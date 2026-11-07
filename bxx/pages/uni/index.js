const { loadHistory, loadNotes, saveHistory } = require('../../utils/appStore');
const { confirmDelete } = require('../../utils/confirm');
const { loadCourses, loadSettings } = require('../../utils/storage');
const { answer } = require('../../utils/uni');

const SUGGESTIONS = ['我这周几节课', '下节课在哪上', '今天有什么待办'];

Page({
  data: {
    text: '',
    messages: [],
    historyOpen: false,
    keyboardHint: '',
    suggestions: SUGGESTIONS,
    scrollTop: 0
  },

  onShow() {
    const messages = loadHistory();
    this.setData({ messages, scrollTop: messages.length ? this.bottomScrollTop(messages.length) : 0 });
  },

  // 内容长度不可预知，用一个远超内容高度的值把视图顶到底部
  bottomScrollTop(count) {
    return 100000 + count * 10;
  },

  // 每次提问都现读一遍：用户可能刚在课表页改过课程，不能缓存
  buildContext() {
    return {
      now: new Date(),
      settings: loadSettings(),
      courses: loadCourses(),
      notes: loadNotes()
    };
  },

  updateText(event) {
    this.setData({ text: event.detail.value, keyboardHint: '' });
  },

  send() {
    this.submit(this.data.text);
  },

  useSuggestion(event) {
    this.submit(event.currentTarget.dataset.text);
  },

  submit(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    const now = Date.now();
    const messages = this.data.messages.concat(
      { id: `u-${now}`, role: 'user', text, at: now },
      { id: `a-${now}`, role: 'assistant', text: answer(text, this.buildContext()), at: now + 1 }
    );
    saveHistory(messages);
    this.setData({
      messages,
      text: '',
      keyboardHint: '',
      scrollTop: this.bottomScrollTop(messages.length)
    });
  },

  openKeyboardVoice() {
    this.setData({ keyboardHint: '已打开系统键盘，点键盘上的麦克风即可语音输入。' });
  },

  showHistory() { this.setData({ historyOpen: true }); },
  hideHistory() { this.setData({ historyOpen: false }); },
  noop() {},

  async clearHistory() {
    const count = this.data.messages.length;
    const confirmed = await confirmDelete({ title: '清空对话历史？', name: '小鸮对话历史', count, recoverable: false });
    if (!confirmed) return;
    saveHistory([]);
    this.setData({ messages: [], historyOpen: false });
  }
});
