export type ResolvedStepPart = {
  refId: string;
  designID?: string;
  name?: string;
  colorID?: string;
  quantityInModel?: number;
};

export type ResolvedStep = {
  step: number;
  parts: ResolvedStepPart[];
};

export function buildResolvedSteps(partsJson: unknown, stepsJson: unknown): ResolvedStep[] {
  const partsById = new Map<
    string,
    {
      designID?: string;
      name?: string;
      colorID?: string;
      quantityInModel?: number;
    }
  >();

  if (Array.isArray(partsJson)) {
    for (const item of partsJson) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const part = item as Record<string, unknown>;
      const refId = String(part.id || '').trim();
      if (!refId) {
        continue;
      }
      partsById.set(refId, {
        designID: typeof part.designID === 'string' ? part.designID : undefined,
        name: typeof part.name === 'string' ? part.name : undefined,
        colorID: typeof part.colorID === 'string' ? part.colorID : undefined,
        quantityInModel: Number.isFinite(Number(part.quantity)) ? Number(part.quantity) : undefined
      });
    }
  }

  const resolved: ResolvedStep[] = [];
  if (!Array.isArray(stepsJson)) {
    return resolved;
  }

  for (const stepItem of stepsJson) {
    if (!stepItem || typeof stepItem !== 'object') {
      continue;
    }
    const stepObj = stepItem as Record<string, unknown>;
    const step = Number(stepObj.step);
    const refs = Array.isArray(stepObj.parts) ? stepObj.parts : [];
    const parts = refs.map((refRaw) => {
      const refId = String(refRaw || '').trim();
      const detail = partsById.get(refId);
      return {
        refId,
        designID: detail?.designID,
        name: detail?.name,
        colorID: detail?.colorID,
        quantityInModel: detail?.quantityInModel
      };
    });

    resolved.push({
      step: Number.isFinite(step) && step > 0 ? step : resolved.length + 1,
      parts
    });
  }

  return resolved;
}
