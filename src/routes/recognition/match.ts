import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type InputPart = {
  name: string;
  quantity: number;
};

export async function recognitionMatchRoutes(app: FastifyInstance) {
  app.post('/match', async (request, reply) => {
    try {
      const inputParts = parseInputParts((request.body as { parts?: unknown })?.parts);
      if (inputParts.length === 0) {
        return reply.code(400).send({
          success: false,
          message: 'parts is required and each item needs a valid name/class and quantity > 0',
          error: 'INVALID_PARTS_PAYLOAD'
        });
      }

      const requestSignature = buildNameQuantitySignature(inputParts);
      request.log.info(
        { requestPartCount: inputParts.length },
        'Start recognition match by part-name and quantity'
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
        'Finished recognition match'
      );

      return reply.send({
        success: true,
        message: 'Recognition matching completed',
        data: matched.map((model) => ({
          id: model.id,
          name: model.name,
          thumbnailUrl: model.thumbnailUrl,
          ioFileUrl: model.ioFileUrl,
          model3dUrl: model.model3dUrl
        }))
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Recognition match failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });
}

function parseInputParts(parts: unknown): InputPart[] {
  if (!Array.isArray(parts)) {
    return [];
  }

  const out: InputPart[] = [];
  for (const item of parts) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const part = item as Record<string, unknown>;
    const nameRaw = String(part.name || part.class || '').trim();
    const quantityRaw = part.quantity ?? 1;
    const quantity = Number(quantityRaw);
    if (!nameRaw || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    out.push({
      name: nameRaw,
      quantity
    });
  }

  return out;
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
