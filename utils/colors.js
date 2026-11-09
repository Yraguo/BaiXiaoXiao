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

/**
 * 深色主题下的同一组课：浅底压成暗色（色相不变、明度降到 0.175），
 * 字提亮到 0.775。两套共用同一个下标，所以切主题时「一门课一个颜色」
 * 不会错位。
 */
const COURSE_PALETTE_DARK = [
  { bg: '#1E283B', ink: '#A6BCE5' },
  { bg: '#3C231E', ink: '#E7B0A5' },
  { bg: '#20392E', ink: '#AAE1C8' },
  { bg: '#2A2337', ink: '#BEACDF' },
  { bg: '#3C301D', ink: '#EDCD9F' },
  { bg: '#1F353A', ink: '#A7D8E4' },
  { bg: '#39202A', ink: '#E1AAC1' },
  { bg: '#2E3723', ink: '#CADFAC' },
  { bg: '#202239', ink: '#AAAFE2' },
  { bg: '#3A2D1F', ink: '#E3C6A8' },
  { bg: '#213835', ink: '#ACDFDA' },
  { bg: '#302336', ink: '#CFACDF' },
  { bg: '#3A221F', ink: '#E3AEA8' },
  { bg: '#22372D', ink: '#ACDFC6' },
  { bg: '#232936', ink: '#ACBCDF' },
  { bg: '#382C21', ink: '#E0C4AC' },
  { bg: '#2B2336', ink: '#C2ACDF' },
  { bg: '#203539', ink: '#A9D8E2' }
];

/** 深色字，也用作详情页/下一节课前面的小圆点 */
const COURSE_COLORS = COURSE_PALETTE.map((item) => item.ink);
/** 浅色底，给课表格子用 */
const COURSE_TINTS = COURSE_PALETTE.map((item) => item.bg);

function courseTint(index, theme) {
  const list = theme === 'dark' ? COURSE_PALETTE_DARK.map((item) => item.bg) : COURSE_TINTS;
  const size = list.length;
  return list[((Number(index) || 0) % size + size) % size];
}

/** 课名文字色：浅色用深字，深色用亮字 */
function courseInk(index, theme) {
  const list = theme === 'dark' ? COURSE_PALETTE_DARK.map((item) => item.ink) : COURSE_COLORS;
  const size = list.length;
  return list[((Number(index) || 0) % size + size) % size];
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

module.exports = {
  COURSE_COLORS,
  COURSE_PALETTE_DARK,
  COURSE_TINTS,
  assignCourseColors,
  courseColorIndex,
  courseInk,
  courseTint,
  normalizeName
};

