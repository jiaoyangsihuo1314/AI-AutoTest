import { expect, type Page, test } from 'playwright/test';

const APP_ROOT = (process.env.ZZPSS_APP_ROOT ?? 'http://192.168.7.180:12222/zzpss').replace(/\/$/, '');
const USERNAME = process.env.ZZPSS_USERNAME ?? 'lining';
const PASSWORD = process.env.ZZPSS_PASSWORD;
const DISPLAY_NAME = process.env.ZZPSS_DISPLAY_NAME ?? '李宁';

const HOME_API_PATHS = [
  '/api/zzhlkj/homePage/getBasicInformationData',
  '/api/zzhlkj/homePage/getWorkOrderCenterData',
  '/api/zzhlkj/homePage/getLineLossManagementData',
  '/api/zzhlkj/homePage/getAbnormalAlarmData',
];

async function openLoginPage(page: Page) {
  // 打开登录页，建立每个场景的可重复初始状态。
  await page.goto(`${APP_ROOT}/#/login`, { waitUntil: 'domcontentloaded' });

  // 验证登录页标题和表单入口已渲染。
  await expect(page).toHaveTitle('供电所运检业务RPA小助手');
  await expect(page.getByText('用户登录', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('请输入用户名称')).toBeVisible();
  await expect(page.getByPlaceholder('请输入登录密码')).toBeVisible();
}

async function login(page: Page, options: { waitForHomeApis?: boolean } = {}) {
  if (!PASSWORD) {
    throw new Error('请通过 Zzpss 测试环境变量 ZZPSS_PASSWORD 提供登录密码。');
  }

  await openLoginPage(page);

  // 输入用户提供的有效账号信息，推进登录流程。
  await page.getByPlaceholder('请输入用户名称').fill(USERNAME);
  await page.getByPlaceholder('请输入登录密码').fill(PASSWORD);

  // 登录前注册接口等待，确保断言覆盖后端登录结果。
  const loginResponse = page.waitForResponse(
    response => response.url().includes('/login/eco-system/user/login') && response.status() === 200,
    { timeout: 15_000 },
  );

  // 首页冒烟场景额外监听关键首页接口，确认看板数据请求成功。
  const homeResponses = options.waitForHomeApis
    ? HOME_API_PATHS.map(path =>
        page.waitForResponse(response => response.url().includes(path) && response.status() === 200, {
          timeout: 25_000,
        }),
      )
    : [];

  // 点击已确认的登录入口，并等待路由进入首页。
  await page.locator('.login-button', { hasText: '登录' }).click();
  expect((await loginResponse).ok()).toBeTruthy();
  await page.waitForURL(/#\/home$/, { timeout: 20_000 });

  // 验证首页用户身份和导航已出现，证明登录态生效。
  await expect(page.getByText(`欢迎您，${DISPLAY_NAME}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.menu-item.menu-active').filter({ hasText: '首页' })).toBeVisible();

  // 等待首页关键接口全部成功，避免只检查静态框架。
  await Promise.all(homeResponses);
}

async function expectHomeDashboard(page: Page) {
  // 验证顶部导航入口完整展示。
  for (const menuName of ['首页', '数智运检', '线损管理', '停电监控', '电能质量', '工单中心', '供电可靠性', '台账维护']) {
    await expect(page.getByText(menuName, { exact: true }).first()).toBeVisible();
  }

  // 验证首页核心看板模块可见。
  for (const sectionName of ['基本情况', '重过载监视', '设备停运', '电能质量', '工单中心', '线损管理', '异常告警']) {
    await expect(page.getByText(sectionName, { exact: true }).first()).toBeVisible();
  }

  // 验证关键指标标签与地图图例出现，证明首页数据区已加载。
  for (const metricName of ['10kV线路', '0.4kV线路', '供电台区', '高压用户', '低压用户', '抢修工单', '正常', '故障']) {
    await expect(page.getByText(metricName, { exact: true }).first()).toBeVisible();
  }
}

test.describe('供电所运检业务RPA小助手登录、首页与退出功能', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.setTimeout(60_000);

  test('TC-ZZPSS-001 有效账号可以登录系统', async ({ page }) => {
    // 使用有效账号完成登录，验证路由进入首页。
    await login(page);
    await expect(page).toHaveURL(/#\/home$/);

    // 验证首页标题、欢迎语和活跃菜单，证明登录后进入正确业务页面。
    await expect(page.getByText('供电所运检业务RPA小助手', { exact: true })).toBeVisible();
    await expect(page.getByText(`欢迎您，${DISPLAY_NAME}`)).toBeVisible();
    await expect(page.locator('.menu-item.menu-active').filter({ hasText: '首页' })).toBeVisible();
  });

  test('TC-ZZPSS-002 首页关键模块和数据接口正常加载', async ({ page }) => {
    // 登录并等待首页关键数据接口返回成功。
    await login(page, { waitForHomeApis: true });

    // 断言首页导航、看板模块、关键指标和图例均已渲染。
    await expectHomeDashboard(page);
  });

  test('TC-ZZPSS-003 用户可以确认退出登录', async ({ page }) => {
    // 先登录到首页，为退出操作准备已认证状态。
    await login(page);

    // 悬浮右上角用户信息，展开用户菜单。
    await page.locator('.login-info').hover();
    await expect(page.locator('.login-info .box')).toBeVisible();
    await expect(page.locator('.login-info .item', { hasText: '退出登录' })).toBeVisible();

    // 点击退出入口，验证系统弹出二次确认框。
    await page.locator('.login-info .item', { hasText: '退出登录' }).click();
    await expect(page.locator('.el-message-box')).toBeVisible();
    await expect(page.getByText('您是否确认退出登录?', { exact: true })).toBeVisible();

    // 确认退出，并等待退出接口成功返回。
    const logoutResponse = page.waitForResponse(
      response => response.url().includes('/login/eco-system/user/logout') && response.status() === 200,
      { timeout: 15_000 },
    );
    await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click();
    expect((await logoutResponse).ok()).toBeTruthy();

    // 验证退出后回到登录页，并展示退出成功反馈。
    await page.waitForURL(/#\/login$/, { timeout: 15_000 });
    await expect(page.getByText('用户登录', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('请输入用户名称')).toBeVisible();
    await expect(page.getByText('退出登录成功！')).toBeVisible({ timeout: 10_000 });
  });
});
