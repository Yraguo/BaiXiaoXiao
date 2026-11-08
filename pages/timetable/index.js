const { COURSE_COLORS, assignCourseColors, courseTint, normalizeName } = require('../../utils/colors');
const { DAY_NAMES } = require('../../utils/constants');
const {
  currentWeek,
  calendarDayDiff,
  dateForDay,
  dateStamp,
  monthCells,
  monthDay,
  parseDate,
  todayDayIndex,
  weekRange
} = require('../../utils/date');
const { formatWeeks } = require('../../utils/weeks');
const { loadCourses, loadSettings } = require('../../utils/storage');
const { loadNotes, saveNotes } = require('../../utils/appStore');
const { confirmDelete } = require('../../utils/confirm');
const { drawWeek, layoutWeek } = require('../../utils/shareCard');

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function monthTitle(year, monthIndex) {
  return `${year}年${monthIndex + 1}月`;
}

const ROW_HEIGHT = 96;

/* ---------------- 百宝箱浮动球 ---------------- */
const BALL_SIZE = 52;          // px，与 wxss 里的 .tool-fab 宽高一致
const BALL_MARGIN = 6;         // 离屏幕边缘至少留这么多，避免贴死或半出屏
const BALL_SNAP = 26;          // 松手时离边缘小于这个距离就吸过去
const BALL_KEY = 'baixiaoxiao.toolbox.ball.v1';

function minutes(value) {
  const [hour, minute] = String(value || '00:00').split(':').map(Number);
  return hour * 60 + minute;
}

function sameDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

Page({
  data: {
    settings: {},
    week: 1,
    currentWeek: 1,
    weekTitle: '',
    // 切换周次时的入场动画类名，'week-in-right' / 'week-in-left'
    weekAnim: '',
    // 顶部两个视图：'timetable' 课表 / 'notes' 记事本
    view: 'timetable',
    year: 2026,
    monthIndex: 0,
    monthText: '',
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    cells: [],
    selectedDate: '',
    selectedLabel: '',
    dayNotes: [],
    monthTotal: 0,
    dayColumns: [],
    periodRows: [],
    weekOptions: [],
    showWeekPicker: false,
    detail: null,
    nextCourse: null,
    hasCourses: true,
    touchStartX: 0,
    // 百宝箱：ballX/ballY 是 px（position:fixed 用 px 才准），ballReady 之前不渲染避免闪一下
    ballX: 0,
    ballY: 0,
    ballReady: false,
    ballDragging: false,
    toolboxOpen: false
  },

  onLoad() {
    this.reload(true);
    const now = new Date();
    this.openMonth(now.getFullYear(), now.getMonth(), dateStamp(now));
    this.initBall();
  },

  onShow() {
    if (this.loadedOnce) this.reload(false);
    this.loadedOnce = true;
    // 两个视图常驻在轨道上，回到页面时两个都要刷新
    this.renderNotes();
  },

  onUnload() {
    // 动画收尾的定时器别留到页面销毁之后
    clearTimeout(this.weekAnimTimer);
  },

  onPullDownRefresh() {
    this.reload(false);
    wx.stopPullDownRefresh();
  },

  onShareAppMessage() {
    return {
      title: `${this.data.settings.timetableName || '我的课表'} · 第${this.data.week}周`,
      path: '/pages/timetable/index'
    };
  },

  reload(resetWeek) {
    const settings = loadSettings();
    const courses = loadCourses();
    const thisWeek = currentWeek(settings.semesterStartMonday, settings.totalWeeks);
    const week = resetWeek
      ? thisWeek
      : Math.min(Math.max(this.data.week || thisWeek, 1), settings.totalWeeks);

    this.settings = settings;
    this.courses = courses;
    this.setData({ settings, currentWeek: thisWeek, week, hasCourses: courses.length > 0 });
    this.buildView();
  },

  buildView() {
    const { settings, courses } = this;
    const { week, currentWeek: shownCurrentWeek } = this.data;
    const now = new Date();
    const todayIndex = todayDayIndex(now);
    const visibleDays = settings.showWeekend ? 7 : 5;
    const colorAllocation = assignCourseColors(courses.map((course) => course.name));
    const periods = settings.periodTimes || [];
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    let activePeriod = -1;

    periods.forEach((period) => {
      if (nowMinute >= minutes(period.start) && nowMinute <= minutes(period.end)) {
        activePeriod = period.period;
      }
    });

    // 表格行数要够用：导入的课表可能排到第 13 节，而作息只配了 12 节。
    // 少一行的话，那门课的色块会画到网格外面，被卡片边缘硬切掉一截。
    const weekCourses = courses.filter((course) => Array.isArray(course.weeks) && course.weeks.includes(week));
    const usedPeriods = weekCourses.reduce((max, course) => Math.max(max, Number(course.endPeriod) || 0), 0);
    const rowCount = Math.max(periods.length, usedPeriods, 1);

    const periodRows = Array.from({ length: rowCount }, (_, index) => {
      const period = periods[index] || { period: index + 1, start: '', end: '' };
      return { ...period, active: week === shownCurrentWeek && period.period === activePeriod };
    });

    const monthOfWeek = dateForDay(settings.semesterStartMonday, week, 0).getMonth() + 1;
    const dayColumns = Array.from({ length: visibleDays }, (_, dayIndex) => {
      const date = dateForDay(settings.semesterStartMonday, week, dayIndex);
      const isToday = week === shownCurrentWeek && dayIndex === todayIndex;
      const blocks = courses
        .filter((course) => Number(course.day) === dayIndex + 1 && course.weeks.includes(week))
        .sort((left, right) => left.startPeriod - right.startPeriod)
        .map((course) => {
          // 配色以「所有课程名的一次性分配」为准，保证一门课一个颜色。
          // 之前优先用课程自带的 colorIndex（按名字哈希），不同课会撞到同一个
          // 颜色，看上去就像"好几门课共用一个色"。
          const colorIndex = colorAllocation[normalizeName(course.name)] || 0;
          const isNow = isToday
            && Number(course.startPeriod) <= activePeriod
            && Number(course.endPeriod) >= activePeriod;
          const top = (Number(course.startPeriod) - 1) * ROW_HEIGHT + 4;
          const height = (Number(course.endPeriod) - Number(course.startPeriod) + 1) * ROW_HEIGHT - 8;
          const ink = COURSE_COLORS[colorIndex % COURSE_COLORS.length];
          return {
            ...course,
            color: ink,
            isNow,
            // 单节次的格子只有 88rpx 高，塞不下两行课名 + 教室
            short: Number(course.endPeriod) - Number(course.startPeriod) < 1,
            style: `top:${top}rpx;height:${height}rpx;background:${courseTint(colorIndex)};color:${ink};`,
            timeText: this.timeText(course)
          };
        });

      return {
        dayIndex,
        label: DAY_NAMES[dayIndex],
        weekChar: DAY_NAMES[dayIndex],
        dayNum: date.getDate(),
        date: monthDay(date),
        isToday,
        blocks
      };
    });

    this.setData({
      periodRows,
      dayColumns,
      weekTitle: weekRange(settings.semesterStartMonday, week),
      weekOptions: Array.from({ length: settings.totalWeeks }, (_, index) => ({
        value: index + 1,
        active: index + 1 === week
      })),
      nextCourse: this.findNextCourse(colorAllocation)
    });
  },

  timeText(course) {
    const periods = this.settings.periodTimes || [];
    const first = periods.find((item) => item.period === Number(course.startPeriod));
    const last = periods.find((item) => item.period === Number(course.endPeriod));
    return first && last ? `${first.start}–${last.end}` : '';
  },

  findNextCourse(colorAllocation) {
    const now = new Date();
    let best = null;
    this.courses.forEach((course) => {
      course.weeks.forEach((week) => {
        const classDate = dateForDay(this.settings.semesterStartMonday, week, Number(course.day) - 1);
        const startTime = (this.settings.periodTimes || []).find(
          (item) => item.period === Number(course.startPeriod)
        );
        if (!startTime) return;
        const start = new Date(classDate);
        const [hour, minute] = startTime.start.split(':').map(Number);
        start.setHours(hour, minute, 0, 0);
        if (start <= now || (start.getTime() - now.getTime()) > 8 * 24 * 60 * 60 * 1000) return;
        if (best && best.start <= start) return;
        best = { course, start, week };
      });
    });
    if (!best) return null;

    const differenceMinutes = Math.ceil((best.start.getTime() - now.getTime()) / 60000);
    const automatic = colorAllocation[normalizeName(best.course.name)] || 0;
    const colorIndex = Number.isInteger(best.course.colorIndex) ? best.course.colorIndex : automatic;
    const dayLabel = sameDay(best.start, now)
      ? '今天'
      : sameDay(best.start, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
        ? '明天'
        : DAY_NAMES[Number(best.course.day) - 1];
    // 倒计时按「自然日差」算，不按小时数整除：
    // 周六 20:16 看周一 08:00 的课只差 36 小时，除以 24 取整会得到"1 天后"，
    // 跟旁边的"周一"对不上；按自然日算才是 2 天。
    const dayDiff = calendarDayDiff(now, best.start);
    let countdown = `${dayDiff} 天后`;
    if (dayDiff <= 0) {
      countdown = differenceMinutes >= 60
        ? `${Math.floor(differenceMinutes / 60)} 小时后`
        : `${differenceMinutes} 分钟后`;
    }

    return {
      ...best.course,
      color: COURSE_COLORS[colorIndex % COURSE_COLORS.length],
      dayLabel,
      countdown,
      timeText: this.timeText(best.course)
    };
  },

  previousWeek() {
    this.changeWeek(this.data.week - 1);
  },

  nextWeek() {
    this.changeWeek(this.data.week + 1);
  },

  goCurrentWeek() {
    this.changeWeek(this.data.currentWeek);
  },

  changeWeek(value, animate) {
    const week = Math.min(Math.max(Number(value), 1), this.settings.totalWeeks);
    if (week === this.data.week || this.switching) return false;
    const forward = week > this.data.week;
    if (animate === false) {
      this.setData({ week, showWeekPicker: false, weekAnim: '' });
      this.buildView();
      return true;
    }
    // 旧内容先按方向滑出（26% + 淡出），再换数据让新内容从反方向进入
    this.switching = true;
    this.setData({ showWeekPicker: false, weekAnim: forward ? 'wk-leave-left' : 'wk-leave-right' });
    clearTimeout(this.weekAnimTimer);
    this.weekAnimTimer = setTimeout(() => {
      this.setData({ week, weekAnim: forward ? 'wk-enter-right' : 'wk-enter-left' });
      this.buildView();
      this.weekAnimTimer = setTimeout(() => {
        this.setData({ weekAnim: '' });
        this.switching = false;
      }, 200);
    }, 120);
    return true;
  },

  openWeekPicker() {
    this.setData({ showWeekPicker: true });
  },

  closeWeekPicker() {
    this.setData({ showWeekPicker: false });
  },

  selectWeek(event) {
    this.changeWeek(event.currentTarget.dataset.week);
  },

  rememberTouch(event) {
    this.setData({ touchStartX: event.changedTouches[0].clientX });
  },

  /**
   * 只监听起止，不跟手——这是 UniMate 的做法：
   * 滑动只用来判断方向和距离，动画交给两段式进出场。
   */
  finishTouch(event) {
    const dx = event.changedTouches[0].clientX - this.data.touchStartX;
    if (Math.abs(dx) < 55) return;
    if (this.data.view === 'notes') this.shiftMonth(dx < 0 ? 1 : -1);
    else this.changeWeek(dx < 0 ? this.data.week + 1 : this.data.week - 1);
  },

  showCourse(event) {
    const id = event.currentTarget.dataset.id;
    const course = this.courses.find((item) => item.id === id);
    if (!course) return;
    const colorAllocation = assignCourseColors(this.courses.map((item) => item.name));
    // 与格子里的配色保持同一套分配，否则详情页圆点和格子颜色会对不上
    const colorIndex = colorAllocation[normalizeName(course.name)] || 0;
    this.setData({
      detail: {
        ...course,
        color: COURSE_COLORS[colorIndex % COURSE_COLORS.length],
        dayText: DAY_NAMES[Number(course.day) - 1],
        periodText: `第 ${course.startPeriod}–${course.endPeriod} 节`,
        timeText: this.timeText(course),
        weeksText: formatWeeks(course.weeks)
      }
    });
  },

  closeDetail() {
    this.setData({ detail: null });
  },

  /* ---------------- 百宝箱（可拖动的浮动球） ---------------- */

  /** 可用窗口尺寸：优先 getWindowInfo，老基础库退回 getSystemInfoSync */
  windowSize() {
    try {
      if (wx.getWindowInfo) {
        const info = wx.getWindowInfo();
        if (info && info.windowWidth) return { width: info.windowWidth, height: info.windowHeight };
      }
      const info = wx.getSystemInfoSync();
      return { width: info.windowWidth, height: info.windowHeight };
    } catch (error) {
      return { width: 375, height: 667 };
    }
  },

  /** 把球限制在可视区内：拖动、旋转屏、改字号之后都能兜住 */
  clampBall(x, y) {
    const { width, height } = this.windowSize();
    const maxX = Math.max(BALL_MARGIN, width - BALL_SIZE - BALL_MARGIN);
    const maxY = Math.max(BALL_MARGIN, height - BALL_SIZE - BALL_MARGIN);
    return {
      x: Math.min(Math.max(Number(x) || 0, BALL_MARGIN), maxX),
      y: Math.min(Math.max(Number(y) || 0, BALL_MARGIN), maxY)
    };
  },

  initBall() {
    const { width, height } = this.windowSize();
    // 默认停在右下角、主按钮上方一点，不挡课表也不挡 tabBar
    let x = width - BALL_SIZE - 12;
    let y = height - BALL_SIZE - 96;
    try {
      const saved = wx.getStorageSync(BALL_KEY);
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        x = saved.x;
        y = saved.y;
      }
    } catch (error) {
      // 读不到就用默认位置
    }
    const spot = this.clampBall(x, y);
    this.setData({ ballX: spot.x, ballY: spot.y, ballReady: true });
  },

  saveBall() {
    try {
      wx.setStorageSync(BALL_KEY, { x: this.data.ballX, y: this.data.ballY });
    } catch (error) {
      // 存不下就算了，不影响使用
    }
  },

  onBallTouchStart(event) {
    const touch = event.touches[0];
    this.ballDrag = {
      startX: touch.clientX,
      startY: touch.clientY,
      originX: this.data.ballX,
      originY: this.data.ballY,
      moved: false,
      at: Date.now()
    };
  },

  onBallTouchMove(event) {
    const drag = this.ballDrag;
    if (!drag) return;
    const touch = event.touches[0];
    const dx = touch.clientX - drag.startX;
    const dy = touch.clientY - drag.startY;
    // 4px 以内算点击，避免手抖把点按识别成拖动
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      this.setData({ ballDragging: true });
    }
    const spot = this.clampBall(drag.originX + dx, drag.originY + dy);
    this.setData({ ballX: spot.x, ballY: spot.y });
  },

  onBallTouchEnd() {
    const drag = this.ballDrag;
    this.ballDrag = null;
    if (!drag) return;
    if (!drag.moved) {
      if (Date.now() - drag.at < 600) this.openToolbox();
      return;
    }
    // 松手轻吸附：靠边就贴边，靠中间就留在原地，位置记到本机
    const { width } = this.windowSize();
    const maxX = width - BALL_SIZE - BALL_MARGIN;
    let x = this.data.ballX;
    if (x - BALL_MARGIN < BALL_SNAP) x = BALL_MARGIN;
    else if (maxX - x < BALL_SNAP) x = maxX;
    const spot = this.clampBall(x, this.data.ballY);
    this.setData({ ballX: spot.x, ballY: spot.y, ballDragging: false });
    this.saveBall();
  },

  openToolbox() {
    this.setData({ toolboxOpen: true });
  },

  closeToolbox() {
    this.setData({ toolboxOpen: false });
  },

  /**
   * 分享课表：画一张本周课表图，走微信的「分享图片」面板。
   * 真·让对方在小程序里看课表需要云端存一份，现在没有后端，图片是最接近的形态。
   */
  shareTimetable() {
    if (!this.data.hasCourses) {
      wx.showToast({ title: '还没有课程可以分享', icon: 'none' });
      return;
    }
    const model = layoutWeek(this.data.dayColumns, {
      week: this.data.week,
      range: this.data.weekTitle,
      term: this.data.settings.timetableName,
      name: '我的课表'
    });

    wx.showLoading({ title: '正在生成', mask: true });
    wx.createSelectorQuery().select('#shareCanvas').fields({ node: true }).exec((res) => {
      const canvas = res && res[0] && res[0].node;
      if (!canvas) {
        wx.hideLoading();
        wx.showToast({ title: '画布不可用', icon: 'none' });
        return;
      }
      canvas.width = model.width;
      canvas.height = model.height;
      drawWeek(canvas.getContext('2d'), model);

      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: model.width,
        height: model.height,
        destWidth: model.width,
        destHeight: model.height,
        success: (file) => {
          wx.hideLoading();
          if (wx.showShareImageMenu) {
            wx.showShareImageMenu({
              path: file.tempFilePath,
              fail: (error) => {
                const message = String((error && error.errMsg) || '');
                if (message.indexOf('cancel') >= 0) return;
                wx.showToast({ title: '分享失败，重试一次', icon: 'none' });
              }
            });
          } else {
            wx.previewImage({ urls: [file.tempFilePath], current: file.tempFilePath });
            wx.showToast({ title: '长按图片可保存/转发', icon: 'none' });
          }
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '生成失败，重试一次', icon: 'none' });
        }
      });
    });
  },

  toolboxAction(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ toolboxOpen: false });
    if (key === 'pdf') wx.navigateTo({ url: '/pages/pdfimport/index' });
    else if (key === 'jw') wx.navigateTo({ url: '/pages/import/index' });
    else if (key === 'course') this.addCourse();
    else if (key === 'settings') this.openSettings();
    else if (key === 'week') this.goCurrentWeek();
    else if (key === 'share') this.shareTimetable();
    else if (key === 'note') {
      // 先切到记事本并落在今天，再开新建
      this.setData({ view: 'notes' });
      this.goToday();
      this.renderNotes();
      setTimeout(() => this.addNote(), 80);
    }
  },

  addCourse() {
    wx.navigateTo({ url: '/pages/course/edit' });
  },

  editCourse() {
    if (!this.data.detail) return;
    wx.navigateTo({ url: `/pages/course/edit?id=${this.data.detail.id}` });
    this.closeDetail();
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  openImport() {
    // 默认落在云端导入（填学号密码就能读课表），PDF 是它的备选，两个入口在页内并列
    wx.navigateTo({ url: '/pages/import/index' });
  },

  /* ---------------- 记事本（原「记事」tab，现在并到课表页） ---------------- */

  switchView(event) {
    const view = event.currentTarget.dataset.view;
    if (view === this.data.view) return;
    this.setData({ view });
    if (view === 'notes') this.renderNotes();
  },

  openMonth(year, monthIndex, selectedDate) {
    const normalized = new Date(year, monthIndex, 1);
    this.setData({
      year: normalized.getFullYear(),
      monthIndex: normalized.getMonth(),
      selectedDate,
      monthText: monthTitle(normalized.getFullYear(), normalized.getMonth())
    });
    this.renderNotes();
  },

  renderNotes() {
    const notes = loadNotes().filter((item) => !item.deletedAt);
    const byDate = {};
    notes.forEach((note) => {
      if (!note.date) return;
      (byDate[note.date] = byDate[note.date] || []).push(note);
    });

    const today = dateStamp(new Date());
    const { year, monthIndex, selectedDate } = this.data;

    const cells = monthCells(year, monthIndex).map((cell) => ({
      date: cell.date,
      day: cell.day,
      inMonth: cell.inMonth,
      isToday: cell.date === today,
      isSelected: cell.date === selectedDate,
      hasNote: Boolean(byDate[cell.date] && byDate[cell.date].length)
    }));

    const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const monthTotal = notes.filter((note) => String(note.date || '').indexOf(monthPrefix) === 0).length;

    // 未完成的排在前面，同组内新的在上
    const dayNotes = (byDate[selectedDate] || []).slice().sort((left, right) => {
      if (left.done !== right.done) return left.done ? 1 : -1;
      return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
    });

    this.setData({
      cells,
      dayNotes,
      monthTotal,
      selectedLabel: this.labelOf(selectedDate)
    });
  },

  labelOf(date) {
    const parsed = parseDate(date);
    return `${parsed.getMonth() + 1}月${parsed.getDate()}日 · ${WEEK_LABELS[parsed.getDay()]}`;
  },

  previousMonth() {
    this.shiftMonth(-1);
  },

  nextMonth() {
    this.shiftMonth(1);
  },

  shiftMonth(delta, animate) {
    if (this.switching) return;
    const { year, monthIndex } = this.data;
    const target = new Date(year, monthIndex + delta, 1);
    const now = new Date();
    const inCurrentMonth = target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth();
    // 翻到本月就落在今天，翻到别的月份先落在 1 号，避免选中的日期跳到看不见的地方
    const selected = inCurrentMonth
      ? dateStamp(now)
      : dateStamp(new Date(target.getFullYear(), target.getMonth(), 1));
    const apply = () => this.openMonth(target.getFullYear(), target.getMonth(), selected);

    if (animate === false) {
      apply();
      return;
    }
    // 与切周同一套两段式：日历先按方向滑出，换月份后再从反方向进入
    this.switching = true;
    this.setData({ weekAnim: delta > 0 ? 'wk-leave-left' : 'wk-leave-right' });
    clearTimeout(this.weekAnimTimer);
    this.weekAnimTimer = setTimeout(() => {
      apply();
      this.setData({ weekAnim: delta > 0 ? 'wk-enter-right' : 'wk-enter-left' });
      this.weekAnimTimer = setTimeout(() => {
        this.setData({ weekAnim: '' });
        this.switching = false;
      }, 200);
    }, 120);
  },

  goToday() {
    const now = new Date();
    this.openMonth(now.getFullYear(), now.getMonth(), dateStamp(now));
  },

  selectDay(event) {
    const date = event.currentTarget.dataset.date;
    if (date === this.data.selectedDate) return;
    const parsed = parseDate(date);
    if (parsed.getFullYear() !== this.data.year || parsed.getMonth() !== this.data.monthIndex) {
      // 点到上/下月的补位日期，顺手把月份翻过去
      this.openMonth(parsed.getFullYear(), parsed.getMonth(), date);
      return;
    }
    this.setData({ selectedDate: date });
    this.renderNotes();
  },

  addNote() {
    wx.navigateTo({ url: `/pages/note/edit?date=${this.data.selectedDate}` });
  },

  editNote(event) {
    wx.navigateTo({ url: `/pages/note/edit?id=${event.currentTarget.dataset.id}` });
  },

  toggleDone(event) {
    const id = event.currentTarget.dataset.id;
    const notes = loadNotes().map((item) => (
      item.id === id
        ? Object.assign({}, item, { done: !item.done, updatedAt: new Date().toISOString() })
        : item
    ));
    saveNotes(notes);
    this.renderNotes();
  },

  async removeNote(event) {
    const id = event.currentTarget.dataset.id;
    const notes = loadNotes();
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    const confirmed = await confirmDelete({ title: '删除这条记事？', name: note.title, count: 1, recoverable: false });
    if (!confirmed) return;
    saveNotes(notes.map((item) => (item.id === id ? Object.assign({}, item, { deletedAt: new Date().toISOString() }) : item)));
    this.renderNotes();
  },

  stopPropagation() {}
});

