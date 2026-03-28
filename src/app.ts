import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { modelsRoutes } from './routes/admin/models';
import { modelMatchingRoutes } from './routes/models/matching';
import { config } from './config';

export async function buildApp() {
  const app = Fastify({
    logger: true
  });

  await app.register(cors);
  await app.register(multipart, {
    limits: {
      fileSize: config.storage.maxFileSizeMb * 1024 * 1024
    }
  });

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  await app.register(modelsRoutes, { prefix: '/api/admin/models' });
  await app.register(modelMatchingRoutes, { prefix: '/api/models' });

  return app;
}
