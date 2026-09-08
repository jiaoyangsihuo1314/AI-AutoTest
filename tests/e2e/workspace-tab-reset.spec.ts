import { expect, type Page, test } from '@playwright/test';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:5174';
const NAV_GROUP_BY_MODULE: Record<string, string> = {
  '总览': '工作台',
  '一键自动化': '工作台',
  '需求工单': '人工工作台',
  '用例设计': '人工工作台',
  '探索实验室': '人工工作台',
  '脚本工作台': '人工工作台',
  '执行测试': '人工工作台',
  '自愈诊断': '人工工作台',
};

async function gotoModule(page: Page, name: string) {
  const navigation = page.getByRole('navigation', { name: '平台模块' });
  const moduleButton = navigation.getByRole('button', { name: new RegExp(`^${name}`) });
  if (!await moduleButton.isVisible().catch(() => false)) {
    const groupName = NAV_GROUP_BY_MODULE[name];
    const groupButton = groupName ? navigation.getByRole('button', { name: groupName, exact: true }) : null;
    if (groupButton && await groupButton.getAttribute('aria-expanded') === 'false') await groupButton.click();
  }
  await moduleButton.click();
}

async function mockJson(page: Page, path: string, payload: unknown) {
  await page.route(`**${path}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  }));
}

test('TC-PLAT-TAB-RESET-001 工作台页签关闭后重开为空且不删除后端数据', async ({ page }) => {
  const project = { id: 'project-codex-tab-reset', name: 'CODEX_TAB_RESET_PROJECT', status: 'active' };
  const feature = {
    id: 'feature-codex-tab-reset',
    projectId: project.id,
    name: 'CODEX_TAB_RESET_FEATURE',
    path: 'CODEX_TAB_RESET_FEATURE',
    isActive: true,
  };
  const run = {
    id: 'run-codex-tab-reset',
    workItemId: 'work-codex-tab-reset',
    status: 'failed',
    stageKey: 'complete',
    stageLabel: '完成',
    progress: 100,
    startedAt: '2026-07-28T01:00:00Z',
    endedAt: '2026-07-28T01:01:00Z',
    error: 'CODEX_TAB_EXECUTION_ERROR',
  };
  const healingRun = {
    id: 'healing-codex-tab-reset',
    workItemId: 'work-codex-tab-reset',
    sourceRunId: run.id,
    status: 'failed',
    currentRound: 1,
    maxRounds: 3,
    error: 'CODEX_TAB_HEALING_ERROR',
  };
  const workItem = {
    id: 'work-codex-tab-reset',
    projectId: project.id,
    featureId: feature.id,
    title: 'CODEX_TAB_RESET_WORK_ITEM',
    requirement: 'CODEX_TAB_REQUIREMENT_CONTENT',
    targetUrl: 'https://example.test',
    status: 'failed',
    stage: '自愈诊断',
    assetMode: 'create',
    caseIds: ['case-codex-tab-reset'],
    casesMarkdown: '| ID | 优先级 | 标题 |\n| --- | --- | --- |\n| TC-CODEX-TAB-001 | P0 | CODEX_TAB_CASE_TITLE |',
    testCases: [{ id: 'case-codex-tab-reset', externalId: 'TC-CODEX-TAB-001', title: 'CODEX_TAB_CASE_TITLE' }],
    explorations: [{ notes: 'CODEX_TAB_EXPLORATION_NOTE', screenshotPath: '', pageStructure: 'CODEX_TAB_PAGE_STRUCTURE' }],
    elements: [{ area: 'main', name: 'CODEX_TAB_ELEMENT', locatorType: 'text', locatorValue: 'CODEX_TAB_ELEMENT', confirmed: true }],
    scriptVersions: [{
      id: 'script-codex-tab-reset',
      caseId: 'case-codex-tab-reset',
      externalId: 'TC-CODEX-TAB-001',
      content: "test('CODEX_TAB_SCRIPT_CONTENT', async () => {});",
      status: 'draft',
      version: 1,
    }],
    scriptContent: "test('CODEX_TAB_SCRIPT_CONTENT', async () => {});",
    latestRunId: run.id,
    latestRun: run,
    latestHealingRun: healingRun,
  };
  const destructiveRequests: string[] = [];

  page.on('request', (request) => {
    if (/clear-page-data|\/cancel(?:\?|$)|DELETE/i.test(`${request.method()} ${request.url()}`)) {
      destructiveRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.route('**/*', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await mockJson(page, '/api/auth/me', {
    authenticated: true,
    user: { id: 'user-codex-tab-reset', username: 'codex-tab-reset', displayName: 'Codex Tab Reset', role: 'admin', status: 'active' },
  });
  await mockJson(page, '/api/health', { status: 'ok', ai: { configured: true } });
  await mockJson(page, '/api/projects', [project]);
  await mockJson(page, '/api/work-items', [workItem]);
  await mockJson(page, `/api/work-items/${workItem.id}`, workItem);
  await mockJson(page, '/api/deliverables?include_content=false', []);
  await mockJson(page, '/api/runs', [run]);
  await mockJson(page, `/api/runs/${run.id}`, run);
  await mockJson(page, `/api/runs/${run.id}/logs`, { items: [{ id: 'log-tab-reset', message: 'CODEX_TAB_EXECUTION_LOG' }] });
  await mockJson(page, `/api/runs/${run.id}/screenshot`, { dataUrl: '' });
  await mockJson(page, '/api/dashboard-summary?project_id=all', { totals: {}, quality: {}, trends: [], recentWorkItems: [] });
  await mockJson(page, '/api/test-cases?project_id=all', workItem.testCases);
  await mockJson(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJson(page, `/api/test-suites?project_id=all`, []);
  await mockJson(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJson(page, '/api/suite-runs?project_id=all', []);
  await mockJson(page, '/api/automation-flows', []);

  await page.goto(PLATFORM_URL);
  await expect(page.getByRole('region', { name: '平台总览' })).toBeVisible();

  await gotoModule(page, '一键自动化');
  await page.getByTestId('automation-flow-project').selectOption(project.id);
  await page.getByTestId('automation-flow-feature').selectOption(feature.id);
  await page.getByTestId('automation-flow-input').fill('CODEX_TAB_AUTOMATION_INPUT');
  await page.getByRole('button', { name: '关闭一键自动化' }).click();
  await gotoModule(page, '一键自动化');
  await expect(page.getByTestId('automation-flow-project')).toHaveValue('');
  await expect(page.getByTestId('automation-flow-feature')).toHaveValue('');
  await expect(page.getByTestId('automation-flow-input')).toHaveValue('');

  await gotoModule(page, '需求工单');
  await expect(page.getByTestId('requirement-input')).toHaveValue('CODEX_TAB_REQUIREMENT_CONTENT');
  await gotoModule(page, '用例设计');
  await expect(page.getByRole('region', { name: '用例设计' })).toContainText('TC-CODEX-TAB-001');
  await page.getByRole('button', { name: '关闭需求工单' }).click();
  await expect(page.getByRole('region', { name: '用例设计' })).toContainText('TC-CODEX-TAB-001');
  await gotoModule(page, '需求工单');
  await expect(page.getByTestId('requirement-input')).toHaveValue('');
  await expect(page.getByTestId('requirement-project')).toHaveValue('');
  await expect(page.getByTestId('requirement-current-summary')).toHaveCount(0);

  const pageScenarios = [
    { module: '用例设计', region: '用例设计', marker: 'TC-CODEX-TAB-001' },
    { module: '探索实验室', region: '探索实验室', marker: 'CODEX_TAB_EXPLORATION_NOTE' },
    { module: '脚本工作台', region: '脚本工作台', marker: 'TC-CODEX-TAB-001' },
    { module: '执行测试', region: '执行测试', marker: 'CODEX_TAB_EXECUTION_LOG' },
    { module: '自愈诊断', region: '自愈诊断', marker: run.id },
  ];

  await gotoModule(page, '总览');
  await page.getByRole('button', { name: 'CODEX_TAB_RESET_WORK_ITEM' }).click();
  for (const scenario of pageScenarios) {
    await gotoModule(page, scenario.module);
    const region = page.getByRole('region', { name: scenario.region });
    await expect(region).toContainText(scenario.marker);
    await page.getByRole('button', { name: `关闭${scenario.module}` }).click();
    await gotoModule(page, scenario.module);
    await expect(page.getByRole('region', { name: scenario.region })).not.toContainText(scenario.marker);
  }

  await gotoModule(page, '总览');
  await page.getByRole('button', { name: 'CODEX_TAB_RESET_WORK_ITEM' }).click();
  await gotoModule(page, '需求工单');
  await gotoModule(page, '用例设计');
  await page.getByRole('button', { name: '页签更多操作' }).click();
  await page.getByRole('menuitem', { name: '关闭其他' }).click();
  await expect(page.getByRole('region', { name: '用例设计' })).toContainText('TC-CODEX-TAB-001');
  await gotoModule(page, '需求工单');
  await expect(page.getByTestId('requirement-input')).toHaveValue('');

  expect(destructiveRequests).toEqual([]);
});

test('TC-PLAT-DEBUG-NAV-001 单用例调试保存后恢复已关闭的执行页签', async ({ page }) => {
  const project = { id: 'project-codex-debug-nav', name: 'CODEX_DEBUG_NAV_PROJECT', status: 'active', environments: [] };
  const feature = {
    id: 'feature-codex-debug-nav',
    projectId: project.id,
    name: 'CODEX_DEBUG_NAV_FEATURE',
    path: 'CODEX_DEBUG_NAV_FEATURE',
    isActive: true,
  };
  const caseItem = {
    id: 'case-codex-debug-nav',
    projectId: project.id,
    workItemId: 'work-codex-debug-nav',
    featureId: feature.id,
    externalId: 'TC-LIB-001',
    title: '登录后技能库页面完整展示',
    priority: 'P0',
    updatedAt: '2026-09-01T06:00:00Z',
  };
  const scriptVersion = {
    id: 'script-codex-debug-nav-v1',
    caseId: caseItem.id,
    externalId: caseItem.externalId,
    content: "import { expect, test } from '@playwright/test';\ntest('TC-LIB-001 [P0] 登录后技能库页面完整展示', async ({ page }) => { await expect(page).toHaveTitle(/SkillHub/); });",
    status: 'draft',
    version: 1,
    scriptLayout: 'shared-spec',
  };
  const savedScriptVersion = { ...scriptVersion, id: 'script-codex-debug-nav-v2', version: 2 };
  const workItem = {
    id: caseItem.workItemId,
    projectId: project.id,
    featureId: feature.id,
    title: '[导入] skillhub-library.spec',
    requirement: '验证 TC-LIB-001 单用例调试保存后可以执行。',
    targetUrl: 'https://example.test',
    status: 'failed',
    stage: '运行验证',
    assetMode: 'refresh',
    caseIds: [caseItem.id],
    testCases: [caseItem],
    scriptVersions: [scriptVersion],
    scriptContent: scriptVersion.content,
  };
  const debugSession = {
    id: 'debug-codex-nav',
    projectId: project.id,
    workItemId: workItem.id,
    caseId: caseItem.id,
    caseRevisionId: 1,
    sourceScriptVersionId: scriptVersion.id,
    currentScriptVersionId: scriptVersion.id,
    sharedScriptDebug: true,
    debugGrepPattern: '/TC\\-LIB\\-001/',
    dependencyExecution: {
      recommendation: 'single',
      defaultScope: 'single',
      externalIds: [caseItem.externalId],
      manualChoiceRequired: false,
    },
    latestRunId: '',
    status: 'draft',
    stale: false,
    case: caseItem,
    currentScriptVersion: scriptVersion,
    sourceScriptVersion: scriptVersion,
    latestRun: null,
    workItem,
  };
  const savedSession = {
    ...debugSession,
    currentScriptVersionId: savedScriptVersion.id,
    currentScriptVersion: savedScriptVersion,
    workItem: { ...workItem, scriptVersions: [savedScriptVersion], scriptContent: savedScriptVersion.content },
  };
  let draftSaveCount = 0;

  await page.route('**/*', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await mockJson(page, '/api/auth/me', {
    authenticated: true,
    user: { id: 'user-codex-debug-nav', username: 'codex-debug-nav', displayName: 'Codex Debug Nav', role: 'admin', status: 'active' },
  });
  await mockJson(page, '/api/health', { status: 'ok', ai: { configured: true } });
  await mockJson(page, '/api/projects', [project]);
  await mockJson(page, '/api/work-items', [workItem]);
  await mockJson(page, `/api/work-items/${workItem.id}`, workItem);
  await mockJson(page, `/api/case-debug-sessions/${debugSession.id}`, debugSession);
  await page.route(`**/api/case-debug-sessions/${debugSession.id}/script-drafts`, async (route) => {
    draftSaveCount += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedSession) });
  });
  await mockJson(page, '/api/deliverables?include_content=false', []);
  await mockJson(page, '/api/runs', []);
  await mockJson(page, '/api/dashboard-summary?project_id=all', { totals: {}, quality: {}, trends: [], recentWorkItems: [] });
  await mockJson(page, '/api/test-cases?project_id=all', [caseItem]);
  await mockJson(page, `/api/features?project_id=${project.id}`, { items: [feature], tree: [feature] });
  await mockJson(page, '/api/test-suites?project_id=all', []);
  await mockJson(page, `/api/test-suites?project_id=${project.id}`, []);
  await mockJson(page, '/api/suite-runs?project_id=all', []);
  await mockJson(page, '/api/automation-flows', []);

  await page.goto(`${PLATFORM_URL}/?debugSessionId=${debugSession.id}&caseId=${caseItem.id}&module=scripts`);
  const scripts = page.getByRole('region', { name: '脚本工作台' });
  await expect(scripts.getByTestId('case-debug-banner')).toContainText('TC-LIB-001');

  await gotoModule(page, '执行测试');
  await expect(page.getByRole('button', { name: '执行当前用例' })).toBeEnabled();
  await page.getByRole('button', { name: '关闭执行测试' }).click();
  await expect(scripts).toBeVisible();

  await scripts.getByRole('button', { name: '保存修改', exact: true }).click();

  const execution = page.getByRole('region', { name: '执行测试' });
  await expect(execution).toBeVisible();
  await expect(execution.getByTestId('case-debug-banner')).toContainText('TC-LIB-001');
  await expect(execution.getByRole('button', { name: '执行当前用例' })).toBeEnabled();
  await expect(page).toHaveURL(/debugSessionId=debug-codex-nav.*module=execution/);
  expect(draftSaveCount).toBe(1);
});
