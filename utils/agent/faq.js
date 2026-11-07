/**
 * 兜底检索：小型 FAQ 库 + BM25。
 *
 * 比朴素 TF-IDF 余弦好在两点：词频做了饱和（同一词出现十次不等于重要十倍），
 * 并按文档长度做了归一化（长答案不会天然占便宜）。中文没有分词器，
 * 词项用二元组（bigram），配合一张很小的同义词表，把"课表/课程表""导进/导入"并到一处。
 *
 * 命中阈值按归一化分数（0~1）判断，低于阈值宁可承认答不上来，也不硬套。
 */

const { normalize } = require('./nlu');

const FAQ = [
  {
    q: '怎么导入课表 课表咋导进去 pdf 导入步骤 输出pdf 文件传输助手',
    a: '课表页 →「导入课表」→ 默认就是 PDF 导入 → 选择文件。导出方式是：电脑浏览器进教务「信息查询 → 学生课表查询」，选好学年学期点「输出 PDF」，把文件发到微信（文件传输助手即可），再回小程序选择。全程本机解析，不联网。'
  },
  {
    q: '教务系统登录失败 密码错误 登不上 正方 域名',
    a: '教务直连受微信网络层和学校多节点会话影响，部分真机就是过不了。先确认两件事：公众平台「request 合法域名」里加了 https://jwglxt.buct.edu.cn；以及没被临时锁定（本校 5 次失败锁 30 分钟）。实在不行用 PDF 导入，效果一样。'
  },
  {
    q: '支持哪些学校 只有北化吗 其他学校能用吗',
    a: '当前按北京化工大学的正方教务系统适配。PDF 导入理论上通用：只要学校导出的课表 PDF 是带文字层的表格（UniGB-UCS2-H 编码），就能解析；截图或扫描件不行。'
  },
  {
    q: '数据会上传吗 隐私 安全 会不会泄露 联网吗',
    a: '不会。课表、记事、头像昵称都只存在微信本地缓存，PDF 只在本机内存解析，小鸮也只是读本地数据算答案——整个小程序没有任何后端请求。'
  },
  {
    q: '换手机 数据迁移 备份 同步',
    a: '目前没有云同步，换手机后课表需要重新导入一次。记事也只在当前设备，卸载或清理小程序数据会清空。'
  },
  {
    q: '怎么改学期 开学时间 周数 第一周 设置',
    a: '「我的」→ 课表设置，可以改学期名称、第一周周一、总周数和每节课时间。周次是按第一周周一推算的，改完课表会跟着重排。'
  },
  {
    q: '记事会提醒吗 通知 闹钟 定时',
    a: '不会准时弹通知。小程序没有后台常驻能力，「时间备注」只是记在那一行里方便查看。真正要提醒建议配合系统日历或闹钟。'
  },
  {
    q: '空教室 考试安排 成绩 选课 能查吗',
    a: '暂时不能。空教室、考试、成绩、选课都需要教务接口或额外数据源，课表 PDF 里没有这些信息。'
  },
  {
    q: '为什么没有课 周次不对 课表空了 少课',
    a: '先看「课表设置」里的第一周周一是否正确——周次全按它推算。另外导入时如果课程周次超出总周数会被裁掉，把总周数调大即可。'
  }
];

/** 很小的同义词表：只做"同一种说法的归一"，不做语义扩展 */
const SYNONYMS = [
  [/课程表|时间表|功课表/g, '课表'],
  [/导进|导到|放进|弄进|加进/g, '导入'],
  [/待办事项|待办|任务清单|任务/g, '记事'],
  [/换机|换手机/g, '换手机'],
  [/咋弄|怎么弄|咋办/g, '怎么办']
];

function expand(text) {
  let value = String(text || '');
  SYNONYMS.forEach((pair) => { value = value.replace(pair[0], pair[1]); });
  return value;
}

function tokens(text) {
  const value = expand(normalize(text)).replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  if (!value) return [];
  if (value.length <= 2) return [value];
  const out = [];
  for (let index = 0; index < value.length - 1; index += 1) out.push(value.slice(index, index + 2));
  return out;
}

const K1 = 1.2;
const B = 0.75;

const DOCUMENTS = FAQ.map((item) => tokens(item.q));
const DOC_COUNT = DOCUMENTS.length;
const AVG_LENGTH = DOCUMENTS.reduce((sum, doc) => sum + doc.length, 0) / DOC_COUNT;

const IDF = (() => {
  const df = {};
  DOCUMENTS.forEach((doc) => {
    Array.from(new Set(doc)).forEach((term) => { df[term] = (df[term] || 0) + 1; });
  });
  const table = {};
  Object.keys(df).forEach((term) => {
    // BM25 的概率式 IDF，常见词（"课表"）不会像经典 IDF 那样被压到 0
    table[term] = Math.log(1 + (DOC_COUNT - df[term] + 0.5) / (df[term] + 0.5));
  });
  return table;
})();

function bm25(queryTerms, doc) {
  const tf = {};
  doc.forEach((term) => { tf[term] = (tf[term] || 0) + 1; });
  let score = 0;
  queryTerms.forEach((term) => {
    const frequency = tf[term];
    if (!frequency) return;
    const idf = IDF[term] || Math.log(1 + (DOC_COUNT + 0.5) / 0.5);
    const saturated = (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * doc.length / AVG_LENGTH));
    score += idf * saturated;
  });
  return score;
}

/**
 * @param {string} text 用户输入
 * @param {number} threshold 归一化分数阈值，默认 0.2（实测无关问句均在 0.09 以下）
 * @returns {{answer:string, score:number}}
 */
function lookup(text, threshold) {
  const queryTerms = Array.from(new Set(tokens(text)));
  if (!queryTerms.length) return { answer: '', score: 0 };

  const ceiling = queryTerms.reduce((sum, term) => sum + (IDF[term] || Math.log(1 + (DOC_COUNT + 0.5) / 0.5)), 0);
  let best = { index: -1, score: 0 };
  DOCUMENTS.forEach((doc, index) => {
    const score = ceiling ? bm25(queryTerms, doc) / ceiling : 0;
    if (score > best.score) best = { index, score };
  });

  const limit = typeof threshold === 'number' ? threshold : 0.2;
  if (best.index < 0 || best.score < limit) return { answer: '', score: best.score };
  return { answer: FAQ[best.index].a, score: best.score };
}

module.exports = { FAQ, lookup, tokens };
