import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out='dist';
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
await fs.cp('public',out,{recursive:true});
await fs.copyFile('privacy-wasm/quantus_privacy_keys_bg.wasm',`${out}/quantus_privacy_keys_bg.wasm`);
await fs.copyFile('wasm/quantus_wasm_bg.wasm',`${out}/quantus_wasm_bg.wasm`);
await build({entryPoints:['src/popup.ts','src/crypto-worker.ts','src/privacy-keys-worker.ts','src/privacy-prover-worker.ts'],bundle:true,format:'esm',outdir:out,target:'chrome120',platform:'browser',minify:true,sourcemap:false,legalComments:'external',logLevel:'info'});
const wasm=await fs.readFile('wasm/quantus_wasm_bg.wasm');
await fs.writeFile(`${out}/BUILD_INFO.json`,JSON.stringify({version:'0.1.16',sourceCommit:(spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout??'').trim()||null,upstreamCommit:(await fs.readFile('vendor/quantus-wasm/UPSTREAM_COMMIT','utf8')).trim(),wasmSha256:createHash('sha256').update(wasm).digest('hex'),runtimePins:JSON.parse(await fs.readFile('src/core/networks.json','utf8'))},null,2));
await fs.mkdir('.preview',{recursive:true});await fs.cp(out,'.preview',{recursive:true});await fs.rm('.preview/manifest.json',{force:true});
await build({entryPoints:['src/preview.ts'],bundle:true,format:'esm',outfile:'.preview/preview.js',target:'chrome120',platform:'browser',minify:false,logLevel:'info'});
const html=await fs.readFile('public/popup.html','utf8');await fs.writeFile('.preview/index.html',html.replace('src="popup.js"','src="preview.js"'));
await fs.mkdir('dist/licenses',{recursive:true});await fs.copyFile('vendor/quantus-wasm/LICENSE','dist/licenses/Quantus-MIT.txt');
const lock=JSON.parse(await fs.readFile('package-lock.json','utf8'));const deps=Object.entries(lock.packages).filter(([k,v])=>k && !v.dev).map(([path,v])=>({path,version:v.version,license:v.license,integrity:v.integrity}));
await fs.writeFile('dist/licenses/dependencies.json',JSON.stringify(deps,null,2));
for(const [path] of Object.entries(lock.packages).filter(([k,v])=>k&&!v.dev)){
 const name=path.replaceAll('/','_');
 const files=await fs.readdir(path).catch(()=>[]);
 const license=files.find(n=>/^licen[cs]e(?:\.md|\.txt)?$/i.test(n));
 if(license)await fs.copyFile(`${path}/${license}`,`dist/licenses/${name}.txt`);
}

await fs.cp('reference/rust-licenses','dist/licenses/rust',{recursive:true});
await fs.cp('reference/privacy-rust-licenses','dist/licenses/privacy-rust',{recursive:true});
await fs.copyFile('verification/privacy-keys-build-info.json',`${out}/PRIVACY_BUILD_INFO.json`);
