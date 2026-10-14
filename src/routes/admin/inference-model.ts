import { FastifyInstance } from 'fastify';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';

const execFileAsync = promisify(execFile);
const MODEL_DIR = path.resolve(config.storage.uploadRoot, '..', 'inference_service');
const MODEL_FILENAME = 'best.pt';
// 推理服务进程名（pm2），可通过环境变量覆盖
const INFERENCE_PM2_NAME = process.env.INFERENCE_PM2_NAME || 'blocklab-inference';

export async function inferenceModelRoutes(app: FastifyInstance) {
  // 探活：检测推理服务是否在线
  app.get('/inference-model/ping', async (request, reply) => {
    try {
      const modelPath = path.join(MODEL_DIR, MODEL_FILENAME);
      const modelExists = fs.existsSync(modelPath);

      if (!modelExists) {
        return reply.send({
          success: false,
          message: '请先上传模型文件',
          code: 'NO_MODEL'
        });
      }

      const endpoint = config.inference.serviceUrl;
      if (!endpoint) {
        return reply.send({
          success: false,
          message: 'INFERENCE_SERVICE_URL 未配置',
          code: 'NO_ENDPOINT'
        });
      }

      const baseUrl = endpoint.replace(/\/detect$/, '');
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json() as any;
      return reply.send({ success: true, data: { device: data.device || 'unknown' } });
    } catch {
      return reply.send({
        success: false,
        message: '推理服务未启动，请运行 inference_service',
        code: 'SERVICE_OFFLINE'
      });
    }
  });

  app.post('/inference-model/restart', async (request, reply) => {
    try {
      // 仅重启固定的 pm2 推理服务进程，不接受用户输入的命令，避免命令注入
      const { stdout, stderr } = await execFileAsync('pm2', ['restart', INFERENCE_PM2_NAME], {
        timeout: 30000
      });
      if (stderr) request.log.warn({ stderr }, 'pm2 restart stderr');
      request.log.info(`Inference service "${INFERENCE_PM2_NAME}" restart requested`);
      return reply.send({
        success: true,
        message: '重启指令已发送，推理服务正在重新加载，请稍候',
        data: { processName: INFERENCE_PM2_NAME, output: stdout }
      });
    } catch (error: any) {
      request.log.error(
        { error: error.message, stderr: error.stderr },
        'Inference service restart failed'
      );
      return reply.code(500).send({
        success: false,
        message: `重启失败: ${error.stderr || error.message}，请检查 pm2 进程 ${INFERENCE_PM2_NAME} 是否存在`,
        error: 'RESTART_FAILED'
      });
    }
  });

  app.post('/inference-model/upload', async (request, reply) => {
    try {
      const parts = request.parts();
      let fileBuffer: Buffer | null = null;
      let fileName = '';

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'model_file') {
          if (!part.filename.toLowerCase().endsWith('.pt')) {
            return reply.code(400).send({
              success: false,
              message: '只支持 .pt 格式的模型文件',
              error: 'INVALID_FILE_TYPE'
            });
          }
          fileBuffer = await part.toBuffer();
          fileName = part.filename;
          break;
        }
      }

      if (!fileBuffer) {
        return reply.code(400).send({
          success: false,
          message: '请选择 .pt 模型文件',
          error: 'MISSING_FILE'
        });
      }

      // 确保目录存在
      await fs.promises.mkdir(MODEL_DIR, { recursive: true });

      // 写文件（原子写入：先写临时文件再重命名，防止上传中断损坏旧模型）
      const tmpPath = path.join(MODEL_DIR, `${MODEL_FILENAME}.tmp`);
      const finalPath = path.join(MODEL_DIR, MODEL_FILENAME);
      await fs.promises.writeFile(tmpPath, fileBuffer);
      await fs.promises.rename(tmpPath, finalPath);

      const fileSizeMb = (fileBuffer.length / 1024 / 1024).toFixed(2);

      request.log.info(
        { sizeMb: fileSizeMb, originalName: fileName },
        'Inference model uploaded successfully'
      );

      return reply.send({
        success: true,
        message: '模型上传成功',
        data: {
          fileName: MODEL_FILENAME,
          fileSizeMb: Number(fileSizeMb),
          path: finalPath,
          originalName: fileName
        }
      });
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack }, 'Inference model upload failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'UPLOAD_FAILED'
      });
    }
  });

  app.get('/inference-model/info', async (request, reply) => {
    try {
      const modelPath = path.join(MODEL_DIR, MODEL_FILENAME);

      if (!fs.existsSync(modelPath)) {
        return reply.send({
          success: true,
          data: {
            exists: false,
            message: '尚未上传推理模型'
          }
        });
      }

      const stat = await fs.promises.stat(modelPath);
      const fileSizeMb = (stat.size / 1024 / 1024).toFixed(2);
      const modifiedAt = stat.mtime.toISOString();

      return reply.send({
        success: true,
        data: {
          exists: true,
          fileName: MODEL_FILENAME,
          fileSizeMb: Number(fileSizeMb),
          modifiedAt
        }
      });
    } catch (error: any) {
      request.log.error({ error: error.message }, 'Inference model info failed');
      return reply.code(500).send({
        success: false,
        message: error.message,
        error: 'INTERNAL_ERROR'
      });
    }
  });
}
