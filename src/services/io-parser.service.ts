import { parseString } from 'xml2js';
import AdmZip from 'adm-zip';
import { ParsedIOFile, Part, PartPlacement, Matrix3x3, Step, UploadedFile } from '../types';

export class IOParserService {
  async parseIOFileBuffer(buffer: Buffer): Promise<ParsedIOFile> {
    if (this.isZipBuffer(buffer)) {
      return this.parseStudioZipFile(buffer);
    }

    const content = buffer.toString('utf-8');
    const trimmed = content.trimStart();

    if (trimmed.startsWith('<')) {
      return this.parseXMLFile(content);
    }

    return this.parseLDrawText(content);
  }

  async parseIOFile(content: string): Promise<ParsedIOFile> {
    return this.parseXMLFile(content);
  }

  private async parseXMLFile(content: string): Promise<ParsedIOFile> {
    return new Promise((resolve, reject) => {
      parseString(content, (err, result) => {
        if (err) {
          reject(new Error(`XML parse error: ${err.message}`));
          return;
        }

        try {
          const parts = this.extractParts(result);
          const steps = this.extractSteps(result);
          resolve({ parts, steps });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private parseStudioZipFile(buffer: Buffer): ParsedIOFile {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory);

    if (entries.length === 0) {
      throw new Error('Invalid .io zip: no files found');
    }

    const target = this.findLDrawEntry(entries);
    if (!target) {
      throw new Error('Invalid .io zip: cannot find model.ldr/model.io/model.mpd');
    }

    const ldrawContent = target.getData().toString('utf-8');
    const parsed = this.parseLDrawText(ldrawContent);
    const extractedThumbnail = this.extractThumbnailFromEntries(entries);
    return {
      ...parsed,
      extractedThumbnail
    };
  }

  private findLDrawEntry(entries: any[]): any | null {
    const preferredNames = ['model.ldr', 'model.io', 'model.mpd'];
    for (const preferred of preferredNames) {
      const found = entries.find((entry) => entry.entryName.toLowerCase().endsWith(preferred));
      if (found) {
        return found;
      }
    }

    return entries.find((entry) => /\.(ldr|io|mpd)$/i.test(entry.entryName)) || null;
  }

  private extractThumbnailFromEntries(entries: any[]): UploadedFile | undefined {
    const imageEntry = this.findThumbnailEntry(entries);
    if (!imageEntry) {
      return undefined;
    }

    const filename = imageEntry.entryName.split('/').pop() || imageEntry.entryName;
    const lower = filename.toLowerCase();
    const mimetype = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      ? 'image/jpeg'
      : lower.endsWith('.webp')
      ? 'image/webp'
      : 'application/octet-stream';

    return {
      filename,
      mimetype,
      encoding: 'binary',
      data: imageEntry.getData()
    };
  }

  private findThumbnailEntry(entries: any[]): any | null {
    const preferredPatterns = [
      /(^|\/)thumbnail\.(png|jpg|jpeg|webp)$/i,
      /(^|\/)thumb\.(png|jpg|jpeg|webp)$/i
    ];

    for (const pattern of preferredPatterns) {
      const found = entries.find((entry) => pattern.test(entry.entryName));
      if (found) {
        return found;
      }
    }

    return (
      entries.find(
        (entry) =>
          /\.(png|jpg|jpeg|webp)$/i.test(entry.entryName) &&
          /thumb|thumbnail/i.test(entry.entryName)
      ) || null
    );
  }

  private parseLDrawText(content: string): ParsedIOFile {
    const lines = content.split(/\r?\n/);
    const partMap = new Map<string, Part>();
    const steps: Step[] = [];
    let currentStepParts: string[] = [];
    let currentStepPlacements: PartPlacement[] = [];
    // 累计全部零件实例位姿，供"无 STEP 标记"兜底单步使用
    const allPlacements: PartPlacement[] = [];

    const flushStep = () => {
      if (currentStepParts.length === 0) {
        return;
      }
      steps.push({
        step: steps.length + 1,
        parts: currentStepParts,
        placements: currentStepPlacements
      });
      currentStepParts = [];
      currentStepPlacements = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const tokens = line.split(/\s+/);
      if (tokens[0] === '0' && tokens[1]?.toUpperCase() === 'STEP') {
        flushStep();
        continue;
      }

      // LDraw type-1 line: 1 <color> <x y z> <a b c d e f g h i> <part.dat>
      if (tokens[0] !== '1' || tokens.length < 15) {
        continue;
      }

      const colorID = tokens[1] || '0';
      const partToken = tokens[tokens.length - 1] || '';
      const designID = this.normalizeDesignID(partToken);
      if (!designID) {
        continue;
      }

      const key = `${designID}_${colorID}`;
      const existing = partMap.get(key);
      if (existing) {
        existing.quantity += 1;
      } else {
        partMap.set(key, {
          id: key,
          designID,
          quantity: 1,
          colorID
        });
      }

      currentStepParts.push(key);

      // 提取该零件实例的位姿：tokens[2..4] 为位置，tokens[5..13] 为 3×3 旋转矩阵
      const x = Number(tokens[2]);
      const y = Number(tokens[3]);
      const z = Number(tokens[4]);
      const matrix = tokens.slice(5, 14).map(Number);
      if ([x, y, z, ...matrix].every((n) => Number.isFinite(n))) {
        const placement: PartPlacement = {
          designID,
          colorID,
          position: [x, y, z],
          rotation: matrix as Matrix3x3
        };
        currentStepPlacements.push(placement);
        allPlacements.push(placement);
      }
    }

    flushStep();

    const parts = Array.from(partMap.values());
    if (parts.length === 0) {
      throw new Error('No valid parts found in .io file');
    }

    if (steps.length === 0) {
      steps.push({
        step: 1,
        parts: parts.map((part) => part.id),
        placements: allPlacements
      });
    }

    return { parts, steps };
  }

  private normalizeDesignID(partToken: string): string {
    const normalized = partToken.replace(/\\/g, '/');
    const baseName = normalized.split('/').pop() || '';
    return baseName.replace(/\.(dat|ldr|io|mpd)$/i, '');
  }

  private isZipBuffer(buffer: Buffer): boolean {
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  }

  private extractParts(xmlResult: any): Part[] {
    const bricks = xmlResult?.LXFML?.Bricks?.[0]?.Brick || [];
    const partMap = new Map<string, Part>();

    bricks.forEach((brick: any) => {
      const designID = brick.$.designID;
      const part = brick.Part?.[0];
      const colorID = part?.$?.materials || '0';

      const key = `${designID}_${colorID}`;

      if (partMap.has(key)) {
        partMap.get(key)!.quantity++;
      } else {
        partMap.set(key, {
          id: key,
          designID,
          quantity: 1,
          colorID
        });
      }
    });

    return Array.from(partMap.values());
  }

  private extractSteps(xmlResult: any): Step[] {
    const instructions = xmlResult?.LXFML?.BuildingInstructions?.[0]?.BuildingInstruction?.[0];
    const stepNodes = instructions?.Step || [];

    return stepNodes.map((stepNode: any, index: number) => {
      const partRefs = stepNode.Part || [];
      const parts = partRefs.map((p: any) => p.$.refID);

      return {
        step: index + 1,
        parts,
        // LXFML 的位姿在 Brick/Bone 的 transformation 字段，结构与 LDraw 不同，
        // 本期拼装动画仅支持 LDraw（model.ldr）分支，此处位姿后置补充
        placements: []
      };
    });
  }
}
