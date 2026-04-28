import { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'BlockLab 后端接口文档',
        description: 'BlockLab 后端标准接口文档与调试入口',
        version: '1.0.0'
      },
      tags: [
        { name: 'Models', description: '模型查询相关接口' },
        { name: 'Model Types', description: '模型类型相关接口' },
        { name: 'Auth', description: '登录与用户相关接口' },
        { name: 'Recognition', description: '识别匹配相关接口' },
        { name: 'Works', description: '作品相关接口' }
      ]
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    }
  });
}
