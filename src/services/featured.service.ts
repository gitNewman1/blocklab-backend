import { PrismaClient } from '@prisma/client';

/** 精选模式 */
export type FeaturedMode = 'manual' | 'weekly_likes' | 'total_likes';
const VALID_MODES: FeaturedMode[] = ['manual', 'weekly_likes', 'total_likes'];

/** 一周一条记录的起始时间：本周一 00:00:00（服务器本地时区） */
export function getWeekStart(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // getDay(): 周日=0。周一开始为一周之始
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

/** 滚动 7 天的起点 */
export function getRolling7dStart(now = new Date()): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

export function isValidMode(mode: string): mode is FeaturedMode {
  return (VALID_MODES as string[]).includes(mode);
}

export interface FeaturedConfigRow {
  mode: FeaturedMode;
  manualModelId: number | null;
}

/** 读取模式配置（固定 id=1，无则落一条默认 manual） */
export async function getFeaturedConfig(prisma: PrismaClient): Promise<FeaturedConfigRow> {
  const row = await prisma.featuredConfig.findUnique({ where: { id: 1 } });
  if (row) {
    return {
      mode: isValidMode(row.mode) ? (row.mode as FeaturedMode) : 'manual',
      manualModelId: row.manualModelId
    };
  }
  await prisma.featuredConfig.create({ data: { id: 1 } });
  return { mode: 'manual', manualModelId: null };
}

/**
 * 计算当前周精选：按当前模式实时取榜单第一名；
 * 自动模式榜单为空（全为 0 赞）时回落到最后一次手动选择的模型（兜底）。
 * 返回 null 表示当前周无任何可选模型（上线空窗，由后台手动设置兜底）。
 */
export async function computeCurrentWeekFeatured(
  prisma: PrismaClient,
  config: FeaturedConfigRow
): Promise<{ modelId: number; source: FeaturedMode } | null> {
  if (config.mode === 'manual') {
    return config.manualModelId ? { modelId: config.manualModelId, source: 'manual' } : null;
  }

  if (config.mode === 'weekly_likes') {
    const top = await prisma.modelLike.groupBy({
      by: ['modelId'],
      where: { createdAt: { gte: getRolling7dStart() } },
      _count: { modelId: true },
      orderBy: { _count: { modelId: 'desc' } },
      take: 1
    });
    if (top.length > 0) return { modelId: top[0].modelId, source: 'weekly_likes' };
  }

  if (config.mode === 'total_likes') {
    const top = await prisma.modelLike.groupBy({
      by: ['modelId'],
      _count: { modelId: true },
      orderBy: { _count: { modelId: 'desc' } },
      take: 1
    });
    if (top.length > 0) return { modelId: top[0].modelId, source: 'total_likes' };
  }

  // 兜底：榜单为空，回落到最后一次手动选择
  return config.manualModelId ? { modelId: config.manualModelId, source: 'manual' } : null;
}

/**
 * 确保当前周记录存在且与最新计算一致（upsert），并返回。
 * 历史周记录永不重算——只写 weekStart=本周一的行。
 */
export async function upsertCurrentWeekFeatured(
  prisma: PrismaClient,
  config: FeaturedConfigRow
): Promise<{ weekStart: Date; modelId: number; source: string } | null> {
  const computed = await computeCurrentWeekFeatured(prisma, config);
  if (!computed) return null;
  const weekStart = getWeekStart();
  const row = await prisma.featuredModel.upsert({
    where: { weekStart },
    create: { weekStart, modelId: computed.modelId, source: computed.source },
    update: { modelId: computed.modelId, source: computed.source }
  });
  return { weekStart, modelId: row.modelId, source: row.source };
}
