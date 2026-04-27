import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VALID_CATEGORIES = ['TECHNOLOGY', 'VEHICLE', 'FOOD', 'ANIMAL', 'ARCHITECTURE', 'OTHER'];

export async function workRoutes(app: FastifyInstance) {
  app.post(
    '/',
    {
      schema: {
        tags: ['Works'],
        summary: '发布作品',
        body: {
          type: 'object',
          required: ['userId', 'imageUrl', 'name', 'description'],
          properties: {
            userId:      { type: 'string' },
            imageUrl:    { type: 'string' },
            name:        { type: 'string', maxLength: 100 },
            category:    { type: 'string', enum: VALID_CATEGORIES, default: 'OTHER' },
            partCount:   { type: 'integer', minimum: 0 },
            description: { type: 'string' },
            tags:        { type: 'array', items: { type: 'string' }, default: [] },
            generate3d:  { type: 'boolean', default: false },
            isPublic:    { type: 'boolean', default: true },
            joinContest: { type: 'boolean', default: false }
          }
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  id:          { type: 'integer' },
                  userId:      { type: 'string' },
                  imageUrl:    { type: 'string' },
                  name:        { type: 'string' },
                  category:    { type: 'string' },
                  partCount:   { type: ['integer', 'null'] },
                  description: { type: 'string' },
                  tags:        { type: 'array', items: { type: 'string' } },
                  generate3d:  { type: 'boolean' },
                  isPublic:    { type: 'boolean' },
                  joinContest: { type: 'boolean' },
                  createdAt:   { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const body = request.body as {
          userId: string;
          imageUrl: string;
          name: string;
          category?: string;
          partCount?: number;
          description: string;
          tags?: string[];
          generate3d?: boolean;
          isPublic?: boolean;
          joinContest?: boolean;
        };

        const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
        if (!user) {
          return reply.code(400).send({ success: false, message: 'User not found', error: 'INVALID_USER_ID' });
        }

        const work = await prisma.work.create({
          data: {
            userId:      body.userId,
            imageUrl:    body.imageUrl,
            name:        body.name,
            category:    (body.category as any) ?? 'OTHER',
            partCount:   body.partCount ?? null,
            description: body.description,
            tags:        body.tags ?? [],
            generate3d:  body.generate3d ?? false,
            isPublic:    body.isPublic ?? true,
            joinContest: body.joinContest ?? false
          }
        });

        return reply.code(201).send({ success: true, message: 'Work published successfully', data: work });
      } catch (error: any) {
        request.log.error({ error: error.message }, 'Publish work failed');
        return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
      }
    }
  );
}
