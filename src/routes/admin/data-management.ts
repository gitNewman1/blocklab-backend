import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { LocalStorageService } from '../../services/local-storage.service';
import { IOParserService } from '../../services/io-parser.service';

const prisma = new PrismaClient();
const storageService = new LocalStorageService();
const ioParserService = new IOParserService();
const modelAssetFolders = ['io-files', 'models-3d', 'thumbnails', 'manuals'];

// 判断模型的 stepsJson 是否已含每零件位姿（新格式）。老格式的 step 没有 placements 字段。
function hasPlacements(stepsJson: unknown): boolean {
  return (
    Array.isArray(stepsJson) &&
    stepsJson.length > 0 &&
    stepsJson.every((s) => s && typeof s === 'object' && Array.isArray((s as Record<string, unknown>).placements))
  );
}

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

  app.post(
    '/backfill-placements',
    {
      schema: {
        tags: ['Admin Data'],
        summary: '回填零件位姿（重新解析已存 .io，原地更新 stepsJson）',
        description:
          '幂等接口：默认只处理 stepsJson 缺少 placements 的老模型，已补过的跳过；force=true 时强制重新解析所有模型。依赖服务器 uploads/io-files/ 下的原始 .io 文件仍存在。仅更新 stepsJson，不动 partsJson（保留零件名称/图片等富化数据）。',
        querystring: {
          type: 'object',
          properties: {
            force: { type: 'boolean', default: false, description: '为 true 时强制重新解析所有模型' }
          }
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
                  total: { type: 'integer', description: '模型总数' },
                  updated: { type: 'integer', description: '本次重新解析并更新的模型数' },
                  skipped: { type: 'integer', description: '已有 placements 被跳过的模型数' },
                  failed: { type: 'integer', description: '解析失败/找不到 .io 的模型数' },
                  failedIds: { type: 'array', items: { type: 'integer' } }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { force } = request.query as { force?: boolean };
        const forceAll = force === true;

        const models = await prisma.model.findMany({
          select: { id: true, ioFileUrl: true, stepsJson: true }
        });

        let updated = 0;
        let skipped = 0;
        const failedIds: number[] = [];

        for (const model of models) {
          if (!forceAll && hasPlacements(model.stepsJson)) {
            skipped += 1;
            continue;
          }
          try {
            const absPath = storageService.resolveUrlToAbsolutePath(model.ioFileUrl);
            if (!absPath || !fs.existsSync(absPath)) {
              failedIds.push(model.id);
              request.log.warn(
                { modelId: model.id, ioFileUrl: model.ioFileUrl },
                'Backfill: .io 文件在本地未找到'
              );
              continue;
            }
            const buffer = await fs.promises.readFile(absPath);
            const parsed = await ioParserService.parseIOFileBuffer(buffer);
            await prisma.model.update({
              where: { id: model.id },
              data: { stepsJson: parsed.steps as any }
            });
            updated += 1;
          } catch (err: any) {
            failedIds.push(model.id);
            request.log.error({ modelId: model.id, error: err?.message }, 'Backfill: 重新解析失败');
          }
        }

        return reply.send({
          success: true,
          message: `回填完成：更新 ${updated}，跳过 ${skipped}，失败 ${failedIds.length}`,
          data: {
            total: models.length,
            updated,
            skipped,
            failed: failedIds.length,
            failedIds
          }
        });
      } catch (error: any) {
        request.log.error({ error: error.message, stack: error.stack }, 'Backfill placements failed');
        return reply.code(500).send({
          success: false,
          message: error.message,
          error: 'INTERNAL_ERROR'
        });
      }
    }
  );
}
