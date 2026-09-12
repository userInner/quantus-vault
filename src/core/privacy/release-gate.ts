/** Enable only after funded testnet receive/send/change/restore acceptance is recorded. No UI or storage override. */
export const PRIVATE_BROADCAST_ENABLED:boolean=false;
export function assertPrivateBroadcastEnabled():void{if(!PRIVATE_BROADCAST_ENABLED)throw Error('隐私广播尚未开放。');}
