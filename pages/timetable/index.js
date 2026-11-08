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

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function monthTitle(year, monthIndex) {
  return `${year}年${monthIndex + 1}月`;
}

const ROW_HEIGHT = 96;

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
    // 跟手拖动：手指移动时这一层跟着位移，松手后回弹
    dragX: 0,
    dragTransition: 'transform .22s cubic-bezier(.22,.61,.36,1)',
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
    touchStartX: 0
  },

  onLoad() {
    this.reload(true);
    const now = new Date();
    this.openMonth(now.getFullYear(), now.getMonth(), dateStamp(now));
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
    if (week === this.data.week) return false;
    const forward = week > this.data.week;
    this.setData({ week, showWeekPicker: false, weekAnim: '' });
    this.buildView();
    // 拖动换周时由位移自己表现，不再叠 keyframes
    if (animate === false) return true;
    const anim = forward ? 'week-in-right' : 'week-in-left';
    const play = () => {
      this.setData({ weekAnim: anim });
      // 播完就摘掉类名：否则下次还是同一个类，keyframes 不会重新触发
      clearTimeout(this.weekAnimTimer);
      this.weekAnimTimer = setTimeout(() => this.setData({ weekAnim: '' }), 280);
    };
    if (typeof wx !== 'undefined' && wx.nextTick) wx.nextTick(play);
    else setTimeout(play, 16);
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
    this.dragging = false;
    this.setData({ touchStartX: event.changedTouches[0].clientX });
  },

  /**
   * 跟手拖动：手指往左拉，内容跟着往左走。
   * px → rpx 按 2 倍近似（750rpx ≈ 375px 的逻辑宽度），
   * 误差在大屏上会有几 rpx，但拖动过程用户感知不到。
   */
  moveTouch(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - this.data.touchStartX;
    if (!this.dragging) {
      if (Math.abs(dx) < 10) return;
      this.dragging = true;
      this.setData({ dragTransition: 'none' });
    }
    this.setData({ dragX: Math.round(dx * 2) });
  },

  finishTouch(event) {
    const dx = event.changedTouches[0].clientX - this.data.touchStartX;
    const dragged = this.dragging;
    this.dragging = false;

    // 没真的拖动（只是点了一下），交给各自的 click 处理
    if (!dragged) return;

    // 没超过阈值：回弹
    if (Math.abs(dx) < 55) {
      this.setData({ dragX: 0, dragTransition: 'transform .2s ease-out' });
      return;
    }

    if (this.data.view === 'notes') this.snapMonth(dx);
    else this.snapWeek(dx);
  },

  /** 松手换周：先把新一周摆到手指方向，再滑回原位 */
  snapWeek(dx) {
    const before = this.data.week;
    const changed = this.changeWeek(dx < 0 ? before + 1 : before - 1, false);
    if (!changed) {
      this.setData({ dragX: 0, dragTransition: 'transform .2s ease-out' });
      return;
    }
    this.settle(dx < 0 ? 150 : -150);
  },

  /** 记事本里左右滑切月份，手感和课表保持一致 */
  snapMonth(dx) {
    this.shiftMonth(dx < 0 ? 1 : -1);
    this.settle(dx < 0 ? 150 : -150);
  },

  settle(offset) {
    this.setData({ dragX: offset, dragTransition: 'none' });
    const play = () => this.setData({
      dragX: 0,
      dragTransition: 'transform .22s cubic-bezier(.22,.61,.36,1)'
    });
    if (typeof wx !== 'undefined' && wx.nextTick) wx.nextTick(play);
    else setTimeout(play, 16);
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
    // 默认落在 PDF 导入：教务直连在部分真机上过不了，PDF 是本机解析、验证过的稳定路径
    wx.navigateTo({ url: '/pages/pdfimport/index' });
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

  shiftMonth(delta) {
    const { year, monthIndex } = this.data;
    const target = new Date(year, monthIndex + delta, 1);
    const now = new Date();
    const inCurrentMonth = target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth();
    // 翻到本月就落在今天，翻到别的月份先落在 1 号，避免选中的日期跳到看不见的地方
    const selected = inCurrentMonth
      ? dateStamp(now)
      : dateStamp(new Date(target.getFullYear(), target.getMonth(), 1));
    this.openMonth(target.getFullYear(), target.getMonth(), selected);
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

