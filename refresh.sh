#!/bin/bash
set -e
npx prisma db push
npm run build
pm2 restart blocklab-api
