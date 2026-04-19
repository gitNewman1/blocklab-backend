import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildResolvedSteps } from '../../services/resolve-steps';

const prisma = new PrismaClient();

export async function modelQueryRoutes(app: FastifyInstance) {
  app.get('/', async (request, reply) => {
    try {
      const models = await prisma.model.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          thumbnailUrl: true,
          manualUrl: true,
          ioFileUrl: true,
          model3dUrl: true,
          createdAt: true
        }
      });

      return reply.send({
        success: true,
        message: 'Models fetched successfully',
        data: models
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Fetch models failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });

  app.get('/:id', async (request, reply) => {
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
          thumbnailUrl: true,
          manualUrl: true,
          ioFileUrl: true,
          model3dUrl: true,
          partsJson: true,
          stepsJson: true,
          createdAt: true
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
        data: {
          ...model,
          resolvedSteps: buildResolvedSteps(model.partsJson, model.stepsJson)
        }
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Fetch model detail failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });
}
