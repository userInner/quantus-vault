import { Metadata, TypeRegistry } from '@polkadot/types';
import { blake2AsHex, xxhashAsHex } from '@polkadot/util-crypto';
import { compactToU8a, u8aConcat } from '@polkadot/util';
import { type RpcLike, type Network, type Runtime, type NetworkId } from './rpc';
import { hex, unhex, validAddress, isHash, asUInt, parseAmount } from './validation';

export type AccountState = { free: string; reserved: string; frozen: string; spendable: string; nonce: number; block: number; blockHash: string };
export type Draft = { network: NetworkId; from: string; to: string; amount: string; fee: string; feeLimit: string; nonce: number; block: number; blockHash: string; genesisHash: string; specVersion: number; transactionVersion: number; period: 16; call: string; created: number; ed: string };
export function accountStorageKey(address: string): string {
  const id = validAddress(address);
  return xxhashAsHex('System',128) + xxhashAsHex('Account',128).slice(2) + blake2AsHex(id,128).slice(2) + hex(id).slice(2);
}
export class ChainCodec {
  readonly registry = new TypeRegistry();
  readonly metadata: Metadata;
  private accountType: string;
  private eventsType: string;
  private accountFallback: string;
  readonly ed: bigint;
  constructor(metadataHex: string) {
    // Quantus mining difficulty is a fixed-width 512-bit field. Keep it opaque;
    // wallet arithmetic uses only the metadata's u128 balance types.
    this.registry.register({U512: '[u8;64]'});
    this.metadata = new Metadata(this.registry, metadataHex as `0x${string}`);
    this.registry.setMetadata(this.metadata, undefined, {ReversibleTransactionExtension:{extrinsic:{},payload:{}},WormholeProofRecorderExtension:{extrinsic:{},payload:{}}});
    const system = this.metadata.asLatest.pallets.find(p => p.name.toString() === 'System')!;
    const account = system.storage.unwrap().items.find(s => s.name.toString() === 'Account')!;
    const events = system.storage.unwrap().items.find(s => s.name.toString() === 'Events')!;
    if (account.type.asMap.hashers.length !== 1 || !account.type.asMap.hashers[0].isBlake2128Concat) throw new Error('不兼容的账户存储。');
    this.accountType = this.registry.createLookupType(account.type.asMap.value);
    this.accountFallback = account.fallback.toHex();
    this.eventsType = this.registry.createLookupType(events.type.asPlain);
    const balances = this.metadata.asLatest.pallets.find(p => p.name.toString() === 'Balances')!;
    const ed = balances.constants.find(c => c.name.toString() === 'ExistentialDeposit')!;
    this.ed = BigInt(this.registry.createTypeUnsafe(this.registry.createLookupType(ed.type),[ed.value]).toString());
    const calls = this.registry.lookup.getSiType(balances.calls.unwrap().type).def.asVariant.variants;
    const transfer = calls.find(c => c.name.toString() === 'transfer_keep_alive');
    if (balances.index.toNumber() !== 2 || transfer?.index.toNumber() !== 3) throw new Error('未验证的转账编码。');
  }
  static async load(network: Network): Promise<ChainCodec> {
    const response = await fetch(new URL(`metadata/${network.id}.hex`,location.href));
    if (!response.ok) throw new Error('缺少本地网络描述文件。');
    const raw = await response.text();
    const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256',unhex(raw) as Uint8Array<ArrayBuffer>))).slice(2);
    if (digest !== network.metadataSha256) throw new Error('本地网络描述文件校验失败。');
    return new ChainCodec(raw);
  }
  balance(raw: string | null): {free:bigint;reserved:bigint;frozen:bigint;nonce:number} {
    const data = this.registry.createTypeUnsafe(this.accountType,[raw ?? this.accountFallback]).toJSON() as any;
    return {free: BigInt(data.data.free),reserved:BigInt(data.data.reserved),frozen:BigInt(data.data.frozen),nonce:asUInt(data.nonce)};
  }
  transfer(to: string, amount: bigint): string {
    validAddress(to);
    return this.registry.createType('Call',{callIndex:new Uint8Array([2,3]),args:{dest:{Id:to},value:amount.toString()}}).toHex();
  }
  events(raw: string): any[] {
    const records = this.registry.createTypeUnsafe(this.eventsType,[raw]) as unknown as Iterable<any>;
    // Event.toJSON omits section/method; read resolved metadata names before serialization.
    return Array.from(records, record => ({phase:record.phase.toJSON(),event:{section:record.event.section,method:record.event.method,index:record.event.index.toHex()}}));
  }
}
export async function readAccount(rpc: RpcLike, codec: ChainCodec, address: string): Promise<AccountState> {
  const header = await rpc.call<any>('chain_getHeader');
  const block = parseInt(header?.number,16); asUInt(block);
  const blockHash = await rpc.call<string>('chain_getBlockHash',[block]);
  if (!isHash(blockHash)) throw new Error('节点区块数据无效。');
  const data = codec.balance(await rpc.call<string|null>('state_getStorage',[accountStorageKey(address),blockHash]));
  const retained = data.frozen > codec.ed ? data.frozen : codec.ed;
  const spendable = data.free > retained ? data.free-retained : 0n;
  return {...data,free:data.free.toString(),reserved:data.reserved.toString(),frozen:data.frozen.toString(),spendable:spendable.toString(),block,blockHash};
}
export function feeProbe(from: string, call: string, nonce: number, block: number): string {
  const era = ((block % 16) << 4) | 3;
  const body = u8aConcat(new Uint8Array([0x84,0]),validAddress(from),new Uint8Array(7220),new Uint8Array([era & 255,era >> 8]),compactToU8a(nonce),new Uint8Array([0,0]),unhex(call));
  return hex(u8aConcat(compactToU8a(body.length),body));
}
export function unsignedFee(info: any): bigint {
  if (!info || typeof info.partialFee !== 'string' || !/^(0x[0-9a-f]+|\d+)$/i.test(info.partialFee)) throw new Error('手续费查询无效。');
  const fee = BigInt(info.partialFee);
  if (fee <= 0n || fee > 1_000_000_000_000n) throw new Error('手续费超出本版本的安全范围。');
  return fee;
}
export async function prepareTransfer(rpc: RpcLike, codec: ChainCodec, from: string, to: string, input: string, now = Date.now()): Promise<Draft> {
  if (!rpc.network.signing) throw new Error('当前网络未开放转账。');
  validAddress(from); validAddress(to);
  if (to === from) throw new Error('收款地址不能是当前账户。');
  const amount = parseAmount(input);
  await rpc.verify();
  const account = await readAccount(rpc,codec,from);
  const recipient = codec.balance(await rpc.call<string|null>('state_getStorage',[accountStorageKey(to),account.blockHash]));
  if (recipient.free + recipient.reserved + amount < codec.ed) throw new Error('金额低于此网络新账户的最低存款。');
  const nonce = asUInt(await rpc.call<number>('system_accountNextIndex',[from]));
  const call = codec.transfer(to,amount);
  const fee = unsignedFee(await rpc.call('payment_queryInfo',[feeProbe(from,call,nonce,account.block),account.blockHash]));
  const feeLimit = (fee*120n + 99n)/100n;
  if (amount + feeLimit > BigInt(account.spendable)) throw new Error('可用余额不足，需预留手续费和账户最低存款。');
  return Object.freeze({network:rpc.network.id as NetworkId,from,to,amount:amount.toString(),fee:fee.toString(),feeLimit:feeLimit.toString(),nonce,block:account.block,blockHash:account.blockHash,genesisHash:rpc.network.genesis,specVersion:rpc.network.specVersion,transactionVersion:rpc.network.transactionVersion,period:16,call,created:now,ed:codec.ed.toString()});
}
export function validateDraft(d: Draft, network: Network, expectedAddress: string, now = Date.now()): void {
  if (!network || d.network !== network.id || !network.signing || d.from !== expectedAddress || d.genesisHash !== network.genesis || d.specVersion !== network.specVersion || d.transactionVersion !== network.transactionVersion || d.period !== 16) throw new Error('交易上下文不匹配，已停止签名。');
  validAddress(d.from); validAddress(d.to); asUInt(d.nonce); asUInt(d.block);
  if (d.from === d.to || !isHash(d.blockHash) || !Number.isSafeInteger(d.created) || now-d.created>60_000 || now<d.created) throw new Error('交易确认已过期，请重新核对。');
  if (typeof d.amount!=='string' || typeof d.feeLimit!=='string' || typeof d.fee!=='string' || !/^\d{1,13}$/.test(d.fee) || BigInt(d.fee)<=0n || !/^\d{1,13}$/.test(d.feeLimit) || BigInt(d.feeLimit)<BigInt(d.fee) || !/^\d{1,20}$/.test(d.amount) || BigInt(d.amount)<=0n || BigInt(d.amount)>21_000_000n*10n**12n || !/^\d+$/.test(d.feeLimit) || BigInt(d.feeLimit)>10n**12n) throw new Error('交易金额或手续费无效。');
  const call = hex(u8aConcat(new Uint8Array([2,3,0]),validAddress(d.to),compactToU8a(BigInt(d.amount))));
  if (call !== d.call) throw new Error('交易内容与确认页面不一致。');
}
export async function recheckDraft(rpc: RpcLike, codec: ChainCodec, d: Draft): Promise<void> {
  validateDraft(d,rpc.network,d.from); await rpc.verify();
  const account = await readAccount(rpc,codec,d.from);
  const nonce = asUInt(await rpc.call<number>('system_accountNextIndex',[d.from]));
  if (nonce!==d.nonce || account.block<d.block || account.block-d.block>8 || (await rpc.call('chain_getBlockHash',[d.block]))!==d.blockHash) throw new Error('账户或区块状态已变化，请重新核对交易。');
  const fee = unsignedFee(await rpc.call('payment_queryInfo',[feeProbe(d.from,d.call,d.nonce,d.block),account.blockHash]));
  if (fee>BigInt(d.feeLimit) || BigInt(d.amount)+BigInt(d.feeLimit)>BigInt(account.spendable)) throw new Error('手续费或余额已变化，请重新核对交易。');
  validateDraft(d,rpc.network,d.from);
}
export function transactionHash(signed: string): string { return blake2AsHex(unhex(signed),256); }
