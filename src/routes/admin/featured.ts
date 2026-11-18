import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  FeaturedMode,
  getFeaturedConfig,
  getWeekStart,
  isValidMode,
  upsertCurrentWeekFeatured
} from '../../services/featured.service';

const prisma = new PrismaClient();

/** 历史记录展示的周数 */
const HISTORY_WEEKS = 10;

/** 模型的公开字段（历史记录/榜单共用） */
const modelFields = {
  select: {
    id: true,
    name: true,
    partCount: true,
    thumbnailUrl: true,
    modelTypeId: true,
    modelType: { select: { id: true, name: true } }
  }
};

/** 模型点赞统计（总数 + 滚动 7 天） */
async function likeCounts(modelIds: number[]): Promise<Map<number, { total: number; weekly: number }>> {
  const result = new Map<number, { total: number; weekly: number }>();
  if (modelIds.length === 0) return result;
  const [totalRows, weeklyRows] = await Promise.all([
    prisma.modelLike.groupBy({ by: ['modelId'], where: { modelId: { in: modelIds } }, _count: { _all: true } }),
    prisma.modelLike.groupBy({
      by: ['modelId'],
      where: { modelId: { in: modelIds }, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      _count: { _all: true }
    })
  ]);
  for (const r of totalRows) result.set(r.modelId, { total: r._count._all, weekly: 0 });
  for (const r of weeklyRows) {
    const cur = result.get(r.modelId) ?? { total: 0, weekly: 0 };
    cur.weekly = r._count._all;
    result.set(r.modelId, cur);
  }
  return result;
}

function formatModel(m: { id: number; name: string; partCount: number; thumbnailUrl: string | null; modelTypeId: number | null; modelType: { id: number; name: string } | null }, likes: { total: number; weekly: number } | undefined) {
  return {
    id: m.id,
    name: m.name,
    partCount: m.partCount,
    thumbnailUrl: m.thumbnailUrl,
    modelTypeId: m.modelTypeId,
    modelTypeName: m.modelType?.name ?? null,
    likeCount: likes?.total ?? 0,
    weeklyLikeCount: likes?.weekly ?? 0
  };
}

export async function adminFeaturedRoutes(app: FastifyInstance) {
  // 管理端每周精选数据：当前模式、当前周精选、过去 10 周历史、周榜/总榜（供三个选项页签展示）
  app.get('/', { schema: { tags: ['AdminFeatured'], summary: '每周精选管理数据' } }, async (_request, reply) => {
    try {
      const config = await getFeaturedConfig(prisma);
      const current = await upsertCurrentWeekFeatured(prisma, config);
      const thisWeekStart = getWeekStart();

      // 历史：过去 10 周的固化记录（不含当前周；当前周单独返回 thisWeek）
      const historyRows = await prisma.featuredModel.findMany({
        where: { weekStart: { lt: thisWeekStart } },
        orderBy: { weekStart: 'desc' },
        take: HISTORY_WEEKS
      });
      const historyModelIds = historyRows.map(r => r.modelId);
      const historyModels = await prisma.model.findMany({
        where: { id: { in: historyModelIds } },
        select: modelFields.select
      });
      const historyModelMap = new Map(historyModels.map(m => [m.id, m]));
      const history = historyRows.map(r => ({
        weekStart: r.weekStart,
        source: r.source,
        model: historyModelMap.get(r.modelId) ?? null
      }));

      // 周榜（滚动 7 天有赞的模型）与总榜（有赞的模型），供自动模式页签展示
      const [weeklyTop, totalTop] = await Promise.all([
        prisma.modelLike.groupBy({
          by: ['modelId'],
          where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          _count: { _all: true },
          orderBy: { _count: { modelId: 'desc' } }
        }),
        prisma.modelLike.groupBy({
          by: ['modelId'],
          _count: { _all: true },
          orderBy: { _count: { modelId: 'desc' } }
        })
      ]);
      const rankIds = [...new Set([...weeklyTop.map(r => r.modelId), ...totalTop.map(r => r.modelId)])];
      const rankModels = await prisma.model.findMany({
        where: { id: { in: rankIds } },
        select: modelFields.select
      });
      const rankMap = new Map(rankModels.map(m => [m.id, m]));
      const weekly = new Map(weeklyTop.map(r => [r.modelId, r._count._all]));
      const total = new Map(totalTop.map(r => [r.modelId, r._count._all]));
      const rankRows = rankIds.map(id => rankMap.get(id)).filter(m => m !== undefined);
      const weeklyRanking = rankRows.map(m => formatModel(m, { total: total.get(m.id) ?? 0, weekly: weekly.get(m.id) ?? 0 }));
      const totalRanking = [...rankRows].sort((a, b) => (total.get(b.id) ?? 0) - (total.get(a.id) ?? 0)).map(m => formatModel(m, { total: total.get(m.id) ?? 0, weekly: weekly.get(m.id) ?? 0 }));

      // 当前周精选的模型详情
      let thisWeek: { weekStart: Date; source: string; model: unknown } | null = null;
      if (current) {
        const m = await prisma.model.findUnique({ where: { id: current.modelId }, select: modelFields.select });
        if (m) {
          const likes = await likeCounts([m.id]);
          thisWeek = { weekStart: current.weekStart, source: current.source, model: formatModel(m, likes.get(m.id)) };
        }
      }

      return reply.send({
        success: true,
        message: 'Featured data fetched successfully',
        data: {
          mode: config.mode,
          manualModelId: config.manualModelId,
          thisWeek,
          history,
          weeklyRanking,
          totalRanking
        }
      });
    } catch (error: any) {
      _request.log.error({ error: error.message, stack: error.stack }, 'Fetch admin featured failed');
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  // 切换精选模式：manual / weekly_likes / total_likes
  app.put(
    '/mode',
    {
      schema: {
        tags: ['AdminFeatured'],
        summary: '切换每周精选模式',
        body: {
          type: 'object',
          required: ['mode'],
          properties: { mode: { type: 'string', enum: ['manual', 'weekly_likes', 'total_likes'] } }
        }
      }
    },
    async (request, reply) => {
      try {
        const mode = (request.body as { mode: string }).mode;
        if (!isValidMode(mode)) {
          return reply.code(400).send({ success: false, message: 'mode must be one of: manual, weekly_likes, total_likes', error: 'INVALID_MODE' });
        }

        const config = await getFeaturedConfig(prisma);
        await prisma.featuredConfig.update({ where: { id: 1 }, data: { mode: mode as FeaturedMode } });

        // 切换后立即重算当前周（周内草稿态，覆盖写入；历史周不受影响）
        const current = await upsertCurrentWeekFeatured(prisma, { ...config, mode: mode as FeaturedMode });
        return reply.send({ success: true, message: 'Mode updated', data: { mode, current } });
      } catch (error: any) {
        request.log.error({ error: error.message, stack: error.stack }, 'Update featured mode failed');
        return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
      }
    }
  );

  // 手动设置当前周精选（manual 模式下即生效；同时记住 manualModelId 供自动模式兜底）
  app.post(
    '/manual',
    {
      schema: {
        tags: ['AdminFeatured'],
        summary: '手动设置当前周精选模型',
        body: {
          type: 'object',
          required: ['modelId'],
          properties: { modelId: { type: 'integer', minimum: 1 } }
        }
      }
    },
    async (request, reply) => {
      try {
        const modelId = (request.body as { modelId: number }).modelId;
        const model = await prisma.model.findUnique({ where: { id: modelId }, select: { id: true } });
        if (!model) {
          return reply.code(404).send({ success: false, message: 'Model not found', error: 'MODEL_NOT_FOUND' });
        }

        await prisma.featuredConfig.upsert({
          where: { id: 1 },
          create: { id: 1, manualModelId: modelId },
          update: { manualModelId: modelId }
        });
        const current = await upsertCurrentWeekFeatured(prisma, { mode: 'manual', manualModelId: modelId });

        return reply.send({ success: true, message: 'Manual featured set', data: { current } });
      } catch (error: any) {
        request.log.error({ error: error.message, stack: error.stack }, 'Set manual featured failed');
        return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
      }
    }
  );
}
