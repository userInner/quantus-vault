import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {ChainCodec,transactionHash} from '../src/core/chain';import {NETWORKS,type RpcLike} from '../src/core/rpc';
import {PrivateJournal,privateRecoveryState,type PrivatePending} from '../src/core/privacy/journal';
import {reservePrivateInputs,cancelPrivatePreparation} from '../src/core/privacy/reservation';
import {submitPrivateBatch} from '../src/core/privacy/submit';
import {checkPrivateReceipt} from '../src/core/privacy/receipt';
import {privacyEconomics,encodePrivacyDigest,buildPrivateWitness} from '../src/core/privacy/witness';
import init,{verifyPrivacyMerkle} from '../privacy-wasm/quantus_privacy_keys';
const h=(n:string)=>'0x'+n.repeat(64),one=h('1'),two=h('2');
const codec=new ChainCodec(fs.readFileSync('public/metadata/mainnet.hex','utf8'));
const exclusive=async<T>(fn:()=>Promise<T>)=>fn();
async function journal(){const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);let disk:unknown;return new PrivateJournal({load:async()=>disk,save:async v=>{disk=structuredClone(v);}},key,NETWORKS.mainnet.genesis,'public-test');}
test('durable preparation protects inputs, allocates change, and only pre-broadcast cancellation releases',async()=>{
 const j=await journal(),o={journal:j,planHash:one,nullifiers:[one],knownChangeThrough:12,block:20,assertActive:()=>{},exclusive};
 const row=await reservePrivateInputs(o);assert.equal(row.changeIndex,13);assert.ok(privateRecoveryState(await j.read()).reserved.has(one));
 await assert.rejects(reservePrivateInputs({...o,planHash:two}));await cancelPrivatePreparation(j,one,()=>{},exclusive);
 assert.equal(privateRecoveryState(await j.read()).reserved.size,0);const next=await reservePrivateInputs({...o,planHash:two});assert.equal(next.changeIndex,14);
 let sends=0;const result=await submitPrivateBatch({encoded:'0x0102',planHash:two,nullifiers:[one],changeIndex:14,journal:j,assertActive:()=>{},recheck:async()=>{},exclusive,broadcast:async()=>{sends++;throw Error('lost response');}});
 assert.equal(result.state,'unknown');assert.equal(sends,1);await assert.rejects(cancelPrivatePreparation(j,two,()=>{},exclusive));assert.ok(privateRecoveryState(await j.read()).reserved.has(one));
});
test('prepared plan mutation and failed durable writes never broadcast',async()=>{
 const j=await journal();await reservePrivateInputs({journal:j,planHash:one,nullifiers:[one],knownChangeThrough:-1,block:0,assertActive:()=>{},exclusive});
 let sends=0;await assert.rejects(submitPrivateBatch({encoded:'0x0102',planHash:one,nullifiers:[two],changeIndex:0,journal:j,assertActive:()=>{},recheck:async()=>{},exclusive,broadcast:async()=>{sends++;return one;}}));assert.equal(sends,0);
 let rechecks=0;await assert.rejects(submitPrivateBatch({encoded:'0x0102',planHash:one,nullifiers:[one],changeIndex:0,journal:j,assertActive:()=>{},recheck:async()=>{if(++rechecks===2)throw Error('locked');},exclusive,broadcast:async()=>{sends++;return one;}}));assert.equal(sends,0);assert.equal((await j.read())[0].state,'broadcasting');
});
const xt='0x0102',row:PrivatePending={hash:transactionHash(xt),planHash:one,nullifiers:[one],changeIndex:0,block:10,created:1,state:'submitted'};
function rpcFor(options:{tip?:number;found?:boolean;spent?:string|null}={}):RpcLike{return {network:NETWORKS.mainnet,verify:async()=>{},call:async(method,params)=>{
 if(method==='chain_getFinalizedHead'||method==='chain_getBlockHash')return two as any;
 if(method==='chain_getHeader')return {number:'0x'+(options.tip??10).toString(16)} as any;
 if(method==='chain_getBlock')return {block:{header:{number:'0xa'},extrinsics:options.found===false?[]:[xt]}} as any;
 if(method==='state_getStorage')return (String(params?.[0]).includes(one.slice(2))?options.spent??'0x01':'0x00') as any;
 throw Error('Unexpected RPC');}};}
test('private success requires a finalized execution event and all nullifiers consumed',async()=>{
 const fake={...codec,events:()=>[{phase:{applyExtrinsic:0},event:{section:'system',method:'ExtrinsicSuccess'}}]} as unknown as ChainCodec;
 assert.equal((await checkPrivateReceipt(rpcFor(),fake,row)).state,'confirmed');
 assert.equal((await checkPrivateReceipt(rpcFor({spent:'0x00'}),fake,row)).state,'unknown');
 assert.equal((await checkPrivateReceipt(rpcFor(),{...fake,events:()=>[{phase:{finalization:null},event:{section:'system',method:'ExtrinsicSuccess'}}]} as unknown as ChainCodec,row)).state,'unknown');
 assert.deepEqual(await checkPrivateReceipt(rpcFor({tip:9}),fake,row),{});
});
test('proof absence never expires and failed broadcasts remain reserved',async()=>{
 assert.deepEqual(await checkPrivateReceipt(rpcFor({found:false}),codec,row),{checkedThrough:10});
 const failed={...row,state:'failed' as const};assert.ok(privateRecoveryState([failed]).reserved.has(one));
 const fake={...codec,events:()=>[{phase:{applyExtrinsic:0},event:{section:'system',method:'ExtrinsicFailed'}}]} as unknown as ChainCodec;
 assert.equal((await checkPrivateReceipt(rpcFor({spent:'0x00'}),fake,row)).state,'failed');
});
test('header digest follows SCALE vector encoding and rejects overflow',()=>{
 assert.deepEqual(encodePrivacyDigest({logs:['0x060102','0x00']}),[8,6,1,2,0]);assert.deepEqual(encodePrivacyDigest({logs:[]}),[0]);
 assert.throws(()=>encodePrivacyDigest({logs:['0x'+'ab'.repeat(110)]}));assert.throws(()=>encodePrivacyDigest({logs:['0xgg']}));
 assert.equal(privacyEconomics(codec).feeBps,4);
});
test('real chain leaf can build a pinned witness with exact fee and change; reservations stop it',async()=>{
 await init({module_or_path:fs.readFileSync('privacy-wasm/quantus_privacy_keys_bg.wasm')});
 const scan=JSON.parse(fs.readFileSync('verification/privacy-live-scan.json','utf8')),proof=JSON.parse(fs.readFileSync('verification/privacy-live-merkle.json','utf8')).result;
 const credit={...scan.credits[0],nullifier:one,status:'unspent' as const,checkpoint:scan.checkpoint,committedAmount:'300000000000',precisionRemainderUnverified:'0'};
 const rpc:RpcLike={network:NETWORKS.mainnet,verify:async()=>{},call:async method=>{
 if(method==='chain_getFinalizedHead'||method==='chain_getBlockHash')return scan.checkpoint.blockHash;
 if(method==='chain_getHeader')return {number:'0x'+scan.checkpoint.height.toString(16),zkTreeRoot:'0x'+Buffer.from(proof.root).toString('hex'),parentHash:two,stateRoot:two,extrinsicsRoot:two,digest:{logs:[]}} as any;
 if(method==='zkTree_getMerkleProof')return proof;if(method==='state_getStorage')return null as any;throw Error('Unexpected RPC');}};
 const options={rpc,codec,credits:[credit],reserved:new Set<string>(),amount:100000000000n,recipient:'qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG',changeIndex:2,verifyMerkle:verifyPrivacyMerkle};
 const result=await buildPrivateWitness(options),inputs=JSON.parse(result.inputsJson);assert.equal(inputs[0].recipient_amount,10);assert.equal(inputs[0].change_amount,19);assert.equal(result.review.fee,'10000000000');
 await assert.rejects(buildPrivateWitness({...options,reserved:new Set([one])}));
});

test('a cancelled proof preparation cannot be resurrected by a stale review',async()=>{
 const j=await journal();await reservePrivateInputs({journal:j,planHash:one,nullifiers:[one],knownChangeThrough:-1,block:0,assertActive:()=>{},exclusive});await cancelPrivatePreparation(j,one,()=>{},exclusive);
 let calls=0;await assert.rejects(submitPrivateBatch({journal:j,encoded:'0x0102',planHash:one,nullifiers:[one],changeIndex:0,assertActive:()=>{},recheck:async()=>{},exclusive,broadcast:async()=>{calls++;return two;}}));assert.equal(calls,0);
});
