import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import init, {account,accountFromMnemonic,signTransfer,signCallFromMnemonic} from '../wasm/quantus_wasm';
import {seal,unlockKey,openVault,validateVault} from '../src/core/vault';
import {parseAmount,formatAmount,validAddress,hex,unhex} from '../src/core/validation';
import {Session} from '../src/core/session';
import {NETWORKS,Rpc,verifyIdentity,type RpcLike} from '../src/core/rpc';
import {ChainCodec,feeProbe,prepareTransfer,recheckDraft,validateDraft,transactionHash,type Draft} from '../src/core/chain';
import {checkReceipt} from '../src/core/receipt';

const phrase='human snow truck virus now jaguar wall brisk shoe craft gravity diesel';
const addr='qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG';
const recipient='qzm5QCox8Dp5A3oSXZZYHD8YoYgPz7enykZb6RPUropdCyN5h';
const password='correct horse cedar valley 2026';
await init({module_or_path:fs.readFileSync('wasm/quantus_wasm_bg.wasm')});
const codec=new ChainCodec(fs.readFileSync('public/metadata/planck.hex','utf8'));

test('official WASM preserves canonical Quantus key derivation vectors',()=>{
 const a=account(new Uint8Array(32));assert.equal(a.address,'qzk1Nxai3dZD9Cn5kwGcgL6mKxsfxwqdis7kDQJ52aJS2vSn7');a.free();
 const b=accountFromMnemonic(phrase,0,0,0);assert.equal(b.address,addr);b.free();
});
test('legacy signing preserves the pre-148 upstream frozen extrinsic digest',()=>{
 const xt=signTransfer(new Uint8Array(32),{recipient:'0x'+'02'.repeat(32),amount:'1000',nonce:0,genesisHash:'0x'+'11'.repeat(32),specVersion:1,transactionVersion:1});
 assert.equal(xt.length,7297);assert.equal(createHash('sha256').update(xt).digest('hex'),'654900132d40bae9ebf3e2fe66ac8a194b2ea3b86956a6c9f78d443cec14479e');
});
test('vault uses randomized authenticated encryption and non-extractable keys',async()=>{
 const a=await seal(phrase,password,addr,0);const b=await seal(phrase,password,addr,0);
 assert.notEqual(a.vault.salt,b.vault.salt);assert.notEqual(a.vault.iv,b.vault.iv);assert.notEqual(a.vault.ciphertext,b.vault.ciphertext);
 assert.equal(a.vault.version,2);assert.equal(a.vault.iterations,900000);
 assert.throws(()=>validateVault({...a.vault,version:1,iterations:600000}));
 assert.equal(a.key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',a.key));
 assert.equal(await openVault(a.vault,a.key),phrase);
 assert.equal(await openVault(a.vault,await unlockKey(a.vault,password)),phrase);
 assert.ok(!JSON.stringify(a.vault).includes(phrase));assert.ok(!JSON.stringify(a.vault).includes(password));
});
test('wrong password, swapped metadata and modified ciphertext fail closed',async()=>{
 const {vault,key}=await seal(phrase,password,addr,0);
 await assert.rejects(openVault(vault,await unlockKey(vault,'incorrect password phrase')));
 for(const modified of [{...vault,accountIndex:1},{...vault,address:recipient},{...vault,iv:vault.iv.replace(/^./,vault.iv[0]==='A'?'B':'A')},{...vault,ciphertext:vault.ciphertext.replace(/^./,vault.ciphertext[0]==='A'?'B':'A')}])await assert.rejects(openVault(modified,key));
 assert.throws(()=>validateVault({...vault,iterations:1}));assert.throws(()=>validateVault({...vault,iterations:2**31}));
 await assert.rejects(seal(phrase,'short',addr,0));
});
test('amount parser preserves 12-decimal precision and rejects ambiguous forms',()=>{
 assert.equal(parseAmount('0.000000000001'),1n);assert.equal(parseAmount('21000000'),21_000_000n*10n**12n);assert.equal(formatAmount(parseAmount('123.450000000001')),'123.450000000001');
 for(const s of ['0','-1','+1','01','1e3','Infinity','NaN','1,000',' 1','1 ','１','1.0000000000001','21000000.000000000001','1.'])assert.throws(()=>parseAmount(s),s);
});
test('address validation rejects checksum mutation, other networks, and noncanonical input',()=>{
 assert.equal(validAddress(addr).length,32);
 for(const value of [addr.slice(0,-1)+'H','0x'+'00'.repeat(32),'5GrwvaEF5zXb26Fz9rcQpDWS64mJC4E6qyXkLg4R4AXFSnYK',addr+' ',addr+'\u200b','javascript:alert(1)'])assert.throws(()=>validAddress(value));
});
test('session invalidates in-flight actions on lock and expires even if timers were suspended',()=>{
 let now=0;const session=new Session(()=>now);const key={} as CryptoKey;session.unlock(key);const token=session.token();assert.equal(session.assert(token),key);
 session.lock();assert.throws(()=>session.assert(token));session.unlock(key);assert.throws(()=>session.assert(token));const t=session.token();now=120001;session.touch();assert.equal(session.isUnlocked(),false);assert.throws(()=>session.assert(t));
});
test('chain identities and unreviewed runtime upgrades are rejected',()=>{
 const n=NETWORKS.planck;const properties={ss58Format:189,tokenDecimals:12,tokenSymbol:'PLK'};const runtime={specName:'quantus-runtime',specVersion:148,transactionVersion:6};verifyIdentity(n,n.genesis,properties,runtime);
 assert.throws(()=>verifyIdentity(n,NETWORKS.mainnet.genesis,properties,runtime));assert.throws(()=>verifyIdentity(n,n.genesis,{...properties,tokenDecimals:18},runtime));assert.throws(()=>verifyIdentity(n,n.genesis,properties,{...runtime,specVersion:149}));
});
function fakeRpc(options:{balance?:bigint;fee?:string;nonce?:number;block?:number}={}):RpcLike{
 const raw=codec.registry.createTypeUnsafe('Lookup3',[{nonce:0,consumers:0,providers:1,sufficients:0,data:{free:(options.balance??100n*10n**12n).toString(),reserved:'0',frozen:'0',flags:'0'}}]).toHex();
 const result:any={chain_getHeader:{number:'0x'+(options.block??100).toString(16)},chain_getBlockHash:'0x'+'ab'.repeat(32),state_getStorage:raw,system_accountNextIndex:options.nonce??0,payment_queryInfo:{partialFee:options.fee??'1000000000'}};
 return {network:NETWORKS.planck,verify:async()=>{},call:async<T>(method:string)=>result[method] as T};
}
let draft:Draft;
test('transfer uses keep-alive encoding, reserves fee and rechecks state',async()=>{
 const rpc=fakeRpc();draft=await prepareTransfer(rpc,codec,addr,recipient,'1');
 assert.ok(draft.call.startsWith('0x020300'));assert.equal(draft.feeLimit,'1200000000');validateDraft(draft,NETWORKS.planck,addr);await recheckDraft(rpc,codec,draft);
 await assert.rejects(prepareTransfer(fakeRpc({balance:1n}),codec,addr,recipient,'1'));
 await assert.rejects(recheckDraft(fakeRpc({nonce:1}),codec,draft));await assert.rejects(recheckDraft(fakeRpc({fee:'2000000000'}),codec,draft));await assert.rejects(recheckDraft(fakeRpc({block:109}),codec,draft));
});
test('worker signing allowlist rejects altered destination, amount, network and stale review',()=>{
 for(const modified of [{...draft,to:addr},{...draft,amount:'2'},{...draft,call:'0x0200'},{...draft,network:'mainnet'},{...draft,genesisHash:NETWORKS.mainnet.genesis},{...draft,period:0}])assert.throws(()=>validateDraft(modified as Draft,NETWORKS.planck,addr));
 assert.throws(()=>validateDraft(draft,NETWORKS.mainnet,addr));assert.throws(()=>validateDraft(draft,NETWORKS.planck,recipient));assert.throws(()=>validateDraft(draft,NETWORKS.planck,addr,draft.created+60001));
});
test('fee probe matches real signed envelope except signature bytes',()=>{
 const signed=signCallFromMnemonic(phrase,unhex(draft.call),{nonce:draft.nonce,tip:'0',period:16,blockNumber:draft.block,genesisHash:draft.genesisHash,blockHash:draft.blockHash,specVersion:draft.specVersion,transactionVersion:draft.transactionVersion},0,0,0);
 const probe=unhex(feeProbe(addr,draft.call,draft.nonce,draft.block));assert.equal(probe.length,signed.length);const prefix=2;const sigStart=prefix+1+33+1;
 assert.deepEqual(probe.slice(0,sigStart),signed.slice(0,sigStart));assert.deepEqual(probe.slice(sigStart+7219),signed.slice(sigStart+7219));assert.ok(signed.length>7200);
});
test('RPC uses no credentials, rejects mismatched IDs and never retries a broadcast',async()=>{
 let count=0;
 const failed=async (_url:any,options:any)=>{count++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');throw new Error('timeout');};
 const rpc=new Rpc('planck',failed as any);await assert.rejects(rpc.broadcastOnce('0x1234'));assert.equal(count,1);
 const mainnet=new Rpc('mainnet',failed as any);await assert.rejects(mainnet.broadcastOnce('0x1234'));assert.equal(count,2);
 await assert.rejects(rpc.call('author_submitExtrinsic',['0x1234']));assert.equal(count,2);
 const bad=new Rpc('planck',(async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:999,result:1}))) as any);await assert.rejects(bad.call('system_health'));
});
test('receipt status depends on finalized execution events, not broadcast acceptance',async()=>{
 const signed='0x123456';const hash=transactionHash(signed);const record={hash,network:'planck' as const,from:addr,to:recipient,amount:'1',time:1,block:100,state:'submitted' as const};
 const result:any={chain_getFinalizedHead:'0x'+'aa'.repeat(32),chain_getHeader:{number:'0x64'},chain_getBlockHash:'0x'+'bb'.repeat(32),chain_getBlock:{block:{extrinsics:[signed]}},state_getStorage:'0x01'};
 const rpc:RpcLike={network:NETWORKS.planck,verify:async()=>{},call:async<T>(method:string)=>result[method] as T};
 const events=(method:string)=>({events:()=>[{phase:{applyExtrinsic:0},event:{section:'system',method}}]}) as unknown as ChainCodec;
 assert.equal((await checkReceipt(rpc,events('ExtrinsicSuccess'),record)).state,'confirmed');assert.equal((await checkReceipt(rpc,events('ExtrinsicFailed'),record)).state,'failed');assert.equal((await checkReceipt(rpc,events('Other'),record)).state,'uncertain');
 result.chain_getBlock={block:{extrinsics:[]}};assert.equal((await checkReceipt(rpc,events('ExtrinsicSuccess'),record)).state,'submitted');result.chain_getHeader={number:'0x74'};assert.equal((await checkReceipt(rpc,events('ExtrinsicSuccess'),record)).state,'failed');
});
test('release manifest exposes no webpages, external messaging, or broad host access',()=>{
 const m=JSON.parse(fs.readFileSync('public/manifest.json','utf8'));assert.deepEqual(m.permissions,['storage']);assert.equal(m.content_scripts,undefined);assert.equal(m.externally_connectable,undefined);assert.equal(m.web_accessible_resources,undefined);assert.equal(m.background,undefined);
 assert.equal(m.host_permissions.length,5);assert.ok(m.host_permissions.every((s:string)=>s.startsWith('https://')&&!s.includes('<all_urls>')));assert.ok(!m.content_security_policy.extension_pages.includes("'unsafe-eval'"));assert.ok(!m.content_security_policy.extension_pages.includes("'unsafe-inline'"));
});

test('portable event codec preserves resolved success names omitted by raw toJSON',()=>{
 const events=codec.events('0x040000000000000000000200');
 assert.equal(events.length,1);assert.equal(events[0].phase.applyExtrinsic,0);
 assert.equal(events[0].event.section,'system');assert.equal(events[0].event.method,'ExtrinsicSuccess');
});

// Audit regression tests exercise the complete orchestration, including persistence failures.
import {submitReviewedTransfer,refreshTransactionRecords,type Exclusive} from '../src/core/transaction-flow';
import {readBoundedResponse} from '../src/core/rpc';
import type {Store,TxRecord} from '../src/core/storage';
function memoryStore(initial:TxRecord[]=[]):Store & {data:TxRecord[];writes:number;onWrite?:(records:TxRecord[],write:number)=>Promise<void>} {
 return {data:structuredClone(initial),writes:0,loadVault:async()=>undefined,saveVault:async()=>{},async history(){return structuredClone(this.data);},async saveHistory(records){this.writes++;await this.onWrite?.(records,this.writes);this.data=structuredClone(records);}};
}
function lease():Exclusive {let held=false;return async work=>{if(held)throw new Error('lease busy');held=true;try{return await work();}finally{held=false;}};}
const freshDraft=()=>({...draft,created:Date.now()});
const signedFixture='0x12345678';
test('send flow stores intent before broadcasting and never resends an unresolved transaction',async()=>{
 const store=memoryStore();let broadcasts=0,signs=0;
 const services={store,exclusive:lease(),assertActive:()=>{},recheck:async()=>{},sign:async()=>{signs++;return signedFixture;},broadcast:async()=>{broadcasts++;assert.equal(store.data[0].state,'broadcasting');return transactionHash(signedFixture);}};
 const result=await submitReviewedTransfer(freshDraft(),services);assert.equal(result.state,'submitted');assert.equal(store.data[0].state,'submitted');
 await assert.rejects(submitReviewedTransfer(freshDraft(),services));assert.equal(signs,1);assert.equal(broadcasts,1);
});
test('lost broadcast response persists uncertainty and blocks duplicate sends',async()=>{
 const store=memoryStore();let calls=0;
 const result=await submitReviewedTransfer(freshDraft(),{store,exclusive:lease(),assertActive:()=>{},recheck:async()=>{},sign:async()=>signedFixture,broadcast:async()=>{calls++;throw Error('response lost');}});
 assert.equal(result.state,'uncertain');assert.equal(store.data[0].state,'uncertain');assert.equal(calls,1);
});
test('a failed durable-intent write cannot lead to broadcasting',async()=>{
 const store=memoryStore();store.onWrite=async()=>{throw Error('disk full');};let calls=0;
 await assert.rejects(submitReviewedTransfer(freshDraft(),{store,exclusive:lease(),assertActive:()=>{},recheck:async()=>{},sign:async()=>signedFixture,broadcast:async()=>{calls++;return transactionHash(signedFixture);}}));assert.equal(calls,0);
});
test('locking during durable-intent write cancels the send before any network write',async()=>{
 const store=memoryStore();let active=true,calls=0;store.onWrite=async(_,n)=>{if(n===1)active=false;};
 await assert.rejects(submitReviewedTransfer(freshDraft(),{store,exclusive:lease(),assertActive:()=>{if(!active)throw Error('locked');},recheck:async()=>{},sign:async()=>signedFixture,broadcast:async()=>{calls++;return transactionHash(signedFixture);}}));
 assert.equal(calls,0);assert.equal(store.data[0].state,'cancelled');
});
test('review expiration during persistence is rechecked immediately before broadcast',async()=>{
 const store=memoryStore();const d=freshDraft();let now=d.created,calls=0;store.onWrite=async(_,n)=>{if(n===1)now=d.created+60001;};
 await assert.rejects(submitReviewedTransfer(d,{store,exclusive:lease(),now:()=>now,assertActive:()=>{},recheck:async()=>{},sign:async()=>signedFixture,broadcast:async()=>{calls++;return transactionHash(signedFixture);}}));
 assert.equal(calls,0);assert.equal(store.data[0].state,'cancelled');
});
test('post-broadcast disk failure leaves the original pending intent recoverable',async()=>{
 const store=memoryStore();store.onWrite=async(_,n)=>{if(n>1)throw Error('disk full');};let calls=0;
 await assert.rejects(submitReviewedTransfer(freshDraft(),{store,exclusive:lease(),assertActive:()=>{},recheck:async()=>{},sign:async()=>signedFixture,broadcast:async()=>{calls++;return transactionHash(signedFixture);}}));
 assert.equal(calls,1);assert.equal(store.data[0].state,'broadcasting');
});
test('checking history reloads the durable journal instead of overwriting it with a stale window',async()=>{
 const store=memoryStore();const exclusive=lease();const staleWindow=await store.history();
 await submitReviewedTransfer(freshDraft(),{store,exclusive,assertActive:()=>{},recheck:async()=>{},sign:async()=>signedFixture,broadcast:async()=>transactionHash(signedFixture)});
 assert.equal(staleWindow.length,0);let checked=0;
 const records=await refreshTransactionRecords(store,addr,async()=>{checked++;return {state:'confirmed'};},()=>{},exclusive);
 assert.equal(checked,1);assert.equal(records.length,1);assert.equal(store.data.length,1);assert.equal(store.data[0].state,'confirmed');
});
test('send and receipt checking share the same exclusive lease',async()=>{
 const store=memoryStore();const exclusive=lease();let release!:()=>void,started!:()=>void;
 const waiting=new Promise<void>(r=>release=r);const entered=new Promise<void>(r=>started=r);
 const sending=submitReviewedTransfer(freshDraft(),{store,exclusive,assertActive:()=>{},recheck:async()=>{},sign:async()=>{started();await waiting;return signedFixture;},broadcast:async()=>transactionHash(signedFixture)});
 await entered;await assert.rejects(refreshTransactionRecords(store,addr,async()=>({state:'confirmed'}),()=>{},exclusive));release();await sending;assert.equal(store.data.length,1);
});
test('RPC response size is limited while streaming, not after allocating the whole body',async()=>{
 let cancelled=false;const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
 await assert.rejects(readBoundedResponse(new Response(stream),12));assert.equal(cancelled,true);
 assert.equal(await readBoundedResponse(new Response('正常'),6),'正常');await assert.rejects(readBoundedResponse(new Response('正常'),5));
 await assert.rejects(readBoundedResponse(new Response('small',{headers:{'content-length':'100'}}),10));
});
test('signing rejects zero, negative, inverted, and excessive fee reservations',()=>{
 for(const change of [{fee:'0'},{fee:'-1'},{fee:'NaN'},{feeLimit:'0'},{feeLimit:'1'},{feeLimit:'1000000000001'}])assert.throws(()=>validateDraft({...freshDraft(),...change},NETWORKS.planck,addr));
});

test('backup choices contain one correct answer and five unique alternatives, including repeated words',async()=>{
 const {createBackupQuiz}=await import('../src/core/backup-quiz');
 for(const phrase of [Array(24).fill('abandon').join(' '),'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual']){
  const words=phrase.split(' ');const quiz=createBackupQuiz(phrase);
  assert.equal(quiz.length,3);assert.equal(new Set(quiz.map(q=>q.position)).size,3);
  for(const q of quiz){assert(q.position>=0&&q.position<24);assert.equal(q.choices.length,6);assert.equal(new Set(q.choices).size,6);assert.equal(q.choices.filter(w=>w===words[q.position]).length,1);}
 }
 assert.throws(()=>createBackupQuiz('abandon abandon'));
});

test('i18n defaults to English and preserves transaction data in translated labels',async()=>{
 const {setLocale,getLocale,t,normalizeLocale}=await import('../src/i18n');
 assert.equal(normalizeLocale(undefined),'en');assert.equal(normalizeLocale('fr'),'en');setLocale('en');assert.equal(getLocale(),'en');
 assert.equal(t('创建新钱包'),'Create a new wallet');assert.equal(t('第 23 个单词是什么？'),'What is word #23?');
 assert.equal(t('可转余额 1.000000000001 PLK · 另需预留手续费'),'Available: 1.000000000001 PLK · Fee reserve required');
 assert.equal(t('qzPUBLIC · 已广播 · 待确认'),'qzPUBLIC · Broadcast · Pending');
 assert.equal(t('密码不正确，或钱包文件已损坏。'),'Incorrect password or damaged wallet file.');
 assert.equal(t('human snow truck virus now jaguar wall brisk shoe craft gravity diesel'),'human snow truck virus now jaguar wall brisk shoe craft gravity diesel');
 setLocale('zh-CN');assert.equal(t('创建新钱包'),'创建新钱包');setLocale('en');
});


test('mainnet transfer pins its own runtime, metadata and durable record',async()=>{
 const mainCodec=new ChainCodec(fs.readFileSync('public/metadata/mainnet.hex','utf8'));
 const rpc={...fakeRpc(),network:NETWORKS.mainnet};
 const d=await prepareTransfer(rpc,mainCodec,addr,recipient,'1');
 assert.equal(d.network,'mainnet');assert.equal(d.specVersion,152);
 validateDraft(d,NETWORKS.mainnet,addr);
 assert.throws(()=>validateDraft(d,NETWORKS.planck,addr));
 assert.throws(()=>validateDraft({...d,network:'planck'},NETWORKS.mainnet,addr));
 await recheckDraft(rpc,mainCodec,d);
 const store=memoryStore([{hash:'0x'+'ab'.repeat(32),network:'planck',from:addr,to:recipient,amount:'1',time:1,block:100,state:'submitted'}]);
 const result=await submitReviewedTransfer(d,{store,exclusive:lease(),assertActive:()=>{},recheck:async()=>{},sign:async()=>signedFixture,broadcast:async()=>transactionHash(signedFixture)});
 assert.equal(result.network,'mainnet');assert.equal(store.data[0].network,'mainnet');assert.equal(store.data[1].network,'planck');
 await assert.rejects(submitReviewedTransfer(d,{store,exclusive:lease(),assertActive:()=>{},recheck:async()=>{},sign:async()=>{throw Error('Must not sign twice');},broadcast:async()=>transactionHash(signedFixture)}));
});
test('receipt checks reject another network before querying a node',async()=>{
 const record={hash:'0x'+'aa'.repeat(32),network:'mainnet' as const,from:addr,to:recipient,amount:'1',time:1,block:100,state:'submitted' as const};
 let reads=0;
 await assert.rejects(checkReceipt({...fakeRpc(),verify:async()=>{reads++;}},codec,record));
 assert.equal(reads,0);
});

import {selectPrivateInputs,privateSpendable,type PrivacyEconomics,type PrivateInput} from '../src/core/privacy/selection';
const economics:PrivacyEconomics={scale:10_000_000_000n,feeBps:10,batchSize:7};
const privateInput=(i:number,scaled:bigint):PrivateInput=>({nullifier:'0x'+i.toString(16).padStart(64,'0'),amount:scaled*economics.scale,index:i,change:false});
test('privacy selection charges once per batch, keeps change, and excludes pending nullifiers',()=>{
 const inputs=Array.from({length:8},(_,i)=>privateInput(i,100n));
 assert.equal(privateSpendable(inputs,new Set(),economics),798n*economics.scale);
 const pending=new Set([inputs[0]!.nullifier]);const plan=selectPrivateInputs(inputs,pending,500n*economics.scale,economics);
 assert.equal(plan.amount,500n*economics.scale);assert.equal(plan.change,99n*economics.scale);assert.equal(plan.fee,economics.scale);
 assert.ok(plan.batches.flat().every(a=>!pending.has(a.input.nullifier)));
 assert.throws(()=>selectPrivateInputs(inputs,pending,700n*economics.scale,economics));
});
test('privacy amount accounting conserves inputs across batch boundaries and dust',()=>{
 for(let count=1;count<=22;count++){
  const inputs=Array.from({length:count},(_,i)=>({...privateInput(i,100n+BigInt(i)),amount:(100n+BigInt(i))*economics.scale+17n}));
  const max=privateSpendable(inputs,new Set(),economics);
  for(const amount of [economics.scale,max]){
   const p=selectPrivateInputs(inputs,new Set(),amount,economics);const leaves=p.batches.flat();
   assert.equal(leaves.reduce((sum,l)=>sum+l.input.amount,0n),p.amount+p.change+p.fee);
   assert.equal(leaves.reduce((sum,l)=>sum+l.recipient,0n)*economics.scale,amount);
   assert.ok(p.batches.every(batch=>batch.length>0&&batch.length<=7));
  }
 }
 assert.throws(()=>selectPrivateInputs([privateInput(0,10n)],new Set(),1n,economics));
 assert.throws(()=>privateSpendable([privateInput(0,10n),privateInput(0,10n)],new Set(),economics));
 assert.throws(()=>privateSpendable([privateInput(0,0x100000000n)],new Set(),economics));
});


test('eight-character passwords create and reopen a vault; seven characters are rejected',async()=>{
 await assert.rejects(seal(phrase,'1234567',addr,0));
 const {vault}=await seal(phrase,'12345678',addr,0);
 assert.equal(await openVault(vault,await unlockKey(vault,'12345678')),phrase);
 await assert.rejects(openVault(vault,await unlockKey(vault,'12345679')));
});

