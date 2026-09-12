import {seal} from '../src/core/vault';import {ChainCodec} from '../src/core/chain';import {NETWORKS,type RpcLike} from '../src/core/rpc';
import {PrivateJournal} from '../src/core/privacy/journal';import {PrivacyKeysClient} from '../src/core/privacy/keys-client';
import {quotePrivateBatches,reservePrivateBatches} from '../src/core/privacy/batches';import {prepareReservedPrivateBatch,sendPreparedPrivateTransfer} from '../src/core/privacy/transfer';
import {privacyEconomics} from '../src/core/privacy/witness';import init,{verifyPrivacyMerkle} from '../privacy-wasm/quantus_privacy_keys';
import {hex} from '../src/core/validation';import {encodeAddress} from '@polkadot/util-crypto';import type {CheckedCredit} from '../src/core/privacy/scanner';import fixture from './privacy-proof-fixture.json';
const output=document.querySelector('#result')!;const assert=(ok:unknown)=>{if(!ok)throw Error('Assertion failed');};
try{
 const password='Browser TEST ONLY password 2026',phrase='human snow truck virus now jaguar wall brisk shoe craft gravity diesel',address='qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG';
 const {vault,key}=await seal(phrase,password,address,0);let disk:unknown;const journal=new PrivateJournal({load:async()=>disk,save:async value=>{disk=structuredClone(value);}},key,NETWORKS.mainnet.genesis,address);
 const f=fixture[0];const cp={genesis:NETWORKS.mainnet.genesis,height:100,blockHash:hex(Uint8Array.from(f.block_hash))};
 const nullifier=await new PrivacyKeysClient().nullifier(vault,password,0,0,'0');
 const credit:CheckedCredit={id:'synthetic-public',owner:{branch:0,index:0,id:nullifier.addressId},amount:'100000000000000',leafIndex:'0',transferCount:'0',block:100,blockHash:cp.blockHash,status:'unspent',nullifier:nullifier.nullifier,checkpoint:cp,committedAmount:'100000000000000',precisionRemainderUnverified:'0'};
 const rpc:RpcLike={network:NETWORKS.mainnet,verify:async()=>{},call:async(method)=>{
 if(method==='chain_getBlockHash'||method==='chain_getFinalizedHead')return cp.blockHash as any;
 if(method==='chain_getHeader')return {number:'0x64',zkTreeRoot:hex(Uint8Array.from(f.root)),parentHash:hex(Uint8Array.from(f.parent_hash)),stateRoot:hex(Uint8Array.from(f.state_root)),extrinsicsRoot:hex(Uint8Array.from(f.extrinsics_root)),digest:{logs:[]}} as any;
 if(method==='zkTree_getMerkleProof')return {leaf_index:0,depth:0,leaf_data:f.leaf,siblings:[],root:f.root} as any;
 if(method==='state_getStorage')return null as any;throw Error('Unexpected RPC');}};
 const codec=await ChainCodec.load(NETWORKS.mainnet),recipient=encodeAddress(Uint8Array.from(f.recipient),189);await init({module_or_path:new URL('quantus_privacy_keys_bg.wasm',location.href)});
 const quote=quotePrivateBatches([credit],new Set(),99950000000000n,recipient,privacyEconomics(codec));
 const group=await reservePrivateBatches({journal,quote,knownChangeThrough:-1,block:100,assertActive:()=>{}});const start=performance.now();
 const review=await prepareReservedPrivateBatch({vault,password,rpc,codec,journal,credits:[{...credit,status:'reserved'}],amount:BigInt(quote.amount),recipient,knownChangeThrough:-1,signal:new AbortController().signal,assertActive:()=>{},verifyMerkle:verifyPrivacyMerkle,group,batchIndex:0,onStage:()=>{output.textContent='Proving through the production preparation service…';}});
 assert(review.amount===quote.amount&&review.fee===quote.fee&&review.change===quote.change);assert(Object.isFrozen(review));
 let broadcasts=0,rejected=false;try{await sendPreparedPrivateTransfer(review,{rpc,codec,journal,signal:new AbortController().signal,assertActive:()=>{},broadcast:async()=>{broadcasts++;return cp.blockHash;}});}catch{rejected=true;}
 assert(rejected&&broadcasts===0&&(await journal.read())[0].state==='prepared');
 output.textContent=`PASS: durable batch reservation → real witness builder → isolated WASM proof → immutable review in ${Math.round(performance.now()-start)} ms. PASS: production broadcast gate sent zero requests. Synthetic chain only; no funds.`;
}catch(error){output.textContent='FAIL: '+String(error);}
