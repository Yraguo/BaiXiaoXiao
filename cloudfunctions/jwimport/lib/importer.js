/**
 * 教务导入流程（服务端版）
 *
 * 与小程序端 utils/jw/session.js 一一对应，去掉真机专用诊断，保留关键判断：
 *   取登录页 → 取公钥 → 提交密码 → 探活 → 取课表 → 解析
 *
 * 【安全】密码只在本函数内存里过一手：加密后立刻提交，不写日志、不进返回值、不落库。
 */

const {
  GNMKDM,
  ZfError,
  buildLoginFormData,
  currentTerm,
  decidePasswordMode,
  describeZfError,
  encryptPasswordNoPlus,
  hasCaptchaField,
  mergeCourses,
  parseKbList,
  parseLoginFailure,
  parsePublicKey,
  receivedLoginParams,
  xqmOf
} = require('./zfClient');

const { createSession } = require('./net');

const DEFAULT_LOGIN = 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/login_slogin.html';

function loginUrlFor(address) {
  let text = String(address || '').trim();
  if (!text) return DEFAULT_LOGIN;
  if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
  text = text.replace(/^http:\/\//i, 'https://');
  const originMatch = /^(https:\/\/[^/]+)/i.exec(text);
  if (!originMatch) return '';
  const origin = originMatch[1];
  if (/login_slogin\.html/i.test(text)) return text.split('?')[0];
  const path = text.slice(origin.length).replace(/\/+$/, '');
  if (/\/xtgl$/i.test(path)) return origin + path + '/login_slogin.html';
  if (/\/jwglxt$/i.test(path)) return origin + path + '/xtgl/login_slogin.html';
  if (!path) return origin + '/jwglxt/xtgl/login_slogin.html';
  return origin + path + '/xtgl/login_slogin.html';
}

function jwRootOf(address) {
  const login = loginUrlFor(address);
  if (!login) return '';
  return login.replace(/\/xtgl\/login_slogin\.html.*$/i, '');
}

/** 只按学号输入框判断，登录成功后的首页里也可能有指向登录页的退出链接 */
function looksLikeLoginPage(body) {
  return /name=["']yhm["']/i.test(String(body || ''));
}

function fail(kind, message, steps) {
  return {
    ok: false,
    kind,
    error: message || describeZfError(kind),
    courses: [],
    term: null,
    steps: steps || []
  };
}

function note(steps, step, detail) {
  steps.push(Object.assign({ step }, detail));
}

/** 跑一遍完整链路。返回 ok=true 或带 kind 的失败对象 */
async function runOnce(params) {
  const { root, loginUrl, username, password, xnm, xqm, semester, steps } = params;
  const host = /^https:\/\/([^/]+)/i.exec(root)[1].toLowerCase();
  const session = createSession({ timeout: 10000 });

  try {
    // 1. 取登录页：建立会话、拿 csrftoken
    const pageTime = Date.now();
    const page = await session.get(loginUrl);
    note(steps, '1-login-page', {
      status: page.status,
      bytes: page.bytes,
      ms: page.ms,
      cookies: session.cookieNames(host)
    });

    if (!session.cookieNames(host).some((name) => /JSESSIONID/i.test(name))) {
      return fail(
        'NO_SESSION_COOKIE',
        '云函数没有拿到教务系统的会话 Cookie，服务器可能对机房出口做了限制。',
        steps
      );
    }

    const mode = decidePasswordMode(page.body);

    // 2. 取 RSA 公钥（本校公钥由独立接口下发）
    let cipher = password;
    if (mode.mode === 'required') {
      const key = await session.get(root + '/xtgl/login_getPublicKey.html?time=' + Date.now());
      const parsed = parsePublicKey(key.body);
      cipher = encryptPasswordNoPlus(password, parsed.modulus, parsed.exponent);
      note(steps, '2-public-key', {
        status: key.status,
        bytes: key.bytes,
        ms: key.ms,
        cipherLen: cipher.length
      });
    } else {
      note(steps, '2-public-key', { skipped: true, mode: mode.mode });
    }

    // 3. 提交登录。浏览器会在 action 后拼 ?time=页面加载时间戳，这里保持一致
    const post = await session.request(loginUrl + '?time=' + pageTime, {
      method: 'POST',
      form: buildLoginFormData(page.body, username, cipher)
    });
    note(steps, '3-login-post', {
      status: post.status,
      bytes: post.bytes,
      ms: post.ms,
      pageBytes: page.bytes,
      location: post.location ? '(redirect)' : '',
      cookies: session.cookieNames(host)
    });

    const redirectedAway =
      post.status >= 300 && post.status < 400 && post.location && !/login_slogin/i.test(post.location);

    if (!redirectedAway && looksLikeLoginPage(post.body)) {
      const failure = parseLoginFailure(post.body);
      const tips = failure.tips ? '（系统提示：' + failure.tips + '）' : '';

      // 页面比登录页还短：服务端把这次提交当成新会话，会话里没有私钥
      if (!tips && post.bytes < page.bytes) {
        return fail(
          'SESSION_LOST',
          '登录提交没有被认成同一个会话，服务端拿不到解密密码所需的密钥。',
          steps
        );
      }
      // 一个字段都没收到：与密码无关
      if (!receivedLoginParams(post.body)) {
        return fail('PARAMS_LOST', '登录表单没有送达教务系统，这不是密码的问题。', steps);
      }
      // 页面字节数完全一致且无提示：服务端没处理这次提交，多半是失败次数过多被临时锁定
      if (post.bytes === page.bytes) {
        return fail(
          'LOGIN_BOUNCED',
          '教务系统这次没有处理登录：既没校验密码也没给提示，最常见的原因是连续失败次数过多被临时锁定（5 次锁 30 分钟）。',
          steps
        );
      }
      return fail(failure.kind, describeZfError(failure.kind) + tips, steps);
    }

    if (!redirectedAway && !looksLikeLoginPage(post.body) && post.status >= 400) {
      return fail('NETWORK_RETRYABLE', '登录接口返回 HTTP ' + post.status, steps);
    }

    // 4. 探活：区分「没权限」和「会话失效」
    const probe = await session.get(root + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=' + GNMKDM + '&layout=default');
    note(steps, '4-probe', { status: probe.status, bytes: probe.bytes, loginPage: looksLikeLoginPage(probe.body) });
    if (looksLikeLoginPage(probe.body)) return fail('SESSION_EXPIRED', '登录后会话失效，请重试。', steps);
    if (/没有访问权限|无访问权限/.test(probe.body)) return fail('QUERY_DENIED', '账号没有课表查询权限。', steps);

    // 5. 取课表
    const kb = await session.request(root + '/kbcx/xskbcx_cxXsKb.html?gnmkdm=' + GNMKDM, {
      method: 'POST',
      form: {
        xnm: xnm,
        xqm: xqm,
        kzlx: 'ck',
        xsdm: '',
        kclbdm: '',
        kclxdm: ''
      }
    });
    note(steps, '5-kb', { status: kb.status, bytes: kb.bytes, head: String(kb.body).slice(0, 60) });

    if (!kb.body || kb.body.trim().length < 2) {
      return fail('QUERY_DENIED', '教务系统没有返回课表，可能这个学期还没排课。', steps);
    }
    if (kb.body.trim().charAt(0) === '<') {
      if (looksLikeLoginPage(kb.body)) return fail('SESSION_EXPIRED', '会话已过期，请重试。', steps);
      return fail('QUERY_DENIED', '课表接口返回了页面而不是数据。', steps);
    }

    const rows = parseKbList(kb.body);
    const courses = mergeCourses(rows);
    note(steps, '6-parse', { kbRows: rows.length, courses: courses.length });

    if (!courses.length) {
      return fail('QUERY_DENIED', '教务系统有返回数据，但没解析出课程。可能这个学期还没排课，或学期选错了。', steps);
    }

    return {
      ok: true,
      kind: '',
      error: '',
      courses: courses,
      term: {
        xnm: xnm,
        xqm: xqm,
        semester: semester,
        label:
          xnm +
          '-' +
          (Number(xnm) + 1) +
          ' 学年' +
          (Number(semester) === 3 ? '小学期' : '第 ' + semester + ' 学期')
      },
      steps: steps
    };
  } finally {
    session.close();
  }
}

/**
 * @param {{username:string, password:string, xnm?:string, semester?:number, address?:string}} input
 */
async function importTimetable(input) {
  const source = input || {};
  const username = String(source.username || '').trim();
  const password = String(source.password || '');

  if (!username) return fail('VALIDATION_FAILED', '请填写学号');
  if (!password) return fail('VALIDATION_FAILED', '请填写密码');

  const base = currentTerm();
  const semester = Number(source.semester || base.semester);
  const xnm = String(source.xnm || base.xnm);

  let xqm;
  try {
    xqm = xqmOf(semester);
  } catch (error) {
    return fail('VALIDATION_FAILED', '学期选择不正确');
  }

  const root = jwRootOf(source.address || DEFAULT_LOGIN);
  if (!root) return fail('VALIDATION_FAILED', '教务系统地址不正确');

  const params = {
    root,
    loginUrl: root + '/xtgl/login_slogin.html',
    username,
    password,
    xnm,
    xqm,
    semester
  };

  let steps = [];
  let last = null;

  // 只在「会话没建立」时重来一次：这类失败没走到密码校验，不会累计锁定次数
  for (let attempt = 0; attempt < 2; attempt += 1) {
    steps = [];
    try {
      const result = await runOnce(Object.assign({}, params, { steps }));
      if (result.ok || result.kind !== 'SESSION_LOST') return result;
      last = result;
    } catch (error) {
      const kind = error instanceof ZfError ? error.kind : error.kind || 'NETWORK_RETRYABLE';
      last = fail(kind, (error && error.message) || '导入失败', steps);
      if (kind !== 'NETWORK_RETRYABLE' && kind !== 'SESSION_LOST') return last;
    }
  }

  return last || fail('NETWORK_RETRYABLE', '导入失败，请稍后重试');
}

module.exports = { importTimetable, jwRootOf, loginUrlFor, looksLikeLoginPage };
