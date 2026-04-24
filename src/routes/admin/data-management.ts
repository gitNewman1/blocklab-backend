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
}
