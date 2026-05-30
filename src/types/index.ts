export interface ParsedIOFile {
  parts: Part[];
  steps: Step[];
  extractedThumbnail?: UploadedFile;
}

export interface Part {
  id: string;
  designID: string;
  name?: string;
  imgUrl?: string | null;
  quantity: number;
  colorID?: string;
}

// LDraw 3×3 旋转矩阵，行主序：a b c / d e f / g h i
export type Matrix3x3 = [
  number, number, number,
  number, number, number,
  number, number, number
];

// 单个零件实例的摆放信息（LDraw 原始坐标，未做坐标系转换）
// position 单位为 LDU（Y 向下）；坐标系转换由网格管线与客户端共用同一套转换完成
export interface PartPlacement {
  designID: string;
  colorID: string;
  position: [number, number, number];
  rotation: Matrix3x3;
}

export interface Step {
  step: number;
  parts: string[];
  placements: PartPlacement[];
}

export interface UploadedFile {
  filename: string;
  mimetype: string;
  encoding: string;
  data: Buffer;
}
