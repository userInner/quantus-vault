import {PNG} from 'pngjs';import fs from 'node:fs';
fs.mkdirSync('public/icons',{recursive:true});
for(const size of [16,32,48,128]){
 const png=new PNG({width:size,height:size});
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  let coverage=0;
  for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++){
   const px=(x+(sx+.5)/4)/size,py=(y+(sy+.5)/4)/size;
   const r=Math.hypot(px-.49,py-.46);
   const ring=Math.abs(r-.29)<.018||Math.abs(r-.20)<.009;
   const tail=px>.57&&px<.84&&Math.abs(py-px+.005)<.023;
   if(ring||tail)coverage++;
  }
  const t=coverage/16;const at=(y*size+x)*4;
  png.data[at]=12+(239-12)*t;png.data[at+1]=13+(132-13)*t;png.data[at+2]=12+(86-12)*t;png.data[at+3]=255;
 }
 fs.writeFileSync(`public/icons/${size}.png`,PNG.sync.write(png));
}
