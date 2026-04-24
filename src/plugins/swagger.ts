import { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'BlockLab Backend API',
        description: 'Standard API docs for BlockLab backend',
        version: '1.0.0'
      },
      tags: [
        { name: 'Models', description: 'Model query APIs' },
        { name: 'Model Types', description: 'Model type APIs' },
        { name: 'Auth', description: 'Authentication and user APIs' },
        { name: 'Recognition', description: 'Recognition query APIs' }
      ]
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    },
    staticCSP: true
  });
}
