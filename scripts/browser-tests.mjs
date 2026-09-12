import {build}from'esbuild';import fs from'node:fs/promises';
await build({entryPoints:['tests/browser.ts'],bundle:true,format:'esm',outfile:'.preview/browser-tests.js',platform:'browser',target:'chrome120'});
await fs.writeFile('.preview/tests.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quantus Vault browser security tests</title></head><body><h1>Browser security verification</h1><p>Public test vectors only. No real secrets. No transaction broadcast.</p><h2 id="summary">Running tests…</h2><p id="live"></p><p id="fee"></p><p id="events"></p><ol id="results"></ol><script type="module" src="browser-tests.js"></script></body></html>');
await build({entryPoints:['tests/app-harness.ts'],bundle:true,format:'esm',outfile:'.preview/app-harness.js',platform:'browser',target:'chrome120'});
const source=await fs.readFile('public/popup.html','utf8');await fs.writeFile('.preview/app-test.html',source.replace('src="popup.js"','src="app-harness.js"').replace('<title>Quantus Vault</title>','<title>TEST FIXTURE · Quantus Vault · No broadcast</title>'));
await build({entryPoints:['tests/functional-harness.ts'],bundle:true,format:'esm',outfile:'.preview/functional-harness.js',platform:'browser',target:'chrome120'});
await fs.writeFile('.preview/functional.html',source.replace('src="popup.js"','src="functional-harness.js"').replace('<title>Quantus Vault</title>','<title>SIMULATED NETWORK · Wallet functional tests</title>'));

await build({entryPoints:['tests/lock-probe.ts'],bundle:true,format:'esm',outfile:'.preview/lock-probe.js',platform:'browser',target:'chrome120'});
