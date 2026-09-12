import test from 'node:test';import assert from 'node:assert/strict';
import {quotePrivateBatches,reservePrivateBatches,requirePreviousBatchesConfirmed,cancelRemainingPrivateBatches} from '../src/core/privacy/batches';
import {PrivateJournal,privateRecoveryState} from '../src/core/privacy/journal';
import {submitPrivateBatch} from '../src/core/privacy/submit';
import {Rpc,NETWORKS} from '../src/core/rpc';
import {transactionHash} from '../src/core/chain';
import type {CheckedCredit} from '../src/core/privacy/scanner';
const h=(n:number)=>'0x'+n.toString(16).padStart(64,'0');
const address='qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG';
const credits:CheckedCredit[]=Array.from({length:15},(_,i)=>({id:String(i),owner:{branch:0,index:i,id:h(i+50)},amount:'100000000000',leafIndex:String(i),transferCount:'0',block:10,blockHash:h(90),status:'unspent',nullifier:h(i+1),checkpoint:{genesis:NETWORKS.mainnet.genesis,height:10,blockHash:h(90)},committedAmount:'100000000000',precisionRemainderUnverified:'0'}));
const economics={scale:10000000000n,feeBps:4,batchSize:7 as const},exclusive=async<T>(work:()=>Promise<T>)=>work();
async function fixture(){const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);let disk:unknown;let writes=0;const io={load:async()=>disk,save:async(v:unknown)=>{disk=structuredClone(v);writes++;}};const journal=new PrivateJournal(io,key,NETWORKS.mainnet.genesis,address);return {journal,reopen:()=>new PrivateJournal(io,key,NETWORKS.mainnet.genesis,address),writes:()=>writes};}
const quote=()=>quotePrivateBatches(credits,new Set(),1400000000000n,address,economics);
test('15 inputs form three conserving batches with distinct inputs and exact aggregate fees',()=>{
 const q=quote();assert.equal(q.batches.length,3);assert.deepEqual(q.batches.map(b=>b.nullifiers.length),[7,7,1]);assert.equal(q.amount,'1400000000000');assert.equal(q.fee,'30000000000');assert.equal(q.change,'70000000000');
 assert.equal(new Set(q.batches.flatMap(b=>b.nullifiers)).size,15);
 assert.throws(()=>quotePrivateBatches(credits,new Set(credits.map(c=>c.nullifier)),1n,address,economics));
});
test('all batch reservations persist in one write and survive reopening with their amounts',async()=>{
 const f=await fixture();const group=await reservePrivateBatches({journal:f.journal,quote:quote(),knownChangeThrough:4,block:10,assertActive:()=>{},exclusive});assert.equal(f.writes(),1);
 const rows=await f.reopen().read();assert.deepEqual(rows.map(r=>r.changeIndex),[5,6,7]);assert.ok(rows.every(r=>r.details?.group===group));assert.equal(privateRecoveryState(rows).reserved.size,15);
 await assert.rejects(reservePrivateBatches({journal:f.journal,quote:quote(),knownChangeThrough:4,block:10,assertActive:()=>{},exclusive}));assert.equal(f.writes(),1);
});
test('later batches require finalized predecessors; unknown, failed and cancelled never count as paid',async()=>{
 const f=await fixture();await reservePrivateBatches({journal:f.journal,quote:quote(),knownChangeThrough:-1,block:10,assertActive:()=>{},exclusive});const rows=await f.journal.read();
 requirePreviousBatchesConfirmed(rows,rows[0]);for(const state of ['prepared','submitted','unknown','failed','cancelled'] as const){rows[0].state=state;assert.throws(()=>requirePreviousBatchesConfirmed(rows,rows[1]));}
 rows[0].state='confirmed';requirePreviousBatchesConfirmed(rows,rows[1]);assert.throws(()=>requirePreviousBatchesConfirmed(rows.slice(0,2),rows[1]));
});
test('partial send and cancellation preserve sent records and release only never-broadcast inputs',async()=>{
 const f=await fixture();const group=await reservePrivateBatches({journal:f.journal,quote:quote(),knownChangeThrough:-1,block:10,assertActive:()=>{},exclusive});const first=(await f.journal.read())[0];let calls=0;
 const submitted=await submitPrivateBatch({journal:f.journal,requirePrepared:true,encoded:'0x0102',planHash:first.planHash,nullifiers:first.nullifiers,changeIndex:first.changeIndex,assertActive:()=>{},recheck:async()=>{},exclusive,broadcast:async data=>{calls++;return transactionHash(data);}});assert.equal(submitted.details?.group,group);
 await cancelRemainingPrivateBatches(f.journal,group,()=>{},exclusive);const rows=await f.reopen().read();assert.deepEqual(rows.map(r=>r.state),['submitted','cancelled','cancelled']);assert.equal(privateRecoveryState(rows).reserved.size,7);assert.equal(calls,1);
});
test('malformed totals and overlapping batches are rejected before any durable write',async()=>{
 const f=await fixture(),q=quote();q.amount='1';await assert.rejects(reservePrivateBatches({journal:f.journal,quote:q,knownChangeThrough:-1,block:10,assertActive:()=>{},exclusive}));
 const duplicate=quote();duplicate.batches[1].nullifiers[0]=duplicate.batches[0].nullifiers[0];await assert.rejects(reservePrivateBatches({journal:f.journal,quote:duplicate,knownChangeThrough:-1,block:10,assertActive:()=>{},exclusive}));assert.equal(f.writes(),0);
});
test('broadcast gate rejects unsigned private extrinsics before making any network request',async()=>{
 let calls=0;const rpc=new Rpc('mainnet',async()=>{calls++;throw Error('must not fetch');});await assert.rejects(rpc.broadcastOnce('0x0404'),/隐私广播尚未开放/);assert.equal(calls,0);
});
