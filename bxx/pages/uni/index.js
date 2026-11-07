const { loadHistory, loadNotes, saveHistory, saveNotes } = require('../../utils/appStore');
const { confirmDelete } = require('../../utils/confirm');
const { loadCourses, loadSettings } = require('../../utils/storage');
const { ask } = require('../../utils/uni');

const SUGGESTIONS = ['我这周几节课', '高数在哪上', '记一下 周五交实验报告'];

const OWL_DEFAULT = '/assets/owl/owl-think.png';
const OWL_CONFUSED = '/assets/owl/owl-confused.png';

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
    // memory 让"那周三呢""哪门课？→高等数学"这类多轮对话能接上
    const result = ask(text, this.buildContext(), this.memory);
    this.memory = result.memory;

    let reply = result.text;
    if (result.action && !this.applyAction(result.action)) {
      reply = '记事没保存成功，去「记事」页手动加一条吧。';
    }

    const messages = this.data.messages.concat(
      { id: `u-${now}`, role: 'user', text, at: now },
      {
        id: `a-${now}`,
        role: 'assistant',
        text: reply,
        at: now + 1,
        avatar: result.tone === 'confused' ? OWL_CONFUSED : OWL_DEFAULT
      }
    );
    saveHistory(messages);
    this.setData({
      messages,
      text: '',
      keyboardHint: '',
      scrollTop: this.bottomScrollTop(messages.length)
    });
  },

  /**
   * 执行小鸮返回的动作。Agent 只负责"想清楚要做什么"，真正写存储放在页面，
   * 这样 utils 层保持纯函数、可单测，也不会因为一次误判就默默改数据。
   */
  applyAction(action) {
    if (!action || action.type !== 'createNote' || !action.note) return true;
    try {
      const notes = loadNotes();
      notes.unshift(action.note);
      saveNotes(notes);
      return true;
    } catch (error) {
      return false;
    }
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
