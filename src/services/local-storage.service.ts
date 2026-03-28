import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { UploadedFile } from '../types';

export class LocalStorageService {
  constructor() {
    this.ensureBaseFolders();
  }

  async uploadFile(file: UploadedFile, folder: string): Promise<string> {
    const safeName = this.sanitizeFilename(file.filename);
    const ext = path.extname(safeName);
    const baseName = path.basename(safeName, ext);
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).slice(2, 8);
    const finalName = `${timestamp}-${randomStr}-${baseName}${ext}`;

    const relativePath = path.posix.join(folder, finalName);
    const absolutePath = path.join(config.storage.uploadRoot, folder, finalName);

    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, file.data);

    const base = config.storage.publicBaseUrl.replace(/\/+$/, '');
    return `${base}/static/${relativePath}`;
  }

  private ensureBaseFolders(): void {
    const folders = ['io-files', 'models-3d', 'thumbnails', 'manuals', 'posts'];
    for (const folder of folders) {
      fs.mkdirSync(path.join(config.storage.uploadRoot, folder), { recursive: true });
    }
  }

  private sanitizeFilename(filename: string): string {
    const name = path.basename(filename);
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}
