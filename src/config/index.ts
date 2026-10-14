import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const parsedPort = parseInt(process.env.PORT || '3000', 10);
const parsedMaxFileSizeMb = parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10);
const parsedRebrickableTimeoutMs = parseInt(process.env.REBRICKABLE_TIMEOUT_MS || '8000', 10);
const parsedRebrickableBatchSize = parseInt(process.env.REBRICKABLE_BATCH_SIZE || '80', 10);
const parsedRoboflowTimeoutMs = parseInt(process.env.ROBOFLOW_TIMEOUT || '15000', 10);
const parsedWxTimeoutMs = parseInt(process.env.WX_TIMEOUT_MS || '8000', 10);
const parsedJwtTtlDays = parseInt(process.env.JWT_TTL_DAYS || '30', 10);

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
  },
  roboflow: {
    apiKey: process.env.ROBOFLOW_API_KEY || '',
    workflowUrl: process.env.ROBOFLOW_WORKFLOW_URL || '',
    timeoutMs: Number.isFinite(parsedRoboflowTimeoutMs) ? parsedRoboflowTimeoutMs : 15000
  },
  inference: {
    serviceUrl: process.env.INFERENCE_SERVICE_URL || '',
    timeoutMs: Number.isFinite(parsedRoboflowTimeoutMs) ? parsedRoboflowTimeoutMs : 15000
  },
  hunyuan3d: {
    secretId: process.env.HUNYUAN3D_SECRET_ID || '',
    secretKey: process.env.HUNYUAN3D_SECRET_KEY || '',
    region: process.env.HUNYUAN3D_REGION || 'ap-guangzhou'
  },
  wx: {
    // 小程序 AppID（公开信息），Secret 只从环境变量读取，不下发到代码/仓库
    appid: process.env.WX_APPID || 'wxa5731a718db4cf65',
    secret: process.env.WX_SECRET || '',
    timeoutMs: Number.isFinite(parsedWxTimeoutMs) ? parsedWxTimeoutMs : 8000
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'blocklab-dev-insecure-secret',
    ttlSeconds: (Number.isFinite(parsedJwtTtlDays) ? parsedJwtTtlDays : 30) * 24 * 60 * 60
  }
};
