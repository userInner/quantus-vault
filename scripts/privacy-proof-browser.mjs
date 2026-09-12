import {build} from 'esbuild';import fs from 'node:fs/promises';
for(const name of ['privacy-proof','privacy-transfer','privacy-planck']){
 await build({entryPoints:[`tests/${name}-browser.ts`],bundle:true,format:'esm',outfile:`.preview/${name}-browser.js`,platform:'browser',target:'chrome120'});
 await fs.writeFile(`.preview/${name}.html`,`<!doctype html><meta charset="utf-8"><title>Public ${name} verification</title><h1>Browser ${name} — ${name==='privacy-planck'?'live read-only chain':'synthetic chain'}, no funds</h1><p id="result">Starting…</p><script type="module" src="${name}-browser.js"></script>`);
}
