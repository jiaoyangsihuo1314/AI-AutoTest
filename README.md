# Web 自动化测试平台

一个本地 QA 自动化测试平台，用于按 `qa-playwright-automation` 流程完成需求分析、项目预检、用例设计、页面探索、脚本实现、运行验证、自愈诊断和保存已验证产物。平台前端使用 React + Vite，后端使用 FastAPI，数据库使用 SQLite。

## 功能概览

- 一级/二级菜单式专业工作台：
  - 工作台：总览、自动化测试全流程。
  - 测试任务流：需求工单、用例设计、探索实验室、脚本工作台、执行测试、自愈诊断。
  - 资产管理：项目管理、用例管理、交付报告。
  - 系统设置：AI 配置。
- 输入需求、目标 URL、角色/账号、测试数据、验收标准和排除项。
- 保存工单后展示需求抽取、必要澄清提示和项目预检摘要，自动检查 Playwright 配置、包管理脚本、已有 spec、用例文档和 helper 约定。
- 先生成或手工保存可追溯测试用例，再点击 `执行探索` 调起 Playwright 浏览器；探索区用 WebSocket + CDP Screencast 展示可操控实时画面，并按多步骤计划采集截图、页面结构、日志和候选元素。
- AI 生成或人工编辑测试用例和 Playwright 脚本；未配置 AI 时明确提示。
- 用例、探索和脚本先作为草稿沉淀；运行验证后才将测试用例、spec 和人工报告写入仓库交付路径。
- 展示执行阶段进度、实时日志、运行结果和历史记录。
- 实时浏览器控制台支持点击、滚动和键盘输入；证据截图仅用于归档。
- 将运行记录、日志和证据路径持久化到 SQLite。
- 生成 Playwright HTML Report 和人工测试报告。

## 技术栈

- Frontend：React、Vite、lucide-react
- Backend：FastAPI、Uvicorn、SQLite
- E2E：Playwright

## 目录结构

```text
.
├── backend/
│   ├── app/main.py                 # FastAPI 后端入口
│   └── requirements.txt            # Python 后端依赖
├── frontend/
│   ├── src/main.jsx                # React 工作台
│   ├── src/styles.css              # 前端样式
│   └── package.json                # 前端依赖和脚本
├── tests/e2e/
│   ├── automation-platform.spec.ts # 平台验收测试
│   └── automation-platform-test-cases.md
├── automation-platform-test-report.md
├── package.json
└── playwright.config.ts
```

## 端口

- 前端：`http://127.0.0.1:5174`
- 后端：`http://127.0.0.1:8001`
- 前端默认 API 地址：`http://127.0.0.1:8001`

## 安装依赖

所有命令默认在项目根目录执行：

```bash
cd /Users/syj/Documents/qa-project
```

首次运行或重新拉取项目后，安装依赖：

```bash
npm install
npm --prefix frontend install
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

## 启动平台

进入项目根目录：

```bash
cd /Users/syj/Documents/qa-project
```

推荐分两个终端分别启动，方便观察日志。

终端 1：启动后端 `8001`。

```bash
npm run dev:backend
```

终端 2：启动前端 `5174`。

```bash
npm run dev:frontend
```

启动后访问：

```text
http://127.0.0.1:5174
```

后端健康检查：

```bash
curl --noproxy '*' http://127.0.0.1:8001/api/health
```

## 常用命令

前端构建：

```bash
npm --prefix frontend run build
```

后端语法检查：

```bash
.venv/bin/python -m py_compile backend/app/main.py
```

运行全部 Playwright 测试：

```bash
npm run test:e2e
```

运行平台验收测试：

```bash
NO_PROXY='127.0.0.1,localhost,*' PLATFORM_URL=http://127.0.0.1:5174 npx playwright test tests/e2e/automation-platform.spec.ts --project=chromium --reporter=list,html
```

查看 Playwright HTML Report：

```bash
npm run test:e2e:report
```

## 后端接口

- `GET /api/health`：健康检查。
- `POST /api/work-items`：创建需求测试任务。
- `GET /api/work-items`：获取任务列表。
- `GET /api/work-items/{id}`：获取任务详情。
- `GET /api/project-context`：获取项目预检摘要。
- `POST /api/work-items/{id}/browser-session`：创建实时浏览器操控会话。
- `WebSocket /ws/browser-sessions/{session_id}`：接收实时浏览器画面帧并发送鼠标、键盘、控制事件。
- `POST /api/work-items/{id}/explore/run`：在已有测试用例后创建并启动页面探索运行，立即返回探索 run id。
- `GET /api/exploration-runs/{run_id}`：获取探索阶段、计划、步骤证据、日志、浏览器会话和最终候选元素。
- `POST /api/work-items/{id}/explore`：保存探索记录和确认元素。
- `POST /api/work-items/{id}/generate-cases`：基于需求抽取和项目预检生成或保存测试用例。
- `POST /api/work-items/{id}/generate-script`：在已有测试用例和已确认元素后生成或保存 Playwright 草稿脚本。
- `POST /api/work-items/{id}/run`：执行当前任务草稿 spec，并生成 Playwright HTML Report。
- `POST /api/work-items/{id}/save-artifacts`：运行验证后写入最终测试用例、spec 和人工报告。
- `POST /api/work-items/{id}/self-heal`：记录自愈尝试。
- `GET /api/test-suites`：获取可执行测试套件。
- `POST /api/runs`：创建并启动一次测试运行。
- `GET /api/runs`：获取历史运行记录。
- `GET /api/runs/{run_id}`：获取单次运行状态。
- `GET /api/runs/{run_id}/logs`：获取运行日志。
- `GET /api/runs/{run_id}/screenshot`：获取浏览器预览截图。
- `GET /api/report`：打开最新 Playwright HTML Report。

## AI 配置

AI 生成功能支持两种配置方式。

方式一：在前端配置。

1. 启动平台并打开 `http://127.0.0.1:5174`。
2. 进入左侧 `AI 配置` 模块。
3. 输入 `OpenAI API Key`、模型名和 OpenAI-compatible `Base URL`。
4. 点击 `保存 AI 配置`，也可以点击 `测试连接` 发起一次极短真实生成来验证 Key、模型和地址。

配置会保存到后端本地 SQLite，健康接口只返回掩码，不返回明文 Key。

方式二：通过后端环境变量启用：

```bash
export OPENAI_API_KEY=你的密钥
export OPENAI_BASE_URL=https://api.openai.com/v1
npm run dev:backend
```

如果同时配置了环境变量和前端本地配置，后端优先使用环境变量。`Base URL` 默认是 `https://api.openai.com/v1`，也支持兼容 OpenAI Responses API 的代理或私有网关。未配置 AI 时，平台不会生成伪内容；页面会提示 `AI 未配置`，仍可手工编辑并保存测试用例和脚本。

探索计划会优先使用已配置的 OpenAI Key 结合已保存测试用例生成结构化步骤；如果未配置、模型不可用或返回失败，平台会自动使用规则兜底计划继续执行主流程探索。

## 完整 QA 流程

1. 在 `需求工单` 顶部输入完整需求，点击 `需求分析`，由 AI 自动提取功能目标、用户路径、验收标准、角色、测试数据、环境和排除项。
2. 平台展示需求抽取、必要澄清提示和项目预检摘要；AI 不可用时使用规则兜底抽取，项目预检确认测试目录、命名、reporter、已有 spec、用例文档和 helper 约定。
3. 进入 `用例设计`，先生成或手工保存可追溯测试用例；未保存用例时不能执行页面探索。
4. 进入 `探索实验室`，点击 `执行探索`，后端基于已保存测试用例创建多步骤探索计划并调起 Chromium。
5. 探索区通过 WebSocket 接收 CDP Screencast 实时画面，用户可在 canvas 上点击、滚动和输入。
6. 后端按计划执行导航、输入、点击、断言和截图采集，每一步保存 URL、页面结构、截图和候选元素。
7. 探索完成后回填最终截图路径、页面结构和候选元素；人工勾选确认可用于最终脚本的 selector。
8. 进入 `脚本工作台`，在已有测试用例和已确认元素后生成或保存 Playwright 草稿脚本。
9. 进入 `执行测试`，运行草稿 spec 并生成 Playwright HTML Report。
10. 失败时进入 `自愈诊断`，最多 3 轮记录测试侧修复并重新运行。
11. 测试通过，或明确确认剩余失败来自应用/环境问题后，点击 `保存已验证产物` 写入最终测试用例、spec 和人工报告。

## 测试交付物

- 测试用例：`tests/e2e/automation-platform-test-cases.md`
- 自动化脚本：`tests/e2e/automation-platform.spec.ts`
- 人工测试报告：`automation-platform-test-report.md`
- Playwright HTML Report：`playwright-report/index.html`
- 平台运行证据目录：`artifacts/automation-platform/`
- 草稿运行目录：`tests/e2e/.draft-runs/` 和 `tests/e2e/.live-runs/`，已在 `.gitignore` 忽略。
- Playwright 失败证据目录：`test-results/`

## 注意事项

- v1 是本地单用户平台，不做登录和多用户并发隔离。
- 浏览器展示区使用 WebSocket + CDP Screencast，不使用截图轮询；证据截图只作为步骤归档。
- 探索阶段会自动采集候选元素，但最终 selector 仍必须人工确认；没有测试用例或确认元素时不能生成最终脚本。
- 最终交付物只在运行验证后写入仓库；草稿运行文件不会作为交付 spec。
- SQLite 数据库文件位于 `backend/automation-platform.sqlite`，已在 `.gitignore` 中忽略。
- 如果本地代理影响 localhost 请求，运行测试时请设置 `NO_PROXY='127.0.0.1,localhost,*'`。

## 排错

如果页面提示：

```text
后端连接失败：Failed to fetch
```

优先检查后端是否启动：

```bash
cd /Users/syj/Documents/qa-project
curl --noproxy '*' http://127.0.0.1:8001/api/health
```

如果连接失败，单独启动后端：

```bash
cd /Users/syj/Documents/qa-project
npm run dev:backend
```

如果提示 `.venv/bin/python` 不存在，重新安装后端依赖：

```bash
cd /Users/syj/Documents/qa-project
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```
