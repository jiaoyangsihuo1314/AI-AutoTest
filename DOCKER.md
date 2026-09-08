# Docker 部署说明

Docker 部署是新增能力，不会替换或改变现有原生启动命令：

```bash
npm run dev
npm run build:lan
npm run start:lan
```

Docker 方案面向 Linux x86_64，将 React 前端、Python 后端、Node.js、Playwright 和 Chromium 放在同一个应用容器中，并固定使用单个 Uvicorn worker。

## 1. 环境要求

- Docker Engine 和 Docker Compose v2。
- 使用本地 SSD 的 Linux x86_64 主机。
- 建议从 8 vCPU、16 GB 内存、3 个活动浏览器并发开始。
- HTTPS 部署需要包含 `fullchain.pem` 和 `privkey.pem` 的证书目录。

创建本地 Docker 环境变量文件：

```bash
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

启动前至少检查 `DOCKER_DATA_DIR`、`APP_UID`、`APP_GID`、`QA_MAX_ACTIVE_BROWSER_SESSIONS` 和 HTTPS 相关配置。Linux 上的 `APP_UID`、`APP_GID` 应与持有数据目录的宿主机用户一致，可通过 `id -u` 和 `id -g` 查询。

## 2. 全新安装

容器以非 root 用户运行。全新安装先创建绑定目录并确认当前用户可写：

```bash
mkdir -p docker-data/{db,artifacts,playwright-report,test-results,draft-runs,live-runs,execution-configs}
test -w docker-data
```

应用首次启动时会初始化新的 SQLite 数据库；首次保存敏感变量时会生成 Fernet 主密钥。

启动可信内网方案：

```bash
docker compose --env-file .env.docker \
  -f compose.yml \
  -f compose.lan.yml \
  up -d --build
```

访问 `http://服务器IP:8001`，或访问 `APP_PORT` 配置的端口。

检查状态和日志：

```bash
docker compose --env-file .env.docker \
  -f compose.yml \
  -f compose.lan.yml \
  ps

docker compose --env-file .env.docker \
  -f compose.yml \
  -f compose.lan.yml \
  logs -f app
```

## 3. 迁移现有数据

迁移命令只会把现有状态复制到 `docker-data`，不会修改或删除源数据库、artifacts、报告和测试文件。

1. 停止当前项目的原生 Uvicorn、Node.js、Playwright 和 Chromium 进程。
2. 确认目标目录不存在或为空。
3. 执行：

```bash
python3 scripts/docker-migrate-state.py --confirm-source-stopped
```

迁移工具会：

- 使用 SQLite Backup API 创建 `docker-data/db/automation-platform.sqlite`。
- 复制 `artifacts/`、`playwright-report/`、`test-results/` 和三个运行目录。
- 保留现有 `artifacts/automation-platform/.secret-key`。
- 将数据库副本中的已知本机路径转换为容器内 `/app` 路径。
- 生成 `docker-data/docker-migration-report.json`。

如果数据库副本包含无法识别的绝对路径，命令会以状态码 `2` 退出。正式启动前必须检查并处理报告中的 `paths.unknownPaths`；源数据不会受影响。

自定义源数据库、目标目录或旧仓库路径：

```bash
python3 scripts/docker-migrate-state.py \
  --confirm-source-stopped \
  --source-db /path/to/automation-platform.sqlite \
  --destination /srv/ai-autotest-data \
  --legacy-root /previous/repository/root
```

启动 Compose 前，将 `.env.docker` 中的 `DOCKER_DATA_DIR` 设置为同一个目标目录。

## 4. HTTPS 部署

在 `.env.docker` 中设置：

```dotenv
SERVER_NAME=qa.example.com
TLS_CERT_DIR=./docker-data/certs
HTTP_PORT=80
HTTPS_PORT=443
```

证书文件目录：

```text
docker-data/certs/fullchain.pem
docker-data/certs/privkey.pem
```

启动应用和 Nginx：

```bash
docker compose --env-file .env.docker \
  -f compose.yml \
  -f compose.https.yml \
  up -d --build
```

HTTPS 模式只有 Nginx 向宿主机开放端口。WebSocket、NDJSON 流式接口、测试报告和前端页面都会转发到内部的 `app:8001`。

## 5. 健康检查和冒烟测试

内网模式：

```bash
curl --fail http://127.0.0.1:8001/api/health
```

HTTPS 模式：

```bash
curl --fail https://qa.example.com/api/health
```

如需执行完整浏览器链路冒烟，使用 `DOCKER_SMOKE_YYYYMMDD_HHMMSS` 形式的唯一标记。测试结束后只能删除该标记创建的数据，不能使用 `/api/test/reset`。

## 6. 停止、升级和备份

正常停止内网模式：

```bash
docker compose --env-file .env.docker \
  -f compose.yml \
  -f compose.lan.yml \
  down
```

不要添加 `-v`。持久化数据使用宿主机绑定目录，必须保留。

升级前应停止容器，并完整备份 `DOCKER_DATA_DIR`。SQLite、`artifacts/automation-platform/.secret-key`、artifacts 和报告必须属于同一个恢复点。

更新代码并重建，不会修改原生部署文件：

```bash
git pull
docker compose --env-file .env.docker \
  -f compose.yml \
  -f compose.lan.yml \
  up -d --build
```

## 7. 运行约束

- 必须保持 `--workers 1`，否则内存中的浏览器、任务和 WebSocket 状态会分裂。
- 使用 SQLite 和进程内任务状态期间，不得将 `app` 扩容为多个副本。
- 持久化目录必须位于本地 SSD，不能使用 NFS、SMB 或同步网盘。
- 不挂载 Docker Socket，不使用 `privileged` 或 host network。
- 容器以 `APP_UID:APP_GID` 指定的非 root 身份运行；升级或迁移后必须保持所有绑定目录对该身份可写。
- 只允许授权用户访问平台和授权的被测系统。
- 容器使用 `ipc: host` 提高 Chromium 稳定性，使用 `init: true` 回收子进程。
