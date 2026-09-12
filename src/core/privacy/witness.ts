import {compactToU8a,u8aConcat} from '@polkadot/util';
import {blake2AsHex} from '@polkadot/util-crypto';
import type {ChainCodec} from '../chain';
import type {RpcLike} from '../rpc';
import {validAddress,unhex,isHash} from '../validation';
import {verifyPrivacyCredits,type CheckedCredit} from './scanner';
import {selectPrivateInputs,type PrivacyEconomics} from './selection';
export function privacyEconomics(codec:ChainCodec):PrivacyEconomics{
 const constant=codec.metadata.asLatest.pallets.find(p=>p.name.toString()==='Wormhole')?.constants.find(c=>c.name.toString()==='VolumeFeeRateBps');
 if(!constant||codec.registry.lookup.getTypeDef(constant.type).type!=='u32')throw Error('Unsupported private fee metadata');
 const feeBps=Number(codec.registry.createTypeUnsafe(codec.registry.createLookupType(constant.type),[constant.value]).toString());
 if(!Number.isSafeInteger(feeBps)||feeBps<0||feeBps>10000)throw Error('Invalid private fee');
 return {scale:10_000_000_000n,feeBps,batchSize:7};
}
export function encodePrivacyDigest(digest:unknown):number[]{
 const logs=(digest as {logs?:unknown})?.logs;
 if(!Array.isArray(logs)||logs.length>32||logs.some(log=>typeof log!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(log)||log.length>222))throw Error('Invalid private header digest');
 // RPC log entries are already SCALE encoded DigestItems; prefix only the vector length.
 const encoded=u8aConcat(compactToU8a(logs.length),...logs.map(log=>unhex(log)));
 if(encoded.length>110)throw Error('Private header digest exceeds circuit limit');return [...encoded];
}
const hashBytes=(v:unknown)=>{if(!isHash(v))throw Error('Invalid private header hash');return [...unhex(v)];};
/** Build one batch from real finalized leaves; all input and output amounts are integer circuit units. */
export async function buildPrivateWitness(options:{rpc:RpcLike;codec:ChainCodec;credits:readonly CheckedCredit[];reserved:ReadonlySet<string>;amount:bigint;recipient:string;changeIndex:number;verifyMerkle:(leaf:Uint8Array,siblings:Uint8Array,root:Uint8Array)=>boolean;signal?:AbortSignal}){
 options.signal?.throwIfAborted();const recipient=[...validAddress(options.recipient)],e=privacyEconomics(options.codec);
 if(!Number.isSafeInteger(options.changeIndex)||options.changeIndex<0||options.changeIndex>=0x80000000)throw Error('Invalid private change index');
 const available=options.credits.filter(c=>c.status==='unspent');const byNullifier=new Map(available.map(c=>[c.nullifier,c]));
 const plan=selectPrivateInputs(available.map(c=>({nullifier:c.nullifier,amount:BigInt(c.committedAmount),index:c.owner.index,change:c.owner.branch===1})),options.reserved,options.amount,e);
 if(plan.batches.length!==1)throw Error('This amount needs multiple private batches; split it into smaller transfers');
 const selected=plan.batches[0].map(a=>byNullifier.get(a.input.nullifier)!);const cp=selected[0].checkpoint;
 if(selected.some(c=>JSON.stringify(c.checkpoint)!==JSON.stringify(cp)))throw Error('Private inputs belong to different checkpoints');
 const proofs=new Map<number,any>();let header:any;
 const capturing:RpcLike={network:options.rpc.network,verify:()=>options.rpc.verify(),call:async<T>(method:string,params?:unknown[]):Promise<T>=>{
  const value=await options.rpc.call<T>(method,params);options.signal?.throwIfAborted();
  if(method==='zkTree_getMerkleProof')proofs.set(Number(params![0]),structuredClone(value));
  if(method==='chain_getHeader'&&params?.[0]===cp.blockHash)header=structuredClone(value);
  return value;
 }};
 const verified=await verifyPrivacyCredits({rpc:capturing,codec:options.codec,checkpoint:cp,credits:selected.map(c=>({...c,status:'unverified' as const})),reserved:options.reserved,signal:options.signal,verifyMerkle:options.verifyMerkle,
  nullifier:async c=>{const owned=selected.find(row=>row.id===c.id);if(!owned)throw Error('Private input mismatch');return {addressId:owned.owner.id,nullifier:owned.nullifier};}});
 if(verified.some(c=>c.status!=='unspent'))throw Error('Private inputs are no longer spendable');
 if(typeof header?.number!=='string'||!/^0x[0-9a-f]+$/i.test(header.number)||BigInt(header.number)!==BigInt(cp.height)||cp.height>0xffffffff)throw Error('Private witness header mismatch');
 const digest=encodePrivacyDigest(header.digest);
 const inputs=plan.batches[0].map((a,i)=>{
  const c=selected[i],p=proofs.get(Number(c.leafIndex));
  return {branch:c.owner.branch,index:c.owner.index,leaf:p.leaf_data,siblings:p.siblings,root:p.root,block_hash:hashBytes(cp.blockHash),block_number:cp.height,parent_hash:hashBytes(header.parentHash),state_root:hashBytes(header.stateRoot),extrinsics_root:hashBytes(header.extrinsicsRoot),digest,recipient,recipient_amount:Number(a.recipient),change_index:options.changeIndex,change_amount:Number(a.change),fee_bps:e.feeBps};
 });
 const inputsJson=JSON.stringify(inputs);if(inputsJson.length>100000)throw Error('Private witness exceeds worker limit');
 const review={genesis:cp.genesis,checkpoint:cp,recipient:options.recipient,amount:plan.amount.toString(),fee:plan.fee.toString(),change:plan.change.toString(),changeIndex:options.changeIndex,nullifiers:selected.map(c=>c.nullifier),feeBps:e.feeBps};
 return {inputsJson,review,planHash:blake2AsHex(new TextEncoder().encode(JSON.stringify({review,inputs})),256)};
}
