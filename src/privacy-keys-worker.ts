import init,{privacyAddressId,privacyNullifier} from '../privacy-wasm/quantus_privacy_keys';
import {openVault,unlockKey,validateVault} from './core/vault';
self.onmessage=async(event:MessageEvent)=>{
  try{
    const m=event.data;
    if(!['privacy-addresses','privacy-nullifier'].includes(m?.op)||![0,1].includes(m.branch)||!Number.isSafeInteger(m.start)||m.start<0||!Number.isSafeInteger(m.count)||m.count<1||m.count>100||m.start+m.count>0x80000000)throw Error('Invalid request');
    const vault=validateVault(m.vault);
    const key=await unlockKey(vault,m.password);
    const mnemonic=await openVault(vault,key);
    await init({module_or_path:new URL('quantus_privacy_keys_bg.wasm',self.location.href)});
    const addresses=Array.from({length:m.count},(_,offset)=>({branch:m.branch,index:m.start+offset,id:privacyAddressId(mnemonic,m.branch,m.start+offset)}));
    if(m.op==='privacy-nullifier'){if(m.count!==1||typeof m.transferCount!=='string')throw Error('Invalid nullifier request');self.postMessage({ok:true,result:{addressId:addresses[0].id,nullifier:privacyNullifier(mnemonic,m.branch,m.start,m.transferCount)}});}else self.postMessage({ok:true,result:{addresses}});
  }catch{self.postMessage({ok:false,error:'Privacy address derivation failed. Check your password and request.'});}
  self.close();
};
