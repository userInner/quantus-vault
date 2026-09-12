import {seal} from '../src/core/vault';
import {PrivacyKeysClient} from '../src/core/privacy/keys-client';
import {discoverPrivacyAddresses} from '../src/core/privacy/discovery';
const phrase='human snow truck virus now jaguar wall brisk shoe craft gravity diesel';
const password='testpass';const client=new PrivacyKeysClient();
const {vault}=await seal(phrase,password,'qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG',0);
let passed=0,failed=0;
const assert=(value:unknown)=>{if(!value)throw Error('Assertion failed');};
async function test(name:string,run:()=>Promise<void>){const row=document.createElement('li');document.querySelector('ol')!.append(row);row.textContent='Running: '+name;try{await run();passed++;row.textContent='PASS: '+name;}catch(e){failed++;row.textContent='FAIL: '+name+' '+String(e);}}
await test('12-word recovery derives distinct external and change addresses without returning secrets',async()=>{
 const external=await client.derive(vault,password,0,0,2),change=await client.derive(vault,password,1,0,2);
 assert(external.length===2 && change.length===2 && external[0].id!==change[0].id);
 for(const row of [...external,...change])assert(Object.keys(row).sort().join(',')==='branch,id,index');
 assert((await client.derive(vault,password,0,0,2))[1].id===external[1].id);
});
await test('wrong password and invalid ranges fail without results',async()=>{
 for(const run of [()=>client.derive(vault,'incorrect',0,0,1),()=>client.derive(vault,password,0,0,101),()=>client.derive(vault,password,0,-1,1)]){
  let rejected=false;try{await run();}catch{rejected=true;}assert(rejected);
 }
});
await test('locking cancels in-flight privacy derivation',async()=>{
 const pending=client.derive(vault,password,0,0,100);client.cancelAll();let rejected=false;try{await pending;}catch{rejected=true;}assert(rejected);
});
await test('24-word recovery produces deterministic addresses',async()=>{
 const mnemonic=Array(23).fill('abandon').join(' ')+' art';
 const v=await seal(mnemonic,password,vault.address,0);
 const a=await client.derive(v.vault,password,1,20,1),b=await client.derive(v.vault,password,1,20,1);assert(a[0].id===b[0].id);
});
await test('discovery composes real WASM derivation with simulated indexer on both branches',async()=>{
 const checkpoint={genesis:'0x'+'11'.repeat(32),blockHash:'0x'+'22'.repeat(32),height:100};
 const result=await discoverPrivacyAddresses({checkpoint,gapLimit:2,maxIndex:5,derive:(branch,start,count)=>client.derive(vault,password,branch,start,count),lookup:async(addresses)=>({...checkpoint,indexedThrough:100,complete:true,usedIds:addresses.filter(a=>a.index===0).map(a=>a.id)})});
 assert(result.complete && result.branches.every(b=>b.used.length===1 && b.scannedThrough===2));
});
document.querySelector('h2')!.textContent=`${passed} passed / ${failed} failed`;
await test('Nullifiers are derived in worker without exposing spending material',async()=>{
 const a=await client.nullifier(vault,password,0,0,'0'),b=await client.nullifier(vault,password,0,0,'1');
 assert(a.addressId===b.addressId && a.nullifier!==b.nullifier && Object.keys(a).sort().join(',')==='addressId,nullifier');
});
document.querySelector('h2')!.textContent=`${passed} passed / ${failed} failed`;
await test('Live official mainnet indexer and header-bound Merkle proof verify in browser',async()=>{
 const {Rpc}=await import('../src/core/rpc');const {PrivacyIndexer}=await import('../src/core/privacy/indexer');const {hex,validAddress}=await import('../src/core/validation');
 const wasm=await import('../privacy-wasm/quantus_privacy_keys');await wasm.default({module_or_path:new URL('quantus_privacy_keys_bg.wasm',location.href)});
 const rpc=new Rpc('mainnet');await rpc.connect();const indexer=new PrivacyIndexer(rpc);let cp;try{cp=await indexer.checkpoint();}catch(e){throw Error('Indexer checkpoint: '+String(e));}
 const credits=await indexer.credits([{branch:0,index:0,id:hex(validAddress('qzmzErRBVvD8RymrowYD7tFsUyfMXJFJsDa551WukiRANTCjm'))}],cp);assert(credits.length>0);
 const proof=await rpc.call<any>('zkTree_getMerkleProof',[Number(credits[0].leafIndex),cp.blockHash]);const header=await rpc.call<any>('chain_getHeader',[cp.blockHash]);
 assert(hex(Uint8Array.from(proof.root))===header.zkTreeRoot);
 assert(wasm.verifyPrivacyMerkle(Uint8Array.from(proof.leaf_data),Uint8Array.from(proof.siblings.flat(2)),Uint8Array.from(proof.root)));
});
document.querySelector('h2')!.textContent=`${passed} passed / ${failed} failed`;
