import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { config } from '../../config';

// 测试库（读模型、写 synced_models 台账）
const prisma = new PrismaClient();

// 生产库连接（惰性创建）：仅当配置了 PROMOTE_DATABASE_URL 时可用
let prodPrisma: PrismaClient | null = null;

// 积木模型晋级（测试 → 生产）：把测试库的模型数据与文件同步到生产环境。
// 约束见 /srv/blocklab/积木模型文件硬链接共享方案.md 第 7 节：
// - 文件步骤在前（硬链接，天然幂等），数据库事务在后，任何一步失败可安全重跑；
// - 生产侧写库仅允许通过本接口（生产 .env 不配置 PROMOTE_DATABASE_URL，接口在生产自动 403）；
// - 不删任何文件、不改测试侧任何 URL；生产行 URL 前缀按环境重写；
// - 成功后写测试库 synced_models 台账。
const PROD_DATABASE_URL = process.env.PROMOTE_DATABASE_URL || '';

function getProdPrisma(): PrismaClient | null {
  if (!PROD_DATABASE_URL) return null;
  if (!prodPrisma) {
    prodPrisma = new PrismaClient({
      datasources: { db: { url: PROD_DATABASE_URL } }
    });
  }
  return prodPrisma;
}

const TEST_UPLOAD_ROOT = config.storage.uploadRoot; // /data/blocklab-test/uploads
const PROD_UPLOAD_ROOT = TEST_UPLOAD_ROOT.includes('blocklab-test')
  ? TEST_UPLOAD_ROOT.replace('blocklab-test', 'blocklab')
  : '';
const TEST_STATIC_PREFIX = `${config.storage.publicBaseUrl.replace(/\/$/, '')}/static/`;
const PROD_STATIC_PREFIX = TEST_STATIC_PREFIX.includes('blocklab-test')
  ? TEST_STATIC_PREFIX.replace('blocklab-test', 'blocklab')
  : '';

// 从 URL 提取 static/ 下的相对路径（如 io-files/xxx.io）
function urlToRelPath(url: string): string | null {
  const idx = url.indexOf('/static/');
  if (idx < 0) return null;
  return url.slice(idx + '/static/'.length);
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// 把单个文件从测试目录硬链接到生产目录；返回 null=成功，否则返回错误消息
function hardlinkFile(relPath: string): string | null {
  if (!PROD_UPLOAD_ROOT) return '无法推导生产上传目录（UPLOAD_ROOT 未含 blocklab-test）';
  const src = path.join(TEST_UPLOAD_ROOT, relPath);
  const dst = path.join(PROD_UPLOAD_ROOT, relPath);
  if (!fs.existsSync(src)) return `测试侧文件不存在: ${relPath}`;
  if (fs.existsSync(dst)) {
    // 已存在：同一 inode（已是硬链接）或内容一致都视为成功
    if (fs.statSync(src).ino === fs.statSync(dst).ino) return null;
    if (sha256(src) === sha256(dst)) return null;
    return `生产侧已存在同名但内容不一致的文件: ${relPath}`;
  }
  fs.linkSync(src, dst);
  return null;
}

interface SyncItemResult {
  id: number;
  ok: boolean;
  message: string;
}

export async function modelSyncRoutes(app: FastifyInstance) {
  // 批量晋级：body { ids: number[] }，单个同步传 [id] 即可
  app.post('/sync', async (request, reply) => {
    const prod = getProdPrisma();
    if (!prod) {
      return reply.code(403).send({
        success: false,
        message: '未配置 PROMOTE_DATABASE_URL，模型同步功能不可用',
        error: 'SYNC_DISABLED'
      });
    }

    const body = (request.body || {}) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : [];
    if (!ids.length) {
      return reply.code(400).send({
        success: false,
        message: 'ids must be a non-empty array of positive integers',
        error: 'INVALID_IDS'
      });
    }
    const uniqueIds = [...new Set(ids)];

    await prod.$connect();
    const results: SyncItemResult[] = [];

    for (const id of uniqueIds) {
      try {
        // 1) 测试库取模型（含分类）
        const model = await prisma_model(id);
        if (!model) {
          results.push({ id, ok: false, message: '测试库不存在该模型' });
          continue;
        }

        // 2) 前置检查：生产已存在则跳过（幂等），确保台账补齐
        const existsInProd = await prod.model.findUnique({ where: { id }, select: { id: true } });
        if (existsInProd) {
          await markSynced(id);
          results.push({ id, ok: true, message: '已存在于生产库，跳过（台账已补记）' });
          continue;
        }

        // 3) 重名检查：与生产现有其他模型重名则拒绝（接口判重逻辑脚本直插不会触发，需自行覆盖）
        const nameDup = await prod.model.findFirst({
          where: { name: model.name, NOT: { id } },
          select: { id: true }
        });
        if (nameDup) {
          results.push({ id, ok: false, message: `生产库已有同名模型（id=${nameDup.id}），拒绝同步` });
          continue;
        }

        // 4) 文件硬链接：四类 URL 文件 + 分步动画 assembly_{id}.glb，任一失败即中止该项
        const relPaths = new Set<string>();
        let urlError: string | null = null;
        for (const url of [model.ioFileUrl, model.manualUrl, model.thumbnailUrl, model.model3dUrl]) {
          if (!url) continue;
          const rel = urlToRelPath(url);
          if (!rel) {
            urlError = `URL 不含 /static/ 前缀，无法映射文件: ${url}`;
            break;
          }
          relPaths.add(rel);
        }
        if (urlError) {
          results.push({ id, ok: false, message: urlError });
          continue;
        }
        relPaths.add(`parts/assembly_${id}.glb`);
        let fileError: string | null = null;
        for (const rel of relPaths) {
          fileError = hardlinkFile(rel);
          if (fileError) break;
        }
        if (fileError) {
          results.push({ id, ok: false, message: `文件硬链接失败: ${fileError}` });
          continue;
        }

        // 5) 生产库事务：补齐分类（按 name 判重、重映射 id）→ 显式 ID 插入模型行 → 校正序列
        //    URL 前缀按环境重写（blocklab-test → blocklab）
        await prod.$transaction(async tx => {
          let prodModelTypeId: number | null = null;
          if (model.modelTypeId != null && model.modelType) {
            const sameId = await tx.modelType.findUnique({ where: { id: model.modelTypeId }, select: { id: true } });
            if (sameId) {
              prodModelTypeId = model.modelTypeId;
            } else {
              const sameName = await tx.modelType.findFirst({ where: { name: model.modelType.name }, select: { id: true } });
              if (sameName) {
                prodModelTypeId = sameName.id;
              } else {
                await tx.modelType.create({
                  data: { id: model.modelTypeId, name: model.modelType.name, createdAt: model.modelType.createdAt }
                });
                prodModelTypeId = model.modelTypeId;
              }
              await tx.$executeRawUnsafe(
                `SELECT setval('model_types_id_seq', GREATEST((SELECT last_value FROM model_types_id_seq), (SELECT COALESCE(MAX(id), 1) FROM model_types)), true)`
              );
            }
          }

          const rewrite = (url: string | null): string | null =>
            url ? url.replace(TEST_STATIC_PREFIX, PROD_STATIC_PREFIX) : null;

          await tx.model.create({
            data: {
              id: model.id,
              name: model.name,
              partCount: model.partCount,
              thumbnailUrl: rewrite(model.thumbnailUrl),
              manualUrl: rewrite(model.manualUrl),
              ioFileUrl: rewrite(model.ioFileUrl)!,
              model3dUrl: rewrite(model.model3dUrl),
              partsJson: model.partsJson === undefined ? null : (model.partsJson as any),
              stepsJson: model.stepsJson === undefined ? null : (model.stepsJson as any),
              createdAt: model.createdAt,
              modelTypeId: prodModelTypeId
            }
          });

          await tx.$executeRawUnsafe(
            `SELECT setval('models_id_seq', GREATEST((SELECT last_value FROM models_id_seq), (SELECT COALESCE(MAX(id), 1) FROM models)), true)`
          );
        });

        // 6) 写测试库台账
        await markSynced(id);
        results.push({ id, ok: true, message: '同步成功' });
      } catch (err: any) {
        results.push({ id, ok: false, message: `同步失败: ${err.message}` });
      }
    }

    const failed = results.filter(r => !r.ok);
    return reply.send({
      success: failed.length === 0,
      message: failed.length === 0 ? '全部同步成功' : '部分模型同步失败',
      data: { results }
    });
  });
}

// 测试库读取模型完整行（含分类与 JSON 字段）
function prisma_model(id: number) {
  return prisma.model.findUnique({
    where: { id },
    include: { modelType: true }
  });
}

// 台账置位（测试库）
async function markSynced(id: number) {
  await prisma.syncedModels.upsert({
    where: { modelId: id },
    create: { modelId: id },
    update: {}
  });
}
