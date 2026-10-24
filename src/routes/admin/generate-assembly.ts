import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { config } from '../../config';
import { LocalStorageService } from '../../services/local-storage.service';

const prisma = new PrismaClient();
const storageService = new LocalStorageService();

// 服务器端 assembly glb 生成：
// .io 源文件在模型上传时已存于 uploads/io-files/，本接口按模型 id 取该文件，
// 按需拉起 /srv/blocklab/ldraw/generator-server（Blender 无头生成），
// 生成结果拷贝到 uploads/parts/assembly_{id}.glb。
// 生成服务用完即停：每次请求重置 30 分钟空闲计时，超时无请求则 kill 进程。
const GENERATOR_PORT = Number(process.env.GENERATOR_PORT || 5177);
const GENERATOR_URL = `http://127.0.0.1:${GENERATOR_PORT}`;
const GENERATOR_DIR = process.env.GENERATOR_DIR || '/srv/blocklab/ldraw/generator-server';
const IDLE_STOP_MS = Number(process.env.GENERATOR_IDLE_MS || 30 * 60 * 1000);
const START_TIMEOUT_MS = 20 * 1000;

let generatorChild: ChildProcess | null = null;
let idleTimer: NodeJS.Timeout | null = null;

function stopIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function killGenerator(reason: string) {
  if (generatorChild) {
    const pid = generatorChild.pid;
    try {
      generatorChild.kill();
    } catch {
      // 进程已退出时忽略
    }
    generatorChild = null;
    console.log(`[generate-assembly] generator stopped (${reason}), pid=${pid}`);
  }
  stopIdleTimer();
}

function scheduleIdleStop() {
  stopIdleTimer();
  idleTimer = setTimeout(() => killGenerator('idle 30min'), IDLE_STOP_MS);
}

async function isGeneratorAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${GENERATOR_URL}/api/env-check`, {
      signal: AbortSignal.timeout(1500)
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 按需启动 generator-server，并等待其就绪
async function ensureGenerator(): Promise<void> {
  if (await isGeneratorAlive()) return;

  killGenerator('restart');
  const logFile = path.join(GENERATOR_DIR, 'generator.log');
  const logFd = fs.openSync(logFile, 'a');
  generatorChild = spawn('node', ['server.js'], {
    cwd: GENERATOR_DIR,
    env: { ...process.env, PORT: String(GENERATOR_PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', logFd, logFd],
    detached: false
  });
  console.log(`[generate-assembly] generator starting, pid=${generatorChild.pid}`);

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isGeneratorAlive()) return;
  }
  throw new Error(`generator-server failed to start within ${START_TIMEOUT_MS / 1000}s, see ${logFile}`);
}

export async function generateAssemblyRoutes(app: FastifyInstance) {
  app.post(
    '/generate-assembly',
    {
      schema: {
        tags: ['Admin Models'],
        summary: '服务器端生成分步动画 assembly_{id}.glb（按需拉起 Blender 生成服务）',
        description:
          '按模型 id 读取已上传的 .io 源文件（uploads/io-files/），调用本机 generator-server 生成 assembly_{id}.glb 并落到 uploads/parts/。生成服务空闲 30 分钟自动停止。',
        consumes: ['application/json']
      }
    },
    async (request, reply) => {
      const { id } = (request.body as { id?: number }) || {};
      if (!Number.isInteger(id) || (id as number) <= 0) {
        return reply.code(400).send({ success: false, message: 'id must be a positive integer', error: 'INVALID_ID' });
      }
      const modelId = id as number;

      try {
        const model = await prisma.model.findUnique({ where: { id: modelId } });
        if (!model) {
          return reply.code(404).send({ success: false, message: `Model ${modelId} not found`, error: 'NOT_FOUND' });
        }
        if (!model.ioFileUrl) {
          return reply.code(400).send({ success: false, message: 'Model has no .io source file', error: 'NO_IO_FILE' });
        }
        const ioPath = storageService.resolveUrlToAbsolutePath(model.ioFileUrl);
        if (!ioPath || !fs.existsSync(ioPath)) {
          return reply.code(400).send({
            success: false,
            message: `.io source file not found on disk: ${model.ioFileUrl}`,
            error: 'IO_FILE_MISSING'
          });
        }

        await ensureGenerator();
        scheduleIdleStop();

        // 把已存的 .io 转发给 generator-server（服务端本机 HTTP，开销可忽略）
        const ioBuffer = await fs.promises.readFile(ioPath);
        const form = new FormData();
        form.append('id', String(modelId));
        form.append('io_file', new Blob([new Uint8Array(ioBuffer)]), path.basename(ioPath));

        const startedAt = Date.now();
        const genRes = await fetch(`${GENERATOR_URL}/api/generate-assembly`, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(10 * 60 * 1000)
        });
        const genJson: any = await genRes.json();
        if (!genRes.ok || !genJson.success) {
          request.log.error({ modelId, genJson }, 'generator returned failure');
          return reply.code(500).send({
            success: false,
            message: genJson.message || 'Generate assembly GLB failed',
            error: 'GENERATION_FAILED',
            data: genJson.data || null
          });
        }

        // 生成产物从 ldraw/models_glb 拷贝到 uploads/parts/（对外静态目录）
        const glbSource = genJson.data.glbPath as string;
        const partsDir = path.join(config.storage.uploadRoot, 'parts');
        await fs.promises.mkdir(partsDir, { recursive: true });
        const glbTarget = path.join(partsDir, `assembly_${modelId}.glb`);
        await fs.promises.copyFile(glbSource, glbTarget);

        const base = config.storage.publicBaseUrl.replace(/\/+$/, '');
        return reply.send({
          success: true,
          message: '生成并落盘完成',
          data: {
            id: modelId,
            url: `${base}/static/parts/assembly_${modelId}.glb`,
            fileSize: genJson.data.fileSize,
            nodeCount: genJson.data.nodeCount,
            meshCount: genJson.data.meshCount,
            firstNodes: genJson.data.firstNodes,
            elapsedMs: Date.now() - startedAt,
            generatorElapsedMs: genJson.data.elapsedMs,
            log: genJson.data.log
          }
        });
      } catch (error: any) {
        request.log.error({ error: error.message, stack: error.stack }, 'generate-assembly failed');
        return reply.code(500).send({ success: false, message: error.message, error: 'INTERNAL_ERROR' });
      }
    }
  );
}
