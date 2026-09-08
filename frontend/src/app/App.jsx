import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  Bell,
  Bot,
  Brain,
  Bug,
  CheckCircle2,
  CheckSquare,
  CircleHelp,
  CircleDot,
  ClipboardList,
  Code2,
  Copy,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  FileCheck2,
  FileText,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
  Lock,
  MoreHorizontal,
  MonitorPlay,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Save,
  Settings,
  ScrollText,
  Sparkles,
  Square,
  SquareTerminal,
  Table2,
  Wand2,
  Wrench,
  XCircle,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CalendarClock,
  Clock,
  Edit3,
  FileCode2,
  FolderTree,
  ListChecks,
  Maximize2,
  Minimize2,
  Search,
  Trash2,
  UserCog,
  UserRound,
  Upload,
  KeyRound,
  X,
} from 'lucide-react';
import autoTestLogoMark from '../assets/auto-test-logo-mark.png';
import CaseAssistantPanel from '../modules/case-assistant';
import GlobalAssistant from '../modules/global-assistant';
import AiConfigModule from '../modules/ai-config';
import { AuthGate, AuthPlatformLogo, AuthWorkspaceHero } from '../components/auth';
import { TopbarActions } from '../components/layout';
import { createReconnectingWebSocket } from '../utils/reconnecting-websocket';


import { API_BASE, WS_BASE, fetchJson as apiFetchJson, streamNdjson as apiStreamNdjson } from '../api/client';
const THEME_STORAGE_KEY = 'qa-platform-theme';
const ACTIVE_MODULE_STORAGE_KEY = 'qa-platform-active-module';
const OPEN_MODULE_TABS_STORAGE_KEY = 'qa-platform-open-module-tabs';
const CURRENT_PROJECT_STORAGE_KEY = 'qa-platform-current-project';
const TEST_EXECUTION_PROJECT_STORAGE_KEY = 'qa-platform-test-execution-project';
const SELECTED_SUITE_STORAGE_KEY = 'qa-platform-selected-suite';
const MONITOR_SUITE_RUN_STORAGE_KEY = 'qa-platform-monitor-suite-run';
const DEBUG_SESSION_QUERY_KEY = 'debugSessionId';
const DEBUG_BATCH_QUERY_KEY = 'debugBatchId';
const SUITE_VIEW_QUERY_KEY = 'suiteView';
const SUITE_ID_QUERY_KEY = 'suiteId';
const SUITE_VIEWS = new Set(['list', 'detail', 'edit', 'create']);
const THEMES = [
  {
    id: 'deep-sea',
    label: '深海',
    description: '经典深色',
    swatches: ['#07111d', '#14b8a6', '#2563eb'],
  },
  {
    id: 'obsidian-blue',
    label: '曜石蓝',
    description: '蓝靛暗色',
    swatches: ['#080b1a', '#6366f1', '#38bdf8'],
  },
  {
    id: 'teal-forest',
    label: '松石绿',
    description: '绿松暗色',
    swatches: ['#061511', '#10b981', '#22d3ee'],
  },
  {
    id: 'daylight',
    label: '晨光',
    description: '浅色办公',
    swatches: ['#f7fafc', '#2563eb', '#14b8a6'],
  },
];
const DEFAULT_THEME_ID = THEMES[0].id;
const THEME_IDS = new Set(THEMES.map((theme) => theme.id));

function readStoredTheme() {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID;
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_IDS.has(storedTheme) ? storedTheme : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

function storeTheme(themeId) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // Theme persistence is a convenience; the active in-memory theme should keep working.
  }
}

function elementKey(element) {
  const locatorType = element.locatorType || element.locator_type || '';
  const locatorValue = element.locatorValue || element.locator_value || '';
  if (!locatorType || !locatorValue) return '';
  const stepIndex = element.stepIndex ?? element.step_index ?? '';
  const sourceUrl = element.sourceUrl || element.source_url || '';
  return `${locatorType}::${locatorValue}::${stepIndex}::${sourceUrl}`;
}

function formatLogTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDuration(startedAt, endedAt = '') {
  if (!startedAt) return '-';
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-';
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;
  if (hours) return `${hours}h ${remainingMinutes}m`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function summarizeContent(value, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

const MODULES = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'automation-flow', label: '一键自动化', icon: SquareTerminal },
  { id: 'test-suites', label: '测试套件', icon: ListChecks },
  { id: 'execution-monitor', label: '执行监控', icon: RadioTower },
  { id: 'requirements', label: '需求工单', icon: ClipboardList },
  { id: 'cases', label: '用例设计', icon: FileCheck2 },
  { id: 'exploration', label: '探索实验室', icon: FlaskConical },
  { id: 'scripts', label: '脚本工作台', icon: Code2 },
  { id: 'execution', label: '执行测试', icon: MonitorPlay },
  { id: 'healing', label: '自愈诊断', icon: Wand2 },
  { id: 'delivery', label: '测试报告', icon: FileText },
  { id: 'projects', label: '项目管理', icon: Database },
  { id: 'case-management', label: '用例管理', icon: Table2 },
  { id: 'feature-menus', label: '功能配置', icon: FolderTree },
  { id: 'ai-config', label: 'AI 配置', icon: Settings },
  { id: 'user-management', label: '用户管理', icon: UserCog },
];

const HOME_MODULE_ID = 'overview';
const MODULE_LOOKUP = Object.fromEntries(MODULES.map((module) => [module.id, module]));
const NAV_GROUPS = [
  { id: 'workspace', title: '工作台', icon: LayoutDashboard, moduleIds: ['overview', 'automation-flow'] },
  {
    id: 'manual-workbench',
    title: '人工工作台',
    icon: ClipboardList,
    moduleIds: ['requirements', 'cases', 'exploration', 'scripts', 'execution', 'healing'],
  },
  { id: 'test-execution', title: '测试执行', icon: MonitorPlay, moduleIds: ['test-suites', 'execution-monitor'] },
  { id: 'assets', title: '资产管理', icon: Database, moduleIds: ['projects', 'case-management', 'delivery'] },
  { id: 'settings', title: '系统设置', icon: Settings, moduleIds: ['user-management', 'ai-config', 'feature-menus'] },
];
const DEFAULT_EXPANDED_NAV_GROUP_IDS = [];
const MODULE_GROUP_LOOKUP = Object.fromEntries(NAV_GROUPS.flatMap((group) => group.moduleIds.map((moduleId) => [moduleId, group.id])));
const ROLE_LABELS = {
  admin: '管理员',
  lead: '测试负责人',
  executor: '测试执行者',
  viewer: '只读访客',
};
const STATUS_LABELS = {
  pending: '待审核',
  active: '已启用',
  disabled: '已禁用',
};
const MODULE_ROLE_ACCESS = {
  overview: ['admin', 'lead', 'executor', 'viewer'],
  'test-suites': ['admin', 'lead', 'executor', 'viewer'],
  'execution-monitor': ['admin', 'lead', 'executor', 'viewer'],
  requirements: ['admin', 'lead', 'executor', 'viewer'],
  cases: ['admin', 'lead', 'executor', 'viewer'],
  exploration: ['admin', 'lead', 'executor', 'viewer'],
  scripts: ['admin', 'lead', 'executor', 'viewer'],
  execution: ['admin', 'lead', 'executor', 'viewer'],
  healing: ['admin', 'lead', 'executor', 'viewer'],
  delivery: ['admin', 'lead', 'executor', 'viewer'],
  projects: ['admin', 'lead', 'viewer'],
  'case-management': ['admin', 'lead', 'executor', 'viewer'],
  'automation-flow': ['admin', 'lead', 'executor', 'viewer'],
  'feature-menus': ['admin', 'lead'],
  'ai-config': ['admin'],
  'user-management': ['admin'],
};

function readStoredActiveModule() {
  if (typeof window === 'undefined') return HOME_MODULE_ID;
  try {
    if (new URLSearchParams(window.location.search).has(SUITE_VIEW_QUERY_KEY)) return 'test-suites';
    const moduleId = window.localStorage.getItem(ACTIVE_MODULE_STORAGE_KEY);
    return MODULE_LOOKUP[moduleId] ? moduleId : HOME_MODULE_ID;
  } catch {
    return HOME_MODULE_ID;
  }
}

function readSuiteRoute() {
  if (typeof window === 'undefined') return { view: 'list', suiteId: '' };
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get(SUITE_VIEW_QUERY_KEY) || 'list';
  const suiteId = params.get(SUITE_ID_QUERY_KEY) || '';
  const view = SUITE_VIEWS.has(requestedView) ? requestedView : 'list';
  if ((view === 'detail' || view === 'edit') && !suiteId) return { view: 'list', suiteId: '' };
  return { view, suiteId: view === 'detail' || view === 'edit' ? suiteId : '' };
}

function replaceSuiteRouteUrl(view = 'list', suiteId = '', mode = 'replace') {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set(SUITE_VIEW_QUERY_KEY, view);
  if (suiteId && (view === 'detail' || view === 'edit')) url.searchParams.set(SUITE_ID_QUERY_KEY, suiteId);
  else url.searchParams.delete(SUITE_ID_QUERY_KEY);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (mode === 'push') window.history.pushState({}, '', nextUrl);
  else window.history.replaceState({}, '', nextUrl);
}

function clearSuiteRouteUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete(SUITE_VIEW_QUERY_KEY);
  url.searchParams.delete(SUITE_ID_QUERY_KEY);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function readStoredOpenModuleTabs() {
  if (typeof window === 'undefined') return [HOME_MODULE_ID];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OPEN_MODULE_TABS_STORAGE_KEY) || '[]');
    const tabs = Array.isArray(parsed)
      ? parsed.filter((moduleId) => MODULE_LOOKUP[moduleId])
      : [];
    const uniqueTabs = Array.from(new Set([HOME_MODULE_ID, ...tabs]));
    return uniqueTabs.length ? uniqueTabs : [HOME_MODULE_ID];
  } catch {
    return [HOME_MODULE_ID];
  }
}

function readStoredCurrentProjectId() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function readStoredString(key, fallback = '') {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function storeJson(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Navigation persistence should never block the in-memory app state.
  }
}

function storeString(key, value) {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Navigation persistence should never block the in-memory app state.
  }
}

const FLOW = ['需求分析', '项目预检', '用例设计', '页面探索', '脚本实现', '运行验证', '自愈诊断', '保存已验证产物'];
const AUTOMATION_FLOW_STAGES = FLOW;
const WORKFLOW_MODULE_STAGES = {
  requirements: '需求分析',
  cases: '用例设计',
  exploration: '页面探索',
  scripts: '脚本实现',
  execution: '运行验证',
  healing: '自愈诊断',
};
const WORKFLOW_CONTEXT_MODULES = new Set(Object.keys(WORKFLOW_MODULE_STAGES));
const MANUAL_WORKSPACE_MODULE_IDS = Object.freeze(['requirements', 'cases', 'exploration', 'scripts', 'execution', 'healing']);
const MANUAL_WORKSPACE_MODULE_SET = new Set(MANUAL_WORKSPACE_MODULE_IDS);
const RESETTABLE_MODULE_SET = new Set(['automation-flow', ...MANUAL_WORKSPACE_MODULE_IDS]);

function getWorkflowStageContext(activeModule, item) {
  const fallbackStage = WORKFLOW_MODULE_STAGES[activeModule] || FLOW[0];
  const candidateStage = activeModule === 'overview' && FLOW.includes(item?.stage) ? item.stage : fallbackStage;
  const stageIndex = Math.max(0, FLOW.indexOf(candidateStage));
  return {
    stage: FLOW[stageIndex],
    previousStage: FLOW[stageIndex - 1] || '无前置',
    nextStage: FLOW[stageIndex + 1] || '已到交付',
    progress: Math.round(((stageIndex + 1) / FLOW.length) * 100),
  };
}

function formatDetailedLogTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (item) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatFlowLogDuration(durationMs) {
  if (durationMs == null || durationMs === '') return '';
  const milliseconds = Number(durationMs);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function flowLogStepStatusLabel(status, level = '') {
  return {
    started: '进行中',
    passed: '通过',
    failed: '失败',
    warning: '警告',
    retrying: '重试',
    skipped: '跳过',
  }[status] || {
    success: '通过',
    error: '失败',
    blocked: '阻塞',
    warning: '警告',
  }[level] || level || '记录';
}

function flowLogDetailEntries(log) {
  const details = log?.details && typeof log.details === 'object' && !Array.isArray(log.details) ? log.details : {};
  const hiddenKeys = new Set(['round', 'runId']);
  return Object.entries(details)
    .filter(([key, value]) => !hiddenKeys.has(key) && value !== '' && value !== null && value !== undefined)
    .slice(0, 8)
    .map(([key, value]) => [key, formatFlowLogDetailValue(value)]);
}

function formatFlowLogDetailValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!item || typeof item !== 'object') return String(item);
      const name = item.name || item.targetId || item.id || '未命名项';
      const caseIds = Array.isArray(item.caseIds) ? item.caseIds.filter(Boolean) : [];
      return `${name}${caseIds.length ? `（${caseIds.join('、')}）` : ''}`;
    }).join('；');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function statusLabel(status) {
  return {
    draft: '草稿',
    verified: '已验证',
    active: '生效中',
    archived: '已归档',
    explored: '已探索',
    'explored-draft': '探索待确认',
    exploring: '探索中',
    'cases-ready': '用例就绪',
    'script-ready': '脚本就绪',
    'artifacts-saved': '已保存交付物',
    'review-required': '下游待复核',
    designed: '已设计',
    automated: '已自动化',
    manual: '人工',
    ready: '已生成',
    skipped: '跳过',
    queued: '排队中',
    generating: '生成修复脚本',
    rerunning: '重新执行中',
    rejected: '修复未采用',
    recorded: '历史记录',
    running: '运行中',
    healing: '自愈中',
    passed: '已通过',
    partial: '部分通过',
    'partially-verified': '部分验证',
    failed: '失败',
    idle: '待命',
    blocked: '阻塞',
    completed: '已完成',
    cancelled: '已取消',
  }[status] || status;
}

function credentialFieldLabel(field) {
  if (field === 'username') return '用户名';
  if (field === 'password') return '密码';
  return field;
}

function isPartialAutomationFlow(flow, status = flow?.status) {
  return status === 'completed' && flow?.outcome?.mode === 'partial';
}

function automationFlowStatusLabel(status, flow) {
  return isPartialAutomationFlow(flow, status) ? '已完成，有警告' : statusLabel(status);
}

function automationFlowStatusClass(status, flow) {
  return isPartialAutomationFlow(flow, status) ? 'completed-warning' : status;
}

function healingDiagnosisCategoryLabel(category) {
  return {
    'test-code': '测试脚本问题',
    'test-data-environment': '账号/环境待确认',
    'product-expectation': '产品行为与预期不一致',
    unknown: '根因待确认',
  }[category] || category || '尚未分类';
}

function healingDiagnosisActionLabel(action) {
  return {
    repair: '自动修复脚本',
    confirm: '原脚本确认复跑',
    block: '停止自愈并人工确认',
  }[action] || action || '-';
}

const TERMINAL_FLOW_STATUSES = new Set(['completed', 'failed', 'blocked', 'cancelled']);
const ACTIVE_FLOW_STATUSES = new Set(['queued', 'running', 'healing']);
const ACTIVE_RUN_STATUSES = new Set(['queued', 'running']);

function isTerminalFlowStatus(status) {
  return TERMINAL_FLOW_STATUSES.has(status);
}

function isActiveFlowStatus(status) {
  return ACTIVE_FLOW_STATUSES.has(status);
}

function isActiveRunStatus(status) {
  return ACTIVE_RUN_STATUSES.has(status);
}

function browserConnectionDetail(payload) {
  if (payload.message) return payload.message;
  if (payload.queuePosition > 0) {
    return `等待浏览器资源，当前排队第 ${payload.queuePosition} 位（${payload.activeBrowserCount || 0}/${payload.browserLimit || 10}）`;
  }
  return '';
}

function assetModeLabel(mode) {
  return {
    create: '新建',
    refresh: '刷新替换',
    append: '追加',
  }[mode] || mode || '新建';
}

function projectTypeLabel(type) {
  return {
    product: '产品类',
    delivery: '交付类',
  }[type] || type || '-';
}

function projectStatusLabel(status) {
  return {
    planning: '规划中',
    active: '进行中',
    paused: '暂停',
    completed: '已完成',
    archived: '已归档',
  }[status] || status || '-';
}

function emptyProjectForm(project = {}) {
  const sourceEnvironments = project.environments?.length
    ? project.environments
    : project.targetUrl
      ? [{ id: '', name: '默认环境', url: project.targetUrl, isDefault: true }]
      : [];
  return {
    project_code: project.projectCode || '',
    name: project.name || '',
    project_type: project.projectType || 'product',
    status: project.status || 'active',
    target_url: project.targetUrl || '',
    environments: sourceEnvironments.map((environment, index) => ({
      id: environment.id || '',
      name: environment.name || '',
      url: environment.url || '',
      is_default: Boolean(environment.isDefault ?? environment.is_default),
      _key: environment.id || `environment-${Date.now()}-${index}`,
    })),
    repository_path: project.repositoryPath || '/Users/syj/Documents/qa-project',
    test_dir: project.testDir || 'tests/e2e',
    description: project.description || '',
  };
}

function emptyRequirement() {
  return {
    title: '',
    title_mode: 'auto',
    requirement: '',
    target_url: '',
    role: '',
    test_data: '',
    acceptance: '',
    exclusions: '',
  };
}

function requirementFromWorkItem(item = {}) {
  return {
    title: item.title || '',
    title_mode: item.titleSource || 'manual',
    requirement: item.requirement || '',
    target_url: item.targetUrl || '',
    role: item.role || '',
    test_data: item.testData || '',
    acceptance: item.acceptance || '',
    exclusions: item.exclusions || '',
  };
}

function emptyExploration() {
  return {
    notes: '等待根据测试用例执行页面探索并确认真实元素。',
    screenshot_path: 'artifacts/automation-platform/browser-preview.svg',
    page_structure: '页面结构将在探索完成后回填；最终 selector 必须人工确认。',
    state_evidence: [],
    elements: [],
  };
}

function emptyScriptGenerationState() {
  return {
    total: 0,
    caseIds: [],
    currentIndex: 0,
    currentCaseId: '',
    statuses: {},
    errors: {},
    failedCaseIds: [],
  };
}

function emptyCaseReportFilters() {
  return { q: '', status: 'all' };
}

function emptyManualReportFilters() {
  return { q: '', status: 'all' };
}

function emptyReportScopeFilters() {
  return { project_id: '', work_item_id: '' };
}

function defaultSuiteRunConfig() {
  return {
    mode: 'serial',
    failurePolicy: 'continue',
    retryCount: 0,
    runFailedOnly: false,
    environmentId: '',
  };
}

function projectForWorkItem(projects, item) {
  return projects.find((project) => project.id === item?.projectId) || null;
}

function environmentSelectionForWorkItem(projects, item) {
  const project = projectForWorkItem(projects, item);
  if (!project) return '';
  return project.environments?.find((environment) => environment.url === item?.targetUrl)?.id
    || project.defaultEnvironmentId
    || '';
}

function defaultSuiteScheduleConfig() {
  return {
    enabled: false,
    frequency: 'off',
    time: '09:00',
    weekday: '1',
    intervalMinutes: 60,
    timezone: 'Asia/Shanghai',
    note: '',
  };
}

function normalizeSuiteForm(suite = {}) {
  return {
    projectId: suite.projectId || suite.project_id || '',
    name: suite.name || '',
    description: suite.description || '',
    status: suite.status || 'active',
    runConfig: { ...defaultSuiteRunConfig(), ...(suite.runConfig || {}) },
    scheduleConfig: { ...defaultSuiteScheduleConfig(), ...(suite.scheduleConfig || {}) },
    caseIds: [...(suite.caseIds || [])],
  };
}

function suiteCaseStats(suite, cases) {
  const ids = new Set(suite?.caseIds || []);
  const suiteCases = cases.filter((item) => ids.has(item.id));
  const automated = suiteCases.filter((item) => item.automationStatus === 'automated' || item.specPath).length;
  const priorities = suiteCases.reduce((acc, item) => {
    const key = item.priority || 'P2';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { P0: 0, P1: 0, P2: 0 });
  return { total: suiteCases.length, automated, priorities };
}

function scheduleConfigLabel(config = defaultSuiteScheduleConfig()) {
  const value = { ...defaultSuiteScheduleConfig(), ...config };
  if (!value.enabled || value.frequency === 'off') return '未配置';
  if (value.frequency === 'daily') return `每天 ${value.time}`;
  if (value.frequency === 'weekly') return `每周${value.weekday} ${value.time}`;
  return `每 ${value.intervalMinutes} 分钟`;
}

function buildReportListPath(endpoint, filters, page = 1, pageSize = 50) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  Object.entries(filters).forEach(([key, value]) => {
    if (!value || value === 'all') return;
    params.set(key, value);
  });
  return `${endpoint}?${params.toString()}`;
}

function buildSuiteRunsPath(projectId = 'all', suiteName = '') {
  const params = new URLSearchParams();
  params.set('project_id', projectId || 'all');
  const normalizedSuiteName = suiteName.trim();
  if (normalizedSuiteName) params.set('suite_name', normalizedSuiteName);
  return `/api/suite-runs?${params.toString()}`;
}

function playwrightReportUrl({ runId = '', suiteRunId = '' } = {}) {
  if (runId) return `${API_BASE}/reports/playwright/runs/${encodeURIComponent(runId)}`;
  if (suiteRunId) return `${API_BASE}/reports/playwright/suite-runs/${encodeURIComponent(suiteRunId)}`;
  return `${API_BASE}/reports/playwright/`;
}

function deliverableReportUrl(deliverable) {
  if (!deliverable?.id) return '';
  return `${API_BASE}/reports/deliverables/${encodeURIComponent(deliverable.id)}`;
}

function reportRecordUrl(report) {
  if (!report?.id) return '';
  return `${API_BASE}/reports/report-records/${encodeURIComponent(report.id)}`;
}

function artifactReportUrl(artifact) {
  if (!artifact) return '';
  if (artifact.artifactType === 'html-report' && artifact.path) {
    const params = new URLSearchParams({ path: artifact.path });
    return `${API_BASE}/reports/file?${params.toString()}`;
  }
  if (artifact.artifactType === 'html-report') return playwrightReportUrl();
  if (artifact.path && ['manual-report', 'final-report'].includes(artifact.artifactType)) {
    const params = new URLSearchParams({ path: artifact.path });
    return `${API_BASE}/reports/file?${params.toString()}`;
  }
  return '';
}

function openReportUrl(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function drawBrowserFrame(canvas, payload, onFrameDrawn) {
  if (!canvas) return;
  const image = new Image();
  image.onload = () => {
    const context = canvas.getContext('2d');
    canvas.width = payload.width || 1440;
    canvas.height = payload.height || 900;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    onFrameDrawn?.();
  };
  image.src = `data:image/${payload.format || 'jpeg'};base64,${payload.data}`;
}

function clearBrowserCanvas(canvas) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

function BrowserPreviewToggle({ enabled, onChange, testId }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="实时浏览器预览"
      className={`browser-preview-toggle ${enabled ? 'enabled' : ''}`}
      data-testid={testId}
      onClick={() => onChange(!enabled)}
    >
      <span className="browser-preview-toggle-track" aria-hidden="true">
        <span className="browser-preview-toggle-thumb" />
      </span>
      <span>实时预览 {enabled ? '开' : '关'}</span>
    </button>
  );
}

function flattenFeatureTree(nodes = [], depth = 0) {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flattenFeatureTree(node.children || [], depth + 1),
  ]);
}

function buildFeatureTree(features = []) {
  const nodesById = new Map();
  features.forEach((feature) => {
    if (!feature?.id) return;
    nodesById.set(feature.id, {
      ...feature,
      parentId: feature.parentId || feature.parent_id || '',
      children: [],
    });
  });
  const roots = [];
  nodesById.forEach((node) => {
    const parent = nodesById.get(node.parentId);
    if (parent && parent.id !== node.id) {
      parent.children.push(node);
      return;
    }
    roots.push(node);
  });
  return roots;
}

function isAuthRequiredError(error) {
  return error?.message === '请先登录';
}

function collectFeatureIds(node) {
  return [
    node.id,
    ...(node.children || []).flatMap((child) => collectFeatureIds(child)),
  ].filter(Boolean);
}

function activeFeatureOptions(features = [], selectedFeatureId = '') {
  return features.filter((feature) => feature.isActive || feature.id === selectedFeatureId);
}

function App() {
  const [activeModule, setActiveModule] = useState(readStoredActiveModule);
  const [openModuleTabs, setOpenModuleTabs] = useState(() => {
    const tabs = readStoredOpenModuleTabs();
    return tabs.includes(activeModule) ? tabs : [...tabs, activeModule];
  });
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [themeId, setThemeId] = useState(readStoredTheme);
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [users, setUsers] = useState([]);
  const [userActionMessage, setUserActionMessage] = useState('');
  const [health, setHealth] = useState({ status: 'checking', ai: { configured: false } });
  const [workItems, setWorkItems] = useState([]);
  const [currentItem, setCurrentItem] = useState(null);
  const currentItemRef = useRef(null);
  const selectedWorkItemIdRef = useRef('');
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState(readStoredCurrentProjectId);
  const [requirementProjectId, setRequirementProjectId] = useState(readStoredCurrentProjectId);
  const [testExecutionProjectId, setTestExecutionProjectId] = useState(() => readStoredString(TEST_EXECUTION_PROJECT_STORAGE_KEY, 'all'));
  const [dashboardScopeProjectId, setDashboardScopeProjectId] = useState('all');
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [openingSuiteRunId, setOpeningSuiteRunId] = useState('');
  const [testCases, setTestCases] = useState([]);
  const [features, setFeatures] = useState([]);
  const [featureTree, setFeatureTree] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [reportTab, setReportTab] = useState('case');
  const [reportScopeFilters, setReportScopeFilters] = useState(emptyReportScopeFilters);
  const [caseReports, setCaseReports] = useState({ items: [], total: 0, page: 1, pageSize: 50 });
  const [caseReportFilters, setCaseReportFilters] = useState(emptyCaseReportFilters);
  const [manualReports, setManualReports] = useState({ items: [], total: 0, page: 1, pageSize: 50 });
  const [manualReportFilters, setManualReportFilters] = useState(emptyManualReportFilters);
  const [suites, setSuites] = useState([]);
  const [suiteCaseProjects, setSuiteCaseProjects] = useState([]);
  const [suiteRuns, setSuiteRuns] = useState([]);
  const [latestSuiteRun, setLatestSuiteRun] = useState(null);
  const [monitorSuiteNameFilter, setMonitorSuiteNameFilter] = useState('');
  const [monitorQueryRevision, setMonitorQueryRevision] = useState(0);
  const [monitorSuiteRunId, setMonitorSuiteRunId] = useState(() => readStoredString(MONITOR_SUITE_RUN_STORAGE_KEY));
  const [monitorSuiteRunDetail, setMonitorSuiteRunDetail] = useState(null);
  const [monitorLogs, setMonitorLogs] = useState([]);
  const [monitorLogLevel, setMonitorLogLevel] = useState('all');
  const [monitorSelectedCaseRunId, setMonitorSelectedCaseRunId] = useState('');
  const [monitorBrowserStatus, setMonitorBrowserStatus] = useState('Closed');
  const [monitorBrowserDetail, setMonitorBrowserDetail] = useState('');
  const [monitorBrowserLiveConnected, setMonitorBrowserLiveConnected] = useState(false);
  const [monitorBrowserHasFrame, setMonitorBrowserHasFrame] = useState(false);
  const [monitorBrowserPreviewEnabled, setMonitorBrowserPreviewEnabled] = useState(false);
  const [monitorBrowserRun, setMonitorBrowserRun] = useState(null);
  const monitorBrowserSocketRef = useRef(null);
  const monitorBrowserCanvasRef = useRef(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState(() => new Set());
  const [scriptEditor, setScriptEditor] = useState({
    open: false,
    loading: false,
    saving: false,
    error: '',
    detail: null,
    content: '',
    sourceCase: null,
  });
  const [selectedSuiteId, setSelectedSuiteId] = useState(() => readStoredString(SELECTED_SUITE_STORAGE_KEY));
  const [suiteForm, setSuiteForm] = useState(() => normalizeSuiteForm());
  const [suiteFormBaseline, setSuiteFormBaseline] = useState(() => normalizeSuiteForm());
  const [suiteEditing, setSuiteEditing] = useState(false);
  const [suiteView, setSuiteView] = useState(() => readSuiteRoute().view);
  const [suiteRouteId, setSuiteRouteId] = useState(() => readSuiteRoute().suiteId);
  const [suiteRouteLoading, setSuiteRouteLoading] = useState(false);
  const [suiteRouteError, setSuiteRouteError] = useState('');
  const [suiteRouteRecord, setSuiteRouteRecord] = useState(null);
  const suiteRouteRequestRef = useRef(0);
  const suiteFormDirty = suiteEditing && JSON.stringify(suiteForm) !== JSON.stringify(suiteFormBaseline);
  const [runs, setRuns] = useState([]);
  const [logs, setLogs] = useState([]);
  const [screenshot, setScreenshot] = useState('');
  const [explorationPreview, setExplorationPreview] = useState('');
  const [explorationRun, setExplorationRun] = useState(null);
  const [explorationLogs, setExplorationLogs] = useState([]);
  const [browserStatus, setBrowserStatus] = useState('Closed');
  const [browserStatusDetail, setBrowserStatusDetail] = useState('');
  const [liveConnected, setLiveConnected] = useState(false);
  const [explorationBrowserPreviewEnabled, setExplorationBrowserPreviewEnabled] = useState(false);
  const browserSocketRef = useRef(null);
  const browserCanvasRef = useRef(null);
  const [executionBrowserStatus, setExecutionBrowserStatus] = useState('Closed');
  const [executionBrowserDetail, setExecutionBrowserDetail] = useState('');
  const [executionLiveConnected, setExecutionLiveConnected] = useState(false);
  const [executionBrowserPreviewEnabled, setExecutionBrowserPreviewEnabled] = useState(false);
  const [executionEnvironmentId, setExecutionEnvironmentId] = useState('');
  const executionBrowserSocketRef = useRef(null);
  const executionBrowserCanvasRef = useRef(null);
  const ignoredExecutionRunIdRef = useRef('');
  const [healingLogs, setHealingLogs] = useState([]);
  const [healingDiagnosticLogs, setHealingDiagnosticLogs] = useState([]);
  const [healingBrowserStatus, setHealingBrowserStatus] = useState('Closed');
  const [healingBrowserDetail, setHealingBrowserDetail] = useState('');
  const [healingLiveConnected, setHealingLiveConnected] = useState(false);
  const [healingBrowserPreviewEnabled, setHealingBrowserPreviewEnabled] = useState(false);
  const [healingEnvironmentId, setHealingEnvironmentId] = useState('');
  const healingBrowserSocketRef = useRef(null);
  const healingBrowserCanvasRef = useRef(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exploring, setExploring] = useState(false);
  const [explorationSaving, setExplorationSaving] = useState(false);
  const [caseAction, setCaseAction] = useState('');
  const [scriptAction, setScriptAction] = useState('');
  const [manualClearAction, setManualClearAction] = useState('');
  const [executionStarting, setExecutionStarting] = useState(false);
  const [artifactsSaving, setArtifactsSaving] = useState(false);
  const [confirmedElementKeys, setConfirmedElementKeys] = useState(() => new Set());
  const confirmedElementKeysRef = useRef(confirmedElementKeys);
  const [analyzingRequirement, setAnalyzingRequirement] = useState(false);
  const [requirementForm, setRequirementForm] = useState(emptyRequirement());
  const [requirementDirty, setRequirementDirty] = useState(false);
  const [requirementFeatureId, setRequirementFeatureId] = useState('');
  const [requirementFeatureOptions, setRequirementFeatureOptions] = useState([]);
  const [requirementFeatureTree, setRequirementFeatureTree] = useState([]);
  const [exploration, setExploration] = useState(emptyExploration);
  const [casesMarkdown, setCasesMarkdown] = useState('');
  const [pendingCaseDeletions, setPendingCaseDeletions] = useState([]);
  const [assistantProposalCommits, setAssistantProposalCommits] = useState([]);
  const [scriptContent, setScriptContent] = useState('');
  const [selectedScriptCaseId, setSelectedScriptCaseId] = useState('');
  const [fixtureContent, setFixtureContent] = useState('');
  const [scriptGeneration, setScriptGeneration] = useState(emptyScriptGenerationState);
  const [debugSession, setDebugSession] = useState(null);
  const [debugBatch, setDebugBatch] = useState(null);
  const [debugExecutionScope, setDebugExecutionScope] = useState('auto');
  const [debugSessionLoading, setDebugSessionLoading] = useState('');
  const [debugBatchLoading, setDebugBatchLoading] = useState(false);
  const [debugAction, setDebugAction] = useState('');
  const [assetMode, setAssetMode] = useState('create');
  const [healingRun, setHealingRun] = useState(null);
  const [healingStarting, setHealingStarting] = useState(false);
  const [automationRequirement, setAutomationRequirement] = useState('');
  const [automationProjectId, setAutomationProjectId] = useState('');
  const [automationFeatureId, setAutomationFeatureId] = useState('');
  const [automationFeatureOptions, setAutomationFeatureOptions] = useState([]);
  const [automationFeatureTree, setAutomationFeatureTree] = useState([]);
  const [automationFlow, setAutomationFlow] = useState(null);
  const [automationFlowId, setAutomationFlowId] = useState('');
  const [automationLiveTracking, setAutomationLiveTracking] = useState(false);
  const [automationFlowHistory, setAutomationFlowHistory] = useState([]);
  const [automationHistoryLoading, setAutomationHistoryLoading] = useState(false);
  const [automationHistoryError, setAutomationHistoryError] = useState('');
  const [automationHistoryRestoringId, setAutomationHistoryRestoringId] = useState('');
  const [automationLogs, setAutomationLogs] = useState([]);
  const [automationArtifacts, setAutomationArtifacts] = useState([]);
  const [automationStatus, setAutomationStatus] = useState('idle');
  const [automationStopping, setAutomationStopping] = useState(false);
  const [automationRetrying, setAutomationRetrying] = useState(false);
  const [automationActiveStage, setAutomationActiveStage] = useState('');
  const [automationLiveConnected, setAutomationLiveConnected] = useState(false);
  const [automationBrowserStatus, setAutomationBrowserStatus] = useState('Closed');
  const [automationBrowserDetail, setAutomationBrowserDetail] = useState('');
  const [automationBrowserLiveConnected, setAutomationBrowserLiveConnected] = useState(false);
  const [automationBrowserSessionId, setAutomationBrowserSessionId] = useState('');
  const [automationBrowserMode, setAutomationBrowserMode] = useState('exploration');
  const [automationBrowserHasFrame, setAutomationBrowserHasFrame] = useState(false);
  const [automationBrowserPreviewEnabled, setAutomationBrowserPreviewEnabled] = useState(false);
  const [automationResetKey, setAutomationResetKey] = useState(0);
  const [detachedManualModules, setDetachedManualModules] = useState(() => new Set());
  const automationFlowSocketRef = useRef(null);
  const automationBrowserSocketRef = useRef(null);
  const automationBrowserCanvasRef = useRef(null);
  const automationLogRef = useRef(null);
  const dismissedAutomationTerminalErrorsRef = useRef(new Set());
  const activeAutomationTerminalErrorRef = useRef({ key: '', message: '' });
  const [expandedNavGroups, setExpandedNavGroups] = useState(() => new Set(DEFAULT_EXPANDED_NAV_GROUP_IDS));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const tabMenuRef = useRef(null);
  const moduleTabsRef = useRef(null);
  const activeModuleTabRef = useRef(null);
  const activeModuleRef = useRef(activeModule);
  const skipAutoSelectWorkItemRef = useRef(false);
  const scrollPositionsRef = useRef({ [HOME_MODULE_ID]: 0 });
  const pendingScrollRestoreRef = useRef(null);
  const moduleSessionVersionsRef = useRef(Object.fromEntries([...RESETTABLE_MODULE_SET].map((moduleId) => [moduleId, 0])));

  function currentWindowScrollY() {
    if (typeof window === 'undefined') return 0;
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function saveActiveModuleScrollPosition() {
    scrollPositionsRef.current[activeModuleRef.current] = currentWindowScrollY();
  }

  function restoreModuleScrollPosition(moduleId, fallbackPosition = 0) {
    if (typeof window === 'undefined') return;
    const top = scrollPositionsRef.current[moduleId] ?? fallbackPosition;
    pendingScrollRestoreRef.current = { moduleId, top };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const pending = pendingScrollRestoreRef.current;
        if (!pending || pending.moduleId !== moduleId) return;
        window.scrollTo({ top: Math.max(0, pending.top), left: 0, behavior: 'auto' });
        pendingScrollRestoreRef.current = null;
      });
    });
  }

  function keepScrollPositionsForTabs(tabs) {
    const allowedTabs = new Set(tabs);
    Object.keys(scrollPositionsRef.current).forEach((moduleId) => {
      if (!allowedTabs.has(moduleId)) delete scrollPositionsRef.current[moduleId];
    });
  }

  function attachManualModuleSessions(moduleIds = MANUAL_WORKSPACE_MODULE_IDS) {
    const requested = new Set(Array.isArray(moduleIds) ? moduleIds : [moduleIds]);
    setDetachedManualModules((previous) => {
      if (![...requested].some((moduleId) => previous.has(moduleId))) return previous;
      const next = new Set(previous);
      requested.forEach((moduleId) => next.delete(moduleId));
      return next;
    });
  }

  function openManualModuleSession(moduleId) {
    attachManualModuleSessions(moduleId);
    openModule(moduleId);
  }

  function resetModulePageSession(moduleId) {
    if (!RESETTABLE_MODULE_SET.has(moduleId)) return;
    moduleSessionVersionsRef.current[moduleId] = (moduleSessionVersionsRef.current[moduleId] || 0) + 1;
    if (moduleId === 'automation-flow') {
      resetAutomationPageSession();
      return;
    }
    setDetachedManualModules((previous) => new Set(previous).add(moduleId));
    clearLocalManualPageState(moduleId, { preserveWorkspace: true });
  }

  function resetClosedModuleSessions(moduleIds) {
    moduleIds.forEach(resetModulePageSession);
  }

  function manualPageItem(moduleId) {
    return detachedManualModules.has(moduleId) ? null : currentItem;
  }

  function captureModuleSession(moduleId) {
    return moduleSessionVersionsRef.current[moduleId] || 0;
  }

  function isCurrentModuleSession(moduleId, version) {
    return captureModuleSession(moduleId) === version;
  }

  function openModule(moduleId) {
    if (!MODULE_LOOKUP[moduleId]) return;
    if (!moduleAllowed(moduleId)) {
      setError('当前账号无权访问该模块');
      return;
    }
    if (activeModuleRef.current === 'test-suites' && moduleId !== 'test-suites' && !confirmDiscardSuiteChanges()) return;
    if (activeModuleRef.current === moduleId) {
      setTabMenuOpen(false);
      return;
    }
    if (moduleId === 'test-suites') resetSuiteRouteState('list');
    else if (activeModuleRef.current === 'test-suites') clearSuiteRouteState();
    saveActiveModuleScrollPosition();
    const alreadyOpen = openModuleTabs.includes(moduleId);
    setOpenModuleTabs((previous) => (previous.includes(moduleId) ? previous : [...previous, moduleId]));
    activeModuleRef.current = moduleId;
    setActiveModule(moduleId);
    setTabMenuOpen(false);
    restoreModuleScrollPosition(moduleId, alreadyOpen ? 0 : 0);
  }

  function closeModuleTab(moduleId) {
    if (moduleId === HOME_MODULE_ID) return;
    if (!openModuleTabs.includes(moduleId)) return;
    if (activeModule === moduleId && moduleId === 'test-suites' && !confirmDiscardSuiteChanges()) return;
    saveActiveModuleScrollPosition();
    const currentIndex = openModuleTabs.indexOf(moduleId);
    const nextTabs = openModuleTabs.filter((item) => item !== moduleId);
    const safeTabs = nextTabs.length ? nextTabs : [HOME_MODULE_ID];
    resetModulePageSession(moduleId);
    delete scrollPositionsRef.current[moduleId];
    setOpenModuleTabs(safeTabs);
    if (activeModule === moduleId) {
      if (moduleId === 'test-suites') clearSuiteRouteState();
      const fallbackIndex = Math.min(currentIndex, safeTabs.length - 1);
      const fallbackModule = safeTabs[fallbackIndex] || HOME_MODULE_ID;
      activeModuleRef.current = fallbackModule;
      setActiveModule(fallbackModule);
      restoreModuleScrollPosition(fallbackModule);
    }
    setTabMenuOpen(false);
  }

  function closeCurrentTab() {
    closeModuleTab(activeModule);
  }

  function closeOtherTabs() {
    saveActiveModuleScrollPosition();
    const nextTabs = activeModule === HOME_MODULE_ID ? [HOME_MODULE_ID] : [HOME_MODULE_ID, activeModule];
    resetClosedModuleSessions(openModuleTabs.filter((moduleId) => !nextTabs.includes(moduleId)));
    keepScrollPositionsForTabs(nextTabs);
    setOpenModuleTabs(nextTabs);
    setTabMenuOpen(false);
  }

  function closeAllTabs() {
    if (activeModule === 'test-suites' && !confirmDiscardSuiteChanges()) return;
    saveActiveModuleScrollPosition();
    const homeScrollPosition = scrollPositionsRef.current[HOME_MODULE_ID] || 0;
    resetClosedModuleSessions(openModuleTabs.filter((moduleId) => moduleId !== HOME_MODULE_ID));
    scrollPositionsRef.current = { [HOME_MODULE_ID]: homeScrollPosition };
    setOpenModuleTabs([HOME_MODULE_ID]);
    if (activeModule === 'test-suites') clearSuiteRouteState();
    activeModuleRef.current = HOME_MODULE_ID;
    setActiveModule(HOME_MODULE_ID);
    setTabMenuOpen(false);
    restoreModuleScrollPosition(HOME_MODULE_ID);
  }

  function resetSessionNavigation({ preventAutoSelect = false } = {}) {
    resetClosedModuleSessions(openModuleTabs.filter((moduleId) => moduleId !== HOME_MODULE_ID));
    // A logout starts a fresh UI session. Keep server-side work items intact,
    // but do not carry the previous workbench selection or drafts into it.
    if (preventAutoSelect) skipAutoSelectWorkItemRef.current = true;
    MANUAL_WORKSPACE_MODULE_IDS.forEach((moduleId) => clearLocalManualPageState(moduleId, { preserveWorkspace: true }));
    resetManualWorkspaceState();
    setDetachedManualModules(new Set());
    resetAutomationPageSession({ clearMessages: true });
    resetMonitorTransientState();
    setWorkItems([]);
    setRuns([]);
    setCurrentItem(null);
    currentItemRef.current = null;
    selectedWorkItemIdRef.current = '';
    pendingScrollRestoreRef.current = null;
    scrollPositionsRef.current = { [HOME_MODULE_ID]: 0 };
    activeModuleRef.current = HOME_MODULE_ID;
    setActiveModule(HOME_MODULE_ID);
    setOpenModuleTabs([HOME_MODULE_ID]);
    setExpandedNavGroups(new Set(DEFAULT_EXPANDED_NAV_GROUP_IDS));
    setSidebarCollapsed(false);
    setTabMenuOpen(false);
    setDebugSession(null);
    setDebugAction('');
    clearSuiteRouteState();
    updateDebugSessionUrl(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', `${url.pathname}${url.hash}`);
    }
    storeString(ACTIVE_MODULE_STORAGE_KEY, HOME_MODULE_ID);
    storeJson(OPEN_MODULE_TABS_STORAGE_KEY, [HOME_MODULE_ID]);
  }

  function closeRightTabs() {
    saveActiveModuleScrollPosition();
    const activeIndex = openModuleTabs.indexOf(activeModule);
    if (activeIndex < 0) {
      setTabMenuOpen(false);
      return;
    }
    const nextTabs = openModuleTabs.filter((moduleId, index) => moduleId === HOME_MODULE_ID || index <= activeIndex);
    const safeTabs = nextTabs.includes(activeModule) ? nextTabs : [HOME_MODULE_ID, activeModule].filter((moduleId, index, list) => list.indexOf(moduleId) === index);
    resetClosedModuleSessions(openModuleTabs.filter((moduleId) => !safeTabs.includes(moduleId)));
    keepScrollPositionsForTabs(safeTabs);
    setOpenModuleTabs(safeTabs);
    setTabMenuOpen(false);
  }

  function closeLeftTabs() {
    saveActiveModuleScrollPosition();
    const activeIndex = openModuleTabs.indexOf(activeModule);
    if (activeIndex < 0) {
      setTabMenuOpen(false);
      return;
    }
    const nextTabs = openModuleTabs.filter((moduleId, index) => moduleId === HOME_MODULE_ID || index >= activeIndex);
    const safeTabs = nextTabs.includes(activeModule) ? nextTabs : [HOME_MODULE_ID, activeModule].filter((moduleId, index, list) => list.indexOf(moduleId) === index);
    resetClosedModuleSessions(openModuleTabs.filter((moduleId) => !safeTabs.includes(moduleId)));
    keepScrollPositionsForTabs(safeTabs);
    setOpenModuleTabs(safeTabs);
    setTabMenuOpen(false);
  }

  useEffect(() => {
    activeModuleRef.current = activeModule;
  }, [activeModule]);

  useEffect(() => {
    if (!moduleTabsRef.current || !activeModuleTabRef.current) return;
    activeModuleTabRef.current.scrollIntoView({
      block: 'nearest',
      inline: 'end',
      behavior: 'smooth',
    });
  }, [activeModule, openModuleTabs]);

  useEffect(() => {
    function handleWindowScroll() {
      scrollPositionsRef.current[activeModuleRef.current] = currentWindowScrollY();
    }
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleWindowScroll);
  }, []);

  useEffect(() => {
    if (!tabMenuOpen) return undefined;
    function handleDocumentClick(event) {
      if (!tabMenuRef.current?.contains(event.target)) {
        setTabMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [tabMenuOpen]);

  const latestRun = useMemo(() => {
    if (!currentItem?.latestRunId) return null;
    return runs.find((run) => run.id === currentItem.latestRunId) || currentItem.latestRun || null;
  }, [runs, currentItem]);
  const workspaceLatestRun = debugSession?.latestRun || latestRun;

  useEffect(() => {
    setExecutionEnvironmentId(environmentSelectionForWorkItem(projects, currentItem));
  }, [currentItem?.id, currentItem?.targetUrl, projects]);

  useEffect(() => {
    const project = projectForWorkItem(projects, currentItem);
    const sourceRun = healingRun?.sourceRun || workspaceLatestRun;
    const selectedHealingEnvironmentId = healingRun?.environment?.id || '';
    if (healingRun?.environment?.url) {
      setHealingEnvironmentId(
        selectedHealingEnvironmentId && project?.environments?.some((environment) => environment.id === selectedHealingEnvironmentId)
          ? selectedHealingEnvironmentId
          : '',
      );
      return;
    }
    const sourceEnvironmentId = sourceRun?.environment?.id || '';
    const matchedEnvironment = project?.environments?.find((environment) => (
      environment.id === sourceEnvironmentId
      || (sourceRun?.environment?.url && environment.url === sourceRun.environment.url)
    ));
    setHealingEnvironmentId(sourceRun ? matchedEnvironment?.id || '' : environmentSelectionForWorkItem(projects, currentItem));
  }, [currentItem?.id, healingRun?.id, workspaceLatestRun?.id, projects]);

  const healingLiveRun = useMemo(() => {
    const rerunId = healingRun?.latestRunId || '';
    if (!rerunId || rerunId === healingRun?.sourceRunId) return null;
    return runs.find((run) => run.id === rerunId) || healingRun?.latestRun || null;
  }, [healingRun, runs]);

  function openHealingForFailedExecution(runPayload) {
    if (runPayload?.status !== 'failed') return;
    openManualModuleSession('healing');
  }

  async function openAutomationFailureInManualWorkbench() {
    const workItemId = automationFlow?.workItemId || automationFlow?.workItem?.id || '';
    if (!workItemId) {
      setError('当前一键流程未关联可打开的需求工单，请从人工工作台手动选择工单。');
      return;
    }
    try {
      const selectedItem = await selectWorkItem(workItemId);
      const failedCaseResult = [...(automationFlow?.outcome?.caseResults || [])]
        .reverse()
        .find((caseResult) => caseResult.status === 'failed' && caseResult.runId);
      let failedRun = [automationFlow?.latestRun, selectedItem?.latestRun]
        .find((run) => run?.status === 'failed') || null;
      if (!failedRun && failedCaseResult?.runId) {
        failedRun = await fetchJson(`/api/runs/${failedCaseResult.runId}`);
      }
      if (failedRun?.status === 'failed' && selectedItem?.latestRun?.id !== failedRun.id) {
        applySelectedWorkItem({
          ...selectedItem,
          latestRunId: failedRun.id,
          latestRun: failedRun,
          latestHealingRun: selectedItem?.latestHealingRun?.sourceRunId === failedRun.id
            ? selectedItem.latestHealingRun
            : null,
        });
      }
      const targetModule = failedRun?.status === 'failed' ? 'healing' : 'scripts';
      openManualModuleSession(targetModule);
      setNotice(targetModule === 'healing' ? '已打开人工工作台的自愈诊断。' : '已打开人工工作台的脚本实现，可继续调试未验证用例。');
      setError('');
    } catch (err) {
      setError(`打开人工工作台失败：${err.message}`);
    }
  }

  const monitorBrowserTarget = useMemo(() => {
    const cases = monitorSuiteRunDetail?.cases || [];
    const runningCase = cases.find((item) => item.runId && item.status === 'running');
    const selectedCase = cases.find((item) => item.runId && item.runId === monitorSelectedCaseRunId);
    const recentCase = [...cases].reverse().find((item) => item.runId);
    const targetCase = runningCase || selectedCase || recentCase || null;
    return {
      runId: targetCase?.runId || '',
      caseItem: targetCase,
    };
  }, [monitorSuiteRunDetail?.cases, monitorSelectedCaseRunId]);

  const automationBrowserTarget = useMemo(() => {
    const stage = automationActiveStage || automationFlow?.stage || '';
    const explorationSessionId = automationFlow?.explorationRun?.browserSessionId || automationFlow?.explorationRun?.browserSession?.id || '';
    const executionSessionId = automationFlow?.latestRun?.browserSessionId || automationFlow?.latestRun?.browserSession?.id || '';
    const executionStages = new Set(['运行验证', '自愈诊断', '保存已验证产物']);
    if (executionSessionId && executionStages.has(stage)) {
      return { sessionId: executionSessionId, mode: 'execution' };
    }
    if (explorationSessionId && (stage === '页面探索' || !executionSessionId)) {
      return { sessionId: explorationSessionId, mode: 'exploration' };
    }
    if (executionSessionId) return { sessionId: executionSessionId, mode: 'execution' };
    if (explorationSessionId) return { sessionId: explorationSessionId, mode: 'exploration' };
    return { sessionId: '', mode: executionStages.has(stage) ? 'execution' : 'exploration' };
  }, [automationActiveStage, automationFlow]);

  const showWorkflowContext = WORKFLOW_CONTEXT_MODULES.has(activeModule);
  const activeNavGroupId = MODULE_GROUP_LOOKUP[activeModule];
  const currentRole = authUser?.role || 'viewer';
  const canManageUsers = currentRole === 'admin';
  const canManageAI = currentRole === 'admin';
  const canManageAssets = ['admin', 'lead'].includes(currentRole);
  const canExecute = ['admin', 'lead', 'executor'].includes(currentRole);
  const canCreateDrafts = ['admin', 'lead', 'executor'].includes(currentRole);
  const canSaveArtifacts = ['admin', 'lead'].includes(currentRole);
  const visibleNavGroups = useMemo(() => NAV_GROUPS
    .map((group) => ({
      ...group,
      moduleIds: group.moduleIds.filter((moduleId) => (MODULE_ROLE_ACCESS[moduleId] || []).includes(currentRole)),
    }))
    .filter((group) => group.moduleIds.length), [currentRole]);

  function moduleAllowed(moduleId) {
    return (MODULE_ROLE_ACCESS[moduleId] || []).includes(currentRole);
  }
  useEffect(() => {
    storeTheme(themeId);
  }, [themeId]);

  useEffect(() => {
    storeString(ACTIVE_MODULE_STORAGE_KEY, activeModule);
  }, [activeModule]);

  useEffect(() => {
    storeJson(OPEN_MODULE_TABS_STORAGE_KEY, openModuleTabs);
  }, [openModuleTabs]);

  useEffect(() => {
    storeString(CURRENT_PROJECT_STORAGE_KEY, currentProjectId);
  }, [currentProjectId]);

  useEffect(() => {
    storeString(TEST_EXECUTION_PROJECT_STORAGE_KEY, testExecutionProjectId || 'all');
  }, [testExecutionProjectId]);

  useEffect(() => {
    storeString(SELECTED_SUITE_STORAGE_KEY, selectedSuiteId);
  }, [selectedSuiteId]);

  useEffect(() => {
    storeString(MONITOR_SUITE_RUN_STORAGE_KEY, monitorSuiteRunId);
  }, [monitorSuiteRunId]);

  const toggleNavGroup = (groupId) => {
    setExpandedNavGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  useEffect(() => {
    if (!authUser || !activeNavGroupId) return;
    setExpandedNavGroups((previous) => {
      if (previous.has(activeNavGroupId)) return previous;
      const next = new Set(previous);
      next.add(activeNavGroupId);
      return next;
    });
  }, [activeNavGroupId]);

  useEffect(() => {
    if (!authUser) return;
    const allowedTabs = openModuleTabs.filter((moduleId) => moduleAllowed(moduleId));
    const nextTabs = allowedTabs.includes(HOME_MODULE_ID) ? allowedTabs : [HOME_MODULE_ID, ...allowedTabs];
    if (nextTabs.length !== openModuleTabs.length) {
      setOpenModuleTabs(nextTabs);
      keepScrollPositionsForTabs(nextTabs);
    }
    if (!moduleAllowed(activeModule)) {
      activeModuleRef.current = HOME_MODULE_ID;
      setActiveModule(HOME_MODULE_ID);
    }
  }, [authUser?.role]);

  useEffect(() => {
    const node = automationLogRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [automationLogs]);

  useEffect(() => {
    if (!projects.length) {
      if (automationProjectId) {
        setAutomationProjectId('');
        setAutomationFeatureId('');
      }
      return;
    }
    if (automationProjectId && !projects.find((project) => project.id === automationProjectId)) {
      setAutomationProjectId('');
      setAutomationFeatureId('');
    }
  }, [automationProjectId, projects]);

  useEffect(() => {
    if (!projects.length) {
      return;
    }
    if (!projects.find((project) => project.id === currentProjectId)) {
      setCurrentProjectId(projects[0].id);
      return;
    }
  }, [currentProjectId, projects]);

  useEffect(() => {
    if (!projects.length || testExecutionProjectId === 'all') return;
    if (!projects.some((project) => project.id === testExecutionProjectId)) {
      setTestExecutionProjectId('all');
    }
  }, [projects, testExecutionProjectId]);

  useEffect(() => {
    if (!authUser) return undefined;
    if (!requirementProjectId) {
      setRequirementFeatureOptions([]);
      setRequirementFeatureTree([]);
      setRequirementFeatureId('');
      return undefined;
    }
    let cancelled = false;
    async function loadRequirementFeatures() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(`/api/features?project_id=${encodeURIComponent(requirementProjectId)}`);
        if (cancelled) return;
        const featureItems = payload.items || [];
        setRequirementFeatureOptions(featureItems);
        setRequirementFeatureTree(payload.tree || []);
        setRequirementFeatureId((value) => activeFeatureOptions(featureItems, value).some((feature) => feature.id === value) ? value : '');
      } catch (err) {
        if (!cancelled) {
          setRequirementFeatureOptions([]);
          setRequirementFeatureTree([]);
          setRequirementFeatureId('');
          if (isAuthRequiredError(err)) return;
          setError(`加载需求工单功能树失败：${err.message}`);
        }
      }
    }
    loadRequirementFeatures();
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, requirementProjectId]);

  useEffect(() => {
    if (!authUser) return undefined;
    if (!automationProjectId) {
      setAutomationFeatureOptions([]);
      setAutomationFeatureTree([]);
      setAutomationFeatureId('');
      return undefined;
    }
    let cancelled = false;
    async function loadAutomationFeatures() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(`/api/features?project_id=${encodeURIComponent(automationProjectId)}`);
        if (cancelled) return;
        const activeItems = (payload.items || []).filter((feature) => feature.isActive);
        setAutomationFeatureOptions(activeItems);
        setAutomationFeatureTree(payload.tree || []);
        setAutomationFeatureId((value) => activeItems.some((feature) => feature.id === value) ? value : '');
      } catch (err) {
        if (!cancelled) {
          setAutomationFeatureOptions([]);
          setAutomationFeatureTree([]);
          setAutomationFeatureId('');
          if (isAuthRequiredError(err)) return;
          setError(`加载全流程功能树失败：${err.message}`);
        }
      }
    }
    loadAutomationFeatures();
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, automationProjectId]);

  function applyAutomationSnapshot(payload) {
    const normalizedPayload = {
      ...payload,
      stage: payload.status === 'completed' ? '保存已验证产物' : payload.stage,
    };
    setAutomationFlow(normalizedPayload);
    setAutomationLogs(payload.logs || []);
    setAutomationArtifacts(payload.flowArtifacts || []);
    setAutomationStatus(payload.status || 'idle');
    setAutomationActiveStage(normalizedPayload.stage || '');
    const workItem = payload.workItem || null;
    const nextProjectId = payload.projectId || workItem?.projectId || '';
    const nextFeatureId = payload.featureId || workItem?.featureId || '';
    if (workItem?.requirement) setAutomationRequirement(workItem.requirement);
    if (nextProjectId) setAutomationProjectId(nextProjectId);
    if (nextFeatureId) setAutomationFeatureId(nextFeatureId);
    if (workItem) {
      applySelectedWorkItem(workItem, { preserveRequirementDraft: true });
    }
    if (payload.latestRun) {
      setRuns((items) => {
        const exists = items.some((item) => item.id === payload.latestRun.id);
        return exists ? items.map((item) => (item.id === payload.latestRun.id ? payload.latestRun : item)) : [payload.latestRun, ...items];
      });
    }
  }

  function automationTerminalErrorMessage(status, flow) {
    const reportHint = flow?.workItemId ? ' 人工报告已生成，可在交付物中查看。' : '';
    if (status === 'failed') return `一键全流程失败：${flow?.error || '详见流程日志和失败报告'}${reportHint}`;
    if (status === 'blocked') return `${flow?.error || '一键全流程已阻塞，请查看阶段日志。'}${reportHint}`;
    return '';
  }

  function automationTerminalErrorKey(status, flow, message) {
    if (!['failed', 'blocked'].includes(status) || !message) return '';
    const flowRunId = flow?.id || flow?.flowRunId || automationFlowId;
    return flowRunId ? `${flowRunId}:${status}:${message}` : '';
  }

  function showAutomationTerminalError(status, flow) {
    const message = automationTerminalErrorMessage(status, flow);
    const key = automationTerminalErrorKey(status, flow, message);
    activeAutomationTerminalErrorRef.current = { key, message };
    if (!key || dismissedAutomationTerminalErrorsRef.current.has(key)) return;
    setError(message);
  }

  function clearErrorBanner() {
    const { key, message } = activeAutomationTerminalErrorRef.current;
    if (key && message && error === message) {
      dismissedAutomationTerminalErrorsRef.current.add(key);
      activeAutomationTerminalErrorRef.current = { key: '', message: '' };
    }
    setError('');
  }

  function mergeAutomationArtifact(nextArtifact) {
    if (!nextArtifact?.id) return;
    setAutomationArtifacts((items) => {
      const exists = items.some((item) => item.id === nextArtifact.id);
      return exists ? items.map((item) => (item.id === nextArtifact.id ? nextArtifact : item)) : [...items, nextArtifact];
    });
  }

  function closeAutomationRealtime() {
    automationFlowSocketRef.current?.close();
    automationFlowSocketRef.current = null;
    automationBrowserSocketRef.current?.close();
    automationBrowserSocketRef.current = null;
    setAutomationLiveTracking(false);
    setAutomationLiveConnected(false);
    setAutomationBrowserLiveConnected(false);
  }

  async function refreshAutomationTerminalState(status, flow) {
    const flowRunId = flow?.id || flow?.flowRunId || automationFlowId;
    let latestFlow = flow;
    if (flowRunId) {
      try {
        latestFlow = await fetchJson(`/api/automation-flows/${flowRunId}`);
        applyAutomationSnapshot(latestFlow);
      } catch (err) {
        if (!isAuthRequiredError(err)) setError(`刷新一键流程终态失败：${err.message}`);
      }
    }
    if (status === 'completed') {
      setAutomationActiveStage('保存已验证产物');
      const projectId = latestFlow?.projectId || latestFlow?.workItem?.projectId || flow?.projectId || flow?.workItem?.projectId || '';
      if (projectId) setCurrentProjectId(projectId);
      await loadAll({ preferredProjectId: projectId });
      const workItemId = latestFlow?.workItem?.id || flow?.workItem?.id || '';
      if (workItemId) {
        const nextScope = { project_id: projectId, work_item_id: workItemId };
        const nextFilters = emptyCaseReportFilters();
        setReportTab('case');
        setReportScopeFilters(nextScope);
        setCaseReportFilters(nextFilters);
        await loadCaseReports({ ...nextScope, ...nextFilters }, 1).catch((err) => {
          if (!isAuthRequiredError(err)) setError(`刷新测试报告失败：${err.message}`);
        });
      }
    }
    return latestFlow;
  }

  async function handleAutomationTerminalStatus(status, flow) {
    if (status === 'completed') {
      const latestFlow = await refreshAutomationTerminalState(status, flow);
      if (isPartialAutomationFlow(latestFlow, status)) {
        const counts = latestFlow?.outcome?.counts || {};
        setNotice(`一键流程已完成但有警告：P0 通过 ${counts.p0Passed || 0} 条，失败 ${counts.failed || 0} 条，未执行 ${(counts.blocked || 0) + (counts.notRun || 0)} 条。`);
      } else {
        setNotice('一键全流程已完成：最终测试用例、spec、人工报告和 Playwright HTML report 已保存。');
      }
    } else if (status === 'failed') {
      showAutomationTerminalError(status, flow);
    } else if (status === 'blocked') {
      showAutomationTerminalError(status, flow);
    } else if (status === 'cancelled') {
      setNotice(flow?.workItemId ? '已停止当前一键流程，人工报告已生成。' : '已停止当前一键流程。');
      setError('');
    }
    if (isTerminalFlowStatus(status)) {
      setAutomationStopping(false);
      closeAutomationRealtime();
    }
  }

  useEffect(() => {
    if (!automationFlowId || !automationLiveTracking) return undefined;
    const socket = new WebSocket(`${WS_BASE}/ws/automation-flows/${automationFlowId}`);
    automationFlowSocketRef.current = socket;
    socket.addEventListener('open', () => setAutomationLiveConnected(true));
    socket.addEventListener('close', () => setAutomationLiveConnected(false));
    socket.addEventListener('error', () => setAutomationLiveConnected(false));
    socket.addEventListener('message', async (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'snapshot') {
        const snapshot = { ...(payload.flow || {}), logs: payload.logs || [], flowArtifacts: payload.flowArtifacts || [] };
        applyAutomationSnapshot(snapshot);
        if (isTerminalFlowStatus(snapshot.status)) {
          await handleAutomationTerminalStatus(snapshot.status, snapshot);
        }
      } else if (payload.type === 'stage') {
        setAutomationFlow((previous) => previous ? {
          ...previous,
          stage: payload.stage || previous.stage,
          progress: payload.progress ?? previous.progress,
          status: payload.status || previous.status,
          currentAttempt: payload.currentAttempt ?? previous.currentAttempt,
          error: payload.error ?? previous.error,
        } : previous);
        if (payload.status) setAutomationStatus(payload.status);
        if (payload.stage) setAutomationActiveStage(payload.stage);
      } else if (payload.type === 'log' && payload.log) {
        setAutomationLogs((items) => items.some((item) => item.id === payload.log.id) ? items : [...items, payload.log]);
      } else if ((payload.type === 'artifact_created' || payload.type === 'artifact_updated') && payload.artifact) {
        mergeAutomationArtifact(payload.artifact);
      } else if (payload.type === 'artifact_delta') {
        setAutomationArtifacts((items) => items.map((item) => (
          item.id === payload.artifactId
            ? { ...item, content: `${item.content || ''}${payload.delta || ''}`, updatedAt: new Date().toISOString() }
            : item
        )));
      } else if (payload.type === 'flow_done') {
        if (payload.flow) applyAutomationSnapshot(payload.flow);
        await handleAutomationTerminalStatus(payload.status, payload.flow);
      }
    });
    return () => {
      if (automationFlowSocketRef.current === socket) automationFlowSocketRef.current = null;
      socket.close();
      setAutomationLiveConnected(false);
    };
  }, [automationFlowId, automationLiveTracking]);

  useEffect(() => {
    if (!authUser || !automationFlowId || !automationLiveTracking) return undefined;
    let cancelled = false;

    async function pollAutomationFlow() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(`/api/automation-flows/${automationFlowId}`);
        if (cancelled) return;
        applyAutomationSnapshot(payload);
        if (isTerminalFlowStatus(payload.status)) {
          await handleAutomationTerminalStatus(payload.status, payload);
        } else {
          setError('');
        }
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) setError(`获取全流程状态失败：${err.message}`);
      }
    }

    pollAutomationFlow();
    if (!isActiveFlowStatus(automationFlow?.status || 'running')) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(pollAutomationFlow, automationLiveConnected ? 8000 : 1600);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, automationFlowId, automationLiveTracking, automationFlow?.status, automationLiveConnected]);

  useEffect(() => {
    const { sessionId, mode } = automationBrowserTarget;
    setAutomationBrowserSessionId(sessionId);
    setAutomationBrowserMode(mode);
    if (!sessionId) {
      setAutomationBrowserStatus('Closed');
      setAutomationBrowserDetail('');
      setAutomationBrowserLiveConnected(false);
      setAutomationBrowserHasFrame(false);
      return;
    }
    const sessionStatus = mode === 'execution'
      ? automationFlow?.latestRun?.browserSession?.status || automationFlow?.latestRun?.status || 'Connecting'
      : automationFlow?.explorationRun?.browserSession?.status || automationFlow?.explorationRun?.status || 'Connecting';
    setAutomationBrowserStatus(sessionStatus);
  }, [automationBrowserTarget, automationFlow]);

  useEffect(() => {
    if (!automationBrowserPreviewEnabled || !automationBrowserSessionId) {
      automationBrowserSocketRef.current?.close();
      automationBrowserSocketRef.current = null;
      setAutomationBrowserLiveConnected(false);
      setAutomationBrowserHasFrame(false);
      clearBrowserCanvas(automationBrowserCanvasRef.current);
      return undefined;
    }
    if (automationBrowserSocketRef.current) {
      automationBrowserSocketRef.current.close();
    }
    setAutomationBrowserHasFrame(false);
    const socket = createReconnectingWebSocket(`${WS_BASE}/ws/browser-sessions/${automationBrowserSessionId}`);
    automationBrowserSocketRef.current = socket;
    socket.addEventListener('open', () => setAutomationBrowserLiveConnected(true));
    socket.addEventListener('close', () => setAutomationBrowserLiveConnected(false));
    socket.addEventListener('error', () => setAutomationBrowserLiveConnected(false));
    socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'status' || payload.type === 'capacity') {
        setAutomationBrowserStatus(payload.status);
        setAutomationBrowserDetail(browserConnectionDetail(payload));
      }
      if (payload.type === 'frame') {
        drawBrowserFrame(automationBrowserCanvasRef.current, payload, () => setAutomationBrowserHasFrame(true));
      }
    });
    return () => {
      if (automationBrowserSocketRef.current === socket) automationBrowserSocketRef.current = null;
      socket.close();
      setAutomationBrowserLiveConnected(false);
    };
  }, [automationBrowserPreviewEnabled, automationBrowserSessionId]);

  useEffect(() => {
    confirmedElementKeysRef.current = confirmedElementKeys;
  }, [confirmedElementKeys]);

  useEffect(() => {
    currentItemRef.current = currentItem;
  }, [currentItem]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!authUser || activeModuleRef.current !== 'test-suites') return;
    const route = readSuiteRoute();
    loadSuiteRoute(route.view, route.suiteId, { historyMode: 'replace' });
  }, [authUser?.id]);

  useEffect(() => {
    const handlePopState = () => {
      const route = readSuiteRoute();
      if (suiteFormDirty && !window.confirm('当前套件内容尚未保存，确认离开此页面？')) {
        replaceSuiteRouteUrl(suiteView, suiteRouteId, 'push');
        return;
      }
      if (new URLSearchParams(window.location.search).has(SUITE_VIEW_QUERY_KEY)) {
        activeModuleRef.current = 'test-suites';
        setActiveModule('test-suites');
        setOpenModuleTabs((items) => (items.includes('test-suites') ? items : [...items, 'test-suites']));
      }
      loadSuiteRoute(route.view, route.suiteId, { historyMode: 'replace' });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [suiteFormDirty, suiteRouteId, suiteView, canManageAssets]);

  useEffect(() => {
    if (!suiteFormDirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [suiteFormDirty]);

  function handleAuthExpired(message = '登录状态已失效，请重新登录。') {
    resetSessionNavigation({ preventAutoSelect: true });
    setAuthUser(null);
    setAuthMode('login');
    setAuthChecked(true);
    setAuthError(message);
  }

  async function fetchJson(path, options) {
    return apiFetchJson(path, options, handleAuthExpired);
  }

  async function waitForImportTerminal(importId, attempts = 20) {
    if (!importId) return null;
    const terminalStatuses = new Set(['verified', 'partially-verified', 'validation-failed', 'publish-failed']);
    let payload = null;
    for (let index = 0; index < attempts; index += 1) {
      payload = await fetchJson(`/api/test-case-imports/${encodeURIComponent(importId)}`);
      if (terminalStatuses.has(payload.status)) return payload;
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return payload;
  }

  async function streamNdjson(path, options, onEvent) {
    return apiStreamNdjson(path, options, onEvent, handleAuthExpired);
  }

  function confirmDiscardSuiteChanges() {
    if (!suiteFormDirty) return true;
    return window.confirm('当前套件内容尚未保存，确认离开此页面？');
  }

  function applySuiteRecord(suite, editing = false) {
    const nextForm = normalizeSuiteForm(suite);
    setSuites((items) => [suite, ...items.filter((item) => item.id !== suite.id)]);
    setSelectedSuiteId(suite.id);
    setSuiteRouteRecord(suite);
    setSuiteForm(nextForm);
    setSuiteFormBaseline(nextForm);
    setSuiteEditing(editing);
    setSuiteRouteLoading(false);
    setSuiteRouteError('');
  }

  function resetSuiteRouteState(view = 'list', options = {}) {
    suiteRouteRequestRef.current += 1;
    const nextView = SUITE_VIEWS.has(view) ? view : 'list';
    setSuiteView(nextView);
    setSuiteRouteId('');
    setSelectedSuiteId('');
    setSuiteRouteRecord(null);
    setSuiteEditing(nextView === 'create');
    setSuiteRouteLoading(false);
    setSuiteRouteError('');
    if (nextView === 'create') {
      const nextForm = normalizeSuiteForm(options.initialForm || { projectId: currentProjectId });
      setSuiteForm(nextForm);
      setSuiteFormBaseline(nextForm);
    } else {
      setSuiteForm(normalizeSuiteForm());
      setSuiteFormBaseline(normalizeSuiteForm());
    }
    replaceSuiteRouteUrl(nextView, '', options.historyMode || 'replace');
  }

  function clearSuiteRouteState() {
    suiteRouteRequestRef.current += 1;
    setSuiteView('list');
    setSuiteRouteId('');
    setSelectedSuiteId('');
    setSuiteRouteRecord(null);
    setSuiteEditing(false);
    setSuiteRouteLoading(false);
    setSuiteRouteError('');
    clearSuiteRouteUrl();
  }

  async function loadSuiteRoute(view, suiteId, options = {}) {
    let nextView = SUITE_VIEWS.has(view) ? view : 'list';
    if (nextView === 'edit' && !canManageAssets) nextView = 'detail';
    if (nextView === 'create' && !canManageAssets) nextView = 'list';
    if ((nextView === 'detail' || nextView === 'edit') && !suiteId) nextView = 'list';

    if (nextView === 'list' || nextView === 'create') {
      resetSuiteRouteState(nextView, {
        initialForm: options.initialForm,
        historyMode: options.historyMode || 'replace',
      });
      return;
    }

    suiteRouteRequestRef.current += 1;
    setSuiteView(nextView);
    setSuiteRouteId(suiteId);
    setSelectedSuiteId(suiteId);
    setSuiteEditing(nextView === 'edit');
    setSuiteRouteLoading(true);
    setSuiteRouteError('');
    replaceSuiteRouteUrl(nextView, suiteId, options.historyMode || 'replace');

    if (options.suite) {
      applySuiteRecord(options.suite, nextView === 'edit');
      return;
    }

    const requestId = suiteRouteRequestRef.current;
    try {
      const suite = await fetchJson(`/api/test-suites/${encodeURIComponent(suiteId)}`);
      if (suiteRouteRequestRef.current !== requestId) return;
      applySuiteRecord(suite, nextView === 'edit');
    } catch (err) {
      if (suiteRouteRequestRef.current !== requestId) return;
      setSuiteRouteLoading(false);
      setSuiteEditing(false);
      setSuiteRouteError(err.message === 'Test suite not found' ? '套件不存在或已删除' : `加载套件失败：${err.message}`);
    }
  }

  function navigateSuite(view, suiteId = '', options = {}) {
    if (!options.skipUnsaved && !confirmDiscardSuiteChanges()) return;
    loadSuiteRoute(view, suiteId, {
      ...options,
      historyMode: options.replace ? 'replace' : 'push',
    });
  }

  async function checkAuth({ resetUnauthenticated = true } = {}) {
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
      const payload = await response.json();
      const user = payload.authenticated ? payload.user : null;
      if (!user && resetUnauthenticated) resetSessionNavigation();
      setAuthUser(user);
      setAuthChecked(true);
      return { user, reachable: true };
    } catch {
      setAuthUser(null);
      setAuthChecked(true);
      return { user: null, reachable: false };
    }
  }

  async function ensureAuthenticated() {
    const { user, reachable } = await checkAuth({ resetUnauthenticated: false });
    if (!reachable) {
      throw new Error('Failed to fetch');
    }
    if (!user) {
      handleAuthExpired();
      throw new Error('请先登录');
    }
    return user;
  }

  async function submitLogin(credentials) {
    setAuthSubmitting(true);
    setAuthError('');
    setAuthMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || '登录失败');
      setAuthUser(payload.user);
      setAuthError('');
      await loadAll({ skipAuthCheck: true });
      return true;
    } catch (err) {
      setAuthError(err.message);
      return false;
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function submitRegister(registration) {
    setAuthSubmitting(true);
    setAuthError('');
    setAuthMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registration),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || '注册失败');
      setAuthMode('login');
      setAuthMessage('注册已提交，请等待管理员审核启用。');
      return true;
    } catch (err) {
      setAuthError(err.message);
      return false;
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function logout() {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => null);
    resetSessionNavigation({ preventAutoSelect: true });
    setAuthUser(null);
    setAuthMode('login');
    setNotice('');
    setError('');
  }

  async function loadUsers() {
    if (!canManageUsers) return [];
    const payload = await fetchJson('/api/users');
    setUsers(payload);
    return payload;
  }

  async function updateUser(userId, patch) {
    try {
      const updated = await fetchJson(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setUsers((items) => items.map((item) => (item.id === userId ? updated : item)));
      setUserActionMessage('用户信息已更新');
      setError('');
      return updated;
    } catch (err) {
      setError(`更新用户失败：${err.message}`);
      return null;
    }
  }

  async function createUser(payload) {
    try {
      const created = await fetchJson('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setUsers((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      setUserActionMessage('用户已创建');
      setError('');
      return created;
    } catch (err) {
      setError(`创建用户失败：${err.message}`);
      return null;
    }
  }

  async function deleteUser(userId) {
    try {
      await fetchJson(`/api/users/${userId}`, { method: 'DELETE' });
      setUsers((items) => items.filter((item) => item.id !== userId));
      setUserActionMessage('用户已删除');
      setError('');
    } catch (err) {
      setError(`删除用户失败：${err.message}`);
    }
  }

  async function resetUserPassword(userId) {
    const password = window.prompt('请输入新密码（至少8位，包含字母和数字）');
    if (!password) return;
    try {
      await fetchJson(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setUserActionMessage('密码已重置');
      setError('');
    } catch (err) {
      setError(`重置密码失败：${err.message}`);
    }
  }

  async function loadCaseReports(nextFilters = { ...reportScopeFilters, ...caseReportFilters }, page = 1, pageSize = caseReports.pageSize || 50) {
    const payload = await fetchJson(buildReportListPath('/api/case-reports', nextFilters, page, pageSize));
    setCaseReports(payload);
    return payload;
  }

  async function loadManualReports(nextFilters = { ...reportScopeFilters, ...manualReportFilters }, page = 1, pageSize = manualReports.pageSize || 50) {
    const payload = await fetchJson(buildReportListPath('/api/manual-reports', nextFilters, page, pageSize));
    setManualReports(payload);
    return payload;
  }

  async function refreshCases(projectId = 'all') {
    const scope = projectId || 'all';
    const payload = await fetchJson(`/api/test-cases?project_id=${encodeURIComponent(scope)}`);
    setTestCases(payload);
    return payload;
  }

  async function refreshFeatures(projectId = currentProjectId) {
    if (!projectId) {
      setFeatures([]);
      setFeatureTree([]);
      return { items: [], tree: [] };
    }
    const payload = await fetchJson(`/api/features?project_id=${encodeURIComponent(projectId)}`);
    setFeatures(payload.items || []);
    setFeatureTree(payload.tree || []);
    return payload;
  }

  async function refreshCaseAssets(projectId = currentProjectId) {
    if (!projectId) {
      setTestCases([]);
      setFeatures([]);
      setFeatureTree([]);
      setSuites([]);
      await loadSuiteCaseProjects(projects);
      return { cases: [], features: { items: [], tree: [] }, suites: [] };
    }
    const [casePayload, featurePayload, suitesPayload, dashboardPayload] = await Promise.all([
      fetchJson('/api/test-cases?project_id=all'),
      fetchJson(`/api/features?project_id=${encodeURIComponent(projectId)}`),
      fetchJson('/api/test-suites?project_id=all'),
      fetchJson(`/api/dashboard-summary?project_id=${encodeURIComponent(dashboardScopeProjectId || 'all')}`),
    ]);
    setTestCases(casePayload);
    setFeatures(featurePayload.items || []);
    setFeatureTree(featurePayload.tree || []);
    setSuites(suitesPayload);
    setDashboardSummary(dashboardPayload);
    await loadSuiteCaseProjects(projects);
    return { cases: casePayload, features: featurePayload, suites: suitesPayload };
  }

  async function loadSuiteCaseProjects(projectItems = projects) {
    const items = await Promise.all((projectItems || []).map(async (project) => {
      try {
        const [casePayload, featurePayload] = await Promise.all([
          fetchJson(`/api/test-cases?project_id=${encodeURIComponent(project.id)}`),
          fetchJson(`/api/features?project_id=${encodeURIComponent(project.id)}`),
        ]);
        return {
          ...project,
          testCases: casePayload,
          features: featurePayload.items || [],
          featureTree: featurePayload.tree || [],
        };
      } catch (err) {
        return {
          ...project,
          testCases: [],
          features: [],
          featureTree: [],
          suiteCaseLoadError: err.message,
        };
      }
    }));
    setSuiteCaseProjects(items);
    return items;
  }

  async function loadDashboardSummary(scopeProjectId = dashboardScopeProjectId) {
    setDashboardLoading(true);
    try {
      const scope = scopeProjectId || 'all';
      const payload = await fetchJson(`/api/dashboard-summary?project_id=${encodeURIComponent(scope)}`);
      setDashboardSummary(payload);
      return payload;
    } finally {
      setDashboardLoading(false);
    }
  }

  async function openDashboardSuiteRun(run) {
    if (!run?.id || !run.projectId || openingSuiteRunId) return;
    setOpeningSuiteRunId(run.id);
    try {
      await ensureAuthenticated();
      const [suiteRunPayload, detailPayload] = await Promise.all([
        fetchJson(buildSuiteRunsPath(run.projectId)),
        fetchJson(`/api/suite-runs/${run.id}`),
      ]);
      const nextSuiteRuns = suiteRunPayload.some((item) => item.id === detailPayload.id)
        ? suiteRunPayload.map((item) => (item.id === detailPayload.id ? { ...item, ...detailPayload } : item))
        : [detailPayload, ...suiteRunPayload];
      resetMonitorTransientState();
      setCurrentProjectId(detailPayload.projectId || run.projectId);
      applyMonitorQuery(detailPayload.projectId || run.projectId, '');
      setSuiteRuns(nextSuiteRuns);
      setLatestSuiteRun(detailPayload);
      setMonitorSuiteRunId(detailPayload.id);
      setMonitorSuiteRunDetail(detailPayload);
      setError('');
      openModule('execution-monitor');
    } catch (err) {
      if (isAuthRequiredError(err)) {
        handleAuthExpired();
        return;
      }
      setError(err.message === 'Suite run not found' ? '该套件执行记录已不存在，请刷新总览后重试' : `打开套件执行记录失败：${err.message}`);
    } finally {
      setOpeningSuiteRunId('');
    }
  }

  async function loadAll(options = {}) {
    try {
      if (!options.skipAuthCheck) {
        await ensureAuthenticated();
      }
      const projectId = options.preferredProjectId || currentProjectId;
      const [healthPayload, projectPayload, workPayload, deliverablePayload, runsPayload, dashboardPayload] = await Promise.all([
        fetchJson('/api/health'),
        fetchJson('/api/projects'),
        fetchJson('/api/work-items'),
        fetchJson('/api/deliverables?include_content=false'),
        fetchJson('/api/runs'),
        fetchJson(`/api/dashboard-summary?project_id=${encodeURIComponent(dashboardScopeProjectId || 'all')}`),
      ]);
      const nextProjectId = projectPayload.find((project) => project.id === projectId)?.id || projectPayload[0]?.id || '';
      const requestedTestExecutionProjectId = options.preferredTestExecutionProjectId || testExecutionProjectId || 'all';
      const nextTestExecutionProjectId = requestedTestExecutionProjectId === 'all'
        || projectPayload.some((project) => project.id === requestedTestExecutionProjectId)
        ? requestedTestExecutionProjectId
        : 'all';
      const [casePayload, featurePayload, suitesPayload, suiteRunPayload] = nextProjectId
        ? await Promise.all([
          fetchJson('/api/test-cases?project_id=all'),
          fetchJson(`/api/features?project_id=${encodeURIComponent(nextProjectId)}`),
          fetchJson('/api/test-suites?project_id=all'),
          fetchJson(buildSuiteRunsPath(nextTestExecutionProjectId, monitorSuiteNameFilter)),
        ])
        : [[], { items: [], tree: [] }, [], []];
      setHealth(healthPayload);
      setProjects(projectPayload);
      if (nextProjectId !== currentProjectId) {
        setCurrentProjectId(nextProjectId);
      }
      if (nextTestExecutionProjectId !== testExecutionProjectId) {
        setTestExecutionProjectId(nextTestExecutionProjectId);
      }
      await loadSuiteCaseProjects(projectPayload);
      setWorkItems(workPayload);
      setTestCases(casePayload);
      setFeatures(featurePayload.items || []);
      setFeatureTree(featurePayload.tree || []);
      setDeliverables(deliverablePayload);
      setSuites(suitesPayload);
      setSuiteRuns(suiteRunPayload);
      if (!latestSuiteRun && suiteRunPayload[0]) {
        setLatestSuiteRun(suiteRunPayload[0]);
      }
      setRuns(runsPayload);
      setDashboardSummary(dashboardPayload);
      if (!skipAutoSelectWorkItemRef.current && !selectedWorkItemIdRef.current && !currentItemRef.current && workPayload[0]) {
        await selectWorkItem(workPayload[0].id, { auto: true });
      }
      setError('');
    } catch (err) {
      if (isAuthRequiredError(err)) {
        handleAuthExpired();
        return;
      }
      setHealth((value) => ({ ...value, status: 'offline' }));
      setError(`后端连接失败：${err.message}`);
    }
  }

  function applySelectedWorkItem(item, { preserveRequirementDraft = false } = {}) {
    if (!item) return;
    const preserveCurrentDraft = preserveRequirementDraft && requirementDirty && currentItemRef.current?.id === item.id;
    selectedWorkItemIdRef.current = item.id;
    currentItemRef.current = item;
    setCurrentItem(item);
    if (!preserveCurrentDraft) {
      setRequirementForm(requirementFromWorkItem(item));
      setCurrentProjectId(item.projectId || '');
      setRequirementProjectId(item.projectId || '');
      setRequirementFeatureId(item.featureId || '');
      setRequirementDirty(false);
    }
    setCasesMarkdown(item.casesMarkdown || '');
    setPendingCaseDeletions([]);
    setAssistantProposalCommits([]);
    setScriptGeneration(emptyScriptGenerationState());
    applyScriptWorkspace(item);
    setAssetMode(item.assetMode || 'create');
    setHealingRun(item.latestHealingRun || null);
    if (item.explorations?.[0]) {
      const nextElements = item.elements?.length ? item.elements : emptyExploration().elements;
      setConfirmedElementKeys(new Set(nextElements.filter((element) => element.confirmed).map(elementKey).filter(Boolean)));
      setExploration((value) => ({
        ...value,
        notes: item.explorations[0].notes || value.notes,
        screenshot_path: item.explorations[0].screenshotPath || value.screenshot_path,
        page_structure: item.explorations[0].pageStructure || value.page_structure,
        state_evidence: item.explorations[0].stateEvidence || value.state_evidence || [],
        elements: nextElements,
      }));
    } else {
      setConfirmedElementKeys(new Set());
      setExploration(emptyExploration());
    }
  }

  function applyScriptWorkspace(item, preferredCaseId = '') {
    const versions = item?.scriptVersions || item?.scriptSet?.scriptVersions || [];
    const caseIds = (item?.testCases || []).map((caseItem) => caseItem.id).filter(Boolean);
    if (!caseIds.length) caseIds.push(...(item?.caseIds || []).filter(Boolean));
    const requestedCaseId = preferredCaseId || selectedScriptCaseId;
    const selectedCaseId = caseIds.includes(requestedCaseId)
      ? requestedCaseId
      : caseIds[0] || versions[0]?.caseId || '';
    const selected = versions.find((version) => version.caseId === selectedCaseId) || null;
    setSelectedScriptCaseId(selectedCaseId);
    setScriptContent(selected?.content || (!caseIds.length ? item?.scriptContent || '' : ''));
    setFixtureContent(item?.fixtureVersion?.content || item?.scriptSet?.fixtureVersion?.content || '');
  }

  async function selectWorkItem(id, { auto = false } = {}) {
    ignoredExecutionRunIdRef.current = '';
    const item = await fetchJson(`/api/work-items/${id}`);
    if (auto && skipAutoSelectWorkItemRef.current) return null;
    selectedWorkItemIdRef.current = id;
    attachManualModuleSessions();
    applySelectedWorkItem(item);
    return item;
  }

  function updateDebugSessionUrl(session, moduleId = activeModuleRef.current, batch = debugBatch) {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (session?.id) {
      url.searchParams.set(DEBUG_SESSION_QUERY_KEY, session.id);
      if (batch?.id) url.searchParams.set(DEBUG_BATCH_QUERY_KEY, batch.id);
      else url.searchParams.delete(DEBUG_BATCH_QUERY_KEY);
      url.searchParams.set('caseId', session.caseId || '');
      url.searchParams.set('module', moduleId || 'scripts');
    } else {
      url.searchParams.delete(DEBUG_SESSION_QUERY_KEY);
      url.searchParams.delete(DEBUG_BATCH_QUERY_KEY);
      url.searchParams.delete('caseId');
      url.searchParams.delete('module');
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function applyDebugSession(session, moduleId = 'scripts', batch = debugBatch) {
    if (!session) return;
    const nextHealingRun = session.latestHealingRun || null;
    const healingContextChanged = (healingRun?.id || '') !== (nextHealingRun?.id || '');
    if (MANUAL_WORKSPACE_MODULE_SET.has(moduleId)) attachManualModuleSessions(moduleId);
    setDebugSession(session);
    setDebugExecutionScope(session.executionPolicy === 'strict-single' ? 'single' : (session.dependencyExecution?.manualChoiceRequired ? session.dependencyExecution.defaultScope || 'group' : 'auto'));
    if (session.workItem) applySelectedWorkItem(session.workItem, { preserveRequirementDraft: false });
    setCasesMarkdown(session.draftCaseMarkdown || session.workItem?.casesMarkdown || '');
    const debugExploration = session.exploration || {};
    setExploration({
      ...emptyExploration(),
      notes: debugExploration.notes || '',
      screenshot_path: debugExploration.screenshot_path || '',
      page_structure: debugExploration.page_structure || '',
      state_evidence: debugExploration.state_evidence || [],
      elements: debugExploration.elements?.length ? debugExploration.elements : emptyExploration().elements,
    });
    setConfirmedElementKeys(new Set((debugExploration.elements || []).filter((element) => element.confirmed).map(elementKey).filter(Boolean)));
    setExplorationRun(session.latestExplorationRun || null);
    setExplorationLogs(session.latestExplorationRun?.logs || []);
    setHealingRun(nextHealingRun);
    if (healingContextChanged) {
      resetHealingDiagnosticLogs();
      resetHealingLiveState();
    }
    setSelectedScriptCaseId(session.caseId || '');
    setScriptContent(session.currentScriptVersion?.content || '');
    setFixtureContent(session.currentScriptVersion?.fixtureVersion?.content || session.workItem?.fixtureVersion?.content || '');
    if (session.latestRun) {
      setRuns((items) => {
        const exists = items.some((item) => item.id === session.latestRun.id);
        return exists ? items.map((item) => item.id === session.latestRun.id ? session.latestRun : item) : [session.latestRun, ...items];
      });
    }
    updateDebugSessionUrl(session, moduleId, batch);
    openModule(moduleId);
  }

  async function enterCaseDebug(caseItem, moduleId = 'cases') {
    if (!caseItem?.id) return;
    try {
      setDebugSessionLoading(caseItem.id);
      setSelectedCaseIds(new Set([caseItem.id]));
      const session = await fetchJson(`/api/test-cases/${caseItem.id}/debug-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_case_updated_at: caseItem.updatedAt || '', execution_policy: 'strict-single' }),
      });
      setError('');
      applyDebugSession(session, moduleId);
      setNotice(`已进入单用例工作区：${session.case?.externalId || caseItem.externalId}`);
    } catch (err) {
      setError(`进入单用例调试失败：${err.message}`);
    } finally {
      setDebugSessionLoading('');
    }
  }

  async function startCaseDebugBatch(preflight) {
    if (!preflight?.items?.length) return;
    try {
      setDebugBatchLoading(true);
      const batch = await fetchJson('/api/case-debug-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_ids: preflight.items.map((item) => item.caseId),
          environment_id: preflight.environment?.id || '',
        }),
      });
      const firstItem = batch.items?.find((item) => item.debugSessionId);
      if (!firstItem?.debugSessionId) throw new Error('批量调试未创建用例会话');
      const session = await fetchJson(`/api/case-debug-sessions/${firstItem.debugSessionId}`);
      setDebugBatch(batch);
      setSelectedCaseIds(new Set());
      applyDebugSession(session, 'scripts', batch);
      setError('');
      setNotice(`批量调试已启动：${batch.totalCases} 条同项目用例`);
    } catch (err) {
      setError(`启动批量调试失败：${err.message}`);
      throw err;
    } finally {
      setDebugBatchLoading(false);
    }
  }

  async function selectBatchDebugItem(item) {
    if (!item?.debugSessionId || item.debugSessionId === debugSession?.id) return;
    try {
      setDebugSessionLoading(item.caseId);
      const session = await fetchJson(`/api/case-debug-sessions/${item.debugSessionId}`);
      applyDebugSession(session, activeModuleRef.current, debugBatch);
    } catch (err) {
      setError(`切换批量调试用例失败：${err.message}`);
    } finally {
      setDebugSessionLoading('');
    }
  }

  async function cancelCaseDebugBatch() {
    if (!debugBatch?.id || ['passed', 'failed', 'needs_attention', 'cancelled'].includes(debugBatch.status)) return;
    try {
      const batch = await fetchJson(`/api/case-debug-batches/${debugBatch.id}/cancel`, { method: 'POST' });
      setDebugBatch(batch);
      setNotice('已停止批量调试，当前正在运行的用例完成后不会再启动后续用例。');
    } catch (err) {
      setError(`停止批量调试失败：${err.message}`);
    }
  }

  async function refreshDebugSession(sessionId = debugSession?.id, moduleId = activeModuleRef.current) {
    if (!sessionId) return null;
    const session = await fetchJson(`/api/case-debug-sessions/${sessionId}`);
    applyDebugSession(session, moduleId);
    return session;
  }

  function exitCaseDebug() {
    const externalId = debugSession?.case?.externalId || '';
    setDebugSession(null);
    setDebugBatch(null);
    setDebugExecutionScope('auto');
    setDebugAction('');
    updateDebugSessionUrl(null);
    openModule('case-management');
    refreshCaseAssets().catch(() => {});
    setNotice(externalId ? `已退出 ${externalId} 的单用例调试。` : '已退出单用例调试。');
  }

  function resetHealingLiveState() {
    healingBrowserSocketRef.current?.close();
    healingBrowserSocketRef.current = null;
    setHealingLogs([]);
    setHealingBrowserStatus('Closed');
    setHealingBrowserDetail('');
    setHealingLiveConnected(false);
    clearBrowserCanvas(healingBrowserCanvasRef.current);
  }

  function resetHealingDiagnosticLogs() {
    setHealingDiagnosticLogs([]);
  }

  function resetManualWorkspaceState() {
    selectedWorkItemIdRef.current = '';
    currentItemRef.current = null;
    setCurrentItem(null);
    setCasesMarkdown('');
    setPendingCaseDeletions([]);
    setAssistantProposalCommits([]);
    setScriptContent('');
    setSelectedScriptCaseId('');
    setFixtureContent('');
    setScriptGeneration(emptyScriptGenerationState());
    setAssetMode('create');
    setConfirmedElementKeys(new Set());
    setExploration(emptyExploration());
    setExplorationRun(null);
    setExplorationLogs([]);
    setLogs([]);
    setScreenshot('');
    setHealingRun(null);
    resetHealingDiagnosticLogs();
    resetHealingLiveState();
  }

  function startNewRequirement() {
    attachManualModuleSessions('requirements');
    resetManualWorkspaceState();
    setRequirementForm(emptyRequirement());
    setRequirementProjectId('');
    setRequirementFeatureId('');
    setRequirementDirty(false);
    setError('');
    setNotice('已切换到新建需求工单。');
    openModule('requirements');
  }

  function clearLocalManualPageState(page, { preserveWorkspace = false } = {}) {
    if (page === 'requirements') {
      setRequirementForm(emptyRequirement());
      setRequirementProjectId('');
      setRequirementFeatureId('');
      setRequirementDirty(false);
      if (!preserveWorkspace) resetManualWorkspaceState();
    } else if (page === 'cases') {
      setCasesMarkdown('');
      setPendingCaseDeletions([]);
      setAssistantProposalCommits([]);
      setAssetMode('create');
    } else if (page === 'exploration') {
      browserSocketRef.current?.close();
      browserSocketRef.current = null;
      setConfirmedElementKeys(new Set());
      setExploration(emptyExploration());
      setExplorationRun(null);
      setExplorationLogs([]);
      setExplorationPreview('');
      setExplorationBrowserPreviewEnabled(false);
      setBrowserStatus('Closed');
      setBrowserStatusDetail('');
      setLiveConnected(false);
      setExploring(false);
      setExplorationSaving(false);
      clearBrowserCanvas(browserCanvasRef.current);
    } else if (page === 'scripts') {
      setScriptContent('');
      setSelectedScriptCaseId('');
      setFixtureContent('');
      setScriptGeneration(emptyScriptGenerationState());
      setScriptAction('');
    } else if (page === 'execution') {
      if (latestRun?.id) ignoredExecutionRunIdRef.current = latestRun.id;
      executionBrowserSocketRef.current?.close();
      executionBrowserSocketRef.current = null;
      setLogs([]);
      setScreenshot('');
      setExecutionBrowserPreviewEnabled(false);
      setExecutionBrowserStatus('Closed');
      setExecutionBrowserDetail('');
      setExecutionLiveConnected(false);
      setExecutionStarting(false);
      clearBrowserCanvas(executionBrowserCanvasRef.current);
    } else if (page === 'healing') {
      setHealingRun(null);
      setHealingStarting(false);
      setHealingBrowserPreviewEnabled(false);
      resetHealingDiagnosticLogs();
      resetHealingLiveState();
    }
  }

  async function clearManualPageData(page) {
    const pageLabels = {
      cases: '用例设计',
      exploration: '探索实验室',
      scripts: '脚本工作台',
      execution: '执行测试',
      healing: '自愈诊断',
    };
    const label = pageLabels[page] || '当前页面';
    if (!currentItem) {
      clearLocalManualPageState(page);
      setNotice(`${label}页面数据已清空。`);
      return;
    }
    if (!window.confirm(`确认一键清空当前工单的「${label}」页面数据？此操作不可撤销。`)) return;
    try {
      setManualClearAction(page);
      const payload = await fetchJson(`/api/work-items/${currentItem.id}/clear-page-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page }),
      });
      setError('');
      if (payload.item) {
        clearLocalManualPageState(page);
        applySelectedWorkItem(payload.item);
      } else {
        resetManualWorkspaceState();
        setRequirementForm(emptyRequirement());
      }
      await loadAll();
      if (!payload.item) {
        resetManualWorkspaceState();
      }
      setNotice(`${label}页面数据已清空。`);
    } catch (err) {
      setError(`${label}一键清空失败：${err.message}`);
    } finally {
      setManualClearAction('');
    }
  }

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!authUser) return undefined;
    loadAll();
    return undefined;
  }, [authUser?.id, currentProjectId, dashboardScopeProjectId, testExecutionProjectId]);

  useEffect(() => {
    if (!authUser || debugSession?.id || typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    const batchId = params.get(DEBUG_BATCH_QUERY_KEY) || '';
    const sessionId = params.get(DEBUG_SESSION_QUERY_KEY) || '';
    if (!sessionId) return undefined;
    const moduleId = params.get('module') || 'scripts';
    let cancelled = false;
    Promise.all([
      fetchJson(`/api/case-debug-sessions/${sessionId}`),
      batchId ? fetchJson(`/api/case-debug-batches/${batchId}`) : Promise.resolve(null),
    ])
      .then(([session, batch]) => {
        if (!cancelled) {
          if (batch) setDebugBatch(batch);
          applyDebugSession(session, MODULE_LOOKUP[moduleId] ? moduleId : 'scripts', batch);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          updateDebugSessionUrl(null);
          setError(`恢复单用例调试失败：${err.message}`);
        }
      });
    return () => { cancelled = true; };
  }, [authUser?.id, debugSession?.id]);

  useEffect(() => {
    if (debugSession?.id) updateDebugSessionUrl(debugSession, activeModule, debugBatch);
  }, [activeModule, debugSession?.id, debugBatch?.id]);

  useEffect(() => {
    if (!authUser || !debugBatch?.id || ['passed', 'failed', 'needs_attention', 'cancelled'].includes(debugBatch.status)) return undefined;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const batch = await fetchJson(`/api/case-debug-batches/${debugBatch.id}`);
        if (!cancelled) {
          setDebugBatch(batch);
          const activeItem = batch.items?.find((item) => item.debugSessionId === debugSession?.id);
          const sessionChanged = activeItem?.debugSession && (
            activeItem.debugSession.status !== debugSession?.status
            || activeItem.debugSession.latestRunId !== debugSession?.latestRunId
          );
          if (sessionChanged) {
            const session = await fetchJson(`/api/case-debug-sessions/${debugSession.id}`);
            if (!cancelled) applyDebugSession(session, activeModuleRef.current, batch);
          }
        }
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) setError(`刷新批量调试状态失败：${err.message}`);
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, debugBatch?.id, debugBatch?.status, debugSession?.id, debugSession?.status, debugSession?.latestRunId]);

  useEffect(() => {
    if (!authUser || debugSession?.id || activeModule !== 'scripts' || detachedManualModules.has('scripts') || !currentItem?.id) return undefined;
    const workItemId = currentItem.id;
    let cancelled = false;
    async function refreshScriptWorkbenchCases() {
      try {
        const item = await fetchJson(`/api/work-items/${workItemId}`);
        if (cancelled || currentItemRef.current?.id !== workItemId) return;
        currentItemRef.current = item;
        setCurrentItem(item);
        setCasesMarkdown(item.casesMarkdown || '');
        const freshCaseIds = (item.testCases || []).map((caseItem) => caseItem.id).filter(Boolean);
        if (!freshCaseIds.includes(selectedScriptCaseId)) applyScriptWorkspace(item);
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) setError(`同步脚本工作台测试用例失败：${err.message}`);
      }
    }
    refreshScriptWorkbenchCases();
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, debugSession?.id, activeModule, currentItem?.id, detachedManualModules]);

  useEffect(() => {
    if (activeModule !== 'user-management' || !canManageUsers) return undefined;
    loadUsers().catch((err) => setError(`加载用户列表失败：${err.message}`));
    return undefined;
  }, [activeModule, canManageUsers]);

  useEffect(() => {
    if (!authUser || activeModule !== 'delivery') return undefined;
    let cancelled = false;
    async function refreshReports() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const [nextCaseReports, nextManualReports] = await Promise.all([
          fetchJson(buildReportListPath('/api/case-reports', { ...reportScopeFilters, ...caseReportFilters }, caseReports.page || 1, caseReports.pageSize || 50)),
          fetchJson(buildReportListPath('/api/manual-reports', { ...reportScopeFilters, ...manualReportFilters }, manualReports.page || 1, manualReports.pageSize || 50)),
        ]);
        if (!cancelled) {
          setCaseReports(nextCaseReports);
          setManualReports(nextManualReports);
        }
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) setError(`加载测试报告失败：${err.message}`);
      }
    }
    refreshReports();
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, activeModule]);

  useEffect(() => {
    if (!authUser || !latestSuiteRun?.id) return undefined;
    let cancelled = false;
    const startedActive = isActiveRunStatus(latestSuiteRun.status);
    async function pollSuiteRun() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(`/api/suite-runs/${latestSuiteRun.id}`);
        if (!cancelled) {
          setLatestSuiteRun(payload);
          setSuiteRuns((items) => items.map((item) => (item.id === payload.id ? payload : item)));
          if (startedActive && !isActiveRunStatus(payload.status)) {
            if (!currentProjectId) return;
            const [casePayload, deliverablePayload] = await Promise.all([
              fetchJson('/api/test-cases?project_id=all'),
              fetchJson(`/api/deliverables?project_id=${encodeURIComponent(currentProjectId)}`),
            ]);
            setTestCases(casePayload);
            setDeliverables(deliverablePayload);
          }
        }
      } catch {
        // Keep the execution center stable if a historical suite run was removed.
      }
    }
    pollSuiteRun();
    if (!startedActive) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(pollSuiteRun, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, latestSuiteRun?.id, latestSuiteRun?.status, currentProjectId]);

  useEffect(() => {
    if (latestSuiteRun?.id && !monitorSuiteRunId) {
      setMonitorSuiteRunId(latestSuiteRun.id);
    }
  }, [latestSuiteRun?.id, monitorSuiteRunId]);

  useEffect(() => {
    if (!authUser || activeModule !== 'execution-monitor') return undefined;
    let cancelled = false;
    async function pollMonitorList() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(buildSuiteRunsPath(testExecutionProjectId, monitorSuiteNameFilter));
        if (cancelled) return;
        setSuiteRuns(payload);
        setLatestSuiteRun((current) => {
          if (!current?.id) return payload[0] || current;
          return payload.find((item) => item.id === current.id) || current;
        });
        reconcileMonitorSuiteRunSelection(payload, monitorSuiteRunId);
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) setError(`刷新执行监控列表失败：${err.message}`);
      }
    }
    pollMonitorList();
    const timer = window.setInterval(pollMonitorList, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, activeModule, testExecutionProjectId, monitorSuiteNameFilter, monitorQueryRevision, monitorSuiteRunId]);

  useEffect(() => {
    if (!authUser || activeModule !== 'execution-monitor' || !monitorSuiteRunId) return undefined;
    let cancelled = false;
    async function pollMonitorDetail() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const [detailPayload, logPayload] = await Promise.all([
          fetchJson(`/api/suite-runs/${monitorSuiteRunId}`),
          fetchJson(`/api/suite-runs/${monitorSuiteRunId}/logs`),
        ]);
        if (cancelled) return;
        setMonitorSuiteRunDetail(detailPayload);
        setMonitorLogs(logPayload.items || []);
        setSuiteRuns((items) => {
          const exists = items.some((item) => item.id === detailPayload.id);
          return exists ? items.map((item) => (item.id === detailPayload.id ? { ...item, ...detailPayload, cases: item.cases } : item)) : [detailPayload, ...items];
        });
        setLatestSuiteRun((current) => (current?.id === detailPayload.id ? detailPayload : current));
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) {
          if (err.message === 'Suite run not found') {
            const nextRuns = suiteRuns.filter((item) => item.id !== monitorSuiteRunId);
            setSuiteRuns(nextRuns);
            reconcileMonitorSuiteRunSelection(nextRuns, '');
            return;
          }
          setError(`刷新执行监控详情失败：${err.message}`);
        }
      }
    }
    pollMonitorDetail();
    const isActiveRun = monitorSuiteRunDetail ? isActiveRunStatus(monitorSuiteRunDetail.status) : true;
    if (!isActiveRun) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(pollMonitorDetail, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, activeModule, monitorSuiteRunId, monitorSuiteRunDetail?.status]);

  useEffect(() => {
    setMonitorSelectedCaseRunId('');
    setMonitorBrowserRun(null);
    setMonitorBrowserStatus('Closed');
    setMonitorBrowserDetail('');
    setMonitorBrowserLiveConnected(false);
    setMonitorBrowserHasFrame(false);
  }, [monitorSuiteRunId]);

  useEffect(() => {
    if (monitorBrowserTarget.runId) return;
    setMonitorBrowserRun(null);
    setMonitorBrowserStatus('Closed');
    setMonitorBrowserDetail('');
    setMonitorBrowserLiveConnected(false);
    setMonitorBrowserHasFrame(false);
  }, [monitorBrowserTarget.runId]);

  useEffect(() => {
    if (!authUser || activeModule !== 'execution-monitor' || !monitorBrowserTarget.runId) return undefined;
    let cancelled = false;
    async function pollMonitorBrowserRun() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const runPayload = await fetchJson(`/api/runs/${monitorBrowserTarget.runId}`);
        if (cancelled) return;
        setMonitorBrowserRun(runPayload);
        setMonitorBrowserStatus(runPayload.browserSession?.status || runPayload.status || 'Connecting');
      } catch (err) {
        if (!cancelled) {
          if (isAuthRequiredError(err)) return;
          setMonitorBrowserDetail(`刷新执行浏览器画面失败：${err.message}`);
          setMonitorBrowserStatus('Closed');
        }
      }
    }
    pollMonitorBrowserRun();
    const isLive = isActiveRunStatus(monitorBrowserRun?.status) || monitorBrowserTarget.caseItem?.status === 'running';
    if (!isLive) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(pollMonitorBrowserRun, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, activeModule, monitorBrowserTarget.runId, monitorBrowserTarget.caseItem?.status, monitorBrowserRun?.status]);

  useEffect(() => {
    const sessionId = monitorBrowserRun?.browserSessionId;
    if (!monitorBrowserPreviewEnabled || !sessionId || activeModule !== 'execution-monitor') {
      monitorBrowserSocketRef.current?.close();
      monitorBrowserSocketRef.current = null;
      setMonitorBrowserLiveConnected(false);
      setMonitorBrowserHasFrame(false);
      clearBrowserCanvas(monitorBrowserCanvasRef.current);
      return undefined;
    }
    if (monitorBrowserSocketRef.current) {
      monitorBrowserSocketRef.current.close();
    }
    setMonitorBrowserHasFrame(false);
    const socket = createReconnectingWebSocket(`${WS_BASE}/ws/browser-sessions/${sessionId}`);
    monitorBrowserSocketRef.current = socket;
    socket.addEventListener('open', () => setMonitorBrowserLiveConnected(true));
    socket.addEventListener('close', () => setMonitorBrowserLiveConnected(false));
    socket.addEventListener('error', () => setMonitorBrowserLiveConnected(false));
    socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'status' || payload.type === 'capacity') {
        setMonitorBrowserStatus(payload.status);
        setMonitorBrowserDetail(browserConnectionDetail(payload));
      }
      if (payload.type === 'error') {
        setMonitorBrowserStatus('Closed');
        setMonitorBrowserDetail(payload.message || '浏览器会话不存在或已关闭');
      }
      if (payload.type === 'frame' && monitorBrowserCanvasRef.current) {
        drawBrowserFrame(monitorBrowserCanvasRef.current, payload, () => setMonitorBrowserHasFrame(true));
      }
    });
    return () => {
      if (monitorBrowserSocketRef.current === socket) monitorBrowserSocketRef.current = null;
      socket.close();
      setMonitorBrowserLiveConnected(false);
    };
  }, [activeModule, monitorBrowserPreviewEnabled, monitorBrowserRun?.browserSessionId]);

  useEffect(() => {
    if (
      !authUser
      || detachedManualModules.has('execution')
      || !latestRun?.id
      || executionStarting
      || latestRun.id === ignoredExecutionRunIdRef.current
    ) return undefined;
    let cancelled = false;
    const startedRunning = isActiveRunStatus(latestRun.status);
    async function pollRun() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const runPayload = await fetchJson(`/api/runs/${latestRun.id}`);
        const [logPayload, imagePayload] = await Promise.all([
          fetchJson(`/api/runs/${latestRun.id}/logs`).catch(() => ({ items: [] })),
          fetchJson(`/api/runs/${latestRun.id}/screenshot`).catch(() => ({ dataUrl: '' })),
        ]);
        if (!cancelled && latestRun.id !== ignoredExecutionRunIdRef.current) {
          setExecutionBrowserStatus(runPayload.browserSession?.status || runPayload.status);
          setLogs(logPayload.items || logPayload || []);
          setScreenshot(imagePayload.dataUrl || '');
          const terminalTransition = startedRunning && runPayload.workItemId && !isActiveRunStatus(runPayload.status);
          if (terminalTransition) {
            const workItemPayload = await fetchJson(`/api/work-items/${runPayload.workItemId}`);
            if (workItemPayload?.systemImport && workItemPayload.importId && !runPayload.debugSessionId) {
              const importPayload = await waitForImportTerminal(workItemPayload.importId);
              const [casePayload, deliverablePayload] = await Promise.all([
                fetchJson('/api/test-cases?project_id=all'),
                fetchJson('/api/deliverables?include_content=false'),
              ]);
              if (!cancelled) {
                setTestCases(casePayload);
                setDeliverables(deliverablePayload);
                if (importPayload?.status === 'verified') {
                  setNotice(`${workItemPayload?.testCases?.length || importPayload.caseCount || 0} 条用例已绑定共享脚本。`);
                  setError('');
                } else if (importPayload?.status === 'partially-verified') {
                  const pendingCount = (importPayload.failedCaseCount || 0)
                    + (importPayload.skippedCaseCount || 0)
                    + (importPayload.unknownCaseCount || 0);
                  setNotice(`共享脚本部分验证：${importPayload.passedCaseCount || 0} 条通过，${pendingCount} 条待调试。`);
                  setError('');
                } else if (importPayload?.status === 'publish-failed') {
                  setError(importPayload.error || '共享脚本验证通过，但发布绑定失败。');
                } else if (importPayload?.status === 'validation-failed') {
                  setError(importPayload.error || '共享脚本验证失败，已保留待验证脚本和失败证据。');
                }
              }
            }
            if (cancelled) return;
            setRuns((items) => items.map((item) => (item.id === runPayload.id ? runPayload : item)));
            await selectWorkItem(runPayload.workItemId);
            if (debugSession?.id && runPayload.debugSessionId === debugSession.id) {
              const session = await fetchJson(`/api/case-debug-sessions/${debugSession.id}`);
              applyDebugSession(session, 'execution', debugBatch);
            }
            openHealingForFailedExecution(runPayload);
          } else {
            setRuns((items) => items.map((item) => (item.id === runPayload.id ? runPayload : item)));
          }
        }
      } catch {
        // Keep the platform usable when a historical run has missing evidence.
      }
    }
    pollRun();
    if (!startedRunning) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(pollRun, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, latestRun?.id, latestRun?.status, executionStarting, debugSession?.id, detachedManualModules]);

  useEffect(() => {
    if (!authUser || detachedManualModules.has('healing') || !healingRun?.id || !['queued', 'healing'].includes(healingRun.status)) return undefined;
    let cancelled = false;

    async function pollHealingRun() {
      try {
        const payload = await fetchJson(`/api/healing-runs/${healingRun.id}`);
        if (cancelled) return;
        setHealingRun(payload);
        if (payload.latestRun) {
          setRuns((items) => {
            const exists = items.some((item) => item.id === payload.latestRun.id);
            return exists ? items.map((item) => (item.id === payload.latestRun.id ? payload.latestRun : item)) : [payload.latestRun, ...items];
          });
        }
        if (!['queued', 'healing'].includes(payload.status)) {
          setHealingStarting(false);
          await selectWorkItem(payload.workItemId);
          if (debugSession?.id && payload.debugSessionId === debugSession.id) {
            const session = await fetchJson(`/api/case-debug-sessions/${debugSession.id}`);
            applyDebugSession(session, 'healing', debugBatch);
          }
          if (payload.status === 'passed') {
            setNotice('人工自愈重跑已通过：可在当前页面保存该次 Run 绑定的已验证产物。');
            setError('');
          } else {
            setError(payload.error || `人工自愈结束：${statusLabel(payload.status)}`);
          }
        }
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) setError(`获取人工自愈状态失败：${err.message}`);
      }
    }

    pollHealingRun();
    const timer = window.setInterval(pollHealingRun, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, healingRun?.id, healingRun?.status, debugSession?.id, detachedManualModules]);

  useEffect(() => {
    if (!authUser || detachedManualModules.has('healing') || !healingRun?.id) return undefined;
    let cancelled = false;

    async function pollHealingDiagnosticLogs() {
      try {
        const payload = await fetchJson(`/api/healing-runs/${healingRun.id}/logs`);
        if (cancelled) return;
        const items = payload.items || payload || [];
        setHealingDiagnosticLogs(items.map((log) => ({ ...log, source: 'diagnosis' })));
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) {
          setHealingBrowserDetail(`刷新自愈诊断日志失败：${err.message}`);
        }
      }
    }

    pollHealingDiagnosticLogs();
    if (!['queued', 'healing'].includes(healingRun.status)) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(pollHealingDiagnosticLogs, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, healingRun?.id, healingRun?.status, detachedManualModules]);

  useEffect(() => {
    resetHealingLiveState();
    if (healingLiveRun?.id) {
      setHealingBrowserStatus(healingLiveRun.browserSession?.status || healingLiveRun.status || 'Connecting');
    }
  }, [healingLiveRun?.id]);

  useEffect(() => {
    if (!authUser || detachedManualModules.has('healing') || !healingLiveRun?.id) return undefined;
    let cancelled = false;
    const startedActive = isActiveRunStatus(healingLiveRun.status);

    async function pollHealingEvidence() {
      try {
        const [runPayload, logPayload] = await Promise.all([
          fetchJson(`/api/runs/${healingLiveRun.id}`),
          fetchJson(`/api/runs/${healingLiveRun.id}/logs`).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setRuns((items) => {
          const exists = items.some((item) => item.id === runPayload.id);
          return exists ? items.map((item) => (item.id === runPayload.id ? runPayload : item)) : [runPayload, ...items];
        });
        setHealingRun((current) => (
          current?.latestRunId === runPayload.id ? { ...current, latestRun: runPayload } : current
        ));
        setHealingLogs((logPayload.items || logPayload || []).map((log) => ({ ...log, source: 'run' })));
        setHealingBrowserStatus(runPayload.browserSession?.status || runPayload.status || 'Connecting');
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) {
          setHealingBrowserDetail(`刷新自愈重跑日志失败：${err.message}`);
        }
      }
    }

    pollHealingEvidence();
    if (!startedActive) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(pollHealingEvidence, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, healingLiveRun?.id, healingLiveRun?.status, detachedManualModules]);

  useEffect(() => {
    const sessionId = healingLiveRun?.browserSessionId;
    if (!healingBrowserPreviewEnabled || !sessionId) {
      healingBrowserSocketRef.current?.close();
      healingBrowserSocketRef.current = null;
      setHealingLiveConnected(false);
      clearBrowserCanvas(healingBrowserCanvasRef.current);
      return undefined;
    }
    healingBrowserSocketRef.current?.close();
    setHealingLiveConnected(false);
    const socket = createReconnectingWebSocket(`${WS_BASE}/ws/browser-sessions/${sessionId}`);
    healingBrowserSocketRef.current = socket;
    socket.addEventListener('open', () => {
      if (healingBrowserSocketRef.current === socket) setHealingLiveConnected(true);
    });
    socket.addEventListener('close', () => {
      if (healingBrowserSocketRef.current === socket) setHealingLiveConnected(false);
    });
    socket.addEventListener('error', () => {
      if (healingBrowserSocketRef.current !== socket) return;
      setHealingLiveConnected(false);
      setHealingBrowserDetail('自愈重跑实时浏览器会话连接失败');
    });
    socket.addEventListener('message', (event) => {
      if (healingBrowserSocketRef.current !== socket) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'status' || payload.type === 'capacity') {
        setHealingBrowserStatus(payload.status);
        setHealingBrowserDetail(browserConnectionDetail(payload));
      }
      if (payload.type === 'error') {
        setHealingBrowserStatus('Closed');
        setHealingBrowserDetail(payload.message || '浏览器会话不存在或已关闭');
      }
      if (payload.type === 'frame' && healingBrowserCanvasRef.current) {
        drawBrowserFrame(healingBrowserCanvasRef.current, payload);
      }
    });
    return () => {
      if (healingBrowserSocketRef.current === socket) healingBrowserSocketRef.current = null;
      socket.close();
      setHealingLiveConnected(false);
    };
  }, [healingBrowserPreviewEnabled, healingLiveRun?.browserSessionId]);

  useEffect(() => {
    const sessionId = latestRun?.browserSessionId;
    if (!executionBrowserPreviewEnabled || !sessionId) {
      executionBrowserSocketRef.current?.close();
      executionBrowserSocketRef.current = null;
      setExecutionLiveConnected(false);
      clearBrowserCanvas(executionBrowserCanvasRef.current);
      return undefined;
    }
    if (executionBrowserSocketRef.current) {
      executionBrowserSocketRef.current.close();
    }
    setExecutionLiveConnected(false);
    const socket = createReconnectingWebSocket(`${WS_BASE}/ws/browser-sessions/${sessionId}`);
    executionBrowserSocketRef.current = socket;
    socket.addEventListener('open', () => {
      if (executionBrowserSocketRef.current === socket) setExecutionLiveConnected(true);
    });
    socket.addEventListener('close', () => {
      if (executionBrowserSocketRef.current === socket) setExecutionLiveConnected(false);
    });
    socket.addEventListener('error', () => {
      if (executionBrowserSocketRef.current !== socket) return;
      setExecutionLiveConnected(false);
      setExecutionBrowserDetail('实时浏览器会话连接失败');
    });
    socket.addEventListener('message', (event) => {
      if (executionBrowserSocketRef.current !== socket) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'status' || payload.type === 'capacity') {
        setExecutionBrowserStatus(payload.status);
        setExecutionBrowserDetail(browserConnectionDetail(payload));
      }
      if (payload.type === 'error') {
        setExecutionBrowserStatus('Closed');
        setExecutionBrowserDetail(payload.message || '浏览器会话不存在或已关闭');
      }
      if (payload.type === 'frame' && executionBrowserCanvasRef.current) {
        drawBrowserFrame(executionBrowserCanvasRef.current, payload);
      }
    });
    return () => {
      if (executionBrowserSocketRef.current === socket) executionBrowserSocketRef.current = null;
      socket.close();
      setExecutionLiveConnected(false);
    };
  }, [executionBrowserPreviewEnabled, latestRun?.browserSessionId]);

  useEffect(() => {
    if (!authUser || detachedManualModules.has('exploration') || !explorationRun?.id || !isActiveRunStatus(explorationRun.status)) return undefined;
    let cancelled = false;

    async function pollExplorationRun() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(`/api/exploration-runs/${explorationRun.id}`);
        if (cancelled) return;
        applyExplorationRunPayload(payload);
      } catch (err) {
        if (!cancelled) {
          if (isAuthRequiredError(err)) return;
          setExploring(false);
          setError(`获取探索流程失败：${err.message}`);
        }
      }
    }

    pollExplorationRun();
    const timer = window.setInterval(pollExplorationRun, 800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, explorationRun?.id, explorationRun?.status, detachedManualModules]);

  useEffect(() => {
    const sessionId = explorationRun?.browserSessionId;
    if (!explorationBrowserPreviewEnabled || !sessionId) {
      browserSocketRef.current?.close();
      browserSocketRef.current = null;
      setLiveConnected(false);
      clearBrowserCanvas(browserCanvasRef.current);
      return undefined;
    }
    if (browserSocketRef.current) {
      browserSocketRef.current.close();
    }
    const socket = createReconnectingWebSocket(`${WS_BASE}/ws/browser-sessions/${sessionId}`);
    browserSocketRef.current = socket;
    socket.addEventListener('open', () => setLiveConnected(true));
    socket.addEventListener('close', () => setLiveConnected(false));
    socket.addEventListener('message', async (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'status' || payload.type === 'capacity') {
        setBrowserStatus(payload.status);
        setBrowserStatusDetail(browserConnectionDetail(payload));
      }
      if (payload.type === 'frame' && browserCanvasRef.current) {
        drawBrowserFrame(browserCanvasRef.current, payload);
      }
    });
    return () => {
      if (browserSocketRef.current === socket) browserSocketRef.current = null;
      socket.close();
      setLiveConnected(false);
    };
  }, [explorationBrowserPreviewEnabled, explorationRun?.browserSessionId]);

  async function createWorkItem() {
    const sessionVersion = captureModuleSession('requirements');
    if (!requirementProjectId) {
      setError('项目名称为必填项，请先选择项目管理中的项目。');
      return;
    }
    if (!requirementFeatureId) {
      setError('功能为必填项，请先选择所选项目对应功能树上的功能。');
      return;
    }
    setAnalyzingRequirement(true);
    try {
      const item = await fetchJson('/api/work-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requirementForm, project_id: requirementProjectId, feature_id: requirementFeatureId }),
      });
      if (!isCurrentModuleSession('requirements', sessionVersion)) return;
      setError('');
      setWorkItems((items) => [item, ...items]);
      attachManualModuleSessions('requirements');
      applySelectedWorkItem(item);
      openManualModuleSession('requirements');
      setNotice('需求分析完成，可在确认抽取结果后进入用例设计。');
    } catch (err) {
      if (!isCurrentModuleSession('requirements', sessionVersion)) return;
      setError(`需求分析失败：${err.message}`);
    } finally {
      setAnalyzingRequirement(false);
    }
  }

  async function updateCurrentWorkItem() {
    const sessionVersion = captureModuleSession('requirements');
    if (!currentItem?.id) return;
    if (!requirementFeatureId) {
      setError('功能为必填项，请先选择所选项目对应功能树上的功能。');
      return;
    }
    setAnalyzingRequirement(true);
    try {
      const item = await fetchJson(`/api/work-items/${currentItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requirementForm, feature_id: requirementFeatureId }),
      });
      if (!isCurrentModuleSession('requirements', sessionVersion)) return;
      setError('');
      setWorkItems((items) => items.map((candidate) => candidate.id === item.id ? item : candidate));
      applySelectedWorkItem(item);
      setNotice(item.downstreamReviewRequired
        ? '当前工单已更新并重新分析；原有下游数据已保留，请按提示复核后重新验证。'
        : '当前工单已更新并重新分析。');
    } catch (err) {
      if (!isCurrentModuleSession('requirements', sessionVersion)) return;
      setError(`保存需求工单失败：${err.message}`);
    } finally {
      setAnalyzingRequirement(false);
    }
  }

  function toggleCaseSelection(caseId, selected) {
    const target = testCases.find((item) => item.id === caseId);
    const lockedProjectId = testCases.find((item) => selectedCaseIds.has(item.id))?.projectId || '';
    if (selected && lockedProjectId && target?.projectId !== lockedProjectId) {
      setError('多选调试只支持同一项目的用例，请先清空当前选择');
      return;
    }
    setSelectedCaseIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(caseId);
      else next.delete(caseId);
      return next;
    });
  }

  function setAllVisibleCasesSelected(cases, selected) {
    setSelectedCaseIds((previous) => {
      const next = new Set(previous);
      const lockedProjectId = testCases.find((item) => previous.has(item.id))?.projectId || cases[0]?.projectId || '';
      cases.forEach((item) => {
        if (selected && item.projectId === lockedProjectId) next.add(item.id);
        else next.delete(item.id);
      });
      return next;
    });
  }

  async function updateCase(caseId, changes) {
    try {
      const updatedCase = await fetchJson(`/api/test-cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      setTestCases((items) => items.map((item) => (item.id === caseId ? updatedCase : item)));
      setSuiteCaseProjects((items) => items.map((project) => ({
        ...project,
        testCases: (project.testCases || []).map((item) => (item.id === caseId ? updatedCase : item)),
      })));
      if (Object.prototype.hasOwnProperty.call(changes, 'feature_id') && updatedCase.projectId) {
        try {
          const featurePayload = await fetchJson(`/api/features?project_id=${encodeURIComponent(updatedCase.projectId)}`);
          setSuiteCaseProjects((items) => items.map((project) => (project.id === updatedCase.projectId ? {
            ...project,
            features: featurePayload.items || [],
            featureTree: featurePayload.tree || [],
          } : project)));
          if (updatedCase.projectId === currentProjectId) {
            setFeatures(featurePayload.items || []);
            setFeatureTree(featurePayload.tree || []);
          }
        } catch (refreshError) {
          setNotice(`用例已更新，但功能统计刷新失败：${refreshError.message}`);
          setError('');
          return updatedCase;
        }
      }
      setNotice(`用例已更新：${updatedCase.externalId || updatedCase.title || caseId}`);
      setError('');
      return updatedCase;
    } catch (err) {
      setError(`更新用例失败：${err.message}`);
      throw err;
    }
  }

  async function loadScriptVersion(scriptVersionId) {
    return fetchJson(`/api/script-versions/${scriptVersionId}`);
  }

  async function openScriptEditor(caseItem) {
    const scriptVersionId = caseItem?.scriptVersionId || caseItem?.candidateScriptVersionId || '';
    if (!scriptVersionId) return;
    const sourceCase = {
      ...caseItem,
      scriptVersionId,
      specPath: caseItem.specPath || caseItem.candidateSpecPath || '',
      scriptVersion: caseItem.scriptVersion || caseItem.candidateScriptVersion,
      scriptStatus: caseItem.scriptStatus || caseItem.candidateScriptStatus || 'draft',
    };
    setScriptEditor({
      open: true,
      loading: true,
      saving: false,
      error: '',
      detail: null,
      content: '',
      sourceCase,
    });
    try {
      const detail = await loadScriptVersion(scriptVersionId);
      setScriptEditor({
        open: true,
        loading: false,
        saving: false,
        error: '',
        detail,
        content: detail.content || '',
        sourceCase,
      });
      setError('');
    } catch (err) {
      setScriptEditor((value) => ({ ...value, loading: false, error: err.message }));
    }
  }

  function closeScriptEditor() {
    setScriptEditor((value) => ({ ...value, open: false, loading: false, saving: false, error: '' }));
  }

  function updateScriptEditorContent(content) {
    setScriptEditor((value) => ({ ...value, content }));
  }

  async function saveScriptEditorDraft() {
    if (!scriptEditor.detail?.id) return;
    setScriptEditor((value) => ({ ...value, saving: true, error: '' }));
    try {
      const draft = await fetchJson(`/api/script-versions/${scriptEditor.detail.id}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: scriptEditor.content }),
      });
      setScriptEditor((value) => ({
        ...value,
        saving: false,
        detail: draft,
        content: draft.content || value.content,
        error: '',
      }));
      if (draft.workItemId && (draft.workItemId === currentItemRef.current?.id || draft.workItemId === selectedWorkItemIdRef.current)) {
        const item = await fetchJson(`/api/work-items/${draft.workItemId}`);
        setCurrentItem(item);
        currentItemRef.current = item;
        applyScriptWorkspace(item, draft.caseId || scriptEditor.sourceCase?.id || '');
        setAssetMode(item.assetMode || 'create');
      }
      await refreshCaseAssets();
      setNotice(`已另存为草稿脚本 v${draft.version || '-'}，active 绑定将在验证发布后替换。`);
      setError('');
    } catch (err) {
      setScriptEditor((value) => ({ ...value, saving: false, error: err.message }));
    }
  }

  async function deleteCase(caseItem) {
    if (!caseItem?.id) return;
    const label = [caseItem.externalId, caseItem.title].filter(Boolean).join(' · ') || caseItem.id;
    if (!window.confirm(`确认删除用例「${label}」？此操作会从测试套件中移除关联，但保留执行历史和交付物文件。`)) return;
    try {
      await fetchJson(`/api/test-cases/${caseItem.id}`, { method: 'DELETE' });
      setSelectedCaseIds((previous) => {
        const next = new Set(previous);
        next.delete(caseItem.id);
        return next;
      });
      await refreshCaseAssets();
      setNotice(`用例已删除：${label}`);
      setError('');
    } catch (err) {
      setError(`删除用例失败：${err.message}`);
    }
  }

  async function deleteSelectedCases() {
    const caseIds = Array.from(selectedCaseIds);
    if (!caseIds.length) {
      setError('请先选择至少一个用例再删除');
      return;
    }
    if (!window.confirm(`确认删除已选 ${caseIds.length} 条用例？此操作会从测试套件中移除关联，但保留执行历史和交付物文件。`)) return;
    try {
      const payload = await fetchJson('/api/test-cases/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_ids: caseIds }),
      });
      setSelectedCaseIds((previous) => {
        const next = new Set(previous);
        caseIds.forEach((caseId) => next.delete(caseId));
        return next;
      });
      await refreshCaseAssets();
      setNotice(`已删除 ${payload.deleted || caseIds.length} 条用例`);
      setError('');
    } catch (err) {
      setError(`批量删除用例失败：${err.message}`);
    }
  }

  function beginCreateSuite() {
    if (!canManageAssets) {
      setError('当前账号无权新建测试套件');
      return;
    }
    const initialForm = normalizeSuiteForm({ projectId: currentProjectId, name: '新建测试套件', caseIds: Array.from(selectedCaseIds) });
    openModule('test-suites');
    navigateSuite('create', '', { initialForm, skipUnsaved: true });
  }

  function selectSuite(suiteId, view = 'detail') {
    const suite = suites.find((item) => item.id === suiteId)
      || (suiteRouteRecord?.id === suiteId ? suiteRouteRecord : null);
    if (!suite || suite.legacy) return;
    navigateSuite(view, suite.id, { suite });
  }

  async function saveSuite() {
    const editingExistingSuite = Boolean(selectedSuiteId);
    setNotice('');
    const name = suiteForm.name.trim();
    if (!name) {
      setError('套件名称不能为空');
      return;
    }
    const casesById = new Map(suiteCaseProjects.flatMap((project) => (project.testCases || []).map((item) => [item.id, item])));
    const selectedCases = (suiteForm.caseIds || []).map((caseId) => casesById.get(caseId)).filter(Boolean);
    const selectedProjectIds = new Set(selectedCases.map((item) => item.projectId).filter(Boolean));
    if (selectedProjectIds.size > 1) {
      setError('套件不能包含跨项目用例，请只保留同一项目的用例后再保存');
      return;
    }
    const suiteProjectId = selectedProjectIds.values().next().value || suiteForm.projectId || currentProjectId;
    if (!suiteProjectId) {
      setError('请先选择项目后再保存套件');
      return;
    }
    if ((suiteForm.caseIds || []).length !== selectedCases.length) {
      setError('存在无法识别的用例，请刷新页面后重新选择');
      return;
    }
    try {
      const payload = {
        project_id: suiteProjectId,
        name,
        description: suiteForm.description,
        status: suiteForm.status,
        run_config: suiteForm.runConfig,
        schedule_config: suiteForm.scheduleConfig,
      };
      const suite = selectedSuiteId
        ? await fetchJson(`/api/test-suites/${selectedSuiteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        : await fetchJson('/api/test-suites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      const updatedSuite = await fetchJson(`/api/test-suites/${suite.id}/cases`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_ids: suiteForm.caseIds }),
      });
      setSuites((items) => [updatedSuite, ...items.filter((item) => item.id !== updatedSuite.id)]);
      setSelectedSuiteId(updatedSuite.id);
      setSuiteRouteRecord(updatedSuite);
      const nextForm = normalizeSuiteForm(updatedSuite);
      setSuiteForm(nextForm);
      setSuiteFormBaseline(nextForm);
      setSuiteEditing(editingExistingSuite);
      setNotice(`套件已保存：${updatedSuite.name}`);
      setError('');
      if (!editingExistingSuite) {
        navigateSuite('detail', updatedSuite.id, { suite: updatedSuite, skipUnsaved: true });
      }
    } catch (err) {
      setError(`保存套件失败：${err.message}`);
    }
  }

  async function deleteSuite(suiteId = selectedSuiteId) {
    const suite = suites.find((item) => item.id === suiteId)
      || (suiteRouteRecord?.id === suiteId ? suiteRouteRecord : null);
    if (!suite || suite.legacy) return;
    if (!canManageAssets) {
      setError('当前账号无权删除测试套件');
      return;
    }
    if (!window.confirm(`确认删除测试套件「${suite.name}」？仅删除套件及用例关联，不会删除测试用例和历史执行证据。`)) return;
    try {
      await fetchJson(`/api/test-suites/${suiteId}`, { method: 'DELETE' });
      setSuites((items) => items.filter((item) => item.id !== suiteId));
      if (selectedSuiteId === suiteId) {
        setSelectedSuiteId('');
        setSuiteForm(normalizeSuiteForm());
        setSuiteEditing(false);
      }
      setNotice(`套件已删除：${suite.name}`);
      setError('');
      loadSuiteRoute('list', '', { historyMode: 'replace' });
    } catch (err) {
      setError(`删除套件失败：${err.message}`);
    }
  }

  async function runSelectedCases(caseIds = Array.from(selectedCaseIds)) {
    if (!caseIds.length) {
      setError('请先选择至少一个用例执行');
      return;
    }
    try {
      const suiteRun = await fetchJson('/api/suite-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_ids: caseIds }),
      });
      setLatestSuiteRun(suiteRun);
      applyMonitorQuery(suiteRun.projectId || 'all', '');
      setMonitorSuiteRunId(suiteRun.id);
      setMonitorSuiteRunDetail(suiteRun);
      setMonitorLogs([]);
      setSuiteRuns((items) => [suiteRun, ...items]);
      openModule('execution');
      setNotice(`批量执行已启动：${suiteRun.totalCases} 条用例`);
      setError('');
    } catch (err) {
      setError(`批量执行失败：${err.message}`);
    }
  }

  async function runSuite(suiteId, options = {}) {
    try {
      const suiteRun = await fetchJson('/api/suite-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suite_id: suiteId, environment_id: options.environmentId || '' }),
      });
      setLatestSuiteRun(suiteRun);
      applyMonitorQuery(suiteRun.projectId || 'all', '');
      setMonitorSuiteRunId(suiteRun.id);
      setMonitorSuiteRunDetail(suiteRun);
      setMonitorLogs([]);
      setSuiteRuns((items) => [suiteRun, ...items]);
      if (options.navigateToMonitor) {
        openModule('execution-monitor');
      }
      setNotice(options.navigateToMonitor
        ? `套件执行已启动：${suiteRun.name}。请在执行监控内实时查看执行详情。`
        : `套件执行已启动：${suiteRun.name}`);
      setError('');
    } catch (err) {
      setError(`套件执行失败：${err.message}`);
    }
  }

  function resetAutomationPageSession({ clearMessages = false } = {}) {
    closeAutomationRealtime();
    setAutomationProjectId('');
    setAutomationFeatureId('');
    setAutomationRequirement('');
    setAutomationFlow(null);
    setAutomationFlowId('');
    setAutomationLogs([]);
    setAutomationArtifacts([]);
    setAutomationStatus('idle');
    setAutomationStopping(false);
    setAutomationActiveStage('');
    setAutomationLiveConnected(false);
    setAutomationBrowserStatus('Closed');
    setAutomationBrowserDetail('');
    setAutomationBrowserLiveConnected(false);
    setAutomationBrowserSessionId('');
    setAutomationBrowserMode('exploration');
    setAutomationBrowserHasFrame(false);
    setAutomationBrowserPreviewEnabled(false);
    setAutomationHistoryError('');
    setAutomationHistoryRestoringId('');
    clearBrowserCanvas(automationBrowserCanvasRef.current);
    setAutomationResetKey((value) => value + 1);
    if (clearMessages) {
      setError('');
      setNotice('');
    }
  }

  function clearAutomationFlow() {
    resetAutomationPageSession({ clearMessages: true });
  }

  async function loadAutomationFlowHistory() {
    setAutomationHistoryLoading(true);
    setAutomationHistoryError('');
    try {
      const payload = await fetchJson('/api/automation-flows');
      setAutomationFlowHistory(Array.isArray(payload) ? payload : []);
    } catch (err) {
      setAutomationHistoryError(`加载历史记录失败：${err.message}`);
    } finally {
      setAutomationHistoryLoading(false);
    }
  }

  async function restoreAutomationFlow(flowRunId) {
    if (!flowRunId) return;
    const sessionVersion = captureModuleSession('automation-flow');
    setAutomationHistoryRestoringId(flowRunId);
    setAutomationHistoryError('');
    try {
      const payload = await fetchJson(`/api/automation-flows/${flowRunId}`);
      if (!isCurrentModuleSession('automation-flow', sessionVersion)) return;
      closeAutomationRealtime();
      applyAutomationSnapshot(payload);
      setAutomationFlowId(payload.id || payload.flowRunId || flowRunId);
      setAutomationResetKey((value) => value + 1);
      setNotice(`已恢复历史全流程：${payload.flowRunId || payload.id || flowRunId}`);
      setError('');
    } catch (err) {
      if (!isCurrentModuleSession('automation-flow', sessionVersion)) return;
      setAutomationHistoryError(`恢复历史记录失败：${err.message}`);
      setError(`恢复历史记录失败：${err.message}`);
    } finally {
      setAutomationHistoryRestoringId('');
    }
  }

  function handleAutomationProjectChange(projectId) {
    setAutomationProjectId(projectId);
    setAutomationFeatureId('');
  }

  async function startAutomationFlow() {
    const sessionVersion = captureModuleSession('automation-flow');
    const requirementText = automationRequirement.trim();
    if (!automationProjectId) {
      setError('项目名称为必填项，请先选择项目管理中的项目。');
      return;
    }
    if (!automationFeatureId) {
      setError('功能为必填项，请先选择所选项目对应功能树上的功能。');
      return;
    }
    if (!requirementText) {
      closeAutomationRealtime();
      setAutomationFlow(null);
      setAutomationFlowId('');
      setAutomationStatus('blocked');
      setAutomationActiveStage('需求分析');
      setAutomationArtifacts([]);
      setAutomationLogs([{
        id: crypto.randomUUID?.() || `${Date.now()}-blocked`,
        createdAt: new Date().toISOString(),
        stage: '需求分析',
        level: 'blocked',
        message: '阻塞：需求文本为空，请先输入需求、PRD、验收标准、缺陷描述或页面说明。',
      }]);
      return;
    }

    try {
      closeAutomationRealtime();
      setAutomationFlow(null);
      setAutomationFlowId('');
      setAutomationLiveTracking(true);
      setAutomationLogs([]);
      setAutomationArtifacts([]);
      setAutomationStatus('running');
      setAutomationActiveStage('需求分析');
      const payload = await fetchJson('/api/automation-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: requirementText, project_id: automationProjectId, feature_id: automationFeatureId }),
      });
      if (!isCurrentModuleSession('automation-flow', sessionVersion)) return;
      setAutomationFlow(payload);
      setAutomationFlowId(payload.id || payload.flowRunId || '');
      setAutomationLiveTracking(isActiveFlowStatus(payload.status || 'running'));
      setAutomationLogs(payload.logs || []);
      setAutomationArtifacts(payload.flowArtifacts || []);
      setAutomationStatus(payload.status || 'running');
      setAutomationActiveStage(payload.stage || '需求分析');
      loadAutomationFlowHistory();
      if (isTerminalFlowStatus(payload.status)) {
        await handleAutomationTerminalStatus(payload.status, payload);
      } else {
        setNotice(`真实全流程已启动：${payload.flowRunId || payload.id}`);
        setError('');
      }
    } catch (err) {
      if (!isCurrentModuleSession('automation-flow', sessionVersion)) return;
      closeAutomationRealtime();
      setAutomationStatus('failed');
      setAutomationActiveStage('需求分析');
      setError(`启动全流程失败：${err.message}`);
    }
  }

  async function stopAutomationFlow() {
    const flowRunId = automationFlow?.id || automationFlow?.flowRunId || automationFlowId;
    if (!flowRunId || automationStopping) return;
    setAutomationStopping(true);
    try {
      const payload = await fetchJson(`/api/automation-flows/${flowRunId}/cancel`, { method: 'POST' });
      applyAutomationSnapshot(payload);
      setAutomationFlowId(payload.id || payload.flowRunId || flowRunId);
      if (isTerminalFlowStatus(payload.status)) {
        closeAutomationRealtime();
      }
      setNotice('已停止当前一键流程。');
      setError('');
      loadAutomationFlowHistory();
    } catch (err) {
      setError(`停止一键流程失败：${err.message}`);
    } finally {
      setAutomationStopping(false);
    }
  }

  async function retryAutomationExploration() {
    const flowRunId = automationFlow?.id || automationFlow?.flowRunId || automationFlowId;
    if (!flowRunId || automationRetrying) return;
    setAutomationRetrying(true);
    try {
      const payload = await fetchJson(`/api/automation-flows/${flowRunId}/retry-exploration`, { method: 'POST' });
      applyAutomationSnapshot(payload);
      setAutomationFlowId(payload.id || payload.flowRunId || flowRunId);
      setAutomationLiveTracking(true);
      setNotice('已使用原工单和原用例重新启动页面探索。');
      setError('');
      loadAutomationFlowHistory();
    } catch (err) {
      setError(`重试页面探索失败：${err.message}`);
    } finally {
      setAutomationRetrying(false);
    }
  }

  async function saveExploration() {
    if (!currentItem) return;
    const sessionVersion = captureModuleSession('exploration');
    try {
      setExplorationSaving(true);
      const item = await fetchJson(debugSession?.id ? `/api/case-debug-sessions/${debugSession.id}/exploration` : `/api/work-items/${currentItem.id}/explore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exploration),
      });
      if (!isCurrentModuleSession('exploration', sessionVersion)) return;
      setError('');
      if (debugSession?.id) applyDebugSession(item, 'scripts');
      else {
        setCurrentItem(item);
        openManualModuleSession('scripts');
      }
      setNotice(debugSession?.id ? '当前用例的探索草稿已保存，可以生成或编辑脚本。' : '探索结果已保存，可以生成或编辑 Playwright 草稿脚本。');
    } catch (err) {
      if (!isCurrentModuleSession('exploration', sessionVersion)) return;
      setError(`保存探索失败：${err.message}`);
    } finally {
      setExplorationSaving(false);
    }
  }

  function applyExplorationResult(result) {
    const incomingElements = result.elements?.length ? result.elements : [];
    setExploration((state) => {
      const localByKey = new Map(state.elements.map((element) => [elementKey(element), element]).filter(([key]) => key));
      const confirmedKeys = confirmedElementKeysRef.current;
      const elements = incomingElements.map((element) => {
        const key = elementKey(element);
        const local = key ? localByKey.get(key) : null;
        return {
          ...element,
          confirmed: key && confirmedKeys.has(key) ? true : local ? Boolean(local.confirmed) : Boolean(element.confirmed || element.recommended),
        };
      });
      return {
        ...state,
        notes: result.notes || '',
        screenshot_path: result.screenshot_path || '',
        page_structure: result.page_structure || '',
        state_evidence: result.stateEvidence || [],
        elements,
      };
    });
  }

  function applyExplorationRunPayload(payload, { announceStarted = false } = {}) {
    setExplorationRun(payload);
    setExplorationLogs(payload.logs || []);
    setBrowserStatus(payload.browserSession?.status || payload.status);
    if (payload.previewDataUrl) setExplorationPreview(payload.previewDataUrl);

    if (payload.status === 'passed' && payload.result) {
      setExploring(false);
      applyExplorationResult(payload.result);
      setNotice(`探索完成：采集到 ${payload.result.elements?.length || 0} 个候选元素，已推荐 ${payload.recommendedConfirmationCount || payload.result.recommendedConfirmationCount || 0} 个高置信 selector，请审阅后保存探索。`);
      setError('');
      return;
    }
    if (payload.status === 'partial' && payload.result) {
      setExploring(false);
      applyExplorationResult(payload.result);
      setNotice(`探索部分完成：采集到 ${payload.result.elements?.length || 0} 个候选元素，已推荐 ${payload.recommendedConfirmationCount || payload.result.recommendedConfirmationCount || 0} 个高置信 selector，请审阅后保存探索。`);
      setError('');
      return;
    }
    if (isActiveRunStatus(payload.status)) {
      setExploring(true);
      if (announceStarted) {
        setNotice('探索已启动：正在调起 Playwright 浏览器并实时采集页面证据。');
        setError('');
      }
      return;
    }

    setExploring(false);
    setNotice('');
    if (payload.status === 'failed') {
      if (payload.result) applyExplorationResult(payload.result);
      setError(`执行探索失败：${payload.error || '浏览器探索异常结束'}`);
    } else {
      setError(`执行探索已结束：${payload.error || statusLabel(payload.status) || '未返回有效状态'}`);
    }
  }

  async function runExploration(repairRequest = null) {
    if (!currentItem) return;
    const sessionVersion = captureModuleSession('exploration');
    try {
      setExploring(true);
      setExplorationLogs([]);
      const run = await fetchJson(debugSession?.id ? `/api/case-debug-sessions/${debugSession.id}/exploration/run` : `/api/work-items/${currentItem.id}/explore/run`, {
        method: 'POST',
        ...(repairRequest ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(repairRequest),
        } : {}),
      });
      if (!isCurrentModuleSession('exploration', sessionVersion)) return;
      applyExplorationRunPayload(run, { announceStarted: true });
    } catch (err) {
      if (!isCurrentModuleSession('exploration', sessionVersion)) return;
      setError(`执行探索失败：${err.message}`);
      setExploring(false);
    }
  }

  function sendBrowserCommand(payload) {
    const socket = browserSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ ...payload, commandId: crypto.randomUUID?.() || `${Date.now()}` }));
  }

  function selectMonitorCaseRun(runId) {
    if (!runId) return;
    setMonitorSelectedCaseRunId(runId);
  }

  function resetMonitorTransientState() {
    monitorBrowserSocketRef.current?.close();
    monitorBrowserSocketRef.current = null;
    setMonitorSuiteRunDetail(null);
    setMonitorLogs([]);
    setMonitorLogLevel('all');
    setMonitorSelectedCaseRunId('');
    setMonitorBrowserRun(null);
    setMonitorBrowserStatus('Closed');
    setMonitorBrowserDetail('');
    setMonitorBrowserLiveConnected(false);
    setMonitorBrowserHasFrame(false);
  }

  function clearMonitorSuiteRunSelection() {
    setMonitorSuiteRunId('');
    resetMonitorTransientState();
  }

  function reconcileMonitorSuiteRunSelection(nextRuns, preferredRunId = monitorSuiteRunId) {
    if (!nextRuns.length) {
      clearMonitorSuiteRunSelection();
      return;
    }
    const stillSelected = preferredRunId && nextRuns.some((item) => item.id === preferredRunId);
    if (stillSelected) return;
    resetMonitorTransientState();
    setMonitorSuiteRunId(nextRuns[0].id);
  }

  function applyMonitorQuery(projectId = 'all', suiteName = '') {
    setTestExecutionProjectId(projectId || 'all');
    setMonitorSuiteNameFilter(suiteName.trim());
    setMonitorQueryRevision((value) => value + 1);
  }

  async function deleteSuiteRun(suiteRun) {
    if (!suiteRun?.id || isActiveRunStatus(suiteRun.status)) return;
    const confirmed = window.confirm(`确认从执行监控列表移除「${suiteRun.name}」？单用例执行历史、日志和报告文件会保留。`);
    if (!confirmed) return;
    try {
      await fetchJson(`/api/suite-runs/${suiteRun.id}`, { method: 'DELETE' });
      const nextItems = suiteRuns.filter((item) => item.id !== suiteRun.id);
      setSuiteRuns(nextItems);
      reconcileMonitorSuiteRunSelection(nextItems, monitorSuiteRunId === suiteRun.id ? '' : monitorSuiteRunId);
      setLatestSuiteRun((current) => (current?.id === suiteRun.id ? nextItems[0] || null : current));
      setNotice(`执行记录已移除：${suiteRun.name}`);
      setError('');
    } catch (err) {
      setError(`删除执行记录失败：${err.message}`);
    }
  }

  function sendAutomationBrowserCommand(payload) {
    const socket = automationBrowserSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ ...payload, commandId: crypto.randomUUID?.() || `${Date.now()}` }));
  }

  function canvasPoint(event, canvas) {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * canvas.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * canvas.height),
    };
  }

  function handleBrowserClick(event) {
    const point = canvasPoint(event, browserCanvasRef.current);
    sendBrowserCommand({ type: 'mouse', action: 'click', x: point.x, y: point.y });
  }

  function handleBrowserMove(event) {
    const point = canvasPoint(event, browserCanvasRef.current);
    sendBrowserCommand({ type: 'mouse', action: 'move', x: point.x, y: point.y });
  }

  function handleBrowserWheel(event) {
    event.preventDefault();
    sendBrowserCommand({ type: 'mouse', action: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY });
  }

  function handleBrowserKeyDown(event) {
    if (event.key.length === 1) {
      sendBrowserCommand({ type: 'keyboard', action: 'type', text: event.key });
    } else {
      sendBrowserCommand({ type: 'keyboard', action: 'press', key: event.key });
    }
  }

  function handleAutomationBrowserClick(event) {
    if (automationBrowserMode !== 'exploration') return;
    const point = canvasPoint(event, automationBrowserCanvasRef.current);
    sendAutomationBrowserCommand({ type: 'mouse', action: 'click', x: point.x, y: point.y });
  }

  function handleAutomationBrowserMove(event) {
    if (automationBrowserMode !== 'exploration') return;
    const point = canvasPoint(event, automationBrowserCanvasRef.current);
    sendAutomationBrowserCommand({ type: 'mouse', action: 'move', x: point.x, y: point.y });
  }

  function handleAutomationBrowserWheel(event) {
    if (automationBrowserMode !== 'exploration') return;
    event.preventDefault();
    sendAutomationBrowserCommand({ type: 'mouse', action: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY });
  }

  function handleAutomationBrowserKeyDown(event) {
    if (automationBrowserMode !== 'exploration') return;
    if (event.key.length === 1) {
      sendAutomationBrowserCommand({ type: 'keyboard', action: 'type', text: event.key });
    } else {
      sendAutomationBrowserCommand({ type: 'keyboard', action: 'press', key: event.key });
    }
  }

  async function generateCases(action = 'generate') {
    if (!currentItem) return;
    const sessionVersion = captureModuleSession('cases');
    if (debugSession?.id) {
      if (action !== 'save') {
        setError('单用例工作区不支持全量重新生成，请编辑当前用例或使用 AI 助手定向修改。');
        return;
      }
      try {
        setCaseAction(action);
        const session = await fetchJson(`/api/case-debug-sessions/${debugSession.id}/case-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: casesMarkdown, base_case_revision_id: debugSession.caseRevisionId ?? null }),
        });
        if (!isCurrentModuleSession('cases', sessionVersion)) return;
        applyDebugSession(session, 'exploration');
        setError('');
        setNotice(`已保存 ${session.case?.externalId || '当前用例'} 的隔离草稿，尚未发布到用例库。`);
      } catch (err) {
        if (isCurrentModuleSession('cases', sessionVersion)) setError(`保存单用例草稿失败：${err.message}`);
      } finally {
        setCaseAction('');
      }
      return;
    }
    try {
      setCaseAction(action);
      let item;
      let generationSource = 'ai';
      let fallbackReason = '';
      const requestBody = {
        content: action === 'save' ? casesMarkdown : '',
        asset_mode: assetMode,
        case_ids: action === 'save'
          ? (currentItem.caseIds || []).filter((caseId) => !pendingCaseDeletions.some((item) => item.caseId === caseId))
          : currentItem.caseIds || [],
        deleted_case_ids: action === 'save' ? pendingCaseDeletions.map((item) => item.caseId).filter(Boolean) : [],
        base_cases_revision_id: action === 'save' ? (currentItem.casesRevisionId ?? null) : null,
        assistant_proposals: action === 'save' ? assistantProposalCommits : [],
      };
      if (action === 'save') {
        item = await fetchJson(`/api/work-items/${currentItem.id}/generate-cases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
      } else {
        setPendingCaseDeletions([]);
        setAssistantProposalCommits([]);
        setCasesMarkdown('');
        setNotice('正在连接大模型并流式生成测试用例...');
        await streamNdjson(`/api/work-items/${currentItem.id}/generate-cases/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }, async (event) => {
          if (!isCurrentModuleSession('cases', sessionVersion)) return;
          if (event.type === 'delta') {
            setCasesMarkdown((value) => `${value}${event.delta || ''}`);
          } else if (event.type === 'fallback') {
            generationSource = 'fallback';
            fallbackReason = event.reason || 'AI 生成失败';
            setCasesMarkdown(event.content || '');
            setNotice(`${fallbackReason}，已切换为规则兜底。`);
          } else if (event.type === 'complete') {
            generationSource = event.source || generationSource;
            fallbackReason = event.reason || fallbackReason;
            item = event.item;
            setCasesMarkdown(event.content || event.item?.casesMarkdown || '');
          } else if (event.type === 'error') {
            throw new Error(event.message || '流式生成测试用例失败');
          }
        });
        if (!item) throw new Error('流式生成未返回完成事件');
      }
      if (!isCurrentModuleSession('cases', sessionVersion)) return;
      setError('');
      setCurrentItem(item);
      currentItemRef.current = item;
      applyScriptWorkspace(item);
      setAssetMode(item.assetMode || assetMode);
      setPendingCaseDeletions([]);
      setAssistantProposalCommits([]);
      setCasesMarkdown(item.casesMarkdown || casesMarkdown);
      setNotice(action === 'save'
        ? '人工修改的测试用例已保存，并已同步到脚本工作台。'
        : generationSource === 'fallback'
          ? `${fallbackReason || 'AI 生成失败'}，已保存规则兜底测试用例。`
          : '大模型测试用例已流式生成并保存。');
      await loadAll();
      if (action === 'save') openManualModuleSession('exploration');
    } catch (err) {
      if (!isCurrentModuleSession('cases', sessionVersion)) return;
      setError(`${action === 'save' ? '保存' : '生成'}用例失败：${err.message}`);
    } finally {
      setCaseAction('');
    }
  }

  async function generateScript(action = 'generate') {
    const sessionVersion = captureModuleSession('scripts');
    if (debugSession?.id) {
      if (!['save', 'generate', 'generate-current'].includes(action)) {
        setError('单用例调试仅支持保存或重新生成当前用例脚本。');
        return;
      }
      try {
        setScriptAction(action);
        setDebugAction(action === 'save' ? 'saving-script' : 'generating-script');
        if (action === 'save') {
          const session = await fetchJson(`/api/case-debug-sessions/${debugSession.id}/script-drafts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: scriptContent }),
          });
          if (!isCurrentModuleSession('scripts', sessionVersion)) return;
          applyDebugSession(session, 'execution');
          setNotice(`已保存 ${session.case?.externalId || '当前用例'} 的调试草稿 v${session.currentScriptVersion?.version || '-'}`);
        } else {
          setScriptContent('');
          await streamNdjson(`/api/case-debug-sessions/${debugSession.id}/generate-script/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }, async (event) => {
            if (!isCurrentModuleSession('scripts', sessionVersion)) return;
            if (event.type === 'delta') {
              setScriptContent((value) => `${value}${event.delta || ''}`);
            } else if (event.type === 'case-complete' && event.scriptVersion?.content) {
              setScriptContent(event.scriptVersion.content);
            } else if (event.type === 'complete' && event.debugSession) {
              applyDebugSession(event.debugSession, 'scripts');
            } else if (event.type === 'error') {
              throw new Error(event.message || '单用例脚本生成失败');
            }
          });
          if (!isCurrentModuleSession('scripts', sessionVersion)) return;
          setNotice(`已重新生成 ${debugSession.case?.externalId || '当前用例'} 的调试脚本。`);
        }
        setError('');
      } catch (err) {
        if (!isCurrentModuleSession('scripts', sessionVersion)) return;
        setError(`${action === 'save' ? '保存' : '生成'}单用例脚本失败：${err.message}`);
      } finally {
        setScriptAction('');
        setDebugAction('');
      }
      return;
    }
    if (!currentItem) return;
    const versions = currentItem.scriptVersions || currentItem.scriptSet?.scriptVersions || [];
    const allCaseIds = (currentItem.testCases || []).map((caseItem) => caseItem.id).filter(Boolean);
    if (!allCaseIds.length) allCaseIds.push(...(currentItem.caseIds || []).filter(Boolean));
    const generatedCaseIds = new Set(
      versions.filter((version) => !version.outdated).map((version) => version.caseId).filter(Boolean),
    );
    let targetCaseIds;
    if (['save', 'generate-current'].includes(action)) {
      targetCaseIds = selectedScriptCaseId ? [selectedScriptCaseId] : [];
    } else if (action === 'retry-failed') {
      const failedIds = new Set(scriptGeneration.failedCaseIds || []);
      targetCaseIds = allCaseIds.filter((caseId) => failedIds.has(caseId));
    } else if (action === 'generate-all-fixture') {
      targetCaseIds = allCaseIds;
    } else {
      targetCaseIds = allCaseIds.filter((caseId) => !generatedCaseIds.has(caseId));
    }
    if (!targetCaseIds.length) {
      setNotice(action === 'generate'
        ? '当前工单的全部测试用例均已有脚本，无需重复生成。'
        : '没有可生成的测试用例。');
      return;
    }

    try {
      setScriptAction(action);
      let item;
      let activeCaseId = targetCaseIds[0] || '';
      let completedCount = 0;
      let usedFallback = false;
      let fallbackReason = '';
      let failedCases = [];
      const currentScriptVersion = versions
        .find((version) => version.caseId === selectedScriptCaseId);
      const requestBody = {
        content: '',
        fixture_content: action === 'generate-all-fixture' ? fixtureContent : '',
        asset_mode: assetMode,
        case_ids: targetCaseIds,
        regenerate_fixture: action === 'generate-all-fixture',
      };
      if (action === 'save') {
        if (currentScriptVersion?.id) {
          await fetchJson(`/api/script-versions/${currentScriptVersion.id}/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: scriptContent }),
          });
          item = await fetchJson(`/api/work-items/${currentItem.id}`);
        } else {
          item = await fetchJson(`/api/work-items/${currentItem.id}/generate-script`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...requestBody, content: scriptContent }),
          });
        }
      } else {
        setScriptGeneration((previous) => {
          const statuses = { ...previous.statuses };
          const errors = { ...previous.errors };
          targetCaseIds.forEach((caseId) => {
            statuses[caseId] = 'queued';
            delete errors[caseId];
          });
          return {
            total: targetCaseIds.length,
            caseIds: targetCaseIds,
            currentIndex: 0,
            currentCaseId: '',
            statuses,
            errors,
            failedCaseIds: previous.failedCaseIds.filter((caseId) => !targetCaseIds.includes(caseId)),
          };
        });
        setNotice(`准备按顺序生成 ${targetCaseIds.length} 条独立 Playwright 草稿脚本...`);
        await streamNdjson(`/api/work-items/${currentItem.id}/generate-script/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }, async (event) => {
          if (!isCurrentModuleSession('scripts', sessionVersion)) return;
          if (event.type === 'start') {
            setScriptGeneration((previous) => ({
              ...previous,
              total: event.total || targetCaseIds.length,
              caseIds: event.caseIds || targetCaseIds,
            }));
          } else if (event.type === 'case-start') {
            activeCaseId = event.caseId || activeCaseId;
            setSelectedScriptCaseId(activeCaseId);
            setScriptContent('');
            setScriptGeneration((previous) => ({
              ...previous,
              total: event.total || previous.total,
              currentIndex: event.index || previous.currentIndex,
              currentCaseId: activeCaseId,
              statuses: { ...previous.statuses, [activeCaseId]: 'generating' },
            }));
            setNotice(`正在生成 ${event.externalId || '当前用例'}（${event.index || 1}/${event.total || targetCaseIds.length}）...`);
          } else if (event.type === 'delta') {
            setScriptContent((value) => `${value}${event.delta || ''}`);
          } else if (event.type === 'fallback') {
            usedFallback = true;
            fallbackReason = event.reason || 'AI 生成失败';
            setScriptContent(event.content || '');
            setNotice(`${event.externalId || '当前用例'}：${fallbackReason}，已切换为规则兜底。`);
          } else if (event.type === 'case-complete') {
            completedCount += 1;
            const scriptVersion = event.scriptVersion;
            if (scriptVersion?.content) setScriptContent(scriptVersion.content);
            if (scriptVersion) {
              setCurrentItem((previous) => {
                if (!previous) return previous;
                const previousVersions = previous.scriptVersions || previous.scriptSet?.scriptVersions || [];
                const nextVersions = [...previousVersions.filter((version) => version.caseId !== scriptVersion.caseId), scriptVersion];
                const nextItem = {
                  ...previous,
                  scriptVersions: nextVersions,
                  scriptSet: { ...(previous.scriptSet || {}), scriptVersions: nextVersions },
                };
                currentItemRef.current = nextItem;
                return nextItem;
              });
            }
            setScriptGeneration((previous) => ({
              ...previous,
              statuses: { ...previous.statuses, [event.caseId]: 'completed' },
            }));
            setNotice(`已生成 ${event.externalId || '当前用例'}，准备继续下一条用例...`);
          } else if (event.type === 'case-error') {
            failedCases = [...failedCases, {
              caseId: event.caseId,
              externalId: event.externalId,
              error: event.message || '脚本生成失败',
            }];
            setScriptGeneration((previous) => ({
              ...previous,
              statuses: { ...previous.statuses, [event.caseId]: 'failed' },
              errors: { ...previous.errors, [event.caseId]: event.message || '脚本生成失败' },
              failedCaseIds: previous.failedCaseIds.includes(event.caseId)
                ? previous.failedCaseIds
                : [...previous.failedCaseIds, event.caseId],
            }));
            setNotice(`${event.externalId || '当前用例'} 生成失败，继续处理下一条用例。`);
          } else if (event.type === 'complete') {
            item = event.item;
            failedCases = event.failedCases || failedCases;
            setScriptGeneration((previous) => ({
              ...previous,
              currentCaseId: '',
              currentIndex: event.successfulCaseIds?.length || completedCount,
              failedCaseIds: failedCases.map((caseItem) => caseItem.caseId).filter(Boolean),
            }));
          } else if (event.type === 'error') {
            throw new Error(event.message || '流式生成脚本失败');
          }
        });
        if (!item) throw new Error('流式生成未返回完成事件');
      }
      if (!isCurrentModuleSession('scripts', sessionVersion)) return;
      setError('');
      setCurrentItem(item);
      currentItemRef.current = item;
      setAssetMode(item.assetMode || assetMode);
      applyScriptWorkspace(item, activeCaseId || targetCaseIds[0] || '');
      if (action === 'save') openManualModuleSession('execution');
      if (action === 'save') {
        setNotice('人工修改的草稿脚本已保存。');
      } else if (failedCases.length) {
        setNotice(`脚本生成完成：成功 ${completedCount} 条，失败 ${failedCases.length} 条，可重试失败用例。`);
      } else if (usedFallback) {
        setNotice(`已完成 ${completedCount} 条脚本生成；部分用例因 ${fallbackReason || 'AI 生成失败'} 使用规则兜底。`);
      } else {
        setNotice(`已按顺序生成 ${completedCount} 条独立 Playwright 草稿脚本。`);
      }
    } catch (err) {
      if (!isCurrentModuleSession('scripts', sessionVersion)) return;
      if (action !== 'save') {
        setScriptGeneration((previous) => {
          if (!previous.currentCaseId || previous.statuses[previous.currentCaseId] !== 'generating') return previous;
          const failedCaseIds = previous.failedCaseIds.includes(previous.currentCaseId)
            ? previous.failedCaseIds
            : [...previous.failedCaseIds, previous.currentCaseId];
          return {
            ...previous,
            statuses: { ...previous.statuses, [previous.currentCaseId]: 'failed' },
            errors: { ...previous.errors, [previous.currentCaseId]: '流式连接中断，可重新生成未完成用例' },
            failedCaseIds,
            currentCaseId: '',
          };
        });
      }
      setError(`${action === 'save' ? '保存' : '生成'}脚本失败：${err.message}`);
    } finally {
      setScriptAction('');
    }
  }

  function selectScriptCase(caseId) {
    const versions = currentItem?.scriptVersions || currentItem?.scriptSet?.scriptVersions || [];
    const selected = versions.find((version) => version.caseId === caseId);
    setSelectedScriptCaseId(caseId);
    setScriptContent(selected?.content || '');
  }

  async function saveArtifacts(runId) {
    if (!currentItem || !runId) return;
    try {
      setArtifactsSaving(true);
      const refreshedItem = await fetchJson(`/api/work-items/${currentItem.id}`);
      setCurrentItem(refreshedItem);
      const item = await fetchJson(`/api/work-items/${currentItem.id}/save-artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          report_content: '',
        }),
      });
      setError('');
      setCurrentItem(item);
      openModule('delivery');
      const nextScope = { project_id: item.projectId || '', work_item_id: item.id };
      const nextFilters = emptyCaseReportFilters();
      setReportTab('case');
      setReportScopeFilters(nextScope);
      setCaseReportFilters(nextFilters);
      await loadCaseReports({ ...nextScope, ...nextFilters }, 1);
      await loadAll();
      setNotice('已保存验证通过的测试用例、脚本和报告。');
    } catch (err) {
      setError(`保存交付物失败：${err.message}`);
    } finally {
      setArtifactsSaving(false);
    }
  }

  async function runCurrentItem() {
    if (!currentItem) return;
    const sessionVersion = captureModuleSession('execution');
    ignoredExecutionRunIdRef.current = currentItem.latestRunId || '';
    executionBrowserSocketRef.current?.close();
    executionBrowserSocketRef.current = null;
    setExecutionLiveConnected(false);
    setExecutionBrowserStatus('Connecting');
    setExecutionBrowserDetail('');
    setLogs([]);
    try {
      setExecutionStarting(true);
      if (debugSession?.id) {
        setDebugAction('running');
        const session = await fetchJson(`/api/case-debug-sessions/${debugSession.id}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            script_version_id: debugSession.currentScriptVersionId || '',
            environment_id: executionEnvironmentId,
            execution_scope: debugSession.executionPolicy === 'strict-single' ? 'single' : debugExecutionScope,
          }),
        });
        if (!isCurrentModuleSession('execution', sessionVersion)) return;
        applyDebugSession(session, 'execution');
        setError('');
        setNotice(`已启动 ${session.case?.externalId || '当前用例'} 的单用例执行。`);
        return;
      }
      const item = await fetchJson(`/api/work-items/${currentItem.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment_id: executionEnvironmentId }),
      });
      if (!isCurrentModuleSession('execution', sessionVersion)) return;
      setError('');
      setCurrentItem(item);
      openManualModuleSession('execution');
      if (item.latestRunId) {
        const runPayload = await fetchJson(`/api/runs/${item.latestRunId}`).catch(() => null);
        if (runPayload) {
          setRuns((items) => {
            const exists = items.some((run) => run.id === runPayload.id);
            return exists ? items.map((run) => (run.id === runPayload.id ? runPayload : run)) : [runPayload, ...items];
          });
          const runLogs = await fetchJson(`/api/runs/${item.latestRunId}/logs`).catch(() => []);
          setLogs(runLogs.items || runLogs);
          openHealingForFailedExecution(runPayload);
        }
      }
      await loadAll();
    } catch (err) {
      if (!isCurrentModuleSession('execution', sessionVersion)) return;
      setError(`执行任务失败：${err.message}`);
    } finally {
      setExecutionStarting(false);
      setDebugAction('');
    }
  }

  async function recordHealing() {
    if (!currentItem) return;
    const sessionVersion = captureModuleSession('healing');
    try {
      setHealingStarting(true);
      resetHealingDiagnosticLogs();
      resetHealingLiveState();
      const healingPath = debugSession?.id
        ? `/api/case-debug-sessions/${debugSession.id}/self-heal`
        : `/api/work-items/${currentItem.id}/self-heal`;
      const payload = await fetchJson(healingPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment_id: healingEnvironmentId }),
      });
      if (!isCurrentModuleSession('healing', sessionVersion)) return;
      setError('');
      setNotice('人工自愈已启动：系统将自动生成修复脚本并最多重跑三轮。');
      setHealingRun(payload);
      setCurrentItem((item) => (item ? { ...item, status: 'healing', stage: '自愈诊断', latestHealingRun: payload } : item));
    } catch (err) {
      if (!isCurrentModuleSession('healing', sessionVersion)) return;
      setHealingStarting(false);
      setError(`启动自愈失败：${err.message}`);
    }
  }

  async function syncDebugCase() {
    if (!debugSession?.id) return;
    try {
      setDebugAction('syncing');
      const session = await fetchJson(`/api/case-debug-sessions/${debugSession.id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_case_updated_at: debugSession.case?.updatedAt || '' }),
      });
      applyDebugSession(session, 'scripts');
      setNotice('已同步最新用例，请重新保存脚本并执行验证。');
      setError('');
    } catch (err) {
      setError(`同步最新用例失败：${err.message}`);
    } finally {
      setDebugAction('');
    }
  }

  async function publishDebugCase() {
    if (!debugSession?.id) return;
    try {
      setDebugAction('publishing');
      const session = await fetchJson(`/api/case-debug-sessions/${debugSession.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: debugSession.latestRunId || '',
          script_version_id: debugSession.currentScriptVersionId || '',
        }),
      });
      setDebugSession(session);
      updateDebugSessionUrl(null);
      await refreshCaseAssets();
      setDebugSession(null);
      openModule('case-management');
      setNotice(`已发布 ${session.case?.externalId || '当前用例'} 的用例、探索证据和验证脚本，其他用例未变更。`);
      setError('');
    } catch (err) {
      setError(`发布单用例脚本失败：${err.message}`);
    } finally {
      setDebugAction('');
    }
  }

  function updateElement(index, key, value) {
    const previousElement = exploration.elements[index];
    const nextElement = previousElement ? { ...previousElement, [key]: value } : null;
    setExploration((state) => ({
      ...state,
      elements: state.elements.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    }));
    if (!nextElement) return;
    const previousKey = elementKey(previousElement);
    const nextKey = elementKey(nextElement);
    if (key === 'confirmed' || previousKey !== nextKey) {
      setConfirmedElementKeys((previous) => {
        const next = new Set(previous);
        if (previousKey) next.delete(previousKey);
        if (nextElement.confirmed && nextKey) next.add(nextKey);
        return next;
      });
    }
  }

  function addElement() {
    setExploration((state) => ({
      ...state,
      elements: [...state.elements, { area: '', name: '', locatorType: 'text', locatorValue: '', source: '', confirmed: false }],
    }));
  }

  function setAllElementsConfirmed(confirmed) {
    setExploration((state) => ({
      ...state,
      elements: state.elements.map((item) => ({ ...item, confirmed })),
    }));
    setConfirmedElementKeys((previous) => {
      const next = new Set(previous);
      exploration.elements.map(elementKey).filter(Boolean).forEach((key) => {
        if (confirmed) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }

  if (!authChecked) {
    return (
      <main className="auth-shell" data-theme={themeId}>
        <section className="auth-panel auth-layout auth-loading-layout" aria-label="检查登录状态">
          <AuthWorkspaceHero />
          <div className="auth-card auth-loading-card">
            <div className="auth-card-header">
              <span className="auth-kicker">SESSION CHECK</span>
              <h1>自动化测试平台</h1>
              <p>正在检查登录状态...</p>
            </div>
            <div className="auth-loading-indicator" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!authUser) {
    return (
      <AuthGate
        mode={authMode}
        setMode={setAuthMode}
        clearAuthFeedback={() => {
          setAuthError('');
          setAuthMessage('');
        }}
        submitLogin={submitLogin}
        submitRegister={submitRegister}
        submitting={authSubmitting}
        error={authError}
        message={authMessage}
        themeId={themeId}
      />
    );
  }

  return (
    <main className={sidebarCollapsed ? 'platform-shell sidebar-collapsed' : 'platform-shell'} data-theme={themeId}>
      <aside className={sidebarCollapsed ? 'app-sidebar collapsed' : 'app-sidebar'}>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? '展开左侧导航' : '收起左侧导航'}
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <div className="brand-mark">
          <span className="brand-logo-wrap"><AuthPlatformLogo /></span>
          {!sidebarCollapsed && (
            <div>
              <strong> Web 智能测试平台</strong>
            </div>
          )}
        </div>
        <nav className={sidebarCollapsed ? 'collapsed-nav' : undefined} aria-label="平台模块">
          {sidebarCollapsed ? (
            visibleNavGroups.flatMap((group) => group.moduleIds).map((moduleId) => {
              const module = MODULE_LOOKUP[moduleId];
              const Icon = module.icon;
              const label = module.navLabel || module.label;
              const active = activeModule === module.id;
              return (
                <button
                  type="button"
                  key={module.id}
                  className={active ? 'nav-icon-item active' : 'nav-icon-item'}
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  title={label}
                  onClick={() => openModule(module.id)}
                >
                  <Icon size={19} />
                </button>
              );
            })
          ) : (
            visibleNavGroups.map((group) => {
              const GroupIcon = group.icon;
              const expanded = expandedNavGroups.has(group.id);
              const activeGroup = group.id === activeNavGroupId;
              return (
                <section className={activeGroup ? 'nav-group active-group' : 'nav-group'} aria-label={group.title} key={group.id}>
                  <button
                    type="button"
                    className="nav-parent"
                    aria-expanded={expanded}
                    onClick={() => toggleNavGroup(group.id)}
                  >
                    <GroupIcon size={18} />
                    <span>{group.title}</span>
                    <ChevronDown size={16} className={expanded ? 'nav-chevron open' : 'nav-chevron'} />
                  </button>
                  {expanded && (
                    <div className="nav-group-items">
                      {group.moduleIds.map((moduleId) => {
                        const module = MODULE_LOOKUP[moduleId];
                        const Icon = module.icon;
                        return (
                          <button
                            type="button"
                            key={module.id}
                            className={activeModule === module.id ? 'nav-item active' : 'nav-item'}
                            onClick={() => openModule(module.id)}
                          >
                            <Icon size={18} />
                            <span className="nav-label">{module.navLabel || module.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </nav>
      </aside>

      <section className="app-main">
        <header className="command-bar">
          <div className="command-title-row">
            <div>
              <h1>{MODULE_LOOKUP[activeModule]?.label}</h1>
            </div>
            <div className="command-metrics">
              <TopbarActions
                health={health}
                error={error}
                notice={notice}
                latestRun={latestRun || runs[0] || null}
                automationStatus={automationStatus}
                automationStage={automationActiveStage || automationFlow?.stage || ''}
                themes={THEMES}
                themeId={themeId}
                setThemeId={setThemeId}
                user={authUser}
                flowStages={FLOW}
                roleLabels={ROLE_LABELS}
                formatStatus={statusLabel}
                requestJson={fetchJson}
                onError={setError}
                onNotice={setNotice}
                logout={logout}
              />
            </div>
          </div>
          <ModuleTabs
            tabs={openModuleTabs}
            activeModule={activeModule}
            openModule={openModule}
            closeModuleTab={closeModuleTab}
            closeCurrentTab={closeCurrentTab}
            closeOtherTabs={closeOtherTabs}
            closeAllTabs={closeAllTabs}
            closeRightTabs={closeRightTabs}
            closeLeftTabs={closeLeftTabs}
            menuOpen={tabMenuOpen}
            setMenuOpen={setTabMenuOpen}
            menuRef={tabMenuRef}
            tabsRef={moduleTabsRef}
            activeTabRef={activeModuleTabRef}
          />
        </header>

        {error && (
          <section className="error-banner" role="alert" data-testid="error-banner">
            <XCircle size={18} />
            <span>{error}</span>
            <button type="button" className="banner-close-button" aria-label="关闭错误提示" onClick={clearErrorBanner}>
              <X size={15} />
            </button>
          </section>
        )}
        {notice && (
          <section className="notice-banner" role="status" data-testid="notice-banner">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
            <button type="button" className="banner-close-button" aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={15} />
            </button>
          </section>
        )}

        <section className="module-layout">
          <div className="module-canvas">
            {showWorkflowContext && <WorkflowContextBar activeModule={activeModule} item={manualPageItem(activeModule)} latestRun={detachedManualModules.has(activeModule) ? null : latestRun} />}
            {activeModule === 'overview' && (
              <Overview
                projects={projects}
                dashboardSummary={dashboardSummary}
                dashboardScopeProjectId={dashboardScopeProjectId}
                setDashboardScopeProjectId={(projectId) => {
                  setDashboardScopeProjectId(projectId);
                  loadDashboardSummary(projectId).catch((err) => setError(`刷新统计看板失败：${err.message}`));
                }}
                dashboardLoading={dashboardLoading}
                openingSuiteRunId={openingSuiteRunId}
                openSuiteRun={openDashboardSuiteRun}
                workItems={workItems}
                selectWorkItem={selectWorkItem}
              />
            )}
            {activeModule === 'ai-config' && <AiConfigModule key={health.ai?.activeProfileId || 'new-ai-config'} health={health} setHealth={setHealth} requestJson={fetchJson} onError={setError} onNotice={setNotice} />}
            {activeModule === 'user-management' && <UserManagement users={users} loadUsers={loadUsers} createUser={createUser} updateUser={updateUser} deleteUser={deleteUser} resetUserPassword={resetUserPassword} message={userActionMessage} />}
            {activeModule === 'feature-menus' && <FeatureMenus projects={projects} currentProjectId={currentProjectId} setCurrentProjectId={setCurrentProjectId} features={features} featureTree={featureTree} refreshFeatures={refreshFeatures} fetchJson={fetchJson} setNotice={setNotice} setError={setError} />}
            {activeModule === 'projects' && <Projects projects={projects} setProjects={setProjects} currentProjectId={currentProjectId} setCurrentProjectId={setCurrentProjectId} workItems={workItems} testCases={testCases} deliverables={deliverables} suiteRuns={suiteRuns} fetchJson={fetchJson} setNotice={setNotice} setError={setError} canManageAssets={canManageAssets} />}
            {activeModule === 'test-suites' && (
              <TestSuites
                suites={suites}
                testCases={testCases}
                selectedSuiteId={selectedSuiteId}
                suiteForm={suiteForm}
                setSuiteForm={setSuiteForm}
                suiteView={suiteView}
                suiteRouteLoading={suiteRouteLoading}
                suiteRouteError={suiteRouteError}
                suiteRouteRecord={suiteRouteRecord}
                selectSuite={selectSuite}
                navigateSuite={navigateSuite}
                beginCreateSuite={beginCreateSuite}
                saveSuite={saveSuite}
                notifySuiteEditCancelled={() => {
                  setNotice('已取消修改内容');
                  setError('');
                }}
                deleteSuite={deleteSuite}
                runSuite={(suiteId, environmentId) => runSuite(suiteId, { navigateToMonitor: true, environmentId })}
                projects={projects}
                currentProjectId={currentProjectId}
                suiteCaseProjects={suiteCaseProjects}
                canManageAssets={canManageAssets}
                canExecute={canExecute}
              />
            )}
            {activeModule === 'execution-monitor' && (
              <ExecutionMonitor
                suiteRuns={suiteRuns}
                projects={projects}
                testExecutionProjectId={testExecutionProjectId}
                suiteNameFilter={monitorSuiteNameFilter}
                applyQuery={applyMonitorQuery}
                selectedRunId={monitorSuiteRunId}
                setSelectedRunId={setMonitorSuiteRunId}
                selectedRun={monitorSuiteRunDetail}
                logs={monitorLogs}
                logLevel={monitorLogLevel}
                setLogLevel={setMonitorLogLevel}
                monitorBrowserRun={monitorBrowserRun}
                monitorBrowserCase={monitorBrowserTarget.caseItem}
                monitorBrowserStatus={monitorBrowserStatus}
                monitorBrowserDetail={monitorBrowserDetail}
                monitorBrowserLiveConnected={monitorBrowserLiveConnected}
                monitorBrowserHasFrame={monitorBrowserHasFrame}
                monitorBrowserCanvasRef={monitorBrowserCanvasRef}
                browserPreviewEnabled={monitorBrowserPreviewEnabled}
                setBrowserPreviewEnabled={setMonitorBrowserPreviewEnabled}
                selectedCaseRunId={monitorBrowserTarget.runId}
                selectCaseRun={selectMonitorCaseRun}
                deleteSuiteRun={deleteSuiteRun}
              />
            )}
            {activeModule === 'automation-flow' && (
              <AutomationFlow
                projects={projects}
                selectedProjectId={automationProjectId}
                selectedFeatureId={automationFeatureId}
                featureTree={automationFeatureTree}
                featureOptions={automationFeatureOptions}
                onProjectChange={handleAutomationProjectChange}
                onFeatureChange={setAutomationFeatureId}
                requirement={automationRequirement}
                setRequirement={setAutomationRequirement}
                flow={automationFlow}
                logs={automationLogs}
                flowArtifacts={automationArtifacts}
                status={automationStatus}
                activeStage={automationActiveStage}
                liveConnected={automationLiveConnected}
                browserStatus={automationBrowserStatus}
                browserStatusDetail={automationBrowserDetail}
                browserLiveConnected={automationBrowserLiveConnected}
                browserSessionId={automationBrowserSessionId}
                browserMode={automationBrowserMode}
                browserHasFrame={automationBrowserHasFrame}
                browserPreviewEnabled={automationBrowserPreviewEnabled}
                setBrowserPreviewEnabled={setAutomationBrowserPreviewEnabled}
                historyItems={automationFlowHistory}
                historyLoading={automationHistoryLoading}
                historyError={automationHistoryError}
                restoringHistoryId={automationHistoryRestoringId}
                browserCanvasRef={automationBrowserCanvasRef}
                sendBrowserCommand={sendAutomationBrowserCommand}
                handleBrowserClick={handleAutomationBrowserClick}
                handleBrowserMove={handleAutomationBrowserMove}
                handleBrowserWheel={handleAutomationBrowserWheel}
                handleBrowserKeyDown={handleAutomationBrowserKeyDown}
                loadHistory={loadAutomationFlowHistory}
                restoreHistory={restoreAutomationFlow}
                startFlow={startAutomationFlow}
                stopFlow={stopAutomationFlow}
                stoppingFlow={automationStopping}
                retryExploration={retryAutomationExploration}
                retryingExploration={automationRetrying}
                clearFlow={clearAutomationFlow}
                openManualWorkbench={openAutomationFailureInManualWorkbench}
                logRef={automationLogRef}
                resetKey={automationResetKey}
                canRunFlow={canExecute}
              />
            )}
            {activeModule === 'requirements' && (
              <Requirements
                projects={projects}
                selectedProjectId={requirementProjectId}
                selectedFeatureId={requirementFeatureId}
                featureTree={requirementFeatureTree}
                featureOptions={requirementFeatureOptions}
                onProjectChange={(projectId) => {
                  setRequirementProjectId(projectId);
                  setRequirementFeatureId('');
                  setRequirementDirty(true);
                }}
                onFeatureChange={(featureId) => {
                  setRequirementFeatureId(featureId);
                  setRequirementDirty(true);
                }}
                form={requirementForm}
                setForm={(nextForm) => {
                  setRequirementForm(nextForm);
                  setRequirementDirty(true);
                }}
                createWorkItem={createWorkItem}
                updateWorkItem={updateCurrentWorkItem}
                startNewRequirement={startNewRequirement}
                item={manualPageItem('requirements')}
                analyzing={analyzingRequirement}
                setActiveModule={openManualModuleSession}
                canCreate={canCreateDrafts}
              />
            )}
            {activeModule === 'case-management' && <CaseManagement projects={projects} suiteCaseProjects={suiteCaseProjects} testCases={testCases} features={features} selectedCaseIds={selectedCaseIds} toggleCaseSelection={toggleCaseSelection} setAllVisibleCasesSelected={setAllVisibleCasesSelected} runSelectedCases={runSelectedCases} startCaseDebugBatch={startCaseDebugBatch} debugBatchLoading={debugBatchLoading} setActiveModule={openModule} updateCase={updateCase} deleteCase={deleteCase} deleteSelectedCases={deleteSelectedCases} loadScriptVersion={loadScriptVersion} scriptEditor={scriptEditor} openScriptEditor={openScriptEditor} closeScriptEditor={closeScriptEditor} updateScriptEditorContent={updateScriptEditorContent} saveScriptEditorDraft={saveScriptEditorDraft} enterCaseDebug={enterCaseDebug} debugSessionLoading={debugSessionLoading} canManageAssets={canManageAssets} canExecute={canExecute} canEditScripts={canCreateDrafts} fetchJson={fetchJson} reloadData={loadAll} setNotice={setNotice} setGlobalError={setError} openImportedVerification={async (result) => { const workItemId = result.workItemId || result.workItem?.id || ''; if (!workItemId) throw new Error('导入验证未返回系统工单'); await selectWorkItem(workItemId); openManualModuleSession('execution'); }} />}
            {activeModule === 'exploration' && <Exploration item={manualPageItem('exploration')} exploration={exploration} explorationRun={explorationRun} explorationLogs={explorationLogs} browserStatus={browserStatus} browserStatusDetail={browserStatusDetail} liveConnected={liveConnected} browserCanvasRef={browserCanvasRef} browserPreviewEnabled={explorationBrowserPreviewEnabled} setBrowserPreviewEnabled={setExplorationBrowserPreviewEnabled} setExploration={setExploration} updateElement={updateElement} addElement={addElement} setAllElementsConfirmed={setAllElementsConfirmed} saveExploration={saveExploration} runExploration={runExploration} exploring={exploring} saving={explorationSaving} sendBrowserCommand={sendBrowserCommand} handleBrowserClick={handleBrowserClick} handleBrowserMove={handleBrowserMove} handleBrowserWheel={handleBrowserWheel} handleBrowserKeyDown={handleBrowserKeyDown} debugSession={detachedManualModules.has('exploration') ? null : debugSession} exitCaseDebug={exitCaseDebug} canEdit={canCreateDrafts} clearPageData={() => clearManualPageData('exploration')} clearing={manualClearAction === 'exploration'} />}
            {activeModule === 'cases' && <Cases item={manualPageItem('cases')} casesMarkdown={casesMarkdown} setCasesMarkdown={setCasesMarkdown} pendingDeletions={pendingCaseDeletions} setPendingDeletions={setPendingCaseDeletions} assistantProposalCommits={assistantProposalCommits} setAssistantProposalCommits={setAssistantProposalCommits} generateCases={generateCases} action={caseAction} assetMode={assetMode} setAssetMode={setAssetMode} debugSession={detachedManualModules.has('cases') ? null : debugSession} exitCaseDebug={exitCaseDebug} canEdit={canCreateDrafts} aiConfigured={Boolean(health.ai?.configured)} clearPageData={() => clearManualPageData('cases')} clearing={manualClearAction === 'cases'} />}
            {activeModule === 'scripts' && <Scripts item={manualPageItem('scripts')} latestRun={detachedManualModules.has('scripts') ? null : workspaceLatestRun} scriptContent={scriptContent} setScriptContent={setScriptContent} selectedCaseId={selectedScriptCaseId} onSelectCase={selectScriptCase} fixtureContent={fixtureContent} setFixtureContent={setFixtureContent} generateScript={generateScript} action={scriptAction} generation={scriptGeneration} assetMode={assetMode} debugSession={detachedManualModules.has('scripts') ? null : debugSession} debugBatch={detachedManualModules.has('scripts') ? null : debugBatch} selectBatchDebugItem={selectBatchDebugItem} cancelCaseDebugBatch={cancelCaseDebugBatch} debugAction={debugAction} aiConfigured={Boolean(health.ai?.configured)} syncDebugCase={syncDebugCase} exitCaseDebug={exitCaseDebug} canEdit={canCreateDrafts} clearPageData={() => clearManualPageData('scripts')} clearing={manualClearAction === 'scripts'} />}
            {activeModule === 'execution' && <Execution latestRun={detachedManualModules.has('execution') ? null : workspaceLatestRun} logs={logs} screenshot={screenshot} runCurrentItem={runCurrentItem} starting={executionStarting} currentItem={manualPageItem('execution')} projects={projects} environmentId={executionEnvironmentId} setEnvironmentId={setExecutionEnvironmentId} debugSession={detachedManualModules.has('execution') ? null : debugSession} debugExecutionScope={debugExecutionScope} setDebugExecutionScope={setDebugExecutionScope} debugAction={debugAction} publishDebugCase={publishDebugCase} exitCaseDebug={exitCaseDebug} browserStatus={executionBrowserStatus} browserStatusDetail={executionBrowserDetail} liveConnected={executionLiveConnected} browserCanvasRef={executionBrowserCanvasRef} browserPreviewEnabled={executionBrowserPreviewEnabled} setBrowserPreviewEnabled={setExecutionBrowserPreviewEnabled} canExecute={canExecute} saveArtifacts={saveArtifacts} savingArtifacts={artifactsSaving} canSaveArtifacts={canSaveArtifacts} clearPageData={() => clearManualPageData('execution')} clearing={manualClearAction === 'execution'} />}
            {activeModule === 'healing' && <Healing item={manualPageItem('healing')} latestRun={detachedManualModules.has('healing') ? null : workspaceLatestRun} healingRun={detachedManualModules.has('healing') ? null : healingRun} healingStarting={healingStarting} aiConfigured={Boolean(health.ai?.configured)} liveRun={detachedManualModules.has('healing') ? null : healingLiveRun} logs={[...healingDiagnosticLogs, ...healingLogs].sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))} projects={projects} environmentId={healingEnvironmentId} setEnvironmentId={setHealingEnvironmentId} debugSession={detachedManualModules.has('healing') ? null : debugSession} debugAction={debugAction} publishDebugCase={publishDebugCase} exitCaseDebug={exitCaseDebug} browserStatus={healingBrowserStatus} browserStatusDetail={healingBrowserDetail} liveConnected={healingLiveConnected} browserCanvasRef={healingBrowserCanvasRef} browserPreviewEnabled={healingBrowserPreviewEnabled} setBrowserPreviewEnabled={setHealingBrowserPreviewEnabled} recordHealing={recordHealing} canEdit={canCreateDrafts} saveArtifacts={saveArtifacts} savingArtifacts={artifactsSaving} canSaveArtifacts={canSaveArtifacts} clearPageData={() => clearManualPageData('healing')} clearing={manualClearAction === 'healing'} />}
            {activeModule === 'delivery' && (
              <Delivery
                projects={projects}
                workItems={workItems}
                reportTab={reportTab}
                setReportTab={setReportTab}
                reportScopeFilters={reportScopeFilters}
                setReportScopeFilters={setReportScopeFilters}
                caseReports={caseReports}
                caseReportFilters={caseReportFilters}
                setCaseReportFilters={setCaseReportFilters}
                loadCaseReports={loadCaseReports}
                manualReports={manualReports}
                manualReportFilters={manualReportFilters}
                setManualReportFilters={setManualReportFilters}
                loadManualReports={loadManualReports}
                fetchJson={fetchJson}
                setNotice={setNotice}
                setError={setError}
                canManageAssets={canManageAssets}
              />
            )}
          </div>
        </section>
      </section>
      <GlobalAssistant
        ai={health.ai}
        userRole={currentRole}
        onOpenAIConfig={() => openModule('ai-config')}
      />
    </main>
  );
}

function ModuleTabs({
  tabs,
  activeModule,
  openModule,
  closeModuleTab,
  closeCurrentTab,
  closeOtherTabs,
  closeAllTabs,
  closeRightTabs,
  closeLeftTabs,
  menuOpen,
  setMenuOpen,
  menuRef,
  tabsRef,
  activeTabRef,
}) {
  const activeIndex = tabs.indexOf(activeModule);
  const hasClosableTabs = tabs.some((moduleId) => moduleId !== HOME_MODULE_ID);
  const hasOtherClosableTabs = tabs.some((moduleId) => moduleId !== HOME_MODULE_ID && moduleId !== activeModule);
  const hasRightClosableTabs = activeIndex >= 0 && tabs.some((moduleId, index) => index > activeIndex && moduleId !== HOME_MODULE_ID);
  const hasLeftClosableTabs = activeIndex >= 0 && tabs.some((moduleId, index) => index < activeIndex && moduleId !== HOME_MODULE_ID);

  const actions = [
    { label: '关闭当前', onClick: closeCurrentTab, disabled: activeModule === HOME_MODULE_ID },
    { label: '关闭其他', onClick: closeOtherTabs, disabled: !hasOtherClosableTabs },
    { label: '关闭所有', onClick: closeAllTabs, disabled: !hasClosableTabs },
    { label: '关闭右侧', onClick: closeRightTabs, disabled: !hasRightClosableTabs },
    { label: '关闭左侧', onClick: closeLeftTabs, disabled: !hasLeftClosableTabs },
  ];

  return (
    <div className="module-tab-strip" aria-label="已打开菜单页签">
      <div className="module-tabs" role="tablist" aria-label="已打开菜单" ref={tabsRef}>
        {tabs.map((moduleId) => {
          const module = MODULE_LOOKUP[moduleId];
          if (!module) return null;
          const Icon = module.icon;
          const active = moduleId === activeModule;
          return (
            <div className={active ? 'module-tab active' : 'module-tab'} key={moduleId} ref={active ? activeTabRef : null}>
              <button
                type="button"
                className="module-tab-main"
                role="tab"
                aria-selected={active}
                aria-label={module.label}
                onClick={() => openModule(moduleId)}
              >
                <Icon size={15} />
                <span>{module.label}</span>
              </button>
              {moduleId !== HOME_MODULE_ID && (
                <button
                  type="button"
                  className="module-tab-close"
                  aria-label={`关闭${module.label}`}
                  onClick={() => closeModuleTab(moduleId)}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="tab-more" ref={menuRef}>
        <button
          type="button"
          className={menuOpen ? 'tab-more-button active' : 'tab-more-button'}
          aria-label="页签更多操作"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MoreHorizontal size={18} />
        </button>
        {menuOpen && (
          <div className="tab-more-menu" role="menu" aria-label="页签关闭操作">
            {actions.map((action) => (
              <button
                type="button"
                role="menuitem"
                key={action.label}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserManagement({ users, loadUsers, createUser, updateUser, deleteUser, resetUserPassword, message }) {
  const emptyForm = { username: '', display_name: '', role: 'viewer', status: 'active' };
  const [createForm, setCreateForm] = useState(emptyForm);
  const createUserFormRef = useRef(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [detailMode, setDetailMode] = useState('view');
  const [editForm, setEditForm] = useState({ display_name: '', role: 'viewer', status: 'active' });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const selectedUser = users.find((user) => user.id === selectedUserId) || users[0] || null;
  const visibleUsers = users.filter((user) => {
    const haystack = `${user.username} ${user.displayName || ''}`.toLowerCase();
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesQuery && matchesStatus && matchesRole;
  });
  const protectedAdmin = selectedUser?.username === 'admin';
  const filteredEmpty = Boolean(users.length && !visibleUsers.length);

  useEffect(() => {
    if (!users.length) {
      setSelectedUserId('');
      setDetailMode('view');
      return;
    }
    if (!selectedUserId || !users.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(users[0].id);
      setDetailMode('view');
    }
  }, [users, selectedUserId]);

  async function submitCreateUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await createUser({ ...createForm, password: String(data.get('password') || '') });
    if (created) {
      setCreateForm(emptyForm);
      form.reset();
      setSelectedUserId(created.id);
      setDetailMode('view');
    }
  }

  function beginEdit(user) {
    setSelectedUserId(user.id);
    setDetailMode('edit');
    setEditForm({
      display_name: user.displayName || user.username,
      role: user.role,
      status: user.status,
    });
  }

  async function saveEdit() {
    if (!selectedUser) return;
    const updated = await updateUser(selectedUser.id, editForm);
    if (updated) {
      setSelectedUserId(updated.id);
      setDetailMode('view');
    }
  }

  async function updateSelectedUser(patch) {
    if (!selectedUser) return;
    const updated = await updateUser(selectedUser.id, patch);
    if (updated) setSelectedUserId(updated.id);
  }

  function confirmDelete(user) {
    if (window.confirm(`确认删除用户 ${user.username}？删除后该账号将无法登录。`)) {
      deleteUser(user.id);
      setSelectedUserId((currentId) => (currentId === user.id ? '' : currentId));
      setDetailMode('view');
    }
  }

  function selectUser(user) {
    setSelectedUserId(user.id);
    setDetailMode('view');
  }

  function renderStatusBadge(status) {
    return <span className={`user-status-badge ${status}`}>{STATUS_LABELS[status] || status}</span>;
  }

  function renderListRow(user) {
    const isSelected = user.id === selectedUser?.id && detailMode !== 'create';
    const rowProtected = user.username === 'admin';
    return (
      <button
        type="button"
        className={isSelected ? 'user-list-row selected' : 'user-list-row'}
        onClick={() => selectUser(user)}
        key={user.id}
      >
        <div className="user-list-identity">
          <strong>{user.displayName || user.username}</strong>
          <span>{user.username}</span>
        </div>
        <span>{ROLE_LABELS[user.role] || user.role}</span>
        {renderStatusBadge(user.status)}
        <span>{formatDateTime(user.lastLoginAt)}</span>
        <span>{formatDateTime(user.updatedAt)}</span>
        <span>{rowProtected ? '受保护' : '-'}</span>
      </button>
    );
  }

  function renderCreatePanel() {
    return (
      <form className="user-detail-form" onSubmit={submitCreateUser} ref={createUserFormRef}>
        <div className="panel-heading">
          <h3>新建用户</h3>
          <button type="button" className="ghost-button compact" onClick={() => setDetailMode('view')}>取消</button>
        </div>
        <div className="form-grid compact">
          <label className="field wide">
            <span>账号</span>
            <input value={createForm.username} onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })} />
          </label>
          <label className="field wide">
            <span>昵称</span>
            <input value={createForm.display_name} onChange={(event) => setCreateForm({ ...createForm, display_name: event.target.value })} />
          </label>
          <label className="field wide">
            <span>初始密码</span>
            <input name="password" type="password" autoComplete="new-password" />
          </label>
          <label className="field wide">
            <span>角色</span>
            <select value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value })}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label className="field wide">
            <span>状态</span>
            <select value={createForm.status} onChange={(event) => setCreateForm({ ...createForm, status: event.target.value })}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <button type="submit" className="primary-action user-detail-submit">
          <Plus size={17} />
          创建用户
        </button>
      </form>
    );
  }

  function renderDetailPanel() {
    if (detailMode === 'create') return renderCreatePanel();
    if (!selectedUser) {
      return <p className="muted">暂无用户。</p>;
    }
    if (detailMode === 'edit') {
      return (
        <div className="user-detail-form">
          <div className="panel-heading">
            <h3>编辑用户</h3>
            <button type="button" className="ghost-button compact" onClick={() => setDetailMode('view')}>取消</button>
          </div>
          <div className="form-grid compact">
            <label className="field wide">
              <span>账号</span>
              <input value={selectedUser.username} disabled />
            </label>
            <label className="field wide">
              <span>昵称</span>
              <input value={editForm.display_name} onChange={(event) => setEditForm({ ...editForm, display_name: event.target.value })} />
            </label>
            <label className="field wide">
              <span>角色</span>
              <select value={editForm.role} disabled={protectedAdmin} onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}>
                {Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label className="field wide">
              <span>状态</span>
              <select value={editForm.status} disabled={protectedAdmin} onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          </div>
          {protectedAdmin && <div className="user-protected-note">默认管理员受保护，不能禁用、删除或降级。</div>}
          <button type="button" className="primary-action user-detail-submit" onClick={saveEdit}>
            <Save size={17} />
            保存修改
          </button>
        </div>
      );
    }
    return (
      <div className="user-detail-view">
        <div className="panel-heading">
          <h3>用户详情</h3>
          {renderStatusBadge(selectedUser.status)}
        </div>
        <div className="user-detail-identity">
          <strong>{selectedUser.displayName || selectedUser.username}</strong>
          <span>{selectedUser.username}</span>
          {protectedAdmin && <b>默认管理员受保护</b>}
        </div>
        <dl className="user-detail-meta">
          <div><dt>角色</dt><dd>{ROLE_LABELS[selectedUser.role] || selectedUser.role}</dd></div>
          <div><dt>状态</dt><dd>{STATUS_LABELS[selectedUser.status] || selectedUser.status}</dd></div>
          <div><dt>最近登录</dt><dd>{formatDateTime(selectedUser.lastLoginAt)}</dd></div>
          <div><dt>创建时间</dt><dd>{formatDateTime(selectedUser.createdAt)}</dd></div>
          <div><dt>更新时间</dt><dd>{formatDateTime(selectedUser.updatedAt)}</dd></div>
        </dl>
        {protectedAdmin && <div className="user-protected-note">默认管理员账号用于系统兜底登录，危险操作已禁用。</div>}
        <div className="user-detail-actions">
          {selectedUser.status !== 'active' && (
            <button type="button" className="ghost-button" onClick={() => updateSelectedUser({ status: 'active' })}>启用</button>
          )}
          {selectedUser.status !== 'disabled' && (
            <button type="button" className="ghost-button danger-button" onClick={() => updateSelectedUser({ status: 'disabled' })} disabled={protectedAdmin}>禁用</button>
          )}
          <button type="button" className="ghost-button" onClick={() => beginEdit(selectedUser)}>
            <Edit3 size={16} />
            编辑
          </button>
          <button type="button" className="ghost-button" onClick={() => resetUserPassword(selectedUser.id)}>重置密码</button>
          <button type="button" className="ghost-button danger-button" onClick={() => confirmDelete(selectedUser)} disabled={protectedAdmin}>
            <Trash2 size={16} />
            删除
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="module-section" aria-label="用户管理">
      <div className="section-header">
        <div>
          <h2>用户管理</h2>
          <p>新增账号，审核注册用户，维护角色、状态和密码。</p>
        </div>
        <button type="button" className="ghost-button" onClick={loadUsers}>
          <RefreshCw size={17} />
          刷新
        </button>
      </div>
      {message && <div className="notice-inline">{message}</div>}
      <div className="user-management-workspace">
        <section className="data-panel user-list-panel" aria-label="用户列表">
          <div className="user-list-toolbar">
            <label className="field user-search-field">
              <span>搜索</span>
              <input value={query} placeholder="账号或昵称" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className="field">
              <span>状态</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">全部状态</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>角色</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="all">全部角色</option>
                {Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <button type="button" className="primary-action" onClick={() => setDetailMode('create')}>
              <Plus size={17} />
              新建用户
            </button>
          </div>
          <div className="user-list-count">
            <span>{visibleUsers.length} / {users.length} 个用户</span>
          </div>
          <div className="user-list-table" role="list">
            <div className="user-list-row user-list-head">
              <span>用户</span>
              <span>角色</span>
              <span>状态</span>
              <span>最近登录</span>
              <span>更新时间</span>
              <span>保护</span>
            </div>
            {visibleUsers.map(renderListRow)}
          </div>
          {!users.length && <p className="muted user-empty-state">暂无用户。</p>}
          {filteredEmpty && <p className="muted user-empty-state">没有符合条件的用户。</p>}
        </section>
        <aside className="data-panel user-detail-panel" aria-label="用户详情">
          {renderDetailPanel()}
        </aside>
      </div>
    </section>
  );
}

function WorkflowOverviewStrip({ currentStage }) {
  const activeIndex = Math.max(0, FLOW.indexOf(currentStage || FLOW[0]));
  return (
    <section className="pipeline-strip overview-pipeline" aria-label="自动化流程阶段" data-testid="overview-workflow">
      {FLOW.map((stage, index) => (
        <div key={stage} className={index <= activeIndex ? 'pipeline-step done' : 'pipeline-step'}>
          <span>{index + 1}</span>
          <strong>{stage}</strong>
        </div>
      ))}
    </section>
  );
}

function WorkflowContextBar({ activeModule, item, latestRun }) {
  const context = getWorkflowStageContext(activeModule, item);
  const stageStatus = item ? statusLabel(item.status || 'idle') : '等待任务';
  const runStatus = activeModule === 'execution' && latestRun ? `最近执行：${statusLabel(latestRun.status)}` : '';
  return (
    <section className="workflow-context-bar" aria-label="当前流程阶段" data-testid="workflow-context-bar">
      <div className="stage-summary">
        <span>当前阶段</span>
        <strong>{context.stage}</strong>
        <small>{item?.title || '尚未选择需求工单'}</small>
      </div>
      <div className="stage-neighbors" aria-label="相邻阶段">
        <div>
          <span>上一步</span>
          <strong>{context.previousStage}</strong>
        </div>
        <div>
          <span>下一步</span>
          <strong>{context.nextStage}</strong>
        </div>
      </div>
      <div className="stage-status-block">
        <span>{stageStatus}{runStatus ? ` · ${runStatus}` : ''}</span>
        <div className="stage-progress" aria-label={`流程进度 ${context.progress}%`}>
          <span style={{ width: `${context.progress}%` }} />
        </div>
      </div>
    </section>
  );
}

const emptyDashboardSummary = {
  totals: {
    testCases: 0,
    automatedCases: 0,
    failedCases: 0,
    runningRuns: 0,
    activeSuites: 0,
    workItems: 0,
    suiteRuns: 0,
    passedExecutions: 0,
    failedExecutions: 0,
    skippedExecutions: 0,
    executedCases: 0,
    successRate: 0,
    automationCoverage: 0,
    averageDurationSeconds: 0,
  },
  resultDistribution: { passed: 0, failed: 0, skipped: 0 },
  priorityDistribution: [],
  stageDistribution: [],
  trend: [],
  failureHotspots: [],
  recentRuns: [],
};

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return `${Math.max(0, Math.min(100, Math.round(number)))}%`;
}

function formatCompactDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '0s';
  const minutes = Math.floor(value / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m`;
  return `${Math.round(value)}s`;
}

function distributionPercent(total, value) {
  if (!total) return 0;
  return Math.max(0, Math.round((value / total) * 100));
}

function DashboardKpiCard({ icon: Icon, label, value, detail, tone = '' }) {
  return (
    <article className={`dashboard-kpi-card ${tone}`}>
      <div className="dashboard-kpi-icon"><Icon size={18} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function trendPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return '';
  if (points.length === 2) {
    return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  }
  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    const previous = points[index - 1];
    const next = points[index + 1] || point;
    const beforePrevious = points[index - 2] || previous;
    const controlStartX = previous.x + (point.x - beforePrevious.x) / 6;
    const controlEndX = point.x - (next.x - previous.x) / 6;
    return `${path} C ${controlStartX.toFixed(2)} ${previous.y.toFixed(2)}, ${controlEndX.toFixed(2)} ${point.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }, '');
}

function TrendChart({ items = [] }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const chartItems = items.length ? items : [];
  const width = 720;
  const height = 260;
  const padding = { top: 20, right: 22, bottom: 34, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...chartItems.flatMap((item) => [item.passed || 0, item.failed || 0, item.total || 0]));
  const xForIndex = (index) => padding.left + (chartItems.length <= 1 ? plotWidth / 2 : (index / (chartItems.length - 1)) * plotWidth);
  const trendNumber = (item, key) => {
    const value = Number(item?.[key] || 0);
    return Number.isFinite(value) ? value : 0;
  };
  const pointFor = (item, index, key) => {
    const x = xForIndex(index);
    const value = trendNumber(item, key);
    const y = padding.top + plotHeight - ((value / maxValue) * plotHeight);
    return { x, y, value, label: item.label };
  };
  const seriesConfig = [
    { key: 'total', label: '总计', className: 'total' },
    { key: 'passed', label: '通过', className: 'passed' },
    { key: 'failed', label: '失败', className: 'failed' },
  ];
  const series = seriesConfig.map((item) => ({
    ...item,
    points: chartItems.map((day, index) => pointFor(day, index, item.key)),
  }));
  const yTicks = [maxValue, Math.round(maxValue / 2), 0].filter((value, index, list) => list.indexOf(value) === index);
  const xLabels = chartItems.filter((_, index) => index === 0 || index === chartItems.length - 1 || index % 3 === 0);
  const activeItem = activeIndex === null ? null : chartItems[activeIndex];
  const activePoint = activeItem ? { x: xForIndex(activeIndex), item: activeItem } : null;
  const tooltipEdgeClass = activePoint?.x < padding.left + 130 ? 'near-left' : activePoint?.x > width - padding.right - 130 ? 'near-right' : '';
  const hitStep = chartItems.length <= 1 ? plotWidth : plotWidth / (chartItems.length - 1);
  return (
    <div className="trend-chart" aria-label="测试执行趋势">
      {chartItems.length ? (
        <div className="trend-chart-plot" onMouseLeave={() => setActiveIndex(null)}>
          <svg className="trend-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近 2 周通过、失败、总计执行趋势">
            <g className="trend-grid">
              {yTicks.map((tick) => {
                const y = padding.top + plotHeight - ((tick / maxValue) * plotHeight);
                return (
                  <g key={tick}>
                    <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
                    <text x={padding.left - 10} y={y + 4}>{tick}</text>
                  </g>
                );
              })}
            </g>
            <g className="trend-series">
              {series.map((item) => (
                <g className={`trend-line ${item.className}`} key={item.key}>
                  <path d={trendPath(item.points)} />
                  {item.points.map((point) => (
                    <circle key={`${item.key}-${point.label}`} cx={point.x} cy={point.y} r="3.8" />
                  ))}
                </g>
              ))}
            </g>
            {activePoint ? (
              <g className="trend-active-guide" aria-hidden="true">
                <line x1={activePoint.x} x2={activePoint.x} y1={padding.top} y2={height - padding.bottom} />
                {series.map((item) => {
                  const point = item.points[activeIndex];
                  return <circle className={item.className} key={`active-${item.key}`} cx={point.x} cy={point.y} r="5.6" />;
                })}
              </g>
            ) : null}
            <g className="trend-axis-labels">
              {xLabels.map((item, index) => {
                const sourceIndex = chartItems.indexOf(item);
                const x = xForIndex(sourceIndex);
                return <text key={`${item.date}-${index}`} x={x} y={height - 8}>{item.label}</text>;
              })}
            </g>
            <g className="trend-hit-areas">
              {chartItems.map((item, index) => {
                const x = xForIndex(index);
                const left = Math.max(padding.left, x - hitStep / 2);
                const right = Math.min(width - padding.right, x + hitStep / 2);
                const dateLabel = item.date || item.label || '未命名时间';
                return (
                  <rect
                    key={`${dateLabel}-${index}`}
                    className="trend-hit-area"
                    x={left}
                    y={padding.top}
                    width={Math.max(44, right - left)}
                    height={plotHeight}
                    tabIndex={0}
                    role="button"
                    aria-label={`${dateLabel}，总计 ${trendNumber(item, 'total')}，通过 ${trendNumber(item, 'passed')}，失败 ${trendNumber(item, 'failed')}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    onBlur={() => setActiveIndex(null)}
                  />
                );
              })}
            </g>
          </svg>
          {activePoint ? (
            <div
              className={`trend-tooltip ${tooltipEdgeClass}`}
              role="tooltip"
              data-testid="trend-tooltip"
              style={{ left: `${(activePoint.x / width) * 100}%` }}
            >
              <strong>{activeItem.date || activeItem.label || '未命名时间'}</strong>
              <span><i className="total" />总计 <b>{trendNumber(activeItem, 'total')}</b></span>
              <span><i className="passed" />通过 <b>{trendNumber(activeItem, 'passed')}</b></span>
              <span><i className="failed" />失败 <b>{trendNumber(activeItem, 'failed')}</b></span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="dashboard-empty">暂无趋势数据</div>
      )}
      <div className="trend-legend">
        {seriesConfig.map((item) => <span className={item.className} key={item.key}><i />{item.label}</span>)}
      </div>
    </div>
  );
}

function DistributionBars({ items = [], emptyText = '暂无分布数据' }) {
  const total = items.reduce((sum, item) => sum + (item.total || 0), 0);
  if (!items.length || !total) return <p className="muted dashboard-empty-line">{emptyText}</p>;
  return (
    <div className="distribution-bars">
      {items.map((item) => {
        const percent = distributionPercent(total, item.total || 0);
        return (
          <div className="distribution-row" key={item.label}>
            <div>
              <span>{item.label || '未分组'}</span>
              <strong>{item.total || 0}</strong>
            </div>
            <div className="distribution-track" aria-label={`${item.label} ${percent}%`}>
              <span style={{ width: `${Math.max(4, percent)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResultDistribution({ distribution = {} }) {
  const passed = distribution.passed || 0;
  const failed = distribution.failed || 0;
  const skipped = distribution.skipped || 0;
  const total = passed + failed + skipped;
  const passedPercent = distributionPercent(total, passed);
  const failedPercent = distributionPercent(total, failed);
  const skippedPercent = distributionPercent(total, skipped);
  return (
    <div className="result-distribution">
      <div className="result-bar" aria-label="结果分布">
        {total ? (
          <>
            <span className="passed" style={{ width: `${passedPercent}%` }} />
            <span className="failed" style={{ width: `${failedPercent}%` }} />
            <span className="skipped" style={{ width: `${skippedPercent}%` }} />
          </>
        ) : <span className="empty" style={{ width: '100%' }} />}
      </div>
      <div className="result-legend">
        <span><i className="passed" />通过 {passed}</span>
        <span><i className="failed" />失败 {failed}</span>
        <span><i className="skipped" />跳过 {skipped}</span>
      </div>
    </div>
  );
}

function Overview({ projects, dashboardSummary, dashboardScopeProjectId, setDashboardScopeProjectId, dashboardLoading, openingSuiteRunId, openSuiteRun, workItems, selectWorkItem }) {
  const summary = dashboardSummary || emptyDashboardSummary;
  const totals = { ...emptyDashboardSummary.totals, ...(summary.totals || {}) };
  const recentRuns = summary.recentRuns || [];
  const failureHotspots = summary.failureHotspots || [];
  const scopedWorkItems = dashboardScopeProjectId === 'all'
    ? workItems
    : workItems.filter((item) => item.projectId === dashboardScopeProjectId);
  const kpis = [
    { label: '用例总数', value: totals.testCases, detail: `${totals.workItems} 个需求工单`, icon: Table2 },
    { label: '执行成功率', value: formatPercent(totals.successRate), detail: `通过 ${totals.passedExecutions} / 失败 ${totals.failedExecutions}`, icon: Gauge, tone: 'success' },
    { label: '失败用例', value: totals.failedCases, detail: '最近状态为失败', icon: AlertTriangle, tone: totals.failedCases ? 'danger' : '' },
    { label: '自动化覆盖率', value: formatPercent(totals.automationCoverage), detail: `已自动化 ${totals.automatedCases}`, icon: Bot },
    { label: '运行中', value: totals.runningRuns, detail: `${totals.activeSuites} 个活跃套件`, icon: RadioTower },
    { label: '平均耗时', value: formatCompactDuration(totals.averageDurationSeconds), detail: `${totals.suiteRuns} 次套件执行`, icon: Clock },
  ];
  return (
    <section className="module-section overview-dashboard" aria-label="平台总览" data-testid="overview-dashboard">
      <div className="section-header">
        <div>
          <h2>测试总览</h2>
          <p>{dashboardLoading ? '正在刷新统计数据...' : `默认展示全部项目，当前口径：${dashboardScopeProjectId === 'all' ? '全部项目' : projects.find((project) => project.id === dashboardScopeProjectId)?.name || dashboardScopeProjectId}`}</p>
        </div>
        <div className="overview-dashboard-actions">
          <label className="overview-project-select">
            <span>统计项目</span>
            <select value={dashboardScopeProjectId} onChange={(event) => setDashboardScopeProjectId(event.target.value)} data-testid="overview-project-filter">
              <option value="all">全部项目</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="dashboard-kpi-grid">
        {kpis.map((item) => <DashboardKpiCard key={item.label} {...item} />)}
      </div>

      <div className="overview-dashboard-grid">
        <section className="data-panel overview-trend-panel">
          <div className="panel-heading compact">
            <h3><Activity size={16} /> 测试执行趋势</h3>
            <span className="muted">近 2 周</span>
          </div>
          <TrendChart items={summary.trend || []} />
        </section>
        <section className="data-panel">
          <div className="panel-heading compact">
            <h3><CheckSquare size={16} /> 结果分布</h3>
            <span className="muted">{totals.executedCases} 次执行</span>
          </div>
          <ResultDistribution distribution={summary.resultDistribution} />
          <div className="overview-mini-split">
            <div>
              <h3>优先级分布</h3>
              <DistributionBars items={summary.priorityDistribution || []} emptyText="暂无用例优先级数据" />
            </div>
            <div>
              <h3>工单阶段分布</h3>
              <DistributionBars items={summary.stageDistribution || []} emptyText="暂无工单阶段数据" />
            </div>
          </div>
        </section>
      </div>

      <div className="overview-dashboard-lists">
        <section className="data-panel">
          <div className="panel-heading compact">
            <h3><History size={16} /> 最近执行</h3>
            <span className="muted">最近 {recentRuns.length} 条套件记录</span>
          </div>
          {recentRuns.length ? recentRuns.map((run) => {
            const opening = openingSuiteRunId === run.id;
            const active = isActiveRunStatus(run.status);
            return (
            <button
              type="button"
              className="record-row overview-run-row"
              key={`${run.type}-${run.id}`}
              disabled={opening}
              aria-busy={opening}
              aria-label={`查看套件执行记录 ${run.name || run.id}`}
              onClick={() => openSuiteRun(run)}
            >
              <div className="overview-run-main">
                <strong>{run.name || '未命名执行'}</strong>
                <small>套件执行 · {formatDateTime(run.startedAt)} · 共 {run.totalCases || 0} 条</small>
                <div className="overview-run-results" aria-label={`通过 ${run.passedCases || 0}，失败 ${run.failedCases || 0}，跳过 ${run.skippedCases || 0}`}>
                  <span className="passed">通过 {run.passedCases || 0}</span>
                  <span className="failed">失败 {run.failedCases || 0}</span>
                  <span className="skipped">跳过 {run.skippedCases || 0}</span>
                </div>
              </div>
              <div className="overview-run-status">
                <strong className={run.status}>{opening ? '正在打开' : statusLabel(run.status)}</strong>
                {active && !opening ? <small>进度 {run.progress || 0}%</small> : null}
                {opening ? <RefreshCw className="overview-run-spinner" size={16} /> : <ChevronRight size={17} aria-hidden="true" />}
              </div>
            </button>
            );
          }) : <p className="muted">暂无套件执行记录。</p>}
        </section>
        <section className="data-panel failure-hotspots">
          <div className="panel-heading compact">
            <h3><Bug size={16} /> 失败热点</h3>
            <span className="muted">按失败次数</span>
          </div>
          {failureHotspots.length ? failureHotspots.map((item) => (
            <div className="failure-hotspot-row" key={item.caseId}>
              <div>
                <strong>{item.externalId || item.caseId}</strong>
                <span>{item.title}</span>
                <small>最近失败：{formatDateTime(item.lastFailedAt)}</small>
              </div>
              <em>{item.failedCount}</em>
            </div>
          )) : <p className="muted">暂无失败热点。</p>}
        </section>
        <section className="data-panel">
          <div className="panel-heading compact">
            <h3><ClipboardList size={16} /> 最近任务</h3>
            <span className="muted">{scopedWorkItems.length} 个</span>
          </div>
          {scopedWorkItems.length ? scopedWorkItems.slice(0, 6).map((item) => (
            <button type="button" className="record-row" key={item.id} onClick={() => selectWorkItem(item.id)}>
              <span>{item.title}</span>
              <strong>{item.stage}</strong>
            </button>
          )) : <p className="muted">暂无需求工单。</p>}
        </section>
      </div>
    </section>
  );
}

const PROJECT_DEPENDENCY_FIELDS = [
  ['workItems', '需求工单'],
  ['features', '功能模块'],
  ['testCases', '结构化用例'],
  ['testSuites', '测试套件'],
  ['suiteRuns', '套件执行'],
  ['deliverables', '交付物'],
];

function projectDependencyEntries(stats = {}) {
  return PROJECT_DEPENDENCY_FIELDS.map(([key, label]) => ({ key, label, count: Number(stats[key] || 0) }));
}

function Projects({ projects, setProjects, currentProjectId, setCurrentProjectId, fetchJson, setNotice, setError, canManageAssets = true }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectPage, setProjectPage] = useState(1);
  const [formDialog, setFormDialog] = useState({ open: false, mode: 'create', saving: false, error: '', project: null, draft: emptyProjectForm() });
  const [detailDialog, setDetailDialog] = useState({ open: false, loading: false, error: '', project: null, detail: null });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, loading: false, deleting: false, error: '', step: 'check', project: null, detail: null });
  const detailRequestRef = useRef(0);
  const deleteRequestRef = useRef(0);
  const projectPageSize = 10;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredProjects = useMemo(() => [...projects]
    .sort((left, right) => {
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime() || 0;
      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime() || 0;
      return rightTime - leftTime;
    })
    .filter((project) => {
      const searchMatches = !normalizedSearch || [project.name, project.projectCode, project.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch);
      const typeMatches = typeFilter === 'all' || project.projectType === typeFilter;
      const statusMatches = statusFilter === 'all' || project.status === statusFilter;
      return searchMatches && typeMatches && statusMatches;
    }), [normalizedSearch, projects, statusFilter, typeFilter]);
  const totalProjectPages = Math.max(1, Math.ceil(filteredProjects.length / projectPageSize));
  const currentProjectPage = Math.min(projectPage, totalProjectPages);
  const pagedProjects = filteredProjects.slice((currentProjectPage - 1) * projectPageSize, currentProjectPage * projectPageSize);

  useEffect(() => {
    setProjectPage(1);
  }, [normalizedSearch, statusFilter, typeFilter]);

  useEffect(() => {
    if (projectPage > totalProjectPages) setProjectPage(totalProjectPages);
  }, [projectPage, totalProjectPages]);

  function resetProjectFilters() {
    setSearch('');
    setTypeFilter('all');
    setStatusFilter('all');
    setProjectPage(1);
  }

  function beginCreateProject() {
    if (!canManageAssets) return;
    setFormDialog({
      open: true,
      mode: 'create',
      saving: false,
      error: '',
      project: null,
      draft: emptyProjectForm({
        name: `QA 项目 ${projects.length + 1}`,
        projectType: 'delivery',
        status: 'planning',
        description: '用于管理需求、用例、交付物和批量执行的项目。',
      }),
    });
  }

  function beginEditProject(project) {
    if (!canManageAssets) return;
    setFormDialog({ open: true, mode: 'edit', saving: false, error: '', project, draft: emptyProjectForm(project) });
  }

  function updateProjectForm(key, value) {
    setFormDialog((current) => ({ ...current, error: '', draft: { ...current.draft, [key]: value } }));
  }

  function closeProjectForm() {
    setFormDialog((current) => (current.saving ? current : { ...current, open: false, error: '' }));
  }

  async function saveProject() {
    const name = formDialog.draft.name.trim();
    const isCreating = formDialog.mode === 'create';
    if (!name) {
      setFormDialog((current) => ({ ...current, error: '项目名称不能为空。' }));
      return;
    }
    const environments = (formDialog.draft.environments || []).map((environment) => ({
      id: environment.id || '',
      name: environment.name.trim(),
      url: environment.url.trim(),
      is_default: Boolean(environment.is_default),
    }));
    if (environments.some((environment) => !environment.name || !environment.url)) {
      setFormDialog((current) => ({ ...current, error: '环境名称和 URL 不能为空。' }));
      return;
    }
    if (environments.length && environments.filter((environment) => environment.is_default).length !== 1) {
      setFormDialog((current) => ({ ...current, error: '项目有环境配置时必须设置一个默认环境。' }));
      return;
    }
    if (environments.some((environment) => {
      try {
        return !['http:', 'https:'].includes(new URL(environment.url).protocol);
      } catch {
        return true;
      }
    })) {
      setFormDialog((current) => ({ ...current, error: '环境 URL 必须是有效的 HTTP(S) 地址。' }));
      return;
    }
    const defaultEnvironment = environments.find((environment) => environment.is_default);
    const requestPayload = {
      ...formDialog.draft,
      name,
      environments,
      target_url: defaultEnvironment?.url || '',
    };
    delete requestPayload._key;
    setFormDialog((current) => ({ ...current, saving: true, error: '' }));
    try {
      const project = isCreating
        ? await fetchJson('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        })
        : await fetchJson(`/api/projects/${formDialog.project.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        });
      setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]);
      setFormDialog((current) => ({ ...current, open: false, saving: false, project, draft: emptyProjectForm(project) }));
      setNotice(isCreating ? `项目已创建：${project.name}` : `项目已保存：${project.name}`);
      setError('');
    } catch (err) {
      setFormDialog((current) => ({ ...current, saving: false, error: `${isCreating ? '创建' : '保存'}项目失败：${err.message}` }));
    }
  }

  async function openProjectDetail(project) {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setDetailDialog({ open: true, loading: true, error: '', project, detail: null });
    try {
      const detail = await fetchJson(`/api/projects/${project.id}`);
      if (detailRequestRef.current !== requestId) return;
      setDetailDialog({ open: true, loading: false, error: '', project, detail });
    } catch (err) {
      if (detailRequestRef.current !== requestId) return;
      setDetailDialog({ open: true, loading: false, error: err.message, project, detail: null });
    }
  }

  function closeProjectDetail() {
    detailRequestRef.current += 1;
    setDetailDialog((current) => ({ ...current, open: false, loading: false }));
  }

  async function openProjectDelete(project) {
    if (!canManageAssets) return;
    const requestId = deleteRequestRef.current + 1;
    deleteRequestRef.current = requestId;
    setDeleteDialog({ open: true, loading: true, deleting: false, error: '', step: 'check', project, detail: null });
    try {
      const detail = await fetchJson(`/api/projects/${project.id}`);
      if (deleteRequestRef.current !== requestId) return;
      setDeleteDialog({ open: true, loading: false, deleting: false, error: '', step: 'check', project, detail });
    } catch (err) {
      if (deleteRequestRef.current !== requestId) return;
      setDeleteDialog({ open: true, loading: false, deleting: false, error: err.message, step: 'check', project, detail: null });
    }
  }

  function closeProjectDelete() {
    if (deleteDialog.deleting) return;
    deleteRequestRef.current += 1;
    setDeleteDialog((current) => ({ ...current, open: false, loading: false, error: '' }));
  }

  function continueCascadeProjectDelete() {
    setDeleteDialog((current) => ({ ...current, error: '', step: 'confirm-cascade' }));
  }

  async function deleteProject(cascade = false) {
    const project = deleteDialog.detail || deleteDialog.project;
    const blockers = projectDependencyEntries(deleteDialog.detail?.stats).filter((item) => item.count > 0);
    if (!project?.id || deleteDialog.loading || (blockers.length && !cascade)) return;
    setDeleteDialog((current) => ({ ...current, deleting: true, error: '' }));
    try {
      const result = await fetchJson(`/api/projects/${project.id}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE' });
      const remaining = projects.filter((item) => item.id !== project.id);
      setProjects(remaining);
      if (currentProjectId === project.id) setCurrentProjectId(remaining[0]?.id || '');
      setDeleteDialog((current) => ({ ...current, open: false, deleting: false }));
      const warningCount = result.fileCleanupWarnings?.length || 0;
      setNotice(warningCount ? `项目已删除：${project.name}；${warningCount} 个生成文件未能自动清理。` : `项目已删除：${project.name}`);
      setError('');
    } catch (err) {
      setDeleteDialog((current) => ({ ...current, deleting: false, error: `删除项目失败：${err.message}` }));
    }
  }

  return (
    <section className="module-section" aria-label="项目管理">
      <div className="section-header">
        <div>
          <h2>项目管理</h2>
          <p>项目是需求工单、用例、交付物和套件执行的归属边界。</p>
        </div>
        <button type="button" className="primary-action" onClick={beginCreateProject} disabled={!canManageAssets} title={canManageAssets ? '新建项目' : '当前账号仅可查看项目'}>
          <Plus size={17} />
          新建项目
        </button>
      </div>

      <div className="project-tools">
        <div className="list-tools project-filter-grid">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目名称或项目编号" aria-label="搜索项目" data-testid="project-management-search" />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="项目类型筛选" data-testid="project-management-type-filter">
            <option value="all">全部类型</option>
            <option value="product">产品类</option>
            <option value="delivery">交付类</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="项目状态筛选" data-testid="project-management-status-filter">
            <option value="all">全部状态</option>
            <option value="planning">规划中</option>
            <option value="active">进行中</option>
            <option value="paused">暂停</option>
            <option value="completed">已完成</option>
            <option value="archived">已归档</option>
          </select>
          <button
            type="button"
            className="ghost-button project-filter-reset"
            disabled={!search && typeFilter === 'all' && statusFilter === 'all'}
            onClick={resetProjectFilters}
            data-testid="project-management-filter-reset"
          >
            <RefreshCw size={16} />
            重置
          </button>
        </div>
      </div>

      <div className="project-table-scroll" data-testid="project-management-table" role="region" aria-label="项目列表" tabIndex={0}>
        <div className="project-table">
          <div className="project-row project-row-head">
            <span>项目编号</span>
            <span>项目名称</span>
            <span>类型</span>
            <span>状态</span>
            <span>更新时间</span>
            <span>操作</span>
          </div>
          {pagedProjects.length ? pagedProjects.map((project) => {
            const manageTitle = canManageAssets ? '' : '当前账号仅可查看项目';
            return (
              <div className="project-row" key={project.id}>
                <span className="project-data-cell project-code-cell" data-label="项目编号" title={project.projectCode || project.id}>{project.projectCode || project.id}</span>
                <div className="project-data-cell project-main-cell" data-label="项目名称">
                  <strong title={project.name}>{project.name}</strong>
                </div>
                <span className="project-data-cell" data-label="类型">{projectTypeLabel(project.projectType)}</span>
                <span className="project-data-cell" data-label="状态"><i className={`project-status ${project.status || 'active'}`}>{projectStatusLabel(project.status)}</i></span>
                <span className="project-data-cell" data-label="更新时间">{formatDateTime(project.updatedAt || project.createdAt)}</span>
                <div className="project-action-cell">
                  <button type="button" className="ghost-button project-row-action-button" onClick={() => openProjectDetail(project)} aria-label={`查看项目 ${project.name}`} title="查看详情">
                    <Eye size={16} />
                  </button>
                  <button type="button" className="ghost-button project-row-action-button" disabled={!canManageAssets} onClick={() => beginEditProject(project)} aria-label={`编辑项目 ${project.name}`} title={manageTitle || '编辑项目'}>
                    <Edit3 size={16} />
                  </button>
                  <button type="button" className="ghost-button danger-button project-row-action-button" disabled={!canManageAssets} onClick={() => openProjectDelete(project)} aria-label={`删除项目 ${project.name}`} title={manageTitle || '删除项目'}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          }) : (
            <div className="project-table-empty">
              <Database size={24} />
              <strong>{projects.length ? '没有匹配的项目' : '暂无项目'}</strong>
              <span>{projects.length ? '请调整搜索或筛选条件。' : '新建项目后，可在这里统一查看和维护。'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="case-management-pagination project-management-pagination">
        <span>{filteredProjects.length} 个项目 · 第 {currentProjectPage}/{totalProjectPages} 页</span>
        <div className="action-row">
          <button type="button" className="ghost-button" disabled={currentProjectPage <= 1} onClick={() => setProjectPage(1)}>首页</button>
          <button type="button" className="ghost-button" disabled={currentProjectPage <= 1} onClick={() => setProjectPage((page) => Math.max(1, page - 1))}>上一页</button>
          <span>每页 {projectPageSize} 条</span>
          <button type="button" className="ghost-button" disabled={currentProjectPage >= totalProjectPages} onClick={() => setProjectPage((page) => Math.min(totalProjectPages, page + 1))}>下一页</button>
          <button type="button" className="ghost-button" disabled={currentProjectPage >= totalProjectPages} onClick={() => setProjectPage(totalProjectPages)}>末页</button>
        </div>
      </div>

      {formDialog.open && <ProjectFormModal state={formDialog} onChange={updateProjectForm} onClose={closeProjectForm} onSave={saveProject} />}
      {detailDialog.open && <ProjectDetailModal state={detailDialog} onClose={closeProjectDetail} onRetry={() => openProjectDetail(detailDialog.project)} />}
      {deleteDialog.open && <ProjectDeleteModal state={deleteDialog} onClose={closeProjectDelete} onRetry={() => openProjectDelete(deleteDialog.project)} onContinue={continueCascadeProjectDelete} onConfirm={deleteProject} />}
    </section>
  );
}

function ProjectFormModal({ state, onChange, onClose, onSave }) {
  const firstFieldRef = useRef(null);
  const isCreating = state.mode === 'create';
  const draft = state.draft || {};
  const environments = draft.environments || [];

  const addEnvironment = () => onChange('environments', [
    ...environments,
    {
      id: '',
      name: environments.length ? `环境 ${environments.length + 1}` : '测试环境',
      url: '',
      is_default: environments.length === 0,
      _key: `environment-${Date.now()}`,
    },
  ]);
  const updateEnvironment = (key, patch) => onChange('environments', environments.map((environment) => (
    environment._key === key ? { ...environment, ...patch } : environment
  )));
  const setDefaultEnvironment = (key) => onChange('environments', environments.map((environment) => ({
    ...environment,
    is_default: environment._key === key,
  })));
  const removeEnvironment = (key) => {
    const removed = environments.find((environment) => environment._key === key);
    const next = environments.filter((environment) => environment._key !== key);
    if (removed?.is_default && next.length) next[0] = { ...next[0], is_default: true };
    onChange('environments', next);
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !state.saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [state.saving]);

  return createPortal(
    <div className="artifact-preview-modal case-edit-modal project-form-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="artifact-preview-modal-card case-edit-card project-form-card" role="dialog" aria-modal="true" aria-label={isCreating ? '新建项目' : `编辑项目 ${state.project?.name || ''}`}>
        <header className="artifact-renderer-header modal case-detail-header">
          <div>
            <h3>{isCreating ? '新建项目' : '编辑项目'}</h3>
            <p>{isCreating ? '填写项目归属与工程配置。' : `${state.project?.projectCode || state.project?.id || '-'} · ${state.project?.name || '-'}`}</p>
          </div>
          <button type="button" className="artifact-modal-close" disabled={state.saving} title="关闭项目表单" aria-label="关闭项目表单" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="case-edit-body">
          <div className="project-form-modal-grid">
            <label className="field">
              <span>项目编号</span>
              <input ref={firstFieldRef} aria-label="项目编号" value={draft.project_code || ''} disabled={state.saving} onChange={(event) => onChange('project_code', event.target.value)} placeholder="为空时自动生成" />
            </label>
            <label className="field">
              <span>项目名称 *</span>
              <input aria-label="项目名称" value={draft.name || ''} disabled={state.saving} onChange={(event) => onChange('name', event.target.value)} placeholder="输入项目名称" />
            </label>
            <label className="field">
              <span>项目类型</span>
              <select aria-label="项目类型" value={draft.project_type || 'product'} disabled={state.saving} onChange={(event) => onChange('project_type', event.target.value)}>
                <option value="product">产品类</option>
                <option value="delivery">交付类</option>
              </select>
            </label>
            <label className="field">
              <span>项目状态</span>
              <select aria-label="项目状态" value={draft.status || 'active'} disabled={state.saving} onChange={(event) => onChange('status', event.target.value)}>
                <option value="planning">规划中</option>
                <option value="active">进行中</option>
                <option value="paused">暂停</option>
                <option value="completed">已完成</option>
                <option value="archived">已归档</option>
              </select>
            </label>
            <section className="project-environment-editor project-form-wide-field" aria-label="项目环境配置">
              <div className="project-environment-heading">
                <div><span>项目环境</span><small>默认环境同步为项目目标 URL。</small></div>
                <button type="button" className="ghost-button compact" disabled={state.saving} onClick={addEnvironment}><Plus size={15} />新增环境</button>
              </div>
              <div className="project-environment-list">
                {environments.map((environment) => (
                  <div className="project-environment-row" key={environment._key}>
                    <button type="button" className={environment.is_default ? 'icon-button environment-default active' : 'icon-button environment-default'} disabled={state.saving} onClick={() => setDefaultEnvironment(environment._key)} aria-label={`设为默认环境 ${environment.name || ''}`} title={environment.is_default ? '当前默认环境' : '设为默认环境'}><CircleDot size={15} /></button>
                    <input aria-label="环境名称" value={environment.name} disabled={state.saving} onChange={(event) => updateEnvironment(environment._key, { name: event.target.value })} placeholder="例如：测试环境" />
                    <input aria-label="环境 URL" value={environment.url} disabled={state.saving} onChange={(event) => updateEnvironment(environment._key, { url: event.target.value })} placeholder="https://test.example.com" />
                    <button type="button" className="icon-button danger" disabled={state.saving} onClick={() => removeEnvironment(environment._key)} aria-label={`删除环境 ${environment.name || ''}`} title="删除环境"><Trash2 size={15} /></button>
                  </div>
                ))}
                {!environments.length ? <p className="muted project-environment-empty">暂未配置环境，仍可创建项目后再补充。</p> : null}
              </div>
            </section>
            <label className="field">
              <span>仓库路径</span>
              <input aria-label="仓库路径" value={draft.repository_path || ''} disabled={state.saving} onChange={(event) => onChange('repository_path', event.target.value)} />
            </label>
            <label className="field">
              <span>测试目录</span>
              <input aria-label="测试目录" value={draft.test_dir || ''} disabled={state.saving} onChange={(event) => onChange('test_dir', event.target.value)} />
            </label>
            <label className="field project-form-wide-field">
              <span>项目描述</span>
              <textarea aria-label="项目描述" value={draft.description || ''} disabled={state.saving} onChange={(event) => onChange('description', event.target.value)} />
            </label>
          </div>
          {state.error ? <div className="case-editor-error project-dialog-error" role="alert">{state.error}</div> : null}
        </div>
        <footer className="case-edit-footer">
          <span>{isCreating ? '项目编号留空时由系统自动生成。' : '保存后，跨模块的当前项目会同步更新。'}</span>
          <div className="action-row">
            <button type="button" className="ghost-button" disabled={state.saving} onClick={onClose}>取消</button>
            <button type="button" className="primary-action" disabled={state.saving} onClick={onSave}>
              <Save size={16} />
              {state.saving ? '保存中...' : isCreating ? '创建项目' : '保存修改'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function ProjectDetailModal({ state, onClose, onRetry }) {
  const project = state.detail || state.project || {};
  const displayValue = (value, fallback = '-') => value || fallback;
  const dependencies = projectDependencyEntries(project.stats);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return createPortal(
    <div className="artifact-preview-modal case-detail-modal project-detail-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="artifact-preview-modal-card case-detail-card project-detail-card" role="dialog" aria-modal="true" aria-label={`项目详情 ${project.name || ''}`}>
        <header className="artifact-renderer-header modal case-detail-header">
          <div>
            <h3>{displayValue(project.name, '项目详情')}</h3>
            <p>{displayValue(project.projectCode || project.id)} · {projectTypeLabel(project.projectType)}</p>
          </div>
          <button type="button" className="artifact-modal-close" title="关闭项目详情" aria-label="关闭项目详情" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="case-detail-body">
          {state.loading ? (
            <div className="project-dialog-state"><RefreshCw className="spin" size={22} /><span>正在加载项目详情...</span></div>
          ) : state.error ? (
            <div className="case-detail-script-error project-detail-error" role="alert">
              <div><strong>项目详情加载失败</strong><span>{state.error}</span></div>
              <button type="button" className="ghost-button compact" onClick={onRetry}><RefreshCw size={15} />重新加载</button>
            </div>
          ) : (
            <>
              <section className="case-detail-section" aria-label="项目基本信息">
                <h4>基本信息</h4>
                <dl className="case-detail-meta-grid project-detail-meta-grid">
                  <div><dt>项目编号</dt><dd>{displayValue(project.projectCode || project.id)}</dd></div>
                  <div><dt>项目类型</dt><dd>{projectTypeLabel(project.projectType)}</dd></div>
                  <div><dt>项目状态</dt><dd><i className={`project-status ${project.status || 'active'}`}>{projectStatusLabel(project.status)}</i></dd></div>
                  <div><dt>目标 URL</dt><dd>{displayValue(project.targetUrl)}</dd></div>
                  <div><dt>仓库路径</dt><dd>{displayValue(project.repositoryPath)}</dd></div>
                  <div><dt>测试目录</dt><dd>{displayValue(project.testDir)}</dd></div>
                  <div><dt>创建时间</dt><dd>{formatDateTime(project.createdAt)}</dd></div>
                  <div><dt>更新时间</dt><dd>{formatDateTime(project.updatedAt)}</dd></div>
                </dl>
              </section>
              <section className="case-detail-section" aria-label="项目描述">
                <h4>项目描述</h4>
                <p className="project-detail-description">{displayValue(project.description, '暂无项目描述。')}</p>
              </section>
              <section className="case-detail-section" aria-label="项目环境">
                <h4>项目环境</h4>
                <div className="project-detail-environments">
                  {project.environments?.length ? project.environments.map((environment) => (
                    <div key={environment.id}>
                      <span>{environment.name}{environment.isDefault ? ' · 默认' : ''}</span>
                      <strong>{environment.url}</strong>
                    </div>
                  )) : <p className="muted">暂无环境配置。</p>}
                </div>
              </section>
              <section className="case-detail-section" aria-label="关联资产">
                <h4>关联资产</h4>
                <div className="project-dependency-grid">
                  {dependencies.map((item) => <div key={item.key}><span>{item.label}</span><strong>{item.count}</strong></div>)}
                </div>
              </section>
            </>
          )}
        </div>
        <footer className="case-detail-footer"><span>详情内容为只读；修改请使用列表中的编辑入口。</span><button type="button" className="ghost-button" onClick={onClose}>关闭</button></footer>
      </div>
    </div>,
    document.body,
  );
}

function ProjectDeleteModal({ state, onClose, onRetry, onContinue, onConfirm }) {
  const project = state.detail || state.project || {};
  const blockers = projectDependencyEntries(state.detail?.stats).filter((item) => item.count > 0);
  const cascadeConfirmation = blockers.length > 0 && state.step === 'confirm-cascade';
  const canDelete = Boolean(state.detail) && !state.loading && !state.deleting && !state.error && (blockers.length === 0 || cascadeConfirmation);
  const dependencyTotal = blockers.reduce((total, item) => total + item.count, 0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !state.deleting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [state.deleting]);

  return createPortal(
    <div className="artifact-preview-modal project-delete-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="artifact-preview-modal-card project-delete-card" role="alertdialog" aria-modal="true" aria-label={`删除项目 ${project.name || ''}`}>
        <header className="artifact-renderer-header modal case-detail-header">
          <div><h3>删除项目</h3><p>{project.projectCode || project.id || '-'} · {project.name || '-'}</p></div>
          <button type="button" className="artifact-modal-close" disabled={state.deleting} title="关闭删除确认" aria-label="关闭删除确认" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="project-delete-body">
          {state.loading ? (
            <div className="project-dialog-state"><RefreshCw className="spin" size={22} /><span>正在检查项目关联资产...</span></div>
          ) : state.error ? (
            <div className="case-detail-script-error project-detail-error" role="alert">
              <div><strong>{state.detail ? '删除失败' : '删除预检失败'}</strong><span>{state.error}</span></div>
              <button type="button" className="ghost-button compact" onClick={onRetry}><RefreshCw size={15} />重新检查</button>
            </div>
          ) : cascadeConfirmation ? (
            <div className="project-delete-blocked">
              <AlertTriangle size={24} />
              <div><strong>永久删除项目“{project.name}”及全部关联资产？</strong><span>将清除 {dependencyTotal} 条顶层关联记录及其运行日志、脚本版本和生成产物。此操作不可撤销。</span></div>
              <dl>{blockers.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.count}</dd></div>)}</dl>
            </div>
          ) : blockers.length ? (
            <div className="project-delete-blocked">
              <AlertTriangle size={24} />
              <div><strong>该项目仍有关联资产。</strong><span>可以返回处理依赖，或继续进入永久级联删除确认。</span></div>
              <dl>{blockers.map((item) => <div key={item.key}><dt>{item.label}</dt><dd>{item.count}</dd></div>)}</dl>
            </div>
          ) : (
            <div className="project-delete-ready">
              <AlertTriangle size={24} />
              <div><strong>确认永久删除项目“{project.name}”？</strong><span>预检未发现关联资产。此操作不可撤销。</span></div>
            </div>
          )}
        </div>
        <footer className="case-edit-footer project-delete-footer">
          <span>{cascadeConfirmation ? '确认后将同时删除项目数据库历史和受控生成文件。' : blockers.length ? `检测到 ${blockers.length} 类关联资产。` : '仅允许删除没有任何关联资产的项目。'}</span>
          <div className="action-row">
            <button type="button" className="ghost-button" disabled={state.deleting} onClick={onClose}>取消</button>
            {blockers.length && !cascadeConfirmation ? (
              <button type="button" className="ghost-button danger-button" disabled={state.loading || state.deleting || Boolean(state.error)} onClick={onContinue}>
                <AlertTriangle size={16} />
                继续删除
              </button>
            ) : (
              <button type="button" className="ghost-button danger-button" disabled={!canDelete} onClick={() => onConfirm(cascadeConfirmation)}>
                <Trash2 size={16} />
                {state.deleting ? '删除中...' : cascadeConfirmation ? '永久删除项目及资产' : '确认删除'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function SuiteExecutionDialog({ state, project, running, onChange, onClose, onConfirm }) {
  const environments = project?.environments || [];
  const selected = environments.find((environment) => environment.id === state.environmentId)
    || environments.find((environment) => environment.isDefault)
    || null;
  return createPortal(
    <div className="artifact-preview-modal suite-execution-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !running && onClose()}>
      <div className="artifact-preview-modal-card suite-execution-card" role="dialog" aria-modal="true" aria-label={`执行套件 ${state.suite?.name || ''}`}>
        <header className="artifact-renderer-header modal case-detail-header">
          <div><h3>执行测试套件</h3><p>{state.suite?.name || '-'}</p></div>
          <button type="button" className="artifact-modal-close" disabled={running} onClick={onClose} aria-label="关闭套件执行确认"><X size={18} /></button>
        </header>
        <div className="case-edit-body suite-execution-body">
          <label className="field">
            <span>本次运行环境</span>
            <select value={state.environmentId} disabled={running} onChange={(event) => onChange(event.target.value)} data-testid="suite-run-environment">
              <option value="">项目默认环境</option>
              {environments.map((environment) => <option value={environment.id} key={environment.id}>{environment.name}{environment.isDefault ? '（项目默认）' : ''}</option>)}
            </select>
          </label>
          <div className="execution-environment-result"><span>目标 URL</span><strong>{selected?.url || project?.targetUrl || '未配置'}</strong></div>
        </div>
        <footer className="case-edit-footer">
          <span>本次选择只写入套件 Run，不修改套件默认配置。</span>
          <div className="action-row">
            <button type="button" className="ghost-button" disabled={running} onClick={onClose}>取消</button>
            <button type="button" className="primary-action" disabled={running} onClick={onConfirm}><Play size={16} />{running ? '启动中...' : '确认执行'}</button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}


function TestSuites({
  suites,
  testCases,
  projects = [],
  currentProjectId,
  suiteCaseProjects = [],
  selectedSuiteId,
  suiteForm,
  setSuiteForm,
  suiteView,
  suiteRouteLoading,
  suiteRouteError,
  suiteRouteRecord,
  selectSuite,
  navigateSuite,
  beginCreateSuite,
  saveSuite,
  notifySuiteEditCancelled,
  deleteSuite,
  runSuite,
  canManageAssets,
  canExecute,
}) {
  const [suiteQueryDraft, setSuiteQueryDraft] = useState({ projectId: 'all', name: '', status: 'all' });
  const [appliedSuiteQuery, setAppliedSuiteQuery] = useState({ projectId: 'all', name: '', status: 'all' });
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedScope, setSelectedScope] = useState({ type: 'all', projectId: '', featureId: '', featureIds: [] });
  const [caseSearch, setCaseSearch] = useState('');
  const [casePriority, setCasePriority] = useState('all');
  const [casePage, setCasePage] = useState(1);
  const [caseTreePanelWidth, setCaseTreePanelWidth] = useState(320);
  const [expandedProjects, setExpandedProjects] = useState(() => new Set());
  const [expandedFeatures, setExpandedFeatures] = useState(() => new Set());
  const [runningSuiteId, setRunningSuiteId] = useState('');
  const [suiteExecutionDialog, setSuiteExecutionDialog] = useState({ open: false, suite: null, environmentId: '' });
  const casePageSize = 10;
  const normalizedSuiteName = appliedSuiteQuery.name.trim().toLowerCase();
  const normalizedProjectSearch = projectSearch.trim().toLowerCase();
  const normalizedCaseSearch = caseSearch.trim().toLowerCase();
  const isEditorView = suiteView === 'edit' || suiteView === 'create';
  useEffect(() => {
    if (suiteView === 'create') {
      setProjectSearch('');
      setSelectedScope({ type: 'all', projectId: '', featureId: '', featureIds: [] });
    }
  }, [suiteView]);
  useEffect(() => {
    setCasePage(1);
  }, [normalizedProjectSearch, normalizedCaseSearch, casePriority, selectedScope.type, selectedScope.projectId, selectedScope.featureId]);
  const suiteProjects = useMemo(() => {
    if (suiteCaseProjects.length) {
      return suiteCaseProjects.map((project) => ({
        ...project,
        testCases: project.testCases || [],
        features: project.features || [],
        featureTree: project.featureTree?.length ? project.featureTree : buildFeatureTree(project.features || []),
      }));
    }
    return projects.map((project) => ({
      ...project,
      testCases: project.id === currentProjectId ? testCases : [],
      features: [],
      featureTree: [],
    }));
  }, [currentProjectId, projects, suiteCaseProjects, testCases]);
  const allProjectCases = useMemo(() => suiteProjects.flatMap((project) => (
    (project.testCases || []).map((item) => ({
      ...item,
      projectName: project.name,
      projectCode: project.projectCode || '',
    }))
  )), [suiteProjects]);
  const casesById = useMemo(() => new Map(allProjectCases.map((item) => [item.id, item])), [allProjectCases]);
  const projectById = useMemo(() => new Map(suiteProjects.map((project) => [project.id, project])), [suiteProjects]);
  const visibleSuiteProjects = suiteProjects.filter((project) => (
    !normalizedProjectSearch || (project.name || '').toLowerCase().includes(normalizedProjectSearch)
  ));
  const visibleProjectIds = new Set(visibleSuiteProjects.map((project) => project.id));
  const managedSuites = suites.filter((suite) => !suite.legacy);
  const selectedSuite = managedSuites.find((suite) => suite.id === selectedSuiteId)
    || (suiteRouteRecord?.id === selectedSuiteId ? suiteRouteRecord : null);
  const visibleSuites = managedSuites.filter((suite) => {
    const projectMatches = appliedSuiteQuery.projectId === 'all' || suite.projectId === appliedSuiteQuery.projectId;
    const statusMatches = appliedSuiteQuery.status === 'all' || suite.status === appliedSuiteQuery.status;
    const nameMatches = !normalizedSuiteName || (suite.name || '').toLowerCase().includes(normalizedSuiteName);
    return projectMatches && statusMatches && nameMatches;
  });
  const selectedIds = new Set(suiteForm.caseIds || []);
  const selectedCases = (suiteForm.caseIds || []).map((caseId) => casesById.get(caseId)).filter(Boolean);
  const selectedCaseProjectIds = [...new Set(selectedCases.map((item) => item.projectId).filter(Boolean))];
  const selectedCaseProjectId = selectedCaseProjectIds.length === 1 ? selectedCaseProjectIds[0] : '';
  const existingSuiteProjectId = selectedSuiteId ? selectedSuite?.projectId || suiteForm.projectId : '';
  const scopedProjectId = selectedScope.type !== 'all' ? selectedScope.projectId : '';
  const existingSuiteHasCases = Boolean(selectedSuiteId && (selectedSuite?.caseCount || selectedSuite?.caseIds?.length || suiteForm.caseIds?.length));
  const lockedProjectId = selectedCaseProjectId || (existingSuiteHasCases ? existingSuiteProjectId : scopedProjectId);
  const lockedProject = lockedProjectId ? projectById.get(lockedProjectId) : null;
  const formStats = suiteCaseStats({ caseIds: suiteForm.caseIds }, allProjectCases.length ? allProjectCases : testCases);
  const selectedSuiteCaseCount = selectedSuite?.caseCount ?? selectedSuite?.caseIds?.length ?? 0;
  const suiteExecuteDisabledReason = (suite, caseCount) => !canExecute
    ? '当前账号无权执行测试套件'
    : suite.status === 'disabled'
      ? '停用套件不能执行'
      : !caseCount
        ? '空套件不能执行，请先添加测试用例'
        : '';
  const executeDisabledReason = selectedSuite
    ? suiteExecuteDisabledReason(selectedSuite, selectedSuiteCaseCount)
    : '请先选择一个测试套件';
  const filteredCases = allProjectCases.filter((item) => {
    if (!visibleProjectIds.has(item.projectId)) return false;
    const scopeMatches = selectedScope.type === 'all'
      || (selectedScope.type === 'project' && item.projectId === selectedScope.projectId)
      || (selectedScope.type === 'feature' && item.projectId === selectedScope.projectId && (selectedScope.featureIds || []).includes(item.featureId));
    const priorityMatches = casePriority === 'all' || item.priority === casePriority;
    const text = [item.projectName, item.featurePath, item.externalId, item.title, item.requirement, item.steps, item.expected, item.specPath].filter(Boolean).join(' ').toLowerCase();
    return scopeMatches && priorityMatches && (!normalizedCaseSearch || text.includes(normalizedCaseSearch));
  });
  const filteredProjectIds = [...new Set(filteredCases.map((item) => item.projectId).filter(Boolean))];
  const filteredSelectionProjectId = lockedProjectId
    || (scopedProjectId || (filteredProjectIds.length === 1 ? filteredProjectIds[0] : ''));
  const canBulkSelectFiltered = Boolean(filteredSelectionProjectId);
  const caseTotalPages = Math.max(1, Math.ceil(filteredCases.length / casePageSize));
  const currentCasePage = Math.min(casePage, caseTotalPages);
  const pagedCases = filteredCases.slice((currentCasePage - 1) * casePageSize, currentCasePage * casePageSize);
  const selectedScopeLabel = selectedScope.type === 'feature'
    ? projectById.get(selectedScope.projectId)?.features?.find((feature) => feature.id === selectedScope.featureId)?.path || '功能节点'
    : selectedScope.type === 'project'
      ? projectById.get(selectedScope.projectId)?.name || '项目'
      : '全部用例';
  const updateRunConfig = (patch) => setSuiteForm((form) => ({ ...form, runConfig: { ...form.runConfig, ...patch } }));
  const updateScheduleConfig = (patch) => setSuiteForm((form) => {
    const next = { ...form.scheduleConfig, ...patch };
    if (patch.frequency === 'off') next.enabled = false;
    if (patch.frequency && patch.frequency !== 'off') next.enabled = true;
    return { ...form, scheduleConfig: next };
  });
  const fallbackProjectId = (form) => filteredSelectionProjectId || scopedProjectId || selectedSuite?.projectId || form.projectId || currentProjectId;
  const toggleSuiteCase = (item, selected) => {
    if (!isEditorView) return;
    if (selected && lockedProjectId && lockedProjectId !== item.projectId) {
      return;
    }
    setSuiteForm((form) => {
      const next = new Set(form.caseIds || []);
      if (selected) next.add(item.id);
      else next.delete(item.id);
      const remainingCases = Array.from(next).map((caseId) => casesById.get(caseId)).filter(Boolean);
      const nextProjectId = remainingCases[0]?.projectId || fallbackProjectId(form);
      return { ...form, projectId: nextProjectId, caseIds: Array.from(next) };
    });
  };
  const setFilteredCasesSelected = (selected) => {
    if (!isEditorView) return;
    if (selected) {
      const targetProjectId = filteredSelectionProjectId;
      if (!targetProjectId) return;
      setSuiteForm((form) => {
        const next = new Set(form.caseIds || []);
        filteredCases.forEach((item) => {
          if (item.projectId === targetProjectId) next.add(item.id);
        });
        return { ...form, projectId: targetProjectId, caseIds: Array.from(next) };
      });
      return;
    }
    setSuiteForm((form) => {
      const next = new Set(form.caseIds || []);
      filteredCases.forEach((item) => next.delete(item.id));
      const remainingCases = Array.from(next).map((caseId) => casesById.get(caseId)).filter(Boolean);
      const nextProjectId = remainingCases[0]?.projectId || fallbackProjectId(form);
      return { ...form, projectId: nextProjectId, caseIds: Array.from(next) };
    });
  };
  const featureCaseCount = (project, feature) => {
    const featureIds = new Set(collectFeatureIds(feature));
    return (project.testCases || []).filter((item) => featureIds.has(item.featureId)).length;
  };
  const toggleProjectExpanded = (projectId) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };
  const toggleFeatureExpanded = (featureId) => {
    setExpandedFeatures((current) => {
      const next = new Set(current);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  };
  const renderFeaturePickerNode = (project, feature, depth = 0) => {
    const isSelected = selectedScope.type === 'feature' && selectedScope.featureId === feature.id;
    const hasChildren = Boolean(feature.children?.length);
    const isExpanded = expandedFeatures.has(feature.id);
    return (
      <div className="suite-feature-node-wrap" key={feature.id}>
        <button
          type="button"
          className={[
            'suite-feature-node',
            isSelected ? 'selected' : '',
            !feature.isActive ? 'disabled-feature' : '',
          ].filter(Boolean).join(' ')}
          style={{ '--feature-depth': depth }}
          onClick={() => setSelectedScope({ type: 'feature', projectId: project.id, featureId: feature.id, featureIds: collectFeatureIds(feature) })}
          aria-expanded={hasChildren ? isExpanded : undefined}
        >
          <span
            className={hasChildren ? 'suite-tree-toggle' : 'suite-tree-toggle placeholder'}
            role="button"
            tabIndex={-1}
            aria-label={isExpanded ? `收起${feature.name}` : `展开${feature.name}`}
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) toggleFeatureExpanded(feature.id);
            }}
          >
            {hasChildren ? <ChevronDown size={14} /> : <CircleDot size={10} />}
          </span>
          <span>
            <strong>{feature.name}</strong>
            <small>{feature.path}</small>
          </span>
          <em>{featureCaseCount(project, feature)} 条</em>
        </button>
        {hasChildren && isExpanded ? (
          <div className="suite-feature-children">
            {feature.children.map((child) => renderFeaturePickerNode(project, child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };
  const startCaseTreeResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = caseTreePanelWidth;
    const handleMove = (moveEvent) => {
      const nextWidth = Math.min(520, Math.max(240, startWidth + moveEvent.clientX - startX));
      setCaseTreePanelWidth(nextWidth);
    };
    const stopResize = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopResize);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopResize);
  };

  const selectedSuiteProject = projectById.get(selectedSuite?.projectId || suiteForm.projectId);
  const suiteEnvironmentProject = lockedProject || selectedSuiteProject;
  const suiteEnvironments = suiteEnvironmentProject?.environments || [];
  useEffect(() => {
    const environmentId = suiteForm.runConfig.environmentId || '';
    if (environmentId && !suiteEnvironments.some((environment) => environment.id === environmentId)) {
      updateRunConfig({ environmentId: '' });
    }
  }, [suiteEnvironmentProject?.id]);
  const detailCases = (selectedSuite?.caseIds || []).map((caseId) => casesById.get(caseId)).filter(Boolean);
  const detailStats = selectedSuite ? suiteCaseStats(selectedSuite, allProjectCases.length ? allProjectCases : testCases) : formStats;
  const weekdayLabels = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const runModeLabel = suiteForm.runConfig.mode === 'serial' ? '稳健串行' : suiteForm.runConfig.mode;
  const failurePolicyLabel = suiteForm.runConfig.failurePolicy === 'stop' ? '失败即停' : '失败继续';
  const suiteEnvironmentLabel = suiteEnvironments.find((environment) => environment.id === suiteForm.runConfig.environmentId)?.name
    || suiteEnvironmentProject?.environments?.find((environment) => environment.isDefault)?.name
    || '项目默认环境';
  const scheduleFrequencyLabel = {
    off: '关闭',
    daily: '每天',
    weekly: '每周',
    interval: '固定间隔',
  }[suiteForm.scheduleConfig.frequency] || suiteForm.scheduleConfig.frequency;
  const returnFromEditor = () => navigateSuite('list');
  const cancelEditor = () => {
    if (suiteView === 'create') {
      returnFromEditor();
      return;
    }
    if (selectedSuite) {
      setSuiteForm(normalizeSuiteForm(selectedSuite));
      notifySuiteEditCancelled?.();
    }
  };
  const openSuiteExecutionDialog = (suite) => {
    if (runningSuiteId) return;
    const project = projectById.get(suite.projectId);
    const environmentId = suite.runConfig?.environmentId || project?.defaultEnvironmentId || '';
    setSuiteExecutionDialog({ open: true, suite, environmentId });
  };
  const confirmSuiteExecution = async () => {
    const suite = suiteExecutionDialog.suite;
    if (!suite || runningSuiteId) return;
    setRunningSuiteId(suite.id);
    try {
      await runSuite(suite.id, suiteExecutionDialog.environmentId);
      setSuiteExecutionDialog({ open: false, suite: null, environmentId: '' });
    } finally {
      setRunningSuiteId('');
    }
  };
  const applySuiteQuery = (event) => {
    event.preventDefault();
    setAppliedSuiteQuery({
      projectId: suiteQueryDraft.projectId || 'all',
      name: suiteQueryDraft.name.trim(),
      status: suiteQueryDraft.status || 'all',
    });
  };
  const resetSuiteQuery = () => {
    const emptyQuery = { projectId: 'all', name: '', status: 'all' };
    setSuiteQueryDraft(emptyQuery);
    setAppliedSuiteQuery(emptyQuery);
  };

  if (suiteView === 'list') {
    return (
      <section className="module-section suite-module suite-list-module" aria-label="测试套件">
        <div className="section-header">
          <div>
            <h2>测试套件</h2>
            <p>共 {managedSuites.length} 个套件。</p>
          </div>
          <div className="action-row">
            <button
              type="button"
              className="primary-action"
              onClick={beginCreateSuite}
              disabled={!canManageAssets}
              title={canManageAssets ? '新建测试套件' : '当前账号无权新建测试套件'}
            >
              <Plus size={17} />
              新建套件
            </button>
          </div>
        </div>

        <form className="data-panel suite-query-panel" aria-label="测试套件查询" onSubmit={applySuiteQuery}>
          <label className="field">
            <span>项目</span>
            <select
              value={suiteQueryDraft.projectId}
              onChange={(event) => setSuiteQueryDraft((current) => ({ ...current, projectId: event.target.value }))}
              data-testid="test-suites-query-project"
            >
              <option value="all">全部项目</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>测试套件名称</span>
            <input
              value={suiteQueryDraft.name}
              onChange={(event) => setSuiteQueryDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="请输入测试套件名称"
              data-testid="test-suites-query-name"
            />
          </label>
          <label className="field">
            <span>状态</span>
            <select
              value={suiteQueryDraft.status}
              onChange={(event) => setSuiteQueryDraft((current) => ({ ...current, status: event.target.value }))}
              data-testid="test-suites-query-status"
            >
              <option value="all">全部状态</option>
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
          </label>
          <div className="suite-query-actions">
            <button type="submit" className="primary-action">
              <Search size={16} />
              查询
            </button>
            <button type="button" className="ghost-button" onClick={resetSuiteQuery}>
              <RefreshCw size={16} />
              重置
            </button>
          </div>
        </form>

        <div className="data-panel suite-list-page">
          <div className="suite-list-summary">
            <span className="muted">显示 {visibleSuites.length}/{managedSuites.length}</span>
          </div>

          <div className="suite-table-scroll">
            <div className="suite-table" role="table" aria-label="测试套件列表">
              <div className="suite-table-row suite-table-head" role="row">
                <span>套件</span>
                <span>所属项目</span>
                <span>状态</span>
                <span>用例数</span>
                <span>自动化</span>
                <span>定时配置</span>
                <span>更新时间</span>
                <span>操作</span>
              </div>
              {visibleSuites.map((suite) => {
                const stats = suiteCaseStats(suite, allProjectCases.length ? allProjectCases : testCases);
                const project = projectById.get(suite.projectId);
                const manageTitle = canManageAssets ? '' : '当前账号无权管理测试套件';
                const caseCount = suite.caseCount ?? suite.caseIds?.length ?? stats.total;
                const executeTitle = runningSuiteId
                  ? runningSuiteId === suite.id ? '正在启动套件执行' : '请等待当前套件启动完成'
                  : suiteExecuteDisabledReason(suite, caseCount);
                return (
                  <div className="suite-table-row" role="row" key={suite.id}>
                    <span className="suite-table-name">
                      <strong>{suite.name}</strong>
                      <small>{suite.description || '暂无描述'}</small>
                    </span>
                    <span>{project?.name || suite.projectId || '-'}</span>
                    <span><i className={`suite-status-badge ${suite.status}`}>{suite.status === 'disabled' ? '停用' : '启用'}</i></span>
                    <span>{caseCount}</span>
                    <span>{stats.automated}</span>
                    <span>{scheduleConfigLabel(suite.scheduleConfig)}</span>
                    <span>{formatDateTime(suite.updatedAt || suite.createdAt)}</span>
                    <span className="suite-row-actions">
                      <button type="button" className="icon-button" onClick={() => selectSuite(suite.id, 'detail')} aria-label="查看详情" title="查看详情">
                        <Eye size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button suite-execute-button"
                        onClick={() => openSuiteExecutionDialog(suite)}
                        disabled={Boolean(executeTitle)}
                        aria-label="执行套件"
                        title={executeTitle || '启动套件执行并进入执行监控'}
                      >
                        {runningSuiteId === suite.id ? <RefreshCw size={15} className="spinning" /> : <Play size={15} />}
                      </button>
                      <button type="button" className="icon-button" onClick={() => selectSuite(suite.id, 'edit')} disabled={!canManageAssets} aria-label="编辑套件" title={manageTitle || '编辑套件'}>
                        <Edit3 size={15} />
                      </button>
                      <button type="button" className="icon-button danger" onClick={() => deleteSuite(suite.id)} disabled={!canManageAssets} aria-label="删除套件" title={manageTitle || '删除套件'}>
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {!visibleSuites.length && (
            <div className="empty-suite-state">
              <ListChecks size={34} />
              <strong>{managedSuites.length ? '没有符合当前条件的套件' : '暂无测试套件'}</strong>
              <span>{managedSuites.length ? '请调整查询条件后重试。' : '新建套件，将常用测试用例沉淀为可复用集合。'}</span>
              {!managedSuites.length && (
                <button type="button" className="primary-action" onClick={beginCreateSuite} disabled={!canManageAssets}>
                  <Plus size={16} />新建套件
                </button>
              )}
            </div>
          )}
        </div>
        {suiteExecutionDialog.open ? (
          <SuiteExecutionDialog
            state={suiteExecutionDialog}
            project={projectById.get(suiteExecutionDialog.suite?.projectId)}
            running={runningSuiteId === suiteExecutionDialog.suite?.id}
            onChange={(environmentId) => setSuiteExecutionDialog((current) => ({ ...current, environmentId }))}
            onClose={() => setSuiteExecutionDialog({ open: false, suite: null, environmentId: '' })}
            onConfirm={confirmSuiteExecution}
          />
        ) : null}
      </section>
    );
  }

  if (suiteRouteLoading) {
    return (
      <section className="module-section suite-module" aria-label="测试套件">
        <div className="data-panel empty-suite-state suite-route-state">
          <RefreshCw size={30} className="spinning" />
          <strong>正在加载测试套件</strong>
          <span>正在读取最新配置和关联用例。</span>
        </div>
      </section>
    );
  }

  if (suiteRouteError || (!selectedSuite && suiteView !== 'create')) {
    return (
      <section className="module-section suite-module" aria-label="测试套件">
        <div className="data-panel empty-suite-state suite-route-state">
          <AlertTriangle size={32} />
          <strong>{suiteRouteError || '套件不存在或已删除'}</strong>
          <span>请返回套件列表后重新选择。</span>
          <button type="button" className="ghost-button" onClick={() => navigateSuite('list')}>
            <ArrowLeft size={16} />返回列表
          </button>
        </div>
      </section>
    );
  }

  if (suiteView === 'detail') {
    return (
      <section className="module-section suite-module" aria-label="测试套件">
        <div className="section-header suite-page-header">
          <div className="suite-page-title">
            <button type="button" className="ghost-button compact" onClick={() => navigateSuite('list')}>
              <ArrowLeft size={16} />返回列表
            </button>
            <div>
              <div className="suite-title-line">
                <h2>{selectedSuite.name}</h2>
                <i className={`suite-status-badge ${selectedSuite.status}`}>{selectedSuite.status === 'disabled' ? '停用' : '启用'}</i>
              </div>
            </div>
          </div>
          <div className="action-row">
            <button type="button" className="ghost-button" onClick={() => openSuiteExecutionDialog(selectedSuite)} disabled={Boolean(executeDisabledReason)} title={executeDisabledReason || '选择环境并启动套件执行'}>
              <Play size={16} />执行套件
            </button>
            <button type="button" className="ghost-button" onClick={() => selectSuite(selectedSuite.id, 'edit')} disabled={!canManageAssets} title={canManageAssets ? '编辑套件' : '当前账号无权编辑测试套件'}>
              <Edit3 size={16} />编辑
            </button>
            <button type="button" className="ghost-button danger-button" onClick={() => deleteSuite(selectedSuite.id)} disabled={!canManageAssets} title={canManageAssets ? '删除套件' : '当前账号无权删除测试套件'}>
              <Trash2 size={16} />删除
            </button>
          </div>
        </div>

        <div className="suite-detail-page">
          <div className="data-panel">
            <div className="panel-heading compact"><h3>基本信息</h3></div>
            <dl className="suite-readonly-grid">
              <div><dt>套件名称</dt><dd>{selectedSuite.name}</dd></div>
              <div><dt>所属项目</dt><dd>{selectedSuiteProject?.name || selectedSuite.projectId || '-'}</dd></div>
              <div><dt>状态</dt><dd>{selectedSuite.status === 'disabled' ? '停用' : '启用'}</dd></div>
              <div><dt>创建时间</dt><dd>{formatDateTime(selectedSuite.createdAt)}</dd></div>
              <div><dt>更新时间</dt><dd>{formatDateTime(selectedSuite.updatedAt)}</dd></div>
              <div className="wide"><dt>描述</dt><dd>{selectedSuite.description || '暂无描述'}</dd></div>
            </dl>
            <div className="suite-metric-grid">
              <div><span>用例数</span><strong>{selectedSuite.caseCount ?? detailStats.total}</strong></div>
              <div><span>自动化覆盖</span><strong>{detailStats.automated}</strong></div>
              <div><span>P0/P1/P2</span><strong>{detailStats.priorities.P0}/{detailStats.priorities.P1}/{detailStats.priorities.P2}</strong></div>
              <div><span>定时配置</span><strong>{scheduleConfigLabel(suiteForm.scheduleConfig)}</strong></div>
            </div>
          </div>

          <div className="suite-detail-config-grid">
            <div className="data-panel">
              <div className="panel-heading compact"><h3>运行配置</h3></div>
              <dl className="suite-readonly-grid compact-grid">
                <div><dt>执行方式</dt><dd>{runModeLabel}</dd></div>
                <div><dt>失败策略</dt><dd>{failurePolicyLabel}</dd></div>
                <div><dt>重试次数</dt><dd>{suiteForm.runConfig.retryCount}</dd></div>
                <div><dt>失败用例</dt><dd>{suiteForm.runConfig.runFailedOnly ? '仅运行上次失败用例' : '运行全部用例'}</dd></div>
                <div className="wide"><dt>默认环境</dt><dd>{suiteEnvironmentLabel}</dd></div>
              </dl>
            </div>
            <div className="data-panel">
              <div className="panel-heading compact"><h3>定时执行配置</h3></div>
              <dl className="suite-readonly-grid compact-grid">
                <div><dt>频率</dt><dd>{scheduleFrequencyLabel}</dd></div>
                <div><dt>计划时间</dt><dd>{suiteForm.scheduleConfig.frequency === 'interval' ? `每 ${suiteForm.scheduleConfig.intervalMinutes} 分钟` : suiteForm.scheduleConfig.frequency === 'off' ? '-' : suiteForm.scheduleConfig.time}</dd></div>
                <div><dt>星期</dt><dd>{suiteForm.scheduleConfig.frequency === 'weekly' ? weekdayLabels[Number(suiteForm.scheduleConfig.weekday)] || '-' : '-'}</dd></div>
                <div><dt>时区</dt><dd>{suiteForm.scheduleConfig.timezone || '-'}</dd></div>
                <div className="wide"><dt>备注</dt><dd>{suiteForm.scheduleConfig.note || '暂无备注'}</dd></div>
              </dl>
            </div>
          </div>

          <div className="data-panel suite-detail-cases">
            <div className="panel-heading compact">
              <h3>关联用例</h3>
              <span className="muted">共 {selectedSuite.caseCount ?? detailCases.length} 条</span>
            </div>
            {detailCases.length ? (
              <div className="suite-detail-case-table">
                <div className="suite-detail-case-row suite-detail-case-head">
                  <span>项目 / 功能</span><span>用例</span><span>优先级</span><span>自动化</span><span>最近结果</span>
                </div>
                {detailCases.map((item) => (
                  <div className="suite-detail-case-row" key={item.id}>
                    <span><strong>{item.projectName || item.projectId}</strong><small>{item.featurePath || '未绑定功能'}</small></span>
                    <span><strong>{item.externalId} · {item.title}</strong><small>{item.specPath || '未绑定可执行 spec'}</small></span>
                    <span>{item.priority || '-'}</span>
                    <span>{statusLabel(item.automationStatus || 'manual')}</span>
                    <span>{item.latestStatus ? statusLabel(item.latestStatus) : '暂无'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-suite-state compact-empty"><ListChecks size={28} /><span>当前套件尚未关联测试用例。</span></div>
            )}
          </div>
        </div>
        {suiteExecutionDialog.open ? (
          <SuiteExecutionDialog
            state={suiteExecutionDialog}
            project={projectById.get(suiteExecutionDialog.suite?.projectId)}
            running={runningSuiteId === suiteExecutionDialog.suite?.id}
            onChange={(environmentId) => setSuiteExecutionDialog((current) => ({ ...current, environmentId }))}
            onClose={() => setSuiteExecutionDialog({ open: false, suite: null, environmentId: '' })}
            onConfirm={confirmSuiteExecution}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="module-section suite-module" aria-label="测试套件">
      <div className="section-header suite-page-header">
        <div className="suite-page-title">
          <button type="button" className="ghost-button compact" onClick={returnFromEditor}>
            <ArrowLeft size={16} />返回列表
          </button>
          <div>
            <h2>{suiteView === 'create' ? '新建测试套件' : `编辑：${selectedSuite?.name || suiteForm.name}`}</h2>
            {suiteView === 'create' ? <p>创建可复用的测试用例集合。</p> : null}
          </div>
        </div>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={cancelEditor}><X size={16} />取消</button>
          <button type="button" className="primary-action" onClick={saveSuite}><Save size={16} />保存套件</button>
        </div>
      </div>

      <div className="suite-editor-page">
        <div className="data-panel">
          <div className="panel-heading compact"><h3>基本信息</h3></div>
          <div className="suite-form-grid">
            <label className="field">
              <span>套件名称</span>
              <input value={suiteForm.name} onChange={(event) => setSuiteForm((form) => ({ ...form, name: event.target.value }))} />
            </label>
            <label className="field">
              <span>状态</span>
              <select value={suiteForm.status} onChange={(event) => setSuiteForm((form) => ({ ...form, status: event.target.value }))}>
                <option value="active">启用</option><option value="disabled">停用</option>
              </select>
            </label>
            <label className="field wide">
              <span>描述</span>
              <textarea value={suiteForm.description} onChange={(event) => setSuiteForm((form) => ({ ...form, description: event.target.value }))} rows={3} />
            </label>
          </div>
          <div className="suite-metric-grid">
            <div><span>用例数</span><strong>{formStats.total}</strong></div>
            <div><span>自动化覆盖</span><strong>{formStats.automated}</strong></div>
            <div><span>P0/P1/P2</span><strong>{formStats.priorities.P0}/{formStats.priorities.P1}/{formStats.priorities.P2}</strong></div>
            <div><span>定时配置</span><strong>{scheduleConfigLabel(suiteForm.scheduleConfig)}</strong></div>
          </div>
        </div>

        <div className="suite-detail-config-grid">
          <div className="data-panel suite-config-panel">
                <div className="panel-heading compact">
                  <h3>运行模式</h3>
                  <span className="muted">仅保存配置，暂不触发执行</span>
                </div>
                <div className="suite-config-grid">
                  <label className="field">
                    <span>执行方式</span>
                    <select value={suiteForm.runConfig.mode} disabled>
                      <option value="serial">稳健串行</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>失败策略</span>
                    <select value={suiteForm.runConfig.failurePolicy} onChange={(event) => updateRunConfig({ failurePolicy: event.target.value })}>
                      <option value="continue">失败继续</option>
                      <option value="stop">失败即停</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>重试次数</span>
                    <input type="number" min="0" max="3" value={suiteForm.runConfig.retryCount} onChange={(event) => updateRunConfig({ retryCount: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>默认运行环境</span>
                    <select value={suiteForm.runConfig.environmentId || ''} disabled={!suiteEnvironmentProject} onChange={(event) => updateRunConfig({ environmentId: event.target.value })} data-testid="suite-default-environment">
                      <option value="">项目默认环境</option>
                      {suiteEnvironments.map((environment) => <option value={environment.id} key={environment.id}>{environment.name}{environment.isDefault ? '（项目默认）' : ''}</option>)}
                    </select>
                  </label>
                  <label className="toggle-field">
                    <input type="checkbox" checked={Boolean(suiteForm.runConfig.runFailedOnly)} onChange={(event) => updateRunConfig({ runFailedOnly: event.target.checked })} />
                    <span>仅运行上次失败用例</span>
                  </label>
                </div>
          </div>
          <div className="data-panel suite-config-panel">
                <div className="panel-heading compact">
                  <h3>定时执行配置</h3>
                  <span className="muted">已配置，待接入执行监控/调度</span>
                </div>
                <div className="suite-config-grid">
                  <label className="field">
                    <span>频率</span>
                    <select value={suiteForm.scheduleConfig.frequency} onChange={(event) => updateScheduleConfig({ frequency: event.target.value })}>
                      <option value="off">关闭</option>
                      <option value="daily">每天</option>
                      <option value="weekly">每周</option>
                      <option value="interval">固定间隔</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>计划时间</span>
                    <input type="time" value={suiteForm.scheduleConfig.time} disabled={suiteForm.scheduleConfig.frequency === 'off' || suiteForm.scheduleConfig.frequency === 'interval'} onChange={(event) => updateScheduleConfig({ time: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>星期</span>
                    <select value={suiteForm.scheduleConfig.weekday} disabled={suiteForm.scheduleConfig.frequency !== 'weekly'} onChange={(event) => updateScheduleConfig({ weekday: event.target.value })}>
                      <option value="1">周一</option>
                      <option value="2">周二</option>
                      <option value="3">周三</option>
                      <option value="4">周四</option>
                      <option value="5">周五</option>
                      <option value="6">周六</option>
                      <option value="7">周日</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>间隔分钟</span>
                    <input type="number" min="5" max="10080" value={suiteForm.scheduleConfig.intervalMinutes} disabled={suiteForm.scheduleConfig.frequency !== 'interval'} onChange={(event) => updateScheduleConfig({ intervalMinutes: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>时区</span>
                    <input value={suiteForm.scheduleConfig.timezone} onChange={(event) => updateScheduleConfig({ timezone: event.target.value })} />
                  </label>
                  <label className="field wide">
                    <span>备注</span>
                    <input value={suiteForm.scheduleConfig.note} onChange={(event) => updateScheduleConfig({ note: event.target.value })} placeholder="例如：每日冒烟，后续接执行监控通知" />
                  </label>
                </div>
                <div className="suite-schedule-note">
                  <CalendarClock size={16} />
                  <span>{scheduleConfigLabel(suiteForm.scheduleConfig)} · 待接入执行监控/调度</span>
                </div>
          </div>
        </div>

        <div className="data-panel suite-case-picker-panel">
                <div className="panel-heading compact">
                  <h3>选择测试用例</h3>
                  <span className="muted">已选 {selectedIds.size} · {lockedProject ? lockedProject.name : '未锁定项目'}</span>
                </div>
                <div
                  className="suite-case-picker"
                  style={{ '--suite-case-tree-width': `${caseTreePanelWidth}px` }}
                >
                  <aside className="suite-case-tree-panel">
                    <label className="search-field">
                      <Search size={15} />
                      <input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="搜索项目名称" />
                    </label>
                    <button
                      type="button"
                      className={selectedScope.type === 'all' ? 'suite-project-node selected' : 'suite-project-node'}
                      onClick={() => setSelectedScope({ type: 'all', projectId: '', featureId: '', featureIds: [] })}
                    >
                      <Database size={15} />
                      <span>
                        <strong>全部用例</strong>
                        <small>所有项目</small>
                      </span>
                      <em>{allProjectCases.filter((item) => visibleProjectIds.has(item.projectId)).length} 条</em>
                    </button>
                    <div className="suite-project-tree">
                      {visibleSuiteProjects.length ? visibleSuiteProjects.map((project) => {
                        const hasFeatureTree = Boolean(project.featureTree?.length);
                        const projectExpanded = expandedProjects.has(project.id);
                        return (
                          <article className="suite-project-group" key={project.id}>
                            <button
                              type="button"
                              className={selectedScope.type === 'project' && selectedScope.projectId === project.id ? 'suite-project-node selected' : 'suite-project-node'}
                              onClick={() => setSelectedScope({ type: 'project', projectId: project.id, featureId: '', featureIds: [] })}
                              aria-expanded={hasFeatureTree ? projectExpanded : undefined}
                            >
                              <span
                                className={hasFeatureTree ? 'suite-tree-toggle' : 'suite-tree-toggle placeholder'}
                                role="button"
                                tabIndex={-1}
                                aria-label={projectExpanded ? `收起${project.name}` : `展开${project.name}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (hasFeatureTree) toggleProjectExpanded(project.id);
                                }}
                              >
                                {hasFeatureTree ? <ChevronDown size={14} /> : <FolderTree size={14} />}
                              </span>
                              <span>
                                <strong>{project.name}</strong>
                                <small>{project.projectCode || project.id}</small>
                              </span>
                              <em>{project.testCases?.length || 0} 条</em>
                            </button>
                            {projectExpanded ? (
                              hasFeatureTree ? (
                                <div className="suite-feature-tree">
                                  {project.featureTree.map((feature) => renderFeaturePickerNode(project, feature, 1))}
                                </div>
                              ) : project.suiteCaseLoadError ? (
                                <p className="muted suite-tree-empty">用例加载失败：{project.suiteCaseLoadError}</p>
                              ) : (
                                <p className="muted suite-tree-empty">暂无功能树</p>
                              )
                            ) : null}
                          </article>
                        );
                      }) : <p className="muted suite-tree-empty">没有匹配的项目。</p>}
                    </div>
                  </aside>
                  <button
                    type="button"
                    className="suite-case-resize-handle"
                    aria-label="调整功能树宽度"
                    title="拖拽调整功能树宽度"
                    onPointerDown={startCaseTreeResize}
                  />
                  <div className="suite-case-list-panel">
                    <div className="suite-picker-summary">
                      <span>{selectedScopeLabel}</span>
                      <span>{filteredCases.length} 条用例 · 第 {currentCasePage}/{caseTotalPages} 页</span>
                      {lockedProject ? <span>套件项目：{lockedProject.name}</span> : <span>选择首条用例后锁定项目</span>}
                    </div>
                    <div className="suite-filter-row suite-case-filter-row">
                      <label className="search-field">
                        <Search size={15} />
                        <input value={caseSearch} onChange={(event) => setCaseSearch(event.target.value)} placeholder="搜索项目、功能、用例 ID、标题、步骤、脚本" />
                      </label>
                      <select value={casePriority} onChange={(event) => setCasePriority(event.target.value)}>
                        <option value="all">全部优先级</option>
                        <option value="P0">P0</option>
                        <option value="P1">P1</option>
                        <option value="P2">P2</option>
                      </select>
                      <button type="button" className="ghost-button" disabled={!canBulkSelectFiltered} title={canBulkSelectFiltered ? '全选当前筛选结果' : '请先选择一个项目或功能后再批量选择'} onClick={() => setFilteredCasesSelected(true)}>
                        <CheckSquare size={15} />
                        全选筛选结果
                      </button>
                      <button type="button" className="ghost-button" onClick={() => setFilteredCasesSelected(false)}>取消筛选选择</button>
                    </div>
                    {lockedProject && <p className="suite-cross-project-note">套件不能包含跨项目用例。当前只能勾选「{lockedProject.name}」下的用例。</p>}
                    <div className="suite-case-table">
                      <div className="suite-case-row suite-case-head">
                        <span>选择</span>
                        <span>项目 / 功能</span>
                        <span>用例</span>
                        <span>优先级</span>
                        <span>自动化</span>
                        <span>最近结果</span>
                      </div>
                      {filteredCases.length ? pagedCases.map((item) => {
                        const crossProjectDisabled = Boolean(lockedProjectId && lockedProjectId !== item.projectId);
                        return (
                          <label className={crossProjectDisabled ? 'suite-case-row disabled-row' : 'suite-case-row'} key={item.id} title={crossProjectDisabled ? '套件不能包含跨项目用例' : ''}>
                            <span className="check-cell">
                              <input type="checkbox" checked={selectedIds.has(item.id)} disabled={crossProjectDisabled} onChange={(event) => toggleSuiteCase(item, event.target.checked)} />
                              选择
                            </span>
                            <span>
                              <strong>{item.projectName || item.projectId}</strong>
                              <small>{item.featurePath || '未绑定功能'}</small>
                            </span>
                            <span>
                              <strong>{item.externalId} · {item.title}</strong>
                              <small>{item.specPath || '未绑定可执行 spec，后续执行时会跳过并提示原因'}</small>
                            </span>
                            <span>{item.priority || '-'}</span>
                            <span>{statusLabel(item.automationStatus || 'manual')}</span>
                            <span>{item.latestStatus ? statusLabel(item.latestStatus) : '暂无'}</span>
                          </label>
                        );
                      }) : <p className="muted">暂无符合条件的用例。</p>}
                    </div>
                    {filteredCases.length ? (
                      <div className="suite-case-pagination">
                        <span>每页 10 条 · 共 {filteredCases.length} 条</span>
                        <div className="action-row">
                          <button type="button" className="ghost-button" disabled={currentCasePage <= 1} onClick={() => setCasePage(1)}>首页</button>
                          <button type="button" className="ghost-button" disabled={currentCasePage <= 1} onClick={() => setCasePage((page) => Math.max(1, page - 1))}>上一页</button>
                          <span>第 {currentCasePage} 页 / 共 {caseTotalPages} 页</span>
                          <button type="button" className="ghost-button" disabled={currentCasePage >= caseTotalPages} onClick={() => setCasePage((page) => Math.min(caseTotalPages, page + 1))}>下一页</button>
                          <button type="button" className="ghost-button" disabled={currentCasePage >= caseTotalPages} onClick={() => setCasePage(caseTotalPages)}>尾页</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
        </div>

        <div className="suite-editor-footer">
          <button type="button" className="ghost-button" onClick={cancelEditor}><X size={16} />取消</button>
          <button type="button" className="primary-action" onClick={saveSuite}><Save size={16} />保存套件</button>
        </div>
      </div>
    </section>
  );
}

function FeatureMenus({ projects, currentProjectId, setCurrentProjectId, features, featureTree, refreshFeatures, fetchJson, setNotice, setError }) {
  const [mode, setMode] = useState('empty');
  const [selectedFeatureId, setSelectedFeatureId] = useState('');
  const [draft, setDraft] = useState({ name: '', description: '', parentId: '', sortOrder: 0, isActive: true });
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const flatTree = useMemo(() => flattenFeatureTree(featureTree), [featureTree]);
  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId) || null;
  const featureOptions = features.filter((feature) => feature.isActive);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleTree = useMemo(() => {
    if (!normalizedSearch) return featureTree;
    const matches = (feature) => [feature.name, feature.path, feature.description].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch);
    const filterNodes = (nodes) => nodes
      .map((node) => {
        const children = filterNodes(node.children || []);
        return matches(node) || children.length ? { ...node, children } : null;
      })
      .filter(Boolean);
    return filterNodes(featureTree);
  }, [featureTree, normalizedSearch]);

  useEffect(() => {
    setExpanded(new Set(features.map((feature) => feature.id)));
  }, [features.length, currentProjectId]);

  useEffect(() => {
    if (!selectedFeatureId) {
      if (features.length && mode === 'empty') {
        const first = features[0];
        setSelectedFeatureId(first.id);
        setMode('view');
      }
      return;
    }
    const current = features.find((feature) => feature.id === selectedFeatureId);
    if (!current) {
      const next = features[0];
      setSelectedFeatureId(next?.id || '');
      setMode(next ? 'view' : 'empty');
    }
  }, [features, selectedFeatureId, mode]);

  useEffect(() => {
    if (mode === 'create') return;
    if (!selectedFeature) return;
    setDraft({
      name: selectedFeature.name || '',
      description: selectedFeature.description || '',
      parentId: selectedFeature.parentId || '',
      sortOrder: selectedFeature.sortOrder || 0,
      isActive: selectedFeature.isActive,
    });
  }, [selectedFeature?.id, selectedFeature?.updatedAt, mode]);

  const beginCreate = (parentId = '') => {
    if (!currentProjectId) {
      setError('请先在项目管理中创建项目。');
      return;
    }
    setMode('create');
    setDraft({ name: '', description: '', parentId, sortOrder: 0, isActive: true });
    if (parentId) {
      setSelectedFeatureId(parentId);
      setExpanded((items) => new Set([...items, parentId]));
    }
  };

  const beginView = (feature) => {
    setSelectedFeatureId(feature.id);
    setMode('view');
  };

  const toggleExpanded = (featureId) => {
    setExpanded((items) => {
      const next = new Set(items);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  };

  const saveCreate = async () => {
    const name = draft.name.trim();
    if (!currentProjectId) {
      setError('请先在项目管理中创建项目。');
      return;
    }
    if (!name) {
      setError('功能名称不能为空');
      return;
    }
    try {
      await fetchJson('/api/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: currentProjectId,
          parent_id: draft.parentId || '',
          name,
          description: draft.description || '',
          sort_order: Number(draft.sortOrder) || 0,
          is_active: Boolean(draft.isActive),
        }),
      });
      const payload = await refreshFeatures();
      const created = (payload.items || []).find((item) => item.name === name && item.parentId === (draft.parentId || ''));
      if (created) setSelectedFeatureId(created.id);
      setMode('view');
      setNotice(draft.parentId ? `已新增子功能：${name}` : `已新增根功能：${name}`);
      setError('');
    } catch (err) {
      setError(`保存功能失败：${err.message}`);
    }
  };

  const updateFeature = async () => {
    if (!selectedFeature) return;
    const name = draft.name.trim();
    if (!name) {
      setError('功能名称不能为空');
      return;
    }
    try {
      await fetchJson(`/api/features/${selectedFeature.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: draft.description || '',
          parent_id: draft.parentId || '',
          sort_order: Number(draft.sortOrder) || 0,
          is_active: Boolean(draft.isActive),
        }),
      });
      await refreshFeatures();
      setNotice(`已更新功能：${name}`);
      setError('');
    } catch (err) {
      setError(`更新功能失败：${err.message}`);
    }
  };

  const deleteFeature = async (feature) => {
    if (!window.confirm(`确认删除功能「${feature.path || feature.name}」？`)) return;
    try {
      await fetchJson(`/api/features/${feature.id}`, { method: 'DELETE' });
      await refreshFeatures();
      setSelectedFeatureId('');
      setMode('empty');
      setNotice(`已删除功能：${feature.name}`);
      setError('');
    } catch (err) {
      setError(`删除功能失败：${err.message}`);
    }
  };

  const renderFeatureNode = (feature, depth = 0) => {
    const hasChildren = Boolean(feature.children?.length);
    const isExpanded = expanded.has(feature.id);
    return (
      <div className="feature-node-wrap" key={feature.id}>
        <article className={`feature-node ${feature.isActive ? '' : 'disabled'} ${selectedFeatureId === feature.id ? 'selected' : ''}`} style={{ '--feature-depth': depth }}>
          <button type="button" className="icon-button" title={isExpanded ? '收起子功能' : '展开子功能'} disabled={!hasChildren} onClick={(event) => { event.stopPropagation(); toggleExpanded(feature.id); }}>
            <ChevronDown size={15} className={isExpanded ? 'open' : ''} />
          </button>
          <button type="button" className="feature-node-main" onClick={() => beginView(feature)}>
            <strong><CircleDot size={14} /> {feature.name}</strong>
            <small>{feature.path}</small>
          </button>
          <span className={feature.isActive ? 'feature-state active' : 'feature-state'}>{feature.isActive ? '启用' : '停用'}</span>
          <span className="feature-count">{feature.caseCount} 条</span>
          <div className="feature-actions">
            <button type="button" className="icon-button" title="新增子功能" onClick={(event) => { event.stopPropagation(); beginCreate(feature.id); }}><Plus size={15} /></button>
          </div>
        </article>
        {hasChildren && isExpanded && (
          <div className="feature-children">
            {feature.children.map((child) => renderFeatureNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const parentOptions = featureOptions.filter((item) => {
    if (mode === 'create' || !selectedFeature) return true;
    return item.id !== selectedFeature.id && !item.path.startsWith(`${selectedFeature.path} /`);
  });
  const activeParentName = draft.parentId ? features.find((feature) => feature.id === draft.parentId)?.path || '已选择父功能' : '根功能';
  const detailTitle = mode === 'create' ? (draft.parentId ? '新增子功能' : '新增根功能') : selectedFeature ? selectedFeature.name : '功能详情';
  const canDelete = mode === 'view' && selectedFeature;

  return (
    <section className="module-section" aria-label="功能配置">
      <div className="section-header">
        <div>
          <h2>功能配置</h2>
          <p>按项目维护产品功能树，并为测试用例提供可追溯的功能归属。</p>
        </div>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={() => refreshFeatures()} disabled={!currentProjectId}>
            <RefreshCw size={16} />
            刷新
          </button>
          <button type="button" className="primary-action" onClick={() => beginCreate('')} disabled={!currentProjectId}>
            <Plus size={17} />
            新增根功能
          </button>
        </div>
      </div>

      <div className="feature-toolbar">
        <label className="field compact-field">
          <span>当前项目</span>
          <select value={currentProjectId} onChange={(event) => setCurrentProjectId(event.target.value)}>
            <option value="">请选择项目</option>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="search-field feature-search">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索功能名称、路径或描述" />
        </label>
        <div className="feature-summary-strip">
          <span>{features.length} 个功能</span>
          <span>{features.reduce((total, feature) => total + (feature.caseCount || 0), 0)} 条直接绑定</span>
        </div>
      </div>

      <div className="feature-manager-layout">
        <aside className="feature-tree-panel" data-testid="feature-menu-tree">
          <div className="feature-tree-title">
            <h3>功能树</h3>
            <span>{normalizedSearch ? `${flatTree.length} 个节点` : '全部层级'}</span>
          </div>
          {visibleTree.length ? visibleTree.map((feature) => renderFeatureNode(feature)) : (
            <div className="empty-state feature-empty">
              <FolderTree size={34} />
              <span>{!currentProjectId ? '暂无项目。请先在项目管理中创建项目。' : features.length ? '没有匹配的功能。' : '暂无功能配置。先新增根功能，再继续添加不限层级的子功能。'}</span>
              {!features.length && currentProjectId && (
                <button type="button" className="primary-action" onClick={() => beginCreate('')}>
                  <Plus size={17} />
                  新增根功能
                </button>
              )}
            </div>
          )}
        </aside>

        <section className="feature-detail-panel data-panel" aria-label="功能详情">
          <div className="panel-heading compact">
            <div>
              <h3>{detailTitle}</h3>
              <p className="muted">{mode === 'create' ? `父级：${activeParentName}` : selectedFeature?.path || '选择左侧功能后查看详情。'}</p>
            </div>
            {canDelete && (
              <button type="button" className="ghost-button danger-button" onClick={() => deleteFeature(selectedFeature)}>
                <Trash2 size={15} />
                删除
              </button>
            )}
          </div>

          {mode === 'empty' && !selectedFeature ? (
            <div className="empty-suite-state">
              <FolderTree size={34} />
              <span>{currentProjectId ? '选择左侧功能查看详情，或新增根功能开始配置。' : '暂无项目。请先在项目管理中创建项目。'}</span>
              <button type="button" className="primary-action" onClick={() => beginCreate('')} disabled={!currentProjectId}>
                <Plus size={17} />
                新增根功能
              </button>
            </div>
          ) : (
            <>
              {selectedFeature && mode === 'view' && (
                <div className="feature-detail-stats">
                  <div><span>完整路径</span><strong>{selectedFeature.path}</strong></div>
                  <div><span>直接绑定</span><strong>{selectedFeature.caseCount} 条用例</strong></div>
                  <div><span>当前状态</span><strong>{selectedFeature.isActive ? '启用' : '停用'}</strong></div>
                </div>
              )}

              <div className="feature-detail-form">
                <label className="field">
                  <span>功能名称</span>
                  <input value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} placeholder="例如 密码登录" />
                </label>
                <label className="field">
                  <span>父功能</span>
                  <select value={draft.parentId} onChange={(event) => setDraft((value) => ({ ...value, parentId: event.target.value }))}>
                    <option value="">根功能</option>
                    {parentOptions.map((feature) => <option value={feature.id} key={feature.id}>{feature.path}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>排序</span>
                  <input type="number" value={draft.sortOrder} onChange={(event) => setDraft((value) => ({ ...value, sortOrder: event.target.value }))} />
                </label>
                <label className="toggle-field feature-toggle">
                  <input type="checkbox" checked={Boolean(draft.isActive)} onChange={(event) => setDraft((value) => ({ ...value, isActive: event.target.checked }))} />
                  <span>启用该功能</span>
                </label>
                <label className="field wide">
                  <span>功能描述</span>
                  <textarea value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} rows={5} placeholder="记录功能范围、页面入口或绑定用例时的判断标准" />
                </label>
              </div>

              <div className="feature-detail-actions">
                {mode === 'create' ? (
                  <>
                    <button type="button" className="primary-action" onClick={saveCreate}>
                      <Save size={16} />
                      保存新增
                    </button>
                    <button type="button" className="ghost-button" onClick={() => selectedFeature ? setMode('view') : setMode('empty')}>取消</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="primary-action" disabled={!selectedFeature} onClick={updateFeature}>
                      <Save size={16} />
                      保存修改
                    </button>
                    <button type="button" className="ghost-button" disabled={!selectedFeature} onClick={() => beginCreate(selectedFeature.id)}>
                      <Plus size={16} />
                      新增子功能
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function CaseManagement({
  projects = [],
  suiteCaseProjects = [],
  testCases,
  features,
  selectedCaseIds,
  toggleCaseSelection,
  setAllVisibleCasesSelected,
  runSelectedCases,
  startCaseDebugBatch,
  debugBatchLoading = false,
  setActiveModule,
  updateCase,
  deleteCase,
  deleteSelectedCases,
  loadScriptVersion,
  scriptEditor,
  openScriptEditor,
  closeScriptEditor,
  updateScriptEditorContent,
  saveScriptEditorDraft,
  enterCaseDebug,
  debugSessionLoading = '',
  canManageAssets = true,
  canExecute = true,
  canEditScripts = true,
  fetchJson,
  reloadData,
  setNotice,
  setGlobalError,
  openImportedVerification,
}) {
  const [projectFilter, setProjectFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [featureFilter, setFeatureFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [casePage, setCasePage] = useState(1);
  const [caseDetail, setCaseDetail] = useState({ open: false, loading: false, error: '', caseItem: null, script: null });
  const [caseEdit, setCaseEdit] = useState({ open: false, saving: false, error: '', caseItem: null, draft: null });
  const [importOpen, setImportOpen] = useState(false);
  const [batchPreflight, setBatchPreflight] = useState({ open: false, loading: false, starting: false, error: '', data: null });
  const caseDetailRequestRef = useRef(0);
  const pageSelectionRef = useRef(null);
  const casePageSize = 10;
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const enrichedCases = useMemo(() => testCases.map((item) => {
    const project = projectById.get(item.projectId);
    return {
      ...item,
      projectName: project?.name || item.projectName || item.projectId || '未归属项目',
      projectCode: project?.projectCode || item.projectCode || '',
    };
  }), [projectById, testCases]);
  const featureOptionsByProject = useMemo(() => {
    const grouped = new Map();
    const rememberFeature = (feature, fallbackProjectId = '') => {
      const projectId = feature.projectId || fallbackProjectId;
      if (!projectId) return;
      if (!grouped.has(projectId)) grouped.set(projectId, new Map());
      grouped.get(projectId).set(feature.id, feature);
    };
    features.forEach((feature) => rememberFeature(feature));
    suiteCaseProjects.forEach((project) => {
      (project.features || []).forEach((feature) => rememberFeature(feature, project.id));
    });
    enrichedCases.forEach((item) => {
      if (!item.projectId || !item.featureId) return;
      if (!grouped.has(item.projectId)) grouped.set(item.projectId, new Map());
      const optionsById = grouped.get(item.projectId);
      if (!optionsById.has(item.featureId)) {
        optionsById.set(item.featureId, {
          id: item.featureId,
          path: item.featurePath || item.featureName || item.featureId,
          isActive: true,
        });
      }
    });
    return grouped;
  }, [enrichedCases, features, suiteCaseProjects]);
  const featureOptions = useMemo(() => {
    if (projectFilter === 'all') return [];
    const optionsById = featureOptionsByProject.get(projectFilter) || new Map();
    return [...optionsById.values()].sort((a, b) => (a.path || '').localeCompare(b.path || '', 'zh-Hans-CN'));
  }, [featureOptionsByProject, projectFilter]);
  const caseEditFeatureOptions = useMemo(() => {
    const optionsById = featureOptionsByProject.get(caseEdit.caseItem?.projectId) || new Map();
    return activeFeatureOptions([...optionsById.values()], caseEdit.draft?.featureId || '')
      .sort((a, b) => (a.path || a.name || '').localeCompare(b.path || b.name || '', 'zh-Hans-CN'));
  }, [caseEdit.caseItem?.projectId, caseEdit.draft?.featureId, featureOptionsByProject]);
  const normalizedSearch = search.trim().toLowerCase();
  useEffect(() => {
    setFeatureFilter('all');
  }, [projectFilter]);
  const filteredCases = enrichedCases.filter((item) => {
    const projectMatches = projectFilter === 'all' || item.projectId === projectFilter;
    const priorityMatches = priorityFilter === 'all' || item.priority === priorityFilter;
    const statusMatches = statusFilter === 'all' || item.automationStatus === statusFilter || item.latestStatus === statusFilter;
    const featureMatches = featureFilter === 'all' || (featureFilter === 'unbound' ? !item.featureId : item.featureId === featureFilter);
    const searchMatches = !normalizedSearch || [
      item.projectName,
      item.projectCode,
      item.projectId,
      item.externalId,
      item.title,
      item.requirement,
      item.steps,
      item.expected,
    ].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch);
    return projectMatches && priorityMatches && statusMatches && featureMatches && searchMatches;
  });
  useEffect(() => {
    setCasePage(1);
  }, [projectFilter, priorityFilter, statusFilter, featureFilter, normalizedSearch]);
  const totalCasePages = Math.max(1, Math.ceil(filteredCases.length / casePageSize));
  const currentCasePage = Math.min(casePage, totalCasePages);
  const pagedCases = filteredCases.slice((currentCasePage - 1) * casePageSize, currentCasePage * casePageSize);
  const selectedCount = selectedCaseIds.size;
  const selectedCases = enrichedCases.filter((item) => selectedCaseIds.has(item.id));
  const selectedProjectId = selectedCases[0]?.projectId || '';
  const selectedPageCount = pagedCases.filter((item) => selectedCaseIds.has(item.id)).length;
  const isPageSelected = pagedCases.length > 0 && selectedPageCount === pagedCases.length;
  const isPagePartiallySelected = selectedPageCount > 0 && !isPageSelected;
  useEffect(() => {
    if (pageSelectionRef.current) pageSelectionRef.current.indeterminate = isPagePartiallySelected;
  }, [isPagePartiallySelected]);

  function resetCaseFilters() {
    setSearch('');
    setProjectFilter('all');
    setPriorityFilter('all');
    setStatusFilter('all');
    setFeatureFilter('all');
    setCasePage(1);
  }

  async function openBatchDebugPreflight() {
    if (selectedCount < 2) return;
    setBatchPreflight({ open: true, loading: true, starting: false, error: '', data: null });
    try {
      const data = await fetchJson('/api/case-debug-batches/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_ids: Array.from(selectedCaseIds) }),
      });
      setBatchPreflight({ open: true, loading: false, starting: false, error: '', data });
    } catch (err) {
      setBatchPreflight({ open: true, loading: false, starting: false, error: err.message, data: null });
    }
  }

  async function confirmBatchDebug() {
    if (!batchPreflight.data) return;
    setBatchPreflight((value) => ({ ...value, starting: true, error: '' }));
    try {
      await startCaseDebugBatch(batchPreflight.data);
      setBatchPreflight({ open: false, loading: false, starting: false, error: '', data: null });
    } catch (err) {
      setBatchPreflight((value) => ({ ...value, starting: false, error: err.message }));
    }
  }

  async function openCaseDetail(caseItem) {
    const requestId = caseDetailRequestRef.current + 1;
    caseDetailRequestRef.current = requestId;
    const scriptVersionId = caseItem?.scriptVersionId || caseItem?.candidateScriptVersionId || '';
    const hasScript = Boolean(scriptVersionId);
    setCaseDetail({ open: true, loading: hasScript, error: '', caseItem, script: null });
    if (!hasScript) return;
    try {
      const script = await loadScriptVersion(scriptVersionId);
      if (caseDetailRequestRef.current !== requestId) return;
      setCaseDetail({ open: true, loading: false, error: '', caseItem, script });
    } catch (err) {
      if (caseDetailRequestRef.current !== requestId) return;
      setCaseDetail({ open: true, loading: false, error: err.message, caseItem, script: null });
    }
  }

  function closeCaseDetail() {
    caseDetailRequestRef.current += 1;
    setCaseDetail((value) => ({ ...value, open: false, loading: false }));
  }

  function openCaseEdit(caseItem) {
    setCaseEdit({
      open: true,
      saving: false,
      error: '',
      caseItem,
      draft: {
        featureId: caseItem.featureId || '',
        title: caseItem.title || '',
        titleMode: caseItem.titleSource || 'manual',
        priority: caseItem.priority || 'P1',
        automationStatus: caseItem.automationStatus || 'manual',
        requirement: caseItem.requirement || '',
        preconditions: caseItem.preconditions || '',
        steps: caseItem.steps || '',
        expected: caseItem.expected || '',
        automationNotes: caseItem.automationNotes || '',
      },
    });
  }

  function closeCaseEdit() {
    setCaseEdit((value) => (value.saving ? value : { ...value, open: false }));
  }

  function updateCaseEditDraft(field, value) {
    setCaseEdit((current) => ({
      ...current,
      error: '',
      draft: { ...current.draft, [field]: value, ...(field === 'title' ? { titleMode: 'manual' } : {}) },
    }));
  }

  async function saveCaseEdit() {
    const title = caseEdit.draft?.title?.trim();
    if (!title) {
      setCaseEdit((value) => ({ ...value, error: '用例名称为必填项。' }));
      return;
    }
    setCaseEdit((value) => ({ ...value, saving: true, error: '' }));
    try {
      await updateCase(caseEdit.caseItem.id, {
        feature_id: caseEdit.draft.featureId || '',
        title,
        title_mode: caseEdit.draft.titleMode || 'manual',
        priority: caseEdit.draft.priority,
        automation_status: caseEdit.draft.automationStatus,
        requirement: caseEdit.draft.requirement.trim(),
        preconditions: caseEdit.draft.preconditions.trim(),
        steps: caseEdit.draft.steps.trim(),
        expected: caseEdit.draft.expected.trim(),
        automation_notes: caseEdit.draft.automationNotes.trim(),
      });
      setCaseEdit((value) => ({ ...value, open: false, saving: false }));
    } catch (err) {
      setCaseEdit((value) => ({ ...value, saving: false, error: err.message }));
    }
  }

  return (
    <section className="module-section" aria-label="用例管理">
      <div className="section-header">
        <div>
          <h2>用例管理</h2>
          <p>结构化管理从 Markdown 解析出的测试用例，并按项目批量加入套件或执行。</p>
        </div>
        <div className="action-row case-management-header-actions">
          <button type="button" className="ghost-button" disabled={!canEditScripts} onClick={() => setImportOpen(true)}>
            <Upload size={17} />
            导入用例与脚本
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={selectedCount !== 1 || !canEditScripts || debugSessionLoading === selectedCases[0]?.id}
            onClick={() => enterCaseDebug(selectedCases[0], 'cases')}
            title={selectedCount > 1 ? '用例设计一次只能进入一条用例' : selectedCount === 0 ? '请先选择一条用例' : '进入所选用例的隔离工作区'}
          >
            <FileCheck2 size={17} />
            {debugSessionLoading === selectedCases[0]?.id ? '进入中...' : `设计已选 ${selectedCount}`}
          </button>
          <button type="button" className="primary-action" disabled={!selectedCount || !canExecute} onClick={() => runSelectedCases()}>
            <Play size={17} />
            执行已选 {selectedCount}
          </button>
          <button type="button" className="ghost-button" disabled={selectedCount < 2 || !canEditScripts || debugBatchLoading} onClick={openBatchDebugPreflight} title={selectedCount === 1 ? '批量调试至少选择两条同项目用例' : '调试已选用例'}>
            {debugBatchLoading ? <RefreshCw className="spin" size={17} /> : <Wrench size={17} />}
            调试已选 {selectedCount}
          </button>
        </div>
      </div>
      <div className="case-tools">
        <div className="list-tools case-filter-grid">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目、用例 ID、标题、步骤、期望结果" />
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} data-testid="case-management-project-filter">
            <option value="all">全部项目</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>{project.name}</option>
            ))}
          </select>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
            <option value="all">全部优先级</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">全部状态</option>
            <option value="designed">已设计</option>
            <option value="automated">已自动化</option>
            <option value="passed">最近通过</option>
            <option value="failed">最近失败</option>
            <option value="skipped">跳过</option>
          </select>
          <select value={featureFilter} onChange={(event) => setFeatureFilter(event.target.value)}>
            <option value="all">全部功能</option>
            <option value="unbound">未绑定功能</option>
            {featureOptions.map((feature) => <option value={feature.id} key={feature.id}>{feature.path}</option>)}
          </select>
          <button
            type="button"
            className="ghost-button case-filter-reset"
            disabled={!search && projectFilter === 'all' && priorityFilter === 'all' && statusFilter === 'all' && featureFilter === 'all'}
            onClick={resetCaseFilters}
            data-testid="case-management-filter-reset"
          >
            <RefreshCw size={16} />
            重置
          </button>
          <div className="case-bulk-actions" aria-label="用例批量操作">
            <button type="button" className="ghost-button danger-button" disabled={!selectedCount || !canManageAssets} onClick={deleteSelectedCases}>
              <Trash2 size={16} />
              删除已选 {selectedCount}
            </button>
          </div>
        </div>
      </div>
      <div className="case-table-scroll" data-testid="case-management-table" role="region" aria-label="用例列表" tabIndex={0}>
        <div className="case-table">
          <div className="case-row case-row-head">
            <label className="check-cell case-select-cell" title="选择本页全部用例">
              <input
                ref={pageSelectionRef}
                type="checkbox"
                aria-label="选择本页全部用例"
                checked={isPageSelected}
                disabled={!pagedCases.length}
                onChange={(event) => setAllVisibleCasesSelected(pagedCases, event.target.checked)}
              />
            </label>
            <span className="case-project-cell">项目</span>
            <span className="case-main-cell">用例名称</span>
            <span className="case-priority-cell">优先级</span>
            <span className="case-feature-cell">功能</span>
            <span className="case-automation-cell">自动化</span>
            <span className="case-result-cell">最近结果</span>
            <span className="case-script-cell">绑定脚本</span>
            <span className="case-action-cell">操作</span>
          </div>
          {filteredCases.length ? pagedCases.map((item) => (
            <div className="case-row" key={item.id}>
              <label className="check-cell case-select-cell">
                <input type="checkbox" aria-label="选择" checked={selectedCaseIds.has(item.id)} disabled={Boolean(selectedProjectId && item.projectId !== selectedProjectId)} title={selectedProjectId && item.projectId !== selectedProjectId ? '多选调试只支持同一项目' : ''} onChange={(event) => toggleCaseSelection(item.id, event.target.checked)} />
              </label>
              <span className="case-data-cell case-project-cell" data-label="项目">
                <strong title={item.projectName}>{item.projectName}</strong>
                <small title={item.projectCode || item.projectId}>{item.projectCode || item.projectId}</small>
              </span>
              <div className="case-data-cell case-main-cell" data-label="用例名称">
                <strong title={item.externalId}>{item.externalId}</strong>
                <span title={item.title}>{item.title}</span>
                <small>{item.titleSource === 'auto' ? '自动生成' : '人工命名'}</small>
              </div>
              <span className="case-data-cell case-priority-cell" data-label="优先级">{item.priority || '-'}</span>
              <div className="case-data-cell case-feature-cell" data-label="功能">
                <span className="case-feature-value" title={item.featurePath || item.featureName || '未绑定功能'}>
                  {item.featurePath || item.featureName || '未绑定'}
                </span>
              </div>
              <div className="case-data-cell case-automation-cell" data-label="自动化">
                <span className={`report-status case-status-pill ${item.automationStatus || 'manual'}`}>{statusLabel(item.automationStatus || 'manual')}</span>
              </div>
              <div className="case-data-cell case-result-cell" data-label="最近结果">
                <span className={`report-status case-status-pill ${item.latestStatus || 'no-report'}`}>{item.latestStatus ? statusLabel(item.latestStatus) : '暂无'}</span>
              </div>
              <span className="case-data-cell case-script-cell" data-label="绑定脚本">
                {item.scriptVersionId ? (
                  <button type="button" className="script-link-button" onClick={() => openScriptEditor(item)} aria-label={`打开绑定脚本 ${item.specPath || item.externalId}`} title={item.specPath || '打开脚本编辑弹窗'}>
                    <FileCode2 size={15} />
                    <span title={item.specPath || '查看脚本'}>{item.specPath || '查看脚本'}</span>
                    <small>v{item.scriptVersion || '-'} · {statusLabel(item.scriptStatus || 'active')}</small>
                  </button>
                ) : item.candidateScriptVersionId ? (
                  <button type="button" className="script-link-button candidate" onClick={() => openScriptEditor(item)} aria-label={`打开待验证脚本 ${item.candidateSpecPath || item.externalId}`} title={item.candidateSpecPath || '打开待验证脚本'}>
                    <FileCode2 size={15} />
                    <span title={item.candidateSpecPath || '待验证共享脚本'}>{item.candidateSpecPath || '待验证共享脚本'}</span>
                    <small>v{item.candidateScriptVersion || '-'} · {item.candidateScriptStatus === 'failed' ? '验证失败' : '待验证'}{item.candidateScriptLayout === 'shared-spec' ? ' · 共享 spec' : ''}</small>
                  </button>
                ) : (
                  <span className="muted">未绑定</span>
                )}
              </span>
              <div className="case-action-cell">
                <button type="button" className="ghost-button case-row-action-button" disabled={!canEditScripts || debugSessionLoading === item.id} onClick={() => enterCaseDebug(item, 'scripts')} aria-label={`调试当前用例 ${item.externalId || item.title || item.id}`} title="调试当前用例">
                  {debugSessionLoading === item.id ? <RefreshCw className="spin" size={16} /> : <Wrench size={16} />}
                </button>
                <button type="button" className="ghost-button case-row-action-button" onClick={() => openCaseDetail(item)} aria-label={`查看用例详情 ${item.externalId || item.title || item.id}`} title="查看详情">
                  <Eye size={16} />
                </button>
                <button type="button" className="ghost-button case-row-action-button" disabled={!canManageAssets} onClick={() => openCaseEdit(item)} aria-label={`编辑用例 ${item.externalId || item.title || item.id}`} title="编辑用例">
                  <Edit3 size={16} />
                </button>
                <button type="button" className="ghost-button danger-button case-delete-button" disabled={!canManageAssets} onClick={() => deleteCase(item)} aria-label={`删除用例 ${item.externalId || item.title || item.id}`} title="删除用例">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          )) : <p className="muted case-table-empty">暂无结构化用例。先在用例设计中保存 Markdown 用例，系统会自动解析入库。</p>}
        </div>
      </div>
      <div className="case-management-pagination">
        <span>{filteredCases.length} 条用例 · 第 {currentCasePage}/{totalCasePages} 页</span>
        <div className="action-row">
          <button type="button" className="ghost-button" disabled={currentCasePage <= 1} onClick={() => setCasePage(1)}>首页</button>
          <button type="button" className="ghost-button" disabled={currentCasePage <= 1} onClick={() => setCasePage((page) => Math.max(1, page - 1))}>上一页</button>
          <span>每页 {casePageSize} 条</span>
          <button type="button" className="ghost-button" disabled={currentCasePage >= totalCasePages} onClick={() => setCasePage((page) => Math.min(totalCasePages, page + 1))}>下一页</button>
          <button type="button" className="ghost-button" disabled={currentCasePage >= totalCasePages} onClick={() => setCasePage(totalCasePages)}>末页</button>
        </div>
      </div>
      {batchPreflight.open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !batchPreflight.starting) setBatchPreflight({ open: false, loading: false, starting: false, error: '', data: null });
        }}>
          <section className="modal-panel case-debug-preflight-modal" role="dialog" aria-modal="true" aria-labelledby="case-debug-preflight-title">
            <header className="modal-header">
              <div>
                <h3 id="case-debug-preflight-title">批量调试预检</h3>
                <p>仅调试当前同一项目中已选择的用例，确认后进入脚本工作台。</p>
              </div>
              <button type="button" className="icon-button" aria-label="关闭" disabled={batchPreflight.starting} onClick={() => setBatchPreflight({ open: false, loading: false, starting: false, error: '', data: null })}><X size={18} /></button>
            </header>
            <div className="modal-body case-debug-preflight-body">
              {batchPreflight.loading ? <p className="muted">正在检查用例版本、脚本和运行环境...</p> : null}
              {batchPreflight.error ? <div className="case-editor-error" role="alert">{batchPreflight.error}</div> : null}
              {batchPreflight.data ? (
                <>
                  <div className="case-debug-preflight-summary">
                    <div><span>项目</span><strong>{batchPreflight.data.project?.name || batchPreflight.data.projectId}</strong></div>
                    <div><span>运行环境</span><strong>{batchPreflight.data.environment?.name || '项目默认环境'}</strong></div>
                    <div><span>可直接执行</span><strong>{batchPreflight.data.readyCases}/{batchPreflight.data.totalCases}</strong></div>
                    <div><span>待人工处理</span><strong>{batchPreflight.data.attentionCases}</strong></div>
                  </div>
                  <div className="case-debug-preflight-list">
                    {batchPreflight.data.items.map((entry) => (
                      <div className="case-debug-preflight-item" key={entry.caseId}>
                        <div><strong>{entry.case?.externalId || entry.caseId}</strong><span>{entry.case?.title || ''}</span></div>
                        <span className={`report-status case-status-pill ${entry.readiness === 'ready' ? 'passed' : 'skipped'}`}>{entry.readiness === 'ready' ? '可执行' : '待处理'}</span>
                        {entry.reason ? <small>{entry.reason}</small> : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
            <footer className="modal-footer">
              <button type="button" className="ghost-button" disabled={batchPreflight.starting} onClick={() => setBatchPreflight({ open: false, loading: false, starting: false, error: '', data: null })}>取消</button>
              <button type="button" className="primary-action" disabled={!batchPreflight.data || batchPreflight.loading || batchPreflight.starting} onClick={confirmBatchDebug}>
                {batchPreflight.starting ? <RefreshCw className="spin" size={16} /> : <Wrench size={16} />}
                {batchPreflight.starting ? '启动中...' : '进入批量调试'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {caseDetail.open && (
        <CaseDetailModal
          state={caseDetail}
          onClose={closeCaseDetail}
          onRetry={() => openCaseDetail(caseDetail.caseItem)}
        />
      )}
      {caseEdit.open && (
        <CaseManagementEditModal
          state={caseEdit}
          featureOptions={caseEditFeatureOptions}
          onChange={updateCaseEditDraft}
          onClose={closeCaseEdit}
          onSave={saveCaseEdit}
        />
      )}
      {scriptEditor?.open && (
        <ScriptEditorModal
          editor={scriptEditor}
          canEdit={canEditScripts}
          onClose={closeScriptEditor}
          onChange={updateScriptEditorContent}
          onSaveDraft={saveScriptEditorDraft}
        />
      )}
      {importOpen && (
        <CaseImportModal
          projects={projects}
          featureOptionsByProject={featureOptionsByProject}
          canConfigureVariables={canManageAssets}
          fetchJson={fetchJson}
          onClose={() => setImportOpen(false)}
          onComplete={async (result, verifying) => {
            setImportOpen(false);
            await reloadData({ preferredProjectId: result.projectId });
            setGlobalError('');
            if (verifying) {
              setNotice(`共享脚本验证中${result.verificationRunId ? `：Run ${result.verificationRunId}` : ''}`);
              await openImportedVerification(result);
            } else {
              setNotice(`已导入 ${result.caseCount} 条用例和待验证共享 Playwright 脚本。`);
            }
          }}
        />
      )}
    </section>
  );
}

function CaseImportModal({ projects, featureOptionsByProject, canConfigureVariables, fetchJson, onClose, onComplete }) {
  const firstProject = projects[0] || null;
  const [projectId, setProjectId] = useState(firstProject?.id || '');
  const [featureId, setFeatureId] = useState('');
  const [environmentId, setEnvironmentId] = useState(firstProject?.defaultEnvironmentId || '');
  const [casesFile, setCasesFile] = useState(null);
  const [specFile, setSpecFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [variables, setVariables] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const project = projects.find((item) => item.id === projectId) || firstProject;
  const environments = project?.environments || [];
  const selectedEnvironment = environments.find((item) => item.id === environmentId)
    || environments.find((item) => item.isDefault)
    || null;
  const features = [...(featureOptionsByProject.get(projectId)?.values() || [])]
    .filter((item) => item.isActive !== false)
    .sort((a, b) => (a.path || a.name || '').localeCompare(b.path || b.name || '', 'zh-Hans-CN'));

  useEffect(() => {
    if (!project) return;
    setEnvironmentId(project.defaultEnvironmentId || project.environments?.[0]?.id || '');
    setFeatureId('');
    setPreview(null);
    setVariables([]);
  }, [projectId]);

  useEffect(() => {
    if (!preview || !environmentId) return;
    let cancelled = false;
    fetchJson(`/api/project-environments/${encodeURIComponent(environmentId)}/variables`)
      .then((payload) => {
        if (cancelled) return;
        const existing = new Map((payload.items || []).map((item) => [item.name, item]));
        setVariables((preview.requiredEnvironmentVariables || []).map((name) => {
          const stored = existing.get(name);
          return {
            name,
            value: stored?.value || '',
            protectedValue: stored?.isSecret ?? /(?:PASSWORD|TOKEN|SECRET|KEY)/.test(name),
            configured: Boolean(stored?.configured),
          };
        }));
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [environmentId, preview?.id]);

  async function runPreview() {
    if (!projectId || !casesFile || !specFile) {
      setError('请选择项目，并同时上传 Markdown 用例和 Playwright spec。');
      return;
    }
    if (!specFile.name.toLowerCase().endsWith('.spec.ts')) {
      setError('自动化脚本必须为 .spec.ts 文件。');
      return;
    }
    const form = new FormData();
    form.append('project_id', projectId);
    form.append('cases_file', casesFile);
    form.append('spec_file', specFile);
    try {
      setBusy('preview');
      setError('');
      const result = await fetchJson('/api/test-case-imports/preview', { method: 'POST', body: form });
      setPreview(result);
      if (!environmentId && result.environmentId) setEnvironmentId(result.environmentId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  function updateVariable(index, field, value) {
    setVariables((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  function selectSpecFile(event) {
    const file = event.currentTarget.files?.[0] || null;
    if (file && !file.name.toLowerCase().endsWith('.spec.ts')) {
      event.currentTarget.value = '';
      setSpecFile(null);
      setPreview(null);
      setError('自动化脚本必须为 .spec.ts 文件。');
      return;
    }
    setError('');
    setSpecFile(file);
  }

  async function saveVariables() {
    if (!environmentId || !variables.length || !canConfigureVariables) return;
    await fetchJson(`/api/project-environments/${encodeURIComponent(environmentId)}/variables`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: variables.map((item) => ({ name: item.name, value: item.value, is_secret: item.protectedValue })),
      }),
    });
  }

  async function commit(verifying) {
    if (!preview) return;
    try {
      setBusy(verifying ? 'verify' : 'commit');
      setError('');
      if (canConfigureVariables && variables.some((item) => item.value)) await saveVariables();
      const result = await fetchJson(`/api/test-case-imports/${encodeURIComponent(preview.id)}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, feature_id: featureId, environment_id: environmentId, verify: verifying }),
      });
      await onComplete(result, verifying);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const configuredNames = new Set(variables.filter((item) => item.configured || item.value).map((item) => item.name));
  const missingNames = (preview?.requiredEnvironmentVariables || []).filter((name) => !configuredNames.has(name));
  const canVerify = Boolean(environmentId && !missingNames.length);

  return createPortal(
    <div className="artifact-preview-modal case-import-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="artifact-preview-modal-card case-import-card" role="dialog" aria-modal="true" aria-label="导入测试用例与 Playwright 脚本">
        <header className="artifact-renderer-header modal case-detail-header">
          <div><h3>导入测试用例与脚本</h3><p>{preview ? `${preview.caseCount} 条用例 · ${preview.testCount} 条 Playwright 测试` : 'Markdown + TypeScript spec'}</p></div>
          <button type="button" className="artifact-modal-close" disabled={Boolean(busy)} onClick={onClose} aria-label="关闭导入弹窗"><X size={18} /></button>
        </header>
        <div className="case-import-body">
          <div className="case-import-form-grid">
            <label className="field">
              <span>项目 *</span>
              <select value={projectId} disabled={Boolean(preview) || Boolean(busy)} onChange={(event) => setProjectId(event.target.value)}>
                {projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>功能</span>
              <select value={featureId} disabled={Boolean(busy)} onChange={(event) => setFeatureId(event.target.value)}>
                <option value="">未绑定</option>
                {features.map((item) => <option value={item.id} key={item.id}>{item.path || item.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Markdown 用例 *</span>
              <input type="file" accept=".md,text/markdown" disabled={Boolean(preview) || Boolean(busy)} onChange={(event) => setCasesFile(event.target.files?.[0] || null)} />
            </label>
            <label className="field">
              <span>Playwright spec *</span>
              <input type="file" accept=".ts,text/typescript,application/typescript,text/plain" disabled={Boolean(preview) || Boolean(busy)} onChange={selectSpecFile} />
            </label>
          </div>
          {!preview ? (
            <div className="case-import-empty"><Upload size={22} /><span>选择两个文件后执行预检。</span></div>
          ) : (
            <>
              <section className="case-import-section" aria-label="用例绑定预览">
                <div className="case-import-section-heading"><h4>用例绑定</h4><span>{preview.bindings.length}/{preview.caseCount}</span></div>
                <div className="case-import-bindings">
                  {preview.bindings.map((item) => (
                    <div key={item.externalId}><strong>{item.externalId}</strong><span>{item.caseTitle}</span><small>{item.testTitle}</small></div>
                  ))}
                </div>
              </section>
              <section className="case-import-section" aria-label="运行环境变量">
                <div className="case-import-section-heading"><h4>运行环境</h4><span>Playwright {preview.playwrightVersion || '-'}</span></div>
                <label className="field">
                  <span>验证环境</span>
                  <select value={environmentId} disabled={Boolean(busy)} onChange={(event) => setEnvironmentId(event.target.value)}>
                    <option value="">未配置环境</option>
                    {environments.map((item) => <option value={item.id} key={item.id}>{item.name}{item.isDefault ? '（默认）' : ''}</option>)}
                  </select>
                </label>
                <div className="case-import-base-url" data-testid="case-import-base-url">
                  <span>Base URL</span>
                  <strong>{selectedEnvironment?.url || project?.targetUrl || '未配置'}</strong>
                  <small>平台运行时通过 QA_TARGET_URL 注入；无需配置原项目的 QA_BASE_URL。</small>
                </div>
                <div className="case-import-variables">
                  {variables.map((item, index) => (
                    <div className="case-import-variable" key={item.name}>
                      <KeyRound size={16} />
                      <strong>{item.name}</strong>
                      <input
                        type={item.protectedValue ? 'password' : 'text'}
                        value={item.value}
                        disabled={!canConfigureVariables || Boolean(busy)}
                        placeholder={item.configured ? '已配置，留空保持不变' : '未配置'}
                        onChange={(event) => updateVariable(index, 'value', event.target.value)}
                      />
                      <label className="check-cell"><input type="checkbox" checked={item.protectedValue} disabled={!canConfigureVariables || Boolean(busy)} onChange={(event) => updateVariable(index, 'protectedValue', event.target.checked)} />密钥</label>
                    </div>
                  ))}
                </div>
                {missingNames.length ? (
                  <div className="case-import-missing-variables" data-testid="case-import-missing-variables" role="status">
                    <AlertTriangle size={16} />
                    <span>导入并验证还缺少：{missingNames.join('、')}</span>
                  </div>
                ) : null}
              </section>
            </>
          )}
          {error && <div className="case-editor-error" role="alert">{error}</div>}
        </div>
        <footer className="case-edit-footer case-import-footer" data-testid="case-import-footer">
          <span>{preview ? `共享 spec · ${preview.requiredEnvironmentVariables?.length || 0} 个运行变量` : '预检不会执行目标系统测试。'}</span>
          <div className="action-row">
            <button type="button" className="ghost-button" disabled={Boolean(busy)} onClick={onClose}>取消</button>
            {!preview ? (
              <button type="button" className="primary-action" disabled={Boolean(busy) || !projectId || !casesFile || !specFile} onClick={runPreview}><Search size={16} />{busy === 'preview' ? '预检中...' : '开始预检'}</button>
            ) : (
              <>
                <button type="button" className="ghost-button" disabled={Boolean(busy)} onClick={() => commit(false)}>{busy === 'commit' ? '导入中...' : '仅导入用例库'}</button>
                <button type="button" className="primary-action" disabled={Boolean(busy) || !canVerify} title={missingNames.length ? `缺少：${missingNames.join('、')}` : ''} onClick={() => commit(true)}><Play size={16} />{busy === 'verify' ? '启动中...' : '导入并验证'}</button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function CaseManagementEditModal({ state, featureOptions = [], onChange, onClose, onSave }) {
  const firstFieldRef = useRef(null);
  const caseItem = state.caseItem || {};
  const draft = state.draft || {};

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !state.saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [state.saving]);

  return createPortal(
    <div className="artifact-preview-modal case-edit-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="artifact-preview-modal-card case-edit-card" role="dialog" aria-modal="true" aria-label={`编辑用例 ${caseItem.externalId || caseItem.title || ''}`}>
        <header className="artifact-renderer-header modal case-detail-header">
          <div>
            <h3>编辑用例</h3>
            <p>{caseItem.externalId || '-'} · {caseItem.projectName || '未归属项目'}</p>
          </div>
          <button type="button" className="artifact-modal-close" disabled={state.saving} title="关闭用例编辑弹窗" aria-label="关闭用例编辑弹窗" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="case-edit-body">
          <div className="case-edit-readonly-grid" aria-label="只读信息">
            <div><span>项目</span><strong>{caseItem.projectName || '未归属项目'}</strong></div>
            <div><span>用例 ID</span><strong>{caseItem.externalId || '-'}</strong></div>
          </div>
          <div className="case-edit-form-grid">
            <label className="field case-edit-wide-field case-edit-feature-field">
              <span>功能</span>
              <select aria-label="功能" value={draft.featureId || ''} disabled={state.saving} onChange={(event) => onChange('featureId', event.target.value)}>
                <option value="">未绑定</option>
                {featureOptions.map((feature) => (
                  <option value={feature.id} key={feature.id}>{feature.path || feature.name || feature.id}{feature.isActive ? '' : '（停用）'}</option>
                ))}
              </select>
            </label>
            <div className="field case-edit-title-field">
              <span className="name-field-heading">
                <span>用例名称 *</span>
                {draft.titleMode === 'auto' ? <span className="source-chip">自动生成</span> : null}
              </span>
              <input ref={firstFieldRef} aria-label="用例名称" value={draft.title || ''} disabled={state.saving} onChange={(event) => onChange('title', event.target.value)} />
              {caseItem.canRestoreAutoTitle && draft.titleMode !== 'auto' && (
                <button type="button" className="ghost-button compact name-mode-reset" disabled={state.saving} onClick={() => onChange('titleMode', 'auto')}>
                  <RefreshCw size={14} />
                  恢复自动生成
                </button>
              )}
            </div>
            <label className="field">
              <span>优先级</span>
              <select aria-label="优先级" value={draft.priority || 'P1'} disabled={state.saving} onChange={(event) => onChange('priority', event.target.value)}>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
              </select>
            </label>
            <label className="field">
              <span>自动化状态</span>
              <select aria-label="自动化状态" value={draft.automationStatus || 'manual'} disabled={state.saving} onChange={(event) => onChange('automationStatus', event.target.value)}>
                <option value="manual">手工</option>
                <option value="designed">已设计</option>
                <option value="automated">已自动化</option>
              </select>
            </label>
            {[
              ['requirement', '覆盖需求'],
              ['preconditions', '前置条件 / 测试数据'],
              ['steps', '测试步骤'],
              ['expected', '期望结果'],
              ['automationNotes', '自动化说明'],
            ].map(([field, label]) => (
              <label className="field case-edit-wide-field" key={field}>
                <span>{label}</span>
                <textarea aria-label={label} value={draft[field] || ''} disabled={state.saving} onChange={(event) => onChange(field, event.target.value)} />
              </label>
            ))}
          </div>
          {state.error ? <div className="case-editor-error" role="alert">{state.error}</div> : null}
        </div>
        <footer className="case-edit-footer">
          <span>项目、用例 ID 为只读信息；脚本绑定请通过列表中的脚本入口维护。</span>
          <div className="action-row">
            <button type="button" className="ghost-button" disabled={state.saving} onClick={onClose}>取消</button>
            <button type="button" className="primary-action" disabled={state.saving} onClick={onSave}>
              <Save size={16} />
              {state.saving ? '保存中...' : '保存修改'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function CaseDetailModal({ state, onClose, onRetry }) {
  const caseItem = state.caseItem || {};
  const script = state.script || {};
  const boundCases = script.boundCases || [];
  const hasActiveScript = Boolean(caseItem.scriptVersionId);
  const hasCandidateScript = Boolean(caseItem.candidateScriptVersionId);
  const hasAnyScript = hasActiveScript || hasCandidateScript;
  const displayValue = (value, fallback = '-') => value || fallback;
  const caseContent = [
    ['覆盖需求', caseItem.requirement],
    ['前置条件 / 测试数据', caseItem.preconditions],
    ['测试步骤', caseItem.steps],
    ['期望结果', caseItem.expected],
    ['自动化说明', caseItem.automationNotes],
  ];

  return (
    <div className="artifact-preview-modal case-detail-modal" role="dialog" aria-modal="true" aria-label={`用例详情 ${caseItem.externalId || caseItem.title || ''}`}>
      <div className="artifact-preview-modal-card case-detail-card">
        <header className="artifact-renderer-header modal case-detail-header">
          <div>
            <h3>{displayValue(caseItem.title, '用例详情')}</h3>
            <p>{displayValue(caseItem.externalId)} · {displayValue(caseItem.projectName, '未归属项目')}</p>
          </div>
          <button type="button" className="artifact-modal-close" title="关闭用例详情" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="case-detail-body">
          <section className="case-detail-section" aria-label="用例基本信息">
            <h4>基本信息</h4>
            <dl className="case-detail-meta-grid">
              <div><dt>项目</dt><dd>{displayValue(caseItem.projectName, '未归属项目')}</dd></div>
              <div><dt>项目编码</dt><dd>{displayValue(caseItem.projectCode || caseItem.projectId)}</dd></div>
              <div><dt>用例 ID</dt><dd>{displayValue(caseItem.externalId)}</dd></div>
              <div><dt>优先级</dt><dd>{displayValue(caseItem.priority)}</dd></div>
              <div><dt>功能</dt><dd>{displayValue(caseItem.featurePath || caseItem.featureName, '未绑定')}</dd></div>
              <div><dt>自动化状态</dt><dd>{statusLabel(caseItem.automationStatus || 'manual')}</dd></div>
              <div><dt>最近结果</dt><dd>{caseItem.latestStatus ? statusLabel(caseItem.latestStatus) : '暂无'}</dd></div>
              <div><dt>最近 Run</dt><dd>{displayValue(caseItem.latestRunId, '暂无')}</dd></div>
              <div><dt>创建时间</dt><dd>{formatDateTime(caseItem.createdAt)}</dd></div>
              <div><dt>更新时间</dt><dd>{formatDateTime(caseItem.updatedAt)}</dd></div>
            </dl>
          </section>

          <section className="case-detail-section" aria-label="用例内容">
            <h4>用例内容</h4>
            <dl className="case-detail-content-list">
              {caseContent.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{displayValue(value, '暂无')}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="case-detail-section" aria-label="绑定脚本信息">
            <div className="case-detail-section-heading">
              <h4>{hasActiveScript ? '绑定脚本' : hasCandidateScript ? '待验证脚本' : '绑定脚本'}</h4>
              {hasAnyScript ? <span>版本 {script.version || caseItem.scriptVersion || caseItem.candidateScriptVersion || '-'}</span> : null}
            </div>
            {!hasAnyScript ? (
              <div className="case-detail-empty">
                <FileCode2 size={20} />
                <span>当前用例未绑定脚本。</span>
              </div>
            ) : state.loading ? (
              <div className="case-detail-empty">
                <RefreshCw className="case-detail-loading-icon" size={20} />
                <span>正在加载绑定脚本...</span>
              </div>
            ) : state.error ? (
              <div className="case-detail-script-error" role="alert">
                <div>
                  <strong>脚本加载失败</strong>
                  <span>{state.error}</span>
                </div>
                <button type="button" className="ghost-button compact" onClick={onRetry}>
                  <RefreshCw size={15} />
                  重新加载
                </button>
              </div>
            ) : (
              <>
                <dl className="case-detail-meta-grid script">
                  <div><dt>脚本路径</dt><dd>{displayValue(script.specPath || caseItem.specPath || caseItem.candidateSpecPath)}</dd></div>
                  <div><dt>版本状态</dt><dd>v{script.version || caseItem.scriptVersion || caseItem.candidateScriptVersion || '-'} · {hasActiveScript ? statusLabel(script.status || caseItem.scriptStatus || 'active') : caseItem.candidateScriptStatus === 'failed' ? '验证失败' : '待验证'}</dd></div>
                  <div><dt>所属工单</dt><dd>{displayValue(script.workItem?.title || script.workItemId)}</dd></div>
                  <div><dt>验证 Run</dt><dd>{displayValue(script.verifiedRunId, '未验证')}</dd></div>
                  <div><dt>绑定用例</dt><dd>{boundCases.length || (caseItem.id ? 1 : 0)} 条</dd></div>
                  <div><dt>脚本更新时间</dt><dd>{formatDateTime(script.updatedAt || script.createdAt)}</dd></div>
                </dl>
                {boundCases.length ? (
                  <div className="case-detail-bindings">
                    <h5>绑定关系</h5>
                    {boundCases.map((item) => (
                      <div key={item.id}>
                        <strong>{item.externalId} · {item.title}</strong>
                        <span>{item.isActive ? '当前绑定' : '历史绑定'} · {item.testTitle || item.grepPattern || '未记录测试标题'}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="case-detail-code-block">
                  <div><span>脚本代码</span><strong>只读</strong></div>
                  <pre><code>{script.content || '暂无脚本内容'}</code></pre>
                </div>
              </>
            )}
          </section>
        </div>
        <footer className="case-detail-footer">
          <span>详情内容为只读；脚本修改请使用列表中的绑定脚本入口。</span>
          <button type="button" className="ghost-button" onClick={onClose}>关闭</button>
        </footer>
      </div>
    </div>
  );
}

function ScriptEditorModal({ editor, canEdit, onClose, onChange, onSaveDraft }) {
  const detail = editor.detail || {};
  const sourceCase = editor.sourceCase || {};
  const boundCases = detail.boundCases || [];
  const title = detail.scriptName || (sourceCase.externalId ? `${sourceCase.externalId} ${sourceCase.title || '绑定脚本'}` : '绑定脚本');
  return (
    <div className="artifact-preview-modal script-editor-modal" role="dialog" aria-modal="true" aria-label="脚本编辑弹窗">
      <div className="artifact-preview-modal-card script-editor-card">
        <header className="artifact-renderer-header modal script-editor-header">
          <div>
            <h3>{title}</h3>
            <p>{editor.loading ? '正在加载脚本内容...' : `${detail.specPath || sourceCase.specPath || '未记录路径'} · v${detail.version || sourceCase.scriptVersion || '-'} · ${statusLabel(detail.status || sourceCase.scriptStatus || 'active')}`}</p>
          </div>
          <button type="button" className="artifact-modal-close" title="关闭脚本编辑器" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="script-editor-meta">
          <div><span>保存规则</span><strong>另存草稿，不替换 active</strong></div>
          <div><span>所属工单</span><strong>{detail.workItem?.title || detail.workItemId || '-'}</strong></div>
          <div><span>验证 Run</span><strong>{detail.verifiedRunId || '未验证'}</strong></div>
          <div><span>绑定用例</span><strong>{boundCases.length || (sourceCase.id ? 1 : 0)} 条</strong></div>
        </div>
        {editor.error ? <div className="script-editor-error" role="alert">{editor.error}</div> : null}
        <div className="script-editor-body">
          {editor.loading ? (
            <div className="artifact-render-empty inline">
              <strong>正在读取脚本版本</strong>
              <span>请稍候。</span>
            </div>
          ) : (
            <textarea
              className="editor code script-editor-textarea"
              value={editor.content}
              disabled={!canEdit || editor.saving}
              onChange={(event) => onChange(event.target.value)}
              placeholder="在这里编辑 Playwright TypeScript 脚本。"
            />
          )}
        </div>
        <footer className="script-editor-footer">
          <span>{canEdit ? '保存后会创建新的 draft 版本，运行验证通过后再发布。' : '当前账号为只读权限，不能保存草稿。'}</span>
          <div className="action-row">
            <button type="button" className="ghost-button" onClick={onClose}>关闭</button>
            <button type="button" className="primary-action" disabled={!canEdit || editor.loading || editor.saving} onClick={onSaveDraft}>
              <Save size={16} />
              {editor.saving ? '保存中...' : '另存草稿'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function AutomationFlow({
  projects,
  selectedProjectId,
  selectedFeatureId,
  featureTree,
  featureOptions,
  onProjectChange,
  onFeatureChange,
  requirement,
  setRequirement,
  flow,
  logs,
  flowArtifacts,
  status,
  activeStage,
  liveConnected,
  browserStatus,
  browserStatusDetail,
  browserLiveConnected,
  browserSessionId,
  browserMode,
  browserHasFrame,
  browserPreviewEnabled,
  setBrowserPreviewEnabled,
  historyItems,
  historyLoading,
  historyError,
  restoringHistoryId,
  browserCanvasRef,
  sendBrowserCommand,
  handleBrowserClick,
  handleBrowserMove,
  handleBrowserWheel,
  handleBrowserKeyDown,
  loadHistory,
  restoreHistory,
  startFlow,
  stopFlow,
  stoppingFlow = false,
  retryExploration,
  retryingExploration = false,
  clearFlow,
  openManualWorkbench,
  logRef,
  resetKey,
  canRunFlow = true,
}) {
  const [technicalLogsOpen, setTechnicalLogsOpen] = useState(false);
  const [technicalLogsUserClosed, setTechnicalLogsUserClosed] = useState(false);
  const [technicalLogsMaximized, setTechnicalLogsMaximized] = useState(false);
  const [logFollowEnabled, setLogFollowEnabled] = useState(true);
  const [selectedArtifactId, setSelectedArtifactId] = useState('');
  const [artifactTab, setArtifactTab] = useState('preview');
  const [artifactListTab, setArtifactListTab] = useState('directory');
  const [clarificationOpen, setClarificationOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const clarificationRef = useRef(null);
  const artifactRef = useRef(null);
  const historyRef = useRef(null);
  const flowChatRef = useRef(null);
  const browserShellRef = useRef(null);
  const technicalLogStreamRef = useRef(null);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const activeIndex = activeStage ? AUTOMATION_FLOW_STAGES.indexOf(activeStage) : -1;
  const isTerminalFailure = ['blocked', 'failed'].includes(status);
  const isPartialCompletion = isPartialAutomationFlow(flow, status);
  const accountDataBlock = status === 'blocked'
    && (activeStage || flow?.stage) === '需求分析'
    && ['missing-account', 'invalid-account'].includes(flow?.dataResolution?.source);
  const invalidAccountBlock = flow?.dataResolution?.source === 'invalid-account';
  const accountIssueFields = [
    ...(flow?.dataResolution?.missingFields || []),
    ...(flow?.dataResolution?.invalidFields || []),
  ].filter((field, index, values) => values.indexOf(field) === index).map((field) => ({
    id: field,
    label: credentialFieldLabel(field),
  }));
  const outcomeCounts = flow?.outcome?.counts || {};
  const outcomeIssues = (flow?.outcome?.caseResults || []).filter((caseResult) => caseResult.status !== 'passed');
  const visibleArtifacts = orderFlowArtifacts(flowArtifacts, activeStage);
  const hasRunningArtifact = flowArtifacts.some((artifact) => artifact.status === 'streaming');
  const stageBrief = buildStageBrief(activeStage, status, flowArtifacts, logs, flow);
  const conversationMessages = buildFlowConversationMessages({ requirement, flow, logs, artifacts: flowArtifacts, activeStage, status });
  const stageSummaries = buildStageSummaries(AUTOMATION_FLOW_STAGES, flowArtifacts, logs, activeStage, status, flow);
  const clarificationItems = buildClarificationItems({ flow, logs, activeStage, status });
  const issueLogs = logs.filter((log) => ['error', 'blocked', 'warning'].includes(log.level));
  const severeLogs = logs.filter((log) => ['error', 'blocked'].includes(log.level));
  const shouldShowManualHandoff = isPartialCompletion || (isTerminalFailure && (activeStage || flow?.stage) === '自愈诊断');
  const manualHandoffReason = isPartialCompletion
    ? (flow?.outcome?.warnings || []).slice(0, 3).join('；') || '部分用例未通过或未执行，已保留到用例库等待继续调试。'
    : flow?.error || severeLogs[severeLogs.length - 1]?.message || '自动自愈未能完成，请转入人工工作台继续处理。';
  const latestTechnicalLog = logs[logs.length - 1];
  const structuredLogCount = logs.filter((log) => log.stepKey || log.stepLabel).length;
  const shouldShowTechnicalLogs = technicalLogsOpen;
  const selectedArtifact = flowArtifacts.find((artifact) => artifact.id === selectedArtifactId) || visibleArtifacts[0] || null;
  const progress = flow?.progress ?? (status === 'completed' ? 100 : 0);
  const progressLabel = Math.max(0, Math.min(100, progress));
  const currentStage = activeStage || flow?.stage || '等待开始';
  const shouldShowBrowserPanel = Boolean(browserSessionId || ['页面探索', '运行验证'].includes(currentStage) || ['running', 'healing'].includes(status));
  const browserIsExecution = browserMode === 'execution';
  const browserTitle = browserIsExecution ? '运行验证实时浏览器' : '页面探索实时浏览器';
  const browserStageLabel = browserStatusDetail || currentStage;
  const browserControlsDisabled = !browserPreviewEnabled || !browserLiveConnected;
  const browserFullscreenDisabled = !browserPreviewEnabled || !browserIsExecution || !browserSessionId;
  const flatFeatureTree = useMemo(() => flattenFeatureTree(featureTree), [featureTree]);
  const selectableFeatures = activeFeatureOptions(flatFeatureTree.length ? flatFeatureTree : featureOptions, selectedFeatureId);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const selectedFeature = selectableFeatures.find((feature) => feature.id === selectedFeatureId) || null;
  const hasProject = Boolean(selectedProjectId);
  const hasFeature = Boolean(selectedFeatureId);
  const isBusy = ['running', 'queued', 'healing'].includes(status);
  const canStart = canRunFlow && !isBusy && hasProject && hasFeature;
  const canStop = isBusy && Boolean(flow?.id || flow?.flowRunId);
  const canRetryExploration = ['failed', 'blocked'].includes(status)
    && ['页面探索', '脚本实现'].includes(activeStage || flow?.stage)
    && /页面探索|探索证据|页面状态证据|已确认交互控件|猜测 locator/i.test(flow?.error || '');
  const startHint = !canRunFlow ? '当前账号无权启动全流程' : !hasProject ? '请选择项目名称' : !hasFeature ? '请选择功能' : '';
  const stopHint = canStop ? '停止当前一键自动化流程' : '没有正在执行的一键流程';
  const scrollLogsToLatest = (behavior = 'smooth') => {
    const node = technicalLogStreamRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  };
  const toggleTechnicalLogs = () => {
    if (technicalLogsOpen) {
      setTechnicalLogsOpen(false);
      setTechnicalLogsUserClosed(true);
      setTechnicalLogsMaximized(false);
      setLogFollowEnabled(false);
      return;
    }
    setTechnicalLogsOpen(true);
    setTechnicalLogsUserClosed(false);
    setLogFollowEnabled(true);
    requestAnimationFrame(() => scrollLogsToLatest('auto'));
  };
  const toggleTechnicalLogsMaximized = () => {
    const nextMaximized = !technicalLogsMaximized;
    setTechnicalLogsMaximized(nextMaximized);
    if (nextMaximized) {
      setTechnicalLogsOpen(true);
      setTechnicalLogsUserClosed(false);
    }
  };
  const handleTechnicalLogScroll = () => {
    const node = technicalLogStreamRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setLogFollowEnabled(distanceFromBottom <= 32);
  };
  const resumeLogFollow = () => {
    setLogFollowEnabled(true);
    scrollLogsToLatest();
  };
  const scrollToClarification = () => {
    if (clarificationOpen) {
      setClarificationOpen(false);
      return;
    }
    setClarificationOpen(true);
    requestAnimationFrame(() => {
      clarificationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };
  const scrollToArtifacts = () => {
    if (artifactOpen) {
      setArtifactOpen(false);
      return;
    }
    setArtifactOpen(true);
    requestAnimationFrame(() => {
      artifactRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };
  const toggleHistory = () => {
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    if (nextOpen) {
      loadHistory();
      requestAnimationFrame(() => {
        historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  };
  const selectArtifact = (artifactId) => {
    setSelectedArtifactId(artifactId);
    setArtifactOpen(true);
  };
  const toggleBrowserFullscreen = async () => {
    const shell = browserShellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
      } else {
        await shell.requestFullscreen();
      }
    } catch (err) {
      console.warn('切换实时浏览器全屏失败', err);
    }
  };
  const latestConversationMessage = conversationMessages[conversationMessages.length - 1];

  useEffect(() => {
    setTechnicalLogsOpen(false);
    setTechnicalLogsUserClosed(false);
    setTechnicalLogsMaximized(false);
    setLogFollowEnabled(true);
    setSelectedArtifactId('');
    setArtifactTab('preview');
    setArtifactListTab('directory');
    setClarificationOpen(false);
    setArtifactOpen(false);
    setHistoryOpen(false);
  }, [resetKey]);

  useEffect(() => {
    setTechnicalLogsUserClosed(false);
    setTechnicalLogsMaximized(false);
    setLogFollowEnabled(true);
    setTechnicalLogsOpen(['running', 'queued', 'healing'].includes(status));
  }, [flow?.id, flow?.flowRunId]);

  useEffect(() => {
    if (!technicalLogsMaximized) return undefined;
    const previousOverflow = document.body.style.overflow;
    const exitOnEscape = (event) => {
      if (event.key === 'Escape') setTechnicalLogsMaximized(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', exitOnEscape);
    };
  }, [technicalLogsMaximized]);

  useEffect(() => {
    if (isBusy && logs.length && !technicalLogsUserClosed) {
      setTechnicalLogsOpen(true);
    }
  }, [isBusy, logs.length, technicalLogsUserClosed]);

  useEffect(() => {
    if (!technicalLogsOpen || !logFollowEnabled) return undefined;
    const frameId = requestAnimationFrame(() => scrollLogsToLatest('auto'));
    return () => cancelAnimationFrame(frameId);
  }, [technicalLogsOpen, logFollowEnabled, latestTechnicalLog?.id]);

  useEffect(() => {
    const node = flowChatRef.current;
    if (!node) return undefined;
    const frameId = requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(frameId);
  }, [
    conversationMessages.length,
    latestConversationMessage?.id,
    latestConversationMessage?.time,
    status,
    activeStage,
    flowArtifacts.length,
    logs.length,
  ]);

  useEffect(() => {
    const updateFullscreenState = () => {
      setBrowserFullscreen(document.fullscreenElement === browserShellRef.current);
    };
    document.addEventListener('fullscreenchange', updateFullscreenState);
    updateFullscreenState();
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);

  useEffect(() => {
    if (!browserFullscreen) return undefined;
    const exitOnEscape = (event) => {
      if (event.key === 'Escape' && document.fullscreenElement === browserShellRef.current) {
        document.exitFullscreen();
      }
    };
    document.addEventListener('keydown', exitOnEscape);
    return () => document.removeEventListener('keydown', exitOnEscape);
  }, [browserFullscreen]);

  return (
    <section className="module-section automation-flow-page" aria-label="一键自动化" data-testid="automation-flow-page">
      <div className="section-header automation-flow-header">
        <div>
          <h2>一键自动化</h2>
          <p>端到端自动编排：输入需求后创建工单并自动推进用例设计、页面探索、脚本生成、运行验证、自愈诊断和产物保存。</p>
        </div>
        <span className={`automation-run-status ${automationFlowStatusClass(status, flow)}`}>{automationFlowStatusLabel(status, flow)}</span>
      </div>

      <section className="flow-command-panel" aria-label="需求输入与运行控制">
        <div className="automation-context-fields" aria-label="全流程绑定上下文">
          <label>
            <span><Database size={15} /> 项目名称 <b>必填</b></span>
            <select
              data-testid="automation-flow-project"
              value={selectedProjectId}
              onChange={(event) => onProjectChange(event.target.value)}
              disabled={isBusy}
            >
              <option value="">请选择项目</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span><FolderTree size={15} /> 功能 <b>必填</b></span>
            <select
              data-testid="automation-flow-feature"
              value={selectedFeatureId}
              onChange={(event) => onFeatureChange(event.target.value)}
              disabled={isBusy || !selectedProjectId || !selectableFeatures.length}
            >
              <option value="">{selectedProjectId && !selectableFeatures.length ? '当前项目暂无可选功能' : '请选择功能'}</option>
              {selectableFeatures.map((feature) => (
                <option value={feature.id} key={feature.id}>
                  {`${'　'.repeat(feature.depth || 0)}${feature.path || feature.name}${feature.isActive ? '' : '（停用）'}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="automation-requirement-field">
            <span><FileText size={15} /> 需求输入</span>
          <textarea
            data-testid="automation-flow-input"
            value={requirement}
            placeholder="输入需求、PRD、验收标准、缺陷描述或页面说明。请尽量包含 URL、角色、账号/测试数据、验收标准和排除项。"
            onChange={(event) => setRequirement(event.target.value)}
            maxLength={2000}
          />
          <small>{requirement.length} / 2000</small>
        </label>
        <div className="flow-command-footer">
          <div className="action-row automation-actions">
            <button type="button" className="primary-action" disabled={!canStart} onClick={startFlow} title={startHint}>
              <Play size={17} />
              开始一键流程
            </button>
            <button
              type="button"
              className="ghost-button stop-flow-button"
              disabled={!canStop || stoppingFlow}
              onClick={stopFlow}
              title={stopHint}
            >
              <Square size={15} />
              {stoppingFlow ? '停止中' : '停止'}
            </button>
            {canRetryExploration && (
              <button
                type="button"
                className="ghost-button"
                disabled={retryingExploration}
                onClick={retryExploration}
                title="保留原工单和原用例，重新执行页面探索"
              >
                <RefreshCw size={16} />
                {retryingExploration ? '重试中' : '重试页面探索'}
              </button>
            )}
            <button
              type="button"
              className="ghost-button"
              onClick={scrollToClarification}
              aria-expanded={clarificationOpen}
              aria-controls="automation-flow-clarification"
            >
              <ListChecks size={17} />
              过程澄清
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={scrollToArtifacts}
              aria-expanded={artifactOpen}
              aria-controls="automation-flow-artifact-preview"
            >
              <ScrollText size={17} />
              交付物
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={toggleHistory}
              aria-expanded={historyOpen}
              aria-controls="automation-flow-history"
            >
              <History size={17} />
              历史记录
            </button>
            <button type="button" className="ghost-button" onClick={clearFlow}>
              <RefreshCw size={17} />
              清空会话
            </button>
          </div>
          <section className="automation-result-panel" aria-label="全流程运行摘要" data-testid="automation-flow-result">
            <div>
              <span>当前阶段</span>
              <strong>{currentStage}</strong>
            </div>
            <div>
              <span>实时同步</span>
              <strong className={liveConnected ? 'connected' : ''}>{liveConnected ? '已连接' : flow ? '轮询兜底' : '未连接'}</strong>
            </div>
            <div>
              <span>绑定项目</span>
              <strong>{selectedProject?.name || '-'}</strong>
            </div>
            <div>
              <span>绑定功能</span>
              <strong>{selectedFeature?.path || selectedFeature?.name || '-'}</strong>
            </div>
            <div data-testid="automation-data-resolution">
              <span>数据依赖</span>
              <strong>{flow?.dataResolution?.label || '待判定'}</strong>
            </div>
            <div>
              <span>数据来源</span>
              <strong>{({ user: '用户提供', api: '只读接口', page: '页面发现', 'missing-account': '待补账号', 'invalid-account': '凭据有误', 'provider-required': '待配置 Provider', unresolved: '未解析' })[flow?.dataResolution?.source] || '-'}</strong>
            </div>
            <div data-testid="automation-outcome-p0-passed">
              <span>P0 通过</span>
              <strong>{flow?.outcome ? outcomeCounts.p0Passed || 0 : '-'}</strong>
            </div>
            <div data-testid="automation-outcome-failed">
              <span>失败</span>
              <strong>{flow?.outcome ? outcomeCounts.failed || 0 : '-'}</strong>
            </div>
            <div data-testid="automation-outcome-not-run">
              <span>未执行</span>
              <strong>{flow?.outcome ? (outcomeCounts.blocked || 0) + (outcomeCounts.notRun || 0) : '-'}</strong>
            </div>
          </section>
        </div>
        {outcomeIssues.length > 0 && (
          <section className="automation-outcome-issues" aria-label="未通过用例明细" data-testid="automation-outcome-issues">
            <strong>未通过或未执行用例</strong>
            <ul>
              {outcomeIssues.map((caseResult) => (
                <li key={caseResult.caseId || caseResult.externalId}>
                  <span>{caseResult.priority || 'P1'} · {caseResult.externalId || caseResult.caseId}</span>
                  <p>{caseResult.reason || statusLabel(caseResult.status)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {historyOpen && (
          <AutomationFlowHistoryPanel
            id="automation-flow-history"
            ref={historyRef}
            items={historyItems}
            loading={historyLoading}
            error={historyError}
            activeFlowId={flow?.flowRunId || flow?.id || ''}
            restoringId={restoringHistoryId}
            onRefresh={loadHistory}
            onRestore={restoreHistory}
          />
        )}
      </section>

      {accountDataBlock && (
        <section className="automation-data-blocker" role="alert" data-testid="automation-missing-account-blocker">
          <span className="automation-data-blocker-icon" aria-hidden="true">
            <AlertTriangle size={20} />
          </span>
          <div>
            <strong>{invalidAccountBlock ? '登录凭据无法确认，后续场景未执行' : '登录凭据不完整，后续场景未执行'}</strong>
            <p>{flow?.dataResolution?.reason || flow?.error || '登录凭据未达到可执行条件，已停止一键自动化。'}</p>
            {accountIssueFields.length > 0 && (
              <div className="automation-data-blocker-fields" aria-label={invalidAccountBlock ? '无法确认的登录凭据' : '缺少的登录凭据'}>
                {accountIssueFields.map((field) => <span key={field.id}>{field.label}</span>)}
              </div>
            )}
            <small>{flow?.dataResolution?.actionRequired || '请在需求中明确补充登录用户名和密码，然后重新启动一键流程。'}</small>
          </div>
        </section>
      )}

      {shouldShowManualHandoff && (
        <section className={`automation-manual-handoff ${isPartialCompletion ? 'partial' : ''}`} role="alert" data-testid="automation-manual-handoff">
          <span className="automation-manual-handoff-icon" aria-hidden="true">
            <AlertTriangle size={20} />
          </span>
          <div>
            <strong>{isPartialCompletion ? '已完成部分验证，可继续人工调试' : '自动自愈未能完成，需要人工处理'}</strong>
            <p>{manualHandoffReason}</p>
            <small>{isPartialCompletion ? '未通过用例已入库并标记失败；通过脚本已发布，候选脚本不会激活。' : '进入人工工作台后，可查看失败运行、自愈轮次、诊断报告和 Playwright HTML Report。'}</small>
          </div>
          <button type="button" className="primary-action" onClick={openManualWorkbench}>
            <Wrench size={16} />
            前往人工工作台
          </button>
        </section>
      )}

      <section className="automation-stage-strip" aria-label="阶段进度" data-testid="automation-flow-stages">
        {stageSummaries.map((item, index) => {
          const Icon = item.icon;
          return (
            <article className={`automation-stage ${item.state}`} key={item.stage}>
              <span className="automation-stage-node">
                <Icon size={16} />
              </span>
              <strong>{item.stage}</strong>
              <small>{stageStateLabel(item.state)}</small>
              <em>{String(index + 1).padStart(2, '0')}</em>
            </article>
          );
        })}
      </section>

      {shouldShowBrowserPanel && (
        <section className={`automation-flow-browser-panel ${browserIsExecution ? 'execution' : 'exploration'}`} aria-label={browserTitle} data-testid="automation-flow-browser-preview">
          <div className="panel-heading">
            <div>
              <h3><MonitorPlay size={16} /> {browserTitle}</h3>
              <p className="muted">{browserIsExecution ? '画面来自正在执行的真实测试 page；执行期间保持只读预览。' : '画面来自页面探索的真实浏览器会话，可暂停、接管或继续自动探索。'}</p>
            </div>
            <div className="browser-preview-heading-actions">
              <BrowserPreviewToggle
                enabled={browserPreviewEnabled}
                onChange={setBrowserPreviewEnabled}
                testId="automation-flow-browser-preview-toggle"
              />
              <span className={browserLiveConnected ? 'preview-status running' : 'preview-status'}>{browserStageLabel} · {browserStatus}</span>
            </div>
          </div>
          <div className="exploration-runtime automation-browser-runtime" data-testid="automation-flow-browser-runtime">
            <div>
              <span>浏览器会话</span>
              <strong>{browserSessionId || '-'}</strong>
            </div>
            <div>
              <span>实时连接</span>
              <strong>{browserPreviewEnabled ? (browserLiveConnected ? 'Live WebSocket' : '未连接') : '已关闭'} · {browserStatus}</strong>
            </div>
            <div>
              <span>当前阶段</span>
              <strong>{currentStage}</strong>
            </div>
            <div>
              <span>全流程进度</span>
              <strong>{progressLabel}%</strong>
            </div>
          </div>
          <div className="mini-progress" aria-label="全流程实时浏览器进度">
            <span style={{ width: `${Math.max(4, progressLabel)}%` }} />
          </div>
          <div className="live-browser-shell automation-live-browser-shell" ref={browserShellRef} data-testid="automation-flow-browser-shell">
            <div className="browser-live-toolbar">
              <span>{browserIsExecution ? '只读执行预览' : '可人工接管'} · {browserStatus}</span>
              <div className="action-row">
                {browserIsExecution && (
                  <button
                    type="button"
                    className="ghost-button"
                    data-testid="automation-flow-browser-fullscreen"
                    disabled={browserFullscreenDisabled}
                    title={browserFullscreen ? '退出全屏' : '全屏展示'}
                    aria-pressed={browserFullscreen}
                    onClick={toggleBrowserFullscreen}
                  >
                    <Maximize2 size={15} />
                    {browserFullscreen ? '退出全屏' : '全屏展示'}
                  </button>
                )}
                {!browserIsExecution && (
                  <>
                    <button
                      type="button"
                      className="ghost-button"
                      data-testid="automation-flow-browser-pause"
                      disabled={browserControlsDisabled}
                      onClick={() => sendBrowserCommand({ type: 'control', action: 'pause' })}
                    >
                      暂停
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      data-testid="automation-flow-browser-takeover"
                      disabled={browserControlsDisabled}
                      onClick={() => sendBrowserCommand({ type: 'control', action: 'takeover' })}
                    >
                      人工接管
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      data-testid="automation-flow-browser-resume"
                      disabled={browserControlsDisabled}
                      onClick={() => sendBrowserCommand({ type: 'control', action: 'resume' })}
                    >
                      继续
                    </button>
                  </>
                )}
              </div>
            </div>
            <canvas
              ref={browserCanvasRef}
              className="browser-live-canvas automation-flow-live-canvas"
              data-testid="automation-flow-browser-live-canvas"
              tabIndex={browserPreviewEnabled && !browserIsExecution ? 0 : -1}
              aria-label={browserIsExecution ? '一键自动化运行验证实时浏览器只读预览' : '一键自动化页面探索实时浏览器控制画布'}
              onClick={browserPreviewEnabled ? handleBrowserClick : undefined}
              onMouseMove={browserPreviewEnabled ? handleBrowserMove : undefined}
              onWheel={browserPreviewEnabled ? handleBrowserWheel : undefined}
              onKeyDown={browserPreviewEnabled ? handleBrowserKeyDown : undefined}
            />
            {(!browserLiveConnected || !browserHasFrame) && (
              <div className="preview-placeholder live-overlay">
                <MonitorPlay size={38} />
                <span>{!browserPreviewEnabled ? '实时预览已关闭，打开开关后连接浏览器画面。' : browserSessionId ? '正在连接实时浏览器画面。' : '进入页面探索或运行验证后连接实时浏览器。'}</span>
              </div>
            )}
          </div>
        </section>
      )}

      <div className={`automation-flow-layout ${clarificationOpen ? 'clarification-open' : 'clarification-closed'} ${artifactOpen ? 'artifact-open' : 'artifact-closed'}`}>
        {clarificationOpen && (
          <section
            className="automation-flow-panel"
            aria-label="过程澄清"
            id="automation-flow-clarification"
            data-testid="automation-flow-clarification"
            ref={clarificationRef}
          >
            <section className={`clarification-panel ${isTerminalFailure ? 'attention' : ''}`} aria-label="过程澄清">
              <div className="panel-heading compact">
                <div>
                  <h3>过程澄清</h3>
                  <p className="muted">按阶段汇总缺失信息、风险提示和继续推进条件。</p>
                </div>
                <span className={`clarification-count ${issueLogs.length ? 'attention' : 'ok'}`}>{issueLogs.length ? `${issueLogs.length} 项` : '无阻塞'}</span>
              </div>
              <div className="clarification-list">
                {clarificationItems.map((item) => {
                  const Icon = item.tone === 'danger' ? AlertTriangle : item.tone === 'warning' ? AlertTriangle : CheckCircle2;
                  return (
                    <article className={`clarification-item ${item.tone}`} key={item.id}>
                      <Icon size={16} />
                      <div>
                        <span>{item.stage}</span>
                        <strong>{item.title}</strong>
                        <p>{item.message}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </section>
        )}

        <section className="automation-flow-panel" aria-label="流程会话">
          <section className={`flow-chat-panel ${isTerminalFailure ? 'attention' : ''}`} aria-label="客户交付会话" data-testid="automation-flow-live">
            <div className="flow-chat-heading">
              <Bot size={18} />
              <div>
                <h3>流程会话</h3>
                <p>{hasRunningArtifact ? '正在实时生成产物内容。' : '阶段结论和交付物会按会话顺序沉淀。'}</p>
              </div>
              <span className={hasRunningArtifact ? 'live-status streaming' : `live-status ${status}`}>{hasRunningArtifact ? 'AI 生成中' : statusLabel(status)}</span>
            </div>

            <div className="flow-chat-stream" aria-label="流程播报" ref={flowChatRef}>
              {conversationMessages.length ? conversationMessages.map((message) => (
                <FlowChatMessage message={message} onSelectArtifact={selectArtifact} key={message.id} />
              )) : (
                <FlowChatMessage message={{
                  id: 'idle',
                  role: 'assistant',
                  tone: 'idle',
                  time: '',
                  title: '等待开始',
                  body: '输入需求后，我会像交付对话一样展示需求理解、用例设计、页面探索、脚本实现、运行验证和最终报告。',
                  attachments: [],
                }} onSelectArtifact={selectArtifact} />
              )}
            </div>
          </section>
        </section>

        {artifactOpen && (
          <section
            className="automation-flow-panel automation-flow-right"
            aria-label="交付物目录"
            id="automation-flow-artifact-preview"
            data-testid="automation-flow-artifact-preview"
            ref={artifactRef}
          >
            <ArtifactWorkspace
              artifacts={visibleArtifacts}
              selectedArtifact={selectedArtifact}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={setSelectedArtifactId}
              hasRunningArtifact={hasRunningArtifact}
              listTab={artifactListTab}
              setListTab={setArtifactListTab}
              detailTab={artifactTab}
              setDetailTab={setArtifactTab}
            />
          </section>
        )}
      </div>

      <section
        className={`technical-log-panel ${shouldShowTechnicalLogs ? 'open' : ''} ${technicalLogsMaximized ? 'maximized' : ''}`}
        aria-label="技术明细"
        aria-modal={technicalLogsMaximized ? 'true' : undefined}
        data-testid="automation-flow-logs"
        data-maximized={technicalLogsMaximized ? 'true' : 'false'}
        ref={logRef}
        role={technicalLogsMaximized ? 'dialog' : undefined}
      >
        <div className="technical-log-header">
          <button type="button" className="technical-log-summary" onClick={toggleTechnicalLogs} aria-expanded={shouldShowTechnicalLogs}>
            <div>
              <span>实时日志</span>
              <strong>{structuredLogCount} 个步骤 / {severeLogs.length} 个错误 / {issueLogs.length - severeLogs.length} 个警告</strong>
            </div>
            <small>{latestTechnicalLog ? `${latestTechnicalLog.stage} · ${latestTechnicalLog.stepLabel || latestTechnicalLog.message}` : '暂无底层执行日志'}</small>
            <ChevronDown size={16} className={shouldShowTechnicalLogs ? 'open' : ''} />
          </button>
          <button
            type="button"
            className="icon-button technical-log-maximize"
            onClick={toggleTechnicalLogsMaximized}
            aria-label={technicalLogsMaximized ? '退出实时日志最大化' : '最大化实时日志'}
            aria-pressed={technicalLogsMaximized}
            title={technicalLogsMaximized ? '退出最大化（Esc）' : '最大化展示'}
          >
            {technicalLogsMaximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
        {shouldShowTechnicalLogs && !logFollowEnabled && (
          <div className="automation-log-follow-bar">
            <span>已暂停自动跟随，当前可查看较早步骤。</span>
            <button type="button" className="ghost-button" onClick={resumeLogFollow}>
              <ArrowDown size={14} />
              回到最新
            </button>
          </div>
        )}
        <div
          ref={technicalLogStreamRef}
          className={`automation-log-stream ${shouldShowTechnicalLogs ? 'expanded' : 'collapsed'}`}
          aria-hidden={!shouldShowTechnicalLogs}
          data-testid="automation-flow-log-stream"
          onScroll={handleTechnicalLogScroll}
        >
          {logs.length ? logs.map((log) => {
            const detailEntries = flowLogDetailEntries(log);
            const duration = formatFlowLogDuration(log.durationMs);
            const round = log.details?.round;
            const linkedRunId = log.linkedRunId || log.details?.runId;
            const stepStatus = log.stepStatus || log.level;
            return (
              <article key={log.id} className={`automation-log-line ${log.level} ${log.stepStatus || ''}`}>
                <div className="automation-log-line-main">
                  <span>[{formatDetailedLogTime(log.createdAt)}]</span>
                  <strong>[{log.stage}]</strong>
                  <em className={`automation-log-status ${stepStatus}`}>{flowLogStepStatusLabel(log.stepStatus, log.level)}</em>
                  {log.stepLabel ? <b>{log.stepLabel}</b> : null}
                </div>
                <p>{log.message}</p>
                {(duration || round || linkedRunId || log.evidencePath || detailEntries.length > 0) && (
                  <div className="automation-log-meta">
                    {duration ? <span><Clock size={12} /> 耗时 {duration}</span> : null}
                    {round ? <span>轮次 {round}</span> : null}
                    {linkedRunId ? <span>Run {linkedRunId}</span> : null}
                    {detailEntries.map(([key, value]) => <span key={`${log.id}-${key}`}>{key}: {value}</span>)}
                    {log.evidencePath ? <span className="automation-log-evidence">证据：{log.evidencePath}</span> : null}
                  </div>
                )}
              </article>
            );
          }) : <p className="automation-log-line muted">等待流程开始。</p>}
        </div>
      </section>
    </section>
  );
}

const AutomationFlowHistoryPanel = React.forwardRef(function AutomationFlowHistoryPanel({
  id,
  items,
  loading,
  error,
  activeFlowId,
  restoringId,
  onRefresh,
  onRestore,
}, ref) {
  return (
    <section className="automation-history-panel" id={id} ref={ref} aria-label="全流程历史记录" data-testid="automation-flow-history">
      <div className="panel-heading compact">
        <div>
          <h3><History size={16} /> 历史记录</h3>
          <p className="muted">选择历史流程后恢复需求、阶段、日志和交付物。</p>
        </div>
        <button type="button" className="ghost-button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} />
          刷新
        </button>
      </div>
      {error && <p className="history-state error">{error}</p>}
      {loading && <p className="history-state">正在加载历史记录...</p>}
      {!loading && !items.length && !error && <p className="history-state">暂无历史流程记录。</p>}
      <div className="automation-history-list">
        {items.map((item) => {
          const flowRunId = item.flowRunId || item.id;
          const workItem = item.workItem || {};
          const isActive = flowRunId && flowRunId === activeFlowId;
          const featureLabel = item.featurePath || item.featureName || workItem.featurePath || workItem.featureName || '-';
          const title = workItem.title || `全流程 ${flowRunId}`;
          const requirementSummary = summarizeContent(workItem.requirement || item.error || title, '暂无需求摘要');
          return (
            <button
              type="button"
              className={`automation-history-item ${isActive ? 'active' : ''}`}
              data-testid="automation-flow-history-item"
              onClick={() => onRestore(flowRunId)}
              disabled={!flowRunId || restoringId === flowRunId}
              key={flowRunId}
            >
              <span className={`automation-run-status ${automationFlowStatusClass(item.status, item)}`}>{automationFlowStatusLabel(item.status, item)}</span>
              <span className="history-item-main">
                <strong>{title}</strong>
                <small>{requirementSummary}</small>
              </span>
              <span className="history-item-meta">
                <em>{formatDateTime(item.startedAt)}</em>
                <em>{item.stage || '-'} · {item.progress ?? 0}%</em>
                <em>{featureLabel}</em>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
});

function ArtifactWorkspace({ artifacts, selectedArtifact, selectedArtifactId, onSelectArtifact, hasRunningArtifact, listTab, setListTab, detailTab, setDetailTab }) {
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [expandedStages, setExpandedStages] = useState(() => new Set());
  const [touchedStages, setTouchedStages] = useState(() => new Set());
  const displayArtifacts = buildDisplayArtifacts(artifacts);
  const groupedArtifacts = groupArtifactsByStage(displayArtifacts);
  const stageGroups = AUTOMATION_FLOW_STAGES.filter((stage) => groupedArtifacts.get(stage)?.length);
  const versionItems = [...displayArtifacts].sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0));
  const activeArtifact = displayArtifacts.find((artifact) => artifact.id === selectedArtifactId) || selectedArtifact || displayArtifacts[0] || null;
  const activeArtifactUrl = artifactReportUrl(activeArtifact);

  useEffect(() => {
    if (!previewExpanded) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setPreviewExpanded(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewExpanded]);

  useEffect(() => {
    setExpandedStages((current) => {
      const next = new Set(current);
      let changed = false;
      stageGroups.forEach((stage) => {
        if (!next.has(stage) && !touchedStages.has(stage)) {
          next.add(stage);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [stageGroups.join('|'), touchedStages]);

  const toggleStage = (stage) => {
    setTouchedStages((current) => {
      const next = new Set(current);
      next.add(stage);
      return next;
    });
    setExpandedStages((current) => {
      const next = new Set(current);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  return (
    <>
      <ArtifactTestAnchors artifacts={artifacts} />
      <div className="panel-heading compact">
        <div>
          <h3><ScrollText size={16} /> 交付物</h3>
          <p className="muted">{hasRunningArtifact ? '当前产物正在流式写入，详情会同步更新。' : '查看全流程生成的可审阅产物。'}</p>
        </div>
        <span className={hasRunningArtifact ? 'artifact-live-indicator streaming' : 'artifact-live-indicator'}>{hasRunningArtifact ? '生成中' : '就绪'}</span>
      </div>

      <div className="artifact-workspace">
        <section className="artifact-browser" aria-label="产物目录">
          <div className="artifact-tabs">
            <button type="button" className={listTab === 'directory' ? 'active' : ''} onClick={() => setListTab('directory')}>产物目录</button>
            <button type="button" className={listTab === 'versions' ? 'active' : ''} onClick={() => setListTab('versions')}>版本记录</button>
          </div>
          <div className="artifact-tree">
            {displayArtifacts.length ? (
              listTab === 'directory' ? (
                stageGroups.map((stage) => {
                  const stageArtifacts = groupedArtifacts.get(stage) || [];
                  const expanded = expandedStages.has(stage);
                  const groupId = `artifact-stage-${stage}`;
                  return (
                    <div className={`artifact-stage-group ${expanded ? 'expanded' : 'collapsed'}`} key={stage}>
                      <button
                        type="button"
                        className="artifact-stage-toggle"
                        aria-expanded={expanded}
                        aria-controls={groupId}
                        onClick={() => toggleStage(stage)}
                      >
                        <ChevronDown size={13} className={expanded ? 'open' : ''} />
                        {stage} ({stageArtifacts.length})
                      </button>
                      {expanded && (
                        <div className="artifact-stage-items" id={groupId}>
                          {stageArtifacts.map((artifact) => (
                            <ArtifactTreeItem artifact={artifact} active={selectedArtifactId === artifact.id} onSelect={() => onSelectArtifact(artifact.id)} key={artifact.id} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                versionItems.map((artifact) => (
                  <ArtifactTreeItem artifact={artifact} active={selectedArtifactId === artifact.id} onSelect={() => onSelectArtifact(artifact.id)} showTime key={artifact.id} />
                ))
              )
            ) : (
              <div className="artifact-empty compact">
                <strong>等待阶段产物</strong>
                <span>启动全流程后，这里会展示需求抽取、测试用例、探索计划、脚本、自愈修复和最终报告。</span>
              </div>
            )}
          </div>
        </section>

        <section className="artifact-renderer" aria-label="产物预览">
          {activeArtifact ? (
            <>
              <header className="artifact-renderer-header">
                <div>
                  <strong>{activeArtifact.title}</strong>
                  <span>{artifactTypeLabel(activeArtifact.artifactType)} · {formatArtifactSize(activeArtifact)} · {formatDateTime(activeArtifact.updatedAt || activeArtifact.createdAt)}</span>
                </div>
                <div className="artifact-icon-actions">
                  <button type="button" title="打开渲染报告" disabled={!activeArtifactUrl} onClick={() => openReportUrl(activeArtifactUrl)}><ExternalLink size={16} /></button>
                  <button type="button" title="下载产物"><Save size={16} /></button>
                  <button type="button" title="放大预览" onClick={() => setPreviewExpanded(true)}><Maximize2 size={16} /></button>
                </div>
              </header>
              <div className="artifact-tabs detail">
                <button type="button" className={detailTab === 'preview' ? 'active' : ''} onClick={() => setDetailTab('preview')}>预览</button>
                <button type="button" className={detailTab === 'content' ? 'active' : ''} onClick={() => setDetailTab('content')}>内容</button>
                <button type="button" className={detailTab === 'meta' ? 'active' : ''} onClick={() => setDetailTab('meta')}>元数据</button>
              </div>
              <ArtifactRenderedPanel artifact={activeArtifact} tab={detailTab} />
            </>
          ) : (
            <div className="artifact-render-empty">
              <FileText size={24} />
              <strong>等待选择交付物</strong>
              <span>产物生成后可在这里预览报告、脚本、用例和执行摘要。</span>
            </div>
          )}
        </section>
      </div>
      {previewExpanded && activeArtifact && (
        <div className="artifact-preview-modal" role="dialog" aria-modal="true" aria-label="放大产物预览">
          <div className="artifact-preview-modal-card">
            <header className="artifact-renderer-header modal">
              <div>
                <strong>{activeArtifact.title}</strong>
                <span>{artifactTypeLabel(activeArtifact.artifactType)} · {formatArtifactSize(activeArtifact)} · {formatDateTime(activeArtifact.updatedAt || activeArtifact.createdAt)}</span>
              </div>
              <button type="button" className="artifact-modal-close" title="关闭放大预览" onClick={() => setPreviewExpanded(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="artifact-tabs detail modal">
              <button type="button" className={detailTab === 'preview' ? 'active' : ''} onClick={() => setDetailTab('preview')}>预览</button>
              <button type="button" className={detailTab === 'content' ? 'active' : ''} onClick={() => setDetailTab('content')}>内容</button>
              <button type="button" className={detailTab === 'meta' ? 'active' : ''} onClick={() => setDetailTab('meta')}>元数据</button>
            </div>
            <div className="artifact-preview-modal-body">
              <ArtifactRenderedPanel artifact={activeArtifact} tab={detailTab} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FlowChatMessage({ message, onSelectArtifact }) {
  const Icon = message.role === 'user' ? ClipboardList : message.tone === 'danger' ? AlertTriangle : message.tone === 'success' ? CheckCircle2 : Bot;
  return (
    <article className={`flow-chat-message ${message.role} ${message.tone || 'neutral'}`}>
      <div className="flow-chat-avatar"><Icon size={16} /></div>
      <div className="flow-chat-bubble">
        <header>
          <strong>{message.title}</strong>
          {message.time && <span>{formatLogTime(message.time)}</span>}
        </header>
        <p>{message.body}</p>
        {message.attachments?.length ? (
          <div className="flow-chat-attachments">
            {message.attachments.map((artifact) => (
              <FlowArtifactAttachment artifact={artifact} onSelect={() => onSelectArtifact(artifact.id)} key={artifact.id} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function FlowArtifactAttachment({ artifact, onSelect }) {
  const isStreaming = artifact.status === 'streaming';
  const generationLabel = artifactGenerationLabel(artifact);
  return (
    <button type="button" className={`flow-artifact-attachment ${artifact.status}`} onClick={onSelect}>
      <div>
        <span>{artifact.stage} · {artifactTypeLabel(artifact.artifactType)}</span>
        <strong>{artifact.title}</strong>
        {generationLabel && <small className="artifact-generation-label">{generationLabel}</small>}
        <small>{summarizeArtifactContent(artifact)}</small>
      </div>
      <em>{isStreaming ? '生成中' : '审阅'}</em>
    </button>
  );
}

function ArtifactTreeItem({ artifact, active, onSelect, showTime = false }) {
  const Icon = artifactIcon(artifact.artifactType);
  const generationLabel = artifactGenerationLabel(artifact);
  return (
    <button type="button" className={`artifact-tree-item ${artifact.status} ${active ? 'active' : ''}`} onClick={onSelect}>
      <Icon size={15} />
      <div>
        <strong>{artifact.title}</strong>
        {generationLabel && <span className="artifact-generation-label">{generationLabel}</span>}
        <span>{showTime ? formatDateTime(artifact.updatedAt || artifact.createdAt) : summarizeArtifactContent(artifact)}</span>
      </div>
      <em>{artifactStatusLabel(artifact.status)}</em>
    </button>
  );
}

function ArtifactRenderedPanel({ artifact, tab }) {
  if (tab === 'meta') {
    return (
      <div className="artifact-meta-grid" data-testid={`artifact-${artifact.artifactType}-detail`}>
        <div><span>阶段</span><strong>{artifact.stage}</strong></div>
        <div><span>类型</span><strong>{artifactTypeLabel(artifact.artifactType)}</strong></div>
        <div><span>状态</span><strong>{artifactStatusLabel(artifact.status)}</strong></div>
        <div><span>来源</span><strong>{artifactGenerationLabel(artifact) || artifact.source || '-'}</strong></div>
        {artifact.metadata?.reason && <div><span>生成说明</span><strong>{artifact.metadata.reason}</strong></div>}
        {artifact.metadata?.quality && (
          <div>
            <span>验收覆盖</span>
            <strong>{artifact.metadata.quality.covered ?? 0}/{artifact.metadata.quality.required ?? 0}</strong>
          </div>
        )}
        <div><span>路径</span><strong>{artifact.path || '未写入文件路径'}</strong></div>
        <div><span>更新时间</span><strong>{formatDateTime(artifact.updatedAt || artifact.createdAt)}</strong></div>
      </div>
    );
  }

  if (tab === 'content') {
    return (
      <pre className={['playwright-script', 'healed-script'].includes(artifact.artifactType) ? 'artifact-code rendered' : 'artifact-content rendered'} data-testid={`artifact-${artifact.artifactType}-detail`}>
        {artifact.content || '生成中...'}
      </pre>
    );
  }

  return (
    <div className="artifact-preview-render" data-testid={`artifact-${artifact.artifactType}-detail`}>
      {renderArtifactPreviewContent(artifact)}
    </div>
  );
}

function ArtifactTestAnchors({ artifacts }) {
  return (
    <div className="artifact-test-anchors" aria-hidden="true">
      {artifacts.map((artifact) => (
        <pre data-testid={`artifact-${artifact.artifactType}`} key={artifact.id}>
          {artifact.title}
          {'\n'}
          {summarizeArtifactContent(artifact)}
          {'\n'}
          {artifact.content || ''}
        </pre>
      ))}
    </div>
  );
}

function ArtifactPreview({ artifact, expanded, onToggle, compactToggle = false }) {
  const typeLabel = artifactTypeLabel(artifact.artifactType);
  const statusText = artifactStatusLabel(artifact.status);
  const isCode = ['playwright-script', 'healed-script'].includes(artifact.artifactType);
  const hasContent = Boolean(artifact.content);
  const summary = summarizeArtifactContent(artifact);
  return (
    <article className={`artifact-preview-card ${artifact.status}`} data-testid={`artifact-${artifact.artifactType}`}>
      <header>
        <div>
          <span>{artifact.stage} · {typeLabel}</span>
          <strong>{artifact.title}</strong>
        </div>
        <div className="artifact-meta">
          <small>{artifact.source}</small>
          <em>{statusText}</em>
        </div>
      </header>
      {artifact.path && <p className="artifact-path">证据/路径：{artifact.path}</p>}
      <div className="artifact-summary">
        <ListChecks size={15} />
        <span>{summary}</span>
      </div>
      {hasContent && artifact.status !== 'streaming' && !compactToggle && (
        <button type="button" className="artifact-toggle" onClick={onToggle}>
          {expanded ? '收起内容' : '展开审阅'}
          <ChevronDown size={15} className={expanded ? 'open' : ''} />
        </button>
      )}
      {(expanded || !hasContent || artifact.status === 'streaming') && (
        isCode ? (
          <pre className="artifact-code"><code>{artifact.content || '生成中...'}</code></pre>
        ) : (
          <pre className="artifact-content">{artifact.content || '生成中...'}</pre>
        )
      )}
    </article>
  );
}

function renderArtifactPreviewContent(artifact) {
  const content = artifact.content || '';
  if (!content) {
    return (
      <div className="artifact-render-empty inline">
        <Clock size={20} />
        <strong>内容生成中</strong>
        <span>产物会随流程推进自动写入。</span>
      </div>
    );
  }
  if (artifact.artifactType === 'execution-summary' || artifact.artifactType === 'final-report' || artifact.title.includes('报告')) {
    const status = content.match(/状态[：:]\s*([^\n]+)/)?.[1] || (artifact.status === 'failed' ? '失败' : artifactStatusLabel(artifact.status));
    const conclusion = content.match(/结论[：:]\s*([^\n]+)/)?.[1] || firstReadableLine(content);
    return (
      <div className="rendered-report">
        <h4>{artifact.title}</h4>
        <span className={`report-badge ${artifact.status}`}>{status}</span>
        <div className="rendered-report-table">
          <div><span>产物类型</span><strong>{artifactTypeLabel(artifact.artifactType)}</strong></div>
          <div><span>所属阶段</span><strong>{artifact.stage}</strong></div>
          <div><span>更新时间</span><strong>{formatDateTime(artifact.updatedAt || artifact.createdAt)}</strong></div>
          <div><span>大小</span><strong>{formatArtifactSize(artifact)}</strong></div>
        </div>
        <section>
          <strong>摘要</strong>
          <p>{conclusion}</p>
        </section>
      </div>
    );
  }
  if (artifact.artifactType === 'test-cases') {
    const table = parseMarkdownTable(content);
    return (
      <div className="rendered-cases">
        <h4>测试用例预览{table.rows.length ? `（共 ${table.rows.length} 条）` : ''}</h4>
        {table.rows.length ? (
          <div className="rendered-case-table-wrap">
            <table className="rendered-case-table">
              <thead>
                <tr>
                  {table.headers.map((header, index) => (
                    <th key={`${header}-${index}`}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={`${row[0] || 'case'}-${rowIndex}`}>
                    {table.headers.map((header, cellIndex) => (
                      <td key={`${header}-${cellIndex}`}>{row[cellIndex] || '-'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p>{firstReadableLine(content)}</p>}
      </div>
    );
  }
  if (['playwright-script', 'healed-script'].includes(artifact.artifactType)) {
    return <pre className="artifact-code rendered"><code>{content}</code></pre>;
  }
  return (
    <div className="rendered-text">
      <h4>{artifact.title}</h4>
      <p>{summarizeArtifactContent(artifact)}</p>
      <pre className="artifact-content rendered">{content}</pre>
    </div>
  );
}

function orderFlowArtifacts(artifacts, activeStage) {
  const statusWeight = { streaming: 0, failed: 1, fallback: 2, ready: 3, verified: 4, saved: 5 };
  return [...artifacts].sort((left, right) => {
    const leftActive = left.stage === activeStage ? 0 : 1;
    const rightActive = right.stage === activeStage ? 0 : 1;
    if (leftActive !== rightActive) return leftActive - rightActive;
    const leftStatus = statusWeight[left.status] ?? 9;
    const rightStatus = statusWeight[right.status] ?? 9;
    if (leftStatus !== rightStatus) return leftStatus - rightStatus;
    return new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0);
  });
}

function groupArtifactsByStage(artifacts) {
  const groups = new Map();
  for (const artifact of artifacts) {
    const stage = artifact.stage || '未分组';
    if (!groups.has(stage)) groups.set(stage, []);
    groups.get(stage).push(artifact);
  }
  return groups;
}

function buildDisplayArtifacts(artifacts) {
  const derivedReports = artifacts.flatMap((artifact) => deriveReportArtifacts(artifact));
  const existingIds = new Set(artifacts.map((artifact) => artifact.id));
  return [...artifacts, ...derivedReports.filter((artifact) => !existingIds.has(artifact.id))];
}

function deriveReportArtifacts(artifact) {
  if (artifact.artifactType !== 'final-report') return [];
  const content = artifact.content || '';
  const manualReportPath = extractArtifactPath(content, '人工测试报告');
  const htmlReportPath = extractArtifactPath(content, 'Playwright HTML Report') || extractArtifactPath(content, 'HTML report');
  const base = {
    flowRunId: artifact.flowRunId,
    workItemId: artifact.workItemId,
    stage: artifact.stage || '保存已验证产物',
    status: artifact.status,
    source: artifact.source || 'system',
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    parentArtifactId: artifact.id,
  };
  return [
    manualReportPath && {
      ...base,
      id: `${artifact.id}-manual-report`,
      artifactType: 'manual-report',
      title: '人工测试报告',
      path: manualReportPath,
      content: `## 人工测试报告\n\n- 报告路径：\`${manualReportPath}\`\n- 来源：最终交付物审阅\n`,
    },
    htmlReportPath && {
      ...base,
      id: `${artifact.id}-html-report`,
      artifactType: 'html-report',
      title: 'Playwright HTML Report',
      path: htmlReportPath,
      content: `## Playwright HTML Report\n\n- 报告路径：\`${htmlReportPath}\`\n- 来源：最终交付物审阅\n`,
    },
  ].filter(Boolean);
}

function extractArtifactPath(content, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`${escapedLabel}[：:]\\s*\\\`?([^\\\`\\n]+)\\\`?`));
  return match?.[1]?.trim() || '';
}

function artifactIcon(type) {
  return {
    'requirement-analysis': ClipboardList,
    'data-context': Database,
    'test-cases': FileCheck2,
    'test-case-refinement': FileCheck2,
    'exploration-plan': ListChecks,
    'exploration-result': MonitorPlay,
    'confirmed-elements': CheckSquare,
    'playwright-script': FileCode2,
    'execution-summary': Gauge,
    'healing-summary': Wand2,
    'healed-script': FileCode2,
    'final-report': FileText,
    'manual-report': FileText,
    'html-report': FileText,
  }[type] || FileText;
}

function stageStateLabel(state) {
  return {
    done: '已完成',
    running: '进行中',
    failed: '需处理',
    skipped: '无需自愈',
    idle: '待开始',
  }[state] || state;
}

function stagePillClass(stage, index, activeIndex, activeStage, status, isTerminalFailure) {
  if (isTerminalFailure && stage === activeStage) return 'flow-stage-pill blocked';
  if (['running', 'queued', 'healing'].includes(status) && stage === activeStage) return 'flow-stage-pill running';
  if (status === 'completed' || (activeIndex >= 0 && index < activeIndex)) return 'flow-stage-pill done';
  return 'flow-stage-pill';
}

function buildFlowConversationMessages({ requirement, flow, logs, artifacts, activeStage, status }) {
  const messages = [];
  const importantLogs = [...logs]
    .filter((log) => ['success', 'warning', 'error', 'blocked'].includes(log.level))
    .slice(-5);
  const finalSaveLog = status === 'completed'
    ? [...logs].reverse().find((log) => log.stage === '保存已验证产物' && ['success', 'warning'].includes(log.level))
    : null;
  const visibleLogs = finalSaveLog && !importantLogs.some((log) => log.id === finalSaveLog.id)
    ? [...importantLogs.slice(1), finalSaveLog]
    : importantLogs;
  const flowStartedAt = flow?.startedAt || logs[0]?.createdAt || artifacts[0]?.createdAt || '';
  if (requirement.trim() || flow?.workItem?.requirement) {
    messages.push({
      id: 'user-requirement',
      role: 'user',
      tone: 'neutral',
      time: flowStartedAt,
      title: '测试需求',
      body: firstReadableLine(requirement.trim() || flow?.workItem?.requirement || ''),
      attachments: [],
    });
  }
  if (flow || ['running', 'queued', 'healing'].includes(status)) {
    const brief = buildStageBrief(activeStage, status, artifacts, logs, flow);
    messages.push({
      id: `assistant-status-${activeStage || status}`,
      role: 'assistant',
      tone: ['failed', 'blocked'].includes(status) ? 'danger' : isPartialAutomationFlow(flow, status) ? 'warning' : status === 'completed' ? 'success' : status === 'cancelled' ? 'warning' : 'live',
      time: flowStartedAt,
      title: brief.title,
      body: brief.description,
      attachments: [],
    });
  }
  const artifactsByStage = new Map();
  for (const artifact of artifacts) {
    if (!artifactsByStage.has(artifact.stage)) artifactsByStage.set(artifact.stage, []);
    artifactsByStage.get(artifact.stage).push(artifact);
  }
  for (const stage of AUTOMATION_FLOW_STAGES) {
    const stageArtifacts = artifactsByStage.get(stage) || [];
    if (!stageArtifacts.length) continue;
    const latest = stageArtifacts.reduce((winner, item) => (
      new Date(item.updatedAt || item.createdAt || 0) > new Date(winner.updatedAt || winner.createdAt || 0) ? item : winner
    ), stageArtifacts[0]);
    const failed = stageArtifacts.some((artifact) => artifact.status === 'failed');
    const streaming = stageArtifacts.some((artifact) => artifact.status === 'streaming');
    const body = streaming
      ? `正在生成${stageArtifacts.map((artifact) => artifactTypeLabel(artifact.artifactType)).join('、')}，内容会实时追加到附件。`
      : stageSummaryText(stage, stageArtifacts, logs.filter((log) => log.stage === stage), { failed, streaming: false, completed: true });
    messages.push({
      id: `artifact-stage-${stage}-${latest.updatedAt || latest.createdAt}`,
      role: 'assistant',
      tone: failed ? 'danger' : streaming ? 'live' : 'success',
      time: latest.updatedAt || latest.createdAt,
      title: streaming ? `${stage}产物生成中` : `${stage}产物已就绪`,
      body,
      attachments: stageArtifacts,
    });
  }
  visibleLogs.forEach((log) => {
    messages.push({
      id: `log-${log.id}`,
      role: 'assistant',
      tone: log.level === 'success' ? 'success' : ['error', 'blocked'].includes(log.level) ? 'danger' : 'warning',
      time: log.createdAt,
      title: `${log.stage} ${logLevelLabel(log.level)}`,
      body: `${customerLogMessage(log)}${log.evidencePath ? ` 证据：${log.evidencePath}` : ''}`,
      attachments: [],
    });
  });
  return dedupeByTitle(messages)
    .sort((left, right) => new Date(left.time || 0) - new Date(right.time || 0))
    .slice(-16);
}

function buildStageBrief(activeStage, status, artifacts, logs, flow) {
  const latestArtifact = orderFlowArtifacts(artifacts, activeStage)[0];
  const latestIssue = [...logs].reverse().find((log) => ['error', 'blocked', 'warning'].includes(log.level));
  if (status === 'blocked') {
    return {
      kicker: '需要补充信息',
      title: `${activeStage || '需求分析'} 已阻塞`,
      description: latestIssue?.message || '当前流程缺少继续执行所需的信息，请根据提示补齐后重新开始。',
    };
  }
  if (status === 'failed') {
    return {
      kicker: '需要排障',
      title: `${activeStage || '运行验证'} 未通过`,
      description: latestIssue?.message || '流程已记录失败原因和证据路径，可展开技术明细定位问题。',
    };
  }
  if (status === 'completed') {
    if (isPartialAutomationFlow(flow, status)) {
      const counts = flow?.outcome?.counts || {};
      return {
        kicker: '已完成，有警告',
        title: '最低交付目标已达成',
        description: `P0 通过 ${counts.p0Passed || 0} 条；失败或未执行用例已入库，可前往人工工作台继续调试。`,
      };
    }
    return {
      kicker: '交付就绪',
      title: '全流程已完成',
      description: '测试用例、自动化脚本、执行证据和最终报告已生成，可进入测试报告审阅。',
    };
  }
  if (status === 'cancelled') {
    return {
      kicker: '已停止',
      title: '一键流程已取消',
      description: flow?.error || latestIssue?.message || '当前流程已按用户操作停止，已保留停止前生成的日志和产物。',
    };
  }
  if (latestArtifact?.status === 'streaming') {
    return {
      kicker: `当前阶段：${latestArtifact.stage}`,
      title: `正在生成${artifactTypeLabel(latestArtifact.artifactType)}`,
      description: `${latestArtifact.title} 正在流式更新，右侧产物会随轮询持续追加内容。`,
    };
  }
  return {
    kicker: flow ? `进度 ${flow.progress ?? 0}%` : '等待开始',
    title: activeStage ? `正在推进${activeStage}` : '等待启动自动化全流程',
    description: activeStage ? stageFriendlyDescription(activeStage) : '输入需求并开始后，系统会把底层执行转换成客户可读的流程播报。',
  };
}

function buildCustomerUpdates(logs, artifacts, activeStage, status) {
  const artifactUpdates = orderFlowArtifacts(artifacts, activeStage).slice(0, 5).map((artifact) => ({
    id: `artifact-${artifact.id}-${artifact.status}`,
    time: artifact.updatedAt || artifact.createdAt,
    tone: artifact.status === 'failed' ? 'danger' : artifact.status === 'streaming' ? 'live' : ['fallback', 'partial'].includes(artifact.status) ? 'warning' : 'success',
    title: artifact.status === 'streaming'
      ? `正在生成${artifactTypeLabel(artifact.artifactType)}`
      : `${artifactTypeLabel(artifact.artifactType)}${artifactStatusLabel(artifact.status)}`,
    message: summarizeArtifactContent(artifact),
  }));
  const importantLogs = logs
    .filter((log) => ['success', 'warning', 'error', 'blocked'].includes(log.level))
    .slice(-4);
  const finalSaveLog = status === 'completed'
    ? [...logs].reverse().find((log) => log.stage === '保存已验证产物' && ['success', 'warning'].includes(log.level))
    : null;
  const visibleLogs = finalSaveLog && !importantLogs.some((log) => log.id === finalSaveLog.id)
    ? [...importantLogs.slice(1), finalSaveLog]
    : importantLogs;
  const importantLogUpdates = visibleLogs.map((log) => ({
      id: `log-${log.id}`,
      time: log.createdAt,
      tone: log.level === 'success' ? 'success' : ['error', 'blocked'].includes(log.level) ? 'danger' : 'warning',
      title: `${log.stage} ${logLevelLabel(log.level)}`,
      message: customerLogMessage(log),
  }));
  const statusUpdate = status === 'running' || status === 'healing' || status === 'queued'
    ? [{
      id: `status-${status}-${activeStage || 'idle'}`,
      time: new Date().toISOString(),
      tone: 'live',
      title: activeStage ? `${activeStage}进行中` : '流程已启动',
      message: activeStage ? stageFriendlyDescription(activeStage) : '系统正在创建运行上下文并准备第一批产物。',
    }]
    : [];
  const updates = [...statusUpdate, ...artifactUpdates, ...importantLogUpdates]
    .filter((item) => item.message)
    .sort((left, right) => new Date(right.time || 0) - new Date(left.time || 0));
  return dedupeByTitle(updates).slice(0, 7);
}

function buildStageSummaries(stages, artifacts, logs, activeStage, status, flow) {
  const currentStage = activeStage || flow?.stage || '';
  const currentIndex = stages.indexOf(currentStage);
  const finalIndex = stages.indexOf('保存已验证产物');
  const healingStage = '自愈诊断';
  const healingIndex = stages.indexOf(healingStage);
  const observedStageIndex = Math.max(stages.indexOf(activeStage), stages.indexOf(flow?.stage));
  const flowInProgress = ['running', 'queued', 'healing'].includes(status);
  const hasHealingEvidence = artifacts.some((artifact) => artifact.stage === healingStage)
    || logs.some((log) => log.stage === healingStage);
  const healingFlowInProgress = flowInProgress
    && observedStageIndex <= healingIndex
    && (
      status === 'healing'
      || Number(flow?.currentAttempt || 0) > 0
      || activeStage === healingStage
      || flow?.stage === healingStage
      || hasHealingEvidence
    );
  return stages.map((stage) => {
    const stageIndex = stages.indexOf(stage);
    const stageArtifacts = artifacts.filter((artifact) => artifact.stage === stage);
    const stageLogs = logs.filter((log) => log.stage === stage);
    const healingInProgress = stage === healingStage && healingFlowInProgress;
    const activeStageInProgress = flowInProgress && !healingFlowInProgress && stage === currentStage;
    const failed = !activeStageInProgress && !healingInProgress && (
      stageLogs.some((log) => ['error', 'blocked'].includes(log.level))
      || stageArtifacts.some((artifact) => artifact.status === 'failed')
    );
    const streaming = stageArtifacts.some((artifact) => artifact.status === 'streaming')
      || activeStageInProgress
      || healingInProgress;
    const hasStageEvidence = stageArtifacts.length > 0 || stageLogs.length > 0;
    const completedByEvidence = stageArtifacts.some((artifact) => ['ready', 'verified', 'saved', 'fallback', 'partial'].includes(artifact.status)) || stageLogs.some((log) => ['success', 'warning'].includes(log.level));
    const progressedPastStage = currentIndex > stageIndex || (status === 'completed' && finalIndex > stageIndex);
    const cancelledHere = status === 'cancelled' && stage === currentStage;
    const skipped = stage === healingStage && status === 'completed' && !hasStageEvidence;
    const completed = !skipped && (completedByEvidence || (progressedPastStage && (hasStageEvidence || stage !== healingStage)));
    const state = failed || cancelledHere ? 'failed' : streaming ? 'running' : skipped ? 'skipped' : completed ? 'done' : 'idle';
    return {
      stage,
      state,
      icon: failed ? AlertTriangle : streaming ? Clock : skipped ? CircleDot : completed ? CheckCircle2 : ListChecks,
      summary: stageSummaryText(stage, stageArtifacts, stageLogs, { failed, streaming, skipped, completed }),
    };
  });
}

function buildClarificationItems({ flow, logs, activeStage, status }) {
  const issueLogs = logs
    .filter((log) => ['blocked', 'error', 'warning'].includes(log.level))
    .slice(-5)
    .reverse();
  if (issueLogs.length) {
    return issueLogs.map((log) => ({
      id: `clarification-${log.id}`,
      stage: log.stage || activeStage || '需求分析',
      tone: ['blocked', 'error'].includes(log.level) ? 'danger' : 'warning',
      title: log.level === 'warning' ? '需要关注' : '需要补充或处理',
      message: customerLogMessage(log),
    }));
  }
  if (flow?.error) {
    return [{
      id: 'clarification-flow-error',
      stage: activeStage || flow.stage || '需求分析',
      tone: 'danger',
      title: '流程阻塞',
      message: flow.error,
    }];
  }
  if (['running', 'queued', 'healing'].includes(status)) {
    return [{
      id: 'clarification-running',
      stage: activeStage || '需求分析',
      tone: 'ok',
      title: '当前无需人工补充',
      message: '系统正在一键推进真实编排；如果某阶段缺少 URL、账号、验收标准或 selector，会在这里提示补充。',
    }];
  }
  if (status === 'completed') {
    if (isPartialAutomationFlow(flow, status)) {
      return [{
        id: 'clarification-completed-partial',
        stage: '保存已验证产物',
        tone: 'warning',
        title: '部分用例需要继续处理',
        message: '最低交付目标已达成，未通过或未执行用例已保留在人工工作台。',
      }];
    }
    return [{
      id: 'clarification-completed',
      stage: '保存已验证产物',
      tone: 'ok',
      title: '全流程澄清已关闭',
      message: '需求、用例、脚本、执行证据和报告均已完成，可进入测试报告审阅。',
    }];
  }
  if (status === 'cancelled') {
    return [{
      id: 'clarification-cancelled',
      stage: activeStage || flow?.stage || '已停止',
      tone: 'warning',
      title: '流程已停止',
      message: flow?.error || '当前一键自动化流程已停止，停止前产生的日志和产物已保留。',
    }];
  }
  return [{
    id: 'clarification-idle',
    stage: activeStage || '需求分析',
    tone: 'ok',
    title: '等待需求输入',
    message: '建议在需求中包含 URL、角色账号、测试数据、验收标准和明确排除项，减少后续阻塞。',
  }];
}

function stageSummaryText(stage, artifacts, logs, state) {
  if (state.failed) {
    const issue = [...logs].reverse().find((log) => ['error', 'blocked'].includes(log.level));
    return issue?.message || '发现阻塞或失败，已保留技术明细。';
  }
  if (state.streaming) return stageFriendlyDescription(stage);
  if (state.skipped) return '运行验证已通过，无需进入脚本自愈。';
  if (!state.completed) return '等待进入该阶段。';
  if (stage === '用例设计') {
    const content = artifacts.find((artifact) => artifact.artifactType === 'test-cases')?.content || '';
    const caseCount = (content.match(/\|\s*TC-/g) || []).length;
    return caseCount ? `已生成 ${caseCount} 条可追溯用例。` : '已生成可审阅测试用例。';
  }
  if (stage === '页面探索') {
    const content = artifacts.map((artifact) => artifact.content || '').join('\n');
    const elementMatch = content.match(/候选元素[：:]\s*(\d+)/);
    const confirmedMatch = content.match(/已确认 selector[：:]\s*(\d+)/);
    if (elementMatch || confirmedMatch) {
      return `已采集 ${elementMatch?.[1] || 0} 个候选元素，确认 ${confirmedMatch?.[1] || 0} 个 selector。`;
    }
    return '已完成页面探索并沉淀 selector 证据。';
  }
  if (stage === '运行验证') {
    const content = artifacts.find((artifact) => artifact.artifactType === 'execution-summary')?.content || '';
    const statusMatch = content.match(/状态[：:]\s*([^\n]+)/);
    const reportMatch = content.match(/HTML report[：:]\s*`?([^`\n]+)`?/);
    return `执行${statusMatch ? `状态：${statusMatch[1].trim()}` : '已记录'}${reportMatch ? `，报告：${reportMatch[1].trim()}` : ''}。`;
  }
  if (stage === '脚本实现') return '已生成 Playwright 自动化脚本。';
  if (stage === '保存已验证产物') return '已保存最终测试报告和证据路径。';
  return '阶段产物已生成，可审阅。';
}

function stageFriendlyDescription(stage) {
  return {
    需求分析: '正在把原始需求整理成目标、角色、测试数据、验收标准和排除项。',
    项目预检: '正在确认项目路径、Playwright 配置、用例目录和脚本约定。',
    用例设计: '正在基于需求生成以冒烟/回归为主的可追溯测试用例，业务规则以实际需求为准。',
    页面探索: '正在打开真实页面采集 DOM、截图、候选元素和稳定 selector。',
    脚本实现: '正在把用例和已确认元素组装成 Playwright TypeScript 脚本。',
    运行验证: '正在执行 Playwright，并记录通过状态、失败摘要和 HTML report。',
    自愈诊断: '若执行失败，正在分析日志并尝试修复 selector、等待策略或断言。',
    保存已验证产物: '正在保存测试用例、脚本、执行证据和最终报告。',
  }[stage] || '正在推进当前阶段并沉淀可审阅产物。';
}

function summarizeArtifactContent(artifact) {
  const content = artifact.content || '';
  if (!content) return artifact.status === 'streaming' ? '内容正在生成，稍后会自动补齐。' : '暂无内容。';
  if (artifact.artifactType === 'test-cases') {
    const caseCount = (content.match(/\|\s*TC-/g) || []).length;
    const priorities = Array.from(new Set((content.match(/\|\s*P[0-3]\s*\|/g) || []).map((item) => item.replace(/[|\s]/g, ''))));
    return caseCount ? `已生成 ${caseCount} 条测试用例${priorities.length ? `，覆盖 ${priorities.join('/')} 优先级` : ''}。` : firstReadableLine(content);
  }
  if (['playwright-script', 'healed-script'].includes(artifact.artifactType)) {
    const testCount = (content.match(/\btest\s*\(/g) || []).length;
    return testCount ? `脚本包含 ${testCount} 个 Playwright 测试，已按当前 selector 与断言生成。` : '脚本内容已生成，可展开审阅。';
  }
  if (artifact.artifactType === 'exploration-result') {
    const elementMatch = content.match(/候选元素[：:]\s*(\d+)/);
    const screenshotMatch = content.match(/截图路径[：:]\s*([^\n]+)/);
    return `页面探索已记录${elementMatch ? ` ${elementMatch[1]} 个候选元素` : '候选元素'}${screenshotMatch ? `，截图：${screenshotMatch[1].trim()}` : ''}。`;
  }
  if (artifact.artifactType === 'confirmed-elements') {
    const match = content.match(/已确认 selector[：:]\s*(\d+)/);
    return match ? `已确认 ${match[1]} 个 selector，可用于脚本生成。` : '已整理可用于自动化的 selector。';
  }
  if (artifact.artifactType === 'execution-summary') {
    const statusMatch = content.match(/状态[：:]\s*([^\n]+)/);
    const reportMatch = content.match(/HTML report[：:]\s*`?([^`\n]+)`?/);
    return `Playwright ${statusMatch ? `状态：${statusMatch[1].trim()}` : '执行结果已记录'}${reportMatch ? `，报告：${reportMatch[1].trim()}` : ''}。`;
  }
  if (artifact.artifactType === 'manual-report') {
    return artifact.path ? `人工测试报告：${artifact.path}` : '人工测试报告已生成。';
  }
  if (artifact.artifactType === 'html-report') {
    return artifact.path ? `Playwright HTML Report：${artifact.path}` : 'Playwright HTML Report 已生成。';
  }
  return firstReadableLine(content);
}

function firstReadableLine(content) {
  const line = content
    .split('\n')
    .map((item) => item.replace(/^[-#*\s`|]+/, '').trim())
    .find((item) => item && !/^---+$/.test(item));
  return line ? (line.length > 110 ? `${line.slice(0, 110)}...` : line) : '产物已生成，可展开审阅。';
}

function customerLogMessage(log) {
  if (log.level === 'blocked') return `当前需要处理：${log.message}`;
  if (log.level === 'error') return `发现失败：${log.message}`;
  if (log.level === 'warning') return `注意事项：${log.message}`;
  if (log.level === 'success') return log.message;
  return log.message;
}

function logLevelLabel(level) {
  return {
    success: '完成',
    warning: '提醒',
    error: '失败',
    blocked: '阻塞',
  }[level] || level;
}

function dedupeByTitle(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}-${item.message || item.body || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatArtifactSize(artifact) {
  const bytes = new Blob([artifact.content || '']).size;
  if (bytes < 1024) return `${bytes || 0} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const CASE_TABLE_FIELDS = [
  { key: 'externalId', header: 'ID', aliases: ['id', '用例id', '编号'] },
  { key: 'priority', header: '优先级', aliases: ['优先级', 'priority'] },
  { key: 'title', header: '标题', aliases: ['标题', '用例标题', '名称'] },
  { key: 'requirement', header: '覆盖需求', aliases: ['覆盖需求', '需求', 'coverage'] },
  { key: 'preconditions', header: '前置条件/测试数据', aliases: ['前置条件/测试数据', '前置条件', '测试数据'] },
  { key: 'steps', header: '步骤', aliases: ['步骤', '测试步骤'] },
  { key: 'expected', header: '期望结果', aliases: ['期望结果', '预期结果'] },
  { key: 'automationNotes', header: '自动化说明', aliases: ['自动化说明', '自动化备注'] },
];

function normalizeCaseHeader(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function plainMarkdownTableCell(value) {
  return String(value || '')
    .trim()
    .replace(/\\([\\`*_{}\[\]()#+.!|-])/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCaseMarkdownDocument(content) {
  const text = String(content || '');
  const lines = text.split('\n');
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith('|')) continue;
    const headers = splitMarkdownTableRow(lines[index]);
    const normalizedHeaders = headers.map(normalizeCaseHeader);
    const idField = CASE_TABLE_FIELDS[0];
    const titleField = CASE_TABLE_FIELDS[2];
    const hasId = idField.aliases.some((alias) => normalizedHeaders.includes(normalizeCaseHeader(alias)));
    const hasTitle = titleField.aliases.some((alias) => normalizedHeaders.includes(normalizeCaseHeader(alias)));
    if (!hasId || !hasTitle) continue;
    const separatorCells = splitMarkdownTableRow(lines[index + 1]);
    if (!looksLikeMarkdownSeparator(separatorCells)) continue;
    let tableEnd = index + 1;
    while (tableEnd + 1 < lines.length && lines[tableEnd + 1].trim().startsWith('|')) tableEnd += 1;
    const rows = lines
      .slice(index + 2, tableEnd + 1)
      .map(splitMarkdownTableRow)
      .filter((cells) => cells.some((cell) => cell.trim()))
      .map((cells) => Object.fromEntries(CASE_TABLE_FIELDS.map((field) => {
        const columnIndex = normalizedHeaders.findIndex((header) => field.aliases.some((alias) => header === normalizeCaseHeader(alias)));
        const value = columnIndex >= 0 ? cells[columnIndex] : '';
        return [field.key, plainMarkdownTableCell(value) || (field.key === 'priority' ? 'P1' : '')];
      })))
      .filter((row) => row.externalId || row.title);
    return { valid: true, rows, tableStart: index, tableEnd, lines };
  }
  return { valid: false, rows: [], tableStart: -1, tableEnd: -1, lines };
}

function escapeMarkdownTableCell(value) {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCaseInternalFields(row) {
  return Object.fromEntries(CASE_TABLE_FIELDS.map((field) => [field.key, String(row?.[field.key] || '')]));
}

function serializeCaseMarkdownTable(rows) {
  const header = `| ${CASE_TABLE_FIELDS.map((field) => field.header).join(' | ')} |`;
  const separator = `| ${CASE_TABLE_FIELDS.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${CASE_TABLE_FIELDS.map((field) => escapeMarkdownTableCell(row[field.key])).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

function replaceCaseMarkdownTable(content, rows, document = parseCaseMarkdownDocument(content)) {
  const serialized = serializeCaseMarkdownTable(rows);
  if (!document.valid) return String(content || '').trim() ? content : serialized;
  const nextLines = [
    ...document.lines.slice(0, document.tableStart),
    ...serialized.split('\n'),
    ...document.lines.slice(document.tableEnd + 1),
  ];
  return nextLines.join('\n');
}

function createEmptyCaseDraft(rows) {
  const existingIds = new Set(rows.map((row) => row.externalId));
  let index = rows.length + 1;
  let externalId = `TC-NEW-${String(index).padStart(3, '0')}`;
  while (existingIds.has(externalId)) {
    index += 1;
    externalId = `TC-NEW-${String(index).padStart(3, '0')}`;
  }
  return {
    externalId,
    priority: 'P1',
    title: '',
    requirement: '',
    preconditions: '',
    steps: '',
    expected: '',
    automationNotes: '',
  };
}

function parseMarkdownTable(content) {
  const tableLines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  if (tableLines.length < 2) return { headers: [], rows: [] };
  const headers = splitMarkdownTableRow(tableLines[0]);
  if (!headers.length) return { headers: [], rows: [] };
  const rows = tableLines
    .slice(1)
    .filter((line) => !looksLikeMarkdownSeparator(splitMarkdownTableRow(line)))
    .map((line) => splitMarkdownTableRow(line))
    .filter((cells) => cells.some(Boolean))
    .map((cells) => headers.map((_, index) => cells[index] || ''));
  return { headers, rows };
}

function splitMarkdownTableRow(line) {
  const text = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let escaped = false;
  for (const character of text) {
    if (character === '\\' && !escaped) {
      escaped = true;
      current += character;
      continue;
    }
    if (character === '|' && !escaped) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    escaped = false;
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function looksLikeMarkdownSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function artifactTypeLabel(type) {
  return {
    'requirement-analysis': '需求抽取',
    'data-context': '测试数据上下文',
    'test-cases': '测试用例',
    'test-case-refinement': '用例证据修订',
    'exploration-plan': '探索计划',
    'exploration-result': '探索结果',
    'confirmed-elements': '确认元素',
    'playwright-script': '自动化脚本',
    'execution-summary': '执行摘要',
    'healing-summary': '自愈诊断',
    'healed-script': '修复脚本',
    'final-report': '交付报告',
    'manual-report': '人工报告',
    'html-report': 'HTML report',
  }[type] || type;
}

function artifactGenerationLabel(artifact) {
  const source = artifact?.source || artifact?.metadata?.generationSource || '';
  if (source === 'evidence-refined' || artifact?.metadata?.refined) return '证据修订';
  if (source === 'fallback') return '规则兜底';
  if (source === 'ai') return 'AI 生成';
  if (source === 'playwright') return 'Playwright 证据';
  if (source === 'api') return '页面 API 证据';
  return '';
}

function artifactStatusLabel(status) {
  return {
    streaming: '生成中',
    ready: '可审阅',
    fallback: '规则兜底',
    failed: '失败',
    saved: '已保存',
    verified: '已验证',
    partial: '部分完成',
  }[status] || status;
}

function Requirements({
  projects,
  selectedProjectId,
  selectedFeatureId,
  featureTree,
  featureOptions,
  onProjectChange,
  onFeatureChange,
  form,
  setForm,
  createWorkItem,
  updateWorkItem,
  startNewRequirement,
  item,
  analyzing,
  setActiveModule,
  canCreate = true,
}) {
  const analysis = item?.requirementAnalysis;
  const project = item?.projectContext;
  const sourceLabel = analysis?.source === 'ai' ? 'AI 自动提取' : analysis?.source ? '规则兜底提取' : '等待分析';
  const flatFeatureTree = useMemo(() => flattenFeatureTree(featureTree), [featureTree]);
  const selectableFeatures = activeFeatureOptions(flatFeatureTree.length ? flatFeatureTree : featureOptions, selectedFeatureId);
  const selectedProject = projects.find((projectItem) => projectItem.id === selectedProjectId) || null;
  const selectedFeature = selectableFeatures.find((feature) => feature.id === selectedFeatureId) || null;
  const hasProject = Boolean(selectedProjectId);
  const hasFeature = Boolean(selectedFeatureId);
  const editing = Boolean(item?.id);
  const canAnalyze = canCreate && !analyzing && hasProject && hasFeature && form.requirement.trim();
  const analyzeHint = !canCreate ? '当前账号无权创建需求工单' : !hasProject ? '请选择项目名称' : !hasFeature ? '请选择功能' : '';
  return (
    <section className="module-section" aria-label="需求工单">
      <div className="section-header">
        <div>
          <h2>需求工单</h2>
          <p>先输入完整需求，点击需求分析后自动提取目标、用户路径、验收标准、角色、测试数据、环境和排除项。</p>
        </div>
        {editing && (
          <button type="button" className="ghost-button" onClick={startNewRequirement} disabled={analyzing}>
            <Plus size={17} />
            新建需求工单
          </button>
        )}
      </div>

      <div className="requirement-analysis-card">
        <div className="automation-context-fields requirement-context-fields" aria-label="需求工单绑定上下文">
          <label>
            <span><Database size={15} /> 项目名称 <b>必填</b></span>
            <select
              data-testid="requirement-project"
              value={selectedProjectId}
              onChange={(event) => onProjectChange(event.target.value)}
              disabled={analyzing}
            >
              <option value="">请选择项目</option>
              {projects.map((projectItem) => (
                <option value={projectItem.id} key={projectItem.id}>{projectItem.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span><FolderTree size={15} /> 功能 <b>必填</b></span>
            <select
              data-testid="requirement-feature"
              value={selectedFeatureId}
              onChange={(event) => onFeatureChange(event.target.value)}
              disabled={analyzing || !selectedProjectId || !selectableFeatures.length}
            >
              <option value="">{selectedProjectId && !selectableFeatures.length ? '当前项目暂无可选功能' : '请选择功能'}</option>
              {selectableFeatures.map((feature) => (
                <option value={feature.id} key={feature.id}>
                  {`${'　'.repeat(feature.depth || 0)}${feature.path || feature.name}${feature.isActive ? '' : '（停用）'}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="requirement-input-field">
          <span>需求输入</span>
          <textarea
            data-testid="requirement-input"
            value={form.requirement}
            placeholder="输入需求、PRD、验收标准、缺陷描述或页面说明。可以包含 URL、角色、账号、测试数据、验收标准和明确排除项。"
            onChange={(event) => setForm({ ...form, requirement: event.target.value })}
          />
        </label>
        <div className="action-row requirement-actions">
          <button type="button" className="primary-action" disabled={!canAnalyze} onClick={editing ? updateWorkItem : createWorkItem} title={analyzeHint}>
            <Sparkles size={17} />
            {analyzing ? '分析中...' : '需求分析'}
          </button>
          {item && (
            <button type="button" className="ghost-button" onClick={() => setActiveModule('cases')}>
              <FileCheck2 size={17} />
              进入用例设计
            </button>
          )}
        </div>
      </div>

      {analysis && (
        <div className="split-grid">
          <div className="data-panel" data-testid="requirement-analysis">
            <div className="panel-heading compact">
              <h3>需求抽取/澄清检查</h3>
              <span className="source-chip">{sourceLabel}</span>
            </div>
            <div className="delivery-row"><span>绑定项目</span><strong>{item?.project?.name || selectedProject?.name || item?.projectId || '-'}</strong></div>
            <div className="delivery-row"><span>绑定功能</span><strong>{item?.featurePath || item?.featureName || selectedFeature?.path || selectedFeature?.name || '-'}</strong></div>
            <div className="delivery-row"><span>功能目标</span><strong>{analysis.goal}</strong></div>
            <div className="delivery-row"><span>用户路径</span><strong>{analysis.userPath}</strong></div>
            <div className="delivery-row"><span>验收标准</span><strong>{analysis.acceptance}</strong></div>
            <div className="delivery-row"><span>角色</span><strong>{analysis.role}</strong></div>
            <div className="delivery-row"><span>测试数据</span><strong>{analysis.testData}</strong></div>
            <div className="delivery-row"><span>环境</span><strong>{analysis.environment}</strong></div>
            <div className="delivery-row"><span>排除项</span><strong>{analysis.exclusions}</strong></div>
            <p className="muted">{analysis.clarificationNeeded ? `仍需澄清：${analysis.missing.join('、')}` : '需求信息足够进入测试用例设计。'}</p>
          </div>
          <div className="data-panel" data-testid="project-context">
            <h3>项目预检摘要</h3>
            <div className="delivery-row"><span>Playwright 配置</span><strong>{project?.playwrightConfig}</strong></div>
            <div className="delivery-row"><span>测试目录</span><strong>{project?.testDir} · {project?.specPattern}</strong></div>
            <div className="delivery-row"><span>已有测试</span><strong>{project?.existingSpecs} specs / {project?.existingCaseDocs} 用例文档</strong></div>
            <div className="delivery-row"><span>测试脚本</span><strong>{project?.testScript || '未发现 package 脚本'}</strong></div>
            <div className="delivery-row"><span>fixture/helper</span><strong>{project?.helperSummary}</strong></div>
            <div className="delivery-row"><span>locator 风格</span><strong>{project?.locatorStyle}</strong></div>
            <p className="muted">{project?.summary}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function Exploration({ item, exploration, explorationRun, explorationLogs, browserStatus, browserStatusDetail, liveConnected, browserCanvasRef, browserPreviewEnabled, setBrowserPreviewEnabled, setExploration, updateElement, addElement, setAllElementsConfirmed, saveExploration, runExploration, exploring, saving = false, sendBrowserCommand, handleBrowserClick, handleBrowserMove, handleBrowserWheel, handleBrowserKeyDown, debugSession = null, exitCaseDebug, canEdit = true, clearPageData, clearing = false }) {
  const hasCases = Boolean(item?.casesMarkdown);
  const confirmedCount = exploration.elements.filter((element) => element.confirmed).length;
  const recommendedCount = exploration.elements.filter((element) => element.recommended).length;
  const hasPageData = Boolean(item || explorationRun || explorationLogs.length || exploration.notes || exploration.screenshot_path || exploration.page_structure || exploration.elements.some((element) => element.name || element.locatorValue || element.confirmed));
  const stageLabel = browserStatusDetail || explorationRun?.stage?.label || (exploring ? '准备探索环境' : '等待探索');
  const progress = explorationRun?.progress || 0;
  const runStatus = explorationRun ? statusLabel(explorationRun.status) : '未启动';
  const planItems = explorationRun?.plan || [];
  const planTargets = explorationRun?.planTargets || [];
  const planJourneys = explorationRun?.planJourneys || [];
  const stepItems = explorationRun?.steps || [];
  const targetCoverage = explorationRun?.result?.targetCoverage || { total: planTargets.length, covered: 0, missing: planTargets.length, percent: 0 };
  const missingTargets = explorationRun?.result?.missingTargets || [];
  const explorationQuality = explorationRun?.result?.quality || null;
  const caseCoverage = explorationRun?.result?.caseCoverage || [];
  const behaviorFindings = explorationRun?.result?.behaviorFindings || explorationQuality?.behaviorFindings || [];
  const resolvedTargetIds = new Set((explorationRun?.result?.resolved_elements || []).map((element) => element.targetId).filter(Boolean));
  const preflightEvidence = explorationRun?.preflightEvidence || {};
  const preflightCounts = preflightEvidence.counts || {};
  const planDiagnostics = explorationRun?.planDiagnostics || {};
  const blockedPlanCases = explorationRun?.blockedCases || planDiagnostics.blockedCases || [];
  const repairOptions = explorationRun?.repairOptions || [];
  const planSourceLabel = explorationRun?.planSource === 'cache'
    ? '缓存复用'
    : explorationRun?.planSource === 'hybrid'
      ? '本地编译 + AI 映射'
      : explorationRun?.planSource === 'system'
        ? '本地编译'
        : explorationRun?.planSource || '等待生成';
  const explorationBrowserShellRef = useRef(null);
  const [explorationBrowserFullscreen, setExplorationBrowserFullscreen] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [repairSelections, setRepairSelections] = useState({});
  const normalizedSearch = listSearch.trim().toLowerCase();
  const matchesSearch = (values) => {
    if (!normalizedSearch) return true;
    return values.filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch);
  };
  const filteredPlanItems = planItems.filter((step) => {
    const status = step.skipped ? 'skipped' : 'planned';
    const statusMatches = statusFilter === 'all' || statusFilter === status || statusFilter === step.action;
    return statusMatches && matchesSearch([step.action, step.description, step.target, step.value, status]);
  });
  const filteredStepItems = stepItems.filter((step) => {
    const statusMatches = statusFilter === 'all' || statusFilter === step.status || statusFilter === step.action;
    return statusMatches && matchesSearch([step.action, step.description, step.status, step.title, step.urlBefore, step.urlAfter, step.screenshotPath]);
  });
  const toggleExplorationBrowserFullscreen = async () => {
    const shell = explorationBrowserShellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
      } else {
        await shell.requestFullscreen();
      }
    } catch (err) {
      console.warn('切换探索实时浏览器全屏失败', err);
    }
  };

  useEffect(() => {
    const updateFullscreenState = () => {
      setExplorationBrowserFullscreen(document.fullscreenElement === explorationBrowserShellRef.current);
    };
    document.addEventListener('fullscreenchange', updateFullscreenState);
    updateFullscreenState();
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);

  useEffect(() => {
    setRepairSelections({});
  }, [explorationRun?.id]);

  const retryExplorationTarget = (group) => {
    const selectedId = repairSelections[group.targetId];
    const candidate = (group.candidates || []).find((item) => item.id === selectedId);
    if (!candidate || !group.journeyId || !explorationRun?.id) return;
    runExploration({
      retry_run_id: explorationRun.id,
      journey_id: group.journeyId,
      target_overrides: [{
        target_id: group.targetId,
        locator_type: candidate.locatorType,
        locator_value: candidate.locatorValue,
        locator_role: candidate.locatorRole || '',
        name: candidate.name || '',
      }],
    });
  };

  return (
    <section className="module-section" aria-label="探索实验室">
      <CaseDebugBanner session={debugSession} onExit={exitCaseDebug} />
      <div className="section-header">
        <div>
          <h2>探索与元素确认</h2>
          <p>{debugSession ? `探索范围严格限定为 ${debugSession.case?.externalId || '当前用例'}。` : '人工接管或单步重跑页面探索，确认真实 DOM、可访问名称和稳定 selector。'}</p>
        </div>
        <div className="action-row">
          {!debugSession && <button type="button" className="ghost-button danger-action" disabled={exploring || saving || clearing || !hasPageData || !canEdit} onClick={clearPageData}>
            <Trash2 size={17} />
            {clearing ? '清空中...' : '一键清空'}
          </button>}
          <button type="button" className="ghost-button" disabled={!item || !hasCases || exploring || saving || !canEdit} onClick={() => runExploration()}>
            <FlaskConical size={17} />
            {exploring ? '探索中' : '执行探索'}
          </button>
          <button type="button" className="primary-action" disabled={!item || !hasCases || !confirmedCount || exploring || saving || !canEdit} onClick={saveExploration}>
            <Save size={17} />
            {saving ? '保存中...' : '保存探索'}
          </button>
        </div>
      </div>
      {!hasCases && <p className="muted" data-testid="exploration-prerequisite">请先在用例设计中保存可追溯测试用例，再执行页面探索。</p>}
      <div className="form-grid">
        <Field label="探索记录" textarea value={exploration.notes} onChange={(value) => setExploration({ ...exploration, notes: value })} />
        <Field label="截图路径" value={exploration.screenshot_path} onChange={(value) => setExploration({ ...exploration, screenshot_path: value })} />
        <Field label="页面结构发现" textarea value={exploration.page_structure} onChange={(value) => setExploration({ ...exploration, page_structure: value })} />
      </div>
      <div className="exploration-preview-panel">
        <div className="panel-heading">
          <div>
            <h3>实时浏览器控制台</h3>
            <p className="muted">通过 WebSocket 接收 CDP Screencast 画面，点击、滚动和键盘输入会回传到浏览器会话。</p>
          </div>
          <div className="browser-preview-heading-actions">
            <BrowserPreviewToggle
              enabled={browserPreviewEnabled}
              onChange={setBrowserPreviewEnabled}
              testId="exploration-browser-preview-toggle"
            />
            <span className={exploring ? 'preview-status running' : 'preview-status'}>{stageLabel} · {runStatus}</span>
          </div>
        </div>
        <div className="exploration-runtime" data-testid="exploration-runtime">
          <div>
            <span>当前阶段</span>
            <strong>{stageLabel}</strong>
          </div>
          <div>
            <span>实时会话</span>
            <strong>{browserPreviewEnabled ? (liveConnected ? 'Live WebSocket' : '未连接') : '已关闭'} · {browserStatus}</strong>
          </div>
          <div>
            <span>探索进度</span>
            <strong>{progress}%</strong>
          </div>
        </div>
        {preflightEvidence.finalUrl ? (
          <div className="exploration-runtime" data-testid="exploration-preflight-summary">
            <div>
              <span>预探索页面</span>
              <strong>{preflightEvidence.title || preflightEvidence.finalUrl}</strong>
            </div>
            <div>
              <span>页面控件</span>
              <strong>表单 {preflightCounts.forms || 0} · 输入 {preflightCounts.inputs || 0} · 按钮 {preflightCounts.buttons || 0} · 链接 {preflightCounts.links || 0}</strong>
            </div>
            <div>
              <span>候选元素</span>
              <strong>{preflightEvidence.candidateCount || preflightEvidence.elements?.length || 0}</strong>
            </div>
          </div>
        ) : null}
        {planTargets.length ? (
          <div className="exploration-runtime" data-testid="exploration-target-coverage">
            <div>
              <span>目标控件覆盖</span>
              <strong>{targetCoverage.covered || 0}/{targetCoverage.total || planTargets.length} · {targetCoverage.percent || 0}%</strong>
            </div>
            <div>
              <span>最短状态路径</span>
              <strong>{planJourneys.length}</strong>
            </div>
            <div>
              <span>缺失必需控件</span>
              <strong>{targetCoverage.missing || missingTargets.length || 0}</strong>
            </div>
          </div>
        ) : null}
        {planDiagnostics.plannerVersion ? (
          <div className="exploration-runtime" data-testid="exploration-plan-diagnostics">
            <div>
              <span>计划编译器</span>
              <strong>V{planDiagnostics.plannerVersion} · {planSourceLabel}</strong>
            </div>
            <div>
              <span>本地解析</span>
              <strong>{planDiagnostics.localMatchedTargetCount || 0} 个 DOM 目标 · {planDiagnostics.inferredTargetCount || 0} 个状态目标</strong>
            </div>
            <div>
              <span>AI / 缓存</span>
              <strong>{planDiagnostics.aiUsed ? `映射 ${planDiagnostics.aiMappingCount || 0} 个缺口` : '未调用 AI'} · {planDiagnostics.cacheHit ? '命中缓存' : '新编译'}</strong>
            </div>
          </div>
        ) : null}
        {blockedPlanCases.length ? (
          <div className="step-list" data-testid="exploration-plan-blocked-cases">
            {blockedPlanCases.map((blockedCase) => (
              <div className="step-row" key={blockedCase.caseId}>
                <strong>{blockedCase.priority || 'P1'} · {blockedCase.caseId} · 计划降级</strong>
                <span>{blockedCase.reason || blockedCase.code || '目标未解析'}</span>
                {blockedCase.missingTargets?.length ? <small>缺失目标：{blockedCase.missingTargets.join('、')}</small> : null}
                {blockedCase.missingActions?.length ? <small>缺失动作：{blockedCase.missingActions.join('、')}</small> : null}
              </div>
            ))}
          </div>
        ) : null}
        {missingTargets.length ? (
          <div className="error-banner" data-testid="exploration-missing-targets">
            未获取稳定 locator：{missingTargets.map((target) => `${target.name || target.targetId}${target.caseIds?.length ? `（${target.caseIds.join('、')}）` : ''}`).join('；')}
          </div>
        ) : null}
        {repairOptions.length ? (
          <div className="data-panel" data-testid="exploration-repair-options">
            <div className="panel-heading compact">
              <h3>定位修复</h3>
              <span className="muted">选择候选后重跑当前状态路径</span>
            </div>
            <div className="step-list">
              {repairOptions.map((group) => (
                <div className="step-row" key={group.targetId} data-testid={`exploration-repair-${group.targetId}`}>
                  <strong>{group.targetName}</strong>
                  <span>{group.message}</span>
                  {(group.candidates || []).length ? (
                    <div className="repair-candidate-list">
                      {group.candidates.map((candidate) => (
                        <label className="check-cell" key={candidate.id}>
                          <input
                            type="radio"
                            name={`repair-${group.targetId}`}
                            value={candidate.id}
                            checked={repairSelections[group.targetId] === candidate.id}
                            onChange={() => setRepairSelections((state) => ({ ...state, [group.targetId]: candidate.id }))}
                          />
                          <span>{candidate.name} · {candidate.locatorType}{candidate.locatorRole ? `(${candidate.locatorRole})` : ''}</span>
                        </label>
                      ))}
                    </div>
                  ) : <small>没有可安全重试的候选，请为目标记录补充稳定 data-testid 后重新探索。</small>}
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={exploring || !repairSelections[group.targetId] || !group.journeyId}
                    onClick={() => retryExplorationTarget(group)}
                  >
                    <RefreshCw size={16} />
                    使用此元素并重试当前路径
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {explorationQuality ? (
          <div
            className={explorationQuality.level === 'low' ? 'error-banner' : 'notice-banner'}
            data-testid="exploration-quality"
          >
            探索置信度：{explorationQuality.level === 'high' ? '高' : explorationQuality.level === 'medium' ? '中' : '低'}
            {' · '}{explorationQuality.score || 0} 分
            {explorationQuality.reasons?.length ? ` · ${explorationQuality.reasons.join('；')}` : ''}
          </div>
        ) : null}
        {behaviorFindings.length ? (
          <div className="notice-banner" data-testid="exploration-behavior-findings">
            <strong>发现 {behaviorFindings.length} 条业务行为差异，已继续交由运行验证判定。</strong>
            {behaviorFindings.map((finding) => (
              <div key={`${finding.caseId}-${finding.stepIndex}-${finding.code}`}>
                {finding.priority || 'P1'} · {finding.caseId} · {finding.target || finding.action || '交互'}：{finding.message}
                {finding.actualUrl ? ` · ${finding.actualUrl}` : ''}
              </div>
            ))}
          </div>
        ) : null}
        {caseCoverage.length ? (
          <div className="step-list" data-testid="exploration-case-coverage">
            {caseCoverage.map((coverage) => (
              <div className="step-row" key={coverage.caseId}>
                  <strong>{coverage.priority} · {coverage.caseId} · {coverage.assetStatus === 'proven' || coverage.status === 'proven' ? '资产已证明' : '探索阻塞'}</strong>
                  <span>
                    路径 {coverage.journeyPassed ? '通过' : '未通过'} · 证据 {coverage.evidenceComplete ? '完整' : '不足'} · 动作 {coverage.actionRequirementsMet ? '完整' : '缺失'} · 业务 {coverage.behaviorStatus === 'mismatch' ? '与需求不符' : '已观察'}
                  </span>
                {coverage.missingTargets?.length ? <small>缺失：{coverage.missingTargets.join('、')}</small> : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className="mini-progress" aria-label="探索进度">
          <span style={{ width: `${Math.max(4, progress)}%` }} />
        </div>
        <div className="live-browser-shell automation-live-browser-shell" ref={explorationBrowserShellRef} data-testid="exploration-preview">
          <div className="browser-live-toolbar">
            <span>{browserStatus}</span>
            <div className="action-row">
              <button
                type="button"
                className="ghost-button"
                data-testid="exploration-browser-fullscreen"
                title={explorationBrowserFullscreen ? '退出全屏' : '全屏展示'}
                aria-pressed={explorationBrowserFullscreen}
                disabled={!browserPreviewEnabled}
                onClick={toggleExplorationBrowserFullscreen}
              >
                <Maximize2 size={15} />
                {explorationBrowserFullscreen ? '退出全屏' : '全屏展示'}
              </button>
              <button type="button" className="ghost-button" disabled={!browserPreviewEnabled || !liveConnected} onClick={() => sendBrowserCommand({ type: 'control', action: 'pause' })}>暂停</button>
              <button type="button" className="ghost-button" disabled={!browserPreviewEnabled || !liveConnected} onClick={() => sendBrowserCommand({ type: 'control', action: 'takeover' })}>人工接管</button>
              <button type="button" className="ghost-button" disabled={!browserPreviewEnabled || !liveConnected} onClick={() => sendBrowserCommand({ type: 'control', action: 'resume' })}>继续</button>
            </div>
          </div>
          <canvas
            ref={browserCanvasRef}
            className="browser-live-canvas automation-flow-live-canvas"
            data-testid="browser-live-canvas"
            tabIndex={browserPreviewEnabled ? 0 : -1}
            aria-label="实时浏览器控制画布"
            onClick={browserPreviewEnabled ? handleBrowserClick : undefined}
            onMouseMove={browserPreviewEnabled ? handleBrowserMove : undefined}
            onWheel={browserPreviewEnabled ? handleBrowserWheel : undefined}
            onKeyDown={browserPreviewEnabled ? handleBrowserKeyDown : undefined}
          />
          {!liveConnected && (
            <div className="preview-placeholder live-overlay">
              <MonitorPlay size={38} />
              <span>{browserPreviewEnabled ? '点击执行探索后连接实时浏览器' : '实时预览已关闭，打开开关后连接浏览器画面。'}</span>
            </div>
          )}
        </div>
        <div className="exploration-plan-grid">
          <div className="data-panel">
            <div className="panel-heading compact">
              <h3>目标控件与最短状态路径</h3>
              <span className="muted">{filteredPlanItems.length}/{planItems.length}</span>
            </div>
            <div className="step-list" data-testid="exploration-targets">
              {planTargets.length ? planTargets.map((target) => (
                <div className="step-row" key={target.targetId}>
                  <strong>{resolvedTargetIds.has(target.targetId) ? '已确认' : '待确认'} · {target.kind} · {target.name}</strong>
                  <span>{target.stateKey || 'initial'} · {(target.caseIds || []).join('、')}</span>
                  <small>{target.targetId}</small>
                </div>
              )) : <p className="muted">等待生成交互控件清单。</p>}
            </div>
            <div className="list-tools">
              <input
                data-testid="exploration-search"
                value={listSearch}
                onChange={(event) => setListSearch(event.target.value)}
                placeholder="搜索 action、描述、URL、状态"
              />
              <select data-testid="exploration-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">全部状态</option>
                <option value="planned">计划中</option>
                <option value="pending">待执行</option>
                <option value="running">运行中</option>
                <option value="passed">已通过</option>
                <option value="failed">失败</option>
                <option value="skipped">已跳过</option>
                <option value="partial">部分完成</option>
              </select>
            </div>
            <div className="step-list" data-testid="exploration-plan">
              {filteredPlanItems.length ? filteredPlanItems.map((step) => (
                <div className="step-row" key={`${step.index}-${step.action}`}>
                  <strong>{step.index + 1}. {step.action}</strong>
                  <span>{step.journeyId || step.stateKey || '状态路径'} · {step.description}</span>
                  <small>{step.target || step.value || (step.skipped ? 'skipped' : 'planned')}</small>
                </div>
              )) : <p className="muted">{planItems.length ? '没有匹配的计划步骤。' : '等待生成探索计划。'}</p>}
            </div>
          </div>
          <div className="data-panel">
            <div className="panel-heading compact">
              <h3>步骤证据</h3>
              <span className="muted">{filteredStepItems.length}/{stepItems.length}</span>
            </div>
            <div className="step-list" data-testid="step-evidence">
              {filteredStepItems.length ? filteredStepItems.map((step) => (
                <div className="step-row" key={step.id}>
                  <strong>{step.stepIndex + 1}. {step.action} · {step.status}</strong>
                  <span>{step.title || step.description}</span>
                  <small>{step.urlAfter || step.screenshotPath || '等待证据'}</small>
                  {step.candidates?.length ? <small>候选元素 {step.candidates.length} 个</small> : null}
                  {step.recovery?.status ? (
                    <small>
                      自动进入登录入口{step.recovery.status === 'passed' ? '成功' : step.recovery.status === 'failed' ? '失败' : '进行中'}
                      {step.recovery.entry?.name ? `：${step.recovery.entry.name}` : ''}
                    </small>
                  ) : null}
                  {step.error ? <small>{step.error}</small> : null}
                </div>
              )) : <p className="muted">{stepItems.length ? '没有匹配的步骤证据。' : '暂无步骤证据。'}</p>}
            </div>
          </div>
        </div>
        <div className="exploration-log" data-testid="exploration-log">
          {explorationLogs.length ? explorationLogs.map((log) => (
            <p key={log.id} className={`log ${log.level}`}>
              <span>{formatLogTime(log.createdAt)} #{log.id}</span>
              {log.message}
            </p>
          )) : <p className="log muted">等待探索日志。</p>}
        </div>
      </div>
      <div className="data-panel">
        <div className="panel-heading">
          <h3>已确认元素</h3>
          <div className="action-row">
            <button type="button" className="ghost-button" onClick={() => setAllElementsConfirmed(true)}>确认全部候选</button>
            <button type="button" className="ghost-button" onClick={() => setAllElementsConfirmed(false)}>取消全部确认</button>
            <button type="button" className="ghost-button" onClick={addElement}>新增元素</button>
          </div>
        </div>
        <p className="muted">系统推荐 {recommendedCount} 个高置信 selector，当前确认 {confirmedCount} 个；文本定位、歧义定位和低于 85 分的 locator 不会自动确认。</p>
        <div className="element-table">
          {exploration.elements.map((element, index) => (
            <div className="element-row" key={`${element.name}-${index}`}>
              <input value={element.area} onChange={(event) => updateElement(index, 'area', event.target.value)} placeholder="页面/区域" />
              <input value={element.name} onChange={(event) => updateElement(index, 'name', event.target.value)} placeholder="元素名称" />
              <select value={element.locatorType} onChange={(event) => updateElement(index, 'locatorType', event.target.value)}>
                <option value="role">role</option>
                <option value="label">label</option>
                <option value="placeholder">placeholder</option>
                <option value="text">text</option>
                <option value="testid">testid</option>
                <option value="selector">selector</option>
              </select>
              <input value={element.locatorValue} onChange={(event) => updateElement(index, 'locatorValue', event.target.value)} placeholder="locator 值" />
              <input value={element.source} onChange={(event) => updateElement(index, 'source', event.target.value)} placeholder="来源说明" />
              <label className="check-cell">
                <input data-testid="candidate-confirm-checkbox" type="checkbox" checked={element.confirmed} onChange={(event) => updateElement(index, 'confirmed', event.target.checked)} />
                {element.recommended ? '推荐 · 确认' : '确认'}
              </label>
              {(element.stateKey || element.caseIds?.length || element.fallbacks?.length || element.confidence != null) ? (
                <small className="element-asset-meta">
                  {element.stateKey || '未标注状态'} · {(element.caseIds || []).join('、') || '未映射用例'} · 备用 {element.fallbacks?.length || 0} · {element.confidence ?? 0} 分 · 匹配 {element.matchCount ?? 0}
                </small>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cases({ item, casesMarkdown, setCasesMarkdown, pendingDeletions, setPendingDeletions, assistantProposalCommits, setAssistantProposalCommits, generateCases, action = '', assetMode, setAssetMode, debugSession = null, exitCaseDebug, canEdit = true, aiConfigured = false, clearPageData, clearing = false }) {
  const analysis = item?.requirementAnalysis;
  const project = item?.projectContext;
  const boundCaseCount = item?.caseIds?.length || item?.testCases?.length || 0;
  const hasCases = Boolean(casesMarkdown.trim());
  const parsedDocument = useMemo(() => parseCaseMarkdownDocument(casesMarkdown), [casesMarkdown]);
  const persistedCasesByExternalId = useMemo(
    () => new Map((item?.testCases || []).map((caseItem) => [caseItem.externalId, caseItem])),
    [item?.testCases],
  );
  const tableRows = useMemo(
    () => parsedDocument.rows.map((row) => ({ ...row, _caseId: persistedCasesByExternalId.get(row.externalId)?.id || '' })),
    [parsedDocument.rows, persistedCasesByExternalId],
  );
  const [viewMode, setViewMode] = useState(hasCases || !canEdit ? 'preview' : 'table');
  const [tableError, setTableError] = useState('');
  const [caseEditor, setCaseEditor] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantTarget, setAssistantTarget] = useState('');
  const [assistantUndo, setAssistantUndo] = useState(null);
  const [assistantNotice, setAssistantNotice] = useState('');
  const [assistantAffectedIds, setAssistantAffectedIds] = useState(() => new Set());
  const previousItemIdRef = useRef(item?.id);
  const previousCasesRevisionRef = useRef(item?.casesRevisionId);
  const drawerTriggerRef = useRef(null);

  useEffect(() => {
    if (previousItemIdRef.current !== item?.id) {
      previousItemIdRef.current = item?.id;
      setViewMode(casesMarkdown.trim() || !canEdit ? 'preview' : 'table');
      setTableError('');
      setCaseEditor(null);
      setAssistantTarget('');
      setAssistantUndo(null);
      setAssistantNotice('');
      setAssistantAffectedIds(new Set());
    }
  }, [canEdit, casesMarkdown, item?.id]);

  useEffect(() => {
    if (previousCasesRevisionRef.current === item?.casesRevisionId) return;
    previousCasesRevisionRef.current = item?.casesRevisionId;
    setAssistantUndo(null);
    setAssistantNotice('');
    setAssistantAffectedIds(new Set());
  }, [item?.casesRevisionId]);

  useEffect(() => {
    if (!canEdit && viewMode !== 'preview') setViewMode('preview');
  }, [canEdit, viewMode]);

  function switchViewMode(nextMode) {
    if (nextMode === 'table' && hasCases && !parsedDocument.valid) {
      setTableError('当前 Markdown 未识别到包含 ID、标题和分隔行的有效用例表格，请先在源码中修正格式。');
      setViewMode('source');
      return;
    }
    setTableError('');
    setViewMode(nextMode);
  }

  function applyTableRows(rows) {
    setCasesMarkdown(replaceCaseMarkdownTable(casesMarkdown, rows, parsedDocument));
    setTableError('');
  }

  function openCaseEditor(mode, row, index, trigger) {
    drawerTriggerRef.current = trigger || null;
    setCaseEditor({
      mode,
      index,
      error: '',
      draft: mode === 'create' ? createEmptyCaseDraft(tableRows) : stripCaseInternalFields(row),
    });
  }

  function closeCaseEditor() {
    setCaseEditor(null);
    window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
  }

  function updateCaseDraft(key, value) {
    setCaseEditor((current) => current ? { ...current, error: '', draft: { ...current.draft, [key]: value } } : current);
  }

  function saveCaseDraft() {
    if (!caseEditor) return;
    const draft = Object.fromEntries(Object.entries(caseEditor.draft).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
    if (!draft.externalId || !draft.title) {
      setCaseEditor((current) => ({ ...current, error: 'ID 和标题为必填项。' }));
      return;
    }
    const duplicate = tableRows.some((row, index) => index !== caseEditor.index && row.externalId === draft.externalId);
    if (duplicate) {
      setCaseEditor((current) => ({ ...current, error: `用例 ID ${draft.externalId} 已存在。` }));
      return;
    }
    const nextRows = tableRows.map(stripCaseInternalFields);
    if (caseEditor.mode === 'create') nextRows.push(draft);
    else nextRows[caseEditor.index] = draft;
    applyTableRows(nextRows);
    closeCaseEditor();
  }

  function deleteCaseRow(row, index) {
    if (tableRows.length <= 1) return;
    const label = [row.externalId, row.title].filter(Boolean).join(' · ');
    if (!window.confirm(`确认从当前用例草稿移除「${label}」？保存修改后将正式删除结构化用例及套件关联。`)) return;
    if (row._caseId) {
      setPendingDeletions((items) => items.some((item) => item.caseId === row._caseId)
        ? items
        : [...items, { caseId: row._caseId, externalId: row.externalId, row: stripCaseInternalFields(row), index }]);
    }
    applyTableRows(tableRows.filter((_, rowIndex) => rowIndex !== index).map(stripCaseInternalFields));
  }

  function undoCaseDeletion(deletion) {
    const nextRows = tableRows.map(stripCaseInternalFields);
    nextRows.splice(Math.min(deletion.index, nextRows.length), 0, deletion.row);
    applyTableRows(nextRows);
    setPendingDeletions((items) => items.filter((item) => item.caseId !== deletion.caseId));
  }

  function openAssistantForCase(externalId = '') {
    setAssistantTarget(externalId);
    setAssistantOpen(true);
  }

  function applyAssistantResult(proposal, result) {
    const appliedIds = new Set(result.appliedOperationIds || []);
    if (debugSession) {
      const currentExternalId = debugSession.case?.externalId || '';
      const unsafeOperations = (proposal.operations || []).filter((operation) => appliedIds.has(operation.id) && (operation.type !== 'update' || operation.targetExternalId !== currentExternalId));
      if (unsafeOperations.length) {
        setAssistantNotice('单用例工作区只接受对当前用例的字段修改，新增、删除或其他用例变更已拒绝。');
        return;
      }
    }
    setAssistantAffectedIds(new Set(
      (proposal.operations || [])
        .filter((operation) => appliedIds.has(operation.id) && operation.type !== 'delete')
        .map((operation) => operation.targetExternalId),
    ));
    setAssistantUndo({
      proposalId: proposal.id,
      casesMarkdown,
      pendingDeletions,
      proposalCommits: assistantProposalCommits,
    });
    setCasesMarkdown(result.content || casesMarkdown);
    const deletedExternalIds = new Set(result.deletedExternalIds || []);
    if (deletedExternalIds.size) {
      setPendingDeletions((items) => {
        const next = [...items];
        deletedExternalIds.forEach((externalId) => {
          const caseItem = (item?.testCases || []).find((candidate) => candidate.externalId === externalId);
          if (!caseItem || next.some((deletion) => deletion.caseId === caseItem.id)) return;
          const index = tableRows.findIndex((row) => row.externalId === externalId);
          const row = tableRows[index];
          next.push({ caseId: caseItem.id, externalId, row: stripCaseInternalFields(row || {}), index: Math.max(0, index) });
        });
        return next;
      });
    }
    setAssistantProposalCommits((items) => [
      ...items.filter((entry) => entry.proposal_id !== proposal.id),
      {
        proposal_id: proposal.id,
        operation_ids: [...new Set([
          ...(items.find((entry) => entry.proposal_id === proposal.id)?.operation_ids || []),
          ...(result.appliedOperationIds || []),
        ])],
      },
    ]);
    setViewMode('table');
    setAssistantNotice(`已将 ${result.appliedOperationIds?.length || 0} 项 AI 变更应用到草稿，尚未保存。`);
  }

  function undoAssistantResult(proposalId) {
    if (!assistantUndo || assistantUndo.proposalId !== proposalId) return;
    setCasesMarkdown(assistantUndo.casesMarkdown);
    setPendingDeletions(assistantUndo.pendingDeletions);
    setAssistantProposalCommits(assistantUndo.proposalCommits);
    setAssistantUndo(null);
    setAssistantAffectedIds(new Set());
    setAssistantNotice('已撤销本次 AI 草稿变更。');
  }

  function updateMarkdownSource(value) {
    setCasesMarkdown(value);
    const nextDocument = parseCaseMarkdownDocument(value);
    const restoredExternalIds = new Set(nextDocument.rows.map((row) => row.externalId));
    setPendingDeletions((items) => items.filter((item) => !restoredExternalIds.has(item.externalId)));
    if (tableError) setTableError('');
  }

  const canSaveCases = Boolean(item && parsedDocument.valid && parsedDocument.rows.length && !action && canEdit);
  const hasPageData = Boolean(item || hasCases || pendingDeletions.length);
  const modeLabel = viewMode === 'preview' ? '渲染预览' : viewMode === 'table' ? '结构化表格编辑' : 'Markdown 源码编辑';

  return (
    <section className="module-section" aria-label="用例设计">
      <CaseDebugBanner session={debugSession} onExit={exitCaseDebug} />
      <div className="section-header">
        <div>
          <h2>可追溯测试用例</h2>
          <p>{debugSession ? `只编辑 ${debugSession.case?.externalId || '当前用例'}；修改保存在隔离草稿中，通过执行后才发布。` : '审阅、补充或重新生成当前工单的测试用例；以冒烟/回归用例为主，业务规则必须来自实际需求。'}</p>
        </div>
        <div className="action-row">
          {!debugSession && <button type="button" className="ghost-button danger-action" disabled={Boolean(action) || clearing || !hasPageData || !canEdit} onClick={clearPageData}>
            <Trash2 size={17} />
            {clearing ? '清空中...' : '一键清空'}
          </button>}
          {!debugSession && <button type="button" className="ghost-button" disabled={!item || Boolean(action) || clearing || !canEdit} onClick={() => generateCases('generate')}>
            <Brain size={17} />
            {action === 'generate' ? '生成中...' : '自动生成'}
          </button>}
          <button type="button" className={assistantOpen ? 'ghost-button active' : 'ghost-button'} disabled={!item} onClick={() => openAssistantForCase(debugSession?.case?.externalId || '')}>
            <Bot size={17} />
            AI 助手
          </button>
          <button type="button" className="primary-action" disabled={!canSaveCases || clearing} onClick={() => generateCases('save')}>
            <Save size={17} />
            {action === 'save' ? '保存中...' : debugSession ? '保存单用例草稿' : '保存修改'}
          </button>
        </div>
      </div>
      {item && (
        <div className="data-panel" data-testid="case-design-context">
          <h3>用例设计上下文</h3>
          <p className="muted">需求：{analysis?.goal}</p>
          <p className="muted">验收：{analysis?.acceptance}</p>
          <p className="muted">设计约束：用例以冒烟/回归为主；未在需求、验收或测试数据中明确的业务规则仅可标记为需业务规则确认。</p>
          <p className="muted">项目约定：{project?.testDir} / {project?.specPattern}；{project?.locatorStyle}</p>
          {!debugSession && <div className="asset-mode-row">
            <label className="field compact-field">
              <span>资产模式</span>
              <select value={assetMode} disabled={!canEdit} onChange={(event) => setAssetMode(event.target.value)}>
                <option value="create">新建用例和脚本</option>
                <option value="refresh" disabled={!boundCaseCount}>刷新替换已有用例</option>
                <option value="append">追加/整改覆盖点</option>
              </select>
            </label>
            <span className="source-chip">{assetModeLabel(assetMode)} · 已绑定 {boundCaseCount} 条用例</span>
          </div>}
        </div>
      )}
      {assistantNotice && <div className="case-ai-draft-notice" role="status"><Sparkles size={16} /><span>{assistantNotice}</span></div>}
      <div className={`case-design-workspace ${assistantOpen ? 'with-assistant' : ''}`}>
      <div className="case-content-workspace">
        <div className="case-content-toolbar">
          <div className="case-content-summary" aria-live="polite">
            <strong>{parsedDocument.rows.length ? `${parsedDocument.rows.length} 条测试用例` : hasCases ? 'Markdown 测试用例' : '暂无测试用例'}</strong>
            <span>{modeLabel}</span>
          </div>
          <div className="segmented-control case-view-toggle" role="tablist" aria-label="用例展示模式" data-testid="case-view-toggle">
            <button
              type="button"
              id="case-preview-tab"
              role="tab"
              aria-controls="case-preview-panel"
              aria-selected={viewMode === 'preview'}
              className={viewMode === 'preview' ? 'active' : ''}
              onClick={() => switchViewMode('preview')}
            >
              <Eye size={16} />
              预览
            </button>
            {canEdit && (
              <button
                type="button"
                id="case-table-tab"
                role="tab"
                aria-controls="case-table-panel"
                aria-selected={viewMode === 'table'}
                className={viewMode === 'table' ? 'active' : ''}
                onClick={() => switchViewMode('table')}
              >
                <Table2 size={16} />
                表格编辑
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                id="case-source-tab"
                role="tab"
                aria-controls="case-source-panel"
                aria-selected={viewMode === 'source'}
                className={viewMode === 'source' ? 'active' : ''}
                onClick={() => switchViewMode('source')}
              >
                <Code2 size={16} />
                Markdown 源码
              </button>
            )}
          </div>
        </div>

        {viewMode === 'preview' ? (
          <div
            id="case-preview-panel"
            className="case-markdown-preview"
            data-testid="case-markdown-preview"
            role="tabpanel"
            aria-labelledby="case-preview-tab"
          >
            {hasCases ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                  table: ({ node: _node, ...props }) => (
                    <div className="case-markdown-table-wrap">
                      <table {...props} />
                    </div>
                  ),
                }}
              >
                {casesMarkdown}
              </ReactMarkdown>
            ) : (
              <div className="case-markdown-empty">
                <FileCheck2 size={28} />
                <strong>暂无测试用例</strong>
                {canEdit && !debugSession && <button type="button" className="ghost-button" onClick={() => switchViewMode('table')}>新增用例</button>}
              </div>
            )}
          </div>
        ) : viewMode === 'table' ? (
          <div id="case-table-panel" className="case-structured-editor" role="tabpanel" aria-labelledby="case-table-tab" data-testid="case-structured-editor">
            <div className="case-structured-toolbar">
              <span>{tableRows.length ? `当前 ${tableRows.length} 条，修改将在保存后生效` : '当前没有用例'}</span>
              {!debugSession && <button type="button" className="ghost-button" onClick={(event) => openCaseEditor('create', null, tableRows.length, event.currentTarget)}>
                <Plus size={16} />
                新增用例
              </button>}
            </div>
            {pendingDeletions.length > 0 && (
              <div className="case-pending-deletions" role="status" data-testid="case-pending-deletions">
                <div><Trash2 size={17} /><strong>{pendingDeletions.length} 条用例待删除，保存修改后正式生效</strong></div>
                <div className="case-pending-list">
                  {pendingDeletions.map((deletion) => (
                    <button type="button" className="ghost-button" key={deletion.caseId} onClick={() => undoCaseDeletion(deletion)}>
                      撤销 {deletion.externalId}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tableRows.length ? (
              <div className="case-structured-table-wrap">
                <table className="case-structured-table">
                  <thead>
                    <tr>
                      {CASE_TABLE_FIELDS.map((field) => <th key={field.key}>{field.header}</th>)}
                      <th className="case-actions-column">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, index) => (
                      <tr className={assistantAffectedIds.has(row.externalId) ? 'case-ai-affected-row' : undefined} key={`${row.externalId}-${index}`}>
                        {CASE_TABLE_FIELDS.map((field) => <td key={field.key} title={row[field.key]}>{row[field.key] || '-'}</td>)}
                        <td className="case-actions-column">
                          <div className="case-row-actions">
                            <button type="button" title={`让 AI 修改用例 ${row.externalId}`} aria-label={`让 AI 修改用例 ${row.externalId}`} onClick={() => openAssistantForCase(row.externalId)}>
                              <Sparkles size={16} />
                            </button>
                            <button type="button" title={`编辑用例 ${row.externalId}`} aria-label={`编辑用例 ${row.externalId}`} onClick={(event) => openCaseEditor('edit', row, index, event.currentTarget)}>
                              <Edit3 size={16} />
                            </button>
                            {!debugSession && <button type="button" className="danger" title={tableRows.length <= 1 ? '至少保留一条用例，请先新增替代用例' : `删除用例 ${row.externalId}`} aria-label={`删除用例 ${row.externalId}`} disabled={tableRows.length <= 1} onClick={() => deleteCaseRow(row, index)}>
                              <Trash2 size={16} />
                            </button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="case-markdown-empty compact">
                <FileCheck2 size={28} />
                <strong>暂无测试用例</strong>
                {!debugSession && <button type="button" className="ghost-button" onClick={(event) => openCaseEditor('create', null, 0, event.currentTarget)}>新增用例</button>}
              </div>
            )}
          </div>
        ) : (
          <div id="case-source-panel" role="tabpanel" aria-labelledby="case-source-tab">
            {tableError && <div className="case-source-error" role="alert">{tableError}</div>}
            <textarea
              className="editor markdown case-markdown-editor"
              data-testid="case-markdown-editor"
              aria-label="Markdown 测试用例源码"
              value={casesMarkdown}
              disabled={!canEdit}
              onChange={(event) => updateMarkdownSource(event.target.value)}
              placeholder="在这里粘贴或编辑测试用例 markdown 表格。"
            />
          </div>
        )}
      </div>
      <CaseAssistantPanel
        item={item}
        rows={tableRows}
        draftMarkdown={casesMarkdown}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        canEdit={canEdit}
        aiConfigured={aiConfigured}
        initialTarget={assistantTarget}
        onApplied={applyAssistantResult}
        appliedProposalIds={new Map((assistantProposalCommits || []).map((entry) => [entry.proposal_id, new Set(entry.operation_ids || [])]))}
        onUndo={undoAssistantResult}
      />
      </div>
      {caseEditor && (
        <CaseEditorDrawer
          editor={caseEditor}
          onChange={updateCaseDraft}
          onClose={closeCaseEditor}
          onSave={saveCaseDraft}
        />
      )}
    </section>
  );
}

function CaseEditorDrawer({ editor, onChange, onClose, onSave }) {
  const firstFieldRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return createPortal(
    <div className="case-editor-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="case-editor-drawer" role="dialog" aria-modal="true" aria-labelledby="case-editor-title" data-testid="case-editor-drawer">
        <header className="case-editor-header">
          <div>
            <h3 id="case-editor-title">{editor.mode === 'create' ? '新增测试用例' : '编辑测试用例'}</h3>
            <p>{editor.mode === 'create' ? '填写后加入当前用例草稿。' : `${editor.draft.externalId} · 修改将在保存后生效。`}</p>
          </div>
          <button type="button" className="artifact-modal-close" title="关闭用例编辑器" aria-label="关闭用例编辑器" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="case-editor-body">
          <div className="case-editor-grid">
            <label className="field">
              <span>ID *</span>
              <input ref={editor.mode === 'create' ? firstFieldRef : null} value={editor.draft.externalId} disabled={editor.mode !== 'create'} onChange={(event) => onChange('externalId', event.target.value)} />
            </label>
            <label className="field">
              <span>优先级</span>
              <select ref={editor.mode !== 'create' ? firstFieldRef : null} value={editor.draft.priority} onChange={(event) => onChange('priority', event.target.value)}>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
              </select>
            </label>
            <label className="field full-span">
              <span>标题 *</span>
              <input value={editor.draft.title} onChange={(event) => onChange('title', event.target.value)} />
            </label>
            {CASE_TABLE_FIELDS.filter((field) => !['externalId', 'priority', 'title'].includes(field.key)).map((field) => (
              <label className="field full-span" key={field.key}>
                <span>{field.header}</span>
                <textarea value={editor.draft[field.key]} onChange={(event) => onChange(field.key, event.target.value)} />
              </label>
            ))}
          </div>
          {editor.error && <div className="case-editor-error" role="alert">{editor.error}</div>}
        </div>
        <footer className="case-editor-footer">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="button" className="primary-action" onClick={onSave}>
            <Save size={16} />
            保存到草稿
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function CaseDebugBanner({ session, action = '', onSync, onExit }) {
  if (!session) return null;
  const sharedSpec = Boolean(session.sharedScriptDebug);
  const dependency = session.dependencyExecution || {};
  const scopeLabel = dependency.recommendation === 'group'
    ? `依赖组 ${dependency.externalIds?.length || 0} 条`
    : dependency.recommendation === 'review'
      ? '执行范围需确认'
      : '单用例可独立执行';
  return (
    <div className={`case-debug-banner ${session.stale ? 'stale' : ''}`} role="status" data-testid="case-debug-banner">
      <div className="case-debug-banner-icon"><Wrench size={19} /></div>
      <div className="case-debug-banner-copy">
        <strong>{sharedSpec ? '共享 spec 私有分支' : '单用例调试'} · {session.case?.externalId || session.caseId}</strong>
        <span>{sharedSpec ? '编辑器展示完整共享源码，执行和发布仅针对当前用例' : `用例修订 #${session.caseRevisionId || '-'} · 候选脚本 v${session.currentScriptVersion?.version || '-'}`} · 最近 Run {session.latestRunId || '-'}</span>
        {sharedSpec && <span>边界 grep · {session.debugGrepPattern || session.case?.externalId || session.caseId}</span>}
        {sharedSpec && <span>依赖分析 · {scopeLabel}{dependency.groupTitle ? ` · ${dependency.groupTitle}` : ''}</span>}
        {sharedSpec && dependency.reasons?.[0]?.message && <span>{dependency.reasons[0].message}</span>}
      </div>
      <span className="source-chip">{session.stale ? '用例已更新' : sharedSpec ? '共享 spec 草稿' : statusLabel(session.status)}</span>
      <div className="action-row">
        {session.stale && onSync && <button type="button" className="primary-action" disabled={Boolean(action)} onClick={onSync}><RefreshCw size={16} />同步最新用例</button>}
        <button type="button" className="ghost-button" disabled={['running', 'healing'].includes(session.status)} onClick={onExit}><X size={16} />退出调试</button>
      </div>
    </div>
  );
}

function ScriptVersionComparison({ session }) {
  if (!session || session.status !== 'passed' || !session.currentScriptVersion) return null;
  return (
    <div className="data-panel case-debug-comparison" data-testid="case-debug-script-comparison">
      <h3>发布前脚本对比</h3>
      <div className="case-debug-comparison-grid">
        <div><span>{session.sharedScriptDebug ? '来源共享 spec' : '当前 active'} · v{session.sourceScriptVersion?.version || '-'}</span><pre>{session.sourceScriptVersion?.content || '当前用例尚无来源脚本'}</pre></div>
        <div><span>{session.sharedScriptDebug ? '验证通过私有分支' : '验证通过候选'} · v{session.currentScriptVersion.version || '-'}</span><pre>{session.currentScriptVersion.content || ''}</pre></div>
      </div>
    </div>
  );
}

function BatchDebugNavigator({ batch, activeSessionId, onSelect, onCancel, loadingCaseId = '' }) {
  if (!batch?.items?.length) return null;
  const labels = { queued: '等待', running: '运行中', passed: '通过', failed: '失败', needs_attention: '待处理', cancelled: '已停止' };
  const completed = (batch.passedCases || 0) + (batch.failedCases || 0) + (batch.pendingCases || 0);
  return (
    <section className="batch-debug-navigator" aria-label="批量调试用例">
      <div className="batch-debug-navigator-summary">
        <div>
          <strong>批量调试 · {batch.totalCases} 条同项目用例</strong>
          <span>{batch.environment?.name || '项目默认环境'} · 已完成 {completed}/{batch.totalCases}</span>
        </div>
        <div className="action-row">
          <span className={`source-chip ${batch.status}`}>{labels[batch.status] || statusLabel(batch.status)}</span>
          {!['passed', 'failed', 'needs_attention', 'cancelled'].includes(batch.status) && <button type="button" className="ghost-button danger-action" onClick={onCancel}><Square size={15} />停止队列</button>}
        </div>
      </div>
      <div className="batch-debug-case-tabs" role="tablist" aria-label="切换批量调试用例">
        {batch.items.map((entry) => {
          const active = entry.debugSessionId === activeSessionId;
          return (
            <button type="button" role="tab" aria-selected={active} className={active ? 'active' : ''} key={entry.id || entry.caseId} onClick={() => onSelect(entry)} disabled={!entry.debugSessionId || loadingCaseId === entry.caseId} title={entry.error || entry.case?.title || ''}>
              {loadingCaseId === entry.caseId ? <RefreshCw className="spin" size={14} /> : <span className={`batch-debug-status-dot ${entry.status}`} />}
              <span>{entry.case?.externalId || entry.caseId}</span>
              <small>{labels[entry.status] || entry.status}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Scripts({ item, latestRun, scriptContent, setScriptContent, selectedCaseId, onSelectCase, fixtureContent, setFixtureContent, generateScript, action = '', generation = emptyScriptGenerationState(), assetMode, debugSession = null, debugBatch = null, selectBatchDebugItem, cancelCaseDebugBatch, debugAction = '', aiConfigured = false, syncDebugCase, exitCaseDebug, canEdit = true, clearPageData, clearing = false }) {
  const [editorTab, setEditorTab] = useState('case');
  const scriptEditorRef = useRef(null);
  const previousGenerationRunningRef = useRef(false);
  const allStoredVersions = item?.scriptVersions || item?.scriptSet?.scriptVersions || [];
  const storedVersions = debugSession
    ? [debugSession.currentScriptVersion].filter(Boolean)
    : allStoredVersions;
  const versionByCaseId = new Map(storedVersions.map((version) => [version.caseId, version]));
  const testCases = debugSession ? [debugSession.case].filter(Boolean) : (item?.testCases || []);
  let caseEntries = testCases.map((caseItem) => ({
    caseId: caseItem.id,
    case: caseItem,
    version: versionByCaseId.get(caseItem.id) || null,
  }));
  if (!caseEntries.length && item?.caseIds?.length) {
    caseEntries = item.caseIds.map((caseId) => ({
      caseId,
      case: storedVersions.find((version) => version.caseId === caseId)?.case || { externalId: caseId, title: '测试用例' },
      version: versionByCaseId.get(caseId) || null,
    }));
  }
  if (!caseEntries.length && storedVersions.length) {
    caseEntries = storedVersions.map((version) => ({ caseId: version.caseId, case: version.case || {}, version }));
  }
  if (!caseEntries.length && scriptContent.trim()) {
    const caseId = item?.caseIds?.[0] || 'legacy-script';
    const version = {
      id: '',
      caseId,
      case: { externalId: caseId || '旧版脚本', title: item?.title || '工单脚本' },
      version: '-',
      status: 'draft',
      specPath: item?.specPath || '',
      content: scriptContent,
    };
    caseEntries = [{ caseId, case: version.case, version }];
  }
  const selectedEntry = caseEntries.find((entry) => entry.caseId === selectedCaseId) || caseEntries[0] || null;
  const selectedVersion = selectedEntry?.version || null;
  const scriptsOutdated = debugSession
    ? Boolean(debugSession.stale || debugSession.scriptOutdated)
    : Boolean(selectedVersion?.outdated);
  const hasPageData = Boolean(item || caseEntries.length || scriptContent.trim());
  const generationBusy = Boolean(action);
  const generationRunning = Boolean(action && action !== 'save');
  const missingCount = caseEntries.filter((entry) => !entry.version || entry.version.outdated).length;
  const failedCount = generation.failedCaseIds?.length || 0;
  const processedCount = (generation.caseIds || []).filter((caseId) => ['completed', 'failed'].includes(generation.statuses?.[caseId])).length;
  const currentProgress = generation.total ? Math.min(100, Math.round((processedCount / generation.total) * 100)) : 0;
  const generateLabel = scriptsOutdated ? '同步最新用例' : storedVersions.length ? '生成未完成' : '生成全部';

  useEffect(() => {
    const shouldFollow = editorTab === 'case' && (generationRunning || previousGenerationRunningRef.current);
    previousGenerationRunningRef.current = generationRunning;
    if (!shouldFollow) return undefined;
    const editor = scriptEditorRef.current;
    if (!editor) return undefined;
    requestAnimationFrame(() => {
      if (editor.isConnected) editor.scrollTop = editor.scrollHeight;
    });
    return undefined;
  }, [editorTab, generation.currentCaseId, generationRunning, scriptContent, selectedCaseId]);

  function caseGenerationStatus(entry) {
    const transientStatus = generation.statuses?.[entry.caseId];
    if (transientStatus) return transientStatus;
    if (entry.version?.outdated || (debugSession?.stale && entry.version)) return 'outdated';
    return entry.version ? 'completed' : 'pending';
  }

  function renderCaseStatus(entry) {
    const status = caseGenerationStatus(entry);
    if (status === 'generating') return <><RefreshCw className="script-status-icon generating" size={14} /><span>生成中</span></>;
    if (status === 'queued') return <><Clock className="script-status-icon" size={14} /><span>排队中</span></>;
    if (status === 'failed') return <><AlertTriangle className="script-status-icon" size={14} /><span>生成失败</span></>;
    if (status === 'outdated') return <><RefreshCw className="script-status-icon" size={14} /><span>用例已更新</span></>;
    if (entry.version) return <><CheckCircle2 className="script-status-icon" size={14} /><span>v{entry.version.version} · {debugSession?.sharedScriptDebug ? '共享 spec 草稿' : statusLabel(entry.version.status)}</span></>;
    return <><CircleDot className="script-status-icon" size={14} /><span>待生成</span></>;
  }

  return (
    <section className="module-section" aria-label="脚本工作台">
      <BatchDebugNavigator batch={debugBatch} activeSessionId={debugSession?.id} onSelect={selectBatchDebugItem} onCancel={cancelCaseDebugBatch} />
      <CaseDebugBanner session={debugSession} action={debugAction} onSync={syncDebugCase} onExit={exitCaseDebug} />
      <div className="section-header">
        <div>
          <h2>Playwright 脚本工作台</h2>
          <p>{debugSession?.sharedScriptDebug ? '完整保留共享 spec 的 hook、helper、describe 和动态测试；运行与发布通过当前用例 ID 限定范围。' : debugSession ? '当前工作台严格限定为所选测试用例；共享 Fixture 仅供查看。' : '每条测试用例维护独立 spec，共享 Fixture 只承载无状态的公共初始化与工具函数。'}</p>
        </div>
        <div className="action-row">
          {!debugSession && <button type="button" className="ghost-button danger-action" disabled={generationBusy || clearing || !hasPageData || !canEdit} onClick={clearPageData}>
            <Trash2 size={17} />
            {clearing ? '清空中...' : '一键清空'}
          </button>}
          <button type="button" className="ghost-button" aria-label={action === 'generate' ? '生成中...' : '自动生成'} disabled={!item || (!debugSession && !missingCount) || generationBusy || clearing || !canEdit || Boolean(debugSession && !aiConfigured)} title={debugSession && !aiConfigured ? '请先配置 AI；仍可手工编写并保存脚本' : ''} onClick={() => generateScript('generate')}>
            <Code2 size={17} />
            {action === 'generate' ? '生成中...' : generateLabel}
          </button>
          {!debugSession && failedCount > 0 && (
            <button type="button" className="ghost-button danger-action" disabled={generationBusy || clearing || !canEdit} onClick={() => generateScript('retry-failed')}>
              <RefreshCw size={17} />
              {action === 'retry-failed' ? '重试中...' : `重试失败（${failedCount}）`}
            </button>
          )}
          <button type="button" className="ghost-button" disabled={!selectedEntry || scriptsOutdated || generationBusy || clearing || !canEdit || Boolean(debugSession && !aiConfigured)} title={scriptsOutdated ? '请先同步最新用例' : '重新生成当前用例脚本'} onClick={() => generateScript('generate-current')}>
            <RefreshCw size={17} />
            {action === 'generate-current' ? '生成中...' : '重新生成当前'}
          </button>
          <button type="button" className="primary-action" disabled={!selectedEntry || scriptsOutdated || !scriptContent.trim() || generationBusy || clearing || !canEdit || editorTab !== 'case'} title={scriptsOutdated ? '请先同步全部最新用例' : '保存当前脚本修改'} onClick={() => generateScript('save')}>
            <Save size={17} />
            {action === 'save' ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
      <div className="data-panel compact-script-panel">
        <div className="delivery-row"><span>资产模式</span><strong>{assetModeLabel(assetMode)}</strong></div>
        {debugSession?.case && <div className="delivery-row"><span>规范脚本标题</span><strong>{`${debugSession.case.externalId || ''} ${debugSession.case.title || ''}`.trim()}</strong></div>}
        <div className="delivery-row"><span>当前验证</span><strong>{latestRun ? statusLabel(latestRun.status) : '未运行'}</strong></div>
        <div className="delivery-row"><span>脚本进度</span><strong>{scriptsOutdated ? `待同步 ${caseEntries.length} 条最新用例` : debugSession?.sharedScriptDebug ? '完整共享源码 · 当前用例私有分支' : `${storedVersions.length}/${caseEntries.length} 份独立 spec`}</strong></div>
        <div className="delivery-row"><span>Fixture</span><strong>{item?.fixtureVersion ? `v${item.fixtureVersion.version}` : '未生成'}</strong></div>
      </div>
      {(generationRunning || generation.total > 0) && (
        <div className="script-generation-progress" aria-live="polite" aria-atomic="true">
          <div>
            <strong>{generationRunning ? '正在逐用例生成' : failedCount ? '本轮生成已结束' : '本轮生成已完成'}</strong>
            <span>{generationRunning && generation.currentIndex ? `第 ${generation.currentIndex}/${generation.total} 条` : `已处理 ${processedCount}/${generation.total} 条`}</span>
          </div>
          <div className="script-generation-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={currentProgress}>
            <span style={{ width: `${currentProgress}%` }} />
          </div>
        </div>
      )}
      <div className="script-workspace-grid">
        <nav className="script-case-navigation" aria-label="测试用例脚本列表">
          <div className="script-case-navigation-header">
            <strong>测试用例</strong>
            <span>{caseEntries.length}</span>
          </div>
          {caseEntries.length ? caseEntries.map((entry) => {
            const caseItem = entry.case || {};
            const selected = entry.caseId === selectedCaseId;
            const generationStatus = caseGenerationStatus(entry);
            return (
              <button
                type="button"
                key={entry.caseId}
                className={`script-case-nav-item ${selected ? 'active' : ''} status-${generationStatus}`.trim()}
                aria-current={selected ? 'true' : undefined}
                aria-label={`${caseItem.externalId || entry.caseId} ${caseItem.title || '未命名用例'} ${generationStatus === 'failed' ? '生成失败' : generationStatus === 'generating' ? '生成中' : generationStatus === 'outdated' ? '用例已更新' : entry.version ? '已生成' : '待生成'}`}
                disabled={generationBusy}
                onClick={() => {
                  onSelectCase(entry.caseId);
                  setEditorTab('case');
                }}
              >
                <span>{caseItem.externalId || entry.caseId}</span>
                <strong>{caseItem.title || '未命名用例'}</strong>
                <small className="script-case-status" title={generation.errors?.[entry.caseId] || ''}>{renderCaseStatus(entry)}</small>
              </button>
            );
          }) : <p className="muted script-case-empty">请先在用例设计中保存测试用例。</p>}
        </nav>
        <div className="script-editor-pane">
          <div className="script-editor-toolbar">
            <div className="segmented-control" aria-label="脚本编辑范围">
              <button type="button" className={editorTab === 'case' ? 'active' : ''} aria-pressed={editorTab === 'case'} onClick={() => setEditorTab('case')}>用例脚本</button>
              <button type="button" className={editorTab === 'fixture' ? 'active' : ''} aria-pressed={editorTab === 'fixture'} onClick={() => setEditorTab('fixture')}>共享 Fixture</button>
            </div>
            {editorTab === 'fixture' ? (
              <button type="button" className="ghost-button" disabled={Boolean(debugSession) || !fixtureContent.trim() || !caseEntries.length || generationBusy || !canEdit} title={debugSession ? '单用例调试中共享 Fixture 只读' : ''} onClick={() => generateScript('generate-all-fixture')}>
                <RefreshCw size={16} />
                应用并重新生成全部
              </button>
            ) : (
              <span>{selectedVersion ? (debugSession?.sharedScriptDebug ? `完整共享源码 · 私有草稿 v${selectedVersion.version || '-'} · 来源 v${debugSession.sourceScriptVersion?.version || '-'}` : `${selectedVersion.scriptName || `${selectedEntry?.case?.externalId || ''} ${selectedEntry?.case?.title || ''}`.trim()} · ${selectedVersion.specPath || '路径待生成'}`) : (selectedEntry ? '当前用例尚未生成脚本' : '请选择测试用例')}</span>
            )}
          </div>
          {editorTab === 'case' ? (
            <textarea ref={scriptEditorRef} className="editor code script-unit-editor" value={scriptContent} disabled={!canEdit || !selectedEntry || generationBusy} onChange={(event) => setScriptContent(event.target.value)} placeholder={selectedEntry ? (debugSession?.sharedScriptDebug ? '完整共享 spec 将在此显示。' : '生成脚本，或在此手工编写当前用例的 Playwright spec。') : '请先选择测试用例。'} />
          ) : (
            <textarea className="editor code script-unit-editor" value={fixtureContent} disabled={!canEdit || generationBusy || Boolean(debugSession)} onChange={(event) => setFixtureContent(event.target.value)} placeholder="共享 Fixture 仅放置无状态的公共初始化和工具函数。" />
          )}
        </div>
      </div>
    </section>
  );
}

function SaveVerifiedArtifactsButton({ item, run, saveArtifacts, saving = false, canSave = true, primary = false }) {
  const alreadySaved = item?.status === 'artifacts-saved';
  const runMatchesItem = Boolean(run?.id && run?.workItemId === item?.id);
  const runIsLatest = Boolean(run?.id && item?.latestRunId === run.id);
  const hasVersionSnapshot = Boolean(run?.scriptVersionId && run?.casesRevisionId);
  const enabled = Boolean(item && runMatchesItem && runIsLatest && run.status === 'passed' && hasVersionSnapshot && canSave && !saving && !alreadySaved);
  const disabledReason = !item
    ? '请先选择需求工单'
    : alreadySaved
      ? '当前通过版本已经保存为交付物'
      : !canSave
        ? '仅管理员或测试负责人可以保存已验证产物'
        : !run
          ? '请先执行测试并获得通过结果'
          : !runMatchesItem
            ? '当前 Run 不属于所选工单'
            : !runIsLatest
              ? '只能保存当前工单最近一次通过的 Run'
              : run.status === 'running'
                ? '测试仍在执行，请等待完成'
                : run.status !== 'passed'
                  ? '只有验证通过后才能保存最终交付物'
                  : !hasVersionSnapshot
                    ? '该历史 Run 缺少版本绑定，请重新执行验证'
                    : '';
  return (
    <button
      type="button"
      className={primary && !alreadySaved ? 'primary-action' : 'ghost-button'}
      disabled={!enabled}
      title={disabledReason}
      onClick={() => saveArtifacts(run.id)}
    >
      <Save size={17} />
      {alreadySaved ? '已保存' : saving ? '保存中...' : '保存已验证产物'}
    </button>
  );
}

function RunLiveConsole({
  run,
  logs,
  browserStatus,
  browserStatusDetail,
  liveConnected,
  browserCanvasRef,
  browserPreviewEnabled,
  setBrowserPreviewEnabled,
  waitingLabel,
  placeholderText,
  testIdPrefix,
  logTestId,
  canvasAriaLabel,
}) {
  const progress = run?.progress || 0;
  const stageLabel = browserStatusDetail || run?.stage?.label || waitingLabel;
  const runStatus = run ? statusLabel(run.status) : waitingLabel;
  const browserShellRef = useRef(null);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);

  const toggleBrowserFullscreen = async () => {
    const shell = browserShellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
      } else {
        await shell.requestFullscreen();
      }
    } catch (err) {
      console.warn('切换实时浏览器全屏失败', err);
    }
  };

  useEffect(() => {
    const updateFullscreenState = () => {
      setBrowserFullscreen(document.fullscreenElement === browserShellRef.current);
    };
    document.addEventListener('fullscreenchange', updateFullscreenState);
    updateFullscreenState();
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);

  return (
    <div className="exploration-preview-panel execution-preview-panel">
      <div className="panel-heading">
        <div>
          <h3>实时浏览器预览</h3>
          <p className="muted">只读展示正在执行的真实 Playwright 页面，避免人工操作干扰自动测试结果。</p>
        </div>
        <div className="browser-preview-heading-actions">
          <BrowserPreviewToggle
            enabled={browserPreviewEnabled}
            onChange={setBrowserPreviewEnabled}
            testId={`${testIdPrefix}-browser-preview-toggle`}
          />
          <span className={isActiveRunStatus(run?.status) ? 'preview-status running' : 'preview-status'}>{stageLabel} · {runStatus}</span>
        </div>
      </div>
      <div className="exploration-runtime execution-runtime" data-testid={`${testIdPrefix}-runtime`}>
        <div>
          <span>当前阶段</span>
          <strong>{stageLabel}</strong>
        </div>
        <div>
          <span>实时会话</span>
          <strong>{browserPreviewEnabled ? (liveConnected ? 'Live WebSocket' : '未连接') : '已关闭'} · {browserStatus}</strong>
        </div>
        <div>
          <span>执行进度</span>
          <strong>{progress}%</strong>
        </div>
      </div>
      <div className="mini-progress" aria-label={`${canvasAriaLabel}进度`}>
        <span style={{ width: `${Math.max(4, progress)}%` }} />
      </div>
      <div className="live-browser-shell automation-live-browser-shell" ref={browserShellRef} data-testid={`${testIdPrefix}-browser-preview`}>
        <div className="browser-live-toolbar">
          <span>只读执行预览 · {browserStatus}</span>
          <div className="action-row">
            <button
              type="button"
              className="ghost-button"
              data-testid={`${testIdPrefix}-browser-fullscreen`}
              title={browserFullscreen ? '退出全屏' : '全屏展示'}
              aria-pressed={browserFullscreen}
              disabled={!browserPreviewEnabled}
              onClick={toggleBrowserFullscreen}
            >
              <Maximize2 size={15} />
              {browserFullscreen ? '退出全屏' : '全屏展示'}
            </button>
          </div>
        </div>
        <canvas
          ref={browserCanvasRef}
          className="browser-live-canvas automation-flow-live-canvas"
          data-testid={`${testIdPrefix}-browser-live-canvas`}
          tabIndex={-1}
          aria-label={canvasAriaLabel}
        />
        {!liveConnected && (
          <div className="preview-placeholder live-overlay">
            <MonitorPlay size={38} />
            <span>{browserPreviewEnabled ? placeholderText : '实时预览已关闭，打开开关后连接浏览器画面。'}</span>
          </div>
        )}
      </div>
      <div className="log-box execution-log" data-testid={logTestId}>
        {logs.length ? logs.map((log) => (
          <p key={`${log.source || 'run'}-${log.id}`} className={`log ${log.level}`}>
            <span>{formatLogTime(log.createdAt)} #{log.id}</span>
            {log.message}
          </p>
        )) : <p className="log muted">暂无日志。</p>}
      </div>
    </div>
  );
}

function EnvironmentSelector({ projects, item, value, onChange, disabled = false, fallbackUrl = '', fallbackLabel = '当前工单 URL', testId }) {
  const project = projectForWorkItem(projects, item);
  const environments = project?.environments || [];
  const selected = environments.find((environment) => environment.id === value)
    || { id: '', name: fallbackLabel, url: fallbackUrl || item?.targetUrl || '' };
  return (
    <div className="execution-environment-bar" data-testid={testId}>
      <label className="field">
        <span>运行环境</span>
        <select value={value} disabled={disabled || (!environments.length && !selected.url)} onChange={(event) => onChange(event.target.value)}>
          {!value && selected.url ? (
            <option value="">{fallbackLabel}</option>
          ) : null}
          {environments.map((environment) => (
            <option value={environment.id} key={environment.id}>
              {environment.name}{environment.isDefault ? '（默认）' : ''}
            </option>
          ))}
          {!environments.length && !selected.url ? <option value="">未配置项目环境</option> : null}
        </select>
      </label>
      <div>
        <span>本次目标 URL</span>
        <strong>{selected.url || '未配置'}</strong>
      </div>
    </div>
  );
}


function Execution({ latestRun, logs, screenshot, runCurrentItem, starting = false, currentItem, projects = [], environmentId = '', setEnvironmentId, debugSession = null, debugExecutionScope = 'auto', setDebugExecutionScope, debugAction = '', publishDebugCase, exitCaseDebug, browserStatus, browserStatusDetail, liveConnected, browserCanvasRef, browserPreviewEnabled, setBrowserPreviewEnabled, canExecute = true, saveArtifacts, savingArtifacts = false, canSaveArtifacts = true, clearPageData, clearing = false }) {
  const runPassed = latestRun?.status === 'passed';
  const hasPageData = Boolean(currentItem || latestRun || logs.length || screenshot);
  const dependency = debugSession?.dependencyExecution || {};
  const effectiveScope = debugSession?.executionPolicy === 'strict-single' ? 'single' : (debugExecutionScope === 'auto' ? dependency.defaultScope || 'single' : debugExecutionScope);
  const groupCount = dependency.externalIds?.length || 0;

  return (
    <section className="module-section" aria-label="执行测试">
      <CaseDebugBanner session={debugSession} action={debugAction} onExit={exitCaseDebug} />
      <div className="section-header">
        <div>
          <h2>执行测试</h2>
          <p>{debugSession ? (effectiveScope === 'group' ? `运行 ${debugSession.case?.externalId || '当前用例'} 所在的最小依赖组，共 ${groupCount} 条测试。` : `仅运行 ${debugSession.case?.externalId || '当前用例'} 的候选脚本。`) : '运行当前脚本批次中的独立 spec，汇总生成 Playwright HTML report。'}</p>
        </div>
        <div className="action-row">
          {!debugSession && <button type="button" className="ghost-button danger-action" disabled={latestRun?.status === 'running' || starting || savingArtifacts || clearing || !hasPageData || !canExecute} onClick={clearPageData}>
            <Trash2 size={17} />
            {clearing ? '清空中...' : '一键清空'}
          </button>}
          <button type="button" className={runPassed ? 'ghost-button' : 'primary-action'} disabled={!(debugSession?.currentScriptVersionId || currentItem?.scriptVersions?.length || currentItem?.scriptContent) || latestRun?.status === 'running' || starting || !canExecute || savingArtifacts || clearing || Boolean(debugSession?.stale)} onClick={runCurrentItem}>
            <Play size={17} />
            {starting ? '启动中...' : debugSession ? (effectiveScope === 'group' ? `执行依赖组（${groupCount}）` : '执行当前用例') : latestRun ? '重新执行' : '执行当前任务'}
          </button>
          {debugSession ? (
            <button type="button" className={runPassed ? 'primary-action' : 'ghost-button'} disabled={!runPassed || !canSaveArtifacts || debugAction === 'publishing'} onClick={publishDebugCase} title={!canSaveArtifacts ? '仅管理员或测试负责人可以发布' : ''}>
              <Save size={17} />{debugAction === 'publishing' ? '发布中...' : '发布当前用例'}
            </button>
          ) : <SaveVerifiedArtifactsButton item={currentItem} run={latestRun} saveArtifacts={saveArtifacts} saving={savingArtifacts || clearing} canSave={canSaveArtifacts} primary={runPassed} />}
        </div>
      </div>
      {debugSession?.executionPolicy !== 'strict-single' && debugSession?.dependencyExecution?.manualChoiceRequired && (
        <div className="segmented-control" aria-label="调试执行范围">
          <button type="button" className={effectiveScope === 'single' ? 'active' : ''} aria-pressed={effectiveScope === 'single'} disabled={starting} onClick={() => setDebugExecutionScope?.('single')}>当前用例</button>
          <button type="button" className={effectiveScope === 'group' ? 'active' : ''} aria-pressed={effectiveScope === 'group'} disabled={starting} onClick={() => setDebugExecutionScope?.('group')}>依赖组（{groupCount}）</button>
        </div>
      )}
      <EnvironmentSelector
        projects={projects}
        item={currentItem}
        value={environmentId}
        onChange={setEnvironmentId}
        disabled={latestRun?.status === 'running' || starting || clearing}
        fallbackUrl={currentItem?.targetUrl || ''}
        testId="execution-environment-selector"
      />
      {latestRun?.environment?.url ? (
        <div className="execution-environment-result"><span>当前 Run 环境</span><strong>{latestRun.environment.name || '运行环境'} · {latestRun.environment.url}</strong></div>
      ) : null}
      {latestRun?.debugExecutionScope ? (
        <div className="execution-environment-result"><span>当前 Run 范围</span><strong>{latestRun.debugExecutionScope === 'group' ? `依赖组 · ${latestRun.debugScopeTestTitles?.length || 0} 条` : '单用例'}</strong></div>
      ) : null}
      <RunLiveConsole
        run={latestRun}
        logs={logs}
        browserStatus={browserStatus}
        browserStatusDetail={browserStatusDetail}
        liveConnected={liveConnected}
        browserCanvasRef={browserCanvasRef}
        browserPreviewEnabled={browserPreviewEnabled}
        setBrowserPreviewEnabled={setBrowserPreviewEnabled}
        waitingLabel="等待执行"
        placeholderText={screenshot ? '等待实时会话连接，保留最近执行截图。' : '点击执行当前任务后连接实时浏览器。'}
        testIdPrefix="execution"
        logTestId="log-panel"
        canvasAriaLabel="执行测试实时浏览器只读预览"
      />
      <a className="report-link" href={playwrightReportUrl({ runId: latestRun?.id })} target="_blank" rel="noreferrer">
        <FileText size={16} />
        Playwright HTML Report
        <ExternalLink size={14} />
      </a>
      <ScriptVersionComparison session={debugSession} />
    </section>
  );
}

function Healing({ item, latestRun, healingRun, healingStarting, aiConfigured, liveRun, logs, projects = [], environmentId = '', setEnvironmentId, debugSession = null, debugAction = '', publishDebugCase, exitCaseDebug, browserStatus, browserStatusDetail, liveConnected, browserCanvasRef, browserPreviewEnabled, setBrowserPreviewEnabled, recordHealing, canEdit = true, saveArtifacts, savingArtifacts = false, canSaveArtifacts = true, clearPageData, clearing = false }) {
  const active = healingStarting || ['queued', 'healing'].includes(healingRun?.status);
  const sourceRun = healingRun?.sourceRun || latestRun;
  const failedScripts = healingRun?.failedScripts || sourceRun?.failedScripts || [];
  const healedRun = healingRun?.latestRun || (healingRun?.latestRunId === latestRun?.id ? latestRun : null);
  const healingPassed = healingRun?.status === 'passed' && healedRun?.status === 'passed';
  const attempts = debugSession ? healingRun?.attempts || [] : healingRun?.attempts || item?.healingAttempts || [];
  const latestAttempt = attempts[attempts.length - 1] || null;
  const diagnosis = healingRun?.diagnosis && Object.keys(healingRun.diagnosis).length
    ? healingRun.diagnosis
    : latestAttempt?.diagnosis || null;
  const currentRound = healingRun?.currentRound || 0;
  const maxRounds = healingRun?.maxRounds || 3;
  const progress = active ? Math.max(6, Math.round((currentRound / maxRounds) * 100)) : healingRun ? 100 : 0;
  const canStart = Boolean(item && latestRun?.status === 'failed' && aiConfigured && canEdit && !active);
  const hasPageData = Boolean(item || healingRun);
  const displayedRerunId = liveRun?.id || latestAttempt?.rerunRunId || '';
  const project = projectForWorkItem(projects, item);
  const selectedEnvironment = project?.environments?.find((environment) => environment.id === environmentId);
  const sourceEnvironment = healingRun?.sourceEnvironment || sourceRun?.environment || {};
  const selectedEnvironmentUrl = healingRun?.environment?.url || selectedEnvironment?.url || sourceEnvironment.url || item?.targetUrl || '';
  const environmentChanged = Boolean(sourceEnvironment.url && selectedEnvironmentUrl && sourceEnvironment.url !== selectedEnvironmentUrl);
  const waitingLabel = active ? '等待启动重跑' : '暂无重跑';
  const placeholderText = liveRun
    ? active
      ? '正在连接当前自愈重跑的实时浏览器会话。'
      : '自愈重跑已结束，保留最后接收到的浏览器画面。'
    : active
      ? '正在分析失败证据并生成修复脚本，等待启动重跑。'
      : '启动自愈后将在此展示当前重跑的实时浏览器画面。';
  const startHint = !item
    ? '请先选择需求工单'
    : latestRun?.status !== 'failed'
      ? '最近一次运行必须为失败状态'
      : !aiConfigured
        ? '请先配置 AI'
        : active
          ? '当前自愈任务正在执行'
          : '';
  return (
    <section className="module-section" aria-label="自愈诊断">
      <CaseDebugBanner session={debugSession} action={debugAction} onExit={exitCaseDebug} />
      <div className="section-header">
        <div>
          <h2>失败诊断与自动修复</h2>
          <p>{debugSession ? '只修复并重跑当前用例，通过后即停止，不触发整工单回归。' : '基于最近失败运行生成修复脚本并自动重跑，通过即停止，单次自愈最多三轮。'}</p>
        </div>
        <div className="action-row">
          {!debugSession && <button type="button" className="ghost-button danger-action" disabled={active || savingArtifacts || clearing || !hasPageData || !canEdit} onClick={clearPageData}>
            <Trash2 size={17} />
            {clearing ? '清空中...' : '一键清空'}
          </button>}
          <button type="button" className={healingPassed ? 'ghost-button' : 'primary-action'} disabled={!canStart || savingArtifacts || clearing} title={startHint} onClick={recordHealing}>
            <RefreshCw size={17} />
            {active ? `自愈中 ${currentRound}/${maxRounds}` : '启动自愈'}
          </button>
          {debugSession ? (
            <button type="button" className={healingPassed ? 'primary-action' : 'ghost-button'} disabled={!healingPassed || !canSaveArtifacts || debugAction === 'publishing'} onClick={publishDebugCase} title={!canSaveArtifacts ? '仅管理员或测试负责人可以发布' : ''}>
              <Save size={17} />{debugAction === 'publishing' ? '发布中...' : '发布当前用例'}
            </button>
          ) : <SaveVerifiedArtifactsButton item={item} run={healedRun} saveArtifacts={saveArtifacts} saving={savingArtifacts || clearing} canSave={canSaveArtifacts} primary={healingPassed} />}
        </div>
      </div>
      <EnvironmentSelector
        projects={projects}
        item={item}
        value={environmentId}
        onChange={setEnvironmentId}
        disabled={active || clearing}
        fallbackUrl={healingRun?.environment?.url || sourceEnvironment.url || item?.targetUrl || ''}
        fallbackLabel={healingRun?.environment?.url ? '当前自愈重跑环境' : sourceEnvironment.url ? '沿用源 Run 环境' : '当前工单 URL'}
        testId="healing-environment-selector"
      />
      {environmentChanged ? (
        <div className="environment-change-warning" role="status">
          <AlertTriangle size={16} />
          <span>诊断仍使用源 Run 环境 {sourceEnvironment.url} 的失败证据，自愈重跑将固定使用 {selectedEnvironmentUrl}。</span>
        </div>
      ) : null}
      <div className="data-panel" data-testid="healing-run-summary">
        <div className="delivery-row"><span>源失败 Run</span><strong>{healingRun?.sourceRunId || sourceRun?.id || '-'}</strong></div>
        <div className="delivery-row"><span>当前状态</span><strong>{healingRun ? statusLabel(healingRun.status) : '等待启动'}</strong></div>
        <div className="delivery-row"><span>当前轮次</span><strong>{currentRound}/{maxRounds}</strong></div>
        <div className="delivery-row"><span>最新重跑</span><strong>{displayedRerunId || '-'}</strong></div>
        <div className="delivery-row"><span>失败用例脚本</span><strong>{failedScripts.length ? `${failedScripts.length} 个` : sourceRun?.status === 'failed' ? '未定位' : '-'}</strong></div>
        <div className="delivery-row"><span>重跑环境</span><strong>{healingRun?.environment?.url || selectedEnvironmentUrl || '-'}</strong></div>
        {diagnosis && <div className="delivery-row"><span>根因分类</span><strong>{healingDiagnosisCategoryLabel(diagnosis.category)}</strong></div>}
        {diagnosis && <div className="delivery-row"><span>诊断置信度</span><strong>{diagnosis.confidence === 'high' ? '高' : diagnosis.confidence === 'medium' ? '中' : '低'}</strong></div>}
        {diagnosis && <div className="delivery-row"><span>处理动作</span><strong>{healingDiagnosisActionLabel(diagnosis.action)}</strong></div>}
        <div className="mini-progress" aria-label="人工自愈进度"><span style={{ width: `${progress}%` }} /></div>
        {failedScripts.length ? (
          <div className="healing-failed-script-list" data-testid="healing-failed-scripts">
            {failedScripts.map((script) => (
              <div className="record-row static" key={script.scriptVersionId || script.caseId || script.specPath}>
                <span>
                  {`${script.externalId || script.caseId || '未绑定用例'}${script.title ? ` · ${script.title}` : ''}`}
                  <small>{script.specPath || '脚本路径未知'}</small>
                </span>
                <strong>失败</strong>
              </div>
            ))}
          </div>
        ) : sourceRun?.status === 'failed' ? (
          <p className="muted" data-testid="healing-failed-scripts-unresolved">未能从 Playwright 结果中定位具体失败用例脚本，请查看执行日志或 HTML Report。</p>
        ) : null}
        {diagnosis?.summary && <p className="muted" data-testid="healing-diagnosis-summary">{diagnosis.summary}</p>}
        {Array.isArray(diagnosis?.evidence) && diagnosis.evidence.length > 0 && (
          <div className="healing-failed-script-list" data-testid="healing-diagnosis-evidence">
            {diagnosis.evidence.map((evidence, index) => (
              <div className="record-row static" key={`${diagnosis.signature || 'diagnosis'}-${index}`}>
                <span>证据 {index + 1}</span>
                <strong>{evidence}</strong>
              </div>
            ))}
          </div>
        )}
        {healingRun?.error && <p className="muted">{healingRun.error}</p>}
      </div>
      <div className="data-panel">
        <h3>自愈轮次</h3>
        {attempts.length ? attempts.map((attempt) => (
          <div className="record-row static" key={attempt.id}>
            <span>
              第 {attempt.round} 轮 · {statusLabel(attempt.status)}
              <small>{attempt.scriptVersionId ? `脚本版本 ${attempt.scriptVersionId}` : '等待修复脚本'} · {attempt.rerunRunId ? `Run ${attempt.rerunRunId}` : '尚未重跑'}</small>
              {attempt.diagnosis?.category && <small>{healingDiagnosisCategoryLabel(attempt.diagnosis.category)} · {healingDiagnosisActionLabel(attempt.diagnosis.action)}</small>}
            </span>
            <strong>{attempt.result || attempt.error || '-'}</strong>
          </div>
        )) : <p className="muted">暂无自愈记录。</p>}
      </div>
      <RunLiveConsole
        run={liveRun}
        logs={logs}
        browserStatus={browserStatus}
        browserStatusDetail={browserStatusDetail}
        liveConnected={liveConnected}
        browserCanvasRef={browserCanvasRef}
        browserPreviewEnabled={browserPreviewEnabled}
        setBrowserPreviewEnabled={setBrowserPreviewEnabled}
        waitingLabel={waitingLabel}
        placeholderText={placeholderText}
        testIdPrefix="healing"
        logTestId="healing-log-panel"
        canvasAriaLabel="自愈重跑实时浏览器只读预览"
      />
      {(healingRun?.latestRunId || latestRun?.id) && (
        <a className="report-link" href={playwrightReportUrl({ runId: liveRun?.id || healingRun?.latestRunId || latestRun?.id })} target="_blank" rel="noreferrer">
          <FileText size={16} />
          Playwright HTML Report
          <ExternalLink size={14} />
        </a>
      )}
      <ScriptVersionComparison session={debugSession} />
    </section>
  );
}

function ExecutionMonitor({
  suiteRuns,
  projects = [],
  testExecutionProjectId,
  suiteNameFilter,
  applyQuery,
  selectedRunId,
  setSelectedRunId,
  selectedRun,
  logs,
  logLevel,
  setLogLevel,
  monitorBrowserRun,
  monitorBrowserCase,
  monitorBrowserStatus,
  monitorBrowserDetail,
  monitorBrowserLiveConnected,
  monitorBrowserHasFrame,
  monitorBrowserCanvasRef,
  browserPreviewEnabled,
  setBrowserPreviewEnabled,
  selectedCaseRunId,
  selectCaseRun,
  deleteSuiteRun,
}) {
  const [monitorListCollapsed, setMonitorListCollapsed] = useState(false);
  const [monitorListPanelWidth, setMonitorListPanelWidth] = useState(340);
  const [queryDraft, setQueryDraft] = useState(() => ({
    projectId: testExecutionProjectId || 'all',
    suiteName: suiteNameFilter || '',
  }));
  useEffect(() => {
    setQueryDraft({
      projectId: testExecutionProjectId || 'all',
      suiteName: suiteNameFilter || '',
    });
  }, [testExecutionProjectId, suiteNameFilter]);
  const activeRun = selectedRun || suiteRuns.find((item) => item.id === selectedRunId) || suiteRuns[0] || null;
  const hasAppliedQuery = (testExecutionProjectId || 'all') !== 'all' || Boolean(suiteNameFilter);
  const filteredLogs = logLevel === 'all' ? logs : logs.filter((log) => log.level === logLevel);
  const runningCount = suiteRuns.filter((run) => ['queued', 'running'].includes(run.status)).length;
  const totalFinishedCases = suiteRuns.reduce((sum, run) => sum + (run.passedCases || 0) + (run.failedCases || 0), 0);
  const totalPassedCases = suiteRuns.reduce((sum, run) => sum + (run.passedCases || 0), 0);
  const totalFailedCases = suiteRuns.reduce((sum, run) => sum + (run.failedCases || 0), 0);
  const passRate = totalFinishedCases ? Math.round((totalPassedCases / totalFinishedCases) * 100) : 0;
  const logLevels = ['all', 'info', 'success', 'warning', 'error'];
  const browserSessionId = monitorBrowserRun?.browserSessionId || monitorBrowserRun?.browserSession?.id || '';
  const browserStageLabel = monitorBrowserDetail || monitorBrowserRun?.stage?.label || monitorBrowserCase?.status || '等待执行';
  const browserProgress = monitorBrowserRun?.progress || 0;
  const browserCaseLabel = monitorBrowserCase?.case
    ? `${monitorBrowserCase.case.externalId || monitorBrowserCase.caseId} · ${monitorBrowserCase.case.title || '用例'}`
    : monitorBrowserCase?.caseId || '等待运行中的用例';
  const browserRunStatus = monitorBrowserRun ? statusLabel(monitorBrowserRun.status) : '未绑定';
  const browserPlaceholderText = browserSessionId
    ? monitorBrowserLiveConnected
      ? '等待实时浏览器画面帧。'
      : '实时浏览器会话已结束或正在连接。'
    : activeRun
      ? '等待套件用例分配单次 Run 后连接实时浏览器画面。'
      : '选择一次执行后查看实时浏览器画面。';
  const submitQuery = (event) => {
    event.preventDefault();
    applyQuery(queryDraft.projectId, queryDraft.suiteName);
  };
  const resetQuery = () => {
    setQueryDraft({ projectId: 'all', suiteName: '' });
    applyQuery('all', '');
  };
  const startMonitorListResize = (event) => {
    if (monitorListCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = monitorListPanelWidth;
    const handleMove = (moveEvent) => {
      const nextWidth = Math.min(560, Math.max(280, startWidth + moveEvent.clientX - startX));
      setMonitorListPanelWidth(nextWidth);
    };
    const stopResize = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopResize);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopResize);
  };

  return (
    <section className="module-section execution-monitor" aria-label="执行监控">
      <div className="section-header">
        <div>
          <h2>执行监控</h2>
          <p>实时查看套件与批量用例执行状态。</p>
        </div>
        <div className="action-row">
          <a className="report-link" href={playwrightReportUrl({ suiteRunId: activeRun?.id })} target="_blank" rel="noreferrer">
            <FileText size={16} />
            Playwright HTML Report
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      <form className="data-panel monitor-query-panel" aria-label="执行监控查询" onSubmit={submitQuery}>
        <label className="field">
          <span>项目</span>
          <select
            value={queryDraft.projectId}
            onChange={(event) => setQueryDraft((current) => ({ ...current, projectId: event.target.value }))}
            data-testid="execution-monitor-query-project"
          >
            <option value="all">全部项目</option>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>测试套件名称</span>
          <input
            value={queryDraft.suiteName}
            onChange={(event) => setQueryDraft((current) => ({ ...current, suiteName: event.target.value }))}
            placeholder="请输入测试套件名称"
            data-testid="execution-monitor-query-name"
          />
        </label>
        <div className="monitor-query-actions">
          <button type="submit" className="primary-action" data-testid="execution-monitor-query-submit">
            <Search size={16} />
            查询
          </button>
          <button type="button" className="ghost-button" onClick={resetQuery} data-testid="execution-monitor-query-reset">
            <RefreshCw size={16} />
            重置
          </button>
        </div>
      </form>

      <div className="stats-grid monitor-stats">
        <div className="stat-tile">
          <RadioTower size={20} />
          <span>运行中</span>
          <strong>{runningCount}</strong>
        </div>
        <div className="stat-tile">
          <History size={20} />
          <span>最近执行</span>
          <strong>{suiteRuns.length}</strong>
        </div>
        <div className="stat-tile">
          <Gauge size={20} />
          <span>通过率</span>
          <strong>{passRate}%</strong>
        </div>
        <div className="stat-tile">
          <AlertTriangle size={20} />
          <span>失败用例</span>
          <strong>{totalFailedCases}</strong>
        </div>
      </div>

      <div
        className={monitorListCollapsed ? 'execution-monitor-layout monitor-list-collapsed' : 'execution-monitor-layout'}
        style={{ '--monitor-list-width': `${monitorListPanelWidth}px` }}
      >
        <aside className="data-panel monitor-run-list" aria-label="执行列表">
          <div className="panel-heading compact">
            <h3>执行列表</h3>
            <div className="monitor-list-actions">
              <span className="muted">最近 {suiteRuns.length}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="收起执行列表"
                title="收起执行列表"
                onClick={() => setMonitorListCollapsed(true)}
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
          </div>
          <div className="monitor-run-items">
            {suiteRuns.length ? suiteRuns.map((run) => {
              const deleteDisabled = isActiveRunStatus(run.status);
              return (
                <div
                  className={`monitor-run-item ${activeRun?.id === run.id ? 'active' : ''}`}
                  key={run.id}
                >
                  <button
                    type="button"
                    className="monitor-run-select"
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <div>
                      <strong>{run.name}</strong>
                      <span>{formatDateTime(run.startedAt)} · {run.progress || 0}%</span>
                    </div>
                    <em className={run.status}>{statusLabel(run.status)}</em>
                    <small>{run.passedCases || 0}/{run.failedCases || 0}/{run.skippedCases || 0}</small>
                  </button>
                  <button
                    type="button"
                    className="icon-button danger monitor-run-delete"
                    aria-label={`删除执行记录 ${run.name}`}
                    title={deleteDisabled ? '运行中或排队中的执行记录不能删除' : '从执行监控列表移除'}
                    disabled={deleteDisabled}
                    onClick={() => deleteSuiteRun(run)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            }) : (
              <div className="empty-suite-state">
                <RadioTower size={24} />
                <strong>{hasAppliedQuery ? '暂无匹配的执行记录' : '暂无执行记录'}</strong>
                <span>{hasAppliedQuery ? '请调整查询条件或重置后查看全部执行记录。' : '从测试套件或执行测试页启动批量执行后，会在这里看到实时状态。'}</span>
              </div>
            )}
          </div>
        </aside>
        <div className="monitor-list-rail">
          <button
            type="button"
            className="icon-button"
            aria-label="展开执行列表"
            title="展开执行列表"
            onClick={() => setMonitorListCollapsed(false)}
          >
            <PanelLeftOpen size={15} />
          </button>
        </div>
        <button
          type="button"
          className="monitor-resize-handle"
          aria-label="调整执行列表宽度"
          title="拖拽调整执行列表宽度"
          onPointerDown={startMonitorListResize}
        />

        <section className="data-panel monitor-detail-panel" aria-label="执行详情">
          {activeRun ? (
            <>
              <div className="panel-heading compact">
                <div>
                  <h3>{activeRun.name}</h3>
                  <p className="muted">Run ID: {activeRun.id} · {formatDateTime(activeRun.startedAt)}</p>
                </div>
                <span className={['queued', 'running'].includes(activeRun.status) ? 'preview-status running' : 'preview-status'}>{statusLabel(activeRun.status)}</span>
              </div>
              <div className="exploration-runtime monitor-run-summary">
                <div><span>总数</span><strong>{activeRun.totalCases || 0}</strong></div>
                <div><span>通过</span><strong>{activeRun.passedCases || 0}</strong></div>
                <div><span>失败</span><strong>{activeRun.failedCases || 0}</strong></div>
                <div><span>跳过</span><strong>{activeRun.skippedCases || 0}</strong></div>
                <div><span>耗时</span><strong>{formatDuration(activeRun.startedAt, activeRun.endedAt)}</strong></div>
                <div><span>运行环境</span><strong>{activeRun.environment?.name || '-'}{activeRun.environment?.url ? ` · ${activeRun.environment.url}` : ''}</strong></div>
              </div>
              <div className="mini-progress" aria-label="监控执行进度"><span style={{ width: `${Math.max(4, activeRun.progress || 0)}%` }} /></div>

              <section className="monitor-browser-panel" aria-label="执行浏览器画面" data-testid="execution-monitor-browser-preview">
                <div className="panel-heading compact">
                  <div>
                    <h3><MonitorPlay size={16} /> 执行浏览器画面</h3>
                    <p className="muted">只读预览真实 Playwright 执行 page，执行期间不开放人工操作。</p>
                  </div>
                  <div className="browser-preview-heading-actions">
                    <BrowserPreviewToggle
                      enabled={browserPreviewEnabled}
                      onChange={setBrowserPreviewEnabled}
                      testId="execution-monitor-browser-preview-toggle"
                    />
                    <span className={monitorBrowserLiveConnected ? 'preview-status running' : 'preview-status'}>{browserStageLabel} · {browserRunStatus}</span>
                  </div>
                </div>
                <div className="exploration-runtime monitor-browser-runtime">
                  <div><span>当前用例</span><strong>{browserCaseLabel}</strong></div>
                  <div><span>单次 Run</span><strong>{monitorBrowserRun?.id || monitorBrowserCase?.runId || '-'}</strong></div>
                  <div><span>浏览器会话</span><strong>{browserSessionId || '-'}</strong></div>
                  <div><span>实时连接</span><strong>{browserPreviewEnabled ? (monitorBrowserLiveConnected ? 'Live WebSocket' : '未连接') : '已关闭'} · {monitorBrowserStatus}</strong></div>
                  <div><span>执行进度</span><strong>{browserProgress}%</strong></div>
                </div>
                <div className="mini-progress" aria-label="执行浏览器画面进度">
                  <span style={{ width: `${Math.max(4, browserProgress)}%` }} />
                </div>
                <div className="live-browser-shell monitor-live-browser-shell">
                  <div className="browser-live-toolbar">
                    <span>只读执行预览 · {monitorBrowserStatus}</span>
                  </div>
                  <canvas
                    ref={monitorBrowserCanvasRef}
                    className="browser-live-canvas monitor-browser-live-canvas"
                    data-testid="execution-monitor-browser-live-canvas"
                    tabIndex={-1}
                    aria-label="执行监控实时浏览器只读画布"
                  />
                  {(!monitorBrowserLiveConnected || !monitorBrowserHasFrame) && (
                    <div className="preview-placeholder live-overlay">
                      <MonitorPlay size={38} />
                      <span>{browserPreviewEnabled ? browserPlaceholderText : '实时预览已关闭，打开开关后连接浏览器画面。'}</span>
                    </div>
                  )}
                </div>
              </section>

              <div className="monitor-detail-grid">
                <div className="monitor-case-panel">
                  <div className="panel-heading compact">
                    <h3>用例明细</h3>
                    <span className="muted">{activeRun.cases?.length || 0} 条</span>
                  </div>
                  <div className="monitor-case-list">
                    {activeRun.cases?.length ? activeRun.cases.map((item) => {
                      const caseLabel = `${item.case?.externalId || item.caseId} · ${item.case?.title || '用例'}`;
                      const isSelected = Boolean(selectedCaseRunId && item.runId === selectedCaseRunId);
                      const rowContent = <>
                        <div>
                          <strong>{caseLabel}</strong>
                          <span>{item.runId ? `Run: ${item.runId}` : '等待分配单用例 run'} · {formatDuration(item.startedAt, item.endedAt)}</span>
                          {item.error && <small>{item.error}</small>}
                        </div>
                        <div className="monitor-case-action">
                          <em className={item.status}>{statusLabel(item.status)}</em>
                          {item.runId && (
                            <span className="monitor-case-report-hint" aria-hidden="true">
                              <FileText size={14} />
                              查看报告
                              <ExternalLink size={13} />
                            </span>
                          )}
                        </div>
                      </>;
                      return item.runId ? (
                        <a
                          className={`monitor-case-row report-ready ${isSelected ? 'selected' : ''}`}
                          href={playwrightReportUrl({ runId: item.runId })}
                          target="_blank"
                          rel="noreferrer"
                          key={item.id}
                          onClick={() => selectCaseRun(item.runId)}
                          aria-label={`查看单用例报告 ${caseLabel}`}
                          aria-current={isSelected ? 'true' : undefined}
                          data-testid={`execution-monitor-case-report-${item.runId}`}
                        >
                          {rowContent}
                        </a>
                      ) : (
                        <div
                          className="monitor-case-row unavailable"
                          key={item.id}
                          aria-disabled="true"
                          aria-label={`${caseLabel}，等待分配单用例 Run`}
                        >
                          {rowContent}
                        </div>
                      );
                    }) : <p className="muted">等待用例执行明细。</p>}
                  </div>
                </div>

                <div className="monitor-log-panel">
                  <div className="panel-heading compact">
                    <h3>聚合日志</h3>
                    <div className="monitor-log-filters" aria-label="日志级别筛选">
                      {logLevels.map((level) => (
                        <button type="button" className={logLevel === level ? 'active' : ''} onClick={() => setLogLevel(level)} key={level}>
                          {level === 'all' ? '全部' : level}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="log-box monitor-log-box" data-testid="execution-monitor-log-panel">
                    {filteredLogs.length ? filteredLogs.map((log) => (
                      <p key={log.id} className={`log ${log.level}`}>
                        <span>{formatLogTime(log.createdAt)} #{log.id} · {log.level}</span>
                        {log.message}
                      </p>
                    )) : <p className="log muted">暂无匹配日志。</p>}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-suite-state monitor-empty-detail">
              <Activity size={26} />
              <strong>选择一次执行查看详情</strong>
              <span>执行状态、用例结果和日志会按轮询自动刷新。</span>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function fallbackReportRecord(kind, row) {
  const isCaseReport = kind === 'case';
  const caseItem = row.case || {};
  const run = row.latestRun || {};
  const report = row.report || {};
  return {
    id: isCaseReport ? (row.reportId || '') : (report.id || ''),
    reportType: isCaseReport ? 'case-execution' : 'work-item-summary',
    project: row.project || {},
    workItem: row.workItem || {},
    case: caseItem,
    runId: isCaseReport ? (run.id || '') : (report.runId || ''),
    status: isCaseReport ? (run.status || '') : (report.status || ''),
    version: report.version || 1,
    name: isCaseReport ? `${caseItem.externalId || caseItem.id || '用例'} 执行报告` : (report.name || '工单总结报告'),
    summary: report.summary || '',
    startedAt: run.startedAt || null,
    endedAt: run.endedAt || null,
    updatedAt: report.updatedAt || run.endedAt || run.startedAt || null,
    content: '',
    sourceCaseDeleted: Boolean(row.sourceCaseDeleted),
    currentCaseChanged: Boolean(row.currentCaseChanged),
    artifacts: [],
  };
}

function ReportDetailModal({ kind, row, fetchJson, onClose }) {
  const modalCardRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [executionLogs, setExecutionLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [logsReloadKey, setLogsReloadKey] = useState(0);
  const [historyItems, setHistoryItems] = useState(() => [fallbackReportRecord(kind, row)]);
  const [selectedReportId, setSelectedReportId] = useState(() => fallbackReportRecord(kind, row).id);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modalCardRef.current?.querySelectorAll(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  const isCaseReport = kind === 'case';
  const fallbackRecord = fallbackReportRecord(kind, row);
  const activeRecord = historyItems.find((item) => item.id === selectedReportId) || historyItems[0] || fallbackRecord;
  const caseItem = activeRecord.case || {};
  const report = row.report || {};
  const logRunId = activeRecord.runId || '';
  const title = isCaseReport ? (caseItem.externalId || caseItem.id || '用例详情') : (activeRecord.name || report.name || '人工报告详情');
  const subtitle = isCaseReport ? (caseItem.title || '未命名用例') : (activeRecord.workItem?.title || '未关联工单');
  const details = isCaseReport
    ? [
        ['用例 ID', caseItem.externalId || caseItem.id || '-'],
        ['用例名称', caseItem.title || '-'],
        ['项目', activeRecord.project?.name || '-'],
        ['工单', activeRecord.workItem?.title || '-'],
        ['执行状态', statusLabel(activeRecord.status)],
        ['Run ID', activeRecord.runId || '-'],
        ['开始时间', formatDateTime(activeRecord.startedAt)],
        ['结束时间', formatDateTime(activeRecord.endedAt)],
        ['耗时', formatDuration(activeRecord.startedAt, activeRecord.endedAt)],
        ['快照状态', activeRecord.sourceCaseDeleted ? '源用例已删除' : activeRecord.currentCaseChanged ? '当前用例已变更' : '与当前用例一致'],
      ]
    : [
        ['报告名称', activeRecord.name || report.name || '-'],
        ['项目', activeRecord.project?.name || '-'],
        ['工单', activeRecord.workItem?.title || '-'],
        ['状态', statusLabel(activeRecord.status)],
        ['版本', `v${activeRecord.version || 1}`],
        ['更新时间', formatDateTime(activeRecord.updatedAt)],
      ];

  useEffect(() => {
    const targetId = isCaseReport ? (row.case?.id || '') : (row.report?.workItemId || row.workItem?.id || '');
    if (!targetId) return undefined;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError('');
    const endpoint = isCaseReport
      ? `/api/case-reports/${encodeURIComponent(targetId)}/history`
      : `/api/manual-reports/${encodeURIComponent(targetId)}/history`;
    fetchJson(endpoint)
      .then((payload) => {
        if (cancelled || !(payload?.items || []).length) return;
        setHistoryItems(payload.items);
        setSelectedReportId((current) => payload.items.some((item) => item.id === current) ? current : payload.items[0].id);
      })
      .catch((err) => {
        if (!cancelled) setHistoryError(err.message || '历史记录加载失败');
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchJson, isCaseReport, row.case?.id, row.report?.workItemId, row.workItem?.id]);

  useEffect(() => {
    if (!logRunId) {
      setExecutionLogs([]);
      setLogsLoading(false);
      setLogsError('');
      return undefined;
    }
    let cancelled = false;
    setLogsLoading(true);
    setLogsError('');
    fetchJson(`/api/runs/${encodeURIComponent(logRunId)}/logs`)
      .then((payload) => {
        if (!cancelled) setExecutionLogs(payload?.items || payload || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setExecutionLogs([]);
          setLogsError(err.message || '执行日志加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchJson, logRunId, logsReloadKey]);

  return createPortal(
    <div
      className="artifact-preview-modal delivery-detail-modal"
      role="presentation"
      data-testid="report-detail-modal-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={modalCardRef}
        className="artifact-preview-modal-card report-detail-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-detail-modal-title"
      >
        <header className="artifact-renderer-header modal report-detail-modal-header">
          <div>
            <h3 id="report-detail-modal-title">{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="artifact-modal-close" title="关闭详情" aria-label="关闭详情" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="report-detail-modal-body">
          <section className="report-history-toolbar" aria-label="报告历史">
            <label>
              <span>{isCaseReport ? '执行历史' : '版本历史'}</span>
              <select value={selectedReportId} onChange={(event) => setSelectedReportId(event.target.value)} disabled={historyLoading || historyItems.length <= 1}>
                {historyItems.map((item) => (
                  <option key={item.id || `${item.runId}-${item.version}`} value={item.id}>
                    {isCaseReport
                      ? `${formatDateTime(item.endedAt || item.startedAt)} · ${statusLabel(item.status)}${item.runId ? ` · ${item.runId}` : ''}`
                      : `v${item.version || 1} · ${formatDateTime(item.updatedAt)} · ${statusLabel(item.status)}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="report-history-actions">
              <span>{historyError ? `历史加载失败：${historyError}` : `共 ${historyItems.length} 条`}</span>
              {activeRecord.id ? (
                <a className="report-action-link" href={reportRecordUrl(activeRecord)} target="_blank" rel="noreferrer">
                  <FileText size={14} />
                  打开报告
                </a>
              ) : null}
            </div>
          </section>
          <dl className="report-detail-grid">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {!isCaseReport && (
            <section className="report-detail-summary" aria-label="报告摘要">
              <h4>摘要</h4>
              <p>{activeRecord.summary || '暂无摘要'}</p>
            </section>
          )}
          {activeRecord.failureReason ? (
            <section className="report-detail-summary" aria-label="失败原因">
              <h4>失败原因</h4>
              <p>{activeRecord.failureReason}</p>
            </section>
          ) : null}
          <section className="report-execution-logs" aria-label="执行日志" data-testid="report-execution-logs">
            <div className="report-detail-section-heading">
              <h4><ScrollText size={15} />执行日志</h4>
              {logRunId && !logsLoading && !logsError ? <span>{executionLogs.length} 条</span> : null}
            </div>
            {logsLoading ? (
              <p className="report-log-state">正在加载执行日志...</p>
            ) : logsError ? (
              <div className="report-log-error">
                <p>执行日志加载失败：{logsError}</p>
                <button type="button" className="ghost-button" onClick={() => setLogsReloadKey((value) => value + 1)}>
                  <RefreshCw size={14} />
                  重试
                </button>
              </div>
            ) : executionLogs.length ? (
              <div className="report-log-list">
                {executionLogs.map((log, index) => (
                  <p className={`log ${log.level || 'info'}`} key={log.id || `${log.createdAt || 'log'}-${index}`}>
                    <span>{formatDateTime(log.createdAt)} #{log.id || index + 1} · {(log.level || 'info').toUpperCase()}</span>
                    {log.message || '-'}
                  </p>
                ))}
              </div>
            ) : (
              <p className="report-log-state">{logRunId ? '该 Run 暂无执行日志。' : '未关联执行 Run，暂无执行日志。'}</p>
            )}
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function Delivery({
  projects,
  workItems,
  reportTab,
  setReportTab,
  reportScopeFilters,
  setReportScopeFilters,
  caseReports,
  caseReportFilters,
  setCaseReportFilters,
  loadCaseReports,
  manualReports,
  manualReportFilters,
  setManualReportFilters,
  loadManualReports,
  fetchJson,
  setNotice,
  setError,
  canManageAssets = true,
}) {
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [selectedCaseReports, setSelectedCaseReports] = useState(() => new Set());
  const [selectedManualReports, setSelectedManualReports] = useState(() => new Set());
  const [deletingReportKind, setDeletingReportKind] = useState('');
  const selectAllReportsRef = useRef(null);
  const isCaseTab = reportTab === 'case';
  const activePayload = isCaseTab ? caseReports : manualReports;
  const activeFilters = isCaseTab ? caseReportFilters : manualReportFilters;
  const activeSelection = isCaseTab ? selectedCaseReports : selectedManualReports;
  const totalPages = Math.max(1, Math.ceil((activePayload.total || 0) / (activePayload.pageSize || 50)));
  const hasFilters = [...Object.values(reportScopeFilters), ...Object.values(activeFilters)]
    .some((value) => value && value !== 'all');
  const scopedWorkItems = reportScopeFilters.project_id
    ? workItems.filter((workItem) => workItem.projectId === reportScopeFilters.project_id)
    : [];
  const caseReportKey = (caseId, runId) => JSON.stringify([caseId, runId]);
  const caseReportCanDelete = (row) => Boolean(
    row?.case?.id
    && row?.latestRun?.id
    && !isActiveRunStatus(row.latestRun.status)
  );
  const currentSelectableKeys = isCaseTab
    ? (caseReports.items || [])
      .filter(caseReportCanDelete)
      .map((row) => caseReportKey(row.case.id, row.latestRun.id))
    : (manualReports.items || []).map((row) => row.report?.id).filter(Boolean);
  const selectedCurrentPageCount = currentSelectableKeys.filter((key) => activeSelection.has(key)).length;
  const isCurrentPageSelected = currentSelectableKeys.length > 0 && selectedCurrentPageCount === currentSelectableKeys.length;
  const isCurrentPagePartiallySelected = selectedCurrentPageCount > 0 && !isCurrentPageSelected;

  useEffect(() => {
    if (selectAllReportsRef.current) selectAllReportsRef.current.indeterminate = isCurrentPagePartiallySelected;
  }, [isCurrentPagePartiallySelected, reportTab, activePayload.page]);

  const closeDetail = () => setSelectedDetail(null);

  const applyFilters = async (page = 1, event) => {
    event?.preventDefault();
    closeDetail();
    const nextFilters = { ...reportScopeFilters, ...activeFilters };
    if (isCaseTab) await loadCaseReports(nextFilters, page);
    else await loadManualReports(nextFilters, page);
  };

  const resetFilters = async () => {
    closeDetail();
    const nextScope = emptyReportScopeFilters();
    setReportScopeFilters(nextScope);
    if (isCaseTab) {
      const nextFilters = emptyCaseReportFilters();
      setCaseReportFilters(nextFilters);
      await loadCaseReports({ ...nextScope, ...nextFilters }, 1);
    } else {
      const nextFilters = emptyManualReportFilters();
      setManualReportFilters(nextFilters);
      await loadManualReports({ ...nextScope, ...nextFilters }, 1);
    }
  };

  const updateReportProject = (projectId) => {
    setReportScopeFilters({ project_id: projectId, work_item_id: '' });
  };

  const updateReportWorkItem = (workItemId) => {
    setReportScopeFilters((current) => ({ ...current, work_item_id: workItemId }));
  };

  const switchReportTab = async (nextTab) => {
    closeDetail();
    setReportTab(nextTab);
    if (nextTab === 'case') await loadCaseReports({ ...reportScopeFilters, ...caseReportFilters }, 1);
    else await loadManualReports({ ...reportScopeFilters, ...manualReportFilters }, 1);
  };

  const toggleReportSelection = (key, selected) => {
    const updateSelection = isCaseTab ? setSelectedCaseReports : setSelectedManualReports;
    updateSelection((previous) => {
      const next = new Set(previous);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const setCurrentPageSelected = (selected) => {
    const updateSelection = isCaseTab ? setSelectedCaseReports : setSelectedManualReports;
    updateSelection((previous) => {
      const next = new Set(previous);
      currentSelectableKeys.forEach((key) => {
        if (selected) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };

  const refreshAfterDelete = async (kind, page) => {
    const filters = kind === 'case'
      ? { ...reportScopeFilters, ...caseReportFilters }
      : { ...reportScopeFilters, ...manualReportFilters };
    const payload = kind === 'case'
      ? await loadCaseReports(filters, page)
      : await loadManualReports(filters, page);
    if (!(payload.items || []).length && page > 1 && (payload.total || 0) > 0) {
      if (kind === 'case') await loadCaseReports(filters, page - 1);
      else await loadManualReports(filters, page - 1);
    }
  };

  const deleteReportItems = async (kind, items, label) => {
    if (!canManageAssets || !items.length || deletingReportKind) return;
    const reportLabel = kind === 'case' ? '用例执行报告' : '工单总结报告';
    const confirmed = window.confirm(label || `确认删除已选 ${items.length} 条${reportLabel}？报告文件会同步删除，但测试用例、工单和执行记录会保留。`);
    if (!confirmed) return;
    setDeletingReportKind(kind);
    try {
      await fetchJson(kind === 'case' ? '/api/case-reports/bulk-delete' : '/api/manual-reports/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'case' ? { items } : { report_ids: items }),
      });
      if (kind === 'case') {
        const deletedKeys = new Set(items.map((item) => caseReportKey(item.case_id, item.run_id)));
        setSelectedCaseReports((previous) => new Set([...previous].filter((key) => !deletedKeys.has(key))));
      } else {
        const deletedIds = new Set(items);
        setSelectedManualReports((previous) => new Set([...previous].filter((id) => !deletedIds.has(id))));
      }
      closeDetail();
      await refreshAfterDelete(kind, kind === 'case' ? (caseReports.page || 1) : (manualReports.page || 1));
      setNotice(`已删除 ${items.length} 条${reportLabel}`);
      setError('');
    } catch (err) {
      setError(`删除${reportLabel}失败：${err.message}`);
    } finally {
      setDeletingReportKind('');
    }
  };

  const deleteSelectedReports = () => {
    if (isCaseTab) {
      const items = [...selectedCaseReports].map((key) => {
        const [case_id, run_id] = JSON.parse(key);
        return { case_id, run_id };
      });
      deleteReportItems('case', items);
      return;
    }
    deleteReportItems('manual', [...selectedManualReports]);
  };

  const renderFilters = () => (
    <form className="report-filter-bar" onSubmit={(event) => applyFilters(1, event)} data-testid={`${reportTab}-report-filters`}>
      <label className="field">
        <span>项目</span>
        <select aria-label="项目" value={reportScopeFilters.project_id} onChange={(event) => updateReportProject(event.target.value)}>
          <option value="">全部项目</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>工单</span>
        <select
          aria-label="工单"
          value={reportScopeFilters.work_item_id}
          disabled={!reportScopeFilters.project_id}
          onChange={(event) => updateReportWorkItem(event.target.value)}
        >
          <option value="">{reportScopeFilters.project_id ? '全部工单' : '请先选择项目'}</option>
          {scopedWorkItems.map((workItem) => <option key={workItem.id} value={workItem.id}>{workItem.title}</option>)}
        </select>
      </label>
      <label className="field report-keyword-field">
        <span>关键词</span>
        <input
          value={activeFilters.q}
          onChange={(event) => (isCaseTab ? setCaseReportFilters : setManualReportFilters)((current) => ({ ...current, q: event.target.value }))}
          placeholder={isCaseTab ? '搜索用例、项目或工单' : '搜索报告、项目或工单'}
        />
      </label>
      <label className="field">
        <span>状态</span>
        <select
          value={activeFilters.status}
          onChange={(event) => (isCaseTab ? setCaseReportFilters : setManualReportFilters)((current) => ({ ...current, status: event.target.value }))}
        >
          <option value="all">全部状态</option>
          {isCaseTab && <option value="no_report">暂无报告</option>}
          {isCaseTab && <option value="queued">排队中</option>}
          {isCaseTab && <option value="running">运行中</option>}
          <option value="passed">已通过</option>
          <option value="failed">失败</option>
          {isCaseTab && <option value="skipped">跳过</option>}
          {!isCaseTab && <option value="ready">已生成</option>}
          {!isCaseTab && <option value="draft">草稿</option>}
          {!isCaseTab && <option value="archived">已归档</option>}
        </select>
      </label>
      <button type="submit" className="primary-action">
        <Search size={16} />
        查询
      </button>
      <button type="button" className="ghost-button" disabled={!hasFilters} onClick={resetFilters}>
        <RefreshCw size={16} />
        重置
      </button>
      <button
        type="button"
        className="ghost-button danger-button report-bulk-delete"
        disabled={!canManageAssets || !activeSelection.size || Boolean(deletingReportKind)}
        title={canManageAssets ? '删除已选报告及报告文件' : '当前账号无权删除报告'}
        onClick={deleteSelectedReports}
      >
        <Trash2 size={16} />
        {deletingReportKind === reportTab ? '删除中...' : `删除已选 ${activeSelection.size} 条`}
      </button>
    </form>
  );

  const renderCaseReports = () => (
    <div className="report-table" data-testid="case-report-table">
      <div className="report-table-head case-report-row">
        <label className="check-cell report-select-cell" title="选择本页全部可删除的用例执行报告">
          <input
            ref={isCaseTab ? selectAllReportsRef : undefined}
            type="checkbox"
            aria-label="选择本页全部用例执行报告"
            checked={isCurrentPageSelected}
            disabled={!canManageAssets || !currentSelectableKeys.length || Boolean(deletingReportKind)}
            onChange={(event) => setCurrentPageSelected(event.target.checked)}
          />
        </label>
        <span>用例</span><span>项目 / 工单</span><span>最近结果</span><span>执行时间</span><span>耗时</span><span>操作</span>
      </div>
      {(caseReports.items || []).length ? caseReports.items.map((row) => {
        const caseItem = row.case || {};
        const run = row.latestRun;
        const selectable = caseReportCanDelete(row);
        const selectionKey = selectable ? caseReportKey(caseItem.id, run.id) : '';
        const deleteDisabled = !canManageAssets || !selectable || Boolean(deletingReportKind);
        return (
          <article className="report-table-row case-report-row" key={caseItem.id} data-testid={`case-report-row-${caseItem.id}`}>
            <label className="check-cell report-select-cell" data-label="选择">
              <input
                type="checkbox"
                aria-label={`选择用例执行报告 ${caseItem.externalId || caseItem.id}`}
                checked={Boolean(selectionKey && selectedCaseReports.has(selectionKey))}
                disabled={deleteDisabled}
                onChange={(event) => toggleReportSelection(selectionKey, event.target.checked)}
              />
            </label>
            <div className="report-primary-cell" data-label="用例">
              <strong>{caseItem.externalId || caseItem.id}</strong>
              <span>{caseItem.title || '未命名用例'}</span>
              <span className="report-record-flags">
                {row.historyCount > 1 ? <em><History size={12} />{row.historyCount} 次执行</em> : null}
                {row.sourceCaseDeleted ? <em className="danger"><Trash2 size={12} />源用例已删除</em> : null}
                {!row.sourceCaseDeleted && row.currentCaseChanged ? <em className="warning"><AlertTriangle size={12} />当前用例已变更</em> : null}
              </span>
            </div>
            <div className="report-secondary-cell" data-label="项目 / 工单">
              <strong>{row.project?.name || '未归属项目'}</strong>
              <span>{row.workItem?.title || '未关联工单'}</span>
            </div>
            <div data-label="最近结果">
              <span className={`report-status ${run?.status || 'no-report'}`}>{run ? statusLabel(run.status) : '暂无报告'}</span>
            </div>
            <span data-label="执行时间">{formatDateTime(run?.endedAt || run?.startedAt)}</span>
            <span data-label="耗时">{run ? formatDuration(run.startedAt, run.endedAt) : '-'}</span>
            <div className="report-operation-cell" data-label="操作">
              <button type="button" className="ghost-button" onClick={() => setSelectedDetail({ kind: 'case', row })}>
                <Eye size={15} />
                详情
              </button>
              {row.reportAvailable && row.reportId ? (
                <a className="report-action-link" href={reportRecordUrl({ id: row.reportId })} target="_blank" rel="noreferrer">
                  <FileText size={15} />
                  报告
                </a>
              ) : (
                <button type="button" className="report-action-link" disabled title="暂无可查看的单用例报告">
                  <FileText size={15} />
                  报告
                </button>
              )}
              <button
                type="button"
                className="ghost-button danger-button report-delete-button"
                disabled={deleteDisabled}
                aria-label={`删除用例执行报告 ${caseItem.externalId || caseItem.id}`}
                title={!canManageAssets ? '当前账号无权删除报告' : !selectable ? '暂无可删除报告，或报告仍在运行' : '删除报告及报告文件'}
                onClick={() => deleteReportItems(
                  'case',
                  [{ case_id: caseItem.id, run_id: run.id }],
                  `确认删除用例「${caseItem.externalId || caseItem.title || caseItem.id}」的执行报告？报告文件会同步删除，但执行记录、日志和截图会保留。`,
                )}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        );
      }) : <div className="report-empty-state">没有匹配的单用例报告。</div>}
    </div>
  );

  const renderManualReports = () => (
    <div className="report-table" data-testid="manual-report-table">
      <div className="report-table-head manual-report-row">
        <label className="check-cell report-select-cell" title="选择本页全部工单总结报告">
          <input
            ref={!isCaseTab ? selectAllReportsRef : undefined}
            type="checkbox"
            aria-label="选择本页全部工单总结报告"
            checked={isCurrentPageSelected}
            disabled={!canManageAssets || !currentSelectableKeys.length || Boolean(deletingReportKind)}
            onChange={(event) => setCurrentPageSelected(event.target.checked)}
          />
        </label>
        <span>报告名称</span><span>项目</span><span>工单</span><span>状态 / 版本</span><span>更新时间</span><span>操作</span>
      </div>
      {(manualReports.items || []).length ? manualReports.items.map((row) => {
        const report = row.report || {};
        const deleteDisabled = !canManageAssets || !report.id || Boolean(deletingReportKind);
        return (
          <article className="report-table-row manual-report-row" key={report.id} data-testid={`manual-report-row-${report.id}`}>
            <label className="check-cell report-select-cell" data-label="选择">
              <input
                type="checkbox"
                aria-label={`选择工单总结报告 ${report.name || report.id}`}
                checked={Boolean(report.id && selectedManualReports.has(report.id))}
                disabled={deleteDisabled}
                onChange={(event) => toggleReportSelection(report.id, event.target.checked)}
              />
            </label>
            <div className="report-primary-cell" data-label="报告名称">
              <strong>{report.name || '未命名报告'}</strong>
              <span>{report.summary || '暂无摘要'}</span>
              {row.historyCount > 1 ? <span className="report-record-flags"><em><History size={12} />{row.historyCount} 个版本</em></span> : null}
            </div>
            <span data-label="项目">{row.project?.name || '未归属项目'}</span>
            <span data-label="工单">{row.workItem?.title || '未关联工单'}</span>
            <div className="report-secondary-cell" data-label="状态 / 版本">
              <span className={`report-status ${report.status || 'ready'}`}>{statusLabel(report.status)}</span>
              <span>v{report.version || 1}</span>
            </div>
            <span data-label="更新时间">{formatDateTime(report.updatedAt)}</span>
            <div className="report-operation-cell" data-label="操作">
              <button type="button" className="ghost-button" onClick={() => setSelectedDetail({ kind: 'manual', row })}>
                <Eye size={15} />
                详情
              </button>
              <a className="report-action-link" href={reportRecordUrl(report)} target="_blank" rel="noreferrer">
                <FileText size={15} />
                报告
              </a>
              <button
                type="button"
                className="ghost-button danger-button report-delete-button"
                disabled={deleteDisabled}
                aria-label={`删除工单总结报告 ${report.name || report.id}`}
                title={canManageAssets ? '删除报告及报告文件' : '当前账号无权删除报告'}
                onClick={() => deleteReportItems(
                  'manual',
                  [report.id],
                  `确认删除工单总结报告「${report.name || report.id}」？报告文件会同步删除，但工单和执行记录会保留。`,
                )}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        );
      }) : <div className="report-empty-state">没有匹配的人工报告。</div>}
    </div>
  );

  return (
    <section className="module-section delivery-report-page" aria-label="测试报告">
      <div className="section-header">
        <div>
          <h2>测试报告</h2>
          <p>{isCaseTab ? '按项目和工单查看测试用例最近一次独立执行结果。' : '按项目和工单查看最新生成的工单总结报告。'}</p>
        </div>
      </div>

      <div className="report-view-tabs" role="tablist" aria-label="报告类型">
        <button type="button" role="tab" id="case-report-tab" aria-controls="case-report-panel" aria-selected={isCaseTab} className={isCaseTab ? 'active' : ''} onClick={() => switchReportTab('case')}>
          用例执行报告
        </button>
        <button type="button" role="tab" id="manual-report-tab" aria-controls="manual-report-panel" aria-selected={!isCaseTab} className={!isCaseTab ? 'active' : ''} onClick={() => switchReportTab('manual')}>
          工单总结报告
        </button>
      </div>

      {renderFilters()}

      <div className="report-list-summary">
        <div className="report-list-meta">
          <span>共 {activePayload.total || 0} 条记录</span>
          <span>第 {activePayload.page || 1} / {totalPages} 页</span>
        </div>
      </div>

      <div id={isCaseTab ? 'case-report-panel' : 'manual-report-panel'} role="tabpanel" aria-labelledby={isCaseTab ? 'case-report-tab' : 'manual-report-tab'}>
        {isCaseTab ? renderCaseReports() : renderManualReports()}
      </div>

      {selectedDetail && (
        <ReportDetailModal kind={selectedDetail.kind} row={selectedDetail.row} fetchJson={fetchJson} onClose={closeDetail} />
      )}

      <div className="delivery-pagination report-pagination">
        <button type="button" className="ghost-button" disabled={(activePayload.page || 1) <= 1} onClick={() => applyFilters((activePayload.page || 1) - 1)}>
          上一页
        </button>
        <span>第 {activePayload.page || 1} 页 / 共 {totalPages} 页</span>
        <button type="button" className="ghost-button" disabled={(activePayload.page || 1) >= totalPages} onClick={() => applyFilters((activePayload.page || 1) + 1)}>
          下一页
        </button>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, textarea = false }) {
  return (
    <label className={textarea ? 'field wide' : 'field'}>
      <span>{label}</span>
      {textarea ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

export default App;
