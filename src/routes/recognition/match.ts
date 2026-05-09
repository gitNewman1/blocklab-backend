import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type InputPart = {
  name: string;
  quantity: number;
};

type ModelVector = {
  id: number;
  name: string;
  partCount: number;
  modelTypeId: number | null;
  modelTypeName: string | null;
  thumbnailUrl: string | null;
  manualUrl: string | null;
  ioFileUrl: string;
  model3dUrl: string;
  partsJson: unknown;
  vector: Map<string, number>;
};

type ScoredMatch = {
  id: number;
  name: string;
  partCount: number;
  modelTypeId: number | null;
  modelTypeName: string | null;
  thumbnailUrl: string | null;
  manualUrl: string | null;
  ioFileUrl: string;
  model3dUrl: string;
  matchType: 'exact' | 'fuzzy';
  similarity: number;
  matchedQty: number;
  missingPartCount: number;
  missingParts: MissingPart[];
};

type MissingPart = {
  designId: string | null;
  imgUrl: string | null;
  name: string | null;
  missingQuantity: number;
};

export async function recognitionMatchRoutes(app: FastifyInstance) {
  app.post(
    '/json-match',
    {
      schema: {
        tags: ['Recognition'],
        summary: '根据零件 JSON 匹配候选模型',
        body: {
          type: 'object',
          required: ['parts'],
          properties: {
            parts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1 }
                }
              }
            },
            userId: { type: 'string' }
          }
        },
        response: {
          200: {
            description: '成功返回匹配结果',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                    thumbnailUrl: { type: ['string', 'null'] },
                    manualUrl: { type: ['string', 'null'] },
                    ioFileUrl: { type: 'string' },
                    model3dUrl: { type: 'string' },
                    matchType: { type: 'string', enum: ['exact', 'fuzzy'] },
                    score: { type: 'number' }
                  }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
    try {
      const body = request.body as { parts?: unknown; userId?: string };
      const inputParts = parseInputParts(body?.parts);
      if (inputParts.length === 0) {
        return reply.code(400).send({
          success: false,
          message: 'parts is required and each item needs a valid name/class and quantity > 0',
          error: 'INVALID_PARTS_PAYLOAD'
        });
      }

      const requestVector = buildVector(inputParts);
      request.log.info(
        { requestPartCount: inputParts.length, requestUniqueCount: requestVector.size },
        'Start recognition match by part-name and quantity'
      );

      const models = await prisma.model.findMany({
        select: {
          id: true,
          name: true,
          partCount: true,
          modelTypeId: true,
          thumbnailUrl: true,
          manualUrl: true,
          ioFileUrl: true,
          model3dUrl: true,
          partsJson: true,
          modelType: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      const modelVectors: ModelVector[] = models
        .map((model) => ({
          id: model.id,
          name: model.name,
          partCount: model.partCount,
          modelTypeId: model.modelType?.id ?? model.modelTypeId ?? null,
          modelTypeName: model.modelType?.name ?? null,
          thumbnailUrl: model.thumbnailUrl,
          manualUrl: model.manualUrl,
          ioFileUrl: model.ioFileUrl,
          model3dUrl: model.model3dUrl,
          partsJson: model.partsJson,
          vector: buildVector(extractNameQuantityFromPartsJson(model.partsJson))
        }))
        .filter((m) => m.vector.size > 0);

      const scoredMatches: ScoredMatch[] = modelVectors.map((model) => {
        const matchedQty = calculateMatchedQty(requestVector, model.vector);
        const modelTotalQty = sumVector(model.vector);
        const similarity = calculateModelCoverageScore(matchedQty, modelTotalQty);
        const matchType: 'exact' | 'fuzzy' = similarity >= 1 ? 'exact' : 'fuzzy';
        const missingParts = calculateMissingParts(requestVector, model.partsJson);
        const missingPartCount = missingParts.reduce((sum, item) => sum + item.missingQuantity, 0);
        return {
          id: model.id,
          name: model.name,
          partCount: model.partCount,
          modelTypeId: model.modelTypeId,
          modelTypeName: model.modelTypeName,
          thumbnailUrl: model.thumbnailUrl,
          manualUrl: model.manualUrl,
          ioFileUrl: model.ioFileUrl,
          model3dUrl: model.model3dUrl,
          matchType,
          similarity,
          matchedQty,
          missingPartCount,
          missingParts
        };
      });

      scoredMatches.sort(sortByRule);
      const topMatches = scoredMatches.slice(0, 4);
      const exactCount = scoredMatches.filter((item) => item.matchType === 'exact').length;

      request.log.info(
        {
          totalModelsCompared: modelVectors.length,
          exactCount,
          returnedCount: topMatches.length,
          mode: 'coverage_top4'
        },
        'Finished recognition match'
      );

      if (body.userId) {
        await prisma.user.updateMany({ where: { id: body.userId }, data: { scanCount: { increment: 1 } } });
      }
      return reply.send({
        success: true,
        message: 'Recognition matching completed',
        data: topMatches.map(toResponseItem)
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Recognition match failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
    }
  );
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

function buildVector(parts: InputPart[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const part of parts) {
    const key = normalizeName(part.name);
    if (!key) {
      continue;
    }
    map.set(key, (map.get(key) || 0) + part.quantity);
  }
  return map;
}

function sumVector(vector: Map<string, number>): number {
  let sum = 0;
  for (const qty of vector.values()) {
    sum += qty;
  }
  return sum;
}

function calculateMatchedQty(
  requestVector: Map<string, number>,
  modelVector: Map<string, number>
): number {
  let matchedQty = 0;
  for (const [key, requiredQty] of modelVector.entries()) {
    const detectedQty = requestVector.get(key) || 0;
    matchedQty += Math.min(detectedQty, requiredQty);
  }
  return matchedQty;
}

function calculateModelCoverageScore(matchedQty: number, modelTotalQty: number): number {
  if (modelTotalQty <= 0) {
    return 0;
  }
  return matchedQty / modelTotalQty;
}

function calculateMissingParts(
  requestVector: Map<string, number>,
  partsJson: unknown
): MissingPart[] {
  if (!Array.isArray(partsJson)) {
    return [];
  }

  const missingParts: MissingPart[] = [];
  for (const item of partsJson) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const part = item as Record<string, unknown>;
    const name = typeof part.name === 'string' ? part.name.trim() : '';
    const key = normalizeName(name);
    const requiredQty = Number(part.quantity || 0);
    if (!key || !Number.isFinite(requiredQty) || requiredQty <= 0) {
      continue;
    }

    const detectedQty = requestVector.get(key) || 0;
    const missingQuantity = Math.max(requiredQty - detectedQty, 0);
    if (missingQuantity <= 0) {
      continue;
    }

    missingParts.push({
      designId: typeof part.designID === 'string' ? part.designID : null,
      imgUrl: typeof part.imgUrl === 'string' ? part.imgUrl : null,
      name: name || null,
      missingQuantity
    });
  }

  return missingParts;
}

function sortByRule(a: ScoredMatch, b: ScoredMatch): number {
  if (b.similarity !== a.similarity) {
    return b.similarity - a.similarity;
  }
  if (b.partCount !== a.partCount) {
    return b.partCount - a.partCount;
  }
  if (b.matchedQty !== a.matchedQty) {
    return b.matchedQty - a.matchedQty;
  }
  return a.id - b.id;
}

function toResponseItem(item: ScoredMatch) {
  const score = Number((item.similarity * 100).toFixed(2));
  return {
    id: item.id,
    name: item.name,
    partCount: item.partCount,
    modelTypeId: item.modelTypeId,
    modelTypeName: item.modelTypeName,
    thumbnailUrl: item.thumbnailUrl,
    manualUrl: item.manualUrl,
    ioFileUrl: item.ioFileUrl,
    model3dUrl: item.model3dUrl,
    matchType: item.matchType,
    score,
    missingPartCount: item.missingPartCount,
    missingParts: item.missingParts
  };
}
