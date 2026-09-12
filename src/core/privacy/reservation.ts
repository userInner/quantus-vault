import {exclusiveTransaction,type Exclusive} from '../transaction-flow';
import {isHash} from '../validation';
import {PrivateJournal,privatePending,type PrivatePending} from './journal';
/** Persist an input lease before starting the expensive prover. Mutations share the ordinary transfer lock. */
export async function reservePrivateInputs(options:{journal:PrivateJournal;planHash:string;nullifiers:readonly string[];knownChangeThrough:number;block:number;assertActive:()=>void;exclusive?:Exclusive}):Promise<PrivatePending>{
 const {journal,assertActive,planHash,block,knownChangeThrough}=options;const nullifiers=[...options.nullifiers];
 if(!isHash(planHash)||nullifiers.length<1||nullifiers.length>7||nullifiers.some(n=>!isHash(n))||new Set(nullifiers).size!==nullifiers.length||!Number.isSafeInteger(knownChangeThrough)||knownChangeThrough< -1||knownChangeThrough>=0x7fffffff||!Number.isSafeInteger(block)||block<0||block>0xffffffff)throw Error('Invalid private reservation');
 return (options.exclusive??exclusiveTransaction)(async()=>{
  assertActive();const rows=await journal.read();assertActive();
  if(rows.some(r=>r.planHash===planHash||privatePending(r)&&r.nullifiers.some(n=>nullifiers.includes(n))))throw Error('Private inputs already reserved');
  const changeIndex=Math.max(knownChangeThrough,...rows.map(r=>r.changeIndex))+1;
  if(changeIndex>=0x80000000)throw Error('Private change index exhausted');
  const row:PrivatePending={hash:planHash,planHash,nullifiers,changeIndex,block,created:Date.now(),state:'prepared'};
  rows.push(row);await journal.write(rows);assertActive();return structuredClone(row);
 });
}
/** Only a never-broadcast preparation can be abandoned. Ambiguous submissions stay reserved. */
export async function cancelPrivatePreparation(journal:PrivateJournal,planHash:string,assertActive:()=>void,exclusive:Exclusive=exclusiveTransaction):Promise<void>{
 return exclusive(async()=>{assertActive();const rows=await journal.read();assertActive();const row=rows.find(r=>r.planHash===planHash);
  if(!row||row.state!=='prepared')throw Error('This private transaction cannot be cancelled safely');
  row.state='cancelled';await journal.write(rows);assertActive();});
}
