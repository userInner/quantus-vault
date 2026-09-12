//! Local proof generation, not a broadcast API. No secret is exported.
use wasm_bindgen::prelude::*;
use serde::Deserialize;
use qp_rusty_crystals_hdwallet::derive_wormhole_from_mnemonic;
use qp_wormhole_circuit::{inputs::{CircuitInputs,PrivateCircuitInputs,PublicCircuitInputs},sensitive::Secret,nullifier::Nullifier};
use qp_zk_circuits_common::{utils::digest_to_bytes,zk_merkle::ZkMerkleProof};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
 branch:u32,index:u32,leaf:Vec<u8>,siblings:Vec<[[u8;32];3]>,root:[u8;32],
 block_hash:[u8;32],block_number:u32,parent_hash:[u8;32],state_root:[u8;32],extrinsics_root:[u8;32],digest:Vec<u8>,
 recipient:[u8;32],recipient_amount:u32,change_index:u32,change_amount:u32,fee_bps:u32,
}
fn prove(mnemonic:&str,json:&str)->Result<Vec<u8>,String>{
 if json.len()>100_000{return Err("Proof request too large".into());}
 let inputs:Vec<Input>=serde_json::from_str(json).map_err(|_|"Invalid proof request")?;
 if inputs.is_empty()||inputs.len()>7{return Err("Invalid batch size".into());}
 let fee=inputs[0].fee_bps;let recipient=inputs[0].recipient;let change_index=inputs[0].change_index;
 let mut total_in=0u64;let mut total_out=0u64;
 for input in &inputs{
  if input.leaf.len()!=60||input.branch>1||input.index>=0x80000000||input.change_index>=0x80000000||input.siblings.len()>32||input.digest.len()>110||input.fee_bps>10000||input.fee_bps!=fee||input.recipient!=recipient||input.change_index!=change_index{return Err("Invalid or inconsistent batch".into());}
  let raw=u128::from_le_bytes(input.leaf[44..60].try_into().unwrap());
  let amount=u32::try_from(raw/10_000_000_000u128).map_err(|_|"Amount overflow")?;
  total_in+=amount as u64;total_out+=input.recipient_amount as u64+input.change_amount as u64;
 }
 if total_out==0||total_out!=total_in*(10000-fee as u64)/10000{return Err("Batch does not conserve funds".into());}
 let leaf_prover=qp_wormhole_prover::build_fresh();
 let common=leaf_prover.circuit_data.common.clone();
 let canonical=qp_wormhole_aggregator::common::utils::canonical_leaf_verifier_data();
 let dummy=qp_wormhole_aggregator::dummy_proof::build_dummy_circuit_inputs().map_err(|_|"Dummy circuit failed")?;
 let template=leaf_prover.commit(&dummy).map_err(|_|"Dummy commit failed")?.prove().map_err(|_|"Dummy proof failed")?;
 let batch=qp_wormhole_aggregator::private_batch::prover::PrivateBatchProver::new(qp_zk_circuits_common::circuit::wormhole_private_batch_circuit_config(),common,&canonical.verifier_only,7,template).map_err(|_|"Batch circuit failed")?;
 let mut proofs=Vec::new();let mut seen=std::collections::HashSet::new();
 for input in inputs {
  if input.branch>1||input.index>=0x80000000||input.change_index>=0x80000000||input.leaf.len()!=60||input.siblings.len()>32||input.digest.len()>110||input.fee_bps>10000{return Err("Invalid proof bounds".into());}
  let path=format!("m/44'/189189189'/0'/{}'/{}'",input.branch,input.index);
  let pair=derive_wormhole_from_mnemonic(mnemonic,None,&path).map_err(|_|"Invalid phrase")?;
  if input.leaf[..32]!=pair.address()[..]{return Err("Credit ownership mismatch".into());}
  let tc=u64::from_le_bytes(input.leaf[32..40].try_into().unwrap());
  let asset=u32::from_le_bytes(input.leaf[40..44].try_into().unwrap());if asset!=0{return Err("Unsupported asset".into());}
  let raw=u128::from_le_bytes(input.leaf[44..60].try_into().unwrap());
  let amount=u32::try_from(raw/10_000_000_000u128).map_err(|_|"Amount overflow")?;
  let secret=(*pair.secret().as_bytes()).try_into().map_err(|_|"Secret digest invalid")?;
  let nul=digest_to_bytes(Nullifier::from_preimage(secret,tc).hash);if !seen.insert(nul){return Err("Duplicate credit".into());}
  let leaf=qp_wormhole_circuit::zk_merkle_proof::ZkLeafData::new(*pair.address(),tc,asset,amount,input.recipient_amount,input.change_amount,input.fee_bps);
  let leaf_hash=plonky2::hash::poseidon2::hash_no_pad_bytes(&leaf.collect_for_hash());
  let merkle=ZkMerkleProof::from_unsorted(0,input.siblings,leaf_hash,input.root).map_err(|_|"Invalid Merkle proof")?;
  if !merkle.verify(){return Err("Invalid Merkle root".into());}
  let change_path=format!("m/44'/189189189'/0'/1'/{}'",input.change_index);
  let change=derive_wormhole_from_mnemonic(mnemonic,None,&change_path).map_err(|_|"Invalid change path")?;
  let mut digest=[0u8;110];digest[..input.digest.len()].copy_from_slice(&input.digest);
  let circuit=CircuitInputs{
   private:PrivateCircuitInputs{secret:Secret::from(secret),transfer_count:tc,unspendable_account:(*pair.address()).try_into().map_err(|_|"Address digest")?,parent_hash:input.parent_hash.try_into().map_err(|_|"Parent hash")?,state_root:input.state_root.try_into().map_err(|_|"State root")?,extrinsics_root:input.extrinsics_root.try_into().map_err(|_|"Extrinsics root")?,digest,zk_tree_root:input.root,zk_merkle_siblings:merkle.siblings,zk_merkle_positions:merkle.positions},
   public:PublicCircuitInputs{asset_id:asset,output_amount_1:input.recipient_amount,output_amount_2:input.change_amount,volume_fee_bps:input.fee_bps,nullifier:nul,exit_account_1:input.recipient.try_into().map_err(|_|"Recipient")?,exit_account_2:(*change.address()).try_into().map_err(|_|"Change")?,block_hash:input.block_hash.try_into().map_err(|_|"Block hash")?,block_number:input.block_number,input_amount:amount},
  };
  let proof=qp_wormhole_prover::build_fresh().commit(&circuit).map_err(|_|"Proof commit failed")?.prove().map_err(|_|"Proof generation failed")?;proofs.push(proof);
 }
 let proof=batch.aggregate(proofs).map_err(|_|"Aggregation failed")?;
 let verifier=qp_wormhole_aggregator::common::utils::canonical_private_batch_verifier_data(&canonical,7).map_err(|_|"Verifier unavailable")?;
 verifier.verify(proof.clone()).map_err(|_|"Local verification failed")?;
 Ok(proof.to_bytes())
}
#[wasm_bindgen(js_name=provePrivacyBatch)]
pub fn prove_privacy_batch(mnemonic:&str,json:&str)->Result<Vec<u8>,JsError>{prove(mnemonic,json).map_err(|_|JsError::new("Privacy proof failed"))}

#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn rejects_unbounded_and_empty_requests_before_proving(){assert!(prove("invalid","[]").is_err());assert!(prove("invalid",&" ".repeat(100001)).is_err());assert!(prove("invalid","{}").is_err());}
}
#[cfg(test)]
mod roundtrip {
 use super::*;
 #[test]
 #[ignore = "expensive full proof roundtrip; public synthetic witness only"]
 fn synthetic_batch_proves_and_verifies() {
  let phrase="human snow truck virus now jaguar wall brisk shoe craft gravity diesel";
  let pair=derive_wormhole_from_mnemonic(phrase,None,"m/44'/189189189'/0'/0'/0'").unwrap();
  let mut leaf=pair.address().to_vec();leaf.extend(0u64.to_le_bytes());leaf.extend(0u32.to_le_bytes());leaf.extend((10000u128*10_000_000_000).to_le_bytes());
  let data=qp_wormhole_circuit::zk_merkle_proof::ZkLeafData::new(*pair.address(),0,0,10000,9995,1,4);
  let root=plonky2::hash::poseidon2::hash_no_pad_bytes(&data.collect_for_hash());
  let zero=[0u8;32];let digest=[0u8;110];
  let header=qp_wormhole_circuit::block_header::header::HeaderInputs::new(zero.try_into().unwrap(),100,zero.try_into().unwrap(),zero.try_into().unwrap(),root.try_into().unwrap(),&digest).unwrap();
  let hash=header.block_hash();
  let input=serde_json::json!([{"branch":0,"index":0,"leaf":leaf,"siblings":[],"root":root,"block_hash":hash.as_ref(),"block_number":100,"parent_hash":zero,"state_root":zero,"extrinsics_root":zero,"digest":digest.to_vec(),"recipient":pair.address(),"recipient_amount":9995,"change_index":0,"change_amount":1,"fee_bps":4}]);
  println!("PUBLIC_BROWSER_FIXTURE:{}",input);
  let proof=prove(phrase,&input.to_string()).unwrap();assert!(proof.len()>100000);
 }
}
