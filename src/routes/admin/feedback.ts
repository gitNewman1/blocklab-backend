import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function adminFeedbackRoutes(app: FastifyInstance) {
  // 反馈列表（管理后台查看，按时间倒序）
  app.get('/', {
    schema: {
      tags: ['Admin Feedback'], summary: '意见反馈列表',
      querystring: {
        type: 'object',
        properties: {
          page:  { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
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
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      title: { type: 'string' },
                      content: { type: 'string' },
                      images: { type: 'array', items: { type: 'string' } },
                      userId: { type: ['string', 'null'] },
                      userName: { type: ['string', 'null'] },
                      createdAt: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { page, limit } = request.query as { page?: number; limit?: number };
      const p = page && page > 0 ? page : 1;
      const l = limit && limit > 0 ? Math.min(limit, 100) : 20;

      const [total, rows] = await Promise.all([
        prisma.feedback.count(),
        prisma.feedback.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (p - 1) * l,
          take: l,
          include: { user: { select: { nickname: true, unionId: true } } }
        })
      ]);

      return reply.send({
        success: true,
        message: 'Feedback list fetched successfully',
        data: {
          total, page: p, limit: l,
          items: rows.map(f => ({
            id: f.id,
            title: f.title,
            content: f.content,
            images: f.images,
            userId: f.userId,
            userName: f.user ? (f.user.nickname ?? `积木${f.user.unionId.slice(0, 6)}`) : null,
            createdAt: f.createdAt.toISOString()
          }))
        }
      });
    } catch (error: any) {
      request.log.error({ error: error.message }, 'Fetch feedback list failed');
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}
