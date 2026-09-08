# SauceDemo 标准用户购物结账流程测试报告

## 测试范围

- 验证 `standard_user` 可以登录 SauceDemo。
- 验证用户可以将 `Sauce Labs Backpack` 加入购物车，且购物车数量、商品名称、数量和价格正确。
- 验证用户可以填写结账信息、检查订单金额并完成订单。
- 本次按仓库约定执行单条 P0 主流程冒烟测试，未执行异常场景、全量回归或跨浏览器测试。

## 测试环境

- 执行日期：2026-07-23
- 目标环境：`https://www.saucedemo.com`
- 测试框架：Playwright 1.60.0
- 浏览器项目：Chromium（Desktop Chrome 配置）
- 测试账号：`standard_user` / `secret_sauce`

## 测试用例

| ID | 优先级 | 场景 | 期望结果 | 结果 |
| --- | --- | --- | --- | --- |
| TC-001 | P0 | 登录、添加 Sauce Labs Backpack、进入购物车、填写结账信息、确认金额并完成订单 | 进入商品页；购物车数量为 1；商品价格为 `$29.99`；总价为 `$32.39`；完成页显示 `Thank you for your order!` | 通过 |

完整用例定义见 `tests/e2e/saucedemo-test-cases.md`，自动化实现见 `tests/e2e/saucedemo.spec.ts`。

## 执行记录

```bash
PLAYWRIGHT_HTML_OUTPUT_DIR=playwright-report/saucedemo-standard-user-20260723 \
PLAYWRIGHT_HTML_OPEN=never \
npx playwright test tests/e2e/saucedemo.spec.ts \
  --project=chromium \
  --grep 'TC-001' \
  --output=test-results/saucedemo-standard-user-20260723
```

- 执行结果：`1 passed (1.4s)`
- 失败原因：无
- HTML 报告：`playwright-report/saucedemo-standard-user-20260723/index.html`
- 失败证据：无。测试通过，且项目配置仅在失败时保留截图和视频、首次重试时保留 trace。

## 数据清理

本测试仅在 SauceDemo 当前浏览器会话中完成演示订单，没有创建可持久化管理的测试记录，因此未执行数据删除，也未调用任何全量重置接口。

## 残余风险

- 仅验证 Chromium 桌面配置，未覆盖 Firefox、WebKit 或移动端。
- 未覆盖错误登录、锁定账号、结账必填校验、移除商品和登出后的权限校验；这些场景已在同一 spec 中实现，但不在本次冒烟执行范围内。
- SauceDemo 是外部公开演示站点，后续可用性和页面数据可能受站点变更影响。
