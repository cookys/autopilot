#!/usr/bin/env node
// docs/assets flow-diagram generator — the four flow*.svg variants are GENERATED;
// edit THIS file and re-run (node docs/assets/flow.gen.js) instead of hand-editing the SVGs.
// Generate docs/assets/flow{,.light,.zh-TW,.zh-TW.light}.svg from one layout.
const fs = require('fs');

const PLANE = `<g transform="translate(6 -6) rotate(45 32 32)">
<path d="M27 57 L23 63" stroke="#A5B4FC" stroke-width="3.4" stroke-linecap="round" fill="none"/>
<path d="M32 57.5 L32 65" stroke="#F5A524" stroke-width="3.6" stroke-linecap="round" fill="none"/>
<path d="M37 57 L41 63" stroke="#818CF8" stroke-width="3.4" stroke-linecap="round" fill="none"/>
<path fill="__PLANEFILL__" fill-rule="evenodd" d="M32 8 L36 18 L36 24 L54 40 L54 44 L36 36 L35 46 L45 54 L45 57 L34 52 L33.5 55 L30.5 55 L30 52 L19 57 L19 54 L29 46 L28 36 L10 44 L10 40 L28 24 L28 18 Z M30.5 15 L33.5 15 L33.5 20 L30.5 20 Z"/>
</g>`;

const DARK = {
  bgA:'#1b2340', bgB:'#0d1322', bgC:'#07090f', grid:'#334155', gridOp:0.14,
  panelBad:'rgba(248,113,113,0.05)', panelBadStroke:'rgba(248,113,113,0.35)',
  panelGood:'rgba(52,211,153,0.04)', panelGoodStroke:'rgba(52,211,153,0.30)',
  card:'#0f1524', text:'#e6ebf5', sub:'#94a3b8',
  red:'#f87171', redText:'#fca5a5',
  green:'#34d399', greenText:'#6ee7b7',
  amber:'#f5a524', amberText:'#fbbf24',
  indigo:'#818cf8', neutral:'#3b4a6b', planeFill:'#C5CDDC'
};
const LIGHT = {
  bgA:'#eef2f9', bgB:'#f6f8fc', bgC:'#ffffff', grid:'#64748b', gridOp:0.12,
  panelBad:'#fff5f5', panelBadStroke:'#fecaca',
  panelGood:'#f4fbf8', panelGoodStroke:'#a7f3d0',
  card:'#ffffff', text:'#0f172a', sub:'#64748b',
  red:'#dc2626', redText:'#b91c1c',
  green:'#059669', greenText:'#047857',
  amber:'#d97706', amberText:'#b45309',
  indigo:'#4f46e5', neutral:'#cbd5e1', planeFill:'#475569'
};

const EN = {
  title:'A Day with Autopilot',
  badTitle:'Without Autopilot — always on',
  bad:[
    ['Developer request','e.g., “Add WebSocket compression”'],
    ['Greps & rewrites immediately','No design — straight into the source'],
    ['No plan, no branches','No phases, no isolation'],
    ['No quality gates','Tests and review fully bypassed'],
    ['Edge cases missed, CI fails','Bugs and maintenance debt land on you']
  ],
  badFoot:'You are the full-time reviewer.',
  goodTitle:'With Autopilot — the system stays in the chair',
  req:['Developer request','e.g., “Add WebSocket compression”'],
  front:['dev-flow — the front door','Sizes the task, routes the work'],
  laneA:'Small task · fast lane', laneB:'Large project · plan + branch',
  a1:['Implement directly','Fast, precise, targeted edits'],
  a2:['Pass the quality gate','Automated tests + code review'],
  a3:['Commit & merge','Clean, complete history'],
  b1:['Project init & plan','Dev plan drafted, progress tracked'],
  b2:['Phase-by-phase build','Every phase passes its gate'],
  b3:['Archive & learn','Close out, document the lessons'],
  s1:['Research','survey'], s2:['Strategy','think-tank'],
  fin:['finish-flow — clean close','Standard closeout, nothing skipped'],
  done:['Merged','Clean codebase, stable system']
};
const ZH = {
  title:'Autopilot 的一天',
  badTitle:'沒有 Autopilot——人一直在場',
  bad:[
    ['開發者需求','例：「加上 WebSocket 壓縮」'],
    ['立刻 grep、立刻改 code','沒有設計，直接進 source'],
    ['沒計畫、沒分支','沒有階段、沒有隔離'],
    ['沒有 quality gate','測試與審查全部跳過'],
    ['漏掉 edge case、CI 掛掉','bug 跟維護債全落在你身上']
  ],
  badFoot:'你就是那個全職 reviewer。',
  goodTitle:'有 Autopilot——系統一直在場',
  req:['開發者需求','例：「加上 WebSocket 壓縮」'],
  front:['dev-flow——前門','判斷大小、分流工作'],
  laneA:'小任務 · 快車道', laneB:'大專案 · 計畫＋分支',
  a1:['直接實作','快而準的小範圍修改'],
  a2:['過 quality gate','自動測試＋code review'],
  a3:['commit 併 merge','乾淨完整的歷史'],
  b1:['立案＋寫計畫','起 dev plan、開始追蹤'],
  b2:['分階段實作','每個階段都過 gate'],
  b3:['歸檔＋記取教訓','收專案、留下文件'],
  s1:['調研','survey'], s2:['策略','think-tank'],
  fin:['finish-flow——乾淨收尾','標準收尾，一步不漏'],
  done:['合併完成','乾淨 codebase、穩定系統']
};

function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}

function card(x,y,w,h,accent,P,title,sub,subColor){
  return `<g>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${P.card}" stroke="${accent}" stroke-opacity="0.55" stroke-width="1.2"/>
<rect x="${x}" y="${y+8}" width="3" height="${h-16}" rx="1.5" fill="${accent}" fill-opacity="0.8"/>
<text x="${x+w/2}" y="${y+24}" text-anchor="middle" class="t">${esc(title)}</text>
<text x="${x+w/2}" y="${y+43}" text-anchor="middle" class="s"${subColor?` fill="${subColor}"`:''}>${esc(sub)}</text>
</g>`;
}
function link(x1,y1,x2,y2,color){
  return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${color}" stroke-opacity="0.6" stroke-width="1.6" stroke-dasharray="2 7" stroke-linecap="round" fill="none"/>`;
}

function gen(S,P){
  const W=1200,H=1000;
  // bad column geometry
  const bx=48,bw=304, bcx=bx+bw/2;
  const badYs=[150,290,430,570,710];
  // good panel
  const gx=384,gw=768;
  const laneAx=470,laneBx=760,laneW=250; // lane card left x
  const laneAcx=laneAx+laneW/2, laneBcx=laneBx+laneW/2, gcx=gx+gw/2;
  let s='';
  s+=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="title desc">
<title id="title">${esc(S.title)}</title>
<desc id="desc">${esc(S.badTitle)} vs ${esc(S.goodTitle)}</desc>
<defs>
<radialGradient id="glow" cx="70%" cy="12%" r="95%">
<stop offset="0%" stop-color="${P.bgA}"/><stop offset="55%" stop-color="${P.bgB}"/><stop offset="100%" stop-color="${P.bgC}"/>
</radialGradient>
<pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
<path d="M44 0H0V44" fill="none" stroke="${P.grid}" stroke-opacity="${P.gridOp}" stroke-width="1"/>
</pattern>
<style>
.w { font: 700 24px "Segoe UI","Helvetica Neue",Arial,"Noto Sans TC",sans-serif; fill: ${P.text}; }
.pt { font: 700 15px "Segoe UI","Helvetica Neue",Arial,"Noto Sans TC",sans-serif; }
.t { font: 700 14.5px "Segoe UI","Helvetica Neue",Arial,"Noto Sans TC",sans-serif; fill: ${P.text}; }
.s { font: 500 11.5px "Segoe UI","Helvetica Neue",Arial,"Noto Sans TC",sans-serif; fill: ${P.sub}; }
.lane { font: 700 13px "Segoe UI","Helvetica Neue",Arial,"Noto Sans TC",sans-serif; }
.foot { font: 600 13px "Segoe UI","Helvetica Neue",Arial,"Noto Sans TC",sans-serif; fill: ${P.redText}; }
</style>
</defs>
<rect width="${W}" height="${H}" rx="18" fill="url(#glow)"/>
<rect width="${W}" height="${H}" rx="18" fill="url(#grid)"/>
<g transform="translate(486 18) scale(0.62)">${PLANE.replace('__PLANEFILL__',P.planeFill)}</g>
<text x="540" y="48" class="w">${esc(S.title)}</text>`;

  // ---- bad panel
  s+=`<rect x="${bx-16}" y="84" width="${bw+32}" height="856" rx="14" fill="${P.panelBad}" stroke="${P.panelBadStroke}" stroke-width="1.2"/>`;
  s+=`<text x="${bcx}" y="118" text-anchor="middle" class="pt" fill="${P.redText}">${esc(S.badTitle)}</text>`;
  S.bad.forEach((c,i)=>{
    const y=badYs[i];
    s+=card(bx,y,bw,58,P.red,P,c[0],c[1]);
    if(i<S.bad.length-1) s+=link(bcx,y+58,bcx,badYs[i+1],P.red);
  });
  s+=`<text x="${bcx}" y="836" text-anchor="middle" class="foot">${esc(S.badFoot)}</text>`;
  s+=`<text x="${bcx}" y="862" text-anchor="middle" style="font-size:20px" fill="${P.red}">&#8635;</text>`;

  // ---- good panel
  s+=`<rect x="${gx-16}" y="84" width="${gw+32}" height="856" rx="14" fill="${P.panelGood}" stroke="${P.panelGoodStroke}" stroke-width="1.2"/>`;
  s+=`<text x="${gcx}" y="118" text-anchor="middle" class="pt" fill="${P.greenText}">${esc(S.goodTitle)}</text>`;
  // request (neutral)
  s+=card(gcx-170,150,340,58,P.neutral,P,S.req[0],S.req[1]);
  s+=link(gcx,208,gcx,242,P.green);
  // dev-flow front door (amber, brand decision node)
  s+=card(gcx-190,242,380,58,P.amber,P,S.front[0],S.front[1],P.amberText);
  // lane split
  s+=link(gcx-60,300,laneAcx,344,P.green);
  s+=link(gcx+60,300,laneBcx,344,P.green);
  s+=`<text x="${laneAcx}" y="336" text-anchor="middle" class="lane" fill="${P.greenText}">${esc(S.laneA)}</text>`;
  s+=`<text x="${laneBcx}" y="336" text-anchor="middle" class="lane" fill="${P.indigo}">${esc(S.laneB)}</text>`;
  const ys=[352,470,588];
  const A=[S.a1,S.a2,S.a3], B=[S.b1,S.b2,S.b3];
  A.forEach((c,i)=>{ s+=card(laneAx,ys[i],laneW,58,P.green,P,c[0],c[1]);
    if(i<2) s+=link(laneAcx,ys[i]+58,laneAcx,ys[i+1],P.green); });
  B.forEach((c,i)=>{ s+=card(laneBx,ys[i],laneW,58,P.green,P,c[0],c[1]);
    if(i<2) s+=link(laneBcx,ys[i]+58,laneBcx,ys[i+1],P.green); });
  // diverge side cards (amber dashed)
  const sx=1046, sw=118;
  [[S.s1,436],[S.s2,516]].forEach(([c,y])=>{
    s+=`<g>
<rect x="${sx}" y="${y}" width="${sw}" height="52" rx="10" fill="${P.card}" stroke="${P.amber}" stroke-opacity="0.6" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="${sx+sw/2}" y="${y+22}" text-anchor="middle" class="t" fill="${P.amberText}">${esc(c[0])}</text>
<text x="${sx+sw/2}" y="${y+39}" text-anchor="middle" class="s">${esc(c[1])}</text>
</g>`;
  });
  s+=`<path d="M${laneBx+laneW} 499 C ${sx-14} 480, ${sx-14} 470, ${sx} 462" stroke="${P.amber}" stroke-opacity="0.55" stroke-width="1.4" fill="none" stroke-dasharray="2 6"/>`;
  s+=`<path d="M${laneBx+laneW} 499 C ${sx-14} 518, ${sx-14} 528, ${sx} 538" stroke="${P.amber}" stroke-opacity="0.55" stroke-width="1.4" fill="none" stroke-dasharray="2 6"/>`;
  // converge to finish-flow
  s+=link(laneAcx,ys[2]+58,gcx-40,730,P.green);
  s+=link(laneBcx,ys[2]+58,gcx+40,730,P.green);
  s+=card(gcx-190,730,380,58,P.green,P,S.fin[0],S.fin[1]);
  s+=link(gcx,788,gcx,822,P.green);
  // done
  s+=`<g>
<rect x="${gcx-150}" y="822" width="300" height="58" rx="10" fill="${P.green}" fill-opacity="0.12" stroke="${P.green}" stroke-width="1.4"/>
<text x="${gcx}" y="846" text-anchor="middle" class="t" fill="${P.greenText}">&#10003; ${esc(S.done[0])}</text>
<text x="${gcx}" y="865" text-anchor="middle" class="s">${esc(S.done[1])}</text>
</g>`;
  // small plane flying along the good panel top-right
  s+=`<path d="M900 108 C 980 96, 1040 116, 1108 100" stroke="${P.neutral}" stroke-width="1.4" stroke-dasharray="2 8" fill="none" opacity="0.8"/>`;
  s+=`<g transform="translate(1096 74) scale(0.55)">${PLANE.replace('__PLANEFILL__',P.planeFill)}</g>`;
  s+='</svg>\n';
  return s;
}

const out = {
  'flow.svg': gen(EN,DARK),
  'flow.light.svg': gen(EN,LIGHT),
  'flow.zh-TW.svg': gen(ZH,DARK),
  'flow.zh-TW.light.svg': gen(ZH,LIGHT),
};
for (const [f,c] of Object.entries(out)) fs.writeFileSync(`/home/cookys/projects/autopilot/docs/assets/${f}`, c);
console.log('wrote', Object.keys(out).join(', '));
