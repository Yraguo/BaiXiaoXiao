/**
 * 提醒适配层 —— 本次迁移**能力降级最大**的一块，务必先看这段说明
 *
 * 【原实现】src/services/notify.ts（778 行）
 *   Capacitor LocalNotifications 直接往 Android AlarmManager 排精确闹钟：
 *   可以一次排满一整个学期的"上课前 15 分钟"，Doze 下也能准点响；
 *   还用前台服务保活、开机广播恢复、心跳兜底。
 *
 * 【小程序】以上全部没有。微信只给一样东西：**订阅消息**
 *   · 必须由用户**点击**触发，不能自动弹（想在启动时申请会被拒）
 *   · 一次授权 = 一条消息（一次性订阅）；长期订阅只对少数类目开放
 *   · 消息由**服务端**调 subscribeMessage.send 下发，小程序端只能"申请额度"
 *   · 因此"离线准点提醒"这件事在小程序里必须由云函数 + 定时触发器接管
 *
 * 结论：提醒功能不是"移植"，是"重做"。产品上建议改成：
 *   进入小程序时检查今天/明天的课，把「上课提醒」做成用户主动点一次、
 *   当天生效的一次性订阅；长周期提醒引导用户用「添加到手机日历」。
 */

/** 模板 ID：在小程序后台「订阅消息」里建好模板后填这里 */
export const TMPL = {
  /** 上课提醒：课程名 + 时间 + 地点 */
  classSoon: 'REPLACE_WITH_TEMPLATE_ID_1',
  /** 待办到期提醒 */
  todoDue: 'REPLACE_WITH_TEMPLATE_ID_2'
};

export interface SubscribeResult {
  /** 用户实际同意了几条（微信不支持批量接受，可能逐条弹） */
  accepted: number;
  /** 用户勾了"总是保持以上选择"后不再弹窗 */
  silent: boolean;
  error: string;
}

/**
 * 申请订阅额度。**必须绑在某个点击事件里**，不能在 onLoad 调。
 *
 * 用法：
 *   <button @click="onRemindTap">开启上课提醒</button>
 *   async function onRemindTap() { await requestSubscribe([TMPL.classSoon]); }
 */
export function requestSubscribe(tmplIds: string[], silent = false): Promise<SubscribeResult> {
  return new Promise((resolve) => {
    const usable = tmplIds.filter((id) => id && !id.startsWith('REPLACE_'));
    if (usable.length === 0) {
      resolve({ accepted: 0, silent, error: '还没在后台配置订阅消息模板 ID' });
      return;
    }
    uni.requestSubscribeMessage({
      tmplIds: usable,
      success: (res: any) => {
        const accepted = usable.filter((id) => res[id] === 'accept').length;
        resolve({ accepted, silent, error: '' });
      },
      fail: (err: any) => {
        const msg = err?.errMsg || '订阅失败';
        // 用户勾过"保持以上选择"后微信直接返回 errCode 20004，这不是错误
        const kept = /20004/.test(msg);
        resolve({ accepted: 0, silent: kept, error: kept ? '' : msg });
      }
    });
  });
}

/**
 * 把"排期"从本机搬到服务端。小程序端只负责把计划写进数据库，
 * 由云函数定时扫表 + 下发。这里留的是接口形状，具体实现见 docs/迁移指南。
 */
export interface ReminderPlan {
  /** 触发时间（毫秒时间戳） */
  at: number;
  title: string;
  body: string;
  /** openid：小程序里唯一能定位到人的标识，靠 wx.login → code2Session 换 */
  openid?: string;
  templateId: string;
}

export async function syncPlansToServer(plans: ReminderPlan[]): Promise<{ ok: boolean; error: string }> {
  // TODO: 换成你自己的云函数 / 后端
  // return requestJson({ url: 'https://api.example.com/reminders', method: 'POST', data: { plans } })
  return { ok: false, error: '服务端排期接口未接入（见 adapter 注释）' };
}

/** 获取 openid 的唯一正确姿势：wx.login 拿 code，服务端 code2Session 换 openid */
export function loginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (r) => resolve(r.code),
      fail: (e) => reject(new Error(e?.errMsg || 'wx.login 失败'))
    });
  });
}
