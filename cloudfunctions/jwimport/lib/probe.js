/**
 * 连通性探针：只拉一次登录页，确认云函数能访问学校、能拿到会话 Cookie。
 * 不涉及任何用户凭据，可随时单独调用（event.action = 'probe'）。
 */

const https = require('node:https');

const LOGIN_URL = 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/login_slogin.html';
const ALLOWED_SUFFIX = '.buct.edu.cn';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function isAllowed(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith(ALLOWED_SUFFIX);
  } catch (error) {
    return false;
  }
}

function cookieNamesOf(setCookie) {
  if (!setCookie) return [];
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const names = [];
  list.forEach((line) => {
    const first = String(line).split(';')[0];
    const index = first.indexOf('=');
    if (index > 0) names.push(first.slice(0, index).trim());
  });
  return names;
}

function get(url, options) {
  const opts = options || {};
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let req;
    try {
      req = https.request(
        url,
        {
          method: 'GET',
          timeout: opts.timeout || 8000,
          rejectUnauthorized: false,
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Accept-Encoding': 'identity',
            Connection: 'close'
          }
        },
        (res) => {
          const chunks = [];
          let bytes = 0;
          res.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes <= 128 * 1024) chunks.push(chunk);
          });
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            done({
              ok: res.statusCode >= 200 && res.statusCode < 400,
              status: res.statusCode,
              bytes,
              ms: Date.now() - started,
              cookieNames: cookieNamesOf(res.headers['set-cookie']),
              hasLoginForm: /name=["']yhm["']/i.test(body),
              hasCsrf: /name=["']csrftoken["']/i.test(body),
              head: body.replace(/\s+/g, ' ').slice(0, 120)
            });
          });
        }
      );
    } catch (error) {
      done({
        ok: false,
        ms: Date.now() - started,
        error: { code: 'REQUEST_FAILED', message: String(error && error.message) }
      });
      return;
    }

    req.on('timeout', () => {
      req.destroy();
      done({
        ok: false,
        ms: Date.now() - started,
        error: { code: 'TIMEOUT', message: '请求超时（超过 ' + (opts.timeout || 8000) + 'ms）' }
      });
    });

    req.on('error', (error) => {
      done({
        ok: false,
        ms: Date.now() - started,
        error: {
          code: (error && (error.code || error.name)) || 'NETWORK_ERROR',
          message: String((error && error.message) || error)
        }
      });
    });

    req.end();
  });
}

function probeEgressIp() {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.request(
        'https://api.ipify.org?format=json',
        { method: 'GET', timeout: 2500, rejectUnauthorized: false, headers: { 'User-Agent': UA } },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            if (text.length < 2048) text += chunk.toString('utf8');
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(text);
              resolve(parsed && parsed.ip ? String(parsed.ip) : '');
            } catch (error) {
              resolve('');
            }
          });
        }
      );
    } catch (error) {
      resolve('');
      return;
    }
    req.on('timeout', () => {
      req.destroy();
      resolve('');
    });
    req.on('error', () => resolve(''));
    req.end();
  });
}

async function runProbe(event) {
  const target = (event && event.url) || LOGIN_URL;

  if (!isAllowed(target)) {
    return {
      stage: 'probe',
      ok: false,
      error: { code: 'URL_NOT_ALLOWED', message: '只允许访问 buct.edu.cn 下的 https 地址' }
    };
  }

  const [result, egressIp] = await Promise.all([get(target), probeEgressIp()]);

  return Object.assign(
    {
      stage: 'probe',
      target,
      egressIp: egressIp || '（未取到）',
      node: process.version,
      env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || ''
    },
    result
  );
}

module.exports = { runProbe };
