# BlockLab Backend

Backend API for BlockLab model upload and `.io` parsing.

## Features
- Upload model files: `.io`, `.glb`, optional thumbnail
- Parse `.io` and store `parts_json` / `steps_json`
- Save uploaded files to local disk (`uploads/`)
- Store model metadata in PostgreSQL via Prisma

## Tech Stack
- Node.js 18+
- TypeScript
- Fastify
- Prisma
- PostgreSQL

## Quick Start
1. Install dependencies
```bash
npm install
```

2. Configure environment variables
```bash
cp .env.example .env
```

3. Initialize database
```bash
npx prisma generate
npx prisma migrate dev
```

4. Start development server
```bash
npm run dev
```

Server listens on `http://localhost:3000`.

## API

### Health check
`GET /health`

### Upload model
`POST /api/admin/models/upload` (`multipart/form-data`)

Required fields:
- `name`: model name
- `io_file`: `.io` file

Optional fields:
- `manual_file`: pdf file

### Image recognition and model match
`POST /api/recognition/image-match`

Supports:
- `application/json` with `image_url`
- `multipart/form-data` with `image_url` or `image_file` (only one)

Optional params:
- `min_confidence` (0-1, default `0.6`)
- `top_k` (default `4`)
- `include_model_detail` (`true/false`, default `false`; when true returns best-match model steps/parts detail)

Response includes:
- `recognizedParts` (aggregated classes and quantities from Roboflow)
- `matches` (model candidates with score)

## Local File Storage
- Default upload root: `./uploads`
- Returned file URL format: `{PUBLIC_BASE_URL}/static/{folder}/{filename}`
- Production should expose `uploads/` via Nginx `/static/` mapping.

## Roboflow
- `ROBOFLOW_API_KEY` is used for Roboflow workflow authentication.
- `ROBOFLOW_WORKFLOW_URL` must be configured in `.env`.

## Test Environment (服务器上的独立测试实例)

A separate test instance runs alongside production on the same host:

| | Production | Test |
|---|---|---|
| Working dir | `/srv/blocklab/backend` (branch `prod`) | `/srv/blocklab/backend-test` (branch `test`) |
| Branch | `prod` | `test` |
| Port | 3000 | 3001 |
| Database | `blocklab` | `blocklab_test` (一次性导入 prod 数据) |
| Upload root | `/data/blocklab/uploads` | `/srv/blocklab/backend-test/uploads` |
| Public base URL | `https://api.ai-youtoo.cn/blocklab` | `https://api.ai-youtoo.cn/blocklab-test` |
| Process manager | pm2 `blocklab-api` (`node dist/server.js`) | pm2 `blocklab-api-test` (`tsx watch`, 改代码自动重载，无需 build) |

Nginx (`/etc/nginx/conf.d/api.ai-youtoo.cn.conf`) strips the `/blocklab-test/` prefix before proxying to port 3001, so the backend code needs no changes. Uploaded files are served back via `/blocklab-test/static/`.

Deploy / update the test instance:

```bash
cd /srv/blocklab/backend-test
./deploy-test.sh   # git pull origin test -> prisma db push -> pm2 restart -> health check
```

Workflow: develop on the `test` branch, verify against the test instance, then merge into `prod`.
