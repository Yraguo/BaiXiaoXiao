const { courseColorIndex } = require('../../utils/colors');
const { DAY_NAMES, SEMESTER_LABELS } = require('../../utils/constants');
const { confirmReplace } = require('../../utils/confirm');
const { currentTerm } = require('../../utils/jw/zfClient');
const { maxWeekOf, toCourses } = require('../../utils/jw/mapper');
const { importTimetable, getStepLog } = require('../../utils/jw/session');
const { loadCourses, loadSettings, saveCourses, saveSettings } = require('../../utils/storage');
const { formatWeeks } = require('../../utils/weeks');

const DEFAULT_ADDRESS = 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/login_slogin.html';

/**
 * 这些失败说明凭据本身有问题（或已触发锁定），重试同一串密码没有意义，
 * 继续提交还会加重锁定，所以直接把输入框清掉，逼用户先确认密码。
 * 网络类失败（断网、域名没配、会话丢失）保留输入，别让人为一次断网重敲密码。
 */
const CREDENTIAL_ERRORS = [
  'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED', 'ACCOUNT_DISABLED', 'NEED_CAPTCHA', 'LOGIN_BOUNCED'
];


Page({
  data: {
    address: DEFAULT_ADDRESS,
    showAdvanced: false,
    username: '',
    password: '',
    showPassword: false,
    yearOptions: [],
    yearIndex: 1,
    semesterIndex: 0,
    semesterLabels: SEMESTER_LABELS,
    termLabel: '',
    loading: false,
    loadingText: '',
    error: '',
    errorKind: '',
    preview: null,
    previewTotal: 0,
    previewMore: 0,
    saving: false,
    // 失败时的分步诊断信息，直接展开就能看到卡在哪一步
    diagnostics: [],
    showDiagnostics: false
  },

  onLoad() {
    const term = currentTerm();
    // 学年可选前后各一年：补导上一学年、或开学前先导下一学年都走得通
    const base = Number(term.xnm);
    this.baseYear = base;
    this.setData({
      yearOptions: [base - 1, base, base + 1].map((year) => `${year}-${year + 1} 学年`),
      yearIndex: 1,
      semesterIndex: term.semester - 1,
      termLabel: this.termText(base, term.semester)
    });
  },

  termText(xnm, semester) {
    const year = Number(xnm);
    const semesterText = Number(semester) === 3 ? '小学期' : `第 ${semester} 学期`;
    return `${year}-${year + 1} 学年${semesterText}`;
  },

  /** 当前选中的学年起始年，教务接口要的是 2026 这种四位年，不是区间 */
  selectedXnm() {
    return String(this.baseYear - 1 + Number(this.data.yearIndex));
  },

  changeYear(event) {
    const yearIndex = Number(event.detail.value);
    this.setData({
      yearIndex,
      termLabel: this.termText(this.baseYear - 1 + yearIndex, this.data.semesterIndex + 1),
      error: ''
    });
  },

  updateUsername(event) {
    this.setData({ username: event.detail.value, error: '' });
  },

  updatePassword(event) {
    this.setData({ password: event.detail.value, error: '' });
  },

  updateAddress(event) {
    this.setData({ address: event.detail.value, error: '' });
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  toggleAdvanced() {
    this.setData({ showAdvanced: !this.data.showAdvanced });
  },

  toggleDiagnostics() {
    this.setData({ showDiagnostics: !this.data.showDiagnostics });
  },

  changeSemester(event) {
    const index = Number(event.detail.value);
    this.setData({
      semesterIndex: index,
      termLabel: this.termText(this.selectedXnm(), index + 1),
      error: ''
    });
  },

  async startImport() {
    if (this.data.loading) return;
    const username = String(this.data.username || '').trim();
    const password = String(this.data.password || '');
    if (!username) {
      this.setData({ error: '请填写学号', errorKind: 'VALIDATION_FAILED' });
      return;
    }
    if (!password) {
      this.setData({ error: '请填写密码', errorKind: 'VALIDATION_FAILED' });
      return;
    }

    this.setData({ loading: true, loadingText: '正在登录教务系统…', error: '', errorKind: '', preview: null });
    wx.showLoading({ title: '正在导入…', mask: true });

    let result;
    try {
      result = await importTimetable({
        address: this.data.address,
        username,
        password,
        xnm: this.selectedXnm(),
        semester: this.data.semesterIndex + 1
      });
    } catch (error) {
      result = { ok: false, kind: 'NETWORK_RETRYABLE', error: (error && error.message) || '导入失败' };
    }

    wx.hideLoading();

    if (!result || !result.ok) {
      const errorKind = (result && result.kind) || '';
      const patch = {
        loading: false,
        loadingText: '',
        error: (result && result.error) || '导入没有完成，请稍后重试。',
        errorKind,
        diagnostics: getStepLog(),
        showDiagnostics: false
      };
      if (CREDENTIAL_ERRORS.indexOf(errorKind) >= 0) patch.password = '';
      this.setData(patch);
      return;
    }

    const rows = result.courses || [];
    const settings = loadSettings();
    const totalWeeks = Math.max(Number(settings.totalWeeks) || 18, maxWeekOf(rows));

    const previewItems = rows
      .slice()
      .sort((left, right) => (left.day - right.day) || (left.startPeriod - right.startPeriod))
      .map((row) => ({
        key: `${row.name}-${row.day}-${row.startPeriod}-${row.endPeriod}`,
        name: row.name,
        color: courseColorIndex(row.name),
        meta: `${DAY_NAMES[row.day - 1]} · 第 ${row.startPeriod}–${row.endPeriod} 节 · ${formatWeeks(row.weeks).replace(/周$/, '')}周`,
        room: row.room || '',
        teacher: row.teacher || ''
      }));

    const distinct = new Set(rows.map((row) => row.name)).size;
    this.pendingRows = rows;
    this.pendingTotalWeeks = totalWeeks;

    this.setData({
      loading: false,
      loadingText: '',
      // 密码用到这里就不再需要，立刻从页面数据里清掉
      password: '',
      preview: {
        items: previewItems.slice(0, 60),
        term: (result.term && result.term.label) || '',
        distinct,
        blocks: rows.length,
        totalWeeks
      },
      previewTotal: previewItems.length,
      previewMore: Math.max(0, previewItems.length - 60)
    });
  },

  async replaceAll() {
    if (!this.pendingRows || this.data.saving) return;
    const existing = loadCourses();
    const ok = await confirmReplace({
      title: '替换现有课表？',
      name: '教务导入的课程',
      count: existing.length
    });
    if (!ok) return;
    this.commit(false);
  },

  async appendToExisting() {
    if (!this.pendingRows || this.data.saving) return;
    this.commit(true);
  },

  commit(append) {
    this.setData({ saving: true });
    const rows = this.pendingRows || [];
    const totalWeeks = this.pendingTotalWeeks || 18;
    const imported = toCourses(rows, totalWeeks);

    let courses = imported;
    if (append) {
      const existing = loadCourses();
      const seen = new Set(existing.map((course) => [
        course.name, course.day, course.startPeriod, course.endPeriod
      ].join('|')));
      const fresh = imported.filter((course) => !seen.has([
        course.name, course.day, course.startPeriod, course.endPeriod
      ].join('|')));
      courses = existing.concat(fresh);
    }

    const settings = loadSettings();
    if (totalWeeks > (Number(settings.totalWeeks) || 18)) {
      saveSettings(Object.assign({}, settings, { totalWeeks }));
    }
    saveCourses(courses);

    this.pendingRows = null;
    this.setData({ saving: false, preview: null });
    wx.showModal({
      title: '导入完成',
      content: append
        ? `已把 ${imported.length} 个课程时间段加入课表，当前共 ${courses.length} 个。`
        : `课表已更新为 ${courses.length} 个课程时间段。`,
      showCancel: false,
      success: () => wx.navigateBack()
    });
  },

  cancelPreview() {
    this.pendingRows = null;
    this.setData({ preview: null });
  },

  openManual() {
    wx.navigateTo({ url: '/pages/course/edit' });
  },

  openPdfImport() {
    wx.redirectTo({ url: '/pages/pdfimport/index' });
  }
});
