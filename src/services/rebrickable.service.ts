import { config } from '../config';
import { Part } from '../types';

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

interface RebrickablePartItem {
  part_num?: string;
  name?: string;
  part_img_url?: string;
}

interface RebrickablePartsResponse {
  results?: RebrickablePartItem[];
}

export class RebrickableService {
  async enrichParts(parts: Part[], logger: LoggerLike): Promise<Part[]> {
    if (!config.rebrickable.apiKey) {
      throw new Error('REBRICKABLE_API_KEY is missing');
    }

    const uniqueDesignIds = Array.from(
      new Set(parts.map((part) => part.designID).filter((id) => !!id))
    );

    if (uniqueDesignIds.length === 0) {
      logger.warn({ partsCount: parts.length }, 'No design IDs found for Rebrickable enrichment');
      return parts;
    }

    logger.info(
      {
        partsCount: parts.length,
        uniqueDesignIdCount: uniqueDesignIds.length,
        batchSize: config.rebrickable.batchSize
      },
      'Start enriching parsed parts with Rebrickable data'
    );

    const startedAt = Date.now();
    const nameMap = new Map<string, { name: string; imgUrl: string | null }>();
    const chunks = this.chunk(uniqueDesignIds, Math.max(1, config.rebrickable.batchSize));

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const batchIndex = i + 1;
      const batchStartedAt = Date.now();
      logger.info(
        { batchIndex, batchTotal: chunks.length, designIdsInBatch: chunk.length },
        'Requesting Rebrickable batch'
      );

      const response = await this.fetchBatch(chunk);
      for (const item of response.results || []) {
        const partNum = (item.part_num || '').trim();
        const partName = (item.name || '').trim();
        if (partNum && partName) {
          nameMap.set(partNum, { name: partName, imgUrl: item.part_img_url || null });
        }
      }

      logger.info(
        {
          batchIndex,
          batchTotal: chunks.length,
          durationMs: Date.now() - batchStartedAt,
          namesResolvedInBatch: (response.results || []).length
        },
        'Rebrickable batch completed'
      );
    }

    const enriched = parts.map((part) => {
      const entry = nameMap.get(part.designID);
      if (!entry) {
        return part;
      }
      return {
        ...part,
        name: entry.name,
        imgUrl: entry.imgUrl
      };
    });

    const unresolvedCount = enriched.filter((part) => !part.name).length;
    logger.info(
      {
        durationMs: Date.now() - startedAt,
        totalParts: enriched.length,
        unresolvedCount
      },
      'Finished Rebrickable enrichment'
    );

    return enriched;
  }

  private async fetchBatch(designIds: string[]): Promise<RebrickablePartsResponse> {
    const endpoint = `${config.rebrickable.baseUrl.replace(/\/+$/, '')}/lego/parts/`;
    const params = new URLSearchParams({
      part_nums: designIds.join(','),
      inc_part_details: '1',
      page_size: String(designIds.length)
    });

    const url = `${endpoint}?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.rebrickable.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `key ${config.rebrickable.apiKey}`
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const bodyPreview = (await response.text()).slice(0, 300);
        throw new Error(`Rebrickable request failed: HTTP ${response.status}, body=${bodyPreview}`);
      }

      const data = (await response.json()) as RebrickablePartsResponse;
      return data;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Rebrickable request timeout after ${config.rebrickable.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(items.slice(i, i + size));
    }
    return out;
  }
}
