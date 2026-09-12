import {transactionHash} from '../chain';
import {exclusiveTransaction,type Exclusive} from '../transaction-flow';
import {PrivateJournal,privatePending,type PrivatePending} from './journal';
/** One already-reviewed, locally verified batch. No retry or release of an ambiguous spend. */
export async function submitPrivateBatch(options:{
 encoded:string;planHash:string;block?:number;requirePrepared?:boolean;nullifiers:string[];changeIndex:number;journal:PrivateJournal;
 assertActive:()=>void;recheck:()=>Promise<void>;broadcast:(encoded:string)=>Promise<string>;exclusive?:Exclusive;
}):Promise<PrivatePending>{
 const {assertActive,recheck,journal}=options;const encoded=options.encoded,planHash=options.planHash,changeIndex=options.changeIndex,nullifiers=[...options.nullifiers];
 return (options.exclusive??exclusiveTransaction)(async()=>{
  assertActive();const rows=await journal.read();assertActive();
  const hash=transactionHash(encoded);
  if(rows.some(r=>r.planHash===planHash&&r.state!=='prepared'))throw Error('Private plan is no longer active');
  const prepared=rows.find(r=>r.planHash===planHash&&r.state==='prepared');
  if(options.requirePrepared&&!prepared)throw Error('Private preparation is unavailable');
  if(prepared&&(prepared.changeIndex!==changeIndex||JSON.stringify([...prepared.nullifiers].sort())!==JSON.stringify([...nullifiers].sort())))throw Error('Private preparation changed');
  if(rows.some(r=>r!==prepared&&(r.hash===hash||privatePending(r)&&r.nullifiers.some(n=>nullifiers.includes(n)))))throw Error('Private inputs already submitted or reserved');
  await recheck();assertActive();
  const record:PrivatePending={details:prepared?.details,hash,planHash,nullifiers,changeIndex,block:prepared?.block??options.block,created:prepared?.created??Date.now(),state:'broadcasting'};
  if(prepared)rows.splice(rows.indexOf(prepared),1,record);else rows.push(record);await journal.write(rows);assertActive();
  // A cancellation or failed recheck leaves the durable reservation intact for explicit reconciliation.
  await recheck();assertActive();
  try{record.state=await options.broadcast(encoded)===hash?'submitted':'unknown';}catch{record.state='unknown';}
  await journal.write(rows);return record;
 });
}
