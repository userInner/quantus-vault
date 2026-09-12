/** Both official account=0 branches must be searched. This discovers addresses, not spendable funds. */
export type PrivacyBranch = 0 | 1;
export type PrivacyAddress = { branch: PrivacyBranch; index: number; id: string };
export type DiscoveryCheckpoint = { genesis: string; blockHash: string; height: number };
export type DiscoveryPage = { genesis: string; blockHash: string; indexedThrough: number; complete: boolean; usedIds: string[] };
export type DiscoveryProgress = { branch: PrivacyBranch; scannedThrough: number; usedCount: number };
export type DiscoveryResult = {
  checkpoint: DiscoveryCheckpoint;
  branches: { branch: PrivacyBranch; used: PrivacyAddress[]; scannedThrough: number; stop: 'gap' | 'limit' }[];
  complete: boolean;
  scope: 'address-discovery-only';
};
const hash = (s:unknown):s is string => typeof s==='string' && /^0x[0-9a-f]{64}$/.test(s);
function integer(n:number,min:number,max:number):boolean {return Number.isSafeInteger(n)&&n>=min&&n<=max;}
export async function discoverPrivacyAddresses(options: {
  checkpoint: DiscoveryCheckpoint;
  derive: (branch:PrivacyBranch,start:number,count:number)=>Promise<PrivacyAddress[]>;
  lookup: (addresses:readonly PrivacyAddress[],checkpoint:DiscoveryCheckpoint)=>Promise<DiscoveryPage>;
  gapLimit?:number;
  maxIndex?:number;
  knownThrough?:Partial<Record<PrivacyBranch,number>>;
  signal?:AbortSignal;
  onProgress?:(p:DiscoveryProgress)=>void;
}):Promise<DiscoveryResult> {
  const checkpoint={...options.checkpoint};const gap=options.gapLimit??20;const max=options.maxIndex??999;
  if(!hash(checkpoint.genesis)||!hash(checkpoint.blockHash)||!integer(checkpoint.height,0,Number.MAX_SAFE_INTEGER)||!integer(gap,1,100)||!integer(max,0,1_000_000))throw Error('Invalid privacy discovery range');
  const known=[options.knownThrough?.[0]??-1,options.knownThrough?.[1]??-1];
  if(known.some(v=>!integer(v,-1,max)))throw Error('Known privacy index exceeds scan range');
  const alive=()=>{if(options.signal?.aborted)throw new DOMException('Privacy discovery cancelled','AbortError');};
  const result:DiscoveryResult={checkpoint,branches:[],complete:true,scope:'address-discovery-only'};
  const allIds=new Set<string>();
  for(const branch of [0,1] as const){
    let missing=0,scannedThrough=-1,stopped=false;const used:PrivacyAddress[]=[];
    for(let start=0;start<=max && !stopped;start+=gap){
      alive();const count=Math.min(gap,max-start+1);const addresses=await options.derive(branch,start,count);alive();
      if(!Array.isArray(addresses)||addresses.length!==count)throw Error('Incomplete privacy derivation');
      for(let i=0;i<count;i++){
        const a=addresses[i];if(!a||a.branch!==branch||a.index!==start+i||!hash(a.id)||allIds.has(a.id))throw Error('Invalid privacy derivation');allIds.add(a.id);
      }
      // Give the adapter copies so it cannot change the verified discovery inputs/checkpoint.
      const page=await options.lookup(addresses.map(a=>({...a})),{...checkpoint});alive();
      if(!page||page.genesis!==checkpoint.genesis||page.blockHash!==checkpoint.blockHash||page.complete!==true||!integer(page.indexedThrough,checkpoint.height,Number.MAX_SAFE_INTEGER)||!Array.isArray(page.usedIds)||page.usedIds.length>count)throw Error('Privacy indexer response is incomplete or from another checkpoint');
      const allowed=new Set(addresses.map(a=>a.id));const existing=new Set(page.usedIds);
      if(existing.size!==page.usedIds.length||page.usedIds.some(id=>!allowed.has(id)))throw Error('Invalid privacy indexer addresses');
      for(const address of addresses){
        scannedThrough=address.index;
        if(existing.has(address.id)){used.push({...address});missing=0;}else missing++;
        if(missing>=gap && scannedThrough>=known[branch]+gap){stopped=true;break;}
      }
      alive();options.onProgress?.({branch,scannedThrough,usedCount:used.length});alive();
    }
    result.branches.push({branch,used,scannedThrough,stop:stopped?'gap':'limit'});
    if(!stopped)result.complete=false;
  }
  alive();return result;
}
