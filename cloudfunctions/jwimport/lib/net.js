/**
 * 云函数里的 HTTPS 会话层。
 *
 * 和小程序端（utils/jw/session.js）的区别，也是这条路能成的关键：
 *   1. 用 Node 的 https 直接发请求，没有微信网络层改写头部、二次转义的问题
 *   2. keepAlive + maxSockets:1，四个请求复用同一条 TCP 连接，
 *      服务端负载均衡会把它们送到同一台后端节点，会话里的私钥才不会漂
 *   3. Cookie 自己管，每个会话独立一个 jar —— 云函数实例会被复用，
 *      绝不能把 jar 放在模块级变量里，否则两个用户同时导入会串号
 *
 * 【安全】本文件不接触密码，只负责搬运字节。
 */

const https = require('node:https');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Accept-Encoding': 'identity',
  'Upgrade-Insecure-Requests': '1'
};

function hostOf(url) {
  const match = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
  return match ? match[1].toLowerCase() : '';
}

/** Set-Cookie 可能是一条字符串或数组，统一成数组 */
function toCookieList(setCookie) {
  if (!setCookie) return [];
  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

function createSession(options) {
  const opts = options || {};
  const timeout = Number(opts.timeout) || 10000;
  const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 1,
    maxFreeSockets: 1,
    keepAliveMsecs: 30000
  });
  const jar = new Map();

  function bucketOf(host) {
    if (!jar.has(host)) jar.set(host, new Map());
    return jar.get(host);
  }

  function cookieHeader(host) {
    const bucket = jar.get(host);
    if (!bucket || bucket.size === 0) return '';
    const parts = [];
    bucket.forEach((value, name) => parts.push(name + '=' + value));
    return parts.join('; ');
  }

  function cookieNames(host) {
    const bucket = jar.get(host);
    return bucket ? Array.from(bucket.keys()) : [];
  }

  function eatCookies(host, setCookie) {
    const bucket = bucketOf(host);
    toCookieList(setCookie).forEach((line) => {
      const first = String(line).split(';')[0];
      const index = first.indexOf('=');
      if (index <= 0) return;
      const name = first.slice(0, index).trim();
      const value = first.slice(index + 1).trim();
      if (!name) return;
      if (value === '' || /max-age=0/i.test(String(line))) bucket.delete(name);
      else bucket.set(name, value);
    });
  }

  function request(url, config) {
    const cfg = config || {};
    const host = hostOf(url);
    if (!host) return Promise.reject(Object.assign(new Error('地址不正确'), { kind: 'VALIDATION_FAILED' }));

    const headers = Object.assign({}, BASE_HEADERS, cfg.headers || {});
    const cookie = cookieHeader(host);
    if (cookie) headers.Cookie = cookie;

    let payload = null;
    if (cfg.form) {
      payload = Buffer.from(new URLSearchParams(cfg.form).toString(), 'utf8');
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = payload.length;
    }

    return new Promise((resolve, reject) => {
      const started = Date.now();
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      let req;
      try {
        req = https.request(
          url,
          { method: cfg.method || 'GET', headers, timeout, agent, rejectUnauthorized: false },
          (res) => {
            const chunks = [];
            let bytes = 0;
            res.on('data', (chunk) => {
              bytes += chunk.length;
              if (bytes <= 512 * 1024) chunks.push(chunk);
            });
            res.on('end', () => {
              const setCookie = toCookieList(res.headers['set-cookie']);
              eatCookies(host, setCookie);
              finish(resolve, {
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
                bytes,
                ms: Date.now() - started,
                setCookie,
                location: res.headers.location || ''
              });
            });
            res.on('error', (error) => {
              finish(reject, Object.assign(error, { kind: 'NETWORK_RETRYABLE' }));
            });
          }
        );
      } catch (error) {
        finish(reject, Object.assign(error, { kind: 'NETWORK_RETRYABLE' }));
        return;
      }

      req.on('timeout', () => {
        req.destroy();
        finish(reject, Object.assign(new Error('请求超时'), { kind: 'NETWORK_RETRYABLE' }));
      });
      req.on('error', (error) => {
        finish(reject, Object.assign(error, { kind: 'NETWORK_RETRYABLE' }));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  /** 只发一次、只跟一层重定向的 GET，用于取页面 */
  async function get(url) {
    const res = await request(url, { method: 'GET' });
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = res.location.startsWith('http')
        ? res.location
        : new URL(res.location, url).toString();
      return request(next, { method: 'GET' });
    }
    return res;
  }

  return {
    request,
    get,
    cookieHeader,
    cookieNames,
    close() {
      agent.destroy();
    }
  };
}

/** 从 Set-Cookie 里挑出 JSESSIONID 的值（不对外输出，只用于判断会话是否被刷新） */
function pickSessionId(setCookie) {
  const list = toCookieList(setCookie);
  for (let i = 0; i < list.length; i += 1) {
    const first = String(list[i]).split(';')[0];
    const index = first.indexOf('=');
    if (index <= 0) continue;
    if (/^JSESSIONID$/i.test(first.slice(0, index).trim())) return first.slice(index + 1).trim();
  }
  return '';
}

module.exports = { createSession, pickSessionId, hostOf };
