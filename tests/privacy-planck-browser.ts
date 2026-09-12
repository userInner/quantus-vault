import {seal} from '../src/core/vault';import {scanPrivacyWallet} from '../src/core/privacy/recovery';
const output=document.querySelector('#result')!;
try{
 const password='Browser TEST ONLY password 2026';const {vault}=await seal('human snow truck virus now jaguar wall brisk shoe craft gravity diesel',password,'qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG',0);
 const result=await scanPrivacyWallet({vault,password,network:'planck',signal:new AbortController().signal,reserved:new Set(),onProgress:stage=>{output.textContent=stage;}});
 output.textContent=`PASS: live Planck scan completed at ${result.discovery.checkpoint.height}, ${result.credits.length} owned credits, ${result.confirmedUnreservedBeforeFees} base units. Public fixture only; no broadcast.`;
}catch(error){output.textContent='FAIL: '+String(error);}
