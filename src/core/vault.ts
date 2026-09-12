import { requirePassword, validAddress } from './validation';

export const CURRENT_ITERATIONS = 900_000;
const enc = new TextEncoder();
export type Vault = {
  version: 2; kdf: 'PBKDF2-SHA256'; iterations: number; cipher: 'AES-256-GCM';
  salt: string; iv: string; ciphertext: string; address: string; accountIndex: number;
};
function b64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function bytes(s: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function aad(v: Omit<Vault, 'ciphertext'>): Uint8Array<ArrayBuffer> {
  return enc.encode(JSON.stringify(['quantus-vault', v.version, v.kdf, v.iterations, v.cipher, v.salt, v.iv, v.address, v.accountIndex]));
}
export function validateVault(input: unknown): Vault {
  if (!input || typeof input !== 'object') throw new Error('钱包文件无效。');
  const v = input as Vault;
  if (!(v.version === 2 && v.iterations === CURRENT_ITERATIONS) || v.kdf !== 'PBKDF2-SHA256' || v.cipher !== 'AES-256-GCM') throw new Error('不支持的钱包加密格式。');
  if (!Number.isInteger(v.accountIndex) || v.accountIndex < 0 || v.accountIndex > 1000) throw new Error('钱包账户索引无效。');
  validAddress(v.address);
  for (const k of ['salt', 'iv', 'ciphertext'] as const) {
    if (typeof v[k] !== 'string' || v[k].length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v[k])) throw new Error('钱包密文无效。');
  }
  if (bytes(v.salt).length !== 32 || bytes(v.iv).length !== 12 || bytes(v.ciphertext).length < 32) throw new Error('钱包密文无效。');
  return v;
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const raw = enc.encode(password);
  try {
    const base = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { raw.fill(0); }
}
export async function seal(mnemonic: string, password: string, address: string, accountIndex: number): Promise<{ vault: Vault; key: CryptoKey }> {
  requirePassword(password);
  return encryptMnemonic(mnemonic,password,address,accountIndex);
}
async function encryptMnemonic(mnemonic:string,password:string,address:string,accountIndex:number):Promise<{vault:Vault;key:CryptoKey}> {
  validAddress(address);
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > 1000) throw new Error('账户索引无效。');
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, CURRENT_ITERATIONS);
  const header: Omit<Vault, 'ciphertext'> = { version: 2, kdf: 'PBKDF2-SHA256', iterations: CURRENT_ITERATIONS, cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), address, accountIndex };
  const clear = enc.encode(mnemonic);
  try {
    const ciphertext = b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header), tagLength: 128 }, key, clear)));
    return { vault: { ...header, ciphertext }, key };
  } finally { clear.fill(0); }
}
export async function openVault(vault: Vault, key: CryptoKey): Promise<string> {
  validateVault(vault);
  let clear: Uint8Array | undefined;
  try {
    clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(vault.iv), additionalData: aad(vault), tagLength: 128 }, key, bytes(vault.ciphertext)));
    return new TextDecoder('utf-8', { fatal: true }).decode(clear);
  } catch { throw new Error('密码不正确，或钱包文件已损坏。'); }
  finally { clear?.fill(0); }
}
export async function unlockKey(vault: Vault, password: string): Promise<CryptoKey> {
  validateVault(vault);
  if (typeof password !== 'string' || password.length > 256) throw new Error('密码无效。');
  return derive(password, bytes(vault.salt), vault.iterations);
}

