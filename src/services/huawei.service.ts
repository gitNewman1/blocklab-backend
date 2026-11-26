import { importJWK, jwtVerify, type JWK } from 'jose';
import { config } from '../config';

export class HuaweiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HuaweiError';
  }
}

// 华为 AppGallery Connect ID Token 公钥（JWKS）端点。
// 公钥每天 0 点轮换，端点返回「当天 + 前一天」两把；服务端缓存，
// 按 kid 未命中时强制刷新一次，避免跨天轮换后登录失败。
const JWKS_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/certs';
const JWKS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 10000;

// ID Token 的 issuer（已由客户端真实 token 确认）
const ID_TOKEN_ISSUER = 'https://accounts.huawei.com';

export interface HuaweiIdTokenPayload {
  /** UnionID：同一开发者账号下用户的全局唯一标识（与 users 表 unionId 对齐） */
  sub: string;
  /** OpenID：本应用下用户唯一标识 */
  openid?: string;
  iss?: string;
  aud?: string | string[];
  nonce?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

interface JwksCache {
  fetchedAt: number;
  keys: JWK[];
}
let jwksCache: JwksCache | null = null;

async function fetchJwks(): Promise<JWK[]> {
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new HuaweiError(`JWKS 拉取失败: HTTP ${res.status}`);
  const data = (await res.json()) as { keys?: JWK[] };
  if (!Array.isArray(data.keys) || data.keys.length === 0) throw new HuaweiError('JWKS 响应缺少 keys');
  jwksCache = { fetchedAt: Date.now(), keys: data.keys };
  return data.keys;
}

async function getJwksCache(): Promise<JwksCache> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) return jwksCache;
  await fetchJwks();
  return jwksCache!;
}

async function findJwkByKid(kid: string): Promise<JWK | undefined> {
  let keys = (await getJwksCache()).keys;
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // 公钥轮换（每天 0 点）后首次出现新 kid：清缓存重拉一次再查
    jwksCache = null;
    keys = (await getJwksCache()).keys;
    jwk = keys.find((k) => k.kid === kid);
  }
  return jwk;
}

/** 解析 JWT 头（仅取 kid/alg，不做任何信任） */
function parseHeader(idToken: string): { kid?: string; alg?: string } {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HuaweiError('ID Token 格式非法（非三段式 JWT）');
  try {
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    throw new HuaweiError('ID Token 头解析失败');
  }
}

/**
 * 本地校验华为 ID Token：
 * 1. 按 token 头 kid 从 JWKS 取公钥。注意：华为 JWKS 的 alg 字段固定标 RS256，
 *    但 token 可能用 PS256 签名（同一把公钥），jose 默认的 alg 过滤选钥会拒掉，
 *    故这里手动按 kid 匹配（与华为官方示例一致）；
 * 2. jwtVerify：按 token 头实际 alg（RS256/PS256）验签 + iss / aud 强校验 + exp 过期校验。
 */
export async function verifyHuaweiIdToken(idToken: string): Promise<HuaweiIdTokenPayload> {
  const { clientId } = config.huawei;
  if (!clientId) {
    throw new HuaweiError('HUAWEI_CLIENT_ID 未配置，请检查服务器环境变量');
  }

  const header = parseHeader(idToken);
  if (header.alg !== 'PS256' && header.alg !== 'RS256') {
    throw new HuaweiError(`不支持的签名算法: ${header.alg ?? 'unknown'}`);
  }
  if (!header.kid) throw new HuaweiError('ID Token 头缺少 kid');

  const jwk = await findJwkByKid(header.kid);
  if (!jwk) throw new HuaweiError(`JWKS 中找不到 kid=${header.kid} 对应的公钥`);

  // 按 token 头声明的实际算法导入公钥（华为 PS256/RS256 用同一把密钥对）
  const key = await importJWK(jwk, header.alg);

  let payload: HuaweiIdTokenPayload;
  try {
    ({ payload } = await jwtVerify<HuaweiIdTokenPayload>(idToken, key, {
      algorithms: ['RS256', 'PS256'],
      audience: clientId,
      issuer: ID_TOKEN_ISSUER
    }));
  } catch (error: any) {
    throw new HuaweiError(`华为 ID Token 校验失败: ${error.message}`);
  }

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new HuaweiError('华为 ID Token 缺少 sub (UnionID)');
  }

  return payload;
}
