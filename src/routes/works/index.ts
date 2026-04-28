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

  const workListItem = {
    type: 'object',
    properties: {
      id:          { type: 'integer' },
      userId:      { type: 'string' },
      imageUrl:    { type: 'string' },
      name:        { type: 'string' },
      category:    { type: 'string' },
      partCount:   { type: ['integer', 'null'] },
      tags:        { type: 'array', items: { type: 'string' } },
      isPublic:    { type: 'boolean' },
      joinContest: { type: 'boolean' },
      createdAt:   { type: 'string', format: 'date-time' }
    }
  };

  app.get(
    '/',
    {
      schema: {
        tags: ['Works'],
        summary: '获取作品列表',
        querystring: {
          type: 'object',
          properties: {
            userId:   { type: 'string', description: '按用户 ID 过滤' },
            category: { type: 'string', enum: VALID_CATEGORIES, description: '按分类过滤' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: { type: 'array', items: workListItem }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { userId, category } = request.query as { userId?: string; category?: string };
        const works = await prisma.work.findMany({
          where: {
            ...(userId ? { userId } : {}),
            ...(category ? { category: category as any } : {})
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, userId: true, imageUrl: true, name: true,
            category: true, partCount: true, tags: true,
            isPublic: true, joinContest: true, createdAt: true
          }
        });
        return reply.send({ success: true, message: 'Works fetched successfully', data: works });
      } catch (error: any) {
        return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
      }
    }
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['Works'],
        summary: '获取作品详情',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer', minimum: 1 } }
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
        const { id } = request.params as { id: string };
        const workId = Number(id);
        if (!Number.isInteger(workId) || workId <= 0) {
          return reply.code(400).send({ success: false, message: 'id must be a positive integer', error: 'INVALID_ID' });
        }
        const work = await prisma.work.findUnique({ where: { id: workId } });
        if (!work) {
          return reply.code(404).send({ success: false, message: 'Work not found', error: 'WORK_NOT_FOUND' });
        }
        return reply.send({ success: true, message: 'Work fetched successfully', data: work });
      } catch (error: any) {
        return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
      }
    }
  );
}
