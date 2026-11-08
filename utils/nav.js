/**
 * 导入完成后主动刷新课表页。
 *
 * 只靠 wx.navigateBack() 触发的 onShow 不够稳：
 *   1. 导入页可能是从 PDF 页 redirectTo 过来的，回退的上一页不一定是课表；
 *   2. 课表页可能停在别的周次上，即使数据变了，回去也看不到刚导进来的课。
 * 所以直接找到栈里的课表页实例，让它按「当前周」重排一次。
 */

function pageRoute(page) {
  if (!page) return '';
  return page.route || page.__route__ || '';
}

function refreshTimetable(resetWeek) {
  let pages = [];
  try {
    pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  } catch (error) {
    pages = [];
  }
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index];
    if (pageRoute(page) === 'pages/timetable/index' && typeof page.reload === 'function') {
      page.reload(resetWeek !== false);
      return true;
    }
  }
  return false;
}

module.exports = { refreshTimetable };
