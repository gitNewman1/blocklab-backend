import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';

const PARTS_FOLDER = 'parts';

// 文件名应为 {designID}.glb，清洗非法字符并校验扩展名
function sanitizePartFilename(filename: string): string | null {
  const base = path.basename(filename || '');
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!/\.glb$/i.test(clean)) {
    return null;
  }
  return clean;
}

export async function partsRoutes(app: FastifyInstance) {
  app.post(
    '/upload',
    {
      schema: {
        tags: ['Admin Data'],
        summary: '上传零件网格 glb（保存到 uploads/parts/，文件名即 designID.glb）',
        description:
          '支持一次上传多个 .glb（multipart/form-data）。文件名应为 {designID}.glb，例如 3021.glb，保存后通过 /static/parts/3021.glb 访问，供拼装动画逐零件加载。非 .glb 文件会被跳过。同名文件会覆盖。',
        consumes: ['multipart/form-data'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  saved: { type: 'array', items: { type: 'string' } },
                  skipped: { type: 'array', items: { type: 'string' } },
                  count: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const parts = request.parts();
        const dir = path.join(config.storage.uploadRoot, PARTS_FOLDER);
        await fs.promises.mkdir(dir, { recursive: true });

        const saved: string[] = [];
        const skipped: string[] = [];

        for await (const part of parts) {
          if (part.type !== 'file') {
            continue;
          }
          const safeName = sanitizePartFilename(part.filename);
          if (!safeName) {
            // 必须消费文件流，否则会阻塞后续 part
            await part.toBuffer();
            skipped.push(part.filename);
            continue;
          }
          const buffer = await part.toBuffer();
          await fs.promises.writeFile(path.join(dir, safeName), buffer);
          saved.push(safeName);
        }

        if (saved.length === 0 && skipped.length === 0) {
          return reply.code(400).send({
            success: false,
            message: '未收到任何文件',
            error: 'NO_FILE'
          });
        }

        return reply.send({
          success: true,
          message: `上传完成：保存 ${saved.length}，跳过 ${skipped.length}`,
          data: { saved, skipped, count: saved.length }
        });
      } catch (error: any) {
        request.log.error({ error: error.message, stack: error.stack }, 'Upload part meshes failed');
        return reply.code(500).send({
          success: false,
          message: error.message,
          error: 'INTERNAL_ERROR'
        });
      }
    }
  );
}
