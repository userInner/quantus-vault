import {seal} from '../src/core/vault';
import {provePrivateBatch} from '../src/core/privacy/prover-client';
import fixture from './privacy-proof-fixture.json';
const output=document.querySelector('#result')!;
try{
 const password='Browser TEST ONLY password 2026';const {vault}=await seal('human snow truck virus now jaguar wall brisk shoe craft gravity diesel',password,'qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG',0);
 const start=performance.now();const proof=await provePrivateBatch(vault,password,JSON.stringify(fixture),new AbortController().signal,()=>{output.textContent='Generating full synthetic proof locally…';});
 output.textContent=`PASS: full browser proof generated and locally verified, ${proof.length} bytes, ${Math.round(performance.now()-start)} ms. No network or broadcast.`;proof.fill(0);
 const controller=new AbortController();const pending=provePrivateBatch(vault,password,JSON.stringify(fixture),controller.signal);controller.abort();
 try{await pending;throw Error('Cancellation failed');}catch(error){if(!(error instanceof DOMException)||error.name!=='AbortError')throw error;}
 output.textContent+=' PASS: cancellation terminates proving.';
}catch(error){output.textContent='FAIL: '+String(error);}
