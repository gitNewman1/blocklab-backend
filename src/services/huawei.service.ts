import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config';

export class HuaweiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HuaweiError';
  }
}

// 华为 AppGallery Connect ID Token 公钥（JWKS）端点，公钥每天 0 点刷新，
// jose 的 RemoteJWKSet 会缓存并按需轮换，验签在本地完成，不再逐次在线校验。
const JWKS_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/certs';
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

export interface HuaweiIdTokenPayload {
  /** UnionID：同一开发者账号下用户的全局唯一标识（与 users 表 unionId 对齐） */
  sub: string;
  /** OpenID：本应用下用户唯一标识 */
  openid?: string;
  iss?: string;
  aud?: string | string[];
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

/**
 * 本地校验华为 ID Token：JWKS 验签（RS256/PS256）+ aud 必须等于本应用 Client ID。
 * 暂不强制 iss（华为文档对该固定值做了脱敏），先记录真实 iss，确认后再通过
 * jwtVerify 的 issuer 参数收紧。
 */
export async function verifyHuaweiIdToken(idToken: string): Promise<HuaweiIdTokenPayload> {
  const { clientId } = config.huawei;
  if (!clientId) {
    throw new HuaweiError('HUAWEI_CLIENT_ID 未配置，请检查服务器环境变量');
  }

  let payload: HuaweiIdTokenPayload;
  try {
    ({ payload } = await jwtVerify<HuaweiIdTokenPayload>(idToken, JWKS, {
      algorithms: ['RS256', 'PS256'],
      audience: clientId
    }));
  } catch (error: any) {
    throw new HuaweiError(`华为 ID Token 校验失败: ${error.message}`);
  }

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new HuaweiError('华为 ID Token 缺少 sub (UnionID)');
  }

  // TODO(收紧 iss): 确认真实 iss（华为文档脱敏，HMS 体系通常为 https://accounts.huawei.com）
  // 后，把 issuer 加入上方 jwtVerify 的 options 并删除本行日志
  console.log(`[huawei] idToken verified, iss=${payload.iss}, sub=${payload.sub.slice(0, 8)}***`);

  return payload;
}
