/**
 * 云函数入口：教务课表导入
 *
 * 调用方式（小程序端 wx.cloud.callFunction）：
 *   { username, password, xnm, semester }  → 登录并返回课表
 *   { action: 'probe' }                    → 只测连通性，不碰凭据
 *
 * 返回：
 *   { ok: true, courses: [...], term: {...}, steps: [...] }
 *   { ok: false, kind, error, courses: [], term: null, steps: [...] }
 *
 * 【安全】不记录、不返回密码与密文；steps 里只有状态码、字节数、Cookie 名。
 */

const { runProbe } = require('./lib/probe');
const { importTimetable } = require('./lib/importer');

const HARD_TIMEOUT_MS = 18000;

function timeoutResult() {
  return {
    ok: false,
    kind: 'TIMEOUT',
    error: '教务系统响应太慢，本次导入已中止，请稍后重试。',
    courses: [],
    term: null,
    steps: []
  };
}

/**
 * 控制台「云端测试」的默认模板会把参数包在 data 里，
 * 真机 wx.cloud.callFunction 则是直接平铺。两种都接受。
 */
function normalize(event) {
  const raw = event || {};
  const inner = raw.data;
  if (
    inner &&
    typeof inner === 'object' &&
    !raw.username &&
    !raw.password &&
    !raw.action &&
    (inner.username || inner.password || inner.action)
  ) {
    return inner;
  }
  return raw;
}

exports.main = async (event) => {
  const input = normalize(event);
  const action = String(input.action || '');

  // 没有凭据就当作探针，方便在控制台直接点「云端测试」
  if (action === 'probe' || (!input.username && !input.password)) {
    return runProbe(input);
  }

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timeoutResult()), HARD_TIMEOUT_MS);
  });

  try {
    return await Promise.race([importTimetable(input), timeout]);
  } catch (error) {
    return {
      ok: false,
      kind: 'UNKNOWN',
      error: String((error && error.message) || '导入失败'),
      courses: [],
      term: null,
      steps: []
    };
  } finally {
    clearTimeout(timer);
  }
};
