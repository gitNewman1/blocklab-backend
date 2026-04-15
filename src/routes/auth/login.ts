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
}
