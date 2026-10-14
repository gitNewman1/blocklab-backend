import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { optionalAuth } from '../../plugins/auth';

const prisma = new PrismaClient();

export async function feedbackRoutes(app: FastifyInstance) {
  // 提交意见反馈（匿名可提交；带 token 则关联用户）
  app.post('/', {
    preHandler: optionalAuth,
    schema: {
      tags: ['Feedback'], summary: '提交意见反馈（无需登录）',
      body: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title:   { type: 'string', minLength: 1, maxLength: 100 },
          content: { type: 'string', minLength: 1, maxLength: 2000 },
          images:  { type: 'array', items: { type: 'string' }, maxItems: 9, default: [], description: '截图 URL，选填，最多 9 张' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { title, content, images } = request.body as { title: string; content: string; images?: string[] };
      const feedback = await prisma.feedback.create({
        data: {
          title,
          content,
          images: images ?? [],
          userId: request.user?.userId ?? null
        }
      });
      return reply.code(201).send({ success: true, message: 'Feedback submitted', data: { id: feedback.id } });
    } catch (error: any) {
      request.log.error({ error: error.message }, 'Submit feedback failed');
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}
