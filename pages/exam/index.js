const { cloudExams, stepLines } = require('../../utils/jw/cloudClient');
const { SEMESTER_LABELS } = require('../../utils/constants');
const { currentTerm } = require('../../utils/jw/zfClient');
const { loadExams } = require('../../utils/storage');
const display = require('../../utils/display');

const CREDENTIAL_ERRORS = ['INVALID_CREDENTIALS', 'PARAMS_LOST', 'LOGIN_BOUNCED', 'ACCOUNT_LOCKED'];

Page({
  data: {
    pageStyle: '',
    username: '',
    password: '',
    yearOptions: [],
    yearIndex: 1,
    semesterLabels: SEMESTER_LABELS,
    semesterIndex: 0,
    loading: false,
    loadingText: '',
    error: '',
    errorKind: '',
    exams: [],
    termText: '',
    queried: false,
    syncedLabel: '',
    steps: [],
    showSteps: false
  },

  onLoad() {
    this.setData({ pageStyle: display.applyTheme() });

    // 优先用导入课表时顺带同步下来的考试安排：那份数据不用再登录一次就能看
    const cached = loadExams();
    if (cached.exams.length) {
      this.setData({
        exams: this.toItems(cached.exams),
        queried: true,
        syncedLabel: this.formatAt(cached.at)
      });
    }

    const term = currentTerm();
    const base = Number(term.xnm) || new Date().getFullYear();
    this.setData({
      yearOptions: [base - 1, base, base + 1].map((year) => `${year}-${year + 1} 学年`),
      yearIndex: 1,
      semesterIndex: Math.max(0, Number(term.semester) - 1)
    });
  },

  updateUsername(event) {
    this.setData({ username: event.detail.value, error: '', errorKind: '' });
  },

  updatePassword(event) {
    this.setData({ password: event.detail.value, error: '', errorKind: '' });
  },

  changeYear(event) {
    this.setData({ yearIndex: Number(event.detail.value) });
  },

  changeSemester(event) {
    this.setData({ semesterIndex: Number(event.detail.value) });
  },

  selectedXnm() {
    const label = this.data.yearOptions[this.data.yearIndex] || '';
    return (label.match(/^(\d{4})/) || [])[1] || '';
  },

  async startQuery() {
    if (this.data.loading) return;

    const username = String(this.data.username || '').trim();
    const password = String(this.data.password || '');
    if (!username) {
      this.setData({ error: '请填写学号', errorKind: 'VALIDATION_FAILED' });
      return;
    }
    if (!password) {
      this.setData({ error: '请填写教务系统密码', errorKind: 'VALIDATION_FAILED' });
      return;
    }

    this.setData({
      loading: true,
      loadingText: '正在登录教务系统…',
      error: '',
      errorKind: '',
      queried: false
    });
    wx.showLoading({ title: '正在查询…', mask: true });

    let result;
    try {
      result = await cloudExams({
        username,
        password,
        xnm: this.selectedXnm(),
        semester: this.data.semesterIndex + 1
      });
    } catch (error) {
      result = { ok: false, kind: 'UNKNOWN', error: (error && error.message) || '查询失败' };
    }

    wx.hideLoading();

    if (!result || !result.ok) {
      const kind = (result && result.kind) || '';
      const patch = {
        loading: false,
        loadingText: '',
        error: (result && result.error) || '查询没有完成，请稍后重试。',
        errorKind: kind,
        steps: stepLines((result && result.steps) || []),
        showSteps: false,
        queried: true
      };
      if (CREDENTIAL_ERRORS.indexOf(kind) >= 0) patch.password = '';
      this.setData(patch);
      return;
    }

    const exams = this.toItems(result.exams || []);

    this.setData({
      loading: false,
      loadingText: '',
      // 密码用完即弃，不留在页面数据里
      password: '',
      exams: exams,
      termText: `${this.data.yearOptions[this.data.yearIndex]} · ${SEMESTER_LABELS[this.data.semesterIndex]}`,
      queried: true,
      syncedLabel: '',
      error: exams.length ? '' : '教务系统有返回，但这份列表是空的。可能这个学期还没排考，或者学期选错了。',
      errorKind: exams.length ? '' : 'NO_EXAMS',
      steps: stepLines(result.steps || []),
      showSteps: false
    });
  },

  toggleSteps() {
    this.setData({ showSteps: !this.data.showSteps });
  },

  reset() {
    this.setData({
      exams: [],
      error: '',
      errorKind: '',
      queried: false,
      syncedLabel: '',
      steps: [],
      showSteps: false
    });
  },

  /** 云函数返回的原始条目 → 页面用的结构 */
  toItems(list) {
    return (Array.isArray(list) ? list : []).map((item, index) => ({
      key: `exam-${index}-${item.name || ''}`,
      name: item.name || '未命名考试',
      type: item.type || '',
      time: item.time || '',
      room: item.room || '',
      campus: item.campus || '',
      seat: item.seat || '',
      form: item.form || '',
      remark: item.remark || ''
    }));
  },

  /** 同步时间显示成 11/16 22:40 */
  formatAt(at) {
    const time = Number(at) || 0;
    if (!time) return '';
    const date = new Date(time);
    const pad = (value) => (value < 10 ? '0' + value : String(value));
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
});
