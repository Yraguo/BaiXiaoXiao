/**
 * 二课材料清单图：纯排版计算 + canvas 绘制。
 *
 * 为什么是「一张图」而不是 zip：小程序没有写入手机文件系统的权限，
 * 唯一能落到用户手里、并且在微信里能直接转发的东西是**相册里的图片**。
 * 所以这里把总分、五板块、明细排成一张长图，用户存进相册后可以发给老师
 * 或者上传到学校系统；照片本身另有「逐张存相册」的入口。
 */

const WIDTH = 750;
const PAD = 48;

const COLORS = {
  ink: '#18202d',
  muted: '#8a93a3',
  faint: '#b3bac5',
  line: '#eceef3',
  brand: '#007aff',
  track: '#eef1f6'
};

const PLATE_INK = {
  de: '#2f6bd8',
  zhi: '#7b4fd0',
  ti: '#1c8a5c',
  mei: '#c2610f',
  lao: '#12808a'
};

function dateText(now) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * 只做几何与文案，不碰 canvas，方便单测。
 * @returns {{width:number,height:number,header:object,plates:Array,items:Array,footerY:number}}
 */
function layout(summary, now) {
  const at = now || new Date();
  const plates = summary.plates.map((plate, index) => ({
    short: plate.short,
    scoreText: `${plate.score}`,
    full: plate.full,
    percent: Math.max(0, Math.min(1, plate.score / plate.full)),
    color: PLATE_INK[plate.key] || COLORS.brand,
    y: 320 + index * 56
  }));

  const itemsStart = 320 + plates.length * 56 + 120;
  const items = summary.list.map((record, index) => {
    const plate = summary.plates.find((item) => item.key === record.plate);
    const metaParts = [
      record.date || '未填日期',
      record.level === 'extra' ? '拓展' : '基础',
      record.hours ? `${record.hours} 小时` : '',
      plate ? plate.name : '',
      record.photos.length ? `${record.photos.length} 张照片` : ''
    ].filter(Boolean);
    return {
      index: index + 1,
      y: itemsStart + index * 116,
      title: record.title,
      meta: metaParts.join(' · '),
      scoreText: `+${record.score}`,
      color: PLATE_INK[record.plate] || COLORS.brand,
      badge: plate ? plate.short : '—'
    };
  });

  const footerY = (items.length ? itemsStart + items.length * 116 : itemsStart) + 40;
  const height = footerY + 56;

  return {
    width: WIDTH,
    height,
    at: dateText(at),
    count: summary.count,
    totalText: summary.totalText,
    full: summary.full,
    plates,
    items,
    itemsStart,
    footerY
  };
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, height / 2, width / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** 超出宽度就截断加省略号，避免长课名把版面顶爆 */
function fitText(ctx, text, maxWidth) {
  const source = String(text || '');
  if (ctx.measureText(source).width <= maxWidth) return source;
  let cut = source;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function draw(ctx, model) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, model.width, model.height);

  // 顶部品牌条
  const grad = ctx.createLinearGradient(0, 0, model.width, 0);
  grad.addColorStop(0, '#4d9dff');
  grad.addColorStop(1, '#0062d6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, model.width, 6);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('第二课堂自评材料', PAD, 96);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '22px sans-serif';
  ctx.fillText(`${model.at} 生成 · 共 ${model.count} 条记录`, PAD, 136);

  // 总分
  ctx.fillStyle = COLORS.brand;
  ctx.font = 'bold 76px sans-serif';
  ctx.fillText(model.totalText, PAD, 240);
  const totalWidth = ctx.measureText(model.totalText).width;
  ctx.fillStyle = COLORS.faint;
  ctx.font = '26px sans-serif';
  ctx.fillText(`/ ${model.full}`, PAD + totalWidth + 12, 240);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '22px sans-serif';
  ctx.fillText('合计自评', PAD, 278);

  // 五板块
  model.plates.forEach((plate) => {
    ctx.fillStyle = plate.color;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(plate.short, PAD, plate.y);

    const trackX = PAD + 48;
    const trackWidth = 460;
    ctx.fillStyle = COLORS.track;
    roundRect(ctx, trackX, plate.y - 14, trackWidth, 14, 7);
    ctx.fill();

    if (plate.percent > 0) {
      ctx.fillStyle = plate.color;
      roundRect(ctx, trackX, plate.y - 14, Math.max(14, trackWidth * plate.percent), 14, 7);
      ctx.fill();
    }

    ctx.fillStyle = COLORS.muted;
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${plate.scoreText} / ${plate.full}`, model.width - PAD, plate.y);
    ctx.textAlign = 'left';
  });

  // 分隔线 + 明细标题
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, model.itemsStart - 96);
  ctx.lineTo(model.width - PAD, model.itemsStart - 96);
  ctx.stroke();

  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('明细', PAD, model.itemsStart - 60);

  // 每条记录
  model.items.forEach((item) => {
    const baseY = item.y;

    // 板块角标
    ctx.fillStyle = item.color;
    roundRect(ctx, PAD, baseY - 22, 40, 34, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(item.badge, PAD + 13, baseY + 2);

    // 标题
    ctx.fillStyle = COLORS.ink;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(fitText(ctx, item.title, model.width - PAD * 2 - 120), PAD + 56, baseY);

    // 副标题
    ctx.fillStyle = COLORS.muted;
    ctx.font = '21px sans-serif';
    ctx.fillText(fitText(ctx, item.meta, model.width - PAD * 2 - 56), PAD + 56, baseY + 32);

    // 右侧分数
    ctx.fillStyle = item.color;
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(item.scoreText, model.width - PAD, baseY + 4);
    ctx.textAlign = 'left';

    ctx.strokeStyle = COLORS.line;
    ctx.beginPath();
    ctx.moveTo(PAD, baseY + 62);
    ctx.lineTo(model.width - PAD, baseY + 62);
    ctx.stroke();
  });

  if (!model.items.length) {
    ctx.fillStyle = COLORS.faint;
    ctx.font = '24px sans-serif';
    ctx.fillText('还没有填报记录', PAD, model.itemsStart + 24);
  }

  ctx.fillStyle = COLORS.faint;
  ctx.font = '20px sans-serif';
  ctx.fillText('分数为自行填报与自评，最终认定以学校审核为准。', PAD, model.footerY + 16);
}

/** CSV 单元格：含逗号/引号/换行就加引号并转义 */
function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * 图片真实类型 → 扩展名。
 * 微信的 getImageInfo 返回的是 'jpeg' / 'png' / 'gif' / 'webp'…，
 * 而路径上的后缀经常是临时名甚至没有后缀，所以以探测结果为准。
 */
const IMAGE_EXT = {
  jpeg: 'jpg',
  jpg: 'jpg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
  heic: 'heic',
  heif: 'heif',
  tiff: 'tiff',
  svg: 'svg'
};

/** 从路径猜扩展名，猜不到就返回空串 */
function extFromPath(path) {
  const match = String(path || '').match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  const ext = match ? match[1].toLowerCase() : '';
  return IMAGE_EXT[ext] || (ext && ext.length <= 5 ? ext : '');
}

/** 统一成规范扩展名；未知类型原样返回小写 */
function extFromType(type) {
  const key = String(type || '').toLowerCase().replace(/^image\//, '');
  return IMAGE_EXT[key] || (key.length <= 5 ? key : '');
}

/** 照片在 zip 里的相对路径，序号和 CSV 的「序号」列对得上 */
function photoNameFor(record, index, photoIndex, total, ext) {
  const seq = String(index + 1).padStart(2, '0');
  const title = String(record.title || '活动')
    .replace(/[\\/:*?"<>|,，\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || '活动';
  const suffix = total > 1 ? `-${photoIndex + 1}` : '';
  const finalExt = extFromType(ext) || extFromPath((record.photos || [])[photoIndex]) || 'jpg';
  return `照片/${seq}-${title}${suffix}.${finalExt}`;
}

/**
 * 记录表：Excel / WPS 直接打开，一行一条，最后一列是照片文件名。
 * @param {Array<Array<string>>} photoNamesByIndex 每条记录对应的照片文件名
 */
function buildCsv(summary, photoNamesByIndex) {
  const header = ['序号', '板块', '评定类型', '活动名称', '活动日期', '时长(小时)', '自评分', '地点', '备注', '照片文件'];
  const rows = summary.list.map((record, index) => {
    const plate = summary.plates.find((item) => item.key === record.plate);
    return [
      index + 1,
      plate ? `${plate.short} ${plate.name}` : record.plate,
      record.level === 'extra' ? '拓展' : '基础',
      record.title,
      record.date,
      record.hours || '',
      record.score,
      record.address,
      record.note,
      (photoNamesByIndex[index] || []).join('、')
    ].map(csvCell).join(',');
  });
  // 带 BOM，否则 Windows 的 Excel 会把中文读成乱码
  return `\ufeff${header.join(',')}\n${rows.join('\n')}\n`;
}

/** 机器可读的一份，将来做「导入恢复」直接读它 */
function buildJson(summary, photoNamesByIndex, when) {
  const at = when || new Date();
  return JSON.stringify({
    app: '百小鸮',
    schema: 'second-class/v1',
    exportedAt: dateText(at),
    total: summary.total,
    full: summary.full,
    plates: summary.plates.map((plate) => ({
      key: plate.key,
      name: plate.name,
      score: plate.score,
      full: plate.full
    })),
    records: summary.list.map((record, index) => Object.assign({}, record, {
      photos: photoNamesByIndex[index] || []
    }))
  }, null, 2);
}

function buildReadme(summary, when) {
  const at = dateText(when || new Date());
  return [
    '百小鸮 · 第二课堂材料包',
    `导出时间：${at}`,
    `记录条数：${summary.count} 条`,
    `合计自评：${summary.totalText} / ${summary.full}`,
    '',
    '目录说明：',
    '  二课记录.csv   一行一条，最后一列写了对应对的照片文件名',
    '  二课记录.json  同样的内容，机器可读，便于以后导入恢复',
    '  照片/          文件名前缀是记录序号，和 CSV 的「序号」一一对应',
    '',
    '照片是原图，水印（时间 + 地点）已经打进图里。',
    '分数为自行填报与自评，最终认定以学校审核为准。'
  ].join('\n');
}

module.exports = {
  COLORS,
  IMAGE_EXT,
  PLATE_INK,
  extFromPath,
  extFromType,
  buildCsv,
  buildJson,
  buildReadme,
  layout,
  draw,
  fitText,
  photoNameFor,
  roundRect
};
