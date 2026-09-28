import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { code2Session, WechatError } from '../../services/wechat.service';
import { signToken } from '../../services/jwt.service';

const prisma = new PrismaClient();

interface LoginBody {
  // 兼容旧版模拟入参:直接传 unionId
  unionId?: string;
  // 微信小程序 wx.login 拿到的临时 code,存在时用它换 openid
  code?: string;
  nickName?: string;
  avatarUrl?: string;
}

interface LoginResult {
  user: {
    id: string;
    unionId: string;
    nickname: string | null;
    avatarUrl: string | null;
  };
  isNewUser: boolean;
}

async function findOrCreateUser(identity: string, profile: { nickname?: string; avatarUrl?: string }): Promise<LoginResult> {
  const existing = await prisma.user.findUnique({ where: { unionId: identity } });

  if (existing) {
    // 微信侧资料可能变化,登录时带上了昵称/头像就顺手更新
    let fresh = existing;
    if (profile.nickname !== undefined || profile.avatarUrl !== undefined) {
      fresh = await prisma.user.update({
        where: { id: existing.id },
        data: {
          ...(profile.nickname !== undefined ? { nickname: profile.nickname || null } : {}),
          ...(profile.avatarUrl !== undefined ? { avatarUrl: profile.avatarUrl || null } : {})
        }
      });
    }
    return {
      user: {
        id: fresh.id,
        unionId: fresh.unionId,
        nickname: fresh.nickname,
        avatarUrl: fresh.avatarUrl
      },
      isNewUser: false
    };
  }

  const user = await prisma.user.create({
    data: {
      unionId: identity,
      ...(profile.nickname ? { nickname: profile.nickname } : {}),
      ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {})
    }
  });
  return {
    user: { id: user.id, unionId: user.unionId, nickname: user.nickname, avatarUrl: user.avatarUrl },
    isNewUser: true
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/login',
    {
      schema: {
        tags: ['Auth'],
        summary: '微信小程序登录:code 换 openid 登录/注册,或兼容旧版直接传 unionId',
        body: {
          type: 'object',
          anyOf: [{ required: ['unionId'] }, { required: ['code'] }],
          properties: {
            unionId: { type: 'string', minLength: 1, description: '兼容旧版:直接以该值作为用户唯一标识登录' },
            code: { type: 'string', minLength: 1, description: 'wx.login 获取的临时 code,通过微信 code2session 换取 openid' },
            nickName: { type: 'string', maxLength: 100, description: '微信昵称,可选' },
            avatarUrl: { type: 'string', description: '微信头像地址,可选' }
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
                  isNewUser: { type: 'boolean' },
                  user: {
                    type: 'object',
                    properties: {
                      unionId: { type: 'string' },
                      userId: { type: 'string' },
                      nickName: { type: ['string', 'null'] },
                      avatarUrl: { type: ['string', 'null'] }
                    }
                  }
                }
              }
            }
          },
          400: {
            description: '请求参数缺失',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              error: { type: 'string' }
            }
          },
          401: {
            description: '微信 code 换 session 失败',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              error: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as LoginBody;

      try {
        let identity = body.unionId;
        if (body.code) {
          const session = await code2Session(body.code);
          // session_key 仅用于微信服务端通信,不落库、不记录日志
          identity = session.openid;
        }

        if (!identity) {
          return reply.code(400).send({
            success: false,
            message: 'unionId or code is required',
            error: 'BAD_REQUEST'
          });
        }

        const { user, isNewUser } = await findOrCreateUser(identity, {
          nickname: body.nickName,
          avatarUrl: body.avatarUrl
        });

        const token = signToken(user.id);

        return reply.send({
          success: true,
          message: isNewUser ? 'User created' : 'Login successful',
          data: {
            token,
            isNewUser,
            // 契约约定:该字段返回的是当前登录身份(小程序侧传 code 时为微信 openid)
            user: {
              unionId: user.unionId,
              userId: user.id,
              nickName: user.nickname,
              avatarUrl: user.avatarUrl
            }
          }
        });
      } catch (error: any) {
        if (error instanceof WechatError) {
          return reply.code(401).send({
            success: false,
            message: error.message,
            error: 'WECHAT_CODE2SESSION_FAILED'
          });
        }
        request.log.error({ error: error.message, stack: error.stack }, 'Login failed');
        return reply.code(500).send({
          success: false,
          message: error.message,
          error: 'INTERNAL_ERROR'
        });
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
