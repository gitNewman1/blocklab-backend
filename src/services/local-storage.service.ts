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

  async clearFolders(folders: string[]): Promise<void> {
    for (const folder of folders) {
      const absolutePath = path.join(config.storage.uploadRoot, folder);
      await fs.promises.mkdir(absolutePath, { recursive: true });
      const entries = await fs.promises.readdir(absolutePath);
      await Promise.all(
        entries.map((entry) =>
          fs.promises.rm(path.join(absolutePath, entry), { recursive: true, force: true })
        )
      );
    }
  }

  async deleteFilesByUrls(urls: Array<string | null | undefined>): Promise<void> {
    const absolutePaths = urls
      .map((url) => this.resolvePublicUrlToAbsolutePath(url))
      .filter((item): item is string => !!item);

    await Promise.all(
      absolutePaths.map((absolutePath) => fs.promises.rm(absolutePath, { force: true }))
    );
  }

  private ensureBaseFolders(): void {
    const folders = ['io-files', 'models-3d', 'thumbnails', 'manuals', 'posts', 'recognition-images'];
    for (const folder of folders) {
      fs.mkdirSync(path.join(config.storage.uploadRoot, folder), { recursive: true });
    }
  }

  private sanitizeFilename(filename: string): string {
    const name = path.basename(filename);
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private resolvePublicUrlToAbsolutePath(url: string | null | undefined): string | null {
    if (!url || typeof url !== 'string') {
      return null;
    }

    let pathname = '';
    try {
      pathname = new URL(url, config.storage.publicBaseUrl).pathname;
    } catch {
      return null;
    }

    const staticPrefix = '/static/';
    const staticIndex = pathname.indexOf(staticPrefix);
    if (staticIndex < 0) {
      return null;
    }

    const relativePath = pathname.slice(staticIndex + staticPrefix.length);
    if (!relativePath) {
      return null;
    }

    const absolutePath = path.resolve(config.storage.uploadRoot, relativePath);
    const uploadRoot = path.resolve(config.storage.uploadRoot);
    const relativeToRoot = path.relative(uploadRoot, absolutePath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      return null;
    }

    return absolutePath;
  }
}
