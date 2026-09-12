import {blake2AsHex,xxhashAsHex} from '@polkadot/util-crypto';
import type {RpcLike} from '../rpc';
import {hex,unhex,isHash} from '../validation';
import type {ChainCodec} from '../chain';
import type {DiscoveryCheckpoint} from './discovery';
import type {PrivacyCredit} from './indexer';
export type CheckedCredit=Omit<PrivacyCredit,'status'> & {nullifier:string;status:'unspent'|'spent'|'reserved';checkpoint:DiscoveryCheckpoint;committedAmount:string;precisionRemainderUnverified:string};
export function nullifierStorageKey(codec:ChainCodec,nullifier:string):string{
  if(!isHash(nullifier))throw Error('Invalid nullifier');
  const pallet=codec.metadata.asLatest.pallets.find(p=>p.name.toString()==='Wormhole');
  const storage=pallet?.storage.unwrap();const entry=storage?.items.find(i=>i.name.toString()==='UsedNullifiers');
  if(!entry?.type.isMap||entry.type.asMap.hashers.length!==1||!entry.type.asMap.hashers[0].isBlake2128Concat||codec.registry.lookup.getTypeDef(entry.type.asMap.key).type!=='[u8;32]'||codec.registry.lookup.getTypeDef(entry.type.asMap.value).type!=='bool')throw Error('Unsupported nullifier storage');
  return xxhashAsHex(storage!.prefix.toString(),128)+xxhashAsHex('UsedNullifiers',128).slice(2)+blake2AsHex(unhex(nullifier),128).slice(2)+nullifier.slice(2);
}
function bytes(v:unknown,length?:number):Uint8Array{
  if(!Array.isArray(v)||!v.every(n=>Number.isInteger(n)&&n>=0&&n<=255)||(length!==undefined&&v.length!==length))throw Error('Invalid Merkle bytes');return Uint8Array.from(v);
}
/** No indexer-only credit can enter the spendable set. Secrets are handled by an injected isolated worker. */
export async function verifyPrivacyCredits(options:{
  rpc:RpcLike;codec:ChainCodec;checkpoint:DiscoveryCheckpoint;credits:readonly PrivacyCredit[];
  nullifier:(credit:PrivacyCredit)=>Promise<{addressId:string;nullifier:string}>;
  verifyMerkle:(leaf:Uint8Array,siblings:Uint8Array,root:Uint8Array)=>boolean;
  reserved:ReadonlySet<string>;signal?:AbortSignal;
}):Promise<CheckedCredit[]>{
  const {rpc,checkpoint:cp}=options;await rpc.verify();
  if(cp.genesis!==rpc.network.genesis||!isHash(cp.blockHash))throw Error('Wrong privacy scan network');
  const alive=()=>options.signal?.throwIfAborted();alive();
  if(!Number.isSafeInteger(cp.height)||cp.height<0)throw Error('Invalid checkpoint height');
  const finalHash=await rpc.call<string>('chain_getFinalizedHead');
  const finalHeader=await rpc.call<{number:string}>('chain_getHeader',[finalHash]);
  if(typeof finalHeader?.number!=='string'||!/^0x[0-9a-f]+$/i.test(finalHeader.number)||BigInt(finalHeader.number)<BigInt(cp.height))throw Error('Checkpoint is not finalized');
  if(await rpc.call('chain_getBlockHash',[cp.height])!==cp.blockHash)throw Error('Privacy checkpoint changed');
  const header=await rpc.call<{zkTreeRoot:string}>('chain_getHeader',[cp.blockHash]);if(!isHash(header?.zkTreeRoot))throw Error('Missing header-bound ZK root');
  const result:CheckedCredit[]=[];const seen=new Set<string>();
  for(const c of options.credits){
    alive();if(!/^(0|[1-9][0-9]*)$/.test(c.leafIndex)||!Number.isSafeInteger(Number(c.leafIndex))||c.block>cp.height)throw Error('Invalid private credit index');const proof=await rpc.call<any>('zkTree_getMerkleProof',[Number(c.leafIndex),cp.blockHash]);alive();
    if(!Number.isSafeInteger(Number(c.leafIndex))||!proof||String(proof.leaf_index)!==c.leafIndex||!Number.isInteger(proof.depth)||proof.depth<0||proof.depth>32||!Array.isArray(proof.siblings)||proof.siblings.length!==proof.depth)throw Error('Privacy Merkle proof unavailable');
    const leaf=bytes(proof.leaf_data,60);const root=bytes(proof.root,32);
    const view=new DataView(leaf.buffer);const tc=view.getBigUint64(32,true);const asset=view.getUint32(40,true);const amount=view.getBigUint64(44,true)+(view.getBigUint64(52,true)<<64n);
    if(hex(leaf.slice(0,32))!==c.owner.id||tc.toString()!==c.transferCount||amount.toString()!==c.amount||asset!==0||hex(root)!==header.zkTreeRoot)throw Error('Privacy credit does not match chain commitment');
    const flat:number[]=[];for(const level of proof.siblings){if(!Array.isArray(level)||level.length!==3)throw Error('Invalid Merkle level');for(const sibling of level)flat.push(...bytes(sibling,32));}
    if(!options.verifyMerkle(leaf,Uint8Array.from(flat),root))throw Error('Privacy Merkle verification failed');
    const derived=await options.nullifier(c);alive();
    if(derived.addressId!==c.owner.id||!isHash(derived.nullifier)||seen.has(derived.nullifier))throw Error('Private credit ownership mismatch or duplicate');seen.add(derived.nullifier);
    const spent=await rpc.call<string|null>('state_getStorage',[nullifierStorageKey(options.codec,derived.nullifier),cp.blockHash]);alive();
    if(![null,'0x00','0x01'].includes(spent))throw Error('Invalid nullifier state');
    result.push({...c,owner:{...c.owner},nullifier:derived.nullifier,status:spent==='0x01'?'spent':options.reserved.has(derived.nullifier)?'reserved':'unspent',checkpoint:{...cp},committedAmount:(amount/10_000_000_000n*10_000_000_000n).toString(),precisionRemainderUnverified:(amount%10_000_000_000n).toString()});
  }
  alive();return result;
}
