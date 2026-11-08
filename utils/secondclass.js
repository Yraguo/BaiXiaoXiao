/**
 * 第二课堂（二课）记录的数据模型与统计。
 *
 * 学校口径里叫「第二课堂成绩单」：志愿公益、劳动教育、讲座、社会实践这些
 * 课外活动按学分记进成绩单。这里只做学生自己的一本账——记了什么、多少分、
 * 算哪一类，然后按类别汇总。全程在本机，不联网、不上传。
 */

const CATEGORIES = [
  { key: 'volunteer', name: '志愿公益' },
  { key: 'labor', name: '劳动教育' },
  { key: 'lecture', name: '讲座报告' },
  { key: 'practice', name: '社会实践' },
  { key: 'culture', name: '文体活动' },
  { key: 'innovation', name: '创新创业' },
  { key: 'other', name: '其他' }
];

const DEFAULT_KEY = 'other';

function categoryOf(key) {
  return CATEGORIES.find((item) => item.key === key) || CATEGORIES[CATEGORIES.length - 1];
}

function categoryName(key) {
  return categoryOf(key).name;
}

/** 容错：老数据缺字段、手滑传了字符串，都收敛成同一种结构 */
function normalizeRecord(raw) {
  const source = raw || {};
  const date = String(source.date || '');
  return {
    id: String(source.id || ''),
    title: String(source.title || '').trim(),
    category: CATEGORIES.some((item) => item.key === source.category) ? source.category : DEFAULT_KEY,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    credits: Math.max(0, Number(source.credits) || 0),
    organizer: String(source.organizer || '').trim(),
    note: String(source.note || '').trim()
  };
}

function formatCredits(value) {
  const number = Math.max(0, Number(value) || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

/** 学分留一位小数，避免 0.1 + 0.2 这种浮点尾巴显示成 0.30000000000000004 */
function roundCredits(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

/**
 * @param {Array} records 原始记录
 * @returns {{list:Array, total:number, totalText:string, count:number, byCategory:Array}}
 */
function summarize(records) {
  const list = (Array.isArray(records) ? records : [])
    .map(normalizeRecord)
    .filter((record) => record.title)
    .sort((left, right) => String(right.date).localeCompare(String(left.date))
      || left.title.localeCompare(right.title, 'zh'));

  const total = roundCredits(list.reduce((sum, record) => sum + record.credits, 0));
  const byCategory = CATEGORIES.map((category) => {
    const items = list.filter((record) => record.category === category.key);
    return {
      key: category.key,
      name: category.name,
      count: items.length,
      credits: roundCredits(items.reduce((sum, record) => sum + record.credits, 0))
    };
  }).filter((category) => category.count > 0);

  return { list, total, totalText: formatCredits(total), count: list.length, byCategory };
}

module.exports = {
  CATEGORIES,
  categoryName,
  categoryOf,
  formatCredits,
  normalizeRecord,
  roundCredits,
  summarize
};
