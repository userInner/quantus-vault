import {encodeAddress} from '@polkadot/util-crypto';
import {NETWORKS,readBoundedResponse,type RpcLike} from '../rpc';
import {asUInt,hex,unhex,validAddress,isHash} from '../validation';
import type {DiscoveryCheckpoint,DiscoveryPage,PrivacyAddress} from './discovery';
const ENDPOINTS={mainnet:'https://sqm.quantus.com/v1/graphql',planck:'https://sub2.quantus.com/v1/graphql'} as const;
export type PrivacyCredit={id:string;owner:PrivacyAddress;amount:string;leafIndex:string;transferCount:string;block:number;blockHash:string;status:'unverified'};
/** Official network indexers, used for discovery only. Membership/spend verification is separate. */
export class PrivacyIndexer {
  private readonly endpoint:string;
  constructor(private rpc:RpcLike,private transport:typeof fetch=(input,init)=>globalThis.fetch(input,init)) {const id=rpc.network.id;if((id!=='mainnet'&&id!=='planck')||rpc.network.genesis!==NETWORKS[id].genesis)throw Error('No verified privacy indexer for this network');this.endpoint=ENDPOINTS[id];}
  private async query(query:string,variables:Record<string,unknown>={},signal?:AbortSignal):Promise<any>{
    const abort=AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]);
    const response=await this.transport(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables}),credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:abort});
    if(!response.ok)throw Error('Privacy indexer unavailable');const parsed=JSON.parse(await readBoundedResponse(response,2_000_000));
    if(parsed.errors||!parsed.data||typeof parsed.data!=='object')throw Error('Privacy indexer returned invalid data');abort.throwIfAborted();return parsed.data;
  }
  async checkpoint(signal?:AbortSignal):Promise<DiscoveryCheckpoint>{
    await this.rpc.verify();signal?.throwIfAborted();
    const finalized=await this.rpc.call<string>('chain_getFinalizedHead');
    if(!isHash(finalized))throw Error('Invalid finalized block');
    const header=await this.rpc.call<{number:string}>('chain_getHeader',[finalized]);
    if(typeof header?.number!=='string'||!/^0x[0-9a-f]+$/i.test(header.number))throw Error('Invalid finalized height');
    const height=asUInt(Number(BigInt(header.number))); 
    const tip=await this.query('query { block(limit:1,order_by:{height:desc}) { height hash } }',{},signal);
    if(!Array.isArray(tip.block)||tip.block.length!==1)throw Error('Indexer coverage unavailable');
    const covered=asUInt(tip.block[0].height);const target=Math.min(height,covered);
    const blockHash=await this.rpc.call<string>('chain_getBlockHash',[target]);
    if(!isHash(blockHash))throw Error('Invalid privacy checkpoint');
    const checkpoint={genesis:this.rpc.network.genesis,blockHash,height:target};
    await this.checkCoverage(checkpoint,signal);return checkpoint;
  }
  private async checkCoverage(cp:DiscoveryCheckpoint,signal?:AbortSignal):Promise<void>{
    if(cp.genesis!==this.rpc.network.genesis||!isHash(cp.blockHash)||!Number.isSafeInteger(cp.height)||cp.height<0)throw Error('Invalid privacy checkpoint');
    const data=await this.query('query($height:Int!){block(where:{height:{_eq:$height}},limit:2){height hash}}',{height:cp.height},signal);
    if(!Array.isArray(data.block)||data.block.length!==1||data.block[0].hash!==cp.blockHash||data.block[0].height!==cp.height)throw Error('Indexer has not covered this chain checkpoint');
  }
  async lookup(addresses:readonly PrivacyAddress[],cp:DiscoveryCheckpoint,signal?:AbortSignal):Promise<DiscoveryPage>{
    await this.checkCoverage(cp,signal);
    const used:string[]=[];
    if(addresses.length>100)throw Error('Privacy discovery batch too large');
    if(addresses.length){
      const encoded=addresses.map(owner=>encodeAddress(unhex(owner.id),189));
      const variables:Record<string,unknown>={height:cp.height};encoded.forEach((address,i)=>{variables['a'+i]=address;});
      const declarations=encoded.map((_,i)=>'$a'+i+':String!').join(',');
      const fields=encoded.map((_,i)=>`a${i}:transfer(where:{to:{id:{_eq:$a${i}}},block:{height:{_lte:$height}}},limit:1){to{id}}`).join(' ');
      const data=await this.query(`query($height:Int!,${declarations}){${fields}}`,variables,signal);
      for(let i=0;i<addresses.length;i++){
        const rows=data['a'+i];if(!Array.isArray(rows)||rows.length>1)throw Error('Invalid privacy discovery response');
        if(rows.length){if(rows[0]?.to?.id!==encoded[i])throw Error('Wrong privacy discovery address');used.push(addresses[i].id);}
      }
    }
    await this.checkCoverage(cp,signal);
    return {genesis:cp.genesis,blockHash:cp.blockHash,indexedThrough:cp.height,complete:true,usedIds:used};
  }
  async credits(addresses:readonly PrivacyAddress[],cp:DiscoveryCheckpoint,signal?:AbortSignal):Promise<PrivacyCredit[]>{
    if(addresses.length>1000)throw Error('Too many privacy addresses');
    await this.checkCoverage(cp,signal);const owners=new Map<string,PrivacyAddress>();
    for(const owner of addresses){const address=encodeAddress(unhex(owner.id),189);if(owners.has(address))throw Error('Duplicate privacy address');owners.set(address,{...owner});}
    if(!owners.size)return [];
    const results:PrivacyCredit[]=[];const seen=new Set<string>();let previous:{block:number;id:string}|undefined;
    const query='query($tos:[String!]!,$height:Int!,$offset:Int!){transfer(where:{to:{id:{_in:$tos}},block:{height:{_lte:$height}}},order_by:[{block:{height:asc}},{id:asc}],limit:100,offset:$offset){id amount to{id} leaf_index transfer_count block{height hash}}}';
    for(let offset=0;offset<100_000;offset+=100){
      const data=await this.query(query,{tos:[...owners.keys()],height:cp.height,offset},signal);
      if(!Array.isArray(data.transfer)||data.transfer.length>100)throw Error('Invalid privacy history page');
      for(const row of data.transfer){
        const owner=owners.get(row?.to?.id);const block=asUInt(row?.block?.height);
        if(!owner||typeof row.id!=='string'||row.id.length>160||!row.id||seen.has(row.id)||block>cp.height||!isHash(row.block.hash)||![row.amount,row.leaf_index,row.transfer_count].every(v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v)))throw Error('Invalid privacy credit');
        if(BigInt(row.amount)>((1n<<128n)-1n)||BigInt(row.leaf_index)>((1n<<64n)-1n)||BigInt(row.transfer_count)>((1n<<64n)-1n))throw Error('Privacy credit integer overflow');
        if(previous&&(block<previous.block||(block===previous.block&&row.id<=previous.id)))throw Error('Unstable privacy pagination');
        if(hex(validAddress(row.to.id))!==owner.id)throw Error('Credit owner mismatch');
        previous={block,id:row.id};seen.add(row.id);results.push({id:row.id,owner:{...owner},amount:row.amount,leafIndex:row.leaf_index,transferCount:row.transfer_count,block,blockHash:row.block.hash,status:'unverified'});
      }
      if(data.transfer.length<100){await this.checkCoverage(cp,signal);return results;}
    }
    throw Error('Privacy history scan limit reached; scan is incomplete');
  }
}
