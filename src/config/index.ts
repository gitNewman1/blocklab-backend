import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const parsedPort = parseInt(process.env.PORT || '3000', 10);
const parsedMaxFileSizeMb = parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10);

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
  }
};
