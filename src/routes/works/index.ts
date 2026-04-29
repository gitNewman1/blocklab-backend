import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { Hunyuan3dService } from '../../services/hunyuan3d.service';

const prisma = new PrismaClient();
const hunyuan3d = new Hunyuan3dService();

const VALID_CATEGORIES = ['TECHNOLOGY', 'VEHICLE', 'FOOD', 'ANIMAL', 'ARCHITECTURE', 'OTHER'];

const workFields = {
  id: true, userId: true, imageUrl: true, name: true,
  category: true, partCount: true, description: true, tags: true,
  isPublic: true, joinContest: true, createdAt: true,
  _count: { select: { likes: true } }
};

async function withLiked(works: any[], userId?: string) {
  if (!userId) return works.map(w => ({ ...w, likeCount: w._count.likes, liked: false, _count: undefined }));
  const likedIds = new Set(
    (await prisma.workLike.findMany({ where: { userId, workId: { in: works.map(w => w.id) } }, select: { workId: true } }))
      .map(l => l.workId)
  );
  return works.map(w => ({ ...w, likeCount: w._count.likes, liked: likedIds.has(w.id), _count: undefined }));
}

export async function workRoutes(app: FastifyInstance) {
  // 发布作品
  app.post('/', {
    schema: {
      tags: ['Works'], summary: '发布作品',
      body: {
        type: 'object',
        required: ['userId', 'imageUrl', 'name', 'description'],
        properties: {
          userId:      { type: 'string' },
          imageUrl:    { type: 'string' },
          name:        { type: 'string', maxLength: 100 },
          category:    { type: 'string', enum: VALID_CATEGORIES, default: 'OTHER' },
          partCount:   { type: 'integer', minimum: 0 },
          description: { type: 'string' },
          tags:        { type: 'array', items: { type: 'string' }, default: [] },
          generate3d:  { type: 'boolean', default: false },
          isPublic:    { type: 'boolean', default: true },
          joinContest: { type: 'boolean', default: false }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const body = request.body as any;
      const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
      if (!user) return reply.code(400).send({ success: false, message: 'User not found', error: 'INVALID_USER_ID' });
      const work = await prisma.work.create({ data: {
        userId: body.userId, imageUrl: body.imageUrl, name: body.name,
        category: body.category ?? 'OTHER', partCount: body.partCount ?? null,
        description: body.description, tags: body.tags ?? [],
        generate3d: body.generate3d ?? false, isPublic: body.isPublic ?? true, joinContest: body.joinContest ?? false,
        hunyuan3dStatus: body.generate3d ? 'pending' : null
      }});

      if (body.generate3d) {
        hunyuan3d.submitJob(body.imageUrl)
          .then(jobId => prisma.work.update({ where: { id: work.id }, data: { hunyuan3dTaskId: jobId, hunyuan3dStatus: 'processing' } }))
          .catch(() => prisma.work.update({ where: { id: work.id }, data: { hunyuan3dStatus: 'failed' } }));
      }

      return reply.code(201).send({ success: true, message: 'Work published successfully', data: work });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  // 获取作品列表（含点赞数和是否已点赞）
  app.get('/', {
    schema: {
      tags: ['Works'], summary: '获取作品列表',
      querystring: {
        type: 'object',
        properties: {
          userId:   { type: 'string', description: '当前用户 ID，用于判断是否已点赞' },
          filterUserId: { type: 'string', description: '按作者 ID 过滤' },
          category: { type: 'string', enum: VALID_CATEGORIES }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { userId, filterUserId, category } = request.query as any;
      const works = await prisma.work.findMany({
        where: {
          ...(filterUserId ? { userId: filterUserId } : {}),
          ...(category ? { category } : {})
        },
        orderBy: { createdAt: 'desc' },
        select: workFields
      });
      return reply.send({ success: true, message: 'Works fetched successfully', data: await withLiked(works, userId) });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  // 我的点赞列表
  app.get('/likes/mine', {
    schema: {
      tags: ['Works'], summary: '我点赞的作品列表',
      querystring: {
        type: 'object', required: ['userId'],
        properties: { userId: { type: 'string' } }
      }
    }
  }, async (request, reply) => {
    try {
      const { userId } = request.query as { userId: string };
      const likes = await prisma.workLike.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          work: { select: { id: true, name: true, imageUrl: true, category: true, _count: { select: { likes: true } } } }
        }
      });
      return reply.send({
        success: true, message: 'Liked works fetched successfully',
        data: likes.map(l => ({ ...l.work, likeCount: l.work._count.likes, liked: true, _count: undefined, likedAt: l.createdAt }))
      });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  // 收到的点赞消息列表
  app.get('/likes/received', {
    schema: {
      tags: ['Works'], summary: '收到的点赞消息列表',
      querystring: {
        type: 'object', required: ['userId'],
        properties: { userId: { type: 'string' } }
      }
    }
  }, async (request, reply) => {
    try {
      const { userId } = request.query as { userId: string };
      const likes = await prisma.workLike.findMany({
        where: { work: { userId } },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          userId: true,
          user: { select: { nickname: true, unionId: true } },
          work: { select: { id: true, name: true } }
        }
      });
      return reply.send({
        success: true, message: 'Received likes fetched successfully',
        data: likes.map(l => ({ workId: l.work.id, workName: l.work.name, likerUserId: l.userId, likerNickname: l.user.nickname ?? `积木${l.user.unionId.slice(0, 6)}`, likedAt: l.createdAt }))
      });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  // 我的作品发布消息列表（含3D任务状态）
  app.get('/messages/publish', {
    schema: {
      tags: ['Works'], summary: '我的作品发布消息列表',
      querystring: {
        type: 'object', required: ['userId'],
        properties: { userId: { type: 'string' } }
      }
    }
  }, async (request, reply) => {
    try {
      const { userId } = request.query as { userId: string };
      const works = await prisma.work.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, imageUrl: true, createdAt: true,
          generate3d: true, hunyuan3dTaskId: true, hunyuan3dStatus: true, model3dUrl: true
        }
      });

      // 对 processing 状态的任务，主动查询一次混元最新状态
      await Promise.all(
        works
          .filter(w => w.hunyuan3dTaskId && w.hunyuan3dStatus === 'processing')
          .map(async w => {
            try {
              const result = await hunyuan3d.queryJob(w.hunyuan3dTaskId!);
              if (result.status === 'DONE') {
                await prisma.work.update({ where: { id: w.id }, data: { hunyuan3dStatus: 'done', model3dUrl: result.modelUrl } });
                w.hunyuan3dStatus = 'done';
                w.model3dUrl = result.modelUrl ?? null;
              } else if (result.status === 'FAIL') {
                await prisma.work.update({ where: { id: w.id }, data: { hunyuan3dStatus: 'failed' } });
                w.hunyuan3dStatus = 'failed';
              }
            } catch {}
          })
      );

      return reply.send({
        success: true, message: 'Publish messages fetched successfully',
        data: works.map(w => ({
          workId: w.id, name: w.name, imageUrl: w.imageUrl, publishedAt: w.createdAt,
          generate3d: w.generate3d,
          hunyuan3dStatus: w.hunyuan3dStatus,
          model3dUrl: w.model3dUrl
        }))
      });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  // 查询3D生成状态
  app.get('/:id/3d-status', {
    schema: {
      tags: ['Works'], summary: '查询作品3D生成状态',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } }
    }
  }, async (request, reply) => {
    try {
      const workId = Number((request.params as any).id);
      const work = await prisma.work.findUnique({
        where: { id: workId },
        select: { id: true, hunyuan3dTaskId: true, hunyuan3dStatus: true, model3dUrl: true }
      });
      if (!work) return reply.code(404).send({ success: false, message: 'Work not found', error: 'WORK_NOT_FOUND' });
      if (!work.hunyuan3dTaskId || work.hunyuan3dStatus === 'done' || work.hunyuan3dStatus === 'failed') {
        return reply.send({ success: true, data: { status: work.hunyuan3dStatus, model3dUrl: work.model3dUrl } });
      }
      // 向混元查询最新状态
      const result = await hunyuan3d.queryJob(work.hunyuan3dTaskId);
      if (result.status === 'DONE') {
        await prisma.work.update({ where: { id: workId }, data: { hunyuan3dStatus: 'done', model3dUrl: result.modelUrl } });
        return reply.send({ success: true, data: { status: 'done', model3dUrl: result.modelUrl } });
      }
      if (result.status === 'FAIL') {
        await prisma.work.update({ where: { id: workId }, data: { hunyuan3dStatus: 'failed' } });
        return reply.send({ success: true, data: { status: 'failed', model3dUrl: null } });
      }
      return reply.send({ success: true, data: { status: 'processing', model3dUrl: null } });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  // 点赞 / 取消点赞
  app.post('/:id/like', {
    schema: {
      tags: ['Works'], summary: '点赞或取消点赞作品',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
      body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } }
    }
  }, async (request, reply) => {
    try {
      const workId = Number((request.params as any).id);
      const { userId } = request.body as { userId: string };

      const work = await prisma.work.findUnique({ where: { id: workId }, select: { id: true } });
      if (!work) return reply.code(404).send({ success: false, message: 'Work not found', error: 'WORK_NOT_FOUND' });

      const existing = await prisma.workLike.findUnique({ where: { userId_workId: { userId, workId } } });
      if (existing) {
        await prisma.workLike.delete({ where: { userId_workId: { userId, workId } } });
      } else {
        await prisma.workLike.create({ data: { userId, workId } });
      }

      const likeCount = await prisma.workLike.count({ where: { workId } });
      return reply.send({ success: true, message: existing ? 'Unliked' : 'Liked', data: { liked: !existing, likeCount } });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });

  // 获取作品详情（含点赞数和是否已点赞）
  app.get('/:id', {
    schema: {
      tags: ['Works'], summary: '获取作品详情',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
      querystring: { type: 'object', properties: { userId: { type: 'string', description: '当前用户 ID' } } }
    }
  }, async (request, reply) => {
    try {
      const workId = Number((request.params as any).id);
      const { userId } = request.query as { userId?: string };
      if (!Number.isInteger(workId) || workId <= 0) {
        return reply.code(400).send({ success: false, message: 'id must be a positive integer', error: 'INVALID_ID' });
      }
      const work = await prisma.work.findUnique({
        where: { id: workId },
        select: { ...workFields, description: true, generate3d: true }
      });
      if (!work) return reply.code(404).send({ success: false, message: 'Work not found', error: 'WORK_NOT_FOUND' });

      const liked = userId
        ? !!(await prisma.workLike.findUnique({ where: { userId_workId: { userId, workId } } }))
        : false;

      const { _count, ...rest } = work as any;
      return reply.send({ success: true, message: 'Work fetched successfully', data: { ...rest, likeCount: _count.likes, liked } });
    } catch (error: any) {
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}
