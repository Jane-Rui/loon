/**
 * @fileoverview AkileCloud (akile.ai) 自动登录与每日签到脚本
 * @author Jane-Rui
 * @date 2026-09-11
 * @version 0.01
 * @icon https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/akile.png
 * icon: https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/akile.png
 * @description 支持 AkileCloud 长期 Token 优先复用、自动账密静默登录续期、智能前置防风控审查与每日自动打卡。
 * 
 * ==============================================================================
 * 【功能说明】
 * 1. 长期 Token 优先复用（长效免登）：
 *    - 优先读取本地沙盒持久化 Token（$persistentStore），日常运行直接复用，杜绝频繁重复登录。
 *    - 仅当 Token 首次配置或已完全失效（非 0 状态码）时，才会自动使用配置的账密执行一次静默重登续期。
 * 2. 严格防风控机制（一天仅打卡一次）：
 *    - 在调用签到接口前，前置查询 /api/v1/user/info 获取 last_checkin_time 时间戳；
 *    - 转换为东八区（CST）北京日期校验。若今日已完成签到，立即熔断拦截，不向服务端发送 /Checkin 请求，
 *      彻底规避平台因重复请求引发的风控与封禁风险。
 * 3. 凭据注入途径：
 *    - 插件/脚本参数注入 (argument = "邮箱#密码" 或 "邮箱,密码")，零明文提交代码仓库。
 * 
 * 【依赖与配置】
 * - 平台：Loon (iOS)
 * - 运行时：$persistentStore / $httpClient / $notification
 * ==============================================================================
 */

const SCRIPT_NAME = 'AkileCloud 签到';
const KEY_TOKEN = 'akile_auth_token';
const KEY_ACCOUNT = 'akile_auth_account';

/**
 * 跨平台系统通知封装
 * @function notify
 * @module Notify
 * @param {string} title - 通知主标题
 * @param {string} subtitle - 副标题
 * @param {string} message - 正文详细内容
 */
function notify(title, subtitle, message) {
  if (typeof $notification !== 'undefined') {
    $notification.post(title, subtitle, message, {
      'media-url': 'https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/akile.png'
    });
  } else {
    console.log(`[${title}] ${subtitle} - ${message}`);
  }
}

/**
 * 通用 HTTP 请求 Promise 封装
 * @function sendHttp
 * @module Net
 * @param {Object} req - 请求参数对象
 * @param {string} req.url - 目标 URL
 * @param {string} [req.method='GET'] - HTTP 方法
 * @param {Object} [req.headers] - 请求头
 * @param {string} [req.body] - 请求体
 * @param {number} [req.timeout=25] - 超时秒数
 * @returns {Promise<{status: number, headers: Object, body: string, json: Object|null}>}
 */
function sendHttp(req) {
  return new Promise((resolve, reject) => {
    if (typeof $httpClient === 'undefined') {
      return reject(new Error('未检测到 Loon $httpClient 运行时环境'));
    }
    const method = (req.method || 'GET').toLowerCase();
    const opts = {
      url: req.url,
      headers: req.headers || {},
      timeout: req.timeout || 25
    };
    if (req.body) {
      opts.body = req.body;
    }

    $httpClient[method](opts, (err, resp, data) => {
      if (err) {
        const errDetail = typeof err === 'string' ? err : (err.message || err.error || JSON.stringify(err));
        return reject(new Error(`网络请求失败 [${method.toUpperCase()} ${opts.url}]: ${errDetail}`));
      }
      if (!resp) {
        return reject(new Error(`服务端无响应 [${method.toUpperCase()} ${opts.url}]`));
      }
      let json = null;
      try {
        json = JSON.parse(data);
      } catch (e) {}
      resolve({
        status: resp.status || resp.statusCode,
        headers: resp.headers || {},
        body: data,
        json: json
      });
    });
  });
}

/**
 * 获取东八区北京时间 (CST) 当前日期字符串 YYYY-MM-DD
 * @function getTodayCSTDateStr
 * @module Time
 * @returns {string} 形如 "2026-09-11"
 */
function getTodayCSTDateStr() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const cst = new Date(utc + (3600000 * 8));
  const y = cst.getFullYear();
  const m = String(cst.getMonth() + 1).padStart(2, '0');
  const d = String(cst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 将时间戳转为东八区北京时间 (CST) 格式化时间
 * @function formatCST
 * @module Time
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {{ dateStr: string, timeStr: string, fullStr: string }}
 */
function formatCST(timestamp) {
  if (!timestamp) return { dateStr: '', timeStr: '', fullStr: '从未签到' };
  const d = new Date(timestamp * 1000);
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const cst = new Date(utc + (3600000 * 8));
  const y = cst.getFullYear();
  const m = String(cst.getMonth() + 1).padStart(2, '0');
  const date = String(cst.getDate()).padStart(2, '0');
  const hh = String(cst.getHours()).padStart(2, '0');
  const mm = String(cst.getMinutes()).padStart(2, '0');
  const ss = String(cst.getSeconds()).padStart(2, '0');
  return {
    dateStr: `${y}-${m}-${date}`,
    timeStr: `${hh}:${mm}:${ss}`,
    fullStr: `${y}-${m}-${date} ${hh}:${mm}:${ss}`
  };
}

/**
 * 账号密码静默登录置换最新 Token
 * @function loginWithCredentials
 * @module Auth
 * @param {string} email - 账号邮箱
 * @param {string} password - 登录密码
 * @returns {Promise<string>} 返回最新登录的 Token
 * @throws {Error} 登录失败或服务端返回错误时抛出异常
 */
async function loginWithCredentials(email, password) {
  console.log(`[${SCRIPT_NAME}] 正在尝试使用账号 ${email} 执行自动登录换票...`);
  const payload = {
    email: email,
    password: password,
    token: '',
    email_code: '',
    new_password: '',
    confirm: '',
    verifyCode: '',
    remember: true
  };

  const resp = await sendHttp({
    url: 'https://api.akile.ai/api/v1/user/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Origin': 'https://akile.ai',
      'Referer': 'https://akile.ai/',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15'
    },
    body: JSON.stringify(payload)
  });

  if (resp.json && resp.json.status_code === 0 && resp.json.data && resp.json.data.token) {
    const newToken = resp.json.data.token;
    $persistentStore.write(newToken, KEY_TOKEN);
    console.log(`[${SCRIPT_NAME}] 自动登录成功，已保存并更新长期持久化 Token`);
    return newToken;
  }

  const errMsg = (resp.json && resp.json.status_msg) || `HTTP 响应异常 (状态码: ${resp.status})`;
  throw new Error(`自动登录换票失败: ${errMsg}`);
}

/**
 * 获取当前用户信息（只读检测）
 * @function fetchUserInfo
 * @module User
 * @param {string} token - JWT Token
 * @returns {Promise<Object>} 用户信息响应 JSON
 */
async function fetchUserInfo(token) {
  const resp = await sendHttp({
    url: 'https://api.akile.ai/api/v1/user/info',
    method: 'GET',
    headers: {
      'Origin': 'https://akile.ai',
      'Referer': 'https://akile.ai/',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
      'Authorization': token
    }
  });
  return resp.json;
}

/**
 * 获取控制台资产与金币概览
 * @function fetchUserIndex
 * @module User
 * @param {string} token - JWT Token
 * @returns {Promise<Object>} 控制台资产数据响应 JSON
 */
async function fetchUserIndex(token) {
  const resp = await sendHttp({
    url: 'https://api.akile.ai/api/v1/user/index',
    method: 'GET',
    headers: {
      'Origin': 'https://akile.ai',
      'Referer': 'https://akile.ai/',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
      'Authorization': token
    }
  });
  return resp.json;
}

/**
 * 执行签到打卡 API
 * @function executeCheckin
 * @module Task
 * @param {string} token - JWT Token
 * @returns {Promise<Object>} 签到响应结果 JSON
 */
async function executeCheckin(token) {
  const resp = await sendHttp({
    url: 'https://api.akile.ai/api/v1/user/Checkin',
    method: 'GET',
    headers: {
      'Origin': 'https://akile.ai',
      'Referer': 'https://akile.ai/',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
      'Authorization': token
    }
  });
  return resp.json;
}

/**
 * 定时执行签到核心流程
 * @function handleTask
 * @module Task
 */
async function handleTask() {
  console.log(`[${SCRIPT_NAME}] 开始执行任务...`);

  // 1. 凭据解析：优先从 argument 解析账号密码
  let email = '';
  let password = '';
  const argStr = typeof $argument !== 'undefined' ? String($argument).trim() : '';

  if (argStr) {
    if (argStr.indexOf('#') > -1) {
      const parts = argStr.split('#');
      email = parts[0].trim();
      password = parts.slice(1).join('#').trim();
    } else if (argStr.indexOf(',') > -1) {
      const parts = argStr.split(',');
      email = parts[0].trim();
      password = parts.slice(1).join(',').trim();
    }
  }

  // 备选从沙盒读取持久化账号密码
  if (!email || !password) {
    try {
      const storedAcc = JSON.parse($persistentStore.read(KEY_ACCOUNT) || '{}');
      email = email || storedAcc.email || '';
      password = password || storedAcc.password || '';
    } catch (e) {}
  }

  // 2. 长期 Token 优先复用：读取本地存储的已有 Token
  let token = $persistentStore.read(KEY_TOKEN) || '';

  if (!token && (!email || !password)) {
    notify(SCRIPT_NAME, '❌ 无法执行签到: 缺少凭据', '请在脚本配置中填写账号密码（argument = "邮箱#密码"）。');
    $done();
    return;
  }

  try {
    // 3. 校验已有 Token 是否可用
    let userRes = null;
    if (token) {
      try {
        userRes = await fetchUserInfo(token);
      } catch (checkErr) {
        console.log(`[${SCRIPT_NAME}] 使用缓存 Token 校验时发生网络波动: ${checkErr.message}`);
      }
    }

    // 若 Token 缺失或已过期（返回非 0 状态），执行静默自动登录
    const isTokenExpired = !userRes || userRes.status_code !== 0;
    if (isTokenExpired) {
      if (email && password) {
        console.log(`[${SCRIPT_NAME}] Token 无效或已过期，执行自动登录置换长期 Token...`);
        token = await loginWithCredentials(email, password);
        userRes = await fetchUserInfo(token);
      } else {
        throw new Error('本地 Token 已失效且未配置账号密码，无法自动重新登录');
      }
    } else {
      console.log(`[${SCRIPT_NAME}] 本地长期 Token 仍然有效，直接复用当前会话！`);
    }

    if (!userRes || userRes.status_code !== 0 || !userRes.data) {
      throw new Error(`获取用户信息失败: ${(userRes && userRes.status_msg) || '响应异常'}`);
    }

    const userData = userRes.data;
    const userName = userData.username || userData.email || '用户';
    const lastCheckinTs = Number(userData.last_checkin_time || 0);
    const lastCheckin = formatCST(lastCheckinTs);
    const todayCST = getTodayCSTDateStr();

    console.log(`[${SCRIPT_NAME}] 用户: ${userName} | 上次签到日期: ${lastCheckin.dateStr} | 今日北京日期: ${todayCST}`);

    // 4. 核心防风控审查：今日若已完成打卡，坚决不再发起 Checkin 请求
    if (lastCheckin.dateStr === todayCST) {
      console.log(`[${SCRIPT_NAME}] 触发前置防风控机制：今日已在 ${lastCheckin.timeStr} 完成打卡，拦截后续重复请求！`);

      let akCoinText = '';
      try {
        const idxRes = await fetchUserIndex(token);
        if (idxRes && idxRes.status_code === 0 && idxRes.data) {
          akCoinText = `\n🪙 当前金币: ${idxRes.data.ak_coin} | 余额: ￥${idxRes.data.money}`;
        }
      } catch (e) {}

      notify(
        SCRIPT_NAME,
        `${userName} | 今日已完成打卡`,
        `⏰ 签到时间: ${lastCheckin.fullStr} (CST)\n🛡️ 防风控机制已自动拦截重复请求${akCoinText}`
      );
      return;
    }

    // 5. 今日尚未签到，发起打卡请求
    console.log(`[${SCRIPT_NAME}] 今日尚未签到，正在提交签到打卡请求...`);
    const checkinRes = await executeCheckin(token);

    if (checkinRes && checkinRes.status_code === 0) {
      const reward = checkinRes.data !== undefined ? `+${checkinRes.data} 金币` : '成功';
      console.log(`[${SCRIPT_NAME}] 签到成功: ${reward}`);

      let balanceInfo = '';
      try {
        const idxRes = await fetchUserIndex(token);
        if (idxRes && idxRes.status_code === 0 && idxRes.data) {
          balanceInfo = `\n🪙 累计金币: ${idxRes.data.ak_coin} | 账户余额: ￥${idxRes.data.money}`;
        }
      } catch (e) {}

      notify(
        SCRIPT_NAME,
        `🎉 ${userName} | 签到成功！`,
        `🎁 奖励: ${reward}${balanceInfo}`
      );
    } else {
      const errMsg = (checkinRes && checkinRes.status_msg) || '未知状态';
      console.log(`[${SCRIPT_NAME}] 签到接口响应: ${JSON.stringify(checkinRes)}`);
      notify(SCRIPT_NAME, `⚠️ ${userName} | 签到未成功`, `返回信息: ${errMsg}`);
    }

  } catch (err) {
    const errDetail = (err && (err.message || err.error || (typeof err === 'string' ? err : JSON.stringify(err)))) || String(err);
    console.log(`[${SCRIPT_NAME}] 任务异常: ${errDetail}`);
    notify(SCRIPT_NAME, '❌ 任务执行异常', errDetail);
  } finally {
    $done();
  }
}

// 执行任务
handleTask();
