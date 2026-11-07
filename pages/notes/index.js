const { loadNotes, saveNotes } = require('../../utils/appStore');
const { confirmDelete } = require('../../utils/confirm');
const { dateStamp, monthCells, parseDate } = require('../../utils/date');

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function monthTitle(year, monthIndex) {
  return `${year}年${monthIndex + 1}月`;
}

Page({
  data: {
    year: 2026,
    monthIndex: 0,
    monthText: '',
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    cells: [],
    selectedDate: '',
    selectedLabel: '',
    dayNotes: [],
    monthTotal: 0
  },

  onLoad() {
    const now = new Date();
    this.setMonth(now.getFullYear(), now.getMonth(), dateStamp(now));
  },

  // 从编辑页返回后要重算圆点和当天的列表
  onShow() {
    if (this.data.selectedDate) this.render();
  },

  setMonth(year, monthIndex, selectedDate) {
    const normalized = new Date(year, monthIndex, 1);
    this.setData({
      year: normalized.getFullYear(),
      monthIndex: normalized.getMonth(),
      selectedDate,
      monthText: monthTitle(normalized.getFullYear(), normalized.getMonth())
    });
    this.render();
  },

  render() {
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
    this.setMonth(target.getFullYear(), target.getMonth(), selected);
  },

  goToday() {
    const now = new Date();
    this.setMonth(now.getFullYear(), now.getMonth(), dateStamp(now));
  },

  selectDay(event) {
    const date = event.currentTarget.dataset.date;
    if (date === this.data.selectedDate) return;
    const parsed = parseDate(date);
    if (parsed.getFullYear() !== this.data.year || parsed.getMonth() !== this.data.monthIndex) {
      // 点到上/下月的补位日期，顺手把月份翻过去
      this.setMonth(parsed.getFullYear(), parsed.getMonth(), date);
      return;
    }
    this.setData({ selectedDate: date });
    this.render();
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
    this.render();
  },

  async removeNote(event) {
    const id = event.currentTarget.dataset.id;
    const notes = loadNotes();
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    const confirmed = await confirmDelete({ title: '删除这条记事？', name: note.title, count: 1, recoverable: false });
    if (!confirmed) return;
    saveNotes(notes.map((item) => (item.id === id ? Object.assign({}, item, { deletedAt: new Date().toISOString() }) : item)));
    this.render();
  }
});
