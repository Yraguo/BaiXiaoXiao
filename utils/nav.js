/**
 * 导入完成后主动刷新课表。
 *
 * 只靠 wx.navigateBack() 触发的 onShow 不够稳：
 *   1. 导入页可能是从 PDF 页 redirectTo 过来的，回退的上一页不一定是课表；
 *   2. 课表可能停在别的周次上，即使数据变了，回去也看不到刚导进来的课。
 *
 * 五个 tab 合并进 pages/main 之后，课表不再是页面而是页面里的组件，
 * 所以这里改成从页面栈里找容器页，再用 selectComponent 拿课表组件。
 */

function refreshTimetable(resetWeek) {
  let pages = [];
  try {
    pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  } catch (error) {
    pages = [];
  }

  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index];
    if (!page || typeof page.selectComponent !== 'function') continue;

    const timetable = page.selectComponent('#tab-timetable');
    if (timetable && typeof timetable.reload === 'function') {
      timetable.reload(resetWeek !== false);
      return true;
    }
  }

  return false;
}

module.exports = { refreshTimetable };
