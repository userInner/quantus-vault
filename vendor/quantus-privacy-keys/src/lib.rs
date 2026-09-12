//! Discovery-only bindings: spend secrets and first_hash never cross the WASM boundary.
use qp_rusty_crystals_hdwallet::derive_wormhole_from_mnemonic;
use wasm_bindgen::prelude::*;
fn derive(mnemonic: &str, branch: u32, index: u32) -> Result<String, &'static str> {
    if branch > 1 || index >= 0x8000_0000 { return Err("Invalid privacy path"); }
    let path = format!("m/44'/189189189'/0'/{branch}'/{index}'");
    let pair = derive_wormhole_from_mnemonic(mnemonic, None, &path)
        .map_err(|_| "Invalid privacy recovery phrase")?;
    Ok(format!("0x{}", hex::encode(pair.address())))
}
#[wasm_bindgen(js_name = privacyAddressId)]
pub fn privacy_address_id(mnemonic: &str, branch: u32, index: u32) -> Result<String, JsError> {
    derive(mnemonic, branch, index).map_err(JsError::new)
}
#[cfg(test)]
mod tests {
    use super::*;
    const PHRASE: &str = "rocket primary way job input cactus submit menu zoo burger rent impose";
    #[test]
    fn official_library_known_answer() {
        let pair=derive_wormhole_from_mnemonic(PHRASE,None,"m/44'/189189189'/0'").unwrap();
        assert_eq!(hex::encode(pair.address()),"6a2f0d3abe4390e0b05f6dea4ba10670676cda7c00d49526ddde59f16c85269f");
    }
    #[test]
    fn branches_and_high_indices_follow_official_paths() {
        for phrase in [PHRASE,"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"] {
        for branch in 0..=1 { for index in [0,1,20,1000,0x7fffffff] {
            let path=format!("m/44'/189189189'/0'/{branch}'/{index}'");
            let expected=derive_wormhole_from_mnemonic(phrase,None,&path).unwrap();
            assert_eq!(derive(phrase,branch,index).unwrap(),format!("0x{}",hex::encode(expected.address())));
        }}}
        assert_ne!(derive(PHRASE,0,0),derive(PHRASE,1,0));
    }
    #[test]
    fn invalid_paths_and_phrases_fail() {
        assert!(derive(PHRASE,2,0).is_err());assert!(derive(PHRASE,0,0x80000000).is_err());
        assert!(derive("invalid",0,0).is_err());
    }
}

/// Computes a spend identifier without exporting the underlying spend secret.
#[wasm_bindgen(js_name = privacyNullifier)]
pub fn privacy_nullifier(mnemonic:&str,branch:u32,index:u32,count:&str)->Result<String,JsError>{
    if branch>1 || index>=0x80000000 {return Err(JsError::new("Invalid privacy path"));}
    let tc=count.parse::<u64>().map_err(|_|JsError::new("Invalid transfer count"))?;
    if tc.to_string()!=count{return Err(JsError::new("Noncanonical transfer count"));}
    let path=format!("m/44'/189189189'/0'/{branch}'/{index}'");
    let pair=derive_wormhole_from_mnemonic(mnemonic,None,&path).map_err(|_|JsError::new("Invalid phrase"))?;
    let digest=(*pair.secret().as_bytes()).try_into().map_err(|_|JsError::new("Invalid secret digest"))?;
    let n=qp_wormhole_circuit::nullifier::Nullifier::from_preimage(digest,tc);
    Ok(format!("0x{}",hex::encode(qp_zk_circuits_common::utils::digest_to_bytes(n.hash))))
}
/// Check exact leaf bytes and the official four-ary Poseidon path against a pinned root.
#[wasm_bindgen(js_name = verifyPrivacyMerkle)]
pub fn verify_privacy_merkle(leaf:&[u8],siblings:&[u8],root:&[u8])->bool{
    if leaf.len()!=60 || siblings.len()%96!=0 || siblings.len()>32*96 || root.len()!=32{return false;}
    let raw=u128::from_le_bytes(leaf[44..60].try_into().unwrap());
    let scaled=match u32::try_from(raw/10_000_000_000u128){Ok(v)=>v,Err(_)=>return false};
    let data=qp_wormhole_circuit::zk_merkle_proof::ZkLeafData::new(leaf[0..32].try_into().unwrap(),u64::from_le_bytes(leaf[32..40].try_into().unwrap()),u32::from_le_bytes(leaf[40..44].try_into().unwrap()),scaled,0,0,0);
    let leaf_hash=plonky2::hash::poseidon2::hash_no_pad_bytes(&data.collect_for_hash());
    let levels=siblings.chunks_exact(96).map(|l| [l[0..32].try_into().unwrap(),l[32..64].try_into().unwrap(),l[64..96].try_into().unwrap()]).collect();
    match qp_zk_circuits_common::zk_merkle::ZkMerkleProof::from_unsorted(0,levels,leaf_hash,root.try_into().unwrap()){
        Ok(proof)=>proof.verify(),Err(_)=>false
    }
}

mod prover;
