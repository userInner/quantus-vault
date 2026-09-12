// Browser UI fixture: real UI/crypto; isolated in-memory storage and simulated RPC only.
// This file is excluded from the extension. It never accesses a real RPC endpoint.
import {WalletApp} from '../src/ui/app';
import {ChainCodec,transactionHash} from '../src/core/chain';
import {NETWORKS} from '../src/core/rpc';
import {type Store,type TxRecord} from '../src/core/storage';
import {type Vault} from '../src/core/vault';
import {el} from '../src/ui/dom';
let vault:Vault|undefined;
let records:TxRecord[]=[];
let latestSigned='';let sendCount=0;
const nativeFetch=globalThis.fetch.bind(globalThis);
const codec=await ChainCodec.load(NETWORKS.planck);
const balance=codec.registry.createTypeUnsafe('Lookup3',[{nonce:0,consumers:0,providers:1,sufficients:0,data:{free:'100000000000000',reserved:'0',frozen:'0',flags:'0'}}]).toHex();
let height=1000;
const blockHash='0x'+'cd'.repeat(32);
globalThis.fetch=async(input,options)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(url.startsWith(location.origin+'/'))return nativeFetch(input,options);
 if(new URLSearchParams(location.search).has('slow-rpc'))await new Promise(resolve=>setTimeout(resolve,3000));
 const request=JSON.parse(String(options?.body));
 const n=url.includes('mainnet')?NETWORKS.mainnet:NETWORKS.planck;
 const result:Record<string,unknown>={system_properties:{ss58Format:189,tokenDecimals:12,tokenSymbol:n.symbol},system_health:{peers:8,isSyncing:false},state_getRuntimeVersion:{specName:'quantus-runtime',specVersion:n.specVersion,transactionVersion:6},system_accountNextIndex:0,chain_getHeader:{number:'0x'+height.toString(16)},chain_getFinalizedHead:blockHash,payment_queryInfo:{partialFee:'1000000000'},chain_getBlock:{block:{extrinsics:latestSigned?[latestSigned]:[]}}};
 if(request.method==='chain_getBlockHash')result.chain_getBlockHash=request.params[0]===0?n.genesis:blockHash;
 if(request.method==='state_getStorage')result.state_getStorage=request.params[0].length>100?balance:'0x040000000000000000000200';
 if(request.method==='author_submitExtrinsic'){
  sendCount++;latestSigned=request.params[0];result.author_submitExtrinsic=transactionHash(latestSigned);
 }
 if(!Object.hasOwn(result,request.method))throw new Error('Fixture rejects unknown RPC method');
 return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:result[request.method]}),{headers:{'Content-Type':'application/json'}});
};
const diagnostic=el('p',{id:'fixture-status'});
function report(){diagnostic.textContent=`TEST FIXTURE — memory only; simulated broadcasts: ${sendCount}; stored vault: ${vault?'encrypted':'none'}; history: ${records.map(r=>r.state).join(',')||'empty'}`;}
const store:Store={loadVault:async()=>vault,saveVault:async(v)=>{if(vault)throw Error('Wallet already exists');vault=structuredClone(v);report();},history:async()=>structuredClone(records),saveHistory:async(r)=>{records=structuredClone(r);report();}};
document.body.prepend(diagnostic);report();
await new WalletApp(document.querySelector('#app')!,store).init();
setInterval(report,500);
