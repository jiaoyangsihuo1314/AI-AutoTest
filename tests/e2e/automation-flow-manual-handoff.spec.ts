import { expect, type Page, test } from '@playwright/test';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:5174';
const MARKER = 'CODEX_TEST_20260818_AUTOMATION_HANDOFF';

type FlowStatus = 'failed' | 'blocked' | 'completed';

function createFixture(status: FlowStatus, stage = '自愈诊断') {
  const project = { id: `${MARKER}_PROJECT`, name: `${MARKER}_项目`, status: 'active' };
  const feature = {
    id: `${MARKER}_FEATURE`,
    projectId: project.id,
    name: `${MARKER}_功能`,
    path: `${MARKER}_功能`,
    isActive: true,
  };
  const workItemId = `${MARKER}_WORK_ITEM_${status}`;
  const run = {
    id: `${MARKER}_RUN_${status}`,
    workItemId,
    status: 'failed',
    stageKey: 'complete',
    stageLabel: '完成',
    progress: 100,
    exitCode: 1,
    reportPath: `playwright-report/${MARKER}/${status}/index.html`,
    error: `${MARKER}_${status}_RUN_ERROR`,
  };
  const healingRun = {
    id: `${MARKER}_HEALING_${status}`,
    workItemId,
    sourceRunId: run.id,
    latestRunId: run.id,
    status,
    currentRound: 3,
    maxRounds: 3,
    error: `${MARKER}_${status}_REASON`,
    sourceRun: run,
    latestRun: run,
    attempts: [{
      id: `${MARKER}_ATTEMPT_${status}`,
      round: 3,
      status,
      result: `${MARKER}_${status}_ATTEMPT_RESULT`,
    }],
  };
  const workItem = {
    id: workItemId,
    projectId: project.id,
    featureId: feature.id,
    title: `${MARKER}_${status}_工单`,
    requirement: `${MARKER}_${status}_需求`,
    targetUrl: 'https://example.test',
    status,
    stage: '自愈诊断',
    assetMode: 'create',
    caseIds: [],
    casesMarkdown: '',
    testCases: [],
    explorations: [],
    elements: [],
    scriptVersions: [],
    latestRunId: run.id,
    latestRun: run,
    latestHealingRun: healingRun,
  };
  const flow = {
    id: `${MARKER}_FLOW_${status}_${stage}`,
    flowRunId: `${MARKER}_FLOW_${status}_${stage}`,
    workItemId,
    projectId: project.id,
    featureId: feature.id,
    featureName: feature.name,
    featurePath: feature.path,
    requirement: workItem.requirement,
    status,
    stage,
    progress: 100,
    error: `${MARKER}_${status}_REASON`,
    outcome: undefined as Record<string, unknown> | undefined,
    dataResolution: undefined as undefined | {
      category: string;
      label: string;
      status: string;
      source: string;
      reason: string;
      missingFields: string[];
      invalidFields?: string[];
      actionRequired: string;
    },
    logs: [{
      id: `${MARKER}_LOG_${status}`,
      stage,
      level: status === 'blocked' ? 'blocked' : status === 'failed' ? 'error' : 'success',
      message: `${MARKER}_${status}_REASON`,
    }],
    flowArtifacts: [] as Array<{
      id: string;
      flowRunId: string;
      workItemId: string;
      stage: string;
      artifactType: string;
      title: string;
      path: string;
      content: string;
      status: string;
      source: string;
    }>,
    workItem: { id: workItemId, title: workItem.title },
  };
  return { project, feature, workItem, run, healingRun, flow };
}

async function mockPlatform(page: Page, fixture: ReturnType<typeof createFixture>) {
  const selectedWorkItemRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (!path.startsWith('/api/')) {
      await route.continue();
      return;
    }

    let body: unknown = {};
    if (path === '/api/auth/me') {
      body = { authenticated: true, user: { id: `${MARKER}_USER`, username: 'codex-handoff', displayName: 'Codex Handoff', role: 'admin', status: 'active' } };
    } else if (path === '/api/health') {
      body = { status: 'ok', ai: { configured: true } };
    } else if (path === '/api/projects') {
      body = [fixture.project];
    } else if (path === '/api/features') {
      body = { items: [fixture.feature], tree: [fixture.feature] };
    } else if (path === '/api/automation-flows' && request.method() === 'POST') {
      body = fixture.flow.status === 'completed'
        ? { ...fixture.flow, status: 'running', stage: '运行验证', progress: 80, outcome: undefined }
        : fixture.flow;
    } else if (path === `/api/automation-flows/${fixture.flow.id}`) {
      body = fixture.flow;
    } else if (path === '/api/automation-flows') {
      body = [fixture.flow];
    } else if (path === `/api/work-items/${fixture.workItem.id}`) {
      selectedWorkItemRequests.push(path);
      body = fixture.workItem;
    } else if (path === '/api/work-items') {
      body = [];
    } else if (path === `/api/healing-runs/${fixture.healingRun.id}`) {
      body = fixture.healingRun;
    } else if (path === `/api/healing-runs/${fixture.healingRun.id}/logs`) {
      body = { items: fixture.flow.logs };
    } else if (path === `/api/runs/${fixture.run.id}`) {
      body = fixture.run;
    } else if (path === `/api/runs/${fixture.run.id}/logs`) {
      body = { items: [{ id: `${MARKER}_RUN_LOG`, level: 'error', message: fixture.run.error }] };
    } else if (path === `/api/runs/${fixture.run.id}/screenshot`) {
      body = { dataUrl: '' };
    } else if (path === '/api/dashboard-summary') {
      body = { totals: {}, quality: {}, trends: [], recentWorkItems: [] };
    } else if (['/api/runs', '/api/test-cases', '/api/test-suites', '/api/suite-runs', '/api/deliverables'].includes(path)) {
      body = [];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return selectedWorkItemRequests;
}

async function startFlow(page: Page, fixture: ReturnType<typeof createFixture>) {
  await page.goto(PLATFORM_URL);
  const navigation = page.getByRole('navigation', { name: '平台模块' });
  const workspaceGroup = navigation.getByRole('button', { name: '工作台', exact: true });
  if (await workspaceGroup.getAttribute('aria-expanded') === 'false') await workspaceGroup.click();
  await navigation.getByRole('button', { name: /^一键自动化/ }).click();
  await page.getByTestId('automation-flow-project').selectOption(fixture.project.id);
  await page.getByTestId('automation-flow-feature').selectOption(fixture.feature.id);
  await page.getByTestId('automation-flow-input').fill(fixture.workItem.requirement);
  await page.getByRole('button', { name: '开始一键流程' }).click();
}

for (const status of ['failed', 'blocked'] as const) {
  test(`TC-PLAT-AUTO-HANDOFF-${status} 自愈${status}后展示人工工作台引导`, async ({ page }) => {
    const fixture = createFixture(status);
    const selectedWorkItemRequests = await mockPlatform(page, fixture);
    await startFlow(page, fixture);

    const handoff = page.getByTestId('automation-manual-handoff');
    await expect(handoff).toBeVisible();
    await expect(handoff).toContainText('自动自愈未能完成，需要人工处理');
    await expect(handoff).toContainText(`${MARKER}_${status}_REASON`);

    if (status === 'failed') {
      await handoff.getByRole('button', { name: '前往人工工作台' }).click();
      await expect(page.getByRole('region', { name: '自愈诊断' })).toBeVisible();
      await expect(page.getByTestId('healing-run-summary')).toContainText(fixture.run.id);
      await expect(page.getByTestId('healing-run-summary')).toContainText('失败');
      expect(selectedWorkItemRequests).toEqual([`/api/work-items/${fixture.workItem.id}`]);
    }
  });
}

for (const scenario of [
  { status: 'failed' as const, stage: '运行验证' },
  { status: 'completed' as const, stage: '自愈诊断' },
]) {
  test(`TC-PLAT-AUTO-HANDOFF-HIDDEN-${scenario.status}-${scenario.stage} 非目标状态不展示引导`, async ({ page }) => {
    const fixture = createFixture(scenario.status, scenario.stage);
    await mockPlatform(page, fixture);
    await startFlow(page, fixture);
    await expect(page.getByTestId('automation-manual-handoff')).toHaveCount(0);
  });
}

test('TC-PLAT-AUTO-TERMINAL-REPORT 前置阶段阻塞后展示人工报告且不展示 HTML 报告', async ({ page }) => {
  const fixture = createFixture('blocked', '页面探索');
  fixture.flow.flowArtifacts = [{
    id: `${MARKER}_MANUAL_REPORT`,
    flowRunId: fixture.flow.id,
    workItemId: fixture.workItem.id,
    stage: '页面探索',
    artifactType: 'manual-report',
    title: '一键自动化阶段诊断报告',
    path: `artifacts/automation-platform/flow-runs/${fixture.flow.id}/terminal-report.md`,
    content: `# ${MARKER} 页面探索阶段诊断报告`,
    status: 'blocked',
    source: 'system',
  }];
  await mockPlatform(page, fixture);
  await startFlow(page, fixture);

  await expect(page.getByText('人工报告已生成，可在交付物中查看。')).toBeVisible();
  await page.getByRole('button', { name: /^交付物$/ }).click();
  const artifacts = page.getByTestId('automation-flow-artifact-preview');
  await expect(artifacts).toContainText('一键自动化阶段诊断报告');
  await expect(artifacts).not.toContainText('Playwright HTML Report');
});

test('TC-PLAT-AUTO-MISSING-ACCOUNT 缺少登录凭据时明确提示且保留需求', async ({ page }) => {
  const fixture = createFixture('blocked', '需求分析');
  fixture.flow.error = `${MARKER}_登录流程缺少用户名、密码，登录及其后的业务场景均未执行`;
  fixture.flow.dataResolution = {
    category: 'account-required',
    label: '需要账号',
    status: 'blocked',
    source: 'missing-account',
    reason: fixture.flow.error,
    missingFields: ['username', 'password'],
    actionRequired: '请在需求中明确补充：用户名 standard_user、密码 secret_sauce，然后重新启动一键流程。',
  };
  await mockPlatform(page, fixture);
  await startFlow(page, fixture);

  const blocker = page.getByTestId('automation-missing-account-blocker');
  await expect(blocker).toBeVisible();
  await expect(blocker).toContainText('登录凭据不完整，后续场景未执行');
  await expect(blocker).toContainText('用户名');
  await expect(blocker).toContainText('密码');
  await expect(blocker).toContainText('用户名 standard_user、密码 secret_sauce');
  await expect(page.getByTestId('automation-flow-input')).toHaveValue(fixture.workItem.requirement);
  await expect(page.getByTestId('automation-manual-handoff')).toHaveCount(0);
});

test('TC-PLAT-AUTO-INVALID-ACCOUNT 登录凭据对应关系有误时明确提示', async ({ page }) => {
  const fixture = createFixture('blocked', '需求分析');
  fixture.flow.error = `${MARKER}_登录凭据中的用户名、密码对应关系有误，登录及其后的业务场景均未执行`;
  fixture.flow.dataResolution = {
    category: 'account-required',
    label: '凭据有误',
    status: 'blocked',
    source: 'invalid-account',
    reason: fixture.flow.error,
    missingFields: [],
    invalidFields: ['username', 'password'],
    actionRequired: '请在需求中明确补充：用户名 standard_user、密码 secret_sauce，然后重新启动一键流程。',
  };
  await mockPlatform(page, fixture);
  await startFlow(page, fixture);

  await expect(page.getByTestId('automation-data-resolution')).toContainText('凭据有误');
  const blocker = page.getByTestId('automation-missing-account-blocker');
  await expect(blocker).toContainText('登录凭据无法确认，后续场景未执行');
  await expect(blocker).toContainText('用户名');
  await expect(blocker).toContainText('密码');
  await expect(blocker).toContainText('用户名 standard_user、密码 secret_sauce');
});

test('TC-PLAT-AUTO-PARTIAL 完成但有警告时展示统计、原因和人工工作台入口', async ({ page }) => {
  const fixture = createFixture('completed', '保存已验证产物');
  fixture.flow.outcome = {
    mode: 'partial',
    caseResults: [
      { caseId: `${MARKER}_CASE_P0`, externalId: 'TC-CODEX-P0', priority: 'P0', status: 'passed', reason: 'Playwright 真实执行通过', runId: fixture.run.id },
      { caseId: `${MARKER}_CASE_P1`, externalId: 'TC-CODEX-P1', priority: 'P1', status: 'failed', reason: `${MARKER}_断言失败`, runId: fixture.run.id },
      { caseId: `${MARKER}_CASE_P2`, externalId: 'TC-CODEX-P2', priority: 'P2', status: 'blocked-by-data', reason: `${MARKER}_缺少账号`, runId: '' },
    ],
    counts: { total: 3, passed: 1, failed: 1, blocked: 1, notRun: 0, p0Passed: 1 },
    passedP0CaseIds: ['TC-CODEX-P0'],
    hasP0Passed: true,
    warnings: [`${MARKER}_断言失败`, `${MARKER}_缺少账号`],
    manualWorkbenchRecommended: true,
  };
  await mockPlatform(page, fixture);
  await startFlow(page, fixture);

  await expect(page.locator('.automation-flow-header .automation-run-status')).toHaveText('已完成，有警告');
  await expect(page.getByTestId('automation-outcome-p0-passed')).toContainText('1');
  await expect(page.getByTestId('automation-outcome-failed')).toContainText('1');
  await expect(page.getByTestId('automation-outcome-not-run')).toContainText('1');
  await expect(page.getByTestId('automation-outcome-issues')).toContainText(`${MARKER}_断言失败`);
  await expect(page.getByTestId('automation-outcome-issues')).toContainText(`${MARKER}_缺少账号`);
  await expect(page.getByTestId('automation-manual-handoff')).toContainText('已完成部分验证，可继续人工调试');

  await page.getByTestId('automation-manual-handoff').getByRole('button', { name: '前往人工工作台' }).click();
  await expect(page.getByRole('region', { name: '自愈诊断' })).toBeVisible();
  await expect(page.getByTestId('healing-run-summary')).toContainText(fixture.run.id);

  await page.getByRole('button', { name: /^一键自动化/ }).click();
  await page.getByRole('button', { name: '历史记录' }).click();
  await expect(page.getByTestId('automation-flow-history')).toContainText('已完成，有警告');
});
