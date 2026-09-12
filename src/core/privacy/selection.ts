/** Quantus Wormhole v4.3 batch economics. Parameters must come from pinned runtime metadata. */
export type PrivacyEconomics = { scale: bigint; feeBps: number; batchSize: 7 };
export type PrivateInput = { nullifier: string; amount: bigint; index: number; change: boolean };
export type PrivateAssignment = { input: PrivateInput; recipient: bigint; change: bigint };
export type PrivatePlan = { batches: PrivateAssignment[][]; amount: bigint; change: bigint; fee: bigint };
const U32_MAX = 0xffff_ffffn;
function validate(e:PrivacyEconomics):void {
  if(e.scale!==10_000_000_000n || !Number.isInteger(e.feeBps) || e.feeBps<0 || e.feeBps>10000 || e.batchSize!==7)throw Error('Unsupported privacy economics');
}
const net=(sum:bigint,e:PrivacyEconomics)=>sum*BigInt(10000-e.feeBps)/10000n;
function candidates(inputs:readonly PrivateInput[],pending:ReadonlySet<string>,e:PrivacyEconomics):PrivateInput[] {
  validate(e);const seen=new Set<string>();
  return inputs.map(input=>{
    if(!/^0x[0-9a-f]{64}$/.test(input.nullifier)||seen.has(input.nullifier)||typeof input.amount!=='bigint'||input.amount<0n||input.amount/e.scale>U32_MAX||!Number.isSafeInteger(input.index)||input.index<0||typeof input.change!=='boolean')throw Error('Invalid or duplicate private input');
    seen.add(input.nullifier);return {...input};
  }).filter(u=>!pending.has(u.nullifier)&&u.amount/e.scale>0n).sort((a,b)=>a.amount===b.amount?a.nullifier.localeCompare(b.nullifier):a.amount>b.amount?-1:1);
}
export function privateSpendable(inputs:readonly PrivateInput[],pending:ReadonlySet<string>,e:PrivacyEconomics):bigint {
  const list=candidates(inputs,pending,e);let total=0n;
  for(let i=0;i<list.length;i+=7)total+=net(list.slice(i,i+7).reduce((s,u)=>s+u.amount/e.scale,0n),e);
  return total*e.scale;
}
/** Largest-first selection; fee is rounded once per batch, never once per leaf. */
export function selectPrivateInputs(inputs:readonly PrivateInput[],pending:ReadonlySet<string>,amount:bigint,e:PrivacyEconomics):PrivatePlan {
  validate(e);
  if(typeof amount!=='bigint'||amount<=0n||amount%e.scale!==0n||amount/e.scale>U32_MAX)throw Error('Invalid private amount');
  const list=candidates(inputs,pending,e);const target=amount/e.scale;
  const selected:PrivateInput[]=[];let completed=0n,current=0n;
  for(const u of list){
    if(selected.length && selected.length%7===0){completed+=net(current,e);current=0n;}
    selected.push(u);current+=u.amount/e.scale;
    if(completed+net(current,e)>=target)break;
  }
  if(completed+net(current,e)<target)throw Error('Insufficient private funds');
  const batches:PrivateAssignment[][]=[];let remaining=target,change=0n,consumed=0n;
  for(let i=0;i<selected.length;i+=7){
    const batch=selected.slice(i,i+7);const outputs=batch.map(u=>u.amount/e.scale);
    const total=outputs.reduce((a,b)=>a+b,0n);let fee=total-net(total,e);
    for(let j=outputs.length-1;j>=0&&fee>0n;j--){const deduction=outputs[j]!<fee?outputs[j]!:fee;outputs[j]-=deduction;fee-=deduction;}
    batches.push(batch.map((input,j)=>{
      const pay=outputs[j]!<remaining?outputs[j]!:remaining;remaining-=pay;
      const remainder=outputs[j]!-pay;change+=remainder;consumed+=input.amount;
      return {input,recipient:pay,change:remainder};
    }));
  }
  if(remaining!==0n)throw Error('Private selection mismatch');
  change*=e.scale;
  return {batches,amount,change,fee:consumed-amount-change};
}
