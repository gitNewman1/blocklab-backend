import { FastifyInstance } from 'fastify';
import { LocalStorageService } from '../../services/local-storage.service';

const AVATAR_FOLDER = 'avatars';

// 头像允许的图片 MIME 类型(与作品封面上传保持一致,小程序 chooseAvatar 通常返回 jpeg/png/webp)
const ALLOWED_AVATAR_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp'
]);

export async function avatarUploadRoutes(app: FastifyInstance) {
  const storageService = new LocalStorageService();

  app.post(
    '/upload-avatar',
    {
      schema: {
        tags: ['Auth'],
        summary: '上传头像图片(保存到 uploads/avatars/,返回可访问的 URL)',
        description:
          '上传单张头像图片(multipart/form-data,字段名 file),支持 jpeg/png/webp/gif/bmp,返回图片的公开访问 URL。' +
          '拿到 URL 后再随登录请求的 avatarUrl 一起提交,后端会持久化到用户资料。',
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
                  url: { type: 'string' }
                }
              }
            }
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              error: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const parts = request.parts();
        let fileBuffer: Buffer | null = null;
        let filename = '';
        let mimetype = '';

        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'file') {
            if (!ALLOWED_AVATAR_TYPES.has(part.mimetype)) {
              await part.toBuffer();
              return reply.code(400).send({
                success: false,
                message: `不支持的文件格式: ${part.mimetype}`,
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
            message: '请选择要上传的图片(字段名: file)',
            error: 'MISSING_FILE'
          });
        }

        const url = await storageService.uploadFile(
          { filename, mimetype, encoding: 'binary', data: fileBuffer },
          AVATAR_FOLDER
        );

        request.log.info({ url, size: fileBuffer.length, type: mimetype }, 'Avatar uploaded');

        return reply.send({
          success: true,
          message: '头像上传成功',
          data: { url }
        });
      } catch (error: any) {
        request.log.error({ error: error.message, stack: error.stack }, 'Avatar upload failed');
        return reply.code(500).send({
          success: false,
          message: error.message,
          error: 'UPLOAD_FAILED'
        });
      }
    }
  );
}
