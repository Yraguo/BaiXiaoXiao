/**
 * 云函数：课表分享
 *
 * 三个动作：
 *   save    把一份课表快照存到云存储，返回 6 位分享码
 *   get     按分享码取回快照（扫码打开小程序时用）
 *   qrcode  用分享码生成小程序码，存到云存储并返回 fileID
 *
 * 为什么存云存储不存数据库：云开发的数据库集合要先在控制台建，
 * 而存储桶是开箱即用的；一份快照就是一个 json 文件，读写都简单。
 *
 * 隐私：只存课名、星期、节次、周次、教室、教师、校区，
 * 不含学号、姓名、教务账号密码。
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_COURSES = 80;
const ID_PATTERN = /^[a-z0-9]{6,16}$/;

function makeId() {
  const random = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return `${random}${time}`;
}

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, '').slice(0, max);
}

function cleanCourse(course) {
  const weeks = Array.isArray(course.weeks)
    ? course.weeks.map(Number).filter((value) => Number.isFinite(value) && value > 0 && value <= 30).slice(0, 30)
    : [];
  return {
    name: cleanText(course.name, 40),
    day: Math.min(7, Math.max(1, Number(course.day) || 1)),
    startPeriod: Math.min(20, Math.max(1, Number(course.startPeriod) || 1)),
    endPeriod: Math.min(20, Math.max(1, Number(course.endPeriod) || 1)),
    weeks,
    room: cleanText(course.room, 30),
    teacher: cleanText(course.teacher, 24),
    campus: cleanText(course.campus, 16)
  };
}

async function save(event) {
  const courses = (Array.isArray(event.courses) ? event.courses : [])
    .filter((course) => course && course.name)
    .slice(0, MAX_COURSES)
    .map(cleanCourse);
  if (!courses.length) {
    return { ok: false, error: '没有可分享的课程' };
  }

  const id = makeId();
  const payload = {
    version: 1,
    createdAt: Date.now(),
    term: cleanText(event.term, 20),
    settings: {
      timetableName: cleanText(event.settings && event.settings.timetableName, 20),
      totalWeeks: Math.min(30, Math.max(1, Number(event.settings && event.settings.totalWeeks) || 18)),
      semesterStartMonday: cleanText(event.settings && event.settings.semesterStartMonday, 12)
    },
    courses
  };

  await cloud.uploadFile({
    cloudPath: `shares/${id}.json`,
    fileContent: Buffer.from(JSON.stringify(payload), 'utf8')
  });

  return { ok: true, id, count: courses.length };
}

async function get(event) {
  const id = cleanText(event.id, 16);
  if (!ID_PATTERN.test(id)) return { ok: false, error: '分享码不对' };

  try {
    const file = await cloud.downloadFile({ fileID: `shares/${id}.json` });
    const data = JSON.parse(file.fileContent.toString('utf8'));
    return { ok: true, share: data };
  } catch (error) {
    return { ok: false, error: '分享已失效' };
  }
}

async function qrcode(event) {
  const id = cleanText(event.id, 16);
  if (!ID_PATTERN.test(id)) return { ok: false, error: '分享码不对' };

  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: id,
      page: 'pages/timetable/index',
      checkPath: false,
      envVersion: event.envVersion === 'trial' ? 'trial' : 'release',
      width: 430,
      autoColor: false,
      lineColor: { r: 24, g: 32, b: 45 }
    });

    if (!result || !result.buffer) return { ok: false, error: '生成小程序码失败' };

    const upload = await cloud.uploadFile({
      cloudPath: `qrcodes/${id}.png`,
      fileContent: result.buffer
    });

    return { ok: true, fileID: upload.fileID };
  } catch (error) {
    // 常见原因：小程序还没发布过、没有「获取小程序码」的权限
    return { ok: false, error: String((error && error.errMsg) || error) };
  }
}

exports.main = async (event) => {
  const action = (event && event.action) || 'get';
  try {
    if (action === 'save') return await save(event);
    if (action === 'get') return await get(event);
    if (action === 'qrcode') return await qrcode(event);
    return { ok: false, error: '未知操作' };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) };
  }
};
