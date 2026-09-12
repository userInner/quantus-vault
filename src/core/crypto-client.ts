export class CryptoClient {
  private jobs = new Set<{worker: Worker; cancel: () => void}>();
  run<T>(message: unknown): Promise<T> {
    return new Promise((resolve,reject) => {
      const worker = new Worker(new URL('crypto-worker.js',location.href),{type:'module'});
      const stop = () => {clearTimeout(timer); worker.terminate();this.jobs.delete(job);};
      const job = {worker,cancel:()=>{stop();reject(new Error('操作已取消，钱包已锁定。'));}};
      const timer = setTimeout(()=>{stop();reject(new Error('密钥操作超时，请重试。'));},30_000);
      this.jobs.add(job);
      worker.onmessage = e => {stop();if(e.data?.ok)resolve(e.data.result);else reject(new Error(e.data?.error ?? '密钥操作失败。'));};
      worker.onerror = () => {stop();reject(new Error('本地签名模块加载失败，请重新安装完整扩展。'));};
      worker.postMessage(message);
    });
  }
  cancelAll(): void { for(const job of [...this.jobs]) job.cancel(); }
}
