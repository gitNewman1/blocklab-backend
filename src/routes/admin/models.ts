import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { OBSService } from '../../services/obs.service';
import { IOParserService } from '../../services/io-parser.service';

const prisma = new PrismaClient();
const obsService = new OBSService();
const ioParserService = new IOParserService();

export async function modelsRoutes(app: FastifyInstance) {
  app.post('/upload', async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({
          success: false,
          message: '缺少文件',
          error: 'MISSING_FILE'
        });
      }

      const parts = request.parts();
      const files: any = {};
      let name = '';

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          files[part.fieldname] = {
            filename: part.filename,
            mimetype: part.mimetype,
            encoding: part.encoding,
            data: buffer
          };
        } else {
          if (part.fieldname === 'name') {
            name = part.value as string;
          }
        }
      }

      if (!name || !files.io_file || !files.glb_file) {
        return reply.code(400).send({
          success: false,
          message: '缺少必填参数: name, io_file, glb_file',
          error: 'MISSING_REQUIRED_FIELD'
        });
      }

      const [ioUrl, glbUrl, thumbUrl] = await Promise.all([
        obsService.uploadFile(files.io_file, 'io-files'),
        obsService.uploadFile(files.glb_file, '3d-models'),
        files.thumbnail ? obsService.uploadFile(files.thumbnail, 'thumbnails') : Promise.resolve(null)
      ]);

      const ioContent = files.io_file.data.toString('utf-8');
      const parsed = await ioParserService.parseIOFile(ioContent);

      const model = await prisma.model.create({
        data: {
          name,
          thumbnailUrl: thumbUrl,
          ioFileUrl: ioUrl,
          model3dUrl: glbUrl,
          partsJson: parsed.parts,
          stepsJson: parsed.steps
        }
      });

      return reply.send({
        success: true,
        message: '模型上传成功',
        data: model
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });
}
