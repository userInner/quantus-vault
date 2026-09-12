import {Rpc} from '../src/core/rpc';
import {PrivacyIndexer} from '../src/core/privacy/indexer';
import {hex,validAddress} from '../src/core/validation';
const rpc=new Rpc('mainnet');await rpc.connect();const indexer=new PrivacyIndexer(rpc);const checkpoint=await indexer.checkpoint();
// Public chain address returned by the official indexer's transfer feed, no ownership claim.
const owner={branch:0 as const,index:0,id:hex(validAddress('qzmzErRBVvD8RymrowYD7tFsUyfMXJFJsDa551WukiRANTCjm'))};
const credits=await indexer.credits([owner],checkpoint);console.log(JSON.stringify({checkpoint,count:credits.length,credits}));
