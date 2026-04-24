import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function modelTypeRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      schema: {
        tags: ['Model Types'],
        summary: '获取所有模型类型',
        response: {
          200: {
            description: '成功返回模型类型列表',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
    try {
      const modelTypes = await prisma.modelType.findMany({
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          createdAt: true
        }
      });

      return reply.send({
        success: true,
        message: 'Model types fetched successfully',
        data: modelTypes
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Fetch model types failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
    }
  );
}
