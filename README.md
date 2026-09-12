# Quantus Vault

An independent, open-source browser extension wallet for Quantus. **Not an official Quantus product.**

[Download v0.1.15](https://github.com/userInner/quantus-vault/releases/tag/v0.1.15) · [中文说明](README.zh-CN.md) · [Security](SECURITY.md) · [Privacy status](PRIVACY-STATUS.md)

## Install in Chrome or Edge

1. Download **`quantus-vault-extension-v0.1.15.zip`** from the release assets. GitHub's automatic “Source code” downloads are not installable extensions.
2. Extract the ZIP. The `quantus-vault-extension` folder must contain `manifest.json`.
3. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, and select **Load unpacked**.
4. Select that extracted folder and pin Quantus Vault to the toolbar.
5. Create a wallet or import your recovery phrase. Keep an offline backup.

To update, extract into the same extension folder and press **Reload** on the extension card. Do not uninstall to update: uninstalling deletes locally stored wallet data. This development release reads only vault format v2; it does not migrate earlier formats.

The release includes the JavaScript and WASM files required to run. No Node.js or Rust installation is needed to install the extension. This is an unpacked extension release, not a Chrome Web Store or Edge Add-ons listing.

## What works in v0.1.15

| Feature | Status |
| --- | --- |
| Create a 24-word wallet; import 12/24 English words | Implemented; standard account indices 0–1000 |
| English / Simplified Chinese | English by default |
| Mainnet / Planck balance, receive address and QR | Implemented; mainnet is the default |
| Standard public transfers | Implemented: fee review, local signing, one-shot broadcast, finalized receipt checks |
| Local vault | PBKDF2-SHA256 (900,000 rounds), AES-256-GCM, minimum 8-character password |
| Locking | On close/page hide and after two minutes idle |
| Private asset discovery | Mainnet and Planck; receiving/change branches, Merkle and nullifier checks |
| Private payment preparation | Per-batch amount/fee/change review, encrypted reservations, local proofs, cancellation and recovery |
| Private broadcasting | **Disabled in the UI, transfer service and RPC layer** |
| dApp connections / BIP39 passphrases | Not supported |

Private transfers remain disabled until funded Planck receive/send/change/restore acceptance is completed. Multi-batch payments settle separately; a finalized batch cannot be reversed. Indexers see queried addresses and connection IPs. The wallet checks pinned RPC identities and commitments; it is not a light client.

**No independent security audit or funded end-to-end transfer acceptance has been completed.** Implemented functionality and automated test results are not a guarantee of safety for real funds. See [verification](VERIFICATION.md) for the exact boundary.

## Build from source

Requirements: **Node.js 22+**, npm. Prebuilt WASM and dependency license snapshots are included, so the normal extension build does not require Rust.

```sh
npm ci
npm run check
npm test
npm run build
```

Load `dist/` as an unpacked extension. `npm test` uses public fixtures and simulated RPC responses; it does not transfer funds.

Optional browser checks:

```sh
npm run test:browser:build
npm run test:privacy:browser:build
npm run test:privacy:proof:browser:build
npm run preview
```

Open `http://127.0.0.1:4179/tests.html`, `/privacy-tests.html`, `/privacy-proof.html` or `/privacy-transfer.html`. The privacy tests include clearly labelled read-only live network checks. The complete local proof takes about 51 seconds on the development machine; timings vary. Never fund the public test phrases or fixture addresses.

To rebuild WASM, install Rust, the `wasm32-unknown-unknown` target and `wasm-pack`, then run `npm run build:wasm` and `npm run build:privacy:wasm`. Rust dependencies are pinned by committed lockfiles. Recheck artifact hashes and license snapshots after changing dependencies. See [provenance](PROVENANCE.md).

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md). Useful next steps are funded Planck acceptance, independent review of the proof/receipt/recovery flow, and privacy interoperability tests. Never put recovery phrases, passwords, private keys, or wallet exports in issues or pull requests.

## License

Project code is [MIT](LICENSE). Vendored code and dependencies retain their own licenses, included with the extension under `licenses/`. The Quantus name identifies the supported network; this repository does not claim official endorsement.
