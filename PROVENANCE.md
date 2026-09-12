# Source and build provenance

## Project and upstream code

- UI and extension integration: Quantus Vault contributors, MIT. Colors and network naming reference [Quantus](https://www.quantus.com/); no official endorsement is claimed.
- Standard signer: [Quantus-Network/quantus-wasm](https://github.com/Quantus-Network/quantus-wasm/tree/9149a4d0617dbefe937a6c091ec87c9ed8054cfd), MIT, vendored at that commit with its LICENSE and original Cargo lockfile. The local `src/ext.rs` adaptation adds the `QUANTUS_EXTRINSIC` context for runtime >=148. Standard HD derivation remains on 2.4.0.
- Privacy integration: separate local Rust/WASM wrapper around pinned official crates, including `qp-rusty-crystals-hdwallet` 4.1.1 and Wormhole circuit/prover/aggregator 4.3.0. Secret derivation and proof generation stay in isolated workers.
- Protocol reference: [quantus-apps at e843b06](https://github.com/Quantus-Network/quantus-apps/tree/e843b06b49e4c208f7b4a8c603a91f4578780e96). Original reference source files are not redistributed because an explicit repository license was not found. Links and inspected hashes are retained in `reference/privacy-design/`.
- RPC network snapshots and pinned metadata are included under `reference/` and `public/metadata/`. Runtime upgrades fail closed until pins are reviewed and updated.

## Build artifacts

`wasm/` and `privacy-wasm/` contain checked-in browser-targeted WASM and bindings. Normal `npm run build` bundles these artifacts and does not require Rust. The release's `BUILD_INFO.json` identifies the source commit and signer WASM hash; `PRIVACY_BUILD_INFO.json` records the privacy WASM and lockfile hashes.

Rebuild using `wasm-pack --target web --release --locked --no-opt` through the npm scripts. Changes to dependencies require new WASM, matching hash records, license snapshots, and relevant native/browser tests. A recorded hash establishes artifact identity, not an independent audit or a reproducible-build certification.

## Licenses

Vendored signer code retains its MIT license. npm and Rust dependencies retain their own copyright and license terms. Complete packaged notices live under the extension's `licenses/` directory. The privacy Rust notices are snapshotted in `reference/privacy-rust-licenses/` so a clean Node-only build includes them without relying on a developer's Cargo cache. Refresh those notices when dependencies change.

The repository's MIT license applies to project-authored code, not as a replacement for dependency licenses or network trademarks.
