import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:5174';
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8001';

function bootstrapAdminPassword() {
  const value = process.env.QA_BOOTSTRAP_ADMIN_PASSWORD;
  if (!value) throw new Error('缺少 QA_BOOTSTRAP_ADMIN_PASSWORD，无法登录测试平台');
  return value;
}

type TestContext = {
  marker: string;
  projectId: string;
  featureId: string;
  flowId?: string;
};

function uniqueMarker(caseId: string) {
  return `CODEX_TEST_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${caseId}_${Math.random().toString(16).slice(2, 7)}`;
}

async function apiRequestWithRetry(operation: () => Promise<APIResponse>, attempts = 3) {
  let lastError = '';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  console.warn(`测试数据清理请求失败：${lastError}`);
  return undefined;
}

async function createIsolatedContext(request: APIRequestContext, caseId: string): Promise<TestContext> {
  const marker = uniqueMarker(caseId);

  // 创建带唯一标记的项目，并绑定本仓库与稳定公开目标页。
  const projectResponse = await request.post(`${API_URL}/api/projects`, {
    data: {
      project_code: marker.slice(0, 48),
      name: `${marker}_一键自动化项目`,
      project_type: 'product',
      status: 'active',
      target_url: 'https://example.com',
      repository_path: process.cwd(),
      test_dir: 'tests/e2e',
      description: `${marker} 一键自动化冒烟测试临时项目`,
    },
  });
  expect(projectResponse.ok(), await projectResponse.text()).toBeTruthy();
  const project = await projectResponse.json();

  // 创建属于该项目的唯一功能，供一键流程完成必填绑定。
  const featureResponse = await request.post(`${API_URL}/api/features`, {
    data: {
      project_id: project.id,
      name: `${marker}_页面验证`,
      description: `${marker} 一键自动化冒烟测试临时功能`,
      sort_order: 0,
      is_active: true,
    },
  });
  expect(featureResponse.ok(), await featureResponse.text()).toBeTruthy();
  const feature = await featureResponse.json();

  return { marker, projectId: project.id, featureId: feature.id };
}

async function ensurePlatformSession(page: Page) {
  // 同时兼容关闭鉴权的测试环境与开启鉴权的本地开发环境。
  await page.goto(PLATFORM_URL);
  const loginName = page.getByLabel('登录名', { exact: true });
  const navigation = page.getByRole('navigation', { name: '平台模块' });
  await expect.poll(async () => (await loginName.count()) + (await navigation.count()), { timeout: 10_000 }).toBeGreaterThan(0);
  if (await loginName.isVisible()) {
    await loginName.fill('admin');
    await page.getByLabel('密码', { exact: true }).fill(bootstrapAdminPassword());
    await page.getByRole('button', { name: '登录', exact: true }).click();
  }
  await expect(navigation).toBeVisible({ timeout: 10_000 });
}

async function cleanupIsolatedContext(request: APIRequestContext, context?: TestContext) {
  if (!context?.projectId || !context.marker.startsWith('CODEX_TEST_')) return;

  // 即使流程 ID 尚未写回测试上下文，也按唯一项目 ID 找到并停止活动流程。
  const flowsResponse = await apiRequestWithRetry(() => request.get(`${API_URL}/api/automation-flows`, { timeout: 5_000 }));
  const ownedFlows = flowsResponse?.ok()
    ? (await flowsResponse.json()).filter((flow: { projectId?: string }) => flow.projectId === context.projectId)
    : [];
  for (const flow of ownedFlows) {
    if (!['completed', 'blocked', 'failed', 'cancelled'].includes(flow.status)) {
      await apiRequestWithRetry(() => request.post(`${API_URL}/api/automation-flows/${flow.id || flow.flowRunId}/cancel`, { timeout: 5_000 }));
    }
  }
  const releaseDeadline = Date.now() + 60_000;
  while (Date.now() < releaseDeadline) {
    const latestResponse = await apiRequestWithRetry(() => request.get(`${API_URL}/api/automation-flows`, { timeout: 5_000 }));
    if (!latestResponse?.ok()) break;
    const latestOwnedFlows = (await latestResponse.json())
      .filter((flow: { projectId?: string }) => flow.projectId === context.projectId);
    if (latestOwnedFlows.every((flow: { status?: string }) => (
      ['completed', 'blocked', 'failed', 'cancelled'].includes(flow.status || '')
    ))) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // 永久删除本项目生成的报告记录，解除项目级联删除的保护条件。
  const reportsResponse = await apiRequestWithRetry(() => request.get(
    `${API_URL}/api/manual-reports?project_id=${context.projectId}&page=1&page_size=100`,
    { timeout: 5_000 },
  ));
  if (reportsResponse?.ok()) {
    const reportsPayload = await reportsResponse.json();
    const reportIds = (reportsPayload.items || [])
      .map((item: { report?: { id?: string } }) => item.report?.id)
      .filter(Boolean);
    if (reportIds.length) {
      const reportDeleteResponse = await apiRequestWithRetry(() => request.post(`${API_URL}/api/manual-reports/bulk-delete`, {
        data: { report_ids: reportIds },
        timeout: 5_000,
      }));
      if (reportDeleteResponse && !reportDeleteResponse.ok()) console.warn(`清理本次报告失败：${await reportDeleteResponse.text()}`);
    }
  }

  // 删除本项目每条用例的全部历史报告，包含自愈前后的多版本记录。
  const caseReportsResponse = await apiRequestWithRetry(() => request.get(
    `${API_URL}/api/case-reports?project_id=${context.projectId}&page=1&page_size=100`,
    { timeout: 5_000 },
  ));
  if (caseReportsResponse?.ok()) {
    const caseReportsPayload = await caseReportsResponse.json();
    const caseIds = (caseReportsPayload.items || [])
      .map((item: { case?: { id?: string } }) => item.case?.id || '')
      .filter(Boolean);
    const reportIds: string[] = [];
    for (const caseId of caseIds) {
      const historyResponse = await apiRequestWithRetry(() => request.get(
        `${API_URL}/api/case-reports/${caseId}/history`,
        { timeout: 5_000 },
      ));
      if (!historyResponse?.ok()) continue;
      const historyPayload = await historyResponse.json();
      for (const report of historyPayload.items || []) {
        if (report.projectId === context.projectId && report.id && !reportIds.includes(report.id)) {
          reportIds.push(report.id);
        }
      }
    }
    if (reportIds.length) {
      const caseReportDeleteResponse = await apiRequestWithRetry(() => request.post(`${API_URL}/api/report-records/bulk-delete`, {
        data: { report_ids: reportIds },
        timeout: 5_000,
      }));
      if (caseReportDeleteResponse && !caseReportDeleteResponse.ok()) {
        console.warn(`清理本次用例报告失败：${await caseReportDeleteResponse.text()}`);
      }
    }
  }

  // 后台任务释放与数据库状态落盘存在极短窗口，限定次数重试项目删除。
  let lastDeleteError = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const deleteResponse = await apiRequestWithRetry(() => request.delete(
      `${API_URL}/api/projects/${context.projectId}?cascade=true`,
      { timeout: 5_000 },
    ));
    if (!deleteResponse) continue;
    if (deleteResponse.ok() || deleteResponse.status() === 404) return;
    lastDeleteError = await deleteResponse.text();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.warn(`清理本次项目失败：${lastDeleteError}`);
}

async function waitForCompletedFlow(request: APIRequestContext, flowId: string) {
  const deadline = Date.now() + 300_000;
  let latestFlow: Record<string, unknown> = {};

  // 轮询真实流程状态；遇到失败终态立即报告，不等待到总超时。
  while (Date.now() < deadline) {
    const response = await request.get(`${API_URL}/api/automation-flows/${flowId}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    latestFlow = await response.json();
    const status = String(latestFlow.status || '');
    if (status === 'completed') return latestFlow;
    if (['blocked', 'failed', 'cancelled'].includes(status)) {
      throw new Error(
        `一键自动化未完成：status=${status}, stage=${String(latestFlow.stage || '')}, error=${String(latestFlow.error || '')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`一键自动化在 300 秒内未进入终态：${JSON.stringify(latestFlow)}`);
}

async function openOneClickAutomation(page: Page, context: TestContext) {
  // 打开真实平台首页并进入工作台的一键自动化模块。
  await page.goto(PLATFORM_URL);
  const navigation = page.getByRole('navigation', { name: '平台模块' });
  const workspaceGroup = navigation.getByRole('button', { name: '工作台', exact: true });
  if (await workspaceGroup.getAttribute('aria-expanded') === 'false') await workspaceGroup.click();
  await navigation.getByRole('button', { name: /^一键自动化/ }).click();

  // 选择本次创建的项目和功能，确保流程数据归属可追踪。
  await page.getByTestId('automation-flow-project').selectOption(context.projectId);
  await expect(page.getByTestId('automation-flow-feature')).toBeEnabled();
  await page.getByTestId('automation-flow-feature').selectOption(context.featureId);
}

test.describe('一键自动化功能冒烟', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC-ONECLICK-002 空需求不会创建一键自动化流程', async ({ page }) => {
    test.setTimeout(60_000);
    let context: TestContext | undefined;
    try {
      // 准备本用例专属项目和功能，避免依赖或修改历史数据。
      await ensurePlatformSession(page);
      context = await createIsolatedContext(page.request, '002');
      await openOneClickAutomation(page, context);

      // 监听创建接口，证明前端校验发生在真实流程创建之前。
      let createRequestCount = 0;
      page.on('request', (apiRequest) => {
        if (apiRequest.url() === `${API_URL}/api/automation-flows` && apiRequest.method() === 'POST') {
          createRequestCount += 1;
        }
      });

      // 保持需求为空并尝试启动一键流程。
      await expect(page.getByTestId('automation-flow-input')).toHaveValue('');
      await page.getByRole('button', { name: '开始一键流程' }).click();

      // 验证页面给出明确阻塞信息且未创建后端流程。
      await expect(page.getByTestId('automation-flow-logs')).toContainText('阻塞：需求文本为空');
      await expect.poll(() => createRequestCount, { timeout: 2_000 }).toBe(0);
    } finally {
      // 无论断言是否通过，都只清理本用例唯一标记的数据。
      await cleanupIsolatedContext(page.request, context);
    }
  });

  test('TC-ONECLICK-001 一键自动化完成真实主流程并保存交付物', async ({ page }) => {
    test.setTimeout(360_000);
    let context: TestContext | undefined;
    try {
      // 准备本用例专属项目和功能，目标页使用稳定的 Example Domain。
      await ensurePlatformSession(page);
      context = await createIsolatedContext(page.request, '001');
      await openOneClickAutomation(page, context);

      // 输入包含目标、角色、数据、验收标准和排除项的完整需求。
      const requirement = [
        `需求标记：${context.marker}。`,
        '访问 https://example.com，验证页面显示 Example Domain 标题，且 Learn more 链接可见并可点击。',
        '角色为匿名访客，不需要账号和密码；测试数据仅为公开页面。',
        '只覆盖 Chromium 主流程，不覆盖跨浏览器兼容、性能和第三方站点内容变更。',
      ].join('');
      await page.getByTestId('automation-flow-input').fill(requirement);

      // 点击开始并捕获真实后端创建的一键流程 ID。
      const createStartedAt = Date.now();
      const createResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/api/automation-flows'
        && response.request().method() === 'POST'
      ), { timeout: 10_000 });
      await page.getByRole('button', { name: '开始一键流程' }).click();
      const createResponse = await createResponsePromise;
      const createdFlow = await createResponse.json();
      expect(createResponse.ok(), JSON.stringify(createdFlow)).toBeTruthy();
      expect(Date.now() - createStartedAt).toBeLessThan(2_000);
      expect(['queued', 'running']).toContain(createdFlow.status);
      const flowId = createdFlow.id || createdFlow.flowRunId;
      expect(flowId).toBeTruthy();
      context.flowId = flowId;

      // 验证页面开始显示真实阶段进度和实时日志，而非停留在启动态。
      await expect(page.getByTestId('automation-flow-result')).toContainText('当前阶段', { timeout: 20_000 });
      await expect(page.getByTestId('automation-flow-stages')).toContainText('保存已验证产物');
      await expect(page.getByTestId('automation-flow-logs')).toContainText('项目预检', { timeout: 45_000 });

      // 轮询真实流程接口直到完成；失败终态会携带阶段和后端错误立即结束。
      const terminalFlow = await waitForCompletedFlow(page.request, flowId);

      // 验证后端记录的阶段按一键流程约定顺序推进。
      const logs = Array.isArray(terminalFlow.logs) ? terminalFlow.logs as Array<{ stage?: string }> : [];
      const logText = logs.map((item) => `[${item.stage || ''}]`).join('\n');
      const expectedStages = ['需求分析', '项目预检', '用例设计', '页面探索', '脚本实现', '运行验证', '保存已验证产物'];
      const positions = expectedStages.map((stage) => logText.indexOf(`[${stage}]`));
      positions.forEach((position) => expect(position).toBeGreaterThan(-1));
      for (let index = 1; index < positions.length; index += 1) {
        expect(positions[index]).toBeGreaterThan(positions[index - 1]);
      }

      // 验证一键流程保存了关键阶段产物。
      const artifactsResponse = await page.request.get(`${API_URL}/api/automation-flows/${flowId}/artifacts`);
      expect(artifactsResponse.ok(), await artifactsResponse.text()).toBeTruthy();
      const artifacts = await artifactsResponse.json();
      const artifactTypes = artifacts.map((item: { artifactType: string }) => item.artifactType);
      expect(artifactTypes).toEqual(expect.arrayContaining([
        'requirement-analysis',
        'test-cases',
        'exploration-plan',
        'playwright-script',
      ]));
      expect(artifactTypes).not.toContain('test-case-refinement');
      const casesArtifact = artifacts.find((item: { artifactType: string }) => item.artifactType === 'test-cases');
      expect(casesArtifact?.source).not.toBe('evidence-refined');

      // 验证测试用例已关联到本次项目、功能和工单。
      const workItemId = terminalFlow.workItemId as string;
      const casesResponse = await page.request.get(`${API_URL}/api/test-cases?project_id=${context.projectId}&work_item_id=${workItemId}`);
      expect(casesResponse.ok(), await casesResponse.text()).toBeTruthy();
      const cases = await casesResponse.json();
      expect(cases.length).toBeGreaterThan(0);
      expect(cases.every((item: { featureId: string }) => item.featureId === context.featureId)).toBeTruthy();

      // 验证最终保存了 skill 要求对应的业务交付物类型。
      const deliverablesResponse = await page.request.get(`${API_URL}/api/deliverables?project_id=${context.projectId}&work_item_id=${workItemId}&include_content=false`);
      expect(deliverablesResponse.ok(), await deliverablesResponse.text()).toBeTruthy();
      const deliverables = await deliverablesResponse.json();
      expect(deliverables.map((item: { type: string }) => item.type)).toEqual(expect.arrayContaining([
        'test-cases',
        'spec',
        'manual-report',
        'html-report',
      ]));

      // 验证 UI 最终展示完成状态和交付物入口。
      await expect(page.getByTestId('automation-flow-result')).toContainText('保存已验证产物', { timeout: 20_000 });
      await page.getByRole('button', { name: /^交付物$/ }).click();
      await expect(page.getByTestId('automation-flow-artifact-preview')).toContainText(/测试用例|Playwright/, { timeout: 10_000 });
    } finally {
      // 无论流程结果如何，都只清理本用例唯一标记的数据。
      await cleanupIsolatedContext(page.request, context);
    }
  });
});
