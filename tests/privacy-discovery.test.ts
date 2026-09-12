import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPrivacyAddresses,type PrivacyBranch,type PrivacyAddress,type DiscoveryPage} from '../src/core/privacy/discovery';
const checkpoint={genesis:'0x'+'11'.repeat(32),blockHash:'0x'+'22'.repeat(32),height:100};
const id=(branch:number,index:number)=>'0x'+BigInt(branch*1_000_001+index).toString(16).padStart(64,'0');
const derive=async(branch:PrivacyBranch,start:number,count:number):Promise<PrivacyAddress[]>=>Array.from({length:count},(_,i)=>({branch,index:start+i,id:id(branch,start+i)}));
const lookup=(used:Set<string>)=>async(addresses:readonly PrivacyAddress[]):Promise<DiscoveryPage>=>({...checkpoint,indexedThrough:100,complete:true,usedIds:addresses.filter(a=>used.has(a.id)).map(a=>a.id)});
test('privacy discovery restores external and change branches at a fixed checkpoint',async()=>{
 const result=await discoverPrivacyAddresses({checkpoint,derive,lookup:lookup(new Set([id(0,0),id(0,20),id(1,2)]))});
 assert.deepEqual(result.branches.map(b=>b.used.map(a=>a.index)),[[0,20],[2]]);
 assert.deepEqual(result.branches.map(b=>b.scannedThrough),[40,22]);
 assert.equal(result.complete,true);assert.equal(result.scope,'address-discovery-only');
});
test('known high indices extend discovery beyond an empty gap, bounded scans remain incomplete',async()=>{
 const source=lookup(new Set([id(1,80)]));
 const ordinary=await discoverPrivacyAddresses({checkpoint,derive,lookup:source});assert.equal(ordinary.branches[1].used.length,0);
 const expanded=await discoverPrivacyAddresses({checkpoint,derive,lookup:source,knownThrough:{1:80}});assert.equal(expanded.branches[1].used[0].index,80);assert.equal(expanded.branches[1].scannedThrough,100);
 const capped=await discoverPrivacyAddresses({checkpoint,derive,lookup:source,maxIndex:90,knownThrough:{1:80}});assert.equal(capped.complete,false);assert.equal(capped.branches[1].stop,'limit');
});
test('lagging, partial, duplicate, foreign and wrong-checkpoint indexer responses fail closed',async()=>{
 for(const patch of [{indexedThrough:99},{complete:false},{genesis:'0x'+'33'.repeat(32)},{blockHash:'0x'+'44'.repeat(32)},{usedIds:[id(0,0),id(0,0)]},{usedIds:[id(1,90)]}]){
  await assert.rejects(discoverPrivacyAddresses({checkpoint,derive,lookup:async()=>({...checkpoint,indexedThrough:100,complete:true,usedIds:[],...patch})}));
 }
 await assert.rejects(discoverPrivacyAddresses({checkpoint,derive,lookup:async()=>{throw Error('offline');}}));
});
test('invalid derivation and hostile scan ranges are rejected',async()=>{
 await assert.rejects(discoverPrivacyAddresses({checkpoint,derive:async()=>[],lookup:lookup(new Set())}));
 for(const maxIndex of [-1,1.5,Infinity,1_000_001])await assert.rejects(discoverPrivacyAddresses({checkpoint,derive,lookup:lookup(new Set()),maxIndex}));
 await assert.rejects(discoverPrivacyAddresses({checkpoint,derive,lookup:lookup(new Set()),knownThrough:{1:1000},maxIndex:999}));
});
test('cancellation during lookup cannot emit progress or return a successful recovery',async()=>{
 const controller=new AbortController();let progress=0;
 await assert.rejects(discoverPrivacyAddresses({checkpoint,derive,signal:controller.signal,onProgress:()=>progress++,lookup:async()=>{controller.abort();return {...checkpoint,indexedThrough:100,complete:true,usedIds:[]};}}),{name:'AbortError'});
 assert.equal(progress,0);
});
test('indexer adapter cannot mutate the pinned checkpoint or verified address objects',async()=>{
 const result=await discoverPrivacyAddresses({checkpoint,derive,lookup:async(addresses,cp)=>{
  const real=addresses[0].id;(addresses[0] as PrivacyAddress).id=id(1,500);cp.genesis='0x'+'55'.repeat(32);
  return {...checkpoint,indexedThrough:100,complete:true,usedIds:addresses[0].index===0?[real]:[]};
 }});
 assert.equal(result.checkpoint.genesis,checkpoint.genesis);assert.equal(result.branches[0].used[0].id,id(0,0));
});
