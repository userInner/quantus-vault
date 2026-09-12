# Audit status

**No independent audit has been completed.** Development self-review and automated checks are described in [VERIFICATION.md](VERIFICATION.md).

Review areas include authenticated local storage, worker lifecycle, metadata/network pinning, ordinary signing context, one-shot broadcasting, private commitment verification, proof/amount binding, atomic multi-batch reservations and recovery after interruption.

The ordinary signer uses the `QUANTUS_EXTRINSIC` signing context for runtime >=148 while retaining the existing standard-account derivation library. Private derivation/proving uses a separate pinned WASM module. See [PROVENANCE.md](PROVENANCE.md) and the source under `vendor/`.

Private broadcasting remains disabled. Funded Planck output/change/restoration tests and independent review are outstanding release gates.
