import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const adminWorkFields = {
  id: true, userId: true, imageUrl: true, name: true,
  category: true, partCount: true, description: true, tags: true,
  isPublic: true, reviewStatus: true, reviewReason: true,
  joinContest: true, createdAt: true,
  user: { select: { nickname: true, unionId: true } }
};

function fmt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toRow(w: any) {
  return {
    id: w.id,
    userId: w.userId,
    userName: w.user?.nickname ?? (w.user ? `积木${w.user.unionId.slice(0, 6)}` : null),
    imageUrl: w.imageUrl,
    name: w.name,
    category: w.category,
    partCount: w.partCount,
    description: w.description,
    tags: w.tags,
    reviewStatus: w.reviewStatus,
    reviewReason: w.reviewReason,
    joinContest: w.joinContest,
    createdAt: fmt(new Date(w.createdAt))
  };
}

/**
 * 作品审核（管理后台）：
 * - GET  /pending?status=pending|approved|rejected  审核列表（默认待审）
 * - GET  /pending-count                            红点：待审数量
 * - POST /:id/approve                              通过 → isPublic=true
 * - POST /:id/reject                               拒绝 → isPublic=false + 理由
 */
export async function adminWorkReviewRoutes(app: FastifyInstance) {
  app.get('/pending-count', {
    schema: { tags: ['Admin Review'], summary: '待审核作品数量（红点）' }
  }, async (_request, reply) => {
    try {
      const count = await prisma.work.count({ where: { reviewStatus: 'pending' } });
      return reply.send({ success: true, data: { count } });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/pending', {
    schema: {
      tags: ['Admin Review'], summary: '作品审核列表（默认待审）',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'all'], default: 'pending' },
          page:   { type: 'integer', minimum: 1, default: 1 },
          limit:  { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { status = 'pending', page = 1, limit = 20 } = request.query as any;
      const p = page > 0 ? page : 1;
      const l = Math.min(limit > 0 ? limit : 20, 100);
      const where = status === 'all' ? {} : { reviewStatus: status };

      const [total, rows] = await Promise.all([
        prisma.work.count({ where }),
        prisma.work.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (p - 1) * l,
          take: l,
          select: adminWorkFields
        })
      ]);

      return reply.send({ success: true, data: { total, page: p, limit: l, items: rows.map(toRow) } });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/:id/approve', {
    schema: {
      tags: ['Admin Review'], summary: '审核通过（公开作品）',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } }
    }
  }, async (request, reply) => {
    try {
      const id = Number((request.params as any).id);
      const work = await prisma.work.update({
        where: { id },
        data: { reviewStatus: 'approved', reviewReason: null, isPublic: true },
        select: adminWorkFields
      });
      return reply.send({ success: true, message: 'Work approved', data: toRow(work) });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ success: false, message: 'Work not found', error: 'WORK_NOT_FOUND' });
      }
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/:id/reject', {
    schema: {
      tags: ['Admin Review'], summary: '审核拒绝（不下架已有公开态之外的展示，保持私密）',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
      body: {
        type: 'object',
        properties: { reason: { type: 'string', maxLength: 200 } }
      }
    }
  }, async (request, reply) => {
    try {
      const id = Number((request.params as any).id);
      const { reason } = (request.body ?? {}) as { reason?: string };
      const work = await prisma.work.update({
        where: { id },
        data: { reviewStatus: 'rejected', reviewReason: reason ?? null, isPublic: false },
        select: adminWorkFields
      });
      return reply.send({ success: true, message: 'Work rejected', data: toRow(work) });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ success: false, message: 'Work not found', error: 'WORK_NOT_FOUND' });
      }
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}
