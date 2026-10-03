// Plausible gantt: 40 rows, label column + bar track + axis ticks + per-bar duration text + <title> tooltips (interactive-ready).
function gantt(rows,{rowH=22,labelW=220,trackW=640,pad=8}={}){
  const H=pad*2+24+rows*rowH, W=labelW+trackW+pad*2+60;
  let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif" font-size="11">`;
  s+=`<rect width="${W}" height="${H}" fill="#fff"/>`;
  for(let t=0;t<=10;t++){const x=pad+labelW+t*trackW/10;s+=`<line x1="${x}" y1="${pad+16}" x2="${x}" y2="${H-pad}" stroke="#ddd"/><text x="${x}" y="${pad+10}" text-anchor="middle" fill="#555">${t*6}m</text>`;}
  for(let i=0;i<rows;i++){
    const y=pad+24+i*rowH, start=(i*7)%50, dur=3+(i*5)%9, x=pad+labelW+start*trackW/60, w=dur*trackW/60;
    const label=`l5-foreman-${String(i).padStart(2,'0')} hands/sonnet`;
    s+=`<text x="${pad}" y="${y+14}" fill="#222">${label}</text>`;
    s+=`<rect x="${x.toFixed(1)}" y="${y+3}" width="${w.toFixed(1)}" height="${rowH-8}" rx="3" fill="${i%3?'#4a90d9':'#d9822b'}"><title>${label} ${start}m +${dur}m rc=0</title></rect>`;
    s+=`<text x="${(x+w+4).toFixed(1)}" y="${y+14}" fill="#555">${dur}m</text>`;
  }
  return s+'</svg>';
}
const CAP=131072;
for(const n of [10,20,40,80,160,320,640,1000]) console.log(n,'rows ->',gantt(n).length,'chars',(gantt(n).length/CAP*100).toFixed(1)+'% of cap');
let lo=1;while(gantt(lo+1).length<=CAP)lo++;
console.log('max rows fitting under',CAP,'=',lo,'(len',gantt(lo).length,') ; first over =',lo+1,gantt(lo+1).length);
console.log('per-row chars (40 vs 41 delta):',gantt(41).length-gantt(40).length);
console.log('40-row margin: ',CAP-gantt(40).length,'chars free;',(CAP/gantt(40).length).toFixed(1)+'x headroom');
require('fs').writeFileSync('gantt40.svg',gantt(40));
