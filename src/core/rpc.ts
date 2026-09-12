import {compactStripLength} from '@polkadot/util';
import {unhex} from './validation';
import {assertPrivateBroadcastEnabled} from './privacy/release-gate';
import config from './networks.json';
import { asUInt, isHash } from './validation';
export type NetworkId = keyof typeof config;
export type Network = (typeof config)[NetworkId];
export const NETWORKS = config;
export type Runtime = { specVersion: number; transactionVersion: number; specName: string };
export interface RpcLike { network: Network; call<T>(method: string, params?: unknown[]): Promise<T>; verify(): Promise<void>; }
export function verifyIdentity(n: Network, genesis: unknown, properties: any, runtime: Runtime): void {
  if (genesis !== n.genesis) throw new Error('节点的创世区块不匹配，连接已停止。');
  if (properties?.ss58Format !== 189 || properties?.tokenDecimals !== 12 || properties?.tokenSymbol !== n.symbol) throw new Error('节点的网络参数不匹配，连接已停止。');
  if (runtime?.specName !== 'quantus-runtime' || runtime?.specVersion !== n.specVersion || runtime?.transactionVersion !== n.transactionVersion) throw new Error('网络已升级，当前版本尚未验证。已停止读取余额和转账，请等待钱包更新。');
}
const READ_METHODS = new Set(['chain_getBlockHash','chain_getHeader','chain_getBlock','chain_getFinalizedHead','state_getRuntimeVersion','state_getStorage','system_properties','system_health','system_accountNextIndex','payment_queryInfo','zkTree_getMerkleProof']);
export async function readBoundedResponse(response:Response,limit=8_000_000):Promise<string> {
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>limit){await response.body?.cancel();throw new Error('节点响应过大，已拒绝。');}
  if(!response.body)return '';
  const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0;const parts:string[]=[];
  try {
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new Error('节点响应过大，已拒绝。');}
      parts.push(decoder.decode(value,{stream:true}));
    }
    parts.push(decoder.decode());return parts.join('');
  } finally {reader.releaseLock();}
}
export class Rpc implements RpcLike {
  readonly network: Network;
  private endpoint = 0;
  private id = 0;
  private generation=0;
  private controllers = new Set<AbortController>();
  constructor(networkId: NetworkId, private transport: typeof fetch = (input, init) => globalThis.fetch(input, init)) { this.network = NETWORKS[networkId]; }
  get url(): string { return this.network.endpoints[this.endpoint]; }
  cancel(): void { this.generation++; for (const c of this.controllers) c.abort(); this.controllers.clear(); }
  private async request<T>(url: string, method: string, params: unknown[]): Promise<T> {
    const generation=this.generation;
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const id = ++this.id;
    try {
      const response = await this.transport(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id,method,params}), signal: controller.signal, credentials:'omit', redirect:'error', cache:'no-store', referrerPolicy:'no-referrer' });
      if (!response.ok) throw new Error('节点暂时不可用，请稍后再试。');
      const text = await readBoundedResponse(response);
      if(generation!==this.generation)throw new Error('连接已取消。');
      const result = JSON.parse(text);
      if (result.jsonrpc !== '2.0' || result.id !== id) throw new Error('节点响应不匹配。');
      // Never expose arbitrary RPC-provided text or transaction bytes to the DOM/logs.
      if (result.error) throw new Error(method === 'author_submitExtrinsic' ? '节点未接受交易或结果不确定，请先检查交易记录。' : '节点无法完成查询，请检查网络后重试。');
      if (!Object.hasOwn(result,'result')) throw new Error('节点响应缺少结果。');
      return result.result as T;
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!READ_METHODS.has(method)) throw new Error('不允许的查询方法。');
    // Reads remain on one endpoint for a session. Failover verifies identity first.
    return this.request<T>(this.url, method, params);
  }
  async connect(): Promise<void> {
    let error: unknown;const generation=this.generation;
    for (let i = 0; i < this.network.endpoints.length; i++) {
      this.endpoint = i;
      try { await this.verify(); return; } catch (e) { if(generation!==this.generation)throw new Error('连接已取消。');error = e; }
    }
    throw error;
  }
  async verify(): Promise<void> {
    const [genesis, properties, runtime, health] = await Promise.all([
      this.call('chain_getBlockHash',[0]), this.call('system_properties'), this.call<Runtime>('state_getRuntimeVersion'), this.call<any>('system_health')
    ]);
    verifyIdentity(this.network, genesis, properties, runtime);
    if (!health || health.isSyncing !== false || asUInt(health.peers) === 0) throw new Error('节点尚未同步，暂时不能使用。');
  }
  async broadcastOnce(signed: string): Promise<string> {
    const [,body]=compactStripLength(unhex(signed));if(body[0]===4)assertPrivateBroadcastEnabled();
    if (!this.network.signing) throw new Error('本版本主网仅支持查看，未开放主网签名。');
    // No fallback or retry: a timeout can occur after the node accepted the transaction.
    const hash = await this.request<string>(this.url, 'author_submitExtrinsic', [signed]);
    if (!isHash(hash)) throw new Error('广播结果不确定，请先检查交易记录。');
    return hash;
  }
}
