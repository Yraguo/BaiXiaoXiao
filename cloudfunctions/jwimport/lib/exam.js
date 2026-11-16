/**
 * 考试安排查询。
 *
 * 登录链路与取课表完全一致，登录成功后换考务（kwgl）的接口。
 *
 * 难点在于「接口路径因校而异」：正方不同部署挂的路径和 gnmkdm（功能模块号）
 * 都不一样，硬编码一套大概率扑空。所以这里先用两种办法把路径找出来：
 *   1. 读教务首页的菜单数据，从里面抠出带 kscx / ksxx 的真实地址；
 *   2. 菜单拿不到就退回候选列表，逐个试。
 * 谁先返回 JSON 就用谁，全都失败时把每一次尝试的结果原样带回去，
 * 用户把诊断发过来就能直接判断是路径不对、没权限，还是被当成未登录。
 */

const MENU_PATHS = [
  '/xtgl/index_initMenu.html',
  '/xtgl/index_cxWelcome.html'
];

/*
 * 本校（北化）确认过的地址，来自教务网页「考试信息查询」的地址栏：
 *   /jwglxt/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default
 * 页面和数据是两个入口：GET 页面建立上下文，POST 数据接口才拿得到 JSON。
 */
const CONFIRMED = [
  {
    // 参照 BetterBUCT 的实现：查询端点只带 doType=query，模块号留在页面 URL 上
    label: '本校·考试查询',
    method: 'POST',
    page: '/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default',
    data: '/kwgl/kscx_cxXsksxxIndex.html?doType=query'
  },
  {
    label: '本校·考试查询(带模块号)',
    method: 'POST',
    page: '/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default',
    data: '/kwgl/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105'
  },
  {
    label: '本校·数据接口 POST',
    method: 'POST',
    page: '/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default',
    data: '/kwgl/kscx_cxXsksxx.html?doType=query&gnmkdm=N358105'
  }
];

/*
 * 正方把考试列表放在 AJAX 后面，服务端会看 X-Requested-With 和 Referer：
 * 用浏览器导航那套头去 POST，会被当成非法请求打回登录页（字节数与登录页一致）。
 *
 * 后面这一组是「客户端提示」头，Chrome 在安全上下文里发 AJAX 必然带。
 * UA 写的是 Chrome 126，这里的 sec-ch-ua 版本号要与之一致，否则反而露馅。
 */
const AJAX_HEADERS = {
  'X-Requested-With': 'XMLHttpRequest',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  // 浏览器发 AJAX 时一定带这几个，缺了容易被前置的 WAF 判成脚本请求
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin'
};

/** 取页面 title：判断返回的到底是登录页、首页还是查询页最快的方法 */
function pageTitle(html) {
  const hit = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return hit ? hit[1].replace(/\s+/g, ' ').trim().slice(0, 20) : '';
}

function queryString(params) {
  return Object.keys(params)
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
    .join('&');
}

// 换学校或换版本时的兜底，按正方常见部署排列
const FALLBACK_PATHS = [
  '/kwgl/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105',
  '/kwgl/kscx_cxXsksxx.html?doType=query&gnmkdm=N358105',
  '/kwgl/kscx_cxXsksxx.html',
  '/xskscx/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105',
  '/kwgl/ksxx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105'
];

// 正方的字段名各版本略有出入，按优先级依次回退
const FIELDS = {
  name: ['kcmc', 'kc', 'kcmcDisplay', 'kcmc_show'],
  time: ['kssj', 'ksrq', 'kssjms', 'ksTime', 'kssj_str'],
  room: ['cdmc', 'cd', 'jsmc', 'ksdd', 'cdmcDisplay'],
  seat: ['zwh', 'zwhDisplay', 'seat'],
  form: ['ksfs', 'ksfsmc', 'kslx', 'ksxs'],
  type: ['ksmc', 'ksmcmc', '考试名称'],
  remark: ['bz', 'remark', 'ksbz']
};

function pick(item, names) {
  for (let i = 0; i < names.length; i += 1) {
    const value = item[names[i]];
    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
}

function normalize(item) {
  return {
    name: pick(item, FIELDS.name),
    time: pick(item, FIELDS.time),
    room: pick(item, FIELDS.room),
    seat: pick(item, FIELDS.seat),
    form: pick(item, FIELDS.form),
    type: pick(item, FIELDS.type),
    campus: pick(item, ['xqmc', 'campus']),
    remark: pick(item, FIELDS.remark)
  };
}

/** 抓取表单里的隐藏字段：正方查询接口要求的某些值只在页面里，硬编码会漏 */
function formValues(html) {
  const text = String(html || '');
  const startMatch = text.match(/<form[^>]*id=["']searchForm["']/i);
  const scope = startMatch ? text.slice(startMatch.index) : text;
  const endIndex = scope.search(/<\/form>/i);
  const body = endIndex >= 0 ? scope.slice(0, endIndex) : scope;

  const values = {};
  const decode = (value) => String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const inputRe = /<input\b[^>]*>/gi;
  let hit;
  while ((hit = inputRe.exec(body))) {
    const tag = hit[0];
    const name = (tag.match(/\bname=["']([^"']+)["']/i) || [])[1];
    if (!name) continue;
    if (/\bdisabled\b/i.test(tag)) continue;
    const type = ((tag.match(/\btype=["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
    if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(tag)) continue;
    const value = (tag.match(/\bvalue=["']([^"']*)["']/i) || [])[1] || '';
    values[name] = decode(value);
  }

  const selectRe = /<select\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
  while ((hit = selectRe.exec(body))) {
    const name = hit[1];
    const inner = hit[2];
    const picked = inner.match(/<option\b[^>]*selected[^>]*value=["']([^"']*)["']/i)
      || inner.match(/<option\b[^>]*value=["']([^"']*)["'][^>]*selected/i)
      || inner.match(/<option\b[^>]*value=["']([^"']*)["']/i);
    values[name] = picked ? decode(picked[1]) : '';
  }

  return values;
}

function parseItems(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch (error) {
    return null;
  }
  const list = (data && (data.items || data.rows || data.list)) || [];
  if (!Array.isArray(list)) return null;
  return {
    total: Number(data.totalResult || data.total || list.length) || list.length,
    exams: list.map(normalize).filter((item) => item.name || item.time)
  };
}

/**
 * 从菜单数据里找考试查询的真实地址。
 * 菜单大多是 JSON，字段名各版本不同，直接对整段文本抠 URL 更省事。
 */
function findExamPath(body) {
  const text = String(body || '');
  if (!text) return '';

  const patterns = [
    /"(https?:\/\/[^"]*?(?:kscx|ksxx)[^"]*)"/i,
    /"(\/jwglxt\/[^"]*?(?:kscx|ksxx)[^"]*)"/i,
    /['"](\/?[a-z0-9_\/]*(?:kscx|ksxx)[^'"]*)['"]/i
  ];

  for (let i = 0; i < patterns.length; i += 1) {
    const hit = text.match(patterns[i]);
    if (!hit) continue;
    let url = hit[1];
    url = url.replace(/^https?:\/\/[^/]+/i, '');
    if (url.indexOf('/jwglxt') === 0) url = url.slice('/jwglxt'.length);
    if (url.charAt(0) !== '/') url = '/' + url;
    return url;
  }
  return '';
}

async function loadMenu(session, root) {
  for (let i = 0; i < MENU_PATHS.length; i += 1) {
    try {
      const response = await session.get(root + MENU_PATHS[i]);
      const path = findExamPath(response.body);
      if (path) return path;
    } catch (error) {
      // 菜单接口不通就走兜底，不在这里报错
    }
  }
  return '';
}

function attemptLine(item) {
  const parts = [];
  if (item.label) parts.push(item.label);
  if (item.status) parts.push('HTTP ' + item.status);
  if (item.bytes !== undefined) parts.push(item.bytes + 'B');
  if (item.error) parts.push('错误 ' + item.error);
  if (item.loginPage) parts.push('跳登录页');
  else if (item.html) parts.push('返回网页');
  else if (item.json === false) parts.push('不是 JSON');
  if (item.head) parts.push('开头 ' + item.head);
  return parts.join(' ');
}

/**
 * 返回统一结构：
 *   { ok: true, exams, total, path }
 *   { ok: false, kind, error, attempts }
 */
async function fetchExamList(options) {
  const { session, root, xnm, xqm, steps } = options;
  const attempts = [];
  // 顺带取（例如导入课表时一起同步）只试第一个候选，别为了考试把导课表拖慢
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 99;

  // 版本标记：诊断里能看到它，就能确认云端跑的是不是这一版代码（改代码时记得改这里）
  const BUILD_TAG = 'exam-1116-f';
  if (steps) steps.push({ step: '0-build', detail: BUILD_TAG });

  /*
   * 这里**不能**先读首页菜单（/xtgl/index_initMenu.html）。
   *
   * 登录成功后请求那个页面，会被服务端当成一次普通导航：它返回登录页，
   * 并下发新的 JSESSIONID，把刚建立的登录态整个覆盖掉。
   * 结果就是后续每个请求都退回登录页（20191B），查询接口直接 901、0 字节 ——
   * 看起来像被防护拦了，其实是自己把会话弄丢了。
   *
   * 菜单发现只在路径未知时才有用；本校路径已从浏览器抓包确认，直接跳过。
   * loadMenu 保留在文件里，换学校时再用，但不要在登录后的同一会话里调用。
   */
  const discovered = '';

  // 会话自检：课表接口是已知可用的，它能通过说明登录和 Cookie 都没问题，
  // 后面考试失败就只可能是接口层面的问题
  let sessionAlive = true;
  let probeSummary = '';

  const probeUrl = root + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
  const isLoginPage = (body) => /name=["']yhm["']/i.test(String(body || ''));

  try {
    const first = await session.get(probeUrl);
    const firstBody = String(first.body || '');
    sessionAlive = !isLoginPage(firstBody);

    if (!sessionAlive) {
      /*
       * 首测拿到登录页有两种可能：
       *   1. 服务端会话还没写完（等一拍就好）；
       *   2. 请求被负载均衡送到了另一台节点，那台不认这个 JSESSIONID。
       * 第 2 种只能靠多试几次命中同一节点，所以这里连试三拍（0.6s / 1.4s）。
       */
      const marks = ['首测'];
      const delays = [600, 1400];
      let tried = 1;
      let lastRes = first;

      for (let i = 0; i < delays.length && !sessionAlive; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, delays[i]));
        const again = await session.get(probeUrl);
        tried += 1;
        lastRes = again;
        sessionAlive = !isLoginPage(String(again.body || ''));
        marks.push('第 ' + tried + ' 次 ' + again.status + ' ' + again.bytes + 'B' +
          (sessionAlive ? ' 已就绪' : ' 登录页'));
      }

      probeSummary = '首测 HTTP ' + first.status + ' ' + first.bytes + 'B 登录页' +
        (tried > 1 ? '；' + marks.slice(1).join('；') : '');
      if (steps) steps.push({ step: '4-session', detail: probeSummary });
      if (sessionAlive && steps) {
        steps.push({ step: '4-session-ok', detail: '第 ' + tried + ' 次请求才命中同一节点，会话已就绪' });
      }
    } else {
      probeSummary = 'HTTP ' + first.status + ' ' + first.bytes + 'B 正常页面' +
        (pageTitle(firstBody) ? ' 标题「' + pageTitle(firstBody) + '」' : '');
      if (steps) steps.push({ step: '4-session', detail: probeSummary });
    }
  } catch (error) {
    // 探活本身失败（连接被重置等）：无法确认会话还在，按「没建立」处理，
    // 让上层重新登录一次，比继续用可疑会话发 8 个必然失败的请求要强
    sessionAlive = false;
    probeSummary = '探活失败 ' + (error.code || error.message);
    if (steps) steps.push({ step: '4-session', detail: probeSummary });
  }

  /*
   * 会话已经失效时不要再往下试：那 8 个请求只会全部打回登录页，
   * 既慢又像在扫描，而且给出的 901 会把人误导成「被防护拦了」。
   */
  if (!sessionAlive) {
    return {
      ok: false,
      kind: 'SESSION_EXPIRED',
      // 版本号写进文案：用户截一张图就能看出云端跑的到底是哪一版
      error: '登录后被退回登录页 [' + BUILD_TAG + ']：' + probeSummary +
        '。三种可能：① 密码不正确或账号被临时限制；' +
        '② 登录会话没落到同一台后端节点（多试几次有机会命中）；' +
        '③ 学校对考试模块有额外限制。' +
        '建议先用电脑浏览器无痕窗口确认能登进教务，再回来重试。',
      attempts: [],
      steps: steps || []
    };
  }

  const candidates = CONFIRMED.slice();
  if (discovered) {
    candidates.push({ label: '菜单发现', page: discovered, data: discovered });
  }
  FALLBACK_PATHS.forEach((item) => {
    candidates.push({ label: '兜底 POST', method: 'POST', page: item, data: item });
  });

  if (steps) {
    steps.push({
      step: '4-exam-path',
      detail: discovered ? '菜单发现 ' + discovered : '用本校确认地址（跳过菜单请求，避免覆盖登录会话）'
    });
  }

  for (let i = 0; i < candidates.length && i < maxAttempts; i += 1) {
    const candidate = candidates[i];
    const path = candidate.data;
    let response;

    try {
      // 先 GET 一次页面：把会话和权限标记坐实，再发查询。
      // 这一步单独记诊断——如果连页面都 901，说明整条路径被前置防护拦了，
      // 跟参数没关系；页面能开、只有 POST 被拒，才是查询接口的问题。
      const pageRes = await session.get(root + candidate.page);
      const pageHtml = String(pageRes.body || '');
      const base = formValues(pageHtml);

      const names = Object.keys(base);
      // 表单里出现 yhm/mm 就说明拿回来的是登录页，不是查询页
      const looksLogin = names.some((name) => /^(yhm|mm)$/i.test(name));

      if (steps) {
        steps.push({
          step: '5-page-' + (i + 1),
          detail: candidate.label + ' 页面 HTTP ' + pageRes.status + ' ' + pageRes.bytes + 'B' +
            (pageHtml.trim().charAt(0) === '<' ? ' 网页' : ' 非网页') +
            (pageTitle(pageHtml) ? ' 标题「' + pageTitle(pageHtml) + '」' : '') +
            ' 表单字段 ' + names.length +
            (looksLogin ? ' ⚠疑似登录页' : '') +
            (names.length ? ' [' + names.slice(0, 6).join(',') + ']' : '')
        });
      }

      /*
       * 拿回来的是登录页：会话这次已经失效了，后面 7 个候选只会重复同样的事，
       * 查询也必然是 901。立刻上报，交给上层重新登录一次，比硬试完更干净。
       */
      if (looksLogin) {
        return {
          ok: false,
          kind: 'SESSION_EXPIRED',
          error: '打开考试查询页时被退回了登录页，说明这次登录的会话没有保住。已自动为你重试，如果仍然这样请稍后再试。',
          attempts: attempts,
          steps: steps || []
        };
      }

      // 页面表单里的字段一个都不能少：正方把查询上下文藏在这里，硬编码会漏
      const form = Object.assign({}, base, {
        xnm: xnm,
        xqm: xqm,
        ksmcdmb_id: base.cx_ksmcdmb_id || '',
        kch: base.cx_kch || '',
        kc: base.kc_cx || '',
        ksrq: base.cx_ksrq || '',
        _search: 'false',
        nd: String(Date.now()),
        'queryModel.showCount': '100',
        'queryModel.currentPage': '1',
        'queryModel.sortName': '',
        'queryModel.sortOrder': 'asc',
        time: '0'
      });
      const origin = (root.match(/^(https?:\/\/[^/]+)/i) || [])[1] || '';
      const headers = Object.assign({ Referer: root + candidate.page, Origin: origin }, AJAX_HEADERS);
      const config = candidate.method === 'GET'
        ? { method: 'GET', headers: headers }
        : { method: 'POST', headers: headers, form: form };
      const target = candidate.method === 'GET'
        ? root + candidate.data + '&' + queryString(form)
        : root + candidate.data;
      response = await session.request(target, config);
    } catch (error) {
      const record = { path: path, label: candidate.label, error: error.code || error.message };
      attempts.push(record);
      if (steps) steps.push({ step: '5-exam-' + (i + 1), detail: attemptLine(record) });
      continue;
    }

    const body = String(response.body || '');
    const head = body.trim().slice(0, 1);
    const record = {
      path: path,
      label: candidate.label,
      status: response.status,
      bytes: response.bytes,
      html: head === '<',
      // 只留开头一小段，够判断返回的是登录页、普通网页还是 JSON
      head: head === '<' ? body.replace(/\s+/g, ' ').slice(0, 60) : ''
    };

    if (head === '<') {
      record.loginPage = /login_slogin|name="yhm"/.test(body);
      attempts.push(record);
      if (steps) steps.push({ step: '5-exam-' + (i + 1), detail: attemptLine(record) });
      continue;
    }

    const parsed = parseItems(body);
    if (parsed) {
      record.count = parsed.exams.length;
      attempts.push(record);
      if (steps) steps.push({ step: '5-exam-' + (i + 1), detail: attemptLine(record) });
      return {
        ok: true,
        exams: parsed.exams,
        total: parsed.total,
        path: path,
        attempts: attempts,
        // 成功时也带上步骤：本地脚本和云端成功都能看到登录跳去了哪，便于对比
        steps: steps || []
      };
    }

    record.json = false;
    attempts.push(record);
    if (steps) steps.push({ step: '5-exam-' + (i + 1), detail: attemptLine(record) });
  }

  const sawLogin = attempts.some((item) => item.loginPage);
  if (sawLogin) {
    return {
      ok: false,
      kind: 'SESSION_EXPIRED',
      error: '登录后会话失效，请重试一次。',
      attempts: attempts
    };
  }

  /*
   * 把「页面能不能打开」也写进正文：
   *   页面 200、只有查询 901 → 是查询接口这一层被前置防护拦了；
   *   页面也是 901          → 整条 /kwgl 路径在登录态被拦。
   * 这两种情况的处理方式完全不同，必须分开看，而用户往往不会展开诊断面板。
   */
  const pageLines = (steps || [])
    .filter((item) => item && /^(0-build|3-login-post|3b-landing|4-session|5-page-)/.test(String(item.step || '')))
    .map((item) => {
      const name = String(item.step || '');
      // 登录与跟随那两步存的是散字段，不是 detail 文本，单独拼
      if (name === '3-login-post') {
        // 不截断：Location 的 query 里常常带着失败原因，截掉就只剩「跳登录页」这个结论
        const loc = String(item.location || '');
        return name + ' HTTP ' + item.status + ' ' + item.bytes + 'B' +
          (loc ? ' 跳往 ' + loc : ' 未跳转') +
          ' Cookie[' + ((item.cookies || []).join(',')) + ']';
      }
      if (name === '3b-landing') {
        if (item.error) return name + ' 失败 ' + item.error;
        return name + ' HTTP ' + item.status + ' ' + item.bytes + 'B' +
          (item.loginPage ? ' 又退回登录页' : ' 已进入首页');
      }
      return name + ' ' + (item.detail || item.error || '');
    });

  const tried = attempts
    .slice(0, 4)
    .map((item) => (item.label || '尝试') + ' ' + attemptLine(item))
    .join('；');

  return {
    ok: false,
    kind: 'QUERY_DENIED',
    error: '教务系统没有返回考试数据。' +
      (pageLines.length ? '页面阶段：' + pageLines.join('；') + '。' : '') +
      '查询阶段：' + (tried || '无') +
      '。把这段文字发给开发者即可定位。',
    attempts: attempts
  };
}

module.exports = { fetchExamList, findExamPath, FALLBACK_PATHS, MENU_PATHS };
