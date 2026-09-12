import {scanPrivacyWallet} from '../src/core/privacy/recovery';
import type {CheckedCredit} from '../src/core/privacy/scanner';
import {PrivateJournal} from '../src/core/privacy/journal';
import {NETWORKS} from '../src/core/rpc';
// Development-only UI fixture. Fixed public test mnemonic; zero persistence.
// All transaction broadcast is denied at the transport boundary.
import { WalletApp } from '../src/ui/app';
import { CryptoClient } from '../src/core/crypto-client';
import type {Store,TxRecord} from '../src/core/storage';
import type {Vault} from '../src/core/vault';
const nativeFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(input,options)=>{
 if(typeof options?.body==='string'){
  const request=JSON.parse(options.body);
  if(request.method==='author_submitExtrinsic')throw new Error('UI harness: broadcasting disabled');
 }
 return nativeFetch(input,options);
};
let vault:Vault|undefined;let history:TxRecord[]=[];
const journals=new Map<string,unknown>();
const store:Store={privateJournal:(genesis,address)=>({load:async()=>structuredClone(journals.get(genesis+address)),save:async value=>{journals.set(genesis+address,structuredClone(value));}}),loadVault:async()=>vault,saveVault:async(v)=>{if(vault)throw new Error('Already exists');vault=structuredClone(v);},history:async()=>structuredClone(history),saveHistory:async(h)=>{history=structuredClone(h);}};
if(['?locked','?private-history','?private-send'].includes(location.search)){
 const result=await new CryptoClient().run<{vault:Vault;key:CryptoKey}>({op:'create',mnemonic:'human snow truck virus now jaguar wall brisk shoe craft gravity diesel',password:'Browser TEST ONLY password 2026',accountIndex:0});vault=result.vault;
 if(location.search==='?private-history')await new PrivateJournal(store.privateJournal!(NETWORKS.mainnet.genesis,vault.address),result.key,NETWORKS.mainnet.genesis,vault.address).write([{hash:'0x'+'11'.repeat(32),planHash:'0x'+'11'.repeat(32),nullifiers:['0x'+'22'.repeat(32)],changeIndex:3,created:1,state:'prepared'},{hash:'0x'+'33'.repeat(32),planHash:'0x'+'44'.repeat(32),nullifiers:['0x'+'55'.repeat(32)],changeIndex:4,created:2,state:'unknown'}]);
}
const scanner:typeof scanPrivacyWallet=location.search==='?private-send'?async options=>{
 options.signal.throwIfAborted();const hash=(n:number)=>'0x'+n.toString(16).padStart(64,'0');const checkpoint={genesis:NETWORKS.mainnet.genesis,height:10,blockHash:hash(90)};
 const credits:CheckedCredit[]=Array.from({length:15},(_,i)=>({id:String(i),owner:{branch:0,index:i,id:hash(i+50)},amount:'100000000000',leafIndex:String(i),transferCount:'0',block:10,blockHash:hash(90),status:options.reserved.has(hash(i+1))?'reserved':'unspent',nullifier:hash(i+1),checkpoint,committedAmount:'100000000000',precisionRemainderUnverified:'0'}));
 return {discovery:{checkpoint,branches:[{branch:0,used:credits.map(c=>c.owner),scannedThrough:35,stop:'gap'},{branch:1,used:[],scannedThrough:20,stop:'gap'}],complete:true,scope:'address-discovery-only'},credits,confirmedUnreservedBeforeFees:credits.filter(c=>c.status==='unspent').reduce((n,c)=>n+BigInt(c.committedAmount),0n).toString()};
}:scanPrivacyWallet;
await new WalletApp(document.querySelector('#app')!,store,scanner).init();
