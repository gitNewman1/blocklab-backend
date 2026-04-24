import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const { unionId } = request.body as { unionId: string };

    if (!unionId) {
      return reply.status(400).send({ error: 'unionId is required' });
    }

    const existing = await prisma.user.findUnique({ where: { unionId } });

    if (existing) {
      return { userId: existing.id, isNewUser: false };
    }

    const user = await prisma.user.create({ data: { unionId } });
    return { userId: user.id, isNewUser: true };
  });

  app.get('/users', async (request, reply) => {
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
  });
}
