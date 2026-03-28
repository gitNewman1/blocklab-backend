import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const parsedPort = parseInt(process.env.PORT || '3000', 10);
const parsedMaxFileSizeMb = parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10);
const parsedRebrickableTimeoutMs = parseInt(process.env.REBRICKABLE_TIMEOUT_MS || '8000', 10);
const parsedRebrickableBatchSize = parseInt(process.env.REBRICKABLE_BATCH_SIZE || '80', 10);

export const config = {
  port: Number.isFinite(parsedPort) ? parsedPort : 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL!
  },
  storage: {
    uploadRoot: process.env.UPLOAD_ROOT || path.resolve(process.cwd(), 'uploads'),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || '3000'}`,
    maxFileSizeMb: Number.isFinite(parsedMaxFileSizeMb) ? parsedMaxFileSizeMb : 50
  },
  rebrickable: {
    apiKey: process.env.REBRICKABLE_API_KEY || '',
    baseUrl: process.env.REBRICKABLE_BASE_URL || 'https://rebrickable.com/api/v3',
    timeoutMs: Number.isFinite(parsedRebrickableTimeoutMs) ? parsedRebrickableTimeoutMs : 8000,
    batchSize: Number.isFinite(parsedRebrickableBatchSize) ? parsedRebrickableBatchSize : 80
  }
};
