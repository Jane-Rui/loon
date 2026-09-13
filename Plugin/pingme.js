/**
 * @fileoverview PingMe 虚拟号码与短信平台自动签到及视频激励奖励
 * @author 怎么肥事 (Jane-Rui 整理重构)
 * @version 1.1.0
 * @date 2026-09-11
 * @license MIT
 * @icon https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/PingMe.png
 * icon: https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/PingMe.png
 * 
 * ==============================================================================
 * 【功能说明】
 * 1. 自动化凭证捕获与持久化：
 *    - 拦截 PingMe APP 内查询余额与奖励请求（queryBalanceAndBonus）
 *    - 提取 URL 参数与请求头，安全持久化于本地存储（$persistentStore）
 * 2. 自动化签到与余额查询：
 *    - 自动查询当前 Coins 余额
 *    - 自动提交每日打卡签到（checkIn）
 * 3. 视频激励与智能验证码识别：
 *    - 广告签到打散执行：原始逻辑为每日 2 轮 × 每轮循环 5 次，现打散为
 *      每日 10 次独立执行（每次 Cron 触发仅完成 1 次 videoBonus）；
 *    - 当日进度持久化（pingme_video_progress），跨次累计、达上限自动跳过；
 *    - 执行前随机延迟防风控拦截；
 *    - 当检测到验证码时，内置多 OCR 识别引擎自动重试自愈
 * 
 * ==============================================================================
 * 【支持环境】
 * - Loon (推荐)
 * - Surge
 * - Quantumult X
 * 
 * 【使用说明】
 * 1. 确保 Loon 的 MitM 解密已添加 Hostname：api.pingmeapp.net
 * 2. 打开 PingMe APP，进入相关页面触发一次余额查询请求；
 * 3. 弹出「✅ 参数抓取成功」系统通知即表示凭证获取完成；
 * 4. 随后每天在设定的 Cron 时间自动执行签到与视频任务。
 * 
 * 【信息安全声明】
 * 本脚本严格遵循信息安全规范，公开代码不包含任何用户凭据或隐私数据，
 * 所有会话凭据仅在用户本地客户端的私有沙盒存储中动态读写。
 * ==============================================================================
 */

const scriptName = "PingMe";
const ckKey = "pingme_capture_v3";
const SECRET = "0fOiukQq7jXZV2GRi9LGlO";
const MAX_VIDEO = 5;
const VIDEO_DELAY = 8000;
const KEY_VIDEO_PROGRESS = "pingme_video_progress";
// 原始逻辑为每日 2 轮 × 每轮循环 5 次；打散后每日独立执行总数 = 2 × 5
const DAILY_VIDEO_TOTAL = MAX_VIDEO * 2;

// ===== 新增统一变量区（全部放顶部）=====
const OCR_API_LIST = [
  "http://ocr.rsc.moe/ocr",
  "http://124.222.86.140:8000/ocr",
  "http://43.139.16.120:5000/ocr",
  "http://8.134.50.12:5000/ocr",
];

const RANDOM_DELAY_MIN = 30000; // 30秒
const RANDOM_DELAY_MAX = 60000; // 60秒
// ======================================

function MD5(string) {
  function RotateLeft(lValue, iShiftBits) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function AddUnsigned(lX, lY) {
    const lX4 = lX & 0x40000000,
      lY4 = lY & 0x40000000,
      lX8 = lX & 0x80000000,
      lY8 = lY & 0x80000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4)
      return lResult & 0x40000000
        ? lResult ^ 0xc0000000 ^ lX8 ^ lY8
        : lResult ^ 0x40000000 ^ lX8 ^ lY8;
    return lResult ^ lX8 ^ lY8;
  }
  function F(x, y, z) {
    return (x & y) | (~x & z);
  }
  function G(x, y, z) {
    return (x & z) | (y & ~z);
  }
  function H(x, y, z) {
    return x ^ y ^ z;
  }
  function I(x, y, z) {
    return y ^ (x | ~z);
  }
  function FF(a, b, c, d, x, s, ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  }
  function GG(a, b, c, d, x, s, ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  }
  function HH(a, b, c, d, x, s, ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  }
  function II(a, b, c, d, x, s, ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  }
  function ConvertToWordArray(str) {
    const lMessageLength = str.length;
    const lNumberOfWords_temp1 = lMessageLength + 8;
    const lNumberOfWords_temp2 =
      (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1).fill(0);
    let lBytePosition = 0,
      lByteCount = 0;
    while (lByteCount < lMessageLength) {
      const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] |= str.charCodeAt(lByteCount) << lBytePosition;
      lByteCount++;
    }
    const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] |= 0x80 << lBytePosition;
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function WordToHex(lValue) {
    let WordToHexValue = "";
    for (let lCount = 0; lCount <= 3; lCount++) {
      const lByte = (lValue >>> (lCount * 8)) & 255;
      const WordToHexValue_temp = "0" + lByte.toString(16);
      WordToHexValue += WordToHexValue_temp.substr(
        WordToHexValue_temp.length - 2,
        2,
      );
    }
    return WordToHexValue;
  }
  const x = ConvertToWordArray(string);
  let a = 0x67452301,
    b = 0xefcdab89,
    c = 0x98badcfe,
    d = 0x10325476;
  const S11 = 7,
    S12 = 12,
    S13 = 17,
    S14 = 22,
    S21 = 5,
    S22 = 9,
    S23 = 14,
    S24 = 20;
  const S31 = 4,
    S32 = 11,
    S33 = 16,
    S34 = 23,
    S41 = 6,
    S42 = 10,
    S43 = 15,
    S44 = 21;
  for (let k = 0; k < x.length; k += 16) {
    const AA = a,
      BB = b,
      CC = c,
      DD = d;
    a = FF(a, b, c, d, x[k + 0], S11, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070db);
    b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e);
    b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);
    a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51);
    b = GG(b, c, d, a, x[k + 0], S24, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10], S22, 0x02441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);
    a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6);
    d = HH(d, a, b, c, x[k + 0], S32, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x04881d05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);
    a = II(a, b, c, d, x[k + 0], S41, 0xf4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6], S43, 0xa3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);
    a = AddUnsigned(a, AA);
    b = AddUnsigned(b, BB);
    c = AddUnsigned(c, CC);
    d = AddUnsigned(d, DD);
  }
  return (
    WordToHex(a) +
    WordToHex(b) +
    WordToHex(c) +
    WordToHex(d)
  ).toLowerCase();
}

function getUTCSignDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}

function normalizeHeaderNameMap(headers) {
  const out = {};
  Object.keys(headers || {}).forEach((k) => (out[k] = headers[k]));
  return out;
}

function parseRawQuery(url) {
  const query = (url.split("?")[1] || "").split("#")[0];
  const rawMap = {};
  query.split("&").forEach((pair) => {
    if (!pair) return;
    const idx = pair.indexOf("=");
    if (idx < 0) return;
    const k = pair.slice(0, idx);
    const v = pair.slice(idx + 1);
    rawMap[k] = v;
  });
  return rawMap;
}

function buildSignedParamsRaw(capture) {
  const params = {};
  Object.keys(capture.paramsRaw || {}).forEach((k) => {
    if (k !== "sign" && k !== "signDate") params[k] = capture.paramsRaw[k];
  });
  params.signDate = getUTCSignDate();
  const signBase = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  params.sign = MD5(signBase + SECRET);
  return params;
}

function buildUrl(path, capture) {
  const params = buildSignedParamsRaw(capture);
  const qs = Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
  return `https://api.pingmeapp.net/app/${path}?${qs}`;
}

function cloneHeaders(headers) {
  const out = {};
  Object.keys(headers || {}).forEach((k) => (out[k] = headers[k]));
  return out;
}

function buildHeaders(capture) {
  const headers = cloneHeaders(capture.headers || {});
  delete headers["Content-Length"];
  delete headers["content-length"];
  delete headers[":authority"];
  delete headers[":method"];
  delete headers[":path"];
  delete headers[":scheme"];
  headers["Host"] = "api.pingmeapp.net";
  headers["Accept"] =
    headers["Accept"] || headers["accept"] || "application/json";
  return headers;
}

function notifyDone(title, body) {
  if (typeof $notification !== "undefined") {
    $notification.post(scriptName, title, body, {
      "media-url": "https://raw.githubusercontent.com/Jane-Rui/loon/main/Icon/App/PingMe.png",
    });
  } else if (typeof $notify !== "undefined") {
    $notify(scriptName, title, body);
  } else {
    console.log(`${scriptName} - ${title} - ${body}`);
  }
}

function done(value = {}) {
  if (typeof $done !== "undefined") {
    $done(value);
  }
}

if (typeof $request !== "undefined" && $request) {
  const capture = {
    url: $request.url,
    paramsRaw: parseRawQuery($request.url),
    headers: normalizeHeaderNameMap($request.headers || {}),
  };

  const ok = $persistentStore.write(JSON.stringify(capture), ckKey);

  if (ok) {
    notifyDone("✅ 参数抓取成功", "已保存请求头和参数");
  } else {
    notifyDone("⚠️ 参数抓取失败", "写入存储失败");
  }

  // 脱敏日志：仅输出键名，避免会话参数进入日志（防止日志外传导致凭据泄露）
  console.log(
    `【${scriptName}】capture keys: ${Object.keys(capture || {}).join(",")} | params: ${Object.keys((capture && capture.paramsRaw) || {}).join(",")}`,
  );
  done({});
} else {
  const raw = $persistentStore.read(ckKey);

  if (!raw) {
    notifyDone(
      "⚠️ 未抓到参数",
      "先打开 PingMe 触发一次 queryBalanceAndBonus 请求",
    );
    done({});
  } else {
    let capture;
    try {
      capture = JSON.parse(raw);
    } catch (e) {
      notifyDone("⚠️ 参数损坏", "请重新打开 PingMe 抓参");
      done({});
      return;
    }

    const headers = buildHeaders(capture);
    const msgs = [];
    let totalCoins = 0; // 总积分
    let totalVideos = 0; // 视频次数

    function fetchApi(path) {
      const url = buildUrl(path, capture);
      return new Promise((resolve, reject) => {
        $httpClient.get({ url, headers }, (error, response, data) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({
            statusCode: response
              ? response.status || response.statusCode
              : null,
            headers: response ? response.headers : {},
            body: data,
          });
        });
      });
    }

    function todayStr() {
      const now = new Date();
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const cst = new Date(utc + 3600000 * 8);
      return `${cst.getFullYear()}${String(cst.getMonth() + 1).padStart(2, "0")}${String(cst.getDate()).padStart(2, "0")}`;
    }

    function readVideoProgress() {
      let p = {};
      try {
        p = JSON.parse($persistentStore.read(KEY_VIDEO_PROGRESS) || "{}");
      } catch (e) {
        p = {};
      }
      if (!p || p.date !== todayStr()) {
        p = { date: todayStr(), count: 0 };
      }
      return p;
    }

    /**
     * 单次广告签到（打散模式）：每次运行仅执行 1 次 videoBonus，
     * 每日配额 MAX_VIDEO 次由 Cron 的多个时间点分摊，进度持久化累计。
     */
    function doSingleVideo() {
      const progress = readVideoProgress();

      if (progress.count >= DAILY_VIDEO_TOTAL) {
        msgs.push(`🎬 广告签到：今日 ${DAILY_VIDEO_TOTAL} 次配额已完成，跳过本轮`);
        return Promise.resolve();
      }

      const delay =
        Math.floor(Math.random() * (RANDOM_DELAY_MAX - RANDOM_DELAY_MIN + 1)) +
        RANDOM_DELAY_MIN;

      return new Promise((resolve) => {
        setTimeout(() => {
          fetchApi("videoBonus")
            .then(async (res) => {
              let msg = "";
              try {
                let d = JSON.parse(res.body);

                // ===== OCR 验证码自愈 =====
                if (d.retmsg && d.retmsg.indexOf("验证码") !== -1) {
                  console.log("检测到验证码");
                  const code = await handleOCR(capture, headers);
                  if (code) {
                    try {
                      const retryRes = await fetchApi(
                        "videoBonus",
                        capture,
                        headers,
                        { code },
                      );
                      d = JSON.parse(retryRes.body);
                      console.log("OCR重试成功");
                    } catch (e) {
                      console.log("OCR重试失败");
                    }
                  }
                }

                if (d.retcode === 0) {
                  const bonus = Number(d.result?.bonus || 0);
                  totalCoins += bonus;
                  totalVideos++;
                  progress.count += 1;
                  msg = `🎬 广告签到 ${progress.count}/${DAILY_VIDEO_TOTAL}：+${bonus} Coins`;
                } else {
                  msg = `⏸ 广告签到 ${progress.count + 1}/${DAILY_VIDEO_TOTAL}：${d.retmsg || "失败"}`;
                  // 服务端提示无剩余次数时直接记满，避免后续 Cron 空转
                  if (/次数|已领|上限|完成|没有/.test(d.retmsg || "")) {
                    progress.count = DAILY_VIDEO_TOTAL;
                  }
                }
              } catch (e) {
                msg = "❌ 广告签到：解析失败";
              }
              $persistentStore.write(JSON.stringify(progress), KEY_VIDEO_PROGRESS);
              msgs.push(msg);
              resolve();
            })
            .catch((err) => {
              msgs.push(`❌ 广告签到：${err.error || err.message || "请求失败"}`);
              resolve();
            });
        }, delay);
      });
    }

    function handleOCR(capture, headers) {
      // 打乱顺序（使用顶部变量）
      const apiList = OCR_API_LIST.slice().sort(() => Math.random() - 0.5);

      return new Promise((resolve) => {
        const url = buildUrl("getCaptcha", capture);

        $httpClient.get({ url, headers, binary: true }, (e, r, d) => {
          if (!d) return resolve(null);

          const b64 = d.toString("base64");

          const tryOCR = (i) => {
            if (i >= apiList.length) return resolve(null);

            $httpClient.post(
              {
                url: apiList[i],
                body: b64,
                timeout: 5,
              },
              (err, res, body) => {
                if (!err && body && body.length <= 10) {
                  resolve(body.trim());
                } else {
                  tryOCR(i + 1);
                }
              },
            );
          };

          tryOCR(0);
        });
      });
    }

    fetchApi("queryBalanceAndBonus")
      .then((res) => {
        let msg = "";

        try {
          const d = JSON.parse(res.body);
          if (d.retcode === 0) {
            msg = `💰 当前余额：${d.result.balance} Coins`;
          } else {
            msg = `⚠️ 余额查询：${d.retmsg || "失败"}`;
          }
        } catch (e) {
          msg = "❌ 余额查询：解析失败";
        }

        msgs.push(msg);

        return fetchApi("checkIn");
      })

      .then((res) => {
        let msg = "";

        try {
          const d = JSON.parse(res.body);
          if (d.retcode === 0) {
            msg = `✅ 签到：${(d.result?.bonusHint || d.retmsg || "成功").replace(/\n/g, " ")}`;
          } else {
            msg = `⚠️ 签到：${d.retmsg || "失败"}`;
          }
        } catch (e) {
          msg = "❌ 签到：解析失败";
        }

        msgs.push(msg);

        return doSingleVideo();
      })

      .then(() => {
        return fetchApi("queryBalanceAndBonus");
      })

      .then((res) => {
        let msg = "";

        try {
          const d = JSON.parse(res.body);
          if (d.retcode === 0) {
            msg = `💰 最新余额：${d.result.balance} Coins`;
            msgs.push(msg);
          }
        } catch (e) {}

        notifyDone("🎉 任务完成", msgs.join("\n"));
        done({});
      })

      .catch((err) => {
        notifyDone(
          "❌ 任务失败",
          msgs.join("\n") + "\n" + (err?.error || err?.message || String(err)),
        );
        done({});
      });
  }
}
