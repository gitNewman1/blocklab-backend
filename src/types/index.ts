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

export interface Step {
  step: number;
  parts: string[];
}

export interface UploadedFile {
  filename: string;
  mimetype: string;
  encoding: string;
  data: Buffer;
}
