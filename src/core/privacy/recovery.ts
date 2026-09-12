import init,{verifyPrivacyMerkle} from '../../../privacy-wasm/quantus_privacy_keys';
import type {Vault} from '../vault';
import {Rpc,type NetworkId} from '../rpc';
import {ChainCodec} from '../chain';
import {PrivacyKeysClient} from './keys-client';
import {PrivacyIndexer} from './indexer';
import {discoverPrivacyAddresses,type PrivacyBranch} from './discovery';
import {verifyPrivacyCredits} from './scanner';
/** Actual chain-backed read path. Returned totals are before fees and limited to the reported discovery scope. */
export async function scanPrivacyWallet(options:{vault:Vault;password:string;network:NetworkId;signal:AbortSignal;reserved:ReadonlySet<string>;knownThrough?:Partial<Record<PrivacyBranch,number>>;maxIndex?:number;onProgress?:(stage:string)=>void}){
 const rpc=new Rpc(options.network),keys=new PrivacyKeysClient();const cancel=()=>{rpc.cancel();keys.cancelAll();};
 options.signal.throwIfAborted();options.signal.addEventListener('abort',cancel,{once:true});
 try{
  const indexer=new PrivacyIndexer(rpc);await rpc.connect();options.signal.throwIfAborted();
  options.onProgress?.('正在连接隐私索引器…');const cp=await indexer.checkpoint(options.signal);
  const discovery=await discoverPrivacyAddresses({checkpoint:cp,maxIndex:options.maxIndex,knownThrough:options.knownThrough,signal:options.signal,
   derive:(branch,start,count)=>keys.derive(options.vault,options.password,branch,start,count),
   lookup:(addresses,checkpoint)=>indexer.lookup(addresses,checkpoint,options.signal),
   onProgress:p=>options.onProgress?.(`正在扫描${p.branch===0?'收款':'找零'}地址，索引 ${p.scannedThrough}`)});
  options.onProgress?.('正在读取隐私入账…');const addresses=discovery.branches.flatMap(b=>b.used);
  const credits=await indexer.credits(addresses,cp,options.signal);options.signal.throwIfAborted();
  await init({module_or_path:new URL('quantus_privacy_keys_bg.wasm',location.href)});const codec=await ChainCodec.load(rpc.network);
  options.onProgress?.('正在核验资产和花费状态…');
  const checked=await verifyPrivacyCredits({rpc,codec,checkpoint:cp,credits,reserved:options.reserved,signal:options.signal,verifyMerkle:verifyPrivacyMerkle,
   nullifier:c=>keys.nullifier(options.vault,options.password,c.owner.branch,c.owner.index,c.transferCount)});
  options.signal.throwIfAborted();
  return {discovery,credits:checked,confirmedUnreservedBeforeFees:checked.filter(c=>c.status==='unspent').reduce((sum,c)=>sum+BigInt(c.committedAmount),0n).toString()};
 }finally{options.signal.removeEventListener('abort',cancel);cancel();}
}
