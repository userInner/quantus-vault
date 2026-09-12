import {requirePreviousBatchesConfirmed} from './batches';
import {assertPrivateBroadcastEnabled} from './release-gate';
import type {Vault} from '../vault';
import type {RpcLike} from '../rpc';
import type {ChainCodec} from '../chain';
import {isHash} from '../validation';
import {exclusiveTransaction} from '../transaction-flow';
import {PrivateJournal,privateRecoveryState} from './journal';
import {reservePrivateInputs} from './reservation';
import {buildPrivateWitness} from './witness';
import {provePrivateBatch} from './prover-client';
import {encodePrivateBatch} from './extrinsic';
import {submitPrivateBatch} from './submit';
import {nullifierStorageKey,type CheckedCredit} from './scanner';
type Witness=Awaited<ReturnType<typeof buildPrivateWitness>>;
export type PrivateTransferReview=Readonly<Witness['review']>;
// An opaque in-memory handle prevents edits to a displayed review from changing the broadcast payload.
const prepared=new WeakMap<object,{encoded:string;witness:Witness;created:number;genesis:string}>();
export async function recheckPrivateWitness(rpc:RpcLike,codec:ChainCodec,witness:Witness,signal?:AbortSignal):Promise<void>{
 signal?.throwIfAborted();await rpc.verify();signal?.throwIfAborted();
 if(rpc.network.genesis!==witness.review.genesis||await rpc.call('chain_getBlockHash',[witness.review.checkpoint.height])!==witness.review.checkpoint.blockHash)throw Error('Private proof network or checkpoint changed');
 const best=await rpc.call<string>('chain_getBlockHash');if(!isHash(best))throw Error('Invalid current block');
 for(const n of witness.review.nullifiers){const used=await rpc.call<string|null>('state_getStorage',[nullifierStorageKey(codec,n),best]);signal?.throwIfAborted();if(used!==null&&used!=='0x00')throw Error('Private input was spent or its state is unavailable');}
}
/** Local proof preparation only. Durable reservations survive cancellation, closing and worker failure. */
export async function preparePrivateTransfer(options:{vault:Vault;password:string;rpc:RpcLike;codec:ChainCodec;journal:PrivateJournal;credits:readonly CheckedCredit[];amount:bigint;recipient:string;knownChangeThrough:number;signal:AbortSignal;assertActive:()=>void;verifyMerkle:(leaf:Uint8Array,siblings:Uint8Array,root:Uint8Array)=>boolean;onStage?:(stage:'proving')=>void}):Promise<PrivateTransferReview>{
 const active=()=>{options.signal.throwIfAborted();options.assertActive();};active();
 if(options.journal.genesis!==options.rpc.network.genesis)throw Error('Private journal network mismatch');
 const witness=await exclusiveTransaction(async()=>{
  active();const rows=await options.journal.read();active();const recovery=privateRecoveryState(rows);
  const known=Math.max(options.knownChangeThrough,recovery.changeThrough,...options.credits.filter(c=>c.owner.branch===1).map(c=>c.owner.index));
  const built=await buildPrivateWitness({...options,reserved:recovery.reserved,changeIndex:known+1});active();
  await reservePrivateInputs({journal:options.journal,planHash:built.planHash,nullifiers:built.review.nullifiers,knownChangeThrough:known,block:built.review.checkpoint.height,assertActive:active,exclusive:async work=>work()});active();return built;
 });
 let proof:Uint8Array|undefined;
 try{
  await recheckPrivateWitness(options.rpc,options.codec,witness,options.signal);active();
  proof=await provePrivateBatch(options.vault,options.password,witness.inputsJson,options.signal,options.onStage);active();
  const encoded=encodePrivateBatch(options.codec,proof);await recheckPrivateWitness(options.rpc,options.codec,witness,options.signal);active();
  const review=structuredClone(witness.review);Object.freeze(review.nullifiers);Object.freeze(review.checkpoint);Object.freeze(review);
  prepared.set(review,{encoded,witness,created:Date.now(),genesis:options.rpc.network.genesis});return review;
 }finally{proof?.fill(0);witness.inputsJson='';}
}
/** Call only after the user approves this exact review. The proof is never automatically retried. */
export async function sendPreparedPrivateTransfer(review:PrivateTransferReview,options:{rpc:RpcLike;codec:ChainCodec;journal:PrivateJournal;assertActive:()=>void;signal:AbortSignal;broadcast:(encoded:string)=>Promise<string>}){
 assertPrivateBroadcastEnabled();
 const handle=prepared.get(review);if(!handle)throw Error('Private review expired');
 const active=()=>{options.signal.throwIfAborted();options.assertActive();if(handle.genesis!==options.rpc.network.genesis||handle.genesis!==options.journal.genesis||Date.now()-handle.created>300000)throw Error('Private review expired or network changed');};
 active();prepared.delete(review);
 return submitPrivateBatch({requirePrepared:true,encoded:handle.encoded,planHash:handle.witness.planHash,nullifiers:[...review.nullifiers],changeIndex:review.changeIndex,block:review.checkpoint.height,journal:options.journal,assertActive:active,recheck:async()=>{const rows=await options.journal.read();active();const row=rows.find(r=>r.planHash===handle.witness.planHash);if(!row)throw Error('Private preparation is unavailable');if(row.details)requirePreviousBatchesConfirmed(rows,row);await recheckPrivateWitness(options.rpc,options.codec,handle.witness,options.signal);},broadcast:options.broadcast});
}

/** Rebuild only a never-broadcast batch after unlock/rescan. Its recipient, amounts and change index are immutable. */
export async function prepareReservedPrivateBatch(options:Parameters<typeof preparePrivateTransfer>[0]&{group:string;batchIndex:number}):Promise<PrivateTransferReview>{
 const active=()=>{options.signal.throwIfAborted();options.assertActive();};active();
 if(options.journal.genesis!==options.rpc.network.genesis)throw Error('Private journal network mismatch');
 const witness=await exclusiveTransaction(async()=>{
  active();const rows=await options.journal.read();active();
  const row=rows.find(r=>r.details?.group===options.group&&r.details.index===options.batchIndex);
  if(!row||row.state!=='prepared'||!row.details)throw Error('Private preparation is unavailable');
  requirePreviousBatchesConfirmed(rows,row);
  const selected=row.nullifiers.map(n=>options.credits.find(c=>c.nullifier===n));
  if(selected.some(c=>!c||c.status==='spent'))throw Error('Rescan private assets before continuing');
  const others=privateRecoveryState(rows.filter(r=>r!==row)).reserved;
  const built=await buildPrivateWitness({...options,credits:selected.map(c=>({...c!,status:'unspent' as const})),reserved:others,amount:BigInt(row.details.amount),recipient:row.details.recipient,changeIndex:row.changeIndex});active();
  if(built.review.amount!==row.details.amount||built.review.fee!==row.details.fee||built.review.change!==row.details.change||JSON.stringify([...built.review.nullifiers].sort())!==JSON.stringify([...row.nullifiers].sort()))throw Error('Private quote changed; cancel unbroadcast batches and review again');
  row.hash=built.planHash;row.planHash=built.planHash;row.block=built.review.checkpoint.height;delete row.checkedThrough;
  await options.journal.write(rows);active();return built;
 });
 let proof:Uint8Array|undefined;
 try{
  await recheckPrivateWitness(options.rpc,options.codec,witness,options.signal);active();
  proof=await provePrivateBatch(options.vault,options.password,witness.inputsJson,options.signal,options.onStage);active();
  const encoded=encodePrivateBatch(options.codec,proof);await recheckPrivateWitness(options.rpc,options.codec,witness,options.signal);active();
  const review=structuredClone(witness.review);Object.freeze(review.nullifiers);Object.freeze(review.checkpoint);Object.freeze(review);
  prepared.set(review,{encoded,witness,created:Date.now(),genesis:options.rpc.network.genesis});return review;
 }finally{proof?.fill(0);witness.inputsJson='';}
}
