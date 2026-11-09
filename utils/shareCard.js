/**
 * 课表分享图：把「本周」画成一张竖版课表图，方便直接发给同学。
 *
 * 为什么不做「点开小程序看你的课表」：那需要把课表存到云端再给一个 id，
 * 现在项目是零后端；小程序又没有「分享数据」这种能力。图片是唯一
 * 不需要服务器、对方点开就能看的形态。
 *
 * 【为什么改成网格】上一版是按天竖排的清单：周一一列课名、周二一列课名，
 * 看着像待办列表而不是课表，七天的课多起来还会拉得很长。现在画成和页面
 * 一致的「节次 × 星期」网格，扫一眼就知道哪节课在哪个空档。
 */

const WIDTH = 750;
const PAD = 32;
const PERIOD_W = 74; // 左侧节次列
const TITLE_TOP = 92;
const SUB_TOP = 132;
const HEAD_TOP = 168;
const HEAD_H = 64;
const ROW_H = 78;
const CELL_GAP = 3;

const COLORS = {
  ink: '#18202d',
  muted: '#8a93a3',
  faint: '#c2c8d2',
  line: '#eceef3',
  head: '#f6f8fc',
  brand: '#007aff'
};

const DAY_SHORT = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** #1f6fd0 -> rgba(31,111,208,.14)，给课程块做浅底 */
function tint(hex, alpha) {
  const value = String(hex || '').replace('#', '');
  if (value.length !== 6) return `rgba(0, 122, 255, ${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fitText(ctx, text, maxWidth) {
  const source = String(text || '');
  if (ctx.measureText(source).width <= maxWidth) return source;
  let cut = source;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/** 按宽度折行，超出 maxLines 时最后一行加省略号 */
function wrapText(ctx, text, maxWidth, maxLines) {
  const source = String(text || '');
  const lines = [];
  let line = '';
  for (let i = 0; i < source.length; i += 1) {
    const next = line + source[i];
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = source[i];
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (!lines.length) return [];

  // 还有没排完的内容，把最后一行换成省略号结尾
  const consumed = lines.join('').length;
  if (consumed < source.length) {
    let last = lines[maxLines - 1] || '';
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return lines.slice(0, maxLines);
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
  ctx.arcTo(x, y + r, x + r, y, r);
  ctx.closePath();
}

/**
 * @param {Array} dayColumns 页面里的 dayColumns（每项有 label/date/dayNum/blocks）
 * @param {Array} periodRows 节次行（每项有 period/start/end）
 * @param {object} meta { week, range, term, name }
 */
function layoutWeek(dayColumns, periodRows, meta, options) {
  const opts = options || {};
  const days = dayColumns || [];
  const periods = periodRows || [];
  const columns = days.length || 7;

  // 行数要盖住所有课：导入的课表可能排到第 13 节，而作息只配了 12 节
  const usedPeriod = days.reduce((max, day) => {
    (day.blocks || []).forEach((block) => {
      max = Math.max(max, Number(block.endPeriod) || 0);
    });
    return max;
  }, 0);
  const rowCount = Math.max(periods.length, usedPeriod, 1);

  const tableX = PAD;
  const tableY = HEAD_TOP + HEAD_H;
  const gridX = tableX + PERIOD_W;
  const cellW = (WIDTH - PAD * 2 - PERIOD_W) / columns;
  const gridBottom = tableY + rowCount * ROW_H;

  const qr = opts.withQr
    ? { size: 180, x: (WIDTH - 180) / 2, y: gridBottom + 56, boxY: gridBottom + 28, boxHeight: 290 }
    : null;
  const height = (qr ? qr.boxY + qr.boxHeight : gridBottom + 96) + 24;

  return {
    width: WIDTH,
    height,
    qr,
    periods,
    rowCount,
    columns,
    cellW,
    tableX,
    tableY,
    gridX,
    gridBottom,
    week: meta.week,
    range: meta.range,
    term: meta.term,
    name: meta.name || '我的课表',
    days: days.map((day, index) => ({
      index: index + 1,
      label: day.label || DAY_SHORT[index] || '',
      date: day.date || '',
      dayNum: day.dayNum || '',
      blocks: (day.blocks || []).map((block) => ({
        name: block.name || '',
        // 一门课一色：格子里的主色直接拿来用，底子做淡
        color: block.color || COLORS.brand,
        start: Number(block.startPeriod) || 1,
        end: Number(block.endPeriod) || Number(block.startPeriod) || 1,
        place: [block.campus, block.room].filter(Boolean).join(' '),
        teacher: block.teacher || ''
      }))
    }))
  };
}

function drawWeek(ctx, model) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, model.width, model.height);

  // 顶部一条品牌渐变，和 App 的蓝色基调对上
  const grad = ctx.createLinearGradient(0, 0, model.width, 0);
  grad.addColorStop(0, '#4d9dff');
  grad.addColorStop(1, '#0062d6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, model.width, 6);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 42px sans-serif';
  ctx.fillText(`第 ${model.week} 周课表`, PAD, TITLE_TOP);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '22px sans-serif';
  ctx.fillText([model.range, model.term].filter(Boolean).join(' · '), PAD, SUB_TOP);

  // 表头：左侧留空（节次列），右侧七列「周一 / 10/27」
  ctx.fillStyle = COLORS.head;
  roundRect(ctx, model.tableX, HEAD_TOP, model.width - PAD * 2, HEAD_H, 16);
  ctx.fill();

  model.days.forEach((day, index) => {
    const centerX = model.gridX + index * model.cellW + model.cellW / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = index === 6 ? COLORS.faint : COLORS.ink;
    ctx.font = 'bold 21px sans-serif';
    ctx.fillText(day.label, centerX, HEAD_TOP + 28);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '17px sans-serif';
    ctx.fillText(day.date, centerX, HEAD_TOP + 50);
  });

  // 节次列 + 网格线
  ctx.textAlign = 'center';
  for (let row = 0; row < model.rowCount; row += 1) {
    const y = model.tableY + row * ROW_H;
    const period = model.periods[row] || {};

    ctx.fillStyle = COLORS.ink;
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(String(period.period || row + 1), model.tableX + PERIOD_W / 2, y + 26);
    ctx.fillStyle = COLORS.faint;
    ctx.font = '14px sans-serif';
    if (period.start) ctx.fillText(period.start, model.tableX + PERIOD_W / 2, y + 44);
    if (period.end) ctx.fillText(period.end, model.tableX + PERIOD_W / 2, y + 61);

    if (row > 0) {
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(model.tableX, y);
      ctx.lineTo(model.width - PAD, y);
      ctx.stroke();
    }
  }

  // 列分隔线
  for (let col = 0; col <= model.columns; col += 1) {
    const x = model.gridX + col * model.cellW;
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, model.tableY);
    ctx.lineTo(x, model.gridBottom);
    ctx.stroke();
  }

  // 课程块
  model.days.forEach((day, colIndex) => {
    const x = model.gridX + colIndex * model.cellW + CELL_GAP;
    const width = model.cellW - CELL_GAP * 2;

    day.blocks.forEach((block) => {
      const start = Math.max(1, block.start);
      const end = Math.max(start, block.end);
      const y = model.tableY + (start - 1) * ROW_H + CELL_GAP;
      const height = (end - start + 1) * ROW_H - CELL_GAP * 2;

      ctx.fillStyle = tint(block.color, 0.16);
      roundRect(ctx, x, y, width, height, 9);
      ctx.fill();

      // 左侧一条深色竖条，颜色更醒目（纯浅底在缩略图里容易糊成一片）
      ctx.fillStyle = tint(block.color, 0.85);
      roundRect(ctx, x, y + 6, 3, Math.max(8, height - 12), 1.5);
      ctx.fill();

      const textX = x + 9;
      const textWidth = width - 14;
      let cursor = y + 20;

      ctx.textAlign = 'left';
      ctx.fillStyle = '#1d2735';
      ctx.font = 'bold 18px sans-serif';
      const nameLines = wrapText(ctx, block.name, textWidth, 2);
      nameLines.forEach((line) => {
        ctx.fillText(line, textX, cursor);
        cursor += 20;
      });

      if (block.place && cursor + 4 < y + height) {
        ctx.fillStyle = '#5d6a7d';
        ctx.font = '14px sans-serif';
        ctx.fillText(fitText(ctx, block.place, textWidth), textX, cursor + 2);
      }
    });
  });

  if (model.qr) {
    const { qr } = model;
    ctx.fillStyle = '#f6f8fc';
    roundRect(ctx, PAD, qr.boxY, model.width - PAD * 2, qr.boxHeight, 24);
    ctx.fill();

    if (qr.image) {
      ctx.drawImage(qr.image, qr.x, qr.y, qr.size, qr.size);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.ink;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('扫码看完整课表', model.width / 2, qr.y + qr.size + 42);

    ctx.fillStyle = COLORS.muted;
    ctx.font = '18px sans-serif';
    ctx.fillText('微信扫一扫，打开小程序导入你自己的课表', model.width / 2, qr.y + qr.size + 70);
    ctx.textAlign = 'left';
  } else {
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.faint;
    ctx.font = '18px sans-serif';
    ctx.fillText('百小鸮 · 课表只存在手机本地', model.width / 2, model.gridBottom + 52);
    ctx.textAlign = 'left';
  }
}

module.exports = { COLORS, drawWeek, fitText, layoutWeek, roundRect, tint, wrapText };
