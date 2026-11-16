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
const { fetchExamList } = require('./exam');

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

/**
 * 拼接服务端返回的 Location。
 *
 * 不能直接用 new URL：本校部署在 /jwglxt 这个 context path 下，
 * 服务端有时回 /jwglxt/xtgl/xxx（带 context），有时回 xtgl/xxx（相对）。
 * 前者交给 new URL 会被解析到 host 根路径，把 context 丢掉，跳到 404 或首页去。
 */
function resolveUrl(location, root) {
  const value = String(location || '');
  const origin = String(root || '');
  if (/^https?:\/\//i.test(value)) return value;

  const host = (origin.match(/^https?:\/\/[^/]+/i) || [''])[0];
  const context = (origin.match(/^https?:\/\/[^/]+(\/.*)$/i) || [])[1] || '';

  if (value.charAt(0) === '/') {
    if (context && value.indexOf(context + '/') === 0) return host + value;
    return host + context + value;
  }
  return origin.replace(/\/+$/, '') + '/' + value;
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
      // 跳去哪一定要记下来：跳到首页是登录成功，跳回 login_slogin 就是没进去
      location: post.location || '',
      cookies: session.cookieNames(host)
    });

    const bouncedToLogin =
      post.status >= 300 && post.status < 400 && !!post.location && /login_slogin/i.test(post.location);

    /*
     * 只要 3xx 且带 Location 就算「跳走」。
     *
     * 注意不能因为 Location 里有 login_slogin 就判定登录失败：
     * 本校登录成功后会 302 回 login_slogin.html?time=xxx，那个页面自己再跳首页，
     * 浏览器跟随即可。曾经按字符串把这个当失败，结果把正常登录全判成失败，
     * 课表也跟着导入不了。真正算失败的是「返回 200 且是登录表单页」。
     */
    const redirectedAway = post.status >= 300 && post.status < 400 && !!post.location;
    const bouncedNote = bouncedToLogin ? '（302 指向登录页，按正常跳转处理）' : '';

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

    /*
     * 这里**不主动跟随 302**。
     *
     * 试过两版跟随逻辑，都出了问题：
     *   · 按 Location 里有没有 login_slogin 判成败 —— 本校登录成功后正是 302 回
     *     login_slogin.html?time=xxx（再由那页跳首页），于是把成功全判成失败，
     *     课表也跟着导入不了；
     *   · 跟到首页再判是否登录页 —— 跟随请求本身可能让服务端重发 JSESSIONID，
     *     反而把刚建立的登录态顶掉。
     *
     * 登录是否真的成立，交给下一步「探活」判断就够了：直接请求课表页，
     * 拿得回来就是登录成功，拿回登录页就报会话失效。这一步不额外制造副作用。
     */
    if (bouncedNote && steps) {
      steps.push({ step: '3c-note', detail: '登录返回 302' + bouncedNote });
    }

    // 考试查询：登录链路完全一致，只是登录后换接口
    if (params.task === 'exam') {
      return fetchExamList({ session, root, xnm, xqm, steps });
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

    /*
     * 顺手把考试安排也取回来，用**同一个会话**。
     *
     * 这么做是因为：短时间内第二次登录经常拿不到有效会话（课表能过、考试过不去），
     * 而导课表这次登录是有效的。多问一次接口，比让用户再登一次划算得多。
     * 失败不影响课表：考试取不到就留空，页面照常导入。
     */
    let exams = [];
    try {
      const examSync = await fetchExamList({
        session,
        root,
        xnm,
        xqm,
        steps,
        maxAttempts: 1
      });
      if (examSync && examSync.ok) {
        exams = examSync.exams || [];
        note(steps, '7-exam-sync', { ok: true, exams: exams.length });
      } else {
        note(steps, '7-exam-sync', { skipped: (examSync && examSync.kind) || 'EMPTY' });
      }
    } catch (error) {
      note(steps, '7-exam-sync', { error: error.code || error.message });
    }

    return {
      ok: true,
      kind: '',
      error: '',
      courses: courses,
      exams: exams,
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
    semester,
    task: source.task === 'exam' ? 'exam' : 'timetable'
  };

  let steps = [];
  let last = null;

  // 只在「会话没建立」时重来一次：这类失败没走到密码校验，不会累计锁定次数
  for (let attempt = 0; attempt < 2; attempt += 1) {
    steps = [];
    // 版本标记：诊断第一行就能确认云端跑的是哪一版代码（改代码时记得改这里）
    steps.push({ step: '0-build', detail: 'import-1116-e' });

    // 重登之前先停一下：连续两次登录挨太近，服务端容易把新会话判成异常
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1200));

    try {
      const result = await runOnce(Object.assign({}, params, { steps }));
      /*
       * 只在「登录提交没被认成同一会话」时重来一次。
       *
       * 注意不要对 SESSION_EXPIRED 自动重登：这类失败多半是账号被临时限制
       * 或请求落到了别的节点，再登一次等于又多一次登录，只会让限制更严。
       * 让用户自己隔一会儿再试，比程序连着试更安全。
       */
      if (result.ok) return result;
      if (result.kind !== 'SESSION_LOST') return result;
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
