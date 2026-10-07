import {deflateSync} from 'node:zlib';
import {writeFile} from 'node:fs/promises';
const poly = [[342,125],[159,125],[271,251],[159,387],[342,387],[342,336],[257,336],[334,251],[257,175],[342,175]];
function inside(x,y) {
  let value = false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const [xi,yi]=poly[i], [xj,yj]=poly[j];
    if ((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) value=!value;
  }
  return value;
}
function crc(data) {
  let c=0xffffffff;
  for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
  return (c^0xffffffff)>>>0;
}
function chunk(type,data) {
  const name=Buffer.from(type), size=Buffer.alloc(4), checksum=Buffer.alloc(4);
  size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([name,data])));
  return Buffer.concat([size,name,data,checksum]);
}
for(const size of [180,192,512]) {
  const raw=Buffer.alloc(size*(size*3+1));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let coverage=0;
    for(const dx of [.25,.75])for(const dy of [.25,.75])if(inside((x+dx)*512/size,(y+dy)*512/size))coverage+=.25;
    const p=y*(size*3+1)+1+x*3;
    raw[p]=Math.round(104+(255-104)*coverage);raw[p+1]=Math.round(97+(255-97)*coverage);raw[p+2]=Math.round(195+(255-195)*coverage);
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=2;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  await writeFile(`public/${size===180?'apple-touch-icon':`icon-${size}`}.png`,png);
}
