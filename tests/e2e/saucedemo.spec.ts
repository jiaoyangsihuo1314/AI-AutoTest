import { expect, type Page, test } from 'playwright/test';

const VALID_PASSWORD = 'secret_sauce';
const STANDARD_USER = 'standard_user';

async function login(page: Page, username = STANDARD_USER, password = VALID_PASSWORD) {
  // 打开登录页，作为每个场景的可重复前置状态。
  await page.goto('/');

  // 输入已确认的测试用户名和密码，推进登录操作。
  await page.getByPlaceholder('Username').fill(username);
  await page.getByPlaceholder('Password').fill(password);

  // 提交登录表单，并等待后续页面或错误状态出现。
  await page.locator('[data-test="login-button"]').click();
}

test.describe('Sauce Demo 登录与电商流程', () => {
  test('TC-001 标准用户可以登录、加购、结账并完成订单', async ({ page }) => {
    // 使用标准用户登录，验证可进入商品列表页。
    await login(page);
    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(page.locator('[data-test="title"]')).toHaveText('Products');

    // 确认目标商品信息可见，避免只验证页面打开。
    const backpackItem = page
      .locator('[data-test="inventory-item"]')
      .filter({ hasText: 'Sauce Labs Backpack' });
    await expect(backpackItem.locator('[data-test="inventory-item-price"]')).toHaveText('$29.99');

    // 将商品加入购物车，验证按钮状态和购物车数量变化。
    await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
    await expect(page.locator('[data-test="remove-sauce-labs-backpack"]')).toHaveText('Remove');
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');

    // 进入购物车，确认商品名称、数量和价格与商品页一致。
    await page.locator('[data-test="shopping-cart-link"]').click();
    await expect(page).toHaveURL(/\/cart\.html$/);
    const cartItem = page.locator('[data-test="inventory-item"]').filter({ hasText: 'Sauce Labs Backpack' });
    await expect(cartItem.locator('[data-test="item-quantity"]')).toHaveText('1');
    await expect(cartItem.locator('[data-test="inventory-item-price"]')).toHaveText('$29.99');

    // 从购物车进入结账信息页，验证结账入口可用。
    await page.locator('[data-test="checkout"]').click();
    await expect(page).toHaveURL(/\/checkout-step-one\.html$/);
    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Your Information');

    // 填写结账必填信息，为订单概览页准备完整数据。
    await page.locator('[data-test="firstName"]').fill('Ada');
    await page.locator('[data-test="lastName"]').fill('Lovelace');
    await page.locator('[data-test="postalCode"]').fill('94016');
    await page.locator('[data-test="continue"]').click();

    // 验证订单概览展示商品、税费和总价。
    await expect(page).toHaveURL(/\/checkout-step-two\.html$/);
    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Overview');
    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText('Sauce Labs Backpack');
    await expect(page.locator('[data-test="subtotal-label"]')).toHaveText('Item total: $29.99');
    await expect(page.locator('[data-test="tax-label"]')).toHaveText('Tax: $2.40');
    await expect(page.locator('[data-test="total-label"]')).toHaveText('Total: $32.39');

    // 完成订单，验证成功页确认文案。
    await page.locator('[data-test="finish"]').click();
    await expect(page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Complete!');
    await expect(page.locator('[data-test="complete-header"]')).toHaveText('Thank you for your order!');
  });

  test('TC-002 无效密码会阻止登录并展示错误提示', async ({ page }) => {
    // 使用有效用户名和错误密码提交登录。
    await login(page, STANDARD_USER, 'wrong_password');

    // 验证仍停留在登录页，并展示账号密码不匹配错误。
    await expect(page).toHaveURL(/saucedemo\.com\/?$/);
    await expect(page.locator('[data-test="error"]')).toHaveText(
      'Epic sadface: Username and password do not match any user in this service',
    );
  });

  test('TC-003 锁定用户无法登录并展示锁定提示', async ({ page }) => {
    // 使用站点提供的锁定用户提交登录。
    await login(page, 'locked_out_user');

    // 验证锁定账号被拒绝，且错误信息明确指向锁定状态。
    await expect(page).toHaveURL(/saucedemo\.com\/?$/);
    await expect(page.locator('[data-test="error"]')).toHaveText(
      'Epic sadface: Sorry, this user has been locked out.',
    );
  });

  test('TC-004 购物车可以移除已加入商品', async ({ page }) => {
    // 登录后将指定商品加入购物车。
    await login(page);
    await expect(page).toHaveURL(/\/inventory\.html$/);
    await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');

    // 打开购物车并移除商品，验证购物车恢复为空。
    await page.locator('[data-test="shopping-cart-link"]').click();
    await expect(page).toHaveURL(/\/cart\.html$/);
    await page.locator('[data-test="remove-sauce-labs-backpack"]').click();
    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(0);
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
  });

  test('TC-005 结账信息缺失时会展示必填校验', async ({ page }) => {
    // 登录并添加商品，进入结账信息页。
    await login(page);
    await expect(page).toHaveURL(/\/inventory\.html$/);
    await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
    await page.locator('[data-test="shopping-cart-link"]').click();
    await page.locator('[data-test="checkout"]').click();
    await expect(page).toHaveURL(/\/checkout-step-one\.html$/);

    // 不填写任何信息直接继续，触发首个必填字段校验。
    await page.locator('[data-test="continue"]').click();
    await expect(page.locator('[data-test="error"]')).toHaveText('Error: First Name is required');

    // 补充姓名但保留邮编为空，验证后续必填字段校验。
    await page.locator('[data-test="firstName"]').fill('Ada');
    await page.locator('[data-test="lastName"]').fill('Lovelace');
    await page.locator('[data-test="continue"]').click();
    await expect(page.locator('[data-test="error"]')).toHaveText('Error: Postal Code is required');
  });

  test('TC-006 登出后受保护商品页不可继续访问', async ({ page }) => {
    // 标准用户登录后验证商品页已加载。
    await login(page);
    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(page.locator('[data-test="title"]')).toHaveText('Products');

    // 打开菜单并登出，确认回到登录页。
    await page.getByRole('button', { name: 'Open Menu' }).click();
    await page.locator('[data-test="logout-sidebar-link"]').click();
    await expect(page).toHaveURL(/saucedemo\.com\/?$/);
    await expect(page.locator('[data-test="login-button"]')).toHaveValue('Login');

    // 直接访问受保护页面，验证未登录状态会被拦截。
    await page.goto('/inventory.html');
    await expect(page.locator('[data-test="error"]')).toHaveText(
      "Epic sadface: You can only access '/inventory.html' when you are logged in.",
    );
  });
});
