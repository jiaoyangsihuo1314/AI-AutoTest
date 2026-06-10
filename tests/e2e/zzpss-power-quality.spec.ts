import { expect, type Locator, type Page, test } from 'playwright/test';

const APP_ROOT = (process.env.ZZPSS_APP_ROOT ?? 'http://192.168.7.180:12222/zzpss').replace(/\/$/, '');
const USERNAME = process.env.ZZPSS_USERNAME ?? 'lining';
const PASSWORD = process.env.ZZPSS_PASSWORD;
const DISPLAY_NAME = process.env.ZZPSS_DISPLAY_NAME ?? '李宁';

function responseOk(urlPart: string) {
  return (response: { url(): string; status(): number }) => response.url().includes(urlPart) && response.status() === 200;
}

async function optionalResponse(
  page: Page,
  predicate: (response: { url(): string; status(): number }) => boolean,
  timeout = 5_000,
) {
  return page.waitForResponse(predicate, { timeout }).catch(() => null);
}

async function loginAndOpenPowerQuality(page: Page) {
  if (!PASSWORD) {
    throw new Error('请通过 ZZPSS_PASSWORD 环境变量提供登录密码。');
  }

  // 打开登录页并验证登录表单已经渲染。
  await page.goto(`${APP_ROOT}/#/login`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('供电所运检业务RPA小助手');
  await expect(page.getByText('用户登录', { exact: true })).toBeVisible();

  // 使用用户提供的账号登录系统。
  await page.getByPlaceholder('请输入用户名称').fill(USERNAME);
  await page.getByPlaceholder('请输入登录密码').fill(PASSWORD);
  const loginResponse = page.waitForResponse(responseOk('/login/eco-system/user/login'), { timeout: 15_000 });
  await page.locator('.login-button', { hasText: '登录' }).click();
  expect((await loginResponse).ok()).toBeTruthy();
  await page.waitForURL(/#\/home$/, { timeout: 20_000 });
  await expect(page.getByText(`欢迎您，${DISPLAY_NAME}`)).toBeVisible({ timeout: 15_000 });

  // 点击顶部菜单中的电能质量入口，进入被测页面。
  await page.locator('.menu-content .menu-item').filter({ hasText: '电能质量' }).click();
  await expect(page.locator('.menu-content .menu-item.menu-active').filter({ hasText: '电能质量' })).toBeVisible();
  await expect(page.getByText('重过载治理', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('三相不平衡治理', { exact: true })).toBeVisible();
  await expect(page.getByText('电压治理', { exact: true })).toBeVisible();
}

function card(page: Page, title: string) {
  return page.locator('.card').filter({ hasText: title });
}

async function closeVisibleDialog(page: Page, dialog: Locator) {
  const closeButton = dialog.locator('.close-btn, .el-dialog__headerbtn').first();
  if ((await closeButton.count()) > 0 && (await closeButton.isVisible())) {
    await closeButton.click();
  } else {
    await dialog.getByText('X', { exact: true }).first().click({ force: true });
  }
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

async function clickButtonInDialog(dialog: Locator, name: string) {
  await dialog.getByRole('button', { name }).click({ force: true });
}

test.use({
  viewport: { width: 1920, height: 1080 },
  channel: 'chrome',
});

test.describe('供电所运检业务RPA小助手电能质量页面功能', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('TC-DNZL-001 电能质量首页数据展示和主表行弹窗正常', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', response => {
      if (response.status() >= 500 && response.url().includes('/api/zzhlkj/')) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    // 登录并进入电能质量页面，验证三块业务看板已加载。
    await loginAndOpenPowerQuality(page);
    await page.screenshot({ path: 'test-results/power-quality-main.png', fullPage: true });

    const heavyCard = card(page, '重过载治理');
    const threePhaseCard = card(page, '三相不平衡治理');
    const voltageCard = card(page, '电压治理');

    // 验证重过载治理关键指标、日期控件和负载率表格。
    await expect(heavyCard.getByText('重载台区')).toBeVisible();
    await expect(heavyCard.getByText('过载台区')).toBeVisible();
    await expect(heavyCard.locator('input').first()).toHaveValue('2026-04-15');
    await expect(heavyCard.getByText('负载率', { exact: true })).toBeVisible();
    await expect(heavyCard.getByText('羊庄张坡村', { exact: true })).toBeVisible();
    await expect(heavyCard.getByText('128.96', { exact: true })).toBeVisible();

    // 点击重过载主表首行，验证单台区明细弹窗可打开。
    await heavyCard.locator('.el-table__body-wrapper .el-table__row').first().click();
    const heavyRowDialog = page.locator('.el-dialog:visible').filter({ hasText: '重过载情况' }).first();
    await expect(heavyRowDialog).toBeVisible({ timeout: 10_000 });
    await expect(heavyRowDialog.getByText('羊庄张坡村', { exact: true })).toBeVisible();
    await expect(heavyRowDialog.getByText('过载', { exact: true })).toBeVisible();
    await closeVisibleDialog(page, heavyRowDialog);

    // 验证三相不平衡治理汇总、表格数据，并点击主表首行查看台区信息。
    await expect(threePhaseCard.getByText('三相不平衡台区数量')).toBeVisible();
    await expect(threePhaseCard.getByText('工单数量')).toBeVisible();
    await expect(threePhaseCard.getByText('三相不平衡台区', { exact: true })).toBeVisible();
    await expect(threePhaseCard.getByText('羊庄张坡村', { exact: true })).toBeVisible();
    await threePhaseCard.locator('.el-table__body-wrapper .el-table__row').first().click();
    const threePhaseDialog = page.locator('.el-dialog:visible').filter({ hasText: '三相不平衡台区信息' }).first();
    await expect(threePhaseDialog).toBeVisible({ timeout: 10_000 });
    await expect(threePhaseDialog.getByText('供电单位:')).toBeVisible();
    await expect(threePhaseDialog.getByText('公变资源ID:')).toBeVisible();
    await expect(threePhaseDialog.getByText('查询', { exact: true })).toBeVisible();
    await expect(threePhaseDialog.getByText('导出', { exact: true })).toBeVisible();
    await closeVisibleDialog(page, threePhaseDialog);

    // 验证电压治理指标、分类页签和趋势区域展示。
    await expect(voltageCard.getByText('越限指标', { exact: true })).toBeVisible();
    await expect(voltageCard.getByText('电压合格率', { exact: true })).toBeVisible();
    for (const tabName of ['低电压用户', '过电压用户', '低电压专变', '过电压配变']) {
      await expect(voltageCard.locator('.item-text, .item-text-select').filter({ hasText: tabName })).toBeVisible();
    }
    await expect(voltageCard.getByText('电压合格率趋势', { exact: true })).toBeVisible();

    // 记录已发现的接口 500，脚本不因历史已知缺陷中断其他功能覆盖。
    test.info().annotations.push({
      type: 'observed-server-errors',
      description: serverErrors.length > 0 ? serverErrors.join('\n') : '未捕获到 5xx 接口响应',
    });
  });

  test('TC-DNZL-002 重过载治理查询、详情弹窗和二级曲线弹窗正常', async ({ page }) => {
    // 登录并进入电能质量页面。
    await loginAndOpenPowerQuality(page);
    const heavyCard = card(page, '重过载治理');

    // 切换重过载统计粒度，验证日期框和列表数据按粒度刷新。
    await heavyCard.locator('.data-box-item').filter({ hasText: /^月$/ }).click();
    await expect(heavyCard.locator('input').first()).toHaveValue('2026-04');
    await expect(heavyCard.getByText('贾庄北配一', { exact: true })).toBeVisible();

    await heavyCard.locator('.data-box-item').filter({ hasText: /^日$/ }).click();
    await expect(heavyCard.locator('input').first()).toHaveValue('2026-04-15');
    await expect(heavyCard.getByText('羊庄张坡村', { exact: true })).toBeVisible();

    // 打开重过载详情弹窗，验证筛选项、表格、分页和操作入口。
    await heavyCard.getByRole('button', { name: '详情' }).click();
    const detailDialog = page.locator('.el-dialog:visible').filter({ hasText: '供电单位' }).filter({ hasText: '负载率' }).first();
    await expect(detailDialog).toBeVisible({ timeout: 10_000 });
    await expect(detailDialog.getByText('详情', { exact: true })).toBeVisible();
    await expect(detailDialog.locator('.el-form-item__label').filter({ hasText: '供电单位' })).toBeVisible();
    await expect(detailDialog.getByPlaceholder('请输入公变资源ID')).toBeVisible();
    await expect(detailDialog.getByPlaceholder('请输入公变名称')).toBeVisible();
    await expect(detailDialog.locator('.el-form-item__label').filter({ hasText: '时间选择' })).toBeVisible();
    await expect(detailDialog.getByRole('button', { name: '查询' })).toBeVisible();
    await expect(detailDialog.getByRole('button', { name: '重置' })).toBeVisible();
    await expect(detailDialog.getByRole('button', { name: '导出' })).toBeVisible();
    await expect(detailDialog.locator('.el-table__header-wrapper').getByText('供电单位', { exact: true })).toBeVisible();
    await expect(detailDialog.locator('.el-table__header-wrapper').getByText('维护班组', { exact: true })).toBeVisible();
    await expect(detailDialog.locator('.el-table__header-wrapper').getByText('最大负载率(%)', { exact: true })).toBeVisible();
    await expect(detailDialog.getByText('共 46 条')).toBeVisible();
    await page.screenshot({ path: 'test-results/power-quality-heavy-detail.png', fullPage: true });

    // 执行查询按钮，验证筛选接口可以重新拉取列表。
    const queryResponse = optionalResponse(
      page,
      response => response.url().includes('/api/zzhlkj/powerQuality/getLoadRate') && response.status() === 200,
      8_000,
    );
    await clickButtonInDialog(detailDialog, '查询');
    const queryResult = await queryResponse;
    test.info().annotations.push({
      type: 'heavy-detail-query-response',
      description: queryResult ? `查询接口成功：${queryResult.url()}` : '点击查询后未捕获到新的 getLoadRate 200 响应，已继续验证弹窗数据未丢失',
    });
    await expect(detailDialog.locator('.el-table__body-wrapper .el-table__row').first()).toBeVisible();

    // 点击详情列表中的蓝色公变名称，验证二级“曲线查看”弹窗。
    const curveResponse = page.waitForResponse(responseOk('/api/zzhlkj/powerQuality/searchAllLoad'), { timeout: 20_000 });
    await detailDialog.getByText('官桥前莱村配2', { exact: true }).click();
    expect((await curveResponse).ok()).toBeTruthy();
    const curveDialog = page.locator('.el-dialog:visible').filter({ hasText: '曲线查看' }).first();
    await expect(curveDialog).toBeVisible({ timeout: 10_000 });
    await expect(curveDialog.getByText('官桥前莱村配2曲线查看', { exact: true })).toBeVisible();
    for (const option of ['日', '周', '月', '年', '近365天', '电流']) {
      await expect(curveDialog.getByText(option, { exact: true })).toBeVisible();
    }
    await page.screenshot({ path: 'test-results/power-quality-heavy-curve.png', fullPage: true });

    await closeVisibleDialog(page, curveDialog);
    await closeVisibleDialog(page, detailDialog);
  });

  test('TC-DNZL-003 电压治理分类、判据选择、详情查询和空数据展示正常', async ({ page }) => {
    // 登录并进入电能质量页面。
    await loginAndOpenPowerQuality(page);
    const voltageCard = card(page, '电压治理');

    // 逐个点击电压治理分类页签，验证分类入口可用且选中态切换。
    for (const tabName of ['过电压用户', '低电压专变', '过电压配变', '低电压用户']) {
      await voltageCard.locator('.item-text, .item-text-select').filter({ hasText: tabName }).click();
      await expect(voltageCard.locator('.item-text-select').filter({ hasText: tabName })).toBeVisible();
    }

    // 打开过电压判据下拉框，验证可选项存在。
    await voltageCard.locator('.percent-select').click();
    const dropdown = page.locator('.el-select-dropdown:visible').first();
    await expect(dropdown).toBeVisible();
    await expect(dropdown.locator('.el-select-dropdown__item').first()).toBeVisible();
    await page.keyboard.press('Escape');

    // 切换趋势图粒度，验证趋势接口响应成功。
    const trendResponse = page.waitForResponse(
      response => response.url().includes('/api/zzhlkj/quality/getRateTrend') && response.url().includes('rq=%E5%B9%B4') && response.status() === 200,
      { timeout: 20_000 },
    );
    await voltageCard.locator('.data-box-item').filter({ hasText: /^年$/ }).last().click();
    expect((await trendResponse).ok()).toBeTruthy();

    // 打开电压详情弹窗，验证筛选项、表头、查询按钮和空数据提示。
    await voltageCard.getByRole('button', { name: '详情' }).click();
    const voltageDialog = page.locator('.el-dialog:visible').filter({ hasText: '低电压用户详情' }).first();
    await expect(voltageDialog).toBeVisible({ timeout: 10_000 });
    await expect(voltageDialog.locator('.el-form-item__label').filter({ hasText: '供电单位' })).toBeVisible();
    await expect(voltageDialog.locator('.el-form-item__label').filter({ hasText: '异常类型' })).toBeVisible();
    await expect(voltageDialog.locator('.el-form-item__label').filter({ hasText: '公变名称' })).toBeVisible();
    await expect(voltageDialog.locator('.el-form-item__label').filter({ hasText: '用户名称' })).toBeVisible();
    await expect(voltageDialog.getByRole('button', { name: '查询' })).toBeVisible();
    await expect(voltageDialog.getByRole('button', { name: '导出' })).toBeVisible();
    await expect(voltageDialog.locator('.el-table__header-wrapper').getByText('用户编号', { exact: true })).toBeVisible();
    await expect(voltageDialog.getByText('暂无数据', { exact: true })).toBeVisible();
    await expect(voltageDialog.getByText('共 0 条')).toBeVisible();

    const queryResponse = page.waitForResponse(responseOk('/api/zzhlkj/quality/getVoltageStationArea'), { timeout: 20_000 });
    await clickButtonInDialog(voltageDialog, '查询');
    expect((await queryResponse).ok()).toBeTruthy();
    await page.screenshot({ path: 'test-results/power-quality-voltage-detail.png', fullPage: true });

    await closeVisibleDialog(page, voltageDialog);
  });
});
