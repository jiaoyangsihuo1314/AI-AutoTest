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
  Database,
  ExternalLink,
  FileCheck2,
  FileText,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
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
  X,
} from 'lucide-react';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8001';
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const THEME_STORAGE_KEY = 'qa-platform-theme';
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
  { id: 'feature-menus', label: '功能菜单配置', icon: FolderTree },
  { id: 'ai-config', label: 'AI 配置', icon: Settings },
];

const HOME_MODULE_ID = 'overview';
const MODULE_LOOKUP = Object.fromEntries(MODULES.map((module) => [module.id, module]));
const NAV_GROUPS = [
  { id: 'workspace', title: '工作台', icon: LayoutDashboard, moduleIds: ['overview', 'automation-flow', 'test-suites', 'execution-monitor'] },
  { id: 'workflow', title: '测试任务流', icon: ClipboardList, moduleIds: ['requirements', 'cases', 'exploration', 'scripts', 'execution', 'healing'] },
  { id: 'assets', title: '资产管理', icon: Database, moduleIds: ['projects', 'case-management', 'delivery'] },
  { id: 'settings', title: '系统设置', icon: Settings, moduleIds: ['feature-menus', 'ai-config'] },
];
const MODULE_GROUP_LOOKUP = Object.fromEntries(NAV_GROUPS.flatMap((group) => group.moduleIds.map((moduleId) => [moduleId, group.id])));

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
  const [health, setHealth] = useState({ status: 'checking', ai: { configured: false } });
  const [workItems, setWorkItems] = useState([]);
  const [currentItem, setCurrentItem] = useState(null);
  const currentItemRef = useRef(null);
  const selectedWorkItemIdRef = useRef('');
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState('default-local-project');
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
  const [aiConfig, setAiConfig] = useState({ api_key: '', model: 'gpt-4.1-mini', base_url: 'https://api.openai.com/v1' });
  const [testingAIConfig, setTestingAIConfig] = useState(false);
  const [analyzingRequirement, setAnalyzingRequirement] = useState(false);
  const [requirementForm, setRequirementForm] = useState(emptyRequirement());
  const [exploration, setExploration] = useState(emptyExploration);
  const [casesMarkdown, setCasesMarkdown] = useState('');
  const [scriptContent, setScriptContent] = useState('');
  const [healingForm, setHealingForm] = useState({
    failure_summary: '等待执行失败后填写失败摘要。',
    proposed_fix: '记录选择器、等待策略或断言调整方案。',
  });
  const [automationRequirement, setAutomationRequirement] = useState('');
  const [automationProjectId, setAutomationProjectId] = useState('default-local-project');
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
    const node = automationLogRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [automationLogs]);

  useEffect(() => {
    if (!projects.length) return;
    if (!projects.find((project) => project.id === automationProjectId)) {
      setAutomationProjectId(projects[0].id);
      setAutomationFeatureId('');
    }
  }, [automationProjectId, projects]);

  useEffect(() => {
    if (!automationProjectId) {
      setAutomationFeatureOptions([]);
      setAutomationFeatureTree([]);
      setAutomationFeatureId('');
      return undefined;
    }
    let cancelled = false;
    async function loadAutomationFeatures() {
      try {
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
          setError(`加载全流程功能树失败：${err.message}`);
        }
      }
    }
    loadAutomationFeatures();
    return () => {
      cancelled = true;
    };
  }, [automationProjectId]);

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
    if (!automationFlowId) return undefined;
    let cancelled = false;

    async function pollAutomationFlow() {
      try {
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
        if (!cancelled) setError(`获取全流程状态失败：${err.message}`);
      }
    }

    pollAutomationFlow();
    const terminal = ['completed', 'failed', 'blocked', 'cancelled'].includes(automationFlow?.status);
    const timer = window.setInterval(pollAutomationFlow, automationLiveConnected && !terminal ? 8000 : terminal ? 5000 : 1600);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [automationFlowId, automationFlow?.status, automationLiveConnected]);

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
    setAiConfig((value) => ({
      ...value,
      model: value.model || health.ai.model || 'gpt-4.1-mini',
      base_url: health.ai.baseUrlLocked || value.base_url === 'https://api.openai.com/v1' ? health.ai.baseUrl || value.base_url : value.base_url,
    }));
  }, [health.ai?.baseUrl, health.ai?.baseUrlLocked, health.ai?.model]);

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

  async function fetchJson(path, options) {
    const response = await fetch(`${API_BASE}${path}`, options);
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

  async function loadDeliveryReport(nextFilters = deliveryFilters, page = 1, pageSize = deliveryReport.pageSize || 50) {
    const payload = await fetchJson(buildDeliveryReportPath(nextFilters, page, pageSize));
    setDeliveryReport(payload);
    return payload;
  }

  async function refreshCases(projectId = currentProjectId || 'default-local-project') {
    const payload = await fetchJson(`/api/test-cases?project_id=${encodeURIComponent(projectId)}`);
    setTestCases(payload);
    return payload;
  }

  async function refreshFeatures(projectId = currentProjectId || 'default-local-project') {
    const payload = await fetchJson(`/api/features?project_id=${encodeURIComponent(projectId)}`);
    setFeatures(payload.items || []);
    setFeatureTree(payload.tree || []);
    return payload;
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

  async function loadAll() {
    try {
      const projectId = currentProjectId || 'default-local-project';
      const [healthPayload, projectPayload, workPayload, casePayload, featurePayload, deliverablePayload, suitesPayload, suiteRunPayload, runsPayload, dashboardPayload] = await Promise.all([
        fetchJson('/api/health'),
        fetchJson('/api/projects'),
        fetchJson('/api/work-items'),
        fetchJson(`/api/test-cases?project_id=${encodeURIComponent(projectId)}`),
        fetchJson(`/api/features?project_id=${encodeURIComponent(projectId)}`),
        fetchJson('/api/deliverables?include_content=false'),
        fetchJson(`/api/test-suites?project_id=${encodeURIComponent(projectId)}`),
        fetchJson(`/api/suite-runs?project_id=${encodeURIComponent(projectId)}`),
        fetchJson('/api/runs'),
        fetchJson(`/api/dashboard-summary?project_id=${encodeURIComponent(dashboardScopeProjectId || 'all')}`),
      ]);
      setHealth(healthPayload);
      setProjects(projectPayload);
      if (!projectPayload.find((project) => project.id === currentProjectId) && projectPayload[0]) {
        setCurrentProjectId(projectPayload[0].id);
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
    loadAll();
    const timer = window.setInterval(loadAll, 5000);
    return () => window.clearInterval(timer);
  }, [currentProjectId, dashboardScopeProjectId]);

  useEffect(() => {
    if (activeModule !== 'delivery') return undefined;
    let cancelled = false;
    async function refreshDelivery() {
      try {
        const payload = await fetchJson(buildDeliveryReportPath(deliveryFilters, deliveryReport.page || 1, deliveryReport.pageSize || 50));
        if (!cancelled) setDeliveryReport(payload);
      } catch (err) {
        if (!cancelled) setError(`加载交付报告失败：${err.message}`);
      }
    }
    refreshDelivery();
    return () => {
      cancelled = true;
    };
  }, [activeModule]);

  useEffect(() => {
    if (!latestSuiteRun?.id) return undefined;
    let cancelled = false;
    async function pollSuiteRun() {
      try {
        const payload = await fetchJson(`/api/suite-runs/${latestSuiteRun.id}`);
        if (!cancelled) {
          setLatestSuiteRun(payload);
          setSuiteRuns((items) => items.map((item) => (item.id === payload.id ? payload : item)));
          if (payload.status !== 'running' && payload.status !== 'queued') {
            const projectId = currentProjectId || 'default-local-project';
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
  }, [latestSuiteRun?.id, latestSuiteRun?.status, currentProjectId]);

  useEffect(() => {
    if (latestSuiteRun?.id && !monitorSuiteRunId) {
      setMonitorSuiteRunId(latestSuiteRun.id);
    }
  }, [latestSuiteRun?.id, monitorSuiteRunId]);

  useEffect(() => {
    if (activeModule !== 'execution-monitor') return undefined;
    let cancelled = false;
    async function pollMonitorList() {
      try {
        const projectId = currentProjectId || 'default-local-project';
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
        if (!cancelled) setError(`刷新执行监控列表失败：${err.message}`);
      }
    }
    pollMonitorList();
    const timer = window.setInterval(pollMonitorList, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeModule, currentProjectId, monitorSuiteRunId]);

  useEffect(() => {
    if (activeModule !== 'execution-monitor' || !monitorSuiteRunId) return undefined;
    let cancelled = false;
    async function pollMonitorDetail() {
      try {
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
        if (!cancelled) setError(`刷新执行监控详情失败：${err.message}`);
      }
    }
    pollMonitorDetail();
    const isActiveRun = ['queued', 'running'].includes(monitorSuiteRunDetail?.status);
    const timer = window.setInterval(pollMonitorDetail, isActiveRun ? 1500 : 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeModule, monitorSuiteRunId, monitorSuiteRunDetail?.status]);

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
    if (activeModule !== 'execution-monitor' || !monitorBrowserTarget.runId) return undefined;
    let cancelled = false;
    async function pollMonitorBrowserRun() {
      try {
        const runPayload = await fetchJson(`/api/runs/${monitorBrowserTarget.runId}`);
        if (cancelled) return;
        setMonitorBrowserRun(runPayload);
        setMonitorBrowserStatus(runPayload.browserSession?.status || runPayload.status || 'Connecting');
      } catch (err) {
        if (!cancelled) {
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
  }, [activeModule, monitorBrowserTarget.runId, monitorBrowserTarget.caseItem?.status, monitorBrowserRun?.status]);

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
    if (!latestRun?.id) return undefined;
    let cancelled = false;
    async function pollRun() {
      try {
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
  }, [latestRun?.id, latestRun?.status]);

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
    if (!explorationRun?.id) return undefined;
    let cancelled = false;

    async function pollExplorationRun() {
      try {
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
  }, [explorationRun?.id, explorationRun?.status]);

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
    setAnalyzingRequirement(true);
    try {
      const item = await fetchJson('/api/work-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requirementForm, project_id: currentProjectId }),
      });
      setError('');
      setWorkItems((items) => [item, ...items]);
      selectedWorkItemIdRef.current = item.id;
      setCurrentItem(item);
      currentItemRef.current = item;
      setCasesMarkdown(item.casesMarkdown || '');
      setScriptContent(item.scriptContent || '');
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

  async function createSuiteFromSelection() {
    const caseIds = Array.from(selectedCaseIds);
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
      setAiConfig((value) => ({ ...value, api_key: '', model: payload.model || value.model, base_url: payload.baseUrl || value.base_url }));
      setError('');
      setNotice('AI 配置已保存');
    } catch (err) {
      setError(`保存 AI 配置失败：${err.message}`);
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
      setAiConfig((value) => ({ ...value, api_key: '', base_url: payload.baseUrl || 'https://api.openai.com/v1' }));
      setError('');
      setNotice('本地 AI 配置已清除');
    } catch (err) {
      setError(`清除 AI 配置失败：${err.message}`);
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
        body: JSON.stringify({ content: casesMarkdown }),
      });
      setError('');
      setCurrentItem(item);
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
        body: JSON.stringify({ content: scriptContent }),
      });
      setError('');
      setCurrentItem(item);
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
        {!sidebarCollapsed && (
          <nav aria-label="平台模块">
            {NAV_GROUPS.map((group) => {
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
                            <span className="nav-label">{module.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </nav>
        )}
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
                onLocalLogout={() => setNotice('本地模式无需退出')}
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
          />
        </header>

        {error && (
          <section className="error-banner" role="alert" data-testid="error-banner">
            <XCircle size={18} />
            <span>{error}</span>
          </section>
        )}
        {notice && (
          <section className="notice-banner" role="status" data-testid="notice-banner">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
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
            {activeModule === 'ai-config' && <AIConfig health={health} aiConfig={aiConfig} setAiConfig={setAiConfig} saveAIConfig={saveAIConfig} clearAIConfig={clearAIConfig} testAIConfig={testAIConfig} testingAIConfig={testingAIConfig} />}
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
              />
            )}
            {activeModule === 'requirements' && <Requirements form={requirementForm} setForm={setRequirementForm} createWorkItem={createWorkItem} item={currentItem} analyzing={analyzingRequirement} setActiveModule={openModule} />}
            {activeModule === 'case-management' && <CaseManagement testCases={testCases} features={features} selectedCaseIds={selectedCaseIds} toggleCaseSelection={toggleCaseSelection} setAllVisibleCasesSelected={setAllVisibleCasesSelected} runSelectedCases={runSelectedCases} createSuiteFromSelection={createSuiteFromSelection} newSuiteName={newSuiteName} setNewSuiteName={setNewSuiteName} setActiveModule={openModule} bindCaseFeature={bindCaseFeature} />}
            {activeModule === 'exploration' && <Exploration item={currentItem} exploration={exploration} explorationRun={explorationRun} explorationLogs={explorationLogs} browserStatus={browserStatus} browserStatusDetail={browserStatusDetail} liveConnected={liveConnected} browserCanvasRef={browserCanvasRef} setExploration={setExploration} updateElement={updateElement} addElement={addElement} setAllElementsConfirmed={setAllElementsConfirmed} saveExploration={saveExploration} runExploration={runExploration} exploring={exploring} sendBrowserCommand={sendBrowserCommand} handleBrowserClick={handleBrowserClick} handleBrowserMove={handleBrowserMove} handleBrowserWheel={handleBrowserWheel} handleBrowserKeyDown={handleBrowserKeyDown} />}
            {activeModule === 'cases' && <Cases item={currentItem} casesMarkdown={casesMarkdown} setCasesMarkdown={setCasesMarkdown} generateCases={generateCases} />}
            {activeModule === 'scripts' && <Scripts item={currentItem} latestRun={latestRun} scriptContent={scriptContent} setScriptContent={setScriptContent} generateScript={generateScript} saveArtifacts={saveArtifacts} />}
            {activeModule === 'execution' && <Execution latestRun={latestRun} logs={logs} screenshot={screenshot} runCurrentItem={runCurrentItem} currentItem={currentItem} browserStatus={executionBrowserStatus} browserStatusDetail={executionBrowserDetail} liveConnected={executionLiveConnected} browserCanvasRef={executionBrowserCanvasRef} sendBrowserCommand={sendExecutionBrowserCommand} handleBrowserClick={handleExecutionBrowserClick} handleBrowserMove={handleExecutionBrowserMove} handleBrowserWheel={handleExecutionBrowserWheel} handleBrowserKeyDown={handleExecutionBrowserKeyDown} />}
            {activeModule === 'healing' && <Healing item={currentItem} form={healingForm} setForm={setHealingForm} recordHealing={recordHealing} />}
            {activeModule === 'delivery' && <Delivery item={currentItem} projects={projects} deliveryReport={deliveryReport} deliveryFilters={deliveryFilters} setDeliveryFilters={setDeliveryFilters} loadDeliveryReport={loadDeliveryReport} fetchJson={fetchJson} />}
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
      <div className="module-tabs" role="tablist" aria-label="已打开菜单">
        {tabs.map((moduleId) => {
          const module = MODULE_LOOKUP[moduleId];
          if (!module) return null;
          const Icon = module.icon;
          const active = moduleId === activeModule;
          return (
            <div className={active ? 'module-tab active' : 'module-tab'} key={moduleId}>
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

function AIConfig({ health, aiConfig, setAiConfig, saveAIConfig, clearAIConfig, testAIConfig, testingAIConfig }) {
  return (
    <section className="module-section" aria-label="AI 配置">
      <div className="section-header">
        <div>
          <h2>AI 生成配置</h2>
          <p>在前端录入 OpenAI-compatible API Key、模型和 Base URL；健康接口只返回掩码，不回传明文。</p>
        </div>
        <div className="action-row">
          <button type="button" className="ghost-button" onClick={testAIConfig} disabled={testingAIConfig}>
            <RadioTower size={17} />
            {testingAIConfig ? '测试中...' : '测试连接'}
          </button>
          <button type="button" className="ghost-button" onClick={clearAIConfig} disabled={health.ai?.envLocked}>
            <XCircle size={17} />
            清除本地配置
          </button>
          <button type="button" className="primary-action" onClick={saveAIConfig}>
            <Save size={17} />
            保存 AI 配置
          </button>
        </div>
      </div>
      <div className="split-grid">
        <div className="data-panel">
          <h3>当前状态</h3>
          <div className="delivery-row">
            <span>状态</span>
            <strong>{health.ai?.configured ? '已配置' : '未配置'}</strong>
          </div>
          <div className="delivery-row">
            <span>来源</span>
            <strong>{health.ai?.source === 'env' ? '环境变量' : health.ai?.source === 'local' ? '前端本地配置' : '无'}</strong>
          </div>
          <div className="delivery-row">
            <span>模型</span>
            <strong>{health.ai?.model || 'gpt-4.1-mini'}</strong>
          </div>
          <div className="delivery-row">
            <span>调用地址</span>
            <strong>{health.ai?.baseUrl || 'https://api.openai.com/v1'}</strong>
          </div>
          <div className="delivery-row">
            <span>URL 来源</span>
            <strong>{health.ai?.baseUrlSource === 'env' ? '环境变量' : health.ai?.baseUrlSource === 'local' ? '前端本地配置' : '默认值'}</strong>
          </div>
          <div className="delivery-row">
            <span>连接状态</span>
            <strong>{health.ai?.connectionStatus === 'connected' ? '测试通过' : '待测试'}</strong>
          </div>
          <div className="delivery-row">
            <span>密钥</span>
            <strong>{health.ai?.maskedKey || '未保存'}</strong>
          </div>
        </div>
        <div className="data-panel">
          <h3>配置表单</h3>
          <div className="form-grid compact">
            <label className="field wide">
              <span>OpenAI API Key</span>
              <input
                type="password"
                value={aiConfig.api_key}
                placeholder={health.ai?.envLocked ? '已由环境变量配置，前端不可覆盖' : 'sk-...'}
                disabled={health.ai?.envLocked}
                onChange={(event) => setAiConfig({ ...aiConfig, api_key: event.target.value })}
              />
            </label>
            <label className="field wide">
              <span>模型</span>
              <input value={aiConfig.model} onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })} />
            </label>
            <label className="field wide">
              <span>Base URL</span>
              <input
                value={aiConfig.base_url}
                placeholder="https://api.openai.com/v1"
                disabled={health.ai?.baseUrlLocked}
                onChange={(event) => setAiConfig({ ...aiConfig, base_url: event.target.value })}
              />
            </label>
          </div>
          <p className="muted">如果服务启动时已设置 `OPENAI_API_KEY` 或 `OPENAI_BASE_URL`，平台会优先使用环境变量；测试连接会执行一次极短真实生成。</p>
        </div>
      </div>
    </section>
  );
}

function TopbarActions({ health, error, notice, latestRun, automationStatus, automationStage, themes, themeId, setThemeId, onLocalLogout }) {
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
              <span className="qa-avatar large">QA</span>
              <div>
                <strong>QA 用户</strong>
                <span>本地工作台</span>
              </div>
            </div>
            <button
              type="button"
              className="user-menu-action"
              onClick={() => {
                setOpenPanel('');
                onLocalLogout();
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
  const [editingProjectId, setEditingProjectId] = useState(currentProject?.id || '');
  const [projectForm, setProjectForm] = useState(() => emptyProjectForm(currentProject));
  const isCreating = editingProjectId === 'new';
  const isDefaultProject = currentProject?.id === 'default-local-project';

  useEffect(() => {
    if (editingProjectId === 'new') return;
    setEditingProjectId(currentProject?.id || '');
    setProjectForm(emptyProjectForm(currentProject));
  }, [currentProject?.id]);

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
    setEditingProjectId(currentProject?.id || '');
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
              <button type="button" className="ghost-button danger-action" onClick={deleteProject} disabled={isDefaultProject}>
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
  const [listCollapsed, setListCollapsed] = useState(false);
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
        featureTree: project.featureTree || [],
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
  const lockedProjectId = selectedCaseProjectId || existingSuiteProjectId;
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
    || (selectedScope.type !== 'all' ? selectedScope.projectId : filteredProjectIds.length === 1 ? filteredProjectIds[0] : '');
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
      const nextProjectId = remainingCases[0]?.projectId || (selectedSuiteId ? selectedSuite?.projectId || form.projectId : currentProjectId);
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
      const nextProjectId = remainingCases[0]?.projectId || (selectedSuiteId ? selectedSuite?.projectId || form.projectId : currentProjectId);
      return { ...form, projectId: nextProjectId, caseIds: Array.from(next) };
    });
  };
  const featureCaseCount = (project, feature) => {
    const featureIds = new Set(collectFeatureIds(feature));
    return (project.testCases || []).filter((item) => featureIds.has(item.featureId)).length;
  };
  const renderFeaturePickerNode = (project, feature, depth = 0) => {
    const isSelected = selectedScope.type === 'feature' && selectedScope.featureId === feature.id;
    return (
      <div className="suite-feature-node-wrap" key={feature.id}>
        <button
          type="button"
          className={isSelected ? 'suite-feature-node selected' : 'suite-feature-node'}
          style={{ '--feature-depth': depth }}
          onClick={() => setSelectedScope({ type: 'feature', projectId: project.id, featureId: feature.id, featureIds: collectFeatureIds(feature) })}
        >
          <CircleDot size={13} />
          <span>
            <strong>{feature.name}</strong>
            <small>{feature.path}</small>
          </span>
          <em>{featureCaseCount(project, feature)} 条</em>
        </button>
        {feature.children?.length ? (
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
                <div className="suite-case-picker">
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
                      {visibleSuiteProjects.length ? visibleSuiteProjects.map((project) => (
                        <article className="suite-project-group" key={project.id}>
                          <button
                            type="button"
                            className={selectedScope.type === 'project' && selectedScope.projectId === project.id ? 'suite-project-node selected' : 'suite-project-node'}
                            onClick={() => setSelectedScope({ type: 'project', projectId: project.id, featureId: '', featureIds: [] })}
                          >
                            <FolderTree size={15} />
                            <span>
                              <strong>{project.name}</strong>
                              <small>{project.projectCode || project.id}</small>
                            </span>
                            <em>{project.testCases?.length || 0} 条</em>
                          </button>
                          {project.featureTree?.length ? (
                            <div className="suite-feature-tree">
                              {project.featureTree.map((feature) => renderFeaturePickerNode(project, feature))}
                            </div>
                          ) : project.suiteCaseLoadError ? (
                            <p className="muted suite-tree-empty">用例加载失败：{project.suiteCaseLoadError}</p>
                          ) : (
                            <p className="muted suite-tree-empty">暂无功能树</p>
                          )}
                        </article>
                      )) : <p className="muted suite-tree-empty">没有匹配的项目。</p>}
                    </div>
                  </aside>
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
          <button type="button" className="ghost-button" onClick={() => refreshFeatures()}>
            <RefreshCw size={16} />
            刷新
          </button>
          <button type="button" className="primary-action" onClick={() => beginCreate('')}>
            <Plus size={17} />
            新增根功能
          </button>
        </div>
      </div>

      <div className="feature-toolbar">
        <label className="field compact-field">
          <span>当前项目</span>
          <select value={currentProjectId} onChange={(event) => setCurrentProjectId(event.target.value)}>
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
              <span>{features.length ? '没有匹配的功能。' : '暂无功能菜单配置。先新增根功能，再继续添加不限层级的子功能。'}</span>
              {!features.length && (
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
              <span>选择左侧功能查看详情，或新增根功能开始配置。</span>
              <button type="button" className="primary-action" onClick={() => beginCreate('')}>
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

function CaseManagement({ testCases, features, selectedCaseIds, toggleCaseSelection, setAllVisibleCasesSelected, runSelectedCases, createSuiteFromSelection, newSuiteName, setNewSuiteName, setActiveModule, bindCaseFeature }) {
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
          <button type="button" className="primary-action" disabled={!selectedCount} onClick={() => runSelectedCases()}>
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
      </div>
      <div className="suite-create-row">
        <input value={newSuiteName} onChange={(event) => setNewSuiteName(event.target.value)} placeholder="套件名称" />
        <button type="button" className="ghost-button" disabled={!selectedCount} onClick={createSuiteFromSelection}>
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
            <select className="case-feature-select" value={item.featureId || ''} onChange={(event) => bindCaseFeature(item.id, event.target.value)} aria-label={`${item.externalId} 绑定功能`}>
              <option value="">未绑定</option>
              {activeFeatureOptions(features, item.featureId).map((feature) => (
                <option value={feature.id} key={feature.id}>{feature.path}{feature.isActive ? '' : '（停用）'}</option>
              ))}
            </select>
            <span>{statusLabel(item.automationStatus || 'manual')}</span>
            <span>{item.latestStatus ? statusLabel(item.latestStatus) : '暂无'}</span>
            <span>{item.specPath || '未绑定'}</span>
          </div>
        )) : <p className="muted">暂无结构化用例。先在用例设计中保存 Markdown 用例，系统会自动解析入库。</p>}
      </div>
    </section>
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
  const stageSummaries = buildStageSummaries(AUTOMATION_FLOW_STAGES, flowArtifacts, logs, activeStage, status);
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
  const canStart = !isBusy && hasProject && hasFeature;
  const startHint = !hasProject ? '请选择项目名称' : !hasFeature ? '请选择功能' : '';
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

function buildStageSummaries(stages, artifacts, logs, activeStage, status) {
  return stages.map((stage) => {
    const stageArtifacts = artifacts.filter((artifact) => artifact.stage === stage);
    const stageLogs = logs.filter((log) => log.stage === stage);
    const failed = stageLogs.some((log) => ['error', 'blocked'].includes(log.level)) || stageArtifacts.some((artifact) => artifact.status === 'failed');
    const streaming = stageArtifacts.some((artifact) => artifact.status === 'streaming') || (stage === activeStage && ['running', 'queued', 'healing'].includes(status));
    const completed = stageArtifacts.some((artifact) => ['ready', 'verified', 'saved', 'fallback'].includes(artifact.status)) || stageLogs.some((log) => log.level === 'success');
    return {
      stage,
      state: failed ? 'failed' : streaming ? 'running' : completed ? 'done' : 'idle',
      icon: failed ? AlertTriangle : streaming ? Clock : completed ? CheckCircle2 : ListChecks,
      summary: stageSummaryText(stage, stageArtifacts, stageLogs, { failed, streaming, completed }),
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

function Requirements({ form, setForm, createWorkItem, item, analyzing, setActiveModule }) {
  const analysis = item?.requirementAnalysis;
  const project = item?.projectContext;
  const sourceLabel = analysis?.source === 'ai' ? 'AI 自动提取' : analysis?.source ? '规则兜底提取' : '等待分析';
  return (
    <section className="module-section" aria-label="需求工单">
      <div className="section-header">
        <div>
          <h2>需求工单</h2>
          <p>先输入完整需求，点击需求分析后自动提取目标、用户路径、验收标准、角色、测试数据、环境和排除项。</p>
        </div>
      </div>

      <div className="requirement-analysis-card">
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
          <button type="button" className="primary-action" disabled={analyzing || !form.requirement.trim()} onClick={createWorkItem}>
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

function Exploration({ item, exploration, explorationRun, explorationLogs, browserStatus, browserStatusDetail, liveConnected, browserCanvasRef, setExploration, updateElement, addElement, setAllElementsConfirmed, saveExploration, runExploration, exploring, sendBrowserCommand, handleBrowserClick, handleBrowserMove, handleBrowserWheel, handleBrowserKeyDown }) {
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
          <button type="button" className="ghost-button" disabled={!item || !hasCases || exploring} onClick={runExploration}>
            <FlaskConical size={17} />
            {exploring ? '探索中' : '执行探索'}
          </button>
          <button type="button" className="primary-action" disabled={!item || !hasCases} onClick={saveExploration}>
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

function Cases({ item, casesMarkdown, setCasesMarkdown, generateCases }) {
  const analysis = item?.requirementAnalysis;
  const project = item?.projectContext;
  return (
    <section className="module-section" aria-label="用例设计">
      <div className="section-header">
        <div>
          <h2>可追溯测试用例</h2>
          <p>实现脚本前先保存测试用例；字段必须覆盖 ID、标题、优先级、覆盖需求、前置条件/测试数据、步骤、期望结果和自动化说明。</p>
        </div>
        <button type="button" className="primary-action" disabled={!item} onClick={generateCases}>
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
        </div>
      )}
      <textarea className="editor markdown" value={casesMarkdown} onChange={(event) => setCasesMarkdown(event.target.value)} placeholder="在这里粘贴或编辑测试用例 markdown 表格。" />
    </section>
  );
}

function Scripts({ item, latestRun, scriptContent, setScriptContent, generateScript, saveArtifacts }) {
  const runMatchesItem = latestRun?.workItemId === item?.id;
  const hasVerifiedRun = Boolean(item?.latestRunId && (!runMatchesItem || latestRun.status !== 'running'));
  const canSaveArtifacts = Boolean(item?.scriptContent && hasVerifiedRun);
  return (
    <section className="module-section" aria-label="脚本工作台">
      <div className="section-header">
        <div>
          <h2>Playwright 脚本工作台</h2>
          <p>基于已保存测试用例和已确认元素生成草稿 spec；每个关键 locator 必须来自确认过的页面信息。</p>
        </div>
        <div className="action-row">
          <button type="button" className="ghost-button" disabled={!item} onClick={generateScript}>
            <Code2 size={17} />
            生成/保存草稿脚本
          </button>
          <button type="button" className="primary-action" disabled={!canSaveArtifacts} onClick={saveArtifacts}>
            <Save size={17} />
            保存已验证产物
          </button>
        </div>
      </div>
      <textarea className="editor code" value={scriptContent} onChange={(event) => setScriptContent(event.target.value)} placeholder="在这里粘贴或编辑 Playwright TypeScript 草稿 spec。" />
    </section>
  );
}

function Execution({ latestRun, logs, screenshot, runCurrentItem, currentItem, browserStatus, browserStatusDetail, liveConnected, browserCanvasRef, sendBrowserCommand, handleBrowserClick, handleBrowserMove, handleBrowserWheel, handleBrowserKeyDown }) {
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
        <button type="button" className="primary-action" disabled={!currentItem?.scriptContent || latestRun?.status === 'running'} onClick={runCurrentItem}>
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

function Healing({ item, form, setForm, recordHealing }) {
  return (
    <section className="module-section" aria-label="自愈诊断">
      <div className="section-header">
        <div>
          <h2>失败诊断与自愈记录</h2>
          <p>最多 3 轮，只记录测试侧修复：selector、等待、断言、测试数据。</p>
        </div>
        <button type="button" className="primary-action" disabled={!item} onClick={recordHealing}>
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

function Delivery({ item, projects, deliveryReport, deliveryFilters, setDeliveryFilters, loadDeliveryReport, fetchJson }) {
  const [expandedCaseId, setExpandedCaseId] = useState('');
  const [expandedDeliverables, setExpandedDeliverables] = useState({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const rows = deliveryReport.items || [];
  const totalPages = Math.max(1, Math.ceil((deliveryReport.total || 0) / (deliveryReport.pageSize || 50)));
  const hasScopedFilter = Boolean(deliveryFilters.work_item_id || deliveryFilters.project_id || deliveryFilters.case_id || deliveryFilters.q || deliveryFilters.priority !== 'all' || deliveryFilters.automation_status !== 'all' || deliveryFilters.latest_status !== 'all' || deliveryFilters.deliverable_type !== 'all' || deliveryFilters.updated_from || deliveryFilters.updated_to);

  const updateFilter = (key, value) => {
    setDeliveryFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = async (page = 1) => {
    await loadDeliveryReport(deliveryFilters, page);
    setExpandedCaseId('');
  };

  const resetFilters = async () => {
    const nextFilters = emptyDeliveryFilters();
    setDeliveryFilters(nextFilters);
    await loadDeliveryReport(nextFilters, 1);
    setExpandedCaseId('');
  };

  const scopeToCurrentItem = async () => {
    if (!item?.id) return;
    const nextFilters = { ...emptyDeliveryFilters(), work_item_id: item.id };
    setDeliveryFilters(nextFilters);
    await loadDeliveryReport(nextFilters, 1);
    setExpandedCaseId('');
  };

  const loadPreview = async (row) => {
    const caseId = row.case?.id;
    if (!caseId) return;
    if (expandedCaseId === caseId) {
      setExpandedCaseId('');
      return;
    }
    setExpandedCaseId(caseId);
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

  const renderDeliverableState = (row, type) => {
    const deliverable = row.deliverableSummary?.[type];
    if (!deliverable) return <span className="missing-state">待生成</span>;
    const fileName = deliverable.filePath ? deliverable.filePath.split('/').pop() : '';
    if (type === 'html-report' || type === 'manual-report') {
      const href = type === 'html-report' ? playwrightReportUrl() : deliverableReportUrl(deliverable);
      return (
        <a className="delivery-table-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          {type === 'html-report' ? '打开' : '渲染'}
          <ExternalLink size={12} />
        </a>
      );
    }
    return (
      <span className="ready-state deliverable-state-detail">
        v{deliverable.version}
        {fileName ? <small>{fileName}</small> : null}
      </span>
    );
  };

  return (
    <section className="module-section delivery-report-page" aria-label="交付报告">
      <div className="section-header">
        <div>
          <h2>全项目用例级交付报告</h2>
          <p>默认展示所有项目下的所有测试用例；没有交付物的用例也会作为待生成项出现。</p>
        </div>
        <div className="action-row">
          {item && (
            <button type="button" className="ghost-button" onClick={scopeToCurrentItem}>
              <ClipboardList size={16} />
              当前工单
            </button>
          )}
          <button type="button" className="ghost-button" disabled={!hasScopedFilter} onClick={resetFilters}>
            <RefreshCw size={16} />
            查看全部
          </button>
        </div>
      </div>

      <div className="delivery-filter-grid" data-testid="delivery-report-filters">
        <label className="field wide">
          <span>关键词</span>
          <input value={deliveryFilters.q} onChange={(event) => updateFilter('q', event.target.value)} placeholder="搜索用例、项目、工单、交付物" />
        </label>
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
        <button type="button" className="primary-action" onClick={() => applyFilters(1)}>
          <FileText size={16} />
          查询
        </button>
      </div>

      {deliveryFilters.work_item_id && (
        <div className="delivery-context-banner">
          <span>当前按工单筛选：{item?.title || deliveryFilters.work_item_id}</span>
          <button type="button" className="ghost-button" onClick={resetFilters}>清除筛选，查看全部项目</button>
        </div>
      )}

      <div className="delivery-report-summary">
        <strong>{deliveryReport.total || 0}</strong>
        <span>条用例记录 · 第 {deliveryReport.page || 1}/{totalPages} 页</span>
      </div>

      <div className="delivery-report-table" data-testid="delivery-report-table">
        <div className="delivery-report-row delivery-report-head">
          <span>项目</span>
          <span>用例</span>
          <span>优先级</span>
          <span>自动化</span>
          <span>最近结果</span>
          <span>用例文档</span>
          <span>脚本</span>
          <span>人工报告</span>
          <span>HTML report</span>
          <span>证据</span>
          <span>更新时间</span>
        </div>
        {rows.length ? rows.map((row) => {
          const caseItem = row.case || {};
          const isExpanded = expandedCaseId === caseItem.id;
          const previewItems = expandedDeliverables[caseItem.id] || row.deliverables || [];
          const latestStatus = caseItem.latestStatus || row.latestRun?.status || '';
          return (
            <React.Fragment key={caseItem.id}>
              <div className={isExpanded ? 'delivery-report-row expanded' : 'delivery-report-row'} role="button" tabIndex={0} onClick={() => loadPreview(row)} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && loadPreview(row)}>
                <span>{row.project?.name || '未归属项目'}</span>
                <span>
                  <strong>{caseItem.externalId || caseItem.id}</strong>
                  <small>{caseItem.title || '未命名用例'}</small>
                  {row.workItem?.title ? <small>{row.workItem.title}</small> : null}
                </span>
                <span>{caseItem.priority || '-'}</span>
                <span>{statusLabel(caseItem.automationStatus || 'manual')}</span>
                <span className={latestStatus || 'idle'}>{latestStatus ? statusLabel(latestStatus) : '暂无'}</span>
                <span>{renderDeliverableState(row, 'test-cases')}</span>
                <span>{renderDeliverableState(row, 'spec')}</span>
                <span>{renderDeliverableState(row, 'manual-report')}</span>
                <span>{renderDeliverableState(row, 'html-report')}</span>
                <span>{renderDeliverableState(row, 'execution-preview')}</span>
                <span>{formatDateTime(row.updatedAt || caseItem.updatedAt)}</span>
              </div>
              {isExpanded && (
                <div className="delivery-preview-panel">
                  {previewLoading ? <p className="muted">正在读取交付物预览...</p> : null}
                  {previewItems.length ? previewItems.map((deliverable) => (
                    <article className="deliverable-card" key={deliverable.id}>
                      <div className="panel-heading compact">
                        <h3>{deliverable.name}</h3>
                        <span className="source-chip">v{deliverable.version || 1} · {deliveryTypeLabel(deliverable.type)}</span>
                      </div>
                      <div className="delivery-row"><span>状态</span><strong>{statusLabel(deliverable.status)}</strong></div>
                      <div className="delivery-row"><span>路径</span><strong>{deliverable.filePath || '-'}</strong></div>
                      <p className="muted">{deliverable.summary || '暂无摘要'}</p>
                      {deliverable.type === 'manual-report' ? (
                        <a className="report-link inline-report-link" href={deliverableReportUrl(deliverable)} target="_blank" rel="noreferrer">
                          <FileText size={16} />
                          打开渲染报告
                          <ExternalLink size={14} />
                        </a>
                      ) : deliverable.type === 'html-report' ? (
                        <a className="report-link inline-report-link" href={playwrightReportUrl()} target="_blank" rel="noreferrer">
                          <FileText size={16} />
                          打开 HTML Report
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                      {deliverable.content ? (
                        <pre className="deliverable-preview">{deliverable.content.slice(0, 2400)}</pre>
                      ) : null}
                    </article>
                  )) : <p className="muted">该用例暂无交付物，当前状态为待生成。</p>}
                </div>
              )}
            </React.Fragment>
          );
        }) : <p className="muted">没有匹配的用例记录。</p>}
      </div>

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
