# Release procedure

1. Update package/manifest/UI versions together and document enabled versus disabled functionality.
2. Run `npm ci`, `npm run check`, `npm test` and `npm run build` from a clean source checkout. Rerun relevant browser/native tests for runtime or cryptographic changes.
3. Review tracked files for secrets, private data, local paths, generated build directories and third-party redistribution rights. Keep dependency licenses intact.
4. Commit the source. Build from that commit, then run `node scripts/package.mjs`. The script refuses a dirty checkout and archives only committed source.
5. Publish the extension ZIP, source ZIP and SHA256SUMS.txt with the corresponding Git tag. Verify the uploaded bytes and required extension files after download.

The installable archive must contain `quantus-vault-extension/manifest.json`; GitHub's automatic source downloads are not extension builds. A release must state that private broadcasting is disabled until funded acceptance and review are complete.
