import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** AppStats 是单行表（id=1），确保行存在并返回 */
async function getStats() {
  const existing = await prisma.appStats.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.appStats.create({ data: { id: 1 } });
}

/** 公开展示接口：应用覆盖零件数 + 匹配次数 */
export async function statsRoutes(app: FastifyInstance) {
  app.get('/', {
    schema: {
      tags: ['Stats'], summary: '应用统计数据（覆盖零件数/匹配次数）',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                partCoverage: { type: 'integer' },
                matchCount: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }, async (_request, reply) => {
    try {
      const s = await getStats();
      return reply.send({ success: true, data: { partCoverage: s.partCoverage, matchCount: s.matchCount } });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}

/** 管理端：查看 + 编辑 */
export async function adminStatsRoutes(app: FastifyInstance) {
  app.get('/', {
    schema: {
      tags: ['Admin Stats'], summary: '查看应用统计数据'
    }
  }, async (_request, reply) => {
    try {
      const s = await getStats();
      return reply.send({ success: true, data: { partCoverage: s.partCoverage, matchCount: s.matchCount, updatedAt: s.updatedAt.toISOString() } });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  app.put('/', {
    schema: {
      tags: ['Admin Stats'], summary: '编辑应用统计数据（覆盖零件数/匹配次数）',
      body: {
        type: 'object',
        required: ['partCoverage', 'matchCount'],
        properties: {
          partCoverage: { type: 'integer', minimum: 0 },
          matchCount: { type: 'integer', minimum: 0 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { partCoverage, matchCount } = request.body as { partCoverage: number; matchCount: number };
      await getStats();
      const s = await prisma.appStats.update({
        where: { id: 1 },
        data: { partCoverage, matchCount }
      });
      return reply.send({ success: true, message: 'Stats updated', data: { partCoverage: s.partCoverage, matchCount: s.matchCount, updatedAt: s.updatedAt.toISOString() } });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}
