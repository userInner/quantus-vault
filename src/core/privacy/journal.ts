import {validateBatchDetails,type BatchDetails} from './batch-details';
import {hex,unhex,isHash} from '../validation';
export type PrivatePending={details?:BatchDetails;hash:string;planHash:string;nullifiers:string[];changeIndex:number;created:number;block?:number;checkedThrough?:number;state:'prepared'|'cancelled'|'broadcasting'|'submitted'|'unknown'|'confirmed'|'failed'};
export interface PrivateJournalIO{load:()=>Promise<unknown>;save:(value:unknown)=>Promise<void>}
/** A separate encrypted journal. Shares the vault's AES key but binds every blob to its own domain/network/account. */
export class PrivateJournal {
 private aad:Uint8Array<ArrayBuffer>;
 constructor(private io:PrivateJournalIO,private key:CryptoKey,readonly genesis:string,address:string){
  if(!isHash(genesis)||!address||key.extractable||key.algorithm.name!=='AES-GCM'||(key.algorithm as AesKeyAlgorithm).length!==256)throw Error('Invalid private journal key');
  this.aad=new TextEncoder().encode(JSON.stringify(['quantus-private-journal',1,genesis,address]));
 }
 private validate(rows:unknown):PrivatePending[]{
  if(!Array.isArray(rows)||rows.length>200)throw Error('Invalid private journal');const hashes=new Set<string>();
  for(const r of rows){if(!r||!isHash(r.hash)||hashes.has(r.hash)||!isHash(r.planHash)||!Array.isArray(r.nullifiers)||r.nullifiers.length<1||r.nullifiers.length>7||r.nullifiers.some((n:unknown)=>!isHash(n))||new Set(r.nullifiers).size!==r.nullifiers.length||!Number.isSafeInteger(r.changeIndex)||r.changeIndex<0||r.changeIndex>=0x80000000||!Number.isSafeInteger(r.created)||r.created<0||!['prepared','cancelled','broadcasting','submitted','unknown','confirmed','failed'].includes(r.state)||[r.block,r.checkedThrough].some(n=>n!==undefined&&(!Number.isSafeInteger(n)||n<0||n>0xffffffff)))throw Error('Invalid private journal entry');if(r.details!==undefined)validateBatchDetails(r.details);hashes.add(r.hash);}
  return rows;
 }
 async read():Promise<PrivatePending[]>{
  const value=await this.io.load();if(value===undefined)return [];
  const v=value as {version:number;iv:string;ciphertext:string};
  if(v?.version!==1||!/^0x[0-9a-f]{24}$/.test(v.iv)||typeof v.ciphertext!=='string'||v.ciphertext.length>1_000_000||!/^0x(?:[0-9a-f]{2})+$/.test(v.ciphertext))throw Error('Invalid encrypted private journal');
  let clear:Uint8Array|undefined;
  try{clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(unhex(v.iv)),additionalData:this.aad,tagLength:128},this.key,Uint8Array.from(unhex(v.ciphertext))));return this.validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(clear)));}
  catch{throw Error('Private journal authentication failed');}finally{clear?.fill(0);}
 }
 async write(rows:PrivatePending[]):Promise<void>{
  this.validate(rows);const clear=new TextEncoder().encode(JSON.stringify(rows));if(clear.length>400_000){clear.fill(0);throw Error('Private journal too large');}
  try{const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:this.aad,tagLength:128},this.key,clear);await this.io.save({version:1,iv:hex(iv),ciphertext:hex(new Uint8Array(encrypted))});
   if(JSON.stringify(await this.read())!==JSON.stringify(rows))throw Error('Private journal write not confirmed');
  }finally{clear.fill(0);}
 }
}
export const privatePending=(r:PrivatePending)=>['prepared','broadcasting','submitted','unknown','failed'].includes(r.state);

/** All allocated indices remain discoverable, including abandoned attempts. Never prune this journal. */
export function privateRecoveryState(rows:readonly PrivatePending[]){
 return {reserved:new Set(rows.filter(privatePending).flatMap(r=>r.nullifiers)),changeThrough:rows.reduce((n,r)=>Math.max(n,r.changeIndex),-1)};
}
