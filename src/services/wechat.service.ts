import { config } from '../config';

export interface WechatSession {
  openid: string;
  /** 小程序绑定了微信开放平台账号时才返回 */
  unionid?: string;
  /** 仅服务端留存，绝不下发前端 */
  sessionKey: string;
}

/**
 * 微信小程序登录：用 wx.login() 的 code 换取 openid/session_key
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
 */
export async function code2Session(code: string): Promise<WechatSession> {
  if (!config.wechat.appId || !config.wechat.secret) {
    throw new Error('服务端未配置 WX_APPID / WX_SECRET');
  }
  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${encodeURIComponent(config.wechat.appId)}` +
    `&secret=${encodeURIComponent(config.wechat.secret)}` +
    `&js_code=${encodeURIComponent(code)}` +
    '&grant_type=authorization_code';

  const res = await fetch(url, { signal: AbortSignal.timeout(config.wechat.timeoutMs) });
  const data = (await res.json()) as { errcode?: number; errmsg?: string; openid?: string; unionid?: string; session_key?: string };

  if (data.errcode) {
    throw new Error(`微信登录失败：${data.errmsg ?? 'unknown'} (errcode ${data.errcode})`);
  }
  if (!data.openid) {
    throw new Error('微信登录失败：未返回 openid');
  }
  return { openid: data.openid, unionid: data.unionid, sessionKey: data.session_key ?? '' };
}

// ---- 小程序 access_token 与内容安全 msgSecCheck ----

let accessTokenCache: { token: string; expiresAt: number } | null = null;

/** 获取小程序全局 access_token（带缓存，提前 60s 过期） */
export async function getAccessToken(): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now()) {
    return accessTokenCache.token;
  }
  if (!config.wechat.appId || !config.wechat.secret) {
    throw new Error('服务端未配置 WX_APPID / WX_SECRET');
  }
  const url =
    'https://api.weixin.qq.com/cgi-bin/token' +
    `?grant_type=client_credential&appid=${encodeURIComponent(config.wechat.appId)}` +
    `&secret=${encodeURIComponent(config.wechat.secret)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(config.wechat.timeoutMs) });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!data.access_token) {
    throw new Error(`获取 access_token 失败：${data.errmsg ?? 'unknown'} (errcode ${data.errcode ?? '-'})`);
  }
  accessTokenCache = { token: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 7200) - 60) * 1000 };
  return accessTokenCache.token;
}

export interface TextCheckResult {
  /** pass 通过 / risky 违规(命中微信风险标签) / error 接口异常(由调用方决定放行策略) */
  result: 'pass' | 'risky' | 'error';
  /** 命中的风险标签或错误信息 */
  detail?: string;
}

/**
 * 微信文本内容安全检测（msg_sec_check v2）。
 * openid 可选：有 openid 时检测更准确；接口异常时按 error 返回，由调用方决定放行策略。
 */
export async function msgSecCheck(text: string, openid?: string): Promise<TextCheckResult> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2, openid: openid ?? '', scene: 2, content: text }),
      signal: AbortSignal.timeout(config.wechat.timeoutMs)
    });
    const data = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      result?: { suggest: string; label: number };
      detail?: Array<{ strategy: string; errcode: number; suggest: string; label: number; prob: number }>;
    };
    if (data.errcode && data.errcode !== 0) {
      return { result: 'error', detail: `msg_sec_check errcode ${data.errcode}: ${data.errmsg}` };
    }
    const suggest = data.result?.suggest ?? 'pass';
    if (suggest === 'pass') return { result: 'pass' };
    return { result: 'risky', detail: `suggest=${suggest}, label=${data.result?.label ?? '-'}` };
  } catch (error: any) {
    return { result: 'error', detail: error.message };
  }
}
