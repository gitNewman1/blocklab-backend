# BlockLab 后端部署指南

## 文档说明

本文档提供 BlockLab 后端服务的完整部署流程，从代码上传到服务器运行。

**前置条件**：
- 已完成服务器基础环境搭建（参考 `server-setup-guide-centos8.md`）
- 服务器已安装 Node.js 18、PostgreSQL 14、PM2
- 已配置华为云 OBS

**预计部署时间**：30-40 分钟

---

## 一、准备工作

### 1.1 本地代码检查

在本地项目目录执行：

```bash
cd D:\ClaudeCode\BlockLab\backend

# 检查文件结构
dir /s /b
```

**确认以下文件存在**：
- package.json
- tsconfig.json
- .env.example
- prisma/schema.prisma
- src/server.ts
- src/app.ts
- src/config/index.ts
- src/services/obs.service.ts
- src/services/io-parser.service.ts
- src/routes/admin/models.ts
- src/types/index.ts

### 1.2 创建 .env 文件

在本地创建 `.env` 文件（不要提交到 Git）：

```bash
# 复制示例文件
copy .env.example .env
```

编辑 `.env` 文件，填写实际配置：

```env
# 数据库配置（替换为你的实际密码）
DATABASE_URL="postgresql://blocklab_user:your_actual_password@localhost:5432/blocklab"

# 服务器配置
PORT=3000
NODE_ENV=production

# 华为云 OBS 配置（替换为你的实际密钥）
OBS_ACCESS_KEY=your-actual-access-key
OBS_SECRET_KEY=your-actual-secret-key
OBS_BUCKET=blocklab-files
OBS_ENDPOINT=obs.cn-north-4.myhuaweicloud.com
```

**重要提示**：
- `your_actual_password` 替换为你在服务器上设置的数据库密码
- `your-actual-access-key` 和 `your-actual-secret-key` 从华为云控制台获取
- 确保 `.env` 文件在 `.gitignore` 中，不要上传到 GitHub

---

## 二、上传代码到 GitHub

### 2.1 初始化 Git 仓库

在本地项目目录执行：

```bash
cd D:\ClaudeCode\BlockLab\backend

# 初始化 Git
git init

# 添加所有文件
git add .

# 提交
git commit -m "Initial commit: BlockLab backend"
```

### 2.2 创建 GitHub 仓库

**方法 1：使用 GitHub CLI（推荐）**

```bash
# 创建私有仓库
gh repo create blocklab-backend --private --source=. --remote=origin --push
```

**方法 2：使用 GitHub 网页**

1. 访问 https://github.com/new
2. 仓库名称：`blocklab-backend`
3. 选择 Private（私有）
4. 不要勾选任何初始化选项
5. 点击 "Create repository"

然后在本地执行：

```bash
# 添加远程仓库（替换 YOUR_USERNAME）
git remote add origin https://github.com/YOUR_USERNAME/blocklab-backend.git

# 推送代码
git branch -M main
git push -u origin main
```

### 2.3 验证上传成功

访问 GitHub 仓库页面，确认代码已上传。

---

## 三、服务器部署

### 3.1 连接到服务器

使用 SSH 连接到你的服务器：

```bash
ssh root@你的服务器IP
```

### 3.2 克隆代码

```bash
# 进入项目目录
cd /var/www/blocklab

# 克隆代码（替换 YOUR_USERNAME）
git clone https://github.com/YOUR_USERNAME/blocklab-backend.git

# 进入项目目录
cd blocklab-backend
```

**如果是私有仓库**，需要配置 GitHub 访问：

```bash
# 方法 1：使用 Personal Access Token
git clone https://YOUR_TOKEN@github.com/YOUR_USERNAME/blocklab-backend.git

# 方法 2：配置 SSH Key（推荐）
# 在服务器上生成 SSH Key
ssh-keygen -t ed25519 -C "your_email@example.com"

# 查看公钥
cat ~/.ssh/id_ed25519.pub

# 复制公钥，添加到 GitHub Settings > SSH Keys
```

### 3.3 安装依赖

```bash
# 安装项目依赖
npm install
```

**注意**：这一步需要等待 3-5 分钟

### 3.4 配置环境变量

```bash
# 创建 .env 文件
vim .env
```

按 `i` 进入编辑模式，填写以下内容：

```env
DATABASE_URL="postgresql://blocklab_user:your_password@localhost:5432/blocklab"
PORT=3000
NODE_ENV=production
OBS_ACCESS_KEY=your-access-key
OBS_SECRET_KEY=your-secret-key
OBS_BUCKET=blocklab-files
OBS_ENDPOINT=obs.cn-north-4.myhuaweicloud.com
```

按 `Esc`，输入 `:wq` 保存并退出。

**重要**：
- 将 `your_password` 替换为你的数据库密码
- 将 `your-access-key` 和 `your-secret-key` 替换为华为云 OBS 密钥

### 3.5 生成 Prisma Client

```bash
# 生成 Prisma Client
npx prisma generate
```

### 3.6 运行数据库迁移

```bash
# 运行数据库迁移
npx prisma migrate deploy
```

**预期输出**：
```
Applying migration `20240323000000_init`
The following migration(s) have been applied:

migrations/
  └─ 20240323000000_init/
    └─ migration.sql

All migrations have been successfully applied.
```

### 3.7 构建项目

```bash
# 编译 TypeScript
npm run build
```

**预期输出**：
- 在 `dist/` 目录生成编译后的 JavaScript 文件

### 3.8 启动应用

```bash
# 使用 PM2 启动应用
pm2 start npm --name blocklab-api -- start

# 查看应用状态
pm2 status
```

**预期输出**：
```
┌─────┬──────────────┬─────────┬─────────┬─────────┐
│ id  │ name         │ status  │ restart │ uptime  │
├─────┼──────────────┼─────────┼─────────┼─────────┤
│ 0   │ blocklab-api │ online  │ 0       │ 0s      │
└─────┴──────────────┴─────────┴─────────┴─────────┘
```

### 3.9 查看日志

```bash
# 查看实时日志
pm2 logs blocklab-api

# 查看最近 100 行日志
pm2 logs blocklab-api --lines 100
```

**预期输出**：
```
Server running on http://0.0.0.0:3000
```

### 3.10 设置开机自启

```bash
# 生成启动脚本
pm2 startup

# 复制输出的命令并执行（类似下面这样）
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root

# 保存当前进程列表
pm2 save
```

---

## 四、验证部署

### 4.1 测试健康检查

在服务器上执行：

```bash
# 测试本地访问
curl http://localhost:3000/health
```

**预期输出**：
```json
{"status":"ok"}
```

### 4.2 测试外网访问

在本地电脑浏览器访问：

```
http://你的服务器IP:3000/health
```

**如果无法访问**，检查防火墙：

```bash
# 检查防火墙状态
firewall-cmd --list-ports

# 如果 3000 端口未开放，执行：
firewall-cmd --permanent --add-port=3000/tcp
firewall-cmd --reload
```

### 4.3 测试文件上传 API

使用 Postman 或 curl 测试：

```bash
curl -X POST http://你的服务器IP:3000/api/admin/models/upload \
  -F "name=测试模型" \
  -F "io_file=@/path/to/test.io" \
  -F "glb_file=@/path/to/test.glb"
```

**预期输出**：
```json
{
  "success": true,
  "message": "模型上传成功",
  "data": {
    "id": 1,
    "name": "测试模型",
    "io_file_url": "https://...",
    "model_3d_url": "https://...",
    ...
  }
}
```

### 4.4 验证数据库

```bash
# 连接数据库
PGPASSWORD=your_password psql -U blocklab_user -h localhost -d blocklab

# 查看 models 表
SELECT id, name, created_at FROM models;

# 退出
\q
```

---

## 五、配置 Nginx 反向代理（可选但推荐）

### 5.1 创建 Nginx 配置

```bash
vim /etc/nginx/conf.d/blocklab-api.conf
```

填写以下内容：

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;  # 替换为你的域名或 IP

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # 文件上传大小限制
        client_max_body_size 50M;
    }
}
```

### 5.2 测试并重启 Nginx

```bash
# 测试配置
nginx -t

# 重启 Nginx
systemctl restart nginx
```

### 5.3 配置 SELinux

```bash
# 允许 Nginx 网络连接
setsebool -P httpd_can_network_connect 1
```

### 5.4 测试 Nginx 代理

```bash
# 通过 Nginx 访问
curl http://你的服务器IP/health
```

---

## 六、华为云 OBS 配置

### 6.1 创建 OBS Bucket

1. 登录华为云控制台
2. 进入"对象存储服务 OBS"
3. 点击"创建桶"
4. 填写信息：
   - 桶名称：`blocklab-files`
   - 区域：选择与服务器相同的区域
   - 存储类别：标准存储
   - 桶策略：私有
5. 点击"立即创建"

### 6.2 获取访问密钥

1. 点击右上角用户名 → "我的凭证"
2. 点击"访问密钥" → "新增访问密钥"
3. 下载 credentials.csv 文件
4. 记录 Access Key ID 和 Secret Access Key

### 6.3 配置 Bucket 权限（可选）

如果需要公开访问文件：

1. 进入 Bucket 详情
2. 点击"权限管理" → "桶策略"
3. 添加公共读策略

---

## 七、常见问题排查

### 7.1 应用无法启动

**问题**：`pm2 status` 显示 `errored`

**排查步骤**：

```bash
# 查看错误日志
pm2 logs blocklab-api --err

# 常见原因：
# 1. 端口被占用
netstat -tulpn | grep 3000

# 2. 环境变量配置错误
cat .env

# 3. 数据库连接失败
PGPASSWORD=your_password psql -U blocklab_user -h localhost -d blocklab
```

### 7.2 数据库连接失败

**问题**：日志显示 "database connection failed"

**解决方案**：

```bash
# 检查 PostgreSQL 状态
systemctl status postgresql-14

# 检查数据库是否存在
su - postgres
psql -l | grep blocklab
exit

# 检查用户权限
su - postgres
psql
\du blocklab_user
\q
exit
```

### 7.3 OBS 上传失败

**问题**：上传文件时返回 "OBS upload failed"

**排查步骤**：

```bash
# 检查环境变量
cat .env | grep OBS

# 测试 OBS 连接（在本地测试）
# 使用华为云 OBS 控制台上传测试文件
```

### 7.4 文件上传过大

**问题**：上传大文件时返回 413 错误

**解决方案**：

```bash
# 修改 Nginx 配置
vim /etc/nginx/conf.d/blocklab-api.conf

# 添加或修改
client_max_body_size 100M;

# 重启 Nginx
systemctl restart nginx
```

---

## 八、日常维护

### 8.1 查看应用状态

```bash
# 查看 PM2 进程
pm2 status

# 查看实时日志
pm2 logs blocklab-api

# 查看应用信息
pm2 info blocklab-api
```

### 8.2 重启应用

```bash
# 重启应用
pm2 restart blocklab-api

# 重新加载（零停机）
pm2 reload blocklab-api
```

### 8.3 更新代码

```bash
# 进入项目目录
cd /var/www/blocklab/blocklab-backend

# 拉取最新代码
git pull origin main

# 安装新依赖（如果有）
npm install

# 运行数据库迁移（如果有）
npx prisma migrate deploy

# 重新构建
npm run build

# 重启应用
pm2 restart blocklab-api
```

### 8.4 数据库备份

```bash
# 备份数据库
PGPASSWORD=your_password pg_dump -U blocklab_user -h localhost blocklab > backup_$(date +%Y%m%d).sql

# 恢复数据库
PGPASSWORD=your_password psql -U blocklab_user -h localhost blocklab < backup_20260323.sql
```

### 8.5 查看系统资源

```bash
# 查看内存使用
free -h

# 查看磁盘使用
df -h

# 查看 CPU 和进程
top
```

---

## 九、安全建议

### 9.1 配置 HTTPS（推荐）

使用 Let's Encrypt 免费证书：

```bash
# 安装 Certbot
dnf install -y certbot python3-certbot-nginx

# 获取证书（替换为你的域名）
certbot --nginx -d api.yourdomain.com

# 自动续期
certbot renew --dry-run
```

### 9.2 限制 API 访问

在 Nginx 中添加 IP 白名单：

```nginx
location /api/admin/ {
    allow 你的IP地址;
    deny all;

    proxy_pass http://localhost:3000;
}
```

### 9.3 定期更新系统

```bash
# 每周执行一次
dnf update -y
```

---

## 十、部署检查清单

部署完成后，逐项检查：

- [ ] 代码已上传到 GitHub
- [ ] 服务器已克隆代码
- [ ] 依赖已安装（npm install）
- [ ] 环境变量已配置（.env）
- [ ] Prisma Client 已生成
- [ ] 数据库迁移已执行
- [ ] 项目已构建（npm run build）
- [ ] PM2 应用已启动且状态为 online
- [ ] 健康检查接口返回正常（/health）
- [ ] 文件上传 API 测试通过
- [ ] 数据库中有测试数据
- [ ] 防火墙已开放 3000 端口
- [ ] Nginx 反向代理已配置（可选）
- [ ] 华为云 OBS 已配置
- [ ] PM2 开机自启已设置

---

## 十一、下一步

部署完成后，你可以：

1. **准备测试数据**：上传 10 个乐高模型的 .io 和 .glb 文件
2. **开发客户端**：使用部署的 API 进行客户端开发
3. **实现其他功能**：识别匹配算法、社区功能等
4. **性能优化**：添加缓存、CDN 加速等

---

## 附录：快速部署脚本

创建一个自动化部署脚本 `deploy.sh`：

```bash
#!/bin/bash

echo "开始部署 BlockLab Backend..."

# 拉取最新代码
git pull origin main

# 安装依赖
npm install

# 运行数据库迁移
npx prisma migrate deploy

# 构建项目
npm run build

# 重启应用
pm2 restart blocklab-api

echo "部署完成！"
pm2 status
```

使用方法：

```bash
chmod +x deploy.sh
./deploy.sh
```

---

## 总结

本文档提供了 BlockLab 后端的完整部署流程，包括：

1. ✅ 代码上传到 GitHub
2. ✅ 服务器克隆代码
3. ✅ 安装依赖和配置环境
4. ✅ 数据库迁移
5. ✅ 启动应用
6. ✅ 配置 Nginx（可选）
7. ✅ 华为云 OBS 配置
8. ✅ 验证部署
9. ✅ 日常维护

**预计部署时间**：30-40 分钟

如遇问题，参考"常见问题排查"章节或查看应用日志。

祝你部署顺利！🚀
