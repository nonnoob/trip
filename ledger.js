/* Ledger — 签名打卡账本（ECDSA P-256 签名 + 口令派生 AES-GCM 锁私钥）
   接口：Ledger.create({storage,subtle,today}) → load/setup/unlock/lock/checkIn/remove/
         isVisited/isTamper/record/shareFragment + readonly/hasIdentity/unlocked/fp/supported
       云存档（ADR-0010）：cloudId(pass)/exportCloud()/importCloud(pass,bundle)/mergeCloud(bundle)
   存储格式（np_v1）、#share= 编码、云存档 bundle 格式必须保持不变：老数据与已上传存档依赖它们。 */
(function(root){
"use strict";
const enc=new TextEncoder(), dec=new TextDecoder();

/* ---------- base64 ---------- */
function abToB64(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s);}
function b64ToBytes(b64){const s=atob(b64);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;}
function strToB64url(str){const u=enc.encode(str);let s='';for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function b64urlToStr(b){b=b.replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';const s=atob(b);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return dec.decode(u);}

/* ---------- crypto ---------- */
function deriveAes(subtle,pass,saltBytes){return subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']).then(base=>subtle.deriveKey({name:'PBKDF2',salt:saltBytes,iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']));}
/* 云存档查找键：只由口令派生（固定盐），任何设备同口令算出同一 ID */
async function cloudIdOf(subtle,pass){const base=await subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveBits']);const bits=await subtle.deriveBits({name:'PBKDF2',salt:enc.encode('np-cloud-v1'),iterations:150000,hash:'SHA-256'},base,128);const b=new Uint8Array(bits);let s='';for(let i=0;i<b.length;i++)s+=b[i].toString(16).padStart(2,'0');return s;}
async function fingerprint(subtle,jwk){const h=await subtle.digest('SHA-256',enc.encode(jwk.x+'.'+jwk.y));const b=new Uint8Array(h);const A='0123456789ABCDEFGHJKMNPQRSTVWXYZ';let out='';for(let i=0;i<6;i++)out+=A[b[i]%32];return 'NP-'+out.slice(0,3)+'-'+out.slice(3);}
function msgOf(id,date,note){return enc.encode(id+'|'+date+'|'+(note||''));}

function create(opts){
  opts=opts||{};
  const subtle=opts.subtle!==undefined?opts.subtle:((root.crypto&&root.crypto.subtle)||null);
  const cryptoObj=opts.crypto||root.crypto;
  const storage=opts.storage||null;            /* {load():obj|null, save(obj)} */
  const todayFn=opts.today||function(){const d=new Date();const z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());};

  let S={idn:null,recs:{}}, VALID={}, PUB=null, PRIV=null, share=false;
  let CKEY=null, CID=null; /* 解锁时缓存：云存档加密钥（同口令派生）与查找键 */

  function persist(){if(!share&&storage)storage.save(S);}
  async function importPub(jwk){return subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}
  async function verifyRec(id,r){try{return await subtle.verify({name:'ECDSA',hash:'SHA-256'},PUB,b64ToBytes(r.s),msgOf(id,r.d,r.n));}catch(e){return false;}}
  async function verifyAll(){VALID={};PUB=null;if(!S.idn||!S.idn.pub)return;PUB=await importPub(S.idn.pub);for(const id in S.recs)VALID[id]=await verifyRec(id,S.recs[id]);}

  const api={
    get supported(){return !!subtle;},
    get readonly(){return share;},
    get hasIdentity(){return !!S.idn;},
    get unlocked(){return !!PRIV;},
    get fp(){return S.idn?(S.idn.fp||''):'';},

    /* hash: location.hash；有合法 share= 则进入只读分享模式，否则读 storage。返回 'share'|'local' */
    async load(hash){
      const m=hash&&hash.match(/share=([^&]+)/);
      if(m){try{const data=JSON.parse(b64urlToStr(m[1]));if(data&&data.pub){S={idn:{pub:data.pub,fp:data.fp||await fingerprint(subtle,data.pub)},recs:data.recs||{}};share=true;await verifyAll();return 'share';}}catch(e){}}
      /* 每次 load 先清空：换存储槽（多图鉴）时不得残留上一本的数据 */
      S={idn:null,recs:{}};PRIV=null;CKEY=null;CID=null;
      if(storage){const r=storage.load();if(r&&typeof r==='object')S={idn:r.idn||null,recs:r.recs||{}};}
      await verifyAll();return 'local';
    },

    /* 生成身份（印章）：ECDSA 密钥对，私钥用口令派生 AES-GCM 加密后存储。
       新身份=新图鉴：旧记录（旧钥匙签的，换身份必验失败）一并清空 */
    async setup(pass){
      S={idn:null,recs:{}};VALID={};
      const kp=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
      const pub=await subtle.exportKey('jwk',kp.publicKey);
      const priv=await subtle.exportKey('pkcs8',kp.privateKey);
      const salt=cryptoObj.getRandomValues(new Uint8Array(16)), iv=cryptoObj.getRandomValues(new Uint8Array(12));
      const aes=await deriveAes(subtle,pass,salt);
      const ct=await subtle.encrypt({name:'AES-GCM',iv},aes,priv);
      S.idn={salt:abToB64(salt),iv:abToB64(iv),enc:abToB64(ct),pub,fp:await fingerprint(subtle,pub)};
      PRIV=kp.privateKey;
      CKEY=aes;CID=await cloudIdOf(subtle,pass);
      PUB=await importPub(pub);persist();return S.idn.fp;
    },

    async unlock(pass){
      if(!S.idn)return false;
      try{
        const aes=await deriveAes(subtle,pass,b64ToBytes(S.idn.salt));
        const pkcs8=await subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(S.idn.iv)},aes,b64ToBytes(S.idn.enc));
        PRIV=await subtle.importKey('pkcs8',pkcs8,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
        CKEY=aes;CID=await cloudIdOf(subtle,pass);
        return true;
      }catch(e){return false;}
    },
    lock(){PRIV=null;CKEY=null;CID=null;},

    /* 打卡：需已解锁。签名 id|date|note，写入并持久化 */
    async checkIn(id,note){
      if(share)throw new Error('readonly');if(!PRIV)throw new Error('locked');
      const d=todayFn(), n=note||'';
      const sig=await subtle.sign({name:'ECDSA',hash:'SHA-256'},PRIV,msgOf(id,d,n));
      S.recs[id]={d:d,n:n,s:abToB64(sig)};VALID[id]=true;persist();return S.recs[id];
    },
    remove(id){if(share)return;delete S.recs[id];delete VALID[id];persist();},

    isVisited(id){return !!(S.recs[id]&&VALID[id]===true);},
    isTamper(id){return !!(S.recs[id]&&VALID[id]===false);},
    record(id){return S.recs[id]||null;},

    /* 属主自愈：删掉全部验签失败的记录（只读分享不动）。返回删除条数 */
    purgeInvalid(){
      if(share)return 0;
      let n=0;for(const id in S.recs){if(VALID[id]!==true){delete S.recs[id];delete VALID[id];n++;}}
      if(n)persist();return n;
    },

    /* 只导出验签通过的记录；编码格式不可变 */
    shareFragment(){
      const recs={};for(const id in S.recs){if(VALID[id])recs[id]=S.recs[id];}
      return 'share='+strToB64url(JSON.stringify({v:1,pub:S.idn.pub,fp:S.idn.fp,recs:recs}));
    },

    /* ---------- 云存档（ADR-0010） ---------- */
    async cloudId(pass){return cloudIdOf(subtle,pass);},

    /* 导出：整包（身份+验签通过的记录）AES-GCM 加密，再对密文 ECDSA 签名——仓库里不裸奔，无口令者改不动。
       只带验签通过的记录：坏记录不进云、不跨设备扩散 */
    async exportCloud(){
      if(!PRIV||!CKEY||!CID)throw new Error('locked');
      const recs={};for(const k in S.recs){if(VALID[k])recs[k]=S.recs[k];}
      const iv=cryptoObj.getRandomValues(new Uint8Array(12));
      const ct=await subtle.encrypt({name:'AES-GCM',iv},CKEY,enc.encode(JSON.stringify({idn:S.idn,recs:recs})));
      const sig=await subtle.sign({name:'ECDSA',hash:'SHA-256'},PRIV,ct);
      return {v:1,id:CID,fp:S.idn.fp,pub:{kty:'EC',crv:'P-256',x:S.idn.pub.x,y:S.idn.pub.y},salt:S.idn.salt,iv:abToB64(iv),ct:abToB64(ct),sig:abToB64(sig)};
    },

    /* 恢复：新设备只凭口令。解不开/结构不对返回 false，成功返回编号并处于解锁态 */
    async importCloud(pass,bundle){
      try{
        const aes=await deriveAes(subtle,pass,b64ToBytes(bundle.salt));
        const buf=await subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(bundle.iv)},aes,b64ToBytes(bundle.ct));
        const data=JSON.parse(dec.decode(buf));
        if(!data||!data.idn||!data.idn.pub)return false;
        S={idn:data.idn,recs:data.recs||{}};
        await verifyAll();persist();
        if(!await api.unlock(pass))return false;
        return S.idn.fp;
      }catch(e){return false;}
    },

    /* 合并（多设备）：同一身份的云存档里，本地缺的记录收进来。
       返回 {added,extra}；身份不同或解不开返回 null。extra=本地有而云端没有的条数（>0 该回传） */
    async mergeCloud(bundle){
      if(!CKEY||!S.idn)return null;
      if(!bundle||!bundle.pub||bundle.pub.x!==S.idn.pub.x||bundle.pub.y!==S.idn.pub.y)return null;
      try{
        const buf=await subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(bundle.iv)},CKEY,b64ToBytes(bundle.ct));
        const data=JSON.parse(dec.decode(buf));
        const crecs=(data&&data.recs)||{};let added=0,extra=0;
        for(const id in crecs){if(!S.recs[id]){S.recs[id]=crecs[id];VALID[id]=await verifyRec(id,S.recs[id]);added++;}}
        for(const id in S.recs){if(!crecs[id])extra++;}
        if(added)persist();
        return {added:added,extra:extra};
      }catch(e){return null;}
    }
  };
  return api;
}
root.Ledger={create:create};
})(typeof window!=='undefined'?window:globalThis);
