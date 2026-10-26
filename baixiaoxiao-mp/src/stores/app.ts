/**
 * 应用状态
 *
 * 【原实现】src/stores/db.ts，1059 行，Pinia setup store
 * 【这里】小程序骨架版：保留原工程的**数据形状**（timetables / courses / timetableId），
 *   这样后面把 db.ts 整份搬过来时，模板里的 `db.activeTab`、`db.coursesOn` 这类引用不用改。
 *
 * 用 reactive 单例而不是 Pinia：少一个依赖，行为等价。
 */
import { computed, reactive } from 'vue';
import { readJson, writeJson } from '../adapters/storage';
import { COURSE_COLORS, courseColorIndex } from '../shared/periods';

/* ============================ 数据模型 ============================ */

export interface Timetable {
  id: string;
  name: string;
  /** 学期标签，如「2025-2026 秋」 */
  semesterLabel: string;
  /** 学期第一周的周一，'YYYY-MM-DD'。当前周次由它推算 */
  semesterStartMonday: string;
  totalWeeks: number;
  createdAt: string;
  updatedAt: string;
}

export interface Course {
  id: string;
  timetableId: string;
  name: string;
  teacher: string;
  room: string;
  campus: string;
  /** 1=周一 … 7=周日（教务口径） */
  day: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
  /** 原始周次文字，手工添加时按所选周次生成，便于回显 */
  weeksRaw: string;
  credit: number | null;
  examMode: string;
  colorIndex: number;
  /** 用户手动选过色 = true；否则颜色按课程名自动算 */
  colorSet?: boolean;
  source: 'manual' | 'jwglxt';
  remark: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodoItem {
  id: string;
  title: string;
  due: string;
  done: boolean;
}

export interface Session {
  displayName: string;
  username: string;
  isDemo: boolean;
}

/* ============================ 工具函数 ============================ */

export function uid(prefix = 'c'): string {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date → 'YYYY-MM-DD' */
export function dateStamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 取某天所在周的周一 */
export function mondayOf(d = new Date()): string {
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  return dateStamp(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (dow - 1)));
}

/** 学期第一周周一 + 今天 → 第几周（钳在 1..totalWeeks） */
export function weekOfToday(semesterStartMonday: string, totalWeeks: number): number {
  const start = new Date(semesterStartMonday.replace(/-/g, '/'));
  if (Number.isNaN(start.getTime())) return 1;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((today.getTime() - start.getTime()) / 86400000);
  const w = Math.floor(days / 7) + 1;
  if (w < 1) return 1;
  if (w > totalWeeks) return totalWeeks;
  return w;
}

/** 把周次数组压成人类可读的文字：「1-8,10-12」 */
export function weeksToText(weeks: number[]): string {
  if (!weeks.length) return '';
  const s = [...weeks].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  let start = s[0];
  let prev = s[0];
  for (let i = 1; i < s.length; i++) {
    if (s[i] === prev + 1) {
      prev = s[i];
      continue;
    }
    runs.push([start, prev]);
    start = s[i];
    prev = s[i];
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(',');
}

/** 两门课的节次是否重叠 */
export function periodOverlap(
  a: { startPeriod: number; endPeriod: number },
  b: { startPeriod: number; endPeriod: number }
): boolean {
  return a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod;
}

/** 两门课的周次是否有交集 */
export function weekOverlap(a: number[], b: number[]): boolean {
  return a.some((w) => b.includes(w));
}

/* ============================ 初始数据 ============================ */

const DEFAULT_WEEKS = 18;

function currentSemesterLabel(): string {
  const now = new Date();
  const y = now.getFullYear();
  // 8 月之后算秋季学期，其余算春季学期
  return now.getMonth() >= 7 ? `${y}-${y + 1} 秋` : `${y - 1}-${y} 春`;
}

function makeTimetable(name: string, totalWeeks = DEFAULT_WEEKS): Timetable {
  const now = new Date().toISOString();
  return {
    id: uid('tt'),
    name,
    semesterLabel: currentSemesterLabel(),
    // 默认往前推 5 周 —— 首次打开时"已经在学期中"，比第 1 周更接近真实使用场景
    semesterStartMonday: mondayOf(new Date(Date.now() - 7 * 5 * 86400000)),
    totalWeeks,
    createdAt: now,
    updatedAt: now
  };
}

function demoCourses(timetableId: string): Course[] {
  const rows: Array<[string, string, string, number, number, number, number, number]> = [
    ['高等数学 B(Ⅰ)', '王老师', '主教 301', 1, 1, 2, 1, 16],
    ['大学物理', '李老师', '主教 205', 1, 3, 4, 1, 16],
    ['程序设计基础', '张老师', '实验楼 A402', 2, 1, 3, 1, 8],
    ['大学英语', '刘老师', '文理楼 108', 2, 6, 7, 1, 16],
    ['线性代数', '陈老师', '主教 402', 3, 2, 3, 1, 16],
    ['体育（篮球）', '赵老师', '体育馆', 3, 8, 9, 1, 16],
    ['无机化学实验', '孙老师', '化工楼 210', 4, 3, 5, 3, 12],
    ['思想道德与法治', '周老师', '文理楼 301', 4, 10, 11, 1, 16],
    ['高等数学 B(Ⅰ)', '王老师', '主教 301', 5, 1, 2, 1, 16],
    ['工程制图', '吴老师', '机械楼 105', 5, 6, 8, 1, 16]
  ];
  const now = new Date().toISOString();
  return rows.map(([name, teacher, room, day, sp, ep, w1, w2]) => {
    const weeks: number[] = [];
    for (let w = w1; w <= w2; w++) weeks.push(w);
    return {
      id: uid(),
      timetableId,
      name,
      teacher,
      room,
      campus: '',
      day,
      startPeriod: sp,
      endPeriod: ep,
      weeks,
      weeksRaw: weeksToText(weeks) + ' 周',
      credit: null,
      examMode: '',
      colorIndex: courseColorIndex(name),
      source: 'manual' as const,
      remark: '',
      createdAt: now,
      updatedAt: now
    };
  });
}

/* ============================ 加载与迁移 ============================ */

const KEY = 'state/v2';
const KEY_V1 = 'state/v1';

interface Persisted {
  session: Session | null;
  currentWeek: number;
  timetables: Timetable[];
  activeTimetableId: string;
  courses: Course[];
  todos: TodoItem[];
  notes: NoteItem[];
  records: ScoreRecord[];
  hours: HourEntry[];
}

function bootstrap(): Persisted {
  const v2 = readJson<Persisted | null>(KEY, null);
  // v2 存在就以它为准 —— 哪怕 timetables 是空数组（用户真的删光了/新装）。
  // 新加的三个集合要给老数据兜底，否则升级上来的用户读到 undefined 会白屏。
  if (v2 && Array.isArray(v2.timetables)) {
    return {
      ...v2,
      notes: Array.isArray(v2.notes) ? v2.notes : [],
      records: Array.isArray(v2.records) ? v2.records : [],
      hours: Array.isArray(v2.hours) ? v2.hours : []
    };
  }

  /*
   * 【首次启动 = 没有课表】
   * 产品要求：一进来是空的，让用户主动去「添加课表」（自动导入 / 手动建）。
   * 所以这里**不塞演示数据** —— 演示数据改成用户主动点「用示例看看」才生成（seedDemoTimetable）。
   * 只有从 v1（老的单课表版本）升级上来的用户，才把他原来的课表接过来。
   */
  const v1 = readJson<any>(KEY_V1, null);
  if (!v1 || !Array.isArray(v1.courses) || !v1.courses.length) {
    return {
      session: null,
      currentWeek: 1,
      timetables: [],
      activeTimetableId: '',
      courses: [],
      todos: [],
      notes: [],
      records: [],
      hours: []
    };
  }

  const tt = makeTimetable('我的课表', v1?.totalWeeks || DEFAULT_WEEKS);
  if (v1?.semesterStartMonday) tt.semesterStartMonday = v1.semesterStartMonday;

  const courses: Course[] = v1.courses.map((c: any) => ({
        ...c,
        timetableId: tt.id,
        weeksRaw: c.weeksRaw || weeksToText(c.weeks || []),
        campus: c.campus || '',
        credit: c.credit ?? null,
        examMode: c.examMode || '',
        remark: c.remark || '',
        source: c.source || 'manual',
        createdAt: c.createdAt || new Date().toISOString(),
        updatedAt: c.updatedAt || new Date().toISOString()
      }));

  return {
    session: v1?.session ?? null,
    currentWeek: v1?.currentWeek || weekOfToday(tt.semesterStartMonday, tt.totalWeeks),
    timetables: [tt],
    activeTimetableId: tt.id,
    courses,
    todos: v1?.todos ?? [],
    notes: [],
    records: [],
    hours: []
  };
}

const boot = bootstrap();

export const db = reactive({
  booted: false,
  /** 0=课表 1=第二课堂 2=小鸮 3=校园通 4=我的 */
  activeTab: 0,
  /** 课表页内的分段控件：grid=课程表 list=待办 */
  activeSheet: 'grid' as 'grid' | 'list',
  session: boot.session as Session | null,
  currentWeek: boot.currentWeek,
  timetables: boot.timetables,
  activeTimetableId: boot.activeTimetableId,
  courses: boot.courses,
  todos: boot.todos,
  notes: boot.notes,
  records: boot.records,
  hours: boot.hours,
  lastError: ''
});

export function persist(): void {
  writeJson(KEY, {
    session: db.session,
    currentWeek: db.currentWeek,
    timetables: db.timetables,
    activeTimetableId: db.activeTimetableId,
    courses: db.courses,
    todos: db.todos,
    notes: db.notes,
    records: db.records,
    hours: db.hours
  } satisfies Persisted);
}

/* ============================ 派生数据 ============================ */

export const activeTimetable = computed<Timetable | undefined>(
  () => db.timetables.find((t) => t.id === db.activeTimetableId) || db.timetables[0]
);

export const totalWeeks = computed(() => activeTimetable.value?.totalWeeks || DEFAULT_WEEKS);

/** 当前课表的课程（切课表后自动变） */
export const activeCourses = computed(() =>
  db.courses.filter((c) => c.timetableId === (activeTimetable.value?.id || db.activeTimetableId))
);

export const todayIndex = computed(() => {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
});

export function coursesOn(day: number, week: number): Course[] {
  return activeCourses.value.filter((c) => c.day === day && c.weeks.includes(week));
}

export function colorOf(c: Course): string {
  return COURSE_COLORS[(c.colorIndex ?? 0) % COURSE_COLORS.length];
}

/** 课程名 → 稳定色号。原工程实测：按行号取模会让同一门课变色，必须按名字哈希 */
export function colorIndexByName(name: string): number {
  return courseColorIndex(name);
}

/**
 * 同一门课的颜色必须一致 —— 原工程踩过：只改一条会让「高等数学」
 * 在周二和周四长得不一样（真机反馈）。
 */
export function syncColorByName(name: string, idx: number, set: boolean): void {
  if (!name) return;
  const ttId = activeTimetable.value?.id;
  for (const c of db.courses) {
    if (c.timetableId === ttId && c.name === name) {
      if (c.colorIndex !== idx || !!c.colorSet !== set) {
        c.colorIndex = idx;
        c.colorSet = set;
      }
    }
  }
}

/* ============================ 课程 CRUD ============================ */

/** 新建课程的空白模板（对应原工程 TimetableView.blank()） */
export function blankCourse(overrides: Partial<Course> = {}): Course {
  const now = new Date().toISOString();
  return {
    id: uid(),
    timetableId: activeTimetable.value?.id || db.activeTimetableId,
    name: '',
    teacher: '',
    room: '',
    campus: '',
    day: 1,
    startPeriod: 1,
    endPeriod: 2,
    weeks: [],
    weeksRaw: '',
    credit: null,
    examMode: '',
    colorIndex: 0,
    colorSet: false,
    source: 'manual',
    remark: '',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

/**
 * 保存一门课（新增或覆盖）。
 * 校验口径与原工程一致：必须有课程名、必须选周次。
 */
export function saveCourse(c: Course): { ok: boolean; error: string } {
  const name = (c.name || '').trim();
  if (!name) return { ok: false, error: '请填写课程名称' };
  if (!c.weeks.length) return { ok: false, error: '请至少选择一个周次' };
  if (c.endPeriod < c.startPeriod) return { ok: false, error: '结束节次不能早于开始节次' };

  const now = new Date().toISOString();
  const idx = db.courses.findIndex((x) => x.id === c.id);
  const next: Course = {
    ...c,
    name,
    weeks: [...c.weeks].sort((a, b) => a - b),
    weeksRaw: weeksToText(c.weeks) + ' 周',
    colorIndex: c.colorSet ? c.colorIndex : courseColorIndex(name),
    updatedAt: now
  };
  if (idx >= 0) db.courses[idx] = next;
  else db.courses.push(next);
  syncColorByName(next.name, next.colorIndex, !!next.colorSet);
  persist();
  return { ok: true, error: '' };
}

/**
 * 删除一门课：与它「同名 + 同星期 + 同节次」的记录一起删。
 * 手工添加的一门课可能被拆成多段周次，逐条删会留半截。
 */
export function removeCourseGroup(target: Course): number {
  const before = db.courses.length;
  db.courses = db.courses.filter(
    (c) =>
      !(
        c.timetableId === target.timetableId &&
        c.name === target.name &&
        c.day === target.day &&
        c.startPeriod === target.startPeriod &&
        c.endPeriod === target.endPeriod
      )
  );
  persist();
  return before - db.courses.length;
}

/**
 * 冲突检测：同一张课表里，同一天、节次重叠、周次有交集的其他课程。
 * 原工程在解析器里做过同样的判断（jwglxtBuct.ts:207），这里补到手工添加路径上。
 * 同名课程同一时段不算冲突 —— 那是多教学班，不是撞课。
 */
export function conflictsOf(draft: Course): Course[] {
  return db.courses.filter(
    (c) =>
      c.timetableId === draft.timetableId &&
      c.id !== draft.id &&
      c.day === draft.day &&
      c.name !== draft.name &&
      periodOverlap(c, draft) &&
      weekOverlap(c.weeks, draft.weeks)
  );
}

/* ============================ 课表 CRUD ============================ */

export function newTimetable(name: string, totalWeeksArg = DEFAULT_WEEKS): Timetable {
  const t = makeTimetable(name || '未命名课表', totalWeeksArg);
  t.semesterStartMonday = mondayOf();
  db.timetables.push(t);
  db.activeTimetableId = t.id;
  db.currentWeek = 1;
  persist();
  return t;
}

export function switchTimetable(id: string): void {
  if (!db.timetables.some((t) => t.id === id)) return;
  db.activeTimetableId = id;
  const t = activeTimetable.value;
  if (t) db.currentWeek = Math.min(t.totalWeeks, weekOfToday(t.semesterStartMonday, t.totalWeeks));
  persist();
}

export function updateTimetable(id: string, patch: Partial<Timetable>): void {
  const t = db.timetables.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch, { updatedAt: new Date().toISOString() });
  if (t.totalWeeks < 1) t.totalWeeks = 1;
  db.currentWeek = Math.min(db.currentWeek, t.totalWeeks);
  persist();
}

/** 删除整张课表（连同它的课程）。最后一张不允许删 —— 否则界面没有可显示的东西 */
export function removeTimetable(id: string): { ok: boolean; error: string } {
  if (db.timetables.length <= 1) return { ok: false, error: '至少保留一张课表' };
  const n = db.courses.filter((c) => c.timetableId === id).length;
  db.timetables = db.timetables.filter((t) => t.id !== id);
  db.courses = db.courses.filter((c) => c.timetableId !== id);
  if (db.activeTimetableId === id) {
    db.activeTimetableId = db.timetables[0].id;
    db.currentWeek = 1;
  }
  persist();
  return { ok: true, error: n ? `已删除课表及 ${n} 门课程` : '已删除课表' };
}

export const weekLabel = computed(() => `第 ${db.currentWeek} 周`);

/* ============================ 建表 / 导入 / 示例 ============================ */

export interface CourseSeed {
  name: string;
  teacher: string;
  room: string;
  campus: string;
  day: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
  weeksRaw: string;
}

/** 新建一张课表并立刻切过去（导入、手动建表都走这里） */
export function createTimetable(
  name: string,
  opts: { semesterLabel?: string; totalWeeks?: number; semesterStartMonday?: string } = {}
): Timetable {
  const t = makeTimetable(name || '我的课表', opts.totalWeeks || DEFAULT_WEEKS);
  if (opts.semesterLabel) t.semesterLabel = opts.semesterLabel;
  if (opts.semesterStartMonday) t.semesterStartMonday = opts.semesterStartMonday;
  db.timetables.push(t);
  db.activeTimetableId = t.id;
  db.currentWeek = Math.min(t.totalWeeks, weekOfToday(t.semesterStartMonday, t.totalWeeks));
  persist();
  return t;
}

/**
 * 把导入结果写进某张课表。
 *  merge     —— 同一门课同一时段（同名 + 同星期 + 同起始节）先删后写，保留其它手动修正
 *  overwrite —— 整张表清空后写入
 * 返回最终写入条数。
 */
export function importCourses(timetableId: string, seeds: CourseSeed[], mode: 'merge' | 'overwrite'): number {
  const now = new Date().toISOString();
  const mapped: Course[] = seeds.map((s) => ({
    id: uid(),
    timetableId,
    name: s.name,
    teacher: s.teacher,
    room: s.room,
    campus: s.campus,
    day: s.day,
    startPeriod: s.startPeriod,
    endPeriod: s.endPeriod,
    weeks: s.weeks.slice().sort((a, b) => a - b),
    weeksRaw: s.weeksRaw || weeksToText(s.weeks) + ' 周',
    credit: null,
    examMode: '',
    colorIndex: courseColorIndex(s.name),
    colorSet: false,
    source: 'jwglxt',
    remark: '',
    createdAt: now,
    updatedAt: now
  }));

  const keep =
    mode === 'overwrite'
      ? db.courses.filter((c) => c.timetableId !== timetableId)
      : db.courses.filter(
          (c) =>
            !(
              c.timetableId === timetableId &&
              mapped.some((m) => m.name === c.name && m.day === c.day && m.startPeriod === c.startPeriod)
            )
        );

  db.courses = keep.concat(mapped);
  db.activeTimetableId = timetableId;
  persist();
  return mapped.length;
}

/** 「先用示例看看」：生成一张带 10 门课的演示课表，只给体验用 */
export function seedDemoTimetable(): Timetable {
  const t = makeTimetable('示例课表');
  t.semesterLabel = currentSemesterLabel();
  t.semesterStartMonday = mondayOf(new Date(Date.now() - 5 * 7 * 86400000));
  db.timetables.push(t);
  db.courses = db.courses.concat(demoCourses(t.id));
  db.activeTimetableId = t.id;
  db.currentWeek = Math.min(t.totalWeeks, weekOfToday(t.semesterStartMonday, t.totalWeeks));

  // 演示用的记事与二课自评（对齐原版截图里的 95/600 = 德10·智25·体30·美10·劳20）
  const d = new Date();
  const day = (offset: number) => dateStamp(new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset));
  const iso = new Date().toISOString();
  if (!db.notes.length) {
    db.notes = [
      { id: uid('n'), sheet: 'sheet2', title: '交大学物理实验报告', content: '周三 22:00 前交到雨课堂', date: day(-2), done: false, colorIndex: 0, createdAt: iso, updatedAt: iso },
      { id: uid('n'), sheet: 'sheet2', title: '高数第九章习题', content: '9.1 - 9.4 全部', date: day(1), done: false, colorIndex: 1, createdAt: iso, updatedAt: iso },
      { id: uid('n'), sheet: 'sheet2', title: '二课志愿服务报名', content: '社区志愿服务，周五截止', date: day(3), done: false, colorIndex: 4, createdAt: iso, updatedAt: iso },
      { id: uid('n'), sheet: 'sheet2', title: '还书', content: '图书馆三楼自助机', date: day(-6), done: true, colorIndex: 2, createdAt: iso, updatedAt: iso }
    ];
  }
  if (!db.records.length) {
    db.records = [
      { id: uid('r'), block: 'de', title: '主题班会', score: 10, at: day(-9), photos: 0, note: '' },
      { id: uid('r'), block: 'zhi', title: '学术讲座一次', score: 6, at: day(-12), photos: 1, note: '' },
      { id: uid('r'), block: 'zhi', title: '大创项目立项', score: 19, at: day(-5), photos: 2, note: '' },
      { id: uid('r'), block: 'ti', title: '奔跑在北化打卡', score: 30, at: day(-3), photos: 0, note: '' },
      { id: uid('r'), block: 'mei', title: '美育讲座', score: 10, at: day(-7), photos: 0, note: '' },
      { id: uid('r'), block: 'lao', title: '社区志愿服务', score: 20, at: day(-1), photos: 1, note: '全部有水印' }
    ];
  }
  if (!db.hours.length) {
    db.hours = [
      { id: uid('h'), kind: 'volunteer', title: '社区志愿服务', hours: 12, at: day(-1), note: '' },
      { id: uid('h'), kind: 'volunteer', title: '校园开放日引导', hours: 6, at: day(-16), note: '' },
      { id: uid('h'), kind: 'labor', title: '宿舍卫生评比（优）', hours: 10, at: day(-20), note: '' }
    ];
  }

  persist();
  return t;
}

/* ============================ 记事本 / 二课 / 时长 ============================ */

export type BlockKey = 'de' | 'zhi' | 'ti' | 'mei' | 'lao';

export interface NoteItem {
  id: string;
  /** 'sheet2' 固定（原工程有两张表，这里只保留记事本） */
  sheet: string;
  title: string;
  content: string;
  /** 'YYYY-MM-DD' */
  date: string;
  done: boolean;
  colorIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreRecord {
  id: string;
  block: BlockKey;
  title: string;
  score: number;
  /** 'YYYY-MM-DD' */
  at: string;
  photos: number;
  note: string;
}

export interface HourEntry {
  id: string;
  kind: 'volunteer' | 'labor';
  title: string;
  hours: number;
  at: string;
  note: string;
}

/** 五板块满分（来源：学生手册，与原工程 catalog/secondClass.ts 一致） */
export const SC_BLOCKS: Array<{ key: BlockKey; name: string; full: string; fullScore: number }> = [
  { key: 'de', name: '德', full: '道德与思想素质', fullScore: 180 },
  { key: 'zhi', name: '智', full: '学术与科技创新', fullScore: 120 },
  { key: 'ti', name: '体', full: '体育与身心健康', fullScore: 100 },
  { key: 'mei', name: '美', full: '美学与人文素养', fullScore: 100 },
  { key: 'lao', name: '劳', full: '劳动与社会实践', fullScore: 100 }
];
export const SC_TOTAL = SC_BLOCKS.reduce((a, b) => a + b.fullScore, 0);

/** 各板块已得自评分（超过上限按上限算） */
export function blockScore(key: BlockKey): number {
  const sum = db.records.filter((r) => r.block === key).reduce((a, r) => a + r.score, 0);
  const cap = SC_BLOCKS.find((b) => b.key === key)?.fullScore ?? 0;
  return Math.min(sum, cap);
}
export function totalScore(): number {
  return SC_BLOCKS.reduce((a, b) => a + blockScore(b.key), 0);
}
export function hourTotal(kind: 'volunteer' | 'labor'): number {
  return Math.round(db.hours.filter((h) => h.kind === kind).reduce((a, h) => a + h.hours, 0) * 10) / 10;
}

export function addNote(part: Partial<NoteItem> = {}): NoteItem {
  const now = new Date().toISOString();
  const n: NoteItem = {
    id: uid('n'),
    sheet: 'sheet2',
    title: '',
    content: '',
    date: dateStamp(),
    done: false,
    colorIndex: 2,
    createdAt: now,
    updatedAt: now,
    ...part
  };
  db.notes.unshift(n);
  persist();
  return n;
}

export function removeNote(id: string): void {
  db.notes = db.notes.filter((n) => n.id !== id);
  persist();
}

export function toggleNote(id: string): void {
  const n = db.notes.find((x) => x.id === id);
  if (!n) return;
  n.done = !n.done;
  n.updatedAt = new Date().toISOString();
  persist();
}

export function addRecord(part: Partial<ScoreRecord> = {}): ScoreRecord {
  const r: ScoreRecord = {
    id: uid('r'),
    block: 'de',
    title: '',
    score: 10,
    at: dateStamp(),
    photos: 0,
    note: '',
    ...part
  };
  db.records.unshift(r);
  persist();
  return r;
}

export function addHour(part: Partial<HourEntry> = {}): HourEntry {
  const h: HourEntry = {
    id: uid('h'),
    kind: 'volunteer',
    title: '',
    hours: 0,
    at: dateStamp(),
    note: '',
    ...part
  };
  db.hours.unshift(h);
  persist();
  return h;
}
