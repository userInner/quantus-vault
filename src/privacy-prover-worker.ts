import init,{provePrivacyBatch} from '../privacy-wasm/quantus_privacy_keys';
import {openVault,unlockKey,validateVault} from './core/vault';
/** Dedicated long-running worker. No network or broadcast path; caller must terminate on lock/close. */
self.onmessage=async(event:MessageEvent)=>{
  try{
    const m=event.data;
    if(m?.op!=='privacy-prove'||typeof m.inputs!=='string'||m.inputs.length>100_000)throw Error('Invalid proof request');
    const vault=validateVault(m.vault);const key=await unlockKey(vault,m.password);const mnemonic=await openVault(vault,key);
    await init({module_or_path:new URL('quantus_privacy_keys_bg.wasm',self.location.href)});
    self.postMessage({stage:'proving'});
    const proof=provePrivacyBatch(mnemonic,m.inputs);
    // Return only the public proof, never witness or spend secret.
    self.postMessage({ok:true,proof});proof.fill(0);
  }catch{self.postMessage({ok:false,error:'Privacy proof generation or verification failed'});}
  self.close();
};
