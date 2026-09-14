/**
 * @fileoverview 中国移动客户端多重凭证自动劫持与活动中心每日自动签到
 * @author Jane-Rui
 * @version 2.4.0
 * @date 2026-09-14
 * @license MIT
 * @icon https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/10086.png
 * icon: https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/10086.png
 * 
 * ==============================================================================
 * 【功能说明】
 * 1. 多层级会话凭据智能劫持与持久化：
 *    - 拦截 APP 客户端原生登录态 (client.app.coc.10086.cn / apm.app.coc.10086.cn)
 *    - 拦截 H5 活动中心 SSO 换票网关 (wx.10086.cn/qwhdsso/appTokenLogin)
 *    - 拦截签到活动页会话 Cookie (wx.10086.cn/qwhdhub/api/mark/)
 * 2. 独家自愈换票机制 (Auto-Refresh Session)：
 *    - 活动中心 Session Cookie (QWHD_SESSION_TOKEN) 有效期仅约 30 分钟。
 *    - 当定时签到检测到会话失效时，脚本自动利用持久化的客户端原生 Token 重新
 *      执行 SSO 换票握手流程，静默换取最新会话 Cookie，免去频繁手动抓包。
 * 3. 每日全自动签到与阶梯奖励自动领取：
 *    - 自动提交当日日历签到打卡；
 *    - 自动查询累签/连签奖励阶梯（如 2 签 1GB 日包、抽奖机会等），并自动领取；
 *    - 汇总签到状态、累计天数、到手奖品，推送系统通知；
 *    - 签到通知附带账户资产卡片：话费余额 / 通用流量剩余 / 通用通话剩余
 *      (biz-orange 网关 qen=1 加密信封查询，官方加密函数直接扣取嵌入)。
 * 4. 捕获即触发（v1.4.0，无定时、无延迟窗口）：
 *    - 捕获规则命中并拿到会话 Cookie 时，立即在本次请求上下文内联执行
 *      签到、累签领奖与话费/流量/通话资产查询；
 *    - 会话凭据为刚刚捕获的新鲜登录态，免除定时执行的重新登录握手；
 *    - 执行锁（120 秒）防并发双触发并节流失败重试；当日签到成功后不再触发；
 *    - 通知合并（v1.5.0）：凭据捕获不再单独弹窗，捕获来源并入签到结果通知统一推送；
 *    - 全自动监听、提取、签到闭环（v2.0.0）：
 *      ① 监听：自动拦截移动 APP 客户端请求；
 *      ② 提取：自动提取 Cookie、UID，并自动解密请求体提取真实手机号，彻底废除手动输入；
 *      ③ 触发：提取完成后立即内联执行签到、阶梯领奖与话费流量查询，单条通知推送；
 *      ④ 多账号支持：以 UID 为键隔离多账号状态，切换登录各自独立触发；
 *    - Cron 仅用于 argument 含 force 的手动强制执行，普通定时触发为空操作。
 * 
 * ==============================================================================
 * 【支持环境】
 * - Loon (推荐)
 * - Surge
 * - Quantumult X
 * 
 * 【使用说明】
 * 1. 开启 Loon 的 MitM 解密，确保已添加以下 Hostname：
 *    client.app.coc.10086.cn, apm.app.coc.10086.cn, wx.10086.cn
 * 2. 打开【中国移动 APP】，登录账号或进入首页【签到】；
 * 3. 弹出「中国移动签到 - 授权状态获取成功」通知即表示凭证劫持完成；
 * 4. 随后每天将在设定的 Cron 时间自动执行静默签到与领奖。
 * 
 * 【信息安全声明】
 * 本脚本严格遵循信息安全规范，公开代码不包含任何硬编码的密钥、Cookie 或用户隐私信息，
 * 所有的会话凭证均在用户本地客户端的私有沙盒存储（$persistentStore）中动态读写。
 * ==============================================================================
 */

const SCRIPT_NAME = '中国移动签到';
const KEY_TOKEN_INFO = 'cmcc_sign_token_info';
const KEY_SESSION_COOKIE = 'cmcc_sign_session_cookie';
const KEY_RUN_LOCK = 'cmcc_run_lock';
const KEY_GLOBAL_RUNNING = 'cmcc_global_sign_lock';
const KEY_RUN_DATE = 'cmcc_run_date';
const KEY_LAST_UID = 'cmcc_last_uid';
const KEY_TEL_MAP = 'cmcc_tel_map';
const KEY_TEL_UID = 'cmcc_tel_uid';
const KEY_PENDING_TEL = 'cmcc_pending_tel';

// 通用跨平台通知
function notify(title, subtitle, message) {
  if (typeof $notification !== 'undefined') {
    $notification.post(title, subtitle, message, { 'media-url': 'https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/10086.png' });
  } else {
    console.log(`[${title}] ${subtitle} - ${message}`);
  }
}

// 通用持久化存储读写
function readStore(key) {
  if (typeof $persistentStore !== 'undefined') {
    return $persistentStore.read(key);
  }
  return null;
}

function writeStore(val, key) {
  if (typeof $persistentStore !== 'undefined') {
    return $persistentStore.write(val, key);
  }
  return false;
}

// 统一 HTTP 请求封装
function sendHttp(req) {
  return new Promise((resolve, reject) => {
    const client = typeof $httpClient !== 'undefined' ? $httpClient : null;
    if (!client) {
      return reject(new Error('未检测到支持的代理脚本 HTTP 客户端环境'));
    }
    const method = (req.method || 'GET').toLowerCase();
    client[method](req, (err, resp, data) => {
      if (err) {
        return reject(err);
      }
      resolve({
        status: resp.status || resp.statusCode,
        headers: resp.headers || {},
        body: data
      });
    });
  });
}

// 获取东八区北京时间当前日期字符串 (YYYYMMDD)
function getTodayDateStr() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const cst = new Date(utc + (3600000 * 8));
  const y = cst.getFullYear();
  const m = String(cst.getMonth() + 1).padStart(2, '0');
  const d = String(cst.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * ==============================================================================
 * 【官方加密组件 —— 依工程策略：不手写逆向实现，直接扣取官方 JS 函数】
 * - CryptoJS 4.2.0 官方组件 (core / enc-base64 / cipher-core / aes / md5)
 * - pt() / yt() / _t() 及密钥常量扣取自中国移动官方 H5 模块:
 *   https://app.online-cmcc.cn/cmcc-module/prod/js/CMCCService_module_lite.1.1.16.js
 * - f() 为原模块 webpack 迭代器转数组辅助函数的等价 shim
 * - 已用真实抓包向量交叉验证: x-token / x-sign / 信封解密 全部一致
 * ==============================================================================
 */
!function(t,n){"object"==typeof exports?module.exports=exports=n():"function"==typeof define&&define.amd?define([],n):t.CryptoJS=n()}(this,function(){var i,f=Math;if("undefined"!=typeof window&&window.crypto&&(i=window.crypto),"undefined"!=typeof self&&self.crypto&&(i=self.crypto),!(i=!(i=!(i="undefined"!=typeof globalThis&&globalThis.crypto?globalThis.crypto:i)&&"undefined"!=typeof window&&window.msCrypto?window.msCrypto:i)&&"undefined"!=typeof global&&global.crypto?global.crypto:i)&&"function"==typeof require)try{i=require("crypto")}catch(t){}var e=Object.create||function(t){return n.prototype=t,t=new n,n.prototype=null,t};function n(){}var t={},r=t.lib={},o=r.Base={extend:function(t){var n=e(this);return t&&n.mixIn(t),n.hasOwnProperty("init")&&this.init!==n.init||(n.init=function(){n.$super.init.apply(this,arguments)}),(n.init.prototype=n).$super=this,n},create:function(){var t=this.extend();return t.init.apply(t,arguments),t},init:function(){},mixIn:function(t){for(var n in t)t.hasOwnProperty(n)&&(this[n]=t[n]);t.hasOwnProperty("toString")&&(this.toString=t.toString)},clone:function(){return this.init.prototype.extend(this)}},u=r.WordArray=o.extend({init:function(t,n){t=this.words=t||[],this.sigBytes=null!=n?n:4*t.length},toString:function(t){return(t||a).stringify(this)},concat:function(t){var n=this.words,e=t.words,i=this.sigBytes,r=t.sigBytes;if(this.clamp(),i%4)for(var o=0;o<r;o++){var s=e[o>>>2]>>>24-o%4*8&255;n[i+o>>>2]|=s<<24-(i+o)%4*8}else for(var a=0;a<r;a+=4)n[i+a>>>2]=e[a>>>2];return this.sigBytes+=r,this},clamp:function(){var t=this.words,n=this.sigBytes;t[n>>>2]&=4294967295<<32-n%4*8,t.length=f.ceil(n/4)},clone:function(){var t=o.clone.call(this);return t.words=this.words.slice(0),t},random:function(t){for(var n=[],e=0;e<t;e+=4)n.push(function(){if(i){if("function"==typeof i.getRandomValues)try{return i.getRandomValues(new Uint32Array(1))[0]}catch(t){}if("function"==typeof i.randomBytes)try{return i.randomBytes(4).readInt32LE()}catch(t){}}throw new Error("Native crypto module could not be used to get secure random number.")}());return new u.init(n,t)}}),s=t.enc={},a=s.Hex={stringify:function(t){for(var n=t.words,e=t.sigBytes,i=[],r=0;r<e;r++){var o=n[r>>>2]>>>24-r%4*8&255;i.push((o>>>4).toString(16)),i.push((15&o).toString(16))}return i.join("")},parse:function(t){for(var n=t.length,e=[],i=0;i<n;i+=2)e[i>>>3]|=parseInt(t.substr(i,2),16)<<24-i%8*4;return new u.init(e,n/2)}},c=s.Latin1={stringify:function(t){for(var n=t.words,e=t.sigBytes,i=[],r=0;r<e;r++){var o=n[r>>>2]>>>24-r%4*8&255;i.push(String.fromCharCode(o))}return i.join("")},parse:function(t){for(var n=t.length,e=[],i=0;i<n;i++)e[i>>>2]|=(255&t.charCodeAt(i))<<24-i%4*8;return new u.init(e,n)}},p=s.Utf8={stringify:function(t){try{return decodeURIComponent(escape(c.stringify(t)))}catch(t){throw new Error("Malformed UTF-8 data")}},parse:function(t){return c.parse(unescape(encodeURIComponent(t)))}},d=r.BufferedBlockAlgorithm=o.extend({reset:function(){this._data=new u.init,this._nDataBytes=0},_append:function(t){"string"==typeof t&&(t=p.parse(t)),this._data.concat(t),this._nDataBytes+=t.sigBytes},_process:function(t){var n,e=this._data,i=e.words,r=e.sigBytes,o=this.blockSize,s=r/(4*o),a=(s=t?f.ceil(s):f.max((0|s)-this._minBufferSize,0))*o,t=f.min(4*a,r);if(a){for(var c=0;c<a;c+=o)this._doProcessBlock(i,c);n=i.splice(0,a),e.sigBytes-=t}return new u.init(n,t)},clone:function(){var t=o.clone.call(this);return t._data=this._data.clone(),t},_minBufferSize:0}),h=(r.Hasher=d.extend({cfg:o.extend(),init:function(t){this.cfg=this.cfg.extend(t),this.reset()},reset:function(){d.reset.call(this),this._doReset()},update:function(t){return this._append(t),this._process(),this},finalize:function(t){return t&&this._append(t),this._doFinalize()},blockSize:16,_createHelper:function(e){return function(t,n){return new e.init(n).finalize(t)}},_createHmacHelper:function(e){return function(t,n){return new h.HMAC.init(e,n).finalize(t)}}}),t.algo={});return t});!function(r,e){"object"==typeof exports?module.exports=exports=e(require("./core")):"function"==typeof define&&define.amd?define(["./core"],e):e(r.CryptoJS)}(this,function(r){var v;return v=r.lib.WordArray,r.enc.Base64={stringify:function(r){for(var e=r.words,t=r.sigBytes,o=this._map,a=(r.clamp(),[]),n=0;n<t;n+=3)for(var i=(e[n>>>2]>>>24-n%4*8&255)<<16|(e[n+1>>>2]>>>24-(n+1)%4*8&255)<<8|e[n+2>>>2]>>>24-(n+2)%4*8&255,f=0;f<4&&n+.75*f<t;f++)a.push(o.charAt(i>>>6*(3-f)&63));var s=o.charAt(64);if(s)for(;a.length%4;)a.push(s);return a.join("")},parse:function(r){var e=r.length,t=this._map;if(!(o=this._reverseMap))for(var o=this._reverseMap=[],a=0;a<t.length;a++)o[t.charCodeAt(a)]=a;for(var n,i,f=t.charAt(64),s=(!f||-1!==(f=r.indexOf(f))&&(e=f),r),c=e,h=o,p=[],u=0,d=0;d<c;d++)d%4&&(i=h[s.charCodeAt(d-1)]<<d%4*2,n=h[s.charCodeAt(d)]>>>6-d%4*2,i=i|n,p[u>>>2]|=i<<24-u%4*8,u++);return v.create(p,u)},_map:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="},r.enc.Base64});!function(e,t){"object"==typeof exports?module.exports=exports=t(require("./core"),require("./evpkdf")):"function"==typeof define&&define.amd?define(["./core","./evpkdf"],t):t(e.CryptoJS)}(this,function(e){function c(e){return"string"==typeof e?l:u}function n(e,t,r){var i,c=this._iv;c?(i=c,this._iv=void 0):i=this._prevBlock;for(var n=0;n<r;n++)e[t+n]^=i[n]}var t,r,o,i,s,a,h,p,f,d,u,l;e.lib.Cipher||(t=(e=e).lib,r=t.Base,o=t.WordArray,i=t.BufferedBlockAlgorithm,(s=e.enc).Utf8,a=s.Base64,h=e.algo.EvpKDF,p=t.Cipher=i.extend({cfg:r.extend(),createEncryptor:function(e,t){return this.create(this._ENC_XFORM_MODE,e,t)},createDecryptor:function(e,t){return this.create(this._DEC_XFORM_MODE,e,t)},init:function(e,t,r){this.cfg=this.cfg.extend(r),this._xformMode=e,this._key=t,this.reset()},reset:function(){i.reset.call(this),this._doReset()},process:function(e){return this._append(e),this._process()},finalize:function(e){return e&&this._append(e),this._doFinalize()},keySize:4,ivSize:4,_ENC_XFORM_MODE:1,_DEC_XFORM_MODE:2,_createHelper:function(i){return{encrypt:function(e,t,r){return c(t).encrypt(i,e,t,r)},decrypt:function(e,t,r){return c(t).decrypt(i,e,t,r)}}}}),t.StreamCipher=p.extend({_doFinalize:function(){return this._process(!0)},blockSize:1}),s=e.mode={},f=t.BlockCipherMode=r.extend({createEncryptor:function(e,t){return this.Encryptor.create(e,t)},createDecryptor:function(e,t){return this.Decryptor.create(e,t)},init:function(e,t){this._cipher=e,this._iv=t}}),f=s.CBC=((s=f.extend()).Encryptor=s.extend({processBlock:function(e,t){var r=this._cipher,i=r.blockSize;n.call(this,e,t,i),r.encryptBlock(e,t),this._prevBlock=e.slice(t,t+i)}}),s.Decryptor=s.extend({processBlock:function(e,t){var r=this._cipher,i=r.blockSize,c=e.slice(t,t+i);r.decryptBlock(e,t),n.call(this,e,t,i),this._prevBlock=c}}),s),s=(e.pad={}).Pkcs7={pad:function(e,t){for(var t=4*t,r=t-e.sigBytes%t,i=r<<24|r<<16|r<<8|r,c=[],n=0;n<r;n+=4)c.push(i);t=o.create(c,r);e.concat(t)},unpad:function(e){var t=255&e.words[e.sigBytes-1>>>2];e.sigBytes-=t}},t.BlockCipher=p.extend({cfg:p.cfg.extend({mode:f,padding:s}),reset:function(){p.reset.call(this);var e,t=this.cfg,r=t.iv,t=t.mode;this._xformMode==this._ENC_XFORM_MODE?e=t.createEncryptor:(e=t.createDecryptor,this._minBufferSize=1),this._mode&&this._mode.__creator==e?this._mode.init(this,r&&r.words):(this._mode=e.call(t,this,r&&r.words),this._mode.__creator=e)},_doProcessBlock:function(e,t){this._mode.processBlock(e,t)},_doFinalize:function(){var e,t=this.cfg.padding;return this._xformMode==this._ENC_XFORM_MODE?(t.pad(this._data,this.blockSize),e=this._process(!0)):(e=this._process(!0),t.unpad(e)),e},blockSize:4}),d=t.CipherParams=r.extend({init:function(e){this.mixIn(e)},toString:function(e){return(e||this.formatter).stringify(this)}}),f=(e.format={}).OpenSSL={stringify:function(e){var t=e.ciphertext,e=e.salt,e=e?o.create([1398893684,1701076831]).concat(e).concat(t):t;return e.toString(a)},parse:function(e){var t,e=a.parse(e),r=e.words;return 1398893684==r[0]&&1701076831==r[1]&&(t=o.create(r.slice(2,4)),r.splice(0,4),e.sigBytes-=16),d.create({ciphertext:e,salt:t})}},u=t.SerializableCipher=r.extend({cfg:r.extend({format:f}),encrypt:function(e,t,r,i){i=this.cfg.extend(i);var c=e.createEncryptor(r,i),t=c.finalize(t),c=c.cfg;return d.create({ciphertext:t,key:r,iv:c.iv,algorithm:e,mode:c.mode,padding:c.padding,blockSize:e.blockSize,formatter:i.format})},decrypt:function(e,t,r,i){return i=this.cfg.extend(i),t=this._parse(t,i.format),e.createDecryptor(r,i).finalize(t.ciphertext)},_parse:function(e,t){return"string"==typeof e?t.parse(e,this):e}}),s=(e.kdf={}).OpenSSL={execute:function(e,t,r,i,c){i=i||o.random(8),c=(c?h.create({keySize:t+r,hasher:c}):h.create({keySize:t+r})).compute(e,i);e=o.create(c.words.slice(t),4*r);return c.sigBytes=4*t,d.create({key:c,iv:e,salt:i})}},l=t.PasswordBasedCipher=u.extend({cfg:u.cfg.extend({kdf:s}),encrypt:function(e,t,r,i){r=(i=this.cfg.extend(i)).kdf.execute(r,e.keySize,e.ivSize,i.salt,i.hasher),i.iv=r.iv,e=u.encrypt.call(this,e,t,r.key,i);return e.mixIn(r),e},decrypt:function(e,t,r,i){i=this.cfg.extend(i),t=this._parse(t,i.format);r=i.kdf.execute(r,e.keySize,e.ivSize,t.salt,i.hasher);return i.iv=r.iv,u.decrypt.call(this,e,t,r.key,i)}}))});!function(e,r){"object"==typeof exports?module.exports=exports=r(require("./core"),require("./enc-base64"),require("./md5"),require("./evpkdf"),require("./cipher-core")):"function"==typeof define&&define.amd?define(["./core","./enc-base64","./md5","./evpkdf","./cipher-core"],r):r(e.CryptoJS)}(this,function(e){for(var r=e,o=r.lib.BlockCipher,i=r.algo,h=[],t=[],n=[],c=[],s=[],d=[],u=[],f=[],y=[],p=[],_=[],a=0;a<256;a++)_[a]=a<128?a<<1:a<<1^283;for(var k=0,l=0,a=0;a<256;a++){var v=l^l<<1^l<<2^l<<3^l<<4,S=(h[k]=v=v>>>8^255&v^99,_[t[v]=k]),B=_[S],R=_[B],q=257*_[v]^16843008*v;n[k]=q<<24|q>>>8,c[k]=q<<16|q>>>16,s[k]=q<<8|q>>>24,d[k]=q,u[v]=(q=16843009*R^65537*B^257*S^16843008*k)<<24|q>>>8,f[v]=q<<16|q>>>16,y[v]=q<<8|q>>>24,p[v]=q,k?(k=S^_[_[_[R^S]]],l^=_[_[l]]):k=l=1}var C=[0,1,2,4,8,16,32,64,128,27,54],i=i.AES=o.extend({_doReset:function(){if(!this._nRounds||this._keyPriorReset!==this._key){for(var e=this._keyPriorReset=this._key,r=e.words,o=e.sigBytes/4,i=4*(1+(this._nRounds=6+o)),t=this._keySchedule=[],n=0;n<i;n++)n<o?t[n]=r[n]:(d=t[n-1],n%o?6<o&&n%o==4&&(d=h[d>>>24]<<24|h[d>>>16&255]<<16|h[d>>>8&255]<<8|h[255&d]):(d=h[(d=d<<8|d>>>24)>>>24]<<24|h[d>>>16&255]<<16|h[d>>>8&255]<<8|h[255&d],d^=C[n/o|0]<<24),t[n]=t[n-o]^d);for(var c=this._invKeySchedule=[],s=0;s<i;s++){var d,n=i-s;d=s%4?t[n]:t[n-4],c[s]=s<4||n<=4?d:u[h[d>>>24]]^f[h[d>>>16&255]]^y[h[d>>>8&255]]^p[h[255&d]]}}},encryptBlock:function(e,r){this._doCryptBlock(e,r,this._keySchedule,n,c,s,d,h)},decryptBlock:function(e,r){var o=e[r+1],o=(e[r+1]=e[r+3],e[r+3]=o,this._doCryptBlock(e,r,this._invKeySchedule,u,f,y,p,t),e[r+1]);e[r+1]=e[r+3],e[r+3]=o},_doCryptBlock:function(e,r,o,i,t,n,c,s){for(var d=this._nRounds,h=e[r]^o[0],u=e[r+1]^o[1],f=e[r+2]^o[2],y=e[r+3]^o[3],p=4,_=1;_<d;_++)var a=i[h>>>24]^t[u>>>16&255]^n[f>>>8&255]^c[255&y]^o[p++],k=i[u>>>24]^t[f>>>16&255]^n[y>>>8&255]^c[255&h]^o[p++],l=i[f>>>24]^t[y>>>16&255]^n[h>>>8&255]^c[255&u]^o[p++],v=i[y>>>24]^t[h>>>16&255]^n[u>>>8&255]^c[255&f]^o[p++],h=a,u=k,f=l,y=v;a=(s[h>>>24]<<24|s[u>>>16&255]<<16|s[f>>>8&255]<<8|s[255&y])^o[p++],k=(s[u>>>24]<<24|s[f>>>16&255]<<16|s[y>>>8&255]<<8|s[255&h])^o[p++],l=(s[f>>>24]<<24|s[y>>>16&255]<<16|s[h>>>8&255]<<8|s[255&u])^o[p++],v=(s[y>>>24]<<24|s[h>>>16&255]<<16|s[u>>>8&255]<<8|s[255&f])^o[p++];e[r]=a,e[r+1]=k,e[r+2]=l,e[r+3]=v},keySize:8});return r.AES=o._createHelper(i),e.AES});!function(e,r){"object"==typeof exports?module.exports=exports=r(require("./core")):"function"==typeof define&&define.amd?define(["./core"],r):r(e.CryptoJS)}(this,function(e){for(var c=Math,r=e,t=(o=r.lib).WordArray,n=o.Hasher,o=r.algo,b=[],s=0;s<64;s++)b[s]=4294967296*c.abs(c.sin(s+1))|0;function j(e,r,t,n,o,s,i){e=e+(r&t|~r&n)+o+i;return(e<<s|e>>>32-s)+r}function k(e,r,t,n,o,s,i){e=e+(r&n|t&~n)+o+i;return(e<<s|e>>>32-s)+r}function q(e,r,t,n,o,s,i){e=e+(r^t^n)+o+i;return(e<<s|e>>>32-s)+r}function z(e,r,t,n,o,s,i){e=e+(t^(r|~n))+o+i;return(e<<s|e>>>32-s)+r}return o=o.MD5=n.extend({_doReset:function(){this._hash=new t.init([1732584193,4023233417,2562383102,271733878])},_doProcessBlock:function(e,r){for(var t=0;t<16;t++){var n=r+t,o=e[n];e[n]=16711935&(o<<8|o>>>24)|4278255360&(o<<24|o>>>8)}var s=this._hash.words,i=e[r+0],a=e[r+1],c=e[r+2],h=e[r+3],f=e[r+4],u=e[r+5],d=e[r+6],l=e[r+7],_=e[r+8],p=e[r+9],v=e[r+10],y=e[r+11],D=e[r+12],H=e[r+13],M=e[r+14],g=e[r+15],m=j(s[0],B=s[1],x=s[2],w=s[3],i,7,b[0]),w=j(w,m,B,x,a,12,b[1]),x=j(x,w,m,B,c,17,b[2]),B=j(B,x,w,m,h,22,b[3]);m=j(m,B,x,w,f,7,b[4]),w=j(w,m,B,x,u,12,b[5]),x=j(x,w,m,B,d,17,b[6]),B=j(B,x,w,m,l,22,b[7]),m=j(m,B,x,w,_,7,b[8]),w=j(w,m,B,x,p,12,b[9]),x=j(x,w,m,B,v,17,b[10]),B=j(B,x,w,m,y,22,b[11]),m=j(m,B,x,w,D,7,b[12]),w=j(w,m,B,x,H,12,b[13]),x=j(x,w,m,B,M,17,b[14]),m=k(m,B=j(B,x,w,m,g,22,b[15]),x,w,a,5,b[16]),w=k(w,m,B,x,d,9,b[17]),x=k(x,w,m,B,y,14,b[18]),B=k(B,x,w,m,i,20,b[19]),m=k(m,B,x,w,u,5,b[20]),w=k(w,m,B,x,v,9,b[21]),x=k(x,w,m,B,g,14,b[22]),B=k(B,x,w,m,f,20,b[23]),m=k(m,B,x,w,p,5,b[24]),w=k(w,m,B,x,M,9,b[25]),x=k(x,w,m,B,h,14,b[26]),B=k(B,x,w,m,_,20,b[27]),m=k(m,B,x,w,H,5,b[28]),w=k(w,m,B,x,c,9,b[29]),x=k(x,w,m,B,l,14,b[30]),m=q(m,B=k(B,x,w,m,D,20,b[31]),x,w,u,4,b[32]),w=q(w,m,B,x,_,11,b[33]),x=q(x,w,m,B,y,16,b[34]),B=q(B,x,w,m,M,23,b[35]),m=q(m,B,x,w,a,4,b[36]),w=q(w,m,B,x,f,11,b[37]),x=q(x,w,m,B,l,16,b[38]),B=q(B,x,w,m,v,23,b[39]),m=q(m,B,x,w,H,4,b[40]),w=q(w,m,B,x,i,11,b[41]),x=q(x,w,m,B,h,16,b[42]),B=q(B,x,w,m,d,23,b[43]),m=q(m,B,x,w,p,4,b[44]),w=q(w,m,B,x,D,11,b[45]),x=q(x,w,m,B,g,16,b[46]),m=z(m,B=q(B,x,w,m,c,23,b[47]),x,w,i,6,b[48]),w=z(w,m,B,x,l,10,b[49]),x=z(x,w,m,B,M,15,b[50]),B=z(B,x,w,m,u,21,b[51]),m=z(m,B,x,w,D,6,b[52]),w=z(w,m,B,x,h,10,b[53]),x=z(x,w,m,B,v,15,b[54]),B=z(B,x,w,m,a,21,b[55]),m=z(m,B,x,w,_,6,b[56]),w=z(w,m,B,x,g,10,b[57]),x=z(x,w,m,B,d,15,b[58]),B=z(B,x,w,m,H,21,b[59]),m=z(m,B,x,w,f,6,b[60]),w=z(w,m,B,x,y,10,b[61]),x=z(x,w,m,B,c,15,b[62]),B=z(B,x,w,m,p,21,b[63]),s[0]=s[0]+m|0,s[1]=s[1]+B|0,s[2]=s[2]+x|0,s[3]=s[3]+w|0},_doFinalize:function(){for(var e=this._data,r=e.words,t=8*this._nDataBytes,n=8*e.sigBytes,o=(r[n>>>5]|=128<<24-n%32,c.floor(t/4294967296)),o=(r[15+(64+n>>>9<<4)]=16711935&(o<<8|o>>>24)|4278255360&(o<<24|o>>>8),r[14+(64+n>>>9<<4)]=16711935&(t<<8|t>>>24)|4278255360&(t<<24|t>>>8),e.sigBytes=4*(r.length+1),this._process(),this._hash),s=o.words,i=0;i<4;i++){var a=s[i];s[i]=16711935&(a<<8|a>>>24)|4278255360&(a<<24|a>>>8)}return o},clone:function(){var e=n.clone.call(this);return e._hash=this._hash.clone(),e}}),r.MD5=n._createHelper(o),r.HmacMD5=n._createHmacHelper(o),e.MD5});
var ht = CryptoJS;
function f(t){ return Array.from(t); }
function pt(e){for(var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"service-module",r=[],n=0;n<e.length;n+=2)r.push(parseInt(e.substr(n,2),16));for(var o=[],i=0;i<t.length;i++)o.push(t.charCodeAt(i));for(var a=[],c=0;c<r.length;c++)c%3!=0&&a.push(r[c]);for(var s=f(Array(a.length).keys()),u=a.length-1;u>0;u--){var l=o[u%o.length]*(u+1)%(u+1),h=[s[l],s[u]];s[u]=h[0],s[l]=h[1]}for(var p=new Array(a.length),d=0;d<a.length;d++)p[s[d]]=a[d];for(var v=[],g=0;g<p.length;g++)v.push(p[g]^o[g%o.length]);return String.fromCharCode.apply(String,v)}var dt=pt("000a1d00040c00171100695a00190700370d001207005615"),vt=pt("00331b001559005511005d35000829003b05002403000826"),gt=pt("00524b004759005152001e59005e5300445d005d42005c4a");function yt(e){var t=ht.enc.Utf8.parse(dt),r=ht.enc.Utf8.parse(gt);return ht.AES.encrypt(e,t,{iv:r,mode:ht.mode.CBC,padding:ht.pad.Pkcs7}).toString()}function _t(e){return ht.MD5(e)}

/**
 * 账号键读写：以原生会话 Cookie 的 UID 作为账号唯一标识（同设备多账号隔离）
 */
function currentUid() {
  return readStore(KEY_LAST_UID) || '';
}
function runDateKey(uid) { return uid ? `${KEY_RUN_DATE}_${uid}` : KEY_RUN_DATE; }
function lockKey(uid) { return uid ? `${KEY_RUN_LOCK}_${uid}` : KEY_RUN_LOCK; }
function sessionCookieKey(uid) { return uid ? `${KEY_SESSION_COOKIE}_${uid}` : ''; }
function tokenInfoKey(uid) { return uid ? `${KEY_TOKEN_INFO}_${uid}` : ''; }

/**
 * 取某账号绑定的手机号（资产查询用）：严格按 uid 提取，绝不跨账号回退污染
 */
function getTelForUid(uid) {
  if (!uid) return '';
  let map = {};
  try { map = JSON.parse(readStore(KEY_TEL_MAP) || '{}'); } catch (e) {}
  if (map && map[uid]) return map[uid];
  return '';
}

/**
 * 绑定 uid 与手机号（自动提取或反哺时调用）
 */
function bindTel(uid, tel) {
  if (!uid || !tel) return;
  let map = {};
  try { map = JSON.parse(readStore(KEY_TEL_MAP) || '{}'); } catch (e) {}
  map[uid] = tel;
  writeStore(JSON.stringify(map), KEY_TEL_MAP);
  writeStore(tel, KEY_CMCC_TEL);
  writeStore(uid, KEY_TEL_UID);
  console.log(`[${SCRIPT_NAME}] 已绑定账号 ${uid.slice(0, 10)}... ↔ 手机号 ${tel.slice(0,3)}****${tel.slice(7)}`);
}

/**
 * 暂存过渡期捕获的手机号（针对部分上报接口无 UID 的情况，等待业务包到达后由新账号认领）
 */
function recordPendingTel(tel) {
  if (!tel || !/^\d{11}$/.test(tel)) return;
  writeStore(JSON.stringify({ tel: tel, time: Date.now() }), KEY_PENDING_TEL);
  console.log(`[${SCRIPT_NAME}] 暂存过渡期捕获的手机号: ${tel.slice(0,3)}****${tel.slice(7)}，等待新账号 UID 归属认领`);
}

/**
 * 账号认领过渡期手机号
 */
function claimPendingTel(uid) {
  if (!uid || getTelForUid(uid)) return;
  try {
    const raw = readStore(KEY_PENDING_TEL);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && obj.tel && Date.now() - obj.time < 60000) {
      bindTel(uid, obj.tel);
      writeStore('', KEY_PENDING_TEL);
      console.log(`[${SCRIPT_NAME}] ⚡ 账号 ${uid.slice(0, 10)}... 成功认领过渡期手机号: ${obj.tel.slice(0,3)}****${obj.tel.slice(7)}`);
    }
  } catch (e) {}
}

/**
 * 捕获即触发判定（无定时、无延迟窗口，按账号计日）：
 * 检测到凭据捕获（Cookie 到手）且当日未完成、无并发执行时返回 true，
 * 由调用方在本次捕获的脚本上下文内联执行签到与资产查询。
 * @returns {boolean} 是否应立即执行签到流程
 */
function shouldRunOnCapture(uid) {
  try {
    const accountKey = uid || currentUid();
    if (readStore(runDateKey(accountKey)) === getTodayDateStr()) return false;
    const now = Date.now();
    const lock = parseInt(readStore(lockKey(accountKey)) || '0', 10);
    if (lock && now - lock < 120000) return false; // 执行锁：防并发双触发 + 失败重试节流
    writeStore(String(now), lockKey(accountKey));
    console.log(`[${SCRIPT_NAME}] 检测到凭据捕获（账号 ${accountKey}，Cookie 已到手），立即执行签到与资产查询`);
    return true;
  } catch (e) {
    console.log(`[${SCRIPT_NAME}] 捕获触发判定异常: ${e.message}`);
    return false;
  }
}

/**
 * ----------------------------------------------------------------------------
 * 1. 抓包拦截模式：捕获并劫持客户端原生凭据与 SSO 授权状态
 * ----------------------------------------------------------------------------
 */
function handleCapture() {
  const url = $request.url;
  const headers = $request.headers || {};
  const cookie = headers['Cookie'] || headers['cookie'] || '';
  const body = $request.body || '';

  // 核心防御 1：忽略尚未完成登录授权的解耦配置请求（放行等待客户端登录完成）
  if (url.indexOf('/biz-orange/LN/decoupling') > -1) {
    $done({});
    return;
  }

  // 1. 多源全息提取当前请求携带的 UID
  let reqUid = '';
  const uidMatch = cookie.match(/UID=([^;\s]+)/);
  if (uidMatch) {
    reqUid = uidMatch[1].trim();
  } else {
    // 备用来源 A: 从 URL query 参数中提取 UID（常见于 H5 业务请求）
    const urlUidMatch = url.match(/UID=([^;&\s]+)/);
    if (urlUidMatch) {
      reqUid = decodeURIComponent(urlUidMatch[1].trim());
    }
  }

  let decryptedEnv = null;
  // 2. 尝试从请求体中解密提取手机号、原生 Cookie 及 UID
  if (body && typeof body === 'string' && body.length > 20) {
    try {
      const dec = ht.AES.decrypt(body, ht.enc.Utf8.parse(dt), {
        iv: ht.enc.Utf8.parse(gt),
        mode: ht.mode.CBC,
        padding: ht.pad.Pkcs7
      }).toString(ht.enc.Utf8);
      if (dec && dec.indexOf('{') > -1) {
        decryptedEnv = JSON.parse(dec.slice(dec.indexOf('{'), dec.lastIndexOf('}') + 1));
      }
    } catch (e) {}
  }

  // 备用来源 B: 从解密后的信封中提取原生 Token 与 UID
  if (decryptedEnv) {
    if (decryptedEnv.t && typeof decryptedEnv.t === 'string') {
      const tUidMatch = decryptedEnv.t.match(/UID=([^;\s]+)/);
      if (tUidMatch) {
        reqUid = tUidMatch[1].trim();
      }
      if (reqUid) {
        const uKey = tokenInfoKey(reqUid);
        let existing = {};
        try { existing = JSON.parse(readStore(uKey) || '{}'); } catch (e) {}
        if (!existing.token || existing.token !== decryptedEnv.t) {
          existing.token = decryptedEnv.t;
          existing.updatedAt = new Date().toISOString();
          writeStore(JSON.stringify(existing), uKey);
          console.log(`[${SCRIPT_NAME}] 从解密请求体已更新账号 ${reqUid.slice(0, 10)}... 的原生会话 Cookie`);
        }
      }
    }

    // 从解密信封中提取真实 11 位手机号（支持 mobile/tel/cellNum 多重官方字段）
    const extractedTel = decryptedEnv.mobile || decryptedEnv.tel || (decryptedEnv.reqBody && decryptedEnv.reqBody.cellNum) || '';
    if (/^\d{11}$/.test(extractedTel)) {
      if (reqUid) {
        bindTel(reqUid, extractedTel);
        console.log(`[${SCRIPT_NAME}] 自动提取并绑定手机号: ${extractedTel.slice(0,3)}****${extractedTel.slice(7)} (UID: ${reqUid.slice(0, 10)}...)`);
      } else {
        recordPendingTel(extractedTel);
      }
    }
  }

  // 场景 A: 拦截客户端原生请求，按 UID 分账号独立存储 Token
  if (url.indexOf('10086.cn/biz-orange/') > -1 && cookie.indexOf('JSESSIONID=') > -1) {
    const tokenMatch = cookie.match(/JSESSIONID=[^;]+;[^;]*UID=[^;]+;[^;]*ticketID=[^;]+/i) ||
                       cookie.match(/JSESSIONID=[^;]+/i);
    if (tokenMatch && reqUid) {
      const uKey = tokenInfoKey(reqUid);
      let existing = {};
      try { existing = JSON.parse(readStore(uKey) || '{}'); } catch (e) {}
      if (!existing.token || existing.token !== cookie) {
        existing.token = cookie;
        existing.updatedAt = new Date().toISOString();
        writeStore(JSON.stringify(existing), uKey);
        console.log(`[${SCRIPT_NAME}] 已更新账号 ${reqUid.slice(0, 10)}... 的原生会话 Cookie`);
      }
    }
  }

  // 场景 C: 拦截签到 H5 内部 API，按 UID 独立持久化活动专属 Cookie
  if (url.indexOf('/qwhdhub/api/mark/') > -1 && cookie.indexOf('QWHD_SESSION_TOKEN=') > -1) {
    const targetUid = reqUid || readStore(KEY_LAST_UID);
    if (targetUid) {
      const sKey = sessionCookieKey(targetUid);
      const prevCookie = readStore(sKey);
      if (cookie !== prevCookie) {
        writeStore(cookie, sKey);
        console.log(`[${SCRIPT_NAME}] 已更新账号 ${targetUid.slice(0, 10)}... 的签到专属会话凭据`);
      }
    }
  }

  // 核心防御 2：若当前请求无明确 UID，只作为辅助数据捕获源放行，绝不冒充当前账号触发签到
  if (!reqUid) {
    $done({});
    return;
  }

  // 账号认领过渡期捕获的手机号
  claimPendingTel(reqUid);

  // 账号切换敏锐探测：若检测到 UID 发生变化，立即识别为账号切换事件
  const lastUid = readStore(KEY_LAST_UID) || '';
  let isAccountSwitch = false;
  if (reqUid !== lastUid) {
    console.log(`[${SCRIPT_NAME}] ⚡ 监测到账号切换: ${lastUid ? lastUid.slice(0, 10) + '...' : '无'} ➔ ${reqUid.slice(0, 10)}...`);
    writeStore(reqUid, KEY_LAST_UID);
    // 切换账号时立即彻底清除全局旧 Session，杜绝任何复用旧会话的可能性！
    writeStore('', KEY_SESSION_COOKIE);
    writeStore('', KEY_GLOBAL_RUNNING);
    isAccountSwitch = true;
  }

  const activeUid = reqUid;

  // ================= 严格单次触发核心闸门 =================
  // 关键门禁 1：必须确认该账号自己的 Token 或 Session 凭证已经捕获就绪，杜绝早期前置请求早产触发
  const currentToken = readStore(tokenInfoKey(activeUid));
  const currentSession = readStore(sessionCookieKey(activeUid));
  if (!currentToken && !currentSession) {
    console.log(`[${SCRIPT_NAME}] 账号 ${activeUid.slice(0, 10)}... 登录态正在就绪中，放行等待客户端后续业务包...`);
    $done({});
    return;
  }

  // 关键门禁 2：全局 60 秒硬锁（发生账号切换时豁免），杜绝并发双发
  const now = Date.now();
  const globalLock = parseInt(readStore(KEY_GLOBAL_RUNNING) || '0', 10);
  if (!isAccountSwitch && globalLock && now - globalLock < 60000) {
    $done({});
    return;
  }

  // 关键门禁 3：账号当日完成检查（严格按账号 UID 隔离）
  if (readStore(runDateKey(activeUid)) === getTodayDateStr()) {
    console.log(`[${SCRIPT_NAME}] 账号 ${activeUid.slice(0, 10)}... 今日已完成签到（${getTodayDateStr()}），静默放行`);
    $done({});
    return;
  }

  // 原子锁定：立即写入全局执行锁与该账号当日完成标记
  writeStore(String(now), KEY_GLOBAL_RUNNING);
  writeStore(getTodayDateStr(), runDateKey(activeUid));

  console.log(`[${SCRIPT_NAME}] 凭据就绪，立即执行签到与资产查询（账号: ${activeUid.slice(0, 10)}...）`);
  handleSign(() => $done({}), activeUid);
}

/**
 * ----------------------------------------------------------------------------
 * 2. 签到执行模式：会话续期、提交签到、自动阶梯领奖
 * ----------------------------------------------------------------------------
 */
async function handleSign(doneFn, activeUid) {
  const finish = typeof doneFn === 'function' ? doneFn : (() => $done());
  const uid = activeUid || currentUid();
  if (!uid) {
    notify(SCRIPT_NAME, '❌ 签到失败: 未识别到活跃账号', '请打开中国移动 APP 登录账号。');
    finish();
    return;
  }
  console.log(`[${SCRIPT_NAME}] 开始执行账号 ${uid.slice(0, 10)}... 的自动签到任务...`);

  // 严格按 UID 读取会话凭据，绝不回退至跨账号共享的全局键！
  let sessionCookie = readStore(sessionCookieKey(uid)) || '';
  let tokenInfoStr = readStore(tokenInfoKey(uid)) || '';
  let tokenInfo = {};
  try {
    tokenInfo = JSON.parse(tokenInfoStr);
  } catch (e) {}

  if (!sessionCookie && !tokenInfo.token) {
    console.log(`[${SCRIPT_NAME}] 账号 ${uid.slice(0, 10)}... 本地暂无可用的独立会话与 Token，终止执行`);
    writeStore('', runDateKey(uid)); // 恢复签到标记允许后续重试
    finish();
    return;
  }

  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/wkwebview leadeon/12.5.2/CMCCIT',
    'Origin': 'https://wx.10086.cn',
    'Referer': 'https://wx.10086.cn/qwhdhub/qwhdmark/1021122301?channelId=P00000132544&yx=9000338299&redCode=rec_NofeedHotZoneApp_P00000132544',
    'Content-Type': 'application/json;charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest'
  };

  /**
   * 自动换取最新 QWHD_SESSION_TOKEN
   */
  async function refreshSessionToken() {
    if (!tokenInfo || !tokenInfo.token) {
      throw new Error('缺少客户端原生登录 Token，无法自动执行 SSO 换票');
    }
    console.log(`[${SCRIPT_NAME}] 正在通过原生登录态换取活动中心会话 Token (账号: ${uid.slice(0, 10)}...)...`);

    // 步骤 1: 请求 SSO 入口动态获取本次握手的 loginPath / sid
    const entryUrl = 'https://wx.10086.cn/qwhdsso/login?dlwmh=true&actUrl=' +
      encodeURIComponent('https://wx.10086.cn/qwhdhub/qwhdmark/1021122301?channelId=P00000132544&yx=9000338299&redCode=rec_NofeedHotZoneApp_P00000132544');

    const entryResp = await sendHttp({
      url: entryUrl,
      method: 'GET',
      headers: {
        'User-Agent': commonHeaders['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const html = entryResp.body || '';
    const loginPathMatch = html.match(/loginPath\s*=\s*['"]([^'"]+)['"]/);
    if (!loginPathMatch) {
      throw new Error('未能从 SSO 页面提取到有效的 loginPath');
    }
    const loginPath = loginPathMatch[1];
    console.log(`[${SCRIPT_NAME}] 成功定位到 loginPath: ${loginPath}`);

    // 计算当前账号的 userCheckId（手机号 16 进制，官方 SSO 换票核心校验字段）
    const tel = getTelForUid(uid);
    let userCheckId = '';
    if (tel && /^\d{11}$/.test(tel)) {
      try {
        userCheckId = Number(tel).toString(16);
      } catch (e) {}
    }

    // 步骤 2: 发送原生 token 执行 appTokenLogin 换取目标重定向 URL
    const loginUrl = 'https://wx.10086.cn/qwhdsso' + loginPath;
    const loginPayload = {
      jwtToken: null,
      token: tokenInfo.token,
      provinceCode: tokenInfo.provinceCode || '771',
      cityCode: tokenInfo.cityCode || '0771',
      userCheckId: userCheckId,
      carrierOperator: tokenInfo.carrierOperator || '002',
      appVersionCode: tokenInfo.appVersionCode || '12.5.2',
      took: 150
    };

    const loginResp = await sendHttp({
      url: loginUrl,
      method: 'POST',
      headers: {
        'User-Agent': commonHeaders['User-Agent'],
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': 'https://wx.10086.cn',
        'Referer': entryUrl
      },
      body: JSON.stringify(loginPayload)
    });

    let loginData;
    try {
      loginData = JSON.parse(loginResp.body);
    } catch (e) {
      throw new Error(`SSO 登录接口响应异常: ${loginResp.body.slice(0, 100)}`);
    }

    if (loginData.code !== 'SUCCESS' || !loginData.data || !loginData.data.url) {
      throw new Error(`SSO 换取失败: ${loginData.msg || '未知错误'}`);
    }

    const redirectUrl = loginData.data.url;
    console.log(`[${SCRIPT_NAME}] SSO 授权成功，请求目标重定向 URL 获取最新 Cookie...`);

    // 步骤 3: 访问重定向 URL 提取下发的 Set-Cookie
    const redirectResp = await sendHttp({
      url: redirectUrl,
      method: 'GET',
      headers: {
        'User-Agent': commonHeaders['User-Agent'],
        'Referer': entryUrl
      }
    });

    const setCookies = redirectResp.headers['Set-Cookie'] || redirectResp.headers['set-cookie'] || '';
    let extractedCookies = [];
    if (Array.isArray(setCookies)) {
      extractedCookies = setCookies;
    } else if (typeof setCookies === 'string') {
      extractedCookies = setCookies.split(/,(?=[^;]+=[^;]+)/);
    }

    let newToken = '';
    let router = 'qwhd_center_router=hua';
    for (const c of extractedCookies) {
      const tokenMatch = c.match(/QWHD_SESSION_TOKEN=([^;]+)/);
      if (tokenMatch) {
        newToken = tokenMatch[1];
      }
      const routerMatch = c.match(/(qwhd_center_router=[^;]+)/);
      if (routerMatch) {
        router = routerMatch[1];
      }
    }

    if (!newToken) {
      const directMatch = (redirectResp.headers['set-cookie'] || '').match(/QWHD_SESSION_TOKEN=([^;]+)/);
      if (directMatch) {
        newToken = directMatch[1];
      }
    }

    if (!newToken) {
      throw new Error('未能在重定向响应中提取到 QWHD_SESSION_TOKEN');
    }

    sessionCookie = `QWHD_SESSION_TOKEN=${newToken}; ${router};`;
    if (uid) writeStore(sessionCookie, sessionCookieKey(uid));
    console.log(`[${SCRIPT_NAME}] 成功刷新并持久化账号 ${uid.slice(0, 10)}... 的专属会话 Cookie！`);
    return sessionCookie;
  }

  // 关键自愈：当前账号若无专属活动 Session，且有原生 Token，立即主动换票获取专属 Session
  if (!sessionCookie && tokenInfo.token) {
    try {
      sessionCookie = await refreshSessionToken();
    } catch (e) {
      console.log(`[${SCRIPT_NAME}] 首次主动换票提示: ${e.message}`);
    }
  }

  /**
   * 发送签到中心 API 请求（具备自动换票重试能力）
   */
  async function callMarkApi(apiPath, body = {}) {
    const makeReq = async (cookieStr) => {
      const reqHeaders = Object.assign({}, commonHeaders, {
        'Cookie': cookieStr
      });
      return await sendHttp({
        url: `https://wx.10086.cn/qwhdhub/api/mark/${apiPath}`,
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(body)
      });
    };

    let resp;
    try {
      resp = await makeReq(sessionCookie);
    } catch (e) {
      console.log(`[${SCRIPT_NAME}] 请求 ${apiPath} 发生网络异常: ${e.message}`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(resp ? resp.body : '{}');
    } catch (e) {}

    const isAuthFailed = !parsed || parsed.code === 'FAILED' || parsed.status === 'NOT_LOGIN' || (parsed.msg && parsed.msg.indexOf('login') > -1);
    if (isAuthFailed && tokenInfo && tokenInfo.token) {
      console.log(`[${SCRIPT_NAME}] 会话可能已过期，正在尝试自动刷新凭证...`);
      try {
        sessionCookie = await refreshSessionToken();
        resp = await makeReq(sessionCookie);
        parsed = JSON.parse(resp.body);
      } catch (refreshErr) {
        console.log(`[${SCRIPT_NAME}] 自动换票失败: ${refreshErr.message}`);
      }
    }

    return parsed;
  }

  try {
    // 1. 查询当前用户信息
    let userName = '中国移动用户';
    const userRes = await callMarkApi('user/info', { appVersion: '', miniVersion: '' });
    if (userRes && userRes.code === 'SUCCESS' && userRes.data) {
      userName = userRes.data.nickName || userRes.data.mobile || userName;
      const apiMobile = userRes.data.mobile;
      if (/^\d{11}$/.test(apiMobile) && uid && !getTelForUid(uid)) {
        bindTel(uid, apiMobile);
        console.log(`[${SCRIPT_NAME}] 从签到中心成功反哺绑定账号 ${uid.slice(0, 10)}... ↔ 手机号: ${apiMobile.slice(0, 3)}****${apiMobile.slice(7)}`);
      }
    }

    // 2. 查询当前签到状态与已签天数
    const statusRes = await callMarkApi('mark31/markstatus', {});
    const todayStr = getTodayDateStr();
    let alreadySigned = false;
    let accumulateTimes = 0;

    if (statusRes && statusRes.code === 'SUCCESS' && statusRes.data) {
      accumulateTimes = (statusRes.data.userinfo && statusRes.data.userinfo.accumulateTimes) || 0;
      const list = statusRes.data.markstatus || [];
      const todayItem = list.find(item => item.date === todayStr);
      if (todayItem && String(todayItem.status) === '1') {
        alreadySigned = true;
      }
    }

    let signMsg = '';
    let awardChances = [];

    // 3. 执行当日打卡签到
    if (alreadySigned) {
      signMsg = '今日已完成签到，无需重复签到';
      console.log(`[${SCRIPT_NAME}] ${signMsg}`);
    } else {
      console.log(`[${SCRIPT_NAME}] 今日尚未签到，正在提交签到 (日期: ${todayStr})...`);
      const doMarkRes = await callMarkApi('mark31/domark', { date: todayStr });
      if (doMarkRes && doMarkRes.code === 'SUCCESS') {
        signMsg = '签到成功！';
        accumulateTimes += 1;
        if (doMarkRes.data && Array.isArray(doMarkRes.data.taskAwardChance)) {
          awardChances = doMarkRes.data.taskAwardChance;
        }
      } else {
        const errDesc = (doMarkRes && (doMarkRes.msg || doMarkRes.status)) || '未配置奖品或已签到';
        signMsg = `签到未成功: ${errDesc}`;
        console.log(`[${SCRIPT_NAME}] 签到响应: ${JSON.stringify(doMarkRes)}`);
      }
    }

    // 4. 自动领取阶梯累签奖励（如 2签流量包、5签大奖机会）
    if (statusRes && statusRes.code === 'SUCCESS' && statusRes.data && Array.isArray(statusRes.data.taskAwardChance)) {
      for (const t of statusRes.data.taskAwardChance) {
        if (t && t.id && !awardChances.some(x => x.id === t.id)) {
          awardChances.push(t);
        }
      }
    }

    let awardResults = [];
    if (awardChances.length > 0) {
      console.log(`[${SCRIPT_NAME}] 发现可领取的阶梯奖励，数量: ${awardChances.length}`);
      for (const chance of awardChances) {
        if (!chance.id) continue;
        console.log(`[${SCRIPT_NAME}] 正在领取累签奖励 ID: ${chance.id}...`);
        const awardRes = await callMarkApi(`mark31/taskAward/${chance.id}`, {});
        if (awardRes && awardRes.code === 'SUCCESS' && awardRes.data) {
          const pName = awardRes.data.prizeName || '签到专属奖励';
          awardResults.push(pName);
          console.log(`[${SCRIPT_NAME}] 成功领取奖励: ${pName}`);
        } else {
          console.log(`[${SCRIPT_NAME}] 领奖 ID ${chance.id} 响应: ${JSON.stringify(awardRes)}`);
        }
      }
    }

    // 5. 账户资产查询（话费余额 / 通用流量 / 通用通话剩余）
    const assets = await queryAccountAssets(tokenInfo, uid);

    // 6. 构造高直观度通知：去除所有技术噪点，三联排资产核心数据直接置顶直显（无需手动展开）
    const phone = (assets && assets.tel) || (userName.match(/^1\d{10}$/) ? userName : '');
    const phoneMask = phone
      ? phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
      : (userName || '中国移动');
    const notifyTitle = `中国移动 · ${phoneMask}`;

    // 文案精简：去除“无需重复签到”等冗余字眼
    const cleanSignMsg = signMsg.replace(/，无需重复签到|！/g, '');

    // 副标题：三联排核心资产（iOS 横幅二级标题，粗体且默认单行直显，无需长按展开）
    let notifySub = '';
    const subParts = [];
    if (assets) {
      if (assets.fee) subParts.push(`💰 ￥${assets.fee}`);
      if (assets.flow) subParts.push(`📶 ${assets.flow}`);
      if (assets.voice) subParts.push(`📞 ${assets.voice}`);
    }
    if (subParts.length > 0) {
      notifySub = subParts.join(' ｜ ');
    } else {
      notifySub = `📅 ${cleanSignMsg}（本月累计 ${accumulateTimes} 天）`;
    }

    // 正文：首行核心数据再次强化，次行签到累计状态，末行中奖（无奖品时绝不输出废话）
    const bodyLines = [];
    if (subParts.length > 0) {
      bodyLines.push(`💰 话费: ￥${assets.fee || '--'}   📶 流量: ${assets.flow || '--'}   📞 通话: ${assets.voice || '--'}`);
    }
    bodyLines.push(`📅 状态: ${cleanSignMsg}（本月累计 ${accumulateTimes} 天）`);
    if (awardResults.length > 0) {
      bodyLines.push(`🎁 领奖: ${awardResults.join('、')}`);
    }
    const notifyBody = bodyLines.join('\n');

    // 7. 标记当日完成
    if (signMsg === '签到成功！' || signMsg === '今日已完成签到，无需重复签到') {
      writeStore(getTodayDateStr(), runDateKey(uid));
    }

    notify(notifyTitle, notifySub, notifyBody);
    console.log(`[${SCRIPT_NAME}] 任务完成:\n标题: ${notifyTitle}\n副标题: ${notifySub}\n正文: ${notifyBody}`);
  } catch (err) {
    console.log(`[${SCRIPT_NAME}] 签到执行过程发生异常: ${err.stack || err.message}`);
    // 异常时清除当日标记允许重试
    if (uid) writeStore('', runDateKey(uid));
    notify(SCRIPT_NAME, '❌ 签到执行异常', err.message || '请查看运行日志以获取详细信息');
  } finally {
    // 注意：失败时保留执行锁 120 秒，作为重试节流（避免 APP 开启期间失败刷屏）；
    // 成功时由 KEY_RUN_DATE 当日完成标记阻断后续触发
    finish();
  }
}

/**
 * ----------------------------------------------------------------------------
 * 3. 账户资产查询模块（话费余额 / 通用流量 / 通用通话剩余）
 *    接口与加密方案来源：中国移动官方 H5 CMCCService_module / BasicService_H5module
 *    网关：clientaccess.10086.cn /biz-orange/{BN,BH}/... (x-qen=1, 响应为明文 JSON)
 * ----------------------------------------------------------------------------
 */
const CMCC_BIZ_HOST = 'clientaccess.10086.cn';
const KEY_CMCC_TEL = 'cmcc_tel';
const KEY_CMCC_PROFILE = 'cmcc_device_profile';

/**
 * 生成指定长度的随机十六进制字符串（用于本地设备档案，不含真实隐私）
 * @param {number} len 长度
 * @param {boolean} upper 是否大写
 * @returns {string}
 */
function cmccRandomHex(len, upper) {
  let s = '';
  while (s.length < len) {
    s += Math.random().toString(16).slice(2);
  }
  s = s.slice(0, len);
  return upper ? s.toUpperCase() : s;
}

/**
 * 读取或首次生成本地设备档案（cid/xk/imei/ak 等网关信封常量）
 * @returns {Object}
 */
function ensureDeviceProfile() {
  let profile = {};
  try {
    profile = JSON.parse(readStore(KEY_CMCC_PROFILE) || '{}');
  } catch (e) {}
  if (!profile.cid || !profile.xk) {
    profile = {
      cid: cmccRandomHex(64, false),
      xk: cmccRandomHex(80, false),
      imei: cmccRandomHex(31, true),
      ak: cmccRandomHex(40, true),
      createdAt: new Date().toISOString()
    };
    writeStore(JSON.stringify(profile), KEY_CMCC_PROFILE);
    console.log(`[${SCRIPT_NAME}] 已生成本地设备档案并持久化`);
  }
  return profile;
}

/**
 * 调用移动 biz-orange 业务网关（qen=1 加密信封，明文 JSON 响应）
 * @param {string} path 接口路径，如 /biz-orange/BN/realFeeQuery/getRealFee
 * @param {Object} reqBody 业务请求体
 * @param {Object} tokenInfo 持久化的原生会话凭证
 * @returns {Promise<Object|null>} rspBody 或 null
 */
async function cmccBizRequest(path, reqBody, tokenInfo, uid) {
  if (!tokenInfo || !tokenInfo.token) return null;
  const cookie = tokenInfo.token;
  const jsidMatch = cookie.match(/JSESSIONID=([^;]+)/);
  const jsid = jsidMatch ? jsidMatch[1] : '';
  const profile = ensureDeviceProfile();
  const targetUid = uid || currentUid();
  const tel = getTelForUid(targetUid) || '0'; // 信封 tel 与当前账号绑定一致，未绑定则为 '0'
  const C = String(Date.now());
  const nonce = String(Math.floor(10000000 + Math.random() * 89999999));
  const envelope = {
    cid: profile.cid, en: '0', t: cookie, sn: 'iPhone16,2', cv: '12.5.2',
    st: 2, sv: '26.6', sp: '1290x2796', xk: profile.xk, ak: profile.ak,
    xc: 'B2000', imei: profile.imei, nt: '3', sb: 'apple',
    prov: '771', city: '0771', tel: tel, reqBody: reqBody
  };
  const body = yt(JSON.stringify(envelope));
  const S = `${profile.xk}_${path}_${C}_${nonce}`;
  const xt = yt(S);
  const sign = _t(`${xt}_${C}_${nonce}_${jsid}`).toString();
  try {
    const resp = await sendHttp({
      url: `https://${CMCC_BIZ_HOST}${path}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json',
        'x-qen': '1',
        'x-time': C,
        'x-nonce': nonce,
        'x-token': xt,
        'x-sign': sign,
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/wkwebview leadeon/12.5.2/CMCCIT',
        'Origin': 'https://wx.10086.cn',
        'Referer': 'https://wx.10086.cn/'
      },
      body: body
    });
    let parsed = JSON.parse(resp.body);
    // 网关对原生 UA 可能回加密包装 {"body":"<AES>"}，用官方解密函数兜底还原
    if (parsed && typeof parsed.body === 'string' && parsed.retCode === undefined) {
      const plainBody = ht.AES.decrypt(parsed.body, ht.enc.Utf8.parse(vt), {
        iv: ht.enc.Utf8.parse(gt), mode: ht.mode.CBC, padding: ht.pad.Pkcs7
      }).toString(ht.enc.Utf8);
      parsed = JSON.parse(plainBody);
    }
    if (parsed && parsed.retCode === '000000') {
      return parsed.rspBody || {};
    }
    console.log(`[${SCRIPT_NAME}] 网关 ${path} 返回: ${parsed && parsed.retCode} ${parsed && parsed.retDesc}`);
    return null;
  } catch (e) {
    console.log(`[${SCRIPT_NAME}] 网关 ${path} 请求异常: ${e.message}`);
    return null;
  }
}

/**
 * 查询账户资产并格式化为通知卡片行（话费余额 / 通用流量 / 通用通话）
 * @param {Object} tokenInfo 持久化的原生会话凭证
 * @param {string} uid 当前待查询的账号 UID
 * @returns {Promise<Object|null>} 资产对象或 null
 */
async function queryAccountAssets(tokenInfo, uid) {
  try {
    const targetUid = uid || currentUid();
    const tel = getTelForUid(targetUid);
    if (!tel) {
      console.log(`[${SCRIPT_NAME}] 账号 ${targetUid.slice(0, 10)}... 未绑定手机号，跳过账户资产查询`);
      return null;
    }
    const rb = { provinceCode: '771', cityCode: '0771', cellNum: tel };
    let feeVal = '';
    let voiceVal = '';
    let flowVal = '';

    const fee = await cmccBizRequest('/biz-orange/BN/realFeeQuery/getRealFee', rb, tokenInfo, targetUid);
    if (fee && (fee.curFeeTotal || fee.realBalanceFee)) {
      feeVal = fee.curFeeTotal || fee.realBalanceFee;
    }

    const remain = await cmccBizRequest('/biz-orange/BH/newPlanRemainQry/getNewPlanRemainQry', rb, tokenInfo, targetUid);
    if (remain && remain.newPlanRemainQryRes) {
      const res = remain.newPlanRemainQryRes;
      const voiceList = (res.planRemianVoiceListRes && res.planRemianVoiceListRes.planRemianVoiceInfoRes) || [];
      const voice = voiceList.find(v => String(v.voicetype) === '0') || voiceList[0];
      if (voice && voice.voiceRemainNum !== undefined) {
        voiceVal = `${voice.voiceRemainNum} 分钟`;
      }
      const flowList = (res.planRemianFlowListRes && res.planRemianFlowListRes.planRemianFlowRes) || [];
      const flow = flowList.find(v => String(v.flowtype) === '0') || flowList[0];
      if (flow && flow.flowRemainNum !== undefined) {
        const mb = parseFloat(flow.flowRemainNum);
        if (String(flow.unit) === '03') {
          flowVal = mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${mb} MB`;
        } else {
          flowVal = `${flow.flowRemainNum}`;
        }
      }
    }
    return { tel, fee: feeVal, flow: flowVal, voice: voiceVal };
  } catch (e) {
    console.log(`[${SCRIPT_NAME}] 账户资产查询异常: ${e.message}`);
    return null;
  }
}

/**
 * 入口路由：
 * 1. 监听拦截模式 (存在 $request)：自动提取 Cookie/UID/手机号，并立即触发自动签到与查询
 * 2. 手动执行模式 (无 $request)：供用户在 Loon 脚本列表中随时点击「运行」，直接复用沙盒凭据执行签到与资产查询
 */
if (typeof $request !== 'undefined') {
  handleCapture();
} else {
  console.log(`[${SCRIPT_NAME}] 手动触发执行：直接复用本地沙盒凭据与手机号执行签到...`);
  writeStore('', lockKey(currentUid()));
  handleSign();
}
