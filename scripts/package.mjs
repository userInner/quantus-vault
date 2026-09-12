import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
function command(name,args){const result=spawnSync(name,args,{encoding:'utf8'});if(result.status!==0)throw Error(`${name} failed: ${result.stderr}`);return result.stdout;}
if(command('git',['status','--porcelain']).trim())throw Error('Commit source changes before packaging');
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const out=path.resolve('..'),dist=path.resolve('dist');
const manifest=JSON.parse(await fs.readFile('dist/manifest.json','utf8'));
if(manifest.version!==version)throw Error('Build/package versions do not match');
const info=JSON.parse(await fs.readFile('dist/BUILD_INFO.json','utf8'));
if(info.sourceCommit!==command('git',['rev-parse','HEAD']).trim())throw Error('Rebuild from the release commit before packaging');
for(const p of ['popup.html','popup.js','crypto-worker.js','privacy-keys-worker.js','privacy-prover-worker.js','quantus_privacy_keys_bg.wasm','quantus_wasm_bg.wasm','icons/16.png','icons/32.png','icons/48.png','icons/128.png','metadata/planck.hex','metadata/mainnet.hex'])await fs.access(path.join(dist,p));
const forbidden=['human snow truck virus','orchard answer curve patient','Browser TEST ONLY','correct horse cedar','<all_urls>'];
for(const p of ['popup.js','crypto-worker.js','privacy-keys-worker.js','privacy-prover-worker.js']){const source=await fs.readFile(path.join(dist,p),'utf8');for(const bad of forbidden)if(source.includes(bad))throw Error('Unexpected test content in release');}
if(manifest.permissions.join()!=='storage'||manifest.content_scripts||manifest.background||manifest.web_accessible_resources)throw Error('Unexpected permission or entrypoint');
if((await fs.readdir(dist)).some(p=>/preview|test|harness/.test(p)))throw Error('Development-only file in release');
for(const file of ['README.md','README.zh-CN.md','SECURITY.md','VERIFICATION.md','LICENSE','AUDIT.md','RELEASE-CHECK.md','PROVENANCE.md','PRIVACY-STATUS.md'])await fs.copyFile(file,path.join(dist,file));
const binary=`quantus-vault-extension-v${version}.zip`,source=`quantus-vault-source-v${version}.zip`;
command('python3',['-c',`from pathlib import Path
import zipfile,sys
root=Path('dist')
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED,strict_timestamps=False) as z:
 for p in sorted(root.rglob('*')):
  if p.is_file(): z.write(p,Path('quantus-vault-extension')/p.relative_to(root))
`,path.join(out,binary)]);
command('git',['archive','--format=zip','--prefix=quantus-vault-source/',`--output=${path.join(out,source)}`,'HEAD']);
const sums=[];
for(const name of [binary,source]){const bytes=await fs.readFile(path.join(out,name));sums.push(createHash('sha256').update(bytes).digest('hex')+'  '+name);console.log(name,bytes.length,'bytes');}
await fs.writeFile(path.join(out,'SHA256SUMS.txt'),sums.join('\n')+'\n');
console.log('Release files built from committed source.');
