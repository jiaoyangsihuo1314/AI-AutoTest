# 脚本流式跟随定向测试报告

## 测试范围

- 用例脚本在生成、重新生成和失败重试期间随每个流式增量滚动到底部。
- 用户在生成期间手动上滚后，下一个增量重新跟随到底部。
- 切换到下一用例后继续跟随该用例的最新内容。
- 规则流结束时，最终持久化脚本与 `complete` 同批到达仍滚动到底部。
- 生成结束后，手动滚动、查看已有脚本和共享 Fixture 不再被强制拉到底部。

## 测试环境

- 日期：2026-07-15
- 浏览器：Playwright Chromium
- 前端地址：`http://127.0.0.1:5174`
- 数据方式：浏览器内隔离 API/ReadableStream mock，不访问或修改真实后端数据

## 测试用例

| ID | 结果 | 说明 |
| --- | --- | --- |
| TC-PLAT-006A | 通过 | 多段长脚本 delta、跨用例切换、失败重试、最终持久化替换和生成结束后的自由滚动均符合预期 |

## 执行命令

```bash
NO_PROXY='127.0.0.1,localhost,*' PLATFORM_URL=http://127.0.0.1:5174 npx playwright test tests/e2e/automation-platform.spec.ts --project=chromium --grep 'TC-PLAT-006A'
npm --prefix frontend run build
```

## 执行结果

- 定向 E2E：`1 passed`
- 前端构建：通过
- Playwright HTML report：`playwright-report/index.html`
- 失败证据：无
- 数据清理：测试仅使用 mock 数据，没有创建真实数据，也未调用全量重置接口

## 残余风险

- 未执行全量回归；按任务范围只验证脚本工作台定向场景。
- 构建仍有既存的单个 bundle 超过 500 kB 警告，与本次滚动行为修改无关。
