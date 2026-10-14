import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config';

/** 挂载到 request 上的已认证用户信息（由 JWT 解出，前端不可信输入） */
export interface AuthUser {
  userId: string;
  openid?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export interface JwtPayload {
  userId: string;
  openid?: string;
  iat?: number;
  exp?: number;
}

/** 签发登录 token（expiresIn 用 JWT_TTL_DAYS 换算的 ttlSeconds 控制） */
export function signToken(payload: { userId: string; openid?: string | null }): string {
  return jwt.sign(
    { userId: payload.userId, ...(payload.openid ? { openid: payload.openid } : {}) },
    config.jwt.secret,
    { expiresIn: config.jwt.ttlSeconds }
  );
}

/** 解析并校验 token，失败返回 null（不抛异常） */
export function parseToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (typeof decoded === 'string' || typeof decoded.userId !== 'string') return null;
    return decoded as JwtPayload;
  } catch {
    return null;
  }
}

function extractBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || !/^bearer$/i.test(scheme ?? '')) return null;
  return token;
}

function unauthorized(reply: FastifyReply, message: string, error: string): void {
  reply.code(401).send({ success: false, message, error });
}

/**
 * 必选鉴权 preHandler：无 token / token 非法一律 401。
 * 用法：app.get('/x', { preHandler: requireAuth }, handler)
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) return unauthorized(reply, '未登录或登录已过期，请先登录', 'UNAUTHORIZED');
  const payload = parseToken(token);
  if (!payload) return unauthorized(reply, 'token 无效，请重新登录', 'INVALID_TOKEN');
  req.user = payload;
}

/**
 * 可选鉴权 preHandler：带合法 token 则解析出 user，否则按匿名放行。
 * 用于公开浏览接口（作品列表/详情），登录后能顺带返回"是否已点赞"。
 * 注意必须是 async 函数：Fastify 对非 async 的 (req, reply) 钩子按回调风格处理，
 * 等待 done() 被调用——同步 return 会导致请求永久挂起。
 */
export async function optionalAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) return;
  const payload = parseToken(token);
  if (payload) req.user = payload;
}
