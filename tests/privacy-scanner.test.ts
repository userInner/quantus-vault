import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import init,{verifyPrivacyMerkle} from '../privacy-wasm/quantus_privacy_keys';
import {ChainCodec} from '../src/core/chain';import {NETWORKS,type RpcLike} from '../src/core/rpc';import {verifyPrivacyCredits} from '../src/core/privacy/scanner';
await init({module_or_path:fs.readFileSync('privacy-wasm/quantus_privacy_keys_bg.wasm')});
const scan=JSON.parse(fs.readFileSync('verification/privacy-live-scan.json','utf8'));
const proof=JSON.parse(fs.readFileSync('verification/privacy-live-merkle.json','utf8')).result;
const codec=new ChainCodec(fs.readFileSync('public/metadata/mainnet.hex','utf8'));
const nullifier='0x'+'11'.repeat(32);
const rpc:RpcLike={network:NETWORKS.mainnet,verify:async()=>{},call:async(method)=>{
 if(method==='chain_getBlockHash'||method==='chain_getFinalizedHead')return scan.checkpoint.blockHash;
 if(method==='chain_getHeader')return {number:'0x'+scan.checkpoint.height.toString(16),zkTreeRoot:'0x'+Buffer.from(proof.root).toString('hex')};
 if(method==='zkTree_getMerkleProof')return proof;if(method==='state_getStorage')return null;throw Error('Unexpected method');
}};
test('live mainnet proof verifies with official circuit hashing; tampering fails',()=>{
 const leaf=Uint8Array.from(proof.leaf_data),siblings=Uint8Array.from(proof.siblings.flat(2)),root=Uint8Array.from(proof.root);
 assert.equal(verifyPrivacyMerkle(leaf,siblings,root),true);leaf[50]^=1;assert.equal(verifyPrivacyMerkle(leaf,siblings,root),false);
});
test('scanner checks commitment and ownership before classifying funds, excludes reservations',async()=>{
 const base={rpc,codec,checkpoint:scan.checkpoint,credits:[scan.credits[0]],nullifier:async()=>({addressId:scan.credits[0].owner.id,nullifier}),verifyMerkle:verifyPrivacyMerkle,reserved:new Set<string>()};
 const rows=await verifyPrivacyCredits(base);assert.equal(rows[0].status,'unspent');assert.equal(rows[0].committedAmount,'300000000000');
 assert.equal((await verifyPrivacyCredits({...base,reserved:new Set([nullifier])}))[0].status,'reserved');
 await assert.rejects(verifyPrivacyCredits({...base,nullifier:async()=>({addressId:'0x'+'22'.repeat(32),nullifier})}));
 await assert.rejects(verifyPrivacyCredits({...base,verifyMerkle:()=>false}));
 await assert.rejects(verifyPrivacyCredits({...base,credits:[scan.credits[0],scan.credits[0]]}));
});
test('private extrinsic is encoded from pinned metadata as an unsigned verify_private_batch call',async()=>{
 const {encodePrivateBatch}=await import('../src/core/privacy/extrinsic');
 const {compactStripLength}=await import('@polkadot/util');const {unhex}=await import('../src/core/validation');
 const encoded=unhex(encodePrivateBatch(codec,new Uint8Array(151156)));
 const [,body]=compactStripLength(encoded);assert.deepEqual([...body.slice(0,3)],[4,20,2]);
 assert.throws(()=>encodePrivateBatch(codec,new Uint8Array(2)));
});
test('encrypted private journal authenticates network and blocks resending ambiguous spends',async()=>{
 const {seal}=await import('../src/core/vault');const {PrivateJournal}=await import('../src/core/privacy/journal');const {submitPrivateBatch}=await import('../src/core/privacy/submit');
 const {key}=await seal('public fixture','testpass','qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG',0);
 let disk:unknown;const journal=new PrivateJournal({load:async()=>disk,save:async v=>{disk=structuredClone(v);}},key,NETWORKS.mainnet.genesis,'public-test');
 const {encodePrivateBatch}=await import('../src/core/privacy/extrinsic');const encoded=encodePrivateBatch(codec,new Uint8Array(151156));let calls=0;
 const options={encoded,planHash:nullifier,nullifiers:[nullifier],changeIndex:0,journal,assertActive:()=>{},recheck:async()=>{},exclusive:async<T>(fn:()=>Promise<T>)=>fn(),broadcast:async()=>{calls++;throw Error('response lost');}};
 const row=await submitPrivateBatch(options);assert.equal(row.state,'unknown');assert.equal(calls,1);assert.ok(!JSON.stringify(disk).includes(nullifier));
 await assert.rejects(submitPrivateBatch(options));assert.equal(calls,1);
 const other=new PrivateJournal({load:async()=>disk,save:async()=>{}},key,NETWORKS.planck.genesis,'public-test');await assert.rejects(other.read());
 const broken=new PrivateJournal({load:async()=>undefined,save:async()=>{throw Error('disk failed');}},key,NETWORKS.mainnet.genesis,'public-test');
 await assert.rejects(submitPrivateBatch({...options,journal:broken}));assert.equal(calls,1);
});
