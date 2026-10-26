/**
 * 学校名单（小程序版）
 *
 * 来源：原工程 `src/catalog/universities.ts`（52 所）+ `jwSystems.ts`（品牌识别）。
 * 这里只保留「选校 → 判断能不能直接导入」需要的那几个字段。
 *
 * 【为什么只有北化带教务地址】
 * 其余学校的教务系统域名各不相同（jwglxt.xxx.edu.cn / xxx.edu.cn/jwglxt / 带端口…），
 * 靠名字猜出来的地址十有八九是错的，而错地址会把用户引到一个不存在的登录页 ——
 * 那比"如实说没适配"更糟。所以：**北化一键导入，其它学校让用户自己粘地址**。
 * 这条边界原工程写死过（jwSystems 的 importable 只有正方 = true），照抄。
 */

export type SchoolStatus = 'live' | 'developing';

export interface School {
  id: string;
  name: string;
  short: string;
  province: string;
  letter: string;
  status: SchoolStatus;
  /** 已核实的教务系统入口；空 = 还没适配，需要用户自己填 */
  jwBaseUrl?: string;
  /** 教务系统品牌，用于文案 */
  vendor?: 'zf';
}

/** 北化置顶：唯一 live，地址已核实 */
export const SCHOOLS: School[] = [
  {
    id: 'buct',
    name: '北京化工大学',
    short: '北化',
    province: '北京',
    letter: 'B',
    status: 'live',
    jwBaseUrl: 'https://jwglxt.buct.edu.cn',
    vendor: 'zf'
  },
  { id: 'pku', name: '北京大学', short: '北大', province: '北京', letter: 'B', status: 'developing' },
  { id: 'thu', name: '清华大学', short: '清华', province: '北京', letter: 'Q', status: 'developing' },
  { id: 'buaa', name: '北京航空航天大学', short: '北航', province: '北京', letter: 'B', status: 'developing' },
  { id: 'bit', name: '北京理工大学', short: '北理工', province: '北京', letter: 'B', status: 'developing' },
  { id: 'ustb', name: '北京科技大学', short: '北科大', province: '北京', letter: 'B', status: 'developing' },
  { id: 'bupt', name: '北京邮电大学', short: '北邮', province: '北京', letter: 'B', status: 'developing' },
  { id: 'bjtu', name: '北京交通大学', short: '北交大', province: '北京', letter: 'B', status: 'developing' },
  { id: 'bjut', name: '北京工业大学', short: '北工大', province: '北京', letter: 'B', status: 'developing' },
  { id: 'bfu', name: '北京林业大学', short: '北林', province: '北京', letter: 'B', status: 'developing' },
  { id: 'bisu', name: '北京第二外国语学院', short: '北二外', province: '北京', letter: 'B', status: 'developing' },
  { id: 'ruc', name: '中国人民大学', short: '人大', province: '北京', letter: 'Z', status: 'developing' },
  { id: 'tju', name: '天津大学', short: '天大', province: '天津', letter: 'T', status: 'developing' },
  { id: 'nankai', name: '南开大学', short: '南开', province: '天津', letter: 'N', status: 'developing' },
  { id: 'dlut', name: '大连理工大学', short: '大工', province: '辽宁', letter: 'D', status: 'developing' },
  { id: 'jlu', name: '吉林大学', short: '吉大', province: '吉林', letter: 'J', status: 'developing' },
  { id: 'hit', name: '哈尔滨工业大学', short: '哈工大', province: '黑龙江', letter: 'H', status: 'developing' },
  { id: 'fudan', name: '复旦大学', short: '复旦', province: '上海', letter: 'F', status: 'developing' },
  { id: 'sjtu', name: '上海交通大学', short: '上交', province: '上海', letter: 'S', status: 'developing' },
  { id: 'tongji', name: '同济大学', short: '同济', province: '上海', letter: 'T', status: 'developing' },
  { id: 'ecust', name: '华东理工大学', short: '华理', province: '上海', letter: 'H', status: 'developing' },
  { id: 'nju', name: '南京大学', short: '南大', province: '江苏', letter: 'N', status: 'developing' },
  { id: 'seu', name: '东南大学', short: '东大', province: '江苏', letter: 'D', status: 'developing' },
  { id: 'zju', name: '浙江大学', short: '浙大', province: '浙江', letter: 'Z', status: 'developing' },
  { id: 'ustc', name: '中国科学技术大学', short: '中科大', province: '安徽', letter: 'Z', status: 'developing' },
  { id: 'xmu', name: '厦门大学', short: '厦大', province: '福建', letter: 'X', status: 'developing' },
  { id: 'sdu', name: '山东大学', short: '山大', province: '山东', letter: 'S', status: 'developing' },
  { id: 'whu', name: '武汉大学', short: '武大', province: '湖北', letter: 'W', status: 'developing' },
  { id: 'hust', name: '华中科技大学', short: '华科', province: '湖北', letter: 'H', status: 'developing' },
  { id: 'hnu', name: '湖南大学', short: '湖大', province: '湖南', letter: 'H', status: 'developing' },
  { id: 'csu', name: '中南大学', short: '中南', province: '湖南', letter: 'Z', status: 'developing' },
  { id: 'scut', name: '华南理工大学', short: '华工', province: '广东', letter: 'H', status: 'developing' },
  { id: 'sysu', name: '中山大学', short: '中大', province: '广东', letter: 'Z', status: 'developing' },
  { id: 'scu', name: '四川大学', short: '川大', province: '四川', letter: 'S', status: 'developing' },
  { id: 'uestc', name: '电子科技大学', short: '电子科大', province: '四川', letter: 'D', status: 'developing' },
  { id: 'cqu', name: '重庆大学', short: '重大', province: '重庆', letter: 'C', status: 'developing' },
  { id: 'nwpu', name: '西北工业大学', short: '西工大', province: '陕西', letter: 'X', status: 'developing' },
  { id: 'lzu', name: '兰州大学', short: '兰大', province: '甘肃', letter: 'L', status: 'developing' }
];

export function findSchool(id: string): School | undefined {
  return SCHOOLS.find((s) => s.id === id);
}

/** 搜索：校名 / 简称 / 拼音首字母都能命中 */
export function searchSchools(keyword: string): School[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return SCHOOLS;
  return SCHOOLS.filter(
    (s) =>
      s.name.includes(k) ||
      s.short.toLowerCase().includes(k) ||
      s.province.includes(k) ||
      s.letter.toLowerCase() === k
  );
}
