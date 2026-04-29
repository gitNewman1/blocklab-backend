import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function userRoutes(app: FastifyInstance) {
  app.get('/:userId/profile', {
    schema: {
      tags: ['Users'],
      summary: '获取个人信息',
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
      const { userId } = request.params as { userId: string };
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, unionId: true, nickname: true, scanCount: true,
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
}
