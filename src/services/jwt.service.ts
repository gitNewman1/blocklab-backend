import { createHmac } from 'crypto';
import { config } from '../config';

const BASE64URL_SAFE_RE = /[+/]/g;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(BASE64URL_SAFE_RE, (char) => (char === '+' ? '-' : '_'));
}

export interface JwtPayload {
  userId: string;
  iat: number;
  exp: number;
}

/**
 * 签发 HS256 JWT，携带 userId 与过期时间。
 * 过期时间在签发时即固定写入 exp，后续中间件校验只需比对 exp 与签名。
 */
export function signToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: JwtPayload = {
    userId,
    iat: now,
    exp: now + config.jwt.ttlSeconds
  };

  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', config.jwt.secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(BASE64URL_SAFE_RE, (char) => (char === '+' ? '-' : '_'));

  return `${headerPart}.${payloadPart}.${signature}`;
}
