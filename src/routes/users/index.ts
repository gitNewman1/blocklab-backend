import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import dns from 'dns';
import net from 'net';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../../plugins/auth';
import { LocalStorageService } from '../../services/local-storage.service';

const prisma = new PrismaClient();

// 头像下载转存限制（华为 avatarUri 是临时链接，服务端必须下载转存成永久 URL 再入库）
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_FETCH_TIMEOUT_MS = 15000;
const ALLOWED_AVATAR_MIMES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/bmp', '.bmp']
]);

class AvatarFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarFetchError';
  }
}

/** 内网/回环/链路本地等私有地址一律拒绝（防 SSRF 打内网） */
function isPrivateIp(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    return v4 === '' || isPrivateIp(v4);
  }
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return true; // 无法识别的地址一律拒绝
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) {
    throw new AvatarFetchError('avatarUrl 域名不允许');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new AvatarFetchError('avatarUrl 不允许指向内网地址');
    return;
  }
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new AvatarFetchError('avatarUrl 域名解析失败');
  }
  if (addresses.length === 0) throw new AvatarFetchError('avatarUrl 域名解析失败');
  for (const { address } of addresses) {
    if (isPrivateIp(address)) throw new AvatarFetchError('avatarUrl 不允许指向内网地址');
  }
}

/**
 * 下载头像并转存前置校验：仅 https、域名解析后必须全部为公网地址、
 * 重定向目标必须仍为 https（跨域则重新校验）、图片类型白名单、大小上限。
 */
async function downloadAvatar(avatarUrl: string): Promise<{ buffer: Buffer; ext: string; mimetype: string }> {
  let url: URL;
  try {
    url = new URL(avatarUrl);
  } catch {
    throw new AvatarFetchError('avatarUrl 不是合法 URL');
  }
  if (url.protocol !== 'https:') throw new AvatarFetchError('avatarUrl 仅支持 https 链接');
  await assertPublicHost(url.hostname);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS) });
  } catch (error: any) {
    throw new AvatarFetchError(`avatarUrl 下载失败: ${error.message}`);
  }
  if (!res.ok) throw new AvatarFetchError(`avatarUrl 下载失败: HTTP ${res.status}`);

  const finalUrl = new URL(res.url || url.href);
  if (finalUrl.protocol !== 'https:') throw new AvatarFetchError('avatarUrl 重定向目标必须为 https');
  if (finalUrl.hostname !== url.hostname) await assertPublicHost(finalUrl.hostname);

  const mimetype = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = ALLOWED_AVATAR_MIMES.get(mimetype);
  if (!ext) throw new AvatarFetchError(`不支持的头像类型: ${mimetype || 'unknown'}`);

  const body = res.body;
  if (!body) throw new AvatarFetchError('avatarUrl 响应内容为空');

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = Buffer.from(value);
    total += buf.length;
    if (total > AVATAR_MAX_BYTES) {
      await reader.cancel();
      throw new AvatarFetchError(`头像过大（上限 ${AVATAR_MAX_BYTES / 1024 / 1024}MB）`);
    }
    chunks.push(buf);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length === 0) throw new AvatarFetchError('头像内容为空');

  return { buffer, ext, mimetype };
}

export async function userRoutes(app: FastifyInstance) {
  const storageService = new LocalStorageService();

  app.get('/:userId/profile', {
    preHandler: requireAuth,
    schema: {
      tags: ['Users'],
      summary: '获取个人信息（身份从 token 解析）',
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                userId:       { type: 'string' },
                unionId:      { type: 'string' },
                nickname:     { type: ['string', 'null'] },
                avatarUrl:    { type: ['string', 'null'] },
                scanCount:    { type: 'integer' },
                workCount:    { type: 'integer' },
                likeCount:    { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      // 身份从 token 取（requireAuth 已校验）；URL 参数仅为兼容旧客户端保留，不可信
      const userId = request.user!.userId;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, unionId: true, nickname: true, avatarUrl: true, scanCount: true,
          _count: { select: { works: true } }
        }
      });
      if (!user) return reply.code(404).send({ success: false, message: 'User not found', error: 'USER_NOT_FOUND' });

      const likeCount = await prisma.workLike.count({ where: { work: { userId } } });
      const { _count, id, ...rest } = user as any;
      return reply.send({ success: true, data: { userId: id, ...rest, workCount: _count.works, likeCount } });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  // 更新个人资料（昵称/头像）。身份从 token 取。
  // 头像来源（如华为 avatarUri）是临时链接，用户改头像后原链接失效，
  // 故服务端下载转存到本地存储，入库的是永久 URL。
  app.post('/profile', {
    preHandler: requireAuth,
    schema: {
      tags: ['Users'],
      summary: '更新个人资料（昵称/头像；头像服务端下载转存为永久 URL）',
      body: {
        type: 'object',
        properties: {
          nickname: { type: 'string', maxLength: 100, description: '昵称（华为 displayName / 微信 nickName），可选' },
          avatarUrl: { type: 'string', description: '头像链接（华为 avatarUri 为临时链接，服务端下载转存后返回永久 URL），可选' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                userId:    { type: 'string' },
                unionId:   { type: 'string' },
                nickname:  { type: ['string', 'null'] },
                avatarUrl: { type: ['string', 'null'] }
              }
            }
          }
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (request.body ?? {}) as { nickname?: string; avatarUrl?: string };
      const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
      const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : '';

      if (!nickname && !avatarUrl) {
        return reply.code(400).send({ success: false, message: '请提供 nickname 或 avatarUrl', error: 'BAD_REQUEST' });
      }

      const data: { nickname?: string; avatarUrl?: string } = {};
      if (nickname) data.nickname = nickname;

      if (avatarUrl) {
        const { buffer, ext, mimetype } = await downloadAvatar(avatarUrl);
        const savedUrl = await storageService.uploadFile(
          { filename: `avatar${ext}`, mimetype, encoding: 'binary', data: buffer },
          'avatars'
        );
        data.avatarUrl = savedUrl;
      }

      const user = await prisma.user.update({
        where: { id: request.user!.userId },
        data,
        select: { id: true, unionId: true, nickname: true, avatarUrl: true }
      });
      request.log.info({ userId: user.id, hasAvatar: !!data.avatarUrl }, 'user profile updated');
      return reply.send({
        success: true,
        message: 'Profile updated',
        data: { userId: user.id, unionId: user.unionId, nickname: user.nickname, avatarUrl: user.avatarUrl }
      });
    } catch (error: any) {
      if (error instanceof AvatarFetchError) {
        return reply.code(400).send({ success: false, message: error.message, error: 'AVATAR_FETCH_FAILED' });
      }
      request.log.error({ error: error.message, stack: error.stack }, 'user profile update failed');
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}
