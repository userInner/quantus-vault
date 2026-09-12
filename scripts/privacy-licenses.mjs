import {spawnSync} from 'node:child_process';import fs from 'node:fs/promises';import path from 'node:path';
const result=spawnSync('cargo',['metadata','--locked','--offline','--format-version','1','--manifest-path','vendor/quantus-privacy-keys/Cargo.toml'],{encoding:'utf8'});if(result.status!==0)throw Error('Privacy dependency metadata unavailable');
const metadata=JSON.parse(result.stdout);const out='dist/licenses/privacy-rust';await fs.mkdir(out,{recursive:true});
const records=[];
for(const pkg of metadata.packages){
 const root=path.dirname(pkg.manifest_path);const names=await fs.readdir(root);
 const files=names.filter(n=>/^(license|copying)([-.].*)?$/i.test(n));
 for(const file of files){const src=path.join(root,file);if((await fs.stat(src)).isFile())await fs.copyFile(src,path.join(out,`${pkg.name}-${pkg.version}-${file}`));}
 records.push({name:pkg.name,version:pkg.version,license:pkg.license,source:pkg.source});
}
await fs.writeFile(path.join(out,'dependencies.json'),JSON.stringify(records,null,2));
