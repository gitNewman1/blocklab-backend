# BlockLab Backend

BlockLab 后端 API 服务器

## 功能

- 模型文件上传（.io 和 .glb）
- .io 文件自动解析
- 华为云 OBS 文件存储
- PostgreSQL 数据库存储

## 技术栈

- Node.js 18+
- TypeScript
- Fastify
- Prisma
- PostgreSQL
- 华为云 OBS

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写配置：

```bash
cp .env.example .env
```

### 3. 初始化数据库

```bash
npx prisma generate
npx prisma migrate dev
```

### 4. 启动开发服务器

```bash
npm run dev
```

服务器将在 http://localhost:3000 启动

## API 接口

### 健康检查

```
GET /health
```

### 上传模型

```
POST /api/admin/models/upload
Content-Type: multipart/form-data

参数：
- name: 模型名称
- io_file: .io 文件
- glb_file: .glb 文件
- thumbnail: 缩略图（可选）
```

## 部署

参见 `docs/deployment-guide.md`
