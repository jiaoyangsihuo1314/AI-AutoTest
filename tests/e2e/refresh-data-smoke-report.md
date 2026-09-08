# 测试套件/执行监控刷新数据冒烟报告

- 执行日期：2026-07-15
- 测试范围：测试执行数据范围、刷新持久化、套件详情、执行详情与统计
- 测试环境：本地前端 `http://127.0.0.1:5174`，后端 `http://127.0.0.1:8001`，Playwright Chromium
- 数据约束：未创建、修改或删除数据库业务数据；未调用 `/api/test/reset`

## 用例

| ID | 结果 | 验证点 |
| --- | --- | --- |
| TC-PLAT-EXEC-REFRESH-001 | 通过 | 全局当前项目为空项目时，测试套件和执行监控默认按全部项目展示数据；刷新后保留模块、数据范围、套件/Run 详情和统计 |

## 执行结果

1. `npm --prefix frontend run build`
   - 通过，Vite 生产构建完成。
   - 保留既有的单包体积大于 500 kB 警告，与本次修复无关。
2. `.venv/bin/python` 只读调用 `test_suites('all')` 和 `suite_runs('all')`
   - 通过，实际数据库返回 5 个套件、6 条执行记录。
   - 套件和执行记录均来自项目 `54b5b32ddb05`，空项目不会再限制测试执行页面的数据源。
3. `npx playwright test tests/e2e/automation-platform.spec.ts -g "TC-PLAT-EXEC-REFRESH-001" --reporter=list,html`
   - 通过，1 passed。

## 证据

- Playwright HTML Report：`playwright-report/index.html`
- 自动化脚本：`tests/e2e/automation-platform.spec.ts`
- 测试用例清单：`tests/e2e/automation-platform-test-cases.md`

## 残余风险

- 本次按仓库约定只执行目标冒烟用例，未执行全量 E2E 或完整回归。
- 未通过真实登录请求调用 HTTP 接口，避免产生无法用唯一标记识别的会话和审计数据；后端 `all` 查询已在服务同一虚拟环境中直接只读验证。
