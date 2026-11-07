const { COURSE_COLORS, assignCourseColors, normalizeName } = require('../../utils/colors');
const { DAY_NAMES } = require('../../utils/constants');
const {
  currentWeek,
  calendarDayDiff,
  dateForDay,
  monthDay,
  todayDayIndex,
  weekRange
} = require('../../utils/date');
const { formatWeeks } = require('../../utils/weeks');
const { loadCourses, loadSettings } = require('../../utils/storage');

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
  },

  onShow() {
    if (this.loadedOnce) this.reload(false);
    this.loadedOnce = true;
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
          const automatic = colorAllocation[normalizeName(course.name)] || 0;
          const colorIndex = Number.isInteger(course.colorIndex) ? course.colorIndex : automatic;
          const isNow = isToday
            && Number(course.startPeriod) <= activePeriod
            && Number(course.endPeriod) >= activePeriod;
          const top = (Number(course.startPeriod) - 1) * ROW_HEIGHT + 4;
          const height = (Number(course.endPeriod) - Number(course.startPeriod) + 1) * ROW_HEIGHT - 8;
          return {
            ...course,
            color: COURSE_COLORS[colorIndex % COURSE_COLORS.length],
            isNow,
            // 单节次的格子只有 88rpx 高，塞不下两行课名 + 教室
            short: Number(course.endPeriod) - Number(course.startPeriod) < 1,
            style: `top:${top}rpx;height:${height}rpx;background:${COURSE_COLORS[colorIndex % COURSE_COLORS.length]};`,
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

  changeWeek(value) {
    const week = Math.min(Math.max(Number(value), 1), this.settings.totalWeeks);
    if (week === this.data.week) return;
    const forward = week > this.data.week;
    this.setData({ week, showWeekPicker: false, weekAnim: '' });
    this.buildView();
    const anim = forward ? 'week-in-right' : 'week-in-left';
    const play = () => {
      this.setData({ weekAnim: anim });
      // 播完就摘掉类名：否则下次还是同一个类，keyframes 不会重新触发
      clearTimeout(this.weekAnimTimer);
      this.weekAnimTimer = setTimeout(() => this.setData({ weekAnim: '' }), 280);
    };
    if (typeof wx !== 'undefined' && wx.nextTick) wx.nextTick(play);
    else setTimeout(play, 16);
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

  finishTouch(event) {
    const distance = event.changedTouches[0].clientX - this.data.touchStartX;
    if (Math.abs(distance) < 55) return;
    if (distance < 0) this.nextWeek();
    else this.previousWeek();
  },

  showCourse(event) {
    const id = event.currentTarget.dataset.id;
    const course = this.courses.find((item) => item.id === id);
    if (!course) return;
    const colorAllocation = assignCourseColors(this.courses.map((item) => item.name));
    const automatic = colorAllocation[normalizeName(course.name)] || 0;
    const colorIndex = Number.isInteger(course.colorIndex) ? course.colorIndex : automatic;
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

  stopPropagation() {}
});

