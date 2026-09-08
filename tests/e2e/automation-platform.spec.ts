import { expect, type Locator, type Page, test } from '@playwright/test';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:5174';
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8001';

function bootstrapAdminPassword() {
  const value = process.env.QA_BOOTSTRAP_ADMIN_PASSWORD;
  if (!value) throw new Error('缺少 QA_BOOTSTRAP_ADMIN_PASSWORD，无法登录测试平台');
  return value;
}
const THEME_LABELS = ['深海', '曜石蓝', '松石绿', '晨光'] as const;
const NAV_GROUP_BY_MODULE: Record<string, string> = {
  '总览': '工作台',
  '一键自动化': '工作台',
  '需求工单': '人工工作台',
  '用例设计': '人工工作台',
  '探索实验室': '人工工作台',
  '脚本工作台': '人工工作台',
  '执行测试': '人工工作台',
  '自愈诊断': '人工工作台',
  '测试套件': '测试执行',
  '执行监控': '测试执行',
  '项目管理': '资产管理',
  '用例管理': '资产管理',
  '测试报告': '资产管理',
  '功能配置': '系统设置',
  'AI 配置': '系统设置',
  '用户管理': '系统设置',
};

const CASES_MARKDOWN = `| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-DEMO-001 | P0 | 登录页关键元素可见 | 登录页面基础可用性 | Sauce Demo 可访问；standard_user/secret_sauce | 打开登录页 | Username、Password、Login 可见 | 使用 placeholder 和稳定 data-test |
| TC-DEMO-002 | P1 | 错误登录展示提示 | 关键错误状态 | Sauce Demo 可访问；locked_out_user/secret_sauce | 输入锁定账号并登录 | 展示错误提示，不进入商品页 | 探索阶段确认错误提示 selector |`;

const PREVIEW_CASES_MARKDOWN = `| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-PREVIEW-001 | P0 | 主流程登录成功 | 登录主路径可用 | 已准备 standard_user | 打开登录页；输入账号密码；点击登录 | 进入商品列表页 | 自动化覆盖主流程 |
| TC-CODEX-PREVIEW-002 | P1 | 错误密码提示 | 登录错误反馈 | 已准备 standard_user 和错误密码 | 输入错误密码并提交 | 展示错误提示 | 自动化覆盖异常提示 |
| TC-CODEX-PREVIEW-003 | P1 | 加购后角标更新 | 购物车数量反馈 | 已登录且商品可见 | 点击商品加购 | 购物车角标为 1 | 自动化覆盖关键状态 |
| TC-CODEX-PREVIEW-004 | P2 | 移除商品后角标清空 | 购物车移除行为 | 购物车已有商品 | 点击移除 | 购物车角标消失 | 自动化覆盖回归路径 |
| TC-CODEX-PREVIEW-005 | P2 | 缺少邮编提示 | 结账表单校验 | 已进入结账信息页 | 留空邮编提交 | 展示邮编必填错误 | 自动化覆盖表单校验 |
| TC-CODEX-PREVIEW-006 | P2 | 取消结账返回购物车 | 结账导航行为 | 已进入结账信息页 | 点击取消 | 返回购物车页面 | 自动化覆盖导航回退 |`;

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
  const navigation = page.getByRole('navigation', { name: '平台模块' });
  const moduleButton = navigation.getByRole('button', { name: new RegExp(`^${name}`) });
  if (await moduleButton.count() === 0) {
    const groupName = NAV_GROUP_BY_MODULE[name];
    if (groupName) {
      const groupButton = navigation.getByRole('button', { name: groupName, exact: true });
      if (await groupButton.getAttribute('aria-expanded') === 'false') await groupButton.click();
    }
  }
  await moduleButton.click();
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

async function mockSuccessfulAuth(page: Page, role = 'admin') {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: {
          id: 'e2e-codex-preview-user',
          username: 'e2e-codex-preview',
          displayName: 'E2E 预览用户',
          role,
          status: 'active',
        },
      }),
    });
  });
}

async function mockJsonApi(page: Page, path: string, payload: unknown) {
  await page.route(`**${path}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

async function mockFallbackApi(page: Page) {
  await page.route('**/*', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    const emptyListPaths = new Set(['/api/test-suites', '/api/suite-runs']);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyListPaths.has(pathname) ? [] : {}),
    });
  });
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

test('TC-PLAT-REPORTS-001 测试报告默认全量并按共享项目工单范围查询', async ({ page }) => {
  const project = {
    id: 'project-e2e-codex-reports',
    projectCode: 'PRJ-E2E-CODEX-REPORTS',
    slug: 'e2e-codex-reports',
    name: 'E2E-CODEX 测试报告项目',
    status: 'active',
  };
  const workItems = [
    {
      id: 'work-item-e2e-codex-report-1',
      projectId: project.id,
      title: 'E2E-CODEX 登录工单',
      requirement: 'E2E-CODEX 登录报告验证',
      status: 'artifacts-saved',
      stage: 'delivery',
      caseIds: [],
      testCases: [],
      scriptVersions: [],
    },
    {
      id: 'work-item-e2e-codex-report-2',
      projectId: project.id,
      title: 'E2E-CODEX 未执行工单',
      requirement: 'E2E-CODEX 暂无报告验证',
      status: 'cases-ready',
      stage: 'cases',
      caseIds: [],
      testCases: [],
      scriptVersions: [],
    },
  ];
  const caseRows = [
    {
      case: {
        id: 'case-e2e-codex-report-1',
        projectId: project.id,
        workItemId: 'work-item-e2e-codex-report-1',
        externalId: 'TC-CODEX-REPORT-001',
        title: '单用例登录执行报告',
        automationStatus: 'automated',
        updatedAt: '2026-07-29T02:00:00Z',
      },
      project,
      workItem: { id: 'work-item-e2e-codex-report-1', title: 'E2E-CODEX 登录工单' },
      latestRun: {
        id: 'run-e2e-codex-case-report-1',
        status: 'passed',
        startedAt: '2026-07-29T01:00:00Z',
        endedAt: '2026-07-29T01:00:09Z',
      },
      reportAvailable: true,
      reportId: 'report-record-e2e-codex-case-1',
      historyCount: 2,
      currentCaseChanged: true,
    },
    {
      case: {
        id: 'case-e2e-codex-report-3',
        projectId: project.id,
        workItemId: 'work-item-e2e-codex-report-1',
        externalId: 'TC-CODEX-REPORT-003',
        title: '可批量选择的失败报告',
        automationStatus: 'automated',
        updatedAt: '2026-07-29T02:20:00Z',
      },
      project,
      workItem: { id: 'work-item-e2e-codex-report-1', title: 'E2E-CODEX 登录工单' },
      latestRun: {
        id: 'run-e2e-codex-case-report-3',
        status: 'failed',
        startedAt: '2026-07-29T01:10:00Z',
        endedAt: '2026-07-29T01:10:06Z',
      },
      reportAvailable: true,
      reportId: 'report-record-e2e-codex-case-3',
      historyCount: 1,
    },
  ];
  const manualRow = {
    report: {
      id: 'manual-report-e2e-codex-latest',
      projectId: project.id,
      workItemId: 'work-item-e2e-codex-report-1',
      runId: 'run-e2e-codex-manual-report-1',
      type: 'manual-report',
      name: 'E2E-CODEX 登录人工测试报告',
      status: 'ready',
      version: 3,
      summary: '人工验证主流程、异常提示和权限边界均符合预期。',
      updatedAt: '2026-07-29T03:00:00Z',
    },
    project,
    workItem: { id: 'work-item-e2e-codex-report-1', title: 'E2E-CODEX 登录工单' },
    historyCount: 3,
  };
  const caseQueries: URLSearchParams[] = [];
  const manualQueries: URLSearchParams[] = [];
  const caseDeleteRequests: Array<{ items: Array<{ case_id: string; run_id: string }> }> = [];
  const manualDeleteRequests: Array<{ report_ids: string[] }> = [];

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', workItems);
  await mockJsonApi(page, `/api/work-items/${workItems[0].id}`, workItems[0]);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {});
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [], tree: [] });
  await page.route('**/api/case-reports?*', async (route) => {
    caseQueries.push(new URL(route.request().url()).searchParams);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: caseRows,
        total: caseRows.length,
        page: 1,
        pageSize: 50,
      }),
    });
  });
  await page.route('**/api/manual-reports?*', async (route) => {
    manualQueries.push(new URL(route.request().url()).searchParams);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [manualRow], total: 1, page: 1, pageSize: 50 }),
    });
  });
  await mockJsonApi(page, '/api/case-reports/case-e2e-codex-report-1/history', {
    items: [
      {
        id: 'report-record-e2e-codex-case-1',
        reportType: 'case-execution',
        project,
        workItem: { id: 'work-item-e2e-codex-report-1', title: 'E2E-CODEX 登录工单' },
        case: caseRows[0].case,
        runId: 'run-e2e-codex-case-report-1',
        status: 'passed',
        version: 2,
        startedAt: '2026-07-29T01:00:00Z',
        endedAt: '2026-07-29T01:00:09Z',
        updatedAt: '2026-07-29T01:00:09Z',
        currentCaseChanged: true,
        sourceCaseDeleted: false,
      },
      {
        id: 'report-record-e2e-codex-case-1-old',
        reportType: 'case-execution',
        project,
        workItem: { id: 'work-item-e2e-codex-report-1', title: 'E2E-CODEX 登录工单' },
        case: caseRows[0].case,
        runId: 'run-e2e-codex-case-report-1-old',
        status: 'failed',
        version: 1,
        startedAt: '2026-07-28T01:00:00Z',
        endedAt: '2026-07-28T01:00:05Z',
        updatedAt: '2026-07-28T01:00:05Z',
        failureReason: '历史失败记录',
      },
    ],
    total: 2,
  });
  await mockJsonApi(page, '/api/manual-reports/work-item-e2e-codex-report-1/history', {
    items: [
      {
        id: 'manual-report-e2e-codex-latest',
        reportType: 'work-item-summary',
        project,
        workItem: { id: 'work-item-e2e-codex-report-1', title: 'E2E-CODEX 登录工单' },
        runId: 'run-e2e-codex-manual-report-1',
        status: 'ready',
        version: 3,
        name: 'E2E-CODEX 登录人工测试报告',
        summary: '人工验证主流程、异常提示和权限边界均符合预期。',
        updatedAt: '2026-07-29T03:00:00Z',
      },
    ],
    total: 1,
  });
  await page.route('**/api/case-reports/bulk-delete', async (route) => {
    caseDeleteRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'deleted', deleted: caseDeleteRequests.at(-1)?.items.length || 0 }),
    });
  });
  await page.route('**/api/manual-reports/bulk-delete', async (route) => {
    manualDeleteRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'deleted', deleted: manualDeleteRequests.at(-1)?.report_ids.length || 0 }),
    });
  });
  await mockJsonApi(page, '/api/runs/run-e2e-codex-case-report-1/logs', {
    items: [
      { id: 101, createdAt: '2026-07-29T01:00:01Z', level: 'info', message: 'CODEX_CASE_LOG 打开登录页面' },
      { id: 102, createdAt: '2026-07-29T01:00:09Z', level: 'success', message: 'CODEX_CASE_LOG 用例执行通过' },
    ],
  });
  await mockJsonApi(page, '/api/runs/run-e2e-codex-manual-report-1/logs', {
    items: [
      { id: 201, createdAt: '2026-07-29T02:59:58Z', level: 'info', message: 'CODEX_MANUAL_LOG 汇总人工报告证据' },
    ],
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PLATFORM_URL);
  await gotoModule(page, '测试报告');

  const reports = page.getByRole('region', { name: '测试报告' });
  await expect(page.locator('.command-title-row h1')).toHaveText('测试报告');
  await expect(reports.getByRole('heading', { name: '测试报告' })).toBeVisible();
  const caseTab = reports.getByRole('tab', { name: '用例执行报告' });
  const manualTab = reports.getByRole('tab', { name: '工单总结报告' });
  await expect(caseTab).toHaveAttribute('aria-selected', 'true');
  await expect(reports.getByTestId('case-report-table')).toBeVisible();
  const caseFilters = reports.getByTestId('case-report-filters');
  const caseProject = caseFilters.getByRole('combobox', { name: '项目', exact: true });
  const caseWorkItem = caseFilters.getByRole('combobox', { name: '工单', exact: true });
  const caseQueryButton = caseFilters.getByRole('button', { name: '查询' });
  const caseResetButton = caseFilters.getByRole('button', { name: '重置' });
  const caseBulkDelete = caseFilters.getByRole('button', { name: '删除已选 0 条' });
  await expect(caseProject).toHaveValue('');
  await expect(caseWorkItem).toHaveValue('');
  await expect(caseWorkItem).toBeDisabled();
  await expect(caseBulkDelete).toBeDisabled();
  const desktopFilterLayout = await Promise.all([
    caseQueryButton.boundingBox(),
    caseResetButton.boundingBox(),
    caseBulkDelete.boundingBox(),
  ]);
  expect(desktopFilterLayout.every(Boolean)).toBeTruthy();
  const [queryBox, resetBox, deleteBox] = desktopFilterLayout;
  expect(Math.abs((queryBox?.y || 0) - (deleteBox?.y || 0))).toBeLessThan(2);
  expect((deleteBox?.x || 0)).toBeGreaterThan((resetBox?.x || 0));
  expect((resetBox?.x || 0)).toBeGreaterThan((queryBox?.x || 0));
  await expect(reports.getByRole('button', { name: '当前工单' })).toHaveCount(0);
  await expect(reports.getByRole('button', { name: '当前项目' })).toHaveCount(0);
  await expect.poll(() => caseQueries.length).toBeGreaterThan(0);
  expect(caseQueries.at(-1)?.get('project_id')).toBeNull();
  expect(caseQueries.at(-1)?.get('work_item_id')).toBeNull();

  const firstRow = reports.getByTestId('case-report-row-case-e2e-codex-report-1');
  const thirdRow = reports.getByTestId('case-report-row-case-e2e-codex-report-3');
  await expect(firstRow).toContainText('TC-CODEX-REPORT-001');
  await expect(firstRow).toContainText('2 次执行');
  await expect(firstRow).toContainText('当前用例已变更');
  await expect(reports.getByTestId('case-report-row-case-e2e-codex-report-2')).toHaveCount(0);
  const caseReportLink = firstRow.getByRole('link', { name: '报告' });
  await expect(caseReportLink).toHaveAttribute('href', /\/reports\/report-records\/report-record-e2e-codex-case-1$/);
  await expect(caseReportLink).toHaveAttribute('target', '_blank');

  const caseSelectAll = reports.getByRole('checkbox', { name: '选择本页全部用例执行报告' });
  const firstCaseCheckbox = firstRow.getByRole('checkbox', { name: /选择用例执行报告/ });
  const thirdCaseCheckbox = thirdRow.getByRole('checkbox', { name: /选择用例执行报告/ });
  await firstCaseCheckbox.check();
  await expect(caseSelectAll).toHaveJSProperty('indeterminate', true);
  await expect(reports.getByRole('button', { name: '删除已选 1 条' })).toBeEnabled();

  await manualTab.click();
  const earlyManualRow = reports.getByTestId('manual-report-row-manual-report-e2e-codex-latest');
  const manualCheckbox = earlyManualRow.getByRole('checkbox', { name: /选择工单总结报告/ });
  await manualCheckbox.check();
  await expect(reports.getByRole('button', { name: '删除已选 1 条' })).toBeEnabled();
  await caseTab.click();
  await expect(firstCaseCheckbox).toBeChecked();
  await thirdCaseCheckbox.check();
  await expect(caseSelectAll).toBeChecked();

  page.once('dialog', (dialog) => dialog.dismiss());
  await thirdRow.getByRole('button', { name: /删除用例执行报告/ }).click();
  expect(caseDeleteRequests).toHaveLength(0);

  page.once('dialog', (dialog) => dialog.accept());
  await reports.getByRole('button', { name: '删除已选 2 条' }).click();
  await expect.poll(() => caseDeleteRequests.length).toBe(1);
  expect(caseDeleteRequests[0].items).toEqual([
    { case_id: 'case-e2e-codex-report-1', run_id: 'run-e2e-codex-case-report-1' },
    { case_id: 'case-e2e-codex-report-3', run_id: 'run-e2e-codex-case-report-3' },
  ]);
  await expect(reports.getByRole('button', { name: '删除已选 0 条' })).toBeDisabled();

  await manualTab.click();
  await expect(manualCheckbox).toBeChecked();
  page.once('dialog', (dialog) => dialog.accept());
  await earlyManualRow.getByRole('button', { name: /删除工单总结报告/ }).click();
  await expect.poll(() => manualDeleteRequests.length).toBe(1);
  expect(manualDeleteRequests[0]).toEqual({ report_ids: ['manual-report-e2e-codex-latest'] });
  await caseTab.click();

  await firstRow.getByText('单用例登录执行报告').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const firstDetailButton = firstRow.getByRole('button', { name: '详情' });
  await firstDetailButton.click();
  const firstDialog = page.getByRole('dialog', { name: 'TC-CODEX-REPORT-001' });
  await expect(firstDialog).toBeVisible();
  await expect(firstDialog).toContainText('run-e2e-codex-case-report-1');
  await expect(firstDialog).toContainText('9s');
  await expect(firstDialog).toContainText('共 2 条');
  await expect(firstDialog).toContainText('当前用例已变更');
  await expect(firstDialog.getByTestId('report-execution-logs')).toContainText('CODEX_CASE_LOG 打开登录页面');
  await expect(firstDialog.getByTestId('report-execution-logs')).toContainText('CODEX_CASE_LOG 用例执行通过');
  await expect(firstDialog.getByTestId('report-execution-logs')).toContainText('2 条');
  await firstDialog.getByRole('button', { name: '关闭详情' }).click();
  await expect(firstDialog).toHaveCount(0);
  await expect(firstDetailButton).toBeFocused();

  await firstDetailButton.click();
  const overlay = page.getByTestId('report-detail-modal-overlay');
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await caseProject.selectOption(project.id);
  await expect(caseWorkItem).toBeEnabled();
  await expect(caseWorkItem.getByRole('option', { name: 'E2E-CODEX 登录工单' })).toHaveCount(1);
  await caseWorkItem.selectOption(workItems[0].id);
  const caseKeyword = caseFilters.getByLabel('关键词');
  await caseKeyword.fill('TC-CODEX-REPORT-001');
  await caseFilters.getByRole('button', { name: '查询' }).click();
  expect(caseQueries.at(-1)?.get('q')).toBe('TC-CODEX-REPORT-001');
  expect(caseQueries.at(-1)?.get('project_id')).toBe(project.id);
  expect(caseQueries.at(-1)?.get('work_item_id')).toBe(workItems[0].id);

  await manualTab.click();
  await expect(manualTab).toHaveAttribute('aria-selected', 'true');
  const manualFilters = reports.getByTestId('manual-report-filters');
  await expect(manualFilters.getByLabel('关键词')).toHaveValue('');
  const manualBulkDelete = manualFilters.getByRole('button', { name: '删除已选 0 条' });
  await expect(manualBulkDelete).toBeDisabled();
  const manualProject = manualFilters.getByRole('combobox', { name: '项目', exact: true });
  const manualWorkItem = manualFilters.getByRole('combobox', { name: '工单', exact: true });
  await expect(manualProject).toHaveValue(project.id);
  await expect(manualWorkItem).toHaveValue(workItems[0].id);
  await expect.poll(() => manualQueries.length).toBeGreaterThan(0);
  expect(manualQueries.at(-1)?.get('project_id')).toBe(project.id);
  expect(manualQueries.at(-1)?.get('work_item_id')).toBe(workItems[0].id);
  await manualFilters.getByLabel('关键词').fill('人工登录');
  await manualFilters.getByRole('button', { name: '查询' }).click();
  expect(manualQueries.at(-1)?.get('q')).toBe('人工登录');
  expect(manualQueries.at(-1)?.get('work_item_id')).toBe(workItems[0].id);

  const manualReportRow = reports.getByTestId('manual-report-row-manual-report-e2e-codex-latest');
  await expect(manualReportRow).toContainText('v3');
  const manualReportLink = manualReportRow.getByRole('link', { name: '报告' });
  await expect(manualReportLink).toHaveAttribute('href', /\/reports\/report-records\/manual-report-e2e-codex-latest$/);
  await manualReportRow.getByRole('button', { name: '详情' }).click();
  const manualDialog = page.getByRole('dialog', { name: 'E2E-CODEX 登录人工测试报告' });
  await expect(manualDialog).toContainText('人工验证主流程、异常提示和权限边界均符合预期。');
  await expect(manualDialog).not.toContainText('正文');
  await expect(manualDialog.getByTestId('report-execution-logs')).toContainText('CODEX_MANUAL_LOG 汇总人工报告证据');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBeTruthy();
  const mobileFilterBox = await manualFilters.boundingBox();
  const mobileDeleteBox = await manualBulkDelete.boundingBox();
  expect(mobileFilterBox).not.toBeNull();
  expect(mobileDeleteBox).not.toBeNull();
  expect((mobileDeleteBox?.width || 0)).toBeGreaterThan((mobileFilterBox?.width || 0) - 30);
  expect((mobileDeleteBox?.x || 0)).toBeGreaterThan((mobileFilterBox?.x || 0));
  expect((mobileDeleteBox?.x || 0) + (mobileDeleteBox?.width || 0)).toBeLessThan((mobileFilterBox?.x || 0) + (mobileFilterBox?.width || 0));
  await expect.poll(async () => {
    const box = await page.locator('.report-detail-modal-card').boundingBox();
    return Boolean(box && box.x >= 0 && box.x + box.width <= 391);
  }).toBeTruthy();

  await page.keyboard.press('Escape');
  await manualFilters.getByRole('button', { name: '重置' }).click();
  await expect(manualProject).toHaveValue('');
  await expect(manualWorkItem).toBeDisabled();
  expect(manualQueries.at(-1)?.get('project_id')).toBeNull();
  expect(manualQueries.at(-1)?.get('work_item_id')).toBeNull();
  expect(manualQueries.at(-1)?.get('q')).toBeNull();
  await caseTab.click();
  await expect(caseFilters.getByLabel('关键词')).toHaveValue('TC-CODEX-REPORT-001');
  await expect(caseProject).toHaveValue('');
  await expect(caseWorkItem).toBeDisabled();
});

test('TC-PLAT-CASE-RESPONSIVE-001 用例管理响应式布局不产生页面级横向溢出', async ({ page }) => {
  const project = {
    id: 'project-e2e-codex-case-responsive',
    projectCode: 'PRJ-E2E-CODEX-RESPONSIVE',
    name: 'E2E-CODEX 用例管理超长项目名称响应式验证',
    status: 'active',
  };
  const feature = {
    id: 'feature-e2e-codex-case-responsive',
    projectId: project.id,
    name: '支付订单异常恢复与跨系统状态同步',
    path: '交易中心 / 支付订单 / 异常恢复与跨系统状态同步',
    isActive: false,
  };
  const nextFeature = {
    id: 'feature-e2e-codex-case-responsive-next',
    projectId: project.id,
    name: '支付结果通知与账务核对',
    path: '交易中心 / 支付订单 / 支付结果通知与账务核对',
    isActive: true,
  };
  const unavailableFeature = {
    id: 'feature-e2e-codex-case-responsive-unavailable',
    projectId: project.id,
    name: '已停用且未绑定功能',
    path: '交易中心 / 已停用且未绑定功能',
    isActive: false,
  };
  const responsiveCase = {
    id: 'case-e2e-codex-case-responsive',
    projectId: project.id,
    featureId: feature.id,
    featurePath: feature.path,
    externalId: 'TC-CODEX-RESPONSIVE-001',
    title: '验证超长用例标题、功能路径与脚本路径在不同窗口宽度下保持完整可操作',
    requirement: '覆盖窄桌面和移动端布局，确保选择、绑定功能、查看脚本及删除操作均不会超出页面。',
    preconditions: '已准备测试项目和绑定功能。',
    steps: '进入用例管理；打开详情；检查绑定脚本。',
    expected: '详情字段和脚本代码完整展示。',
    automationNotes: '使用现有脚本版本详情接口。',
    priority: 'P0',
    automationStatus: 'automated',
    latestStatus: 'passed',
    latestRunId: 'run-e2e-codex-responsive',
    scriptVersionId: 'script-version-e2e-codex-responsive',
    scriptVersion: 12,
    scriptStatus: 'active',
    specPath: 'tests/e2e/projects/payment/order-recovery/very-long-responsive-regression-case.spec.ts',
    createdAt: '2026-07-20T02:00:00Z',
    updatedAt: '2026-07-22T03:30:00Z',
  };
  const noScriptCase = {
    ...responsiveCase,
    id: 'case-e2e-codex-case-no-script',
    externalId: 'TC-CODEX-RESPONSIVE-002',
    title: '未绑定脚本用例',
    scriptVersionId: '',
    scriptVersion: null,
    scriptStatus: '',
    specPath: '',
    automationStatus: 'manual',
    latestStatus: '',
  };
  const brokenScriptCase = {
    ...responsiveCase,
    id: 'case-e2e-codex-case-broken-script',
    externalId: 'TC-CODEX-RESPONSIVE-003',
    title: '脚本详情加载失败用例',
    latestStatus: 'failed',
    scriptVersionId: 'script-version-e2e-codex-broken',
    scriptVersion: 3,
  };
  const scriptDetail = {
    id: responsiveCase.scriptVersionId,
    version: 12,
    status: 'active',
    specPath: responsiveCase.specPath,
    workItemId: 'work-item-e2e-codex-responsive',
    workItem: { id: 'work-item-e2e-codex-responsive', title: 'E2E-CODEX 响应式详情工单' },
    verifiedRunId: 'run-e2e-codex-responsive',
    content: "import { test, expect } from '@playwright/test';\n\ntest('TC-CODEX-RESPONSIVE-001 详情展示', async ({ page }) => {\n  await expect(page).toHaveTitle(/AutoTest/);\n});\n",
    createdAt: '2026-07-20T02:00:00Z',
    updatedAt: '2026-07-22T03:30:00Z',
    boundCases: [{
      id: responsiveCase.id,
      externalId: responsiveCase.externalId,
      title: responsiveCase.title,
      testTitle: 'TC-CODEX-RESPONSIVE-001 详情展示',
      grepPattern: 'TC-CODEX-RESPONSIVE-001',
      isActive: true,
    }],
  };
  const paginationCases = Array.from({ length: 8 }, (_, index) => ({
    ...noScriptCase,
    id: `case-e2e-codex-case-page-${index + 1}`,
    externalId: `TC-CODEX-RESPONSIVE-${String(index + 4).padStart(3, '0')}`,
    title: `本页选择范围验证用例 ${index + 1}`,
  }));
  const responsiveCases = [responsiveCase, noScriptCase, brokenScriptCase, ...paginationCases];
  let brokenScriptRequests = 0;
  let caseUpdatePayload: Record<string, unknown> | null = null;
  const editedTitle = '编辑后仍可在桌面和移动端完整操作的用例名称';
  const editedRequirement = '编辑弹窗保存后，列表与详情应立即展示最新用例内容。';

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', []);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {});
  await mockJsonApi(page, '/api/test-cases?project_id=all', responsiveCases);
  await mockJsonApi(page, `/api/test-cases?project_id=${project.id}`, responsiveCases);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, {
    items: [feature, nextFeature, unavailableFeature],
    tree: [feature, nextFeature, unavailableFeature],
  });
  await mockJsonApi(page, `/api/script-versions/${responsiveCase.scriptVersionId}`, scriptDetail);
  await page.route(`**/api/script-versions/${brokenScriptCase.scriptVersionId}`, async (route) => {
    brokenScriptRequests += 1;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '模拟脚本服务不可用' }) });
  });
  await page.route(`**/api/test-cases/${responsiveCase.id}`, async (route) => {
    caseUpdatePayload = route.request().postDataJSON();
    const updatedFeature = caseUpdatePayload.feature_id === nextFeature.id
      ? nextFeature
      : caseUpdatePayload.feature_id === feature.id ? feature : null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...responsiveCase,
        featureId: caseUpdatePayload.feature_id,
        featureName: updatedFeature?.name || '',
        featurePath: updatedFeature?.path || '',
        title: caseUpdatePayload.title,
        priority: caseUpdatePayload.priority,
        automationStatus: caseUpdatePayload.automation_status,
        requirement: caseUpdatePayload.requirement,
        preconditions: caseUpdatePayload.preconditions,
        steps: caseUpdatePayload.steps,
        expected: caseUpdatePayload.expected,
        automationNotes: caseUpdatePayload.automation_notes,
        updatedAt: '2026-07-22T05:00:00Z',
      }),
    });
  });

  const expectNoPageOverflow = async () => {
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    ))).toBeTruthy();
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PLATFORM_URL);
  await gotoModule(page, '用例管理');
  const caseRegion = page.getByRole('region', { name: '用例管理' });
  const tableViewport = page.getByTestId('case-management-table');
  const caseHeader = caseRegion.locator('.case-row-head');
  const caseRow = caseRegion.locator('.case-row').filter({ hasText: responsiveCase.externalId });
  const expectTableFits = async () => {
    await expect.poll(() => tableViewport.evaluate((element) => (
      element.scrollWidth <= element.clientWidth + 1
    ))).toBeTruthy();
    await expect.poll(async () => {
      const [viewportBox, headerBoxes, cellBoxes] = await Promise.all([
        tableViewport.boundingBox(),
        caseHeader.locator(':scope > *').evaluateAll((cells) => cells.map((cell) => {
          const rect = cell.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })),
        caseRow.locator(':scope > *').evaluateAll((cells) => cells.map((cell) => {
          const rect = cell.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })),
      ]);
      return Boolean(
        viewportBox
        && headerBoxes.length === 9
        && cellBoxes.length === 9
        && [...headerBoxes, ...cellBoxes].every((box) => (
          box.left >= viewportBox.x - 1
          && box.right <= viewportBox.x + viewportBox.width + 1
        ))
        && Math.abs(
          (headerBoxes[0].left + headerBoxes[0].right) / 2
          - (cellBoxes[0].left + cellBoxes[0].right) / 2
        ) <= 1
        && headerBoxes.slice(1).every((box, index) => (
          Math.abs(box.left - cellBoxes[index + 1].left) <= 1
        ))
      );
    }).toBeTruthy();
  };
  await expect(caseRow).toBeVisible();
  await expect(caseHeader).toContainText('用例名称');
  const headerStyle = await caseHeader.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderRadius: style.borderRadius,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      minHeight: style.minHeight,
      paddingLeft: style.paddingLeft,
    };
  });
  expect(headerStyle).toEqual({
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderColor: 'rgba(0, 0, 0, 0)',
    borderRadius: '0px',
    fontSize: '12px',
    fontWeight: '900',
    minHeight: '38px',
    paddingLeft: '12px',
  });
  await expect.poll(() => caseHeader.locator('.case-select-cell').evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.backgroundColor === 'rgba(0, 0, 0, 0)'
      && style.borderTopColor === 'rgba(0, 0, 0, 0)';
  })).toBeTruthy();
  const headerAlignments = await caseHeader.locator(':scope > span:not(.case-select-cell)').evaluateAll((cells) => (
    cells.map((cell) => window.getComputedStyle(cell).textAlign)
  ));
  expect(headerAlignments).toHaveLength(8);
  expect(new Set(headerAlignments)).toEqual(new Set(['left']));
  const headerCenterOffsets = await caseHeader.locator(':scope > span').evaluateAll((cells) => (
    cells.map((cell) => {
      const rect = cell.getBoundingClientRect();
      return rect.top + rect.height / 2;
    })
  ));
  expect(Math.max(...headerCenterOffsets) - Math.min(...headerCenterOffsets)).toBeLessThanOrEqual(1);
  const caseRowStyle = await caseRow.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderRadius: style.borderRadius,
      fontSize: style.fontSize,
      minHeight: style.minHeight,
      padding: style.padding,
    };
  });
  expect(caseRowStyle).toMatchObject({
    borderRadius: '8px',
    fontSize: '13px',
    minHeight: '66px',
    padding: '10px 12px',
  });
  expect(caseRowStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(caseRowStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  await caseRow.hover();
  await expect.poll(() => caseRow.evaluate((element, initialStyle) => {
    const style = window.getComputedStyle(element);
    return style.backgroundColor !== initialStyle.backgroundColor
      && style.borderTopColor !== initialStyle.borderColor;
  }, caseRowStyle)).toBeTruthy();
  await caseHeader.hover();
  await expect.poll(() => caseRow.locator('.case-project-cell small').evaluate((element) => window.getComputedStyle(element).fontSize)).toBe('12px');
  await expect(caseRegion.getByRole('button', { name: '全选筛选结果' })).toHaveCount(0);
  await expect(caseRegion.getByRole('button', { name: '取消筛选选择' })).toHaveCount(0);
  const pageSelection = caseHeader.getByRole('checkbox', { name: '选择本页全部用例' });
  const visibleCaseCheckboxes = caseRegion.locator('.case-row:not(.case-row-head)').getByRole('checkbox', { name: '选择' });
  await expect(pageSelection).not.toBeChecked();
  await expect(visibleCaseCheckboxes).toHaveCount(10);
  await pageSelection.check();
  await expect(pageSelection).toBeChecked();
  await expect.poll(() => visibleCaseCheckboxes.evaluateAll((checkboxes) => (
    checkboxes.every((checkbox) => (checkbox as HTMLInputElement).checked)
  ))).toBeTruthy();
  await caseRegion.getByRole('button', { name: '下一页' }).click();
  await expect(visibleCaseCheckboxes).toHaveCount(1);
  await expect(pageSelection).not.toBeChecked();
  await expect(visibleCaseCheckboxes).not.toBeChecked();
  await caseRegion.getByRole('button', { name: '首页' }).click();
  await expect(pageSelection).toBeChecked();
  await pageSelection.uncheck();
  await expect.poll(() => visibleCaseCheckboxes.evaluateAll((checkboxes) => (
    checkboxes.every((checkbox) => !(checkbox as HTMLInputElement).checked)
  ))).toBeTruthy();
  await caseRow.getByRole('checkbox', { name: '选择' }).check();
  await expect.poll(() => pageSelection.evaluate((checkbox) => (checkbox as HTMLInputElement).indeterminate)).toBeTruthy();
  await caseRow.getByRole('checkbox', { name: '选择' }).uncheck();
  await expect(caseRow.locator('.case-main-cell strong')).toHaveText(responsiveCase.externalId);
  await expect(caseRow.locator('.case-main-cell span')).toHaveText(responsiveCase.title);
  await expect(caseRow.locator('.case-project-cell strong')).toHaveAttribute('title', project.name);
  await expect(caseRow.locator('.case-main-cell strong')).toHaveAttribute('title', responsiveCase.externalId);
  await expect(caseRow.locator('.case-main-cell span')).toHaveAttribute('title', responsiveCase.title);
  await expect.poll(() => caseRow.locator('.case-main-cell strong').evaluate((element) => window.getComputedStyle(element).fontSize)).toBe('13px');
  await expect.poll(() => caseRow.locator('.case-main-cell span').evaluate((element) => window.getComputedStyle(element).fontSize)).toBe('12px');
  await expect(caseRow.locator('.case-automation-cell .case-status-pill')).toHaveClass(/automated/);
  await expect(caseRow.locator('.case-result-cell .case-status-pill')).toHaveClass(/passed/);
  await expect.poll(() => caseRow.locator('.case-result-cell .case-status-pill').evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.minHeight === '25px' && style.borderRadius === '999px';
  })).toBeTruthy();
  await expect.poll(() => caseRow.locator('.case-select-cell').evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.backgroundColor === 'rgba(0, 0, 0, 0)'
      && style.borderTopColor === 'rgba(0, 0, 0, 0)';
  })).toBeTruthy();
  await expect(caseRow.locator('.case-feature-value')).toHaveText(feature.path);
  await expect(caseRow.locator('.case-feature-value')).toHaveAttribute('title', feature.path);
  await expect(caseRow.getByRole('combobox', { name: `${responsiveCase.externalId} 绑定功能` })).toHaveCount(0);
  await expect(caseRow.locator('.script-link-button')).toHaveAttribute('title', responsiveCase.specPath);
  await expect.poll(() => caseRow.locator('.script-link-button').evaluate((element) => window.getComputedStyle(element).minHeight)).toBe('46px');
  await expect(caseRow).not.toContainText(responsiveCase.requirement);
  await expect(caseRegion.getByPlaceholder('套件名称')).toHaveCount(0);
  await expect(caseRegion.getByRole('button', { name: '保存为套件' })).toHaveCount(0);
  await expect(caseRow.locator('.case-select-cell')).toHaveText('');
  await expectNoPageOverflow();
  await expectTableFits();

  await caseRow.getByRole('button', { name: `编辑用例 ${responsiveCase.externalId}` }).click();
  const editDialog = page.getByRole('dialog', { name: `编辑用例 ${responsiveCase.externalId}` });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel('只读信息')).toContainText(project.name);
  await expect(editDialog.getByLabel('只读信息')).toContainText(responsiveCase.externalId);
  await expect(editDialog.getByText('人工命名', { exact: true })).toHaveCount(0);
  const featureSelect = editDialog.getByLabel('功能', { exact: true });
  await expect(featureSelect).toHaveValue(feature.id);
  await expect(featureSelect.getByRole('option', { name: `${feature.path}（停用）` })).toHaveCount(1);
  await expect(featureSelect.getByRole('option', { name: nextFeature.path })).toHaveCount(1);
  await expect(featureSelect.getByRole('option', { name: unavailableFeature.path })).toHaveCount(0);
  await expect(featureSelect.getByRole('option', { name: '未绑定' })).toHaveCount(1);
  await featureSelect.selectOption(nextFeature.id);
  await editDialog.getByLabel('用例名称', { exact: true }).fill(editedTitle);
  await editDialog.getByLabel('优先级', { exact: true }).selectOption('P1');
  await editDialog.getByLabel('自动化状态', { exact: true }).selectOption('designed');
  await editDialog.getByLabel('覆盖需求', { exact: true }).fill(editedRequirement);
  await editDialog.getByLabel('自动化说明', { exact: true }).fill('编辑弹窗模拟 PATCH 验证。');
  await editDialog.getByRole('button', { name: '保存修改' }).click();
  await expect(editDialog).toBeHidden();
  expect(caseUpdatePayload).toMatchObject({
    feature_id: nextFeature.id,
    title: editedTitle,
    priority: 'P1',
    automation_status: 'designed',
    requirement: editedRequirement,
    automation_notes: '编辑弹窗模拟 PATCH 验证。',
  });
  await expect(caseRow.locator('.case-main-cell strong')).toHaveText(responsiveCase.externalId);
  await expect(caseRow.locator('.case-main-cell span')).toHaveText(editedTitle);
  await expect(caseRow.locator('.case-feature-value')).toHaveText(nextFeature.path);
  await expect(caseRow.locator('.case-feature-value')).toHaveAttribute('title', nextFeature.path);

  await caseRow.getByRole('button', { name: `查看用例详情 ${responsiveCase.externalId}` }).click();
  const detailDialog = page.getByRole('dialog', { name: `用例详情 ${responsiveCase.externalId}` });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByLabel('用例基本信息')).toContainText(nextFeature.path);
  await expect(detailDialog).toContainText(editedRequirement);
  await expect(detailDialog).toContainText(responsiveCase.preconditions);
  await expect(detailDialog).toContainText('E2E-CODEX 响应式详情工单');
  await expect(detailDialog).toContainText('TC-CODEX-RESPONSIVE-001 详情展示');
  await expect(detailDialog.locator('.case-detail-code-block')).toContainText("import { test, expect } from '@playwright/test';");
  await detailDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(detailDialog).toBeHidden();

  const noScriptRow = caseRegion.locator('.case-row').filter({ hasText: noScriptCase.externalId });
  await expect(noScriptRow.locator('.case-automation-cell .case-status-pill')).toHaveClass(/manual/);
  await expect(noScriptRow.locator('.case-result-cell .case-status-pill')).toHaveClass(/no-report/);
  await noScriptRow.getByRole('button', { name: `查看用例详情 ${noScriptCase.externalId}` }).click();
  const noScriptDialog = page.getByRole('dialog', { name: `用例详情 ${noScriptCase.externalId}` });
  await expect(noScriptDialog).toContainText('当前用例未绑定脚本');
  await noScriptDialog.getByRole('button', { name: '关闭', exact: true }).click();

  const brokenScriptRow = caseRegion.locator('.case-row').filter({ hasText: brokenScriptCase.externalId });
  await expect(brokenScriptRow.locator('.case-result-cell .case-status-pill')).toHaveClass(/failed/);
  await brokenScriptRow.getByRole('button', { name: `查看用例详情 ${brokenScriptCase.externalId}` }).click();
  const brokenScriptDialog = page.getByRole('dialog', { name: `用例详情 ${brokenScriptCase.externalId}` });
  await expect(brokenScriptDialog).toContainText('脚本加载失败');
  await expect(brokenScriptDialog).toContainText(brokenScriptCase.requirement);
  await brokenScriptDialog.getByRole('button', { name: '重新加载' }).click();
  await expect.poll(() => brokenScriptRequests).toBe(2);
  await brokenScriptDialog.getByRole('button', { name: '关闭', exact: true }).click();

  await expect.poll(() => caseRow.locator('.case-action-cell').evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.position === 'static' && style.borderLeftWidth === '0px' && style.boxShadow === 'none';
  })).toBeTruthy();

  await page.setViewportSize({ width: 1024, height: 768 });
  await expectNoPageOverflow();
  await expectTableFits();
  await expect.poll(() => caseHeader.evaluate((element) => window.getComputedStyle(element).fontSize)).toBe('12px');
  const tabletActionBoxes = await caseRow.locator('.case-action-cell button').evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { top: rect.top, left: rect.left };
  }));
  expect(tabletActionBoxes).toHaveLength(4);
  expect(tabletActionBoxes[0].top).toBe(tabletActionBoxes[1].top);
  expect(tabletActionBoxes[2].top).toBeGreaterThan(tabletActionBoxes[0].top);
  expect(tabletActionBoxes[2].left).toBe(tabletActionBoxes[0].left);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoPageOverflow();
  await expect(caseRegion.locator('.case-row-head')).toBeHidden();
  await expect(caseRow.locator('.case-data-cell')).toHaveCount(7);
  const mobileLabels = await caseRow.locator('.case-data-cell').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-label')));
  expect(mobileLabels).toEqual([
    '项目',
    '用例名称',
    '优先级',
    '功能',
    '自动化',
    '最近结果',
    '绑定脚本',
  ]);
  for (const control of [
    caseRow.getByRole('checkbox', { name: '选择' }),
    caseRow.getByRole('button', { name: `查看用例详情 ${responsiveCase.externalId}` }),
    caseRow.getByRole('button', { name: `编辑用例 ${responsiveCase.externalId}` }),
    caseRow.getByRole('button', { name: `删除用例 ${responsiveCase.externalId}` }),
  ]) {
    await expect.poll(() => control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= window.innerWidth + 1;
    })).toBeTruthy();
  }
  await expect.poll(() => caseRow.locator('.case-feature-value').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= -1 && rect.right <= window.innerWidth + 1;
  })).toBeTruthy();
  const actionBoxes = await caseRow.locator('.case-action-cell button').evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }));
  expect(actionBoxes).toHaveLength(4);
  expect(actionBoxes[0].right).toBeLessThanOrEqual(actionBoxes[1].left);
  expect(actionBoxes[1].right).toBeLessThanOrEqual(actionBoxes[2].left);
  expect(actionBoxes[2].right).toBeLessThanOrEqual(actionBoxes[3].left);

  await caseRow.getByRole('button', { name: `编辑用例 ${responsiveCase.externalId}` }).click();
  const mobileEditDialog = page.getByRole('dialog', { name: `编辑用例 ${responsiveCase.externalId}` });
  await expect(mobileEditDialog).toBeVisible();
  await expectNoPageOverflow();
  const mobileFeatureSelect = mobileEditDialog.getByLabel('功能', { exact: true });
  await expect(mobileFeatureSelect).toHaveValue(nextFeature.id);
  await expect(mobileEditDialog.getByRole('button', { name: '保存修改' })).toBeVisible();
  await mobileFeatureSelect.selectOption('');
  await mobileEditDialog.getByRole('button', { name: '保存修改' }).click();
  await expect(mobileEditDialog).toBeHidden();
  expect(caseUpdatePayload).toMatchObject({ feature_id: '' });
  await expect(caseRow.locator('.case-feature-value')).toHaveText('未绑定');
});

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

test('TC-PLAT-OVERVIEW-001 总览套件执行记录展示结果并跳转到跨项目监控详情', async ({ page }) => {
  const currentProject = { id: 'proj-e2e-codex-overview-current', name: 'E2E-CODEX 当前项目', status: 'active' };
  const targetProject = { id: 'proj-e2e-codex-overview-target', name: 'E2E-CODEX 目标项目', status: 'active' };
  const targetRun = {
    id: 'suite-run-e2e-codex-overview-target',
    type: 'suite',
    suiteId: 'suite-e2e-codex-overview-target',
    projectId: targetProject.id,
    name: 'E2E-CODEX 跨项目回归套件',
    status: 'failed',
    progress: 100,
    totalCases: 6,
    passedCases: 4,
    failedCases: 1,
    skippedCases: 1,
    startedAt: '2026-07-14T02:00:00Z',
    endedAt: '2026-07-14T02:03:00Z',
    reportPath: '',
    cases: [],
  };
  const missingRun = {
    ...targetRun,
    id: 'suite-run-e2e-codex-overview-missing',
    name: 'E2E-CODEX 已删除套件记录',
  };
  let targetListRequests = 0;

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [currentProject, targetProject]);
  await mockJsonApi(page, '/api/work-items', []);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {
    totals: { testCases: 6, suiteRuns: 2 },
    recentRuns: [missingRun, targetRun],
  });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  for (const project of [currentProject, targetProject]) {
    await mockJsonApi(page, `/api/test-cases?project_id=${project.id}`, []);
    await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [], tree: [] });
    await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  }
  await mockJsonApi(page, `/api/suite-runs?project_id=${currentProject.id}`, []);
  await page.route(`**/api/suite-runs?project_id=${targetProject.id}`, async (route) => {
    targetListRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([targetRun]) });
  });
  await mockJsonApi(page, `/api/suite-runs/${targetRun.id}`, targetRun);
  await mockJsonApi(page, `/api/suite-runs/${targetRun.id}/logs`, { items: [] });
  await page.route(`**/api/suite-runs/${missingRun.id}`, async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Suite run not found' }) });
  });
  await mockJsonApi(page, '/api/automation-flows', []);

  await page.goto(PLATFORM_URL);
  const dashboard = page.getByTestId('overview-dashboard');
  const targetRecord = dashboard.getByRole('button', { name: `查看套件执行记录 ${targetRun.name}` });
  await expect(targetRecord).toContainText('通过 4');
  await expect(targetRecord).toContainText('失败 1');
  await expect(targetRecord).toContainText('跳过 1');
  await expect(dashboard).not.toContainText('单用例执行');

  await dashboard.getByRole('button', { name: `查看套件执行记录 ${missingRun.name}` }).click();
  await expect(page.getByTestId('error-banner')).toContainText('该套件执行记录已不存在');
  await expect(page.getByRole('region', { name: '平台总览' })).toBeVisible();

  await targetRecord.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '执行监控' })).toBeVisible();
  await expect(page.locator('.monitor-run-item.active')).toContainText(targetRun.name);
  await expect(page.locator('.monitor-detail-panel')).toContainText(`Run ID: ${targetRun.id}`);
  expect(targetListRequests).toBeGreaterThan(0);
});

test('TC-PLAT-SUITE-QUERY-001 测试套件按已提交的项目、名称和状态组合查询', async ({ page }) => {
  const projectAlpha = { id: 'proj-e2e-codex-suite-query-alpha', name: 'E2E-CODEX Alpha 项目', status: 'active' };
  const projectBeta = { id: 'proj-e2e-codex-suite-query-beta', name: 'E2E-CODEX Beta 项目', status: 'active' };
  const baseSuite = {
    description: '测试套件查询模拟数据',
    caseIds: [],
    caseCount: 0,
    runConfig: { mode: 'serial', failurePolicy: 'continue', retryCount: 0, runFailedOnly: false },
    scheduleConfig: { enabled: false, frequency: 'off', time: '', weekday: '1', intervalMinutes: 60, timezone: 'Asia/Shanghai', note: '' },
    createdAt: '2026-07-29T01:00:00Z',
    updatedAt: '2026-07-29T01:00:00Z',
  };
  const alphaSuite = {
    ...baseSuite,
    id: 'suite-e2e-codex-query-alpha',
    projectId: projectAlpha.id,
    name: 'E2E-CODEX Alpha 核心回归',
    status: 'active',
  };
  const betaActiveSuite = {
    ...baseSuite,
    id: 'suite-e2e-codex-query-beta-active',
    projectId: projectBeta.id,
    name: 'E2E-CODEX Beta 冒烟套件',
    status: 'active',
  };
  const betaDisabledSuite = {
    ...baseSuite,
    id: 'suite-e2e-codex-query-beta-disabled',
    projectId: projectBeta.id,
    name: 'E2E-CODEX Beta 已停用套件',
    status: 'disabled',
  };
  const allSuites = [alphaSuite, betaActiveSuite, betaDisabledSuite];

  await page.addInitScript(({ projectId }) => {
    window.localStorage.setItem('qa-platform-current-project', projectId);
    window.localStorage.setItem('qa-platform-active-module', 'test-suites');
    window.localStorage.setItem('qa-platform-open-module-tabs', JSON.stringify(['overview', 'test-suites']));
    window.localStorage.setItem('qa-platform-test-execution-project', 'all');
  }, { projectId: projectAlpha.id });
  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [projectAlpha, projectBeta]);
  await mockJsonApi(page, '/api/work-items', []);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {});
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, '/api/test-suites?project_id=all', allSuites);
  await mockJsonApi(page, '/api/suite-runs?project_id=all', []);
  for (const project of [projectAlpha, projectBeta]) {
    await mockJsonApi(page, `/api/test-cases?project_id=${project.id}`, []);
    await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [], tree: [] });
  }
  await mockJsonApi(page, '/api/automation-flows', []);

  await page.goto(PLATFORM_URL);
  const suiteRegion = page.getByRole('region', { name: '测试套件' });
  const queryForm = page.getByRole('form', { name: '测试套件查询' });
  const suiteTable = page.getByRole('table', { name: '测试套件列表' });
  const projectSelect = page.getByTestId('test-suites-query-project');
  const nameInput = page.getByTestId('test-suites-query-name');
  const statusSelect = page.getByTestId('test-suites-query-status');

  await expect(suiteRegion).toBeVisible();
  await expect(suiteRegion.locator('.section-header')).not.toContainText('数据范围');
  await expect(projectSelect).toHaveValue('all');
  await expect(suiteTable).toContainText(alphaSuite.name);
  await expect(suiteTable).toContainText(betaActiveSuite.name);
  await expect(suiteTable).toContainText(betaDisabledSuite.name);
  await expect(suiteRegion.locator('.suite-list-summary')).toContainText('显示 3/3');

  await nameInput.fill('alpha');
  await expect(suiteTable).toContainText(betaActiveSuite.name);
  await nameInput.press('Enter');
  await expect(suiteTable).toContainText(alphaSuite.name);
  await expect(suiteTable).not.toContainText(betaActiveSuite.name);
  await expect(suiteRegion.locator('.suite-list-summary')).toContainText('显示 1/3');

  await queryForm.getByRole('button', { name: '重置' }).click();
  await expect(projectSelect).toHaveValue('all');
  await expect(nameInput).toHaveValue('');
  await expect(statusSelect).toHaveValue('all');
  await expect(suiteRegion.locator('.suite-list-summary')).toContainText('显示 3/3');

  await projectSelect.selectOption(projectBeta.id);
  await statusSelect.selectOption('disabled');
  await queryForm.getByRole('button', { name: '查询' }).click();
  await expect(suiteTable).toContainText(betaDisabledSuite.name);
  await expect(suiteTable).not.toContainText(betaActiveSuite.name);
  await expect(suiteTable).not.toContainText(alphaSuite.name);

  await nameInput.fill('不存在的套件');
  await expect(suiteTable).toContainText(betaDisabledSuite.name);
  await queryForm.getByRole('button', { name: '查询' }).click();
  await expect(suiteRegion).toContainText('没有符合当前条件的套件');

  await queryForm.getByRole('button', { name: '重置' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(queryForm.getByRole('button', { name: '查询' })).toBeVisible();
  await expect(queryForm.getByRole('button', { name: '重置' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ))).toBeTruthy();
  await gotoModule(page, '执行监控');
  await expect(page.getByTestId('execution-monitor-query-project')).toHaveValue('all');
});

test('TC-PLAT-EXEC-QUERY-001 执行监控按项目和套件名称查询并支持重置', async ({ page }) => {
  const projectOne = { id: 'proj-e2e-codex-monitor-query-one', name: 'E2E-CODEX 查询项目一', status: 'active' };
  const projectTwo = { id: 'proj-e2e-codex-monitor-query-two', name: 'E2E-CODEX 查询项目二', status: 'active' };
  const loginRun = {
    id: 'suite-run-e2e-codex-monitor-login',
    suiteId: 'suite-e2e-codex-monitor-login',
    projectId: projectOne.id,
    name: 'E2E-CODEX 登录冒烟套件',
    status: 'passed',
    progress: 100,
    totalCases: 2,
    passedCases: 2,
    failedCases: 0,
    skippedCases: 0,
    startedAt: '2026-07-29T02:00:00Z',
    endedAt: '2026-07-29T02:01:00Z',
    reportPath: '',
    cases: [],
  };
  const paymentRun = {
    id: 'suite-run-e2e-codex-monitor-payment',
    suiteId: 'suite-e2e-codex-monitor-payment',
    projectId: projectTwo.id,
    name: 'E2E-CODEX 支付回归套件',
    status: 'failed',
    progress: 100,
    totalCases: 2,
    passedCases: 1,
    failedCases: 1,
    skippedCases: 0,
    startedAt: '2026-07-29T03:00:00Z',
    endedAt: '2026-07-29T03:01:00Z',
    reportPath: '',
    cases: [],
  };
  const allRuns = [paymentRun, loginRun];
  const listRequests: Array<{ projectId: string; suiteName: string }> = [];

  await page.addInitScript(({ suiteRunId }) => {
    window.localStorage.setItem('qa-platform-active-module', 'execution-monitor');
    window.localStorage.setItem('qa-platform-open-module-tabs', JSON.stringify(['overview', 'execution-monitor']));
    window.localStorage.setItem('qa-platform-test-execution-project', 'all');
    window.localStorage.setItem('qa-platform-monitor-suite-run', suiteRunId);
  }, { suiteRunId: loginRun.id });
  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [projectOne, projectTwo]);
  await mockJsonApi(page, '/api/work-items', []);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {});
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${projectOne.id}`, { items: [], tree: [] });
  await mockJsonApi(page, `/api/features?project_id=${projectTwo.id}`, { items: [], tree: [] });
  await mockJsonApi(page, '/api/test-suites?project_id=all', []);
  for (const run of allRuns) {
    await mockJsonApi(page, `/api/suite-runs/${run.id}`, run);
    await mockJsonApi(page, `/api/suite-runs/${run.id}/logs`, { items: [] });
  }
  await mockJsonApi(page, '/api/automation-flows', []);
  await page.route(/\/api\/suite-runs\?/, async (route) => {
    const requestUrl = new URL(route.request().url());
    const projectId = requestUrl.searchParams.get('project_id') || 'all';
    const suiteName = (requestUrl.searchParams.get('suite_name') || '').trim();
    listRequests.push({ projectId, suiteName });
    const normalizedName = suiteName.toLowerCase();
    const result = allRuns.filter((run) => (
      (projectId === 'all' || run.projectId === projectId)
      && (!normalizedName || run.name.toLowerCase().includes(normalizedName))
    ));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });

  await page.goto(PLATFORM_URL);
  const monitorRegion = page.getByRole('region', { name: '执行监控' });
  const queryForm = page.getByRole('form', { name: '执行监控查询' });
  const projectSelect = page.getByTestId('execution-monitor-query-project');
  const nameInput = page.getByTestId('execution-monitor-query-name');
  await expect(monitorRegion).toBeVisible();
  await expect(monitorRegion.locator('.section-header')).not.toContainText('数据范围');
  await expect(page.getByTestId('execution-monitor-project-select')).toHaveCount(0);
  await expect(projectSelect).toHaveValue('all');
  await expect(nameInput).toHaveValue('');
  await expect(page.locator('.monitor-run-item')).toHaveCount(2);
  await expect(page.locator('.monitor-stats .stat-tile').filter({ hasText: '最近执行' })).toContainText('2');
  await expect(page.locator('.monitor-stats .stat-tile').filter({ hasText: '通过率' })).toContainText('75%');

  await projectSelect.selectOption(projectOne.id);
  await queryForm.getByRole('button', { name: '查询' }).click();
  await expect(page.locator('.monitor-run-item')).toHaveCount(1);
  await expect(page.locator('.monitor-run-item')).toContainText(loginRun.name);
  await expect(page.locator('.monitor-detail-panel')).toContainText(`Run ID: ${loginRun.id}`);

  await nameInput.fill('  支付回归  ');
  await queryForm.getByRole('button', { name: '查询' }).click();
  await expect(monitorRegion).toContainText('暂无匹配的执行记录');
  await expect(page.locator('.monitor-stats .stat-tile').filter({ hasText: '最近执行' })).toContainText('0');

  await projectSelect.selectOption('all');
  await nameInput.press('Enter');
  await expect(page.locator('.monitor-run-item')).toHaveCount(1);
  await expect(page.locator('.monitor-run-item')).toContainText(paymentRun.name);
  await expect(page.locator('.monitor-detail-panel')).toContainText(`Run ID: ${paymentRun.id}`);
  await expect(nameInput).toHaveValue('支付回归');
  await page.waitForTimeout(250);
  const filteredRequestCount = listRequests.filter((item) => item.projectId === 'all' && item.suiteName === '支付回归').length;
  await expect.poll(() => listRequests.filter((item) => item.projectId === 'all' && item.suiteName === '支付回归').length, {
    timeout: 6500,
  }).toBeGreaterThan(filteredRequestCount);

  await queryForm.getByRole('button', { name: '重置' }).click();
  await expect(projectSelect).toHaveValue('all');
  await expect(nameInput).toHaveValue('');
  await expect(page.locator('.monitor-run-item')).toHaveCount(2);
  await expect(page.locator('.monitor-stats .stat-tile').filter({ hasText: '最近执行' })).toContainText('2');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(queryForm.getByRole('button', { name: '查询' })).toBeVisible();
  await expect(queryForm.getByRole('button', { name: '重置' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ))).toBeTruthy();
});

test('TC-PLAT-EXEC-REFRESH-001 全局当前项目为空时刷新仍展示全部项目的套件与执行数据', async ({ page }) => {
  const emptyProject = { id: 'proj-e2e-codex-refresh-empty', name: 'E2E-CODEX 空项目', status: 'active' };
  const targetProject = { id: 'proj-e2e-codex-refresh-target', name: 'E2E-CODEX 执行项目', status: 'active' };
  const targetSuite = {
    id: 'suite-e2e-codex-refresh-target',
    projectId: targetProject.id,
    name: 'E2E-CODEX 刷新恢复套件',
    description: '验证空项目作为全局当前项目时，测试执行模块仍展示全部项目数据。',
    status: 'active',
    caseIds: ['case-e2e-codex-refresh-target'],
    caseCount: 1,
    runConfig: { mode: 'serial', failurePolicy: 'continue', retryCount: 0, runFailedOnly: false },
    scheduleConfig: { enabled: false, frequency: 'off', time: '', weekday: '1', intervalMinutes: 60, timezone: 'Asia/Shanghai', note: '' },
    createdAt: '2026-07-14T01:00:00Z',
    updatedAt: '2026-07-14T01:00:00Z',
  };
  const targetRun = {
    id: 'suite-run-e2e-codex-refresh-target',
    suiteId: targetSuite.id,
    projectId: targetProject.id,
    name: targetSuite.name,
    status: 'passed',
    progress: 100,
    totalCases: 1,
    passedCases: 1,
    failedCases: 0,
    skippedCases: 0,
    startedAt: '2026-07-14T01:05:00Z',
    endedAt: '2026-07-14T01:06:00Z',
    reportPath: '',
    cases: [],
  };

  await page.addInitScript(({ projectId, suiteId, suiteRunId }) => {
    if (window.localStorage.getItem('qa-platform-e2e-refresh-seeded')) return;
    window.localStorage.setItem('qa-platform-e2e-refresh-seeded', 'true');
    window.localStorage.setItem('qa-platform-current-project', projectId);
    window.localStorage.setItem('qa-platform-active-module', 'test-suites');
    window.localStorage.setItem('qa-platform-open-module-tabs', JSON.stringify(['overview', 'test-suites']));
    window.localStorage.setItem('qa-platform-selected-suite', suiteId);
    window.localStorage.setItem('qa-platform-monitor-suite-run', suiteRunId);
  }, { projectId: emptyProject.id, suiteId: targetSuite.id, suiteRunId: targetRun.id });
  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [emptyProject, targetProject]);
  await mockJsonApi(page, '/api/work-items', []);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {
    totals: { projects: 2, workItems: 0, testCases: 1, suiteRuns: 1 },
    recentRuns: [targetRun],
  });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  for (const project of [emptyProject, targetProject]) {
    await mockJsonApi(page, `/api/test-cases?project_id=${project.id}`, []);
    await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [], tree: [] });
  }
  await mockJsonApi(page, `/api/test-suites?project_id=${emptyProject.id}`, []);
  await mockJsonApi(page, `/api/test-suites?project_id=${targetProject.id}`, [targetSuite]);
  await mockJsonApi(page, '/api/test-suites?project_id=all', [targetSuite]);
  await mockJsonApi(page, `/api/test-suites/${targetSuite.id}`, targetSuite);
  await mockJsonApi(page, `/api/suite-runs?project_id=${emptyProject.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${targetProject.id}`, [targetRun]);
  await mockJsonApi(page, '/api/suite-runs?project_id=all', [targetRun]);
  await mockJsonApi(page, `/api/suite-runs/${targetRun.id}`, targetRun);
  await mockJsonApi(page, `/api/suite-runs/${targetRun.id}/logs`, { items: [] });
  await mockJsonApi(page, '/api/automation-flows', []);
  let submittedSuiteId = '';
  await page.route(/\/api\/suite-runs$/, async (route) => {
    submittedSuiteId = route.request().postDataJSON().suite_id;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(targetRun) });
  });

  // 以无数据项目作为全局当前项目进入平台，测试套件应独立按全部项目加载。
  await page.goto(PLATFORM_URL);
  const suiteRegion = page.getByRole('region', { name: '测试套件' });
  await expect(suiteRegion).toBeVisible();
  await expect(page.getByTestId('test-suites-query-project')).toHaveValue('all');
  await expect(suiteRegion).toContainText(targetSuite.name);
  await expect(suiteRegion).not.toContainText('暂无测试套件');
  await expect(page.locator('.suite-detail-page')).toHaveCount(0);
  const suiteRow = page.locator('.suite-table-row').filter({ hasText: targetSuite.name });
  await expect(suiteRow.getByRole('button', { name: '执行套件' })).toBeEnabled();
  await suiteRow.getByRole('button', { name: '执行套件' }).click();
  await expect(page.getByRole('region', { name: '执行监控' })).toBeVisible();
  expect(submittedSuiteId).toBe(targetSuite.id);

  await gotoModule(page, '测试套件');
  await suiteRow.getByRole('button', { name: '查看详情' }).click();
  await expect(page).toHaveURL(new RegExp(`suiteView=detail.*suiteId=${targetSuite.id}`));
  await expect(page.locator('.suite-detail-page')).toContainText(targetSuite.description);
  await expect(page.locator('.suite-page-header')).not.toContainText(targetProject.name);
  await expect(page.locator('.suite-readonly-grid:not(.compact-grid)')).toContainText(targetProject.name);

  // 详情链接刷新后仍停留在独立详情页，并重新读取对应套件。
  await page.reload();
  await expect(page.locator('.suite-detail-page')).toContainText(targetSuite.name);

  // 执行套件后，执行监控按既有行为切换到该套件所属项目。
  await gotoModule(page, '执行监控');
  const monitorRegion = page.getByRole('region', { name: '执行监控' });
  await expect(monitorRegion).toBeVisible();
  await expect(page.getByTestId('execution-monitor-query-project')).toHaveValue(targetProject.id);
  await expect(monitorRegion).toContainText(targetRun.name);
  await expect(page.locator('.monitor-stats .stat-tile').filter({ hasText: '最近执行' })).toContainText('1');
  await expect(page.locator('.monitor-stats .stat-tile').filter({ hasText: '通过率' })).toContainText('100%');

  // 刷新后应恢复执行监控模块、所属项目范围以及此前选中的执行详情。
  await page.reload();
  await expect(page.getByRole('region', { name: '执行监控' })).toBeVisible();
  await expect(page.getByTestId('execution-monitor-query-project')).toHaveValue(targetProject.id);
  await expect(page.locator('.monitor-run-item.active')).toContainText(targetRun.name);
  await expect(page.locator('.monitor-detail-panel')).toContainText(`Run ID: ${targetRun.id}`);
  await expect(page.locator('.monitor-stats .stat-tile').filter({ hasText: '最近执行' })).toContainText('1');
  await expect(page.locator('.monitor-stats .stat-tile').filter({ hasText: '通过率' })).toContainText('100%');
});

test('TC-PLAT-SUITE-EDIT-001 编辑套件保存成功或失败均停留在编辑页', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-suite-edit', name: 'E2E-CODEX 套件编辑项目', status: 'active' };
  let persistedSuite = {
    id: 'suite-e2e-codex-edit-stay',
    projectId: project.id,
    name: 'E2E-CODEX 编辑停留套件',
    description: '保存前描述',
    status: 'active',
    caseIds: [],
    caseCount: 0,
    runConfig: { mode: 'serial', failurePolicy: 'continue', retryCount: 0, runFailedOnly: false },
    scheduleConfig: { enabled: false, frequency: 'off', time: '', weekday: '1', intervalMinutes: 60, timezone: 'Asia/Shanghai', note: '' },
    createdAt: '2026-07-28T01:00:00Z',
    updatedAt: '2026-07-28T01:00:00Z',
  };
  let patchAttempts = 0;
  let savedDescription = '';

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', []);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', { totals: {}, recentRuns: [] });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/test-cases?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [], tree: [] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, [persistedSuite]);
  await mockJsonApi(page, '/api/test-suites?project_id=all', [persistedSuite]);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/suite-runs?project_id=all', []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await page.route(new RegExp(`/api/test-suites/${persistedSuite.id}$`), async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(persistedSuite) });
      return;
    }
    patchAttempts += 1;
    if (patchAttempts === 2) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: '模拟保存失败' }) });
      return;
    }
    const payload = route.request().postDataJSON();
    savedDescription = payload.description;
    persistedSuite = { ...persistedSuite, description: payload.description, updatedAt: '2026-07-28T02:00:00Z' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(persistedSuite) });
  });
  await page.route(new RegExp(`/api/test-suites/${persistedSuite.id}/cases$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(persistedSuite) });
  });

  await page.goto(PLATFORM_URL);
  await gotoModule(page, '测试套件');
  const suiteRegion = page.getByRole('region', { name: '测试套件' });
  const suiteRow = suiteRegion.locator('.suite-table-row').filter({ hasText: persistedSuite.name });
  await suiteRow.getByRole('button', { name: '编辑套件' }).click();
  await expect(page).toHaveURL(new RegExp(`suiteView=edit.*suiteId=${persistedSuite.id}`));
  await expect(page.locator('.suite-page-header')).not.toContainText(project.name);

  const descriptionField = suiteRegion.getByLabel('描述');
  await descriptionField.fill('保存后继续停留编辑页');
  await suiteRegion.getByRole('button', { name: '保存套件' }).first().click();
  await expect(page.getByTestId('notice-banner')).toContainText(`套件已保存：${persistedSuite.name}`);
  await expect(page).toHaveURL(new RegExp(`suiteView=edit.*suiteId=${persistedSuite.id}`));
  await expect(page.locator('.suite-editor-page')).toBeVisible();
  await expect(page.locator('.suite-detail-page')).toHaveCount(0);
  expect(savedDescription).toBe('保存后继续停留编辑页');

  await descriptionField.fill('失败时保留的用户输入');
  await suiteRegion.getByRole('button', { name: '保存套件' }).first().click();
  await expect(page.getByTestId('error-banner')).toContainText('保存套件失败：模拟保存失败');
  await expect(page).toHaveURL(new RegExp(`suiteView=edit.*suiteId=${persistedSuite.id}`));
  await expect(descriptionField).toHaveValue('失败时保留的用户输入');

  await suiteRegion.getByRole('button', { name: '取消', exact: true }).first().click();
  await expect(descriptionField).toHaveValue('保存后继续停留编辑页');
  await expect(page.getByTestId('notice-banner')).toContainText('已取消修改内容');
  await expect(page.getByTestId('error-banner')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`suiteView=edit.*suiteId=${persistedSuite.id}`));
  await expect(page.locator('.suite-editor-page')).toBeVisible();
  await expect(page.locator('.suite-detail-page')).toHaveCount(0);

  await suiteRegion.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(page).toHaveURL(/suiteView=list/);
  await expect(page.getByRole('table', { name: '测试套件列表' })).toBeVisible();
  await expect(page.locator('.suite-editor-page')).toHaveCount(0);
});

test('TC-PLAT-EXEC-REPORT-001 用例明细按单次 Run 打开独立报告并保留选中状态', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-case-report', name: 'E2E-CODEX 单用例报告项目', status: 'active' };
  const suiteRun = {
    id: 'suite-run-e2e-codex-case-report',
    suiteId: 'suite-e2e-codex-case-report',
    projectId: project.id,
    name: 'E2E-CODEX 单用例报告套件',
    status: 'running',
    progress: 75,
    totalCases: 4,
    passedCases: 1,
    failedCases: 1,
    skippedCases: 0,
    startedAt: '2026-07-23T01:00:00Z',
    endedAt: null,
    reportPath: '',
    cases: [
      {
        id: 1,
        caseId: 'case-e2e-codex-report-running',
        runId: 'run-e2e-codex-report-running',
        status: 'running',
        startedAt: '2026-07-23T01:00:00Z',
        endedAt: null,
        error: '',
        case: { externalId: 'TC-CODEX-REPORT-001', title: '执行中的单用例报告' },
      },
      {
        id: 2,
        caseId: 'case-e2e-codex-report-passed',
        runId: 'run-e2e-codex-report-passed',
        status: 'passed',
        startedAt: '2026-07-23T01:00:00Z',
        endedAt: '2026-07-23T01:00:15Z',
        error: '',
        case: { externalId: 'TC-CODEX-REPORT-002', title: '已通过的单用例报告' },
      },
      {
        id: 3,
        caseId: 'case-e2e-codex-report-failed',
        runId: 'run-e2e-codex-report-failed',
        status: 'failed',
        startedAt: '2026-07-23T01:00:15Z',
        endedAt: '2026-07-23T01:00:30Z',
        error: '详见单用例执行日志和 HTML report',
        case: { externalId: 'TC-CODEX-REPORT-003', title: '失败的单用例报告' },
      },
      {
        id: 4,
        caseId: 'case-e2e-codex-report-queued',
        runId: '',
        status: 'queued',
        startedAt: null,
        endedAt: null,
        error: '',
        case: { externalId: 'TC-CODEX-REPORT-004', title: '等待分配 Run 的用例' },
      },
    ],
  };

  await page.addInitScript(({ suiteRunId }) => {
    window.localStorage.setItem('qa-platform-active-module', 'execution-monitor');
    window.localStorage.setItem('qa-platform-open-module-tabs', JSON.stringify(['overview', 'execution-monitor']));
    window.localStorage.setItem('qa-platform-test-execution-project', 'all');
    window.localStorage.setItem('qa-platform-monitor-suite-run', suiteRunId);
  }, { suiteRunId: suiteRun.id });
  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', []);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {});
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/test-cases?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [], tree: [] });
  await mockJsonApi(page, '/api/test-suites?project_id=all', []);
  await mockJsonApi(page, '/api/suite-runs?project_id=all', [suiteRun]);
  await mockJsonApi(page, `/api/suite-runs/${suiteRun.id}`, suiteRun);
  await mockJsonApi(page, `/api/suite-runs/${suiteRun.id}/logs`, { items: [] });
  for (const item of suiteRun.cases.filter((caseItem) => caseItem.runId)) {
    await mockJsonApi(page, `/api/runs/${item.runId}`, {
      id: item.runId,
      status: item.status,
      progress: item.status === 'running' ? 60 : 100,
      stage: { key: 'execute', label: '运行验证' },
      browserSessionId: '',
      browserSession: null,
    });
  }
  await page.context().route('**/reports/playwright/runs/*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>单用例报告</title>' });
  });
  await mockJsonApi(page, '/api/automation-flows', []);

  await page.goto(PLATFORM_URL);
  const monitorRegion = page.getByRole('region', { name: '执行监控' });
  await expect(monitorRegion).toBeVisible();

  const suiteReport = monitorRegion.getByRole('link', { name: /Playwright HTML Report/ });
  await expect(suiteReport).toHaveAttribute('href', new RegExp(`/reports/playwright/suite-runs/${suiteRun.id}$`));
  await expect(suiteReport).toHaveAttribute('target', '_blank');

  for (const item of suiteRun.cases.filter((caseItem) => caseItem.runId)) {
    const reportLink = monitorRegion.getByRole('link', {
      name: `查看单用例报告 ${item.case.externalId} · ${item.case.title}`,
    });
    await expect(reportLink).toHaveAttribute('href', new RegExp(`/reports/playwright/runs/${item.runId}$`));
    await expect(reportLink).toHaveAttribute('target', '_blank');
    await expect(reportLink).toContainText('查看报告');
  }

  const runningReportLink = page.getByTestId('execution-monitor-case-report-run-e2e-codex-report-running');
  const popupPromise = page.waitForEvent('popup');
  await runningReportLink.click();
  const reportPage = await popupPromise;
  await expect(reportPage).toHaveURL(new RegExp(`/reports/playwright/runs/run-e2e-codex-report-running$`));
  await reportPage.close();
  await expect(runningReportLink).toHaveClass(/selected/);
  await expect(runningReportLink).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('execution-monitor-browser-preview')).toContainText('TC-CODEX-REPORT-001');

  const queuedCase = monitorRegion.getByLabel('TC-CODEX-REPORT-004 · 等待分配 Run 的用例，等待分配单用例 Run');
  await expect(queuedCase).toHaveAttribute('aria-disabled', 'true');
  await expect(queuedCase).toContainText('等待分配单用例 run');
  await expect(queuedCase.getByRole('link')).toHaveCount(0);
});

test('TC-PLAT-001G 总览趋势图悬浮展示时间点汇总', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-trend-tooltip', name: 'E2E-CODEX 趋势项目', status: 'active' };

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', []);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {
    totals: {
      testCases: 7,
      workItems: 0,
      passedExecutions: 6,
      failedExecutions: 2,
      executedCases: 8,
      successRate: 75,
    },
    resultDistribution: { passed: 6, failed: 2, skipped: 0 },
    priorityDistribution: [],
    stageDistribution: [],
    trend: [
      { date: '2026-07-01', label: '07-01', total: 1, passed: 1, failed: 0 },
      { date: '2026-07-02', label: '07-02', total: 7, passed: 5, failed: 2 },
      { date: '2026-07-03', label: '07-03', total: 0, passed: 0, failed: 0 },
    ],
    failureHotspots: [],
    recentRuns: [],
  });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [], tree: [] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);

  await page.goto(PLATFORM_URL);
  const dashboard = page.getByTestId('overview-dashboard');
  await expect(dashboard).toContainText('测试执行趋势');
  await expect(dashboard.locator('.trend-legend')).toContainText('通过');
  await expect(dashboard.locator('.trend-legend')).toContainText('失败');
  await expect(dashboard.locator('.trend-legend')).toContainText('总计');

  await dashboard.locator('.trend-hit-area').nth(1).hover();
  const tooltip = page.getByTestId('trend-tooltip');
  await expect(tooltip).toContainText('2026-07-02');
  await expect(tooltip).toContainText('总计 7');
  await expect(tooltip).toContainText('通过 5');
  await expect(tooltip).toContainText('失败 2');
});

async function saveCases(page) {
  // 保存可追溯测试用例，作为页面探索的前置输入。
  await gotoModule(page, '用例设计');
  await page.locator('textarea.editor.markdown').fill(CASES_MARKDOWN);
  await page.getByRole('button', { name: /^保存修改$/ }).click();
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
  await page.getByRole('button', { name: /^保存修改$/ }).click();
  await expect(page.getByRole('region', { name: '执行测试' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('workflow-context-bar')).toContainText('运行验证', { timeout: 10_000 });
}

test('TC-PLAT-009A 一键流程测试用例预览展示全部行和完整表头', async ({ page }) => {
  const project = {
    id: 'proj-e2e-codex-preview',
    projectCode: 'PRJ-E2E-CODEX-PREVIEW',
    name: 'E2E-CODEX-preview 项目',
    projectType: 'product',
    status: 'active',
  };
  const feature = {
    id: 'feature-e2e-codex-preview',
    projectId: project.id,
    name: 'E2E-CODEX-preview 功能',
    path: 'E2E-CODEX-preview 功能',
    isActive: true,
  };
  const workItem = {
    id: 'work-e2e-codex-preview',
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX-preview 测试用例预览',
    requirement: '验证交付物测试用例预览展示全部字段和全部行。',
    casesMarkdown: PREVIEW_CASES_MARKDOWN,
    scriptContent: '',
    assetMode: 'create',
  };
  const flow = {
    id: 'flow-e2e-codex-preview',
    flowRunId: 'flow-e2e-codex-preview',
    projectId: project.id,
    featureId: feature.id,
    featureName: feature.name,
    featurePath: feature.path,
    workItemId: workItem.id,
    workItem,
    status: 'completed',
    stage: '保存已验证产物',
    progress: 100,
    startedAt: '2026-06-27T00:00:00Z',
    updatedAt: '2026-06-27T00:01:00Z',
    logs: [
      {
        id: 1,
        flowRunId: 'flow-e2e-codex-preview',
        stage: '用例设计',
        level: 'success',
        message: '已保存可追溯测试用例',
        evidencePath: '',
        createdAt: '2026-06-27T00:00:30Z',
      },
    ],
    flowArtifacts: [
      {
        id: 'artifact-e2e-codex-preview-cases',
        flowRunId: 'flow-e2e-codex-preview',
        workItemId: workItem.id,
        stage: '用例设计',
        artifactType: 'test-cases',
        title: '可追溯测试用例',
        content: PREVIEW_CASES_MARKDOWN,
        status: 'ready',
        source: 'mock',
        path: '',
        createdAt: '2026-06-27T00:00:30Z',
        updatedAt: '2026-06-27T00:00:30Z',
      },
    ],
  };

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await mockJsonApi(page, `/api/work-items/${workItem.id}`, workItem);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {
    totals: { projects: 1, workItems: 1, testCases: 6, suiteRuns: 0 },
    quality: { passRate: 0, failedCases: 0, automationCoverage: 0 },
    trends: [],
    recentWorkItems: [],
  });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', [flow]);
  await mockJsonApi(page, `/api/automation-flows/${flow.id}`, flow);

  await page.goto(PLATFORM_URL);
  await expect(page.getByRole('navigation', { name: '平台模块' })).toBeVisible();
  await gotoModule(page, '一键自动化');
  await page.getByRole('button', { name: /历史记录/ }).click();
  await page.getByTestId('automation-flow-history-item').filter({ hasText: workItem.title }).click();
  await page.getByRole('button', { name: /^交付物$/ }).click();

  const artifactPreview = page.getByTestId('automation-flow-artifact-preview');
  await expect(artifactPreview.getByRole('heading', { name: '测试用例预览（共 6 条）' })).toBeVisible();
  for (const header of ['ID', '优先级', '标题', '覆盖需求', '前置条件/测试数据', '步骤', '期望结果', '自动化说明']) {
    await expect(artifactPreview.getByRole('columnheader', { name: header })).toBeVisible();
  }
  await expect(artifactPreview).toContainText('TC-CODEX-PREVIEW-001');
  await expect(artifactPreview).toContainText('TC-CODEX-PREVIEW-006');
  await expect(artifactPreview).toContainText('取消结账返回购物车');
  await expect(page.getByTestId('artifact-test-cases')).toContainText('TC-CODEX-PREVIEW-006');
});

test('TC-PLAT-004A 人工用例和脚本区分自动生成与保存修改', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-manual', name: 'E2E-CODEX-manual 项目', status: 'active' };
  const feature = { id: 'feature-e2e-codex-manual', projectId: project.id, name: 'E2E-CODEX-manual 功能', path: 'E2E-CODEX-manual 功能', isActive: true };
  const workItem = {
    id: 'work-e2e-codex-manual',
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX-manual 人工阶段对齐',
    requirement: '验证人工工作台自动生成与保存修改使用不同请求内容。',
    stage: '用例设计',
    status: 'draft',
    casesMarkdown: '',
    scriptContent: '',
    assetMode: 'create',
    caseIds: [],
  };
  const submittedBodies: Array<{ content?: string }> = [];
  const submittedScriptBodies: Array<{ content?: string }> = [];
  const fallbackScript = `${SCRIPT_CONTENT}\n// fallback-stream-content`;
  const generatedCases = [
    { id: 'case-e2e-codex-manual-001', externalId: 'TC-DEMO-001', title: '登录页关键元素可见', priority: 'P0' },
    { id: 'case-e2e-codex-manual-002', externalId: 'TC-DEMO-002', title: '错误登录展示提示', priority: 'P1' },
  ];
  const fallbackScriptVersion = {
    id: '',
    caseId: generatedCases[0].id,
    case: generatedCases[0],
    version: 1,
    status: 'draft',
    specPath: 'tests/e2e/.draft-runs/manual/fallback.spec.ts',
    content: fallbackScript,
  };

  await page.addInitScript(({ targetWorkItem, casesContent, scriptContent, cases, scriptVersion }) => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    (window as any).__manualStreamRequests = [];
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const streamResponse = (events: unknown[], delay = 350) => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify(events[0])}\n`));
          controller.enqueue(encoder.encode(`${JSON.stringify(events[1])}\n`));
          window.setTimeout(() => {
            for (const event of events.slice(2)) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            controller.close();
          }, delay);
        },
      }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
      if (url.endsWith(`/api/work-items/${targetWorkItem.id}/generate-cases/stream`)) {
        (window as any).__manualStreamRequests.push({ type: 'cases', body: JSON.parse(String(init?.body || '{}')) });
        const splitAt = Math.floor(casesContent.length / 2);
        return streamResponse([
          { type: 'start', stage: 'cases', source: 'ai', model: 'mock-stream-model' },
          { type: 'delta', stage: 'cases', delta: casesContent.slice(0, splitAt) },
          { type: 'delta', stage: 'cases', delta: casesContent.slice(splitAt) },
          { type: 'complete', stage: 'cases', source: 'ai', content: casesContent, item: { ...targetWorkItem, stage: '页面探索', status: 'cases-ready', casesMarkdown: casesContent, caseIds: cases.map((caseItem) => caseItem.id), testCases: cases } },
        ]);
      }
      if (url.endsWith(`/api/work-items/${targetWorkItem.id}/generate-script/stream`)) {
        (window as any).__manualStreamRequests.push({ type: 'script', body: JSON.parse(String(init?.body || '{}')) });
        return streamResponse([
          { type: 'start', stage: 'script', source: 'ai', model: 'mock-stream-model' },
          { type: 'delta', stage: 'script', delta: 'partial invalid script' },
          { type: 'fallback', stage: 'script', caseId: cases[0].id, source: 'fallback', reason: 'AI 返回脚本格式校验失败', content: scriptContent },
          { type: 'case-complete', stage: 'script', caseId: cases[0].id, externalId: cases[0].externalId, index: 1, total: 2, source: 'fallback', scriptVersion },
          { type: 'complete', stage: 'script', source: 'fallback', reason: 'AI 返回脚本格式校验失败', successfulCaseIds: [cases[0].id], failedCases: [], content: scriptContent, item: { ...targetWorkItem, stage: '运行验证', status: 'script-ready', casesMarkdown: casesContent, caseIds: cases.map((caseItem) => caseItem.id), testCases: cases, scriptContent, scriptVersions: [scriptVersion], scriptSet: { status: 'partial', scriptVersions: [scriptVersion] } } },
        ]);
      }
      return originalFetch(input, init);
    };
  }, { targetWorkItem: workItem, casesContent: CASES_MARKDOWN, scriptContent: fallbackScript, cases: generatedCases, scriptVersion: fallbackScriptVersion });

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await mockJsonApi(page, `/api/work-items/${workItem.id}`, workItem);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', { totals: {}, quality: {}, trends: [], recentWorkItems: [] });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await page.route(`**/api/work-items/${workItem.id}/generate-cases`, async (route) => {
    const body = route.request().postDataJSON() as { content?: string };
    submittedBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...workItem,
        stage: '页面探索',
        status: 'cases-ready',
        casesMarkdown: body.content || CASES_MARKDOWN,
        caseIds: generatedCases.map((caseItem) => caseItem.id),
        testCases: generatedCases,
      }),
    });
  });
  await page.route(`**/api/work-items/${workItem.id}/generate-script`, async (route) => {
    const body = route.request().postDataJSON() as { content?: string };
    submittedScriptBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...workItem,
        stage: '运行验证',
        status: 'script-ready',
        casesMarkdown: CASES_MARKDOWN,
        caseIds: generatedCases.map((caseItem) => caseItem.id),
        testCases: generatedCases,
        scriptContent: body.content || SCRIPT_CONTENT,
      }),
    });
  });

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '用例设计');
  await expect(page.getByTestId('case-structured-editor')).toBeVisible();
  await page.getByRole('tab', { name: 'Markdown 源码' }).click();
  await expect(page.getByTestId('case-markdown-editor')).toBeVisible();
  const autoGenerate = page.getByRole('button', { name: /^自动生成$/ });
  await autoGenerate.click();
  await expect(page.getByRole('button', { name: /^生成中/ })).toBeDisabled();
  await expect(page.locator('textarea.editor.markdown')).toHaveValue(/TC-DEMO-001/, { timeout: 250 });
  await expect(page.getByTestId('notice-banner')).toContainText('大模型测试用例已流式生成并保存');
  await expect(page.getByRole('region', { name: '用例设计' })).toBeVisible();
  await expect(page.getByTestId('workflow-context-bar')).toContainText('用例设计');
  await expect(page.getByRole('button', { name: /^进入探索实验室$/ })).toHaveCount(0);
  await gotoModule(page, '探索实验室');
  await expect(page.getByRole('region', { name: '探索实验室' })).toBeVisible();
  const streamRequests = await page.evaluate(() => (window as any).__manualStreamRequests);
  expect(streamRequests[0]).toMatchObject({ type: 'cases', body: { content: '' } });

  await gotoModule(page, '用例设计');
  const renderedCases = page.getByTestId('case-markdown-preview');
  await expect(renderedCases).toBeVisible();
  await expect(renderedCases.getByRole('columnheader', { name: 'ID' })).toBeVisible();
  await expect(renderedCases).toContainText('TC-DEMO-001');
  await expect(renderedCases).not.toContainText('| --- |');
  await page.getByRole('tab', { name: 'Markdown 源码' }).click();
  await expect(page.getByTestId('case-markdown-editor')).toHaveValue(CASES_MARKDOWN);
  const manualCases = CASES_MARKDOWN.replace('TC-DEMO-001', 'TC-CODEX-MANUAL-001');
  await page.getByTestId('case-markdown-editor').fill(manualCases);
  await page.getByRole('button', { name: /^保存修改$/ }).click();
  await expect(page.getByTestId('notice-banner')).toContainText('人工修改的测试用例已保存');
  await expect(page.getByRole('region', { name: '探索实验室' })).toBeVisible();
  await expect(page.getByTestId('workflow-context-bar')).toContainText('页面探索');
  expect(submittedBodies[0].content).toBe(manualCases);

  await gotoModule(page, '脚本工作台');
  await page.getByRole('button', { name: /^自动生成$/ }).click();
  await expect(page.locator('textarea.editor.code')).toHaveValue('partial invalid script', { timeout: 250 });
  await expect(page.getByTestId('notice-banner')).toContainText('使用规则兜底');
  const scriptStreamRequests = await page.evaluate(() => (window as any).__manualStreamRequests);
  expect(scriptStreamRequests[1]).toMatchObject({ type: 'script', body: { content: '' } });

  await gotoModule(page, '脚本工作台');
  await expect(page.locator('textarea.editor.code')).toHaveValue(fallbackScript);
  await page.locator('textarea.editor.code').fill(SCRIPT_CONTENT);
  await page.getByRole('button', { name: /^保存修改$/ }).click();
  await expect(page.getByRole('region', { name: '执行测试' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('notice-banner')).toContainText('人工修改的草稿脚本已保存');
  expect(submittedScriptBodies[0].content).toBe(SCRIPT_CONTENT);
});

test('TC-PLAT-006A 脚本工作台逐用例流式生成并重试失败用例', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-script-queue', name: 'E2E-CODEX 脚本队列项目', status: 'active' };
  const feature = { id: 'feature-e2e-codex-script-queue', projectId: project.id, name: 'E2E-CODEX 脚本队列功能', path: 'E2E-CODEX 脚本队列功能', isActive: true };
  const testCases = [
    { id: 'case-e2e-codex-script-001', externalId: 'TC-CODEX-QUEUE-001', title: '已有脚本用例', priority: 'P0' },
    { id: 'case-e2e-codex-script-002', externalId: 'TC-CODEX-QUEUE-002', title: '流式生成用例', priority: 'P1' },
    { id: 'case-e2e-codex-script-003', externalId: 'TC-CODEX-QUEUE-003', title: '失败后重试用例', priority: 'P2' },
  ];
  const longStreamTail = Array.from({ length: 48 }, (_, index) => `// streamed line ${String(index + 1).padStart(2, '0')}`).join('\n');
  const fixtureVersion = {
    id: 'fixture-e2e-codex-script',
    version: 1,
    content: `export const TARGET_URL = 'https://example.test';\n${longStreamTail}`,
  };
  const existingScript = `${SCRIPT_CONTENT}\n// existing case\n${longStreamTail}`;
  const existingVersion = {
    id: 'script-e2e-codex-script-001',
    caseId: testCases[0].id,
    case: testCases[0],
    version: 1,
    status: 'draft',
    specPath: 'tests/e2e/.draft-runs/queue/case-001.spec.ts',
    content: existingScript,
  };
  const secondChunkOne = `${SCRIPT_CONTENT.replaceAll('TC-DEMO-001', testCases[1].externalId)}\n// second chunk one\n${longStreamTail}`;
  const secondChunkTwo = `\n// second chunk two\n${longStreamTail}`;
  const secondScript = `${secondChunkOne}${secondChunkTwo}\n// persisted case two`;
  const secondVersion = {
    id: 'script-e2e-codex-script-002',
    caseId: testCases[1].id,
    case: testCases[1],
    version: 1,
    status: 'draft',
    specPath: 'tests/e2e/.draft-runs/queue/case-002.spec.ts',
    content: secondScript,
  };
  const thirdChunkOne = `${SCRIPT_CONTENT.replaceAll('TC-DEMO-001', testCases[2].externalId)}\n// third chunk one\n${longStreamTail}`;
  const thirdChunkTwo = `\n// third chunk two\n${longStreamTail}`;
  const thirdScript = `${thirdChunkOne}${thirdChunkTwo}\n// retried persisted case three`;
  const thirdVersion = {
    id: 'script-e2e-codex-script-003',
    caseId: testCases[2].id,
    case: testCases[2],
    version: 1,
    status: 'draft',
    specPath: 'tests/e2e/.draft-runs/queue/case-003.spec.ts',
    content: thirdScript,
  };
  const workItem = {
    id: 'work-e2e-codex-script-queue',
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX 脚本逐条生成',
    requirement: '验证脚本工作台逐条生成、自动切换和失败重试。',
    stage: '脚本实现',
    status: 'explored',
    casesMarkdown: CASES_MARKDOWN,
    assetMode: 'create',
    caseIds: testCases.map((caseItem) => caseItem.id),
    testCases,
    fixtureVersion,
    scriptVersions: [existingVersion],
    scriptSet: { generationBatchId: 'batch-e2e-codex-script', status: 'partial', fixtureVersion, scriptVersions: [existingVersion] },
    scriptContent: existingVersion.content,
  };
  const clearedWorkItem = {
    ...workItem,
    stage: '脚本实现',
    status: 'explored',
    fixtureVersion: null,
    scriptVersions: [],
    scriptSet: { generationBatchId: '', status: 'empty', fixtureVersion: null, scriptVersions: [] },
    scriptContent: '',
  };
  let clearRequest: { page?: string } | null = null;
  let workItemCleared = false;

  await page.addInitScript(({ targetWorkItem, cases, existing, second, third, secondParts, thirdParts }) => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    (window as any).__scriptQueueRequests = [];
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.endsWith(`/api/work-items/${targetWorkItem.id}/generate-script/stream`)) return originalFetch(input, init);
      const body = JSON.parse(String(init?.body || '{}'));
      (window as any).__scriptQueueRequests.push(body);
      const retrying = body.case_ids?.length === 1 && body.case_ids[0] === cases[2].id;
      const events = retrying
        ? [
          { type: 'start', stage: 'script', total: 1, caseIds: [cases[2].id] },
          { type: 'case-start', stage: 'script', caseId: cases[2].id, externalId: cases[2].externalId, index: 1, total: 1 },
          { type: 'delta', stage: 'script', caseId: cases[2].id, delta: thirdParts[0] },
          { type: 'delta', stage: 'script', caseId: cases[2].id, delta: thirdParts[1] },
          [
            { type: 'case-complete', stage: 'script', caseId: cases[2].id, externalId: cases[2].externalId, index: 1, total: 1, scriptVersion: third },
            { type: 'complete', stage: 'script', source: 'ai', successfulCaseIds: [cases[2].id], failedCases: [], item: { ...targetWorkItem, status: 'script-ready', stage: '运行验证', scriptVersions: [existing, second, third], scriptSet: { ...targetWorkItem.scriptSet, status: 'ready', scriptVersions: [existing, second, third] } } },
          ],
        ]
        : [
          { type: 'start', stage: 'script', total: 2, caseIds: [cases[1].id, cases[2].id] },
          { type: 'case-start', stage: 'script', caseId: cases[1].id, externalId: cases[1].externalId, index: 1, total: 2 },
          { type: 'delta', stage: 'script', caseId: cases[1].id, delta: secondParts[0] },
          { type: 'delta', stage: 'script', caseId: cases[1].id, delta: secondParts[1] },
          { type: 'case-complete', stage: 'script', caseId: cases[1].id, externalId: cases[1].externalId, index: 1, total: 2, scriptVersion: second },
          { type: 'case-start', stage: 'script', caseId: cases[2].id, externalId: cases[2].externalId, index: 2, total: 2 },
          { type: 'delta', stage: 'script', caseId: cases[2].id, delta: thirdParts[0] },
          { type: 'delta', stage: 'script', caseId: cases[2].id, delta: thirdParts[1] },
          { type: 'case-error', stage: 'script', caseId: cases[2].id, externalId: cases[2].externalId, index: 2, total: 2, message: '脚本校验失败' },
          { type: 'complete', stage: 'script', source: 'ai', successfulCaseIds: [cases[1].id], failedCases: [{ caseId: cases[2].id, externalId: cases[2].externalId, error: '脚本校验失败' }], item: { ...targetWorkItem, status: 'script-ready', stage: '运行验证', scriptVersions: [existing, second], scriptSet: { ...targetWorkItem.scriptSet, status: 'partial', scriptVersions: [existing, second] } } },
        ];
      return new Response(new ReadableStream({
        start(controller) {
          let eventIndex = 0;
          const pushNext = () => {
            const eventBatch = Array.isArray(events[eventIndex]) ? events[eventIndex] : [events[eventIndex]];
            controller.enqueue(encoder.encode(`${eventBatch.map((event) => JSON.stringify(event)).join('\n')}\n`));
            eventIndex += 1;
            if (eventIndex >= events.length) {
              controller.close();
              return;
            }
            window.setTimeout(pushNext, 300);
          };
          pushNext();
        },
      }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  }, {
    targetWorkItem: workItem,
    cases: testCases,
    existing: existingVersion,
    second: secondVersion,
    third: thirdVersion,
    secondParts: [secondChunkOne, secondChunkTwo],
    thirdParts: [thirdChunkOne, thirdChunkTwo],
  });

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: true } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await page.route(`**/api/work-items/${workItem.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(workItemCleared ? clearedWorkItem : workItem),
    });
  });
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', { totals: {}, quality: {}, trends: [], recentWorkItems: [] });
  await mockJsonApi(page, '/api/test-cases?project_id=all', testCases);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await page.route(`**/api/work-items/${workItem.id}/clear-page-data`, async (route) => {
    clearRequest = route.request().postDataJSON() as { page?: string };
    workItemCleared = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'cleared', page: 'scripts', deleted: { generatedScripts: 3, scriptVersions: 3, scriptBatches: 1 }, item: clearedWorkItem }),
    });
  });

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '脚本工作台');
  const workbench = page.getByRole('region', { name: '脚本工作台' });
  await expect(workbench.getByRole('navigation', { name: '测试用例脚本列表' })).toContainText(testCases[0].externalId);
  await expect(workbench.getByRole('navigation', { name: '测试用例脚本列表' })).toContainText(testCases[2].externalId);
  await expect(workbench.locator('.script-case-nav-item.active')).toContainText(testCases[0].externalId);
  await expect(workbench.getByText('1/3 份独立 spec')).toBeVisible();

  const scriptEditor = workbench.locator('textarea.script-unit-editor');
  const expectEditorAtBottom = async () => {
    await expect.poll(
      () => scriptEditor.evaluate((editor) => editor.scrollTop + editor.clientHeight >= editor.scrollHeight - 2),
      { timeout: 1_000 },
    ).toBeTruthy();
  };

  // 启动缺失脚本的顺序生成，并确认第一条待生成用例被自动选中。
  await workbench.getByRole('button', { name: '自动生成' }).click();
  await expect(workbench.locator('.script-case-nav-item.active')).toContainText(testCases[1].externalId, { timeout: 2_000 });

  // 第一段长脚本到达后，编辑器应立即跟随到当前内容底部。
  await expect(scriptEditor).toHaveValue(/second chunk one/, { timeout: 2_000 });
  await expectEditorAtBottom();

  // 用户在生成期间手动上滚后，当前增量到达前应能停留在顶部。
  await scriptEditor.evaluate((editor) => { editor.scrollTop = 0; });
  await expect.poll(() => scriptEditor.evaluate((editor) => editor.scrollTop)).toBe(0);

  // 下一段增量到达后，编辑器必须重新回到底部展示最新生成内容。
  await expect(scriptEditor).toHaveValue(/second chunk two/, { timeout: 2_000 });
  await expectEditorAtBottom();

  // 最终持久化脚本替换流式草稿时也必须保持跟随，避免最后一帧停在旧位置。
  await scriptEditor.evaluate((editor) => { editor.scrollTop = 0; });
  await expect(scriptEditor).toHaveValue(/persisted case two/, { timeout: 2_000 });
  await expectEditorAtBottom();

  // 自动切换到下一用例后，新用例的每个流式增量仍应独立跟随到底部。
  await expect(workbench.locator('.script-case-nav-item.active')).toContainText(testCases[2].externalId, { timeout: 3_000 });
  await expect(scriptEditor).toHaveValue(/third chunk one/, { timeout: 2_000 });
  await expectEditorAtBottom();
  await scriptEditor.evaluate((editor) => { editor.scrollTop = 0; });
  await expect(scriptEditor).toHaveValue(/third chunk two/, { timeout: 2_000 });
  await expectEditorAtBottom();

  // 当前用例校验失败后应结束本轮并提供定向重试入口。
  await expect(workbench.getByRole('button', { name: /重试失败（1）/ })).toBeVisible({ timeout: 3_000 });
  await expect(workbench.getByText('2/3 份独立 spec')).toBeVisible();

  let requests = await page.evaluate(() => (window as any).__scriptQueueRequests);
  expect(requests[0].case_ids).toEqual([testCases[1].id, testCases[2].id]);

  // 重试失败用例时仍应自动切换并跟随重新生成的长脚本。
  await workbench.getByRole('button', { name: /重试失败（1）/ }).click();
  await expect(workbench.locator('.script-case-nav-item.active')).toContainText(testCases[2].externalId, { timeout: 2_000 });
  await expect(scriptEditor).toHaveValue(/third chunk one/, { timeout: 2_000 });
  await expectEditorAtBottom();
  await scriptEditor.evaluate((editor) => { editor.scrollTop = 0; });
  await expect(scriptEditor).toHaveValue(/third chunk two/, { timeout: 2_000 });
  await expectEditorAtBottom();
  await expect(scriptEditor).toHaveValue(/retried persisted case three/, { timeout: 2_000 });
  await expectEditorAtBottom();
  await expect(workbench.getByText('3/3 份独立 spec')).toBeVisible({ timeout: 3_000 });
  await expect(workbench.getByRole('button', { name: /重试失败/ })).toHaveCount(0);
  requests = await page.evaluate(() => (window as any).__scriptQueueRequests);
  expect(requests[1].case_ids).toEqual([testCases[2].id]);

  // 生成结束后取消强制跟随，用户手动上滚应在后续动画帧保持不变。
  await scriptEditor.evaluate((editor) => { editor.scrollTop = 0; });
  await scriptEditor.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => scriptEditor.evaluate((editor) => editor.scrollTop)).toBe(0);

  // 查看已有脚本时不应触发生成期滚动逻辑。
  await workbench.getByRole('button', { name: new RegExp(`^${testCases[0].externalId}`) }).click();
  await expect(scriptEditor).toHaveValue(/existing case/);
  await scriptEditor.evaluate((editor) => { editor.scrollTop = 0; });
  await scriptEditor.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => scriptEditor.evaluate((editor) => editor.scrollTop)).toBe(0);

  // 切换共享 Fixture 后同样允许用户正常浏览，不会被拉到底部。
  await workbench.getByRole('button', { name: '共享 Fixture' }).click();
  await expect(scriptEditor).toHaveValue(/TARGET_URL/);
  await scriptEditor.evaluate((editor) => { editor.scrollTop = 0; });
  await scriptEditor.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => scriptEditor.evaluate((editor) => editor.scrollTop)).toBe(0);

  // 回到用例脚本后清理本测试 mock 的页面数据，验证原有清理入口不受影响。
  await workbench.getByRole('button', { name: '用例脚本' }).click();

  page.once('dialog', (dialog) => dialog.accept());
  await workbench.getByRole('button', { name: '一键清空' }).click();
  await expect(workbench.getByText('0/3 份独立 spec')).toBeVisible();
  await expect(workbench.locator('textarea.script-unit-editor')).toHaveValue('');
  await expect(workbench.getByText('待生成')).toHaveCount(3);
  await expect(workbench.getByRole('button', { name: '自动生成' })).toBeEnabled();
  expect(clearRequest).toEqual({ page: 'scripts' });
});

test('TC-PLAT-004B 只读用户在移动端查看 Markdown 用例预览', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-markdown-viewer', name: 'E2E-CODEX-markdown-viewer 项目', status: 'active' };
  const feature = { id: 'feature-e2e-codex-markdown-viewer', projectId: project.id, name: 'E2E-CODEX-markdown-viewer 功能', path: 'E2E-CODEX-markdown-viewer 功能', isActive: true };
  const workItem = {
    id: 'work-e2e-codex-markdown-viewer',
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX-markdown-viewer Markdown 预览',
    requirement: '验证只读用户可以在移动端查看渲染后的测试用例。',
    stage: '页面探索',
    status: 'cases-ready',
    casesMarkdown: `${CASES_MARKDOWN}\n\n<div data-unsafe-markdown>unsafe html</div>`,
    scriptContent: '',
    assetMode: 'create',
    caseIds: [],
  };

  await page.setViewportSize({ width: 375, height: 812 });
  await mockFallbackApi(page);
  await mockSuccessfulAuth(page, 'viewer');
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await mockJsonApi(page, `/api/work-items/${workItem.id}`, workItem);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', { totals: {}, quality: {}, trends: [], recentWorkItems: [] });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '用例设计');

  const renderedCases = page.getByTestId('case-markdown-preview');
  await expect(renderedCases).toBeVisible();
  await expect(renderedCases).toContainText('TC-DEMO-002');
  await expect(renderedCases.locator('[data-unsafe-markdown]')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '表格编辑' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Markdown 源码' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^保存修改$/ })).toBeDisabled();
  await expect(page.getByTestId('case-markdown-editor')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await expect.poll(() => renderedCases.locator('.case-markdown-table-wrap').evaluate((element) => element.scrollWidth > element.clientWidth)).toBeTruthy();
});

test('TC-PLAT-004C 表格编辑支持抽屉编辑、新增、删除撤销和保存删除', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-structured', name: 'E2E-CODEX-structured 项目', status: 'active' };
  const feature = { id: 'feature-e2e-codex-structured', projectId: project.id, name: 'E2E-CODEX-structured 功能', path: 'E2E-CODEX-structured 功能', isActive: true };
  const structuredMarkdown = `# 登录测试用例\n\n${CASES_MARKDOWN}\n\n> E2E-CODEX-structured 保留说明`;
  const persistedCases = [
    { id: 'case-e2e-codex-structured-001', externalId: 'TC-DEMO-001', title: '登录页关键元素可见', priority: 'P0' },
    { id: 'case-e2e-codex-structured-002', externalId: 'TC-DEMO-002', title: '错误登录展示提示', priority: 'P1' },
  ];
  const workItem = {
    id: 'work-e2e-codex-structured',
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX-structured 结构化编辑',
    requirement: '验证结构化用例编辑和保存时删除。',
    stage: '页面探索',
    status: 'cases-ready',
    casesMarkdown: structuredMarkdown,
    scriptContent: '',
    assetMode: 'create',
    caseIds: persistedCases.map((item) => item.id),
    testCases: persistedCases,
  };
  const submittedBodies: Array<{ content?: string; case_ids?: string[]; deleted_case_ids?: string[] }> = [];
  let saveAttempts = 0;

  await page.setViewportSize({ width: 375, height: 812 });
  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await mockJsonApi(page, `/api/work-items/${workItem.id}`, workItem);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', { totals: {}, quality: {}, trends: [], recentWorkItems: [] });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await page.route(`**/api/work-items/${workItem.id}/generate-cases`, async (route) => {
    const body = route.request().postDataJSON() as { content?: string; case_ids?: string[]; deleted_case_ids?: string[] };
    submittedBodies.push(body);
    saveAttempts += 1;
    if (saveAttempts === 1) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'E2E-CODEX 模拟保存失败' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...workItem,
        stage: '页面探索',
        status: 'cases-ready',
        casesMarkdown: body.content,
        caseIds: body.case_ids || [],
        testCases: persistedCases.filter((item) => body.case_ids?.includes(item.id)),
      }),
    });
  });

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '用例设计');
  await page.getByRole('tab', { name: '表格编辑' }).click();

  await page.getByRole('button', { name: '编辑用例 TC-DEMO-001' }).click();
  const drawer = page.getByTestId('case-editor-drawer');
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate((element) => Math.round(element.getBoundingClientRect().width) === window.innerWidth)).toBeTruthy();
  await drawer.getByLabel('标题 *').fill('登录页可见 | 已编辑');
  await drawer.getByLabel('步骤').fill('打开登录页\n检查核心元素');
  await drawer.getByRole('button', { name: '保存到草稿' }).click();

  await page.getByRole('button', { name: '新增用例' }).first().click();
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('标题 *').fill('新增结构化用例');
  await drawer.getByLabel('期望结果').fill('新增结果可见');
  await drawer.getByRole('button', { name: '保存到草稿' }).click();
  await expect(page.getByTestId('case-structured-editor')).toContainText('新增结构化用例');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除用例 TC-DEMO-002' }).click();
  await expect(page.getByTestId('case-pending-deletions')).toContainText('TC-DEMO-002');
  await page.getByRole('button', { name: '撤销 TC-DEMO-002' }).click();
  await expect(page.getByTestId('case-pending-deletions')).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除用例 TC-DEMO-002' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除用例 TC-NEW-003' }).click();
  await expect(page.getByRole('button', { name: '删除用例 TC-DEMO-001' })).toBeDisabled();

  await page.getByRole('tab', { name: 'Markdown 源码' }).click();
  const sourceEditor = page.getByTestId('case-markdown-editor');
  await expect(sourceEditor).toHaveValue(/登录页可见 \\\| 已编辑/);
  await expect(sourceEditor).toHaveValue(/# 登录测试用例/);
  await expect(sourceEditor).toHaveValue(/E2E-CODEX-structured 保留说明/);
  await page.getByRole('tab', { name: '表格编辑' }).click();
  await page.getByRole('button', { name: /^保存修改$/ }).click();
  await expect(page.getByText(/保存用例失败.*E2E-CODEX 模拟保存失败/)).toBeVisible();
  await expect(page.getByTestId('case-structured-editor')).toContainText('登录页可见 | 已编辑');
  await expect(page.getByTestId('case-pending-deletions')).toContainText('TC-DEMO-002');
  await page.getByRole('button', { name: /^保存修改$/ }).click();
  await expect(page.getByTestId('notice-banner')).toContainText('人工修改的测试用例已保存');

  expect(submittedBodies).toHaveLength(2);
  const savedBody = submittedBodies[1];
  expect(savedBody.case_ids).toEqual(['case-e2e-codex-structured-001']);
  expect(savedBody.deleted_case_ids).toEqual(['case-e2e-codex-structured-002']);
  expect(savedBody.content).toContain('登录页可见 \\| 已编辑');
  expect(savedBody.content).not.toContain('TC-DEMO-002');
  expect(savedBody.content).toContain('E2E-CODEX-structured 保留说明');
});

test('TC-PLAT-004D AI 助手可在新增用例提案内查看详情', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-ai-detail', name: 'E2E-CODEX-ai-detail 项目', status: 'active' };
  const feature = { id: 'feature-e2e-codex-ai-detail', projectId: project.id, name: 'E2E-CODEX-ai-detail 功能', path: 'E2E-CODEX-ai-detail 功能', isActive: true };
  const workItem = {
    id: 'work-e2e-codex-ai-detail',
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX-ai-detail AI 助手详情',
    requirement: '验证 AI 新增用例可以在助手内查看详情。',
    stage: '用例设计',
    status: 'cases-ready',
    casesRevisionId: 'revision-e2e-codex-ai-detail',
    casesMarkdown: CASES_MARKDOWN,
    scriptContent: '',
    assetMode: 'create',
    caseIds: [],
    testCases: [],
  };
  const proposal = {
    id: 'proposal-e2e-codex-ai-detail',
    summary: '补充登录边界用例',
    status: 'pending',
    operations: [
      {
        id: 'op-ai-detail-add-1',
        type: 'add',
        targetExternalId: 'TC-CODEX-AI-DETAIL-001',
        reason: '覆盖锁定账号边界',
        after: {
          externalId: 'TC-CODEX-AI-DETAIL-001',
          priority: 'P0',
          title: '锁定账号登录被拒绝',
          requirement: '锁定账号不可登录',
          preconditions: '准备 locked_out_user 账号',
          steps: '打开登录页并提交锁定账号',
          expected: '显示账号锁定提示且不进入首页',
          automationNotes: '使用稳定 data-test 定位错误提示',
        },
      },
      {
        id: 'op-ai-detail-add-2',
        type: 'add',
        targetExternalId: 'TC-CODEX-AI-DETAIL-002',
        reason: '覆盖登录输入边界',
        after: {
          externalId: 'TC-CODEX-AI-DETAIL-002',
          priority: 'P1',
          title: '空密码登录校验',
          requirement: '',
          preconditions: '',
          steps: '输入用户名后直接提交',
          expected: '显示密码必填提示',
          automationNotes: '',
        },
      },
      {
        id: 'op-ai-detail-update',
        type: 'update',
        targetExternalId: 'TC-DEMO-001',
        reason: '明确登录成功断言',
        before: { expected: 'Username、Password、Login 可见' },
        after: { expected: '进入商品列表页且商品标题可见' },
      },
      {
        id: 'op-ai-detail-delete',
        type: 'delete',
        targetExternalId: 'TC-DEMO-002',
        reason: '移除重复用例',
        before: { title: '错误登录展示提示' },
        after: null,
      },
    ],
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: true } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await mockJsonApi(page, `/api/work-items/${workItem.id}`, workItem);
  await mockJsonApi(page, `/api/work-items/${workItem.id}/case-assistant`, { items: [] });
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', { totals: {}, quality: {}, trends: [], recentWorkItems: [] });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await page.route(`**/api/work-items/${workItem.id}/case-assistant/messages`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        userMessageId: 'message-e2e-codex-ai-detail-user',
        needsClarification: false,
        message: {
          id: 'message-e2e-codex-ai-detail-assistant',
          role: 'assistant',
          content: '已补充两条登录边界用例。',
          actorDisplayName: 'AI 助手',
          createdAt: new Date().toISOString(),
          proposal,
        },
      }),
    });
  });
  await page.route(`**/api/work-items/${workItem.id}/case-assistant/proposals/${proposal.id}/apply`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: workItem.casesMarkdown,
        appliedOperationIds: ['op-ai-detail-add-1', 'op-ai-detail-add-2', 'op-ai-detail-update'],
        conflicts: [],
        deletedExternalIds: [],
      }),
    });
  });

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '用例设计');
  await page.getByRole('button', { name: 'AI 助手' }).click();
  const panel = page.getByTestId('case-ai-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '检查遗漏' }).click();

  await expect(panel.getByRole('button', { name: '查看详情' })).toHaveCount(2);
  await expect(panel.getByRole('button', { name: '修改操作 TC-DEMO-001' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '查看详情' }).nth(0)).toHaveAttribute('aria-expanded', 'false');
  await panel.getByRole('button', { name: '查看详情' }).nth(0).click();
  const firstDetail = panel.getByTestId('case-ai-add-detail-op-ai-detail-add-1');
  await expect(firstDetail).toBeVisible();
  await expect(firstDetail).toContainText('锁定账号登录被拒绝');
  await expect(firstDetail).toContainText('显示账号锁定提示且不进入首页');
  await expect(panel.getByRole('button', { name: '收起详情' }).first()).toHaveAttribute('aria-expanded', 'true');

  await panel.locator('button.case-ai-detail-toggle[aria-expanded="false"]').first().click();
  const secondDetail = panel.getByTestId('case-ai-add-detail-op-ai-detail-add-2');
  await expect(secondDetail).toBeVisible();
  await expect(secondDetail).toContainText('暂无');
  await panel.getByRole('button', { name: '收起详情' }).first().click();
  await expect(firstDetail).toHaveCount(0);

  await panel.getByRole('button', { name: /应用选中/ }).click();
  await expect(panel.locator('button.case-ai-detail-toggle')).toHaveCount(2);
});

test('TC-PLAT-005A 人工探索预选推荐 selector 但不自动保存', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-recommend', name: 'E2E-CODEX-recommend 项目', status: 'active' };
  const feature = { id: 'feature-e2e-codex-recommend', projectId: project.id, name: 'E2E-CODEX-recommend 功能', path: 'E2E-CODEX-recommend 功能', isActive: true };
  const workItem = {
    id: 'work-e2e-codex-recommend',
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX-recommend 推荐确认',
    requirement: '验证推荐 selector 只在人工页面预选。',
    stage: '页面探索',
    status: 'cases-ready',
    casesMarkdown: CASES_MARKDOWN,
    scriptContent: '',
    assetMode: 'create',
    caseIds: [],
  };
  const explorationRun = {
    id: 'explore-e2e-codex-recommend',
    workItemId: workItem.id,
    status: 'passed',
    stage: { key: 'complete', label: '完成' },
    progress: 100,
    recommendedConfirmationCount: 1,
    logs: [],
    plan: [],
    steps: [],
    result: {
      notes: '已完成推荐分析',
      screenshot_path: '',
      page_structure: '登录表单',
      recommendedConfirmationCount: 1,
      elements: [{
        area: '登录页',
        name: '用户名',
        locatorType: 'testid',
        locatorValue: 'username',
        source: 'data-testid',
        confirmed: false,
        recommended: true,
      }],
    },
  };

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await mockJsonApi(page, `/api/work-items/${workItem.id}`, workItem);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', { totals: {}, quality: {}, trends: [], recentWorkItems: [] });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await mockJsonApi(page, `/api/work-items/${workItem.id}/explore/run`, { ...explorationRun, status: 'running', result: null });
  await mockJsonApi(page, `/api/exploration-runs/${explorationRun.id}`, explorationRun);

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '探索实验室');
  await page.getByRole('button', { name: /^执行探索$/ }).click();
  const recommendedCheckbox = page.getByTestId('candidate-confirm-checkbox');
  await expect(recommendedCheckbox).toBeChecked({ timeout: 10_000 });
  const noticeBanner = page.getByTestId('notice-banner');
  await expect(noticeBanner).toContainText('探索完成');
  await page.getByRole('button', { name: '关闭提示' }).click();
  await expect(noticeBanner).toHaveCount(0);
  await page.waitForTimeout(3500);
  await expect(noticeBanner).toHaveCount(0);
  await expect(page.getByText(/系统推荐 1 个高置信 selector/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^保存探索$/ })).toBeEnabled();
  await recommendedCheckbox.uncheck();
  await expect(page.getByRole('button', { name: /^保存探索$/ })).toBeDisabled();
});

test('TC-PLAT-005B 探索首次响应失败时立即恢复执行按钮', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-explore-failed', name: 'E2E-CODEX-explore-failed 项目', status: 'active' };
  const feature = { id: 'feature-e2e-codex-explore-failed', projectId: project.id, name: 'E2E-CODEX-explore-failed 功能', path: 'E2E-CODEX-explore-failed 功能', isActive: true };
  const workItem = {
    id: 'work-e2e-codex-explore-failed',
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX-explore-failed 探索失败恢复',
    requirement: '验证页面探索失败后可以重试。',
    stage: '页面探索',
    status: 'cases-ready',
    casesMarkdown: CASES_MARKDOWN,
    scriptContent: '',
    assetMode: 'create',
    caseIds: [],
  };
  const failedExploration = {
    id: 'explore-e2e-codex-immediate-failed',
    workItemId: workItem.id,
    status: 'failed',
    stage: { key: 'complete', label: '计划生成失败' },
    progress: 100,
    error: '页面探索计划存在未解决的关键用例',
    logs: [],
    plan: [],
    steps: [],
    result: {
      notes: '探索失败但已保留候选',
      screenshot_path: '',
      page_structure: '安装总榜',
      elements: [{
        area: '安装总榜',
        name: '2 第二技能',
        locatorType: 'text',
        locatorValue: '2 第二技能',
        locatorRole: '',
        source: '失败步骤候选',
        confirmed: false,
      }],
      missingTargets: [{ targetId: 'target-rank-second', name: '2 第二技能', caseIds: ['TC-DISC-017'] }],
      targetCoverage: { total: 1, covered: 0, missing: 1, percent: 0 },
      quality: { level: 'low', score: 0, reasons: ['关键用例未证明：TC-DISC-017'] },
    },
    repairOptions: [{
      targetId: 'target-rank-second',
      targetName: '2 第二技能',
      regionName: '安装总榜',
      selectionIndex: 2,
      journeyId: 'journey-rank',
      caseIds: ['TC-DISC-017'],
      message: '未找到安装总榜第 2 条记录，建议选择下方候选后重试当前路径。',
      candidates: [{
        id: 'repair-rank-second',
        targetId: 'target-rank-second',
        name: '2 第二技能',
        area: '安装总榜',
        locatorType: 'selector',
        locatorValue: 'section:has-text("安装总榜") tr[role="link"] >> nth=1',
        locatorRole: 'link',
        source: '失败步骤候选',
        confidence: 50,
      }],
    }],
  };
  const repairedExploration = {
    ...failedExploration,
    id: 'explore-e2e-codex-repaired',
    status: 'passed',
    error: '',
    repairOfRunId: failedExploration.id,
    repairJourneyId: 'journey-rank',
    repairOptions: [],
    result: {
      ...failedExploration.result,
      missingTargets: [],
      targetCoverage: { total: 1, covered: 1, missing: 0, percent: 100 },
      quality: { level: 'high', score: 100, reasons: [] },
      elements: [{
        ...failedExploration.result.elements[0],
        locatorType: 'selector',
        locatorValue: 'section:has-text("安装总榜") tr[role="link"] >> nth=1',
        confirmed: false,
        recommended: true,
      }],
    },
  };
  const explorationRequests: unknown[] = [];

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await mockJsonApi(page, `/api/work-items/${workItem.id}`, workItem);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', []);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', { totals: {}, quality: {}, trends: [], recentWorkItems: [] });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await page.route(`**/api/work-items/${workItem.id}/explore/run`, async (route) => {
    const body = route.request().postData() ? route.request().postDataJSON() as Record<string, unknown> : null;
    explorationRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body?.retry_run_id ? { ...repairedExploration, status: 'running', result: null } : failedExploration),
    });
  });
  await mockJsonApi(page, `/api/exploration-runs/${repairedExploration.id}`, repairedExploration);

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '探索实验室');
  await page.getByRole('button', { name: /^执行探索$/ }).click();

  await expect(page.getByTestId('error-banner')).toContainText('执行探索失败');
  await expect(page.getByTestId('error-banner')).toContainText('页面探索计划存在未解决的关键用例');
  await expect(page.getByRole('button', { name: /^执行探索$/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: '探索中' })).toHaveCount(0);
  const repairPanel = page.getByTestId('exploration-repair-options');
  await expect(repairPanel).toContainText('未找到安装总榜第 2 条记录');
  await repairPanel.getByRole('radio').check();
  await repairPanel.getByRole('button', { name: '使用此元素并重试当前路径' }).click();
  await expect.poll(() => explorationRequests.length).toBe(2);
  expect(explorationRequests[1]).toEqual({
    retry_run_id: failedExploration.id,
    journey_id: 'journey-rank',
    target_overrides: [{
      target_id: 'target-rank-second',
      locator_type: 'selector',
      locator_value: 'section:has-text("安装总榜") tr[role="link"] >> nth=1',
      locator_role: 'link',
      name: '2 第二技能',
    }],
  });
  await expect(page.getByTestId('notice-banner')).toContainText('探索完成');
  await expect(page.getByRole('button', { name: /^执行探索$/ })).toBeEnabled();
});

test('TC-PLAT-008 人工自愈生成修复脚本并自动重跑', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const project = {
    id: 'proj-e2e-codex-healing',
    projectCode: 'PRJ-E2E-CODEX-HEALING',
    name: 'E2E-CODEX-healing 项目',
    projectType: 'product',
    status: 'active',
  };
  const feature = {
    id: 'feature-e2e-codex-healing',
    projectId: project.id,
    name: 'E2E-CODEX-healing 功能',
    path: 'E2E-CODEX-healing 功能',
    isActive: true,
  };
  const failedRun = {
    id: 'run-e2e-codex-healing-failed',
    workItemId: 'work-e2e-codex-healing',
    status: 'failed',
    progress: 100,
    exitCode: 1,
    stage: { key: 'complete', label: '完成' },
    reportPath: 'artifacts/e2e-codex-healing/failed/index.html',
  };
  const passedRun = {
    ...failedRun,
    id: 'run-e2e-codex-healing-passed',
    status: 'passed',
    exitCode: 0,
    reportPath: 'artifacts/e2e-codex-healing/passed/index.html',
    scriptVersionId: 'script-version-healed-001',
    casesRevisionId: 101,
  };
  const runningRun = {
    ...failedRun,
    id: 'run-e2e-codex-healing-running',
    status: 'running',
    progress: 58,
    exitCode: null,
    stage: { key: 'execute', label: '执行脚本' },
    reportPath: 'artifacts/e2e-codex-healing/running/index.html',
    browserSessionId: '',
  };
  const workItem = {
    id: failedRun.workItemId,
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX-healing 人工自愈',
    requirement: '验证人工自愈生成修复脚本并重新执行。',
    stage: '自愈诊断',
    status: 'failed',
    latestRunId: failedRun.id,
    casesMarkdown: CASES_MARKDOWN,
    scriptContent: SCRIPT_CONTENT,
    assetMode: 'create',
    healingAttempts: [],
    latestHealingRun: null,
  };
  const healingRunId = 'healing-e2e-codex-001';
  let healingPolls = 0;
  let healingCompleted = false;
  let selfHealRequest: Record<string, unknown> | null = null;
  let saveArtifactsRequest: Record<string, unknown> | null = null;
  const healingPayload = (completed: boolean) => ({
    id: healingRunId,
    workItemId: workItem.id,
    sourceRunId: failedRun.id,
    status: completed ? 'passed' : 'healing',
    currentRound: 1,
    maxRounds: 3,
    latestRunId: completed ? passedRun.id : runningRun.id,
    error: '',
    sourceRun: failedRun,
    latestRun: completed ? passedRun : runningRun,
    attempts: [{
      id: 1,
      healingRunId,
      workItemId: workItem.id,
      sourceRunId: failedRun.id,
      rerunRunId: completed ? passedRun.id : runningRun.id,
      scriptVersionId: 'script-version-healed-001',
      round: 1,
      status: completed ? 'passed' : 'rerunning',
      failureSummary: '登录按钮 selector 失效',
      proposedFix: '使用稳定 data-test selector',
      result: completed ? '重跑完成：passed，退出码 0' : '已保存修复脚本，正在重新执行验证',
      error: '',
    }],
  });

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: true } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await page.route(`**/api/work-items/${workItem.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...workItem,
        status: healingCompleted ? 'passed' : 'failed',
        latestRunId: healingCompleted ? passedRun.id : failedRun.id,
        scriptContent: healingCompleted ? `${SCRIPT_CONTENT}\n// healed` : SCRIPT_CONTENT,
        latestHealingRun: healingCompleted ? healingPayload(true) : null,
      }),
    });
  });
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, '/api/runs', [failedRun]);
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {
    totals: { projects: 1, workItems: 1, testCases: 2, suiteRuns: 0 },
    quality: { passRate: 0, failedCases: 1, automationCoverage: 100 },
    trends: [],
    recentWorkItems: [],
  });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await page.route(`**/api/work-items/${workItem.id}/self-heal`, async (route) => {
    selfHealRequest = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(healingPayload(false)) });
  });
  await page.route(`**/api/healing-runs/${healingRunId}`, async (route) => {
    healingPolls += 1;
    healingCompleted = healingPolls >= 4;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(healingPayload(healingCompleted)) });
  });
  await page.route(`**/api/healing-runs/${healingRunId}/logs`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          { id: 1, createdAt: '2026-08-18T10:00:00Z', level: 'info', message: '启动自愈诊断', stepKey: 'healing.lifecycle' },
          { id: 2, createdAt: '2026-08-18T10:00:01Z', level: 'info', message: '读取失败证据', stepKey: 'healing.diagnose' },
        ],
      }),
    });
  });
  await page.route(`**/api/work-items/${workItem.id}/save-artifacts`, async (route) => {
    saveArtifactsRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...workItem,
        status: 'artifacts-saved',
        latestRunId: passedRun.id,
        latestRun: passedRun,
      }),
    });
  });
  await mockJsonApi(page, `/api/runs/${runningRun.id}`, runningRun);
  await mockJsonApi(page, `/api/runs/${runningRun.id}/logs`, { items: [{ id: 20, level: 'info', message: 'healing rerun is executing' }] });
  await mockJsonApi(page, `/api/runs/${passedRun.id}`, passedRun);
  await mockJsonApi(page, `/api/runs/${passedRun.id}/logs`, { items: [{ id: 1, level: 'info', message: 'healed run passed' }] });

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '脚本工作台');
  await expect(page.getByRole('button', { name: '保存已验证产物' })).toHaveCount(0);
  await gotoModule(page, '执行测试');
  await expect.poll(() => pageErrors).toEqual([]);
  await expect(page.getByRole('button', { name: '保存已验证产物' })).toBeDisabled();
  await gotoModule(page, '自愈诊断');
  await expect(page.getByTestId('healing-run-summary')).toContainText('等待启动');
  await expect(page.getByLabel('补充失败说明（可选）')).toHaveCount(0);
  await expect(page.getByLabel('修复约束或建议（可选）')).toHaveCount(0);
  await expect(page.getByTestId('healing-browser-preview')).toBeVisible();
  await expect(page.getByTestId('healing-log-panel')).toContainText('暂无日志');
  await page.getByRole('button', { name: '启动自愈' }).click();
  await expect(page.getByTestId('notice-banner')).toContainText('人工自愈已启动');
  expect(selfHealRequest).toEqual({});
  await expect(page.getByTestId('healing-run-summary')).toContainText(runningRun.id);
  await expect(page.getByTestId('healing-log-panel')).toContainText('启动自愈诊断');
  await expect(page.getByTestId('healing-log-panel')).toContainText('读取失败证据');
  await expect(page.getByTestId('healing-runtime')).toContainText('执行脚本');
  await expect(page.getByTestId('healing-log-panel')).toContainText('healing rerun is executing');
  await expect(page.getByTestId('healing-browser-preview')).toContainText('只读执行预览');
  await expect(page.getByTestId('healing-browser-preview').getByRole('button', { name: '暂停' })).toHaveCount(0);
  await expect(page.getByTestId('healing-browser-preview').getByRole('button', { name: '人工接管' })).toHaveCount(0);
  await expect(page.getByTestId('healing-browser-preview').getByRole('button', { name: '继续' })).toHaveCount(0);
  await expect(page.getByTestId('healing-browser-fullscreen')).toBeVisible();
  await expect(page.getByTestId('healing-browser-live-canvas')).toHaveAttribute('tabindex', '-1');
  await expect(page.getByTestId('healing-run-summary')).toContainText('已通过', { timeout: 10_000 });
  await expect(page.getByTestId('healing-log-panel')).toContainText('healed run passed');
  await expect(page.getByTestId('healing-log-panel')).not.toContainText('healing rerun is executing');
  await expect(page.getByText(/第 1 轮 · 已通过/)).toBeVisible();
  await expect(page.getByText(/脚本版本 script-version-healed-001/)).toBeVisible();
  await expect(page.getByTestId('notice-banner')).toContainText('可在当前页面保存');
  await expect(page.getByRole('button', { name: '启动自愈' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存已验证产物' })).toBeEnabled();
  await page.getByRole('button', { name: '保存已验证产物' }).click();
  await expect(page.getByRole('region', { name: '测试报告' })).toBeVisible();
  expect(saveArtifactsRequest).toEqual({ run_id: passedRun.id, report_content: '' });
});

test('TC-PLAT-007A 再次执行时立即清空旧日志并只展示最新 Run 日志', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-execution-logs', name: 'E2E-CODEX execution logs 项目', status: 'active' };
  const feature = {
    id: 'feature-e2e-codex-execution-logs',
    projectId: project.id,
    name: 'E2E-CODEX execution logs 功能',
    path: 'E2E-CODEX execution logs 功能',
    isActive: true,
  };
  const oldRun = {
    id: 'run-e2e-codex-old',
    workItemId: 'work-e2e-codex-execution-logs',
    status: 'passed',
    stage: { key: 'complete', label: '完成' },
    progress: 100,
    browserSessionId: 'browser-e2e-codex-readonly',
  };
  const newRun = {
    id: 'run-e2e-codex-new',
    workItemId: oldRun.workItemId,
    status: 'running',
    stage: { key: 'prepare', label: '准备环境' },
    progress: 6,
    browserSessionId: oldRun.browserSessionId,
  };
  const oldItem = {
    id: oldRun.workItemId,
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX execution logs 工单',
    requirement: '验证重复执行只显示最新 Run 日志。',
    targetUrl: 'https://example.test',
    stage: '运行验证',
    status: 'passed',
    casesMarkdown: CASES_MARKDOWN,
    scriptContent: SCRIPT_CONTENT,
    assetMode: 'create',
    latestRunId: oldRun.id,
    latestRun: oldRun,
  };
  const newItem = {
    ...oldItem,
    status: 'running',
    latestRunId: newRun.id,
    latestRun: newRun,
  };
  let releaseRunResponse = () => {};
  let signalRunRequest = () => {};
  const runResponseGate = new Promise<void>((resolve) => { releaseRunResponse = resolve; });
  const runRequested = new Promise<void>((resolve) => { signalRunRequest = resolve; });
  let runStarted = false;

  // 使用页面内 WebSocket mock 提供实时状态和画面，并记录所有可能发出的控制消息。
  await page.addInitScript(() => {
    const commandMessages: string[] = [];
    const sockets: Array<{ url: string }> = [];
    class ReadOnlyPreviewWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = ReadOnlyPreviewWebSocket.CONNECTING;
      url: string;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        sockets.push(this);
        queueMicrotask(() => {
          this.readyState = ReadOnlyPreviewWebSocket.OPEN;
          this.dispatchEvent(new Event('open'));
          if (!this.url.includes('/ws/browser-sessions/')) return;
          this.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({ type: 'status', status: 'Live', message: '只读执行预览' }),
          }));
          this.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
              type: 'frame',
              format: 'png',
              width: 16,
              height: 9,
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4S0AAAAASUVORK5CYII=',
            }),
          }));
        });
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        commandMessages.push(String(data));
      }

      close() {
        if (this.readyState === ReadOnlyPreviewWebSocket.CLOSED) return;
        this.readyState = ReadOnlyPreviewWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent('close'));
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: ReadOnlyPreviewWebSocket });
    (window as any).__readonlyPreviewCommandMessages = commandMessages;
    (window as any).__readonlyPreviewSockets = sockets;
  });

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: false } });
  await mockJsonApi(page, '/api/projects', [project]);
  await page.route('**/api/work-items', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runStarted ? [newItem, oldItem] : [oldItem]),
    });
  });
  await mockJsonApi(page, `/api/work-items/${oldItem.id}`, oldItem);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await page.route('**/api/runs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runStarted ? [newRun, oldRun] : [oldRun]),
    });
  });
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {
    totals: { projects: 1, workItems: 1, testCases: 2, suiteRuns: 0 },
    quality: { passRate: 100, failedCases: 0, automationCoverage: 100 },
    trends: [],
    recentWorkItems: [],
  });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await mockJsonApi(page, `/api/runs/${oldRun.id}`, oldRun);
  await mockJsonApi(page, `/api/runs/${oldRun.id}/logs`, {
    items: [{ id: 11, createdAt: '2026-07-14T00:00:00Z', level: 'info', message: 'OLD-RUN-LOG' }],
  });
  await mockJsonApi(page, `/api/runs/${oldRun.id}/screenshot`, { dataUrl: null });
  await mockJsonApi(page, `/api/runs/${newRun.id}`, newRun);
  await mockJsonApi(page, `/api/runs/${newRun.id}/logs`, {
    items: [{ id: 12, createdAt: '2026-07-14T00:01:00Z', level: 'info', message: 'NEW-RUN-LOG' }],
  });
  await mockJsonApi(page, `/api/runs/${newRun.id}/screenshot`, { dataUrl: null });
  await page.route(`**/api/work-items/${oldItem.id}/run`, async (route) => {
    signalRunRequest();
    await runResponseGate;
    runStarted = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(newItem) });
  });

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '执行测试');
  const logPanel = page.getByTestId('log-panel');
  await expect(logPanel).toContainText('OLD-RUN-LOG');

  // 执行阶段只保留全屏预览，不展示任何可能干扰自动测试的控制入口。
  const browserPreview = page.getByTestId('execution-browser-preview');
  const browserCanvas = page.getByTestId('execution-browser-live-canvas');
  const previewToggle = page.getByTestId('execution-browser-preview-toggle');
  await expect(browserPreview).toContainText('只读执行预览');
  await expect(previewToggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('execution-runtime')).toContainText('已关闭');
  await expect.poll(() => page.evaluate(() => (window as any).__readonlyPreviewSockets.filter((socket: { url: string }) => socket.url.includes('/ws/browser-sessions/')).length)).toBe(0);
  await expect(browserPreview.getByRole('button', { name: '暂停' })).toHaveCount(0);
  await expect(browserPreview.getByRole('button', { name: '人工接管' })).toHaveCount(0);
  await expect(browserPreview.getByRole('button', { name: '继续' })).toHaveCount(0);
  await expect(browserCanvas).toHaveAttribute('tabindex', '-1');
  await previewToggle.click();
  await expect(previewToggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('execution-runtime')).toContainText('Live WebSocket');
  await expect.poll(() => browserCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0)).toBeTruthy();

  // 进入全屏后移动鼠标，确认只读 canvas 不会向 WebSocket 发送任何命令。
  const fullscreenButton = page.getByTestId('execution-browser-fullscreen');
  await fullscreenButton.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') || '')).toBe('execution-browser-preview');
  const fullscreenCanvasBox = await browserCanvas.boundingBox();
  expect(fullscreenCanvasBox).not.toBeNull();
  await page.mouse.move(
    (fullscreenCanvasBox?.x || 0) + (fullscreenCanvasBox?.width || 0) / 2,
    (fullscreenCanvasBox?.y || 0) + (fullscreenCanvasBox?.height || 0) / 2,
  );
  await expect.poll(() => page.evaluate(() => (window as any).__readonlyPreviewCommandMessages.length)).toBe(0);
  await expect(page.getByText('浏览器 worker stdin 不可用', { exact: true })).toHaveCount(0);
  await fullscreenButton.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBeTruthy();
  await expect.poll(() => browserCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0)).toBeTruthy();

  // 关闭预览后断开浏览器 WebSocket，但不影响后续后台执行。
  await previewToggle.click();
  await expect(previewToggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('execution-runtime')).toContainText('已关闭');
  await expect.poll(() => page.evaluate(() => {
    const sockets = (window as any).__readonlyPreviewSockets.filter((socket: { url: string }) => socket.url.includes('/ws/browser-sessions/'));
    return sockets.length > 0 && sockets.every((socket: { readyState: number }) => socket.readyState === WebSocket.CLOSED);
  })).toBeTruthy();

  await page.getByRole('button', { name: /重新执行/ }).click();
  await runRequested;
  await expect(logPanel).toContainText('暂无日志');
  await expect(logPanel).not.toContainText('OLD-RUN-LOG');

  releaseRunResponse();
  await expect(logPanel).toContainText('NEW-RUN-LOG');
  await expect(logPanel).not.toContainText('OLD-RUN-LOG');
});

test('TC-PLAT-007B 人工执行失败后自动进入自愈诊断', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-execution-healing', name: 'E2E-CODEX execution healing 项目', status: 'active' };
  const feature = {
    id: 'feature-e2e-codex-execution-healing',
    projectId: project.id,
    name: 'E2E-CODEX execution healing 功能',
    path: 'E2E-CODEX execution healing 功能',
    isActive: true,
  };
  const workItemId = 'work-e2e-codex-execution-healing';
  const runningRun = {
    id: 'run-e2e-codex-execution-healing',
    workItemId,
    status: 'running',
    stage: { key: 'execute', label: '执行脚本' },
    progress: 45,
    browserSessionId: null,
  };
  const failedRun = {
    ...runningRun,
    status: 'failed',
    stage: { key: 'complete', label: '完成' },
    progress: 100,
    exitCode: 1,
    error: 'locator timeout',
    failedScripts: [{
      caseId: 'case-e2e-codex-execution-healing-002',
      externalId: 'TC-DEMO-002',
      title: '错误登录展示提示',
      scriptVersionId: 'script-e2e-codex-execution-healing-002',
      specPath: 'tests/e2e/work-items/execution-healing/tc-demo-002.spec.ts',
      resultStatus: 'failed',
    }],
  };
  const baseItem = {
    id: workItemId,
    projectId: project.id,
    featureId: feature.id,
    title: 'E2E-CODEX execution healing 工单',
    requirement: '验证人工执行失败后自动进入自愈诊断。',
    targetUrl: 'https://example.test',
    stage: '运行验证',
    status: 'script-ready',
    latestRunId: '',
    latestRun: null,
    casesMarkdown: CASES_MARKDOWN,
    scriptContent: SCRIPT_CONTENT,
    assetMode: 'create',
    healingAttempts: [],
    latestHealingRun: null,
  };
  let runStarted = false;
  let runPolls = 0;
  const currentRun = () => (runPolls >= 2 ? failedRun : runningRun);
  const currentItem = () => {
    if (!runStarted) return baseItem;
    const run = currentRun();
    return {
      ...baseItem,
      status: run.status === 'failed' ? 'failed' : 'running',
      stage: run.status === 'failed' ? '自愈诊断' : '运行验证',
      latestRunId: run.id,
      latestRun: run,
    };
  };

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: true } });
  await mockJsonApi(page, '/api/projects', [project]);
  await page.route('**/api/work-items', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([currentItem()]) });
  });
  await page.route(`**/api/work-items/${workItemId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentItem()) });
  });
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await page.route('**/api/runs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runStarted ? [currentRun()] : []),
    });
  });
  await mockJsonApi(page, '/api/dashboard-summary?project_id=all', {
    totals: { projects: 1, workItems: 1, testCases: 2, suiteRuns: 0 },
    quality: { passRate: 0, failedCases: 1, automationCoverage: 100 },
    trends: [],
    recentWorkItems: [],
  });
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJsonApi(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJsonApi(page, `/api/suite-runs?project_id=${project.id}`, []);
  await mockJsonApi(page, '/api/automation-flows', []);
  await page.route(`**/api/runs/${runningRun.id}`, async (route) => {
    runPolls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentRun()) });
  });
  await page.route(`**/api/runs/${runningRun.id}/logs`, async (route) => {
    const run = currentRun();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: run.status === 'failed' ? [{
          id: 22,
          createdAt: '2026-07-14T00:02:00Z',
          level: 'error',
          message: '失败用例脚本：TC-DEMO-002 错误登录展示提示（tests/e2e/work-items/execution-healing/tc-demo-002.spec.ts）',
        }] : [{
          id: 21,
          createdAt: '2026-07-14T00:02:00Z',
          level: 'info',
          message: 'E2E-CODEX run running',
        }],
      }),
    });
  });
  await mockJsonApi(page, `/api/runs/${runningRun.id}/screenshot`, { dataUrl: null });
  await page.route(`**/api/work-items/${workItemId}/run`, async (route) => {
    runStarted = true;
    runPolls = 0;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(currentItem()),
    });
  });

  await page.goto(PLATFORM_URL);
  await page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: '人工工作台', exact: true }).click();
  await gotoModule(page, '执行测试');
  await page.getByRole('button', { name: /执行当前任务/ }).click();

  await expect(page.getByRole('region', { name: '自愈诊断' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('healing-run-summary')).toContainText(`源失败 Run${failedRun.id}`);
  await expect(page.getByTestId('healing-failed-scripts')).toContainText('TC-DEMO-002 · 错误登录展示提示');
  await expect(page.getByTestId('healing-failed-scripts')).toContainText('tests/e2e/work-items/execution-healing/tc-demo-002.spec.ts');
  await expect(page.getByRole('button', { name: '启动自愈' })).toBeEnabled();

  await gotoModule(page, '执行测试');
  await expect(page.getByTestId('log-panel')).toContainText('失败用例脚本：TC-DEMO-002 错误登录展示提示');
  await expect(page.getByTestId('log-panel')).toContainText('tests/e2e/work-items/execution-healing/tc-demo-002.spec.ts');
});

test('TC-PLAT-007C 导入用例调试通过后不重复显示历史导入失败', async ({ page }) => {
  const project = { id: 'proj-e2e-codex-import-debug', name: 'E2E-CODEX import debug 项目', status: 'active' };
  const feature = {
    id: 'feature-e2e-codex-import-debug',
    projectId: project.id,
    name: 'E2E-CODEX import debug 功能',
    path: 'E2E-CODEX import debug 功能',
    isActive: true,
  };
  const workItemId = 'work-e2e-codex-import-debug';
  const debugSessionId = 'debug-e2e-codex-import';
  const runId = 'run-e2e-codex-import-debug';
  const importId = 'import-e2e-codex-old-failure';
  let runPolls = 0;
  let importRequests = 0;
  const currentRun = () => ({
    id: runId,
    workItemId,
    debugSessionId,
    status: runPolls >= 2 ? 'passed' : 'running',
    stage: { key: runPolls >= 2 ? 'complete' : 'execute', label: runPolls >= 2 ? '完成' : '执行脚本' },
    progress: runPolls >= 2 ? 100 : 55,
    exitCode: runPolls >= 2 ? 0 : null,
    browserSessionId: null,
  });
  const workItem = {
    id: workItemId,
    projectId: project.id,
    featureId: feature.id,
    title: '[导入] E2E-CODEX shared spec',
    requirement: '验证调试 Run 不复用历史导入错误。',
    targetUrl: 'https://example.test',
    stage: '运行验证',
    status: runPolls >= 2 ? 'passed' : 'running',
    latestRunId: runId,
    latestRun: currentRun(),
    systemImport: true,
    importId,
    casesMarkdown: CASES_MARKDOWN,
    scriptContent: SCRIPT_CONTENT,
    testCases: [],
    scriptVersions: [],
    assetMode: 'create',
  };
  const debugSession = () => ({
    id: debugSessionId,
    projectId: project.id,
    workItemId,
    caseId: 'case-e2e-codex-import-debug',
    currentScriptVersionId: 'script-e2e-codex-import-debug',
    status: runPolls >= 2 ? 'passed' : 'running',
    latestRunId: runId,
    latestRun: currentRun(),
    dependencyExecution: { defaultScope: 'single', manualChoiceRequired: false },
    case: { id: 'case-e2e-codex-import-debug', externalId: 'TC-CODEX-IMPORT-DEBUG-001', title: '导入用例调试' },
    currentScriptVersion: { id: 'script-e2e-codex-import-debug', content: SCRIPT_CONTENT },
    workItem,
  });

  await mockFallbackApi(page);
  await mockSuccessfulAuth(page);
  await mockJsonApi(page, '/api/health', { status: 'ok', ai: { configured: true } });
  await mockJsonApi(page, '/api/projects', [project]);
  await mockJsonApi(page, '/api/work-items', [workItem]);
  await mockJsonApi(page, '/api/runs', [currentRun()]);
  await mockJsonApi(page, '/api/test-cases?project_id=all', []);
  await mockJsonApi(page, '/api/deliverables?include_content=false', []);
  await mockJsonApi(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await page.route(`**/api/work-items/${workItemId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...workItem, latestRun: currentRun() }) });
  });
  await page.route(`**/api/case-debug-sessions/${debugSessionId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(debugSession()) });
  });
  await page.route(`**/api/runs/${runId}`, async (route) => {
    runPolls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentRun()) });
  });
  await mockJsonApi(page, `/api/runs/${runId}/logs`, { items: [] });
  await mockJsonApi(page, `/api/runs/${runId}/screenshot`, { dataUrl: null });
  await page.route(`**/api/test-case-imports/${importId}`, async (route) => {
    importRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'validation-failed', error: 'Playwright Run a09b8f129cbe 状态为 failed' }),
    });
  });

  await page.goto(`${PLATFORM_URL}/?debugSessionId=${debugSessionId}&module=execution`);

  await expect.poll(() => runPolls, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => importRequests, { timeout: 2_000 }).toBe(0);
  await expect(page.getByTestId('error-banner')).toHaveCount(0);
});

test('TC-PLAT-001B 项目管理采用筛选表格与安全弹窗完成 CRUD', async ({ page }) => {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const marker = `CODEX_TEST_${timestamp}`;
  const projectCode = `PRJ-E2E-${timestamp}`;
  const linkedProjectCode = `PRJ-LINKED-${timestamp}`;
  const linkedCaseExternalId = `TC-LINKED-${timestamp}`;
  let createdProjectId = '';
  let linkedProjectId = '';
  let linkedCaseId = '';

  try {
    await page.goto(PLATFORM_URL);
    const loginName = page.getByLabel('登录名', { exact: true });
    const platformNavigation = page.getByRole('navigation', { name: '平台模块' });
    await expect.poll(async () => (await loginName.count()) + (await platformNavigation.count()), { timeout: 10_000 }).toBeGreaterThan(0);
    if (await loginName.isVisible()) {
      await loginName.fill('admin');
      await page.getByLabel('密码', { exact: true }).fill(bootstrapAdminPassword());
      await page.getByRole('button', { name: '登录', exact: true }).click();
    }
    await expect(platformNavigation).toBeVisible({ timeout: 10_000 });

    await gotoModule(page, '项目管理');
    const projectRegion = page.getByRole('region', { name: '项目管理' });
    await expect(projectRegion).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('project-management-type-filter')).toHaveValue('all');
    await expect(page.getByTestId('project-management-status-filter')).toHaveValue('all');
    await expect(projectRegion.locator('.project-management-pagination')).toContainText('每页 10 条');
    await page.waitForLoadState('networkidle');
    const projectContextBeforeCrud = await page.evaluate(() => window.localStorage.getItem('qa-platform-current-project'));

    // 新建项目并验证表格展示独立的项目编号列。
    await projectRegion.getByRole('button', { name: '新建项目' }).click();
    const createDialog = page.getByRole('dialog', { name: '新建项目' });
    await createDialog.getByLabel('项目编号').fill(projectCode);
    await createDialog.getByLabel('项目名称').fill(`${marker} 交付台账项目`);
    await createDialog.getByLabel('项目类型').selectOption('delivery');
    await createDialog.getByLabel('项目状态').selectOption('planning');
    await createDialog.getByLabel('目标 URL').fill('https://example.com/e2e');
    await createDialog.getByLabel('仓库路径').fill('/Users/syj/Documents/qa-project');
    await createDialog.getByLabel('测试目录').fill(`tests/e2e/${marker}`);
    await createDialog.getByLabel('项目描述').fill(`${marker} 项目管理表格化冒烟数据。`);
    const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await createDialog.getByRole('button', { name: '创建项目' }).click();
    const createdProject = await (await createResponsePromise).json();
    createdProjectId = createdProject.id;
    await expect(page.getByTestId('notice-banner')).toContainText('项目已创建', { timeout: 10_000 });

    const search = page.getByTestId('project-management-search');
    await search.fill(projectCode);
    let projectRow = page.getByTestId('project-management-table').locator('.project-row').filter({ hasText: projectCode });
    await expect(page.getByTestId('project-management-table').locator('.project-row-head')).toContainText('项目编号');
    await expect(projectRow.locator('[data-label="项目编号"]')).toHaveText(projectCode);
    await expect(projectRow).toContainText(`${marker} 交付台账项目`);
    await expect(projectRow).toContainText('交付类');
    await expect(projectRow).toContainText('规划中');
    await expect(page.getByTestId('project-management-table').locator('.active-project-row')).toHaveCount(0);
    await page.getByTestId('project-management-type-filter').selectOption('product');
    await expect(projectRow).toHaveCount(0);
    await page.getByTestId('project-management-type-filter').selectOption('delivery');
    await page.getByTestId('project-management-status-filter').selectOption('planning');
    projectRow = page.getByTestId('project-management-table').locator('.project-row').filter({ hasText: projectCode });
    await expect(projectRow).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('qa-platform-current-project'))).toBe(projectContextBeforeCrud);

    // 详情弹窗加载完整工程配置和真实依赖统计。
    await projectRow.getByRole('button', { name: /查看项目/ }).click();
    const detailDialog = page.getByRole('dialog', { name: new RegExp(`项目详情 ${marker}`) });
    await expect(detailDialog).toContainText('https://example.com/e2e');
    await expect(detailDialog).toContainText(`tests/e2e/${marker}`);
    await expect(detailDialog.getByRole('region', { name: '关联资产' })).toContainText('结构化用例');
    await detailDialog.getByRole('button', { name: '关闭项目详情' }).click();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('qa-platform-current-project'))).toBe(projectContextBeforeCrud);
    await expect(page.getByTestId('project-management-table').locator('.active-project-row')).toHaveCount(0);

    // 编辑继续使用独立弹窗，保存后列表按最新数据刷新。
    await projectRow.getByRole('button', { name: /编辑项目/ }).click();
    const editDialog = page.getByRole('dialog', { name: new RegExp(`编辑项目 ${marker}`) });
    await editDialog.getByLabel('项目名称').fill(`${marker} 产品台账项目`);
    await editDialog.getByLabel('项目类型').selectOption('product');
    await editDialog.getByLabel('项目状态').selectOption('active');
    await editDialog.getByRole('button', { name: '保存修改' }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('项目已保存', { timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('qa-platform-current-project'))).toBe(projectContextBeforeCrud);
    await expect(page.getByTestId('project-management-table').locator('.active-project-row')).toHaveCount(0);
    await page.getByTestId('project-management-type-filter').selectOption('product');
    await page.getByTestId('project-management-status-filter').selectOption('active');
    projectRow = page.getByTestId('project-management-table').locator('.project-row').filter({ hasText: projectCode });
    await expect(projectRow).toContainText(`${marker} 产品台账项目`);
    await expect(projectRow).toContainText('进行中');

    // 无依赖项目通过预检后可以删除。
    await projectRow.getByRole('button', { name: /删除项目/ }).click();
    let deleteDialog = page.getByRole('alertdialog', { name: new RegExp(`删除项目 ${marker}`) });
    await expect(deleteDialog).toContainText('预检未发现关联资产');
    await expect(deleteDialog.getByRole('button', { name: '确认删除' })).toBeEnabled();
    await deleteDialog.getByRole('button', { name: '确认删除' }).click();
    await expect(page.getByTestId('notice-banner')).toContainText('项目已删除', { timeout: 10_000 });
    createdProjectId = '';

    // 创建带唯一标记的关联用例，验证前端进入两步级联删除确认。
    await projectRegion.getByRole('button', { name: '新建项目' }).click();
    const linkedCreateDialog = page.getByRole('dialog', { name: '新建项目' });
    await linkedCreateDialog.getByLabel('项目编号').fill(linkedProjectCode);
    await linkedCreateDialog.getByLabel('项目名称').fill(`${marker} 关联资产项目`);
    const linkedResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await linkedCreateDialog.getByRole('button', { name: '创建项目' }).click();
    const linkedProject = await (await linkedResponsePromise).json();
    linkedProjectId = linkedProject.id;
    const linkedCaseResponse = await page.request.post(`${API_URL}/api/test-cases`, {
      data: {
        project_id: linkedProjectId,
        external_id: linkedCaseExternalId,
        title: `${marker} 关联资产删除保护用例`,
        priority: 'P1',
        automation_status: 'manual',
      },
    });
    expect(linkedCaseResponse.ok()).toBeTruthy();
    linkedCaseId = (await linkedCaseResponse.json()).id;

    await search.fill(linkedProjectCode);
    await page.getByTestId('project-management-type-filter').selectOption('all');
    await page.getByTestId('project-management-status-filter').selectOption('all');
    const linkedRow = page.getByTestId('project-management-table').locator('.project-row').filter({ hasText: linkedProjectCode });
    await linkedRow.getByRole('button', { name: /删除项目/ }).click();
    deleteDialog = page.getByRole('alertdialog', { name: new RegExp(`删除项目 ${marker}`) });
    await expect(deleteDialog).toContainText('该项目仍有关联资产');
    await expect(deleteDialog).toContainText('结构化用例');
    await expect(deleteDialog.getByRole('button', { name: '继续删除' })).toBeEnabled();
    await deleteDialog.getByRole('button', { name: '继续删除' }).click();
    await expect(deleteDialog).toContainText('永久删除项目');
    await expect(deleteDialog.getByRole('button', { name: '永久删除项目及资产' })).toBeEnabled();
    await deleteDialog.getByRole('button', { name: '取消' }).click();

    // 将鉴权信息切换为访客，确认管理入口禁用而详情仍可查看。
    await page.route('**/api/auth/me', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { id: 'project-viewer', username: 'project-viewer', displayName: '项目访客', role: 'viewer', status: 'active' } }),
    }));
    await page.reload();
    await gotoModule(page, '项目管理');
    await page.getByTestId('project-management-search').fill(linkedProjectCode);
    const viewerRegion = page.getByRole('region', { name: '项目管理' });
    const viewerRow = page.getByTestId('project-management-table').locator('.project-row').filter({ hasText: linkedProjectCode });
    await expect(viewerRegion.getByRole('button', { name: '新建项目' })).toBeDisabled();
    await expect(viewerRow.getByRole('button', { name: /查看项目/ })).toBeEnabled();
    await expect(viewerRow.getByRole('button', { name: /编辑项目/ })).toBeDisabled();
    await expect(viewerRow.getByRole('button', { name: /删除项目/ })).toBeDisabled();

    // 恢复管理员状态，通过第二次确认发出显式 cascade=true 请求。
    await page.unroute('**/api/auth/me');
    await page.reload();
    await gotoModule(page, '项目管理');
    await page.getByTestId('project-management-search').fill(linkedProjectCode);
    const cascadeRow = page.getByTestId('project-management-table').locator('.project-row').filter({ hasText: linkedProjectCode });
    await cascadeRow.getByRole('button', { name: /删除项目/ }).click();
    deleteDialog = page.getByRole('alertdialog', { name: new RegExp(`删除项目 ${marker}`) });
    await deleteDialog.getByRole('button', { name: '继续删除' }).click();
    const cascadeDeleteResponse = page.waitForResponse((response) => response.url().includes(`/api/projects/${linkedProjectId}?cascade=true`) && response.request().method() === 'DELETE');
    await deleteDialog.getByRole('button', { name: '永久删除项目及资产' }).click();
    expect((await cascadeDeleteResponse).ok()).toBeTruthy();
    await expect(page.getByTestId('notice-banner')).toContainText('项目已删除', { timeout: 10_000 });
    linkedCaseId = '';
    linkedProjectId = '';
  } finally {
    await page.unroute('**/api/auth/me').catch(() => {});
    if (linkedCaseId) {
      const response = await page.request.delete(`${API_URL}/api/test-cases/${linkedCaseId}`);
      expect([200, 404]).toContain(response.status());
    }
    if (linkedProjectId) {
      const response = await page.request.delete(`${API_URL}/api/projects/${linkedProjectId}?cascade=true`);
      expect([200, 404]).toContain(response.status());
    }
    if (createdProjectId) {
      const response = await page.request.delete(`${API_URL}/api/projects/${createdProjectId}`);
      expect([200, 404]).toContain(response.status());
    }
  }
});

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

    // 验证左侧一级菜单可全部收起，并可按需展开二级菜单。
    const moduleNav = page.getByRole('navigation', { name: '平台模块' });
    await expect(moduleNav).toBeVisible();
    const navGroupNames = ['工作台', '人工工作台', '测试执行', '资产管理', '系统设置'];
    for (const groupName of navGroupNames) {
      await expect(moduleNav.getByRole('region', { name: groupName })).toBeVisible();
      const groupButton = moduleNav.getByRole('button', { name: groupName, exact: true });
      if (await groupButton.getAttribute('aria-expanded') === 'true') await groupButton.click();
      await expect(groupButton).toHaveAttribute('aria-expanded', 'false');
    }
    for (const groupName of navGroupNames) {
      const groupButton = moduleNav.getByRole('button', { name: groupName, exact: true });
      await groupButton.click();
      await expect(groupButton).toHaveAttribute('aria-expanded', 'true');
    }
    for (const moduleName of ['总览', '一键自动化', '测试套件', '执行监控', '项目管理', '用例管理', '测试报告', '功能配置', 'AI 配置']) {
      await expect(moduleNav.getByRole('button', { name: new RegExp(`^${moduleName}`) })).toBeVisible();
    }
    const executionGroupText = await moduleNav.getByRole('region', { name: '测试执行' }).innerText();
    expect(executionGroupText).toMatch(/测试套件[\s\S]*执行监控/);
    const assetGroupText = await moduleNav.getByRole('region', { name: '资产管理' }).innerText();
    expect(assetGroupText).toMatch(/项目管理[\s\S]*用例管理[\s\S]*测试报告/);
    expect(assetGroupText).not.toContain('测试套件');
    expect(assetGroupText).not.toContain('执行监控');
    const settingsGroupText = await moduleNav.getByRole('region', { name: '系统设置' }).innerText();
    expect(settingsGroupText).toMatch(/用户管理[\s\S]*AI 配置[\s\S]*功能配置/);
    await page.getByRole('button', { name: '收起左侧导航' }).click();
    await expect(moduleNav).toBeVisible();
    await expect(moduleNav.getByRole('button', { name: '总览', exact: true })).toBeVisible();
    await expect(moduleNav.getByRole('button', { name: '一键自动化', exact: true })).toBeVisible();
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
    for (const moduleName of ['需求工单', '用例设计', '探索实验室', '脚本工作台', '执行测试', '自愈诊断', '测试报告', '项目管理', '用例管理', '功能配置', 'AI 配置']) {
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
    await expect(dashboard).toContainText('测试总览');
    await expect(dashboard).toContainText('用例总数');
    await expect(dashboard).toContainText('执行成功率');
    await expect(dashboard).toContainText('失败用例');
    await expect(dashboard).toContainText('测试执行趋势');
    await expect(dashboard).toContainText('近 2 周');
    await expect(dashboard.locator('.trend-legend')).toContainText('通过');
    await expect(dashboard.locator('.trend-legend')).toContainText('失败');
    await expect(dashboard.locator('.trend-legend')).toContainText('总计');
    const trendShapeSummary = await dashboard.locator('.trend-line-chart').evaluate((svg) => {
      const seriesPaths = Array.from(svg.querySelectorAll('.trend-line path')).map((path) => ({
        d: path.getAttribute('d') || '',
        fill: getComputedStyle(path).fill,
      }));
      const areaLikeElements = svg.querySelectorAll('polygon, linearGradient, radialGradient, .trend-area, [data-testid="trend-area"]').length;
      return { seriesPaths, areaLikeElements };
    });
    expect(trendShapeSummary.seriesPaths).toHaveLength(3);
    expect(trendShapeSummary.seriesPaths.every((path) => path.d.includes(' C '))).toBeTruthy();
    expect(trendShapeSummary.seriesPaths.every((path) => path.fill === 'none')).toBeTruthy();
    expect(trendShapeSummary.areaLikeElements).toBe(0);
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
    await gotoModule(page, '功能配置');
    await expect(openedTabs.getByRole('tab', { name: '功能配置' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('workflow-context-bar')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '功能配置' })).toBeVisible();
    await gotoModule(page, '测试报告');
    await expect(openedTabs.getByRole('tab', { name: '测试报告' })).toHaveAttribute('aria-selected', 'true');
    await openedTabs.getByRole('tab', { name: '功能配置' }).click();
    await page.getByRole('button', { name: '页签更多操作' }).click();
    await page.getByRole('menuitem', { name: '关闭右侧' }).click();
    await expect(openedTabs.getByRole('tab', { name: '测试报告' })).toHaveCount(0);
    await expect(openedTabs.getByRole('tab', { name: '功能配置' })).toHaveAttribute('aria-selected', 'true');
    await gotoModule(page, '项目管理');
    await page.getByRole('button', { name: '页签更多操作' }).click();
    await page.getByRole('menuitem', { name: '关闭左侧' }).click();
    await expect(openedTabs.getByRole('tab', { name: '功能配置' })).toHaveCount(0);
    await expect(openedTabs.getByRole('tab', { name: '测试报告' })).toHaveCount(0);
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
    await gotoModule(page, '功能配置');
    await gotoModule(page, '测试报告');
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

  test('TC-PLAT-THEME-001 AI 测试连接成功提示在所有主题下清晰可读', async ({ page }) => {
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

  test('TC-PLAT-001C 功能配置以树形管理并支持用例绑定', async ({ page, request }) => {
    const project = await createE2EProject(request, 'E2E 功能菜单项目');
    const rootName = `用户中心 ${Date.now()}`;
    const childName = `密码登录 ${Math.random().toString(16).slice(2, 6)}`;
    const renamedChildName = `${childName} 已编辑`;
    const caseExternalId = `TC-FEATURE-${Date.now()}`;

    await page.goto(PLATFORM_URL);
    await gotoModule(page, '功能配置');
    const featureRegion = page.getByRole('region', { name: '功能配置' });
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

    await gotoModule(page, '功能配置');
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
    const suiteRow = suiteRegion.locator('.suite-table-row').filter({ hasText: suite.name });
    await expect(suiteRow.locator(':scope > span').nth(3)).toHaveText('2');

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
    await expect(suiteRow.locator(':scope > span').nth(3)).toHaveText('0', { timeout: 10_000 });
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
    const suiteRow = suiteRegion.locator('.suite-table-row').filter({ hasText: suiteName });
    await suiteRow.getByRole('button', { name: '查看详情' }).click();
    await expect(suiteRegion.getByRole('button', { name: '执行套件' })).toBeVisible();
    await expect(suiteRegion.getByRole('button', { name: '后续接入执行监控' })).toHaveCount(0);

    await suiteRegion.getByRole('button', { name: '执行套件' }).click();
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
    const monitorPreviewToggle = page.getByTestId('execution-monitor-browser-preview-toggle');
    await expect(monitorPreviewToggle).toHaveAttribute('aria-checked', 'false');
    await monitorPreviewToggle.click();
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
    await expect(page.getByRole('button', { name: /保存探索/ })).toBeDisabled();
    await expect(page.getByTestId('workflow-context-bar')).toContainText('页面探索');
  });

  test('TC-PLAT-005 探索实验室基于测试用例执行多步骤探索并确认元素', async ({ page }) => {
    test.setTimeout(90_000);

    // 创建任务并先保存测试用例，满足页面探索前置条件。
    await createWorkItem(page);
    await saveCases(page);

    // 点击执行探索后立即展示 WebSocket 实时浏览器控制台。
    const explorationPreviewToggle = page.getByTestId('exploration-browser-preview-toggle');
    await expect(explorationPreviewToggle).toHaveAttribute('aria-checked', 'false');
    await explorationPreviewToggle.click();
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
    await page.getByRole('button', { name: /^保存修改$/ }).click();
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

    // 脚本工作台只负责草稿编辑，不再承担最终产物发布。
    await gotoModule(page, '脚本工作台');
    await expect(page.getByRole('button', { name: /保存已验证产物/ })).toHaveCount(0);

    // 执行草稿 spec 并验证执行日志与 HTML report 入口。
    await gotoModule(page, '执行测试');
    await expect(page.getByRole('button', { name: /保存已验证产物/ })).toBeDisabled();
    const executionPreviewToggle = page.getByTestId('execution-browser-preview-toggle');
    await expect(executionPreviewToggle).toHaveAttribute('aria-checked', 'false');
    await executionPreviewToggle.click();
    await page.getByRole('button', { name: /执行当前任务/ }).click();
    await expect(page.getByTestId('execution-runtime')).toContainText('Live WebSocket', { timeout: 20_000 });
    await expect(page.getByTestId('log-panel')).toContainText('执行命令', { timeout: 20_000 });
    await expect(page.getByTestId('execution-browser-live-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('execution-runtime')).toContainText(/执行进度|100%/, { timeout: 20_000 });
    await expect(page.getByRole('link', { name: /Playwright HTML Report/ })).toBeVisible();
    await expect(page.getByTestId('log-panel')).toContainText(/执行完成，退出码|1 passed|failed/, { timeout: 45_000 });

    // 运行通过后直接在执行结果页保存最终产物，并进入当前工单的单用例报告。
    await expect(page.getByRole('button', { name: /保存已验证产物/ })).toBeEnabled();
    await page.getByRole('button', { name: /保存已验证产物/ }).click();
    const reports = page.getByRole('region', { name: '测试报告' });
    await expect(reports).toBeVisible({ timeout: 10_000 });
    await expect(reports.getByRole('heading', { name: '测试报告' })).toBeVisible();
    await expect(reports.getByRole('tab', { name: '用例执行报告' })).toHaveAttribute('aria-selected', 'true');
    await expect(reports.getByTestId('case-report-filters')).toBeVisible();
    await expect(reports.getByTestId('case-report-table')).toBeVisible();
    const firstReportRow = reports.locator('.report-table-row').first();
    await expect(firstReportRow.getByRole('button', { name: '详情' })).toBeVisible();
    await firstReportRow.getByRole('button', { name: '详情' }).click();
    await expect(page.getByRole('dialog', { name: /TC-/ }).last()).toBeVisible({ timeout: 10_000 });
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
    await expect(moduleNav.getByRole('button', { name: /^一键自动化/ })).toBeVisible();
    await gotoModule(page, '一键自动化');

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
    const automationPreviewToggle = page.getByTestId('automation-flow-browser-preview-toggle');
    await expect(automationPreviewToggle).toHaveAttribute('aria-checked', 'false');
    await automationPreviewToggle.click();
    const automationCanvas = page.getByTestId('automation-flow-browser-live-canvas');
    await expect(automationCanvas).toBeVisible();
    await expect.poll(async () => automationCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0), { timeout: 20_000 }).toBeTruthy();
    const fullscreenButton = page.getByTestId('automation-flow-browser-fullscreen');
    await expect(fullscreenButton).toBeVisible();
    await expect(fullscreenButton).toBeEnabled();
    await expect(page.getByTestId('automation-flow-browser-pause')).toHaveCount(0);
    await expect(page.getByTestId('automation-flow-browser-takeover')).toHaveCount(0);
    await expect(page.getByTestId('automation-flow-browser-resume')).toHaveCount(0);
    await expect(automationCanvas).toHaveAttribute('tabindex', '-1');
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
