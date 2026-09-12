import type {Vault} from '../vault';
import type {PrivacyAddress,PrivacyBranch} from './discovery';
/** One short-lived worker per discovery batch. Only public address IDs are returned. */
export class PrivacyKeysClient {
  private jobs=new Set<()=>void>();
  derive(vault:Vault,password:string,branch:PrivacyBranch,start:number,count:number):Promise<PrivacyAddress[]> {
    return this.run<{addresses:PrivacyAddress[]}>({op:'privacy-addresses',vault,password,branch,start,count}).then(r=>r.addresses);
  }
  nullifier(vault:Vault,password:string,branch:PrivacyBranch,index:number,transferCount:string):Promise<{addressId:string;nullifier:string}>{
    return this.run({op:'privacy-nullifier',vault,password,branch,start:index,count:1,transferCount});
  }
  private run<T>(message:unknown):Promise<T>{
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('privacy-keys-worker.js',location.href),{type:'module'});
      const cleanup=()=>{clearTimeout(timer);worker.terminate();this.jobs.delete(cancel);};
      const cancel=()=>{cleanup();reject(new Error('Privacy discovery cancelled'));};
      const timer=setTimeout(cancel,30_000);this.jobs.add(cancel);
      worker.onmessage=e=>{cleanup();if(e.data?.ok)resolve(e.data.result);else reject(new Error('Privacy address derivation failed'));};
      worker.onerror=()=>{cleanup();reject(new Error('Privacy key module failed'));};
      try{worker.postMessage(message);}catch{cleanup();reject(new Error('Privacy key request failed'));}
    });
  }
  cancelAll():void {for(const cancel of [...this.jobs])cancel();}
}
