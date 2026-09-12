# Verification for v0.1.15

## Automated checks

- TypeScript check: passed.
- Node test suite: 58 passed. Covers vault authentication/tampering, transaction constraints, duplicate-send protection, privacy discovery, commitments/nullifiers, encrypted journals and multi-batch reservations.
- Public frozen mainnet proof fixtures exercise circuit hashing and witness construction. These fixtures do not demonstrate ownership of funded assets.
- Native synthetic full-proof roundtrip passed during development.

## Browser checks performed during development

- Synthetic 15-credit balance: review a 1.4 QTC payment as three batches (0.69 / 0.69 / 0.02), total fees 0.03, change 0.07.
- Reserve all inputs; lock/unlock/rescan preserves all reservations; cancel remaining unbroadcast batches.
- Complete local proof: 151,156 bytes, approximately 51 seconds, followed by cancellation/worker termination check.
- Real preparation service with synthetic RPC and real WASM: immutable review produced; production broadcast gate sends zero requests.
- Real Planck RPC/indexer scan using a public test mnemonic: checkpoint 1,089,471, zero owned private credits. Read-only network/credit evidence is in `verification/`.

Evidence: [Node output](verification/privacy-batches-tests.txt), [browser notes](verification/private-send-ui-v015.txt), [network identities](verification/privacy-network-acceptance.json), [Planck query](verification/privacy-planck-live.json).

## Not completed

No funded end-to-end standard/private transfer acceptance and no independent security audit have been completed. Funded Planck tests must cover recipient output verification, change, multi-batch partial execution, restart and mnemonic-only restoration before private broadcasting is opened. Automated tests and generated proofs alone do not establish that on-chain transfers work.
