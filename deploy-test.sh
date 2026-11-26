#!/bin/bash
# 测试环境部署脚本：拉取 test 分支 → 同步表结构 → 重启服务
set -e
cd "$(dirname "$0")"

git pull origin test
npx prisma db push
pm2 restart blocklab-api-test

echo "--- 状态 ---"
pm2 list | grep blocklab-api-test || true
sleep 2
curl -s -m 5 http://127.0.0.1:3001/health && echo
