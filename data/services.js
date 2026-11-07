/**
 * 校园服务入口清单。
 * 校园页和小鸮都用这一份，避免两边各写一遍后慢慢对不上。
 */
const SERVICES = [
  { key: 'online', icon: '/assets/icons/online.png', name: '北化在线', desc: '在线课程与作业', url: 'https://online.buct.edu.cn/' },
  { key: 'jw', icon: '/assets/icons/jw.png', name: '教务系统', desc: '课表 · 成绩 · 选课', url: 'https://jwglxt.buct.edu.cn/' },
  { key: 'exam', icon: '/assets/icons/exam.png', name: '考试查询', desc: '考试安排与记事提醒', url: '' },
  { key: 'health', icon: '/assets/icons/health.png', name: '健康云', desc: '体质测试与健康数据', url: '' },
  { key: 'library', icon: '/assets/icons/library.png', name: '图书馆', desc: '馆藏检索与数据库', url: 'https://lib.buct.edu.cn/' },
  { key: 'resource', icon: '/assets/icons/resource.png', name: '电子资源', desc: '统一身份认证入口', url: '' },
  { key: 'portal', icon: '/assets/icons/portal.png', name: '信息门户', desc: '校园信息服务', url: '' },
  { key: 'school', icon: '/assets/icons/school.png', name: '学校主页', desc: '通知公告与数字校园', url: 'https://www.buct.edu.cn/' },
  { key: 'network', icon: '/assets/icons/network.png', name: '校园网平台', desc: '网络认证与校园网服务', url: '' }
];

module.exports = { SERVICES };
