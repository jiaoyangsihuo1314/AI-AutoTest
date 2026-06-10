import { expect, test } from '@playwright/test';

test.describe('平台生成脚本演示', () => {
  test('TC-DEMO-001 登录页关键元素可见', async ({ page }) => {
    // 打开目标登录页，建立可重复的测试前置状态。
    await page.goto('https://www.saucedemo.com');

    // 验证用户名输入框可见，证明登录表单加载完成。
    await expect(page.getByPlaceholder('Username')).toBeVisible({ timeout: 10_000 });
  });
});