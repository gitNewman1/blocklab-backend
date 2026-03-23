export interface ParsedIOFile {
  parts: Part[];
  steps: Step[];
}

export interface Part {
  id: string;
  designID: string;
  name?: string;
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
