import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { LocalStorageService } from '../../services/local-storage.service';
import { IOParserService } from '../../services/io-parser.service';
import { RebrickableService } from '../../services/rebrickable.service';
import { UploadedFile } from '../../types';

const prisma = new PrismaClient();
const storageService = new LocalStorageService();
const ioParserService = new IOParserService();
const rebrickableService = new RebrickableService();
const allowedThumbnailExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function modelsRoutes(app: FastifyInstance) {
  app.post('/upload', async (request, reply) => {
    try {
      request.log.info('Start processing model upload request');

      const parts = request.parts();
      const files: Record<string, UploadedFile> = {};
      let name = '';
      let confirmDuplicate = false;

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          files[part.fieldname] = {
            filename: part.filename,
            mimetype: part.mimetype,
            encoding: part.encoding,
            data: buffer
          };
          continue;
        }

        if (part.fieldname === 'name') {
          name = String(part.value || '');
        }
        if (part.fieldname === 'confirm_duplicate') {
          const raw = String(part.value || '').toLowerCase();
          confirmDuplicate = raw === 'true' || raw === '1' || raw === 'yes';
        }
      }

      if (!name || !files.io_file || !files.glb_file) {
        return reply.code(400).send({
          success: false,
          message: 'Missing required fields: name, io_file, glb_file',
          error: 'MISSING_REQUIRED_FIELD'
        });
      }
      if (!hasFileExtension(files.io_file.filename, '.io')) {
        return reply.code(400).send({
          success: false,
          message: 'io_file must be a .io file',
          error: 'INVALID_IO_FILE'
        });
      }
      if (!hasFileExtension(files.glb_file.filename, '.glb')) {
        return reply.code(400).send({
          success: false,
          message: 'glb_file must be a .glb file',
          error: 'INVALID_GLB_FILE'
        });
      }
      if (files.thumbnail && !hasOneOfExtensions(files.thumbnail.filename, allowedThumbnailExts)) {
        return reply.code(400).send({
          success: false,
          message: 'thumbnail must be one of .jpg, .jpeg, .png, .webp',
          error: 'INVALID_THUMBNAIL_FILE'
        });
      }

      const duplicateCount = await prisma.model.count({
        where: { name }
      });
      if (duplicateCount > 0 && !confirmDuplicate) {
        request.log.warn(
          { modelName: name, duplicateCount },
          'Duplicate model name detected, confirmation required'
        );
        return reply.code(409).send({
          success: false,
          message: 'Model name already exists, confirmation required',
          error: 'DUPLICATE_MODEL_NAME',
          data: {
            modelName: name,
            existingCount: duplicateCount
          }
        });
      }

      const [ioUrl, glbUrl, thumbUrl] = await Promise.all([
        storageService.uploadFile(files.io_file, 'io-files'),
        storageService.uploadFile(files.glb_file, 'models-3d'),
        files.thumbnail ? storageService.uploadFile(files.thumbnail, 'thumbnails') : Promise.resolve(null)
      ]);

      const parsed = await ioParserService.parseIOFileBuffer(files.io_file.data);
      request.log.info(
        {
          parsedPartsCount: parsed.parts.length,
          parsedStepsCount: parsed.steps.length
        },
        'IO parsing completed'
      );

      const enrichedParts = await rebrickableService.enrichParts(parsed.parts, request.log);
      const partsWithoutName = enrichedParts.filter((part) => !part.name).length;
      request.log.info(
        {
          enrichedPartsCount: enrichedParts.length,
          partsWithoutName
        },
        'Rebrickable enrichment completed'
      );

      const model = await prisma.model.create({
        data: {
          name,
          thumbnailUrl: thumbUrl,
          ioFileUrl: ioUrl,
          model3dUrl: glbUrl,
          partsJson: enrichedParts as any,
          stepsJson: parsed.steps as any
        }
      });

      return reply.send({
        success: true,
        message: 'Model uploaded successfully',
        data: model
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Model upload failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });
}

function hasFileExtension(filename: string, ext: string): boolean {
  return filename.toLowerCase().endsWith(ext.toLowerCase());
}

function hasOneOfExtensions(filename: string, exts: Set<string>): boolean {
  const lower = filename.toLowerCase();
  for (const ext of exts) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}
