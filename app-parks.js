/* National Parks scratch-off tracker — map redesign (national overview + state view + gesture scratch) */
(function(){
"use strict";
const PARKS=window.PARKS, REGIONS=window.REGIONS, TIERS=window.TIERS, STATES=window.STATES, PSF=window.PARK_STATE_FALLBACK||{};
const subtle=(window.crypto&&window.crypto.subtle)||null;
const enc=new TextEncoder(), dec=new TextDecoder();
const LS='np_v1';
const $=s=>document.querySelector(s);
const el=(t,c)=>{const e=document.createElement(t);if(c)e.className=c;return e;};

/* ---------- base64 ---------- */
function abToB64(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s);}
function b64ToBytes(b64){const s=atob(b64);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;}
function strToB64url(str){const u=enc.encode(str);let s='';for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function b64urlToStr(b){b=b.replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';const s=atob(b);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return dec.decode(u);}

/* ---------- crypto ---------- */
async function deriveAes(pass,saltBytes){const base=await subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);return subtle.deriveKey({name:'PBKDF2',salt:saltBytes,iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function fingerprint(jwk){const h=await subtle.digest('SHA-256',enc.encode(jwk.x+'.'+jwk.y));const b=new Uint8Array(h);const A='0123456789ABCDEFGHJKMNPQRSTVWXYZ';let out='';for(let i=0;i<6;i++)out+=A[b[i]%32];return 'NP-'+out.slice(0,3)+'-'+out.slice(3);}
async function createIdentity(pass){const kp=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const pub=await subtle.exportKey('jwk',kp.publicKey);const priv=await subtle.exportKey('pkcs8',kp.privateKey);const salt=crypto.getRandomValues(new Uint8Array(16));const iv=crypto.getRandomValues(new Uint8Array(12));const aes=await deriveAes(pass,salt);const ct=await subtle.encrypt({name:'AES-GCM',iv},aes,priv);return {salt:abToB64(salt),iv:abToB64(iv),enc:abToB64(ct),pub,fp:await fingerprint(pub)};}
async function unlockPriv(pass,idn){const aes=await deriveAes(pass,b64ToBytes(idn.salt));const pkcs8=await subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(idn.iv)},aes,b64ToBytes(idn.enc));return subtle.importKey('pkcs8',pkcs8,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);}
async function importPub(jwk){return subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}
function msgOf(id,date,note){return enc.encode(id+'|'+date+'|'+(note||''));}
async function signRec(priv,id,date,note){const sig=await subtle.sign({name:'ECDSA',hash:'SHA-256'},priv,msgOf(id,date,note));return abToB64(sig);}
async function verifyRec(pub,id,date,note,sigB64){try{return await subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,b64ToBytes(sigB64),msgOf(id,date,note));}catch(e){return false;}}

/* ---------- state ---------- */
let S={idn:null,recs:{}}, SHARE=false, PUBKEY=null, PRIV=null, VALID={}, curRegion=null, MODE='nation';
function loadLS(){try{const r=JSON.parse(localStorage.getItem(LS));if(r&&typeof r==='object')S={idn:r.idn||null,recs:r.recs||{}};}catch(e){}}
function saveLS(){try{localStorage.setItem(LS,JSON.stringify(S));}catch(e){}}
async function parseShare(){const m=location.hash.match(/share=([^&]+)/);if(!m)return false;try{const data=JSON.parse(b64urlToStr(m[1]));if(!data||!data.pub)return false;S={idn:{pub:data.pub,fp:data.fp||(await fingerprint(data.pub))},recs:data.recs||{}};SHARE=true;return true;}catch(e){return false;}}
async function verifyAll(){VALID={};if(!S.idn||!S.idn.pub){PUBKEY=null;return;}PUBKEY=await importPub(S.idn.pub);for(const id in S.recs){const r=S.recs[id];VALID[id]=await verifyRec(PUBKEY,id,r.d,r.n,r.s);}}
const isVisited=id=>!!(S.recs[id]&&VALID[id]===true);
const isTamper=id=>!!(S.recs[id]&&VALID[id]===false);
const visitedCount=()=>PARKS.reduce((n,p)=>n+(isVisited(p.id)?1:0),0);

/* ---------- park <-> state ---------- */
const ABBR2NAME={},NAME2STATE={};STATES.forEach(s=>{ABBR2NAME[s.ab]=s.name;NAME2STATE[s.name]=s;});
const USGS_OVR={hawaii:'Volcanoes National Park',haleakala:'Haleakala National Park',wrangell:'Wrangell',samoa:'American Samoa',virginislands:'Virgin Islands National Park'};
PARKS.forEach(p=>{p._terr=(p.id==='virginislands'||p.id==='samoa');let ab=PSF[p.id];if(!ab){const m=p.st.match(/([A-Z]{2})\s*$/);ab=m?m[1]:null;}p._ab=ab;p._state=ab?ABBR2NAME[ab]:null;p._usgs=USGS_OVR[p.id]||(p.en+' National Park');});
const parksInState=name=>PARKS.filter(p=>p._state===name);

/* ---------- progress / tiers / regions ---------- */
function tierOf(n){for(const[t,name]of TIERS)if(n>=t)return name;return '未启程';}
function renderProgress(){const n=visitedCount();$('#cnt').textContent=n;$('#tier').textContent=tierOf(n);$('#fill').style.width=Math.round(n/PARKS.length*100)+'%';$('#pct').textContent=Math.round(n/PARKS.length*100)+'%';const states=new Set();PARKS.forEach(p=>{if(isVisited(p.id)&&p._state)states.add(p._state);});$('#states').textContent=states.size;let latest='';PARKS.forEach(p=>{if(isVisited(p.id)){const d=S.recs[p.id].d;if(d>latest)latest=d;}});$('#latest').textContent=latest?('最近 '+latest):'';}
function renderRegions(){const host=$('#regions');host.innerHTML='';REGIONS.forEach(rg=>{const tot=PARKS.filter(p=>p.rg===rg).length;const got=PARKS.filter(p=>p.rg===rg&&isVisited(p.id)).length;const c=el('div','chip'+(curRegion===rg?' on':''));c.innerHTML=rg+' <b>'+got+'</b>/'+tot;c.onclick=()=>{curRegion=curRegion===rg?null:rg;renderRegions();paintNational();};host.appendChild(c);});}

/* ---------- sound + haptics ---------- */
let AC=null, SOUND=localStorage.getItem('np_sound')!=='0';
function ensureAudio(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}if(AC&&AC.state==='suspended')AC.resume();}
function sfxScratch(){if(!SOUND||!AC)return;const t=AC.currentTime,len=Math.floor(AC.sampleRate*0.05);const b=AC.createBuffer(1,len,AC.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*0.5;const s=AC.createBufferSource();s.buffer=b;const f=AC.createBiquadFilter();f.type='highpass';f.frequency.value=2600;const g=AC.createGain();g.gain.setValueAtTime(0.16,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.06);s.connect(f);f.connect(g);g.connect(AC.destination);s.start(t);}
function sfxDing(){if(!SOUND||!AC)return;const t=AC.currentTime;[660,990,1320].forEach((fr,i)=>{const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.value=fr;const ts=t+i*0.08;g.gain.setValueAtTime(0.0001,ts);g.gain.exponentialRampToValueAtTime(0.2,ts+0.02);g.gain.exponentialRampToValueAtTime(0.0001,ts+0.5);o.connect(g);g.connect(AC.destination);o.start(ts);o.stop(ts+0.55);});}
function buzz(p){if(SOUND&&navigator.vibrate){try{navigator.vibrate(p);}catch(e){}}}
$('#btnSound').textContent=SOUND?'🔊':'🔇';
$('#btnSound').onclick=()=>{SOUND=!SOUND;localStorage.setItem('np_sound',SOUND?'1':'0');$('#btnSound').textContent=SOUND?'🔊':'🔇';if(SOUND){ensureAudio();sfxDing();}};

/* ---------- boundary fetch (USGS National Map) ---------- */
const BCACHE={};
async function fetchBoundary(p){
  if(p._terr)return null;if(BCACHE[p.id]!==undefined)return BCACHE[p.id];
  const base='https://cartowfs.nationalmap.gov/arcgis/rest/services/govunits/MapServer/23/query?';
  const url=base+'where='+encodeURIComponent("name LIKE '%"+p._usgs.replace(/'/g,"''")+"%'")+'&outFields=name&maxAllowableOffset=0.002&geometryPrecision=4&returnGeometry=true&outSR=4326&f=geojson';
  try{const r=await fetch(url);const j=await r.json();if(j&&j.features&&j.features.length){BCACHE[p.id]={type:'FeatureCollection',features:j.features};return BCACHE[p.id];}}catch(e){}
  BCACHE[p.id]=null;return null;
}

/* ---------- national overview ---------- */
let usFeatures=null, stateEls={}, markEls={};
async function buildNational(){
  const host=$('#mapHost');
  if(!window.d3||!window.topojson)return buildListFallback('地图组件未能加载，已切换到列表模式。');
  let us;try{us=window.__US||(window.__US=await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'));}catch(e){return buildListFallback('地图数据加载失败（可能离线），已切换到列表模式。');}
  const W=960,H=600;host.innerHTML='';
  const svg=d3.select(host).append('svg').attr('id','map').attr('viewBox','0 0 '+W+' '+H);
  const fc=topojson.feature(us,us.objects.states);usFeatures=fc.features;
  const proj=d3.geoAlbersUsa().fitSize([W-16,H-46],fc);const path=d3.geoPath(proj);
  stateEls={};markEls={};
  // states
  svg.append('g').selectAll('path').data(fc.features).join('path')
    .attr('d',path).attr('class','state').attr('data-name',d=>d.properties.name)
    .each(function(d){const name=d.properties.name;if(NAME2STATE[name]){d3.select(this).classed('clickable',true).on('click',()=>enterState(name));stateEls[name]=this;}});
  // labels: state abbr only (mascot is shown in the state view)
  const lg=svg.append('g');
  fc.features.forEach(d=>{const st=NAME2STATE[d.properties.name];if(!st)return;const c=path.centroid(d);if(!c||isNaN(c[0]))return;lg.append('text').attr('class','ab').attr('x',c[0]).attr('y',c[1]+3).text(st.ab);});
  // territory inset
  const tb={x:792,y:486,w:152,h:92};
  svg.append('rect').attr('x',tb.x).attr('y',tb.y).attr('width',tb.w).attr('height',tb.h).attr('rx',8).attr('fill','#0e2734').attr('stroke','#23495a').attr('stroke-width',.8);
  svg.append('text').attr('x',tb.x+tb.w/2).attr('y',tb.y+15).attr('text-anchor','middle').attr('fill','#5d8794').attr('font-size','10').text('海外属地');
  const terr={virginislands:[tb.x+46,tb.y+58],samoa:[tb.x+106,tb.y+58]};
  // park markers
  const mg=svg.append('g');
  PARKS.forEach(p=>{let xy=p._terr?terr[p.id]:proj([p.lng,p.lat]);if(!xy)return;const t=mg.append('text').attr('class','pmark').attr('x',xy[0]).attr('y',xy[1]+4).text(p.em).on('click',(ev)=>{ev.stopPropagation();if(p._terr)openInfo(p);else if(p._state)enterState(p._state);});markEls[p.id]=t.node();});
  paintNational();
}
function paintNational(){
  // state tint by progress
  for(const name in stateEls){const ps=parksInState(name);const done=ps.filter(p=>isVisited(p.id)).length;const cls=done===0?'':(done===ps.length?'done':'lit');const e=stateEls[name];e.classList.remove('has','lit','done');if(ps.length&&done===0)e.classList.add('has');else if(cls)e.classList.add(cls);}
  // park markers
  PARKS.forEach(p=>{const m=markEls[p.id];if(!m)return;m.classList.toggle('lit',isVisited(p.id));m.style.opacity=(!curRegion||curRegion===p.rg)?'':'0.25';});
}
function buildListFallback(msg){const host=$('#mapHost');host.innerHTML='<div class="maperr">'+(msg||'')+'</div>';const grid=el('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;padding:6px 12px 14px';PARKS.forEach(p=>{const c=el('div');c.style.cssText='background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;cursor:pointer;font-size:12px';const vis=isVisited(p.id);c.innerHTML='<div style="font-size:18px">'+(vis?p.em:'▢')+'</div><b style="color:'+(vis?'#e7c06a':'#eaf2f0')+'">'+p.zh+'</b><div style="color:#8fb3b0">'+p.st+(vis?' ✓':'')+'</div>';c.onclick=()=>openInfo(p,true);grid.appendChild(c);});host.appendChild(grid);}

/* ---------- state view ---------- */
function setMode(m){MODE=m;$('#nationalView').style.display=m==='nation'?'':'none';$('#stateView').style.display=m==='state'?'block':'none';$('#regions').style.display=m==='nation'?'':'none';$('#hintbar').textContent=m==='nation'?'👆 点一个州放大，进去用手指刮开公园':'👆 用手指刮开公园轮廓 → 灰色变彩色即打卡';}
function backToNation(){setMode('nation');paintNational();renderProgress();window.scrollTo(0,0);}
function enterState(name){
  const st=NAME2STATE[name];const feat=usFeatures&&usFeatures.find(f=>f.properties.name===name);
  const ps=parksInState(name);
  const host=$('#stateView');host.innerHTML='';
  const head=el('div','sv-head');
  head.innerHTML='<button class="sv-back">‹ 全美</button><div class="sv-mascot">'+(st?st.m:'📍')+'</div><div class="sv-title">'+(st?st.zh:name)+'<small>'+name+'</small></div><div class="sv-sub"><b id="svDone">'+ps.filter(p=>isVisited(p.id)).length+'</b>/'+ps.length+' 座<br>已点亮</div>';
  host.appendChild(head);head.querySelector('.sv-back').onclick=backToNation;
  const stage=el('div','sv-stage');host.appendChild(stage);
  setMode('state');window.scrollTo(0,0);
  if(!ps.length){stage.innerHTML='<div class="sv-emptly"><div class="big2">'+(st?st.m:'🗺️')+'</div><div style="margin-top:8px">'+(st?st.zh:name)+'目前还没有国家公园</div><div style="font-size:12px;margin-top:4px">换个州试试 →</div></div>';return;}
  // measure then render backdrop + medallions
  setTimeout(()=>{
    const W=Math.max(280,stage.clientWidth||340);const Hs=Math.round(W*0.62);stage.style.minHeight=Hs+'px';
    let proj=null;
    if(window.d3&&feat){const svg=d3.select(stage).append('svg').attr('class','sv-bg').attr('viewBox','0 0 '+W+' '+Hs).style('width','100%').style('height',Hs+'px');proj=d3.geoMercator().fitExtent([[24,20],[W-24,Hs-20]],feat);svg.append('path').attr('d',d3.geoPath(proj)(feat));}
    // positions
    const pts=ps.map(p=>{let xy=proj?proj([p.lng,p.lat]):null;if(!xy)xy=[W/2,Hs/2];return {p,x:xy[0],y:xy[1]};});
    const FIG=ps.length>4?94:118;
    relax(pts,FIG*0.84,W,Hs);
    pts.forEach(pt=>{const ph=el('div','park-fig');ph.style.left=pt.x+'px';ph.style.top=pt.y+'px';ph.innerHTML='<div style="width:'+FIG+'px;height:'+FIG+'px;border-radius:50%;background:#143240;margin:0 auto"></div>';stage.appendChild(ph);fetchBoundary(pt.p).then(fc=>{ph.replaceWith(fc?makeFigure(pt.p,pt.x,pt.y,FIG,fc):makeMedallion(pt.p,pt.x,pt.y,ps.length>4));}).catch(()=>{ph.replaceWith(makeMedallion(pt.p,pt.x,pt.y,ps.length>4));});});
    const tip=el('div','scratch-tip');tip.textContent=PRIV||SHARE?'用手指刮开公园轮廓':'刮开时会让你输入口令解锁';stage.appendChild(tip);
  },30);
}
function relax(pts,mind,W,H){for(let it=0;it<60;it++){let moved=false;for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){const a=pts[i],b=pts[j];let dx=b.x-a.x,dy=b.y-a.y;let d=Math.hypot(dx,dy)||.01;if(d<mind){const push=(mind-d)/2;dx/=d;dy/=d;a.x-=dx*push;a.y-=dy*push;b.x+=dx*push;b.y+=dy*push;moved=true;}}for(const pt of pts){pt.x=Math.max(40,Math.min(W-40,pt.x));pt.y=Math.max(34,Math.min(H-40,pt.y));}if(!moved)break;}}

/* ---------- scratch core (clipped, sound, haptics) ---------- */
function countFoil(ctx,cv){const im=ctx.getImageData(0,0,cv.width,cv.height).data;let c=0;const step=Math.max(2,Math.floor(cv.width/18));for(let y=0;y<cv.height;y+=step)for(let x=0;x<cv.width;x+=step){if(im[(y*cv.width+x)*4+3]>=128)c++;}return c;}
function circlePath(size){const r=size/2-1,c=size/2;return 'M '+c+' '+(c-r)+' a '+r+' '+r+' 0 1 0 0 '+(2*r)+' a '+r+' '+r+' 0 1 0 0 '+(-2*r)+' Z';}
function initScratch(cv,grayEl,clipD,p,finalize){
  setTimeout(()=>{
    const dpr=Math.min(2,window.devicePixelRatio||1);const rect=cv.getBoundingClientRect();const size=Math.round(rect.width)||90;
    cv.width=size*dpr;cv.height=size*dpr;const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);
    let clip=null;try{if(clipD)clip=new Path2D(clipD);}catch(e){}
    ctx.save();if(clip)ctx.clip(clip);
    const g=ctx.createLinearGradient(0,0,size,size);g.addColorStop(0,'#d6e0e4');g.addColorStop(.5,'#9fb0b8');g.addColorStop(1,'#6c7f88');
    ctx.fillStyle=g;ctx.fillRect(0,0,size,size);
    ctx.fillStyle='rgba(255,255,255,.18)';for(let i=0;i<24;i++)ctx.fillRect(Math.random()*size,Math.random()*size,2,2);
    ctx.restore();
    const total=Math.max(1,countFoil(ctx,cv));
    ctx.save();if(clip)ctx.clip(clip);ctx.globalCompositeOperation='destination-out';ctx.lineCap='round';ctx.lineJoin='round';
    let drawing=false,last=null,done=false,lastSfx=0;
    const toLocal=e=>{const b=cv.getBoundingClientRect();return {x:(e.clientX-b.left)*size/b.width,y:(e.clientY-b.top)*size/b.height};};
    const erase=(x,y)=>{ctx.beginPath();ctx.arc(x,y,size*0.15,0,7);ctx.fill();if(last){ctx.lineWidth=size*0.28;ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(x,y);ctx.stroke();}last={x,y};};
    const onDown=e=>{if(done)return;if(!SHARE&&!PRIV){ensureAudio();ensurePriv();return;}e.preventDefault();ensureAudio();drawing=true;last=null;try{cv.setPointerCapture(e.pointerId);}catch(_){}const l=toLocal(e);erase(l.x,l.y);};
    const onMove=e=>{if(!drawing||done)return;e.preventDefault();const l=toLocal(e);erase(l.x,l.y);const now=performance.now();if(now-lastSfx>70){lastSfx=now;sfxScratch();buzz(6);}const f=1-countFoil(ctx,cv)/total;const k=Math.min(1,f/0.5);grayEl.style.filter='grayscale('+(1-k)+') brightness('+(0.8+0.25*k)+')';if(f>=0.5){done=true;ctx.restore();ctx.clearRect(0,0,size,size);grayEl.style.filter='none';cv.style.transition='opacity .35s';cv.style.opacity='0';setTimeout(()=>cv.remove(),360);sfxDing();buzz([28,40,80]);finalize();}};
    const onUp=()=>{drawing=false;last=null;};
    cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onMove);cv.addEventListener('pointerup',onUp);cv.addEventListener('pointerleave',onUp);cv.addEventListener('pointercancel',onUp);
  },20);
}
/* ---------- park figure (real boundary shape) ---------- */
function rewindFC(fc){const rr=a=>{if(Array.isArray(a)&&Array.isArray(a[0])&&typeof a[0][0]==='number')a.reverse();else if(Array.isArray(a))a.forEach(rr);};const f2=JSON.parse(JSON.stringify(fc));f2.features.forEach(f=>{if(f.geometry&&f.geometry.coordinates)rr(f.geometry.coordinates);});return f2;}
function makeFigure(p,x,y,FIG,fc0){
  const fc=rewindFC(fc0);
  const vis=isVisited(p.id),tam=isTamper(p.id);let D='',cen=[FIG/2,FIG/2];
  try{const proj=d3.geoMercator().fitExtent([[9,9],[FIG-9,FIG-9]],fc);const pg=d3.geoPath(proj);D=pg(fc)||'';cen=pg.centroid(fc);}catch(e){}
  if(!D)return makeMedallion(p,x,y,FIG<104);
  const cont=el('div','park-fig');cont.style.left=x+'px';cont.style.top=y+'px';
  const disc=el('div','fig-disc');disc.style.width=FIG+'px';disc.style.height=FIG+'px';
  const wrap=el('div','fig-wrap'+(vis?' color':''));
  wrap.innerHTML='<svg class="fig-svg" viewBox="0 0 '+FIG+' '+FIG+'"><defs><linearGradient id="fg_'+p.id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e7e8c"/><stop offset="1" stop-color="#2f7d5a"/></linearGradient></defs><path d="'+D+'" fill="url(#fg_'+p.id+')" class="'+(vis||tam?'done':'')+'"'+(tam?' stroke="#ef6f6f"':'')+'/></svg>';
  const emo=el('div','fig-emoji');emo.style.cssText='position:absolute;left:'+cen[0]+'px;top:'+cen[1]+'px;transform:translate(-50%,-50%);font-size:'+Math.round(FIG*0.3)+'px';emo.textContent=p.em;wrap.appendChild(emo);
  disc.appendChild(wrap);
  if(!vis){const cv=el('canvas','fig-canvas');disc.appendChild(cv);initScratch(cv,wrap,D,p,()=>{wrap.classList.add('color');const pa=wrap.querySelector('path');if(pa)pa.classList.add('done');finishCheck(p,cont);});}
  const info=el('div','med-info');info.textContent='i';info.onclick=e=>{e.stopPropagation();openInfo(p);};disc.appendChild(info);
  cont.appendChild(disc);
  const nm=el('div','med-name');nm.style.marginTop='5px';nm.innerHTML=p.zh+'<span>'+p.en+'</span>'+(vis?'<div class="med-date">✓ '+S.recs[p.id].d+'</div>':(tam?'<div class="med-date" style="color:var(--bad)">⚠ 异常</div>':''));
  cont.appendChild(nm);
  return cont;
}
/* ---------- medallion fallback ---------- */
function makeMedallion(p,x,y,small){
  const vis=isVisited(p.id), tam=isTamper(p.id);const SZ=small?64:84;
  const m=el('div','medallion'+(small?' small':''));m.style.left=x+'px';m.style.top=y+'px';
  const disc=el('div','med-disc');disc.style.width=SZ+'px';disc.style.height=SZ+'px';
  const base=el('div','med-base'+(vis?' color':''));base.style.fontSize=small?'30px':'42px';base.textContent=p.em;
  const ring=el('div','med-ring'+(vis||tam?' done':''));if(tam)ring.style.borderColor='var(--bad)';
  disc.appendChild(base);disc.appendChild(ring);
  if(!vis){const cv=el('canvas','med-canvas');disc.appendChild(cv);initScratch(cv,base,circlePath(SZ),p,()=>{ring.classList.add('done');finishCheck(p,m);});}
  const info=el('div','med-info');info.textContent='i';info.onclick=(e)=>{e.stopPropagation();openInfo(p);};disc.appendChild(info);
  m.appendChild(disc);
  const nm=el('div','med-name');nm.innerHTML=p.zh+'<span>'+p.en+'</span>'+(vis?'<div class="med-date">✓ '+S.recs[p.id].d+'</div>':(tam?'<div class="med-date" style="color:var(--bad)">⚠ 异常</div>':''));
  m.appendChild(nm);
  return m;
}
async function finishCheck(p,cont){
  if(SHARE)return;if(!await ensurePriv())return;
  const date=today();const sig=await signRec(PRIV,p.id,date,'');
  S.recs[p.id]={d:date,n:'',s:sig};VALID[p.id]=true;saveLS();
  const nm=cont&&cont.querySelector('.med-name');if(nm&&!nm.querySelector('.med-date'))nm.insertAdjacentHTML('beforeend','<div class="med-date">✓ '+date+'</div>');
  const sd=$('#svDone');if(sd&&p._state){const ps=parksInState(p._state);sd.textContent=ps.filter(x=>isVisited(x.id)).length;}
  renderProgress();stampAnim();toast('已点亮 · '+p.zh);
}

/* ---------- info sheet ---------- */
function openInfo(p,fromList){
  const vis=isVisited(p.id),tam=isTamper(p.id),rec=S.recs[p.id];
  const sh=$('#sheet');let h='<div class="grip"></div>';
  h+='<div class="pk-top"><div class="pk-emoji">'+p.em+'</div><div><div class="pk-h1">'+p.zh+'</div><div class="pk-en">'+p.en+' National Park</div></div></div>';
  h+='<div style="margin-top:8px"><span class="pill state">📍 '+p.st+'</span><span class="pill yr">设立 '+p.yr+'</span>';
  if(vis)h+='<span class="pill done">✓ 已打卡 · '+rec.d+'</span>';if(tam)h+='<span class="pill tamper">⚠ 签名异常</span>';h+='</div>';
  h+='<div class="intro">'+p.intro+'</div><div class="hl">✨ 亮点：<b>'+p.hl+'</b></div>';
  h+='<div class="stampbox">';
  if(SHARE){h+='<div class="hint">🔗 只读分享卡片，不能在此打卡。</div>';}
  else if(p._terr){ // territory parks check in here (no state view)
    if(vis){h+='<button class="holdbtn danger" id="holdRemove"><span class="prog2"></span><span class="lab">长按取消打卡</span></button>';}
    else{h+='<button class="holdbtn" id="holdStamp"><span class="prog2"></span><span class="lab">长按盖章打卡 🅿️</span></button><div class="hint">'+(PRIV?'按住盖章':'按住时会要求口令')+'</div>';}
  }
  else if(vis){h+='<div class="hint">已点亮。想取消？长按下面。</div><button class="holdbtn danger" id="holdRemove"><span class="prog2"></span><span class="lab">长按取消打卡</span></button>';}
  else if(fromList){h+='<button class="holdbtn" id="holdStamp"><span class="prog2"></span><span class="lab">长按盖章打卡 🅿️</span></button>';}
  else{h+='<div class="hint">回到 '+(NAME2STATE[p._state]?NAME2STATE[p._state].zh:'地图')+' 视角，用手指刮开徽章即可打卡 ✨</div>';}
  h+='</div>';
  sh.innerHTML=h;$('#scrim').classList.add('show');sh.classList.add('show');
  const hs=$('#holdStamp');if(hs)bindHold(hs,()=>doStamp(p));
  const hr=$('#holdRemove');if(hr)bindHold(hr,()=>doRemove(p));
}
function closeSheet(){$('#scrim').classList.remove('show');$('#sheet').classList.remove('show');}
$('#scrim').addEventListener('click',closeSheet);
function bindHold(btn,onDone){let raf=null,start=0,done=false;const bar=btn.querySelector('.prog2');const DUR=820;const step=t=>{if(!start)start=t;const k=Math.min(1,(t-start)/DUR);bar.style.width=(k*100)+'%';if(k>=1){done=true;cancel();onDone();}else raf=requestAnimationFrame(step);};const begin=e=>{e.preventDefault();done=false;start=0;raf=requestAnimationFrame(step);};const cancel=()=>{if(raf)cancelAnimationFrame(raf);raf=null;if(!done)bar.style.width='0%';};btn.addEventListener('pointerdown',begin);btn.addEventListener('pointerup',cancel);btn.addEventListener('pointerleave',cancel);btn.addEventListener('pointercancel',cancel);}
async function doStamp(p){if(SHARE)return;if(!await ensurePriv())return;const date=today();const sig=await signRec(PRIV,p.id,date,'');S.recs[p.id]={d:date,n:'',s:sig};VALID[p.id]=true;saveLS();paintNational();renderProgress();closeSheet();stampAnim();toast('已点亮 · '+p.zh);}
async function doRemove(p){if(SHARE)return;if(!await ensurePriv())return;delete S.recs[p.id];delete VALID[p.id];saveLS();paintNational();renderProgress();closeSheet();toast('已取消打卡');if(MODE==='state'&&p._state)enterState(p._state);}

/* ---------- crypto unlock helpers ---------- */
function today(){const d=new Date();const z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());}
async function ensurePriv(){if(PRIV)return true;if(!S.idn){const made=await openLock(true);return !!PRIV;}const pass=await askPass('输入口令解锁打卡','你设置的打卡口令');if(pass===null)return false;try{PRIV=await unlockPriv(pass,S.idn);setLockUI();document.querySelectorAll('.med-lock').forEach(x=>x.remove());return true;}catch(e){toast('口令不对');return false;}}
function stampAnim(){const s=el('div','stamp-anim');s.textContent='VISITED';document.body.appendChild(s);requestAnimationFrame(()=>s.classList.add('go'));setTimeout(()=>s.remove(),1000);}

/* ---------- modal ---------- */
function openModal(html){const m=$('#modal');$('#mcard').innerHTML=html;m.classList.add('show');return m;}
function closeModal(){$('#modal').classList.remove('show');}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal();});
function askPass(title,ph){return new Promise(res=>{openModal('<h3>'+title+'</h3><input class="inp" type="password" id="pp" placeholder="'+(ph||'口令')+'" autocomplete="off"><div class="mbtns"><button id="pc">取消</button><button class="pri" id="po">确定</button></div>');const inp=$('#pp');inp.focus();const done=v=>{closeModal();res(v);};$('#po').onclick=()=>done(inp.value||'');$('#pc').onclick=()=>done(null);inp.onkeydown=e=>{if(e.key==='Enter')done(inp.value||'');};});}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),1800);}
function setLockUI(){const b=$('#btnLock');if(SHARE){b.textContent='👁';return;}b.textContent=!S.idn?'🔑':(PRIV?'🔓':'🔒');}
function openLock(forceSetup){
  return new Promise(resolve=>{
    if(SHARE){openModal('<h3>只读分享卡片</h3><p>你在看一张被加密签名保护的分享卡片，无法打卡或修改。卡片编号 <span class="fp">'+(S.idn?S.idn.fp:'')+'</span>。</p><p>想要自己的图鉴？去掉网址里 # 后面的内容重新打开即可。</p><div class="mbtns"><button class="pri" id="ok">好的</button></div>');$('#ok').onclick=()=>{closeModal();resolve();};return;}
    if(!S.idn){openModal('<h3>设置打卡口令</h3><p>打卡用 <b>ECDSA 数字签名</b> 保护：只有知道口令的人能盖章/刮开，别人改了记录签名就会失效、显示「异常」。口令<b>无法找回</b>，请记牢。</p><input class="inp" type="password" id="p1" placeholder="设置口令"><input class="inp" type="password" id="p2" placeholder="再输一次"><div class="mbtns"><button id="c">取消</button><button class="pri" id="o">生成我的印章</button></div>');$('#c').onclick=()=>{closeModal();resolve();};$('#o').onclick=async()=>{const a=$('#p1').value,b=$('#p2').value;if(a.length<4)return toast('口令至少 4 位');if(a!==b)return toast('两次不一致');const btn=$('#o');btn.textContent='生成中…';btn.disabled=true;S.idn=await createIdentity(a);PRIV=await unlockPriv(a,S.idn);saveLS();closeModal();setLockUI();toast('印章已生成 '+S.idn.fp);resolve();};return;}
    if(PRIV){openModal('<h3>已解锁 🔓</h3><p>卡片编号 <span class="fp">'+S.idn.fp+'</span>，可以打卡。</p><div class="mbtns"><button id="lock">锁定</button><button class="pri" id="ok">完成</button></div>');$('#ok').onclick=()=>{closeModal();resolve();};$('#lock').onclick=()=>{PRIV=null;setLockUI();closeModal();toast('已锁定');resolve();};return;}
    openModal('<h3>输入口令解锁</h3><input class="inp" type="password" id="pp" placeholder="你的打卡口令"><div class="mbtns"><button id="c">取消</button><button class="pri" id="o">解锁</button></div>');$('#pp').focus();$('#c').onclick=()=>{closeModal();resolve();};$('#o').onclick=async()=>{try{PRIV=await unlockPriv($('#pp').value,S.idn);setLockUI();document.querySelectorAll('.med-lock').forEach(x=>x.remove());closeModal();toast('已解锁 '+S.idn.fp);}catch(e){toast('口令不对');}resolve();};
  });
}
$('#btnLock').onclick=()=>openLock();

/* ---------- share ---------- */
$('#btnShare').onclick=()=>{
  if(!S.idn)return openModal('<h3>还没有可分享的卡片</h3><p>先点右上角 🔑 设置口令并打卡。</p><div class="mbtns"><button class="pri" id="ok">好的</button></div>'),void($('#ok').onclick=closeModal);
  const recs={};for(const id in S.recs){if(VALID[id])recs[id]=S.recs[id];}
  const link=location.origin+location.pathname+'#share='+strToB64url(JSON.stringify({v:1,pub:S.idn.pub,fp:S.idn.fp,recs}));
  openModal('<h3>分享我的图鉴</h3><p>链接带着你的<b>公钥与签名</b>：朋友能看你点亮了哪些并验证真伪，但<b>改不了、伪造不了</b>。卡片编号 <span class="fp">'+S.idn.fp+'</span>。</p><div class="share-out" id="so">'+link+'</div><div class="mbtns"><button id="c">关闭</button><button class="pri" id="cp">复制链接</button></div>');
  $('#c').onclick=closeModal;$('#cp').onclick=async()=>{try{await navigator.clipboard.writeText(link);toast('已复制');}catch(e){const r=document.createRange();r.selectNodeContents($('#so'));const sel=getSelection();sel.removeAllRanges();sel.addRange(r);toast('已选中，长按复制');}};
};

/* ---------- footer / help ---------- */
$('#foot').innerHTML='共 63 座美国国家公园 · 打卡用数字签名保护 · <a id="helpL">玩法说明</a>';
document.addEventListener('click',e=>{if(e.target&&e.target.id==='helpL'){openModal('<h3>玩法 & 安全说明</h3><p>① 全美地图上每个州有名字、吉祥物，公园是灰色 emoji；<br>② 点一个州放大进入州视角；<br>③ 设一个口令生成你的「印章」；<br>④ 用<b>手指在公园徽章上刮</b>，灰色慢慢变彩色，刮够一半即完成打卡；<br>⑤ 右上「分享」生成带签名的链接发给朋友。</p><p style="color:#8fb3b0">安全：每次打卡用从口令派生的私钥做 ECDSA 签名，验证用公钥；别人改了本地数据或链接，签名一对就失效、标红「异常」。这是浏览器端防篡改，知道口令的人仍可签名，请保管好口令。</p><div class="mbtns"><button class="pri" id="ok">明白了</button></div>');$('#ok').onclick=closeModal;}});

/* ---------- banner ---------- */
function renderBanner(){const b=$('#banner');b.className='banner';const tamper=PARKS.some(p=>isTamper(p.id));if(SHARE){b.classList.add('show','ro');b.innerHTML='👁 只读分享卡片 · 编号 '+(S.idn?S.idn.fp:'')+(tamper?' · ⚠ 含异常记录':'');}else if(tamper){b.classList.add('show','tamper');b.textContent='⚠ 有打卡记录签名验证失败，可能被改动过（已标红，不计入进度）。';}}

/* ---------- init ---------- */
async function init(){
  if(!subtle){$('#banner').className='banner show tamper';$('#banner').textContent='当前环境不支持 Web Crypto（请用 https 打开）。';}
  loadLS();await parseShare();await verifyAll();
  setLockUI();renderBanner();renderProgress();renderRegions();
  setMode('nation');
  await buildNational();
  renderProgress();
}
init();
})();
