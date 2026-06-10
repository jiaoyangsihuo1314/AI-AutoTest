| ID | 优先级 | 标题 | 覆盖需求 | 前置条件 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-ZZPSS-001 | P0 | 有效账号可以登录系统 | 登录成功主流程 | 目标站点可访问；使用测试账号 `lining` | 打开登录页；输入用户名和密码；点击登录 | 登录接口返回 200；页面跳转到 `#/home`；首页展示欢迎语和顶部导航 | Playwright spec `zzpss-login-home.spec.ts`，使用已确认的 placeholder 和 `.login-button` locator |
| TC-ZZPSS-002 | P0 | 首页关键模块和数据接口正常加载 | 首页功能冒烟 | 已使用有效账号登录 | 等待首页加载；检查顶部菜单、欢迎语、首页看板模块；监听关键首页接口 | 首页展示“基本情况、重过载监视、设备停运、电能质量、工单中心、线损管理、异常告警”等模块；关键首页接口返回 200 | Playwright spec `zzpss-login-home.spec.ts`，断言 UI 文案并校验首页 API 响应 |
| TC-ZZPSS-003 | P0 | 用户可以确认退出登录 | 退出登录流程 | 已使用有效账号登录 | 悬浮用户信息；点击“退出登录”；在确认框点击“确定” | 退出接口返回 200；页面回到 `#/login`；登录页可见；出现退出成功提示 | Playwright spec `zzpss-login-home.spec.ts`，使用 `.login-info` 用户菜单和 Element Plus 确认框 locator |
