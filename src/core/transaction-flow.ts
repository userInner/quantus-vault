import { type Draft, transactionHash, validateDraft } from './chain';
import { NETWORKS } from './rpc';
import { type Store, type TxRecord } from './storage';

export type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;
export const exclusiveTransaction: Exclusive = work => navigator.locks.request('quantus-vault-transfer',{ifAvailable:true},async lease=>{
  if(!lease)throw new Error('另一个钱包窗口正在处理交易或检查记录，请稍后重试。');
  return work();
});
export const isPending = (r:TxRecord):boolean => ['broadcasting','submitted','uncertain'].includes(r.state);
export type SendServices = {
  store:Store; assertActive:()=>void; recheck:()=>Promise<void>; sign:()=>Promise<string>;
  broadcast:(signed:string)=>Promise<string>; exclusive?:Exclusive; now?:()=>number;
};
export async function submitReviewedTransfer(draft:Draft,services:SendServices):Promise<TxRecord> {
  const {store,assertActive,recheck,sign,broadcast}=services;
  const now=services.now??Date.now;
  const valid=()=>{assertActive();validateDraft(draft,NETWORKS[draft.network],draft.from,now());};
  return (services.exclusive??exclusiveTransaction)(async()=>{
    valid();
    const records=await store.history();valid();
    if(records.some(r=>r.from===draft.from&&r.network===draft.network&&isPending(r)))throw new Error('已有尚未确认的交易，请先检查活动记录。');
    await recheck();valid();
    let signed=await sign();
    let record:TxRecord|undefined;
    let broadcastStarted=false;
    try {
      valid();await recheck();valid();
      record={hash:transactionHash(signed),network:draft.network,from:draft.from,to:draft.to,amount:draft.amount,time:now(),block:draft.block,state:'broadcasting'};
      records.unshift(record);
      // A durable intent must exist before a request can reach the network.
      await store.saveHistory(records);valid();
      broadcastStarted=true;
      try {record.state=(await broadcast(signed))===record.hash?'submitted':'uncertain';}
      catch {record.state='uncertain';}
      try {await store.saveHistory(records);}
      catch {throw new Error('交易可能已广播，但状态保存失败。请先检查链上记录，勿重复发送。');}
      return record;
    } catch(error) {
      if(record && !broadcastStarted){
        record.state='cancelled';record.detail='操作已取消，没有向节点广播。';
        // If this write fails, the prior durable intent remains unresolved and blocks a retry.
        try {await store.saveHistory(records);} catch { /* Preserve conservative pending state. */ }
      }
      throw error;
    } finally {signed='';}
  });
}
export async function refreshTransactionRecords(store:Store,address:string,check:(record:TxRecord)=>Promise<Partial<TxRecord>>,assertActive:()=>void,exclusive:Exclusive=exclusiveTransaction):Promise<TxRecord[]> {
  return exclusive(async()=>{
    assertActive();
    // Read only after acquiring the same lease as broadcasting; never write a window's stale snapshot.
    const records=await store.history();assertActive();
    for(const record of records.filter(r=>r.from===address&&isPending(r))){
      const status=await check(record);assertActive();Object.assign(record,status);
    }
    await store.saveHistory(records);assertActive();return records;
  });
}
