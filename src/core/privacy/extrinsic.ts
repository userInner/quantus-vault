import {compactToU8a,u8aConcat} from '@polkadot/util';
import type {ChainCodec} from '../chain';
import {hex} from '../validation';
/** Encodes a locally verified proof. Callers must finish review, durable reservation and rechecks before broadcasting. */
export function encodePrivateBatch(codec:ChainCodec,proof:Uint8Array):string{
  if(proof.length<100||proof.length>2_000_000)throw Error('Invalid privacy proof size');
  const pallet=codec.metadata.asLatest.pallets.find(p=>p.name.toString()==='Wormhole');
  if(!pallet?.calls.isSome)throw Error('Privacy calls unavailable');
  const type=codec.registry.lookup.getTypeDef(pallet.calls.unwrap().type);
  const variants=Array.isArray(type.sub)?type.sub:[];const variant=variants.find(v=>v.name==='verify_private_batch');
  const fields=Array.isArray(variant?.sub)?variant.sub:[];
  if(!variant||variant.index===undefined||fields.length!==1||fields[0].name!=='proofBytes'||fields[0].type!=='Bytes')throw Error('Unsupported private batch call');
  const payload=u8aConcat(new Uint8Array([4,pallet.index.toNumber(),variant.index]),compactToU8a(proof.length),proof);
  return hex(u8aConcat(compactToU8a(payload.length),payload));
}
