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
