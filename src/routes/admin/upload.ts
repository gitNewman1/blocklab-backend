import { FastifyInstance } from 'fastify';
import { LocalStorageService } from '../../services/local-storage.service';

const IMAGE_FOLDER = 'images';
const FILE_FOLDER = 'files';

// 允许的图片 MIME 类型
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp'
]);

// 允许的视频 MIME 类型
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska'
]);

export async function uploadRoutes(app: FastifyInstance) {
  const storageService = new LocalStorageService();

  // 通用文件上传（图片 / 视频 / 其他）
  async function handleFileUpload(
    request: any,
    reply: any,
    fieldName: string,
    allowedTypes: Set<string> | null,
    folder: string,
    typeLabel: string
  ) {
    try {
      const parts = request.parts();
      let fileBuffer: Buffer | null = null;
      let filename = '';
      let mimetype = '';

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === fieldName) {
          if (allowedTypes && !allowedTypes.has(part.mimetype)) {
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
          message: `请选择要上传的文件（字段名: ${fieldName}）`,
          error: 'MISSING_FILE'
        });
      }

      const url = await storageService.uploadFile(
        { filename, mimetype, encoding: 'binary', data: fileBuffer },
        folder
      );

      request.log.info({ url, size: fileBuffer.length, type: mimetype }, `${typeLabel} uploaded`);

      return reply.send({
        success: true,
        message: `${typeLabel}上传成功`,
        data: { url }
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, `${typeLabel} upload failed`);
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'UPLOAD_FAILED'
      });
    }
  }

  app.post(
    '/upload/image',
    {
      schema: {
        tags: ['Admin Data'],
        summary: '上传图片（保存到 uploads/images/，返回可访问的 URL）',
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
                properties: {
                  url: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => handleFileUpload(request, reply, 'image', ALLOWED_IMAGE_TYPES, IMAGE_FOLDER, '图片')
  );

  app.post(
    '/upload/video',
    {
      schema: {
        tags: ['Admin Data'],
        summary: '上传视频（保存到 uploads/files/，返回可访问的 URL）',
        description:
          '上传单文件（multipart/form-data，字段名 video），支持 mp4/webm/ogg/mov/avi/mkv 等视频格式，返回文件的公开访问 URL。',
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
          }
        }
      }
    },
    async (request, reply) => handleFileUpload(request, reply, 'video', ALLOWED_VIDEO_TYPES, FILE_FOLDER, '视频')
  );

  app.post(
    '/upload/file',
    {
      schema: {
        tags: ['Admin Data'],
        summary: '上传任意文件（保存到 uploads/files/，返回可访问的 URL）',
        description:
          '上传任意类型的文件（multipart/form-data，字段名 file），不限格式，返回文件的公开访问 URL。',
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
          }
        }
      }
    },
    async (request, reply) => handleFileUpload(request, reply, 'file', null, FILE_FOLDER, '文件')
  );
}
