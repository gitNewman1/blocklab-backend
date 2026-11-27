import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * 管理端：全部注册用户列表（供 admin 页「用户管理」展示）。
 * 与其余 admin 路由一致，依赖网络层/内网访问控制防护。
 */
export async function adminUserRoutes(app: FastifyInstance) {
  app.get('/', {
    schema: {
      tags: ['Admin Data'],
      summary: '获取全部用户（含登录平台/手机号）',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  userId:    { type: 'string' },
                  unionId:   { type: 'string' },
                  nickname:  { type: ['string', 'null'] },
                  avatarUrl: { type: ['string', 'null'] },
                  phone:     { type: ['string', 'null'] },
                  platform:  { type: 'string', description: 'huawei=华为账号 / wechat=微信小程序' },
                  createdAt: { type: 'string', format: 'date-time' },
                  workCount: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    }
  }, async (_request, reply) => {
    try {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, unionId: true, nickname: true, avatarUrl: true,
          phone: true, platform: true, createdAt: true,
          _count: { select: { works: true } }
        }
      });
      return reply.send({
        success: true,
        data: users.map(({ _count, id, ...rest }) => ({ userId: id, ...rest, workCount: _count.works }))
      });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}
