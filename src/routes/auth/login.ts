import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/login',
    {
      schema: {
        tags: ['Auth'],
        summary: '根据 unionId 登录或自动创建用户',
        body: {
          type: 'object',
          required: ['unionId'],
          properties: {
            unionId: { type: 'string', minLength: 1 }
          }
        },
        response: {
          200: {
            description: '登录成功',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  userId: { type: 'string' },
                  isNewUser: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
    const { unionId } = request.body as { unionId: string };

    if (!unionId) {
      return reply.status(400).send({ error: 'unionId is required' });
    }

    const existing = await prisma.user.findUnique({ where: { unionId } });

    if (existing) {
      return { success: true, message: 'Login successful', data: { userId: existing.id, isNewUser: false } };
    }

    const user = await prisma.user.create({ data: { unionId } });
    return { success: true, message: 'User created', data: { userId: user.id, isNewUser: true } };
    }
  );

  app.get(
    '/users',
    {
      schema: {
        tags: ['Auth'],
        summary: '获取所有用户',
        response: {
          200: {
            description: '成功返回用户列表',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    unionId: { type: 'string' },
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
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          unionId: true,
          createdAt: true
        }
      });

      return reply.send({
        success: true,
        message: 'Users fetched successfully',
        data: users
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Fetch users failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
    }
  );
}
