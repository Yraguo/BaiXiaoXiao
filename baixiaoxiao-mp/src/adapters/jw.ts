/**
 * 教务系统对接层 —— 本次迁移的**唯一硬阻塞点**，必须先决策
 *
 * 【原实现在做什么】
 *   src/services/jwwebview.ts 注册了一个原生插件 JwWebView：
 *   用 Android 的 WebView 打开 jwglxt.buct.edu.cn，因为页面**在教务域名下**，
 *   所以：Cookie 天然带上、登录页的 jsbn RSA 加密能直接跑、抓表格 HTML 一抓一个准。
 *   zfimport 模式更进一步：原生侧拼一段 JS 在同源上下文里 fetch 课表接口拿 kbList。
 *
 * 【小程序里这条路 100% 走不通】
 *   · <web-view> 只能打开**已备案且配置为业务域名**的页面
 *   · 它是个**受控的独立容器**，宿主拿不到里面任何 DOM、也读不到 Cookie
 *   · 因此"在教务页面里执行自己的 JS"没有任何可能
 *
 * 【三条可行路线，按推荐度排序】
 *
 *  A. 服务端代理（推荐）—— 登录在服务器做，小程序只拿结构化结果
 *     ① 云函数/自建服务用 node 发请求，自己维护 Cookie 罐（zfClient 的协议逻辑原样搬过去）
 *     ② 读登录页隐藏字段 → 按 mmsfjm 决定是否 RSA 加密 → POST 登录 → 302 跟到 target
 *     ③ 用同一会话请求 kbList 接口 → 解析 → 只把 {课程名, 星期, 节次, 周次, 地点} 回传小程序
 *     ④ 密码**不落库**，登录完立刻丢弃；会话按需续期
 *     优点：小程序端零网络限制；协议逻辑复用你们已有的 zfClient.ts（纯函数，可直接 require）
 *     代价：要一台服务器 / 云函数，且需要处理学校系统可能的反爬与合规问题
 *
 *  B. 用户自助导入（最省事，可先上线）—— 不做自动抓取
 *     让用户在浏览器登录教务 → 导出课表 HTML / ics → 在小程序里"选择文件"上传解析
 *     （wx.chooseMessageFile 选聊天里的文件，或 wx.chooseMedia 拍照识别）
 *     代价：体验差一档，但**零合规风险**，且解析器现成（parser/jwglxtBuct.ts）
 *
 *  C. 混合：小程序只做"查看 + 提醒"，导入跳转到 H5
 *     用 <web-view> 挂一个自建 H5（H5 在你们自己的域名下，可以随便抓）
 *     注意：web-view 与小程序**不能直接通信**，只能靠 postMessage（基础库 2.21+）
 *
 * 下面把三条路都留了接口，选哪条改这里就行。
 */

export type ImportChannel = 'server-proxy' | 'manual-upload' | 'h5-webview';

/** 当前启用哪条 —— 先设成 manual-upload，保证能跑通闭环 */
export const ACTIVE_CHANNEL: ImportChannel = 'manual-upload';

export interface ImportedCourse {
  name: string;
  teacher: string;
  rooms: string;
  day: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
  weeksText: string;
}

export interface ImportResult {
  ok: boolean;
  courses: ImportedCourse[];
  error: string;
  /** 用的哪条通道，便于排查 */
  channel: ImportChannel;
}

/**
 * 路线 A：让服务端去抓。小程序只发学号+密码，拿回课程。
 * ⚠️ 密码只在内存里过一手，不写 storage、不进日志。
 */
export async function importViaServer(username: string, password: string): Promise<ImportResult> {
  // TODO: 换成你的服务端地址（要 HTTPS + 配进 request 合法域名）
  // const r = await requestJson<{ ok: boolean; courses: ImportedCourse[]; error?: string }>({
  //   url: 'https://api.example.com/zf/import',
  //   method: 'POST',
  //   data: { username, password, school: 'buct' }
  // });
  return {
    ok: false,
    courses: [],
    error: '服务端代理未接入：' + (username ? '' : '（还没有输入学号）'),
    channel: 'server-proxy'
  };
}

/**
 * 路线 B：用户自己导出的课表文件。
 * 小程序只能用 wx.chooseMessageFile 从聊天记录里选（不能直接读相册/下载目录），
 * 所以引导话术要写清楚："先把课表文件发到「文件传输助手」，再从聊天记录里选"。
 */
export function pickTimetableFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    // @ts-ignore 小程序专有 API
    if (typeof wx === 'undefined' || typeof wx.chooseMessageFile !== 'function') {
      resolve(null);
      return;
    }
    // @ts-ignore
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['html', 'htm', 'json', 'ics', 'txt'],
      success: (res: any) => {
        const f = res.tempFiles?.[0];
        if (!f) {
          resolve(null);
          return;
        }
        // @ts-ignore
        wx.getFileSystemManager().readFile({
          filePath: f.path,
          encoding: 'utf8',
          success: (r: any) => resolve({ name: f.name || 'timetable', text: r.data }),
          fail: () => resolve(null)
        });
      },
      fail: () => resolve(null)
    });
  });
}
