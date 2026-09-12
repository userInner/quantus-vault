# Security policy

This project has not received an independent security audit. v0.1.15 is the initial public release; earlier local development versions are not supported. The current format does not migrate old encrypted vaults.

## Report a vulnerability

Use **Security → Report a vulnerability** in this GitHub repository. Do not disclose exploit details or real wallet material in public issues. Never send recovery phrases, passwords, private keys or decrypted journal contents.

## Security boundaries

- AES-256-GCM vault encryption, 32-byte random salt, 12-byte IV, 128-bit authentication tag, PBKDF2-SHA256 with 900,000 rounds. Authenticated metadata binds the account and vault header; session keys are non-extractable.
- Minimum new password length: 8 characters. No unlocked key or password is persisted. Workers terminate on cancellation/lock. Closing/hiding a page or two minutes idle locks the wallet.
- Ordinary sends are revalidated before signing and broadcasting. A durable intent is saved first; ambiguous results are not automatically retried.
- Private journals are separately encrypted and bound to the wallet/network. Cross-window mutations share a Web Lock. A multi-batch payment reserves its inputs atomically; only never-broadcast preparations can be cancelled. Unknown/failed broadcasts remain reserved.
- Each next private batch requires finalized predecessors. Resuming a preparation preserves its recipient, amounts and change index. Allocated change indices remain in recovery scope. The journal is bounded to 200 entries and fails closed rather than discarding recovery records.
- Private broadcasting is disabled in the UI, service and unsigned RPC path. Local proof generation is available; funded receipt/change/recovery acceptance is incomplete.
- Only pinned Quantus runtime/network identities are accepted. The browser connects to three official RPC hosts and two official indexers. No webpage access, content injection or clipboard-read permission is requested.

## Limits

RPC/indexer endpoints see connection IPs and public queries. This is not a light client; identity and commitment checks do not remove the trust placed in RPC responses. Address discovery uses a bounded gap scan and can miss assets beyond the scanned range. Browser or OS compromise can defeat local protections. Offline encrypted-vault attacks depend on password strength. Local duplicate protection does not coordinate separate devices.

Dependency advisory results are time-sensitive; run current npm/Rust audits when reviewing a release. Historical development audit reports are not a current security certification. Dependencies retain their upstream maintenance and licensing constraints.
