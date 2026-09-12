// Development-only build. Not part of the extension until recovery and spending are validated.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir('.preview',{recursive:true});
await build({entryPoints:['src/privacy-keys-worker.ts'],bundle:true,format:'esm',platform:'browser',target:'chrome120',outfile:'.preview/privacy-keys-worker.js'});
await fs.copyFile('privacy-wasm/quantus_privacy_keys_bg.wasm','.preview/quantus_privacy_keys_bg.wasm');
await build({entryPoints:['tests/privacy-browser.ts'],bundle:true,format:'esm',platform:'browser',target:'chrome120',outfile:'.preview/privacy-browser.js'});
await fs.writeFile('.preview/privacy-tests.html','<!doctype html><html lang="en"><meta charset="utf-8"><title>Privacy recovery tests</title><h1>Privacy recovery — public fixtures only</h1><p>Public fixtures and official mainnet read queries. No user wallet or transactions.</p><h2>Running</h2><ol></ol><script type="module" src="privacy-browser.js"></script></html>');
await build({entryPoints:['src/privacy-prover-worker.ts'],bundle:true,format:'esm',platform:'browser',target:'chrome120',outfile:'.preview/privacy-prover-worker.js'});
