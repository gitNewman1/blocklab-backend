import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { LocalStorageService } from '../../services/local-storage.service';
import { RoboflowService } from '../../services/roboflow.service';
import { buildResolvedSteps, ResolvedStep } from '../../services/resolve-steps';
import { UploadedFile } from '../../types';

const prisma = new PrismaClient();
const storageService = new LocalStorageService();
const roboflowService = new RoboflowService();

type InputPart = {
  name: string;
  quantity: number;
};

type DetectionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

type RecognizedPart = InputPart & {
  avgConfidence: number;
  maxConfidence: number;
  imgUrl?: string | null;
  designId?: string | null;
  coordinates: DetectionBox[];
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

type Detection = {
  className: string;
  confidence: number;
  detectionId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ModelDetailResponse = {
  id: number;
  name: string;
  thumbnailUrl: string | null;
  manualUrl: string | null;
  ioFileUrl: string;
  model3dUrl: string;
  partsJson: unknown;
  resolvedSteps: ResolvedStep[];
};

export async function recognitionImageMatchRoutes(app: FastifyInstance) {
  app.post('/image-match', async (request, reply) => {
    try {
      const parsedInput = await parseImageInput(request);
      if (parsedInput.hasBothInputs) {
        return reply.code(400).send({
          success: false,
          message: 'image_url and image_file cannot be provided at the same time',
          error: 'INVALID_IMAGE_INPUT'
        });
      }
      if (!parsedInput.imageUrl) {
        return reply.code(400).send({
          success: false,
          message: 'image_url or image_file is required',
          error: 'MISSING_IMAGE_INPUT'
        });
      }

      const imageUrl = parsedInput.imageUrl.trim();
      const topK = clampPositiveInt(parsedInput.topK, 4, 20);
      const minConfidence = clampFloat(parsedInput.minConfidence, 0.6, 0, 1);
      const includeModelDetail = !!parsedInput.includeModelDetail;
      if (!/^https?:\/\//i.test(imageUrl)) {
        return reply.code(400).send({
          success: false,
          message: 'image_url must be a valid http/https url',
          error: 'INVALID_IMAGE_URL'
        });
      }

      const roboflowRaw = await roboflowService.detectByImageUrl(imageUrl);
      const detections = extractDetectionsFromRoboflowResult(roboflowRaw).filter(
        (item) => item.confidence >= minConfidence
      );
      if (detections.length === 0) {
        return reply.send({
          success: true,
          message: 'No parts detected by Roboflow',
          data: {
            imageUrl,
            minConfidence,
            includeModelDetail,
            recognizedParts: [],
            matches: []
          }
        });
      }

      const recognizedParts = aggregateDetectionsToInputParts(detections);
      const requestVector = buildVector(recognizedParts);
      const requestSignature = buildSignatureFromVector(requestVector);
      const requestTotalQty = sumVector(requestVector);

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

      let matches: ScoredMatch[];
      if (exactMatches.length >= 4) {
        exactMatches.sort(sortByRule);
        matches = exactMatches.slice(0, topK);
      } else {
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
        matches = fuzzyMatches.slice(0, topK);
      }

      const recognizedImageBase64 = extractOutputImageBase64(roboflowRaw);

      // Build imgUrl/designId map from best match model's partsJson
      const partInfoByName = new Map<string, { imgUrl: string | null; designId: string | null }>();
      if (matches.length > 0) {
        const bestModel = models.find((m) => m.id === matches[0].id);
        if (bestModel) {
          for (const item of extractPartsWithImgUrl(bestModel.partsJson)) {
            if (item.name) {
              partInfoByName.set(normalizePartKey(item.name), {
                imgUrl: item.imgUrl ?? null,
                designId: item.designId ?? null
              });
            }
          }
        }
      }

      const enrichedRecognizedParts: RecognizedPart[] = recognizedParts.map((p) => {
        const info = partInfoByName.get(normalizePartKey(p.name));
        return {
          ...p,
          imgUrl: info?.imgUrl ?? null,
          designId: info?.designId ?? null
        };
      });

      const responseData: {
        imageUrl: string;
        minConfidence: number;
        includeModelDetail: boolean;
        recognizedImageBase64: string | null;
        recognizedParts: RecognizedPart[];
        matches: ReturnType<typeof toResponseItem>[];
        modelDetail?: ModelDetailResponse;
      } = {
        imageUrl,
        minConfidence,
        includeModelDetail,
        recognizedImageBase64,
        recognizedParts: enrichedRecognizedParts,
        matches: matches.map(toResponseItem)
      };

      if (includeModelDetail && matches.length > 0) {
        const bestMatchId = matches[0].id;
        const bestModel = await prisma.model.findUnique({
          where: { id: bestMatchId },
          select: {
            id: true,
            name: true,
            thumbnailUrl: true,
            manualUrl: true,
            ioFileUrl: true,
            model3dUrl: true,
            partsJson: true,
            stepsJson: true
          }
        });

        if (bestModel) {
          const { stepsJson, ...rest } = bestModel;
          responseData.modelDetail = {
            ...rest,
            resolvedSteps: buildResolvedSteps(rest.partsJson, stepsJson)
          };
        }
      }

      return reply.send({
        success: true,
        message: 'Image recognition matching completed',
        data: responseData
      });
    } catch (error: any) {
      const message = String(error?.message || 'Image recognition match failed');
      if (
        message === 'image_file must be jpg/jpeg/png/webp' ||
        message === 'image_url and image_file cannot be provided at the same time'
      ) {
        return reply.code(400).send({
          success: false,
          message,
          error: 'INVALID_IMAGE_INPUT'
        });
      }
      request.log.error({ error: error.message, stack: error.stack }, 'Image recognition match failed');
      return reply.code(500).send({
        success: false,
        message,
        error: 'INTERNAL_ERROR'
      });
    }
  });
}

async function parseImageInput(
  request: any
): Promise<{
  imageUrl?: string;
  hasBothInputs?: boolean;
  minConfidence?: number;
  topK?: number;
  includeModelDetail?: boolean;
}> {
  const isMultipart = typeof request.isMultipart === 'function' && request.isMultipart();
  if (!isMultipart) {
    const body = (request.body || {}) as Record<string, unknown>;
    const imageUrl = typeof body.image_url === 'string' ? body.image_url : '';
    return {
      imageUrl,
      minConfidence: toMaybeNumber(body.min_confidence),
      topK: toMaybeInt(body.top_k),
      includeModelDetail: toBooleanFlag(body.include_model_detail)
    };
  }

  const parts = request.parts();
  let imageUrl = '';
  let imageFile: UploadedFile | null = null;
  let minConfidence: number | undefined;
  let topK: number | undefined;
  let includeModelDetail = false;

  for await (const part of parts) {
    if (part.type === 'file' && part.fieldname === 'image_file') {
      if (!isSupportedImageFile(part.filename, part.mimetype)) {
        throw new Error('image_file must be jpg/jpeg/png/webp');
      }
      imageFile = {
        filename: part.filename,
        mimetype: part.mimetype,
        encoding: part.encoding,
        data: await part.toBuffer()
      };
      continue;
    }

    if (part.type === 'field' && part.fieldname === 'image_url') {
      imageUrl = String(part.value || '');
    }
    if (part.type === 'field' && part.fieldname === 'min_confidence') {
      minConfidence = toMaybeNumber(part.value);
    }
    if (part.type === 'field' && part.fieldname === 'top_k') {
      topK = toMaybeInt(part.value);
    }
    if (part.type === 'field' && part.fieldname === 'include_model_detail') {
      includeModelDetail = toBooleanFlag(part.value);
    }
  }

  if (imageUrl && imageFile) {
    return { hasBothInputs: true };
  }

  if (imageFile) {
    const imageUrlFromUpload = await storageService.uploadFile(imageFile, 'recognition-images');
    return { imageUrl: imageUrlFromUpload, minConfidence, topK, includeModelDetail };
  }

  return { imageUrl, minConfidence, topK, includeModelDetail };
}

function extractDetectionsFromRoboflowResult(raw: unknown): Detection[] {
  const candidates = getKnownRoboflowPredictionArrays(raw);
  if (candidates.length === 0) {
    candidates.push(...collectPredictionArrays(raw));
  }
  const out: Detection[] = [];
  const seen = new Set<string>();

  for (const predictions of candidates) {
    for (const item of predictions) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const obj = item as Record<string, unknown>;
      const className = String(obj.class || obj.label || '').trim();
      const confidence = Number(obj.confidence ?? obj.score ?? 0);
      if (!className || !Number.isFinite(confidence) || confidence <= 0) {
        continue;
      }
      const detectionId = typeof obj.detection_id === 'string' ? obj.detection_id : undefined;
      const x = Number(obj.x);
      const y = Number(obj.y);
      const width = Number(obj.width);
      const height = Number(obj.height);
      const dedupeKey = detectionId || `${className}|${confidence}|${x}|${y}|${width}|${height}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      out.push({
        className,
        confidence,
        detectionId,
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        width: Number.isFinite(width) ? width : 0,
        height: Number.isFinite(height) ? height : 0
      });
    }
  }

  return out;
}

function getKnownRoboflowPredictionArrays(raw: unknown): Array<Array<Record<string, unknown>>> {
  const out: Array<Array<Record<string, unknown>>> = [];

  if (!Array.isArray(raw)) {
    return out;
  }

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const root = item as Record<string, unknown>;
    const predictionsRoot = root.predictions;
    if (!predictionsRoot || typeof predictionsRoot !== 'object') {
      continue;
    }
    const predictions = (predictionsRoot as Record<string, unknown>).predictions;
    if (!Array.isArray(predictions)) {
      continue;
    }
    out.push(predictions as Array<Record<string, unknown>>);
  }

  return out;
}

function collectPredictionArrays(raw: unknown): Array<Array<Record<string, unknown>>> {
  const arrays: Array<Array<Record<string, unknown>>> = [];
  const stack: unknown[] = [raw];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (Array.isArray(current)) {
      if (current.length > 0 && typeof current[0] === 'object' && current[0] !== null) {
        const first = current[0] as Record<string, unknown>;
        if ('class' in first || 'label' in first) {
          arrays.push(current as Array<Record<string, unknown>>);
        }
      }
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    if (typeof current === 'object') {
      for (const value of Object.values(current as Record<string, unknown>)) {
        stack.push(value);
      }
    }
  }

  return arrays;
}

function aggregateDetectionsToInputParts(detections: Detection[]): RecognizedPart[] {
  const map = new Map<
    string,
    {
      rawName: string;
      quantity: number;
      confidenceSum: number;
      confidenceMax: number;
      coordinates: DetectionBox[];
    }
  >();

  for (const detection of detections) {
    const normalized = normalizePartKey(detection.className);
    if (!normalized) {
      continue;
    }

    const box: DetectionBox = {
      x: Number(detection.x.toFixed(2)),
      y: Number(detection.y.toFixed(2)),
      width: Number(detection.width.toFixed(2)),
      height: Number(detection.height.toFixed(2)),
      confidence: Number(detection.confidence.toFixed(4))
    };

    const existing = map.get(normalized);
    if (!existing) {
      map.set(normalized, {
        rawName: detection.className,
        quantity: 1,
        confidenceSum: detection.confidence,
        confidenceMax: detection.confidence,
        coordinates: [box]
      });
      continue;
    }

    existing.quantity += 1;
    existing.confidenceSum += detection.confidence;
    existing.confidenceMax = Math.max(existing.confidenceMax, detection.confidence);
    existing.coordinates.push(box);
  }

  return Array.from(map.entries())
    .map(([, value]) => ({
      name: value.rawName,
      quantity: value.quantity,
      avgConfidence: Number((value.confidenceSum / value.quantity).toFixed(4)),
      maxConfidence: Number(value.confidenceMax.toFixed(4)),
      coordinates: value.coordinates
    }))
    .sort((a, b) => {
      if (b.quantity !== a.quantity) {
        return b.quantity - a.quantity;
      }
      return b.avgConfidence - a.avgConfidence;
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
    const normalizedName = normalizePartKey(name);
    if (!normalizedName || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    out.push({ name: normalizedName, quantity });
  }
  return out;
}

function normalizePartKey(name: string): string {
  const lowered = name.toLowerCase();
  const withSpaces = lowered
    .replace(/[_-]+/g, ' ')
    .replace(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/g, '$1x$2x$3')
    .replace(/(\d+)\s*x\s*(\d+)/g, '$1x$2')
    .replace(/[^a-z0-9x ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withSpaces) {
    return '';
  }

  const tokens = withSpaces.split(' ').filter(Boolean);
  const typeToken = findTypeToken(tokens);
  const sizeToken = tokens.find((token) => /^\d+x\d+(x\d+)?$/.test(token));
  if (typeToken && sizeToken) {
    return `${typeToken}_${sizeToken}`;
  }

  return tokens.join('_');
}

function findTypeToken(tokens: string[]): string | undefined {
  const knownTypePriority = ['corner', 'plate', 'brick', 'tile', 'slope', 'technic'];
  for (const type of knownTypePriority) {
    if (tokens.includes(type)) {
      return type;
    }
  }
  return undefined;
}

function buildVector(parts: InputPart[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const part of parts) {
    const key = normalizePartKey(part.name);
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

function toMaybeNumber(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return undefined;
  }
  return num;
}

function toMaybeInt(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isInteger(num)) {
    return undefined;
  }
  return num;
}

function clampPositiveInt(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (!value || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(1, Math.min(maxValue, Math.floor(value)));
}

function clampFloat(
  value: number | undefined,
  defaultValue: number,
  minValue: number,
  maxValue: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(minValue, Math.min(maxValue, value));
}

function isSupportedImageFile(filename: string, mimetype: string): boolean {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) {
    return true;
  }
  return mimetype.startsWith('image/');
}

function toBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function extractOutputImageBase64(raw: unknown): string | null {
  const stack: unknown[] = [raw];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') {
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }
    const obj = current as Record<string, unknown>;
    const outputImage = obj.output_image as Record<string, unknown> | undefined;
    if (outputImage && typeof outputImage === 'object') {
      const val = outputImage.value;
      if (typeof val === 'string' && val.length > 0) {
        return val;
      }
    }
    for (const value of Object.values(obj)) {
      stack.push(value);
    }
  }
  return null;
}

function extractPartsWithImgUrl(
  partsJson: unknown
): Array<{ name?: string; imgUrl?: string | null; designId?: string | null }> {
  if (!Array.isArray(partsJson)) return [];
  return partsJson
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const p = item as Record<string, unknown>;
      return {
        name: typeof p.name === 'string' ? p.name : undefined,
        imgUrl: typeof p.imgUrl === 'string' ? p.imgUrl : null,
        designId: typeof p.designID === 'string' ? p.designID : null
      };
    });
}

