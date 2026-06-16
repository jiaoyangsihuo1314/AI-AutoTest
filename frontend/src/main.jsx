import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
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
  SquareTerminal,
  Table2,
  Wand2,
  XCircle,
  ChevronDown,
  AlertTriangle,
  CalendarClock,
  Clock,
  Edit3,
  FileCode2,
  FolderTree,
  ListChecks,
  Maximize2,
  Search,
  Trash2,
  UserCog,
  X,
} from 'lucide-react';
import './styles.css';

function defaultApiBase() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8001';
  return `${window.location.protocol}//${window.location.hostname}:8001`;
}

const API_BASE = import.meta.env.VITE_API_BASE || defaultApiBase();
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const THEME_STORAGE_KEY = 'qa-platform-theme';
const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_AI_MODEL = 'gpt-4.1-mini';
const AI_PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'gpt', label: 'GPT 网关' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'custom', label: '自定义' },
];
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

function deliveryTypeLabel(type) {
  return {
    'test-cases': '用例文档',
    spec: '自动化脚本',
    'manual-report': '人工报告',
    'html-report': 'HTML report',
    'execution-preview': '执行证据',
  }[type] || type;
}

const MODULES = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'automation-flow', label: '自动化测试全流程', icon: SquareTerminal },
  { id: 'test-suites', label: '测试套件', icon: ListChecks },
  { id: 'execution-monitor', label: '执行监控', icon: RadioTower },
  { id: 'requirements', label: '需求工单', icon: ClipboardList },
  { id: 'cases', label: '用例设计', icon: FileCheck2 },
  { id: 'exploration', label: '探索实验室', icon: FlaskConical },
  { id: 'scripts', label: '脚本工作台', icon: Code2 },
  { id: 'execution', label: '执行测试', icon: MonitorPlay },
  { id: 'healing', label: '自愈诊断', icon: Wand2 },
  { id: 'delivery', label: '交付报告', icon: FileText },
  { id: 'projects', label: '项目管理', icon: Database },
  { id: 'case-management', label: '用例管理', icon: Table2 },
  { id: 'feature-menus', label: '功能菜单配置', navLabel: '功能模块配置', icon: FolderTree },
  { id: 'ai-config', label: 'AI 配置', icon: Settings },
  { id: 'user-management', label: '用户管理', icon: UserCog },
];

const HOME_MODULE_ID = 'overview';
const MODULE_LOOKUP = Object.fromEntries(MODULES.map((module) => [module.id, module]));
const NAV_GROUPS = [
  { id: 'workspace', title: '工作台', icon: LayoutDashboard, moduleIds: ['overview', 'automation-flow', 'test-suites', 'execution-monitor'] },
  { id: 'workflow', title: '测试任务流', icon: ClipboardList, moduleIds: ['requirements', 'cases', 'exploration', 'scripts', 'execution', 'healing'] },
  { id: 'assets', title: '资产管理', icon: Database, moduleIds: ['projects', 'case-management', 'delivery'] },
  { id: 'settings', title: '系统设置', icon: Settings, moduleIds: ['feature-menus', 'ai-config', 'user-management'] },
];
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
    designed: '已设计',
    automated: '已自动化',
    manual: '人工',
    ready: '已生成',
    skipped: '跳过',
    queued: '排队中',
    running: '运行中',
    healing: '自愈中',
    passed: '已通过',
    failed: '失败',
    idle: '待命',
    blocked: '阻塞',
    completed: '已完成',
  }[status] || status;
}

function assetModeLabel(mode) {
  return {
    create: '新建',
    refresh: '刷新替换',
    append: '追加',
  }[mode] || mode || '新建';
}

function aiProviderLabel(provider) {
  return AI_PROVIDER_OPTIONS.find((item) => item.value === provider)?.label || '自定义';
}

function emptyAIConfig() {
  return {
    id: '',
    name: '',
    provider: 'openai',
    api_key: '',
    model: DEFAULT_AI_MODEL,
    base_url: DEFAULT_AI_BASE_URL,
  };
}

function aiProfileToForm(profile) {
  if (!profile) return emptyAIConfig();
  return {
    id: profile.id || '',
    name: profile.name || '',
    provider: profile.provider || 'openai',
    api_key: '',
    model: profile.model || DEFAULT_AI_MODEL,
    base_url: profile.baseUrl || DEFAULT_AI_BASE_URL,
  };
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy copy path for restricted browser contexts.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
  return copied;
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
  return {
    project_code: project.projectCode || '',
    name: project.name || '',
    project_type: project.projectType || 'product',
    status: project.status || 'active',
    target_url: project.targetUrl || '',
    repository_path: project.repositoryPath || '/Users/syj/Documents/qa-project',
    test_dir: project.testDir || 'tests/e2e',
    description: project.description || '',
  };
}

function emptyRequirement() {
  return {
    title: '',
    requirement: '',
    target_url: '',
    role: '',
    test_data: '',
    acceptance: '',
    exclusions: '',
  };
}

function emptyExploration() {
  return {
    notes: '等待根据测试用例执行页面探索并确认真实元素。',
    screenshot_path: 'artifacts/automation-platform/browser-preview.svg',
    page_structure: '页面结构将在探索完成后回填；最终 selector 必须人工确认。',
    elements: [],
  };
}

function emptyDeliveryFilters() {
  return {
    q: '',
    project_id: '',
    work_item_id: '',
    case_id: '',
    readiness: 'all',
    priority: 'all',
    automation_status: 'all',
    latest_status: 'all',
    deliverable_type: 'all',
    updated_from: '',
    updated_to: '',
  };
}

function defaultSuiteRunConfig() {
  return {
    mode: 'serial',
    failurePolicy: 'continue',
    retryCount: 0,
    runFailedOnly: false,
  };
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

function buildDeliveryReportPath(filters = emptyDeliveryFilters(), page = 1, pageSize = 50) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  Object.entries(filters).forEach(([key, value]) => {
    if (!value || value === 'all') return;
    params.set(key, value);
  });
  return `/api/delivery-report?${params.toString()}`;
}

function playwrightReportUrl() {
  return `${API_BASE}/reports/playwright/`;
}

function deliverableReportUrl(deliverable) {
  if (!deliverable?.id) return '';
  return `${API_BASE}/reports/deliverables/${encodeURIComponent(deliverable.id)}`;
}

function artifactReportUrl(artifact) {
  if (!artifact) return '';
  if (artifact.artifactType === 'html-report') return playwrightReportUrl();
  if (artifact.path && ['manual-report', 'final-report'].includes(artifact.artifactType)) {
    const params = new URLSearchParams({ path: artifact.path });
    return `${API_BASE}/reports/file?${params.toString()}`;
  }
  if (artifact.path && artifact.artifactType === 'html-report') return playwrightReportUrl();
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
  const [activeModule, setActiveModule] = useState(HOME_MODULE_ID);
  const [openModuleTabs, setOpenModuleTabs] = useState([HOME_MODULE_ID]);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [themeId, setThemeId] = useState(readStoredTheme);
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ username: '', display_name: '', password: '' });
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [users, setUsers] = useState([]);
  const [userActionMessage, setUserActionMessage] = useState('');
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '' });
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
  const [health, setHealth] = useState({ status: 'checking', ai: { configured: false } });
  const [workItems, setWorkItems] = useState([]);
  const [currentItem, setCurrentItem] = useState(null);
  const currentItemRef = useRef(null);
  const selectedWorkItemIdRef = useRef('');
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState('');
  const [dashboardScopeProjectId, setDashboardScopeProjectId] = useState('all');
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [testCases, setTestCases] = useState([]);
  const [features, setFeatures] = useState([]);
  const [featureTree, setFeatureTree] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [deliveryReport, setDeliveryReport] = useState({ items: [], total: 0, page: 1, pageSize: 50 });
  const [deliveryFilters, setDeliveryFilters] = useState(emptyDeliveryFilters);
  const [suites, setSuites] = useState([]);
  const [suiteCaseProjects, setSuiteCaseProjects] = useState([]);
  const [suiteRuns, setSuiteRuns] = useState([]);
  const [latestSuiteRun, setLatestSuiteRun] = useState(null);
  const [monitorSuiteRunId, setMonitorSuiteRunId] = useState('');
  const [monitorSuiteRunDetail, setMonitorSuiteRunDetail] = useState(null);
  const [monitorLogs, setMonitorLogs] = useState([]);
  const [monitorLogLevel, setMonitorLogLevel] = useState('all');
  const [monitorSelectedCaseRunId, setMonitorSelectedCaseRunId] = useState('');
  const [monitorBrowserStatus, setMonitorBrowserStatus] = useState('Closed');
  const [monitorBrowserDetail, setMonitorBrowserDetail] = useState('');
  const [monitorBrowserLiveConnected, setMonitorBrowserLiveConnected] = useState(false);
  const [monitorBrowserHasFrame, setMonitorBrowserHasFrame] = useState(false);
  const [monitorBrowserRun, setMonitorBrowserRun] = useState(null);
  const monitorBrowserSocketRef = useRef(null);
  const monitorBrowserCanvasRef = useRef(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState(() => new Set());
  const [newSuiteName, setNewSuiteName] = useState('回归测试套件');
  const [scriptEditor, setScriptEditor] = useState({
    open: false,
    loading: false,
    saving: false,
    error: '',
    detail: null,
    content: '',
    sourceCase: null,
  });
  const [selectedSuiteId, setSelectedSuiteId] = useState('');
  const [suiteForm, setSuiteForm] = useState(() => normalizeSuiteForm());
  const [suiteEditing, setSuiteEditing] = useState(false);
  const [runs, setRuns] = useState([]);
  const [logs, setLogs] = useState([]);
  const [screenshot, setScreenshot] = useState('');
  const [explorationPreview, setExplorationPreview] = useState('');
  const [explorationRun, setExplorationRun] = useState(null);
  const [explorationLogs, setExplorationLogs] = useState([]);
  const [browserStatus, setBrowserStatus] = useState('Closed');
  const [browserStatusDetail, setBrowserStatusDetail] = useState('');
  const [liveConnected, setLiveConnected] = useState(false);
  const browserSocketRef = useRef(null);
  const browserCanvasRef = useRef(null);
  const [executionBrowserStatus, setExecutionBrowserStatus] = useState('Closed');
  const [executionBrowserDetail, setExecutionBrowserDetail] = useState('');
  const [executionLiveConnected, setExecutionLiveConnected] = useState(false);
  const executionBrowserSocketRef = useRef(null);
  const executionBrowserCanvasRef = useRef(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exploring, setExploring] = useState(false);
  const [confirmedElementKeys, setConfirmedElementKeys] = useState(() => new Set());
  const confirmedElementKeysRef = useRef(confirmedElementKeys);
  const [aiConfig, setAiConfig] = useState(() => emptyAIConfig());
  const [testingAIConfig, setTestingAIConfig] = useState(false);
  const [aiSecretVisible, setAiSecretVisible] = useState(false);
  const [analyzingRequirement, setAnalyzingRequirement] = useState(false);
  const [requirementForm, setRequirementForm] = useState(emptyRequirement());
  const [requirementFeatureId, setRequirementFeatureId] = useState('');
  const [requirementFeatureOptions, setRequirementFeatureOptions] = useState([]);
  const [requirementFeatureTree, setRequirementFeatureTree] = useState([]);
  const [exploration, setExploration] = useState(emptyExploration);
  const [casesMarkdown, setCasesMarkdown] = useState('');
  const [scriptContent, setScriptContent] = useState('');
  const [assetMode, setAssetMode] = useState('create');
  const [healingForm, setHealingForm] = useState({
    failure_summary: '等待执行失败后填写失败摘要。',
    proposed_fix: '记录选择器、等待策略或断言调整方案。',
  });
  const [automationRequirement, setAutomationRequirement] = useState('');
  const [automationProjectId, setAutomationProjectId] = useState('');
  const [automationFeatureId, setAutomationFeatureId] = useState('');
  const [automationFeatureOptions, setAutomationFeatureOptions] = useState([]);
  const [automationFeatureTree, setAutomationFeatureTree] = useState([]);
  const [automationFlow, setAutomationFlow] = useState(null);
  const [automationFlowId, setAutomationFlowId] = useState('');
  const [automationFlowHistory, setAutomationFlowHistory] = useState([]);
  const [automationHistoryLoading, setAutomationHistoryLoading] = useState(false);
  const [automationHistoryError, setAutomationHistoryError] = useState('');
  const [automationHistoryRestoringId, setAutomationHistoryRestoringId] = useState('');
  const [automationLogs, setAutomationLogs] = useState([]);
  const [automationArtifacts, setAutomationArtifacts] = useState([]);
  const [automationStatus, setAutomationStatus] = useState('idle');
  const [automationActiveStage, setAutomationActiveStage] = useState('');
  const [automationLiveConnected, setAutomationLiveConnected] = useState(false);
  const [automationBrowserStatus, setAutomationBrowserStatus] = useState('Closed');
  const [automationBrowserDetail, setAutomationBrowserDetail] = useState('');
  const [automationBrowserLiveConnected, setAutomationBrowserLiveConnected] = useState(false);
  const [automationBrowserSessionId, setAutomationBrowserSessionId] = useState('');
  const [automationBrowserMode, setAutomationBrowserMode] = useState('exploration');
  const [automationBrowserHasFrame, setAutomationBrowserHasFrame] = useState(false);
  const [automationResetKey, setAutomationResetKey] = useState(0);
  const automationFlowSocketRef = useRef(null);
  const automationBrowserSocketRef = useRef(null);
  const automationBrowserCanvasRef = useRef(null);
  const automationLogRef = useRef(null);
  const [expandedNavGroups, setExpandedNavGroups] = useState(() => new Set(NAV_GROUPS.map((group) => group.id)));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const tabMenuRef = useRef(null);
  const moduleTabsRef = useRef(null);
  const activeModuleTabRef = useRef(null);
  const activeModuleRef = useRef(HOME_MODULE_ID);
  const scrollPositionsRef = useRef({ [HOME_MODULE_ID]: 0 });
  const pendingScrollRestoreRef = useRef(null);

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

  function openModule(moduleId) {
    if (!MODULE_LOOKUP[moduleId]) return;
    if (!moduleAllowed(moduleId)) {
      setError('当前账号无权访问该模块');
      return;
    }
    if (activeModuleRef.current === moduleId) {
      setTabMenuOpen(false);
      return;
    }
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
    saveActiveModuleScrollPosition();
    const currentIndex = openModuleTabs.indexOf(moduleId);
    const nextTabs = openModuleTabs.filter((item) => item !== moduleId);
    const safeTabs = nextTabs.length ? nextTabs : [HOME_MODULE_ID];
    delete scrollPositionsRef.current[moduleId];
    setOpenModuleTabs(safeTabs);
    if (activeModule === moduleId) {
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
    keepScrollPositionsForTabs(nextTabs);
    setOpenModuleTabs(nextTabs);
    setTabMenuOpen(false);
  }

  function closeAllTabs() {
    saveActiveModuleScrollPosition();
    const homeScrollPosition = scrollPositionsRef.current[HOME_MODULE_ID] || 0;
    scrollPositionsRef.current = { [HOME_MODULE_ID]: homeScrollPosition };
    setOpenModuleTabs([HOME_MODULE_ID]);
    activeModuleRef.current = HOME_MODULE_ID;
    setActiveModule(HOME_MODULE_ID);
    setTabMenuOpen(false);
    restoreModuleScrollPosition(HOME_MODULE_ID);
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

  const toggleNavGroup = (groupId) => {
    setExpandedNavGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  useEffect(() => {
    if (!activeNavGroupId) return;
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
    if (!projects.find((project) => project.id === automationProjectId)) {
      setAutomationProjectId(projects[0].id);
      setAutomationFeatureId('');
    }
  }, [automationProjectId, projects]);

  useEffect(() => {
    if (!projects.length) {
      if (currentProjectId) {
        setCurrentProjectId('');
        setRequirementFeatureId('');
      }
      return;
    }
    if (!projects.find((project) => project.id === currentProjectId)) {
      setCurrentProjectId(projects[0].id);
      setRequirementFeatureId('');
      return;
    }
  }, [currentProjectId, projects]);

  useEffect(() => {
    if (!authUser) return undefined;
    if (!currentProjectId) {
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
        const payload = await fetchJson(`/api/features?project_id=${encodeURIComponent(currentProjectId)}`);
        if (cancelled) return;
        const activeItems = (payload.items || []).filter((feature) => feature.isActive);
        setRequirementFeatureOptions(activeItems);
        setRequirementFeatureTree(payload.tree || []);
        setRequirementFeatureId((value) => activeItems.some((feature) => feature.id === value) ? value : '');
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
  }, [authUser?.id, currentProjectId]);

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
    setAutomationFlow(payload);
    setAutomationLogs(payload.logs || []);
    setAutomationArtifacts(payload.flowArtifacts || []);
    setAutomationStatus(payload.status || 'idle');
    setAutomationActiveStage(payload.stage || '');
    const workItem = payload.workItem || null;
    const nextProjectId = payload.projectId || workItem?.projectId || '';
    const nextFeatureId = payload.featureId || workItem?.featureId || '';
    if (workItem?.requirement) setAutomationRequirement(workItem.requirement);
    if (nextProjectId) setAutomationProjectId(nextProjectId);
    if (nextFeatureId) setAutomationFeatureId(nextFeatureId);
    if (workItem) {
      selectedWorkItemIdRef.current = workItem.id;
      setCurrentItem(workItem);
      setCasesMarkdown(workItem.casesMarkdown || '');
      setScriptContent(workItem.scriptContent || '');
      setAssetMode(workItem.assetMode || 'create');
    }
    if (payload.latestRun) {
      setRuns((items) => {
        const exists = items.some((item) => item.id === payload.latestRun.id);
        return exists ? items.map((item) => (item.id === payload.latestRun.id ? payload.latestRun : item)) : [payload.latestRun, ...items];
      });
    }
  }

  function mergeAutomationArtifact(nextArtifact) {
    if (!nextArtifact?.id) return;
    setAutomationArtifacts((items) => {
      const exists = items.some((item) => item.id === nextArtifact.id);
      return exists ? items.map((item) => (item.id === nextArtifact.id ? nextArtifact : item)) : [...items, nextArtifact];
    });
  }

  useEffect(() => {
    if (!automationFlowId) return undefined;
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
        applyAutomationSnapshot({ ...(payload.flow || {}), logs: payload.logs || [], flowArtifacts: payload.flowArtifacts || [] });
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
        if (payload.status === 'completed') {
          setNotice('一键全流程已完成：最终测试用例、spec、人工报告和 Playwright HTML report 已保存。');
          await loadAll();
        } else if (payload.status === 'failed') {
          setError(`一键全流程失败：${payload.flow?.error || '详见流程日志和失败报告'}`);
        } else if (payload.status === 'blocked') {
          setError(payload.flow?.error || '一键全流程已阻塞，请查看阶段日志。');
        }
      }
    });
    return () => {
      if (automationFlowSocketRef.current === socket) automationFlowSocketRef.current = null;
      socket.close();
      setAutomationLiveConnected(false);
    };
  }, [automationFlowId]);

  useEffect(() => {
    if (!authUser || !automationFlowId) return undefined;
    let cancelled = false;

    async function pollAutomationFlow() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(`/api/automation-flows/${automationFlowId}`);
        if (cancelled) return;
        applyAutomationSnapshot(payload);
        if (payload.status === 'completed') {
          setNotice('一键全流程已完成：最终测试用例、spec、人工报告和 Playwright HTML report 已保存。');
          await loadAll();
        } else if (payload.status === 'failed') {
          setError(`一键全流程失败：${payload.error || '详见流程日志和失败报告'}`);
        } else if (payload.status === 'blocked') {
          setError(payload.error || '一键全流程已阻塞，请查看阶段日志。');
        } else {
          setError('');
        }
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) setError(`获取全流程状态失败：${err.message}`);
      }
    }

    pollAutomationFlow();
    const terminal = ['completed', 'failed', 'blocked', 'cancelled'].includes(automationFlow?.status);
    const timer = window.setInterval(pollAutomationFlow, automationLiveConnected && !terminal ? 8000 : terminal ? 5000 : 1600);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, automationFlowId, automationFlow?.status, automationLiveConnected]);

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
    if (!automationBrowserSessionId) return undefined;
    if (automationBrowserSocketRef.current) {
      automationBrowserSocketRef.current.close();
    }
    setAutomationBrowserHasFrame(false);
    const socket = new WebSocket(`${WS_BASE}/ws/browser-sessions/${automationBrowserSessionId}`);
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
      if (payload.type === 'status') {
        setAutomationBrowserStatus(payload.status);
        setAutomationBrowserDetail(payload.message || '');
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
  }, [automationBrowserSessionId]);

  useEffect(() => {
    confirmedElementKeysRef.current = confirmedElementKeys;
  }, [confirmedElementKeys]);

  useEffect(() => {
    currentItemRef.current = currentItem;
  }, [currentItem]);

  useEffect(() => {
    if (!health.ai) return;
    const activeProfile = health.ai.activeProfile;
    if (!activeProfile) {
      setAiConfig((value) => (value.id ? { ...emptyAIConfig(), api_key: value.api_key } : value));
      return;
    }
    setAiConfig((value) => (value.id === activeProfile.id ? value : aiProfileToForm(activeProfile)));
    setAiSecretVisible(false);
  }, [health.ai?.activeProfileId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (suiteEditing) return;
    const activeSuite = selectedSuiteId
      ? suites.find((suite) => suite.id === selectedSuiteId)
      : suites.find((suite) => !suite.legacy);
    if (activeSuite) {
      if (activeSuite.id !== selectedSuiteId) setSelectedSuiteId(activeSuite.id);
      setSuiteForm(normalizeSuiteForm(activeSuite));
      return;
    }
    setSelectedSuiteId('');
    setSuiteForm(normalizeSuiteForm());
  }, [suites, selectedSuiteId, suiteEditing]);

  function handleAuthExpired(message = '登录状态已失效，请重新登录。') {
    setAuthUser(null);
    setAuthMode('login');
    setAuthChecked(true);
    setAuthError(message);
  }

  async function fetchJson(path, options) {
    const response = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...(options || {}) });
    if (response.status === 401) {
      handleAuthExpired();
      throw new Error('请先登录');
    }
    if (!response.ok) {
      const text = await response.text();
      try {
        const payload = JSON.parse(text);
        throw new Error(payload.detail || text);
      } catch (err) {
        if (err instanceof SyntaxError) throw new Error(text);
        throw err;
      }
    }
    return response.json();
  }

  async function checkAuth() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
      const payload = await response.json();
      setAuthUser(payload.authenticated ? payload.user : null);
      setAuthChecked(true);
      return { user: payload.authenticated ? payload.user : null, reachable: true };
    } catch {
      setAuthUser(null);
      setAuthChecked(true);
      return { user: null, reachable: false };
    }
  }

  async function ensureAuthenticated() {
    const { user, reachable } = await checkAuth();
    if (!reachable) {
      throw new Error('Failed to fetch');
    }
    if (!user) {
      handleAuthExpired();
      throw new Error('请先登录');
    }
    return user;
  }

  async function submitLogin() {
    setAuthSubmitting(true);
    setAuthError('');
    setAuthMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || '登录失败');
      setAuthUser(payload.user);
      setAuthError('');
      setPasswordForm({ current_password: '', new_password: '' });
      await loadAll({ skipAuthCheck: true });
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function submitRegister() {
    setAuthSubmitting(true);
    setAuthError('');
    setAuthMessage('');
    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerForm),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || '注册失败');
      setRegisterForm({ username: '', display_name: '', password: '' });
      setAuthMode('login');
      setAuthMessage('注册已提交，请等待管理员审核启用。');
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function logout() {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => null);
    setAuthUser(null);
    setAuthMode('login');
    setNotice('');
    setError('');
  }

  async function changePassword() {
    try {
      await fetchJson('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm),
      });
      setPasswordForm({ current_password: '', new_password: '' });
      setPasswordPanelOpen(false);
      setNotice('密码已修改');
    } catch (err) {
      setError(`修改密码失败：${err.message}`);
    }
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

  async function loadDeliveryReport(nextFilters = deliveryFilters, page = 1, pageSize = deliveryReport.pageSize || 50) {
    const payload = await fetchJson(buildDeliveryReportPath(nextFilters, page, pageSize));
    setDeliveryReport(payload);
    return payload;
  }

  async function refreshCases(projectId = currentProjectId) {
    if (!projectId) {
      setTestCases([]);
      return [];
    }
    const payload = await fetchJson(`/api/test-cases?project_id=${encodeURIComponent(projectId)}`);
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
      fetchJson(`/api/test-cases?project_id=${encodeURIComponent(projectId)}`),
      fetchJson(`/api/features?project_id=${encodeURIComponent(projectId)}`),
      fetchJson(`/api/test-suites?project_id=${encodeURIComponent(projectId)}`),
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

  async function loadAll(options = {}) {
    try {
      if (!options.skipAuthCheck) {
        await ensureAuthenticated();
      }
      const projectId = currentProjectId;
      const [healthPayload, projectPayload, workPayload, deliverablePayload, runsPayload, dashboardPayload] = await Promise.all([
        fetchJson('/api/health'),
        fetchJson('/api/projects'),
        fetchJson('/api/work-items'),
        fetchJson('/api/deliverables?include_content=false'),
        fetchJson('/api/runs'),
        fetchJson(`/api/dashboard-summary?project_id=${encodeURIComponent(dashboardScopeProjectId || 'all')}`),
      ]);
      const nextProjectId = projectPayload.find((project) => project.id === projectId)?.id || projectPayload[0]?.id || '';
      const [casePayload, featurePayload, suitesPayload, suiteRunPayload] = nextProjectId
        ? await Promise.all([
          fetchJson(`/api/test-cases?project_id=${encodeURIComponent(nextProjectId)}`),
          fetchJson(`/api/features?project_id=${encodeURIComponent(nextProjectId)}`),
          fetchJson(`/api/test-suites?project_id=${encodeURIComponent(nextProjectId)}`),
          fetchJson(`/api/suite-runs?project_id=${encodeURIComponent(nextProjectId)}`),
        ])
        : [[], { items: [], tree: [] }, [], []];
      setHealth(healthPayload);
      setProjects(projectPayload);
      if (nextProjectId !== currentProjectId) {
        setCurrentProjectId(nextProjectId);
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
      if (!selectedWorkItemIdRef.current && !currentItemRef.current && workPayload[0]) {
        await selectWorkItem(workPayload[0].id);
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

  async function selectWorkItem(id) {
    selectedWorkItemIdRef.current = id;
    const item = await fetchJson(`/api/work-items/${id}`);
    setCurrentItem(item);
    setCasesMarkdown(item.casesMarkdown || '');
    setScriptContent(item.scriptContent || '');
    setAssetMode(item.assetMode || 'create');
    if (item.explorations?.[0]) {
      const nextElements = item.elements?.length ? item.elements : emptyExploration().elements;
      setConfirmedElementKeys(new Set(nextElements.filter((element) => element.confirmed).map(elementKey).filter(Boolean)));
      setExploration((value) => ({
        ...value,
        notes: item.explorations[0].notes || value.notes,
        screenshot_path: item.explorations[0].screenshotPath || value.screenshot_path,
        page_structure: item.explorations[0].pageStructure || value.page_structure,
        elements: nextElements,
      }));
    } else {
      setConfirmedElementKeys(new Set());
      setExploration(emptyExploration());
    }
  }

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!authUser) return undefined;
    loadAll();
    const timer = window.setInterval(loadAll, 5000);
    return () => window.clearInterval(timer);
  }, [authUser?.id, currentProjectId, dashboardScopeProjectId]);

  useEffect(() => {
    if (activeModule !== 'user-management' || !canManageUsers) return undefined;
    loadUsers().catch((err) => setError(`加载用户列表失败：${err.message}`));
    return undefined;
  }, [activeModule, canManageUsers]);

  useEffect(() => {
    if (!authUser || activeModule !== 'delivery') return undefined;
    let cancelled = false;
    async function refreshDelivery() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(buildDeliveryReportPath(deliveryFilters, deliveryReport.page || 1, deliveryReport.pageSize || 50));
        if (!cancelled) setDeliveryReport(payload);
      } catch (err) {
        if (!cancelled && !isAuthRequiredError(err)) setError(`加载交付报告失败：${err.message}`);
      }
    }
    refreshDelivery();
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, activeModule]);

  useEffect(() => {
    if (!authUser || !latestSuiteRun?.id) return undefined;
    let cancelled = false;
    async function pollSuiteRun() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(`/api/suite-runs/${latestSuiteRun.id}`);
        if (!cancelled) {
          setLatestSuiteRun(payload);
          setSuiteRuns((items) => items.map((item) => (item.id === payload.id ? payload : item)));
          if (payload.status !== 'running' && payload.status !== 'queued') {
            const projectId = currentProjectId;
            if (!projectId) return;
            const [casePayload, deliverablePayload] = await Promise.all([
              fetchJson(`/api/test-cases?project_id=${encodeURIComponent(projectId)}`),
              fetchJson(`/api/deliverables?project_id=${encodeURIComponent(projectId)}`),
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
    const timer = window.setInterval(pollSuiteRun, latestSuiteRun.status === 'running' || latestSuiteRun.status === 'queued' ? 1500 : 5000);
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
        const projectId = currentProjectId;
        if (!projectId) {
          setSuiteRuns([]);
          setLatestSuiteRun((current) => current);
          return;
        }
        const payload = await fetchJson(`/api/suite-runs?project_id=${encodeURIComponent(projectId)}`);
        if (cancelled) return;
        setSuiteRuns(payload);
        setLatestSuiteRun((current) => {
          if (!current?.id) return payload[0] || current;
          return payload.find((item) => item.id === current.id) || current;
        });
        if (!monitorSuiteRunId && payload[0]) {
          setMonitorSuiteRunId(payload[0].id);
        }
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
  }, [authUser?.id, activeModule, currentProjectId, monitorSuiteRunId]);

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
        if (!cancelled && !isAuthRequiredError(err)) setError(`刷新执行监控详情失败：${err.message}`);
      }
    }
    pollMonitorDetail();
    const isActiveRun = ['queued', 'running'].includes(monitorSuiteRunDetail?.status);
    const timer = window.setInterval(pollMonitorDetail, isActiveRun ? 1500 : 5000);
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
    const isLive = ['queued', 'running'].includes(monitorBrowserRun?.status) || monitorBrowserTarget.caseItem?.status === 'running';
    const timer = window.setInterval(pollMonitorBrowserRun, isLive ? 1200 : 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, activeModule, monitorBrowserTarget.runId, monitorBrowserTarget.caseItem?.status, monitorBrowserRun?.status]);

  useEffect(() => {
    const sessionId = monitorBrowserRun?.browserSessionId;
    if (!sessionId || activeModule !== 'execution-monitor') {
      setMonitorBrowserLiveConnected(false);
      setMonitorBrowserHasFrame(false);
      return undefined;
    }
    if (monitorBrowserSocketRef.current) {
      monitorBrowserSocketRef.current.close();
    }
    setMonitorBrowserHasFrame(false);
    const socket = new WebSocket(`${WS_BASE}/ws/browser-sessions/${sessionId}`);
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
      if (payload.type === 'status') {
        setMonitorBrowserStatus(payload.status);
        setMonitorBrowserDetail(payload.message || '');
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
  }, [activeModule, monitorBrowserRun?.browserSessionId]);

  useEffect(() => {
    if (!authUser || !latestRun?.id) return undefined;
    let cancelled = false;
    async function pollRun() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const [runPayload, logPayload, imagePayload] = await Promise.all([
          fetchJson(`/api/runs/${latestRun.id}`),
          fetchJson(`/api/runs/${latestRun.id}/logs`),
          fetchJson(`/api/runs/${latestRun.id}/screenshot`),
        ]);
        if (!cancelled) {
          setRuns((items) => items.map((item) => (item.id === runPayload.id ? runPayload : item)));
          setExecutionBrowserStatus(runPayload.browserSession?.status || runPayload.status);
          setLogs(logPayload.items);
          setScreenshot(imagePayload.dataUrl || '');
          if (runPayload.workItemId && runPayload.status !== 'running') {
            await selectWorkItem(runPayload.workItemId);
          }
        }
      } catch {
        // Keep the platform usable when a historical run has missing evidence.
      }
    }
    pollRun();
    const timer = window.setInterval(pollRun, latestRun.status === 'running' ? 1200 : 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, latestRun?.id, latestRun?.status]);

  useEffect(() => {
    const sessionId = latestRun?.browserSessionId;
    if (!sessionId) return undefined;
    if (executionBrowserSocketRef.current) {
      executionBrowserSocketRef.current.close();
    }
    const socket = new WebSocket(`${WS_BASE}/ws/browser-sessions/${sessionId}`);
    executionBrowserSocketRef.current = socket;
    socket.addEventListener('open', () => setExecutionLiveConnected(true));
    socket.addEventListener('close', () => setExecutionLiveConnected(false));
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'status') {
        setExecutionBrowserStatus(payload.status);
        setExecutionBrowserDetail(payload.message || '');
      }
      if (payload.type === 'frame' && executionBrowserCanvasRef.current) {
        drawBrowserFrame(executionBrowserCanvasRef.current, payload);
      }
    });
    return () => {
      socket.close();
    };
  }, [latestRun?.browserSessionId]);

  useEffect(() => {
    if (!authUser || !explorationRun?.id) return undefined;
    let cancelled = false;

    async function pollExplorationRun() {
      try {
        await ensureAuthenticated();
        if (cancelled) return;
        const payload = await fetchJson(`/api/exploration-runs/${explorationRun.id}`);
        if (cancelled) return;
        setExplorationRun(payload);
        setExplorationLogs(payload.logs || []);
        setBrowserStatus(payload.browserSession?.status || payload.status);
        if (payload.status === 'passed' && payload.result) {
          setExploring(false);
          applyExplorationResult(payload.result);
          setNotice(`探索完成：采集到 ${payload.result.elements?.length || 0} 个候选元素，请人工勾选确认后保存探索。`);
          setError('');
        } else if (payload.status === 'partial' && payload.result) {
          setExploring(false);
          applyExplorationResult(payload.result);
          setNotice(`探索部分完成：采集到 ${payload.result.elements?.length || 0} 个候选元素，请人工确认后保存探索。`);
          setError('');
        } else if (payload.status === 'failed') {
          setExploring(false);
          setError(`执行探索失败：${payload.error || '浏览器探索异常结束'}`);
        }
      } catch (err) {
        if (!cancelled) {
          if (isAuthRequiredError(err)) return;
          setExploring(false);
          setError(`获取探索流程失败：${err.message}`);
        }
      }
    }

    pollExplorationRun();
    const timer = window.setInterval(pollExplorationRun, explorationRun.status === 'running' ? 800 : 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser?.id, explorationRun?.id, explorationRun?.status]);

  useEffect(() => {
    const sessionId = explorationRun?.browserSessionId;
    if (!sessionId) return undefined;
    if (browserSocketRef.current) {
      browserSocketRef.current.close();
    }
    const socket = new WebSocket(`${WS_BASE}/ws/browser-sessions/${sessionId}`);
    browserSocketRef.current = socket;
    socket.addEventListener('open', () => setLiveConnected(true));
    socket.addEventListener('close', () => setLiveConnected(false));
    socket.addEventListener('message', async (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'status') {
        setBrowserStatus(payload.status);
        setBrowserStatusDetail(payload.message || '');
      }
      if (payload.type === 'frame' && browserCanvasRef.current) {
        drawBrowserFrame(browserCanvasRef.current, payload);
      }
    });
    return () => {
      socket.close();
    };
  }, [explorationRun?.browserSessionId]);

  async function createWorkItem() {
    if (!currentProjectId) {
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
        body: JSON.stringify({ ...requirementForm, project_id: currentProjectId, feature_id: requirementFeatureId }),
      });
      setError('');
      setWorkItems((items) => [item, ...items]);
      selectedWorkItemIdRef.current = item.id;
      setCurrentItem(item);
      currentItemRef.current = item;
      setCasesMarkdown(item.casesMarkdown || '');
      setScriptContent(item.scriptContent || '');
      setAssetMode(item.assetMode || 'create');
      setConfirmedElementKeys(new Set());
      setExploration(emptyExploration());
      openModule('requirements');
      setNotice('需求分析完成，可在确认抽取结果后进入用例设计。');
    } catch (err) {
      setError(`需求分析失败：${err.message}`);
    } finally {
      setAnalyzingRequirement(false);
    }
  }

  function toggleCaseSelection(caseId, selected) {
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
      cases.forEach((item) => {
        if (selected) next.add(item.id);
        else next.delete(item.id);
      });
      return next;
    });
  }

  async function bindCaseFeature(caseId, featureId) {
    try {
      const updatedCase = await fetchJson(`/api/test-cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: featureId }),
      });
      setTestCases((items) => items.map((item) => (item.id === caseId ? updatedCase : item)));
      await refreshFeatures();
      setNotice(featureId ? `用例已绑定功能：${updatedCase.featurePath || updatedCase.featureName || featureId}` : '用例已解绑功能');
      setError('');
    } catch (err) {
      setError(`绑定功能失败：${err.message}`);
    }
  }

  async function openScriptEditor(caseItem) {
    if (!caseItem?.scriptVersionId) return;
    setScriptEditor({
      open: true,
      loading: true,
      saving: false,
      error: '',
      detail: null,
      content: '',
      sourceCase: caseItem,
    });
    try {
      const detail = await fetchJson(`/api/script-versions/${caseItem.scriptVersionId}`);
      setScriptEditor({
        open: true,
        loading: false,
        saving: false,
        error: '',
        detail,
        content: detail.content || '',
        sourceCase: caseItem,
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
        setScriptContent(item.scriptContent || draft.content || scriptEditor.content);
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

  async function createSuiteFromSelection() {
    const caseIds = Array.from(selectedCaseIds);
    if (!currentProjectId) {
      setError('请先在项目管理中创建项目。');
      return;
    }
    if (!caseIds.length) {
      setError('请先选择至少一个用例再创建套件');
      return;
    }
    try {
      const suite = await fetchJson('/api/test-suites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: currentProjectId,
          name: newSuiteName,
          description: '由用例管理页勾选生成。',
        }),
      });
      const updatedSuite = await fetchJson(`/api/test-suites/${suite.id}/cases`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_ids: caseIds }),
      });
      setSuites((items) => [updatedSuite, ...items.filter((item) => item.id !== updatedSuite.id)]);
      setSelectedSuiteId(updatedSuite.id);
      setSuiteForm(normalizeSuiteForm(updatedSuite));
      setSuiteEditing(false);
      setNotice(`套件已创建：${updatedSuite.name}`);
      setError('');
    } catch (err) {
      setError(`创建套件失败：${err.message}`);
    }
  }

  function beginCreateSuite() {
    setSelectedSuiteId('');
    setSuiteForm(normalizeSuiteForm({ projectId: currentProjectId, name: '新建测试套件', caseIds: Array.from(selectedCaseIds) }));
    setSuiteEditing(true);
    openModule('test-suites');
  }

  function selectSuite(suiteId) {
    const suite = suites.find((item) => item.id === suiteId);
    if (!suite || suite.legacy) return;
    setSelectedSuiteId(suite.id);
    setSuiteForm(normalizeSuiteForm(suite));
    setSuiteEditing(false);
  }

  async function saveSuite() {
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
      setSuiteForm(normalizeSuiteForm(updatedSuite));
      setSuiteEditing(false);
      setNotice(`套件已保存：${updatedSuite.name}`);
      setError('');
    } catch (err) {
      setError(`保存套件失败：${err.message}`);
    }
  }

  async function deleteSuite(suiteId = selectedSuiteId) {
    const suite = suites.find((item) => item.id === suiteId);
    if (!suite || suite.legacy) return;
    if (!window.confirm(`确认删除测试套件「${suite.name}」？`)) return;
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
        body: JSON.stringify({ suite_id: suiteId }),
      });
      setLatestSuiteRun(suiteRun);
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

  async function saveAIConfig() {
    try {
      const payload = await fetchJson('/api/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiConfig),
      });
      setHealth((value) => ({ ...value, ai: payload }));
      setAiConfig({ ...aiProfileToForm(payload.activeProfile), api_key: '' });
      setAiSecretVisible(false);
      setError('');
      setNotice('AI 配置档案已保存');
    } catch (err) {
      setError(`保存 AI 配置失败：${err.message}`);
    }
  }

  function newAIConfig() {
    setAiConfig(emptyAIConfig());
    setAiSecretVisible(false);
    setError('');
  }

  function selectAIProfile(profile) {
    setAiConfig(aiProfileToForm(profile));
    setAiSecretVisible(false);
    setError('');
  }

  async function activateAIProfile(profileId = aiConfig.id) {
    if (!profileId) {
      setError('请先选择已保存的 AI 配置档案');
      return;
    }
    try {
      const payload = await fetchJson('/api/ai-config/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId }),
      });
      setHealth((value) => ({ ...value, ai: payload }));
      setAiConfig({ ...aiProfileToForm(payload.activeProfile), api_key: '' });
      setAiSecretVisible(false);
      setError('');
      setNotice('已切换当前 AI 配置');
    } catch (err) {
      setError(`切换 AI 配置失败：${err.message}`);
    }
  }

  async function testAIConfig() {
    setTestingAIConfig(true);
    try {
      const payload = await fetchJson('/api/ai-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiConfig),
      });
      setHealth((value) => ({
        ...value,
        ai: {
          ...(value.ai || {}),
          configured: true,
          provider: payload.provider || value.ai?.provider,
          model: payload.model,
          baseUrl: payload.baseUrl,
          connectionStatus: 'connected',
        },
      }));
      setError('');
      setNotice(payload.message || 'AI 连接测试成功');
    } catch (err) {
      setNotice('');
      setError(`测试 AI 连接失败：${err.message}`);
    } finally {
      setTestingAIConfig(false);
    }
  }

  async function clearAIConfig() {
    try {
      const payload = await fetchJson('/api/ai-config', { method: 'DELETE' });
      setHealth((value) => ({ ...value, ai: payload }));
      setAiConfig({ ...aiProfileToForm(payload.activeProfile), api_key: '' });
      setAiSecretVisible(false);
      setError('');
      setNotice('本地 AI 配置已清除');
    } catch (err) {
      setError(`清除 AI 配置失败：${err.message}`);
    }
  }

  async function deleteAIProfile(profileId = aiConfig.id) {
    if (!profileId) {
      setError('请先选择已保存的 AI 配置档案');
      return;
    }
    try {
      const payload = await fetchJson(`/api/ai-config?profile_id=${encodeURIComponent(profileId)}`, { method: 'DELETE' });
      setHealth((value) => ({ ...value, ai: payload }));
      setAiConfig({ ...aiProfileToForm(payload.activeProfile), api_key: '' });
      setAiSecretVisible(false);
      setError('');
      setNotice('AI 配置档案已删除');
    } catch (err) {
      setError(`删除 AI 配置失败：${err.message}`);
    }
  }

  async function revealAISecret() {
    if (health.ai?.envLocked) {
      setError('API Key 已由环境变量配置，页面无法读取服务进程的环境变量明文。');
      return '';
    }
    if (aiConfig.api_key) {
      setAiSecretVisible((value) => !value);
      setError('');
      return aiConfig.api_key;
    }
    if (!aiConfig.id) {
      setAiSecretVisible((value) => !value);
      setError('');
      return '';
    }
    try {
      const payload = await fetchJson(`/api/ai-config/${encodeURIComponent(aiConfig.id)}/secret`);
      setAiConfig((value) => ({ ...value, api_key: payload.apiKey || '' }));
      setAiSecretVisible(true);
      setError('');
      return payload.apiKey || '';
    } catch (err) {
      setError(`读取 AI 密钥失败：${err.message}`);
      return '';
    }
  }

  async function copyAISecret() {
    if (health.ai?.envLocked) {
      setError('API Key 已由环境变量配置，页面无法复制环境变量明文。');
      return;
    }
    let secret = aiConfig.api_key;
    if (!secret && aiConfig.id) {
      try {
        const payload = await fetchJson(`/api/ai-config/${encodeURIComponent(aiConfig.id)}/secret`);
        secret = payload.apiKey || '';
        setAiConfig((value) => ({ ...value, api_key: secret }));
      } catch (err) {
        setError(`复制 AI 密钥失败：${err.message}`);
        return;
      }
    }
    if (!secret) {
      setError('当前没有可复制的 API Key');
      return;
    }
    try {
      const copied = await writeClipboardText(secret);
      if (!copied) throw new Error('浏览器拒绝写入剪贴板');
      setError('');
      setNotice('API Key 已复制');
    } catch (err) {
      setError(`复制 AI 密钥失败：${err.message}`);
    }
  }

  function clearAutomationFlow() {
    automationFlowSocketRef.current?.close();
    automationFlowSocketRef.current = null;
    automationBrowserSocketRef.current?.close();
    automationBrowserSocketRef.current = null;
    setAutomationRequirement('');
    setAutomationFlow(null);
    setAutomationFlowId('');
    setAutomationLogs([]);
    setAutomationArtifacts([]);
    setAutomationStatus('idle');
    setAutomationActiveStage('');
    setAutomationLiveConnected(false);
    setAutomationBrowserStatus('Closed');
    setAutomationBrowserDetail('');
    setAutomationBrowserLiveConnected(false);
    setAutomationBrowserSessionId('');
    setAutomationBrowserMode('exploration');
    setAutomationBrowserHasFrame(false);
    setAutomationResetKey((value) => value + 1);
    setError('');
    setNotice('');
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
    setAutomationHistoryRestoringId(flowRunId);
    setAutomationHistoryError('');
    try {
      const payload = await fetchJson(`/api/automation-flows/${flowRunId}`);
      applyAutomationSnapshot(payload);
      setAutomationFlowId(payload.id || payload.flowRunId || flowRunId);
      setAutomationResetKey((value) => value + 1);
      setNotice(`已恢复历史全流程：${payload.flowRunId || payload.id || flowRunId}`);
      setError('');
    } catch (err) {
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
      setAutomationFlow(null);
      setAutomationFlowId('');
      setAutomationLogs([]);
      setAutomationArtifacts([]);
      setAutomationStatus('running');
      setAutomationActiveStage('需求分析');
      const payload = await fetchJson('/api/automation-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: requirementText, project_id: automationProjectId, feature_id: automationFeatureId }),
      });
      setAutomationFlow(payload);
      setAutomationFlowId(payload.id || payload.flowRunId || '');
      setAutomationLogs(payload.logs || []);
      setAutomationArtifacts(payload.flowArtifacts || []);
      setAutomationStatus(payload.status || 'running');
      setAutomationActiveStage(payload.stage || '需求分析');
      loadAutomationFlowHistory();
      setNotice(`真实全流程已启动：${payload.flowRunId || payload.id}`);
      setError('');
    } catch (err) {
      setAutomationStatus('failed');
      setAutomationActiveStage('需求分析');
      setError(`启动全流程失败：${err.message}`);
    }
  }

  async function saveExploration() {
    if (!currentItem) return;
    try {
      const item = await fetchJson(`/api/work-items/${currentItem.id}/explore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exploration),
      });
      setError('');
      setCurrentItem(item);
      openModule('scripts');
    } catch (err) {
      setError(`保存探索失败：${err.message}`);
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
          confirmed: key && confirmedKeys.has(key) ? true : local ? Boolean(local.confirmed) : Boolean(element.confirmed),
        };
      });
      return {
        ...state,
        notes: result.notes || '',
        screenshot_path: result.screenshot_path || '',
        page_structure: result.page_structure || '',
        elements,
      };
    });
  }

  async function runExploration() {
    if (!currentItem) return;
    try {
      setExploring(true);
      setExplorationLogs([]);
      const run = await fetchJson(`/api/work-items/${currentItem.id}/explore/run`, { method: 'POST' });
      setExplorationRun(run);
      setExplorationLogs(run.logs || []);
      if (run.previewDataUrl) {
        setExplorationPreview(run.previewDataUrl);
      }
      setNotice('探索已启动：正在调起 Playwright 浏览器并实时采集页面证据。');
      setError('');
    } catch (err) {
      setError(`执行探索失败：${err.message}`);
      setExploring(false);
    } finally {
      // 完成状态由探索轮询接管，避免按钮过早恢复。
    }
  }

  function sendBrowserCommand(payload) {
    const socket = browserSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ ...payload, commandId: crypto.randomUUID?.() || `${Date.now()}` }));
  }

  function sendExecutionBrowserCommand(payload) {
    const socket = executionBrowserSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ ...payload, commandId: crypto.randomUUID?.() || `${Date.now()}` }));
  }

  function selectMonitorCaseRun(runId) {
    if (!runId) return;
    setMonitorSelectedCaseRunId(runId);
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

  function handleExecutionBrowserClick(event) {
    const point = canvasPoint(event, executionBrowserCanvasRef.current);
    sendExecutionBrowserCommand({ type: 'mouse', action: 'click', x: point.x, y: point.y });
  }

  function handleExecutionBrowserMove(event) {
    const point = canvasPoint(event, executionBrowserCanvasRef.current);
    sendExecutionBrowserCommand({ type: 'mouse', action: 'move', x: point.x, y: point.y });
  }

  function handleExecutionBrowserWheel(event) {
    event.preventDefault();
    sendExecutionBrowserCommand({ type: 'mouse', action: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY });
  }

  function handleExecutionBrowserKeyDown(event) {
    if (event.key.length === 1) {
      sendExecutionBrowserCommand({ type: 'keyboard', action: 'type', text: event.key });
    } else {
      sendExecutionBrowserCommand({ type: 'keyboard', action: 'press', key: event.key });
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

  async function generateCases() {
    if (!currentItem) return;
    try {
      const item = await fetchJson(`/api/work-items/${currentItem.id}/generate-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: casesMarkdown,
          asset_mode: assetMode,
          case_ids: currentItem.caseIds || [],
        }),
      });
      setError('');
      setCurrentItem(item);
      setAssetMode(item.assetMode || assetMode);
      openModule('exploration');
      setCasesMarkdown(item.casesMarkdown || casesMarkdown);
      await loadAll();
    } catch (err) {
      setError(`生成用例失败：${err.message}`);
    }
  }

  async function generateScript() {
    if (!currentItem) return;
    try {
      const item = await fetchJson(`/api/work-items/${currentItem.id}/generate-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: scriptContent,
          asset_mode: assetMode,
          case_ids: currentItem.caseIds || [],
        }),
      });
      setError('');
      setCurrentItem(item);
      setAssetMode(item.assetMode || assetMode);
      openModule('execution');
      setScriptContent(item.scriptContent || scriptContent);
    } catch (err) {
      setError(`生成脚本失败：${err.message}`);
    }
  }

  async function saveArtifacts() {
    if (!currentItem) return;
    try {
      const refreshedItem = await fetchJson(`/api/work-items/${currentItem.id}`);
      setCurrentItem(refreshedItem);
      const item = await fetchJson(`/api/work-items/${currentItem.id}/save-artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cases_markdown: casesMarkdown || refreshedItem.casesMarkdown || '',
          script_content: scriptContent || refreshedItem.scriptContent || '',
          report_content: '',
          asset_mode: assetMode,
          case_ids: refreshedItem.caseIds || currentItem.caseIds || [],
        }),
      });
      setError('');
      setCurrentItem(item);
      openModule('delivery');
      const nextFilters = { ...emptyDeliveryFilters(), work_item_id: item.id };
      setDeliveryFilters(nextFilters);
      await loadDeliveryReport(nextFilters, 1);
      await loadAll();
    } catch (err) {
      setError(`保存交付物失败：${err.message}`);
    }
  }

  async function runCurrentItem() {
    if (!currentItem) return;
    try {
      const item = await fetchJson(`/api/work-items/${currentItem.id}/run`, { method: 'POST' });
      setError('');
      setCurrentItem(item);
      openModule('execution');
      if (item.latestRunId) {
        const runPayload = await fetchJson(`/api/runs/${item.latestRunId}`).catch(() => null);
        if (runPayload) {
          setRuns((items) => {
            const exists = items.some((run) => run.id === runPayload.id);
            return exists ? items.map((run) => (run.id === runPayload.id ? runPayload : run)) : [runPayload, ...items];
          });
          const runLogs = await fetchJson(`/api/runs/${item.latestRunId}/logs`).catch(() => []);
          setLogs(runLogs.items || runLogs);
        }
      }
      await loadAll();
    } catch (err) {
      setError(`执行任务失败：${err.message}`);
    }
  }

  async function recordHealing() {
    if (!currentItem) return;
    try {
      const item = await fetchJson(`/api/work-items/${currentItem.id}/self-heal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(healingForm),
      });
      setError('');
      setCurrentItem(item);
    } catch (err) {
      setError(`记录自愈失败：${err.message}`);
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
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        registerForm={registerForm}
        setRegisterForm={setRegisterForm}
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
          <RadioTower size={22} />
          {!sidebarCollapsed && (
            <div>
              <strong>自动化测试平台</strong>
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
                passwordPanelOpen={passwordPanelOpen}
                setPasswordPanelOpen={setPasswordPanelOpen}
                passwordForm={passwordForm}
                setPasswordForm={setPasswordForm}
                changePassword={changePassword}
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
            <button type="button" className="banner-close-button" aria-label="关闭错误提示" onClick={() => setError('')}>
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
            {showWorkflowContext && <WorkflowContextBar activeModule={activeModule} item={currentItem} latestRun={latestRun} />}
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
                workItems={workItems}
                selectWorkItem={selectWorkItem}
              />
            )}
            {activeModule === 'ai-config' && <AIConfig health={health} aiConfig={aiConfig} setAiConfig={setAiConfig} saveAIConfig={saveAIConfig} clearAIConfig={clearAIConfig} testAIConfig={testAIConfig} testingAIConfig={testingAIConfig} newAIConfig={newAIConfig} selectAIProfile={selectAIProfile} activateAIProfile={activateAIProfile} deleteAIProfile={deleteAIProfile} aiSecretVisible={aiSecretVisible} revealAISecret={revealAISecret} copyAISecret={copyAISecret} />}
            {activeModule === 'user-management' && <UserManagement users={users} loadUsers={loadUsers} createUser={createUser} updateUser={updateUser} deleteUser={deleteUser} resetUserPassword={resetUserPassword} message={userActionMessage} />}
            {activeModule === 'feature-menus' && <FeatureMenus projects={projects} currentProjectId={currentProjectId} setCurrentProjectId={setCurrentProjectId} features={features} featureTree={featureTree} refreshFeatures={refreshFeatures} fetchJson={fetchJson} setNotice={setNotice} setError={setError} />}
            {activeModule === 'projects' && <Projects projects={projects} setProjects={setProjects} currentProjectId={currentProjectId} setCurrentProjectId={setCurrentProjectId} workItems={workItems} testCases={testCases} deliverables={deliverables} suiteRuns={suiteRuns} fetchJson={fetchJson} setNotice={setNotice} setError={setError} />}
            {activeModule === 'test-suites' && (
              <TestSuites
                suites={suites}
                testCases={testCases}
                selectedSuiteId={selectedSuiteId}
                suiteForm={suiteForm}
                setSuiteForm={setSuiteForm}
                suiteEditing={suiteEditing}
                setSuiteEditing={setSuiteEditing}
                selectSuite={selectSuite}
                beginCreateSuite={beginCreateSuite}
                saveSuite={saveSuite}
                deleteSuite={deleteSuite}
                runSuite={(suiteId) => runSuite(suiteId, { navigateToMonitor: true })}
                projects={projects}
                currentProjectId={currentProjectId}
                suiteCaseProjects={suiteCaseProjects}
              />
            )}
            {activeModule === 'execution-monitor' && (
              <ExecutionMonitor
                suiteRuns={suiteRuns}
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
                selectedCaseRunId={monitorBrowserTarget.runId}
                selectCaseRun={selectMonitorCaseRun}
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
                clearFlow={clearAutomationFlow}
                logRef={automationLogRef}
                resetKey={automationResetKey}
                canRunFlow={canExecute}
              />
            )}
            {activeModule === 'requirements' && (
              <Requirements
                projects={projects}
                selectedProjectId={currentProjectId}
                selectedFeatureId={requirementFeatureId}
                featureTree={requirementFeatureTree}
                featureOptions={requirementFeatureOptions}
                onProjectChange={setCurrentProjectId}
                onFeatureChange={setRequirementFeatureId}
                form={requirementForm}
                setForm={setRequirementForm}
                createWorkItem={createWorkItem}
                item={currentItem}
                analyzing={analyzingRequirement}
                setActiveModule={openModule}
                canCreate={canCreateDrafts}
              />
            )}
            {activeModule === 'case-management' && <CaseManagement testCases={testCases} features={features} selectedCaseIds={selectedCaseIds} toggleCaseSelection={toggleCaseSelection} setAllVisibleCasesSelected={setAllVisibleCasesSelected} runSelectedCases={runSelectedCases} createSuiteFromSelection={createSuiteFromSelection} newSuiteName={newSuiteName} setNewSuiteName={setNewSuiteName} setActiveModule={openModule} bindCaseFeature={bindCaseFeature} deleteCase={deleteCase} deleteSelectedCases={deleteSelectedCases} scriptEditor={scriptEditor} openScriptEditor={openScriptEditor} closeScriptEditor={closeScriptEditor} updateScriptEditorContent={updateScriptEditorContent} saveScriptEditorDraft={saveScriptEditorDraft} canManageAssets={canManageAssets} canExecute={canExecute} canEditScripts={canCreateDrafts} />}
            {activeModule === 'exploration' && <Exploration item={currentItem} exploration={exploration} explorationRun={explorationRun} explorationLogs={explorationLogs} browserStatus={browserStatus} browserStatusDetail={browserStatusDetail} liveConnected={liveConnected} browserCanvasRef={browserCanvasRef} setExploration={setExploration} updateElement={updateElement} addElement={addElement} setAllElementsConfirmed={setAllElementsConfirmed} saveExploration={saveExploration} runExploration={runExploration} exploring={exploring} sendBrowserCommand={sendBrowserCommand} handleBrowserClick={handleBrowserClick} handleBrowserMove={handleBrowserMove} handleBrowserWheel={handleBrowserWheel} handleBrowserKeyDown={handleBrowserKeyDown} canEdit={canCreateDrafts} />}
            {activeModule === 'cases' && <Cases item={currentItem} casesMarkdown={casesMarkdown} setCasesMarkdown={setCasesMarkdown} generateCases={generateCases} assetMode={assetMode} setAssetMode={setAssetMode} canEdit={canCreateDrafts} />}
            {activeModule === 'scripts' && <Scripts item={currentItem} latestRun={latestRun} scriptContent={scriptContent} setScriptContent={setScriptContent} generateScript={generateScript} saveArtifacts={saveArtifacts} assetMode={assetMode} canEdit={canCreateDrafts} canSaveArtifacts={canSaveArtifacts} />}
            {activeModule === 'execution' && <Execution latestRun={latestRun} logs={logs} screenshot={screenshot} runCurrentItem={runCurrentItem} currentItem={currentItem} browserStatus={executionBrowserStatus} browserStatusDetail={executionBrowserDetail} liveConnected={executionLiveConnected} browserCanvasRef={executionBrowserCanvasRef} sendBrowserCommand={sendExecutionBrowserCommand} handleBrowserClick={handleExecutionBrowserClick} handleBrowserMove={handleExecutionBrowserMove} handleBrowserWheel={handleExecutionBrowserWheel} handleBrowserKeyDown={handleExecutionBrowserKeyDown} canExecute={canExecute} />}
            {activeModule === 'healing' && <Healing item={currentItem} form={healingForm} setForm={setHealingForm} recordHealing={recordHealing} canEdit={canCreateDrafts} />}
            {activeModule === 'delivery' && <Delivery item={currentItem} projects={projects} currentProjectId={currentProjectId} deliveryReport={deliveryReport} deliveryFilters={deliveryFilters} setDeliveryFilters={setDeliveryFilters} loadDeliveryReport={loadDeliveryReport} fetchJson={fetchJson} />}
          </div>
        </section>
      </section>
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

function AIConfig({
  health,
  aiConfig,
  setAiConfig,
  saveAIConfig,
  clearAIConfig,
  testAIConfig,
  testingAIConfig,
  newAIConfig,
  selectAIProfile,
  activateAIProfile,
  deleteAIProfile,
  aiSecretVisible,
  revealAISecret,
  copyAISecret,
}) {
  const profiles = health.ai?.profiles || [];
  const activeProfileId = health.ai?.activeProfileId || health.ai?.profileId || '';
  const editingSavedProfile = profiles.find((profile) => profile.id === aiConfig.id);
  const isEditingActive = Boolean(aiConfig.id && aiConfig.id === activeProfileId);
  return (
    <section className="module-section" aria-label="AI 配置">
      <div className="section-header">
        <div>
          <h2>AI 多厂商配置</h2>
          <p>保存多个AI配置，在生成测试用例、脚本和自愈时切换当前模型。</p>
        </div>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={newAIConfig}>
            <Plus size={17} />
            新建配置
          </button>
          <button type="button" className="ghost-button danger-action" onClick={() => deleteAIProfile(aiConfig.id)} disabled={!aiConfig.id}>
            <Trash2 size={17} />
            删除配置
          </button>
          <button type="button" className="ghost-button" onClick={clearAIConfig} disabled={health.ai?.envLocked && health.ai?.baseUrlLocked}>
            <XCircle size={17} />
            清除本地全部
          </button>
          <button type="button" className="primary-action" onClick={saveAIConfig}>
            <Save size={17} />
            保存配置
          </button>
        </div>
      </div>
      <div className="ai-config-layout">
        <aside className="data-panel ai-profile-list" aria-label="AI 配置列表">
          <div className="panel-heading">
            <h3>配置列表</h3>
            <span className="source-chip">{profiles.length} 个</span>
          </div>
          {profiles.length ? (
            <div className="ai-profile-items">
              {profiles.map((profile) => (
                <button
                  type="button"
                  className={`ai-profile-card ${profile.id === aiConfig.id ? 'selected' : ''}`}
                  onClick={() => selectAIProfile(profile)}
                  key={profile.id}
                >
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{aiProviderLabel(profile.provider)} · {profile.model}</small>
                  </span>
                  {profile.id === activeProfileId && <b>当前</b>}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">暂无本地配置。</p>
          )}
        </aside>

        <div className="data-panel">
          <h3>配置表单</h3>
          <div className="form-grid compact">
            <label className="field wide">
              <span>配置名称</span>
              <input
                value={aiConfig.name}
                placeholder="例如：DeepSeek 生产网关"
                onChange={(event) => setAiConfig({ ...aiConfig, name: event.target.value })}
              />
            </label>
            <label className="field wide">
              <span>厂商</span>
              <select value={aiConfig.provider} onChange={(event) => setAiConfig({ ...aiConfig, provider: event.target.value })}>
                {AI_PROVIDER_OPTIONS.map((provider) => (
                  <option value={provider.value} key={provider.value}>{provider.label}</option>
                ))}
              </select>
            </label>
            <label className="field wide">
              <span>API Key</span>
              <div className="secret-input-row">
                <input
                  type={aiSecretVisible ? 'text' : 'password'}
                  value={aiConfig.api_key}
                  placeholder={health.ai?.envLocked ? '已由环境变量配置，前端不可覆盖' : editingSavedProfile?.maskedKey || 'sk-...'}
                  disabled={health.ai?.envLocked}
                  onChange={(event) => setAiConfig({ ...aiConfig, api_key: event.target.value })}
                />
                <button type="button" className="icon-button" title={aiSecretVisible ? '隐藏密钥' : '显示密钥'} onClick={revealAISecret} disabled={health.ai?.envLocked}>
                  {aiSecretVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button type="button" className="icon-button" title="复制密钥" onClick={copyAISecret} disabled={health.ai?.envLocked}>
                  <Copy size={16} />
                </button>
              </div>
            </label>
            <label className="field wide">
              <span>模型</span>
              <input value={aiConfig.model} onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })} />
            </label>
            <label className="field wide">
              <span>Base URL</span>
              <input
                value={aiConfig.base_url}
                placeholder={DEFAULT_AI_BASE_URL}
                disabled={health.ai?.baseUrlLocked}
                onChange={(event) => setAiConfig({ ...aiConfig, base_url: event.target.value })}
              />
            </label>
          </div>
          <div className="action-row ai-form-actions">
            <button type="button" className="ghost-button" onClick={() => activateAIProfile(aiConfig.id)} disabled={!aiConfig.id || isEditingActive}>
              <CheckCircle2 size={17} />
              设为当前
            </button>
            <button type="button" className="ghost-button" onClick={testAIConfig} disabled={testingAIConfig}>
              <RadioTower size={17} />
              {testingAIConfig ? '测试中...' : '测试连接'}
            </button>
            <button type="button" className="primary-action" onClick={saveAIConfig}>
              <Save size={17} />
              保存并启用
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuthWorkspaceHero() {
  const highlights = [
    { icon: ClipboardList, title: '需求分析与项目预检', description: '自动抽取测试目标、角色、数据与验收标准，并检查 Playwright 配置和项目约定。', tone: 'teal' },
    { icon: FlaskConical, title: '用例设计与页面探索', description: '沉淀可追溯测试用例，调起实时浏览器采集页面结构、截图、日志和候选元素。', tone: 'blue' },
    { icon: MonitorPlay, title: '脚本生成与运行验证', description: 'AI 或人工编辑 Playwright 脚本，执行草稿 spec，展示实时日志、报告和历史结果。', tone: 'indigo' },
    { icon: Wand2, title: '自愈诊断与交付归档', description: '失败后记录修复尝试，验证通过后保存用例、spec、报告和运行证据。', tone: 'cyan' },
  ];
  const metrics = [
    { value: '8 步', label: '自动化流程' },
    { value: '实时', label: '浏览器探索画面' },
    { value: '可追溯', label: '验证产物归档' },
  ];

  return (
    <aside className="auth-hero" aria-label="平台品牌">
      <div className="auth-brand">
        <span className="auth-brand-mark"><AuthPlatformLogo /></span>
        <strong>Web 自动化测试平台</strong>
        <span>AI-Powered Automation Platform</span>
      </div>
      <div className="auth-hero-copy">
        <h2>
          <span>从需求到交付</span>
          <span>自动化测试闭环</span>
        </h2>
        <p>面向本地自动化测试场景，串联需求分析、项目预检、用例设计、页面探索、脚本实现、运行验证、自愈诊断和交付报告，让 Playwright 测试从草稿到已验证产物全程可追踪。</p>
      </div>
      <div className="auth-feature-list" aria-label="平台能力">
        {highlights.map((item) => {
          const Icon = item.icon;
          return (
            <div className="auth-feature-item" key={item.title}>
              <span className={`auth-feature-icon ${item.tone}`}><Icon size={19} /></span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="auth-metric-strip" aria-label="平台指标">
        {metrics.map((item) => (
          <div className="auth-metric" key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function AuthPlatformLogo() {
  return (
    <svg className="auth-platform-logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect className="logo-browser" x="7" y="10" width="34" height="28" rx="6" />
      <path className="logo-browser-bar" d="M8 18h32" />
      <circle className="logo-dot logo-dot-muted" cx="14" cy="14" r="1.5" />
      <circle className="logo-dot logo-dot-muted" cx="19" cy="14" r="1.5" />
      <path className="logo-code-line" d="M15 25h7" />
      <path className="logo-code-line" d="M15 31h10" />
      <path className="logo-flow-line" d="M24 25h5.8c2.3 0 4.2 1.9 4.2 4.2v.1" />
      <circle className="logo-node" cx="24" cy="25" r="3" />
      <circle className="logo-node logo-node-end" cx="34" cy="31" r="3.5" />
      <path className="logo-check" d="m31.8 31.1 1.5 1.5 3.3-3.7" />
      <path className="logo-cursor" d="M29 20.5 34.8 23 30.4 25.2z" />
    </svg>
  );
}

function AuthGate({
  mode,
  setMode,
  clearAuthFeedback,
  loginForm,
  setLoginForm,
  registerForm,
  setRegisterForm,
  submitLogin,
  submitRegister,
  submitting,
  error,
  message,
  themeId,
}) {
  const isRegister = mode === 'register';
  const [passwordVisible, setPasswordVisible] = useState(false);
  const handleSubmit = (event) => {
    event.preventDefault();
    if (isRegister) submitRegister();
    else submitLogin();
  };
  const handleModeSwitch = () => {
    clearAuthFeedback();
    setPasswordVisible(false);
    setMode(isRegister ? 'login' : 'register');
  };

  return (
    <main className="auth-shell" data-theme={themeId}>
      <section className="auth-panel auth-layout" aria-label={isRegister ? '注册账号' : '登录平台'} data-testid="auth-panel">
        <AuthWorkspaceHero />
        <div className="auth-card">
          <div className="auth-card-surface">
            <div className="auth-card-header">
              <span className="auth-card-logo"><AuthPlatformLogo /></span>
              <h1>{isRegister ? '申请平台账号' : '欢迎回来'}</h1>
              <p>{isRegister ? '提交账号后等待管理员审核启用' : '登录到 API 智能测试平台，开始您的测试之旅'}</p>
            </div>
            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="field wide">
                <span>登录名</span>
                <div className="auth-input-wrap">
                  <UserCog size={17} />
                  <input
                    value={isRegister ? registerForm.username : loginForm.username}
                    autoComplete="username"
                    placeholder="请输入登录名"
                    inputMode="text"
                    onChange={(event) => (isRegister
                      ? setRegisterForm({ ...registerForm, username: event.target.value })
                      : setLoginForm({ ...loginForm, username: event.target.value }))}
                  />
                </div>
                {isRegister && <small className="auth-field-hint">3-32 位，可使用字母、数字、点、下划线或短横线。</small>}
              </label>
              {isRegister && (
                <label className="field wide">
                  <span>昵称</span>
                  <div className="auth-input-wrap">
                    <Sparkles size={17} />
                    <input
                      value={registerForm.display_name}
                      placeholder="请输入团队内显示名称"
                      onChange={(event) => setRegisterForm({ ...registerForm, display_name: event.target.value })}
                    />
                  </div>
                </label>
              )}
              <label className="field wide">
                <span>密码</span>
                <div className="auth-input-wrap">
                  <Lock size={17} />
                  <input
                    type={passwordVisible ? 'text' : 'password'}
                    value={isRegister ? registerForm.password : loginForm.password}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    placeholder={isRegister ? '至少 8 位，包含字母和数字' : '请输入密码'}
                    onChange={(event) => (isRegister
                      ? setRegisterForm({ ...registerForm, password: event.target.value })
                      : setLoginForm({ ...loginForm, password: event.target.value }))}
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {isRegister && <small className="auth-field-hint">至少 8 位，并包含字母和数字。</small>}
              </label>
              {error && <div className="auth-message danger" role="alert">{error}</div>}
              {message && <div className="auth-message success" role="status">{message}</div>}
              <button type="submit" className="primary-action auth-submit" disabled={submitting}>
                {submitting ? <RefreshCw className="auth-submit-spinner" size={17} /> : <Sparkles size={17} />}
                {submitting ? '处理中...' : isRegister ? '提交注册' : '登录'}
              </button>
            </form>
            <button type="button" className="auth-switch" onClick={handleModeSwitch}>
              {isRegister ? '已有账号，返回登录' : '还没有账号？ 立即注册'}
            </button>
            {!isRegister && (
              <div className="auth-default-account" aria-label="默认管理员账号">
                <Sparkles size={14} />
                <span>默认管理员账号: <strong>admin / admin123456</strong></span>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function UserManagement({ users, loadUsers, createUser, updateUser, deleteUser, resetUserPassword, message }) {
  const emptyForm = { username: '', display_name: '', password: '', role: 'viewer', status: 'active' };
  const [createForm, setCreateForm] = useState(emptyForm);
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
    const created = await createUser(createForm);
    if (created) {
      setCreateForm(emptyForm);
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
      <form className="user-detail-form" onSubmit={submitCreateUser}>
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
            <input type="password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} />
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

function TopbarActions({
  health,
  error,
  notice,
  latestRun,
  automationStatus,
  automationStage,
  themes,
  themeId,
  setThemeId,
  user,
  passwordPanelOpen,
  setPasswordPanelOpen,
  passwordForm,
  setPasswordForm,
  changePassword,
  logout,
}) {
  const [openPanel, setOpenPanel] = useState('');
  const actionsRef = useRef(null);
  const notifications = useMemo(() => {
    const items = [];
    if (error) {
      items.push({ tone: 'danger', title: '当前错误', detail: error });
    }
    if (notice) {
      items.push({ tone: 'success', title: '最新提示', detail: notice });
    }
    if (health.status === 'checking') {
      items.push({ tone: 'info', title: '后端检查中', detail: '正在连接本地服务。' });
    } else if (health.status !== 'ok') {
      items.push({ tone: 'danger', title: '后端离线', detail: '本地后端服务当前不可用。' });
    }
    if (!health.ai?.configured) {
      items.push({ tone: 'warning', title: 'AI 未配置', detail: 'AI 生成能力当前不可用。' });
    }
    if (latestRun?.status === 'running') {
      items.push({
        tone: 'info',
        title: '最近执行运行中',
        detail: `${latestRun.stage?.label || '运行验证'} · ${statusLabel(latestRun.status)}`,
      });
    } else if (latestRun?.status === 'failed') {
      items.push({
        tone: 'danger',
        title: '最近执行失败',
        detail: latestRun.error || `退出码 ${latestRun.exitCode ?? latestRun.exit_code ?? '-'}`,
      });
    }
    if (automationStatus === 'running' || automationStatus === 'healing') {
      items.push({
        tone: 'info',
        title: '全流程运行中',
        detail: automationStage ? `当前阶段：${automationStage}` : statusLabel(automationStatus),
      });
    } else if (automationStatus === 'failed' || automationStatus === 'blocked') {
      items.push({
        tone: 'danger',
        title: '全流程异常',
        detail: automationStage ? `${automationStage} · ${statusLabel(automationStatus)}` : statusLabel(automationStatus),
      });
    }
    return items;
  }, [automationStage, automationStatus, error, health.ai?.configured, health.status, latestRun, notice]);

  useEffect(() => {
    if (!openPanel) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!actionsRef.current?.contains(event.target)) setOpenPanel('');
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpenPanel('');
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openPanel]);

  const togglePanel = (panel) => setOpenPanel((current) => (current === panel ? '' : panel));
  const hasNotifications = notifications.length > 0;

  return (
    <div className="topbar-actions" aria-label="顶部工具区" data-testid="topbar-actions" ref={actionsRef}>
      <div className="topbar-action">
        <button
          type="button"
          className={openPanel === 'theme' ? 'topbar-icon-button active' : 'topbar-icon-button'}
          aria-label="界面主题"
          aria-expanded={openPanel === 'theme'}
          aria-haspopup="dialog"
          onClick={() => togglePanel('theme')}
        >
          <Palette size={22} />
        </button>
        {openPanel === 'theme' && (
          <section className="topbar-popover theme-popover" role="dialog" aria-label="界面主题面板" data-testid="topbar-theme-panel">
            <header>
              <strong>界面主题</strong>
              <span>{themes.find((theme) => theme.id === themeId)?.label || '默认'}</span>
            </header>
            <div className="theme-menu" aria-label="主题选择">
              <div className="theme-options">
                {themes.map((theme) => (
                  <button
                    type="button"
                    className={themeId === theme.id ? 'theme-option active' : 'theme-option'}
                    key={theme.id}
                    aria-pressed={themeId === theme.id}
                    onClick={() => setThemeId(theme.id)}
                  >
                    <span className="theme-swatches" aria-hidden="true">
                      {theme.swatches.map((swatch) => (
                        <span key={swatch} style={{ background: swatch }} />
                      ))}
                    </span>
                    <span>
                      <strong>{theme.label}</strong>
                      <small>{theme.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="topbar-action">
        <button
          type="button"
          className={openPanel === 'notifications' ? 'topbar-icon-button active' : 'topbar-icon-button'}
          aria-label="通知消息"
          aria-expanded={openPanel === 'notifications'}
          aria-haspopup="dialog"
          onClick={() => togglePanel('notifications')}
        >
          <Bell size={22} />
          {hasNotifications && <span className="topbar-badge" aria-hidden="true" />}
        </button>
        {openPanel === 'notifications' && (
          <section className="topbar-popover notification-popover" role="dialog" aria-label="通知消息面板" data-testid="topbar-notification-panel">
            <header>
              <strong>平台消息</strong>
              <span>{hasNotifications ? `${notifications.length} 条` : '暂无'}</span>
            </header>
            <div className="notification-list">
              {hasNotifications ? notifications.map((item, index) => (
                <div className={`notification-item ${item.tone}`} key={`${item.title}-${index}`}>
                  <CircleDot size={10} />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                </div>
              )) : (
                <div className="notification-empty">暂无新的平台消息</div>
              )}
            </div>
          </section>
        )}
      </div>

      <div className="topbar-action">
        <button
          type="button"
          className={openPanel === 'help' ? 'topbar-icon-button active' : 'topbar-icon-button'}
          aria-label="流程帮助"
          aria-expanded={openPanel === 'help'}
          aria-haspopup="dialog"
          onClick={() => togglePanel('help')}
        >
          <CircleHelp size={22} />
        </button>
        {openPanel === 'help' && (
          <section className="topbar-popover help-popover" role="dialog" aria-label="流程帮助面板" data-testid="topbar-help-panel">
            <header>
              <strong>流程帮助</strong>
              <span>QA Workflow</span>
            </header>
            <div className="topbar-flow-list">
              {FLOW.map((stage, index) => (
                <div className="topbar-flow-step" key={stage}>
                  <span>{index + 1}</span>
                  <strong>{stage}</strong>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="topbar-action">
        <button
          type="button"
          className={openPanel === 'user' ? 'topbar-icon-button qa-menu-button active' : 'topbar-icon-button qa-menu-button'}
          aria-label="QA 用户菜单"
          aria-expanded={openPanel === 'user'}
          aria-haspopup="dialog"
          onClick={() => togglePanel('user')}
        >
          <span className="qa-avatar">QA</span>
          <ChevronDown size={16} />
        </button>
        {openPanel === 'user' && (
          <section className="topbar-popover user-popover" role="dialog" aria-label="QA 用户菜单" data-testid="topbar-user-panel">
            <div className="topbar-user-card">
              <span className="qa-avatar large">{(user?.displayName || user?.username || 'QA').slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{user?.displayName || user?.username || 'QA 用户'}</strong>
                <span>{ROLE_LABELS[user?.role] || user?.role || '已登录'}</span>
              </div>
            </div>
            <button
              type="button"
              className="user-menu-action"
              onClick={() => setPasswordPanelOpen(!passwordPanelOpen)}
            >
              <Lock size={16} />
              修改密码
            </button>
            {passwordPanelOpen && (
              <div className="password-panel">
                <input
                  type="password"
                  placeholder="当前密码"
                  value={passwordForm.current_password}
                  onChange={(event) => setPasswordForm({ ...passwordForm, current_password: event.target.value })}
                />
                <input
                  type="password"
                  placeholder="新密码"
                  value={passwordForm.new_password}
                  onChange={(event) => setPasswordForm({ ...passwordForm, new_password: event.target.value })}
                />
                <button type="button" className="primary-action" onClick={changePassword}>保存密码</button>
              </div>
            )}
            <button
              type="button"
              className="user-menu-action"
              onClick={() => {
                setOpenPanel('');
                logout();
              }}
            >
              <LogOut size={16} />
              退出
            </button>
          </section>
        )}
      </div>
    </div>
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
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function TrendChart({ items = [] }) {
  const chartItems = items.length ? items : [];
  const width = 720;
  const height = 260;
  const padding = { top: 20, right: 22, bottom: 34, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...chartItems.flatMap((item) => [item.passed || 0, item.failed || 0, item.total || 0]));
  const pointFor = (item, index, key) => {
    const x = padding.left + (chartItems.length <= 1 ? plotWidth / 2 : (index / (chartItems.length - 1)) * plotWidth);
    const y = padding.top + plotHeight - (((item[key] || 0) / maxValue) * plotHeight);
    return { x, y, value: item[key] || 0, label: item.label };
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
  return (
    <div className="trend-chart" aria-label="测试执行趋势">
      {chartItems.length ? (
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
                  <circle key={`${item.key}-${point.label}`} cx={point.x} cy={point.y} r="3.8">
                    <title>{`${point.label} · ${item.label} ${point.value}`}</title>
                  </circle>
                ))}
              </g>
            ))}
          </g>
          <g className="trend-axis-labels">
            {xLabels.map((item, index) => {
              const sourceIndex = chartItems.indexOf(item);
              const x = padding.left + (chartItems.length <= 1 ? plotWidth / 2 : (sourceIndex / (chartItems.length - 1)) * plotWidth);
              return <text key={`${item.date}-${index}`} x={x} y={height - 8}>{item.label}</text>;
            })}
          </g>
        </svg>
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

function Overview({ projects, dashboardSummary, dashboardScopeProjectId, setDashboardScopeProjectId, dashboardLoading, workItems, selectWorkItem }) {
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
          <h2>测试统计看板</h2>
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
            <span className="muted">最近 {recentRuns.length}</span>
          </div>
          {recentRuns.length ? recentRuns.map((run) => (
            <div className="record-row static overview-run-row" key={`${run.type}-${run.id}`}>
              <span>
                <strong>{run.name || '未命名执行'}</strong>
                <small>{run.type === 'suite' ? '套件执行' : '单用例执行'} · {formatDateTime(run.startedAt)} · {run.totalCases || 0} 条</small>
              </span>
              <strong className={run.status}>{statusLabel(run.status)}</strong>
            </div>
          )) : <p className="muted">暂无执行记录。</p>}
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

function Projects({ projects, setProjects, currentProjectId, setCurrentProjectId, workItems, testCases, deliverables, suiteRuns, fetchJson, setNotice, setError }) {
  const currentProject = projects.find((project) => project.id === currentProjectId) || projects[0];
  const projectWorkItems = workItems.filter((item) => !currentProject || item.projectId === currentProject.id);
  const projectCases = testCases.filter((item) => !currentProject || item.projectId === currentProject.id);
  const projectDeliverables = deliverables.filter((item) => !currentProject || item.projectId === currentProject.id);
  const projectRuns = suiteRuns.filter((item) => !currentProject || item.projectId === currentProject.id);
  const [editingProjectId, setEditingProjectId] = useState(currentProject?.id || 'new');
  const [projectForm, setProjectForm] = useState(() => emptyProjectForm(currentProject));
  const isCreating = editingProjectId === 'new';

  useEffect(() => {
    if (editingProjectId === 'new') return;
    setEditingProjectId(currentProject?.id || 'new');
    setProjectForm(emptyProjectForm(currentProject));
  }, [currentProject?.id]);

  useEffect(() => {
    if (projects.length || editingProjectId === 'new') return;
    setEditingProjectId('new');
    setProjectForm(emptyProjectForm({
      name: '我的 QA 项目',
      projectType: 'delivery',
      status: 'planning',
      description: '用于管理需求、用例、交付物和批量执行的项目。',
    }));
  }, [editingProjectId, projects.length]);

  function updateProjectForm(key, value) {
    setProjectForm((previous) => ({ ...previous, [key]: value }));
  }

  function beginCreateProject() {
    setEditingProjectId('new');
    setProjectForm(emptyProjectForm({
      name: `QA 项目 ${projects.length + 1}`,
      projectType: 'delivery',
      status: 'planning',
      description: '用于管理需求、用例、交付物和批量执行的项目。',
    }));
  }

  function selectProject(project) {
    setCurrentProjectId(project.id);
    setEditingProjectId(project.id);
    setProjectForm(emptyProjectForm(project));
  }

  function cancelProjectEdit() {
    setEditingProjectId(currentProject?.id || 'new');
    setProjectForm(emptyProjectForm(currentProject));
  }

  async function saveProject() {
    if (!projectForm.name.trim()) {
      setError('项目名称不能为空');
      return;
    }
    try {
      const body = JSON.stringify(projectForm);
      const project = isCreating
        ? await fetchJson('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
        : await fetchJson(`/api/projects/${currentProject.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
      setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]);
      setCurrentProjectId(project.id);
      setEditingProjectId(project.id);
      setProjectForm(emptyProjectForm(project));
      setNotice(isCreating ? `项目已创建：${project.name}` : `项目已保存：${project.name}`);
      setError('');
    } catch (err) {
      setError(`${isCreating ? '创建' : '保存'}项目失败：${err.message}`);
    }
  }

  async function deleteProject() {
    if (!currentProject || isCreating) return;
    if (!window.confirm(`确认删除项目「${currentProject.name}」？`)) return;
    try {
      await fetchJson(`/api/projects/${currentProject.id}`, { method: 'DELETE' });
      const remaining = projects.filter((project) => project.id !== currentProject.id);
      setProjects(remaining);
      setCurrentProjectId(remaining[0]?.id || '');
      setEditingProjectId(remaining[0]?.id || '');
      setProjectForm(emptyProjectForm(remaining[0]));
      setNotice(`项目已删除：${currentProject.name}`);
      setError('');
    } catch (err) {
      setError(`删除项目失败：${err.message}`);
    }
  }

  return (
    <section className="module-section" aria-label="项目管理">
      <div className="section-header">
        <div>
          <h2>项目管理</h2>
          <p>项目是需求工单、用例、交付物和套件执行的归属边界。</p>
        </div>
        <button type="button" className="primary-action" onClick={beginCreateProject}>
          <Plus size={17} />
          新建项目
        </button>
      </div>
      <div className="split-grid">
        <div className="data-panel">
          <h3>项目列表</h3>
          {projects.length ? projects.map((project) => (
            <button
              type="button"
              className={project.id === currentProject?.id && !isCreating ? 'record-row project-list-item active-record' : 'record-row project-list-item'}
              key={project.id}
              onClick={() => selectProject(project)}
            >
              <span>
                <em>{project.projectCode || project.id}</em>
                {project.name}
              </span>
              <strong>
                <b>{projectTypeLabel(project.projectType)}</b>
                <i className={`project-status ${project.status || 'active'}`}>{projectStatusLabel(project.status)}</i>
              </strong>
            </button>
          )) : <p className="muted">暂无项目。</p>}
        </div>
        <div className="data-panel">
          <div className="panel-title-row">
            <h3>{isCreating ? '新建项目' : '项目详情'}</h3>
            {!isCreating && currentProject && <span className={`project-status ${currentProject.status || 'active'}`}>{projectStatusLabel(currentProject.status)}</span>}
          </div>
          <div className="form-grid project-form-grid">
            <label className="field">
              <span>项目ID</span>
              <input value={projectForm.project_code} onChange={(event) => updateProjectForm('project_code', event.target.value)} placeholder="为空时自动生成" />
            </label>
            <label className="field">
              <span>项目名称</span>
              <input value={projectForm.name} onChange={(event) => updateProjectForm('name', event.target.value)} placeholder="输入项目名称" />
            </label>
            <label className="field">
              <span>项目类型</span>
              <select value={projectForm.project_type} onChange={(event) => updateProjectForm('project_type', event.target.value)}>
                <option value="product">产品类</option>
                <option value="delivery">交付类</option>
              </select>
            </label>
            <label className="field">
              <span>项目状态</span>
              <select value={projectForm.status} onChange={(event) => updateProjectForm('status', event.target.value)}>
                <option value="planning">规划中</option>
                <option value="active">进行中</option>
                <option value="paused">暂停</option>
                <option value="completed">已完成</option>
                <option value="archived">已归档</option>
              </select>
            </label>
            <label className="field wide">
              <span>目标 URL</span>
              <input value={projectForm.target_url} onChange={(event) => updateProjectForm('target_url', event.target.value)} placeholder="https://example.com" />
            </label>
            <label className="field">
              <span>仓库路径</span>
              <input value={projectForm.repository_path} onChange={(event) => updateProjectForm('repository_path', event.target.value)} />
            </label>
            <label className="field">
              <span>测试目录</span>
              <input value={projectForm.test_dir} onChange={(event) => updateProjectForm('test_dir', event.target.value)} />
            </label>
            <label className="field wide">
              <span>项目描述</span>
              <textarea value={projectForm.description} onChange={(event) => updateProjectForm('description', event.target.value)} />
            </label>
          </div>
          <div className="project-actions">
            <button type="button" className="primary-action" onClick={saveProject}>
              <Save size={16} />
              保存项目
            </button>
            <button type="button" className="ghost-button" onClick={cancelProjectEdit}>
              <X size={16} />
              取消
            </button>
            {!isCreating && currentProject && (
              <button type="button" className="ghost-button danger-action" onClick={deleteProject}>
                <Trash2 size={16} />
                删除项目
              </button>
            )}
          </div>
          <h3 className="subsection-title">项目概览</h3>
          <div className="delivery-row"><span>业务项目ID</span><strong>{isCreating ? '保存后生成' : currentProject?.projectCode || '-'}</strong></div>
          <div className="delivery-row"><span>当前项目</span><strong>{currentProject?.name || '未选择'}</strong></div>
          <div className="delivery-row"><span>项目类型</span><strong>{projectTypeLabel(currentProject?.projectType)}</strong></div>
          <div className="delivery-row"><span>项目状态</span><strong>{projectStatusLabel(currentProject?.status)}</strong></div>
          <div className="delivery-row"><span>仓库路径</span><strong>{currentProject?.repositoryPath || '-'}</strong></div>
          <div className="delivery-row"><span>测试目录</span><strong>{currentProject?.testDir || '-'}</strong></div>
          <div className="delivery-row"><span>需求工单</span><strong>{projectWorkItems.length}</strong></div>
          <div className="delivery-row"><span>结构化用例</span><strong>{projectCases.length}</strong></div>
          <div className="delivery-row"><span>交付物</span><strong>{projectDeliverables.length}</strong></div>
          <div className="delivery-row"><span>套件执行</span><strong>{projectRuns.length}</strong></div>
        </div>
      </div>
    </section>
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
  suiteEditing,
  setSuiteEditing,
  selectSuite,
  beginCreateSuite,
  saveSuite,
  deleteSuite,
  runSuite,
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedScope, setSelectedScope] = useState({ type: 'all', projectId: '', featureId: '', featureIds: [] });
  const [caseSearch, setCaseSearch] = useState('');
  const [casePriority, setCasePriority] = useState('all');
  const [casePage, setCasePage] = useState(1);
  const [listPanelWidth, setListPanelWidth] = useState(340);
  const [caseTreePanelWidth, setCaseTreePanelWidth] = useState(320);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState(() => new Set());
  const [expandedFeatures, setExpandedFeatures] = useState(() => new Set());
  const casePageSize = 10;
  const normalizedSearch = search.trim().toLowerCase();
  const normalizedProjectSearch = projectSearch.trim().toLowerCase();
  const normalizedCaseSearch = caseSearch.trim().toLowerCase();
  useEffect(() => {
    if (!selectedSuiteId && suiteEditing) {
      setProjectSearch('');
      setSelectedScope({ type: 'all', projectId: '', featureId: '', featureIds: [] });
    }
  }, [selectedSuiteId, suiteEditing]);
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
  const selectedSuite = managedSuites.find((suite) => suite.id === selectedSuiteId);
  const visibleSuites = managedSuites.filter((suite) => {
    const statusMatches = statusFilter === 'all' || suite.status === statusFilter;
    const text = [suite.name, suite.description, scheduleConfigLabel(suite.scheduleConfig)].filter(Boolean).join(' ').toLowerCase();
    return statusMatches && (!normalizedSearch || text.includes(normalizedSearch));
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
  const executeDisabledReason = !selectedSuite
    ? '请先选择一个测试套件'
    : selectedSuite.status === 'disabled'
      ? '停用套件不能执行'
      : !selectedSuiteCaseCount
        ? '空套件不能执行，请先添加测试用例'
        : '';
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
    if (!suiteEditing) return;
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
    if (!suiteEditing) return;
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
  const startListResize = (event) => {
    if (listCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = listPanelWidth;
    const handleMove = (moveEvent) => {
      const nextWidth = Math.min(560, Math.max(260, startWidth + moveEvent.clientX - startX));
      setListPanelWidth(nextWidth);
    };
    const stopResize = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopResize);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopResize);
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

  return (
    <section className="module-section" aria-label="测试套件">
      <div className="section-header">
        <div>
          <h2>测试套件</h2>
          <p>维护可复用的测试用例集合，先沉淀运行模式与定时配置，执行监控后续统一接入。</p>
        </div>
        <div className="action-row">
          <button
            type="button"
            className="ghost-button"
            disabled={Boolean(executeDisabledReason)}
            title={executeDisabledReason || '启动套件执行并进入执行监控'}
            onClick={() => selectedSuite && runSuite(selectedSuite.id)}
          >
            <Play size={17} />
            执行
          </button>
          <button type="button" className="primary-action" onClick={beginCreateSuite}>
            <Plus size={17} />
            新建套件
          </button>
        </div>
      </div>
      <div
        className={listCollapsed ? 'suite-workspace suite-list-collapsed' : 'suite-workspace'}
        style={{ '--suite-list-width': `${listPanelWidth}px` }}
      >
        <aside className="data-panel suite-list-panel">
          <div className="panel-heading compact">
            <h3>套件列表</h3>
            <div className="suite-list-actions">
              <span className="muted">{visibleSuites.length}/{managedSuites.length}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="收起套件列表"
                title="收起套件列表"
                onClick={() => setListCollapsed(true)}
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
          </div>
          <div className="suite-filter-row">
            <label className="search-field">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、描述、计划" />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
          </div>
          <div className="suite-list">
            {visibleSuites.length ? visibleSuites.map((suite) => {
              const stats = suiteCaseStats(suite, testCases);
              return (
                <button
                  type="button"
                  className={suite.id === selectedSuiteId ? 'suite-list-item active-record' : 'suite-list-item'}
                  key={suite.id}
                  onClick={() => selectSuite(suite.id)}
                >
                  <span>
                    <strong>{suite.name}</strong>
                    <small>{suite.description || '暂无描述'}</small>
                  </span>
                  <em>{suite.status === 'disabled' ? '停用' : '启用'} · {stats.total} 条</em>
                </button>
              );
            }) : <p className="muted">暂无测试套件。可以从右侧新建，或在用例管理中保存已选用例。</p>}
          </div>
        </aside>
        <div className="suite-list-rail">
          <button
            type="button"
            className="icon-button"
            aria-label="展开套件列表"
            title="展开套件列表"
            onClick={() => setListCollapsed(false)}
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
        <button
          type="button"
          className="suite-resize-handle"
          aria-label="调整套件列表宽度"
          title="拖拽调整套件列表宽度"
          onPointerDown={startListResize}
        />
        <div className="suite-detail-panel">
          <div className="data-panel">
            <div className="panel-heading compact">
              <h3>{selectedSuite ? selectedSuite.name : suiteEditing ? '新建测试套件' : '套件详情'}</h3>
              <div className="action-row">
                {selectedSuite && !suiteEditing ? (
                  <>
                    <button type="button" className="ghost-button" onClick={() => setSuiteEditing(true)}>
                      <Edit3 size={15} />
                      编辑
                    </button>
                    <button type="button" className="ghost-button danger-button" onClick={() => deleteSuite(selectedSuite.id)}>
                      <Trash2 size={15} />
                      删除
                    </button>
                  </>
                ) : null}
                {suiteEditing ? (
                  <button type="button" className="primary-action" onClick={saveSuite}>
                    <Save size={16} />
                    保存套件
                  </button>
                ) : null}
              </div>
            </div>
            {!selectedSuite && !suiteEditing ? (
              <div className="empty-suite-state">
                <ListChecks size={34} />
                <span>选择一个套件查看配置，或新建套件沉淀回归/冒烟/上线验证集合。</span>
              </div>
            ) : (
              <>
                <div className="suite-form-grid">
                  <label className="field">
                    <span>套件名称</span>
                    <input value={suiteForm.name} disabled={!suiteEditing} onChange={(event) => setSuiteForm((form) => ({ ...form, name: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>状态</span>
                    <select value={suiteForm.status} disabled={!suiteEditing} onChange={(event) => setSuiteForm((form) => ({ ...form, status: event.target.value }))}>
                      <option value="active">启用</option>
                      <option value="disabled">停用</option>
                    </select>
                  </label>
                  <label className="field wide">
                    <span>描述</span>
                    <textarea value={suiteForm.description} disabled={!suiteEditing} onChange={(event) => setSuiteForm((form) => ({ ...form, description: event.target.value }))} rows={3} />
                  </label>
                </div>
                <div className="suite-metric-grid">
                  <div><span>用例数</span><strong>{formStats.total}</strong></div>
                  <div><span>自动化覆盖</span><strong>{formStats.automated}</strong></div>
                  <div><span>P0/P1/P2</span><strong>{formStats.priorities.P0}/{formStats.priorities.P1}/{formStats.priorities.P2}</strong></div>
                  <div><span>定时配置</span><strong>{scheduleConfigLabel(suiteForm.scheduleConfig)}</strong></div>
                </div>
              </>
            )}
          </div>
          {(selectedSuite || suiteEditing) && (
            <>
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
                    <select value={suiteForm.runConfig.failurePolicy} disabled={!suiteEditing} onChange={(event) => updateRunConfig({ failurePolicy: event.target.value })}>
                      <option value="continue">失败继续</option>
                      <option value="stop">失败即停</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>重试次数</span>
                    <input type="number" min="0" max="3" value={suiteForm.runConfig.retryCount} disabled={!suiteEditing} onChange={(event) => updateRunConfig({ retryCount: event.target.value })} />
                  </label>
                  <label className="toggle-field">
                    <input type="checkbox" checked={Boolean(suiteForm.runConfig.runFailedOnly)} disabled={!suiteEditing} onChange={(event) => updateRunConfig({ runFailedOnly: event.target.checked })} />
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
                    <select value={suiteForm.scheduleConfig.frequency} disabled={!suiteEditing} onChange={(event) => updateScheduleConfig({ frequency: event.target.value })}>
                      <option value="off">关闭</option>
                      <option value="daily">每天</option>
                      <option value="weekly">每周</option>
                      <option value="interval">固定间隔</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>计划时间</span>
                    <input type="time" value={suiteForm.scheduleConfig.time} disabled={!suiteEditing || suiteForm.scheduleConfig.frequency === 'off' || suiteForm.scheduleConfig.frequency === 'interval'} onChange={(event) => updateScheduleConfig({ time: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>星期</span>
                    <select value={suiteForm.scheduleConfig.weekday} disabled={!suiteEditing || suiteForm.scheduleConfig.frequency !== 'weekly'} onChange={(event) => updateScheduleConfig({ weekday: event.target.value })}>
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
                    <input type="number" min="5" max="10080" value={suiteForm.scheduleConfig.intervalMinutes} disabled={!suiteEditing || suiteForm.scheduleConfig.frequency !== 'interval'} onChange={(event) => updateScheduleConfig({ intervalMinutes: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>时区</span>
                    <input value={suiteForm.scheduleConfig.timezone} disabled={!suiteEditing} onChange={(event) => updateScheduleConfig({ timezone: event.target.value })} />
                  </label>
                  <label className="field wide">
                    <span>备注</span>
                    <input value={suiteForm.scheduleConfig.note} disabled={!suiteEditing} onChange={(event) => updateScheduleConfig({ note: event.target.value })} placeholder="例如：每日冒烟，后续接执行监控通知" />
                  </label>
                </div>
                <div className="suite-schedule-note">
                  <CalendarClock size={16} />
                  <span>{scheduleConfigLabel(suiteForm.scheduleConfig)} · 待接入执行监控/调度</span>
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
                      <button type="button" className="ghost-button" disabled={!suiteEditing || !canBulkSelectFiltered} title={canBulkSelectFiltered ? '全选当前筛选结果' : '请先选择一个项目或功能后再批量选择'} onClick={() => setFilteredCasesSelected(true)}>
                        <CheckSquare size={15} />
                        全选筛选结果
                      </button>
                      <button type="button" className="ghost-button" disabled={!suiteEditing} onClick={() => setFilteredCasesSelected(false)}>取消筛选选择</button>
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
                              <input type="checkbox" checked={selectedIds.has(item.id)} disabled={!suiteEditing || crossProjectDisabled} onChange={(event) => toggleSuiteCase(item, event.target.checked)} />
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
                          <button type="button" className="ghost-button" disabled={currentCasePage <= 1} onClick={() => setCasePage((page) => Math.max(1, page - 1))}>上一页</button>
                          <span>第 {currentCasePage} 页 / 共 {caseTotalPages} 页</span>
                          <button type="button" className="ghost-button" disabled={currentCasePage >= caseTotalPages} onClick={() => setCasePage((page) => Math.min(caseTotalPages, page + 1))}>下一页</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          )}
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
    <section className="module-section" aria-label="功能菜单配置">
      <div className="section-header">
        <div>
          <h2>功能菜单配置</h2>
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
              <span>{!currentProjectId ? '暂无项目。请先在项目管理中创建项目。' : features.length ? '没有匹配的功能。' : '暂无功能菜单配置。先新增根功能，再继续添加不限层级的子功能。'}</span>
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
  testCases,
  features,
  selectedCaseIds,
  toggleCaseSelection,
  setAllVisibleCasesSelected,
  runSelectedCases,
  createSuiteFromSelection,
  newSuiteName,
  setNewSuiteName,
  setActiveModule,
  bindCaseFeature,
  deleteCase,
  deleteSelectedCases,
  scriptEditor,
  openScriptEditor,
  closeScriptEditor,
  updateScriptEditorContent,
  saveScriptEditorDraft,
  canManageAssets = true,
  canExecute = true,
  canEditScripts = true,
}) {
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [featureFilter, setFeatureFilter] = useState('all');
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase();
  const filteredCases = testCases.filter((item) => {
    const priorityMatches = priorityFilter === 'all' || item.priority === priorityFilter;
    const statusMatches = statusFilter === 'all' || item.automationStatus === statusFilter || item.latestStatus === statusFilter;
    const featureMatches = featureFilter === 'all' || (featureFilter === 'unbound' ? !item.featureId : item.featureId === featureFilter);
    const searchMatches = !normalizedSearch || [item.externalId, item.title, item.requirement, item.steps, item.expected].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch);
    return priorityMatches && statusMatches && featureMatches && searchMatches;
  });
  const selectedCount = selectedCaseIds.size;

  return (
    <section className="module-section" aria-label="用例管理">
      <div className="section-header">
        <div>
          <h2>用例管理</h2>
          <p>结构化管理从 Markdown 解析出的测试用例，并按项目批量加入套件或执行。</p>
        </div>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={() => setActiveModule('cases')}>
            <FileCheck2 size={17} />
            设计用例
          </button>
          <button type="button" className="primary-action" disabled={!selectedCount || !canExecute} onClick={() => runSelectedCases()}>
            <Play size={17} />
            执行已选 {selectedCount}
          </button>
        </div>
      </div>
      <div className="list-tools case-tools">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索用例 ID、标题、步骤、期望结果" />
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
          {features.map((feature) => <option value={feature.id} key={feature.id}>{feature.path}</option>)}
        </select>
        <button type="button" className="ghost-button" onClick={() => setAllVisibleCasesSelected(filteredCases, true)}>
          <CheckSquare size={16} />
          全选筛选结果
        </button>
        <button type="button" className="ghost-button" onClick={() => setAllVisibleCasesSelected(filteredCases, false)}>取消筛选选择</button>
        <button type="button" className="ghost-button danger-button" disabled={!selectedCount || !canManageAssets} onClick={deleteSelectedCases}>
          <Trash2 size={16} />
          删除已选 {selectedCount}
        </button>
      </div>
      <div className="suite-create-row">
        <input value={newSuiteName} onChange={(event) => setNewSuiteName(event.target.value)} placeholder="套件名称" />
        <button type="button" className="ghost-button" disabled={!selectedCount || !canManageAssets} onClick={createSuiteFromSelection}>
          <Save size={16} />
          保存为套件
        </button>
      </div>
      <div className="case-table" data-testid="case-management-table">
        <div className="case-row case-row-head">
          <span>选择</span>
          <span>用例</span>
          <span>优先级</span>
          <span>功能</span>
          <span>自动化</span>
          <span>最近结果</span>
          <span>绑定脚本</span>
          <span>操作</span>
        </div>
        {filteredCases.length ? filteredCases.map((item) => (
          <div className="case-row" key={item.id}>
            <label className="check-cell">
              <input type="checkbox" checked={selectedCaseIds.has(item.id)} onChange={(event) => toggleCaseSelection(item.id, event.target.checked)} />
              选择
            </label>
            <div>
              <strong>{item.externalId} · {item.title}</strong>
              <small>{item.requirement || item.steps || '暂无需求描述'}</small>
            </div>
            <span>{item.priority || '-'}</span>
            <select className="case-feature-select" value={item.featureId || ''} disabled={!canManageAssets} onChange={(event) => bindCaseFeature(item.id, event.target.value)} aria-label={`${item.externalId} 绑定功能`}>
              <option value="">未绑定</option>
              {activeFeatureOptions(features, item.featureId).map((feature) => (
                <option value={feature.id} key={feature.id}>{feature.path}{feature.isActive ? '' : '（停用）'}</option>
              ))}
            </select>
            <span>{statusLabel(item.automationStatus || 'manual')}</span>
            <span>{item.latestStatus ? statusLabel(item.latestStatus) : '暂无'}</span>
            <span className="case-script-cell">
              {item.scriptVersionId ? (
                <button type="button" className="script-link-button" onClick={() => openScriptEditor(item)} title="打开脚本编辑弹窗">
                  <FileCode2 size={15} />
                  <span>{item.specPath || '查看脚本'}</span>
                  <small>v{item.scriptVersion || '-'} · {statusLabel(item.scriptStatus || 'active')}</small>
                </button>
              ) : (
                <span className="muted">未绑定</span>
              )}
            </span>
            <button type="button" className="ghost-button danger-button case-delete-button" disabled={!canManageAssets} onClick={() => deleteCase(item)} aria-label={`删除用例 ${item.externalId || item.title || item.id}`} title="删除用例">
              <Trash2 size={16} />
            </button>
          </div>
        )) : <p className="muted">暂无结构化用例。先在用例设计中保存 Markdown 用例，系统会自动解析入库。</p>}
      </div>
      {scriptEditor?.open && (
        <ScriptEditorModal
          editor={scriptEditor}
          canEdit={canEditScripts}
          onClose={closeScriptEditor}
          onChange={updateScriptEditorContent}
          onSaveDraft={saveScriptEditorDraft}
        />
      )}
    </section>
  );
}

function ScriptEditorModal({ editor, canEdit, onClose, onChange, onSaveDraft }) {
  const detail = editor.detail || {};
  const sourceCase = editor.sourceCase || {};
  const boundCases = detail.boundCases || [];
  const title = sourceCase.externalId ? `${sourceCase.externalId} · ${sourceCase.title || '绑定脚本'}` : '绑定脚本';
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
  clearFlow,
  logRef,
  resetKey,
  canRunFlow = true,
}) {
  const [technicalLogsOpen, setTechnicalLogsOpen] = useState(false);
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
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const activeIndex = activeStage ? AUTOMATION_FLOW_STAGES.indexOf(activeStage) : -1;
  const isTerminalFailure = ['blocked', 'failed'].includes(status);
  const visibleArtifacts = orderFlowArtifacts(flowArtifacts, activeStage);
  const hasRunningArtifact = flowArtifacts.some((artifact) => artifact.status === 'streaming');
  const stageBrief = buildStageBrief(activeStage, status, flowArtifacts, logs, flow);
  const conversationMessages = buildFlowConversationMessages({ requirement, flow, logs, artifacts: flowArtifacts, activeStage, status });
  const stageSummaries = buildStageSummaries(AUTOMATION_FLOW_STAGES, flowArtifacts, logs, activeStage, status, flow);
  const clarificationItems = buildClarificationItems({ flow, logs, activeStage, status });
  const issueLogs = logs.filter((log) => ['error', 'blocked', 'warning'].includes(log.level));
  const severeLogs = logs.filter((log) => ['error', 'blocked'].includes(log.level));
  const latestTechnicalLog = logs[logs.length - 1];
  const shouldShowTechnicalLogs = technicalLogsOpen;
  const selectedArtifact = flowArtifacts.find((artifact) => artifact.id === selectedArtifactId) || visibleArtifacts[0] || null;
  const progress = flow?.progress ?? (status === 'completed' ? 100 : 0);
  const progressLabel = Math.max(0, Math.min(100, progress));
  const currentStage = activeStage || flow?.stage || '等待开始';
  const shouldShowBrowserPanel = Boolean(browserSessionId || ['页面探索', '运行验证'].includes(currentStage) || ['running', 'healing'].includes(status));
  const browserIsExecution = browserMode === 'execution';
  const browserTitle = browserIsExecution ? '运行验证实时浏览器' : '页面探索实时浏览器';
  const browserStageLabel = browserStatusDetail || currentStage;
  const browserControlsDisabled = browserIsExecution || !browserLiveConnected;
  const browserFullscreenDisabled = !browserIsExecution || !browserSessionId;
  const flatFeatureTree = useMemo(() => flattenFeatureTree(featureTree), [featureTree]);
  const selectableFeatures = activeFeatureOptions(flatFeatureTree.length ? flatFeatureTree : featureOptions, selectedFeatureId);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const selectedFeature = selectableFeatures.find((feature) => feature.id === selectedFeatureId) || null;
  const hasProject = Boolean(selectedProjectId);
  const hasFeature = Boolean(selectedFeatureId);
  const isBusy = ['running', 'queued', 'healing'].includes(status);
  const canStart = canRunFlow && !isBusy && hasProject && hasFeature;
  const startHint = !canRunFlow ? '当前账号无权启动全流程' : !hasProject ? '请选择项目名称' : !hasFeature ? '请选择功能' : '';
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
    setSelectedArtifactId('');
    setArtifactTab('preview');
    setArtifactListTab('directory');
    setClarificationOpen(false);
    setArtifactOpen(false);
    setHistoryOpen(false);
  }, [resetKey]);

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
    <section className="module-section automation-flow-page" aria-label="自动化测试全流程" data-testid="automation-flow-page">
      <div className="section-header automation-flow-header">
        <div>
          <h2>自动化测试全流程</h2>
          <p>输入需求后由后端真实创建工单、探索页面、生成脚本、运行 Playwright、自愈失败并保存报告证据。</p>
        </div>
        <span className={`automation-run-status ${status}`}>{statusLabel(status)}</span>
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
              开始全流程
            </button>
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
          </section>
        </div>
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
            <span className={browserLiveConnected ? 'preview-status running' : 'preview-status'}>{browserStageLabel} · {browserStatus}</span>
          </div>
          <div className="exploration-runtime automation-browser-runtime" data-testid="automation-flow-browser-runtime">
            <div>
              <span>浏览器会话</span>
              <strong>{browserSessionId || '-'}</strong>
            </div>
            <div>
              <span>实时连接</span>
              <strong>{browserLiveConnected ? 'Live WebSocket' : '未连接'} · {browserStatus}</strong>
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
              </div>
            </div>
            <canvas
              ref={browserCanvasRef}
              className="browser-live-canvas automation-flow-live-canvas"
              data-testid="automation-flow-browser-live-canvas"
              tabIndex={0}
              aria-label="自动化测试全流程实时浏览器画布"
              onClick={handleBrowserClick}
              onMouseMove={handleBrowserMove}
              onWheel={handleBrowserWheel}
              onKeyDown={handleBrowserKeyDown}
            />
            {(!browserLiveConnected || !browserHasFrame) && (
              <div className="preview-placeholder live-overlay">
                <MonitorPlay size={38} />
                <span>{browserSessionId ? '正在连接实时浏览器画面。' : '进入页面探索或运行验证后连接实时浏览器。'}</span>
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

      <section className={`technical-log-panel ${shouldShowTechnicalLogs ? 'open' : ''}`} aria-label="技术明细" data-testid="automation-flow-logs" ref={logRef}>
        <button type="button" className="technical-log-summary" onClick={() => setTechnicalLogsOpen((value) => !value)} aria-expanded={shouldShowTechnicalLogs}>
          <div>
            <span>技术明细（实时日志）</span>
            <strong>{severeLogs.length} 个错误 / {issueLogs.length - severeLogs.length} 个警告</strong>
          </div>
          <small>{latestTechnicalLog ? `${latestTechnicalLog.stage}：${latestTechnicalLog.message}` : '暂无底层执行日志'}</small>
          <ChevronDown size={16} className={shouldShowTechnicalLogs ? 'open' : ''} />
        </button>
        <div className={`automation-log-stream ${shouldShowTechnicalLogs ? 'expanded' : 'collapsed'}`} aria-hidden={!shouldShowTechnicalLogs}>
          {logs.length ? logs.map((log) => (
            <p key={log.id} className={`automation-log-line ${log.level}`}>
              <span>[{formatDetailedLogTime(log.createdAt)}]</span>{' '}
              <strong>[{log.stage}]</strong>{' '}
              <em>[{log.level}]</em>{' '}
              {log.message}
              {log.evidencePath ? <small> 证据：{log.evidencePath}</small> : null}
            </p>
          )) : <p className="automation-log-line muted">等待流程开始。</p>}
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
              <span className={`automation-run-status ${item.status}`}>{statusLabel(item.status)}</span>
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
  return (
    <button type="button" className={`flow-artifact-attachment ${artifact.status}`} onClick={onSelect}>
      <div>
        <span>{artifact.stage} · {artifactTypeLabel(artifact.artifactType)}</span>
        <strong>{artifact.title}</strong>
        <small>{summarizeArtifactContent(artifact)}</small>
      </div>
      <em>{isStreaming ? '生成中' : '审阅'}</em>
    </button>
  );
}

function ArtifactTreeItem({ artifact, active, onSelect, showTime = false }) {
  const Icon = artifactIcon(artifact.artifactType);
  return (
    <button type="button" className={`artifact-tree-item ${artifact.status} ${active ? 'active' : ''}`} onClick={onSelect}>
      <Icon size={15} />
      <div>
        <strong>{artifact.title}</strong>
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
        <div><span>来源</span><strong>{artifact.source || '-'}</strong></div>
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
    const rows = parseMarkdownTableRows(content).slice(0, 4);
    return (
      <div className="rendered-cases">
        <h4>测试用例预览</h4>
        {rows.length ? (
          <div className="rendered-case-table">
            {rows.map((row, index) => (
              <div className="rendered-case-row" key={`${row.id}-${index}`}>
                <strong>{row.id || `TC-${index + 1}`}</strong>
                <span>{row.priority || '-'}</span>
                <p>{row.title || row.summary || firstReadableLine(content)}</p>
              </div>
            ))}
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
    'test-cases': FileCheck2,
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
      tone: ['failed', 'blocked'].includes(status) ? 'danger' : status === 'completed' ? 'success' : 'live',
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
  logs
    .filter((log) => ['success', 'warning', 'error', 'blocked'].includes(log.level))
    .slice(-5)
    .forEach((log) => {
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
    return {
      kicker: '交付就绪',
      title: '全流程已完成',
      description: '测试用例、自动化脚本、执行证据和最终报告已生成，可进入交付报告审阅。',
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
    tone: artifact.status === 'failed' ? 'danger' : artifact.status === 'streaming' ? 'live' : artifact.status === 'fallback' ? 'warning' : 'success',
    title: artifact.status === 'streaming'
      ? `正在生成${artifactTypeLabel(artifact.artifactType)}`
      : `${artifactTypeLabel(artifact.artifactType)}${artifactStatusLabel(artifact.status)}`,
    message: summarizeArtifactContent(artifact),
  }));
  const importantLogUpdates = logs
    .filter((log) => ['success', 'warning', 'error', 'blocked'].includes(log.level))
    .slice(-4)
    .map((log) => ({
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
  return stages.map((stage) => {
    const stageIndex = stages.indexOf(stage);
    const stageArtifacts = artifacts.filter((artifact) => artifact.stage === stage);
    const stageLogs = logs.filter((log) => log.stage === stage);
    const failed = stageLogs.some((log) => ['error', 'blocked'].includes(log.level)) || stageArtifacts.some((artifact) => artifact.status === 'failed');
    const streaming = stageArtifacts.some((artifact) => artifact.status === 'streaming') || (stage === activeStage && ['running', 'queued', 'healing'].includes(status));
    const hasStageEvidence = stageArtifacts.length > 0 || stageLogs.length > 0;
    const completedByEvidence = stageArtifacts.some((artifact) => ['ready', 'verified', 'saved', 'fallback'].includes(artifact.status)) || stageLogs.some((log) => log.level === 'success');
    const progressedPastStage = currentIndex > stageIndex || (status === 'completed' && finalIndex > stageIndex);
    const skipped = stage === healingStage && status === 'completed' && !hasStageEvidence;
    const completed = !skipped && (completedByEvidence || (progressedPastStage && (hasStageEvidence || stage !== healingStage)));
    const state = failed ? 'failed' : streaming ? 'running' : skipped ? 'skipped' : completed ? 'done' : 'idle';
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
    return [{
      id: 'clarification-completed',
      stage: '保存已验证产物',
      tone: 'ok',
      title: '全流程澄清已关闭',
      message: '需求、用例、脚本、执行证据和报告均已完成，可进入交付报告审阅。',
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
  if (stage === '保存已验证产物') return '已保存最终交付报告和证据路径。';
  return '阶段产物已生成，可审阅。';
}

function stageFriendlyDescription(stage) {
  return {
    需求分析: '正在把原始需求整理成目标、角色、测试数据、验收标准和排除项。',
    项目预检: '正在确认项目路径、Playwright 配置、用例目录和脚本约定。',
    用例设计: '正在基于需求生成可追溯测试用例，并覆盖主流程与关键异常路径。',
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

function parseMarkdownTableRows(content) {
  const lines = content.split('\n').filter((line) => line.trim().startsWith('|') && !line.includes('---'));
  if (lines.length < 2) return [];
  const header = lines[0].split('|').map((cell) => cell.trim()).filter(Boolean);
  return lines.slice(1).map((line) => {
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    const row = Object.fromEntries(header.map((name, index) => [name, cells[index] || '']));
    return {
      id: row.ID || row['用例 ID'] || row['用例ID'] || cells[0],
      priority: row['优先级'] || cells[1],
      title: row['标题'] || row['用例标题'] || cells[2],
      summary: cells.find((cell) => cell && cell.length > 8),
    };
  });
}

function artifactTypeLabel(type) {
  return {
    'requirement-analysis': '需求抽取',
    'test-cases': '测试用例',
    'exploration-plan': '探索计划',
    'exploration-result': '探索结果',
    'confirmed-elements': '确认元素',
    'playwright-script': '自动化脚本',
    'execution-summary': '执行摘要',
    'healing-summary': '自愈诊断',
    'healed-script': '修复脚本',
    'final-report': '交付报告',
  }[type] || type;
}

function artifactStatusLabel(status) {
  return {
    streaming: '生成中',
    ready: '可审阅',
    fallback: '规则兜底',
    failed: '失败',
    saved: '已保存',
    verified: '已验证',
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
  const canAnalyze = canCreate && !analyzing && hasProject && hasFeature && form.requirement.trim();
  const analyzeHint = !canCreate ? '当前账号无权创建需求工单' : !hasProject ? '请选择项目名称' : !hasFeature ? '请选择功能' : '';
  return (
    <section className="module-section" aria-label="需求工单">
      <div className="section-header">
        <div>
          <h2>需求工单</h2>
          <p>先输入完整需求，点击需求分析后自动提取目标、用户路径、验收标准、角色、测试数据、环境和排除项。</p>
        </div>
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
          <button type="button" className="primary-action" disabled={!canAnalyze} onClick={createWorkItem} title={analyzeHint}>
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

function Exploration({ item, exploration, explorationRun, explorationLogs, browserStatus, browserStatusDetail, liveConnected, browserCanvasRef, setExploration, updateElement, addElement, setAllElementsConfirmed, saveExploration, runExploration, exploring, sendBrowserCommand, handleBrowserClick, handleBrowserMove, handleBrowserWheel, handleBrowserKeyDown, canEdit = true }) {
  const hasCases = Boolean(item?.casesMarkdown);
  const stageLabel = browserStatusDetail || explorationRun?.stage?.label || (exploring ? '准备探索环境' : '等待探索');
  const progress = explorationRun?.progress || 0;
  const runStatus = explorationRun ? statusLabel(explorationRun.status) : '未启动';
  const planItems = explorationRun?.plan || [];
  const stepItems = explorationRun?.steps || [];
  const explorationBrowserShellRef = useRef(null);
  const [explorationBrowserFullscreen, setExplorationBrowserFullscreen] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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

  return (
    <section className="module-section" aria-label="探索实验室">
      <div className="section-header">
        <div>
          <h2>探索与元素确认</h2>
          <p>根据已保存测试用例执行页面探索，确认真实 DOM、可访问名称和稳定 selector。</p>
        </div>
        <div className="action-row">
          <button type="button" className="ghost-button" disabled={!item || !hasCases || exploring || !canEdit} onClick={runExploration}>
            <FlaskConical size={17} />
            {exploring ? '探索中' : '执行探索'}
          </button>
          <button type="button" className="primary-action" disabled={!item || !hasCases || !canEdit} onClick={saveExploration}>
            <Save size={17} />
            保存探索
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
          <span className={exploring ? 'preview-status running' : 'preview-status'}>{stageLabel} · {runStatus}</span>
        </div>
        <div className="exploration-runtime" data-testid="exploration-runtime">
          <div>
            <span>当前阶段</span>
            <strong>{stageLabel}</strong>
          </div>
          <div>
            <span>实时会话</span>
            <strong>{liveConnected ? 'Live WebSocket' : '未连接'} · {browserStatus}</strong>
          </div>
          <div>
            <span>探索进度</span>
            <strong>{progress}%</strong>
          </div>
        </div>
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
                onClick={toggleExplorationBrowserFullscreen}
              >
                <Maximize2 size={15} />
                {explorationBrowserFullscreen ? '退出全屏' : '全屏展示'}
              </button>
              <button type="button" className="ghost-button" onClick={() => sendBrowserCommand({ type: 'control', action: 'pause' })}>暂停</button>
              <button type="button" className="ghost-button" onClick={() => sendBrowserCommand({ type: 'control', action: 'takeover' })}>人工接管</button>
              <button type="button" className="ghost-button" onClick={() => sendBrowserCommand({ type: 'control', action: 'resume' })}>继续</button>
            </div>
          </div>
          <canvas
            ref={browserCanvasRef}
            className="browser-live-canvas automation-flow-live-canvas"
            data-testid="browser-live-canvas"
            tabIndex={0}
            aria-label="实时浏览器控制画布"
            onClick={handleBrowserClick}
            onMouseMove={handleBrowserMove}
            onWheel={handleBrowserWheel}
            onKeyDown={handleBrowserKeyDown}
          />
          {!liveConnected && (
            <div className="preview-placeholder live-overlay">
              <MonitorPlay size={38} />
              <span>点击执行探索后连接实时浏览器</span>
            </div>
          )}
        </div>
        <div className="exploration-plan-grid">
          <div className="data-panel">
            <div className="panel-heading compact">
              <h3>探索计划</h3>
              <span className="muted">{filteredPlanItems.length}/{planItems.length}</span>
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
                  <span>{step.description}</span>
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
        <p className="muted">候选元素默认未确认，请勾选真正稳定、可用于最终脚本的 selector。</p>
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
              </select>
              <input value={element.locatorValue} onChange={(event) => updateElement(index, 'locatorValue', event.target.value)} placeholder="locator 值" />
              <input value={element.source} onChange={(event) => updateElement(index, 'source', event.target.value)} placeholder="来源说明" />
              <label className="check-cell">
                <input data-testid="candidate-confirm-checkbox" type="checkbox" checked={element.confirmed} onChange={(event) => updateElement(index, 'confirmed', event.target.checked)} />
                确认
              </label>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cases({ item, casesMarkdown, setCasesMarkdown, generateCases, assetMode, setAssetMode, canEdit = true }) {
  const analysis = item?.requirementAnalysis;
  const project = item?.projectContext;
  const boundCaseCount = item?.caseIds?.length || item?.testCases?.length || 0;
  return (
    <section className="module-section" aria-label="用例设计">
      <div className="section-header">
        <div>
          <h2>可追溯测试用例</h2>
          <p>实现脚本前先保存测试用例；字段必须覆盖 ID、标题、优先级、覆盖需求、前置条件/测试数据、步骤、期望结果和自动化说明。</p>
        </div>
        <button type="button" className="primary-action" disabled={!item || !canEdit} onClick={generateCases}>
          <Brain size={17} />
          生成/保存用例
        </button>
      </div>
      {item && (
        <div className="data-panel" data-testid="case-design-context">
          <h3>用例设计上下文</h3>
          <p className="muted">需求：{analysis?.goal}</p>
          <p className="muted">验收：{analysis?.acceptance}</p>
          <p className="muted">项目约定：{project?.testDir} / {project?.specPattern}；{project?.locatorStyle}</p>
          <div className="asset-mode-row">
            <label className="field compact-field">
              <span>资产模式</span>
              <select value={assetMode} disabled={!canEdit} onChange={(event) => setAssetMode(event.target.value)}>
                <option value="create">新建用例和脚本</option>
                <option value="refresh" disabled={!boundCaseCount}>刷新替换已有用例</option>
                <option value="append">追加/整改覆盖点</option>
              </select>
            </label>
            <span className="source-chip">{assetModeLabel(assetMode)} · 已绑定 {boundCaseCount} 条用例</span>
          </div>
        </div>
      )}
      <textarea className="editor markdown" value={casesMarkdown} disabled={!canEdit} onChange={(event) => setCasesMarkdown(event.target.value)} placeholder="在这里粘贴或编辑测试用例 markdown 表格。" />
    </section>
  );
}

function Scripts({ item, latestRun, scriptContent, setScriptContent, generateScript, saveArtifacts, assetMode, canEdit = true, canSaveArtifacts: canPublishArtifacts = true }) {
  const runMatchesItem = latestRun?.workItemId === item?.id;
  const hasVerifiedRun = Boolean(item?.latestRunId && (!runMatchesItem || latestRun.status !== 'running'));
  const canSaveArtifacts = canPublishArtifacts && Boolean(item?.scriptContent && hasVerifiedRun && latestRun?.status === 'passed');
  return (
    <section className="module-section" aria-label="脚本工作台">
      <div className="section-header">
        <div>
          <h2>Playwright 脚本工作台</h2>
          <p>基于已保存测试用例和已确认元素生成草稿 spec；每个关键 locator 必须来自确认过的页面信息。</p>
        </div>
        <div className="action-row">
          <button type="button" className="ghost-button" disabled={!item || !canEdit} onClick={generateScript}>
            <Code2 size={17} />
            生成/保存草稿脚本
          </button>
          <button type="button" className="primary-action" disabled={!canSaveArtifacts} onClick={saveArtifacts}>
            <Save size={17} />
            保存已验证产物
          </button>
        </div>
      </div>
      <div className="data-panel compact-script-panel">
        <div className="delivery-row"><span>资产模式</span><strong>{assetModeLabel(assetMode)}</strong></div>
        <div className="delivery-row"><span>当前验证</span><strong>{latestRun ? statusLabel(latestRun.status) : '未运行'}</strong></div>
        <div className="delivery-row"><span>发布规则</span><strong>验证通过后保存才替换 active 绑定</strong></div>
      </div>
      <textarea className="editor code" value={scriptContent} disabled={!canEdit} onChange={(event) => setScriptContent(event.target.value)} placeholder="在这里粘贴或编辑 Playwright TypeScript 草稿 spec。" />
    </section>
  );
}

function Execution({ latestRun, logs, screenshot, runCurrentItem, currentItem, browserStatus, browserStatusDetail, liveConnected, browserCanvasRef, sendBrowserCommand, handleBrowserClick, handleBrowserMove, handleBrowserWheel, handleBrowserKeyDown, canExecute = true }) {
  const progress = latestRun?.progress || 0;
  const stageLabel = browserStatusDetail || latestRun?.stage?.label || '等待执行';
  const runStatus = latestRun ? statusLabel(latestRun.status) : '未启动';
  const executionBrowserShellRef = useRef(null);
  const [executionBrowserFullscreen, setExecutionBrowserFullscreen] = useState(false);
  const toggleExecutionBrowserFullscreen = async () => {
    const shell = executionBrowserShellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
      } else {
        await shell.requestFullscreen();
      }
    } catch (err) {
      console.warn('切换执行测试实时浏览器全屏失败', err);
    }
  };

  useEffect(() => {
    const updateFullscreenState = () => {
      setExecutionBrowserFullscreen(document.fullscreenElement === executionBrowserShellRef.current);
    };
    document.addEventListener('fullscreenchange', updateFullscreenState);
    updateFullscreenState();
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);

  return (
    <section className="module-section" aria-label="执行测试">
      <div className="section-header">
        <div>
          <h2>执行测试</h2>
          <p>运行草稿 spec，生成 Playwright HTML report；验证后才能保存最终交付物。</p>
        </div>
        <button type="button" className="primary-action" disabled={!currentItem?.scriptContent || latestRun?.status === 'running' || !canExecute} onClick={runCurrentItem}>
          <Play size={17} />
          执行当前任务
        </button>
      </div>
      <div className="exploration-preview-panel execution-preview-panel">
        <div className="panel-heading">
          <div>
            <h3>实时浏览器控制台</h3>
            <p className="muted">通过 WebSocket 接收 CDP Screencast 画面，点击、滚动和键盘输入会回传到浏览器会话。</p>
          </div>
          <span className={latestRun?.status === 'running' ? 'preview-status running' : 'preview-status'}>{stageLabel} · {runStatus}</span>
        </div>
        <div className="exploration-runtime execution-runtime" data-testid="execution-runtime">
          <div>
            <span>当前阶段</span>
            <strong>{stageLabel}</strong>
          </div>
          <div>
            <span>实时会话</span>
            <strong>{liveConnected ? 'Live WebSocket' : '未连接'} · {browserStatus}</strong>
          </div>
          <div>
            <span>执行进度</span>
            <strong>{progress}%</strong>
          </div>
        </div>
        <div className="mini-progress" aria-label="执行进度">
          <span style={{ width: `${Math.max(4, progress)}%` }} />
        </div>
        <div className="live-browser-shell automation-live-browser-shell" ref={executionBrowserShellRef} data-testid="execution-browser-preview">
          <div className="browser-live-toolbar">
            <span>{browserStatus}</span>
            <div className="action-row">
              <button
                type="button"
                className="ghost-button"
                data-testid="execution-browser-fullscreen"
                title={executionBrowserFullscreen ? '退出全屏' : '全屏展示'}
                aria-pressed={executionBrowserFullscreen}
                onClick={toggleExecutionBrowserFullscreen}
              >
                <Maximize2 size={15} />
                {executionBrowserFullscreen ? '退出全屏' : '全屏展示'}
              </button>
              <button type="button" className="ghost-button" onClick={() => sendBrowserCommand({ type: 'control', action: 'pause' })}>暂停</button>
              <button type="button" className="ghost-button" onClick={() => sendBrowserCommand({ type: 'control', action: 'takeover' })}>人工接管</button>
              <button type="button" className="ghost-button" onClick={() => sendBrowserCommand({ type: 'control', action: 'resume' })}>继续</button>
            </div>
          </div>
          <canvas
            ref={browserCanvasRef}
            className="browser-live-canvas automation-flow-live-canvas"
            data-testid="execution-browser-live-canvas"
            tabIndex={0}
            aria-label="执行测试实时浏览器操控画布"
            onClick={handleBrowserClick}
            onMouseMove={handleBrowserMove}
            onWheel={handleBrowserWheel}
            onKeyDown={handleBrowserKeyDown}
          />
          {!liveConnected && (
            <div className="preview-placeholder live-overlay">
              <MonitorPlay size={38} />
              <span>{screenshot ? '等待实时会话连接，保留最近执行截图。' : '点击执行当前任务后连接实时浏览器。'}</span>
            </div>
          )}
        </div>
        <div className="log-box execution-log" data-testid="log-panel">
          {logs.length ? logs.map((log) => (
            <p key={log.id} className={`log ${log.level}`}>
              <span>{formatLogTime(log.createdAt)} #{log.id}</span>
              {log.message}
            </p>
          )) : <p className="log muted">暂无日志。</p>}
        </div>
      </div>
      <a className="report-link" href={playwrightReportUrl()} target="_blank" rel="noreferrer">
        <FileText size={16} />
        Playwright HTML Report
        <ExternalLink size={14} />
      </a>
    </section>
  );
}

function Healing({ item, form, setForm, recordHealing, canEdit = true }) {
  return (
    <section className="module-section" aria-label="自愈诊断">
      <div className="section-header">
        <div>
          <h2>失败诊断与自愈记录</h2>
          <p>最多 3 轮，只记录测试侧修复：selector、等待、断言、测试数据。</p>
        </div>
        <button type="button" className="primary-action" disabled={!item || !canEdit} onClick={recordHealing}>
          <RefreshCw size={17} />
          记录自愈
        </button>
      </div>
      <div className="form-grid">
        <Field label="失败摘要" textarea value={form.failure_summary} onChange={(value) => setForm({ ...form, failure_summary: value })} />
        <Field label="修复方案" textarea value={form.proposed_fix} onChange={(value) => setForm({ ...form, proposed_fix: value })} />
      </div>
      <div className="data-panel">
        <h3>自愈轮次</h3>
        {item?.healingAttempts?.length ? item.healingAttempts.map((attempt) => (
          <div className="record-row static" key={attempt.id}>
            <span>第 {attempt.round} 轮：{attempt.failureSummary}</span>
            <strong>{attempt.result}</strong>
          </div>
        )) : <p className="muted">暂无自愈记录。</p>}
      </div>
    </section>
  );
}

function ExecutionMonitor({
  suiteRuns,
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
  selectedCaseRunId,
  selectCaseRun,
}) {
  const [monitorListCollapsed, setMonitorListCollapsed] = useState(false);
  const [monitorListPanelWidth, setMonitorListPanelWidth] = useState(340);
  const activeRun = selectedRun || suiteRuns.find((item) => item.id === selectedRunId) || suiteRuns[0] || null;
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
          <p>实时查看套件与批量用例执行状态、结果统计、用例明细和聚合日志。</p>
        </div>
        <a className="report-link" href={playwrightReportUrl()} target="_blank" rel="noreferrer">
          <FileText size={16} />
          Playwright HTML Report
          <ExternalLink size={14} />
        </a>
      </div>

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
            {suiteRuns.length ? suiteRuns.map((run) => (
              <button
                type="button"
                className={`monitor-run-item ${activeRun?.id === run.id ? 'active' : ''}`}
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
              >
                <div>
                  <strong>{run.name}</strong>
                  <span>{formatDateTime(run.startedAt)} · {run.progress || 0}%</span>
                </div>
                <em className={run.status}>{statusLabel(run.status)}</em>
                <small>{run.passedCases || 0}/{run.failedCases || 0}/{run.skippedCases || 0}</small>
              </button>
            )) : (
              <div className="empty-suite-state">
                <RadioTower size={24} />
                <strong>暂无执行记录</strong>
                <span>从测试套件或执行测试页启动批量执行后，会在这里看到实时状态。</span>
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
              </div>
              <div className="mini-progress" aria-label="监控执行进度"><span style={{ width: `${Math.max(4, activeRun.progress || 0)}%` }} /></div>

              <section className="monitor-browser-panel" aria-label="执行浏览器画面" data-testid="execution-monitor-browser-preview">
                <div className="panel-heading compact">
                  <div>
                    <h3><MonitorPlay size={16} /> 执行浏览器画面</h3>
                    <p className="muted">只读预览真实 Playwright 执行 page，执行期间不开放人工操作。</p>
                  </div>
                  <span className={monitorBrowserLiveConnected ? 'preview-status running' : 'preview-status'}>{browserStageLabel} · {browserRunStatus}</span>
                </div>
                <div className="exploration-runtime monitor-browser-runtime">
                  <div><span>当前用例</span><strong>{browserCaseLabel}</strong></div>
                  <div><span>单次 Run</span><strong>{monitorBrowserRun?.id || monitorBrowserCase?.runId || '-'}</strong></div>
                  <div><span>浏览器会话</span><strong>{browserSessionId || '-'}</strong></div>
                  <div><span>实时连接</span><strong>{monitorBrowserLiveConnected ? 'Live WebSocket' : '未连接'} · {monitorBrowserStatus}</strong></div>
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
                      <span>{browserPlaceholderText}</span>
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
                    {activeRun.cases?.length ? activeRun.cases.map((item) => (
                      <button
                        type="button"
                        className={`monitor-case-row ${selectedCaseRunId && item.runId === selectedCaseRunId ? 'selected' : ''}`}
                        key={item.id}
                        disabled={!item.runId}
                        onClick={() => selectCaseRun(item.runId)}
                        aria-pressed={Boolean(selectedCaseRunId && item.runId === selectedCaseRunId)}
                      >
                        <div>
                          <strong>{item.case?.externalId || item.caseId} · {item.case?.title || '用例'}</strong>
                          <span>{item.runId ? `Run: ${item.runId}` : '等待分配单用例 run'} · {formatDuration(item.startedAt, item.endedAt)}</span>
                          {item.error && <small>{item.error}</small>}
                        </div>
                        <em className={item.status}>{statusLabel(item.status)}</em>
                      </button>
                    )) : <p className="muted">等待用例执行明细。</p>}
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

const REQUIRED_DELIVERY_TYPES = ['test-cases', 'spec', 'manual-report', 'html-report'];

function Delivery({ item, projects, currentProjectId, deliveryReport, deliveryFilters, setDeliveryFilters, loadDeliveryReport, fetchJson }) {
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [expandedDeliverables, setExpandedDeliverables] = useState({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [density, setDensity] = useState('cards');
  const [contentPreviewOpen, setContentPreviewOpen] = useState({});
  const defaultScopeAppliedRef = useRef(false);
  const rows = deliveryReport.items || [];
  const summary = deliveryReport.summary || { total: deliveryReport.total || 0, ready: 0, missing: 0, failedRisk: 0, missingByType: {} };
  const totalPages = Math.max(1, Math.ceil((deliveryReport.total || 0) / (deliveryReport.pageSize || 50)));
  const hasScopedFilter = Boolean(deliveryFilters.work_item_id || deliveryFilters.project_id || deliveryFilters.case_id || deliveryFilters.q || deliveryFilters.readiness !== 'all' || deliveryFilters.priority !== 'all' || deliveryFilters.automation_status !== 'all' || deliveryFilters.latest_status !== 'all' || deliveryFilters.deliverable_type !== 'all' || deliveryFilters.updated_from || deliveryFilters.updated_to);
  const currentScopeLabel = deliveryFilters.work_item_id
    ? `当前工单：${item?.title || deliveryFilters.work_item_id}`
    : deliveryFilters.project_id
      ? `当前项目：${projects.find((project) => project.id === deliveryFilters.project_id)?.name || deliveryFilters.project_id}`
      : '全局视图';

  useEffect(() => {
    if (defaultScopeAppliedRef.current) return;
    const hasScope = deliveryFilters.work_item_id || deliveryFilters.project_id || deliveryFilters.case_id;
    if (hasScope) return;
    const nextFilters = { ...deliveryFilters };
    if (item?.id) nextFilters.work_item_id = item.id;
    else if (currentProjectId) nextFilters.project_id = currentProjectId;
    if (nextFilters.work_item_id || nextFilters.project_id) {
      defaultScopeAppliedRef.current = true;
      setDeliveryFilters(nextFilters);
      loadDeliveryReport(nextFilters, 1);
    }
  }, [item?.id, currentProjectId]);

  const updateFilter = (key, value) => {
    setDeliveryFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = async (page = 1) => {
    await loadDeliveryReport(deliveryFilters, page);
    setSelectedCaseId('');
  };

  const resetFilters = async () => {
    const nextFilters = emptyDeliveryFilters();
    setDeliveryFilters(nextFilters);
    await loadDeliveryReport(nextFilters, 1);
    setSelectedCaseId('');
  };

  const scopeToCurrentItem = async () => {
    if (!item?.id) return;
    const nextFilters = { ...emptyDeliveryFilters(), work_item_id: item.id };
    setDeliveryFilters(nextFilters);
    await loadDeliveryReport(nextFilters, 1);
    setSelectedCaseId('');
  };

  const scopeToCurrentProject = async () => {
    if (!currentProjectId) return;
    const nextFilters = { ...emptyDeliveryFilters(), project_id: currentProjectId };
    setDeliveryFilters(nextFilters);
    await loadDeliveryReport(nextFilters, 1);
    setSelectedCaseId('');
  };

  const loadDetail = async (row) => {
    const caseId = row.case?.id;
    if (!caseId) return;
    setSelectedCaseId(caseId);
    if (expandedDeliverables[caseId]) return;
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams({ include_content: 'true' });
      if (row.case?.workItemId) params.set('work_item_id', row.case.workItemId);
      else if (row.case?.specPath) params.set('spec_path', row.case.specPath);
      else params.set('case_id', caseId);
      const payload = await fetchJson(`/api/deliverables?${params.toString()}`);
      const scopedPayload = payload.filter((deliverable) => (
        deliverable.caseId === caseId
        || (!deliverable.caseId && row.case?.workItemId && deliverable.workItemId === row.case.workItemId)
        || (!deliverable.caseId && !deliverable.workItemId && row.case?.specPath && (
          deliverable.filePath === row.case.specPath
          || deliverable.filePath === row.case.specPath.replace('.spec.ts', '-test-cases.md')
        ))
      ));
      setExpandedDeliverables((current) => ({ ...current, [caseId]: scopedPayload }));
    } catch (err) {
      setExpandedDeliverables((current) => ({
        ...current,
        [caseId]: [{ id: `${caseId}-error`, type: 'error', name: '预览加载失败', status: 'failed', summary: err.message, content: '' }],
      }));
    } finally {
      setPreviewLoading(false);
    }
  };

  const deliverableHref = (deliverable) => {
    if (!deliverable) return '';
    if (deliverable.type === 'html-report') return playwrightReportUrl();
    if (deliverable.type === 'manual-report') return deliverableReportUrl(deliverable);
    return '';
  };

  const readinessLabel = (value) => ({
    ready: '可交付',
    missing: '缺失',
    risk: '失败风险',
  }[value] || '待审阅');

  const renderDeliverableChip = (row, type) => {
    const deliverable = row.deliverableSummary?.[type];
    const isRequired = REQUIRED_DELIVERY_TYPES.includes(type);
    if (!deliverable) return <span key={type} className={isRequired ? 'delivery-chip missing' : 'delivery-chip optional'}>{deliveryTypeLabel(type)}缺失</span>;
    return (
      <span key={type} className="delivery-chip ready">
        <CheckCircle2 size={13} />
        {deliveryTypeLabel(type)} v{deliverable.version || 1}
      </span>
    );
  };

  const renderPrimaryAction = (row) => {
    const manualReport = row.deliverableSummary?.['manual-report'];
    const htmlReport = row.deliverableSummary?.['html-report'];
    const target = manualReport || htmlReport;
    if (!target) return <span className="delivery-action-empty">报告缺失</span>;
    return (
      <a className="delivery-primary-link" href={deliverableHref(target)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        打开报告
        <ExternalLink size={14} />
      </a>
    );
  };

  const selectedRow = rows.find((row) => row.case?.id === selectedCaseId);
  const selectedDeliverables = selectedRow ? (expandedDeliverables[selectedCaseId] || selectedRow.deliverables || []) : [];

  return (
    <section className="module-section delivery-report-page" aria-label="交付报告">
      <div className="section-header">
        <div>
          <h2>交付审阅工作台</h2>
          <p>{currentScopeLabel} · 按四件套判断交付完整性，缺失项优先展示。</p>
        </div>
        <div className="action-row">
          {item && (
            <button type="button" className="ghost-button" onClick={scopeToCurrentItem}>
              <ClipboardList size={16} />
              当前工单
            </button>
          )}
          <button type="button" className="ghost-button" onClick={scopeToCurrentProject}>
            <Database size={16} />
            当前项目
          </button>
          <button type="button" className="ghost-button" disabled={!hasScopedFilter} onClick={resetFilters}>
            <RefreshCw size={16} />
            查看全部
          </button>
        </div>
      </div>

      <div className="delivery-readiness-grid" aria-label="交付结论">
        <div className="delivery-readiness-card total"><span>总用例</span><strong>{summary.total || 0}</strong></div>
        <div className="delivery-readiness-card ready"><span>可交付</span><strong>{summary.ready || 0}</strong></div>
        <div className="delivery-readiness-card missing"><span>缺失</span><strong>{summary.missing || 0}</strong></div>
        <div className="delivery-readiness-card risk"><span>失败风险</span><strong>{summary.failedRisk || 0}</strong></div>
      </div>

      <div className="delivery-missing-strip">
        {REQUIRED_DELIVERY_TYPES.map((type) => (
          <span key={type}>{deliveryTypeLabel(type)}缺失 <strong>{summary.missingByType?.[type] || 0}</strong></span>
        ))}
      </div>

      <div className="delivery-filter-panel" data-testid="delivery-report-filters">
        <div className="delivery-basic-filters">
          <label className="field wide">
            <span>关键词</span>
            <input value={deliveryFilters.q} onChange={(event) => updateFilter('q', event.target.value)} placeholder="搜索用例、项目、工单、交付物" />
          </label>
          <label className="field">
            <span>完整性</span>
            <select value={deliveryFilters.readiness} onChange={(event) => updateFilter('readiness', event.target.value)}>
              <option value="all">全部状态</option>
              <option value="missing">缺失</option>
              <option value="risk">失败风险</option>
              <option value="ready">可交付</option>
            </select>
          </label>
          <button type="button" className="ghost-button" onClick={() => setAdvancedFiltersOpen((value) => !value)}>
            <SlidersHorizontalFallback />
            高级筛选
          </button>
          <button type="button" className="primary-action" onClick={() => applyFilters(1)}>
            <Search size={16} />
            查询
          </button>
        </div>
        {advancedFiltersOpen && (
          <div className="delivery-advanced-filters">
            <label className="field">
              <span>项目</span>
              <select value={deliveryFilters.project_id} onChange={(event) => updateFilter('project_id', event.target.value)}>
                <option value="">全部项目</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>优先级</span>
              <select value={deliveryFilters.priority} onChange={(event) => updateFilter('priority', event.target.value)}>
                <option value="all">全部</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
              </select>
            </label>
            <label className="field">
              <span>自动化</span>
              <select value={deliveryFilters.automation_status} onChange={(event) => updateFilter('automation_status', event.target.value)}>
                <option value="all">全部</option>
                <option value="designed">已设计</option>
                <option value="automated">已自动化</option>
                <option value="manual">人工</option>
              </select>
            </label>
            <label className="field">
              <span>最近结果</span>
              <select value={deliveryFilters.latest_status} onChange={(event) => updateFilter('latest_status', event.target.value)}>
                <option value="all">全部</option>
                <option value="passed">通过</option>
                <option value="failed">失败</option>
                <option value="skipped">跳过</option>
              </select>
            </label>
            <label className="field">
              <span>交付物</span>
              <select value={deliveryFilters.deliverable_type} onChange={(event) => updateFilter('deliverable_type', event.target.value)}>
                <option value="all">全部类型</option>
                <option value="test-cases">用例文档</option>
                <option value="spec">自动化脚本</option>
                <option value="manual-report">人工报告</option>
                <option value="html-report">HTML report</option>
                <option value="execution-preview">执行证据</option>
              </select>
            </label>
            <label className="field">
              <span>更新起始</span>
              <input type="date" value={deliveryFilters.updated_from} onChange={(event) => updateFilter('updated_from', event.target.value)} />
            </label>
            <label className="field">
              <span>更新截止</span>
              <input type="date" value={deliveryFilters.updated_to} onChange={(event) => updateFilter('updated_to', event.target.value)} />
            </label>
          </div>
        )}
      </div>

      <div className="delivery-toolbar">
        <span>{deliveryReport.total || 0} 条匹配记录 · 第 {deliveryReport.page || 1}/{totalPages} 页</span>
        <div className="segmented-control" aria-label="视图密度">
          <button type="button" className={density === 'cards' ? 'active' : ''} onClick={() => setDensity('cards')}>卡片</button>
          <button type="button" className={density === 'compact' ? 'active' : ''} onClick={() => setDensity('compact')}>紧凑</button>
        </div>
      </div>

      <div className={density === 'compact' ? 'delivery-review-list compact' : 'delivery-review-list'} data-testid="delivery-report-table">
        {rows.length ? rows.map((row) => {
          const caseItem = row.case || {};
          const isSelected = selectedCaseId === caseItem.id;
          const latestStatus = caseItem.latestStatus || row.latestRun?.status || '';
          const missingText = row.missingTypes?.length ? `缺失：${row.missingTypes.map(deliveryTypeLabel).join('、')}` : '四件套齐全';
          return (
            <article className={isSelected ? 'delivery-case-card selected' : 'delivery-case-card'} key={caseItem.id} role="button" tabIndex={0} onClick={() => loadDetail(row)} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && loadDetail(row)}>
              <div className="delivery-case-main">
                <span className={`delivery-readiness-pill ${row.readiness || 'missing'}`}>{readinessLabel(row.readiness)}</span>
                <div>
                  <strong>{caseItem.externalId || caseItem.id}</strong>
                  <h3>{caseItem.title || '未命名用例'}</h3>
                  <p>{row.project?.name || '未归属项目'}{row.workItem?.title ? ` · ${row.workItem.title}` : ''}</p>
                </div>
              </div>
              <div className="delivery-case-meta">
                <span>{caseItem.priority || '-'}</span>
                <span>{statusLabel(caseItem.automationStatus || 'manual')}</span>
                <span className={latestStatus || 'idle'}>{latestStatus ? statusLabel(latestStatus) : '暂无结果'}</span>
                <span>{formatDateTime(row.updatedAt || caseItem.updatedAt)}</span>
              </div>
              <div className="delivery-chip-row">
                {REQUIRED_DELIVERY_TYPES.map((type) => renderDeliverableChip(row, type))}
                {renderDeliverableChip(row, 'execution-preview')}
              </div>
              <div className="delivery-case-footer">
                <span>{missingText}</span>
                {renderPrimaryAction(row)}
              </div>
            </article>
          );
        }) : <p className="muted">没有匹配的用例记录。</p>}
      </div>

      {selectedRow && (
        <aside className="delivery-detail-panel" aria-label="交付详情">
          <div className="panel-heading compact">
            <div>
              <h3>{selectedRow.case?.externalId || selectedRow.case?.id}</h3>
              <p className="muted">{selectedRow.case?.title}</p>
            </div>
            <button type="button" className="ghost-icon-button" aria-label="关闭交付详情" onClick={() => setSelectedCaseId('')}>
              <X size={16} />
            </button>
          </div>
          {previewLoading ? <p className="muted">正在读取交付物详情...</p> : null}
          <div className="delivery-detail-grid">
            {selectedDeliverables.length ? selectedDeliverables.map((deliverable) => {
              const isPreviewOpen = Boolean(contentPreviewOpen[deliverable.id]);
              return (
                <article className="deliverable-card" key={deliverable.id}>
                  <div className="panel-heading compact">
                    <h3>{deliverable.name}</h3>
                    <span className="source-chip">v{deliverable.version || 1} · {deliveryTypeLabel(deliverable.type)}</span>
                  </div>
                  <div className="delivery-row"><span>状态</span><strong>{statusLabel(deliverable.status)}</strong></div>
                  <div className="delivery-row"><span>路径</span><strong>{deliverable.filePath || '-'}</strong></div>
                  <p className="muted">{deliverable.summary || '暂无摘要'}</p>
                  <div className="action-row">
                    {deliverableHref(deliverable) ? (
                      <a className="report-link inline-report-link" href={deliverableHref(deliverable)} target="_blank" rel="noreferrer">
                        <FileText size={16} />
                        {deliverable.type === 'html-report' ? '打开 HTML Report' : '打开渲染报告'}
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                    {deliverable.content ? (
                      <button type="button" className="ghost-button" onClick={() => setContentPreviewOpen((current) => ({ ...current, [deliverable.id]: !current[deliverable.id] }))}>
                        <Eye size={15} />
                        {isPreviewOpen ? '收起内容预览' : '查看内容预览'}
                      </button>
                    ) : null}
                  </div>
                  {isPreviewOpen && deliverable.content ? (
                    <pre className="deliverable-preview">{deliverable.content.slice(0, 2400)}</pre>
                  ) : null}
                </article>
              );
            }) : <p className="muted">该用例暂无交付物，当前状态为缺失。</p>}
          </div>
        </aside>
      )}

      <div className="delivery-pagination">
        <button type="button" className="ghost-button" disabled={(deliveryReport.page || 1) <= 1} onClick={() => applyFilters((deliveryReport.page || 1) - 1)}>
          上一页
        </button>
        <span>第 {deliveryReport.page || 1} 页 / 共 {totalPages} 页</span>
        <button type="button" className="ghost-button" disabled={(deliveryReport.page || 1) >= totalPages} onClick={() => applyFilters((deliveryReport.page || 1) + 1)}>
          下一页
        </button>
      </div>
    </section>
  );
}

function SlidersHorizontalFallback() {
  return <Settings size={16} />;
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

createRoot(document.getElementById('root')).render(<App />);
