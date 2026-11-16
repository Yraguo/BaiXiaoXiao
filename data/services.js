/**
 * 校园服务入口清单。
 * 校园页和小鸮都用这一份，避免两边各写一遍后慢慢对不上。
 */
const SERVICES = [
  { key: 'online', icon: '/assets/icons/online.png', name: '北化在线', desc: '在线课程与作业', url: 'https://online.buct.edu.cn/' },
  { key: 'jw', icon: '/assets/icons/jw.png', name: '教务系统', desc: '课表 · 成绩 · 选课', url: 'https://jwglxt.buct.edu.cn/' },
  { key: 'exam', icon: '/assets/icons/exam.png', name: '考试查询', desc: '用教务账号查考试安排', url: '', path: '/pages/exam/index' },
  // 健康云 = 体育教学管理系统，查体测成绩、申请免测；需校园网 + 统一身份认证账号
  { key: 'health', icon: '/assets/icons/health.png', name: '健康云', desc: '体测成绩与免测申请', url: 'http://tygl.buct.edu.cn' },
  { key: 'library', icon: '/assets/icons/library.png', name: '图书馆', desc: '馆藏检索与数据库', url: 'https://lib.buct.edu.cn/' },
  // 统一身份认证：一套账号全校漫游，校内环境访问
  { key: 'resource', icon: '/assets/icons/resource.png', name: '统一认证', desc: '一套账号登录校内各系统', url: 'https://i.buct.edu.cn' },
  { key: 'portal', icon: '/assets/icons/portal.png', name: '信息门户', desc: '数字校园综合服务', url: 'https://portal.buct.edu.cn/' },
  { key: 'school', icon: '/assets/icons/school.png', name: '学校主页', desc: '通知公告与数字校园', url: 'https://www.buct.edu.cn/' },
  // 校园网自助服务：查在线设备、充值、改密码
  { key: 'network', icon: '/assets/icons/network.png', name: '校园网自助', desc: '在线设备 · 充值 · 改密', url: 'https://tree.buct.edu.cn' }
];

module.exports = { SERVICES };
