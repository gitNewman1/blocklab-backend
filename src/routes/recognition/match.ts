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
  thumbnailUrl: string | null;
  manualUrl: string | null;
  ioFileUrl: string;
  model3dUrl: string;
  vector: Map<string, number>;
};

type ScoredMatch = {
  id: number;
  name: string;
  thumbnailUrl: string | null;
  manualUrl: string | null;
  ioFileUrl: string;
  model3dUrl: string;
  matchType: 'exact' | 'fuzzy';
  similarity: number;
  qtyDiff: number;
};

export async function recognitionMatchRoutes(app: FastifyInstance) {
  app.post('/json-match', async (request, reply) => {
    try {
      const inputParts = parseInputParts((request.body as { parts?: unknown })?.parts);
      if (inputParts.length === 0) {
        return reply.code(400).send({
          success: false,
          message: 'parts is required and each item needs a valid name/class and quantity > 0',
          error: 'INVALID_PARTS_PAYLOAD'
        });
      }

      const requestVector = buildVector(inputParts);
      const requestSignature = buildSignatureFromVector(requestVector);
      const requestTotalQty = sumVector(requestVector);
      request.log.info(
        { requestPartCount: inputParts.length, requestUniqueCount: requestVector.size },
        'Start recognition match by part-name and quantity'
      );

      const models = await prisma.model.findMany({
        select: {
          id: true,
          name: true,
          thumbnailUrl: true,
          manualUrl: true,
          ioFileUrl: true,
          model3dUrl: true,
          partsJson: true
        }
      });

      const modelVectors: ModelVector[] = models
        .map((model) => ({
          id: model.id,
          name: model.name,
          thumbnailUrl: model.thumbnailUrl,
          manualUrl: model.manualUrl,
          ioFileUrl: model.ioFileUrl,
          model3dUrl: model.model3dUrl,
          vector: buildVector(extractNameQuantityFromPartsJson(model.partsJson))
        }))
        .filter((m) => m.vector.size > 0);

      const exactMatches: ScoredMatch[] = modelVectors
        .filter((model) => buildSignatureFromVector(model.vector) === requestSignature)
        .map((model) => ({
          id: model.id,
          name: model.name,
          thumbnailUrl: model.thumbnailUrl,
          manualUrl: model.manualUrl,
          ioFileUrl: model.ioFileUrl,
          model3dUrl: model.model3dUrl,
          matchType: 'exact' as const,
          similarity: 1,
          qtyDiff: Math.abs(sumVector(model.vector) - requestTotalQty)
        }));

      if (exactMatches.length >= 4) {
        exactMatches.sort(sortByRule);
        request.log.info(
          {
            totalModelsCompared: modelVectors.length,
            exactCount: exactMatches.length,
            mode: 'exact_only'
          },
          'Finished recognition match'
        );
        return reply.send({
          success: true,
          message: 'Recognition matching completed',
          data: exactMatches.map(toResponseItem)
        });
      }

      const fuzzyMatches: ScoredMatch[] = modelVectors.map((model) => {
        const similarity = calculateWeightedJaccard(requestVector, model.vector);
        const modelSignature = buildSignatureFromVector(model.vector);
        const matchType: 'exact' | 'fuzzy' =
          modelSignature === requestSignature ? 'exact' : 'fuzzy';
        return {
          id: model.id,
          name: model.name,
          thumbnailUrl: model.thumbnailUrl,
          manualUrl: model.manualUrl,
          ioFileUrl: model.ioFileUrl,
          model3dUrl: model.model3dUrl,
          matchType,
          similarity,
          qtyDiff: Math.abs(sumVector(model.vector) - requestTotalQty)
        };
      });

      fuzzyMatches.sort(sortByRule);
      const topMatches = fuzzyMatches.slice(0, 4);

      request.log.info(
        {
          totalModelsCompared: modelVectors.length,
          exactCount: exactMatches.length,
          returnedCount: topMatches.length,
          mode: 'fuzzy_top4'
        },
        'Finished recognition match'
      );

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

function buildSignatureFromVector(vector: Map<string, number>): string {
  return Array.from(vector.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, quantity]) => `${name}:${quantity}`)
    .join('|');
}

function sumVector(vector: Map<string, number>): number {
  let sum = 0;
  for (const qty of vector.values()) {
    sum += qty;
  }
  return sum;
}

function calculateWeightedJaccard(
  requestVector: Map<string, number>,
  modelVector: Map<string, number>
): number {
  const allKeys = new Set<string>([...requestVector.keys(), ...modelVector.keys()]);
  let intersection = 0;
  let union = 0;

  for (const key of allKeys) {
    const q = requestVector.get(key) || 0;
    const m = modelVector.get(key) || 0;
    intersection += Math.min(q, m);
    union += Math.max(q, m);
  }

  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function sortByRule(a: ScoredMatch, b: ScoredMatch): number {
  if (b.similarity !== a.similarity) {
    return b.similarity - a.similarity;
  }
  if (a.qtyDiff !== b.qtyDiff) {
    return a.qtyDiff - b.qtyDiff;
  }
  return a.id - b.id;
}

function toResponseItem(item: ScoredMatch) {
  const score = Number((item.similarity * 100).toFixed(2));
  return {
    id: item.id,
    name: item.name,
    thumbnailUrl: item.thumbnailUrl,
    manualUrl: item.manualUrl,
    ioFileUrl: item.ioFileUrl,
    model3dUrl: item.model3dUrl,
    matchType: item.matchType,
    score
  };
}
