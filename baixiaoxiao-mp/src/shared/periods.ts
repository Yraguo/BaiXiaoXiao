// 默认节次时间表（PRD 附录 C，已确认 2026-09-18）
export interface PeriodTime { period: number; start: string; end: string }

export const DEFAULT_PERIOD_TIMES: PeriodTime[] = [
  { period: 1, start: '08:00', end: '08:45' },
  { period: 2, start: '08:50', end: '09:35' },
  { period: 3, start: '09:45', end: '10:30' },
  { period: 4, start: '10:40', end: '11:25' },
  { period: 5, start: '11:30', end: '12:15' },
  { period: 6, start: '13:30', end: '14:15' },
  { period: 7, start: '14:20', end: '15:05' },
  { period: 8, start: '15:15', end: '16:00' },
  { period: 9, start: '16:05', end: '16:50' },
  { period: 10, start: '18:00', end: '18:45' },
  { period: 11, start: '18:50', end: '19:35' },
  { period: 12, start: '19:40', end: '20:25' }
];

/**
 * 课表调色板。12 色是当初随手定的，但一门主课表常有 14~18 门课，
 * 12 色必然撞（真机反馈"默认会变成一个颜色"）。扩到 18 色，
 * 新增的 6 个都取"同色相更深一档"，保证白字对比度不掉。
 */
export const COURSE_COLORS = [
  '#2E5AAC', '#E8624C', '#3FA97B', '#8E6BC9', '#E8A33D', '#2F9DB5',
  '#C9547E', '#6B8F3F', '#5A6EE8', '#B5762F', '#3F9E8E', '#8A5AA0',
  '#B23A2E', '#2F6B4F', '#3B4A6B', '#7A4E2C', '#5E3A87', '#276B7A'
];

/**
 * 同一门课永远同一个颜色。
 * 旧做法是在导入时按行号取模（i % 12），于是"高等数学"出现在第 3 行和第 40 行
 * 就成了两种颜色 —— 真机反馈"相同的课程没有统一颜色"就是这个。
 * 这里改成对课程名做稳定哈希：不依赖顺序，重复导入/换学期都不会变色，
 * 用户手动选过色（colorSet）时由界面层优先用手动色。
 */
export function courseColorIndex(name: string): number {
  const key = (name || '').replace(/\s+/g, '');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % COURSE_COLORS.length;
}

/**
 * 一张课表里的颜色分配：同一门课恒定同色，且**不同课尽量不同色**。
 * 纯按课程名哈希会有"生日撞车"——十几门课丢进 12 个色位，必然有课共用一个颜色
 * （真机反馈"默认会变成一个颜色"）。这里在哈希的基础上做确定性探测：
 * 先按课程名排序（与导入顺序无关），取哈希位，被占了就顺移，12 门以内保证互不相同。
 */
export function assignCourseColors(names: string[]): Record<string, number> {
  const norm = (x: string) => (x || '').replace(/\s+/g, '');
  const uniq = Array.from(new Set(names.map(norm).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'zh'));
  const out: Record<string, number> = {};
  const used = new Set<number>();
  const n = COURSE_COLORS.length;
  for (const name of uniq) {
    const base = courseColorIndex(name);
    let idx = base;
    for (let k = 0; k < n; k++) {
      const cand = (base + k) % n;
      if (!used.has(cand)) { idx = cand; break; }
      if (k === n - 1) idx = cand;   // 超过 12 门课只能复用
    }
    used.add(idx);
    out[name] = idx;
  }
  return out;
}
