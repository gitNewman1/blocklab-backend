import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { LocalStorageService } from '../../services/local-storage.service';
import { UploadedFile } from '../../types';

const prisma = new PrismaClient();
const storageService = new LocalStorageService();

export async function recommendedModelsRoutes(app: FastifyInstance) {
  app.post('/upload', async (request, reply) => {
    try {
      const parts = request.parts();
      const fields: Record<string, string> = {};
      const files: Record<string, UploadedFile> = {};
      const detailImages: UploadedFile[] = [];

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          const file: UploadedFile = {
            filename: part.filename,
            mimetype: part.mimetype,
            encoding: part.encoding,
            data: buffer
          };
          if (part.fieldname === 'detail_images') {
            detailImages.push(file);
          } else {
            files[part.fieldname] = file;
          }
        } else {
          fields[part.fieldname] = String(part.value ?? '');
        }
      }

      const { set_number, name, part_count, price, age_rating, series, description } = fields;

      if (!set_number || !name || !part_count || !price || !files.cover_image || !files.display_image) {
        return reply.code(400).send({
          success: false,
          message: 'Missing required fields: set_number, name, part_count, price, cover_image, display_image',
          error: 'MISSING_REQUIRED_FIELD'
        });
      }

      const partCountNum = parseInt(part_count, 10);
      const priceNum = parseFloat(price);
      if (!Number.isInteger(partCountNum) || partCountNum <= 0 || !Number.isFinite(priceNum) || priceNum < 0) {
        return reply.code(400).send({
          success: false,
          message: 'part_count must be a positive integer, price must be a non-negative number',
          error: 'INVALID_FIELD'
        });
      }

      const [coverUrl, displayUrl, ...detailUrlResults] = await Promise.all([
        storageService.uploadFile(files.cover_image, 'recommended/covers'),
        storageService.uploadFile(files.display_image, 'recommended/displays'),
        ...detailImages.map((f) => storageService.uploadFile(f, 'recommended/details'))
      ]);

      const model = await prisma.recommendedModel.create({
        data: {
          setNumber: set_number,
          name,
          series: series || null,
          partCount: partCountNum,
          price: priceNum,
          ageRating: age_rating || null,
          description: description || null,
          coverUrl,
          displayUrl,
          detailUrls: detailUrlResults
        }
      });

      return reply.send({ success: true, message: '推荐模型上传成功', data: model });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Recommended model upload failed');
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
    }
  });
}
