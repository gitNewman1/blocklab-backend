# blocklab 全套服务迁移部署手册

> 适用场景：把旧服务器 `121.37.160.39`（CentOS 8.5，即将到期）上的 blocklab 小程序后端全套服务，完整还原到一台新服务器。
> 备份产物位于旧机 `/root/backup-20260928/`，共 6 个文件、约 257MB。
> 编写日期：2026-09-28（依据旧机实际配置逐项核对，非通用模板）

---

## 0. 迁移总览

### 0.1 要迁移的东西（与备份包一一对应）

| 备份文件 | 内容 | 大小 | 新机落点 |
|---|---|---|---|
| `blocklab-db.sql` | PostgreSQL `blocklab` 库全量 dump | 324K | PostgreSQL 数据目录（由 psql 导入） |
| `blocklab-files.tar.gz` | `uploads/`（222 个文件：3D 模型、手册、作品图、缩略图、IO 文件、头像）+ `inference_service/best.pt` | 251M | `/var/www/blocklab-backend/` |
| `blocklab-configs.tar.gz` | `.env`、nginx 两个站点、coturn、clash、`ecosystem.config.js`、`.ssh`、pm2 dump | 76K | 各自原路径（`-C /` 解包） |
| `misc-projects.tar.gz` | `devpocket-server`（无 git）+ `dacun` 官网静态站（无 git） | 4.4M | `/opt/Projects/`、`/var/www/` |
| `extras-nginx-clash.tar.gz` | `/usr/share/nginx/html/test-upload.html`、`/etc/clash/Country.mmdb` | 4.3M | 各自原路径 |
| `SHA256SUMS` | 上述五个包的校验和 | — | 用于传输后校验 |

> 不在备份里、需要重新获取的：代码本体（GitHub `git@github.com:gitNewman1/blocklab-backend.git` 分支 `prod`）、`node_modules`/`dist`（重新安装构建）、系统软件。
> 旧机源码的当前提交是 `1052b0c`（含微信登录 + 头像上传），已推送。

### 0.2 服务拓扑（新机要还原成这样）

```
                          ┌──────────────────────────── 新服务器 ────────────────────────────┐
小程序 ──HTTPS──▶ :443/:80 ─nginx─┬─ location /          ──▶ 127.0.0.1:3000  blocklab-api (pm2)
                                  ├─ location /static/    ──▶ /var/www/blocklab-backend/uploads/
                                  └─ location = /test-upload.html ──▶ /usr/share/nginx/html/
浏览器 ──────────▶ :9001 (dacun)  ─▶ /var/www/dacun 官网静态站
PC/移动端 ───────▶ :9876/ws       ─▶ devpocket-signaling (pm2, WebSocket 信令)
PC/移动端 ───────▶ :3478 tcp+udp  ─▶ coturn (TURN 中继)
blocklab-api ────▶ 127.0.0.1:5432 ─▶ PostgreSQL 14  (库 blocklab, 用户 blocklab_user)
blocklab-api ────▶ 127.0.0.1:8000 ─▶ blocklab-inference (pm2, uvicorn+YOLO, CPU)
blocklab-api ────▶ 127.0.0.1:7890 ─▶ clash (HTTP 代理，出网用)
blocklab-api ────▶ 外网            ─▶ 微信 jscode2session、Rebrickable、Roboflow、Hunyuan3D
```

### 0.3 端口清单

| 端口 | 服务 | 是否对外开放 | 说明 |
|---|---|---|---|
| 22 | sshd | ✅ | 管理 |
| 80 / 443 | nginx | ✅ | API 反代 + 静态资源；443 待配证书 |
| 9001 | nginx | ✅ | dacun 官网 |
| 9876 | devpocket-signaling | ✅ | 客户端要连，必须公网可达 |
| 3478 tcp+udp、5349 | coturn | ✅ | TURN/STUN；另需 49152-65535/udp 中继段 |
| 3000 | blocklab-api | ❌ **建议只对内** | 旧机暴露了，新机建议只走 nginx |
| 5432 | PostgreSQL | ❌ **建议只对内** | 旧机暴露了，新机建议关闭外网 |
| 8000 | 推理服务 | ❌ | 仅本机调用 |
| 7890 / 7891 | clash | ❌ | 仅本机出网用 |

> 旧机 firewalld 实际开放：`22,80,443,3000,5432,9876,3478/tcp,3478/udp,5349/tcp,49152-65535/udp,9001`。
> 云厂商安全组是另一层，**两层都要按上表调整**。

### 0.4 版本对照（新机照此安装或更高大版本）

| 组件 | 旧机版本 | 备注 |
|---|---|---|
| OS | CentOS Linux 8.5.2111（已 EOL） | 新机建议 Rocky/Alma 8/9 或 Ubuntu 22.04 |
| nginx | 1.14.1 | 任意 1.18+ 均可 |
| PostgreSQL | 14.22 | **建议同为 14.x**，避免 dump 跨大版本问题 |
| Node.js | v18.20.8 / npm 10.8.2 | 必须 18.x（代码 CommonJS + Fastify 4） |
| pm2 | 7.0.3 | 进程守卫 |
| Python（推理） | 解释器 `python3.9`（系统 python3 是 3.6.8，不能用） | 需 fastapi/uvicorn/ultralytics/opencv |
| clash / coturn | 已装并开机自启 | 代理与 TURN |

---

## 1. 准备工作

### 1.1 新机规格建议

- CPU 2 核以上（推理是 **CPU 模式** `device: cpu`，模型 `best.pt` 仅 6MB，2~4 核够用）
- 内存 ≥ 4G（Python + ultralytics + torch 峰值较高）
- 磁盘 ≥ 40G（依赖与 torch 体积大；业务数据不到 1G）

### 1.2 从旧机取走备份包

在**你的电脑**上执行（旧机到期前务必完成）：

```bash
# 方式一：scp
scp -r root@121.37.160.39:/root/backup-20260928 ./blocklab-backup

# 方式二：rsync（断点续传，推荐 251M 大包）
rsync -avP root@121.37.160.39:/root/backup-20260928/ ./blocklab-backup/
```

再上传到新机：

```bash
scp -r ./blocklab-backup root@<新机IP>:/root/
```

> ⚠️ `blocklab-configs.tar.gz` 内含明文密钥（数据库密码、`WX_SECRET`、`JWT_SECRET`、第三方 API Key、SSH 私钥）。传输走可信网络，落盘后建议 `chmod 600` 限制权限，不要放公共网盘/仓库。

### 1.3 校验备份完整性（**上新机后第一步**）

```bash
cd /root/backup-20260928
sha256sum -c SHA256SUMS
# 五个包全部 OK 才继续；任何一个 FAILED 就重新传，别接着装
```

预期校验和（`SHA256SUMS` 内容，前 16 位便于肉眼比对）：

```
42c51115801665d6…  blocklab-db.sql
8ea81908c4e3646f…  blocklab-files.tar.gz
69539ece0fc28137…  blocklab-configs.tar.gz
198e35fd1dacf35d…  misc-projects.tar.gz
22485384fa185a32…  extras-nginx-clash.tar.gz
```

### 1.4 配置安全组与防火墙

按 §0.3 表格开放端口。新机 firewalld 示例（只开必要的）：

```bash
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-port=80/tcp
firewall-cmd --permanent --add-port=443/tcp
firewall-cmd --permanent --add-port=9001/tcp          # dacun 官网
firewall-cmd --permanent --add-port=9876/tcp          # devpocket 信令
firewall-cmd --permanent --add-port=3478/tcp --add-port=3478/udp
firewall-cmd --permanent --add-port=5349/tcp
firewall-cmd --permanent --add-port=49152-65535/udp   # coturn 中继段
firewall-cmd --reload
firewall-cmd --list-ports
```

**不要**把 3000、5432、8000、7890 开到公网。

---

## 2. 系统环境准备

### 2.1 安装软件

**CentOS/Rocky/Alma 8+（与原机同系）**

```bash
dnf install -y epel-release
dnf install -y nginx postgresql14-server postgresql14-contrib
dnf module install -y nodejs:18
# Python 3.9（推理用）：系统包或源码编译
dnf install -y python39 python39-devel gcc gcc-c++ make
/usr/bin/python3.9 -m pip install -U pip
# pm2
npm install -g pm2@7
```

**Ubuntu 22.04（若换系统）**

```bash
apt update
apt install -y nginx postgresql-14 postgresql-contrib python3.9 python3.9-venv python3-pip
curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && apt install -y nodejs
npm install -g pm2@7
```

### 2.2 基础设置

```bash
timedatectl set-timezone Asia/Shanghai     # 日志/时间相关
systemctl enable --now postgresql-14       # CentOS 包名；Ubuntu 为 postgresql
systemctl enable --now nginx
```

### 2.3 建目录骨架

```bash
mkdir -p /var/www/blocklab-backend          # 后端 + uploads + inference_service
mkdir -p /var/www/dacun                     # 官网静态站
mkdir -p /opt/Projects/devpocket-server     # 信令服务
mkdir -p /usr/share/nginx/html              # nginx 静态页(含 test-upload.html)
```

> 旧机上这些目录属主均为 `root:root`、权限 `755`，且 **pm2 以 root 运行**（`node dist/server.js` 进程属主是 root）。新机照此即可，若要换成非 root 用户，需同步改所有目录属主与 nginx 读取权限。

---

## 3. 恢复数据库

### 3.1 取出数据库凭据

认证信息藏在 `.env` 的 `DATABASE_URL` 里。先解出配置看一眼（**用户名密码不要改**，改了要同步改 `.env`）：

```bash
mkdir -p /tmp/cfg && tar xzf /root/backup-20260928/blocklab-configs.tar.gz -C /tmp/cfg
grep -E '^DATABASE_URL' /tmp/cfg/var/www/blocklab-backend/.env
# 形如：DATABASE_URL="postgresql://blocklab_user:xxxxx@localhost:5432/blocklab"
```

### 3.2 建角色与建库（**角色必须先存在**）

旧机的库属主是 `postgres`，但所有业务表属主是 `blocklab_user`；且 dump 内含 `ALTER TABLE ... OWNER TO blocklab_user` 语句，所以角色必须先建好：

```bash
su postgres -c "psql -c \"CREATE ROLE blocklab_user LOGIN PASSWORD '把上面密码抄进来';\""
su postgres -c "psql -c \"CREATE DATABASE blocklab OWNER blocklab_user;\""
```

### 3.3 导入 dump

> ⚠️ 实测踩过的坑：`postgres` 系统用户读不了 `/root`（权限 700），直接 `-f /root/...` 会报 `Permission denied`。**先拷到 `/tmp` 并放开读权限**：

```bash
cp /root/backup-20260928/blocklab-db.sql /tmp/blocklab-db.sql && chmod 644 /tmp/blocklab-db.sql
su postgres -c "psql -v ON_ERROR_STOP=1 -d blocklab -f /tmp/blocklab-db.sql" 2>&1 | tail -5
rm -f /tmp/blocklab-db.sql
```

用超级用户 `postgres` 导入（而不是 `blocklab_user`）的原因：dump 里的 `OWNER TO` 语句需要超级用户权限才能生效，这样还原后表属主与旧机完全一致。

### 3.4 行数自检（**判断"数据真的回来了"的唯一标准**）

```bash
su postgres -c "psql -d blocklab -Atc \"select 'users='||(select count(*) from users)||' works='||(select count(*) from works)||' models='||(select count(*) from models)||' model_types='||(select count(*) from model_types)||' work_likes='||(select count(*) from work_likes)||' recommended_models='||(select count(*) from recommended_models)||' _prisma_migrations='||(select count(*) from _prisma_migrations);\""
```

旧机实测基准值（2026-09-28 导出当日）：

```
users=4 works=5 models=22 model_types=6 work_likes=2 recommended_models=4 _prisma_migrations=2
```

再确认表属主（应全部是 `blocklab_user`）：

```bash
su postgres -c "psql -d blocklab -Atc \"select tablename||' -> '||tableowner from pg_tables where schemaname='public' order by 1;\""
```

### 3.5 不要再执行 prisma migrate / db push

数据库由 dump 还原，schema 已就绪。后续**只需要** `npx prisma generate`（生成 client 代码），**不要**跑 `prisma db push` 或 `migrate deploy`，以免与 dump 结果产生偏差。

---

## 4. 恢复文件与模型

```bash
# 4.1 业务上传文件 + 识别模型（注意：必须在项目根目录下解包，包内是相对路径）
cd /var/www/blocklab-backend
tar xzf /root/backup-20260928/blocklab-files.tar.gz

# 4.2 两个无 git 项目
tar xzf /root/backup-20260928/misc-projects.tar.gz -C /

# 4.3 nginx 测试页 + clash 规则库
tar xzf /root/backup-20260928/extras-nginx-clash.tar.gz -C /
```

校验（数字要对得上）：

```bash
ls /var/www/blocklab-backend/uploads/
# 期望 11 个目录：avatars files images io-files manuals models-3d parts
#                recommended recognition-images thumbnails（posts 为空）
find /var/www/blocklab-backend/uploads -type f | wc -l      # 期望 222
ls -lh /var/www/blocklab-backend/inference_service/best.pt  # 期望 6.0M
ls -d /var/www/dacun /opt/Projects/devpocket-server /usr/share/nginx/html/test-upload.html /etc/clash/Country.mmdb
```

权限（`uploads` 必须能被 nginx 读取，应用以 root 运行需可写）：

```bash
chown -R root:root /var/www/blocklab-backend /var/www/dacun /opt/Projects/devpocket-server
chmod -R 755 /var/www/blocklab-backend/uploads
```

> 注：`misc-projects.tar.gz` 里已含 `devpocket-server/node_modules`（就一个 `ws` 依赖），解包后可直接启动；若你选择重装，执行 `npm install`。

---

## 5. 恢复配置

### 5.1 按原路径解包

```bash
tar xzf /root/backup-20260928/blocklab-configs.tar.gz -C /

# 收权限
chmod 600 /var/www/blocklab-backend/.env
chmod 700 /root/.ssh && chmod 600 /root/.ssh/id_ed25519
```

包内文件（共 11 个，逐一确认存在）：

| 路径 | 用途 |
|---|---|
| `/var/www/blocklab-backend/.env` | 全部密钥与运行参数 |
| `/etc/nginx/conf.d/blocklab.conf` | API 反代 + `/static/` 静态 |
| `/etc/nginx/conf.d/dacun.conf` | 官网 9001 |
| `/etc/coturn/turnserver.conf` | TURN 服务 |
| `/etc/clash/jjfly.yaml` | 出网代理 |
| `/root/ecosystem.config.js` | pm2 应用定义 |
| `/root/.ssh/id_ed25519(.pub)`、`known_hosts`、`authorized_keys` | GitHub 部署密钥 |
| `/root/.pm2/dump.pm2` | pm2 进程快照（参考用） |

### 5.2 `.env` 必须复核的项

| 键 | 处理 |
|---|---|
| `DATABASE_URL` | 主机保持 `localhost:5432`，库名/用户/密码与 §3.2 一致 |
| `PUBLIC_BASE_URL` | **必须改**：`http://121.37.160.39` → 新域名（带 https）。头像/上传返回的 URL 由它拼接 |
| `WX_APPID` | 保持 `wxa5731a718db4cf65` |
| `WX_SECRET` | 沿用备份值（若怀疑泄露，去公众平台重置后同步） |
| `JWT_SECRET` | 沿用即可；更换会让所有已签发 token 立即失效 |
| `REBRICKABLE_*` / `ROBOFLOW_*` / `HUNYUAN3D_*` | 沿用备份值 |
| `INFERENCE_SERVICE_URL` | 同机部署则保持 `http://127.0.0.1:8000` |
| `PORT` / `UPLOAD_ROOT` / `MAX_FILE_SIZE_MB` | 保持（3000 / `./uploads` / 50） |

### 5.3 旧 IP 残留清理（**必须全查一遍**）

```bash
grep -rn "121\.37\.160\.39" /var/www /etc/nginx /usr/share/nginx/html /opt/Projects \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist
```

已知会出现的位置，逐个改成新 IP/域名：

1. `/var/www/blocklab-backend/.env` → `PUBLIC_BASE_URL`
2. `/etc/nginx/conf.d/blocklab.conf` → `server_name 121.37.160.39 127.0.0.1 localhost;`
3. `/etc/nginx/conf.d/dacun.conf` → `server_name` 及文件头注释
4. `/var/www/blocklab-backend/test-upload.html`（约 521 行）→ `const DEFAULT_ASSEMBLY_UPLOAD_SERVER = 'http://121.37.160.39:3000';`
5. `/usr/share/nginx/html/test-upload.html` → 同款测试页，也要改
6. **不在本机**：devpocket 客户端里的信令地址 `ws://121.37.160.39:9876/ws` 与 TURN 地址，需在客户端项目/App 里另外修改

### 5.4 clash 代理：必须先决策（否则 API 出网全挂）

`ecosystem.config.js` 给 API 进程注入了 `HTTP_PROXY`/`HTTPS_PROXY=http://127.0.0.1:7890`。**新机若没有 clash，微信换 openid、Rebrickable、Roboflow 全部会超时失败。** 两条路二选一：

- **方案 A：也部署 clash**（配置已备份）。恢复 `jjfly.yaml` + `Country.mmdb`，设置 systemd 自启，确认 7890 在听。
- **方案 B：新机直连外网，就删掉代理**。把 `/root/ecosystem.config.js` 里的 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` 三个 env 去掉。

先测连通性再决策：

```bash
curl -s -m 8 -o /dev/null -w "direct=%{http_code}\n" https://api.weixin.qq.com/sns/jscode2session
curl -s -m 8 -o /dev/null -w "via7890=%{http_code}\n" -x http://127.0.0.1:7890 https://api.weixin.qq.com/sns/jscode2session
# 若 direct 直接 200，选方案 B（更简单、少一个依赖）
```

---

## 6. 部署后端 API

### 6.1 取代码（**别覆盖已解包的 uploads**）

代码从 GitHub 取：`git@github.com:gitNewman1/blocklab-backend.git`，分支 `prod`（当前提交 `1052b0c`）。

如果 `/var/www/blocklab-backend` 已经按 §4 解包过 `uploads/`，就**不要**直接 `git clone` 进去（非空目录会失败）。用下面两步把代码放进去、且不动 `uploads/`：

```bash
git clone -b prod git@github.com:gitNewman1/blocklab-backend.git /tmp/blocklab-repo
rsync -a /tmp/blocklab-repo/ /var/www/blocklab-backend/    # 含 .git，方便以后 git pull；不带 --delete，不会删 uploads
rm -rf /tmp/blocklab-repo
ls /var/www/blocklab-backend    # 应同时看到 uploads/ 与 package.json / src/ / prisma/
```

**部署密钥**：备份里已有 `/root/.ssh/id_ed25519`（能推 GitHub 的那把），沿用即可：

```bash
ssh -T git@github.com        # 出现 "Hi ...! You've successfully authenticated" 即通
```

若不用旧密钥：`ssh-keygen -t ed25519` 生成新钥，把 `.pub` 内容贴到 GitHub 仓库 → Settings → Deploy keys。

### 6.2 安装依赖

```bash
cd /var/www/blocklab-backend
npm ci            # 有 package-lock.json；如报错退化为 npm install
```

> `package-lock.json` 里已把 `@fastify/static` 固定为 `6.12.0`（Fastify 4 兼容性修复），不要手动升级该依赖。

### 6.3 生成 Prisma Client（**只 generate，不 db push**）

```bash
npx prisma generate
```

### 6.4 构建

```bash
npm run build                 # tsc → dist/
ls -l dist/server.js
```

### 6.5 用 pm2 启动全部服务

旧机的 `ecosystem.config.js` **只定义了 blocklab-api**，推理与信令是手工 `pm2 start` 的（参数从 pm2 记录抄出）。新机建议三个应用一并固化，把 `/root/ecosystem.config.js` 改成：

```js
module.exports = {
  apps: [
    {
      name: 'blocklab-api',
      script: 'dist/server.js',
      cwd: '/var/www/blocklab-backend',
      env: {
        // §5.4 选方案 A 时保留这三行；选方案 B（新机直连外网）就删掉
        HTTP_PROXY: 'http://127.0.0.1:7890',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: 'localhost,127.0.0.1'
      }
    },
    {
      name: 'blocklab-inference',
      script: '/usr/local/bin/uvicorn',
      interpreter: 'python3.9',
      args: 'main:app --host 0.0.0.0 --port 8000',
      cwd: '/var/www/blocklab-backend/inference_service',
      env: { MODEL_PATH: 'best.pt' }
    },
    {
      name: 'devpocket-signaling',
      script: 'server.js',
      cwd: '/opt/Projects/devpocket-server',
      env: { PORT: '9876' }
    }
  ]
};
```

```bash
pm2 start /root/ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root   # 按提示执行它输出的那一行命令，实现开机自启
pm2 list
curl -s http://127.0.0.1:3000/health     # 期望 {"status":"ok"}
```

> 改了 `.env` 后要让进程重新读取：`pm2 restart blocklab-api --update-env`。

---

## 7. 部署推理服务（blocklab-inference）

### 7.1 安装 Python 依赖

```bash
/usr/bin/python3.9 -m pip install -r /var/www/blocklab-backend/inference_service/requirements.txt
# ultralytics 会连带安装 torch，体积大（1~2G+），预留磁盘与时间
```

> ⚠️ 系统自带的 `python3` 是 3.6.8，**不能**用来跑这个服务（ultralytics 需要 3.8+）。必须用 `python3.9`。
> 依赖清单：`fastapi / uvicorn[standard] / ultralytics / httpx / opencv-python-headless / numpy / python-multipart / pydantic`。

自检：

```bash
python3.9 -c "import ultralytics, fastapi, cv2, numpy; print('deps ok')"
```

### 7.2 启动

已包含在 §6.5 的 pm2 配置中。手工单独启动的等价命令：

```bash
cd /var/www/blocklab-backend/inference_service
MODEL_PATH=best.pt python3.9 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 7.3 验收

```bash
curl -s http://127.0.0.1:8000/health
# 期望：{"status":"ok","model":"best.pt","device":"cpu"}
```

接口为 `POST /detect`（支持 `{"image_url": "..."}` 或 `-F image=@photo.jpg`），返回格式与 Roboflow 工作流兼容，所以 Node 后端无需改动。

### 7.4 备选：Docker 方式

`inference_service/Dockerfile` 在仓库里，可按需构建容器替代 pm2 托管（注意 `best.pt` 要用 §4 恢复的文件挂载进去）。

---

## 8. 部署 devpocket 信令服务

### 8.1 依赖

备份包里已带 `node_modules`（只有一个 `ws` 依赖）。若重装：

```bash
cd /opt/Projects/devpocket-server && npm install
```

### 8.2 启动与验收

pm2 启动见 §6.5；等价命令 `PORT=9876 node server.js`。

```bash
curl -s http://127.0.0.1:9876/health
# 期望：{"status":"ok","rooms":0,"connections":0}
```

服务特性：WebSocket 路径 `/ws`，房间内存态（重启即清空），`MAX_ROOMS` 默认 100，`/health` 返回房间与连接数。

### 8.3 客户端侧要改的地方（**不在本机**）

- 信令地址：`ws://<新IP或域名>:9876/ws`
- ICE/TURN 地址：`turn:<新IP>:3478`，用户名/密码见 `/etc/coturn/turnserver.conf`
- 若客户端页面本身是 HTTPS，必须用 `wss://`，需要给 9876 配 TLS 或经 nginx 反代 WSS

---

## 9. coturn 与 clash（按需部署）

### 9.1 coturn（devpocket 需要，建议装）

```bash
grep -E "^(listening-port|realm|external-ip|static-auth-secret|user)" /etc/coturn/turnserver.conf
# external-ip 若写死了旧公网 IP，改成新 IP
systemctl enable --now coturn
ss -tlnp | grep 3478
```

防火墙需放行 `3478/tcp`、`3478/udp` 与中继段 `49152-65535/udp`。

### 9.2 clash（仅当 §5.4 选方案 A）

配置已随备份恢复（`/etc/clash/jjfly.yaml` + `Country.mmdb`）：

```bash
systemctl enable --now clash
ss -tlnp | grep -E "7890|7891"
curl -s -m 8 -o /dev/null -w "via7890=%{http_code}\n" -x http://127.0.0.1:7890 https://api.weixin.qq.com/sns/jscode2session
```

> 订阅链接若是临时性质，可能已过期，需要重新获取（备份里只是当时那份）。

---

## 10. Nginx 配置

### 10.1 配置已恢复（§5），修改要点

- `blocklab.conf`：`server_name` → 新域名；`client_max_body_size 100M` 保留（大文件上传）；`location /static/` 的 `alias /var/www/blocklab-backend/uploads/` 不要改；`location /` 反代 `127.0.0.1:3000`
- `dacun.conf`：`server_name` → 新 IP/域名；`listen 9001` 可保留（或并入 80/443）

### 10.2 校验并生效

```bash
nginx -t && systemctl reload nginx
curl -s -o /dev/null -w "api=%{http_code}\n"    http://127.0.0.1/health
curl -s -o /dev/null -w "dacun=%{http_code}\n"  http://127.0.0.1:9001/
```

`/static/` 已关闭目录索引，用具体文件测（见 §12 验收清单）。

---

## 11. HTTPS 与域名（上线必做）

### 11.1 前置条件

- 微信小程序的**服务器域名必须是 HTTPS**，且**不能是 IP、不能带端口**（默认 443）。
- 服务器若在中国大陆，域名需**已备案**；不想备案就用境外/香港节点。
- 旧机 `PUBLIC_BASE_URL=http://121.37.160.39`，无任何 TLS 证书，**这步是新机必须补上的**。

### 11.2 申请证书

```bash
# CentOS/Rocky
dnf install -y certbot python3-certbot-nginx
# Ubuntu
apt install -y certbot python3-certbot-nginx

certbot --nginx -d api.example.com
systemctl enable --now certbot-renew.timer     # Ubuntu 下为 certbot.timer
```

### 11.3 nginx 站点改为 443

在 `blocklab.conf` 基础上补 443（反代与 `/static/` 段保持原样，务必保留 `proxy_set_header X-Forwarded-Proto $scheme;`）：

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    client_max_body_size 100M;

    location = /test-upload.html { root /usr/share/nginx/html; }
    location /static/ { alias /var/www/blocklab-backend/uploads/; autoindex off; }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}
```

```bash
nginx -t && systemctl reload nginx
```

### 11.4 同步应用配置

```bash
# 改 .env：PUBLIC_BASE_URL="https://api.example.com"
pm2 restart blocklab-api --update-env
```

### 11.5 微信小程序后台配置

微信公众平台 → 开发管理 → 开发设置 → **服务器域名**：

| 类别 | 填什么 | 用途 |
|---|---|---|
| request 合法域名 | `https://api.example.com` | 登录、业务接口 |
| uploadFile 合法域名 | `https://api.example.com` | 头像上传 `/api/auth/upload-avatar` |
| downloadFile 合法域名 | `https://api.example.com` | 展示 uploads 里的图片/3D 模型 |

### 11.6 若客户端页面是 HTTPS

devpocket 信令与 TURN 也要走加密：`wss://api.example.com/ws`（nginx 反代 9876）+ `turns:`，否则浏览器会拦截混合内容。

---

## 12. 验收清单（逐条打勾，全过才算迁移完成）

| # | 检查项 | 命令 / 操作 | 期望结果 |
|---|---|---|---|
| 1 | 三个进程在线 | `pm2 list` | `blocklab-api`、`blocklab-inference`、`devpocket-signaling` 全部 `online` |
| 2 | API 直连健康 | `curl -s http://127.0.0.1:3000/health` | `{"status":"ok"}` |
| 3 | API 经 nginx | `curl -s http://<域名或IP>/health` | 同上 |
| 4 | 静态资源可读 | `ls /var/www/blocklab-backend/uploads/avatars/` 取一个文件名 → `curl -I http://<域名>/static/avatars/<文件名>` | `200` + `Content-Type: image/png` |
| 5 | 官网正常 | 浏览器打开 `http://<新IP>:9001` | 潍坊大存首页正常显示 |
| 6 | 数据库读写 | `curl -s -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"unionId":"MIGRATION-SMOKE"}'` | `{"success":true,"data":{"token":"…","user":{"unionId":"MIGRATION-SMOKE","userId":"…"},"isNewUser":true}}`，**验完清理**：`su postgres -c "psql -d blocklab -c \"delete from users where union_id='MIGRATION-SMOKE';\""` |
| 7 | 微信 code 登录 | 小程序真机 `wx.login` → `POST /api/auth/login {code,nickName,avatarUrl}` | `success:true`，`user.unionId` 有值 |
| 8 | 头像上传 | 小程序 `chooseAvatar` → `wx.uploadFile` 打 `/api/auth/upload-avatar`，字段名 **`file`** | 返回 `data.data.url`，再 `curl -I` 该 URL 为 200 |
| 9 | 推理服务 | `curl -s http://127.0.0.1:8000/health` | `{"status":"ok","model":"best.pt","device":"cpu"}` |
| 10 | 识别链路 | 小程序拍照识别一次 | 正常返回零件识别结果 |
| 11 | 信令服务 | `curl -s http://127.0.0.1:9876/health`；两个客户端连 `ws://<新IP>:9876/ws` | `{"status":"ok",...}`；能建房/加入 |
| 12 | 开机自启 | `reboot` 后重新登录 | nginx/postgresql/pm2 三进程自动恢复 |
| 13 | 出网连通 | 见 §5.4 两条 curl | 至少一条 200 |

> 微信换 openid 失败时看 `pm2 logs blocklab-api`，常见码：`40013` AppID 不合法、`40125` AppSecret 不合法、`40029` code 无效/已用过。

---

## 13. 切换与收尾

### 13.1 切换顺序

1. 新机按 §12 全量验收通过（用 IP 直连即可先验）
2. 域名解析切到新机（若用域名，提前把 TTL 调小到 300s，减少生效时间）
3. 真机再走一遍登录 / 头像上传 / 识别
4. 观察 1~2 天
5. 旧机停服，但**先不要退订**，保留 3~5 天兜底

### 13.2 旧机收尾

```bash
rm -f /var/www/blocklab-backend/.env.swp    # 含明文密钥的 vim 残留，别带走也别留
```

可选但建议：备份包在传输/中转环节接触过，敏感项可轮换一次——数据库密码（记得同步改 `.env`）、`WX_SECRET`（公众平台重置）、`JWT_SECRET`（会让线上 token 全部失效，需前端重新登录）、第三方 API Key。

### 13.3 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| nginx 502 | API 没起来 / 端口不对 | `pm2 list`、`pm2 logs blocklab-api`、`ss -tlnp \| grep 3000` |
| 登录 `WECHAT_CODE2SESSION_FAILED` | 出网被代理挡住、AppID 与 Secret 不匹配、code 已用过 | 按 §5.4 测连通性；核对 `WX_APPID`/`WX_SECRET` 属同一小程序 |
| 头像上传 400 | 字段名不是 `file`，或类型不在白名单 | 小程序侧 `name:'file'`；支持 jpeg/png/webp/gif/bmp |
| 上传成功但图片打不开 | `PUBLIC_BASE_URL` 仍是旧 IP；或 `/static/` alias 不对 | 改 `.env` → `pm2 restart blocklab-api --update-env`；`nginx -t` |
| 数据库连不上 | 角色密码与 §3.2 不一致；或 PostgreSQL 未启动 | 核对角色密码；`systemctl status postgresql-14` |
| 推理服务起不来 | 误用 python3.6；或 torch 未装 | 用 `python3.9` 安装 `requirements.txt` |
| 客户端连不上信令 | 安全组未放 9876；HTTPS 页面用 `ws://` 被拦 | 放行 9876；改 `wss://` |
| TURN 不通 | 3478/udp 或中继段未放行；`external-ip` 还是旧 IP | 按 §9.1 逐项核对 |

---

## 附录 A：备份产物与校验和

| 文件 | SHA256 |
|---|---|
| `blocklab-db.sql` | `42c51115801665d6e615a56e02a7d7241f60640dc59b12365f414860182885cc` |
| `blocklab-files.tar.gz` | `8ea81908c4e3646f9d628fe20b6539b69bb071b098d243cbf9038c023e4850d6` |
| `blocklab-configs.tar.gz` | `69539ece0fc2813724867af7812a675b73df4723a87f4bd793ce22fbc0664d1c` |
| `misc-projects.tar.gz` | `198e35fd1dacf35d1dec79060507ec68077fcda993faddfeff53966239abdd41` |
| `extras-nginx-clash.tar.gz` | `22485384fa185a321a1081ee2e18eccd44160fc130a504faa13af97bd76088e7` |

## 附录 B：目录结构（新机应长这样）

```
/var/www/blocklab-backend/          # 后端仓库(prod 分支) + dist/ + uploads/ + inference_service/
├── dist/server.js                  # npm run build 产物
├── uploads/                        # §4 恢复：11 个子目录、222 个文件（nginx /static/ 指向这里）
├── inference_service/              # main.py + best.pt + requirements.txt + Dockerfile
├── prisma/schema.prisma            # 含 User.avatarUrl
├── src/                            # 源码
└── .env                            # §5 恢复，含全部密钥
/var/www/dacun/                     # 官网静态站（index.html + assets/）
/opt/Projects/devpocket-server/     # server.js + package.json + node_modules
/usr/share/nginx/html/              # 含 test-upload.html
/etc/nginx/conf.d/                  # blocklab.conf + dacun.conf
/etc/coturn/turnserver.conf
/etc/clash/{jjfly.yaml,Country.mmdb}
/root/ecosystem.config.js           # §6.5 建议扩充为三个应用
```

## 附录 C：旧机关键事实速查

| 项 | 值 |
|---|---|
| 公网 IP | 121.37.160.39（会变，所有硬编码处见 §5.3） |
| 仓库 / 分支 / 提交 | `git@github.com:gitNewman1/blocklab-backend.git` / `prod` / `1052b0c` |
| 微信 AppID | `wxa5731a718db4cf65`（Secret 在 `.env`，勿下发） |
| 数据库 | PostgreSQL 14.22，库 `blocklab`，用户 `blocklab_user`（非超级），表属主均为 `blocklab_user` |
| API | pm2 `blocklab-api`，`dist/server.js`，:3000，Node v18.20.8 / npm 10.8.2 / pm2 7.0.3 |
| 推理 | pm2 `blocklab-inference`，`uvicorn main:app --host 0.0.0.0 --port 8000`，解释器 python3.9，CPU 模式 |
| 信令 | pm2 `devpocket-signaling`，`node server.js`，:9876，WS 路径 `/ws` |
| nginx | 1.14.1，:80 反代 3000（`client_max_body_size 100M`），:9001 官网 |
| 系统 | CentOS Linux 8.5.2111（已 EOL，新机建议 Rocky/Alma 8+ 或 Ubuntu 22.04） |
