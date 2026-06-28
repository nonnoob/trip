/* National Parks scratch-off tracker — logic */
(function(){
"use strict";
const PARKS=window.PARKS, REGIONS=window.REGIONS, TIERS=window.TIERS;
const subtle = (window.crypto && window.crypto.subtle) || null;
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
async function deriveAes(pass,saltBytes){
  const base=await subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
  return subtle.deriveKey({name:'PBKDF2',salt:saltBytes,iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function fingerprint(jwk){
  const h=await subtle.digest('SHA-256',enc.encode(jwk.x+'.'+jwk.y));
  const b=new Uint8Array(h); const A='0123456789ABCDEFGHJKMNPQRSTVWXYZ'; let out='';
  for(let i=0;i<6;i++)out+=A[b[i]%32];
  return 'NP-'+out.slice(0,3)+'-'+out.slice(3);
}
async function createIdentity(pass){
  const kp=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const pub=await subtle.exportKey('jwk',kp.publicKey);
  const priv=await subtle.exportKey('pkcs8',kp.privateKey);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const aes=await deriveAes(pass,salt);
  const ct=await subtle.encrypt({name:'AES-GCM',iv},aes,priv);
  return {salt:abToB64(salt),iv:abToB64(iv),enc:abToB64(ct),pub,fp:await fingerprint(pub)};
}
async function unlockPriv(pass,idn){
  const aes=await deriveAes(pass,b64ToBytes(idn.salt));
  const pkcs8=await subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(idn.iv)},aes,b64ToBytes(idn.enc)); // throws if wrong pass
  return subtle.importKey('pkcs8',pkcs8,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
}
async function importPub(jwk){return subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}
function msgOf(id,date,note){return enc.encode(id+'|'+date+'|'+(note||''));}
async function signRec(priv,id,date,note){const sig=await subtle.sign({name:'ECDSA',hash:'SHA-256'},priv,msgOf(id,date,note));return abToB64(sig);}
async function verifyRec(pub,id,date,note,sigB64){try{return await subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,b64ToBytes(sigB64),msgOf(id,date,note));}catch(e){return false;}}

/* ---------- state ---------- */
let S={idn:null,recs:{}};
let SHARE=false;          // read-only shared card
let PUBKEY=null;          // CryptoKey (verify)
let PRIV=null;            // CryptoKey (sign), in memory only after unlock
let VALID={};             // id -> true(valid) | false(tampered)
let curRegion=null;

function loadLS(){try{const r=JSON.parse(localStorage.getItem(LS));if(r&&typeof r==='object')S={idn:r.idn||null,recs:r.recs||{}};}catch(e){}}
function saveLS(){try{localStorage.setItem(LS,JSON.stringify(S));}catch(e){}}

async function parseShare(){
  const m=location.hash.match(/share=([^&]+)/);
  if(!m)return false;
  try{
    const data=JSON.parse(b64urlToStr(m[1]));
    if(!data||!data.pub)return false;
    S={idn:{pub:data.pub,fp:data.fp||(await fingerprint(data.pub))},recs:data.recs||{}};
    SHARE=true; return true;
  }catch(e){return false;}
}

async function verifyAll(){
  VALID={};
  if(!S.idn||!S.idn.pub){PUBKEY=null;return;}
  PUBKEY=await importPub(S.idn.pub);
  for(const id in S.recs){const r=S.recs[id];VALID[id]=await verifyRec(PUBKEY,id,r.d,r.n,r.s);}
}
const isVisited=id=>S.recs[id]&&VALID[id]===true;
const isTamper=id=>S.recs[id]&&VALID[id]===false;
const visitedCount=()=>PARKS.reduce((n,p)=>n+(isVisited(p.id)?1:0),0);

/* ---------- progress / tiers / regions ---------- */
function tierOf(n){for(const[t,name]of TIERS)if(n>=t)return name;return '未启程';}
function renderProgress(){
  const n=visitedCount();
  $('#cnt').textContent=n;
  $('#tier').textContent=tierOf(n);
  $('#fill').style.width=Math.round(n/PARKS.length*100)+'%';
  $('#pct').textContent=Math.round(n/PARKS.length*100)+'%';
  const states=new Set();PARKS.forEach(p=>{if(isVisited(p.id))p.st.split(/[\/]/).forEach(s=>states.add(s.trim()));});
  $('#states').textContent=states.size;
  let latest='';PARKS.forEach(p=>{if(isVisited(p.id)){const d=S.recs[p.id].d;if(d>latest)latest=d;}});
  $('#latest').textContent=latest?('最近 '+latest):'';
}
function renderRegions(){
  const host=$('#regions');host.innerHTML='';
  REGIONS.forEach(rg=>{
    const tot=PARKS.filter(p=>p.rg===rg).length;
    const got=PARKS.filter(p=>p.rg===rg&&isVisited(p.id)).length;
    const c=el('div','chip'+(curRegion===rg?' on':''));
    c.innerHTML=rg+' <b>'+got+'</b>/'+tot;
    c.onclick=()=>{curRegion=curRegion===rg?null:rg;renderRegions();applyRegionFocus();};
    host.appendChild(c);
  });
}
function applyRegionFocus(){
  document.querySelectorAll('.pk-node').forEach(g=>{
    const rg=g.getAttribute('data-rg');
    g.style.opacity=(!curRegion||curRegion===rg)?'1':'0.18';
  });
}

/* ---------- map ---------- */
let projection=null;
async function buildMap(){
  const host=$('#mapHost');
  if(!window.d3||!window.topojson){return buildList('地图组件未能加载，已切换到列表模式。');}
  let us;
  try{us=await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json');}
  catch(e){return buildList('地图数据加载失败（可能离线），已切换到列表模式。');}
  const W=960,H=600;
  const svg=d3.select(host).append('svg').attr('id','map').attr('viewBox','0 0 '+W+' '+H);
  const states=topojson.feature(us,us.objects.states);
  projection=d3.geoAlbersUsa().fitSize([W-20,H-70],states);
  const path=d3.geoPath(projection);
  svg.append('g').selectAll('path').data(states.features).join('path').attr('class','state').attr('d',path);
  // territory inset box
  const tb={x:792,y:470,w:150,h:96};
  svg.append('rect').attr('x',tb.x).attr('y',tb.y).attr('width',tb.w).attr('height',tb.h).attr('rx',8).attr('fill','#0e2734').attr('stroke','#23495a').attr('stroke-width',.8);
  svg.append('text').attr('x',tb.x+tb.w/2).attr('y',tb.y+15).attr('text-anchor','middle').attr('fill','#5d8794').attr('font-size','10').text('海外属地');
  const territoryPos={virginislands:[tb.x+44,tb.y+58],samoa:[tb.x+104,tb.y+58]};
  const g=svg.append('g');
  PARKS.forEach(p=>{
    let xy=projection([p.lng,p.lat]);
    if(!xy&&territoryPos[p.id])xy=territoryPos[p.id];
    if(!xy)return;
    const node=g.append('g').attr('class','pk-node').attr('data-rg',p.rg).attr('data-id',p.id).attr('transform','translate('+xy[0]+','+xy[1]+')').style('cursor','pointer');
    node.append('circle').attr('class','dot-hit').attr('r',11).attr('fill','transparent');
    node.append('circle').attr('class','pk-dot').attr('r',5.2).attr('stroke','#0b1f2a').attr('stroke-width',1.1);
    node.append('circle').attr('class','pk-ring').attr('r',8.5).attr('fill','none').attr('stroke-width',1.6).attr('opacity',0);
    node.append('circle').attr('class','foil').attr('r',6.4).attr('fill','url(#foilg)');
    node.on('click',()=>openSheet(p));
    p._node=node;
  });
  // foil gradient
  const defs=svg.append('defs');
  const lg=defs.append('radialGradient').attr('id','foilg').attr('cx','35%').attr('cy','30%');
  lg.append('stop').attr('offset','0%').attr('stop-color','#cfdce0');
  lg.append('stop').attr('offset','55%').attr('stop-color','#9fb0b8');
  lg.append('stop').attr('offset','100%').attr('stop-color','#6f828b');
  paintAll();
}
function buildList(msg){
  const host=$('#mapHost');host.innerHTML='<div class="maperr">'+(msg||'')+'</div>';
  const grid=el('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;padding:6px 12px 14px';
  PARKS.forEach(p=>{
    const c=el('div');c.style.cssText='background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;cursor:pointer;font-size:12px';
    c.dataset.id=p.id;c.onclick=()=>openSheet(p);
    grid.appendChild(c);p._card=c;
  });
  host.appendChild(grid);paintAll();
}
function paintNode(p){
  const vis=isVisited(p.id), tam=isTamper(p.id);
  if(p._node){
    const dot=p._node.select('.pk-dot'), foil=p._node.select('.foil'), ring=p._node.select('.pk-ring');
    foil.style('opacity',vis?0:1).style('transform',vis?'scale(0)':'scale(1)');
    dot.attr('fill',tam?'#ef6f6f':(vis?'#e7c06a':'#33586a'));
    ring.attr('stroke',tam?'#ef6f6f':'#e7c06a').attr('opacity',vis||tam?0.9:0);
    p._node.classed('glow',vis);
  }
  if(p._card){
    p._card.style.borderColor=tam?'#6f2f2f':(vis?'#caa24a':'var(--line)');
    p._card.innerHTML='<div style="font-size:18px">'+(vis?p.em:'▢')+'</div><b style="color:'+(vis?'#e7c06a':'#eaf2f0')+'">'+p.zh+'</b><div style="color:#8fb3b0">'+p.st+(vis?' · ✓':(tam?' · ⚠':''))+'</div>';
  }
}
function paintAll(){PARKS.forEach(paintNode);applyRegionFocus();}

/* ---------- detail sheet ---------- */
let curPark=null;
function openSheet(p){
  curPark=p;
  const vis=isVisited(p.id), tam=isTamper(p.id), rec=S.recs[p.id];
  const sh=$('#sheet');
  let h='<div class="grip"></div>';
  h+='<div class="pk-top"><div class="pk-emoji">'+p.em+'</div><div><div class="pk-h1">'+p.zh+'</div><div class="pk-en">'+p.en+' National Park</div></div></div>';
  h+='<div style="margin-top:8px"><span class="pill state">📍 '+p.st+'</span><span class="pill yr">设立 '+p.yr+'</span>';
  if(vis)h+='<span class="pill done">✓ 已打卡 · '+rec.d+'</span>';
  if(tam)h+='<span class="pill tamper">⚠ 签名异常</span>';
  h+='</div>';
  h+='<div class="intro">'+p.intro+'</div>';
  h+='<div class="hl">✨ 亮点：<b>'+p.hl+'</b></div>';
  if(vis&&rec.n)h+='<div class="hl">📝 '+rec.n+'</div>';
  // action
  h+='<div class="stampbox">';
  if(SHARE){
    h+='<div class="hint">🔗 这是只读分享卡片，不能在此打卡。</div>';
  }else if(!S.idn){
    h+='<button class="holdbtn" id="needSetup"><span class="lab">先设置打卡口令 →</span></button><div class="hint">第一次使用，先设一个只有你知道的口令</div>';
  }else if(vis){
    h+='<input class="note-in" id="noteIn" placeholder="给这次旅程加一句话（可选，会被签名保护）" value="'+(rec.n||'').replace(/"/g,'&quot;')+'">';
    h+='<button class="holdbtn danger" id="holdRemove"><span class="prog2"></span><span class="lab">长按取消打卡</span></button>';
    h+='<div class="hint">改备注/取消都需要你的口令签名</div>';
  }else if(tam){
    h+='<div class="hint" style="color:var(--bad)">这条打卡记录的签名无法验证，可能被改动过。长按可重新签名打卡。</div>';
    h+='<button class="holdbtn" id="holdStamp"><span class="prog2"></span><span class="lab">长按重新盖章打卡</span></button>';
  }else{
    h+='<input class="note-in" id="noteIn" placeholder="给这次旅程加一句话（可选）">';
    h+='<button class="holdbtn" id="holdStamp"><span class="prog2"></span><span class="lab">长按盖章打卡 🅿️</span></button>';
    h+='<div class="hint">'+(PRIV?'按住不放，盖下你的专属印章':'按住打卡时会要求输入口令解锁')+'</div>';
  }
  h+='</div>';
  sh.innerHTML=h;
  $('#scrim').classList.add('show');sh.classList.add('show');
  const ns=$('#needSetup');if(ns)ns.onclick=()=>{closeSheet();openLock();};
  const hs=$('#holdStamp');if(hs)bindHold(hs,()=>doCheckIn(p));
  const hr=$('#holdRemove');if(hr)bindHold(hr,()=>doRemove(p));
}
function closeSheet(){$('#scrim').classList.remove('show');$('#sheet').classList.remove('show');curPark=null;}
$('#scrim').addEventListener('click',closeSheet);

/* hold-to-confirm */
function bindHold(btn,onDone){
  let raf=null,start=0,done=false;const bar=btn.querySelector('.prog2');const DUR=820;
  const step=t=>{if(!start)start=t;const k=Math.min(1,(t-start)/DUR);bar.style.width=(k*100)+'%';if(k>=1){done=true;cancel();onDone();}else raf=requestAnimationFrame(step);};
  const begin=e=>{e.preventDefault();done=false;start=0;raf=requestAnimationFrame(step);};
  const cancel=()=>{if(raf)cancelAnimationFrame(raf);raf=null;if(!done)bar.style.width='0%';};
  btn.addEventListener('pointerdown',begin);
  btn.addEventListener('pointerup',cancel);
  btn.addEventListener('pointerleave',cancel);
  btn.addEventListener('pointercancel',cancel);
}

/* ---------- check-in ---------- */
function today(){const d=new Date();const z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());}
async function ensurePriv(){
  if(PRIV)return true;
  if(!S.idn)return false;
  const pass=await askPass('输入口令解锁打卡','你设置的打卡口令');
  if(pass===null)return false;
  try{PRIV=await unlockPriv(pass,S.idn);setLockUI();return true;}
  catch(e){toast('口令不对');return false;}
}
async function doCheckIn(p){
  if(SHARE)return;
  if(!await ensurePriv())return;
  const noteEl=$('#noteIn');const note=noteEl?noteEl.value.trim().slice(0,120):'';
  const date=today();
  const sig=await signRec(PRIV,p.id,date,note);
  S.recs[p.id]={d:date,n:note,s:sig};VALID[p.id]=true;saveLS();
  paintNode(p);renderProgress();renderRegions();
  closeSheet();stampAnim();toast('已盖章 · '+p.zh);
}
async function doRemove(p){
  if(SHARE)return;
  if(!await ensurePriv())return;
  const noteEl=$('#noteIn');
  // if note changed and still visited, treat as edit (re-sign); else remove
  if(noteEl){const nv=noteEl.value.trim().slice(0,120);if(nv!==(S.recs[p.id].n||'')){const date=S.recs[p.id].d;const sig=await signRec(PRIV,p.id,date,nv);S.recs[p.id]={d:date,n:nv,s:sig};saveLS();paintNode(p);closeSheet();toast('备注已更新');return;}}
  delete S.recs[p.id];delete VALID[p.id];saveLS();
  paintNode(p);renderProgress();renderRegions();closeSheet();toast('已取消打卡');
}
function stampAnim(){
  const s=el('div','stamp-anim');s.textContent='VISITED';document.body.appendChild(s);
  requestAnimationFrame(()=>s.classList.add('go'));
  setTimeout(()=>s.remove(),1000);
}

/* ---------- modal helpers ---------- */
function openModal(html){const m=$('#modal');$('#mcard').innerHTML=html;m.classList.add('show');return m;}
function closeModal(){$('#modal').classList.remove('show');}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal();});
function askPass(title,ph){
  return new Promise(res=>{
    openModal('<h3>'+title+'</h3><input class="inp" type="password" id="pp" placeholder="'+(ph||'口令')+'" autocomplete="off"><div class="mbtns"><button id="pc">取消</button><button class="pri" id="po">确定</button></div>');
    const inp=$('#pp');inp.focus();
    const done=v=>{closeModal();res(v);};
    $('#po').onclick=()=>done(inp.value||'');
    $('#pc').onclick=()=>done(null);
    inp.onkeydown=e=>{if(e.key==='Enter')done(inp.value||'');};
  });
}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),1800);}

/* ---------- lock / setup ---------- */
function setLockUI(){
  const b=$('#btnLock');
  if(SHARE){b.textContent='👁';b.title='只读分享';return;}
  if(!S.idn){b.textContent='🔑';}
  else if(PRIV){b.textContent='🔓';}
  else{b.textContent='🔒';}
}
async function openLock(){
  if(SHARE){openModal('<h3>只读分享卡片</h3><p>你正在查看一张被加密签名保护的分享卡片，无法在此打卡或修改。卡片编号：<span class="fp">'+(S.idn?S.idn.fp:'')+'</span></p><p>想拥有自己的图鉴？去掉网址里 # 后面的内容，重新打开本页即可从空白开始。</p><div class="mbtns"><button class="pri" id="ok">好的</button></div>');$('#ok').onclick=closeModal;return;}
  if(!S.idn){
    openModal('<h3>设置打卡口令</h3><p>打卡用 <b>ECDSA 数字签名</b> 保护：只有知道口令的人才能盖章，别人改动了记录签名就会失效、显示「异常」。口令<b>无法找回</b>，请记牢。</p><input class="inp" type="password" id="p1" placeholder="设置口令"><input class="inp" type="password" id="p2" placeholder="再输一次"><div class="mbtns"><button id="c">取消</button><button class="pri" id="o">生成我的印章</button></div>');
    $('#c').onclick=closeModal;
    $('#o').onclick=async()=>{
      const a=$('#p1').value,b=$('#p2').value;
      if(a.length<4)return toast('口令至少 4 位');
      if(a!==b)return toast('两次不一致');
      const btn=$('#o');btn.textContent='生成中…';btn.disabled=true;
      S.idn=await createIdentity(a);PRIV=await unlockPriv(a,S.idn);saveLS();
      closeModal();setLockUI();toast('印章已生成 '+S.idn.fp);
    };
    return;
  }
  // identity exists
  if(PRIV){
    openModal('<h3>已解锁 🔓</h3><p>卡片编号 <span class="fp">'+S.idn.fp+'</span>，当前可以打卡。</p><div class="mbtns"><button id="lock">锁定</button><button class="pri" id="ok">完成</button></div>');
    $('#ok').onclick=closeModal;
    $('#lock').onclick=()=>{PRIV=null;setLockUI();closeModal();toast('已锁定');};
  }else{
    const pass=await askPass('输入口令解锁','你的打卡口令');
    if(pass===null)return;
    try{PRIV=await unlockPriv(pass,S.idn);setLockUI();toast('已解锁 '+S.idn.fp);}catch(e){toast('口令不对');}
  }
}
$('#btnLock').onclick=openLock;

/* ---------- share ---------- */
$('#btnShare').onclick=()=>{
  if(!S.idn){return openModal('<h3>还没有可分享的卡片</h3><p>先点右上角 🔑 设置口令并打卡，才能生成分享链接。</p><div class="mbtns"><button class="pri" id="ok">好的</button></div>'),void($('#ok').onclick=closeModal);}
  const recs={};for(const id in S.recs){if(VALID[id])recs[id]=S.recs[id];}
  const payload={v:1,pub:S.idn.pub,fp:S.idn.fp,recs};
  const link=location.origin+location.pathname+'#share='+strToB64url(JSON.stringify(payload));
  openModal('<h3>分享我的图鉴</h3><p>这条链接里带着你的<b>公钥与签名</b>：朋友打开能看到你点亮了哪些公园，并能验证真伪，但<b>改不了、也伪造不了</b>（私钥只在你这、用口令加密）。卡片编号 <span class="fp">'+S.idn.fp+'</span>。</p><div class="share-out" id="so">'+link+'</div><div class="mbtns"><button id="c">关闭</button><button class="pri" id="cp">复制链接</button></div>');
  $('#c').onclick=closeModal;
  $('#cp').onclick=async()=>{try{await navigator.clipboard.writeText(link);toast('已复制');}catch(e){const r=document.createRange();r.selectNodeContents($('#so'));const sel=getSelection();sel.removeAllRanges();sel.addRange(r);toast('已选中，长按复制');}};
};

/* ---------- help in footer ---------- */
$('#foot').innerHTML='共 63 座美国国家公园 · 打卡用数字签名保护 · <a id="helpL">玩法说明</a>';
document.addEventListener('click',e=>{if(e.target&&e.target.id==='helpL'){
  openModal('<h3>玩法 & 安全说明</h3><p>① 点地图上的银色圆点看公园介绍；<br>② 设置一个口令生成你的专属「印章」；<br>③ 在公园详情里<b>长按「盖章打卡」</b>，刮开银漆、盖下印章；<br>④ 右上「分享」生成一条带签名的链接，发给朋友看。</p><p style="color:#8fb3b0">安全：每条打卡都用从口令派生的私钥做 ECDSA 签名，验证用公钥。别人即便改了本地数据或链接，签名一对就会失效、标红「异常」。提醒：这是浏览器端的防篡改，知道口令或能在你设备上运行代码的人仍可签名，请妥善保管口令。</p><div class="mbtns"><button class="pri" id="ok">明白了</button></div>');
  $('#ok').onclick=closeModal;
}});

/* ---------- banners ---------- */
function renderBanner(){
  const b=$('#banner');b.className='banner';
  const tamper=PARKS.some(p=>isTamper(p.id));
  if(SHARE){b.classList.add('show','ro');b.innerHTML='👁 只读分享卡片 · 编号 '+(S.idn?S.idn.fp:'')+(tamper?' · ⚠ 含异常记录':'');}
  else if(tamper){b.classList.add('show','tamper');b.textContent='⚠ 有打卡记录的签名验证失败，可能被改动过（已标红，不计入进度）。';}
}

/* ---------- init ---------- */
async function init(){
  if(!subtle){$('#banner').className='banner show tamper';$('#banner').textContent='当前环境不支持 Web Crypto，打卡功能不可用（请用 https 打开）。';}
  loadLS();
  await parseShare();
  await verifyAll();
  setLockUI();renderBanner();renderProgress();renderRegions();
  await buildMap();
  renderProgress();
}
init();
})();
