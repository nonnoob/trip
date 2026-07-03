/* National Parks scratch-off tracker — map redesign (national overview + state view + gesture scratch) */
(function(){
"use strict";
const PARKS=window.PARKS, REGIONS=window.REGIONS, TIERS=window.TIERS, STATES=window.STATES, PSF=window.PARK_STATE_FALLBACK||{};
const LS='np_v1';
const $=s=>document.querySelector(s);
const el=(t,c)=>{const e=document.createElement(t);if(c)e.className=c;return e;};

/* ---------- ledger（签名打卡账本，实现见 ledger.js） ---------- */
const ledger=window.Ledger.create({storage:{
  load(){try{return JSON.parse(localStorage.getItem(LS));}catch(e){return null;}},
  save(o){try{localStorage.setItem(LS,JSON.stringify(o));}catch(e){}}
}});
let SHARE=false, curRegion=null, MODE='nation', curState=null;
const isVisited=id=>ledger.isVisited(id);
const isTamper=id=>ledger.isTamper(id);
const visitedCount=()=>PARKS.reduce((n,p)=>n+(isVisited(p.id)?1:0),0);

/* ---------- park <-> state ---------- */
const ABBR2NAME={},NAME2STATE={};STATES.forEach(s=>{ABBR2NAME[s.ab]=s.name;NAME2STATE[s.name]=s;});
const USGS_OVR={hawaii:'Volcanoes National Park',haleakala:'Haleakala National Park',wrangell:'Wrangell',samoa:'American Samoa',virginislands:'Virgin Islands National Park'};
PARKS.forEach(p=>{p._terr=(p.id==='virginislands'||p.id==='samoa');let ab=PSF[p.id];if(!ab){const m=p.st.match(/([A-Z]{2})\s*$/);ab=m?m[1]:null;}p._ab=ab;p._state=ab?ABBR2NAME[ab]:null;p._usgs=USGS_OVR[p.id]||(p.en+' National Park');});
const parksInState=name=>PARKS.filter(p=>p._state===name);

/* ---------- progress / tiers / regions ---------- */
function tierOf(n){for(const[t,name]of TIERS)if(n>=t)return name;return '未启程';}
function renderProgress(){const n=visitedCount();$('#cnt').textContent=n;$('#tier').textContent=tierOf(n);$('#fill').style.width=Math.round(n/PARKS.length*100)+'%';$('#pct').textContent=Math.round(n/PARKS.length*100)+'%';const states=new Set();PARKS.forEach(p=>{if(isVisited(p.id)&&p._state)states.add(p._state);});$('#states').textContent=states.size;let latest='';PARKS.forEach(p=>{if(isVisited(p.id)){const d=ledger.record(p.id).d;if(d>latest)latest=d;}});$('#latest').textContent=latest?('最近 '+latest):'';}
function renderRegions(){const host=$('#regions');host.innerHTML='';REGIONS.forEach(rg=>{const tot=PARKS.filter(p=>p.rg===rg).length;const got=PARKS.filter(p=>p.rg===rg&&isVisited(p.id)).length;const c=el('div','chip'+(curRegion===rg?' on':''));c.innerHTML=rg+' <b>'+got+'</b>/'+tot;c.onclick=()=>{curRegion=curRegion===rg?null:rg;renderRegions();paintNational();};host.appendChild(c);});}

/* ---------- sound + haptics ---------- */
let AC=null, SOUND=localStorage.getItem('np_sound')!=='0';
function ensureAudio(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}if(AC&&AC.state==='suspended')AC.resume();}
function sfxScratch(){if(!SOUND||!AC)return;const t=AC.currentTime,len=Math.floor(AC.sampleRate*0.05);const b=AC.createBuffer(1,len,AC.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*0.5;const s=AC.createBufferSource();s.buffer=b;const f=AC.createBiquadFilter();f.type='highpass';f.frequency.value=2600;const g=AC.createGain();g.gain.setValueAtTime(0.16,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.06);s.connect(f);f.connect(g);g.connect(AC.destination);s.start(t);}
function sfxDing(){if(!SOUND||!AC)return;const t=AC.currentTime;[660,990,1320].forEach((fr,i)=>{const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.value=fr;const ts=t+i*0.08;g.gain.setValueAtTime(0.0001,ts);g.gain.exponentialRampToValueAtTime(0.2,ts+0.02);g.gain.exponentialRampToValueAtTime(0.0001,ts+0.5);o.connect(g);g.connect(AC.destination);o.start(ts);o.stop(ts+0.55);});}
function buzz(p){if(SOUND&&navigator.vibrate){try{navigator.vibrate(p);}catch(e){}}}
$('#btnSound').textContent=SOUND?'🔊':'🔇';
$('#btnSound').onclick=()=>{SOUND=!SOUND;localStorage.setItem('np_sound',SOUND?'1':'0');$('#btnSound').textContent=SOUND?'🔊':'🔇';if(SOUND){ensureAudio();sfxDing();}};

/* ---------- boundary data (baked static, park-bounds.js) ---------- */
const BCACHE={};
function fetchBoundary(p){
  if(BCACHE[p.id]!==undefined)return Promise.resolve(BCACHE[p.id]);
  const rings=(window.PARK_BOUNDS||{})[p.id];
  let fc=null;
  if(rings&&rings.length){fc={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:rings.map(flat=>{const c=[];for(let i=0;i<flat.length;i+=2)c.push([flat[i],flat[i+1]]);return c;})}}]};}
  BCACHE[p.id]=fc;return Promise.resolve(fc);
}

/* ---------- national overview ---------- */
let usFeatures=null, stateEls={}, markEls={};
async function buildNational(){
  const host=$('#mapHost');
  if(!window.d3||!window.topojson)return buildListFallback('地图组件未能加载，已切换到列表模式。');
  let us;try{us=window.__US||(window.__US=await d3.json('states-10m.json?v=1'));}catch(e){return buildListFallback('地图数据加载失败（可能离线），已切换到列表模式。');}
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
function setMode(m){MODE=m;$('#nationalView').style.display=m==='nation'?'':'none';$('#stateView').style.display=m==='state'?'block':'none';$('#regions').style.display=m==='nation'?'':'none';}
function backToNation(){curState=null;setMode('nation');paintNational();renderProgress();window.scrollTo(0,0);if(!SHARE&&/(^#?|&)st=/.test(location.hash))history.replaceState(null,'',location.pathname+location.search);}
function routeHash(){if(SHARE)return;const m=location.hash.match(/(?:[#&])st=([^&]+)/);if(m){const key=decodeURIComponent(m[1]);const name=ABBR2NAME[key]||(NAME2STATE[key]?key:null);if(name&&NAME2STATE[name]){if(curState!==name)enterState(name);return;}}if(MODE!=='nation')backToNation();}
window.addEventListener('hashchange',routeHash);
function enterState(name){
  const st=NAME2STATE[name];const feat=usFeatures&&usFeatures.find(f=>f.properties.name===name);
  const ps=parksInState(name);
  const host=$('#stateView');host.innerHTML='';
  const head=el('div','sv-head');
  head.innerHTML='<button class="sv-back">‹ 全美</button><div class="sv-mascot">'+(st?st.m:'📍')+'</div><div class="sv-title">'+(st?st.zh:name)+'<small>'+name+'</small></div><div class="sv-sub"><b id="svDone">'+ps.filter(p=>isVisited(p.id)).length+'</b>/'+ps.length+' 座<br>已点亮</div>';
  host.appendChild(head);head.querySelector('.sv-back').onclick=backToNation;
  const stage=el('div','sv-stage');host.appendChild(stage);
  stage.addEventListener('click',function(e){if(!e.target.closest('.sv-callout,.park-fig,.medallion'))closeCallout();});
  setMode('state');window.scrollTo(0,0);
  curState=name;if(!SHARE){const ab=(NAME2STATE[name]&&NAME2STATE[name].ab)||name;const h='#st='+encodeURIComponent(ab);if(location.hash!==h)history.replaceState(null,'',h);}
  if(!ps.length){stage.innerHTML='<div class="sv-emptly"><div class="big2">'+(st?st.m:'🗺️')+'</div><div style="margin-top:8px">'+(st?st.zh:name)+'目前还没有国家公园</div><div style="font-size:12px;margin-top:4px">换个州试试 →</div></div>';return;}
  // measure then render backdrop + medallions
  setTimeout(()=>{
    const W=Math.max(280,stage.clientWidth||340);const vh=(window.innerHeight||700);const Hs=Math.round(Math.max(W*0.62,Math.min(W*1.5,vh-196)));stage.style.minHeight=Hs+'px';
    let proj=null,bb=null,cen=[W/2,Hs/2];
    if(window.d3&&feat){const svg=d3.select(stage).append('svg').attr('class','sv-bg').attr('viewBox','0 0 '+W+' '+Hs).style('width','100%').style('height',Hs+'px');proj=d3.geoMercator().fitExtent([[16,14],[W-16,Hs-14]],feat);const pth=d3.geoPath(proj);svg.append('path').attr('d',pth(feat));bb=pth.bounds(feat);const c=pth.centroid(feat);if(c&&!isNaN(c[0]))cen=c;}
    const n=ps.length;
    // figure size scaled to fit inside the state's box
    let FIG;
    if(bb){const bw=bb[1][0]-bb[0][0],bh=bb[1][1]-bb[0][1];FIG=Math.sqrt(Math.max(1,bw*bh)/n)*0.58;FIG=Math.min(FIG,bw*0.58,bh*0.4,112);FIG=Math.max(38,Math.round(FIG));}
    else FIG=n>4?86:112;
    // start positions at true geographic location
    const pts=ps.map(p=>{let xy=proj?proj([p.lng,p.lat]):null;if(!xy||isNaN(xy[0]))xy=[cen[0],cen[1]];return {p,x:xy[0],y:xy[1]};});
    // tight spacing: keep figures near their true geographic positions (only nudge apart enough to not overlap)
    const hmin=FIG*0.86,vmin=FIG*0.86;
    // keep disc centers inside the state's box
    let ins=bb?[bb[0][0]+FIG*0.5,bb[0][1]+FIG*0.5,bb[1][0]-FIG*0.5,bb[1][1]-FIG*0.5]:[FIG*0.5,FIG*0.5,W-FIG*0.5,Hs-FIG*0.5];
    if(ins[2]<ins[0]){const m=(ins[0]+ins[2])/2;ins[0]=ins[2]=m;}if(ins[3]<ins[1]){const m=(ins[1]+ins[3])/2;ins[1]=ins[3]=m;}
    relax(pts,hmin,vmin,ins,cen,proj,feat);
    pts.forEach(pt=>{const ph=el('div','park-fig');ph.style.left=pt.x+'px';ph.style.top=pt.y+'px';ph.innerHTML='<div style="width:'+FIG+'px;height:'+FIG+'px;border-radius:50%;background:#143240;margin:0 auto"></div>';stage.appendChild(ph);const small=FIG<92;fetchBoundary(pt.p).then(fc=>{ph.replaceWith(fc?makeFigure(pt.p,pt.x,pt.y,FIG,fc):makeMedallion(pt.p,pt.x,pt.y,small));}).catch(()=>{ph.replaceWith(makeMedallion(pt.p,pt.x,pt.y,small));});});
  },30);
}
function relax(pts,hmin,vmin,ins,cen,proj,feat){
  const inside=(x,y)=>{if(!proj||!proj.invert||!feat||!window.d3)return true;try{const ll=proj.invert([x,y]);return !!(ll&&d3.geoContains(feat,ll));}catch(e){return true;}};
  for(let it=0;it<90;it++){let moved=false;
    for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){const a=pts[i],b=pts[j];let nx=(b.x-a.x)/hmin,ny=(b.y-a.y)/vmin;let d2=nx*nx+ny*ny;if(d2<1){let d=Math.sqrt(d2)||0.001;let ux=nx/d,uy=ny/d,push=(1-d)/2;a.x-=ux*push*hmin;a.y-=uy*push*vmin;b.x+=ux*push*hmin;b.y+=uy*push*vmin;moved=true;}}
    for(const pt of pts){pt.x=Math.max(ins[0],Math.min(ins[2],pt.x));pt.y=Math.max(ins[1],Math.min(ins[3],pt.y));let tr=0;while(!inside(pt.x,pt.y)&&tr++<10){pt.x+=(cen[0]-pt.x)*0.28;pt.y+=(cen[1]-pt.y)*0.28;}}
    if(!moved)break;
  }
}

/* ---------- scratch core (clipped, sound, haptics) ---------- */
function countFoil(ctx,cv){const im=ctx.getImageData(0,0,cv.width,cv.height).data;let c=0;const step=Math.max(2,Math.floor(cv.width/18));for(let y=0;y<cv.height;y+=step)for(let x=0;x<cv.width;x+=step){if(im[(y*cv.width+x)*4+3]>=128)c++;}return c;}
function circlePath(size){const r=size/2-1,c=size/2;return 'M '+c+' '+(c-r)+' a '+r+' '+r+' 0 1 0 0 '+(2*r)+' a '+r+' '+r+' 0 1 0 0 '+(-2*r)+' Z';}
/* global active-touch tracker: a 2nd finger anywhere (even on another figure) = pinch, never scratch */
const GPTRS=new Set();
document.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')GPTRS.add(e.pointerId);},true);
const _gpUp=e=>{GPTRS.delete(e.pointerId);};
document.addEventListener('pointerup',_gpUp,true);document.addEventListener('pointercancel',_gpUp,true);
function multiTouch(){return GPTRS.size>1;}
function initScratch(cv,grayEl,clipD,p,finalize){
  setTimeout(()=>{
    const dpr=Math.min(2,window.devicePixelRatio||1);const rect=cv.getBoundingClientRect();const size=Math.round(rect.width)||90;
    cv.width=size*dpr;cv.height=size*dpr;const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);
    let clip=null;try{if(clipD)clip=new Path2D(clipD);}catch(e){}
    const grad=ctx.createLinearGradient(0,0,size,size);grad.addColorStop(0,'#d6e0e4');grad.addColorStop(.5,'#9fb0b8');grad.addColorStop(1,'#6c7f88');
    const paintFoil=()=>{ctx.save();if(clip)ctx.clip(clip);ctx.globalCompositeOperation='source-over';ctx.fillStyle=grad;ctx.fillRect(0,0,size,size);ctx.fillStyle='rgba(255,255,255,.18)';for(let i=0;i<24;i++)ctx.fillRect(Math.random()*size,Math.random()*size,2,2);ctx.restore();};
    const startErase=()=>{ctx.save();if(clip)ctx.clip(clip);ctx.globalCompositeOperation='destination-out';ctx.globalAlpha=0.26;ctx.lineCap='round';ctx.lineJoin='round';};
    paintFoil();const total=Math.max(1,countFoil(ctx,cv));startErase();
    let last=null,done=false,lastSfx=0,travel=0,armed=false,armT=null,downL=null,moved=false;const TH=1,TAP=size*0.25,ARM_MS=350,MOVECANCEL=8;
    const toLocal=e=>{const b=cv.getBoundingClientRect();return {x:(e.clientX-b.left)*size/b.width,y:(e.clientY-b.top)*size/b.height};};
    const erase=(x,y)=>{ctx.beginPath();ctx.arc(x,y,size*0.11,0,7);ctx.fill();if(last){travel+=Math.hypot(x-last.x,y-last.y);ctx.lineWidth=size*0.2;ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(x,y);ctx.stroke();}last={x,y};};
    const recover=()=>{ctx.restore();paintFoil();startErase();done=false;armed=false;cv.classList.remove('armed');last=null;travel=0;grayEl.style.filter='grayscale(1) brightness(.8)';};
    const reveal=()=>{ctx.restore();ctx.clearRect(0,0,size,size);grayEl.style.filter='none';cv.style.transition='opacity .35s';cv.style.opacity='0';setTimeout(()=>{cv.remove();},360);sfxDing();buzz([28,40,80]);finalize();};
    const commit=async()=>{if(!SHARE){const ok=await ensurePriv();if(!ok){recover();return;}}reveal();};
    const setArmed=(v)=>{armed=v;if(v){cv.classList.add('armed');buzz(18);}else{cv.classList.remove('armed');}};
    const clearArm=()=>{if(armT){clearTimeout(armT);armT=null;}};
    const onDown=e=>{if(done||SHARE)return;if(multiTouch())return;ensureAudio();downL=toLocal(e);last=downL;travel=0;moved=false;setArmed(false);try{cv.setPointerCapture(e.pointerId);}catch(_){}clearArm();armT=setTimeout(()=>{armT=null;if(!moved&&!done)setArmed(true);},ARM_MS);};
    /* 采样节流：getImageData 全画布读回很贵，跟 sfx 共用 70ms 节拍；抬指再补一次终判 */
    const checkDone=()=>{if(done)return;const left=countFoil(ctx,cv);const f=1-left/total;const k=Math.min(1,f/TH);grayEl.style.filter='grayscale('+(1-k)+') brightness('+(0.8+0.25*k)+')';if(f>=TH||left<=1){done=true;setArmed(false);commit();}};
    const onMove=e=>{if(done)return;if(multiTouch()){clearArm();setArmed(false);try{cv.releasePointerCapture(e.pointerId);}catch(_){}return;}const l=toLocal(e);if(!armed){if(downL&&Math.hypot(l.x-downL.x,l.y-downL.y)>MOVECANCEL){moved=true;clearArm();}last=l;return;}e.preventDefault();erase(l.x,l.y);const now=performance.now();if(now-lastSfx>70){lastSfx=now;sfxScratch();buzz(6);checkDone();}};
    const onUp=()=>{clearArm();if(armed&&travel>0)checkDone();const tap=!done&&!armed&&!moved&&travel<TAP&&!multiTouch();setArmed(false);last=null;if(tap)showCallout(p);};
    const onCancel=()=>{clearArm();setArmed(false);last=null;};
    cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onMove);cv.addEventListener('pointerup',onUp);cv.addEventListener('pointerleave',onCancel);cv.addEventListener('pointercancel',onCancel);
  },20);
}
/* ---------- park figure (real boundary shape) ---------- */
function fcShape(fc,FIG){
  const pts=[],rings=[];const dig=a=>{if(Array.isArray(a)&&Array.isArray(a[0])&&typeof a[0][0]==='number'){rings.push(a);for(const q of a)pts.push(q);}else if(Array.isArray(a))a.forEach(dig);};
  (fc.features||[]).forEach(f=>{if(f.geometry)dig(f.geometry.coordinates);});
  if(!pts.length)return null;
  let proj;try{proj=d3.geoMercator().fitExtent([[9,9],[FIG-9,FIG-9]],{type:'MultiPoint',coordinates:pts});}catch(e){return null;}
  let d='',minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  rings.forEach(r=>{let started=false;r.forEach(pt=>{const q=proj(pt);if(!q||isNaN(q[0]))return;d+=(started?'L':'M')+q[0].toFixed(2)+','+q[1].toFixed(2);started=true;if(q[0]<minx)minx=q[0];if(q[0]>maxx)maxx=q[0];if(q[1]<miny)miny=q[1];if(q[1]>maxy)maxy=q[1];});if(started)d+='Z';});
  if(!d)return null;
  return {d:d,cen:[(minx+maxx)/2,(miny+maxy)/2]};
}
function makeFigure(p,x,y,FIG,fc){
  const vis=isVisited(p.id),tam=isTamper(p.id);let D='',cen=[FIG/2,FIG/2];
  const sh=fcShape(fc,FIG);if(sh){D=sh.d;cen=sh.cen;}
  if(!D)return makeMedallion(p,x,y,FIG<104);
  const cont=el('div','park-fig');cont.style.left=x+'px';cont.style.top=y+'px';cont.style.width=FIG+'px';cont.style.height=FIG+'px';cont.setAttribute('data-id',p.id);
  const disc=el('div','fig-disc');disc.style.width=FIG+'px';disc.style.height=FIG+'px';
  const wrap=el('div','fig-wrap'+(vis?' color':''));
  wrap.innerHTML='<svg class="fig-svg" viewBox="0 0 '+FIG+' '+FIG+'"><defs><linearGradient id="fg_'+p.id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e7e8c"/><stop offset="1" stop-color="#2f7d5a"/></linearGradient></defs><path d="'+D+'" fill="url(#fg_'+p.id+')" class="'+(vis||tam?'done':'')+'"'+(tam?' stroke="#ef6f6f"':'')+'/></svg>';
  const emo=el('div','fig-emoji');emo.style.cssText='position:absolute;left:'+cen[0]+'px;top:'+cen[1]+'px;transform:translate(-50%,-50%);font-size:'+Math.round(FIG*0.3)+'px';emo.textContent=p.em;wrap.appendChild(emo);
  disc.appendChild(wrap);disc.style.cursor='pointer';
  if(!vis){const cv=el('canvas','fig-canvas');disc.appendChild(cv);initScratch(cv,wrap,D,p,()=>{wrap.classList.add('color');const pa=wrap.querySelector('path');if(pa)pa.classList.add('done');finishCheck(p);});}
  else{disc.onclick=()=>showCallout(p);}
  cont.appendChild(disc);
  return cont;
}
/* ---------- medallion fallback ---------- */
function makeMedallion(p,x,y,small){
  const vis=isVisited(p.id), tam=isTamper(p.id);const SZ=small?64:84;
  const m=el('div','medallion'+(small?' small':''));m.style.left=x+'px';m.style.top=y+'px';m.setAttribute('data-id',p.id);
  const disc=el('div','med-disc');disc.style.width=SZ+'px';disc.style.height=SZ+'px';
  const base=el('div','med-base'+(vis?' color':''));base.style.fontSize=small?'30px':'42px';base.textContent=p.em;
  const ring=el('div','med-ring'+(vis||tam?' done':''));if(tam)ring.style.borderColor='var(--bad)';
  disc.appendChild(base);disc.appendChild(ring);disc.style.cursor='pointer';
  if(!vis){const cv=el('canvas','med-canvas');disc.appendChild(cv);initScratch(cv,base,circlePath(SZ),p,()=>{ring.classList.add('done');finishCheck(p);});}
  else{disc.onclick=()=>showCallout(p);}
  m.appendChild(disc);
  return m;
}
async function finishCheck(p){
  if(SHARE)return;if(!await ensurePriv())return;
  await ledger.checkIn(p.id);
  const sd=$('#svDone');if(sd&&p._state){const ps=parksInState(p._state);sd.textContent=ps.filter(x=>isVisited(x.id)).length;}
  renderProgress();stampAnim();toast('已点亮 · '+p.zh);
}

/* ---------- info sheet ---------- */
function openInfo(p,fromList){
  const vis=isVisited(p.id),tam=isTamper(p.id),rec=ledger.record(p.id);
  const sh=$('#sheet');let h='<div class="grip"></div>';
  h+='<div class="pk-top"><div class="pk-emoji">'+p.em+'</div><div><div class="pk-h1">'+p.zh+'</div><div class="pk-en">'+p.en+' National Park</div></div></div>';
  h+='<div style="margin-top:8px"><span class="pill state">📍 '+p.st+'</span><span class="pill yr">设立 '+p.yr+'</span>';
  if(vis)h+='<span class="pill done">✓ 已打卡 · '+rec.d+'</span>';if(tam)h+='<span class="pill tamper">⚠ 签名异常</span>';h+='</div>';
  h+='<div class="intro">'+p.intro+'</div><div class="hl">✨ 亮点：<b>'+p.hl+'</b></div>';
  h+='<div class="stampbox">';
  if(SHARE){h+='<div class="hint">🔗 只读分享卡片，不能在此打卡。</div>';}
  else if(p._terr){ // territory parks check in here (no state view)
    if(vis){h+='<button class="holdbtn danger" id="holdRemove"><span class="prog2"></span><span class="lab">长按取消打卡</span></button>';}
    else{h+='<button class="holdbtn" id="holdStamp"><span class="prog2"></span><span class="lab">长按盖章打卡 🅿️</span></button><div class="hint">'+(ledger.unlocked?'按住盖章':'按住时会要求口令')+'</div>';}
  }
  else if(vis){h+='<div class="hint">已点亮。想取消？长按下面。</div><button class="holdbtn danger" id="holdRemove"><span class="prog2"></span><span class="lab">长按取消打卡</span></button>';}
  else if(fromList){h+='<button class="holdbtn" id="holdStamp"><span class="prog2"></span><span class="lab">长按盖章打卡 🅿️</span></button>';}
  else{h+='<div class="hint">长按徽章（约半秒）再刮开即可打卡 ✨</div>';}
  h+='</div>';
  sh.innerHTML=h;$('#scrim').classList.add('show');sh.classList.add('show');fixSheetZoom();
  const hs=$('#holdStamp');if(hs)bindHold(hs,()=>doStamp(p));
  const hr=$('#holdRemove');if(hr)bindHold(hr,()=>doRemove(p));
}
function closeSheet(){$('#scrim').classList.remove('show');$('#sheet').classList.remove('show');fixSheetZoom();}
$('#scrim').addEventListener('click',closeSheet);
/* keep the detail sheet / modal readable when the page itself is pinch-zoomed:
   re-anchor them to the visible (visual) viewport and counter-scale by 1/scale */
function fixSheetZoom(){const sh=$('#sheet'),vv=window.visualViewport;const on=vv&&sh.classList.contains('show')&&vv.scale>1.01;if(on){const gap=document.documentElement.clientHeight-(vv.offsetTop+vv.height);sh.style.left='0';sh.style.right='auto';sh.style.margin='0';sh.style.maxWidth='none';sh.style.width=vv.width+'px';sh.style.maxHeight=(vv.height*0.92)+'px';sh.style.transformOrigin='left bottom';sh.style.transform='translate('+vv.offsetLeft+'px,'+(-gap)+'px) scale('+(1/vv.scale)+')';}else{['left','right','margin','maxWidth','width','maxHeight','transformOrigin','transform'].forEach(function(k){sh.style[k]='';});}}
function fixModalZoom(){const md=$('#modal'),card=$('#mcard'),vv=window.visualViewport;const on=vv&&md.classList.contains('show')&&vv.scale>1.01;if(on){md.style.left=vv.offsetLeft+'px';md.style.top=vv.offsetTop+'px';md.style.right='auto';md.style.bottom='auto';md.style.width=vv.width+'px';md.style.height=vv.height+'px';card.style.transformOrigin='center center';card.style.transform='scale('+(1/vv.scale)+')';}else{['left','top','right','bottom','width','height'].forEach(function(k){md.style[k]='';});card.style.transform='';card.style.transformOrigin='';}}
if(window.visualViewport){const _zsync=function(){fixSheetZoom();fixModalZoom();};visualViewport.addEventListener('resize',_zsync);visualViewport.addEventListener('scroll',_zsync);}
/* state view: show a park's detail as an in-map leader-line callout (scales with the map, so it stays readable when the user has pinch-zoomed) */
function closeCallout(){document.querySelectorAll('.sv-callout,.sv-cline').forEach(function(x){x.remove();});}
function showCallout(p){
  const stage=document.querySelector('.sv-stage');if(!stage)return openInfo(p);
  const fig=stage.querySelector('[data-id="'+p.id+'"]');if(!fig)return openInfo(p);
  closeCallout();
  const vis=isVisited(p.id),tam=isTamper(p.id),rec=ledger.record(p.id);
  const sr=stage.getBoundingClientRect(),fr=fig.getBoundingClientRect();
  const fx=fr.left+fr.width/2-sr.left,fy=fr.top+fr.height/2-sr.top;const SW=stage.clientWidth,SH=stage.clientHeight;
  const c=el('div','sv-callout');
  let h='<span class="cx">✕</span><div class="ct"><span class="ce">'+p.em+'</span><div><div class="ch1">'+p.zh+'</div><div class="cen">'+p.en+' NP</div></div></div>';
  h+='<div style="margin-top:6px"><span class="pill state">📍 '+p.st+'</span><span class="pill yr">设立 '+p.yr+'</span></div>';
  h+='<div class="cintro">'+p.intro+'</div><div class="chl">✨ '+p.hl+'</div><div class="cstat">';
  if(SHARE)h+='<span style="color:var(--muted)">👁 只读</span>'+(vis?' · <span style="color:var(--ok)">✓ '+rec.d+'</span>':'');
  else if(tam)h+='<span style="color:var(--bad)">⚠ 签名异常（已改动）</span>';
  else if(vis)h+='<span style="color:var(--ok)">✓ 已点亮 · '+rec.d+'</span><button class="holdbtn danger" id="cRemove"><span class="prog2"></span><span class="lab">长按取消打卡</span></button>';
  else h+='<span style="color:var(--muted)">长按徽章（约半秒）再刮开即可打卡 ✨</span>';
  h+='</div>';c.innerHTML=h;stage.appendChild(c);
  const cw=c.offsetWidth,ch=c.offsetHeight;
  let left=fx+fr.width/2+12,side='r';
  if(left+cw>SW-6){left=fx-fr.width/2-12-cw;side='l';}
  left=Math.max(6,Math.min(left,SW-cw-6));
  let top=Math.max(6,Math.min(fy-ch/2,SH-ch-6));
  c.style.left=left+'px';c.style.top=top+'px';
  const tx=side==='r'?left:left+cw,ty=Math.max(top+14,Math.min(top+ch-14,fy));
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('class','sv-cline');svg.setAttribute('width',SW);svg.setAttribute('height',SH);svg.setAttribute('viewBox','0 0 '+SW+' '+SH);
  const ln=document.createElementNS(ns,'line');ln.setAttribute('x1',fx);ln.setAttribute('y1',fy);ln.setAttribute('x2',tx);ln.setAttribute('y2',ty);ln.setAttribute('stroke','#e7c06a');ln.setAttribute('stroke-width','1.5');ln.setAttribute('stroke-dasharray','3 3');ln.setAttribute('opacity','.9');
  const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',fx);dot.setAttribute('cy',fy);dot.setAttribute('r','3.5');dot.setAttribute('fill','#e7c06a');
  svg.appendChild(ln);svg.appendChild(dot);stage.appendChild(svg);
  c.querySelector('.cx').onclick=function(e){e.stopPropagation();closeCallout();};
  const rm=c.querySelector('#cRemove');if(rm)bindHold(rm,function(){doRemove(p);});
}
function bindHold(btn,onDone){let raf=null,start=0,done=false;const bar=btn.querySelector('.prog2');const DUR=820;const step=t=>{if(!start)start=t;const k=Math.min(1,(t-start)/DUR);bar.style.width=(k*100)+'%';if(k>=1){done=true;cancel();onDone();}else raf=requestAnimationFrame(step);};const begin=e=>{e.preventDefault();done=false;start=0;raf=requestAnimationFrame(step);};const cancel=()=>{if(raf)cancelAnimationFrame(raf);raf=null;if(!done)bar.style.width='0%';};btn.addEventListener('pointerdown',begin);btn.addEventListener('pointerup',cancel);btn.addEventListener('pointerleave',cancel);btn.addEventListener('pointercancel',cancel);}
async function doStamp(p){if(SHARE)return;if(!await ensurePriv())return;await ledger.checkIn(p.id);paintNational();renderProgress();closeSheet();stampAnim();toast('已点亮 · '+p.zh);}
async function doRemove(p){if(SHARE)return;if(!await ensurePriv())return;ledger.remove(p.id);paintNational();renderProgress();closeSheet();toast('已取消打卡');if(MODE==='state'&&p._state)enterState(p._state);}

/* ---------- unlock helpers ---------- */
async function ensurePriv(){if(ledger.unlocked)return true;if(!ledger.hasIdentity){await openLock();return ledger.unlocked;}const pass=await askPass('请签名','你的口令');if(pass===null)return false;if(await ledger.unlock(pass)){setLockUI();return true;}toast('口令不对');return false;}
function stampAnim(){const s=el('div','stamp-anim');s.textContent='VISITED';document.body.appendChild(s);requestAnimationFrame(()=>s.classList.add('go'));setTimeout(()=>s.remove(),1000);}

/* ---------- modal ---------- */
function openModal(html){const m=$('#modal');$('#mcard').innerHTML=html;m.classList.add('show');fixModalZoom();return m;}
function closeModal(){$('#modal').classList.remove('show');fixModalZoom();}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal();});
function askPass(title,ph){return new Promise(res=>{openModal('<h3>'+title+'</h3><input class="inp" type="password" id="pp" placeholder="'+(ph||'口令')+'" autocomplete="off"><div class="mbtns"><button id="pc">取消</button><button class="pri" id="po">确定</button></div>');const inp=$('#pp');inp.focus();const done=v=>{closeModal();res(v);};$('#po').onclick=()=>done(inp.value||'');$('#pc').onclick=()=>done(null);inp.onkeydown=e=>{if(e.key==='Enter')done(inp.value||'');};});}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),1800);}
function setLockUI(){const b=$('#btnLock');if(SHARE){b.textContent='👁';return;}b.textContent=!ledger.hasIdentity?'🔑':(ledger.unlocked?'🔓':'🔒');}
function openLock(){
  return new Promise(resolve=>{
    if(SHARE){openModal('<h3>只读分享卡片</h3><p>你在看一张被加密签名保护的分享卡片，无法打卡或修改。卡片编号 <span class="fp">'+ledger.fp+'</span>。</p><p>想要自己的图鉴？去掉网址里 # 后面的内容重新打开即可。</p><div class="mbtns"><button class="pri" id="ok">好的</button></div>');$('#ok').onclick=()=>{closeModal();resolve();};return;}
    if(!ledger.hasIdentity){openModal('<h3>请签名</h3><p>首次使用：设置一个口令作为你的签名，<b>无法找回</b>，请记牢。</p><input class="inp" type="password" id="p1" placeholder="设置口令"><div class="mbtns"><button id="c">取消</button><button class="pri" id="o">签名</button></div>');const p1=$('#p1');p1.focus();p1.onkeydown=e=>{if(e.key==='Enter')$('#o').click();};$('#c').onclick=()=>{closeModal();resolve();};$('#o').onclick=async()=>{const a=p1.value;if(a.length<4)return toast('口令至少 4 位');const btn=$('#o');btn.textContent='签名中…';btn.disabled=true;const fp=await ledger.setup(a);closeModal();setLockUI();toast('已签名 · 印章 '+fp);resolve();};return;}
    if(ledger.unlocked){openModal('<h3>已解锁 🔓</h3><p>卡片编号 <span class="fp">'+ledger.fp+'</span>，可以打卡。</p><div class="mbtns"><button id="lock">锁定</button><button class="pri" id="ok">完成</button></div>');$('#ok').onclick=()=>{closeModal();resolve();};$('#lock').onclick=()=>{ledger.lock();setLockUI();closeModal();toast('已锁定');resolve();};return;}
    openModal('<h3>请签名</h3><input class="inp" type="password" id="pp" placeholder="你的口令"><div class="mbtns"><button id="c">取消</button><button class="pri" id="o">签名</button></div>');$('#pp').focus();$('#c').onclick=()=>{closeModal();resolve();};$('#o').onclick=async()=>{if(await ledger.unlock($('#pp').value)){setLockUI();closeModal();toast('已解锁 '+ledger.fp);}else{toast('口令不对');}resolve();};
  });
}
$('#btnLock').onclick=()=>openLock();

/* ---------- share ---------- */
$('#btnShare').onclick=()=>{
  if(!ledger.hasIdentity)return openModal('<h3>还没有可分享的卡片</h3><p>先点右上角 🔑 设置口令并打卡。</p><div class="mbtns"><button class="pri" id="ok">好的</button></div>'),void($('#ok').onclick=closeModal);
  const link=location.origin+location.pathname+'#'+ledger.shareFragment();
  openModal('<h3>分享我的图鉴</h3><p>链接带着你的<b>公钥与签名</b>：朋友能看你点亮了哪些并验证真伪，但<b>改不了、伪造不了</b>。卡片编号 <span class="fp">'+ledger.fp+'</span>。</p><div class="share-out" id="so">'+link+'</div><div class="mbtns"><button id="c">关闭</button><button class="pri" id="cp">复制链接</button></div>');
  $('#c').onclick=closeModal;$('#cp').onclick=async()=>{try{await navigator.clipboard.writeText(link);toast('已复制');}catch(e){const r=document.createRange();r.selectNodeContents($('#so'));const sel=getSelection();sel.removeAllRanges();sel.addRange(r);toast('已选中，长按复制');}};
};

/* ---------- footer / help ---------- */
$('#foot').innerHTML='<a id="helpL" style="opacity:.7">玩法说明</a>';
document.addEventListener('click',e=>{if(e.target&&e.target.id==='helpL'){openModal('<h3>玩法 & 安全说明</h3><p>① 全美地图上每个州有名字、吉祥物，公园是灰色 emoji；<br>② 点一个州放大进入州视角；<br>③ 设一个口令生成你的「印章」；<br>④ 用<b>手指在公园徽章上刮</b>，灰色慢慢变彩色，刮够一半即完成打卡；<br>⑤ 右上「分享」生成带签名的链接发给朋友。</p><p style="color:#8fb3b0">安全：每次打卡用从口令派生的私钥做 ECDSA 签名，验证用公钥；别人改了本地数据或链接，签名一对就失效、标红「异常」。这是浏览器端防篡改，知道口令的人仍可签名，请保管好口令。</p><div class="mbtns"><button class="pri" id="ok">明白了</button></div>');$('#ok').onclick=closeModal;}});

/* ---------- banner ---------- */
function renderBanner(){const b=$('#banner');b.className='banner';const tamper=PARKS.some(p=>isTamper(p.id));if(SHARE){b.classList.add('show','ro');b.innerHTML='👁 只读分享卡片 · 编号 '+ledger.fp+(tamper?' · ⚠ 含异常记录':'');}else if(tamper){b.classList.add('show','tamper');b.textContent='⚠ 有打卡记录签名验证失败，可能被改动过（已标红，不计入进度）。';}}

/* ---------- init ---------- */
async function init(){
  if(!ledger.supported){$('#banner').className='banner show tamper';$('#banner').textContent='当前环境不支持 Web Crypto（请用 https 打开）。';}
  SHARE=(await ledger.load(location.hash))==='share';
  setLockUI();renderBanner();renderProgress();renderRegions();
  setMode('nation');
  await buildNational();
  renderProgress();
  routeHash();
}
init();
})();
