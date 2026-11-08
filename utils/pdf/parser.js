/**
 * 把带坐标的文字片段还原成课程行。
 *
 * 课表是「星期为列、节次为行」的二维表：星期信息不在正文里，而在文字的
 * x 坐标上。所以先从表头文字定位七列的锚点，再按坐标把每个课程块归到
 * 对应的星期，最后从块文本里取出课程名、节次、周次、教室和教师。
 */

const { parseWeeks } = require('../weeks.js');
const { extractTextItems } = require('./extract.js');
const { PdfImportError } = require('./errors.js');
const { maxWeekOf } = require('./courses.js');

const DAY_CHARS = '一二三四五六日天';
const COURSE_MARK = '\u2605\u25cb\u25cf\u25c7';
/**
 * 周次解析上限。必须与正方侧 parseWeeks 的 30 周、设置页的 30 周选项一致：
 * 原来写 20 会让"第 21-22 周还有课"的学期在 PDF 导入时被静默截断，
 * 而且总周数也撑不上去（maxWeek 被压到 20），课表后半学期凭空少课。
 */
const MAX_WEEKS = 30;

function headerDay(text) {
  const value = String(text || '').trim();
  const match = /^星期([一二三四五六日天])$/.exec(value) || /^周([一二三四五六日天])$/.exec(value);
  if (!match) return 0;
  const index = DAY_CHARS.indexOf(match[1]);
  return index >= 6 ? 7 : index + 1;
}

function columnAnchors(items) {
  const anchors = [];
  for (let day = 1; day <= 7; day += 1) {
    const xs = items.filter((item) => headerDay(item.text) === day).map((item) => item.x).sort((a, b) => a - b);
    if (xs.length) anchors[day - 1] = xs[0];
  }
  const found = anchors.filter((value) => value !== undefined);
  if (found.length < 2 || !anchors[0] || !anchors[1]) {
    throw new PdfImportError('UNSUPPORTED_FORMAT', '没有找到「星期一 ~ 星期日」表头，请用课表页的「输出 PDF」重新导出。');
  }
  const step = anchors[1] - anchors[0];
  for (let index = 0; index < 7; index += 1) {
    if (anchors[index] === undefined) anchors[index] = anchors[0] + index * step;
  }
  const edges = [];
  for (let index = 0; index < 6; index += 1) edges.push((anchors[index] + anchors[index + 1]) / 2);
  return { edges, left: anchors[0] - 50 };
}

function clean(text) {
  return String(text || '')
    .replace(/\u0002/g, '-')
    .replace(/\s+/g, '');
}

/** 课程名可能被 PDF 排版拆成连续两行，向前收集时要停在上一门课的详情行。 */
function isTitleLine(text) {
  const value = String(text || '');
  if (!value || headerDay(value) !== 0) return false;
  if (/\(\d+-\d+节\)/.test(value)) return false;
  if (value.indexOf('/') >= 0 || /^[:：]/.test(value.trim())) return false;
  return !/学时|学分|考核方式|教学班|选课备注|校区|场地|教师|备注|组成|学号|打印时间|^\s*$/.test(value);
}

function parseBlock(text, day) {
  const source = clean(text);
  const period = /\((\d+)-(\d+)节\)/.exec(source);
  if (!period) return null;
  const name = source.slice(0, period.index).split('/').pop()
    .replace(new RegExp('[' + COURSE_MARK + '].*$'), '')
    .replace(/^\d+/, '')
    .trim();
  const detail = source.slice(period.index + period[0].length);
  const weekMatch = /^(.*?)\/校区/.exec(detail);
  const weekText = (weekMatch ? weekMatch[1] : '').replace(/[()（）]/g, '');
  const room = /\/场地[:：]([^/]*?)(?=\/教师|$)/.exec(detail);
  const teacher = /\/教师[:：]([^/]*?)(?=\/教学班|$)/.exec(detail);
  const campus = /\/校区[:：]([^/]*?)(?=\/|$)/.exec(detail);
  return {
    name: name || '',
    day,
    startPeriod: Number(period[1]),
    endPeriod: Number(period[2]),
    weeks: parseWeeks(weekText, MAX_WEEKS),
    campus: campus ? campus[1].trim() : '',
    room: room ? room[1].trim() : '',
    teacher: teacher ? teacher[1].trim() : ''
  };
}

function isComplete(row) {
  return !!row.name && row.day >= 1 && row.day <= 7
    && row.startPeriod >= 1 && row.endPeriod >= row.startPeriod && row.weeks.length > 0;
}

/**
 * 列表式课表（学校另一套导出模板）：
 *
 *   星期一 | 1-2  | 复变函数与积分变换（A）★ | 周数: 1-9周,11-15周/校区: 北区/地点: ...
 *
 * 星期、节次、课名、详情各占一列，节次不在正文里，而是单独一段 "1-2"。
 * 一个节次下面可以并排多门课（同一时段不同周次/不同教室），所以节次要
 * 记住、课名每出现一次就新起一行。详情会被排版拆成两三行，按出现顺序拼接。
 */
const LIST_DETAIL = /(周数|校区|地点|教师|教学班|考核方式|选课备注|学时|学分)\s*[:：]/;

function parseListItems(items) {
  const rows = [];
  let day = 0;
  let period = null;
  let entry = null;
  let markers = 0;

  const flush = () => {
    if (!entry) return;
    rows.push(toListRow(entry));
    entry = null;
  };

  items.forEach((item) => {
    const text = String(item.text || '').trim();
    if (!text) return;
    // 页脚：其他课程、图例、打印时间
    if (/^其他课程/.test(text) || /^打印时间/.test(text)) return;
    if (new RegExp('^[' + COURSE_MARK + ']\\s*[:：]').test(text)) return;

    const dayNo = headerDay(text);
    if (dayNo) {
      flush();
      day = dayNo;
      period = null;
      return;
    }

    const span = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(text);
    if (span) {
      flush();
      period = { start: Number(span[1]), end: Number(span[2]) };
      return;
    }

    if (!day || !period) return;

    // 详情行：带「周数:」「地点:」这类字段，或是被拆断的续行（以 / 或 : 开头）
    if (LIST_DETAIL.test(text) || /^[/:：]/.test(text)) {
      if (entry) entry.detail += text;
      return;
    }

    flush();
    entry = {
      name: text.replace(new RegExp('[' + COURSE_MARK + '].*$'), '').trim(),
      day,
      startPeriod: period.start,
      endPeriod: period.end,
      detail: ''
    };
    markers += 1;
  });
  flush();

  return { rows, markers };
}

function toListRow(entry) {
  const pick = (label) => {
    const match = new RegExp(label + '\\s*[:：]\\s*([^/]*)').exec(entry.detail);
    return match ? match[1].trim() : '';
  };
  return {
    name: entry.name,
    day: entry.day,
    startPeriod: entry.startPeriod,
    endPeriod: entry.endPeriod,
    weeks: parseWeeks(pick('周数'), MAX_WEEKS),
    campus: pick('校区'),
    room: pick('地点'),
    teacher: pick('教师')
  };
}

/** 表格式课表：星期在表头，课程块里带 "(1-2节)"。 */
function parseGridItems(items) {
  const { edges, left } = columnAnchors(items);
  const groups = {};
  let markers = 0;

  items.forEach((item) => {
    if (item.x < left) return;
    let day = 1;
    edges.forEach((edge) => { if (item.x > edge) day += 1; });
    if (item.x > edges[5] + (edges[1] - edges[0])) return;
    // 按星期聚合，跨页连续：课表会在页边把一门课切成两半
    // （第 1 页末尾"化工过程安全与具身智"，第 2 页开头"能前沿研讨 ★"），
    // 一旦按页分组，后半截就会被当成一门独立的课。
    (groups[day] = groups[day] || []).push(item);
  });

  const rows = [];
  Object.keys(groups).forEach((key) => {
    const list = groups[key].sort((a, b) => (a.group - b.group) || (b.y - a.y) || (a.x - b.x));
    const day = Number(key);
    list.forEach((item, index) => {
      if (!/\(\d+-\d+节\)/.test(item.text)) return;
      markers += 1;
      const titleParts = [];
      for (let back = index - 1; back >= Math.max(0, index - 5); back -= 1) {
        if (!isTitleLine(list[back].text)) break;
        titleParts.unshift(list[back].text);
      }
      const title = titleParts.join('');
      let detail = item.text;
      for (let forward = index + 1; forward < Math.min(list.length, index + 6); forward += 1) {
        if (new RegExp('[' + COURSE_MARK + ']').test(list[forward].text)) break;
        detail += list[forward].text;
        if (/\/教学班/.test(detail)) break;
      }
      const row = parseBlock(title + detail, day);
      if (row) rows.push(row);
    });
  });

  return { rows, markers };
}

/**
 * @param {ArrayBuffer|Uint8Array} input PDF 文件二进制
 * @returns {{rows:Array,term:string,maxWeek:number,distinct:number,warnings:Array<string>}}
 */
function parsePdfTimetable(input) {
  const items = extractTextItems(input);
  // 两种模板：表格式课程块里写 "(1-2节)"；列表式把节次单独放一列
  const grid = items.some((item) => /\(\d+-\d+节\)/.test(item.text));
  const { rows, markers } = grid ? parseGridItems(items) : parseListItems(items);

  if (!markers) {
    throw new PdfImportError('NO_COURSES', grid
      ? '没有识别到「(X-Y节)」课程时间信息，请确认选择的是课表 PDF。'
      : '没有识别到「星期 + 节次」的课程行，请确认选的是「学生课表查询」导出的 PDF。');
  }
  if (!rows.length) {
    throw new PdfImportError('PARSE_INCOMPLETE', '找到了课程时间，但没能还原出任何一门课，模板可能已变化。');
  }
  const incomplete = rows.filter((row) => !isComplete(row)).length;
  if (incomplete) {
    throw new PdfImportError('PARSE_INCOMPLETE', `有 ${incomplete} 个课程块信息不完整，为避免导入错误数据已停止，请重新导出课表 PDF。`);
  }

  const warnings = [];
  if (rows.length !== markers) warnings.push(`识别到 ${markers} 个时间段，成功还原 ${rows.length} 个`);
  const missingDetail = rows.filter((row) => !row.room || !row.teacher).length;
  if (missingDetail) warnings.push(`${missingDetail} 个时间段缺少教室或教师信息`);

  const termItem = items.find((item) => /\d{4}\s*-\s*\d{4}\s*学年第\s*\d+\s*学期/.test(item.text));
  return {
    rows,
    term: termItem ? termItem.text.trim() : '',
    maxWeek: maxWeekOf(rows),
    distinct: new Set(rows.map((row) => row.name)).size,
    warnings
  };
}

module.exports = { parsePdfTimetable, parseBlock, headerDay };
