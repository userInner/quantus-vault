import test from 'node:test';import assert from 'node:assert/strict';
import {PrivacyIndexer} from '../src/core/privacy/indexer';import {NETWORKS,type RpcLike} from '../src/core/rpc';
const cp={genesis:NETWORKS.mainnet.genesis,blockHash:'0x'+'11'.repeat(32),height:100};
const rpc:RpcLike={network:NETWORKS.mainnet,verify:async()=>{},call:async()=>{throw Error('unexpected RPC');}};
test('real indexer adapter omits credentials and fails on errors or foreign checkpoints',async()=>{
 for(const mode of ['graphql','foreign','incomplete']){
 const indexer=new PrivacyIndexer(rpc,async(url,init)=>{
 assert.equal(url,'https://sqm.quantus.com/v1/graphql');assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');
 return new Response(JSON.stringify(mode==='graphql'?{errors:[{message:'secret must not echo'}]}:{data:{block:mode==='incomplete'?[]:[{height:100,hash:'0x'+'22'.repeat(32)}]}}));
 });await assert.rejects(indexer.credits([],cp));
 }
 assert.throws(()=>new PrivacyIndexer({...rpc,network:{...NETWORKS.planck,genesis:NETWORKS.mainnet.genesis}}));
});
test('batched discovery keeps each address result independent and rejects a missing alias',async()=>{
 const {hex,validAddress}=await import('../src/core/validation');const id=hex(validAddress('qzmzErRBVvD8RymrowYD7tFsUyfMXJFJsDa551WukiRANTCjm'));
 let calls=0;let omit=false;
 const indexer=new PrivacyIndexer(rpc,async(_url,init)=>{
  calls++;const request=JSON.parse(String(init?.body));
  const data=request.query.includes('a0:transfer')?(omit?{}:{a0:[{to:{id:request.variables.a0}}]}):{block:[{height:100,hash:cp.blockHash}]};
  return new Response(JSON.stringify({data}));
 });
 const page=await indexer.lookup([{branch:0,index:0,id}],cp);assert.deepEqual(page.usedIds,[id]);assert.equal(calls,3);
 omit=true;await assert.rejects(indexer.lookup([{branch:0,index:0,id}],cp));
});

test('Planck indexer is separated from mainnet and checks its own checkpoint',async()=>{
 const checkpoint={...cp,genesis:NETWORKS.planck.genesis};let calls=0;
 const indexer=new PrivacyIndexer({...rpc,network:NETWORKS.planck},async(url)=>{calls++;assert.equal(url,'https://sub2.quantus.com/v1/graphql');return new Response(JSON.stringify({data:{block:[{height:checkpoint.height,hash:checkpoint.blockHash}]}}));});
 assert.deepEqual(await indexer.credits([],checkpoint),[]);assert.ok(calls>0);await assert.rejects(indexer.credits([],cp));
});
