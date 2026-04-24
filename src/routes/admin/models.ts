import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { LocalStorageService } from '../../services/local-storage.service';
import { IOParserService } from '../../services/io-parser.service';
import { RebrickableService } from '../../services/rebrickable.service';
import { Part, UploadedFile } from '../../types';

const prisma = new PrismaClient();
const storageService = new LocalStorageService();
const ioParserService = new IOParserService();
const rebrickableService = new RebrickableService();
const allowedManualExts = new Set(['.pdf']);

export async function modelsRoutes(app: FastifyInstance) {
  app.post('/upload', async (request, reply) => {
    try {
      request.log.info('Start processing model upload request');

      const parts = request.parts();
      const files: Record<string, UploadedFile> = {};
      let name = '';
      let modelTypeId: number | null = null;
      let confirmDuplicate = false;
      let confirmExactMatch = false;

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
        if (part.fieldname === 'model_type_id') {
          const parsedModelTypeId = Number(part.value);
          modelTypeId = Number.isInteger(parsedModelTypeId) && parsedModelTypeId > 0 ? parsedModelTypeId : null;
        }
        if (part.fieldname === 'confirm_duplicate') {
          const raw = String(part.value || '').toLowerCase();
          confirmDuplicate = raw === 'true' || raw === '1' || raw === 'yes';
        }
        if (part.fieldname === 'confirm_exact_match') {
          const raw = String(part.value || '').toLowerCase();
          confirmExactMatch = raw === 'true' || raw === '1' || raw === 'yes';
        }
      }

      if (!name || !modelTypeId || !files.io_file || !files.glb_file) {
        return reply.code(400).send({
          success: false,
          message: 'Missing required fields: name, model_type_id, io_file, glb_file',
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
      if (files.manual_file && !hasOneOfExtensions(files.manual_file.filename, allowedManualExts)) {
        return reply.code(400).send({
          success: false,
          message: 'manual_file must be a .pdf file',
          error: 'INVALID_MANUAL_FILE'
        });
      }

      const modelType = await prisma.modelType.findUnique({
        where: { id: modelTypeId },
        select: { id: true, name: true }
      });
      if (!modelType) {
        return reply.code(400).send({
          success: false,
          message: 'model_type_id does not exist',
          error: 'INVALID_MODEL_TYPE_ID'
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

      const parsed = await ioParserService.parseIOFileBuffer(files.io_file.data);
      const partCount = calculatePartCount(parsed.parts);
      request.log.info(
        {
          parsedPartsCount: parsed.parts.length,
          partCount,
          parsedStepsCount: parsed.steps.length,
          ioThumbnailExtracted: !!parsed.extractedThumbnail
        },
        'IO parsing completed'
      );

      const exactMatches = await findExactPartMatches(parsed.parts, request.log);
      if (exactMatches.length > 0 && !confirmExactMatch) {
        request.log.warn(
          {
            modelName: name,
            exactMatchCount: exactMatches.length,
            matchedModelIds: exactMatches.slice(0, 10).map((m) => m.id)
          },
          'Exact parts match detected, confirmation required'
        );
        return reply.code(409).send({
          success: false,
          message: 'Exact parts match exists, confirmation required',
          error: 'DUPLICATE_PARTS_MATCH',
          data: {
            modelName: name,
            matchedCount: exactMatches.length,
            matchedModels: exactMatches.slice(0, 5)
          }
        });
      }

      const thumbnailFile = parsed.extractedThumbnail;
      const [ioUrl, glbUrl, thumbUrl, manualUrl] = await Promise.all([
        storageService.uploadFile(files.io_file, 'io-files'),
        storageService.uploadFile(files.glb_file, 'models-3d'),
        thumbnailFile ? storageService.uploadFile(thumbnailFile, 'thumbnails') : Promise.resolve(null),
        files.manual_file ? storageService.uploadFile(files.manual_file, 'manuals') : Promise.resolve(null)
      ]);

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
          modelTypeId,
          thumbnailUrl: thumbUrl,
          manualUrl,
          ioFileUrl: ioUrl,
          model3dUrl: glbUrl,
          partCount,
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

  app.post('/create', async (request, reply) => {
    try {
      const body = (request.body || {}) as Record<string, unknown>;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return reply.code(400).send({ success: false, message: 'name 为必填项', error: 'MISSING_REQUIRED_FIELD' });
      }

      const rawParts = Array.isArray(body.parts) ? body.parts : [];
      const parts: Array<{ designID: string; quantity: number }> = [];
      for (const item of rawParts) {
        if (!item || typeof item !== 'object') continue;
        const p = item as Record<string, unknown>;
        const designID = typeof p.designID === 'string' ? p.designID.trim() : '';
        const quantity = Number(p.quantity);
        if (!designID || !Number.isFinite(quantity) || quantity <= 0) {
          return reply.code(400).send({ success: false, message: `零件数据无效：designID 和 quantity 为必填项`, error: 'INVALID_PARTS' });
        }
        parts.push({ designID, quantity });
      }
      if (parts.length === 0) {
        return reply.code(400).send({ success: false, message: 'parts 不能为空', error: 'MISSING_REQUIRED_FIELD' });
      }

      const partCount = calculatePartCount(parts);

      const enrichedParts = await rebrickableService.enrichParts(
        parts.map((p) => ({ id: p.designID, designID: p.designID, quantity: p.quantity })),
        request.log
      );

      const model = await prisma.model.create({
        data: {
          name,
          ioFileUrl: '',
          model3dUrl: '',
          partCount,
          partsJson: enrichedParts as any,
          stepsJson: [] as any
        }
      });

      return reply.send({ success: true, message: '模型创建成功', data: model });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Model create failed');
      return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
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

async function findExactPartMatches(
  uploadedParts: Part[],
  logger: FastifyInstance['log']
): Promise<Array<{ id: number; name: string }>> {
  const uploadSignature = buildPartsSignature(uploadedParts);
  if (!uploadSignature) {
    logger.warn('Uploaded parts signature is empty, skip exact match check');
    return [];
  }

  const existingModels = await prisma.model.findMany({
    select: {
      id: true,
      name: true,
      partsJson: true
    }
  });

  const matchedModels: Array<{ id: number; name: string }> = [];
  for (const model of existingModels) {
    const existingParts = extractPartsFromJson(model.partsJson);
    const existingSignature = buildPartsSignature(existingParts);
    if (existingSignature && existingSignature === uploadSignature) {
      matchedModels.push({ id: model.id, name: model.name });
    }
  }

  logger.info(
    {
      comparedModelCount: existingModels.length,
      matchedCount: matchedModels.length
    },
    'Exact parts match check completed'
  );

  return matchedModels;
}

function extractPartsFromJson(partsJson: unknown): Part[] {
  if (!Array.isArray(partsJson)) {
    return [];
  }

  const parts: Part[] = [];
  for (const item of partsJson) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const raw = item as Record<string, unknown>;
    const designID = typeof raw.designID === 'string' ? raw.designID : '';
    const quantity =
      typeof raw.quantity === 'number'
        ? raw.quantity
        : Number.isFinite(Number(raw.quantity))
        ? Number(raw.quantity)
        : 0;
    if (!designID || quantity <= 0) {
      continue;
    }

    parts.push({
      id: typeof raw.id === 'string' ? raw.id : designID,
      designID,
      quantity,
      colorID: typeof raw.colorID === 'string' ? raw.colorID : undefined,
      name: typeof raw.name === 'string' ? raw.name : undefined
    });
  }
  return parts;
}

function buildPartsSignature(parts: Part[]): string {
  const countByDesignId = new Map<string, number>();
  for (const part of parts) {
    const designId = (part.designID || '').trim();
    const quantity = Number(part.quantity) || 0;
    if (!designId || quantity <= 0) {
      continue;
    }
    countByDesignId.set(designId, (countByDesignId.get(designId) || 0) + quantity);
  }

  return Array.from(countByDesignId.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([designId, quantity]) => `${designId}:${quantity}`)
    .join('|');
}

function calculatePartCount(parts: Array<{ quantity: number }>): number {
  let total = 0;
  for (const part of parts) {
    const quantity = Number(part.quantity) || 0;
    if (quantity > 0) {
      total += quantity;
    }
  }
  return total;
}
