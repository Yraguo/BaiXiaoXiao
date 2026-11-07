function confirmDelete({ title, name, count = 1, recoverable = false }) {
  const recovery = recoverable ? '可从备份恢复。' : '删除后无法恢复。';
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content: `将删除“${name}”，影响 ${count} 条数据。${recovery}`,
      confirmText: '删除',
      confirmColor: '#ff3b30',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    });
  });
}

/**
 * 替换确认。
 * keepSettings 必须按调用方的真实行为传：导入只替换课程、学期设置保留；
 * 恢复示例课表会连设置一起重置。文案说错了比不说更糟。
 */
function confirmReplace({ title, name, count = 1, keepSettings = true }) {
  const scope = keepSettings ? `条课程（学期设置保留）` : '条课程及课表设置';
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content: `将用“${name}”替换现有 ${count} ${scope}，操作无法恢复。`,
      confirmText: '继续',
      confirmColor: '#ff3b30',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    });
  });
}

module.exports = { confirmDelete, confirmReplace };
