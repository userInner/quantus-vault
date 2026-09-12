// Disposable, public test vectors. This file is never included in the extension package.
import { CryptoClient } from '../src/core/crypto-client';
import { ChainCodec,readAccount,feeProbe,validateDraft,type Draft } from '../src/core/chain';
import { Rpc,NETWORKS } from '../src/core/rpc';
import { type Vault } from '../src/core/vault';
import { hex,unhex } from '../src/core/validation';
import { Session } from '../src/core/session';
import { xxhashAsHex } from '@polkadot/util-crypto';
const root=document.querySelector('#results')!;
const client=new CryptoClient();
const phrase='human snow truck virus now jaguar wall brisk shoe craft gravity diesel';
const password='Browser TEST ONLY password 2026';
const address='qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG';
const recipient='qzm5QCox8Dp5A3oSXZZYHD8YoYgPz7enykZb6RPUropdCyN5h';
import { exclusiveTransaction } from '../src/core/transaction-flow';
let passes=0,fails=0;let vault:Vault;let key:CryptoKey;let codec:ChainCodec;
function assert(v:unknown,message='Assertion failed'):asserts v{if(!v)throw new Error(message);}
async function rejects(f:()=>Promise<unknown>){let rejected=false;try{await f();}catch{rejected=true;}assert(rejected,'Expected rejection');}
async function test(name:string,f:()=>Promise<void>){const row=document.createElement('li');row.textContent='RUNNING: '+name;root.append(row);try{await f();row.textContent='PASS: '+name;passes++;}catch(e){row.textContent='FAIL: '+name+' — '+(e as Error).message;fails++;}}
await test('Browser worker creates an encrypted wallet from official HD vector',async()=>{
 const result=await client.run<{vault:Vault;key:CryptoKey}>({op:'create',mnemonic:phrase,password,accountIndex:0});vault=result.vault;key=result.key;assert(vault.address===address);assert(!key.extractable);assert(!JSON.stringify(vault).includes(phrase));
});
await test('Wrong password rejected inside isolated worker',async()=>{await rejects(()=>client.run({op:'unlock',vault,password:'wrong'}));});
await test('Ciphertext metadata tampering rejected inside worker',async()=>{await rejects(()=>client.run({op:'unlock',vault:{...vault,address:recipient},password}));});
await test('Unlock key stays non-extractable through structured clone',async()=>{const result=await client.run<{key:CryptoKey}>({op:'unlock',vault,password});assert(!result.key.extractable);await rejects(()=>crypto.subtle.exportKey('raw',result.key));});
await test('Mnemonic reveal requires password and matches the original',async()=>{const result=await client.run<{mnemonic:string}>({op:'reveal',vault,password});assert(result.mnemonic===phrase);});
await test('Invalid mnemonic checksum rejected',async()=>{await rejects(()=>client.run({op:'create',mnemonic:'abandon '.repeat(12),password,accountIndex:0}));});
await test('Fresh generated entropy yields 24 words',async()=>{const a=await client.run<{mnemonic:string}>({op:'generate'});const b=await client.run<{mnemonic:string}>({op:'generate'});assert(a.mnemonic.split(' ').length===24);assert(a.mnemonic!==b.mnemonic);});
await test('Abort terminates an in-flight worker',async()=>{const promise=client.run({op:'create',mnemonic:phrase,password,accountIndex:0});client.cancelAll();await rejects(()=>promise);});
await test('Pinned metadata loads and passes integrity check in browser',async()=>{codec=await ChainCodec.load(NETWORKS.planck);assert(codec.ed===1_000_000_000n);});
await test('Browser worker signs only reviewed, network-pinned keep-alive calls',async()=>{
 const d:Draft={network:'planck',from:address,to:recipient,amount:'1000000000000',fee:'1000000000',feeLimit:'1200000000',nonce:0,block:100,blockHash:'0x'+'ab'.repeat(32),genesisHash:NETWORKS.planck.genesis,specVersion:148,transactionVersion:6,period:16,call:codec.transfer(recipient,1_000_000_000_000n),created:Date.now(),ed:'1000000000'};
 validateDraft(d,NETWORKS.planck,address);const result=await client.run<{signed:string}>({op:'sign',vault,password,draft:d});const signed=unhex(result.signed);assert(signed.length>7200);assert(unhex(feeProbe(address,d.call,0,100)).length===signed.length);
 await rejects(()=>client.run({op:'sign',vault,password,draft:{...d,to:address}}));await rejects(()=>client.run({op:'sign',vault,password,draft:{...d,network:'mainnet'}}));
 const n=NETWORKS.mainnet;const main={...d,network:'mainnet' as const,genesisHash:n.genesis,specVersion:n.specVersion,transactionVersion:n.transactionVersion};
 const m=await client.run<{signed:string}>({op:'sign',vault,password,draft:main});assert(unhex(m.signed).length===signed.length);assert(m.signed!==result.signed);
 // The resulting transaction uses an artificial checkpoint and is NEVER broadcast.
});
await test('Browser session invalidates a signing token after lock',async()=>{const s=new Session();s.unlock(key);const token=s.token();s.lock();let failed=false;try{s.assert(token);}catch{failed=true;}assert(failed);});
await test('Real browser contexts share the production transfer lock',async()=>{
 const worker=new Worker('lock-probe.js',{type:'module'});
 const probe=()=>new Promise<boolean>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Lock probe timeout')),5000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.onerror=()=>{clearTimeout(timer);reject(new Error('Lock probe failed'));};worker.postMessage('probe');});
 try{await exclusiveTransaction(async()=>{assert(await probe()===false,'Other context acquired an occupied transfer lock');});assert(await probe()===true,'Lock was not released');}finally{worker.terminate();}
});
await test('Live Planck RPC identity and public-address balance read (no signing)',async()=>{const rpc=new Rpc('planck');await rpc.connect();const b=await readAccount(rpc,codec,address);assert(b.block>0);document.querySelector('#live')!.textContent=`Planck block ${b.block}; public test-vector balance ${b.free} base units.`;});
await test('Live mainnet identity, metadata and balance read without broadcasting',async()=>{const rpc=new Rpc('mainnet');await rpc.connect();const c=await ChainCodec.load(NETWORKS.mainnet);const b=await readAccount(rpc,c,address);assert(b.block>0);});
await test('Live fee estimation accepts a dummy signed envelope without broadcasting',async()=>{
 const rpc=new Rpc('planck');await rpc.connect();const account=await readAccount(rpc,codec,address);const call=codec.transfer(recipient,1000000000n);const quote=await rpc.call<any>('payment_queryInfo',[feeProbe(address,call,account.nonce,account.block),account.blockHash]);assert(BigInt(quote.partialFee)>0n);assert(BigInt(quote.partialFee)<10n**12n);document.querySelector('#fee')!.textContent='Live fee quote: '+quote.partialFee+' base units.';
});
await test('Live events can be decoded using the pinned runtime metadata',async()=>{
 const rpc=new Rpc('planck');const head=await rpc.call<string>('chain_getFinalizedHead');const raw=await rpc.call<string>('state_getStorage',[xxhashAsHex('System',128)+xxhashAsHex('Events',128).slice(2),head]);const events=codec.events(raw);assert(Array.isArray(events));assert(events.some(e=>e.event.section==='system' && e.event.method==='ExtrinsicSuccess'));document.querySelector('#events')!.textContent=JSON.stringify(events.slice(0,2));
});
await test('Explicit paste preserves whitespace and line breaks, and never reads before a click',async()=>{
 const {mnemonicInput}=await import('../src/ui/mnemonic-input');let reads=0;
 const {row,input}=mnemonicInput(async()=>{reads++;return ' human\nsnow\ttruck ';});document.body.append(row);
 try{assert(reads===0);row.querySelector('button')!.click();await new Promise(r=>setTimeout(r,0));assert(Number(reads)===1);assert(input.value===' human\nsnow\ttruck ');}finally{row.remove();}
});
await test('Denied clipboard access preserves existing input and shows keyboard fallback',async()=>{
 const {mnemonicInput}=await import('../src/ui/mnemonic-input');const {row,input}=mnemonicInput(async()=>{throw Error('NotAllowed');});document.body.append(row);input.value='existing input';
 try{row.querySelector('button')!.click();await new Promise(r=>setTimeout(r,0));assert(input.value==='existing input');assert(row.textContent!.includes('Ctrl+V'));}finally{row.remove();}
});
await test('Late clipboard resolution cannot repopulate a closed import screen',async()=>{
 const {mnemonicInput}=await import('../src/ui/mnemonic-input');let finish!:(s:string)=>void;const {row,input}=mnemonicInput(()=>new Promise(resolve=>{finish=resolve;}));document.body.append(row);
 row.querySelector('button')!.click();row.remove();finish('public test words');await new Promise(r=>setTimeout(r,0));assert(input.value==='');
});
await test('Long clipboard text is accepted without truncation or a maxlength attribute',async()=>{
 const {mnemonicInput}=await import('../src/ui/mnemonic-input');
 for(const value of ['x'.repeat(4096), '  \n\t  ']){const {row,input}=mnemonicInput(async()=>value);document.body.append(row);input.value='existing input';try{row.querySelector('button')!.click();await new Promise(r=>setTimeout(r,0));assert(input.value===value);assert(!input.hasAttribute('maxlength'));}finally{row.remove();}}
});
document.querySelector('#summary')!.textContent=`${passes} passed / ${fails} failed. No transactions were submitted.`;
