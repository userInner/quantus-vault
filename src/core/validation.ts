import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

export const DECIMALS = 12;
export const UNIT = 10n ** 12n;
export const MAX_AMOUNT = 21_000_000n * UNIT;
export function parseAmount(input: string): bigint {
  if (typeof input !== 'string' || !/^(0|[1-9]\d{0,7})(\.\d{1,12})?$/.test(input)) throw new Error('请输入有效金额，最多 12 位小数，不支持科学计数法。');
  const [whole, fraction = ''] = input.split('.');
  const value = BigInt(whole) * UNIT + BigInt(fraction.padEnd(12, '0'));
  if (value <= 0n || value > MAX_AMOUNT) throw new Error('金额必须大于 0，且不能超过网络供应上限。');
  return value;
}
export function formatAmount(value: bigint | string): string {
  const n = BigInt(value); const f = (n % UNIT).toString().padStart(12, '0').replace(/0+$/, '');
  return `${n / UNIT}${f ? `.${f}` : ''}`;
}
export function validAddress(address: string): Uint8Array {
  if (typeof address !== 'string' || address.length > 64 || !/^q[1-9A-HJ-NP-Za-km-z]+$/.test(address)) throw new Error('请输入 Quantus 的完整 q 开头地址。');
  try {
    const bytes = decodeAddress(address, false, 189);
    if (bytes.length !== 32 || encodeAddress(bytes, 189) !== address) throw new Error();
    return bytes;
  } catch { throw new Error('地址校验失败，请核对完整地址和网络。'); }
}
export const MIN_PASSWORD_LENGTH = 8;
export function requirePassword(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > 256) throw new Error('密码长度需为 8–256 个字符，建议使用多个不相关的词。');
  if (password.trim().length < MIN_PASSWORD_LENGTH) throw new Error('密码不能主要由空格组成。');
}
export function hex(bytes: Uint8Array): string { return '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
export function unhex(value: string): Uint8Array {
  if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(value)) throw new Error('无效的十六进制数据。');
  return Uint8Array.from(value.slice(2).match(/../g) ?? [], b => parseInt(b, 16));
}
export function isHash(value: unknown): value is string { return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value); }
export function asUInt(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('节点返回的数值无效。');
  return value;
}
export function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : '操作未完成，请重试。';
}
