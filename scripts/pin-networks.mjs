// Run only after a human reviews a runtime upgrade. Never auto-update these pins in a release.
import fs from 'node:fs';
import crypto from 'node:crypto';
const endpoints = {planck: ['https://a1-planck.quantus.cat'], mainnet: ['https://rpc1-mainnet.quantus.com','https://rpc2-mainnet.quantus.com']};
const networks = {};
for (const id of ['planck', 'mainnet']) {
 const results = JSON.parse(fs.readFileSync(`reference/${id}-rpc.json`, 'utf8'));
 const get = n => results.find(r => r.id === n).result;
 const metadata = get(3);
 fs.mkdirSync('public/metadata', {recursive:true});
 fs.writeFileSync(`public/metadata/${id}.hex`, metadata);
 networks[id] = {id, name:id==='planck'?'Planck 测试网':'Quantus 主网', symbol:id==='planck'?'PLK':'QTC', endpoints:endpoints[id], genesis:get(1), specVersion:get(2).specVersion, transactionVersion:get(2).transactionVersion, metadataSha256:crypto.createHash('sha256').update(Buffer.from(metadata.slice(2),'hex')).digest('hex'), signing: id==='planck'};
}
fs.writeFileSync('src/core/networks.json',JSON.stringify(networks,null,2)+'\n');
