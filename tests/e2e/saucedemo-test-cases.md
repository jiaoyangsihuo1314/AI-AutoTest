| ID | 优先级 | 标题 | 覆盖需求 | 前置条件 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | P0 | 标准用户可以完成下单主流程 | 登录、商品浏览、加购、购物车、结账、订单完成 | 使用 `standard_user` / `secret_sauce`，目标站点可访问 | 登录；添加 Sauce Labs Backpack；进入购物车；填写结账信息；确认概览；完成订单 | 进入商品页；购物车数量为 1；概览金额为 `$32.39`；完成页显示感谢文案 | Playwright spec `TC-001`，使用已确认的 `data-test` 和 placeholder locator |
| TC-002 | P0 | 无效密码阻止登录 | 登录错误处理 | 用户名有效，密码错误 | 输入 `standard_user` 和错误密码；点击 Login | 停留登录页，显示用户名密码不匹配错误 | Playwright spec `TC-002`，断言 `data-test=error` 文案 |
| TC-003 | P0 | 锁定用户无法登录 | 账号状态与权限控制 | 使用 `locked_out_user` / `secret_sauce` | 输入锁定用户；点击 Login | 停留登录页，显示账号锁定错误 | Playwright spec `TC-003`，断言锁定错误文案 |
| TC-004 | P1 | 购物车可以移除商品 | 购物车状态变更 | 标准用户已登录，商品已加购 | 进入购物车；点击 Remove | 商品行消失，购物车徽标消失 | Playwright spec `TC-004`，断言商品数量和徽标 |
| TC-005 | P1 | 结账信息缺失会展示必填校验 | 结账表单校验 | 标准用户已登录，购物车有商品 | 进入结账页；直接 Continue；补充姓名后继续 | 首次提示 First Name 必填；随后提示 Postal Code 必填 | Playwright spec `TC-005`，断言 `data-test=error` |
| TC-006 | P1 | 登出后受保护商品页不可访问 | 会话退出与受保护路由 | 标准用户已登录 | 打开菜单登出；直接访问 `/inventory.html` | 回到登录页；访问商品页被登录态拦截 | Playwright spec `TC-006`，断言登录按钮和访问拦截错误 |
