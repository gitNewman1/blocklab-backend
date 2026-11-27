import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../../plugins/auth';

const prisma = new PrismaClient();

/**
 * 头像 URL 格式校验：客户端（华为/微信）传回的 avatarUrl 已是云桶永久 URL，
 * 服务端只做格式校验后落库，不再下载转存，故无 SSRF 面。
 * 仅校验是否为合法的 http/https 绝对链接，拒绝 data:/javascript: 等危险 scheme。
 */
function validateAvatarUrl(avatarUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(avatarUrl);
  } catch {
    return 'avatarUrl 不是合法 URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'avatarUrl 仅支持 http/https 链接';
  }
  return null;
}

export async function userRoutes(app: FastifyInstance) {
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
                phone:        { type: ['string', 'null'] },
                platform:     { type: 'string' },
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
          id: true, unionId: true, nickname: true, avatarUrl: true, phone: true, platform: true, scanCount: true,
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

  // 更新个人资料（昵称/头像/手机号）。身份从 token 取。
  // avatarUrl 由客户端传回云桶永久 URL，服务端仅格式校验后落库，不下载、不转存。
  app.post('/profile', {
    preHandler: requireAuth,
    schema: {
      tags: ['Users'],
      summary: '更新个人资料（昵称/头像/手机号；头像为云桶永久 URL，仅格式校验后落库）',
      body: {
        type: 'object',
        properties: {
          nickname: { type: 'string', maxLength: 100, description: '昵称（华为 displayName / 微信 nickName），可选' },
          avatarUrl: { type: 'string', description: '头像永久 URL（客户端从云桶取回，服务端仅格式校验后落库），可选' },
          phone: { type: 'string', maxLength: 20, description: '手机号（华为手机号凭证 / 微信 getPhoneNumber），可选' }
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
                avatarUrl: { type: ['string', 'null'] },
                phone:     { type: ['string', 'null'] }
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
      const body = (request.body ?? {}) as { nickname?: string; avatarUrl?: string; phone?: string };
      const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
      const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : '';
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

      if (!nickname && !avatarUrl && !phone) {
        return reply.code(400).send({ success: false, message: '请提供 nickname / avatarUrl / phone 至少一项', error: 'BAD_REQUEST' });
      }
      if (phone && !/^\+?[0-9][0-9\s-]{4,19}$/.test(phone)) {
        return reply.code(400).send({ success: false, message: 'phone 格式不合法', error: 'INVALID_PHONE' });
      }
      if (avatarUrl) {
        const avatarErr = validateAvatarUrl(avatarUrl);
        if (avatarErr) {
          return reply.code(400).send({ success: false, message: avatarErr, error: 'INVALID_AVATAR_URL' });
        }
      }

      const data: { nickname?: string; avatarUrl?: string; phone?: string } = {};
      if (nickname) data.nickname = nickname;
      if (phone) data.phone = phone;
      if (avatarUrl) data.avatarUrl = avatarUrl;

      const user = await prisma.user.update({
        where: { id: request.user!.userId },
        data,
        select: { id: true, unionId: true, nickname: true, avatarUrl: true, phone: true }
      });
      request.log.info({ userId: user.id, hasAvatar: !!data.avatarUrl }, 'user profile updated');
      return reply.send({
        success: true,
        message: 'Profile updated',
        data: { userId: user.id, unionId: user.unionId, nickname: user.nickname, avatarUrl: user.avatarUrl, phone: user.phone }
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'user profile update failed');
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}
