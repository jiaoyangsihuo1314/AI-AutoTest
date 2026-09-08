# 执行阶段实时浏览器只读全屏冒烟报告

## 测试范围

- 执行测试页面的实时浏览器仅保留只读画面和全屏能力。
- 自愈重跑页面不展示暂停、人工接管和继续按钮。
- 全屏后鼠标移动不会通过 WebSocket 发送浏览器控制命令。
- 只读执行会话不会写入浏览器 worker stdin。
- 页面探索会话仍可正常转发控制命令。

## 测试环境

- 日期：2026-07-16
- 前端：`http://127.0.0.1:5174`
- 后端：`http://127.0.0.1:8001`
- 浏览器：Playwright Chromium

## 执行命令与结果

1. 后端定向单元测试：3 条通过。

   ```bash
   .venv/bin/python -m unittest \
     tests.test_browser_runtime.BrowserRuntimeEventTests.test_browser_socket_ignores_commands_for_read_only_execution_session \
     tests.test_browser_runtime.BrowserRuntimeEventTests.test_browser_socket_forwards_commands_for_interactive_session \
     tests.test_browser_runtime.BrowserRuntimeEventTests.test_browser_socket_reports_ended_interactive_session_without_stdin_error
   ```

2. 后端语法检查：通过。

   ```bash
   .venv/bin/python -m py_compile backend/app/platform.py tests/test_browser_runtime.py
   ```

3. 前端生产构建：通过。仅保留项目已有的大 chunk 警告。

   ```bash
   npm --prefix frontend run build
   ```

4. 执行页面 mocked Playwright 冒烟：1 条通过。

   ```bash
   NO_PROXY='127.0.0.1,localhost,*' PLATFORM_URL=http://127.0.0.1:5174 \
     npx playwright test tests/e2e/automation-platform.spec.ts \
     --project=chromium --grep 'TC-PLAT-007A' --reporter=list,html
   ```

5. 自愈页面 mocked Playwright 冒烟：1 条通过。

   ```bash
   NO_PROXY='127.0.0.1,localhost,*' PLATFORM_URL=http://127.0.0.1:5174 \
     npx playwright test tests/e2e/automation-platform.spec.ts \
     --project=chromium --grep 'TC-PLAT-008 人工自愈' --reporter=list,html
   ```

## 结果

- 最终状态：通过。
- Playwright HTML report：`playwright-report/index.html`。
- 测试使用 API mock、页面内 fake WebSocket 和内存 runtime，没有创建业务测试数据。
- 未调用 `/api/test/reset`，未删除或修改历史数据。

## 残余风险

- 未执行完整回归；页面探索的交互行为通过后端定向单测和现有实现边界确认。
- 一键自动化完整流程属于耗时场景，本次仅补充对应断言，未运行完整流程。
