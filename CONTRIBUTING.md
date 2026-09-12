# Contributing

Use Node.js 22+, run `npm ci`, then `npm run check`, `npm test`, and `npm run build` before opening a pull request. Explain the behavior change and relevant verification.

Keep wallet operations local, preserve runtime/network pinning, and use the committed upstream cryptographic libraries. Never add telemetry or send secrets to RPC/indexer endpoints. Public fixture phrases belong only in tests; never fund them.

Private broadcasting is intentionally disabled. Enabling it requires recorded funded Planck receive/send/change/restore tests and a review of the security boundary. Do not change a disabled UI button without checking the service and RPC gates.

Changes to cryptographic dependencies require updating lockfiles, rebuilding WASM, refreshing `reference/privacy-rust-licenses/`, updating build hashes and rerunning the native and browser proof checks. `scripts/privacy-licenses.mjs` can refresh the privacy dependency license output after Cargo dependencies have been fetched.

Please report sensitive vulnerabilities through GitHub's private vulnerability reporting feature, not in public issues. Do not attach actual wallet exports, recovery phrases, passwords or private keys.
