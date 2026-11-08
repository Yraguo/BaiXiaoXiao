const test = require('node:test');
const assert = require('node:assert/strict');

const { buildZip, crc32, utf8 } = require('../utils/zip');
const { buildCsv, buildJson, buildReadme, photoNameFor } = require('../utils/materials');
const { summarize } = require('../utils/secondclass');

const SAMPLE = summarize([
  { plate: 'de', title: '主题团日', date: '2026-10-04', score: 10 },
  { plate: 'lao', title: '社区志愿服务', date: '2026-10-15', score: 20, level: 'extra', hours: 6, address: '东校区' }
]);

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

test('CRC32 与标准值一致', () => {
  assert.equal(crc32(utf8('hello')), 0x3610a686);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('UTF-8 编码：中文与 emoji 都按字节展开', () => {
  assert.deepEqual(Array.from(utf8('A')), [0x41]);
  assert.deepEqual(Array.from(utf8('中')), [0xe4, 0xb8, 0xad]);
  assert.equal(utf8('📦').length, 4, 'emoji 是四字节');
});

test('zip 结构完整：本地头、中央目录、EOCD 对得上', () => {
  const files = [
    { name: '二课记录.csv', data: 'a,b\n1,2\n' },
    { name: '照片/01-主题团日.jpg', data: new Uint8Array([0xff, 0xd8, 0xff]) }
  ];
  const zip = buildZip(files, new Date(2026, 10, 8, 16, 30));

  assert.equal(u32(zip, 0), 0x04034b50, '第一个本地文件头');
  assert.equal(u16(zip, 6) & 0x0800, 0x0800, '要带 UTF-8 文件名标记');
  assert.equal(u16(zip, 8), 0, 'store 模式');

  const eocd = zip.length - 22;
  assert.equal(u32(zip, eocd), 0x06054b50, 'EOCD 签名');
  assert.equal(u16(zip, eocd + 8), files.length, '条目数');
  assert.equal(u16(zip, eocd + 10), files.length, '中央目录条目数');
  assert.equal(u32(zip, eocd + 16) + u32(zip, eocd + 12) + 22, zip.length, '偏移 + 目录长度 + EOCD = 总长');
  assert.equal(u32(zip, u32(zip, eocd + 16)), 0x02014b50, '中央目录起始签名');
});

test('打包内容：CSV 带 BOM、JSON 可解析、照片名带序号', () => {
  const records = SAMPLE.list;
  const names = [[], ['照片/02-社区志愿服务.jpg']];
  const csv = buildCsv(SAMPLE, names);
  assert.ok(csv.startsWith('\ufeff'), 'Excel 需要 BOM 才不乱码');
  assert.match(csv, /序号,板块,评定类型/);
  assert.match(csv, /照片\/02-社区志愿服务\.jpg/, '最后一列要写照片文件名');

  const json = JSON.parse(buildJson(SAMPLE, names));
  assert.equal(json.schema, 'second-class/v1');
  assert.equal(json.records.length, 2);
  assert.equal(json.records[1].photos[0], '照片/02-社区志愿服务.jpg');

  const readme = buildReadme(SAMPLE);
  assert.match(readme, /二课记录\.csv/);
  assert.match(readme, /照片\//);

  // jpeg 统一写成 jpg；PNG / HEIC 会按 getImageInfo 的结果保留
  assert.equal(photoNameFor({ title: 'a/b:c', photos: ['x.jpeg'] }, 0, 0, 1), '照片/01-a_b_c.jpg');
  assert.equal(photoNameFor({ title: '图', photos: ['/tmp/a.PNG'] }, 0, 0, 1), '照片/01-图.png');
  assert.equal(photoNameFor({ title: '实拍', photos: ['/tmp/b'] }, 0, 0, 1, 'heic'), '照片/01-实拍.heic');
});

test('CSV 里的逗号和引号要转义', () => {
  const summary = summarize([{ plate: 'de', title: '讲座, 主题"安全"', score: 5 }]);
  const csv = buildCsv(summary, [[]]);
  assert.match(csv, /"讲座, 主题""安全"""/);
});

test('备份包结构：课表 + 二课 + 时长 + 说明，zip 能原样读回', () => {
  const { buildFullBackup } = require('../utils/backup');
  const summary = summarize([
    { plate: 'de', title: '主题团日', date: '2026-10-04', score: 10 }
  ]);
  const courses = [
    { name: '高等数学（A）', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3], campus: '东校区', room: '教A-101', teacher: '李强' }
  ];
  const entries = buildFullBackup({
    courses,
    settings: { timetableName: '2026-2027-1', semesterStartMonday: '2026-09-07', totalWeeks: 18 },
    summary,
    hours: [{ kind: 'volunteer', term: '大一上', title: '图书馆志愿', hours: 4 }],
    photoEntries: [{ name: '照片/01-主题团日.png', data: new Uint8Array([1, 2, 3]) }],
    photoNamesByIndex: [['照片/01-主题团日.png']]
  });

  const names = entries.map((entry) => entry.name);
  assert.ok(names.some((name) => name.endsWith('课表.csv')));
  assert.ok(names.some((name) => name.endsWith('课表.json')));
  assert.ok(names.some((name) => name.endsWith('二课记录.json')));
  assert.ok(names.some((name) => name.endsWith('二课时长.json')));
  assert.ok(names.some((name) => name.endsWith('说明.txt')));
  assert.ok(names.some((name) => name.endsWith('照片/01-主题团日.png')));

  const zip = buildZip(entries, new Date(2026, 10, 8, 17, 0));
  const { readZip, readText } = require('../utils/zip');
  const back = readZip(zip);
  assert.equal(back.length, entries.length, '条目数一致');

  const courseData = JSON.parse(readText(back, '课表.json'));
  assert.equal(courseData.schema, 'timetable/v1');
  assert.equal(courseData.courses.length, 1);
  assert.equal(courseData.courses[0].name, '高等数学（A）');
  assert.equal(courseData.settings.totalWeeks, 18);

  const hoursData = JSON.parse(readText(back, '二课时长.json'));
  assert.equal(hoursData.records[0].hours, 4);

  const photo = back.find((entry) => entry.name.endsWith('.png'));
  assert.deepEqual(Array.from(photo.data), [1, 2, 3], '照片字节要原样保留');
});

test('课表 CSV 的周次写成「1-3周」，不是原始数组', () => {
  const { buildCourseCsv } = require('../utils/backup');
  const csv = buildCourseCsv([
    { name: '工程训练', day: 6, startPeriod: 1, endPeriod: 4, weeks: [1, 2, 3, 4, 6], room: '工程训练中心' }
  ]);
  assert.match(csv, /工程训练,周六,1,4,1-4、6周/, '周次要压缩成 1-4、6周 这种可读写法');
});

test('课表分享图：课程多的那天更高，空白日也有位置', () => {
  const { layoutWeek } = require('../utils/shareCard');
  const model = layoutWeek([
    { label: '周一', date: '11/9', blocks: [{ name: 'A' }, { name: 'B' }] },
    { label: '周二', date: '11/10', blocks: [] }
  ], { week: 11, range: '11/9–11/15', term: '2026-2027-1' });
  assert.ok(model.days[0].height > model.days[1].height, '有课的那天要撑开');
  assert.equal(model.days[1].blocks.length, 0);
  assert.ok(model.height > 300);
});
