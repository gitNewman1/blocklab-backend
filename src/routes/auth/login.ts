import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { signToken } from '../../plugins/auth';
import { code2Session } from '../../services/wechat.service';

const prisma = new PrismaClient();

/**
 * 登录身份口径：
 * - 微信登录取 code2session 的 unionid（小程序绑定开放平台时才有），否则回退 openid，
 *   统一写入 users.union_id 列（该列是用户唯一身份键）。
 * - 将来接华为账号 / 手机号登录时，在此按各自的外部身份键走同一个 upsert 逻辑，
 *   需要区分登录方式时再扩展身份表即可，token 结构不变。
 */
async function upsertUserByExternalId(externalId: string) {
  const existing = await prisma.user.findUnique({ where: { unionId: externalId } });
  if (existing) return { user: existing, isNewUser: false };
  const user = await prisma.user.create({ data: { unionId: externalId } });
  return { user, isNewUser: true };
}

function loginData(user: { id: string }, isNewUser: boolean) {
  return {
    token: signToken({ userId: user.id }),
    userId: user.id,
    isNewUser
  };
}

export async function authRoutes(app: FastifyInstance) {
  // 微信小程序登录：前端 wx.login() 拿到 code 后调这里换 token
  app.post(
    '/login/wechat',
    {
      schema: {
        tags: ['Auth'],
        summary: '微信小程序登录（code 换 token）',
        body: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 1 } }
        },
        response: {
          200: {
            description: '登录成功',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  userId: { type: 'string' },
                  isNewUser: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { code } = request.body as { code: string };
        const session = await code2Session(code);
        const externalId = session.unionid ?? session.openid;
        const { user, isNewUser } = await upsertUserByExternalId(externalId);
        return { success: true, message: 'Login successful', data: loginData(user, isNewUser) };
      } catch (error: any) {
        request.log.error({ error: error.message }, 'WeChat login failed');
        const isWxError = error.message.startsWith('微信登录失败');
        return reply.code(isWxError ? 401 : 500).send({
          success: false,
          message: isWxError ? error.message : '登录服务异常，请稍后重试',
          error: isWxError ? 'WECHAT_LOGIN_FAILED' : 'INTERNAL_ERROR'
        });
      }
    }
  );

  // 兼容旧接口：直接用 unionId 登录/创建用户（同时返回 token）
  app.post(
    '/login',
    {
      schema: {
        tags: ['Auth'],
        summary: '根据 unionId 登录或自动创建用户',
        body: {
          type: 'object',
          required: ['unionId'],
          properties: {
            unionId: { type: 'string', minLength: 1 }
          }
        },
        response: {
          200: {
            description: '登录成功',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  userId: { type: 'string' },
                  isNewUser: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { unionId } = request.body as { unionId: string };

      if (!unionId) {
        return reply.status(400).send({ error: 'unionId is required' });
      }

      try {
        const { user, isNewUser } = await upsertUserByExternalId(unionId);
        return { success: true, message: 'Login successful', data: loginData(user, isNewUser) };
      } catch (error: any) {
        return reply.status(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
      }
    }
  );

  app.get(
    '/users',
    {
      schema: {
        tags: ['Auth'],
        summary: '获取所有用户',
        response: {
          200: {
            description: '成功返回用户列表',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    unionId: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
    try {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          unionId: true,
          createdAt: true
        }
      });

      return reply.send({
        success: true,
        message: 'Users fetched successfully',
        data: users
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Fetch users failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
    }
  );
}
