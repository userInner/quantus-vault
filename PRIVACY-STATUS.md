# Privacy status — v0.1.16

## Available

- Mainnet and Planck discovery of private receiving/change addresses from privacy account 0.
- Candidate-credit discovery via the official network indexer, followed by header-bound Merkle and nullifier checks.
- Payment form and per-batch amount, fee, change and disclosure review.
- Up to 20 batches of 7 inputs. All inputs are reserved in one encrypted journal write.
- Isolated local proof generation and immutable proof review.
- Never-broadcast batch recovery after unlock/rescan, preserving recipient, amounts and change index.
- Cancellation of remaining unbroadcast batches. Submitted/unknown/failed inputs remain reserved; later batches require finalized predecessors.
- Finalized receipt checking code and per-batch progress display.

## Still disabled

**Actual private broadcasting is disabled in the UI, transfer service and unsigned RPC path.** There is no user setting to bypass these gates. This release cannot complete a private payment on-chain.

Funded Planck receive/send tests, exact output verification, change recovery, partial multi-batch execution, and mnemonic-only restoration are not complete. Independent audit is also outstanding.

## What was tested

58 Node tests; browser review/reservation/lock-rescan/cancellation; a complete 151,156-byte browser proof in about 51 seconds; real preparation code using a synthetic RPC and real WASM; private broadcasting blocked before any network request. The complete live Planck scan at checkpoint 1,089,471 found zero owned private credits for the public test mnemonic. No real funds were transferred.

See [verification](VERIFICATION.md). Offline/synthetic tests and empty-wallet live scans do not constitute funded transfer acceptance.

## Protocol and trust boundaries

Private account 0 uses `m/44'/189189189'/0'/0'/n'` (receive) and `m/44'/189189189'/0'/1'/n'` (change). Standard accounts use a separate derivation library and path. BIP39 passphrases are not supported. Gap-limited discovery may miss assets outside the selected range.

Indexers see queried addresses and IPs. Output addresses, output amounts, nullifiers and timing are public. Batches settle separately and cannot be rolled back as one payment. Proofs and pinned identity checks do not make this wallet a light client.

The Planck indexer `https://sub2.quantus.com/v1/graphql` is referenced by the [official CLI](https://github.com/Quantus-Network/quantus-cli); its genesis and pinned checkpoint were compared with the configured Planck RPC. Mainnet uses `https://sqm.quantus.com/v1/graphql`. [Network evidence](verification/privacy-network-acceptance.json).
