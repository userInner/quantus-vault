import init, { accountFromMnemonic, signCallFromMnemonic } from '../wasm/quantus_wasm';
import { entropyToMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { seal, unlockKey, openVault, type Vault } from './core/vault';
import { hex, unhex } from './core/validation';
import { validateDraft, type Draft } from './core/chain';
import { NETWORKS } from './core/rpc';

function normalize(value: string): string {
  if (typeof value !== 'string' || value.length > 1024) throw new Error('助记词格式无效。');
  const mnemonic = value.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');
  if (![12,24].includes(mnemonic.split(' ').length) || !validateMnemonic(mnemonic,wordlist)) throw new Error('助记词校验失败，需为 12 或 24 个有效英文单词。');
  return mnemonic;
}
async function address(mnemonic: string, index: number): Promise<string> {
  if (!Number.isInteger(index) || index<0 || index>1000) throw new Error('账户索引无效。');
  await init({module_or_path: new URL('quantus_wasm_bg.wasm',self.location.href)});
  const account = accountFromMnemonic(mnemonic,index,0,0);
  try { return account.address; } finally { account.free(); }
}
self.onmessage = async (event: MessageEvent) => {
  const m = event.data;
  try {
    if (!m || typeof m.op !== 'string') throw new Error('无效的钱包请求。');
    let result: unknown;
    if (m.op === 'generate') {
      const entropy = crypto.getRandomValues(new Uint8Array(32));
      try { result = {mnemonic: entropyToMnemonic(entropy,wordlist)}; } finally { entropy.fill(0); }
    } else if (m.op === 'create') {
      const mnemonic = normalize(m.mnemonic);
      const addr = await address(mnemonic,m.accountIndex);
      result = await seal(mnemonic,m.password,addr,m.accountIndex);
    } else if (m.op === 'unlock' || m.op === 'reveal' || m.op === 'sign') {
      const vault = m.vault as Vault;
      const key = await unlockKey(vault,m.password);
      const mnemonic = normalize(await openVault(vault,key));
      const addr = await address(mnemonic,vault.accountIndex);
      if (addr !== vault.address) throw new Error('钱包地址与密钥不匹配。');
      if (m.op === 'unlock') result={key};
      if (m.op === 'reveal') result = {mnemonic};
      if (m.op === 'sign') {
        const d = m.draft as Draft;
        validateDraft(d,NETWORKS[d.network],addr);
        const signed = signCallFromMnemonic(mnemonic,unhex(d.call),{
          nonce:d.nonce,tip:'0',period:16,blockNumber:d.block,genesisHash:d.genesisHash,blockHash:d.blockHash,specVersion:d.specVersion,transactionVersion:d.transactionVersion
        },vault.accountIndex,0,0);
        try { result = {signed:hex(signed)}; } finally { signed.fill(0); }
      }
    } else throw new Error('不允许的钱包操作。');
    self.postMessage({ok:true,result});
  } catch (e) {
    // No raw WASM or RPC exceptions: they may contain user input.
    const known = e instanceof Error && /[\u4e00-\u9fff]/.test(e.message) ? e.message : '密钥操作失败，请核对输入后重试。';
    self.postMessage({ok:false,error:known});
  }
  // Parent also terminates the worker. Each operation gets a fresh WASM memory.
  self.close();
};
