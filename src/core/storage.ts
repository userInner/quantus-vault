import type {PrivateJournalIO} from './privacy/journal';
import { validateVault, type Vault } from './vault';
import {validAddress,isHash,asUInt} from './validation';
export type TxRecord = { hash: string; network: 'planck' | 'mainnet'; from: string; to: string; amount: string; time: number; block: number; state: 'broadcasting' | 'submitted' | 'uncertain' | 'confirmed' | 'failed' | 'cancelled'; detail?: string };
export function validateHistory(input: unknown): TxRecord[] {
  if(input === undefined)return [];
  if(!Array.isArray(input) || input.length>50)throw new Error('本地交易记录损坏。为避免重复发送，请先核对链上记录。');
  const states=['broadcasting','submitted','uncertain','confirmed','failed','cancelled'];
  for(const r of input){
    if(!r || !isHash(r.hash) || !['planck','mainnet'].includes(r.network) || !states.includes(r.state) || typeof r.amount!=='string' || !/^\d{1,20}$/.test(r.amount))throw new Error('本地交易记录损坏。请勿重复发送。');
    validAddress(r.from);validAddress(r.to);asUInt(r.time);asUInt(r.block);
    if(r.detail!==undefined && (typeof r.detail!=='string'||r.detail.length>240))throw new Error('本地交易记录损坏。');
  }
  return input;
}
export interface Store {
  privateJournal?(genesis:string,address:string):PrivateJournalIO;
  loadLocale?(): Promise<unknown>;
  saveLocale?(locale:'en'|'zh-CN'):Promise<void>;
  loadVault(): Promise<Vault | undefined>;
  saveVault(v: Vault): Promise<void>;
  history(): Promise<TxRecord[]>;
  saveHistory(records: TxRecord[]): Promise<void>;
}
export function extensionStore(): Store {
  if (location.protocol !== 'chrome-extension:' || !chrome?.runtime?.id) throw new Error('请在浏览器扩展中打开钱包。');
  const init = (chrome.storage.local as typeof chrome.storage.local & {setAccessLevel: (o: {accessLevel: string}) => Promise<void>}).setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return {
    privateJournal(genesis,address){
      if(!isHash(genesis))throw Error('Invalid journal network');validAddress(address);
      const name=`private-journal:${genesis}:${address}`;
      return {load:async()=>{await init;return (await chrome.storage.local.get(name))[name];},save:async value=>{await init;await chrome.storage.local.set({[name]:value});}};
    },
    async loadLocale(){await init;return (await chrome.storage.local.get('locale')).locale;},
    async saveLocale(locale){await init;await chrome.storage.local.set({locale});},
    async loadVault() { await init; const data = await chrome.storage.local.get('vault'); return data.vault ? validateVault(data.vault) : undefined; },
    async saveVault(v) { await init; await navigator.locks.request('quantus-vault-create',async()=>{if ((await chrome.storage.local.get('vault')).vault) throw new Error('已存在钱包，不能覆盖。'); await chrome.storage.local.set({ vault: validateVault(v) });}); },
    async history() { await init; const d = await chrome.storage.local.get('history'); return validateHistory(d.history); },
    async saveHistory(history) { await init; await chrome.storage.local.set({ history: validateHistory(history.slice(0, 50)) }); }
  };
}


