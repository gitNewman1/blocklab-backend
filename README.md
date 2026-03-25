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
- `glb_file`: `.glb` file

Optional fields:
- `thumbnail`: image file

## Local File Storage
- Default upload root: `./uploads`
- Returned file URL format: `{PUBLIC_BASE_URL}/static/{folder}/{filename}`
- Production should expose `uploads/` via Nginx `/static/` mapping.

