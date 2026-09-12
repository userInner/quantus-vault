self.onmessage=async()=>{const acquired=await navigator.locks.request('quantus-vault-transfer',{ifAvailable:true},lock=>!!lock);self.postMessage(acquired);};
export {};
