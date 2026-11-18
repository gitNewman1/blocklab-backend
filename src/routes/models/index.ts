import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { config } from '../../config';
import { requireAuth, optionalAuth } from '../../plugins/auth';
import {
  getFeaturedConfig,
  getRolling7dStart,
  upsertCurrentWeekFeatured
} from '../../services/featured.service';

const prisma = new PrismaClient();

/** 批量统计模型点赞数：总数 + 滚动 7 天数 */
async function getLikeCounts(modelIds: number[]): Promise<Map<number, { total: number; weekly: number }>> {
  const result = new Map<number, { total: number; weekly: number }>();
  if (modelIds.length === 0) return result;
  const [totalRows, weeklyRows] = await Promise.all([
    prisma.modelLike.groupBy({
      by: ['modelId'],
      where: { modelId: { in: modelIds } },
      _count: { _all: true }
    }),
    prisma.modelLike.groupBy({
      by: ['modelId'],
      where: { modelId: { in: modelIds }, createdAt: { gte: getRolling7dStart() } },
      _count: { _all: true }
    })
  ]);
  for (const row of totalRows) result.set(row.modelId, { total: row._count._all, weekly: 0 });
  for (const row of weeklyRows) {
    const cur = result.get(row.modelId) ?? { total: 0, weekly: 0 };
    cur.weekly = row._count._all;
    result.set(row.modelId, cur);
  }
  return result;
}

/** 查询当前用户对一组模型的已点赞 ID 集合 */
async function getLikedIds(userId: string | undefined, modelIds: number[]): Promise<Set<number>> {
  if (!userId || modelIds.length === 0) return new Set();
  const rows = await prisma.modelLike.findMany({
    where: { userId, modelId: { in: modelIds } },
    select: { modelId: true }
  });
  return new Set(rows.map(r => r.modelId));
}

// 从 partsJson 按 designID 去重，生成每种零件的网格(glb)下载清单，供拼装动画逐零件实例化
function buildPartMeshes(partsJson: unknown): Array<{ designID: string; meshUrl: string }> {
  if (!Array.isArray(partsJson)) return [];
  const seen = new Set<string>();
  const result: Array<{ designID: string; meshUrl: string }> = [];
  for (const item of partsJson) {
    const designID = item && typeof item === 'object' ? (item as Record<string, unknown>).designID : undefined;
    if (typeof designID === 'string' && designID && !seen.has(designID)) {
      seen.add(designID);
      result.push({
        designID,
        meshUrl: `${config.storage.publicBaseUrl}/static/parts/${designID}.glb`
      });
    }
  }
  return result;
}

export async function modelQueryRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      preHandler: optionalAuth,
      schema: {
        tags: ['Models'],
        summary: '获取所有模型',
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'integer', minimum: 1, description: '模型类型 ID，可选' }
          }
        },
        response: {
          400: {
            description: '请求参数错误',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              error: { type: 'string' }
            }
          },
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
                    model3dUrl: { type: ['string', 'null'] },
                    createdAt: { type: 'string', format: 'date-time' },
                    modelTypeId: { type: ['integer', 'null'] },
                    modelTypeName: { type: ['string', 'null'] },
                    likeCount: { type: 'integer' },
                    weeklyLikeCount: { type: 'integer' },
                    liked: { type: 'boolean' }
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
        const query = (request.query || {}) as { type?: unknown };
        let modelTypeId: number | undefined;

        if (typeof query.type !== 'undefined') {
          const parsedTypeId = Number(query.type);
          if (!Number.isInteger(parsedTypeId) || parsedTypeId <= 0) {
            return reply.code(400).send({
              success: false,
              message: 'type must be a positive integer',
              error: 'INVALID_MODEL_TYPE'
            });
          }

          const modelType = await prisma.modelType.findUnique({
            where: { id: parsedTypeId },
            select: {
              id: true
            }
          });

          if (!modelType) {
            return reply.code(400).send({
              success: false,
              message: 'type does not exist',
              error: 'INVALID_MODEL_TYPE'
            });
          }

          modelTypeId = parsedTypeId;
        }

        const models = await prisma.model.findMany({
          ...(typeof modelTypeId === 'number' ? { where: { modelTypeId } } : {}),
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

        const ids = models.map(m => m.id);
        const [likeCounts, likedIds] = await Promise.all([
          getLikeCounts(ids),
          getLikedIds(request.user?.userId, ids)
        ]);

        return reply.send({
          success: true,
          message: 'Models fetched successfully',
          data: models.map(m => ({
            ...toModelResponse(m),
            likeCount: likeCounts.get(m.id)?.total ?? 0,
            weeklyLikeCount: likeCounts.get(m.id)?.weekly ?? 0,
            liked: likedIds.has(m.id)
          }))
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
      preHandler: optionalAuth,
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
                  model3dUrl: { type: ['string', 'null'] },
                  partsJson: { type: ['array', 'object', 'null'] },
                  stepsJson: { type: ['array', 'object', 'null'] },
                  partMeshes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        designID: { type: 'string' },
                        meshUrl: { type: 'string' }
                      }
                    }
                  },
                  createdAt: { type: 'string', format: 'date-time' },
                  modelTypeId: { type: ['integer', 'null'] },
                  modelTypeName: { type: ['string', 'null'] },
                  likeCount: { type: 'integer' },
                  weeklyLikeCount: { type: 'integer' },
                  liked: { type: 'boolean' }
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

        const [likeCounts, likedIds] = await Promise.all([
          getLikeCounts([modelId]),
          getLikedIds(request.user?.userId, [modelId])
        ]);

        return reply.send({
          success: true,
          message: 'Model fetched successfully',
          data: {
            ...toModelResponse(model),
            likeCount: likeCounts.get(modelId)?.total ?? 0,
            weeklyLikeCount: likeCounts.get(modelId)?.weekly ?? 0,
            liked: likedIds.has(modelId)
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
    }
  );

  // 点赞 / 取消点赞模型（切换式，身份从 token 解析）
  app.post(
    '/:id/like',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['Models'],
        summary: '点赞或取消点赞模型',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer', minimum: 1 } }
        }
      }
    },
    async (request, reply) => {
      try {
        const modelId = Number((request.params as { id: string }).id);
        if (!Number.isInteger(modelId) || modelId <= 0) {
          return reply.code(400).send({
            success: false,
            message: 'id must be a positive integer',
            error: 'INVALID_MODEL_ID'
          });
        }
        const userId = request.user!.userId;

        const model = await prisma.model.findUnique({ where: { id: modelId }, select: { id: true } });
        if (!model) {
          return reply.code(404).send({ success: false, message: 'Model not found', error: 'MODEL_NOT_FOUND' });
        }

        const existing = await prisma.modelLike.findUnique({
          where: { userId_modelId: { userId, modelId } }
        });
        if (existing) {
          await prisma.modelLike.delete({ where: { id: existing.id } });
        } else {
          await prisma.modelLike.create({ data: { userId, modelId } });
        }

        const likeCount = await prisma.modelLike.count({ where: { modelId } });
        return reply.send({
          success: true,
          message: existing ? 'Unliked' : 'Liked',
          data: { liked: !existing, likeCount }
        });
      } catch (error: any) {
        request.log.error({ error: error.message, stack: error.stack }, 'Toggle model like failed');
        return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
      }
    }
  );

  // 当前周的每周精选模型（客户端调用，只返回 1 个；读取时实时重算当前周并固化）
  app.get(
    '/featured',
    {
      preHandler: optionalAuth,
      schema: {
        tags: ['Models'],
        summary: '获取当前周精选模型'
      }
    },
    async (_request, reply) => {
      try {
        const config = await getFeaturedConfig(prisma);
        const current = await upsertCurrentWeekFeatured(prisma, config);
        if (!current) {
          return reply.send({ success: true, message: 'No featured model yet', data: null });
        }

        const model = await prisma.model.findUnique({
          where: { id: current.modelId },
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
            modelType: { select: { id: true, name: true } }
          }
        });
        if (!model) {
          // 精选记录指向的模型已被删除：视为无精选，由管理员重新设置
          return reply.send({ success: true, message: 'No featured model yet', data: null });
        }

        return reply.send({
          success: true,
          message: 'Featured model fetched successfully',
          data: { ...toModelResponse(model), source: current.source, weekStart: current.weekStart }
        });
      } catch (error: any) {
        _request.log.error({ error: error.message, stack: error.stack }, 'Fetch featured model failed');
        return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
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
    model3dUrl: string | null;
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
    ...(Object.prototype.hasOwnProperty.call(model, 'partsJson') ? { partMeshes: buildPartMeshes(model.partsJson) } : {}),
    modelTypeId: model.modelType?.id ?? model.modelTypeId ?? null,
    modelTypeName: model.modelType?.name ?? null
  };
}
