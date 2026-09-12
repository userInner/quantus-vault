// A popup owns its session. No password, mnemonic, or unlocked key is persisted.
export class Session {
  private key?: CryptoKey;
  private generation = 0;
  private touchedAt = 0;
  readonly idleMs = 120_000;
  constructor(private now = () => Date.now()) {}
  unlock(key: CryptoKey): void { this.generation++; this.key = key; this.touchedAt = this.now(); }
  lock(): void { this.generation++; this.key = undefined; }
  touch(): void { if (this.isUnlocked()) this.touchedAt = this.now(); }
  isUnlocked(): boolean {
    if (this.key && this.now() - this.touchedAt >= this.idleMs) this.lock();
    return this.key !== undefined;
  }
  token(): number { return this.generation; }
  assert(token: number): CryptoKey {
    if (!this.isUnlocked() || token !== this.generation || !this.key) throw new Error('钱包已锁定，请重新解锁。');
    return this.key;
  }
}
