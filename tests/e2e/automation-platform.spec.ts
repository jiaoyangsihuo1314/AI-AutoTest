import { expect, type Locator, type Page, test } from '@playwright/test';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:5174';
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8001';
const THEME_LABELS = ['深海', '曜石蓝', '松石绿', '晨光'] as const;

const CASES_MARKDOWN = `| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-DEMO-001 | P0 | 登录页关键元素可见 | 登录页面基础可用性 | Sauce Demo 可访问；standard_user/secret_sauce | 打开登录页 | Username、Password、Login 可见 | 使用 placeholder 和稳定 data-test |
| TC-DEMO-002 | P1 | 错误登录展示提示 | 关键错误状态 | Sauce Demo 可访问；locked_out_user/secret_sauce | 输入锁定账号并登录 | 展示错误提示，不进入商品页 | 探索阶段确认错误提示 selector |`;

const SCRIPT_CONTENT = `import { expect, test } from '@playwright/test';

test.describe('平台生成脚本演示', () => {
  test('TC-DEMO-001 登录页关键元素可见', async ({ page }) => {
    // 打开目标登录页，建立可重复的测试前置状态。
    await page.goto('https://www.saucedemo.com');

    // 验证用户名输入框可见，证明登录表单加载完成。
    await expect(page.getByPlaceholder('Username')).toBeVisible({ timeout: 10_000 });

    // 验证登录按钮来自已确认的稳定 data-test 约定。
    await expect(page.locator('[data-test="login-button"]')).toBeEnabled({ timeout: 10_000 });
  });
});
`;

async function gotoModule(page, name: string) {
  // 通过左侧模块导航进入指定模块，避免匹配到页面内同名操作按钮。
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

async function createE2EProject(request, name = `E2E 测试项目 ${Date.now()}`) {
  const response = await request.post(`${API_URL}/api/projects`, {
    data: {
      project_code: `PRJ-E2E-${Date.now()}-${Math.random().toString(16).slice(2, 5)}`,
      name,
      project_type: 'product',
      status: 'active',
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createE2EFeature(request, projectId: string, name = `E2E 功能 ${Date.now()}`) {
  const response = await request.post(`${API_URL}/api/features`, {
    data: {
      project_id: projectId,
      name,
      sort_order: 0,
      is_active: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function expectWindowScrollNear(page, expectedTop: number, tolerance = 12) {
  await page.waitForFunction(
    ({ expectedTop, tolerance }) => Math.abs(window.scrollY - expectedTop) <= tolerance,
    { expectedTop, tolerance },
  );
}

async function expectActiveModuleTabVisible(page) {
  await page.waitForFunction(() => {
    const tablist = document.querySelector('.module-tabs');
    const activeTab = document.querySelector('.module-tab.active');
    if (!tablist || !activeTab) return false;
    const tablistRect = tablist.getBoundingClientRect();
    const activeRect = activeTab.getBoundingClientRect();
    return activeRect.left >= tablistRect.left - 1 && activeRect.right <= tablistRect.right + 1;
  });
}

async function expectCanvasHasPaintedPixels(canvasLocator: Locator, timeout = 20_000) {
  await expect.poll(
    async () => canvasLocator.evaluate((canvas: HTMLCanvasElement) => {
      if (!canvas.width || !canvas.height) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      const sampleWidth = Math.min(canvas.width, 240);
      const sampleHeight = Math.min(canvas.height, 160);
      const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] !== 0) return true;
      }
      return false;
    }),
    { timeout },
  ).toBeTruthy();
}

type Rgba = { r: number; g: number; b: number; a: number };

function blendOver(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

function relativeLuminance(color: Rgba) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(foreground: Rgba, background: Rgba) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

async function expectNoticeContrast(page: Page, themeLabel: string) {
  const colors = await page.getByTestId('notice-banner').evaluate((banner) => {
    const parseColor = (color: string) => {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (!match) throw new Error(`Unsupported color format: ${color}`);
      const [r, g, b, a = '1'] = match[1].split(',').map((part) => part.trim());
      return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
    };
    const textColor = parseColor(window.getComputedStyle(banner).color);
    const bannerColor = parseColor(window.getComputedStyle(banner).backgroundColor);
    const shellColor = parseColor(window.getComputedStyle(document.querySelector('.platform-shell') || document.body).backgroundColor);
    return { textColor, bannerColor, shellColor };
  });
  const blendedBackground = blendOver(colors.bannerColor, colors.shellColor);
  expect(contrastRatio(colors.textColor, blendedBackground), `${themeLabel} 成功提示文字对比度`).toBeGreaterThanOrEqual(4.5);
  if (themeLabel === '晨光') {
    expect(relativeLuminance(colors.textColor), '晨光主题成功提示文字应使用深色 success token').toBeLessThan(0.25);
  }
}

async function createWorkItem(page) {
  const project = await createE2EProject(page.request, 'E2E 需求工单项目');
  const feature = await createE2EFeature(page.request, project.id, 'E2E 需求功能');
  const title = `Sauce Demo 登录与购物流程 ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const requirement = `${title}：验证标准用户可以在 https://www.saucedemo.com 登录、添加商品到购物车、进入结账流程，并在错误账号或缺失信息时展示明确错误。角色为 standard_user，测试数据为用户名 standard_user、密码 secret_sauce、商品 Sauce Labs Backpack。不覆盖跨浏览器兼容、支付真实链路和第三方风控。`;
  // 输入完整需求并触发需求分析，平台应自动抽取目标、路径、验收、角色、数据、环境和排除项。
  await page.goto(PLATFORM_URL);
  await gotoModule(page, '需求工单');
  await page.getByTestId('requirement-project').selectOption(project.id);
  await page.getByTestId('requirement-feature').selectOption(feature.id);
  await page.getByTestId('requirement-input').fill(requirement);
  await page.getByRole('button', { name: /^需求分析$/ }).click();
  await expect(page.getByTestId('requirement-analysis')).toContainText('功能目标', { timeout: 20_000 });
  await expect(page.getByTestId('requirement-input')).toHaveValue(requirement);
  return title;
}

async function saveCases(page) {
  // 保存可追溯测试用例，作为页面探索的前置输入。
  await gotoModule(page, '用例设计');
  await page.locator('textarea.editor.markdown').fill(CASES_MARKDOWN);
  await page.getByRole('button', { name: /生成\/保存用例/ }).click();
  await expect(page.getByRole('region', { name: '探索实验室' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('workflow-context-bar')).toContainText('页面探索', { timeout: 10_000 });
}

async function saveExplorationDraft(page) {
  // 不运行真实探索时，用已知稳定元素模拟人工确认后的页面探索结果。
  await gotoModule(page, '探索实验室');
  await page.getByRole('button', { name: /确认全部候选/ }).click();
  await expect(page.getByTestId('candidate-confirm-checkbox').first()).toBeChecked();
  await page.getByRole('button', { name: /保存探索/ }).click();
  await expect(page.getByRole('region', { name: '脚本工作台' })).toBeVisible({ timeout: 10_000 });
}

async function saveScriptDraft(page) {
  // 保存带步骤注释和 web-first assertions 的草稿 spec。
  await gotoModule(page, '脚本工作台');
  await page.locator('textarea.editor.code').fill(SCRIPT_CONTENT);
  await page.getByRole('button', { name: /生成\/保存草稿脚本/ }).click();
  await expect(page.getByRole('region', { name: '执行测试' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('workflow-context-bar')).toContainText('运行验证', { timeout: 10_000 });
}

test.describe('QA 自动化测试平台全流程', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    // 清理本地测试数据库，避免历史工单影响当前任务选择和阶段断言。
    const resetResponse = await request.post(`${API_URL}/api/test/reset`);
    expect(resetResponse.ok(), '本地测试重置接口必须启用并返回成功').toBeTruthy();
  });

  test('TC-PLAT-001 平台总览展示完整 8 步 QA 工作流', async ({ page }) => {
    // 打开平台首页，验证本地专业工作台可以访问。
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PLATFORM_URL);

    // 顶部状态卡已替换为固定工具区，确认四个入口和弹层交互可用。
    const topbarActions = page.getByTestId('topbar-actions');
    await expect(topbarActions).toBeVisible({ timeout: 10_000 });
    await expect(topbarActions.getByRole('button', { name: '界面主题' })).toBeVisible();
    await expect(topbarActions.getByRole('button', { name: '通知消息' })).toBeVisible();
    await expect(topbarActions.getByRole('button', { name: '流程帮助' })).toBeVisible();
    await expect(topbarActions.getByRole('button', { name: 'QA 用户菜单' })).toBeVisible();
    await topbarActions.getByRole('button', { name: '界面主题' }).click();
    const themePanel = page.getByTestId('topbar-theme-panel');
    await expect(themePanel).toBeVisible();
    await expect(themePanel).toContainText('深海');
    await expect(themePanel).toContainText('晨光');
    await topbarActions.getByRole('button', { name: '通知消息' }).click();
    await expect(page.getByTestId('topbar-notification-panel')).toBeVisible();
    await topbarActions.getByRole('button', { name: '流程帮助' }).click();
    const helpPanel = page.getByTestId('topbar-help-panel');
    await expect(helpPanel).toBeVisible();
    await expect(helpPanel).toContainText('需求分析');
    await expect(helpPanel).toContainText('保存已验证产物');
    await topbarActions.getByRole('button', { name: 'QA 用户菜单' }).click();
    const userPanel = page.getByTestId('topbar-user-panel');
    await expect(userPanel).toContainText('QA 用户');
    await expect(userPanel).not.toContainText('界面主题');
    await userPanel.getByRole('button', { name: '退出' }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('本地模式无需退出');
    const topbarLayout = await page.evaluate(() => {
      const command = document.querySelector('.command-bar')?.getBoundingClientRect();
      const titleRow = document.querySelector('.command-title-row')?.getBoundingClientRect();
      const tabStrip = document.querySelector('.module-tab-strip')?.getBoundingClientRect();
      return {
        commandHeight: Math.round(command?.height ?? 0),
        commandTop: Math.round(command?.top ?? -1),
        titleRowHeight: Math.round(titleRow?.height ?? 0),
        tabStripHeight: Math.round(tabStrip?.height ?? 0),
      };
    });
    expect(topbarLayout.commandHeight).toBeGreaterThan(100);
    expect(topbarLayout.commandTop).toBe(0);
    expect(topbarLayout.titleRowHeight).toBeGreaterThan(0);
    expect(topbarLayout.tabStripHeight).toBeGreaterThan(0);
    const openedTabs = page.getByRole('tablist', { name: '已打开菜单' });
    await expect(openedTabs).toBeVisible();
    await expect(openedTabs.getByRole('tab', { name: '总览' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: '关闭总览' })).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 420));
    const scrolledTopbarLayout = await page.evaluate(() => {
      const brand = document.querySelector('.brand-mark')?.getBoundingClientRect();
      const command = document.querySelector('.command-bar')?.getBoundingClientRect();
      return {
        brandTop: Math.round(brand?.top ?? -1),
        commandTop: Math.round(command?.top ?? -1),
      };
    });
    expect(Math.abs(scrolledTopbarLayout.brandTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(scrolledTopbarLayout.commandTop)).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scrollTo(0, 0));

    // 模块页签应各自保存滚动位置；首次打开的新模块默认回到顶部。
    await page.evaluate(() => window.scrollTo(0, 420));
    const overviewScrollTop = await page.evaluate(() => window.scrollY);
    expect(overviewScrollTop).toBeGreaterThan(0);
    await gotoModule(page, '需求工单');
    await expect(page.locator('.command-title-row h1')).toHaveText('需求工单');
    await expectWindowScrollNear(page, 0);
    await page.evaluate(() => window.scrollTo(0, 260));
    const requirementScrollTop = await page.evaluate(() => window.scrollY);
    expect(requirementScrollTop).toBeGreaterThan(0);
    await openedTabs.getByRole('tab', { name: '总览' }).click();
    await expect(page.locator('.command-title-row h1')).toHaveText('总览');
    await expectWindowScrollNear(page, overviewScrollTop);
    await openedTabs.getByRole('tab', { name: '需求工单' }).click();
    await expect(page.locator('.command-title-row h1')).toHaveText('需求工单');
    await expectWindowScrollNear(page, requirementScrollTop);
    await gotoModule(page, 'AI 配置');
    await expect(page.locator('.command-title-row h1')).toHaveText('AI 配置');
    await expectWindowScrollNear(page, 0);
    await gotoModule(page, '总览');
    await page.evaluate(() => window.scrollTo(0, 0));

    // 验证左侧一级/二级菜单导航和总览页统计看板可见，旧 8 步流程条不再展示。
    const moduleNav = page.getByRole('navigation', { name: '平台模块' });
    await expect(moduleNav).toBeVisible();
    for (const groupName of ['工作台', '测试任务流', '资产管理', '系统设置']) {
      await expect(moduleNav.getByRole('region', { name: groupName })).toBeVisible();
      await expect(moduleNav.getByRole('button', { name: groupName, exact: true })).toHaveAttribute('aria-expanded', 'true');
    }
    for (const moduleName of ['总览', '自动化测试全流程', '需求工单', '用例设计', '探索实验室', '脚本工作台', '执行测试', '自愈诊断', '交付报告', '项目管理', '用例管理', '功能模块配置', 'AI 配置']) {
      await expect(moduleNav.getByRole('button', { name: new RegExp(`^${moduleName}`) })).toBeVisible();
    }
    const flowGroupText = await moduleNav.getByRole('region', { name: '测试任务流' }).innerText();
    expect(flowGroupText).toMatch(/需求工单[\s\S]*用例设计[\s\S]*探索实验室[\s\S]*脚本工作台[\s\S]*执行测试[\s\S]*自愈诊断/);
    expect(flowGroupText).not.toContain('交付报告');
    const assetGroupText = await moduleNav.getByRole('region', { name: '资产管理' }).innerText();
    expect(assetGroupText).toMatch(/项目管理[\s\S]*用例管理[\s\S]*交付报告/);
    await page.getByRole('button', { name: '收起左侧导航' }).click();
    await expect(moduleNav).toBeVisible();
    await expect(moduleNav.getByRole('button', { name: '总览', exact: true })).toBeVisible();
    await expect(moduleNav.getByRole('button', { name: '自动化测试全流程', exact: true })).toBeVisible();
    const collapsedAIButton = moduleNav.getByRole('button', { name: 'AI 配置', exact: true });
    await expect(collapsedAIButton).toBeVisible();
    await collapsedAIButton.click();
    await expect(page.locator('.command-title-row h1')).toHaveText('AI 配置');
    await expect(collapsedAIButton).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: '展开左侧导航' }).click();
    await expect(moduleNav).toBeVisible();
    await expect(moduleNav.getByRole('region', { name: '系统设置' })).toBeVisible();
    await gotoModule(page, '总览');
    await page.addStyleTag({ content: '.module-tabs { width: 360px !important; max-width: 360px !important; }' });
    for (const moduleName of ['需求工单', '用例设计', '探索实验室', '脚本工作台', '执行测试', '自愈诊断', '交付报告', '项目管理', '用例管理', '功能模块配置', 'AI 配置']) {
      await gotoModule(page, moduleName);
    }
    await expect(openedTabs.getByRole('tab', { name: 'AI 配置' })).toHaveAttribute('aria-selected', 'true');
    await expectActiveModuleTabVisible(page);
    await page.evaluate(() => {
      document.querySelectorAll('style').forEach((style) => {
        if (style.textContent?.includes('.module-tabs { width: 360px')) style.remove();
      });
    });
    await gotoModule(page, '总览');
    const dashboard = page.getByTestId('overview-dashboard');
    await expect(page.getByTestId('overview-workflow')).toHaveCount(0);
    await expect(dashboard).toContainText('测试统计看板');
    await expect(dashboard).toContainText('用例总数');
    await expect(dashboard).toContainText('执行成功率');
    await expect(dashboard).toContainText('失败用例');
    await expect(dashboard).toContainText('测试执行趋势');
    await expect(dashboard).toContainText('近 2 周');
    await expect(dashboard.locator('.trend-legend')).toContainText('通过');
    await expect(dashboard.locator('.trend-legend')).toContainText('失败');
    await expect(dashboard.locator('.trend-legend')).toContainText('总计');
    await expect(dashboard).toContainText('最近执行');
    await expect(page.getByTestId('overview-project-filter')).toHaveValue('all');
    await expect(page.getByTestId('overview-project-filter')).toContainText('全部项目');

    // 普通工作页降级为轻量阶段上下文，配置/资产页不展示流程提示。
    await gotoModule(page, '需求工单');
    const compactWorkflow = page.getByTestId('workflow-context-bar');
    await expect(compactWorkflow).toContainText('当前阶段');
    await expect(compactWorkflow).toContainText('需求分析');
    await expect(compactWorkflow).toContainText('下一步');
    await expect(compactWorkflow).not.toContainText('保存已验证产物');
    await expect(page.getByTestId('overview-workflow')).toHaveCount(0);
    await gotoModule(page, 'AI 配置');
    await expect(openedTabs.getByRole('tab', { name: '需求工单' })).toBeVisible();
    await expect(openedTabs.getByRole('tab', { name: 'AI 配置' })).toHaveAttribute('aria-selected', 'true');
    await openedTabs.getByRole('tab', { name: '需求工单' }).click();
    await expect(page.locator('.command-title-row h1')).toHaveText('需求工单');
    await expect(openedTabs.getByRole('tab', { name: '需求工单' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '关闭需求工单' }).click();
    await expect(openedTabs.getByRole('tab', { name: 'AI 配置' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.command-title-row h1')).toHaveText('AI 配置');
    await expect(page.getByTestId('workflow-context-bar')).toHaveCount(0);
    await expect(page.getByTestId('overview-workflow')).toHaveCount(0);
    await gotoModule(page, '功能模块配置');
    await expect(openedTabs.getByRole('tab', { name: '功能菜单配置' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('workflow-context-bar')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '功能菜单配置' })).toBeVisible();
    await gotoModule(page, '交付报告');
    await expect(openedTabs.getByRole('tab', { name: '交付报告' })).toHaveAttribute('aria-selected', 'true');
    await openedTabs.getByRole('tab', { name: '功能菜单配置' }).click();
    await page.getByRole('button', { name: '页签更多操作' }).click();
    await page.getByRole('menuitem', { name: '关闭右侧' }).click();
    await expect(openedTabs.getByRole('tab', { name: '交付报告' })).toHaveCount(0);
    await expect(openedTabs.getByRole('tab', { name: '功能菜单配置' })).toHaveAttribute('aria-selected', 'true');
    await gotoModule(page, '项目管理');
    await page.getByRole('button', { name: '页签更多操作' }).click();
    await page.getByRole('menuitem', { name: '关闭左侧' }).click();
    await expect(openedTabs.getByRole('tab', { name: '功能菜单配置' })).toHaveCount(0);
    await expect(openedTabs.getByRole('tab', { name: '交付报告' })).toHaveCount(0);
    await expect(openedTabs.getByRole('tab', { name: '项目管理' })).toHaveAttribute('aria-selected', 'true');
    await gotoModule(page, '用例管理');
    await page.getByRole('button', { name: '页签更多操作' }).click();
    await page.getByRole('menuitem', { name: '关闭其他' }).click();
    await expect(openedTabs.getByRole('tab')).toHaveCount(2);
    await expect(openedTabs.getByRole('tab', { name: '总览' })).toBeVisible();
    await expect(openedTabs.getByRole('tab', { name: '用例管理' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '页签更多操作' }).click();
    await page.getByRole('menuitem', { name: '关闭当前' }).click();
    await expect(openedTabs.getByRole('tab')).toHaveCount(1);
    await expect(openedTabs.getByRole('tab', { name: '总览' })).toHaveAttribute('aria-selected', 'true');
    await gotoModule(page, '功能模块配置');
    await gotoModule(page, '交付报告');
    await page.getByRole('button', { name: '页签更多操作' }).click();
    await page.getByRole('menuitem', { name: '关闭所有' }).click();
    await expect(openedTabs.getByRole('tab')).toHaveCount(1);
    await expect(openedTabs.getByRole('tab', { name: '总览' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('workflow-context-bar')).toHaveCount(0);

    // 验证总览和单列工作区构成平台级信息架构。
    await gotoModule(page, '总览');
    await expect(page.getByRole('region', { name: '平台总览' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: '上下文侧栏' })).toHaveCount(0);
    await expect(page.locator('.context-rail')).toHaveCount(0);
  });

  test('TC-PLAT-001B AI 测试连接成功提示在所有主题下清晰可读', async ({ page }) => {
    await page.route(`${API_URL}/api/auth/me`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'access-control-allow-origin': PLATFORM_URL,
          'access-control-allow-credentials': 'true',
        },
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: 'theme-readable-user',
            username: 'theme-readable',
            displayName: '主题验证用户',
            role: 'admin',
            status: 'active',
          },
        }),
      });
    });
    await page.route(`${API_URL}/api/ai-config/test`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'openai',
          model: 'gpt-4.1-mini',
          baseUrl: 'https://api.openai.com/v1',
          message: '连接成功，模型 gpt-4.1-mini 已完成一次测试生成。',
        }),
      });
    });
    await page.goto(PLATFORM_URL);
    await gotoModule(page, 'AI 配置');
    await page.getByLabel('配置名称').fill('主题提示验证');
    await page.getByLabel('厂商').selectOption('openai');
    await page.getByLabel('API Key').fill('sk-theme-readable-123456');
    await page.getByLabel('模型').fill('gpt-4.1-mini');
    await page.getByLabel('Base URL').fill('https://api.openai.com/v1');

    const topbarActions = page.getByTestId('topbar-actions');
    for (const themeLabel of THEME_LABELS) {
      await topbarActions.getByRole('button', { name: '界面主题' }).click();
      const themePanel = page.getByTestId('topbar-theme-panel');
      await themePanel.getByRole('button', { name: new RegExp(themeLabel) }).click();
      await page.getByRole('button', { name: /^测试连接$/ }).click();
      await expect(page.getByTestId('notice-banner')).toContainText('连接成功，模型 gpt-4.1-mini 已完成一次测试生成。');
      await expectNoticeContrast(page, themeLabel);
      await page.getByRole('button', { name: '关闭提示' }).click();
    }
  });

  test('TC-PLAT-001A AI 配置支持多厂商档案保存与切换', async ({ page, request }) => {
    await request.delete(`${API_URL}/api/ai-config`);
    await page.goto(PLATFORM_URL);
    await gotoModule(page, 'AI 配置');
    await expect(page.locator('.command-title-row h1')).toHaveText('AI 配置');
    await expect(page.getByRole('region', { name: 'AI 配置' })).toContainText('AI 多厂商配置');
    await expect(page.getByRole('button', { name: /^测试连接$/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: '删除配置' })).toBeDisabled();

    await page.getByRole('button', { name: '新建配置' }).click();
    await page.getByRole('button', { name: /^测试连接$/ }).click();
    await expect(page.getByTestId('error-banner')).toContainText('测试 AI 连接失败');
    await page.getByRole('button', { name: '关闭错误提示' }).click();
    await expect(page.getByTestId('error-banner')).toHaveCount(0);
    await page.getByRole('button', { name: '新建配置' }).click();
    await page.getByLabel('配置名称').fill('OpenAI 主账号');
    await page.getByLabel('厂商').selectOption('openai');
    await page.getByLabel('API Key').fill('sk-openai-profile-123456');
    await page.getByLabel('模型').fill('gpt-4.1-mini');
    await page.getByLabel('Base URL').fill('https://api.openai.com/v1');
    await page.getByRole('button', { name: '保存配置' }).click();
    const openAIProfileButton = page.getByRole('button', { name: /OpenAI 主账号/ });
    await expect(openAIProfileButton).toBeVisible();
    await expect(openAIProfileButton).toContainText('当前');

    await page.getByRole('button', { name: '新建配置' }).click();
    await page.getByLabel('配置名称').fill('DeepSeek 兼容网关');
    await page.getByLabel('厂商').selectOption('deepseek');
    await page.getByLabel('API Key').fill('sk-deepseek-profile-abcdef');
    await page.getByLabel('模型').fill('deepseek-chat');
    await page.getByLabel('Base URL').fill('https://api.deepseek.com/v1');
    await page.getByRole('button', { name: '保存配置' }).click();
    await expect(page.getByRole('button', { name: /DeepSeek 兼容网关/ })).toBeVisible();
    await expect(page.getByText('DeepSeek · deepseek-chat')).toBeVisible();
    await expect(page.getByLabel('配置名称')).toHaveValue('DeepSeek 兼容网关');
    await expect(page.getByLabel('厂商')).toHaveValue('deepseek');
    await expect(page.getByLabel('模型')).toHaveValue('deepseek-chat');
    await expect(page.getByLabel('Base URL')).toHaveValue('https://api.deepseek.com/v1');

    let status = await request.get(`${API_URL}/api/ai-config`);
    let payload = await status.json();
    expect(payload.activeProfile.name).toBe('DeepSeek 兼容网关');
    expect(payload.provider).toBe('deepseek');
    expect(JSON.stringify(payload)).not.toContain('sk-deepseek-profile-abcdef');
    const deepSeekProfileId = payload.activeProfile.id;
    const secretResponse = await request.get(`${API_URL}/api/ai-config/${deepSeekProfileId}/secret`);
    expect(secretResponse.ok()).toBeTruthy();
    expect((await secretResponse.json()).apiKey).toBe('sk-deepseek-profile-abcdef');

    await page.getByRole('button', { name: '显示密钥' }).click();
    await expect(page.getByLabel('API Key')).toHaveValue('sk-deepseek-profile-abcdef');
    await expect(page.getByRole('button', { name: '隐藏密钥' })).toBeVisible();
    await page.getByRole('button', { name: '复制密钥' }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('API Key 已复制');
    await page.getByRole('button', { name: '隐藏密钥' }).click();

    await page.getByRole('button', { name: /OpenAI 主账号/ }).click();
    await page.getByRole('button', { name: '设为当前' }).click();
    await expect(page.getByRole('button', { name: /OpenAI 主账号/ })).toContainText('当前');
    await expect(page.getByTestId('notice-banner')).toContainText('已切换当前 AI 配置');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await expect(page.getByTestId('notice-banner')).toHaveCount(0);
    status = await request.get(`${API_URL}/api/health`);
    payload = await status.json();
    expect(payload.ai.activeProfile.name).toBe('OpenAI 主账号');
    expect(payload.ai.provider).toBe('openai');
    expect(payload.ai.model).toBe('gpt-4.1-mini');

    await page.getByRole('button', { name: /DeepSeek 兼容网关/ }).click();
    await page.getByRole('button', { name: '删除配置' }).click();
    await expect(page.getByText('DeepSeek 兼容网关')).toHaveCount(0);
    status = await request.get(`${API_URL}/api/ai-config`);
    payload = await status.json();
    expect(payload.profiles.map((profile) => profile.name)).toEqual(['OpenAI 主账号']);
  });

  test('TC-PLAT-001B 项目管理支持基础台账 CRUD 并保护关联资产', async ({ page, request }) => {
    // 进入项目管理页，确认没有系统自动创建的默认项目依赖。
    await page.goto(PLATFORM_URL);
    await gotoModule(page, '项目管理');
    const projectRegion = page.getByRole('region', { name: '项目管理' });
    await expect(projectRegion).toContainText('项目管理', { timeout: 10_000 });
    await expect(projectRegion).not.toContainText('PRJ-LOCAL-QA');

    // 新建一个交付类项目，覆盖项目ID、名称、类型、状态和工程属性的录入。
    const projectCode = `PRJ-E2E-${Date.now()}`;
    await projectRegion.getByRole('button', { name: /新建项目/ }).click();
    await projectRegion.getByLabel('项目ID').fill(projectCode);
    await projectRegion.getByLabel('项目名称').fill('E2E 交付台账项目');
    await projectRegion.getByLabel('项目类型').selectOption('delivery');
    await projectRegion.getByLabel('项目状态').selectOption('planning');
    await projectRegion.getByLabel('目标 URL').fill('https://example.com/e2e');
    await projectRegion.getByLabel('仓库路径').fill('/Users/syj/Documents/qa-project');
    await projectRegion.getByLabel('测试目录').fill('tests/e2e/project-crud');
    await projectRegion.getByLabel('项目描述').fill('由自动化测试创建，用于验证项目台账 CRUD。');
    await projectRegion.getByRole('button', { name: /保存项目/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('项目已创建', { timeout: 10_000 });
    await expect(projectRegion).toContainText(projectCode);
    await expect(projectRegion).toContainText('交付类');
    await expect(projectRegion).toContainText('规划中');

    // 编辑项目名称、类型和状态，刷新后通过 API 返回数据继续驱动页面展示。
    await projectRegion.getByLabel('项目名称').fill('E2E 产品台账项目');
    await projectRegion.getByLabel('项目类型').selectOption('product');
    await projectRegion.getByLabel('项目状态').selectOption('active');
    await projectRegion.getByRole('button', { name: /保存项目/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('项目已保存', { timeout: 10_000 });
    await expect(projectRegion).toContainText('E2E 产品台账项目');
    await expect(projectRegion).toContainText('产品类');
    await expect(projectRegion).toContainText('进行中');

    // 删除当前无关联资产的临时项目，确认不会回落到任何默认项目。
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('E2E 产品台账项目');
      await dialog.accept();
    });
    await projectRegion.getByRole('button', { name: /删除项目/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('项目已删除', { timeout: 10_000 });
    await expect(projectRegion).not.toContainText(projectCode);

    // 准备一个关联测试用例的项目，验证删除接口会保护已有测试资产。
    const linkedProjectResponse = await request.post(`${API_URL}/api/projects`, {
      data: {
        project_code: `PRJ-LINKED-${Date.now()}`,
        name: 'E2E 关联资产项目',
        project_type: 'delivery',
        status: 'active',
      },
    });
    expect(linkedProjectResponse.ok()).toBeTruthy();
    const linkedProject = await linkedProjectResponse.json();
    const linkedCaseResponse = await request.post(`${API_URL}/api/test-cases`, {
      data: {
        project_id: linkedProject.id,
        external_id: `TC-LINKED-${Date.now()}`,
        title: '关联资产删除保护用例',
        priority: 'P1',
        automation_status: 'manual',
      },
    });
    expect(linkedCaseResponse.ok()).toBeTruthy();
    const deleteLinkedResponse = await request.delete(`${API_URL}/api/projects/${linkedProject.id}`);
    expect(deleteLinkedResponse.status()).toBe(400);
    expect(await deleteLinkedResponse.text()).toContain('项目下仍有关联资产');
  });

  test('TC-PLAT-001C 功能菜单配置以树形管理并支持用例绑定', async ({ page, request }) => {
    const project = await createE2EProject(request, 'E2E 功能菜单项目');
    const rootName = `用户中心 ${Date.now()}`;
    const childName = `密码登录 ${Math.random().toString(16).slice(2, 6)}`;
    const renamedChildName = `${childName} 已编辑`;
    const caseExternalId = `TC-FEATURE-${Date.now()}`;

    await page.goto(PLATFORM_URL);
    await gotoModule(page, '功能模块配置');
    const featureRegion = page.getByRole('region', { name: '功能菜单配置' });
    await expect(featureRegion).toBeVisible();
    await expect(featureRegion.getByRole('heading', { name: '功能树' })).toBeVisible();

    await featureRegion.getByRole('button', { name: /新增根功能/ }).first().click();
    await page.getByLabel('功能名称').fill(rootName);
    await page.getByLabel('功能描述').fill('用户账号相关能力的一级功能。');
    await featureRegion.getByRole('button', { name: /保存新增/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('已新增根功能', { timeout: 10_000 });
    await expect(page.getByTestId('feature-menu-tree')).toContainText(rootName);

    await featureRegion.getByRole('button', { name: rootName }).click();
    await page.getByRole('region', { name: '功能详情' }).getByRole('button', { name: /新增子功能/ }).click();
    await page.getByLabel('功能名称').fill(childName);
    await page.getByLabel('功能描述').fill('密码账号登录入口。');
    await featureRegion.getByRole('button', { name: /保存新增/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('已新增子功能', { timeout: 10_000 });
    await expect(page.getByTestId('feature-menu-tree')).toContainText(childName);

    await featureRegion.getByRole('button', { name: childName }).click();
    await page.getByLabel('功能名称').fill(renamedChildName);
    await page.getByLabel('功能描述').fill('编辑后的密码登录功能说明。');
    await page.getByLabel('启用该功能').uncheck();
    await featureRegion.getByRole('button', { name: /保存修改/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('已更新功能', { timeout: 10_000 });
    await expect(featureRegion).toContainText('停用');
    await page.getByLabel('启用该功能').check();
    await featureRegion.getByRole('button', { name: /保存修改/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('已更新功能', { timeout: 10_000 });

    const featuresResponse = await request.get(`${API_URL}/api/features?project_id=${project.id}`);
    expect(featuresResponse.ok()).toBeTruthy();
    const featurePayload = await featuresResponse.json();
    const childFeature = featurePayload.items.find((item) => item.name === renamedChildName);
    expect(childFeature?.path).toContain(rootName);

    const caseResponse = await request.post(`${API_URL}/api/test-cases`, {
      data: {
        project_id: project.id,
        feature_id: childFeature.id,
        external_id: caseExternalId,
        title: '功能绑定回归用例',
        priority: 'P0',
        automation_status: 'manual',
      },
    });
    expect(caseResponse.ok()).toBeTruthy();

    await gotoModule(page, '功能模块配置');
    await expect(page.getByTestId('feature-menu-tree')).toContainText('1 条', { timeout: 10_000 });
    await gotoModule(page, '用例管理');
    const caseRegion = page.getByRole('region', { name: '用例管理' });
    await expect(caseRegion).toContainText(caseExternalId, { timeout: 10_000 });
    await caseRegion.locator('.case-tools select').nth(2).selectOption(childFeature.id);
    await expect(caseRegion).toContainText(caseExternalId);
    await expect(caseRegion).toContainText(renamedChildName);

    const deleteBoundResponse = await request.delete(`${API_URL}/api/features/${childFeature.id}`);
    expect(deleteBoundResponse.status()).toBe(400);
    expect(await deleteBoundResponse.text()).toContain('已绑定测试用例');

    const createdCase = await caseResponse.json();
    const unbindResponse = await request.patch(`${API_URL}/api/test-cases/${createdCase.id}`, { data: { feature_id: '' } });
    expect(unbindResponse.ok()).toBeTruthy();
    const deleteChildResponse = await request.delete(`${API_URL}/api/features/${childFeature.id}`);
    expect(deleteChildResponse.ok()).toBeTruthy();
  });

  test('TC-PLAT-001D 用例管理支持单条删除和批量删除', async ({ page, request }) => {
    const project = await createE2EProject(request, 'E2E 用例删除项目');
    const timestamp = Date.now();
    const caseSeed = [
      { external_id: `TC-DELETE-UI-${timestamp}-001`, title: '单条删除 UI 回归用例' },
      { external_id: `TC-DELETE-UI-${timestamp}-002`, title: '批量删除 UI 回归用例 A' },
      { external_id: `TC-DELETE-UI-${timestamp}-003`, title: '批量删除 UI 回归用例 B' },
    ];
    const createdCases = [];
    for (const item of caseSeed) {
      const response = await request.post(`${API_URL}/api/test-cases`, {
        data: {
          project_id: project.id,
          external_id: item.external_id,
          title: item.title,
          priority: 'P1',
          automation_status: 'manual',
        },
      });
      expect(response.ok()).toBeTruthy();
      createdCases.push(await response.json());
    }

    const suiteResponse = await request.post(`${API_URL}/api/test-suites`, {
      data: {
        project_id: project.id,
        name: `E2E 删除联动套件 ${timestamp}`,
        description: '验证删除用例会同步移除套件挂载关系。',
        status: 'active',
      },
    });
    expect(suiteResponse.ok()).toBeTruthy();
    const suite = await suiteResponse.json();
    const bindResponse = await request.put(`${API_URL}/api/test-suites/${suite.id}/cases`, {
      data: { case_ids: createdCases.map((item) => item.id) },
    });
    expect(bindResponse.ok()).toBeTruthy();

    await page.goto(PLATFORM_URL);
    await page.reload();
    await gotoModule(page, '用例管理');
    const caseRegion = page.getByRole('region', { name: '用例管理' });
    await expect(caseRegion).toContainText(caseSeed[0].external_id, { timeout: 10_000 });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain(caseSeed[0].external_id);
      await dialog.accept();
    });
    await caseRegion.getByRole('button', { name: new RegExp(`删除用例 ${caseSeed[0].external_id}`) }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('用例已删除', { timeout: 10_000 });
    await expect(caseRegion).not.toContainText(caseSeed[0].external_id);

    await gotoModule(page, '测试套件');
    const suiteRegion = page.getByRole('region', { name: '测试套件' });
    await expect(suiteRegion).toContainText(suite.name, { timeout: 10_000 });
    await expect(suiteRegion.getByRole('button', { name: new RegExp(suite.name) })).toContainText('2 条');

    await gotoModule(page, '用例管理');
    await expect(caseRegion).toContainText(caseSeed[1].external_id, { timeout: 10_000 });
    await caseRegion.locator('.case-row').filter({ hasText: caseSeed[1].external_id }).getByRole('checkbox', { name: '选择' }).check();
    await caseRegion.locator('.case-row').filter({ hasText: caseSeed[2].external_id }).getByRole('checkbox', { name: '选择' }).check();
    await expect(caseRegion.getByRole('button', { name: /删除已选 2/ })).toBeEnabled();
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('已选 2 条用例');
      await dialog.accept();
    });
    await caseRegion.getByRole('button', { name: /删除已选 2/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('已删除 2 条用例', { timeout: 10_000 });
    await expect(caseRegion).not.toContainText(caseSeed[1].external_id);
    await expect(caseRegion).not.toContainText(caseSeed[2].external_id);
    await expect(caseRegion.getByRole('button', { name: /删除已选 0/ })).toBeDisabled();

    await gotoModule(page, '测试套件');
    await expect(suiteRegion.getByRole('button', { name: new RegExp(suite.name) })).toContainText('0 条', { timeout: 10_000 });
  });

  test('TC-PLAT-001E 测试套件页执行后进入执行监控详情', async ({ page, request }) => {
    test.setTimeout(90_000);
    const project = await createE2EProject(request, 'E2E 执行监控项目');
    const timestamp = Date.now();
    const caseResponse = await request.post(`${API_URL}/api/test-cases`, {
      data: {
        project_id: project.id,
        external_id: 'TC-SAUCE-DEMO-3DAB-001',
        title: '套件执行监控入口用例',
        priority: 'P0',
        automation_status: 'automated',
        spec_path: 'tests/e2e/sauce-demo-3dab.spec.ts',
      },
    });
    expect(caseResponse.ok()).toBeTruthy();
    const createdCase = await caseResponse.json();

    const suiteName = `E2E 执行监控套件 ${timestamp}`;
    const suiteResponse = await request.post(`${API_URL}/api/test-suites`, {
      data: {
        project_id: project.id,
        name: suiteName,
        description: '验证测试套件页执行按钮接入执行监控。',
        status: 'active',
      },
    });
    expect(suiteResponse.ok()).toBeTruthy();
    const suite = await suiteResponse.json();
    const bindResponse = await request.put(`${API_URL}/api/test-suites/${suite.id}/cases`, {
      data: { case_ids: [createdCase.id] },
    });
    expect(bindResponse.ok()).toBeTruthy();

    await page.goto(PLATFORM_URL);
    await page.reload();
    await gotoModule(page, '测试套件');
    const suiteRegion = page.getByRole('region', { name: '测试套件' });
    await expect(suiteRegion).toContainText(suiteName, { timeout: 10_000 });
    await suiteRegion.getByRole('button', { name: new RegExp(suiteName) }).click();
    await expect(suiteRegion.getByRole('button', { name: /^执行$/ })).toBeVisible();
    await expect(suiteRegion.getByRole('button', { name: '后续接入执行监控' })).toHaveCount(0);

    await suiteRegion.getByRole('button', { name: /^执行$/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('请在执行监控内实时查看执行详情', { timeout: 10_000 });
    const monitorRegion = page.getByRole('region', { name: '执行监控' });
    await expect(monitorRegion).toBeVisible({ timeout: 10_000 });
    await expect(monitorRegion).toContainText(suiteName, { timeout: 10_000 });
    const monitorList = page.getByRole('complementary', { name: '执行列表' });
    const monitorDetail = page.getByRole('region', { name: '执行详情' });
    await expect(monitorDetail).toContainText(/Run ID|套件执行监控入口用例/, { timeout: 10_000 });
    const browserPreview = page.getByTestId('execution-monitor-browser-preview');
    await expect(browserPreview).toBeVisible({ timeout: 10_000 });
    await expect(browserPreview).toContainText('只读预览真实 Playwright 执行 page');
    await expect(browserPreview).toContainText(/单次 Run|浏览器会话/);
    await expect(browserPreview).toContainText(/Live WebSocket|未连接/, { timeout: 25_000 });
    await expect(browserPreview.getByRole('button', { name: /人工接管|暂停|继续/ })).toHaveCount(0);
    const monitorCanvas = page.getByTestId('execution-monitor-browser-live-canvas');
    await expect(monitorCanvas).toBeVisible({ timeout: 15_000 });
    await expectCanvasHasPaintedPixels(monitorCanvas, 25_000);
    await expect(monitorRegion.getByRole('button', { name: '收起执行列表' })).toBeVisible();
    await monitorRegion.getByRole('button', { name: '收起执行列表' }).click();
    await expect(monitorList).toBeHidden();
    await expect(monitorDetail).toContainText(/Run ID|套件执行监控入口用例/);
    await expect(monitorRegion.getByRole('button', { name: '展开执行列表' })).toBeVisible();
    await monitorRegion.getByRole('button', { name: '展开执行列表' }).click();
    await expect(monitorList).toBeVisible();
    await expect(monitorList).toContainText(suiteName);
  });

  test('TC-PLAT-001F 测试套件新建时切换 test 项目后可选择该项目用例', async ({ page, request }) => {
    const timestamp = Date.now();
    const primaryProject = await createE2EProject(request, `primary ${timestamp}`);
    const primaryCaseResponse = await request.post(`${API_URL}/api/test-cases`, {
      data: {
        project_id: primaryProject.id,
        external_id: `TC-SUITE-PRIMARY-${timestamp}`,
        title: '主项目跨项目保护用例',
        priority: 'P1',
        automation_status: 'manual',
      },
    });
    expect(primaryCaseResponse.ok()).toBeTruthy();
    const primaryCase = await primaryCaseResponse.json();

    const projectResponse = await request.post(`${API_URL}/api/projects`, {
      data: {
        project_code: `PRJ-SUITE-${timestamp}`,
        name: `test ${timestamp}`,
        project_type: 'product',
        status: 'active',
      },
    });
    expect(projectResponse.ok()).toBeTruthy();
    const testProject = await projectResponse.json();

    const testCaseResponse = await request.post(`${API_URL}/api/test-cases`, {
      data: {
        project_id: testProject.id,
        external_id: `TC-SUITE-TEST-${timestamp}`,
        title: 'test 项目可加入套件用例',
        priority: 'P0',
        automation_status: 'manual',
      },
    });
    expect(testCaseResponse.ok()).toBeTruthy();
    const testCase = await testCaseResponse.json();

    await page.goto(PLATFORM_URL);
    await page.reload();
    await gotoModule(page, '测试套件');
    const suiteRegion = page.getByRole('region', { name: '测试套件' });
    await suiteRegion.getByRole('button', { name: '新建套件' }).click();

    await expect(suiteRegion).toContainText(testProject.name, { timeout: 10_000 });
    await suiteRegion.locator('button.suite-project-node').filter({ hasText: testProject.name }).click();
    await expect(suiteRegion).toContainText(`当前只能勾选「${testProject.name}」下的用例`);

    const testCaseRow = suiteRegion.locator('.suite-case-row').filter({ hasText: testCase.externalId });
    await expect(testCaseRow.getByRole('checkbox', { name: '选择' })).toBeEnabled();
    await testCaseRow.getByRole('checkbox', { name: '选择' }).check();
    await expect(testCaseRow.getByRole('checkbox', { name: '选择' })).toBeChecked();
    await expect(suiteRegion).toContainText(`套件项目：${testProject.name}`);

    await suiteRegion.locator('button.suite-project-node').filter({ hasText: primaryProject.name }).click();
    const primaryCaseRow = suiteRegion.locator('.suite-case-row').filter({ hasText: primaryCase.externalId });
    await expect(primaryCaseRow.getByRole('checkbox', { name: '选择' })).toBeDisabled();

    const suiteName = `E2E test 项目套件 ${timestamp}`;
    await suiteRegion.getByLabel('套件名称').fill(suiteName);
    await suiteRegion.getByRole('button', { name: '保存套件' }).click();
    await expect(page.getByTestId('notice-banner')).toContainText(`套件已保存：${suiteName}`, { timeout: 10_000 });

    const suitesResponse = await request.get(`${API_URL}/api/test-suites?project_id=${testProject.id}`);
    expect(suitesResponse.ok()).toBeTruthy();
    const suites = await suitesResponse.json();
    const savedSuite = suites.find((suite) => suite.name === suiteName);
    expect(savedSuite?.projectId).toBe(testProject.id);
    expect(savedSuite?.caseIds).toContain(testCase.id);

    const crossProjectSuiteResponse = await request.post(`${API_URL}/api/test-suites`, {
      data: {
        project_id: testProject.id,
        name: `E2E 跨项目拒绝套件 ${timestamp}`,
        status: 'active',
      },
    });
    expect(crossProjectSuiteResponse.ok()).toBeTruthy();
    const crossProjectSuite = await crossProjectSuiteResponse.json();
    const crossProjectBindResponse = await request.put(`${API_URL}/api/test-suites/${crossProjectSuite.id}/cases`, {
      data: { case_ids: [testCase.id, defaultCase.id] },
    });
    expect(crossProjectBindResponse.status()).toBe(400);
    expect(await crossProjectBindResponse.text()).toContain('存在跨项目用例，不能加入套件');
  });

  test('TC-PLAT-002 需求工单顶部输入需求后执行 AI 需求分析并展示项目预检', async ({ page }) => {
    // 在需求工单顶部输入完整需求并点击需求分析。
    await createWorkItem(page);

    // 留在需求工单验证需求抽取和项目现状预检已自动完成。
    await gotoModule(page, '需求工单');
    await expect(page.getByTestId('requirement-input')).toBeVisible();
    await expect(page.getByRole('button', { name: /进入用例设计/ })).toBeVisible();
    await expect(page.getByTestId('requirement-analysis')).toContainText('功能目标');
    await expect(page.getByTestId('requirement-analysis')).toContainText('用户路径');
    await expect(page.getByTestId('requirement-analysis')).toContainText('验收标准');
    await expect(page.getByTestId('requirement-analysis')).toContainText('角色');
    await expect(page.getByTestId('requirement-analysis')).toContainText('测试数据');
    await expect(page.getByTestId('requirement-analysis')).toContainText('环境');
    await expect(page.getByTestId('requirement-analysis')).toContainText('排除项');
    await expect(page.getByTestId('requirement-analysis')).toContainText('需求信息足够进入测试用例设计');
    await expect(page.getByTestId('project-context')).toContainText('playwright.config.ts');
    await expect(page.getByTestId('project-context')).toContainText('tests/e2e');
    await expect(page.getByTestId('project-context')).toContainText('*.spec.ts');
    await expect(page.getByTestId('workflow-context-bar')).toContainText('当前阶段');
    await expect(page.getByTestId('workflow-context-bar')).toContainText('需求分析');
    await expect(page.getByTestId('overview-workflow')).toHaveCount(0);

    // 分析完成后再由用户进入用例设计。
    await expect(page.getByTestId('workflow-context-bar')).toContainText('需求分析');
    await page.getByRole('button', { name: /进入用例设计/ }).click();
    await expect(page.getByRole('region', { name: '用例设计' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('workflow-context-bar')).toContainText('当前阶段');
    await expect(page.getByTestId('workflow-context-bar')).toContainText('用例设计');
  });

  test('TC-PLAT-003 未保存测试用例时不能执行页面探索', async ({ page }) => {
    // 创建任务后直接进入探索实验室，验证前置门槛阻止跳过用例设计。
    await createWorkItem(page);
    await gotoModule(page, '探索实验室');

    // 执行探索按钮应被禁用，并展示先保存测试用例的提示。
    await expect(page.getByTestId('exploration-prerequisite')).toContainText('请先在用例设计中保存可追溯测试用例');
    await expect(page.getByRole('button', { name: /执行探索/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /保存探索/ })).toBeDisabled();
  });

  test('TC-PLAT-004 用例设计可保存手工测试用例并解锁页面探索', async ({ page }) => {
    // 创建任务后保存可追溯用例，验证平台不依赖 AI 也能沉淀用例。
    await createWorkItem(page);
    await gotoModule(page, '用例设计');
    await expect(page.getByTestId('case-design-context')).toContainText('项目约定');
    await saveCases(page);

    // 保存用例后阶段推进到页面探索，探索入口可用。
    await expect(page.getByRole('button', { name: /执行探索/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /保存探索/ })).toBeEnabled();
    await expect(page.getByTestId('workflow-context-bar')).toContainText('页面探索');
  });

  test('TC-PLAT-005 探索实验室基于测试用例执行多步骤探索并确认元素', async ({ page }) => {
    test.setTimeout(90_000);

    // 创建任务并先保存测试用例，满足页面探索前置条件。
    await createWorkItem(page);
    await saveCases(page);

    // 点击执行探索后立即展示 WebSocket 实时浏览器控制台。
    await page.getByRole('button', { name: /执行探索/ }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('探索已启动', { timeout: 10_000 });
    await expect(page.getByTestId('browser-live-canvas')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => page.getByTestId('browser-live-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0), { timeout: 15_000 }).toBeTruthy();
    await expect(page.getByTestId('exploration-browser-fullscreen')).toBeVisible();
    await page.getByTestId('exploration-browser-fullscreen').click();
    await expect.poll(async () => page.getByTestId('exploration-preview').evaluate((shell) => document.fullscreenElement === shell), { timeout: 10_000 }).toBeTruthy();
    await expect(page.getByTestId('exploration-browser-fullscreen')).toContainText('退出全屏');
    await page.getByTestId('exploration-browser-fullscreen').click();
    await expect.poll(async () => page.evaluate(() => document.fullscreenElement === null), { timeout: 10_000 }).toBeTruthy();
    await expect(page.getByTestId('exploration-browser-fullscreen')).toContainText('全屏展示');
    await expect(page.getByTestId('exploration-plan')).toContainText(/navigate|fill|click|snapshot/, { timeout: 15_000 });
    await expect(page.getByTestId('exploration-log')).toContainText(/测试用例|浏览器会话|执行步骤|证据采集/, { timeout: 25_000 });

    // 探索完成后确认候选 selector，并推进到脚本实现。
    await expect(page.getByTestId('notice-banner')).toContainText(/探索完成|探索部分完成/, { timeout: 90_000 });
    await gotoModule(page, '探索实验室');
    const candidateCheckboxes = page.getByTestId('candidate-confirm-checkbox');
    await expect(candidateCheckboxes.first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /确认全部候选/ }).click();
    await expect(candidateCheckboxes.first()).toBeChecked();
    await page.getByRole('button', { name: /保存探索/ }).click();
    await expect(page.getByRole('region', { name: '脚本工作台' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('workflow-context-bar')).toContainText('脚本实现');
  });

  test('TC-PLAT-006 脚本生成必须依赖测试用例和已确认元素', async ({ page }) => {
    // 只有测试用例、没有确认元素时，生成最终脚本必须失败。
    await createWorkItem(page);
    await saveCases(page);
    await gotoModule(page, '脚本工作台');
    await page.locator('textarea.editor.code').fill(SCRIPT_CONTENT);
    await page.getByRole('button', { name: /生成\/保存草稿脚本/ }).click();
    await expect(page.getByTestId('error-banner')).toContainText('缺少已确认元素', { timeout: 10_000 });

    // 保存探索确认元素后，草稿脚本可以保存并进入运行验证。
    await saveExplorationDraft(page);
    await saveScriptDraft(page);
  });

  test('TC-PLAT-007 草稿脚本先运行验证，之后才能保存最终产物', async ({ page }) => {
    test.setTimeout(60_000);

    // 准备已保存用例、已确认元素和草稿脚本。
    await createWorkItem(page);
    await saveCases(page);
    await saveExplorationDraft(page);
    await saveScriptDraft(page);

    // 草稿脚本运行前，保存最终产物按钮应保持禁用。
    await gotoModule(page, '脚本工作台');
    await expect(page.getByRole('button', { name: /保存已验证产物/ })).toBeDisabled();

    // 执行草稿 spec 并验证执行日志与 HTML report 入口。
    await gotoModule(page, '执行测试');
    await page.getByRole('button', { name: /执行当前任务/ }).click();
    await expect(page.getByTestId('log-panel')).toContainText('执行命令', { timeout: 20_000 });
    await expect(page.getByTestId('execution-browser-live-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('execution-runtime')).toContainText(/执行进度|100%/, { timeout: 20_000 });
    await expect(page.getByRole('link', { name: /Playwright HTML Report/ })).toBeVisible();
    await expect(page.getByTestId('log-panel')).toContainText(/执行完成，退出码|1 passed|failed/, { timeout: 45_000 });

    // 运行完成后保存最终测试用例、spec 和人工测试报告。
    await gotoModule(page, '脚本工作台');
    await page.getByRole('button', { name: /保存已验证产物/ }).click();
    const delivery = page.getByRole('region', { name: '交付报告' });
    await expect(delivery).toBeVisible({ timeout: 10_000 });
    await expect(delivery.getByText('交付审阅工作台')).toBeVisible();
    await expect(delivery.getByLabel('交付结论')).toContainText('缺失');
    await expect(delivery.getByTestId('delivery-report-filters')).toBeVisible();
    await expect(delivery.getByText(/\.spec\.ts/).first()).toBeVisible();
    await expect(delivery.getByText(/test-cases\.md/).first()).toBeVisible();
    await expect(delivery.getByText(/人工报告/).first()).toBeVisible();
    await expect(delivery.getByText(/HTML report/).first()).toBeVisible();

    // 打开交付详情后默认只展示摘要与入口；全文内容需要二次展开。
    await delivery.locator('.delivery-case-card').first().click();
    await expect(delivery.getByRole('complementary', { name: '交付详情' })).toBeVisible({ timeout: 10_000 });
    await expect(delivery.getByRole('button', { name: /查看内容预览/ }).first()).toBeVisible();
  });

  test('TC-PLAT-008 自愈诊断最多记录三轮测试侧修复', async ({ page }) => {
    // 创建任务后进入自愈诊断，记录三轮失败修复。
    await createWorkItem(page);
    await gotoModule(page, '自愈诊断');
    for (let round = 1; round <= 3; round += 1) {
      await page.getByLabel('失败摘要').fill(`第 ${round} 轮 selector 失效`);
      await page.getByLabel('修复方案').fill('改用 data-test=login-button 并重新执行');
      await page.getByRole('button', { name: /记录自愈/ }).click();
      await expect(page.getByText(new RegExp(`第 ${round} 轮：第 ${round} 轮 selector 失效`))).toBeVisible({ timeout: 10_000 });
    }

    // 第四轮应被后端拦截，符合最多三轮的自愈约束。
    await page.getByLabel('失败摘要').fill('第 4 轮 selector 失效');
    await page.getByLabel('修复方案').fill('继续改等待策略');
    await page.getByRole('button', { name: /记录自愈/ }).click();
    await expect(page.getByTestId('error-banner')).toContainText('自愈最多允许 3 轮', { timeout: 10_000 });
  });

  test('TC-PLAT-009 独立全流程页启动真实后端编排并展示运行证据', async ({ page }) => {
    test.setTimeout(240_000);
    const project = await createE2EProject(page.request, 'E2E 全流程项目');
    const featureName = `全流程绑定功能 ${Date.now()}`;
    const featureResponse = await page.request.post(`${API_URL}/api/features`, {
      data: {
        project_id: project.id,
        name: featureName,
        description: '用于验证自动化全流程入口绑定项目和功能。',
        sort_order: 1,
        is_active: true,
      },
    });
    expect(featureResponse.ok()).toBeTruthy();
    const feature = await featureResponse.json();

    const missingFeatureResponse = await page.request.post(`${API_URL}/api/automation-flows`, {
      data: {
        project_id: project.id,
        requirement: '验证缺少功能时全流程创建被拦截。',
      },
    });
    expect(missingFeatureResponse.status()).toBe(400);
    expect(await missingFeatureResponse.text()).toContain('功能为必填项');
    const otherProjectResponse = await page.request.post(`${API_URL}/api/projects`, {
      data: {
        project_code: `PRJ-FLOW-${Date.now()}`,
        name: 'E2E 全流程跨项目功能校验',
        project_type: 'product',
        status: 'active',
      },
    });
    expect(otherProjectResponse.ok()).toBeTruthy();
    const otherProject = await otherProjectResponse.json();
    const otherFeatureResponse = await page.request.post(`${API_URL}/api/features`, {
      data: {
        project_id: otherProject.id,
        name: '跨项目功能',
        is_active: true,
      },
    });
    expect(otherFeatureResponse.ok()).toBeTruthy();
    const otherFeature = await otherFeatureResponse.json();
    const mismatchedFeatureResponse = await page.request.post(`${API_URL}/api/automation-flows`, {
      data: {
        project_id: project.id,
        feature_id: otherFeature.id,
        requirement: '验证选择了其他项目的功能时全流程创建被拦截。',
      },
    });
    expect(mismatchedFeatureResponse.status()).toBe(400);
    expect(await mismatchedFeatureResponse.text()).toContain('功能必须属于所选项目');

    // 打开平台并确认左侧导航存在独立全流程入口。
    await page.goto(PLATFORM_URL);
    const moduleNav = page.getByRole('navigation', { name: '平台模块' });
    await expect(moduleNav.getByRole('button', { name: /^自动化测试全流程/ })).toBeVisible();
    await gotoModule(page, '自动化测试全流程');

    // 验证全流程页在需求输入上方提供项目和功能必填绑定字段。
    const flowPage = page.getByTestId('automation-flow-page');
    await expect(flowPage).toBeVisible();
    await expect(flowPage.getByRole('textbox')).toHaveCount(1);
    await expect(page.getByTestId('automation-flow-project')).toHaveValue(project.id);
    await expect(page.getByTestId('automation-flow-feature')).toContainText(featureName);
    await page.getByTestId('automation-flow-feature').selectOption(feature.id);
    await expect(page.getByTestId('automation-flow-result')).toContainText(featureName);
    await expect(page.getByTestId('automation-flow-input')).toBeVisible();

    // 过程澄清按钮应支持再次点击收起，避免卡片只能展开不能隐藏。
    const clarificationButton = page.getByRole('button', { name: /^过程澄清$/ });
    await expect(page.getByTestId('automation-flow-clarification')).toHaveCount(0);
    await expect(clarificationButton).toHaveAttribute('aria-expanded', 'false');
    await clarificationButton.click();
    await expect(page.getByTestId('automation-flow-clarification')).toBeVisible();
    await expect(clarificationButton).toHaveAttribute('aria-expanded', 'true');
    await clarificationButton.click();
    await expect(page.getByTestId('automation-flow-clarification')).toHaveCount(0);
    await expect(clarificationButton).toHaveAttribute('aria-expanded', 'false');
    const artifactButton = page.getByRole('button', { name: /^交付物$/ });
    await expect(page.getByTestId('automation-flow-artifact-preview')).toHaveCount(0);
    await expect(artifactButton).toHaveAttribute('aria-expanded', 'false');
    await artifactButton.click();
    await expect(page.getByTestId('automation-flow-artifact-preview')).toBeVisible();
    await expect(artifactButton).toHaveAttribute('aria-expanded', 'true');
    await artifactButton.click();
    await expect(page.getByTestId('automation-flow-artifact-preview')).toHaveCount(0);
    await expect(artifactButton).toHaveAttribute('aria-expanded', 'false');

    // 空需求启动时只输出需求分析阶段的阻塞日志。
    await page.getByRole('button', { name: /开始全流程/ }).click();
    const logStream = page.getByTestId('automation-flow-logs');
    await expect(logStream).toContainText('阻塞：需求文本为空', { timeout: 10_000 });
    await expect(logStream).toContainText(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[需求分析\] \[blocked\]/);

    // 输入完整需求后启动真实后端编排，摘要只展示当前阶段和实时同步状态。
    const flowRequests: Array<{ project_id?: string; feature_id?: string; requirement?: string }> = [];
    page.on('request', (request) => {
      if (request.url() === `${API_URL}/api/automation-flows` && request.method() === 'POST') {
        flowRequests.push(request.postDataJSON());
      }
    });
    await page.getByTestId('automation-flow-input').fill('验证用户可以在 https://www.saucedemo.com 使用 standard_user 登录、添加 Sauce Labs Backpack 到购物车、进入结账流程，并在缺失结账信息时看到错误提示。角色为 standard_user，测试数据为用户名 standard_user、密码 secret_sauce、商品 Sauce Labs Backpack。不覆盖跨浏览器兼容、支付真实链路和第三方风控。');
    await page.getByRole('button', { name: /开始全流程/ }).click();
    await expect.poll(() => flowRequests.some((request) => request.project_id === project.id && request.feature_id === feature.id), { timeout: 10_000 }).toBeTruthy();
    await expect(page.getByTestId('automation-flow-result')).toContainText('当前阶段', { timeout: 20_000 });
    await expect(page.getByTestId('automation-flow-result')).toContainText('实时同步');
    await expect(page.getByTestId('automation-flow-result')).not.toContainText('真实 Flow');
    await expect(page.getByTestId('automation-flow-result')).not.toContainText('workItemId');
    await expect(page.getByTestId('automation-flow-stages')).toContainText('保存已验证产物');
    await artifactButton.click();
    const artifactPreview = page.getByTestId('automation-flow-artifact-preview');
    await expect(artifactPreview).toContainText('交付物');
    await expect(artifactPreview).toContainText('需求结构化抽取', { timeout: 20_000 });
    const requirementStageToggle = artifactPreview.getByRole('button', { name: /需求分析 \(\d+\)/ });
    await expect(requirementStageToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(artifactPreview.getByRole('button', { name: /需求结构化抽取/ })).toBeVisible();
    await requirementStageToggle.click();
    await expect(requirementStageToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(artifactPreview.getByRole('button', { name: /需求结构化抽取/ })).toHaveCount(0);
    await requirementStageToggle.click();
    await expect(requirementStageToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(artifactPreview.getByRole('button', { name: /需求结构化抽取/ })).toBeVisible();
    await artifactPreview.getByRole('button', { name: '版本记录' }).click();
    await expect(artifactPreview.getByRole('button', { name: /需求结构化抽取/ })).toBeVisible();
    await artifactPreview.getByRole('button', { name: '产物目录' }).click();
    await expect(requirementStageToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(logStream).toContainText('Playwright 配置', { timeout: 30_000 });
    await expect(page.getByTestId('artifact-test-cases')).toContainText(/TC-|主流程|测试用例/, { timeout: 45_000 });
    await expect(logStream).toContainText(/真实页面探索已启动|已自动确认/, { timeout: 160_000 });
    await expect(page.getByTestId('automation-flow-browser-preview')).toContainText('运行验证实时浏览器', { timeout: 160_000 });
    const automationCanvas = page.getByTestId('automation-flow-browser-live-canvas');
    await expect(automationCanvas).toBeVisible();
    await expect.poll(async () => automationCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0), { timeout: 20_000 }).toBeTruthy();
    const fullscreenButton = page.getByTestId('automation-flow-browser-fullscreen');
    await expect(fullscreenButton).toBeVisible();
    await expect(fullscreenButton).toBeEnabled();
    const canvasBoxBeforeFullscreen = await automationCanvas.boundingBox();
    expect(canvasBoxBeforeFullscreen?.width ?? 0).toBeGreaterThan(0);
    expect(canvasBoxBeforeFullscreen?.height ?? 0).toBeGreaterThan(0);
    await fullscreenButton.click();
    await expect.poll(async () => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') || ''), { timeout: 10_000 }).toBe('automation-flow-browser-shell');
    const canvasBoxInFullscreen = await automationCanvas.boundingBox();
    expect(canvasBoxInFullscreen?.width ?? 0).toBeGreaterThan(canvasBoxBeforeFullscreen?.width ?? 0);
    expect(canvasBoxInFullscreen?.height ?? 0).toBeGreaterThan(canvasBoxBeforeFullscreen?.height ?? 0);
    await expect.poll(async () => automationCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0), { timeout: 10_000 }).toBeTruthy();
    await page.keyboard.press('Escape');
    await expect.poll(async () => page.evaluate(() => Boolean(document.fullscreenElement)), { timeout: 10_000 }).toBeFalsy();
    await expect(logStream).toContainText(/Playwright 真实执行完成|三轮自愈后仍失败|已保存最终测试用例/, { timeout: 160_000 });

    await expect.poll(async () => {
      const text = await logStream.textContent().catch(() => '');
      return text?.match(/真实全流程 run 已创建: ([a-f0-9]+)/)?.[1] || '';
    }, { timeout: 30_000 }).toMatch(/[a-f0-9]+/);
    const resolvedFlowId = await logStream.textContent().then((text) => text?.match(/真实全流程 run 已创建: ([a-f0-9]+)/)?.[1] || '');
    expect(resolvedFlowId).toBeTruthy();
    await expect.poll(async () => {
      const response = await page.request.get(`${API_URL}/api/automation-flows/${resolvedFlowId}`);
      if (!response.ok()) return '';
      const payload = await response.json();
      return payload.status;
    }, { timeout: 180_000 }).toBe('completed');
    const stageStrip = page.getByTestId('automation-flow-stages');
    await expect(stageStrip.getByText('项目预检').locator('xpath=..')).toContainText('已完成');
    await expect(stageStrip.getByText('自愈诊断').locator('xpath=..')).toContainText('无需自愈');

    const flowResponse = await page.request.get(`${API_URL}/api/automation-flows/${resolvedFlowId}`);
    expect(flowResponse.ok()).toBeTruthy();
    const flowPayload = await flowResponse.json();
    expect(flowPayload.projectId).toBe(project.id);
    expect(flowPayload.featureId).toBe(feature.id);
    expect(flowPayload.workItem.featureId).toBe(feature.id);
    const artifactsResponse = await page.request.get(`${API_URL}/api/automation-flows/${resolvedFlowId}/artifacts`);
    expect(artifactsResponse.ok()).toBeTruthy();
    const artifacts = await artifactsResponse.json();
    expect(artifacts.map((item) => item.artifactType)).toEqual(expect.arrayContaining(['requirement-analysis', 'test-cases', 'exploration-plan', 'playwright-script']));
    const casesResponse = await page.request.get(`${API_URL}/api/test-cases?project_id=${project.id}&work_item_id=${flowPayload.workItemId}`);
    expect(casesResponse.ok()).toBeTruthy();
    const cases = await casesResponse.json();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((item) => item.featureId === feature.id)).toBeTruthy();
    const deliverablesResponse = await page.request.get(`${API_URL}/api/deliverables?project_id=${project.id}&work_item_id=${flowPayload.workItemId}&include_content=false`);
    expect(deliverablesResponse.ok()).toBeTruthy();
    const deliverables = await deliverablesResponse.json();
    expect(deliverables.map((item) => item.type)).toEqual(expect.arrayContaining(['test-cases', 'spec', 'manual-report', 'html-report']));
    expect(deliverables.every((item) => item.featureId === feature.id)).toBeTruthy();

    // 读取日志文本并确认真实阶段至少按前置顺序推进，不再依赖前端模拟日志。
    const logText = (flowPayload.logs || []).map((item) => `[${item.stage}]`).join('\n');
    const stages = ['需求分析', '项目预检', '用例设计', '页面探索', '脚本实现', '运行验证'];
    const positions = stages.map((stage) => logText?.indexOf(`[${stage}]`) ?? -1);
    for (const position of positions) {
      expect(position).toBeGreaterThan(-1);
    }
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]);
    }

    const historyResponse = await page.request.get(`${API_URL}/api/automation-flows`);
    expect(historyResponse.ok()).toBeTruthy();
    const historyPayload = await historyResponse.json();
    expect(historyPayload.length).toBeGreaterThanOrEqual(1);
    if (historyPayload.length > 1) {
      expect(historyPayload[0].startedAt >= historyPayload[1].startedAt).toBeTruthy();
    }
    const historyItem = historyPayload.find((item) => item.flowRunId === resolvedFlowId);
    expect(historyItem).toBeTruthy();
    expect(historyItem.projectId).toBe(project.id);
    expect(historyItem.featureId).toBe(feature.id);
    expect(historyItem.workItem.title).toBe(flowPayload.workItem.title);
    expect(historyItem.logs).toBeUndefined();
    expect(historyItem.flowArtifacts).toBeUndefined();

    await page.getByRole('button', { name: /历史记录/ }).click();
    const historyPanel = page.getByTestId('automation-flow-history');
    await expect(historyPanel).toBeVisible();
    await expect(historyPanel).toContainText(flowPayload.workItem.title);
    await page.getByRole('button', { name: /清空会话/ }).click();
    await expect(page.getByTestId('automation-flow-input')).toHaveValue('');
    await page.getByRole('button', { name: /历史记录/ }).click();
    await page.getByTestId('automation-flow-history').getByTestId('automation-flow-history-item').filter({ hasText: flowPayload.workItem.title }).first().click();
    await expect(page.getByTestId('automation-flow-input')).toHaveValue(flowPayload.workItem.requirement);
    await expect(page.getByTestId('automation-flow-project')).toHaveValue(project.id);
    await expect(page.getByTestId('automation-flow-feature')).toHaveValue(feature.id);
    await expect(page.getByTestId('automation-flow-result')).toContainText('保存已验证产物');
    await expect(page.getByTestId('automation-flow-live')).toContainText('需求分析');
    await page.getByRole('button', { name: /^交付物$/ }).click();
    await expect(page.getByTestId('automation-flow-artifact-preview')).toContainText('需求结构化抽取');
    await page.getByTestId('automation-flow-logs').getByRole('button').click();
    await expect(page.getByTestId('automation-flow-logs')).toContainText('真实全流程 run 已创建');
  });
});
