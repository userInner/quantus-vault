import {validateBatchDetails} from './batch-details';
import {blake2AsHex} from '@polkadot/util-crypto';
import {validAddress,isHash} from '../validation';
import {exclusiveTransaction,type Exclusive} from '../transaction-flow';
import {PrivateJournal,privatePending,type PrivatePending} from './journal';
import {selectPrivateInputs,type PrivacyEconomics} from './selection';
import type {CheckedCredit} from './scanner';

export type PrivateBatchQuote={recipient:string;amount:string;fee:string;change:string;batches:{nullifiers:string[];amount:string;fee:string;change:string}[]};
export function quotePrivateBatches(credits:readonly CheckedCredit[],reserved:ReadonlySet<string>,amount:bigint,recipient:string,economics:PrivacyEconomics):PrivateBatchQuote{
 validAddress(recipient);
 const plan=selectPrivateInputs(credits.filter(c=>c.status==='unspent').map(c=>({nullifier:c.nullifier,amount:BigInt(c.committedAmount),index:c.owner.index,change:c.owner.branch===1})),reserved,amount,economics);
 if(plan.batches.length>20)throw Error('A private transfer supports at most 20 batches');
 const batches=plan.batches.map(batch=>{
  const pay=batch.reduce((n,a)=>n+a.recipient,0n)*economics.scale,change=batch.reduce((n,a)=>n+a.change,0n)*economics.scale;
  const input=batch.reduce((n,a)=>n+a.input.amount,0n);
  return {nullifiers:batch.map(a=>a.input.nullifier),amount:pay.toString(),fee:(input-pay-change).toString(),change:change.toString()};
 });
 return {recipient,amount:plan.amount.toString(),fee:plan.fee.toString(),change:plan.change.toString(),batches};
}
const integer=(v:unknown)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(v);

/** Reserve the whole payment in one encrypted write; a later batch cannot consume another batch's inputs. */
export async function reservePrivateBatches(options:{journal:PrivateJournal;quote:PrivateBatchQuote;knownChangeThrough:number;block:number;assertActive:()=>void;exclusive?:Exclusive}):Promise<string>{
 const quote=structuredClone(options.quote);validAddress(quote.recipient);
 if(!Array.isArray(quote.batches)||quote.batches.length<1||quote.batches.length>20||!Number.isSafeInteger(options.knownChangeThrough)||options.knownChangeThrough< -1||!Number.isSafeInteger(options.block)||options.block<0||options.block>0xffffffff)throw Error('Invalid private batch reservation');
 const inputs=quote.batches.flatMap(b=>b.nullifiers);if(new Set(inputs).size!==inputs.length||inputs.some(n=>!isHash(n))||quote.batches.some(b=>b.nullifiers.length<1||b.nullifiers.length>7))throw Error('Duplicate or invalid private inputs');
 for(const key of ['amount','fee','change'] as const){if(!integer(quote[key])||quote.batches.some(b=>!integer(b[key]))||quote.batches.reduce((sum,b)=>sum+BigInt(b[key]),0n)!==BigInt(quote[key]))throw Error('Private quote totals changed');}
 return (options.exclusive??exclusiveTransaction)(async()=>{
  options.assertActive();const rows=await options.journal.read();options.assertActive();
  if(rows.some(r=>privatePending(r)&&r.nullifiers.some(n=>inputs.includes(n))))throw Error('Private inputs already reserved');
  const start=Math.max(options.knownChangeThrough,...rows.map(r=>r.changeIndex))+1;
  if(start+quote.batches.length>0x80000000)throw Error('Private change index exhausted');
  const group=blake2AsHex(crypto.getRandomValues(new Uint8Array(32)),256);
  for(const [index,batch] of quote.batches.entries()){
   const details={group,index,count:quote.batches.length,recipient:quote.recipient,amount:batch.amount,fee:batch.fee,change:batch.change};validateBatchDetails(details);
   const planHash=blake2AsHex(new TextEncoder().encode(JSON.stringify({details,nullifiers:batch.nullifiers,changeIndex:start+index})),256);
   rows.push({hash:planHash,planHash,nullifiers:batch.nullifiers,changeIndex:start+index,created:Date.now(),block:options.block,state:'prepared',details});
  }
  await options.journal.write(rows);options.assertActive();return group;
 });
}
export function requirePreviousBatchesConfirmed(rows:readonly PrivatePending[],row:PrivatePending):void{
 if(!row.details)throw Error('Private batch details unavailable');
 const members=rows.filter(r=>r.details?.group===row.details!.group);
 if(members.length!==row.details.count||new Set(members.map(r=>r.details!.index)).size!==members.length||members.some(r=>r.details!.count!==row.details!.count||r.details!.recipient!==row.details!.recipient))throw Error('Incomplete private batch group');
 if(members.some(r=>r.details!.index<row.details!.index&&r.state!=='confirmed'))throw Error('Confirm previous batches before continuing');
}
export async function cancelRemainingPrivateBatches(journal:PrivateJournal,group:string,assertActive:()=>void,exclusive:Exclusive=exclusiveTransaction):Promise<void>{
 if(!isHash(group))throw Error('Invalid private batch group');
 return exclusive(async()=>{assertActive();const rows=await journal.read();assertActive();for(const row of rows)if(row.details?.group===group&&row.state==='prepared')row.state='cancelled';await journal.write(rows);assertActive();});
}
