import {Rpc} from '../src/core/rpc';import {PrivacyIndexer} from '../src/core/privacy/indexer';import {hex,validAddress} from '../src/core/validation';
const rpc=new Rpc('planck');await rpc.connect();const indexer=new PrivacyIndexer(rpc);const checkpoint=await indexer.checkpoint();
const owner={branch:0 as const,index:0,id:hex(validAddress('qznQKhufTDfU3szAzfgCny7wMhxUN3qjEqneiRUNgC7MjSDyG'))};const discovery=await indexer.lookup([owner],checkpoint);const credits=await indexer.credits([owner],checkpoint);
console.log(JSON.stringify({checkpoint,discovery,credits,readOnly:true,ownedFunds:false},null,2));
