/**
 * 课表分享图：把「本周」画成一张竖版图，方便直接发给同学。
 *
 * 为什么不做「点开小程序看你的课表」：那需要把课表存到云端再给一个 id，
 * 现在项目是零后端；小程序又没有「分享数据」这种能力。图片是唯一
 * 不需要服务器、对方点开就能看的形态。
 */

const WIDTH = 750;
const PAD = 44;

const COLORS = {
  ink: '#18202d',
  muted: '#8a93a3',
  faint: '#b3bac5',
  line: '#eceef3',
  brand: '#007aff'
};

const DAY_TINT = {
  1: '#2f6bd8',
  2: '#7b4fd0',
  3: '#1c8a5c',
  4: '#c2610f',
  5: '#12808a',
  6: '#b03a6a',
  7: '#5a6b86'
};

function fitText(ctx, text, maxWidth) {
  const source = String(text || '');
  if (ctx.measureText(source).width <= maxWidth) return source;
  let cut = source;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
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

/**
 * @param {Array} dayColumns 页面里的 dayColumns（每项有 label/date/dayNum/blocks）
 * @param {object} meta { week, range, term, totalWeeks, name }
 */
function layoutWeek(dayColumns, meta) {
  let cursor = 190;
  const days = (dayColumns || []).map((column, index) => {
    const blocks = (column.blocks || []).map((block) => ({
      time: block.timeText || '',
      name: block.name || '',
      place: [block.campus, block.room].filter(Boolean).join(' '),
      teacher: block.teacher || ''
    }));
    const height = Math.max(64, 28 + blocks.length * 56);
    const day = {
      index: index + 1,
      label: column.label || '',
      date: column.date || '',
      dayNum: column.dayNum || '',
      y: cursor,
      height,
      blocks
    };
    cursor += height + 12;
    return day;
  });

  const height = cursor + 96;
  return {
    width: WIDTH,
    height,
    week: meta.week,
    range: meta.range,
    term: meta.term,
    name: meta.name || '我的课表',
    days
  };
}

function drawWeek(ctx, model) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, model.width, model.height);

  const grad = ctx.createLinearGradient(0, 0, model.width, 0);
  grad.addColorStop(0, '#4d9dff');
  grad.addColorStop(1, '#0062d6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, model.width, 6);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText(`第 ${model.week} 周课表`, PAD, 92);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '23px sans-serif';
  ctx.fillText([model.range, model.term].filter(Boolean).join(' · '), PAD, 132);

  model.days.forEach((day) => {
    const color = DAY_TINT[day.index] || COLORS.brand;

    // 日期块
    ctx.fillStyle = color;
    roundRect(ctx, PAD, day.y, 92, 58, 14);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(day.label, PAD + 12, day.y + 26);
    ctx.font = '19px sans-serif';
    ctx.fillText(day.date, PAD + 12, day.y + 48);

    if (!day.blocks.length) {
      ctx.fillStyle = COLORS.faint;
      ctx.font = '22px sans-serif';
      ctx.fillText('没课', PAD + 116, day.y + 36);
      return;
    }

    day.blocks.forEach((block, index) => {
      const y = day.y + index * 56;
      ctx.fillStyle = COLORS.ink;
      ctx.font = 'bold 24px sans-serif';
      const text = `${block.time ? `${block.time}  ` : ''}${block.name}`;
      ctx.fillText(fitText(ctx, text, model.width - PAD * 2 - 116), PAD + 116, y + 22);

      const sub = [block.place, block.teacher].filter(Boolean).join(' · ');
      if (sub) {
        ctx.fillStyle = COLORS.muted;
        ctx.font = '19px sans-serif';
        ctx.fillText(fitText(ctx, sub, model.width - PAD * 2 - 116), PAD + 116, y + 46);
      }
    });
  });

  ctx.fillStyle = COLORS.faint;
  ctx.font = '19px sans-serif';
  ctx.fillText('由 百小鸮 生成 · 课表只存在手机本地', PAD, model.height - 40);
}

module.exports = { COLORS, DAY_TINT, drawWeek, fitText, layoutWeek, roundRect };
