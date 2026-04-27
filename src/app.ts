import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { modelsRoutes } from './routes/admin/models';
import { dataManagementRoutes } from './routes/admin/data-management';
import { adminModelTypeRoutes } from './routes/admin/model-types';
import { recognitionMatchRoutes } from './routes/recognition/match';
import { recognitionImageMatchRoutes } from './routes/recognition/image-match';
import { modelQueryRoutes } from './routes/models';
import { authRoutes } from './routes/auth/login';
import { workRoutes } from './routes/works';
import { modelTypeRoutes } from './routes/model-types';
import { registerSwagger } from './plugins/swagger';
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
  await registerSwagger(app);

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  await app.register(modelsRoutes, { prefix: '/api/admin/models' });
  await app.register(dataManagementRoutes, { prefix: '/api/admin/data' });
  await app.register(adminModelTypeRoutes, { prefix: '/api/admin/model-types' });
  await app.register(recognitionMatchRoutes, { prefix: '/api/recognition' });
  await app.register(recognitionImageMatchRoutes, { prefix: '/api/recognition' });
  await app.register(modelQueryRoutes, { prefix: '/api/models' });
  await app.register(modelTypeRoutes, { prefix: '/api/model-types' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(workRoutes, { prefix: '/api/works' });

  return app;
}
