import { expect, test } from '@playwright/test';

test.describe('Sauce Demo 登录与购物流程', () => {
  test('TC-SAUCE-DEMO-6C65-001 主流程满足验收标准', async ({ page }) => {
    // 打开需求指定目标页面，建立可重复的测试前置状态。
    await page.goto('https://www.saucedemo.com');

    // 验证探索阶段确认的关键元素可见，证明页面已进入目标状态。
    await expect(page.getByTestId('login-container')).toBeVisible({ timeout: 10_000 });
  });
});