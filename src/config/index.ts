import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL!
  },
  obs: {
    accessKey: process.env.OBS_ACCESS_KEY!,
    secretKey: process.env.OBS_SECRET_KEY!,
    bucket: process.env.OBS_BUCKET!,
    endpoint: process.env.OBS_ENDPOINT!
  }
};
