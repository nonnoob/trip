/* Scratchable — 刮刮卡手势模块（长按解锁 → 刮开 → 阈值判定，双指缩放防误刮）
   接口：Scratchable.attach(canvas, opts) / Scratchable.circlePath(size)
   opts：
     clip         SVG path d 字符串，限制涂层区域（可空 = 整块画布）
     disabled()   → true 时不进入刮开手势（如只读分享）；轻点仍触发 onTap
     confirm()    → Promise<bool>：刮够阈值后调用（如要求签名）；false → 恢复涂层
     onReveal()   涂层清除完成（打卡后续由调用方做）
     onTap()      轻点（未刮、未长按、未移动）
     onProgress(k) 0..1 刮开进度（调用方用来做底图滤镜过渡；恢复时回 0，完成时 1）
     fx           {ensureAudio,scratch,ding,buzz(pattern)} 声效/震动钩子，全部可省
   测试注入（可省）：dpr、isMultiTouch()、now()
   行为常量与线上一致：ARM_MS=350 长按解锁、TH=1 容差 1 格、70ms 采样节拍。 */
(function(root){
"use strict";
const TH=1, ARM_MS=350, MOVECANCEL=8, BEAT=70;

/* 全局多指追踪：任意第二根手指（哪怕落在另一块徽章上）= 缩放手势，绝不刮 */
const PTRS=new Set();
if(typeof document!=='undefined'){
  document.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')PTRS.add(e.pointerId);},true);
  const up=e=>{PTRS.delete(e.pointerId);};
  document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);
}

/* 采样计数涂层剩余：~18x18 网格，alpha>=128 记 1 */
function countFoil(ctx,cv){const im=ctx.getImageData(0,0,cv.width,cv.height).data;let c=0;const step=Math.max(2,Math.floor(cv.width/18));for(let y=0;y<cv.height;y+=step)for(let x=0;x<cv.width;x+=step){if(im[(y*cv.width+x)*4+3]>=128)c++;}return c;}
function circlePath(size){const r=size/2-1,c=size/2;return 'M '+c+' '+(c-r)+' a '+r+' '+r+' 0 1 0 0 '+(2*r)+' a '+r+' '+r+' 0 1 0 0 '+(-2*r)+' Z';}

function attach(cv,opts){
  opts=opts||{};
  const disabled=opts.disabled||function(){return false;};
  const confirmFn=opts.confirm||function(){return Promise.resolve(true);};
  const onReveal=opts.onReveal||function(){};
  const onTap=opts.onTap||function(){};
  const onProgress=opts.onProgress||function(){};
  const fx=opts.fx||{};
  const multiTouch=opts.isMultiTouch||function(){return PTRS.size>1;};
  const nowFn=opts.now||function(){return (typeof performance!=='undefined'?performance:Date).now();};
  setTimeout(()=>{
    const dpr=Math.min(2,opts.dpr||((typeof window!=='undefined'&&window.devicePixelRatio)||1));
    const rect=cv.getBoundingClientRect();const size=Math.round(rect.width)||90;
    cv.width=size*dpr;cv.height=size*dpr;const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);
    let clip=null;try{if(opts.clip)clip=new Path2D(opts.clip);}catch(e){}
    const grad=ctx.createLinearGradient(0,0,size,size);grad.addColorStop(0,'#d6e0e4');grad.addColorStop(.5,'#9fb0b8');grad.addColorStop(1,'#6c7f88');
    const paintFoil=()=>{ctx.save();if(clip)ctx.clip(clip);ctx.globalCompositeOperation='source-over';ctx.fillStyle=grad;ctx.fillRect(0,0,size,size);ctx.fillStyle='rgba(255,255,255,.18)';for(let i=0;i<24;i++)ctx.fillRect(Math.random()*size,Math.random()*size,2,2);ctx.restore();};
    const startErase=()=>{ctx.save();if(clip)ctx.clip(clip);ctx.globalCompositeOperation='destination-out';ctx.globalAlpha=0.26;ctx.lineCap='round';ctx.lineJoin='round';};
    paintFoil();const total=Math.max(1,countFoil(ctx,cv));startErase();
    let last=null,done=false,lastSfx=0,travel=0,armed=false,armT=null,downL=null,moved=false;const TAP=size*0.25;
    const toLocal=e=>{const b=cv.getBoundingClientRect();return {x:(e.clientX-b.left)*size/b.width,y:(e.clientY-b.top)*size/b.height};};
    const erase=(x,y)=>{ctx.beginPath();ctx.arc(x,y,size*0.11,0,7);ctx.fill();if(last){travel+=Math.hypot(x-last.x,y-last.y);ctx.lineWidth=size*0.2;ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(x,y);ctx.stroke();}last={x,y};};
    const recover=()=>{ctx.restore();paintFoil();startErase();done=false;armed=false;cv.classList.remove('armed');last=null;travel=0;onProgress(0);};
    const reveal=()=>{ctx.restore();ctx.clearRect(0,0,size,size);onProgress(1);cv.style.transition='opacity .35s';cv.style.opacity='0';setTimeout(()=>{cv.remove();},360);if(fx.ding)fx.ding();if(fx.buzz)fx.buzz([28,40,80]);onReveal();};
    const commit=async()=>{const ok=await confirmFn();if(!ok){recover();return;}reveal();};
    const setArmed=(v)=>{armed=v;if(v){cv.classList.add('armed');if(fx.buzz)fx.buzz(18);}else{cv.classList.remove('armed');}};
    const clearArm=()=>{if(armT){clearTimeout(armT);armT=null;}};
    const onDown=e=>{if(done||disabled())return;if(multiTouch())return;if(fx.ensureAudio)fx.ensureAudio();downL=toLocal(e);last=downL;travel=0;moved=false;setArmed(false);try{cv.setPointerCapture(e.pointerId);}catch(_){}clearArm();armT=setTimeout(()=>{armT=null;if(!moved&&!done)setArmed(true);},ARM_MS);};
    /* 采样节流：getImageData 全画布读回很贵，跟声效共用 70ms 节拍；抬指再补一次终判 */
    const checkDone=()=>{if(done)return;const left=countFoil(ctx,cv);const f=1-left/total;const k=Math.min(1,f/TH);onProgress(k);if(f>=TH||left<=1){done=true;setArmed(false);commit();}};
    const onMove=e=>{if(done)return;if(multiTouch()){clearArm();setArmed(false);try{cv.releasePointerCapture(e.pointerId);}catch(_){}return;}const l=toLocal(e);if(!armed){if(downL&&Math.hypot(l.x-downL.x,l.y-downL.y)>MOVECANCEL){moved=true;clearArm();}last=l;return;}e.preventDefault();erase(l.x,l.y);const now=nowFn();if(now-lastSfx>BEAT){lastSfx=now;if(fx.scratch)fx.scratch();if(fx.buzz)fx.buzz(6);checkDone();}};
    const onUp=()=>{clearArm();if(armed&&travel>0)checkDone();const tap=!done&&!armed&&!moved&&travel<TAP&&!multiTouch();setArmed(false);last=null;if(tap)onTap();};
    const onCancel=()=>{clearArm();setArmed(false);last=null;};
    cv.addEventListener('pointerdown',onDown);cv.addEventListener('pointermove',onMove);cv.addEventListener('pointerup',onUp);cv.addEventListener('pointerleave',onCancel);cv.addEventListener('pointercancel',onCancel);
  },20);
}

root.Scratchable={attach:attach,circlePath:circlePath,_countFoil:countFoil};
})(typeof window!=='undefined'?window:globalThis);
