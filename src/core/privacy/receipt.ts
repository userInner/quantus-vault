import {xxhashAsHex} from '@polkadot/util-crypto';
import {transactionHash,type ChainCodec} from '../chain';
import type {RpcLike} from '../rpc';
import {isHash} from '../validation';
import {exclusiveTransaction,type Exclusive} from '../transaction-flow';
import {PrivateJournal,type PrivatePending} from './journal';
import {nullifierStorageKey} from './scanner';
const height=(n:unknown)=>{if(typeof n!=='string'||!/^0x[0-9a-f]+$/i.test(n)||BigInt(n)>0xffffffffn)throw Error('Invalid finalized height');return Number(BigInt(n));};
/** Unsigned proofs have no signed mortal era. Absence is never treated as expiry or permission to resend. */
export async function checkPrivateReceipt(rpc:RpcLike,codec:ChainCodec,row:PrivatePending,signal?:AbortSignal):Promise<Partial<PrivatePending>>{
 if(row.state==='prepared'||row.state==='cancelled'||row.state==='confirmed'||row.state==='failed'||row.block===undefined)return {};
 const alive=()=>signal?.throwIfAborted();alive();await rpc.verify();alive();
 const finalized=await rpc.call<string>('chain_getFinalizedHead');if(!isHash(finalized))throw Error('Invalid finalized hash');
 const tip=height((await rpc.call<{number:string}>('chain_getHeader',[finalized]))?.number);
 const start=Math.max(row.block,(row.checkedThrough??(row.block-1))+1),end=Math.min(tip,start+63);
 for(let n=start;n<=end;n++){
  alive();const hash=await rpc.call<string>('chain_getBlockHash',[n]);if(!isHash(hash))throw Error('Invalid finalized block');
  const block=await rpc.call<any>('chain_getBlock',[hash]);alive();
  if(height(block?.block?.header?.number)!==n||!Array.isArray(block?.block?.extrinsics)||block.block.extrinsics.length>10000)throw Error('Invalid block response');
  const index=block.block.extrinsics.findIndex((xt:unknown)=>{if(typeof xt!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(xt))throw Error('Invalid block extrinsic');return transactionHash(xt)===row.hash;});
  if(index<0)continue;
  const raw=await rpc.call<string|null>('state_getStorage',[xxhashAsHex('System',128)+xxhashAsHex('Events',128).slice(2),hash]);alive();
  if(!raw)return {state:'unknown',checkedThrough:n-1};
  const events=codec.events(raw).filter(e=>Number.isSafeInteger(e.phase?.applyExtrinsic)&&e.phase.applyExtrinsic===index&&e.event?.section==='system');
  const success=events.some(e=>e.event.method==='ExtrinsicSuccess'),failed=events.some(e=>e.event.method==='ExtrinsicFailed');
  if(success===failed)return {state:'unknown',checkedThrough:n-1};
  const spent=await Promise.all(row.nullifiers.map(key=>rpc.call<string|null>('state_getStorage',[nullifierStorageKey(codec,key),hash])));alive();
  if(spent.some(v=>![null,'0x00','0x01'].includes(v)))throw Error('Invalid finalized nullifier response');
  if(success&&spent.every(v=>v==='0x01'))return {state:'confirmed',checkedThrough:n};
  if(failed&&spent.every(v=>v!=='0x01'))return {state:'failed',checkedThrough:n};
  return {state:'unknown',checkedThrough:n-1};
 }
 return end>=start?{checkedThrough:end}:{};
}
export async function refreshPrivateReceipts(options:{journal:PrivateJournal;rpc:RpcLike;codec:ChainCodec;assertActive:()=>void;signal?:AbortSignal;exclusive?:Exclusive}):Promise<PrivatePending[]>{
 return (options.exclusive??exclusiveTransaction)(async()=>{
  if(options.journal.genesis!==options.rpc.network.genesis)throw Error('Private journal network mismatch');
  options.assertActive();const rows=await options.journal.read();options.assertActive();
  for(const row of rows){const patch=await checkPrivateReceipt(options.rpc,options.codec,row,options.signal);options.assertActive();Object.assign(row,patch);}
  await options.journal.write(rows);options.assertActive();return rows;
 });
}
