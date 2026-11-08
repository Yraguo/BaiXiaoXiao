/**
 * 课程配色：一门课一个颜色。
 * 每项是「浅色底 + 同色系深字」一对，色块用底、文字用字，
 * 白卡片上比纯色块更耐看，也不会因为颜色太多而花。
 */
const COURSE_PALETTE = [
  { bg: '#E9EEFB', ink: '#2E5AAC' },
  { bg: '#FDE8E4', ink: '#C0492F' },
  { bg: '#E3F5EC', ink: '#2F8F63' },
  { bg: '#EFE8FA', ink: '#6E4BB0' },
  { bg: '#FCF1DC', ink: '#A9701C' },
  { bg: '#E3F2F6', ink: '#2A7F94' },
  { bg: '#FBE6EF', ink: '#B23A6B' },
  { bg: '#F0F4E3', ink: '#5C7A33' },
  { bg: '#E7E9FE', ink: '#4753C4' },
  { bg: '#F6EADD', ink: '#8A5A29' },
  { bg: '#E3F1F0', ink: '#2F7F76' },
  { bg: '#F1E7F5', ink: '#6B3F80' },
  { bg: '#FBE7E5', ink: '#9C3A2E' },
  { bg: '#E4F2E9', ink: '#2A6B4B' },
  { bg: '#E8EBF2', ink: '#39455F' },
  { bg: '#F3EAE0', ink: '#6B4726' },
  { bg: '#EDE7F7', ink: '#4E3373' },
  { bg: '#E2F0F2', ink: '#225E6B' }
];

/** 深色字，也用作详情页/下一节课前面的小圆点 */
const COURSE_COLORS = COURSE_PALETTE.map((item) => item.ink);
/** 浅色底，给课表格子用 */
const COURSE_TINTS = COURSE_PALETTE.map((item) => item.bg);

function courseTint(index) {
  const size = COURSE_TINTS.length;
  return COURSE_TINTS[((Number(index) || 0) % size + size) % size];
}

function normalizeName(name) {
  return String(name || '').replace(/\s+/g, '');
}

function courseColorIndex(name) {
  const key = normalizeName(name);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return hash % COURSE_COLORS.length;
}

function assignCourseColors(names) {
  const unique = Array.from(new Set((names || []).map(normalizeName).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'zh'));
  const output = {};
  const used = new Set();

  unique.forEach((name) => {
    const base = courseColorIndex(name);
    let selected = base;
    for (let offset = 0; offset < COURSE_COLORS.length; offset += 1) {
      const candidate = (base + offset) % COURSE_COLORS.length;
      if (!used.has(candidate)) {
        selected = candidate;
        break;
      }
    }
    used.add(selected);
    output[name] = selected;
  });

  return output;
}

module.exports = { COURSE_COLORS, COURSE_TINTS, assignCourseColors, courseColorIndex, courseTint, normalizeName };

