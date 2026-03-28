import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type InputPart = {
  name: string;
  quantity: number;
};

export async function modelMatchingRoutes(app: FastifyInstance) {
  app.post('/match-by-parts', async (request, reply) => {
    try {
      const body = request.body as { parts?: unknown };
      const rawParts = Array.isArray(body?.parts) ? body.parts : null;
      if (!rawParts || rawParts.length === 0) {
        return reply.code(400).send({
          success: false,
          message: 'parts is required and must be a non-empty array',
          error: 'INVALID_PARTS_PAYLOAD'
        });
      }

      const inputParts: InputPart[] = [];
      for (const item of rawParts) {
        if (!item || typeof item !== 'object') {
          return reply.code(400).send({
            success: false,
            message: 'each part must be an object: { name, quantity }',
            error: 'INVALID_PART_ITEM'
          });
        }
        const part = item as Record<string, unknown>;
        const name = String(part.name || '').trim();
        const quantity = Number(part.quantity || 0);
        if (!name || !Number.isFinite(quantity) || quantity <= 0) {
          return reply.code(400).send({
            success: false,
            message: 'each part requires valid name and quantity > 0',
            error: 'INVALID_PART_ITEM'
          });
        }
        inputParts.push({ name, quantity });
      }

      const requestSignature = buildNameQuantitySignature(inputParts);
      request.log.info(
        { requestPartCount: inputParts.length, requestSignature },
        'Start matching models by part-name and quantity'
      );

      const models = await prisma.model.findMany({
        select: {
          id: true,
          name: true,
          thumbnailUrl: true,
          ioFileUrl: true,
          model3dUrl: true,
          partsJson: true
        }
      });

      const matched = models.filter((model) => {
        const modelParts = extractNameQuantityFromPartsJson(model.partsJson);
        const modelSignature = buildNameQuantitySignature(modelParts);
        return modelSignature.length > 0 && modelSignature === requestSignature;
      });

      request.log.info(
        {
          totalModelsCompared: models.length,
          matchedCount: matched.length
        },
        'Finished matching models by part-name and quantity'
      );

      return reply.send({
        success: true,
        message: 'Model matching completed',
        data: matched.map((model) => ({
          id: model.id,
          name: model.name,
          thumbnailUrl: model.thumbnailUrl,
          downloadPaths: {
            ioFileUrl: model.ioFileUrl,
            model3dUrl: model.model3dUrl
          }
        }))
      });
    } catch (error: any) {
      request.log.error(
        { error: error.message, stack: error.stack },
        'Match-by-parts request failed'
      );
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });
}

function extractNameQuantityFromPartsJson(partsJson: unknown): InputPart[] {
  if (!Array.isArray(partsJson)) {
    return [];
  }

  const out: InputPart[] = [];
  for (const item of partsJson) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const part = item as Record<string, unknown>;
    const name = String(part.name || '').trim();
    const quantity = Number(part.quantity || 0);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    out.push({ name, quantity });
  }
  return out;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildNameQuantitySignature(parts: InputPart[]): string {
  const map = new Map<string, number>();
  for (const part of parts) {
    const key = normalizeName(part.name);
    if (!key) {
      continue;
    }
    map.set(key, (map.get(key) || 0) + part.quantity);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, quantity]) => `${name}:${quantity}`)
    .join('|');
}
