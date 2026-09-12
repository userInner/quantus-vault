import type {Vault} from '../vault';
/** Does not broadcast. A fresh approval and chain recheck are required after proving. */
export async function provePrivateBatch(vault:Vault,password:string,inputs:string,signal:AbortSignal,onStage?:(stage:'proving')=>void):Promise<Uint8Array>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('privacy-prover-worker.js',location.href),{type:'module'});
    const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();};
    const cancel=()=>{stop();reject(new DOMException('Privacy proof cancelled','AbortError'));};
    const timer=setTimeout(cancel,180_000);signal.addEventListener('abort',cancel,{once:true});
    worker.onerror=()=>{stop();reject(Error('Privacy prover unavailable'));};
    worker.onmessage=e=>{
      if(e.data?.stage==='proving'){try{onStage?.('proving');}catch{cancel();}return;}
      stop();if(signal.aborted){reject(new DOMException('Privacy proof cancelled','AbortError'));return;}
      if(e.data?.ok && e.data.proof instanceof Uint8Array && e.data.proof.length>=100 && e.data.proof.length<=2_000_000)resolve(e.data.proof);else reject(Error('Privacy proof verification failed'));
    };
    try{worker.postMessage({op:'privacy-prove',vault,password,inputs});}catch{stop();reject(Error('Invalid privacy proof request'));}
  });
}
