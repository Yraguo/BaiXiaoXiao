/**
 * 小程序端 → 云函数 jwimport 的调用封装。
 *
 * 为什么要走云函数：真机上 wx.request 的 Cookie 会被网络层丢掉、请求体还会被二次转义，
 * 而且正方私钥存在服务端会话里，学校又有多台节点，请求一漂移密文就解不开。
 * 放进云函数后，整条链在同一个 Node 连接里串行跑完，上面三个问题都不存在。
 *
 * 返回结构与旧的「本机直连」importTimetable 保持完全一致：
 *   { ok, kind, error, courses, term, steps }
 * 页面只要把 import 的来源换掉，其余逻辑一行不用改。
 */

const FN_NAME = 'jwimport';

/** 云函数自身有 18 秒硬超时，客户端留一点余量，避免用户对着转圈等到失去耐心 */
const CLIENT_TIMEOUT_MS = 25000;

function emptyResult(kind, error, steps) {
  return {
    ok: false,
    kind: kind,
    error: error,
    courses: [],
    term: null,
    steps: steps || []
  };
}

/** 云函数是否可用：基础库太旧或没初始化过就没有 callFunction */
function isCloudReady() {
  return !!(wx.cloud && typeof wx.cloud.callFunction === 'function');
}

/**
 * 把云函数返回的 steps 转成诊断面板能直接显示的行。
 * 只显示状态码、字节数、耗时这类结构信息，不含密码、密文、Cookie 值。
 */
function stepLines(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((item) => {
    const step = item && item.step ? item.step : 'step';
    const parts = [];
    ['status', 'bytes', 'ms', 'cookies', 'courses', 'kbRows', 'loginPage', 'error'].forEach((key) => {
      const value = item && item[key];
      if (value === undefined || value === null || value === '') return;
      const text = Array.isArray(value) ? value.join(',') : String(value);
      parts.push(key + '=' + text);
    });
    return parts.length ? step + '  ' + parts.join('  ') : step;
  });
}

/**
 * @param {{username:string, password:string, xnm?:string, semester?:number, address?:string}} input
 * @returns {Promise<object>} 与 importTimetable 同构
 */
function cloudImport(input) {
  if (!isCloudReady()) {
    return Promise.resolve(emptyResult(
      'CLOUD_UNAVAILABLE',
      '当前微信版本不支持云开发，请升级微信后重试，或改用 PDF 导入。'
    ));
  }

  const payload = {
    username: String((input && input.username) || '').trim(),
    password: String((input && input.password) || ''),
    xnm: (input && input.xnm) || '',
    semester: (input && input.semester) || 1,
    address: (input && input.address) || ''
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(emptyResult(
        'TIMEOUT',
        '云端响应太慢，本次导入已中止。教务系统高峰期容易这样，稍后再试一次，或改用 PDF 导入。'
      ));
    }, CLIENT_TIMEOUT_MS);

    wx.cloud.callFunction({
      name: FN_NAME,
      data: payload,
      success: (res) => {
        const result = res && res.result;
        if (!result || typeof result !== 'object') {
          finish(emptyResult(
            'CLOUD_FAILED',
            '云函数没有返回结果，可能还没部署。请开发者重新上传一次云函数。'
          ));
          return;
        }
        finish(result);
      },
      fail: (error) => {
        const message = String((error && (error.errMsg || error.message)) || '');
        // -501000 环境不存在 / 函数未部署；-404011 客户端网络问题
        if (/not found|does not exist|-501000|FunctionName/i.test(message)) {
          finish(emptyResult(
            'CLOUD_UNAVAILABLE',
            '云导入服务还没部署好，暂时只能用 PDF 导入。',
            [{ step: 'callFunction', error: message }]
          ));
          return;
        }
        finish(emptyResult(
          'CLOUD_FAILED',
          '连不上云导入服务，请检查网络后重试，或改用 PDF 导入。',
          [{ step: 'callFunction', error: message }]
        ));
      }
    });
  });
}

module.exports = { cloudImport, isCloudReady, stepLines, FN_NAME };
