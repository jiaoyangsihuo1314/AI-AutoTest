import { expect, test } from '@playwright/test';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:5174';

test('一键自动化结构化日志自动展开、暂停跟随并恢复最新步骤', async ({ page }, testInfo) => {
  const project = { id: 'project-log-ui', name: '日志验证项目', projectCode: 'CODEX-LOG-UI', status: 'active' };
  const feature = {
    id: 'feature-log-ui',
    projectId: project.id,
    name: '登录流程',
    path: '登录流程',
    depth: 0,
    isActive: true,
  };
  const createdAt = new Date('2026-08-06T06:30:00.000Z');
  const logs = Array.from({ length: 24 }, (_, index) => ({
    id: index + 1,
    createdAt: new Date(createdAt.getTime() + index * 1000).toISOString(),
    stage: index < 4 ? '需求分析' : index < 8 ? '页面探索' : index < 18 ? '运行验证' : '自愈诊断',
    level: index === 16 ? 'error' : index === 19 ? 'warning' : index % 3 === 2 ? 'success' : 'info',
    message: index === 0 ? '历史兼容日志仍可展示' : `详细步骤 ${index + 1} 已记录`,
    stepKey: index === 0 ? '' : index < 18 ? 'run.business_step' : 'healing.diagnose',
    stepLabel: index === 0 ? '' : index === 10 ? '目标 URL 探测' : index < 18 ? `执行业务步骤 ${index}` : `第 1 轮诊断步骤 ${index - 17}`,
    stepStatus: index === 0 ? '' : index === 16 ? 'failed' : index === 19 ? 'retrying' : index % 3 === 2 ? 'passed' : 'started',
    durationMs: index === 10 ? 321 : index > 0 ? index * 110 : null,
    linkedRunId: index >= 8 ? 'run-ui-001' : '',
    evidencePath: index === 16 ? 'playwright-report/run-ui-001/index.html' : '',
    details: index === 7
      ? { missingTargets: [{ targetId: 'search-input', name: '搜索输入框', caseIds: ['TC-CODEX-LOG-001'] }] }
      : index >= 18 ? { round: 1, target: 'TC-CODEX-LOG-001' } : { runScope: 'full' },
  }));
  const flow = {
    id: 'flow-log-ui',
    flowRunId: 'flow-log-ui',
    workItemId: 'work-log-ui',
    projectId: project.id,
    featureId: feature.id,
    featureName: feature.name,
    featurePath: feature.path,
    status: 'running',
    stage: '运行验证',
    progress: 84,
    currentAttempt: 2,
    logs,
    flowArtifacts: [{
      id: 'healing-round-1-summary',
      flowRunId: 'flow-log-ui',
      workItemId: 'work-log-ui',
      stage: '自愈诊断',
      artifactType: 'healing-summary',
      title: '第 1 轮自愈诊断',
      status: 'failed',
      source: 'system',
      content: '第一轮重跑未通过，正在进入下一轮。',
      createdAt: new Date(createdAt.getTime() + 20_000).toISOString(),
      updatedAt: new Date(createdAt.getTime() + 20_000).toISOString(),
    }],
    workItem: {
      id: 'work-log-ui',
      title: 'CODEX_TEST_结构化日志验证',
      requirement: '验证一键自动化详细实时日志。',
      projectId: project.id,
      featureId: feature.id,
    },
  };

  await page.addInitScript(() => {
    class QuietWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;
      readyState = QuietWebSocket.CONNECTING;
      url: string;

      constructor(url: string) {
        super();
        this.url = url;
        window.setTimeout(() => {
          this.readyState = QuietWebSocket.OPEN;
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send() {}

      close() {
        if (this.readyState === QuietWebSocket.CLOSED) return;
        this.readyState = QuietWebSocket.CLOSED;
        this.dispatchEvent(new Event('close'));
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: QuietWebSocket });
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (!path.startsWith('/api/')) {
      await route.continue();
      return;
    }
    let body: unknown = {};
    if (path === '/api/auth/me') {
      body = { authenticated: true, user: { id: 'log-ui-user', username: 'log-ui', displayName: '日志验证用户', role: 'admin', status: 'active' } };
    } else if (path === '/api/health') {
      body = { status: 'ok' };
    } else if (path === '/api/projects') {
      body = [project];
    } else if (path === '/api/features') {
      body = { items: [feature], tree: [feature] };
    } else if (path === '/api/automation-flows' && request.method() === 'POST') {
      body = flow;
    } else if (path === '/api/automation-flows') {
      body = [];
    } else if (path === '/api/automation-flows/flow-log-ui') {
      body = flow;
    } else if (['/api/work-items', '/api/runs', '/api/test-cases', '/api/test-suites', '/api/suite-runs'].includes(path)) {
      body = [];
    } else if (path === '/api/deliverables') {
      body = [];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto(PLATFORM_URL);
  const navigation = page.getByRole('navigation', { name: '平台模块' });
  const workspaceGroup = navigation.getByRole('button', { name: '工作台', exact: true });
  if (await workspaceGroup.getAttribute('aria-expanded') === 'false') await workspaceGroup.click();
  await navigation.getByRole('button', { name: /^一键自动化/ }).click();

  await page.getByTestId('automation-flow-project').selectOption(project.id);
  await expect(page.getByTestId('automation-flow-feature')).toBeEnabled();
  await page.getByTestId('automation-flow-feature').selectOption(feature.id);
  await page.getByTestId('automation-flow-input').fill('验证一键自动化详细实时日志。');
  await page.getByRole('button', { name: '开始一键流程' }).click();

  const healingStage = page.getByTestId('automation-flow-stages').getByText('自愈诊断').locator('xpath=..');
  const executionStage = page.getByTestId('automation-flow-stages').getByText('运行验证').locator('xpath=..');
  await expect(healingStage).toHaveClass(/running/);
  await expect(healingStage).toContainText('进行中');
  await expect(executionStage).not.toHaveClass(/running/);

  const panel = page.getByTestId('automation-flow-logs');
  const summary = panel.getByRole('button', { name: /^实时日志/ });
  const stream = page.getByTestId('automation-flow-log-stream');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(stream).toContainText('历史兼容日志仍可展示');
  await expect(stream).toContainText('目标 URL 探测');
  await expect(stream).toContainText('耗时 321ms');
  await expect(stream).not.toContainText('耗时 0ms');
  await expect(stream).toContainText('Run run-ui-001');
  await expect(stream).toContainText('轮次 1');
  await expect(stream).toContainText('missingTargets: 搜索输入框（TC-CODEX-LOG-001）');
  await expect(stream).not.toContainText('[object Object]');
  await expect(stream).toContainText('证据：playwright-report/run-ui-001/index.html');
  await expect.poll(() => stream.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(2);

  const maximizeButton = panel.getByRole('button', { name: '最大化实时日志' });
  await maximizeButton.click();
  await expect(panel).toHaveAttribute('data-maximized', 'true');
  await expect(panel.getByRole('button', { name: '退出实时日志最大化' })).toBeVisible();
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    return box && viewport
      ? Math.max(Math.round(box.y), Math.round(viewport.height - box.height - box.y))
      : 999;
  }).toBeLessThanOrEqual(30);
  await page.screenshot({ path: testInfo.outputPath('automation-flow-log-maximized.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-maximized', 'false');
  await expect(maximizeButton).toBeVisible();

  await stream.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(panel.getByRole('button', { name: '回到最新' })).toBeVisible();
  await panel.getByRole('button', { name: '回到最新' }).click();
  await expect.poll(() => stream.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath('automation-flow-log-stream.png'), fullPage: true });

  await summary.click();
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await expect(stream).toHaveAttribute('aria-hidden', 'true');
  await page.waitForTimeout(1800);
  await expect(summary).toHaveAttribute('aria-expanded', 'false');

  flow.status = 'failed';
  flow.currentAttempt = 3;
  await expect(healingStage).toHaveClass(/failed/, { timeout: 5_000 });
  await expect(healingStage).toContainText('需处理');
});
