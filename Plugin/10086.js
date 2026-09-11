/**
 * @fileoverview 中国移动客户端多重凭证自动劫持与活动中心每日自动签到
 * @author Jane-Rui
 * @version 1.0.0
 * @date 2026-09-11
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
 *    - 汇总签到状态、累计天数、到手奖品，推送系统通知。
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
const KEY_LAST_CAPTURE = 'cmcc_sign_last_capture_time';

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
 * ----------------------------------------------------------------------------
 * 1. 抓包拦截模式：捕获并劫持客户端原生凭据与 SSO 授权状态
 * ----------------------------------------------------------------------------
 */
function handleCapture() {
  const url = $request.url;
  const headers = $request.headers || {};
  const cookie = headers['Cookie'] || headers['cookie'] || '';
  const now = Date.now();
  const lastCapture = parseInt(readStore(KEY_LAST_CAPTURE) || '0', 10);

  let captured = false;
  let captureType = '';

  // 场景 A: 拦截 H5 活动中心 SSO 授权接口 (获取完整用户会话及省市地域参数)
  if (url.indexOf('/qwhdsso/appTokenLogin') > -1 && $request.body) {
    try {
      const bodyObj = typeof $request.body === 'string' ? JSON.parse($request.body) : $request.body;
      if (bodyObj && bodyObj.token) {
        const tokenPayload = {
          token: bodyObj.token,
          provinceCode: bodyObj.provinceCode || '771',
          cityCode: bodyObj.cityCode || '0771',
          userCheckId: bodyObj.userCheckId || '',
          carrierOperator: bodyObj.carrierOperator || '002',
          appVersionCode: bodyObj.appVersionCode || '12.5.2',
          updatedAt: new Date().toISOString()
        };
        writeStore(JSON.stringify(tokenPayload), KEY_TOKEN_INFO);
        captured = true;
        captureType = 'APP SSO 完整授权凭证';
      }
    } catch (e) {
      console.log(`[${SCRIPT_NAME}] 解析 appTokenLogin body 失败: ${e.message}`);
    }
  }

  // 场景 B: 拦截客户端原生请求 (client.app.coc.10086.cn 或 apm.app.coc.10086.cn)
  else if (url.indexOf('10086.cn/biz-orange/') > -1 && cookie.indexOf('JSESSIONID=') > -1) {
    const tokenMatch = cookie.match(/JSESSIONID=[^;]+;[^;]*UID=[^;]+;[^;]*ticketID=[^;]+/i) ||
                       cookie.match(/JSESSIONID=[^;]+/i);
    if (tokenMatch) {
      let existing = {};
      try {
        existing = JSON.parse(readStore(KEY_TOKEN_INFO) || '{}');
      } catch (e) {}

      if (!existing.token || existing.token !== cookie) {
        existing.token = cookie;
        existing.updatedAt = new Date().toISOString();
        writeStore(JSON.stringify(existing), KEY_TOKEN_INFO);
        captured = true;
        captureType = 'APP 客户端原生会话 Cookie';
      }
    }
  }

  // 场景 C: 拦截签到 H5 内部 API (wx.10086.cn/qwhdhub/api/mark/)
  else if (url.indexOf('/qwhdhub/api/mark/') > -1 && cookie.indexOf('QWHD_SESSION_TOKEN=') > -1) {
    const prevCookie = readStore(KEY_SESSION_COOKIE);
    if (cookie !== prevCookie) {
      writeStore(cookie, KEY_SESSION_COOKIE);
      captured = true;
      captureType = '签到活动专属会话凭据';
    }
  }

  // 成功捕获后触发通知（加入 30 秒节流防重，避免频繁弹窗打扰）
  if (captured) {
    if (now - lastCapture > 30000) {
      writeStore(String(now), KEY_LAST_CAPTURE);
      notify(
        `${SCRIPT_NAME} - 授权状态获取成功`,
        `成功捕获: ${captureType}`,
        '凭证已安全保存在本地沙盒，定时签到将自动复用该登录状态！'
      );
    }
    console.log(`[${SCRIPT_NAME}] 成功捕获并更新凭证: ${captureType}`);
  }

  $done({});
}

/**
 * ----------------------------------------------------------------------------
 * 2. 签到执行模式：会话续期、提交签到、自动阶梯领奖
 * ----------------------------------------------------------------------------
 */
async function handleSign() {
  console.log(`[${SCRIPT_NAME}] 开始执行自动签到任务...`);

  let sessionCookie = readStore(KEY_SESSION_COOKIE) || '';
  let tokenInfoStr = readStore(KEY_TOKEN_INFO) || '';
  let tokenInfo = {};
  try {
    tokenInfo = JSON.parse(tokenInfoStr);
  } catch (e) {}

  if (!sessionCookie && !tokenInfo.token) {
    notify(
      SCRIPT_NAME,
      '❌ 签到失败: 本地尚未捕获到登录凭证',
      '请先打开中国移动 APP 登录或进入签到页面，脚本将自动劫持授权状态。'
    );
    $done();
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
    console.log(`[${SCRIPT_NAME}] 正在通过原生登录态换取活动中心会话 Token...`);

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

    // 步骤 2: 发送原生 token 执行 appTokenLogin 换取目标重定向 URL
    const loginUrl = 'https://wx.10086.cn/qwhdsso' + loginPath;
    const loginPayload = {
      jwtToken: null,
      token: tokenInfo.token,
      provinceCode: tokenInfo.provinceCode || '771',
      cityCode: tokenInfo.cityCode || '0771',
      userCheckId: tokenInfo.userCheckId || '',
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
    writeStore(sessionCookie, KEY_SESSION_COOKIE);
    console.log(`[${SCRIPT_NAME}] 成功刷新并持久化最新会话 Cookie！`);
    return sessionCookie;
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

    // 5. 组织通知输出
    let notifySub = `${userName} | ${signMsg}`;
    let notifyBody = `📅 本月累计签到: ${accumulateTimes} 天`;
    if (awardResults.length > 0) {
      notifyBody += `\n🎁 获得奖品: ${awardResults.join('、')}`;
    } else {
      notifyBody += `\n🎁 今日暂无待领取累签奖品`;
    }

    notify(SCRIPT_NAME, notifySub, notifyBody);
    console.log(`[${SCRIPT_NAME}] 任务完成: ${notifySub} | ${notifyBody}`);
  } catch (err) {
    console.log(`[${SCRIPT_NAME}] 签到执行过程发生异常: ${err.stack || err.message}`);
    notify(SCRIPT_NAME, '❌ 签到执行异常', err.message || '请查看运行日志以获取详细信息');
  } finally {
    $done();
  }
}

/**
 * 入口路由判断
 */
if (typeof $request !== 'undefined') {
  handleCapture();
} else {
  handleSign();
}
