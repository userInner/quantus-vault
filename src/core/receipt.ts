import { xxhashAsHex } from '@polkadot/util-crypto';
import { ChainCodec, transactionHash } from './chain';
import { type RpcLike } from './rpc';
import { type TxRecord } from './storage';
import { isHash, asUInt } from './validation';
export async function checkReceipt(rpc:RpcLike,codec:ChainCodec,record:TxRecord):Promise<Partial<TxRecord>> {
  if(record.network!==rpc.network.id)throw new Error('交易所属网络与当前网络不匹配。');
  await rpc.verify();
  const finalized=await rpc.call<string>('chain_getFinalizedHead');if(!isHash(finalized))throw new Error('无效的最终确认区块。');
  const header=await rpc.call<any>('chain_getHeader',[finalized]);const height=asUInt(parseInt(header.number,16));
  // A signed mortal transaction is valid only in this bounded 16-block window.
  for(let number=record.block;number<=Math.min(height,record.block+15);number++){
    const hash=await rpc.call<string>('chain_getBlockHash',[number]);if(!isHash(hash))throw new Error('区块哈希无效。');
    const result=await rpc.call<any>('chain_getBlock',[hash]);
    if(!Array.isArray(result?.block?.extrinsics))throw new Error('区块数据不可用。');
    const index=result.block.extrinsics.findIndex((xt:string)=>transactionHash(xt)===record.hash);
    if(index<0)continue;
    const eventsKey=xxhashAsHex('System',128)+xxhashAsHex('Events',128).slice(2);
    const raw=await rpc.call<string|null>('state_getStorage',[eventsKey,hash]);
    if(!raw)return {state:'uncertain',detail:'已找到交易，但暂时无法核实执行事件。'};
    const records=codec.events(raw);
    for(const item of records){
      if(Number(item.phase?.applyExtrinsic)!==index)continue;
      const event=item.event;
      // Portable registry Event.toJSON output carries section and method.
      if(event?.section==='system' && event.method==='ExtrinsicSuccess')return {state:'confirmed',detail:`已在最终确认区块 ${number} 执行成功。`};
      if(event?.section==='system' && event.method==='ExtrinsicFailed')return {state:'failed',detail:`区块 ${number} 执行失败，可能已扣除网络费。`};
      const system=event?.system;
      if(system && Object.hasOwn(system,'extrinsicSuccess'))return {state:'confirmed',detail:`已在最终确认区块 ${number} 执行成功。`};
      if(system && Object.hasOwn(system,'extrinsicFailed'))return {state:'failed',detail:`区块 ${number} 执行失败，可能已扣除网络费。`};
    }
    return {state:'uncertain',detail:'已找到交易，尚未核实成功事件。'};
  }
  if(height>=record.block+16)return {state:'failed',detail:'有效期已结束，最终确认的区块中未找到该交易。'};
  return {state:'submitted',detail:'仍在等待最终确认。'};
}
