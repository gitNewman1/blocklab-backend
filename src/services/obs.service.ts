import ObsClient from 'esdk-obs-nodejs';
import { config } from '../config';
import { UploadedFile } from '../types';

export class OBSService {
  private client: ObsClient;

  constructor() {
    this.client = new ObsClient({
      access_key_id: config.obs.accessKey,
      secret_access_key: config.obs.secretKey,
      server: config.obs.endpoint
    });
  }

  async uploadFile(file: UploadedFile, folder: string): Promise<string> {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    const key = `${folder}/${timestamp}_${randomStr}_${file.filename}`;

    try {
      await this.client.putObject({
        Bucket: config.obs.bucket,
        Key: key,
        Body: file.data
      });

      return `https://${config.obs.bucket}.${config.obs.endpoint}/${key}`;
    } catch (error) {
      throw new Error(`OBS upload failed: ${error}`);
    }
  }
}
