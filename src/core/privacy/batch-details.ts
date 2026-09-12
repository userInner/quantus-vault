import {validAddress,isHash} from '../validation';
export type BatchDetails={group:string;index:number;count:number;recipient:string;amount:string;fee:string;change:string};
const integer=(v:unknown)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(v);
export function validateBatchDetails(d:BatchDetails):void{
 if(!d||!isHash(d.group)||!Number.isInteger(d.index)||!Number.isInteger(d.count)||d.count<1||d.count>20||d.index<0||d.index>=d.count||!integer(d.amount)||BigInt(d.amount)<=0n||!integer(d.fee)||!integer(d.change))throw Error('Invalid private batch details');validAddress(d.recipient);
}
