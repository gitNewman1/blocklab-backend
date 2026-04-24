import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { LocalStorageService } from '../../services/local-storage.service';

const prisma = new PrismaClient();
const storageService = new LocalStorageService();
const modelAssetFolders = ['io-files', 'models-3d', 'thumbnails', 'manuals'];

export async function dataManagementRoutes(app: FastifyInstance) {
  app.post('/clear-models', async (request, reply) => {
    try {
      const body = (request.body || {}) as { deleteFiles?: boolean };
      const deleteFiles = body.deleteFiles === true;

      await prisma.$executeRawUnsafe('TRUNCATE TABLE models RESTART IDENTITY CASCADE;');

      let filesCleared = false;
      let warning: string | null = null;
      if (deleteFiles) {
        try {
          await storageService.clearFolders(modelAssetFolders);
          filesCleared = true;
        } catch (error: any) {
          warning = `Model data cleared, but file cleanup failed: ${String(error?.message || error)}`;
          request.log.error({ error: error?.message, stack: error?.stack }, 'Clear model files failed');
        }
      }

      return reply.send({
        success: true,
        message: deleteFiles
          ? 'Model data cleared successfully'
          : 'Model data cleared successfully, files not deleted',
        data: {
          table: 'models',
          deleteFiles,
          filesCleared,
          clearedFolders: deleteFiles ? modelAssetFolders : []
        },
        ...(warning ? { warning } : {})
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Clear models failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });

  app.post('/clear-model-types', async (request, reply) => {
    try {
      await prisma.$transaction([
        prisma.model.updateMany({
          data: {
            modelTypeId: null
          }
        }),
        prisma.$executeRawUnsafe('TRUNCATE TABLE model_types RESTART IDENTITY;')
      ]);

      return reply.send({
        success: true,
        message: 'Model type data cleared successfully',
        data: {
          table: 'model_types'
        }
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Clear model types failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });

  app.post('/clear-users', async (request, reply) => {
    try {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE users;');

      return reply.send({
        success: true,
        message: 'User data cleared successfully',
        data: {
          table: 'users'
        }
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Clear users failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });

  app.post('/delete-model', async (request, reply) => {
    try {
      const body = (request.body || {}) as { id?: unknown; deleteFiles?: boolean };
      const modelId = Number(body.id);
      const deleteFiles = body.deleteFiles === true;
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
          ioFileUrl: true,
          model3dUrl: true,
          thumbnailUrl: true,
          manualUrl: true
        }
      });
      if (!model) {
        return reply.code(404).send({
          success: false,
          message: 'Model not found',
          error: 'MODEL_NOT_FOUND'
        });
      }

      await prisma.model.delete({
        where: { id: modelId }
      });

      let filesDeleted = false;
      let warning: string | null = null;
      if (deleteFiles) {
        try {
          await storageService.deleteFilesByUrls([
            model.ioFileUrl,
            model.model3dUrl,
            model.thumbnailUrl,
            model.manualUrl
          ]);
          filesDeleted = true;
        } catch (error: any) {
          warning = `Model deleted, but file cleanup failed: ${String(error?.message || error)}`;
          request.log.error({ error: error?.message, stack: error?.stack }, 'Delete model files failed');
        }
      }

      return reply.send({
        success: true,
        message: deleteFiles ? 'Model deleted successfully' : 'Model deleted successfully, files not deleted',
        data: {
          table: 'models',
          id: model.id,
          name: model.name,
          deleteFiles,
          filesDeleted
        },
        ...(warning ? { warning } : {})
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Delete model failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });

  app.post('/delete-model-type', async (request, reply) => {
    try {
      const body = (request.body || {}) as { id?: unknown };
      const modelTypeId = Number(body.id);
      if (!Number.isInteger(modelTypeId) || modelTypeId <= 0) {
        return reply.code(400).send({
          success: false,
          message: 'id must be a positive integer',
          error: 'INVALID_MODEL_TYPE_ID'
        });
      }

      const modelType = await prisma.modelType.findUnique({
        where: { id: modelTypeId },
        select: {
          id: true,
          name: true
        }
      });
      if (!modelType) {
        return reply.code(404).send({
          success: false,
          message: 'Model type not found',
          error: 'MODEL_TYPE_NOT_FOUND'
        });
      }

      await prisma.$transaction([
        prisma.model.updateMany({
          where: { modelTypeId },
          data: { modelTypeId: null }
        }),
        prisma.modelType.delete({
          where: { id: modelTypeId }
        })
      ]);

      return reply.send({
        success: true,
        message: 'Model type deleted successfully',
        data: {
          table: 'model_types',
          id: modelType.id,
          name: modelType.name
        }
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Delete model type failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });

  app.post('/delete-user', async (request, reply) => {
    try {
      const body = (request.body || {}) as { id?: unknown };
      const userId = typeof body.id === 'string' ? body.id.trim() : '';
      if (!userId) {
        return reply.code(400).send({
          success: false,
          message: 'id is required',
          error: 'INVALID_USER_ID'
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          unionId: true
        }
      });
      if (!user) {
        return reply.code(404).send({
          success: false,
          message: 'User not found',
          error: 'USER_NOT_FOUND'
        });
      }

      await prisma.user.delete({
        where: { id: userId }
      });

      return reply.send({
        success: true,
        message: 'User deleted successfully',
        data: {
          table: 'users',
          id: user.id,
          unionId: user.unionId
        }
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Delete user failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });
}
