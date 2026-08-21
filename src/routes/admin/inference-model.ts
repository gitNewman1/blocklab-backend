import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';

const MODEL_DIR = path.resolve(config.storage.uploadRoot, '..', 'inference_service');
const MODEL_FILENAME = 'best.pt';

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
