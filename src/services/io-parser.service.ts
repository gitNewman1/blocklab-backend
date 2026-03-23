import { parseString } from 'xml2js';
import { ParsedIOFile, Part, Step } from '../types';

export class IOParserService {
  async parseIOFile(content: string): Promise<ParsedIOFile> {
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
        parts
      };
    });
  }
}
