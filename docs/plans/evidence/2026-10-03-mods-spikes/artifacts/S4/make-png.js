// Dependency-free PNG encoder (zlib + CRC32). Writes assets/probe.png: 96x64 RGB, 4 colour quadrants + diagonal white line.
const zlib=require('zlib'),fs=require('fs'),path=require('path');
const W=96,H=64;const raw=Buffer.alloc((W*3+1)*H);
for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;for(let x=0;x<W;x++){
  let c=[x<W/2?(y<H/2?[220,40,40]:[40,200,60]):(y<H/2?[40,80,230]:[240,200,30])][0];
  if(Math.abs(x*H/W-y)<1.2)c=[255,255,255];
  const o=y*(W*3+1)+1+x*3;raw[o]=c[0];raw[o+1]=c[1];raw[o+2]=c[2];}}
const crcT=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc=b=>{let c=~0;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return ~c>>>0};
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname,'assets','probe.png'),png);console.log('wrote',png.length,'bytes');
