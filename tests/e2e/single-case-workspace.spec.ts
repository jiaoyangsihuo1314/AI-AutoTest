import { expect, type Page, test } from '@playwright/test';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:5174';

async function gotoModule(page: Page, group: string, module: string) {
  const navigation = page.getByRole('navigation', { name: '平台模块' });
  const groupButton = navigation.getByRole('button', { name: group, exact: true });
  if (await groupButton.getAttribute('aria-expanded') === 'false') await groupButton.click();
  await navigation.getByRole('button', { name: new RegExp(`^${module}`) }).click();
}

test('TC-CODEX-SINGLE-WORKSPACE-001 从用例管理进入严格单用例全链路工作区', async ({ page }) => {
  page.on('pageerror', (error) => console.error(`PAGE_ERROR: ${error.message}`));
  page.on('console', (message) => console.log(`BROWSER_${message.type().toUpperCase()}: ${message.text()}`));
  page.on('requestfailed', (request) => console.error(`REQUEST_FAILED: ${request.url()} ${request.failure()?.errorText}`));
  const project = { id: 'project-codex-single', name: 'CODEX_TEST_20260902_SINGLE', status: 'active', environments: [] };
  const feature = { id: 'feature-codex-single', projectId: project.id, name: '登录', path: '登录', isActive: true };
  const selectedCase = {
    id: 'case-codex-single-001', projectId: project.id, workItemId: 'work-codex-single', featureId: feature.id,
    externalId: 'TC-CODEX-SINGLE-001', title: '当前用例', priority: 'P0', requirement: '验证当前用例',
    preconditions: '无', steps: '打开页面', expected: '页面显示', automationNotes: '自动化', updatedAt: '2026-09-02T01:00:00Z',
  };
  const otherCase = { ...selectedCase, id: 'case-codex-single-002', externalId: 'TC-CODEX-SINGLE-002', title: '其他用例', priority: 'P1' };
  const markdown = '| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| TC-CODEX-SINGLE-001 | P0 | 当前用例 | 验证当前用例 | 无 | 打开页面 | 页面显示 | 自动化 |\n';
  const scriptVersion = {
    id: 'script-codex-single', caseId: selectedCase.id, externalId: selectedCase.externalId, version: 1,
    status: 'draft', scriptLayout: 'shared-spec', caseDefinitionHash: 'draft-hash',
    content: "import { test, expect } from '@playwright/test'; test('TC-CODEX-SINGLE-001 当前用例', async ({ page }) => { await expect(page.locator('body')).toBeVisible(); });",
    outdated: true,
  };
  const scopedWorkItem = {
    id: selectedCase.workItemId, projectId: project.id, featureId: feature.id, title: '单用例工单', requirement: '验证当前用例',
    targetUrl: 'https://example.test', status: 'draft', stage: '用例设计', assetMode: 'refresh', caseIds: [selectedCase.id],
    casesMarkdown: markdown, casesRevisionId: 11, testCases: [selectedCase], scriptVersions: [scriptVersion], scriptContent: scriptVersion.content,
    requirementAnalysis: { goal: '验证当前用例', acceptance: '页面显示' }, projectContext: { testDir: 'tests/e2e', specPattern: '*.spec.ts', locatorStyle: 'role' },
  };
  const debugSession = {
    id: 'debug-codex-single', projectId: project.id, workItemId: scopedWorkItem.id, caseId: selectedCase.id,
    caseRevisionId: 11, caseDefinitionHash: 'draft-hash', sourceCaseDefinitionHash: 'source-hash', executionPolicy: 'strict-single',
    sourceScriptVersionId: scriptVersion.id, currentScriptVersionId: scriptVersion.id, sharedScriptDebug: true,
    debugGrepPattern: '^TC-CODEX-SINGLE-001 当前用例$', dependencyExecution: {
      recommendation: 'group', defaultScope: 'single', externalIds: [selectedCase.externalId, otherCase.externalId], manualChoiceRequired: false, strictSingle: true,
    },
    latestRunId: '', latestExplorationRunId: '', status: 'draft', stale: false, scriptOutdated: false,
    case: selectedCase, sourceCase: selectedCase, draftCaseMarkdown: markdown, exploration: { notes: '', elements: [] },
    currentScriptVersion: scriptVersion, sourceScriptVersion: scriptVersion, latestRun: null, latestExplorationRun: null, workItem: scopedWorkItem,
  };
  let savedDraftBody = '';

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let payload: unknown = {};
    if (url.pathname === '/api/auth/me') payload = { authenticated: true, user: { id: 'admin', username: 'admin', displayName: 'Admin', role: 'admin', status: 'active' } };
    else if (url.pathname === '/api/health') payload = { status: 'ok', ai: { configured: true } };
    else if (url.pathname === '/api/projects') payload = [project];
    else if (url.pathname === '/api/work-items') payload = [scopedWorkItem];
    else if (url.pathname === `/api/work-items/${scopedWorkItem.id}`) payload = scopedWorkItem;
    else if (url.pathname === '/api/test-cases') payload = [selectedCase, otherCase];
    else if (url.pathname === `/api/features`) payload = { items: [feature], tree: [feature] };
    else if (url.pathname === `/api/test-cases/${selectedCase.id}/debug-sessions`) payload = debugSession;
    else if (url.pathname === `/api/case-debug-sessions/${debugSession.id}`) payload = debugSession;
    else if (url.pathname === `/api/case-debug-sessions/${debugSession.id}/case-draft`) {
      const body = route.request().postDataJSON() as { content: string };
      savedDraftBody = body.content;
      const savedMarkdown = body.content;
      const savedCase = { ...selectedCase, title: '当前用例草稿' };
      payload = { ...debugSession, caseRevisionId: 12, case: savedCase, draftCaseMarkdown: savedMarkdown, workItem: { ...scopedWorkItem, casesRevisionId: 12, casesMarkdown: savedMarkdown, testCases: [savedCase] } };
    }
    else if (url.pathname === '/api/dashboard-summary') payload = { totals: {}, quality: {}, trends: [], recentWorkItems: [] };
    else if (url.pathname === '/api/deliverables' || url.pathname === '/api/runs' || url.pathname === '/api/test-suites' || url.pathname === '/api/suite-runs' || url.pathname === '/api/automation-flows') payload = [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  await page.goto(PLATFORM_URL);
  await gotoModule(page, '资产管理', '用例管理');
  const management = page.getByRole('region', { name: '用例管理' });
  await management.getByRole('checkbox', { name: '选择', exact: true }).first().check();
  await management.getByRole('button', { name: '设计已选 1' }).click();

  const cases = page.getByRole('region', { name: '用例设计' });
  await expect(cases.getByTestId('case-debug-banner')).toContainText(selectedCase.externalId);
  await expect(cases).toContainText(selectedCase.externalId);
  await expect(cases).not.toContainText(otherCase.externalId);
  await expect(cases.getByRole('button', { name: '自动生成' })).toHaveCount(0);
  await expect(cases.getByRole('button', { name: '新增用例' })).toHaveCount(0);
  await expect(page).toHaveURL(/debugSessionId=debug-codex-single.*module=cases/);

  await cases.getByRole('button', { name: '退出调试' }).click();
  await expect(management).toBeVisible();
  await management.getByRole('button', { name: `调试当前用例 ${selectedCase.externalId}` }).click();

  const scripts = page.getByRole('region', { name: '脚本工作台' });
  await expect(scripts.getByTestId('case-debug-banner')).toContainText(selectedCase.externalId);
  await expect(scripts).toContainText(selectedCase.externalId);
  await expect(scripts).not.toContainText(otherCase.externalId);
  await expect(scripts).toContainText(`规范脚本标题${selectedCase.externalId} ${selectedCase.title}`);
  await expect(scripts.locator('textarea.script-unit-editor').first()).toHaveValue(scriptVersion.content);
  await expect(scripts.getByRole('button', { name: '重新生成当前' })).toBeEnabled();
  await expect(scripts.getByRole('button', { name: '保存修改' })).toBeEnabled();
  await expect(page).toHaveURL(/debugSessionId=debug-codex-single.*module=scripts/);

  await gotoModule(page, '人工工作台', '用例设计');
  await expect(cases.getByTestId('case-debug-banner')).toContainText(selectedCase.externalId);
  await expect(cases).not.toContainText(otherCase.externalId);
  await cases.getByRole('tab', { name: '表格编辑' }).click();
  await cases.getByRole('button', { name: `编辑用例 ${selectedCase.externalId}` }).click();
  const editor = page.getByRole('dialog', { name: '编辑测试用例' });
  await editor.getByLabel('标题 *').fill('当前用例草稿');
  await editor.getByRole('button', { name: '保存到草稿' }).click();
  await cases.getByRole('button', { name: '保存单用例草稿' }).click();
  await expect(page.getByRole('region', { name: '探索实验室' })).toBeVisible();
  expect(savedDraftBody).toContain('当前用例草稿');
  expect(savedDraftBody).not.toContain(otherCase.externalId);

  const exploration = page.getByRole('region', { name: '探索实验室' });
  await expect(exploration.getByTestId('case-debug-banner')).toContainText(selectedCase.externalId);
  await expect(exploration).not.toContainText(otherCase.externalId);

  for (const module of ['脚本工作台', '执行测试', '自愈诊断']) {
    await gotoModule(page, '人工工作台', module);
    const region = page.getByRole('region', { name: module });
    await expect(region.getByTestId('case-debug-banner')).toContainText(selectedCase.externalId);
    await expect(region).not.toContainText(otherCase.externalId);
  }
  await expect(page.getByRole('button', { name: /执行依赖组/ })).toHaveCount(0);

  debugSession.stale = true;
  debugSession.scriptOutdated = true;
  await page.goto(`${PLATFORM_URL}/?debugSessionId=${debugSession.id}&module=scripts`);
  await expect(scripts.getByTestId('case-debug-banner')).toContainText('用例已更新');
  await expect(scripts.getByRole('button', { name: '重新生成当前' })).toBeDisabled();
  await expect(scripts.getByRole('button', { name: '保存修改' })).toBeDisabled();
});
