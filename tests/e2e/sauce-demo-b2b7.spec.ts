import { expect, test } from '@playwright/test';

test.describe('Sauce Demo 登录与购物流程', () => {
  test('TC-SAUCE-DEMO-B2B7-001 主流程满足验收标准', async ({ page }) => {
    // 打开需求指定目标页面，建立可重复的测试前置状态。
    await page.goto('https://www.saucedemo.com');

    // 使用 Sauce Demo 稳定的 data-test selector 完成登录。
    await page.locator('[data-test="username"]').fill('standard_user');
    await page.locator('[data-test="password"]').fill('secret_sauce');
    await page.locator('[data-test="login-button"]').click();

    // 验证登录成功进入商品页。
    await expect(page.locator('[data-test="title"]')).toHaveText('Products', { timeout: 10_000 });

    // 覆盖核心购物流程：添加指定商品并进入购物车。
    await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
    await page.locator('[data-test="shopping-cart-link"]').click();
    const cartItem = page.locator('[data-test="inventory-item"]').filter({ hasText: 'Sauce Labs Backpack' });
    await expect(cartItem.locator('[data-test="inventory-item-name"]')).toHaveText('Sauce Labs Backpack');

    // 触发低风险必填校验错误态，不提交订单。
    await page.locator('[data-test="checkout"]').click();
    await page.locator('[data-test="continue"]').click();
    await expect(page.locator('[data-test="error"]')).toContainText('First Name is required');
  });
});
