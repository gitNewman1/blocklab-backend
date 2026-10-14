import { FastifyInstance } from 'fastify';
import { optionalAuth } from '../../plugins/auth';
import { LocalStorageService } from '../../services/local-storage.service';

const IMAGE_FOLDER = 'images';

// 允许的图片 MIME 类型（与 admin 端一致）
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp'
]);

/**
 * 用户端图片上传（拍照/相册/反馈截图共用）。
 * 可选鉴权：匿名可传（如反馈截图），带 token 也不影响流程。
 */
export async function userUploadRoutes(app: FastifyInstance) {
  const storageService = new LocalStorageService();

  app.post(
    '/image',
    {
      preHandler: optionalAuth,
      schema: {
        tags: ['Upload'],
        summary: '上传图片（用户端：发布作品/反馈截图，无需登录）',
        description:
          '上传单张图片（multipart/form-data，字段名 image），支持 jpeg/png/gif/webp/bmp，返回图片的公开访问 URL。',
        consumes: ['multipart/form-data'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: { url: { type: 'string' } }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        if (!/multipart\/form-data/i.test(request.headers['content-type'] ?? '')) {
          return reply.code(400).send({
            success: false,
            message: '请使用 multipart/form-data 上传图片（字段名: image）',
            error: 'MISSING_FILE'
          });
        }
        const parts = request.parts();
        let fileBuffer: Buffer | null = null;
        let filename = '';
        let mimetype = '';

        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'image') {
            if (!ALLOWED_IMAGE_TYPES.has(part.mimetype)) {
              await part.toBuffer();
              return reply.code(400).send({
                success: false,
                message: `不支持的图片格式: ${part.mimetype}`,
                error: 'INVALID_FILE_TYPE'
              });
            }
            fileBuffer = await part.toBuffer();
            filename = part.filename;
            mimetype = part.mimetype;
            break;
          }
        }

        if (!fileBuffer) {
          return reply.code(400).send({
            success: false,
            message: '请选择要上传的图片（字段名: image）',
            error: 'MISSING_FILE'
          });
        }

        const url = await storageService.uploadFile(
          { filename, mimetype, encoding: 'binary', data: fileBuffer },
          IMAGE_FOLDER
        );

        request.log.info({ url, size: fileBuffer.length, type: mimetype }, 'user image uploaded');
        return reply.send({ success: true, message: '图片上传成功', data: { url } });
      } catch (error: any) {
        request.log.error({ error: error.message, stack: error.stack }, 'user image upload failed');
        return reply.code(500).send({ success: false, message: error.message, error: 'UPLOAD_FAILED' });
      }
    }
  );
}
