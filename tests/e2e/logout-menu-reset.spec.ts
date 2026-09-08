import { expect, test } from '@playwright/test';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:5174';
const PLATFORM_ORIGIN = new URL(PLATFORM_URL).origin;
const AUTH_USER = {
  id: 'user-codex-logout-menu-reset',
  username: 'codex-logout-menu-reset',
  displayName: 'Codex Logout Reset',
  role: 'admin',
  status: 'active',
};

test('TC-CODEX-LOGOUT-MENU-RESET-001 退出后重新登录恢复默认菜单状态', async ({ page }) => {
  let authenticated = true;

  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('codex-logout-menu-reset-initialized')) {
      window.localStorage.clear();
      window.localStorage.setItem('qa-platform-theme', 'daylight');
      window.sessionStorage.setItem('codex-logout-menu-reset-initialized', 'true');
    }
  });

  await page.route(`${PLATFORM_ORIGIN}/api/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let payload: unknown = {};

    if (pathname === '/api/auth/me') {
      payload = { authenticated, user: authenticated ? AUTH_USER : null };
    } else if (pathname === '/api/auth/logout') {
      authenticated = false;
      payload = { status: 'ok' };
    } else if (pathname === '/api/auth/login') {
      authenticated = true;
      payload = { user: AUTH_USER };
    } else if (pathname === '/api/health') {
      payload = { status: 'ok', ai: { configured: false } };
    } else if (pathname === '/api/dashboard-summary') {
      payload = {
        totals: { projects: 0, workItems: 0, testCases: 0, suiteRuns: 0 },
        quality: { passRate: 0, failedCases: 0, automationCoverage: 0 },
        trends: [],
        recentWorkItems: [],
      };
    } else if ([
      '/api/projects',
      '/api/work-items',
      '/api/deliverables',
      '/api/runs',
      '/api/test-cases',
      '/api/test-suites',
      '/api/suite-runs',
      '/api/automation-flows',
    ].includes(pathname)) {
      payload = [];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PLATFORM_URL);

  const navigation = page.getByRole('navigation', { name: '平台模块' });
  const tabs = page.getByRole('tablist', { name: '已打开菜单' });
  await expect(navigation).toBeVisible();

  await navigation.getByRole('button', { name: '工作台', exact: true }).click();
  await navigation.getByRole('button', { name: '人工工作台', exact: true }).click();
  await navigation.getByRole('button', { name: /^需求工单/ }).click();
  await navigation.getByRole('button', { name: /^用例设计/ }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tabs.getByRole('tab', { name: '用例设计' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: '收起左侧导航' }).click();
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('debugSessionId', 'debug-codex-logout-reset');
    url.searchParams.set('caseId', 'case-codex-logout-reset');
    url.searchParams.set('module', 'scripts');
    url.searchParams.set('suiteView', 'detail');
    url.searchParams.set('suiteId', 'suite-codex-logout-reset');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  });

  await page.getByRole('button', { name: 'QA 用户菜单' }).click();
  await page.getByTestId('topbar-user-panel').getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('auth-panel')).toBeVisible();

  await expect.poll(() => page.evaluate(() => ({
    activeModule: window.localStorage.getItem('qa-platform-active-module'),
    openTabs: window.localStorage.getItem('qa-platform-open-module-tabs'),
  }))).toEqual({ activeModule: 'overview', openTabs: '["overview"]' });

  await page.getByPlaceholder('请输入登录名').fill('codex-logout-menu-reset');
  await page.getByPlaceholder('请输入密码').fill('CODEX_TEST_PASSWORD');
  await page.getByRole('button', { name: '登录', exact: true }).click();

  await expect(page.locator('.command-title-row h1')).toHaveText('总览');
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(tabs.getByRole('tab', { name: '总览' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '收起左侧导航' })).toBeVisible();
  for (const groupName of ['工作台', '人工工作台', '测试执行', '资产管理', '系统设置']) {
    await expect(navigation.getByRole('button', { name: groupName, exact: true })).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(page.locator('main.platform-shell')).toHaveAttribute('data-theme', 'daylight');
  await expect.poll(() => page.evaluate(() => window.location.search)).toBe('');

  await page.reload();
  await expect(page.locator('.command-title-row h1')).toHaveText('总览');
  await expect(page.getByRole('tablist', { name: '已打开菜单' }).getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: '总览' })).toHaveAttribute('aria-selected', 'true');
  for (const groupName of ['工作台', '人工工作台', '测试执行', '资产管理', '系统设置']) {
    await expect(page.getByRole('navigation', { name: '平台模块' }).getByRole('button', { name: groupName, exact: true })).toHaveAttribute('aria-expanded', 'false');
  }

  await page.evaluate(() => {
    window.localStorage.setItem('qa-platform-active-module', 'scripts');
    window.localStorage.setItem('qa-platform-open-module-tabs', '["overview","scripts"]');
  });
  authenticated = false;
  await page.reload();
  await expect(page.getByTestId('auth-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    activeModule: window.localStorage.getItem('qa-platform-active-module'),
    openTabs: window.localStorage.getItem('qa-platform-open-module-tabs'),
  }))).toEqual({ activeModule: 'overview', openTabs: '["overview"]' });
});
