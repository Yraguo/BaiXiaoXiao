const test = require('node:test');
const assert = require('node:assert/strict');

const { buildZip, crc32, utf8 } = require('../utils/zip');
const { buildCsv, buildJson, buildReadme, photoNameFor } = require('../utils/materials');
const { summarize } = require('../utils/secondclass');

const SAMPLE = summarize([
  { plate: 'de', title: '主题团日', date: '2026-10-04', score: 10 },
  { plate: 'lao', title: '社区志愿服务', date: '2026-10-15', score: 20, level: 'extra', hours: 6, address: '北区' }
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

  assert.equal(photoNameFor({ title: 'a/b:c', photos: ['x.jpeg'] }, 0, 0, 1), '照片/01-a_b_c.jpeg');
});

test('CSV 里的逗号和引号要转义', () => {
  const summary = summarize([{ plate: 'de', title: '讲座, 主题"安全"', score: 5 }]);
  const csv = buildCsv(summary, [[]]);
  assert.match(csv, /"讲座, 主题""安全"""/);
});
