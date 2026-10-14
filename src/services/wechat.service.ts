import { config } from '../config';

export interface Code2SessionResult {
  openid: string;
  unionid?: string;
  sessionKey: string;
}

export class WechatError extends Error {
  constructor(
    message: string,
    public readonly errcode?: number
  ) {
    super(message);
    this.name = 'WechatError';
  }
}

interface Code2SessionRawResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 用小程序 wx.login 拿到的 code 换取 openid / session_key。
 * 文档: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
 * 业务成功时返回的 JSON 里没有 errcode 字段，失败时返回 { errcode, errmsg }。
 */
export async function code2Session(code: string): Promise<Code2SessionResult> {
  if (!config.wx.secret) {
    throw new WechatError('WX_SECRET 未配置，请检查服务器环境变量');
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', config.wx.appid);
  url.searchParams.set('secret', config.wx.secret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  let raw: Code2SessionRawResponse;
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(config.wx.timeoutMs)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    raw = (await response.json()) as Code2SessionRawResponse;
  } catch (error: any) {
    throw new WechatError(`微信 code2session 请求失败: ${error.message}`);
  }

  if (raw.errcode) {
    // 常见: 40029 code 无效, 40163 code 已使用, 45011 频率限制, 41002 secret 无效
    throw new WechatError(`微信 code2session 失败(errno:${raw.errcode}): ${raw.errmsg || 'unknown error'}`, raw.errcode);
  }
  if (!raw.openid) {
    throw new WechatError('微信 code2session 响应缺少 openid');
  }

  return {
    openid: raw.openid,
    unionid: raw.unionid,
    sessionKey: raw.session_key || ''
  };
}

// ---- 小程序 access_token 与内容安全 msgSecCheck ----

let accessTokenCache: { token: string; expiresAt: number } | null = null;

/** 获取小程序全局 access_token（带缓存，提前 60s 过期） */
export async function getAccessToken(): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now()) {
    return accessTokenCache.token;
  }
  if (!config.wx.appid || !config.wx.secret) {
    throw new WechatError('WX_APPID / WX_SECRET 未配置，请检查服务器环境变量');
  }
  const url =
    'https://api.weixin.qq.com/cgi-bin/token' +
    `?grant_type=client_credential&appid=${encodeURIComponent(config.wx.appid)}` +
    `&secret=${encodeURIComponent(config.wx.secret)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(config.wx.timeoutMs) });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!data.access_token) {
    throw new WechatError(`获取 access_token 失败：${data.errmsg ?? 'unknown'} (errcode ${data.errcode ?? '-'})`, data.errcode);
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
      signal: AbortSignal.timeout(config.wx.timeoutMs)
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
