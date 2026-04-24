import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function modelQueryRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      schema: {
        tags: ['Models'],
        summary: '获取所有模型',
        response: {
          200: {
            description: '成功返回模型列表',
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
                    partCount: { type: 'integer' },
                    thumbnailUrl: { type: ['string', 'null'] },
                    manualUrl: { type: ['string', 'null'] },
                    ioFileUrl: { type: 'string' },
                    model3dUrl: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    modelTypeId: { type: ['integer', 'null'] },
                    modelTypeName: { type: ['string', 'null'] }
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
      const models = await prisma.model.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          partCount: true,
          thumbnailUrl: true,
          manualUrl: true,
          ioFileUrl: true,
          model3dUrl: true,
          createdAt: true,
          modelTypeId: true,
          modelType: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      return reply.send({
        success: true,
        message: 'Models fetched successfully',
        data: models.map(toModelResponse)
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Fetch models failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
    }
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['Models'],
        summary: '根据 ID 获取模型详情',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'integer', minimum: 1 }
          }
        },
        response: {
          200: {
            description: '成功返回模型详情',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  name: { type: 'string' },
                  partCount: { type: 'integer' },
                  thumbnailUrl: { type: ['string', 'null'] },
                  manualUrl: { type: ['string', 'null'] },
                  ioFileUrl: { type: 'string' },
                  model3dUrl: { type: 'string' },
                  partsJson: { type: ['array', 'object', 'null'] },
                  stepsJson: { type: ['array', 'object', 'null'] },
                  createdAt: { type: 'string', format: 'date-time' },
                  modelTypeId: { type: ['integer', 'null'] },
                  modelTypeName: { type: ['string', 'null'] }
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
      const modelId = Number(id);
      if (!Number.isInteger(modelId) || modelId <= 0) {
        return reply.code(400).send({
          success: false,
          message: 'id must be a positive integer',
          error: 'INVALID_MODEL_ID'
        });
      }

      const model = await prisma.model.findUnique({
        where: { id: modelId },
        select: {
          id: true,
          name: true,
          partCount: true,
          thumbnailUrl: true,
          manualUrl: true,
          ioFileUrl: true,
          model3dUrl: true,
          partsJson: true,
          stepsJson: true,
          createdAt: true,
          modelTypeId: true,
          modelType: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      if (!model) {
        return reply.code(404).send({
          success: false,
          message: 'Model not found',
          error: 'MODEL_NOT_FOUND'
        });
      }

      return reply.send({
        success: true,
        message: 'Model fetched successfully',
        data: toModelResponse(model)
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Fetch model detail failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
    }
  );
}

function toModelResponse<
  T extends {
    id: number;
    name: string;
    partCount: number;
    thumbnailUrl: string | null;
    manualUrl: string | null;
    ioFileUrl: string;
    model3dUrl: string;
    createdAt: Date;
    partsJson?: unknown;
    stepsJson?: unknown;
    modelTypeId: number | null;
    modelType: { id: number; name: string } | null;
  }
>(model: T) {
  return {
    id: model.id,
    name: model.name,
    partCount: model.partCount,
    thumbnailUrl: model.thumbnailUrl,
    manualUrl: model.manualUrl,
    ioFileUrl: model.ioFileUrl,
    model3dUrl: model.model3dUrl,
    createdAt: model.createdAt,
    ...(Object.prototype.hasOwnProperty.call(model, 'partsJson') ? { partsJson: model.partsJson } : {}),
    ...(Object.prototype.hasOwnProperty.call(model, 'stepsJson') ? { stepsJson: model.stepsJson } : {}),
    modelTypeId: model.modelType?.id ?? model.modelTypeId ?? null,
    modelTypeName: model.modelType?.name ?? null
  };
}
