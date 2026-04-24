import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function adminModelTypeRoutes(app: FastifyInstance) {
  app.post(
    '/create',
    {
      schema: {
        tags: ['Model Types'],
        summary: 'Create a model type',
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1 }
          }
        },
        response: {
          200: {
            description: 'Model type created successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
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
    },
    async (request, reply) => {
    try {
      const body = (request.body || {}) as { name?: unknown };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return reply.code(400).send({
          success: false,
          message: 'name is required',
          error: 'MISSING_REQUIRED_FIELD'
        });
      }

      const existing = await prisma.modelType.findFirst({
        where: {
          name
        },
        select: {
          id: true,
          name: true
        }
      });
      if (existing) {
        return reply.code(409).send({
          success: false,
          message: 'Model type already exists',
          error: 'DUPLICATE_MODEL_TYPE',
          data: existing
        });
      }

      const modelType = await prisma.modelType.create({
        data: {
          name
        },
        select: {
          id: true,
          name: true,
          createdAt: true
        }
      });

      return reply.send({
        success: true,
        message: 'Model type created successfully',
        data: modelType
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Create model type failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
    }
  );
}
