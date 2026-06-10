import asyncio
import base64
import json
import os
import re
import shutil
import sqlite3
import contextlib
import html
import urllib.parse
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).resolve().parents[2]
DB_PATH = ROOT_DIR / "backend" / "automation-platform.sqlite"
ARTIFACT_DIR = ROOT_DIR / "artifacts" / "automation-platform"
PROJECT_ARTIFACT_DIR = ROOT_DIR / "artifacts" / "projects"
FLOW_RUN_ARTIFACT_DIR = ARTIFACT_DIR / "flow-runs"
SCREENSHOT_PATH = ARTIFACT_DIR / "browser-preview.svg"
REPORT_INDEX = ROOT_DIR / "playwright-report" / "index.html"
DISCOVERY_DIR = ARTIFACT_DIR / "discovery"
BROWSER_WORKER_PATH = ROOT_DIR / "backend" / "app" / "browser_worker.cjs"
EXECUTION_LIVE_DIR = ROOT_DIR / "tests" / "e2e" / ".live-runs"
WORK_ITEM_DRAFT_DIR = ROOT_DIR / "tests" / "e2e" / ".draft-runs"
EXECUTION_CONFIG_DIR = ROOT_DIR / "tests" / "e2e" / ".execution-configs"
DEFAULT_VIEWPORT = {"width": 1440, "height": 900}
DEFAULT_PROJECT_ID = "default-local-project"
DEFAULT_PROJECT_SLUG = "local-qa-project"
DEFAULT_PROJECT_CODE = "PRJ-LOCAL-QA"
PROJECT_TYPE_VALUES = {"product", "delivery"}
PROJECT_STATUS_VALUES = {"planning", "active", "paused", "completed", "archived"}
EXPLORATION_TIME_BUDGET_SECONDS = 300
EXPLORATION_STEP_TIMEOUT_SECONDS = 30
BROWSER_FRAME_SEND_TIMEOUT_SECONDS = 0.2
BROWSER_EVENT_SEND_TIMEOUT_SECONDS = 1.0
BROWSER_WORKER_STREAM_LIMIT_BYTES = 16 * 1024 * 1024
AUTOMATION_FLOW_EVENT_SEND_TIMEOUT_SECONDS = 1.0

STAGES = [
    ("prepare", "准备环境", 12),
    ("browser", "启动浏览器", 28),
    ("execute", "执行脚本", 58),
    ("evidence", "收集证据", 78),
    ("report", "生成报告", 92),
    ("complete", "完成", 100),
]

QA_FLOW = [
    "需求分析",
    "项目预检",
    "用例设计",
    "页面探索",
    "脚本实现",
    "运行验证",
    "自愈诊断",
    "保存已验证产物",
]

EXPLORATION_STAGE_META = {
    "准备探索环境": ("prepare", 8),
    "启动浏览器": ("browser", 22),
    "创建页面": ("page", 30),
    "打开目标 URL": ("navigate", 44),
    "等待页面加载": ("load", 58),
    "采集候选元素": ("collect", 74),
    "生成页面截图": ("screenshot", 88),
    "执行探索步骤": ("step", 62),
    "等待人工接管": ("takeover", 68),
    "完成": ("complete", 100),
}

ExplorationEventCallback = Callable[[dict[str, Any]], Awaitable[None]]

TEST_SUITES = [
    {
        "id": "saucedemo",
        "name": "Sauce Demo 电商流程",
        "spec": "tests/e2e/saucedemo.spec.ts",
        "priority": "P0",
        "cases": 6,
        "description": "覆盖登录、加购、结账、错误登录、登出与受保护路由。",
    },
    {
        "id": "zzpss-login-home",
        "name": "ZZPSS 登录首页",
        "spec": "tests/e2e/zzpss-login-home.spec.ts",
        "priority": "P0",
        "cases": 3,
        "description": "覆盖电力质量系统登录与首页关键状态。",
    },
    {
        "id": "zzpss-power-quality",
        "name": "ZZPSS 电能质量",
        "spec": "tests/e2e/zzpss-power-quality.spec.ts",
        "priority": "P1",
        "cases": 4,
        "description": "覆盖电能质量曲线、详情与关键图表证据。",
    },
]


class RunRequest(BaseModel):
    suite_id: str


class WorkItemRequest(BaseModel):
    project_id: str = ""
    feature_id: str = ""
    title: str = ""
    requirement: str
    target_url: str = ""
    role: str = ""
    test_data: str = ""
    acceptance: str = ""
    exclusions: str = ""


class AutomationFlowRequest(BaseModel):
    requirement: str
    project_id: str = ""
    feature_id: str = ""


class ExplorationRequest(BaseModel):
    notes: str = ""
    screenshot_path: str = ""
    page_structure: str = ""
    elements: list[dict[str, Any]] = []


class ContentRequest(BaseModel):
    content: str = ""


class SaveArtifactsRequest(BaseModel):
    cases_markdown: str = ""
    script_content: str = ""
    report_content: str = ""


class HealRequest(BaseModel):
    failure_summary: str = ""
    proposed_fix: str = ""


class AIConfigRequest(BaseModel):
    api_key: str = ""
    model: str = ""
    base_url: str = ""


class ProjectRequest(BaseModel):
    name: str
    project_code: str = ""
    project_type: str = "product"
    status: str = "active"
    target_url: str = ""
    repository_path: str = ""
    test_dir: str = "tests/e2e"
    description: str = ""


class ProjectPatchRequest(BaseModel):
    name: Optional[str] = None
    project_code: Optional[str] = None
    project_type: Optional[str] = None
    status: Optional[str] = None
    target_url: Optional[str] = None
    repository_path: Optional[str] = None
    test_dir: Optional[str] = None
    description: Optional[str] = None


class TestCaseRequest(BaseModel):
    project_id: str = ""
    work_item_id: str = ""
    feature_id: str = ""
    external_id: str = ""
    title: str
    priority: str = "P1"
    requirement: str = ""
    preconditions: str = ""
    steps: str = ""
    expected: str = ""
    automation_notes: str = ""
    automation_status: str = "manual"
    spec_path: str = ""


class TestCasePatchRequest(BaseModel):
    feature_id: Optional[str] = None
    title: Optional[str] = None
    priority: Optional[str] = None
    requirement: Optional[str] = None
    preconditions: Optional[str] = None
    steps: Optional[str] = None
    expected: Optional[str] = None
    automation_notes: Optional[str] = None
    automation_status: Optional[str] = None
    spec_path: Optional[str] = None


class FeatureMenuRequest(BaseModel):
    project_id: str = ""
    parent_id: str = ""
    name: str
    description: str = ""
    sort_order: int = 0
    is_active: bool = True


class FeatureMenuPatchRequest(BaseModel):
    parent_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class DeliverableRequest(BaseModel):
    project_id: str = ""
    feature_id: str = ""
    work_item_id: str = ""
    case_id: str = ""
    run_id: str = ""
    type: str
    name: str
    status: str = "ready"
    file_path: str = ""
    content: str = ""
    summary: str = ""


class SuiteRequest(BaseModel):
    project_id: str = ""
    name: str
    description: str = ""
    filter: dict[str, Any] = Field(default_factory=dict)
    status: str = "active"
    run_config: dict[str, Any] = Field(default_factory=dict)
    schedule_config: dict[str, Any] = Field(default_factory=dict)


class SuitePatchRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    filter: Optional[dict[str, Any]] = None
    status: Optional[str] = None
    run_config: Optional[dict[str, Any]] = None
    schedule_config: Optional[dict[str, Any]] = None


class SuiteCaseUpdateRequest(BaseModel):
    case_ids: list[str] = Field(default_factory=list)


class SuiteRunRequest(BaseModel):
    suite_id: str = ""
    case_ids: list[str] = Field(default_factory=list)


class BrowserRuntime:
    def __init__(
        self,
        session_id: str,
        work_item_id: str,
        exploration_run_id: str | None,
        target_url: str,
        process: Any | None,
    ) -> None:
        self.session_id = session_id
        self.work_item_id = work_item_id
        self.exploration_run_id = exploration_run_id
        self.target_url = target_url
        self.process = process
        self.websockets: set[WebSocket] = set()
        self.ready = asyncio.Event()
        self.closed = asyncio.Event()
        self.last_frame: dict[str, Any] | None = None
        self.status = "starting"
        self.last_error = ""
        self.last_worker_event_type = ""
        self.last_worker_event_at = ""
        self.last_worker_url = ""
        self.step_events: dict[int, asyncio.Event] = {}
        self.step_results: dict[int, dict[str, Any]] = {}


BROWSER_RUNTIMES: dict[str, BrowserRuntime] = {}
AUTOMATION_FLOW_SOCKETS: dict[str, set[WebSocket]] = {}
AUTOMATION_FLOW_EVENT_LOOP: asyncio.AbstractEventLoop | None = None


app = FastAPI(title="QA Automation Platform", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://127.0.0.1:5175",
        "http://localhost:5175",
        "http://127.0.0.1:5176",
        "http://localhost:5176",
        "http://127.0.0.1:5177",
        "http://localhost:5177",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def normalize_report_date_bound(value: str, *, end_of_day: bool = False) -> str:
    if not value:
        return ""
    cleaned = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cleaned):
        return f"{cleaned}T23:59:59.999999+00:00" if end_of_day else f"{cleaned}T00:00:00+00:00"
    return cleaned


def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    except sqlite3.OperationalError:
        pass


def init_db() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    PROJECT_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    FLOW_RUN_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                project_code TEXT,
                name TEXT NOT NULL,
                project_type TEXT NOT NULL DEFAULT 'product',
                status TEXT NOT NULL DEFAULT 'active',
                target_url TEXT,
                repository_path TEXT,
                test_dir TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        for column, definition in [
            ("project_code", "TEXT"),
            ("project_type", "TEXT NOT NULL DEFAULT 'product'"),
            ("status", "TEXT NOT NULL DEFAULT 'active'"),
        ]:
            add_column_if_missing(conn, "projects", column, definition)
        conn.execute("UPDATE projects SET project_code = ? WHERE id = ? AND (project_code IS NULL OR project_code = '')", (DEFAULT_PROJECT_CODE, DEFAULT_PROJECT_ID))
        conn.execute("UPDATE projects SET project_type = 'product' WHERE project_type IS NULL OR project_type = ''")
        conn.execute("UPDATE projects SET status = 'active' WHERE status IS NULL OR status = ''")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_project_code ON projects(project_code)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                suite_id TEXT NOT NULL,
                suite_name TEXT NOT NULL,
                spec TEXT NOT NULL,
                status TEXT NOT NULL,
                stage_key TEXT NOT NULL,
                stage_label TEXT NOT NULL,
                progress INTEGER NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                exit_code INTEGER,
                report_path TEXT,
                screenshot_path TEXT,
                work_item_id TEXT,
                browser_session_id TEXT
            )
            """
        )
        for column, definition in [
            ("work_item_id", "TEXT"),
            ("browser_session_id", "TEXT"),
        ]:
            add_column_if_missing(conn, "runs", column, definition)
        conn.execute(
            """
            UPDATE runs
            SET status = 'failed',
                stage_key = 'complete',
                stage_label = '服务重启中断',
                progress = 100,
                ended_at = ?,
                exit_code = 1
            WHERE status = 'running'
            """,
            (now_iso(),),
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS work_items (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL,
                title TEXT NOT NULL,
                requirement TEXT NOT NULL,
                target_url TEXT,
                role TEXT,
                test_data TEXT,
                acceptance TEXT,
                exclusions TEXT,
                stage TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                cases_path TEXT,
                spec_path TEXT,
                report_path TEXT,
                latest_run_id TEXT,
                analysis_json TEXT,
                project_id TEXT,
                feature_id TEXT
            )
            """
        )
        add_column_if_missing(conn, "work_items", "analysis_json", "TEXT")
        add_column_if_missing(conn, "work_items", "project_id", "TEXT")
        add_column_if_missing(conn, "work_items", "feature_id", "TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS automation_flow_runs (
                id TEXT PRIMARY KEY,
                work_item_id TEXT,
                feature_id TEXT,
                status TEXT NOT NULL,
                stage TEXT NOT NULL,
                progress INTEGER NOT NULL,
                current_attempt INTEGER NOT NULL DEFAULT 0,
                latest_run_id TEXT,
                latest_exploration_run_id TEXT,
                cases_path TEXT,
                spec_path TEXT,
                report_path TEXT,
                html_report_path TEXT,
                error TEXT,
                started_at TEXT NOT NULL,
                ended_at TEXT
            )
            """
        )
        add_column_if_missing(conn, "automation_flow_runs", "feature_id", "TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS automation_flow_artifacts (
                id TEXT PRIMARY KEY,
                flow_run_id TEXT NOT NULL,
                work_item_id TEXT,
                stage TEXT NOT NULL,
                artifact_type TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT,
                status TEXT NOT NULL,
                source TEXT NOT NULL,
                path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS automation_flow_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                flow_run_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                stage TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                evidence_type TEXT,
                evidence_path TEXT,
                linked_run_id TEXT
            )
            """
        )
        conn.execute(
            """
            UPDATE automation_flow_runs
            SET status = 'failed',
                progress = 100,
                ended_at = ?,
                error = '服务重启导致全流程中断'
            WHERE status IN ('queued', 'running', 'healing')
            """,
            (now_iso(),),
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS explorations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_item_id TEXT NOT NULL,
                notes TEXT,
                screenshot_path TEXT,
                page_structure TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS exploration_runs (
                id TEXT PRIMARY KEY,
                work_item_id TEXT NOT NULL,
                target_url TEXT,
                status TEXT NOT NULL,
                stage_key TEXT NOT NULL,
                stage_label TEXT NOT NULL,
                progress INTEGER NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                screenshot_path TEXT,
                preview_path TEXT,
                result_json TEXT,
                error TEXT,
                plan_json TEXT,
                current_step_index INTEGER NOT NULL DEFAULT 0,
                max_steps INTEGER NOT NULL DEFAULT 0,
                browser_session_id TEXT,
                result_status TEXT
            )
            """
        )
        for column, definition in [
            ("plan_json", "TEXT"),
            ("current_step_index", "INTEGER NOT NULL DEFAULT 0"),
            ("max_steps", "INTEGER NOT NULL DEFAULT 0"),
            ("browser_session_id", "TEXT"),
            ("result_status", "TEXT"),
        ]:
            add_column_if_missing(conn, "exploration_runs", column, definition)
        conn.execute(
            """
            UPDATE exploration_runs
            SET status = 'failed',
                stage_key = 'complete',
                stage_label = '服务重启中断',
                progress = 100,
                ended_at = ?,
                error = '服务重启导致探索中断'
            WHERE status = 'running'
            """,
            (now_iso(),),
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS exploration_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exploration_run_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS exploration_steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exploration_run_id TEXT NOT NULL,
                work_item_id TEXT NOT NULL,
                step_index INTEGER NOT NULL,
                action TEXT NOT NULL,
                target TEXT,
                value TEXT,
                description TEXT,
                status TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                url_before TEXT,
                url_after TEXT,
                title TEXT,
                screenshot_path TEXT,
                structure_json TEXT,
                candidates_json TEXT,
                error TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS browser_sessions (
                id TEXT PRIMARY KEY,
                work_item_id TEXT NOT NULL,
                exploration_run_id TEXT,
                status TEXT NOT NULL,
                viewport_width INTEGER NOT NULL,
                viewport_height INTEGER NOT NULL,
                target_url TEXT,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                error TEXT
            )
            """
        )
        conn.execute(
            """
            UPDATE browser_sessions
            SET status = 'closed',
                ended_at = ?,
                error = '服务重启导致浏览器会话关闭'
            WHERE status IN ('starting', 'live', 'auto-running', 'paused', 'manual-takeover')
            """,
            (now_iso(),),
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS confirmed_elements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_item_id TEXT NOT NULL,
                area TEXT,
                name TEXT,
                locator_type TEXT,
                locator_value TEXT,
                source TEXT,
                confirmed INTEGER NOT NULL DEFAULT 0,
                step_index INTEGER,
                source_url TEXT,
                screenshot_path TEXT
            )
            """
        )
        for column, definition in [
            ("step_index", "INTEGER"),
            ("source_url", "TEXT"),
            ("screenshot_path", "TEXT"),
        ]:
            add_column_if_missing(conn, "confirmed_elements", column, definition)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS generated_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_item_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS generated_scripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_item_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS healing_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_item_id TEXT NOT NULL,
                round INTEGER NOT NULL,
                failure_summary TEXT,
                proposed_fix TEXT,
                result TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS test_cases (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                work_item_id TEXT,
                feature_id TEXT,
                external_id TEXT NOT NULL,
                title TEXT NOT NULL,
                priority TEXT,
                requirement TEXT,
                preconditions TEXT,
                steps TEXT,
                expected TEXT,
                automation_notes TEXT,
                automation_status TEXT NOT NULL,
                spec_path TEXT,
                latest_run_id TEXT,
                latest_status TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        add_column_if_missing(conn, "test_cases", "feature_id", "TEXT")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_project_external ON test_cases(project_id, external_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS feature_menus (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                parent_id TEXT,
                name TEXT NOT NULL,
                description TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_feature_menus_project_parent ON feature_menus(project_id, parent_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS deliverables (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                work_item_id TEXT,
                case_id TEXT,
                run_id TEXT,
                feature_id TEXT,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                version INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                summary TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        add_column_if_missing(conn, "deliverables", "feature_id", "TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS test_suites (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                filter_json TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                run_config_json TEXT,
                schedule_config_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        for column, definition in [
            ("status", "TEXT NOT NULL DEFAULT 'active'"),
            ("run_config_json", "TEXT"),
            ("schedule_config_json", "TEXT"),
        ]:
            add_column_if_missing(conn, "test_suites", column, definition)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS test_suite_cases (
                suite_id TEXT NOT NULL,
                case_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (suite_id, case_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS suite_runs (
                id TEXT PRIMARY KEY,
                suite_id TEXT,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL,
                total_cases INTEGER NOT NULL,
                passed_cases INTEGER NOT NULL DEFAULT 0,
                failed_cases INTEGER NOT NULL DEFAULT 0,
                skipped_cases INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                report_path TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS suite_run_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                suite_run_id TEXT NOT NULL,
                case_id TEXT NOT NULL,
                run_id TEXT,
                status TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                error TEXT
            )
            """
        )
        migrate_project_case_deliverable_data(conn)
        ensure_default_project(conn)


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return slug[:48] or f"qa-task-{uuid.uuid4().hex[:6]}"


def slug_for_work_item(title: str, work_item_id: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title.lower()).strip("-")
    suffix = work_item_id[:6]
    if not slug:
        return f"qa-task-{suffix}"
    max_base_length = max(1, 48 - len(suffix) - 1)
    return f"{slug[:max_base_length].strip('-')}-{suffix}"


def normalize_project_code(value: str) -> str:
    return re.sub(r"\s+", "-", value.strip().upper())


def validate_project_type(value: str) -> str:
    cleaned = (value or "product").strip()
    if cleaned not in PROJECT_TYPE_VALUES:
        raise HTTPException(status_code=400, detail="项目类型必须为 product 或 delivery")
    return cleaned


def validate_project_status(value: str) -> str:
    cleaned = (value or "active").strip()
    if cleaned not in PROJECT_STATUS_VALUES:
        raise HTTPException(status_code=400, detail="项目状态不合法")
    return cleaned


def generate_project_code(conn: sqlite3.Connection) -> str:
    prefix = f"PRJ-{datetime.now(timezone.utc).strftime('%Y%m%d')}"
    for index in range(1, 1000):
        candidate = f"{prefix}-{index:03d}"
        existing = conn.execute("SELECT id FROM projects WHERE project_code = ?", (candidate,)).fetchone()
        if existing is None:
            return candidate
    return f"{prefix}-{uuid.uuid4().hex[:6].upper()}"


def ensure_unique_project_code(conn: sqlite3.Connection, project_code: str, *, exclude_project_id: str = "") -> None:
    existing = conn.execute(
        "SELECT id FROM projects WHERE project_code = ? AND id != ?",
        (project_code, exclude_project_id),
    ).fetchone()
    if existing is not None:
        raise HTTPException(status_code=400, detail="项目ID已存在")


def project_dependency_counts(conn: sqlite3.Connection, project_id: str) -> dict[str, int]:
    return {
        "workItems": conn.execute("SELECT COUNT(*) AS total FROM work_items WHERE project_id = ?", (project_id,)).fetchone()["total"],
        "testCases": conn.execute("SELECT COUNT(*) AS total FROM test_cases WHERE project_id = ?", (project_id,)).fetchone()["total"],
        "deliverables": conn.execute("SELECT COUNT(*) AS total FROM deliverables WHERE project_id = ?", (project_id,)).fetchone()["total"],
        "features": conn.execute("SELECT COUNT(*) AS total FROM feature_menus WHERE project_id = ?", (project_id,)).fetchone()["total"],
        "testSuites": conn.execute("SELECT COUNT(*) AS total FROM test_suites WHERE project_id = ?", (project_id,)).fetchone()["total"],
        "suiteRuns": conn.execute("SELECT COUNT(*) AS total FROM suite_runs WHERE project_id = ?", (project_id,)).fetchone()["total"],
    }


def relative_or_absolute(path_value: str | Path) -> str:
    path = Path(path_value)
    with contextlib.suppress(ValueError):
        return str(path.resolve().relative_to(ROOT_DIR))
    return str(path)


def resolve_workspace_path(path_value: str) -> Path:
    path = Path(path_value)
    return path if path.is_absolute() else ROOT_DIR / path


def safe_child_path(root: Path, path_value: str) -> Path:
    root_resolved = root.resolve()
    candidate = (root_resolved / path_value).resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        raise HTTPException(status_code=404, detail="Report asset not found")
    return candidate


def default_project_payload() -> dict[str, str]:
    context = project_context()
    return {
        "id": DEFAULT_PROJECT_ID,
        "slug": DEFAULT_PROJECT_SLUG,
        "project_code": DEFAULT_PROJECT_CODE,
        "name": "本地 QA 自动化项目",
        "project_type": "product",
        "status": "active",
        "target_url": "",
        "repository_path": str(ROOT_DIR),
        "test_dir": context.get("testDir", "tests/e2e"),
        "description": "由历史工单和仓库测试资产迁移生成的默认项目。",
    }


def ensure_default_project(conn: sqlite3.Connection) -> str:
    payload = default_project_payload()
    timestamp = now_iso()
    conn.execute(
        """
        INSERT INTO projects (
            id, slug, project_code, name, project_type, status,
            target_url, repository_path, test_dir, description,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            project_code = CASE
                WHEN projects.project_code IS NULL OR projects.project_code = '' THEN excluded.project_code
                ELSE projects.project_code
            END,
            project_type = CASE
                WHEN projects.project_type IS NULL OR projects.project_type = '' THEN excluded.project_type
                ELSE projects.project_type
            END,
            status = CASE
                WHEN projects.status IS NULL OR projects.status = '' THEN excluded.status
                ELSE projects.status
            END,
            repository_path = excluded.repository_path,
            test_dir = excluded.test_dir,
            updated_at = excluded.updated_at
        """,
        (
            payload["id"],
            payload["slug"],
            payload["project_code"],
            payload["name"],
            payload["project_type"],
            payload["status"],
            payload["target_url"],
            payload["repository_path"],
            payload["test_dir"],
            payload["description"],
            timestamp,
            timestamp,
        ),
    )
    return payload["id"]


def row_to_project(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "slug": row["slug"],
        "projectCode": row["project_code"] if "project_code" in row.keys() else "",
        "name": row["name"],
        "projectType": row["project_type"] if "project_type" in row.keys() and row["project_type"] else "product",
        "status": row["status"] if "status" in row.keys() and row["status"] else "active",
        "targetUrl": row["target_url"],
        "repositoryPath": row["repository_path"],
        "testDir": row["test_dir"],
        "description": row["description"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_project_row(project_id: str) -> sqlite3.Row:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id or DEFAULT_PROJECT_ID,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return row


def normalize_project_id(project_id: str | None) -> str:
    return project_id or DEFAULT_PROJECT_ID


def validate_project_id(conn: sqlite3.Connection, project_id: str | None) -> str:
    normalized_project_id = normalize_project_id(project_id)
    row = conn.execute("SELECT id FROM projects WHERE id = ?", (normalized_project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=400, detail="项目不存在，请选择项目管理中的有效项目")
    return normalized_project_id


def dashboard_project_filter(project_id: str | None) -> tuple[str, list[Any], str]:
    normalized = (project_id or "all").strip()
    if not normalized or normalized == "all":
        return "all", [], ""
    return normalized, [normalized], "project_id = ?"


def dashboard_where_clause(base: str, project_id: str | None, project_column: str = "project_id") -> tuple[str, list[Any]]:
    _, params, project_clause = dashboard_project_filter(project_id)
    clauses = [base] if base else []
    if project_clause:
        clauses.append(f"{project_column} = ?")
    return f"WHERE {' AND '.join(clauses)}" if clauses else "", params


def format_dashboard_day(value: datetime) -> str:
    return value.astimezone(timezone.utc).date().isoformat()


def average_seconds_from_rows(rows: list[sqlite3.Row], start_key: str, end_key: str) -> int:
    durations: list[int] = []
    for row in rows:
        started_at = row[start_key]
        ended_at = row[end_key]
        if not started_at or not ended_at:
            continue
        try:
            start = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(ended_at).replace("Z", "+00:00"))
        except ValueError:
            continue
        durations.append(max(0, int((end - start).total_seconds())))
    return round(sum(durations) / len(durations)) if durations else 0


def dashboard_summary_payload(project_id: str | None = "all") -> dict[str, Any]:
    scope, _, _ = dashboard_project_filter(project_id)
    now = datetime.now(timezone.utc)
    days = [now - timedelta(days=offset) for offset in range(13, -1, -1)]
    trend_seed = {
        format_dashboard_day(day): {
            "date": format_dashboard_day(day),
            "label": day.strftime("%m-%d"),
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "total": 0,
        }
        for day in days
    }
    since = format_dashboard_day(days[0])

    with get_db() as conn:
        case_where, case_params = dashboard_where_clause("", scope)
        work_where, work_params = dashboard_where_clause("", scope)
        suite_where, suite_params = dashboard_where_clause("", scope)
        active_suite_where, active_suite_params = dashboard_where_clause("status = 'active'", scope)
        automated_where, automated_params = dashboard_where_clause("automation_status = ?", scope)
        failed_case_where, failed_case_params = dashboard_where_clause("latest_status = ?", scope)
        running_where, running_params = dashboard_where_clause("status IN ('queued', 'running')", scope)
        result_where, result_params = dashboard_where_clause("src.status IN ('passed', 'failed', 'skipped')", scope, "sr.project_id")
        run_case_where, run_case_params = dashboard_where_clause("date(src.ended_at) >= date(?)", scope, "sr.project_id")
        run_case_params = [since, *run_case_params]
        failed_result_where, failed_result_params = dashboard_where_clause("src.status = 'failed'", scope, "sr.project_id")
        duration_where, duration_params = dashboard_where_clause("ended_at IS NOT NULL", scope)

        case_total = conn.execute(f"SELECT COUNT(*) AS total FROM test_cases {case_where}", case_params).fetchone()["total"]
        automated_cases = conn.execute(
            f"SELECT COUNT(*) AS total FROM test_cases {automated_where}",
            ["automated", *automated_params],
        ).fetchone()["total"]
        failed_cases = conn.execute(
            f"SELECT COUNT(*) AS total FROM test_cases {failed_case_where}",
            ["failed", *failed_case_params],
        ).fetchone()["total"]
        running_count = conn.execute(
            f"SELECT COUNT(*) AS total FROM suite_runs {running_where}",
            running_params,
        ).fetchone()["total"]
        active_suites = conn.execute(f"SELECT COUNT(*) AS total FROM test_suites {active_suite_where}", active_suite_params).fetchone()["total"]
        work_item_total = conn.execute(f"SELECT COUNT(*) AS total FROM work_items {work_where}", work_params).fetchone()["total"]
        suite_run_total = conn.execute(f"SELECT COUNT(*) AS total FROM suite_runs {suite_where}", suite_params).fetchone()["total"]

        result_totals = conn.execute(
            f"""
            SELECT
                SUM(CASE WHEN src.status = 'passed' THEN 1 ELSE 0 END) AS passed,
                SUM(CASE WHEN src.status = 'failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN src.status = 'skipped' THEN 1 ELSE 0 END) AS skipped
            FROM suite_run_cases src
            JOIN suite_runs sr ON sr.id = src.suite_run_id
            {result_where}
            """,
            result_params,
        ).fetchone()

        priority_rows = conn.execute(
            f"SELECT COALESCE(NULLIF(priority, ''), '未分级') AS label, COUNT(*) AS total FROM test_cases {case_where} GROUP BY label ORDER BY label ASC",
            case_params,
        ).fetchall()
        stage_rows = conn.execute(
            f"SELECT stage AS label, COUNT(*) AS total FROM work_items {work_where} GROUP BY stage ORDER BY total DESC",
            work_params,
        ).fetchall()
        trend_rows = conn.execute(
            f"""
            SELECT date(src.ended_at) AS day, src.status, COUNT(*) AS total
            FROM suite_run_cases src
            JOIN suite_runs sr ON sr.id = src.suite_run_id
            {run_case_where}
            GROUP BY day, src.status
            """,
            run_case_params,
        ).fetchall()
        failure_rows = conn.execute(
            f"""
            SELECT tc.id, tc.external_id, tc.title, COUNT(*) AS failed_count, MAX(src.ended_at) AS last_failed_at
            FROM suite_run_cases src
            JOIN suite_runs sr ON sr.id = src.suite_run_id
            JOIN test_cases tc ON tc.id = src.case_id
            {failed_result_where}
            GROUP BY tc.id, tc.external_id, tc.title
            ORDER BY failed_count DESC, last_failed_at DESC
            LIMIT 6
            """,
            failed_result_params,
        ).fetchall()
        recent_suite_runs = conn.execute(
            f"SELECT * FROM suite_runs {suite_where} ORDER BY started_at DESC LIMIT 8",
            suite_params,
        ).fetchall()
        duration_suite_rows = conn.execute(
            f"SELECT started_at, ended_at FROM suite_runs {duration_where}",
            duration_params,
        ).fetchall()
        recent_single_runs = []
        if scope == "all":
            recent_single_runs = conn.execute("SELECT * FROM runs ORDER BY started_at DESC LIMIT 8").fetchall()
        else:
            recent_single_runs = conn.execute(
                """
                SELECT r.*
                FROM runs r
                JOIN work_items wi ON wi.id = r.work_item_id
                WHERE wi.project_id = ?
                ORDER BY r.started_at DESC
                LIMIT 8
                """,
                (scope,),
            ).fetchall()

    passed = result_totals["passed"] or 0
    failed = result_totals["failed"] or 0
    skipped = result_totals["skipped"] or 0
    executed = passed + failed
    trend = {key: value.copy() for key, value in trend_seed.items()}
    for row in trend_rows:
        day = row["day"]
        status = row["status"]
        if day in trend and status in trend[day]:
            trend[day][status] = row["total"]
            trend[day]["total"] += row["total"]

    recent_runs = [
        {
            "id": row["id"],
            "type": "suite",
            "name": row["name"],
            "status": row["status"],
            "totalCases": row["total_cases"],
            "passedCases": row["passed_cases"],
            "failedCases": row["failed_cases"],
            "skippedCases": row["skipped_cases"],
            "progress": row["progress"],
            "startedAt": row["started_at"],
            "endedAt": row["ended_at"],
        }
        for row in recent_suite_runs
    ] + [
        {
            "id": row["id"],
            "type": "single",
            "name": row["suite_name"],
            "status": row["status"],
            "totalCases": 1,
            "passedCases": 1 if row["status"] == "passed" else 0,
            "failedCases": 1 if row["status"] == "failed" else 0,
            "skippedCases": 1 if row["status"] == "skipped" else 0,
            "progress": row["progress"],
            "startedAt": row["started_at"],
            "endedAt": row["ended_at"],
        }
        for row in recent_single_runs
    ]
    recent_runs = sorted(recent_runs, key=lambda item: item.get("startedAt") or "", reverse=True)[:8]

    return {
        "scopeProjectId": scope,
        "generatedAt": now.isoformat(),
        "totals": {
            "testCases": case_total,
            "automatedCases": automated_cases,
            "failedCases": failed_cases,
            "runningRuns": running_count,
            "activeSuites": active_suites,
            "workItems": work_item_total,
            "suiteRuns": suite_run_total,
            "passedExecutions": passed,
            "failedExecutions": failed,
            "skippedExecutions": skipped,
            "executedCases": passed + failed + skipped,
            "successRate": round((passed / executed) * 100) if executed else 0,
            "automationCoverage": round((automated_cases / case_total) * 100) if case_total else 0,
            "averageDurationSeconds": average_seconds_from_rows(duration_suite_rows, "started_at", "ended_at"),
        },
        "resultDistribution": {"passed": passed, "failed": failed, "skipped": skipped},
        "priorityDistribution": [{"label": row["label"], "total": row["total"]} for row in priority_rows],
        "stageDistribution": [{"label": row["label"], "total": row["total"]} for row in stage_rows],
        "trend": list(trend.values()),
        "failureHotspots": [
            {
                "caseId": row["id"],
                "externalId": row["external_id"],
                "title": row["title"],
                "failedCount": row["failed_count"],
                "lastFailedAt": row["last_failed_at"],
            }
            for row in failure_rows
        ],
        "recentRuns": recent_runs,
    }


def normalize_feature_id(feature_id: str | None) -> str:
    return (feature_id or "").strip()


def get_feature_row(conn: sqlite3.Connection, feature_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM feature_menus WHERE id = ?", (feature_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="功能菜单不存在")
    return row


def validate_feature_parent(conn: sqlite3.Connection, project_id: str, parent_id: str, *, feature_id: str = "") -> str:
    normalized_parent_id = normalize_feature_id(parent_id)
    if not normalized_parent_id:
        return ""
    if normalized_parent_id == feature_id:
        raise HTTPException(status_code=400, detail="不能将功能移动到自身下级")
    parent = get_feature_row(conn, normalized_parent_id)
    if parent["project_id"] != project_id:
        raise HTTPException(status_code=400, detail="父功能必须属于同一项目")
    cursor_id = parent["parent_id"] or ""
    seen = {normalized_parent_id}
    while cursor_id:
        if cursor_id == feature_id:
            raise HTTPException(status_code=400, detail="不能将功能移动到自己的子功能下")
        if cursor_id in seen:
            raise HTTPException(status_code=400, detail="功能菜单层级存在循环")
        seen.add(cursor_id)
        ancestor = conn.execute("SELECT id, parent_id FROM feature_menus WHERE id = ?", (cursor_id,)).fetchone()
        cursor_id = ancestor["parent_id"] if ancestor else ""
    return normalized_parent_id


def feature_case_count(conn: sqlite3.Connection, feature_id: str) -> int:
    return conn.execute("SELECT COUNT(*) AS total FROM test_cases WHERE feature_id = ?", (feature_id,)).fetchone()["total"]


def feature_path_from_rows(row: sqlite3.Row, rows_by_id: dict[str, sqlite3.Row]) -> str:
    names = [row["name"]]
    cursor_id = row["parent_id"] or ""
    seen = {row["id"]}
    while cursor_id and cursor_id not in seen:
        seen.add(cursor_id)
        parent = rows_by_id.get(cursor_id)
        if parent is None:
            break
        names.append(parent["name"])
        cursor_id = parent["parent_id"] or ""
    return " / ".join(reversed(names))


def row_to_feature(row: sqlite3.Row, rows_by_id: dict[str, sqlite3.Row], case_count: int = 0) -> dict[str, Any]:
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "parentId": row["parent_id"] or "",
        "name": row["name"],
        "description": row["description"] or "",
        "sortOrder": row["sort_order"],
        "isActive": bool(row["is_active"]),
        "caseCount": case_count,
        "path": feature_path_from_rows(row, rows_by_id),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def features_payload(conn: sqlite3.Connection, project_id: str) -> dict[str, Any]:
    rows = conn.execute(
        "SELECT * FROM feature_menus WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC",
        (project_id,),
    ).fetchall()
    rows_by_id = {row["id"]: row for row in rows}
    counts = {
        row["feature_id"]: row["total"]
        for row in conn.execute(
            """
            SELECT feature_id, COUNT(*) AS total
            FROM test_cases
            WHERE project_id = ? AND feature_id IS NOT NULL AND feature_id != ''
            GROUP BY feature_id
            """,
            (project_id,),
        ).fetchall()
    }
    items = [row_to_feature(row, rows_by_id, counts.get(row["id"], 0)) for row in rows]
    by_parent: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        by_parent.setdefault(item["parentId"], []).append({**item, "children": []})

    def attach(parent_id: str) -> list[dict[str, Any]]:
        nodes = by_parent.get(parent_id, [])
        for node in nodes:
            node["children"] = attach(node["id"])
        return nodes

    return {"items": items, "tree": attach("")}


def feature_summary(conn: sqlite3.Connection, feature_id: str | None) -> dict[str, str]:
    normalized_feature_id = normalize_feature_id(feature_id)
    if not normalized_feature_id:
        return {"featureId": "", "featureName": "", "featurePath": ""}
    rows = conn.execute("SELECT * FROM feature_menus").fetchall()
    rows_by_id = {row["id"]: row for row in rows}
    row = rows_by_id.get(normalized_feature_id)
    if row is None:
        return {"featureId": normalized_feature_id, "featureName": "", "featurePath": ""}
    return {"featureId": row["id"], "featureName": row["name"], "featurePath": feature_path_from_rows(row, rows_by_id)}


def validate_case_feature(conn: sqlite3.Connection, project_id: str, feature_id: str | None) -> str:
    normalized_feature_id = normalize_feature_id(feature_id)
    if not normalized_feature_id:
        return ""
    feature = get_feature_row(conn, normalized_feature_id)
    if feature["project_id"] != project_id:
        raise HTTPException(status_code=400, detail="功能菜单必须属于用例所在项目")
    return normalized_feature_id


def validate_project_feature(conn: sqlite3.Connection, project_id: str, feature_id: str | None, *, required: bool = False) -> str:
    normalized_feature_id = normalize_feature_id(feature_id)
    if not normalized_feature_id:
        if required:
            raise HTTPException(status_code=400, detail="功能为必填项，请选择当前项目下的功能")
        return ""
    feature = get_feature_row(conn, normalized_feature_id)
    if feature["project_id"] != project_id:
        raise HTTPException(status_code=400, detail="功能必须属于所选项目")
    if not bool(feature["is_active"]):
        raise HTTPException(status_code=400, detail="不能选择已停用功能")
    return normalized_feature_id


def split_markdown_row(line: str) -> list[str]:
    text = line.strip().strip("|")
    cells: list[str] = []
    current = []
    escaped = False
    for char in text:
        if char == "\\" and not escaped:
            escaped = True
            current.append(char)
            continue
        if char == "|" and not escaped:
            cells.append("".join(current).strip())
            current = []
            continue
        escaped = False
        current.append(char)
    cells.append("".join(current).strip())
    return cells


def looks_like_separator(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def parse_cases_markdown(markdown: str) -> list[dict[str, str]]:
    lines = [line for line in markdown.splitlines() if line.strip().startswith("|")]
    if len(lines) < 2:
        return []
    header = [cell.strip() for cell in split_markdown_row(lines[0])]
    rows = lines[1:]
    if rows and looks_like_separator(split_markdown_row(rows[0])):
        rows = rows[1:]
    normalized_headers = [re.sub(r"\s+", "", cell).lower() for cell in header]

    def value(cells: list[str], *names: str) -> str:
        for name in names:
            key = re.sub(r"\s+", "", name).lower()
            if key in normalized_headers:
                index = normalized_headers.index(key)
                return cells[index].strip() if index < len(cells) else ""
        return ""

    cases: list[dict[str, str]] = []
    for row in rows:
        cells = split_markdown_row(row)
        if len(cells) < 3:
            continue
        external_id = value(cells, "ID", "用例ID", "编号") or cells[0].strip()
        title = value(cells, "标题", "用例标题", "名称") or (cells[2].strip() if len(cells) > 2 else external_id)
        if not external_id or not title:
            continue
        cases.append(
            {
                "external_id": external_id,
                "priority": value(cells, "优先级", "Priority") or "P1",
                "title": title,
                "requirement": value(cells, "覆盖需求", "需求", "Coverage"),
                "preconditions": value(cells, "前置条件/测试数据", "前置条件", "测试数据"),
                "steps": value(cells, "步骤", "测试步骤"),
                "expected": value(cells, "期望结果", "预期结果"),
                "automation_notes": value(cells, "自动化说明", "自动化备注"),
            }
        )
    return cases


def extract_playwright_test_titles(script: str) -> list[str]:
    pattern = re.compile(r"\btest(?:\.(?:only|skip|fixme|slow))?\s*\(\s*(['\"`])((?:\\.|(?!\1).)*)\1", re.DOTALL)
    titles: list[str] = []
    for match in pattern.finditer(script):
        title = match.group(2)
        if "\\" in title:
            try:
                title = bytes(title, "utf-8").decode("unicode_escape")
            except UnicodeDecodeError:
                pass
        titles.append(title)
    return titles


def missing_case_ids_in_script(cases_markdown: str, script: str) -> list[str]:
    case_ids = [item["external_id"] for item in parse_cases_markdown(cases_markdown)]
    if not case_ids:
        return []
    titles = extract_playwright_test_titles(script)
    return [case_id for case_id in case_ids if not any(case_id in title for title in titles)]


def validate_script_covers_cases(cases_markdown: str, script: str) -> None:
    missing = missing_case_ids_in_script(cases_markdown, script)
    if missing:
        raise HTTPException(status_code=400, detail=f"脚本未包含以下用例 ID：{', '.join(missing)}")


def sync_test_cases_from_markdown(
    conn: sqlite3.Connection,
    project_id: str,
    work_item_id: str,
    markdown: str,
    spec_path: str = "",
    default_feature_id: str = "",
) -> list[str]:
    parsed = parse_cases_markdown(markdown)
    timestamp = now_iso()
    feature_id = validate_project_feature(conn, project_id, default_feature_id) if default_feature_id else ""
    case_ids: list[str] = []
    for item in parsed:
        existing = conn.execute(
            "SELECT id FROM test_cases WHERE project_id = ? AND external_id = ?",
            (project_id, item["external_id"]),
        ).fetchone()
        case_id = existing["id"] if existing else uuid.uuid4().hex[:12]
        automation_status = "automated" if spec_path else "designed"
        conn.execute(
            """
            INSERT INTO test_cases (
                id, project_id, work_item_id, feature_id, external_id, title, priority,
                requirement, preconditions, steps, expected, automation_notes,
                automation_status, spec_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                work_item_id = excluded.work_item_id,
                feature_id = CASE
                    WHEN excluded.feature_id != '' THEN excluded.feature_id
                    ELSE test_cases.feature_id
                END,
                title = excluded.title,
                priority = excluded.priority,
                requirement = excluded.requirement,
                preconditions = excluded.preconditions,
                steps = excluded.steps,
                expected = excluded.expected,
                automation_notes = excluded.automation_notes,
                automation_status = CASE
                    WHEN test_cases.automation_status = 'automated' THEN test_cases.automation_status
                    ELSE excluded.automation_status
                END,
                spec_path = CASE
                    WHEN excluded.spec_path != '' THEN excluded.spec_path
                    ELSE test_cases.spec_path
                END,
                updated_at = excluded.updated_at
            """,
            (
                case_id,
                project_id,
                work_item_id,
                feature_id,
                item["external_id"],
                item["title"],
                item["priority"],
                item["requirement"],
                item["preconditions"],
                item["steps"],
                item["expected"],
                item["automation_notes"],
                automation_status,
                spec_path,
                timestamp,
                timestamp,
            ),
        )
        case_ids.append(case_id)
    return case_ids


def row_to_test_case(row: sqlite3.Row) -> dict[str, Any]:
    with get_db() as conn:
        feature = feature_summary(conn, row["feature_id"])
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "workItemId": row["work_item_id"],
        **feature,
        "externalId": row["external_id"],
        "title": row["title"],
        "priority": row["priority"],
        "requirement": row["requirement"],
        "preconditions": row["preconditions"],
        "steps": row["steps"],
        "expected": row["expected"],
        "automationNotes": row["automation_notes"],
        "automationStatus": row["automation_status"],
        "specPath": row["spec_path"],
        "latestRunId": row["latest_run_id"],
        "latestStatus": row["latest_status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def summarize_content(content: str, fallback: str = "") -> str:
    text = re.sub(r"\s+", " ", content).strip()
    if not text:
        return fallback
    return text[:180]


def render_inline_markdown(value: str) -> str:
    escaped = html.escape(value)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    return escaped


def markdown_table_to_html(lines: list[str]) -> str:
    rows = []
    for line in lines:
        cells = [render_inline_markdown(cell.strip()) for cell in line.strip().strip("|").split("|")]
        rows.append(cells)
    if len(rows) <= 2:
        return ""
    header = "".join(f"<th>{cell}</th>" for cell in rows[0])
    body = "".join(
        "<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>"
        for row in rows[2:]
    )
    return f"<table><thead><tr>{header}</tr></thead><tbody>{body}</tbody></table>"


def render_markdown_report(markdown: str) -> str:
    html_parts: list[str] = []
    paragraph: list[str] = []
    table_lines: list[str] = []
    list_open = False
    code_open = False

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            html_parts.append(f"<p>{render_inline_markdown(' '.join(paragraph))}</p>")
            paragraph = []

    def flush_table() -> None:
        nonlocal table_lines
        if table_lines:
            rendered = markdown_table_to_html(table_lines)
            if rendered:
                html_parts.append(rendered)
            else:
                html_parts.extend(f"<p>{render_inline_markdown(line)}</p>" for line in table_lines)
            table_lines = []

    def close_list() -> None:
        nonlocal list_open
        if list_open:
            html_parts.append("</ul>")
            list_open = False

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if line.strip().startswith("```"):
            flush_paragraph()
            flush_table()
            close_list()
            if code_open:
                html_parts.append("</code></pre>")
            else:
                html_parts.append("<pre><code>")
            code_open = not code_open
            continue
        if code_open:
            html_parts.append(html.escape(raw_line) + "\n")
            continue
        if line.startswith("|") and line.endswith("|"):
            flush_paragraph()
            close_list()
            table_lines.append(line)
            continue
        flush_table()
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            close_list()
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            close_list()
            level = min(len(heading.group(1)) + 1, 5)
            html_parts.append(f"<h{level}>{render_inline_markdown(heading.group(2))}</h{level}>")
            continue
        bullet = re.match(r"^[-*]\s+(.+)$", stripped)
        if bullet:
            flush_paragraph()
            if not list_open:
                html_parts.append("<ul>")
                list_open = True
            html_parts.append(f"<li>{render_inline_markdown(bullet.group(1))}</li>")
            continue
        paragraph.append(stripped)

    flush_paragraph()
    flush_table()
    close_list()
    if code_open:
        html_parts.append("</code></pre>")
    return "\n".join(html_parts)


def rendered_report_page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(title)}</title>
  <style>
    :root {{ color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    body {{ margin: 0; background: #f6f8fb; color: #172033; }}
    main {{ width: min(1080px, calc(100vw - 40px)); margin: 32px auto; background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 32px; box-shadow: 0 18px 50px rgba(22, 34, 51, 0.08); }}
    h1 {{ margin: 0 0 20px; font-size: 26px; }}
    h2, h3, h4, h5 {{ margin: 28px 0 12px; color: #0f172a; }}
    p, li {{ line-height: 1.72; }}
    p code, li code {{ background: #eef3f9; border-radius: 4px; padding: 2px 5px; color: #172033; }}
    pre {{ overflow: auto; background: #0f172a; color: #e5edf7; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; font: 14px/1.65 Menlo, Consolas, "Liberation Mono", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }}
    pre code {{ background: transparent; border-radius: 0; padding: 0; color: inherit; font: inherit; }}
    table {{ width: 100%; border-collapse: collapse; margin: 16px 0 24px; font-size: 14px; }}
    th, td {{ border: 1px solid #d9e2ef; padding: 10px 12px; text-align: left; vertical-align: top; }}
    th {{ background: #f1f5f9; }}
    .meta {{ margin-bottom: 24px; color: #64748b; }}
  </style>
</head>
<body>
  <main>
    <h1>{html.escape(title)}</h1>
    <div class="meta">由 QA 自动化测试平台渲染</div>
    {body}
  </main>
</body>
</html>"""


def register_deliverable(
    conn: sqlite3.Connection,
    project_id: str,
    deliverable_type: str,
    name: str,
    file_path: str | Path,
    *,
    work_item_id: str = "",
    case_id: str = "",
    run_id: str = "",
    feature_id: str = "",
    status: str = "ready",
    summary: str = "",
    bump_version: bool = True,
) -> str:
    normalized_path = relative_or_absolute(file_path)
    normalized_feature_id = validate_project_feature(conn, project_id, feature_id) if feature_id else ""
    existing = conn.execute(
        """
        SELECT id, version FROM deliverables
        WHERE project_id = ? AND type = ? AND file_path = ?
        """,
        (project_id, deliverable_type, normalized_path),
    ).fetchone()
    deliverable_id = existing["id"] if existing else uuid.uuid4().hex[:12]
    version = (existing["version"] + 1) if existing and bump_version else existing["version"] if existing else 1
    timestamp = now_iso()
    conn.execute(
        """
        INSERT INTO deliverables (
            id, project_id, work_item_id, case_id, run_id, feature_id, type, name, status,
            version, file_path, summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            work_item_id = excluded.work_item_id,
            case_id = excluded.case_id,
            run_id = excluded.run_id,
            feature_id = excluded.feature_id,
            name = excluded.name,
            status = excluded.status,
            version = excluded.version,
            summary = excluded.summary,
            updated_at = excluded.updated_at
        """,
        (
            deliverable_id,
            project_id,
            work_item_id,
            case_id,
            run_id,
            normalized_feature_id,
            deliverable_type,
            name,
            status,
            version,
            normalized_path,
            summary,
            timestamp,
            timestamp,
        ),
    )
    return deliverable_id


def project_deliverable_dir(project_slug: str, work_item_slug: str) -> Path:
    return PROJECT_ARTIFACT_DIR / project_slug / "deliverables" / work_item_slug


def spec_path_for_case_doc(case_path: Path) -> Path:
    suffix = "-test-cases.md"
    if case_path.name.endswith(suffix):
        return case_path.with_name(f"{case_path.name[:-len(suffix)]}.spec.ts")
    return case_path.with_suffix(".spec.ts")


def row_to_deliverable(row: sqlite3.Row, include_content: bool = False) -> dict[str, Any]:
    with get_db() as conn:
        feature = feature_summary(conn, row["feature_id"] if "feature_id" in row.keys() else "")
    payload = {
        "id": row["id"],
        "projectId": row["project_id"],
        "workItemId": row["work_item_id"],
        "caseId": row["case_id"],
        "runId": row["run_id"],
        **feature,
        "type": row["type"],
        "name": row["name"],
        "status": row["status"],
        "version": row["version"],
        "filePath": row["file_path"],
        "summary": row["summary"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "content": "",
    }
    if include_content:
        path = resolve_workspace_path(row["file_path"])
        if path.exists() and path.is_file() and path.stat().st_size <= 512_000:
            with contextlib.suppress(UnicodeDecodeError, OSError):
                payload["content"] = path.read_text(encoding="utf-8")
    return payload


def row_to_work_item_summary(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    with get_db() as conn:
        feature = feature_summary(conn, row["feature_id"] if "feature_id" in row.keys() else "")
    return {
        "id": row["id"],
        "projectId": row["project_id"] if "project_id" in row.keys() else "",
        **feature,
        "slug": row["slug"],
        "title": row["title"],
        "requirement": row["requirement"],
        "stage": row["stage"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def deliverable_case_match_sql(alias: str = "d") -> str:
    return f"""
        {alias}.project_id = tc.project_id
        AND (
            ({alias}.case_id IS NOT NULL AND {alias}.case_id != '' AND {alias}.case_id = tc.id)
            OR (
                ({alias}.case_id IS NULL OR {alias}.case_id = '')
                AND tc.work_item_id IS NOT NULL AND tc.work_item_id != ''
                AND {alias}.work_item_id IS NOT NULL AND {alias}.work_item_id != ''
                AND {alias}.work_item_id = tc.work_item_id
            )
            OR (
                ({alias}.case_id IS NULL OR {alias}.case_id = '')
                AND ({alias}.work_item_id IS NULL OR {alias}.work_item_id = '')
                AND tc.spec_path IS NOT NULL AND tc.spec_path != ''
                AND {alias}.file_path = tc.spec_path
            )
            OR (
                ({alias}.case_id IS NULL OR {alias}.case_id = '')
                AND ({alias}.work_item_id IS NULL OR {alias}.work_item_id = '')
                AND tc.spec_path IS NOT NULL AND tc.spec_path != ''
                AND {alias}.type = 'test-cases'
                AND {alias}.file_path = replace(tc.spec_path, '.spec.ts', '-test-cases.md')
            )
        )
    """


def row_to_delivery_report_item(conn: sqlite3.Connection, case_row: sqlite3.Row) -> dict[str, Any]:
    project_row = conn.execute("SELECT * FROM projects WHERE id = ?", (case_row["project_id"],)).fetchone()
    work_item_row = conn.execute("SELECT * FROM work_items WHERE id = ?", (case_row["work_item_id"] or "",)).fetchone()
    run_row = None
    if case_row["latest_run_id"]:
        run_row = conn.execute("SELECT * FROM runs WHERE id = ?", (case_row["latest_run_id"],)).fetchone()
    if run_row is None and case_row["work_item_id"]:
        run_row = conn.execute(
            "SELECT * FROM runs WHERE work_item_id = ? ORDER BY started_at DESC LIMIT 1",
            (case_row["work_item_id"],),
        ).fetchone()
    deliverable_rows = conn.execute(
        """
        SELECT DISTINCT d.*
        FROM deliverables d
        WHERE d.project_id = ?
          AND (
              (d.case_id IS NOT NULL AND d.case_id != '' AND d.case_id = ?)
              OR (
                  (d.case_id IS NULL OR d.case_id = '')
                  AND ? != ''
                  AND d.work_item_id IS NOT NULL AND d.work_item_id != ''
                  AND d.work_item_id = ?
              )
              OR (
                  (d.case_id IS NULL OR d.case_id = '')
                  AND (d.work_item_id IS NULL OR d.work_item_id = '')
                  AND ? != ''
                  AND d.file_path = ?
              )
              OR (
                  (d.case_id IS NULL OR d.case_id = '')
                  AND (d.work_item_id IS NULL OR d.work_item_id = '')
                  AND ? != ''
                  AND d.type = 'test-cases'
                  AND d.file_path = ?
              )
          )
        ORDER BY d.updated_at DESC, d.version DESC
        """,
        (
            case_row["project_id"],
            case_row["id"],
            case_row["work_item_id"] or "",
            case_row["work_item_id"] or "",
            case_row["spec_path"] or "",
            case_row["spec_path"] or "",
            case_row["spec_path"] or "",
            (case_row["spec_path"] or "").replace(".spec.ts", "-test-cases.md"),
        ),
    ).fetchall()
    deliverables_payload = [row_to_deliverable(row, include_content=False) for row in deliverable_rows]
    deliverable_summary: dict[str, Any] = {}
    for deliverable in deliverables_payload:
        deliverable_summary.setdefault(deliverable["type"], deliverable)
    updated_candidates = [case_row["updated_at"]]
    updated_candidates.extend(row["updated_at"] for row in deliverable_rows if row["updated_at"])
    updated_at = max(updated_candidates) if updated_candidates else case_row["updated_at"]
    return {
        "case": row_to_test_case(case_row),
        "project": row_to_project(project_row) if project_row else None,
        "workItem": row_to_work_item_summary(work_item_row),
        "latestRun": row_to_run(run_row) if run_row else None,
        "deliverables": deliverables_payload,
        "deliverableSummary": deliverable_summary,
        "updatedAt": updated_at,
    }


def migrate_project_case_deliverable_data(conn: sqlite3.Connection) -> None:
    project_id = ensure_default_project(conn)
    conn.execute("UPDATE work_items SET project_id = ? WHERE project_id IS NULL OR project_id = ''", (project_id,))
    rows = conn.execute("SELECT * FROM work_items").fetchall()
    for row in rows:
        cases_path = row["cases_path"] if "cases_path" in row.keys() else ""
        spec_path = row["spec_path"] if "spec_path" in row.keys() else ""
        report_path = row["report_path"] if "report_path" in row.keys() else ""
        cases_content = ""
        if cases_path and resolve_workspace_path(cases_path).exists():
            with contextlib.suppress(OSError, UnicodeDecodeError):
                cases_content = resolve_workspace_path(cases_path).read_text(encoding="utf-8")
        if not cases_content:
            latest = conn.execute(
                "SELECT content FROM generated_cases WHERE work_item_id = ? ORDER BY id DESC LIMIT 1",
                (row["id"],),
            ).fetchone()
            cases_content = latest["content"] if latest else ""
        case_ids = sync_test_cases_from_markdown(conn, project_id, row["id"], cases_content, relative_or_absolute(spec_path) if spec_path else "") if cases_content else []
        for deliverable_type, path_value, name in [
            ("test-cases", cases_path, f"{row['title']} 测试用例"),
            ("spec", spec_path, f"{row['title']} 自动化脚本"),
            ("manual-report", report_path, f"{row['title']} 人工测试报告"),
        ]:
            if path_value and resolve_workspace_path(path_value).exists():
                register_deliverable(
                    conn,
                    project_id,
                    deliverable_type,
                    name,
                    path_value,
                    work_item_id=row["id"],
                    case_id=case_ids[0] if len(case_ids) == 1 else "",
                    run_id=row["latest_run_id"] or "",
                    summary=f"从历史工单 {row['title']} 迁移登记。",
                    bump_version=False,
                )

    test_dir = ROOT_DIR / project_context().get("testDir", "tests/e2e")
    if test_dir.exists():
        for case_path in test_dir.glob("*-test-cases.md"):
            with contextlib.suppress(OSError, UnicodeDecodeError):
                content = case_path.read_text(encoding="utf-8")
                sibling_spec_path = spec_path_for_case_doc(case_path)
                sibling_spec = relative_or_absolute(sibling_spec_path) if sibling_spec_path.exists() else ""
                case_ids = sync_test_cases_from_markdown(conn, project_id, "", content, sibling_spec)
                register_deliverable(
                    conn,
                    project_id,
                    "test-cases",
                    case_path.name,
                    case_path,
                    case_id=case_ids[0] if len(case_ids) == 1 else "",
                    summary="从仓库测试用例文档扫描登记。",
                    bump_version=False,
                )
                if sibling_spec_path.exists():
                    for case_id in case_ids:
                        register_deliverable(
                            conn,
                            project_id,
                            "spec",
                            sibling_spec_path.name,
                            sibling_spec_path,
                            case_id=case_id,
                            summary="从同名用例文档关联 Playwright spec。",
                            bump_version=False,
                        )
        for spec_path in test_dir.glob("*.spec.ts"):
            register_deliverable(
                conn,
                project_id,
                "spec",
                spec_path.name,
                spec_path,
                summary="从仓库 Playwright spec 扫描登记。",
                bump_version=False,
            )
    for report_path in ROOT_DIR.glob("*-test-report.md"):
        register_deliverable(
            conn,
            project_id,
            "manual-report",
            report_path.name,
            report_path,
            summary="从仓库人工测试报告扫描登记。",
            bump_version=False,
        )
    if REPORT_INDEX.exists():
        register_deliverable(
            conn,
            project_id,
            "html-report",
            "Playwright HTML Report",
            REPORT_INDEX,
            summary="从已有 Playwright HTML Report 扫描登记。",
            bump_version=False,
        )


def get_setting(key: str) -> str:
    with get_db() as conn:
        row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else ""


def set_setting(key: str, value: str) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, now_iso()),
        )


DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"


def normalize_openai_base_url(value: str) -> str:
    base_url = (value or DEFAULT_OPENAI_BASE_URL).strip()
    if not base_url:
        return DEFAULT_OPENAI_BASE_URL
    base_url = base_url.rstrip("/")
    if base_url.endswith("/responses"):
        base_url = base_url[: -len("/responses")].rstrip("/")
    return base_url or DEFAULT_OPENAI_BASE_URL


def validate_openai_base_url(base_url: str) -> None:
    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="Base URL 必须以 http:// 或 https:// 开头")


def get_openai_api_key() -> str:
    if os.environ.get("QA_DISABLE_AI") == "1":
        return ""
    return os.environ.get("OPENAI_API_KEY") or get_setting("openai_api_key")


def get_openai_model() -> str:
    return get_setting("openai_model") or "gpt-4.1-mini"


def get_openai_base_url() -> str:
    return normalize_openai_base_url(os.environ.get("OPENAI_BASE_URL") or get_setting("openai_base_url"))


def build_openai_url(path: str, base_url: str | None = None) -> str:
    normalized_base = normalize_openai_base_url(base_url or get_openai_base_url())
    return f"{normalized_base}/{path.lstrip('/')}"


def parse_openai_text_response(body: dict[str, Any]) -> str:
    text_chunks: list[str] = []
    for item_payload in body.get("output", []):
        for content in item_payload.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                text_chunks.append(content["text"])
    if not text_chunks and body.get("output_text"):
        text_chunks.append(body["output_text"])
    return "\n".join(text_chunks)


def openai_error_message(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        detail = ""
        try:
            body = json.loads(exc.read().decode("utf-8"))
            if isinstance(body.get("error"), dict):
                detail = body["error"].get("message", "")
            elif body.get("detail"):
                detail = str(body["detail"])
        except (json.JSONDecodeError, UnicodeDecodeError):
            detail = ""
        status_messages = {
            401: "鉴权失败，请检查 API Key",
            403: "请求被拒绝，请检查 API Key 权限或网关访问策略",
            404: "接口不存在，请确认 Base URL 支持 /responses",
            429: "请求被限流，请稍后重试或检查额度",
        }
        prefix = status_messages.get(exc.code, f"服务返回 HTTP {exc.code}")
        return f"{prefix}{f'：{detail}' if detail else ''}"
    if isinstance(exc, TimeoutError):
        return "连接超时，请检查 Base URL、网络或网关响应速度"
    if isinstance(exc, urllib.error.URLError):
        reason = getattr(exc, "reason", exc)
        return f"连接失败，请检查 Base URL：{reason}"
    if isinstance(exc, json.JSONDecodeError):
        return "服务返回内容不是有效 JSON，请确认网关兼容 OpenAI Responses API"
    return str(exc) or "连接测试失败"


def call_openai_responses(api_key: str, model: str, base_url: str, payload: dict[str, Any], timeout: int = 6) -> dict[str, Any]:
    url = build_openai_url("/responses", base_url)
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    hostname = urllib.parse.urlparse(url).hostname or ""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if hostname in {"localhost", "127.0.0.1", "::1"} else urllib.request.build_opener()
    with opener.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_openai_stream_delta(event: dict[str, Any]) -> str:
    event_type = str(event.get("type") or "")
    if event_type in {"response.output_text.delta", "response.refusal.delta"}:
        return str(event.get("delta") or "")
    if event_type in {"response.text.delta", "output_text.delta", "text.delta"}:
        return str(event.get("delta") or event.get("text") or "")
    if event_type == "response.output_item.done":
        item = event.get("item") or {}
        text_chunks: list[str] = []
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                text_chunks.append(content["text"])
        return "\n".join(text_chunks)
    return ""


def call_openai_responses_stream(
    api_key: str,
    model: str,
    base_url: str,
    payload: dict[str, Any],
    artifact_id: str,
    timeout: int = 24,
) -> str:
    url = build_openai_url("/responses", base_url)
    stream_payload = {**payload, "model": model, "stream": True}
    request = urllib.request.Request(
        url,
        data=json.dumps(stream_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    hostname = urllib.parse.urlparse(url).hostname or ""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if hostname in {"localhost", "127.0.0.1", "::1"} else urllib.request.build_opener()
    chunks: list[str] = []
    seen_output_item_done = False
    with opener.open(request, timeout=timeout) as response:
        event_lines: list[str] = []
        while True:
            raw = response.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            if not line:
                data_lines = [item[5:].strip() for item in event_lines if item.startswith("data:")]
                event_lines = []
                if not data_lines:
                    continue
                data = "\n".join(data_lines)
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = extract_openai_stream_delta(event)
                if not delta:
                    continue
                if event.get("type") == "response.output_item.done":
                    seen_output_item_done = True
                    if chunks:
                        continue
                chunks.append(delta)
                append_flow_artifact_content(artifact_id, delta)
                continue
            event_lines.append(line)
    text = "".join(chunks)
    return text if not seen_output_item_done else text.strip()


def current_ai_status() -> dict[str, Any]:
    if os.environ.get("QA_DISABLE_AI") == "1":
        return {
            "configured": False,
            "provider": "disabled-for-test",
            "source": "disabled",
            "model": get_openai_model(),
            "baseUrl": get_openai_base_url(),
            "baseUrlSource": "disabled",
            "baseUrlLocked": False,
        }
    env_key = os.environ.get("OPENAI_API_KEY")
    local_key = get_setting("openai_api_key")
    source = "env" if env_key else "local" if local_key else "none"
    configured = source != "none"
    env_base_url = os.environ.get("OPENAI_BASE_URL")
    local_base_url = get_setting("openai_base_url")
    base_url_source = "env" if env_base_url else "local" if local_base_url else "default"
    return {
        "configured": configured,
        "provider": "openai" if configured else "not-configured",
        "source": source,
        "model": get_openai_model(),
        "baseUrl": get_openai_base_url(),
        "baseUrlSource": base_url_source,
        "baseUrlLocked": bool(env_base_url),
    }


def latest_content(conn: sqlite3.Connection, table: str, work_item_id: str) -> str:
    row = conn.execute(
        f"SELECT content FROM {table} WHERE work_item_id = ? ORDER BY id DESC LIMIT 1",
        (work_item_id,),
    ).fetchone()
    return row["content"] if row else ""


def first_existing_script(script_names: list[str]) -> str:
    package_path = ROOT_DIR / "package.json"
    if not package_path.exists():
        return ""
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return ""
    scripts = package.get("scripts", {})
    for name in script_names:
        if name in scripts:
            return f"{name}: {scripts[name]}"
    return ""


def project_context() -> dict[str, Any]:
    test_dir = "tests/e2e"
    config_path = ROOT_DIR / "playwright.config.ts"
    config_text = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    test_dir_match = re.search(r"testDir:\s*['\"]([^'\"]+)['\"]", config_text)
    if test_dir_match:
        test_dir = test_dir_match.group(1).replace("./", "")

    spec_files = sorted(str(path.relative_to(ROOT_DIR)) for path in (ROOT_DIR / test_dir).glob("*.spec.ts")) if (ROOT_DIR / test_dir).exists() else []
    case_files = sorted(str(path.relative_to(ROOT_DIR)) for path in (ROOT_DIR / test_dir).glob("*-test-cases.md")) if (ROOT_DIR / test_dir).exists() else []
    helper_dirs = [name for name in ["fixtures", "fixture", "page-objects", "pageObjects", "helpers", "test-data", "data"] if (ROOT_DIR / test_dir / name).exists()]
    sample_text = ""
    if spec_files:
        sample_path = ROOT_DIR / spec_files[0]
        with contextlib.suppress(OSError):
            sample_text = sample_path.read_text(encoding="utf-8")[:4000]
    locator_style = []
    for token, label in [
        ("getByRole", "getByRole"),
        ("getByLabel", "getByLabel"),
        ("getByPlaceholder", "getByPlaceholder"),
        ("getByText", "getByText"),
        ("data-testid", "data-testid"),
        ("data-test", "data-test"),
        ("toBeVisible", "web-first assertions"),
    ]:
        if token in sample_text or token in config_text:
            locator_style.append(label)
    return {
        "flow": QA_FLOW,
        "playwrightConfig": "playwright.config.ts" if config_path.exists() else "未发现 Playwright 配置",
        "testDir": test_dir,
        "specPattern": "*.spec.ts",
        "casePattern": "*-test-cases.md",
        "testScript": first_existing_script(["test:e2e", "test", "e2e"]),
        "reporter": "list + html" if "html" in config_text else "未在配置中确认 HTML reporter",
        "existingSpecs": len(spec_files),
        "existingCaseDocs": len(case_files),
        "helperDirs": helper_dirs,
        "helperSummary": "、".join(helper_dirs) if helper_dirs else "未发现独立 fixture/page object/helper/test data 目录",
        "locatorStyle": "、".join(dict.fromkeys(locator_style)) if locator_style else "优先使用语义 locator 和稳定 data-test/testid",
        "summary": f"已检查 Playwright 配置、package 脚本、{test_dir} 下已有 spec 与用例文档；遵循 {test_dir} + *.spec.ts 约定。",
    }


def fallback_requirement_analysis(
    requirement: str,
    target_url: str = "",
    role: str = "",
    test_data: str = "",
    acceptance: str = "",
    exclusions: str = "",
    source: str = "rule",
) -> dict[str, Any]:
    extracted_url = target_url or extract_requirement_url(requirement)
    extracted_role = role or extract_labeled_phrase(requirement, ["角色为", "角色：", "角色:", "用户为", "账号为"])
    extracted_test_data = test_data or extract_labeled_phrase(requirement, ["测试数据为", "测试数据：", "测试数据:", "数据为"])
    extracted_exclusions = exclusions or extract_exclusions(requirement)
    extracted_acceptance = acceptance or extract_acceptance(requirement)
    missing = []
    if not extracted_url:
        missing.append("目标 URL")
    if not extracted_test_data:
        missing.append("测试数据")
    if not extracted_acceptance:
        missing.append("验收标准")
    return {
        "goal": requirement,
        "userPath": extracted_acceptance or requirement,
        "role": extracted_role or "未明确角色，默认按普通终端用户处理",
        "testData": extracted_test_data or "未提供测试数据，生成脚本前需补齐或在探索中确认",
        "environment": extracted_url or "未提供目标 URL",
        "acceptance": extracted_acceptance or "未提供明确验收标准，测试用例将以需求描述为覆盖依据",
        "exclusions": extracted_exclusions or "未明确要求的视觉细节、非目标浏览器和无关业务流程默认范围外",
        "missing": missing,
        "clarificationNeeded": bool(missing),
        "source": source,
    }


def normalize_requirement_analysis(raw: dict[str, Any], requirement: str, source: str) -> dict[str, Any]:
    fallback = fallback_requirement_analysis(requirement, source=source)
    raw_environment = str(raw.get("environment") or "").strip()
    environment = raw_environment if raw_environment else fallback["environment"]
    if not environment.startswith(("http://", "https://")):
        environment = extract_requirement_url(requirement) or environment
    normalized = {
        "goal": str(raw.get("goal") or fallback["goal"]).strip(),
        "userPath": str(raw.get("userPath") or raw.get("user_path") or fallback["userPath"]).strip(),
        "acceptance": str(raw.get("acceptance") or fallback["acceptance"]).strip(),
        "role": str(raw.get("role") or fallback["role"]).strip(),
        "testData": str(raw.get("testData") or raw.get("test_data") or fallback["testData"]).strip(),
        "environment": environment,
        "exclusions": str(raw.get("exclusions") or fallback["exclusions"]).strip(),
        "source": source,
    }
    missing = raw.get("missing")
    if not isinstance(missing, list):
        missing = []
    normalized["missing"] = [str(item).strip() for item in missing if str(item).strip()]
    normalized["clarificationNeeded"] = bool(raw.get("clarificationNeeded", raw.get("clarification_needed", normalized["missing"])))
    return normalized


def analyze_requirement_with_ai(requirement: str) -> dict[str, Any]:
    api_key = get_openai_api_key()
    if not api_key:
        return fallback_requirement_analysis(requirement, source="fallback")
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "goal": {"type": "string"},
            "userPath": {"type": "string"},
            "acceptance": {"type": "string"},
            "role": {"type": "string"},
            "testData": {"type": "string"},
            "environment": {"type": "string"},
            "exclusions": {"type": "string"},
            "missing": {"type": "array", "items": {"type": "string"}},
            "clarificationNeeded": {"type": "boolean"},
        },
        "required": ["goal", "userPath", "acceptance", "role", "testData", "environment", "exclusions", "missing", "clarificationNeeded"],
    }
    prompt = f"""你是资深 QA 自动化测试专家。请从用户需求文本中提取结构化测试需求信息。
只提取需求里能直接推断的内容；无法确认的信息放入 missing。
未明确要求的视觉细节、非目标浏览器和无关业务流程默认写入 exclusions。

用户需求：
{requirement}
"""
    payload = {
        "model": get_openai_model(),
        "input": prompt,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "requirement_analysis",
                "schema": schema,
                "strict": True,
            }
        },
    }
    try:
        body = call_openai_responses(api_key, get_openai_model(), get_openai_base_url(), payload, timeout=12)
        parsed = json.loads(parse_openai_text_response(body))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return fallback_requirement_analysis(requirement, source="fallback")
    return normalize_requirement_analysis(parsed, requirement, "ai")


def extract_requirement_url(requirement: str) -> str:
    match = re.search(r"https?://[^\s，。；;]+", requirement)
    return match.group(0) if match else ""


def extract_labeled_phrase(requirement: str, labels: list[str]) -> str:
    for label in labels:
        pattern = rf"{re.escape(label)}\s*([^。；;\n]+)"
        match = re.search(pattern, requirement)
        if match:
            return match.group(1).strip(" ，,")
    return ""


def extract_exclusions(requirement: str) -> str:
    match = re.search(r"(不覆盖|排除|无需覆盖|不需要覆盖)\s*([^。\n]+)", requirement)
    return match.group(0).strip(" 。") if match else ""


def extract_acceptance(requirement: str) -> str:
    match = re.search(r"(验证|确保|应当|需要|可以)\s*([^。]+)", requirement)
    return match.group(0).strip(" 。") if match else ""


def compact_title_text(value: str, max_length: int = 28) -> str:
    text = re.sub(r"https?://[^\s，。；;]+", "", value or "")
    text = re.sub(r"[#*_`|<>\[\]{}]", "", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"(?<=[\u4e00-\u9fff]) (?=[\u4e00-\u9fff])", "", text)
    text = text.strip(" ：:，,。；;、-")
    if not text:
        return ""
    return text[:max_length].strip(" ：:，,。；;、-")


def placeholder_title_text(value: str) -> bool:
    text = (value or "").lower()
    return any(marker in text for marker in ["未提供", "未明确", "需补齐", "默认范围外"])


def with_validation_suffix(value: str, max_length: int = 28) -> str:
    title = compact_title_text(value, max_length)
    if not title or re.search(r"(验证|测试|校验|检查)$", title):
        return title
    suffix = "验证"
    base = compact_title_text(title, max_length - len(suffix))
    return f"{base}{suffix}" if base else suffix


def title_segment_before_detail(value: str) -> str:
    text = value or ""
    without_urls = re.sub(r"https?://[^\s，。；;]+", "", text)
    labeled_title = re.match(r"^\s*(.{4,40}?)[：:]\s*(验证|确保|需要|测试|检查|覆盖|完成)", without_urls)
    if labeled_title:
        text = labeled_title.group(1)
    else:
        text = re.split(r"[：:。；;\n.]", without_urls, maxsplit=1)[0]
    text = re.sub(r"^(请|需要|验证|确保|测试|检查|覆盖|完成|实现|针对|对)", "", text)
    text = re.sub(r"(角色为|角色：|角色:|测试数据为|测试数据：|验收标准为|验收标准：|不覆盖|排除).*$", "", text)
    return text


def extract_environment_name(environment: str) -> str:
    if not environment:
        return ""
    if placeholder_title_text(environment):
        return ""
    parsed = urllib.parse.urlparse(environment if re.match(r"https?://", environment) else f"https://{environment}")
    host = parsed.netloc or parsed.path
    host = host.split("@")[-1].split(":")[0].lower()
    if not host or host in {"未提供目标url", "未提供目标", "localhost", "127.0.0.1"}:
        return ""
    parts = [part for part in host.split(".") if part and part not in {"www", "com", "cn", "net", "org", "io", "test"}]
    if not parts:
        return ""
    return " ".join(part.capitalize() if part.isalpha() else part for part in parts[:2])


def qa_short_title(requirement: str, analysis: dict[str, Any]) -> str:
    environment_name = extract_environment_name(str(analysis.get("environment") or extract_requirement_url(requirement) or ""))
    candidates = [
        str(analysis.get("goal") or ""),
        str(analysis.get("userPath") or ""),
        str(analysis.get("acceptance") or ""),
        requirement,
    ]
    feature = ""
    for candidate in candidates:
        if placeholder_title_text(candidate):
            continue
        feature = compact_title_text(title_segment_before_detail(candidate), 20)
        if feature and feature != compact_title_text(requirement, 20):
            break
    if not feature:
        feature = compact_title_text(title_segment_before_detail(requirement), 20)
    if environment_name and feature and environment_name.lower().replace(" ", "") not in feature.lower():
        title = f"{environment_name} {feature}"
    else:
        title = feature or environment_name
    title = with_validation_suffix(title, 28)
    if len(title) >= 12:
        return title
    if title:
        return f"{title}自动化测试"[:28]
    return f"自动化测试任务-{datetime.now().strftime('%Y%m%d-%H%M')}"


def title_from_analysis(requirement: str, analysis: dict[str, Any]) -> str:
    return qa_short_title(requirement, analysis)


def requirement_analysis(row: sqlite3.Row) -> dict[str, Any]:
    stored = safe_json_loads(row["analysis_json"] if "analysis_json" in row.keys() else None, {})
    if stored:
        return normalize_requirement_analysis(stored, row["requirement"], stored.get("source", "stored"))
    return fallback_requirement_analysis(
        row["requirement"],
        row["target_url"],
        row["role"],
        row["test_data"],
        row["acceptance"],
        row["exclusions"],
    )


def row_to_work_item(row: sqlite3.Row, include_detail: bool = False) -> dict[str, Any]:
    project_id = row["project_id"] if "project_id" in row.keys() and row["project_id"] else DEFAULT_PROJECT_ID
    with get_db() as conn:
        feature = feature_summary(conn, row["feature_id"] if "feature_id" in row.keys() else "")
    payload = {
        "id": row["id"],
        "projectId": project_id,
        **feature,
        "slug": row["slug"],
        "title": row["title"],
        "requirement": row["requirement"],
        "targetUrl": row["target_url"],
        "role": row["role"],
        "testData": row["test_data"],
        "acceptance": row["acceptance"],
        "exclusions": row["exclusions"],
        "stage": row["stage"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "casesPath": row["cases_path"],
        "specPath": row["spec_path"],
        "reportPath": row["report_path"],
        "latestRunId": row["latest_run_id"],
        "requirementAnalysis": requirement_analysis(row),
        "projectContext": project_context(),
    }
    if include_detail:
        with get_db() as conn:
            project_row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            payload["project"] = row_to_project(project_row) if project_row else None
            payload["explorations"] = [
                {
                    "id": item["id"],
                    "notes": item["notes"],
                    "screenshotPath": item["screenshot_path"],
                    "pageStructure": item["page_structure"],
                    "createdAt": item["created_at"],
                }
                for item in conn.execute(
                    "SELECT * FROM explorations WHERE work_item_id = ? ORDER BY id DESC",
                    (row["id"],),
                ).fetchall()
            ]
            payload["elements"] = [
                {
                    "id": item["id"],
                    "area": item["area"],
                    "name": item["name"],
                    "locatorType": item["locator_type"],
                    "locatorValue": item["locator_value"],
                    "source": item["source"],
                    "confirmed": bool(item["confirmed"]),
                    "stepIndex": item["step_index"] if "step_index" in item.keys() else None,
                    "sourceUrl": item["source_url"] if "source_url" in item.keys() else "",
                    "screenshotPath": item["screenshot_path"] if "screenshot_path" in item.keys() else "",
                }
                for item in conn.execute(
                    "SELECT * FROM confirmed_elements WHERE work_item_id = ? ORDER BY id ASC",
                    (row["id"],),
                ).fetchall()
            ]
            payload["casesMarkdown"] = latest_content(conn, "generated_cases", row["id"])
            payload["scriptContent"] = latest_content(conn, "generated_scripts", row["id"])
            payload["testCases"] = [
                row_to_test_case(item)
                for item in conn.execute(
                    "SELECT * FROM test_cases WHERE work_item_id = ? ORDER BY priority ASC, external_id ASC",
                    (row["id"],),
                ).fetchall()
            ]
            payload["deliverables"] = [
                row_to_deliverable(item, include_content=True)
                for item in conn.execute(
                    "SELECT * FROM deliverables WHERE work_item_id = ? ORDER BY updated_at DESC",
                    (row["id"],),
                ).fetchall()
            ]
            payload["healingAttempts"] = [
                {
                    "id": item["id"],
                    "round": item["round"],
                    "failureSummary": item["failure_summary"],
                    "proposedFix": item["proposed_fix"],
                    "result": item["result"],
                    "createdAt": item["created_at"],
                }
                for item in conn.execute(
                    "SELECT * FROM healing_attempts WHERE work_item_id = ? ORDER BY round ASC",
                    (row["id"],),
                ).fetchall()
            ]
    return payload


def get_work_item_row(work_item_id: str) -> sqlite3.Row:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM work_items WHERE id = ?", (work_item_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Work item not found")
    return row


def update_work_item(work_item_id: str, **fields: Any) -> None:
    fields["updated_at"] = now_iso()
    keys = ", ".join(f"{key} = ?" for key in fields)
    with get_db() as conn:
        conn.execute(f"UPDATE work_items SET {keys} WHERE id = ?", [*fields.values(), work_item_id])


def update_automation_flow(flow_run_id: str, **fields: Any) -> None:
    if not fields:
        return
    keys = ", ".join(f"{key} = ?" for key in fields)
    with get_db() as conn:
        conn.execute(f"UPDATE automation_flow_runs SET {keys} WHERE id = ?", [*fields.values(), flow_run_id])
    event_fields = {key: fields[key] for key in ("stage", "progress", "status", "current_attempt", "error") if key in fields}
    if event_fields:
        payload = {
            "type": "stage",
            "flowRunId": flow_run_id,
            "stage": fields.get("stage"),
            "progress": fields.get("progress"),
            "status": fields.get("status"),
            "currentAttempt": fields.get("current_attempt"),
            "error": fields.get("error"),
        }
        schedule_automation_flow_event(flow_run_id, payload)
    if fields.get("status") in {"completed", "failed", "blocked", "cancelled"}:
        with contextlib.suppress(Exception):
            schedule_automation_flow_event(
                flow_run_id,
                {"type": "flow_done", "status": fields.get("status"), "flow": get_automation_flow_payload(flow_run_id)},
            )


async def broadcast_automation_flow_event(flow_run_id: str, payload: dict[str, Any]) -> None:
    websockets = AUTOMATION_FLOW_SOCKETS.get(flow_run_id)
    if not websockets:
        return
    stale: list[WebSocket] = []
    for websocket in list(websockets):
        try:
            await asyncio.wait_for(websocket.send_json(payload), timeout=AUTOMATION_FLOW_EVENT_SEND_TIMEOUT_SECONDS)
        except Exception:
            stale.append(websocket)
    for websocket in stale:
        websockets.discard(websocket)
    if not websockets:
        AUTOMATION_FLOW_SOCKETS.pop(flow_run_id, None)


def schedule_automation_flow_event(flow_run_id: str, payload: dict[str, Any]) -> None:
    loop = AUTOMATION_FLOW_EVENT_LOOP
    if loop is None or loop.is_closed():
        return
    asyncio.run_coroutine_threadsafe(broadcast_automation_flow_event(flow_run_id, payload), loop)


def automation_flow_log_row(flow_run_id: str, log_id: int) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM automation_flow_logs WHERE flow_run_id = ? AND id = ?",
            (flow_run_id, log_id),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "createdAt": row["created_at"],
        "stage": row["stage"],
        "level": row["level"],
        "message": row["message"],
        "evidenceType": row["evidence_type"],
        "evidencePath": row["evidence_path"],
        "linkedRunId": row["linked_run_id"],
    }


def write_automation_flow_log(
    flow_run_id: str,
    stage: str,
    level: str,
    message: str,
    evidence_type: str = "",
    evidence_path: str = "",
    linked_run_id: str = "",
) -> None:
    log_id = 0
    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO automation_flow_logs (
                flow_run_id, created_at, stage, level, message,
                evidence_type, evidence_path, linked_run_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (flow_run_id, now_iso(), stage, level, message, evidence_type, evidence_path, linked_run_id),
        )
        log_id = cursor.lastrowid
    log = automation_flow_log_row(flow_run_id, log_id)
    if log:
        schedule_automation_flow_event(flow_run_id, {"type": "log", "flowRunId": flow_run_id, "log": log})


def row_to_flow_artifact(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "flowRunId": row["flow_run_id"],
        "workItemId": row["work_item_id"],
        "stage": row["stage"],
        "artifactType": row["artifact_type"],
        "title": row["title"],
        "content": row["content"] or "",
        "status": row["status"],
        "source": row["source"],
        "path": row["path"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def flow_artifacts(flow_run_id: str) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM automation_flow_artifacts
            WHERE flow_run_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (flow_run_id,),
        ).fetchall()
    return [row_to_flow_artifact(row) for row in rows]


def flow_artifact_by_id(artifact_id: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM automation_flow_artifacts WHERE id = ?", (artifact_id,)).fetchone()
    return row_to_flow_artifact(row) if row is not None else None


def create_flow_artifact(
    flow_run_id: str,
    work_item_id: str,
    stage: str,
    artifact_type: str,
    title: str,
    content: str = "",
    status: str = "streaming",
    source: str = "system",
    path: str = "",
) -> str:
    artifact_id = uuid.uuid4().hex[:12]
    timestamp = now_iso()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO automation_flow_artifacts (
                id, flow_run_id, work_item_id, stage, artifact_type, title,
                content, status, source, path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_id,
                flow_run_id,
                work_item_id,
                stage,
                artifact_type,
                title,
                content,
                status,
                source,
                path,
                timestamp,
                timestamp,
            ),
        )
    artifact = flow_artifact_by_id(artifact_id)
    if artifact:
        schedule_automation_flow_event(flow_run_id, {"type": "artifact_created", "flowRunId": flow_run_id, "artifact": artifact})
    return artifact_id


def update_flow_artifact(artifact_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = now_iso()
    keys = ", ".join(f"{key} = ?" for key in fields)
    with get_db() as conn:
        conn.execute(f"UPDATE automation_flow_artifacts SET {keys} WHERE id = ?", [*fields.values(), artifact_id])
    artifact = flow_artifact_by_id(artifact_id)
    if artifact:
        schedule_automation_flow_event(
            artifact["flowRunId"],
            {"type": "artifact_updated", "flowRunId": artifact["flowRunId"], "artifact": artifact},
        )


def append_flow_artifact_content(artifact_id: str, delta: str) -> None:
    if not delta:
        return
    flow_run_id = ""
    with get_db() as conn:
        conn.execute(
            """
            UPDATE automation_flow_artifacts
            SET content = COALESCE(content, '') || ?,
                updated_at = ?
            WHERE id = ?
            """,
            (delta, now_iso(), artifact_id),
        )
        row = conn.execute("SELECT flow_run_id FROM automation_flow_artifacts WHERE id = ?", (artifact_id,)).fetchone()
        flow_run_id = row["flow_run_id"] if row is not None else ""
    if flow_run_id:
        schedule_automation_flow_event(
            flow_run_id,
            {"type": "artifact_delta", "flowRunId": flow_run_id, "artifactId": artifact_id, "delta": delta},
        )


def format_requirement_analysis_artifact(item: sqlite3.Row, analysis: dict[str, Any]) -> str:
    missing = analysis.get("missing") or []
    missing_text = "、".join(str(value) for value in missing) if missing else "无"
    source = "AI 自动提取" if analysis.get("source") == "ai" else "规则兜底提取"
    return f"""## 需求结构化结果

- 来源：{source}
- 标题：{item['title']}
- 功能目标：{analysis.get('goal', item['requirement'])}
- 用户路径：{analysis.get('userPath', item['requirement'])}
- 验收标准：{analysis.get('acceptance', item['acceptance'] or '未提供')}
- 角色：{analysis.get('role', item['role'] or '未提供')}
- 测试数据：{analysis.get('testData', item['test_data'] or '未提供')}
- 环境/目标 URL：{analysis.get('environment', item['target_url'] or '未提供')}
- 排除项：{analysis.get('exclusions', item['exclusions'] or '未提供')}
- 仍需澄清：{missing_text}
"""


def format_exploration_plan_artifact(plan: list[dict[str, Any]]) -> str:
    lines = ["| # | 动作 | 目标 | 值 | 说明 | 状态 |", "| --- | --- | --- | --- | --- | --- |"]
    for step in plan:
        status = "跳过危险动作" if step.get("skipped") else "计划执行"
        lines.append(
            "| {index} | {action} | {target} | {value} | {description} | {status} |".format(
                index=int(step.get("index", 0)) + 1,
                action=str(step.get("action", "")),
                target=str(step.get("target", "")).replace("|", "\\|"),
                value=str(step.get("value", "")).replace("|", "\\|"),
                description=str(step.get("description", "")).replace("|", "\\|"),
                status=status,
            )
        )
    return "\n".join(lines)


def format_exploration_result_artifact(exploration_payload: dict[str, Any]) -> str:
    result = exploration_payload.get("result") or {}
    steps = exploration_payload.get("steps") or []
    lines = [
        "## 探索执行结果",
        "",
        f"- 状态：{exploration_payload.get('status', '-')}",
        f"- 截图路径：{result.get('screenshot_path') or exploration_payload.get('screenshotPath') or '-'}",
        f"- 候选元素：{len(result.get('elements') or [])} 个",
        f"- 浏览器会话：{result.get('browser_session_id') or exploration_payload.get('browserSessionId') or '-'}",
        "",
        "| # | 动作 | 执行状态 | URL 变化 | 截图 | 错误 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for step in steps:
        before = step.get("urlBefore") or "-"
        after = step.get("urlAfter") or "-"
        url_change = before if before == after else f"{before} -> {after}"
        lines.append(
            "| {index} | {action} | {status} | {url_change} | {screenshot} | {error} |".format(
                index=int(step.get("stepIndex", 0)) + 1,
                action=str(step.get("action", "")),
                status=str(step.get("status", "")),
                url_change=str(url_change).replace("|", "\\|"),
                screenshot=str(step.get("screenshotPath") or "-").replace("|", "\\|"),
                error=str(step.get("error") or "-").replace("|", "\\|"),
            )
        )
    structure = result.get("page_structure") or ""
    if structure:
        lines.extend(["", "## 页面结构摘要", "", structure])
    return "\n".join(lines)


def format_confirmed_elements_artifact(elements: list[dict[str, Any]], confirmed_count: int) -> str:
    lines = [
        f"## 已确认 selector：{confirmed_count} 个",
        "",
        "| # | 区域 | 元素 | Locator | 来源 | 截图 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    confirmed = [element for element in elements if element.get("confirmed")]
    for index, element in enumerate(confirmed, start=1):
        locator = f"{element.get('locatorType') or element.get('locator_type')}={element.get('locatorValue') or element.get('locator_value')}"
        lines.append(
            "| {index} | {area} | {name} | {locator} | {source} | {screenshot} |".format(
                index=index,
                area=str(element.get("area", "")).replace("|", "\\|"),
                name=str(element.get("name", "")).replace("|", "\\|"),
                locator=str(locator).replace("|", "\\|"),
                source=str(element.get("source", "")).replace("|", "\\|"),
                screenshot=str(element.get("screenshotPath") or element.get("screenshot_path") or "-").replace("|", "\\|"),
            )
        )
    if not confirmed:
        lines.append("| - | - | - | 未自动确认高置信 selector | 需要人工确认元素后再生成最终脚本 | - |")
    return "\n".join(lines)


def format_run_summary_artifact(run: sqlite3.Row, command: str = "") -> str:
    status = run["status"] if run is not None else "未运行"
    exit_code = run["exit_code"] if run is not None else "无"
    spec = run["spec"] if run is not None else "-"
    report = run["report_path"] if run is not None else str(REPORT_INDEX)
    screenshot = run["screenshot_path"] if run is not None else str(SCREENSHOT_PATH)
    command_text = command or (f"npx playwright test {spec} --project=chromium --reporter=list,html" if spec != "-" else "-")
    failure = "无" if status == "passed" else "详见 Playwright HTML report、运行日志、截图/trace/video 证据"
    return f"""## Playwright 运行验证

- 执行命令：`{command_text}`
- Spec 路径：`{spec}`
- 状态：{status}
- 退出码：{exit_code}
- 失败摘要：{failure}
- HTML report：`{report or REPORT_INDEX}`
- 截图/预览：`{screenshot or SCREENSHOT_PATH}`
"""


def format_final_report_artifact(final_item: dict[str, Any], html_report_path: str) -> str:
    return f"""## 最终交付物

- 测试用例：`{final_item.get('casesPath', '-')}`
- Playwright spec：`{final_item.get('specPath', '-')}`
- 人工测试报告：`{final_item.get('reportPath', '-')}`
- Playwright HTML Report：`{html_report_path}`
- 最新运行状态：{final_item.get('status', 'artifacts-saved')}
"""


def update_suite_run(suite_run_id: str, **fields: Any) -> None:
    if not fields:
        return
    keys = ", ".join(f"{key} = ?" for key in fields)
    with get_db() as conn:
        conn.execute(f"UPDATE suite_runs SET {keys} WHERE id = ?", [*fields.values(), suite_run_id])


def refresh_suite_run_counts(suite_run_id: str) -> None:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS total FROM suite_run_cases WHERE suite_run_id = ? GROUP BY status",
            (suite_run_id,),
        ).fetchall()
        counts = {row["status"]: row["total"] for row in rows}
        suite = conn.execute("SELECT total_cases FROM suite_runs WHERE id = ?", (suite_run_id,)).fetchone()
        total = suite["total_cases"] if suite else 0
        finished = counts.get("passed", 0) + counts.get("failed", 0) + counts.get("skipped", 0)
        progress = 100 if total == 0 else int(finished / total * 100)
        conn.execute(
            """
            UPDATE suite_runs
            SET passed_cases = ?, failed_cases = ?, skipped_cases = ?, progress = ?
            WHERE id = ?
            """,
            (counts.get("passed", 0), counts.get("failed", 0), counts.get("skipped", 0), progress, suite_run_id),
        )


def row_to_suite_run(row: sqlite3.Row, include_cases: bool = True) -> dict[str, Any]:
    payload = {
        "id": row["id"],
        "suiteId": row["suite_id"],
        "projectId": row["project_id"],
        "name": row["name"],
        "status": row["status"],
        "progress": row["progress"],
        "totalCases": row["total_cases"],
        "passedCases": row["passed_cases"],
        "failedCases": row["failed_cases"],
        "skippedCases": row["skipped_cases"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "reportPath": row["report_path"],
        "cases": [],
    }
    if include_cases:
        with get_db() as conn:
            payload["cases"] = [
                {
                    "id": item["id"],
                    "suiteRunId": item["suite_run_id"],
                    "caseId": item["case_id"],
                    "runId": item["run_id"],
                    "status": item["status"],
                    "startedAt": item["started_at"],
                    "endedAt": item["ended_at"],
                    "error": item["error"],
                    "case": row_to_test_case(case_row) if (case_row := conn.execute("SELECT * FROM test_cases WHERE id = ?", (item["case_id"],)).fetchone()) else None,
                }
                for item in conn.execute(
                    "SELECT * FROM suite_run_cases WHERE suite_run_id = ? ORDER BY id ASC",
                    (row["id"],),
                ).fetchall()
            ]
    return payload


def require_ai() -> None:
    if not get_openai_api_key():
        raise HTTPException(status_code=503, detail="AI 未配置：请设置 OPENAI_API_KEY，或在页面中手动编辑内容。")


def safe_json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def default_suite_run_config() -> dict[str, Any]:
    return {
        "mode": "serial",
        "failurePolicy": "continue",
        "retryCount": 0,
        "runFailedOnly": False,
    }


def normalize_suite_run_config(config: dict[str, Any] | None) -> dict[str, Any]:
    incoming = config or {}
    retry_count = incoming.get("retryCount", incoming.get("retry_count", 0))
    try:
        retry_count = int(retry_count)
    except (TypeError, ValueError):
        retry_count = 0
    return {
        "mode": "serial",
        "failurePolicy": "stop" if incoming.get("failurePolicy") == "stop" else "continue",
        "retryCount": min(max(retry_count, 0), 3),
        "runFailedOnly": bool(incoming.get("runFailedOnly", incoming.get("run_failed_only", False))),
    }


def default_suite_schedule_config() -> dict[str, Any]:
    return {
        "enabled": False,
        "frequency": "off",
        "time": "09:00",
        "weekday": "1",
        "intervalMinutes": 60,
        "timezone": "Asia/Shanghai",
        "note": "",
    }


def normalize_suite_schedule_config(config: dict[str, Any] | None) -> dict[str, Any]:
    incoming = config or {}
    interval = incoming.get("intervalMinutes", incoming.get("interval_minutes", 60))
    try:
        interval = int(interval)
    except (TypeError, ValueError):
        interval = 60
    frequency = incoming.get("frequency") or "off"
    if frequency not in {"off", "daily", "weekly", "interval"}:
        frequency = "off"
    enabled = bool(incoming.get("enabled")) and frequency != "off"
    return {
        "enabled": enabled,
        "frequency": frequency if enabled else "off",
        "time": str(incoming.get("time") or "09:00"),
        "weekday": str(incoming.get("weekday") or "1"),
        "intervalMinutes": min(max(interval, 5), 10080),
        "timezone": str(incoming.get("timezone") or "Asia/Shanghai"),
        "note": str(incoming.get("note") or "").strip(),
    }


def parse_test_data(test_data: str) -> dict[str, str]:
    values: dict[str, str] = {}
    username_match = re.search(r"(?:用户名|账号|user(?:name)?)\s*[:： ]\s*([A-Za-z0-9_.@-]+)", test_data, re.IGNORECASE)
    password_match = re.search(r"(?:密码|password|pwd)\s*[:： ]\s*([A-Za-z0-9_.@!#$%^&*-]+)", test_data, re.IGNORECASE)
    product_match = re.search(r"(?:商品|产品|product)\s*[:： ]\s*([^,，。]+)", test_data, re.IGNORECASE)
    if username_match:
        values["username"] = username_match.group(1).strip()
    if password_match:
        values["password"] = password_match.group(1).strip()
    if product_match:
        values["product"] = product_match.group(1).strip()
    return values


def is_zzpss_item(item: sqlite3.Row) -> bool:
    text = f"{item['target_url']} {item['title']} {item['requirement']}".lower()
    return "zzpss" in text or "供电所运检业务rpa小助手" in text or "供电所" in text


def latest_cases_for_work_item(work_item_id: str) -> str:
    with get_db() as conn:
        return latest_content(conn, "generated_cases", work_item_id)


def latest_script_for_work_item(work_item_id: str) -> str:
    with get_db() as conn:
        return latest_content(conn, "generated_scripts", work_item_id)


def default_exploration_plan(item: sqlite3.Row, cases_markdown: str = "") -> list[dict[str, Any]]:
    data = parse_test_data(item["test_data"] or "")
    username = data.get("username", "standard_user")
    password = data.get("password", "secret_sauce")
    product = data.get("product", "Sauce Labs Backpack")
    if is_zzpss_item(item):
        return [
            {"index": 0, "action": "navigate", "target": item["target_url"], "value": "", "description": "打开 ZZPSS 登录页，建立探索起点"},
            {"index": 1, "action": "snapshot", "target": "", "value": "", "description": "采集登录表单输入框和页面标题"},
            {"index": 2, "action": "fill", "target": 'input[placeholder="请输入用户名称"]', "value": username, "description": "填写 ZZPSS 登录账号"},
            {"index": 3, "action": "fill", "target": 'input[placeholder="请输入登录密码"]', "value": password, "description": "填写 ZZPSS 登录密码"},
            {"index": 4, "action": "click", "target": '.login-button:has-text("登录"), button:has-text("登录"), .el-button:has-text("登录")', "value": "", "description": "点击登录按钮进入系统首页"},
            {"index": 5, "action": "snapshot", "target": "", "value": "", "description": "采集登录后首页菜单、欢迎语和看板标题"},
            {"index": 6, "action": "assert", "target": 'text=欢迎您，李宁, text=首页, text=基本情况', "value": "", "description": "确认登录后稳定状态元素可见"},
            {"index": 7, "action": "snapshot", "target": "", "value": "", "description": "再次采集登录态证据，供脚本生成和自愈使用"},
        ]
    return [
        {"index": 0, "action": "navigate", "target": item["target_url"], "value": "", "description": "根据已保存测试用例打开目标 URL，建立探索起点"},
        {"index": 1, "action": "snapshot", "target": "", "value": "", "description": "采集初始页面结构和候选元素，用于校验测试用例前置条件"},
        {"index": 2, "action": "fill", "target": "[data-test=\"username\"], input[name=\"user-name\"], input[placeholder=\"Username\"]", "value": username, "description": "填写账号"},
        {"index": 3, "action": "fill", "target": "[data-test=\"password\"], input[name=\"password\"], input[placeholder=\"Password\"]", "value": password, "description": "填写密码"},
        {"index": 4, "action": "click", "target": "[data-test=\"login-button\"], input[type=\"submit\"], button:has-text(\"Login\")", "value": "", "description": "点击登录按钮"},
        {"index": 5, "action": "snapshot", "target": "", "value": "", "description": "采集登录后页面结构和候选元素，确认用例主流程 selector"},
        {"index": 6, "action": "assert", "target": "text=Products, [data-test=\"title\"], h1, h2", "value": "", "description": "确认登录后关键页面标题或主内容可见"},
        {"index": 7, "action": "click", "target": "[data-test=\"add-to-cart-sauce-labs-backpack\"], button:has-text(\"Add to cart\")", "value": "", "description": f"低风险点击主要业务按钮，优先覆盖商品：{product}"},
        {"index": 8, "action": "snapshot", "target": "", "value": "", "description": "采集加购后的按钮、购物车角标和页面候选元素"},
        {"index": 9, "action": "click", "target": "[data-test=\"shopping-cart-link\"], .shopping_cart_link, a:has-text(\"Cart\")", "value": "", "description": "打开购物车查看已选商品状态"},
        {"index": 10, "action": "snapshot", "target": "", "value": "", "description": "采集购物车页面、商品行和继续/结账入口证据"},
        {"index": 11, "action": "click", "target": "[data-test=\"checkout\"], button:has-text(\"Checkout\")", "value": "", "description": "进入结账信息页但不提交订单"},
        {"index": 12, "action": "snapshot", "target": "", "value": "", "description": "采集结账信息表单和必填输入框候选元素"},
        {"index": 13, "action": "click", "target": "[data-test=\"continue\"], input[type=\"submit\"], button:has-text(\"Continue\")", "value": "", "description": "触发低风险必填校验错误态，不填写任何真实提交数据"},
        {"index": 14, "action": "snapshot", "target": "", "value": "", "description": "采集错误态提示、表单字段和最终页面证据，对应用例错误状态"},
    ]


def normalize_exploration_plan(raw_steps: list[dict[str, Any]], item: sqlite3.Row) -> list[dict[str, Any]]:
    allowed = {"navigate", "fill", "click", "assert", "snapshot"}
    normalized: list[dict[str, Any]] = []
    for step in raw_steps:
        action = step.get("action", "snapshot")
        if action not in allowed:
            action = "snapshot"
        normalized.append(
            {
                "index": len(normalized),
                "action": action,
                "target": step.get("target", ""),
                "value": step.get("value", ""),
                "description": step.get("description", f"探索步骤 {len(normalized) + 1}"),
                "skipped": dangerous_step(step),
            }
        )
    if not normalized or normalized[0]["action"] != "navigate":
        normalized.insert(
            0,
            {
                "index": 0,
                "action": "navigate",
                "target": item["target_url"],
                "value": "",
                "description": "打开目标 URL，建立探索起点",
                "skipped": False,
            },
        )
    for index, step in enumerate(normalized):
        step["index"] = index
    return normalized


def ai_exploration_plan(item: sqlite3.Row, cases_markdown: str) -> list[dict[str, Any]]:
    api_key = get_openai_api_key()
    if not api_key:
        return []
    model = get_openai_model()
    base_url = get_openai_base_url()
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "action": {"type": "string", "enum": ["navigate", "fill", "click", "assert", "snapshot"]},
                        "target": {"type": "string"},
                        "value": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["action", "target", "value", "description"],
                },
            }
        },
        "required": ["steps"],
    }
    prompt = f"""请根据已保存的可追溯测试用例生成完整、低风险的 Playwright 页面探索步骤。
步骤数量由测试用例的用户路径、前置条件、步骤和期望结果决定；覆盖主要成功路径、关键异常流程、错误状态和不会产生真实破坏的边界场景。
只允许 navigate、fill、click、assert、snapshot。
跳过删除、支付、下单、生产提交等高风险动作。

标题：{item['title']}
需求：{item['requirement']}
目标 URL：{item['target_url']}
角色/账号：{item['role']}
测试数据：{item['test_data']}
验收标准：{item['acceptance']}
排除项：{item['exclusions']}
已保存测试用例：
{cases_markdown}
"""
    payload = {
        "model": model,
        "input": prompt,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "exploration_plan",
                "schema": schema,
                "strict": True,
            }
        },
    }
    try:
        body = call_openai_responses(api_key, model, base_url, payload, timeout=6)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []
    try:
        parsed = json.loads(parse_openai_text_response(body))
    except json.JSONDecodeError:
        return []
    return normalize_exploration_plan(parsed.get("steps", []), item)


def dangerous_step(step: dict[str, Any]) -> bool:
    text = f"{step.get('description', '')} {step.get('target', '')} {step.get('value', '')}".lower()
    keywords = ["删除", "支付", "付款", "下单", "提交订单", "生产提交", "delete", "pay", "purchase", "place order", "finish order", "remove"]
    return any(keyword in text for keyword in keywords)


def build_exploration_plan(item: sqlite3.Row, cases_markdown: str) -> list[dict[str, Any]]:
    ai_plan = ai_exploration_plan(item, cases_markdown)
    if ai_plan:
        return ai_plan
    return normalize_exploration_plan(default_exploration_plan(item, cases_markdown), item)


def insert_exploration_step(exploration_run_id: str, work_item_id: str, step: dict[str, Any]) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO exploration_steps (
                exploration_run_id, work_item_id, step_index, action, target, value,
                description, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                exploration_run_id,
                work_item_id,
                step["index"],
                step["action"],
                step.get("target", ""),
                step.get("value", ""),
                step.get("description", ""),
                "pending",
            ),
        )


def update_exploration_step(exploration_run_id: str, step_index: int, **fields: Any) -> None:
    if not fields:
        return
    keys = ", ".join(f"{key} = ?" for key in fields)
    with get_db() as conn:
        conn.execute(
            f"UPDATE exploration_steps SET {keys} WHERE exploration_run_id = ? AND step_index = ?",
            [*fields.values(), exploration_run_id, step_index],
        )


def default_cases(item: sqlite3.Row) -> str:
    return f"""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-{item['slug'].upper()}-001 | P0 | 主流程满足验收标准 | {item['acceptance'] or item['requirement']} | 目标页面可访问；测试数据已准备 | 打开目标页面；按需求完成核心操作；观察结果 | 页面展示符合验收标准的成功状态 | 需基于探索记录确认 role/label/text/testid locator |
| TC-{item['slug'].upper()}-002 | P1 | 关键错误状态可见 | 错误处理和边界状态 | 目标页面可访问 | 使用缺失或异常数据执行关键操作 | 页面展示明确错误提示，不进入错误成功态 | 失败提示 selector 必须来自已确认元素 |
"""


def default_script(item: sqlite3.Row, elements: list[sqlite3.Row]) -> str:
    title = item["title"].replace("'", "\\'")
    url = item["target_url"] or "/"
    data = parse_test_data(item["test_data"] or "")
    username = (data.get("username") or "standard_user").replace("'", "\\'")
    password = (data.get("password") or "secret_sauce").replace("'", "\\'")
    product = (data.get("product") or "Sauce Labs Backpack").replace("'", "\\'")
    if is_zzpss_item(item):
        case_ids = {
            "success": "LGN-001",
            "wrong_password": "LGN-002",
            "wrong_username": "LGN-003",
            "missing_username": "LGN-004",
            "missing_password": "LGN-005",
            "empty_form": "LGN-006",
            "refresh_session": "LGN-007",
            "revisit_login": "LGN-008",
            "availability": "LGN-009",
        }
        return f"""import {{ expect, test, type Page }} from '@playwright/test';

const loginUrl = '{url}';
const validUsername = '{username}';
const validPassword = '{password}';
const displayName = '李宁';

function usernameInput(page: Page) {{
  return page.getByPlaceholder('请输入用户名称');
}}

function passwordInput(page: Page) {{
  return page.getByPlaceholder('请输入登录密码');
}}

function loginButton(page: Page) {{
  return page.locator('.login-button, button, .el-button').filter({{ hasText: '登录' }}).first();
}}

async function gotoLoginPage(page: Page) {{
  // 打开目标登录页，验证登录表单已经渲染。
  await page.goto(loginUrl, {{ waitUntil: 'domcontentloaded', timeout: 30_000 }});
  await expect(usernameInput(page)).toBeVisible({{ timeout: 15_000 }});
  await expect(passwordInput(page)).toBeVisible({{ timeout: 15_000 }});
}}

async function submitLogin(page: Page, username: string, password: string) {{
  // 按场景填入账号密码并提交登录表单。
  await usernameInput(page).fill(username);
  await passwordInput(page).fill(password);
  await expect(loginButton(page)).toBeEnabled({{ timeout: 10_000 }});
  await loginButton(page).click();
}}

async function expectLoggedIn(page: Page) {{
  // 使用 ZZPSS 真实首页信号判定登录成功。
  await page.waitForURL(/#\\/home$/, {{ timeout: 20_000 }});
  await expect(page.getByText(`欢迎您，${{displayName}}`)).toBeVisible({{ timeout: 15_000 }});
  await expect(page.locator('.menu-item.menu-active').filter({{ hasText: '首页' }})).toBeVisible({{ timeout: 15_000 }});
  await expect(page.getByText('基本情况', {{ exact: true }}).first()).toBeVisible({{ timeout: 15_000 }});
}}

async function expectStillOnLoginPage(page: Page) {{
  // 验证异常输入不会进入首页。
  await expect(page).toHaveURL(/#\\/login(?:\\?|$)/, {{ timeout: 10_000 }});
  await expect(usernameInput(page)).toBeVisible({{ timeout: 10_000 }});
  await expect(passwordInput(page)).toBeVisible({{ timeout: 10_000 }});
}}

async function expectUnauthenticated(page: Page) {{
  // 验证未成功建立登录态。
  await expect(page).not.toHaveURL(/#\\/home$/, {{ timeout: 5_000 }});
  await expect(usernameInput(page)).toBeVisible({{ timeout: 10_000 }});
  await expect(passwordInput(page)).toBeVisible({{ timeout: 10_000 }});
}}

async function expectValidationMessage(page: Page, pattern: RegExp) {{
  // 捕获 Element Plus 表单校验或消息提示。
  await expect(
    page.locator('.el-form-item__error, .el-message, .el-message__content, .el-notification, .el-notification__content')
      .or(page.getByText(pattern))
      .first(),
  ).toBeVisible({{ timeout: 10_000 }});
}}

test.describe('{title}', () => {{
  test('{case_ids["success"]} P0 使用有效账号密码成功登录', async ({{ page }}) => {{
    // 使用有效账号完成登录并验证首页状态。
    await gotoLoginPage(page);
    await submitLogin(page, validUsername, validPassword);
    await expectLoggedIn(page);
  }});

  test('{case_ids["wrong_password"]} P0 正确账号错误密码登录失败', async ({{ page }}) => {{
    // 错误密码不能进入首页。
    await gotoLoginPage(page);
    await submitLogin(page, validUsername, 'WrongPassword123');
    await expectUnauthenticated(page);
    await expectValidationMessage(page, /错误|失败|账号或密码|密码错误|登录失败|用户名或密码|不正确/);
  }});

  test('{case_ids["wrong_username"]} P0 错误账号正确密码登录失败', async ({{ page }}) => {{
    // 错误账号不能进入首页。
    await gotoLoginPage(page);
    await submitLogin(page, 'invalid_user', validPassword);
    await expectUnauthenticated(page);
    await expectValidationMessage(page, /错误|失败|账号或密码|账号|用户|登录失败|用户名或密码|不正确/);
  }});

  test('{case_ids["missing_username"]} P1 账号为空时阻止登录', async ({{ page }}) => {{
    // 账号为空时应保持在登录页并给出校验提示。
    await gotoLoginPage(page);
    await submitLogin(page, '', validPassword);
    await expectStillOnLoginPage(page);
    await expectValidationMessage(page, /用户名称|账号|用户名|必填|不能为空|请输入/);
  }});

  test('{case_ids["missing_password"]} P1 密码为空时阻止登录', async ({{ page }}) => {{
    // 密码为空时应保持在登录页并给出校验提示。
    await gotoLoginPage(page);
    await submitLogin(page, validUsername, '');
    await expectStillOnLoginPage(page);
    await expectValidationMessage(page, /登录密码|密码|必填|不能为空|请输入/);
  }});

  test('{case_ids["empty_form"]} P1 账号和密码均为空时阻止登录', async ({{ page }}) => {{
    // 空表单提交应保持在登录页并提示必填。
    await gotoLoginPage(page);
    await submitLogin(page, '', '');
    await expectStillOnLoginPage(page);
    await expectValidationMessage(page, /用户名称|账号|用户名|登录密码|密码|必填|不能为空|请输入/);
  }});

  test('{case_ids["refresh_session"]} P1 登录成功后刷新页面保持登录状态', async ({{ page }}) => {{
    // 登录后刷新，验证登录态仍保持。
    await gotoLoginPage(page);
    await submitLogin(page, validUsername, validPassword);
    await expectLoggedIn(page);
    await page.reload({{ waitUntil: 'domcontentloaded', timeout: 30_000 }});
    await expectLoggedIn(page);
  }});

  test('{case_ids["revisit_login"]} P1 已登录状态再次访问登录页的导航行为', async ({{ page }}) => {{
    // 登录后再次访问登录 URL，验证不会丢失登录态或出现异常。
    await gotoLoginPage(page);
    await submitLogin(page, validUsername, validPassword);
    await expectLoggedIn(page);
    await page.goto(loginUrl, {{ waitUntil: 'domcontentloaded', timeout: 30_000 }});
    await expect(page.locator('body')).toBeVisible({{ timeout: 10_000 }});
    await expect(page).not.toHaveURL(/about:blank/);
  }});

  test('{case_ids["availability"]} P2 登录页不可达或服务异常时给出可判定结果', async ({{ page }}) => {{
    // 目标服务正常时应渲染登录页；服务异常时 Playwright 会给出明确导航失败。
    await gotoLoginPage(page);
    await expect(loginButton(page)).toBeVisible({{ timeout: 10_000 }});
  }});
}});
"""
    if "saucedemo" in url.lower() or "sauce demo" in item["title"].lower():
        return f"""import {{ expect, test }} from '@playwright/test';

test.describe('{title}', () => {{
  test('TC-{item['slug'].upper()}-001 主流程满足验收标准', async ({{ page }}) => {{
    // 打开需求指定目标页面，建立可重复的测试前置状态。
    await page.goto('{url}');

    // 使用 Sauce Demo 稳定的 data-test selector 完成登录。
    await page.locator('[data-test="username"]').fill('{username}');
    await page.locator('[data-test="password"]').fill('{password}');
    await page.locator('[data-test="login-button"]').click();

    // 验证登录成功进入商品页。
    await expect(page.locator('[data-test="title"]')).toHaveText('Products', {{ timeout: 10_000 }});

    // 覆盖核心购物流程：添加指定商品并进入购物车。
    await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
    await page.locator('[data-test="shopping-cart-link"]').click();
    const cartItem = page.locator('[data-test="inventory-item"]').filter({{ hasText: '{product}' }});
    await expect(cartItem.locator('[data-test="inventory-item-name"]')).toHaveText('{product}');

    // 触发低风险必填校验错误态，不提交订单。
    await page.locator('[data-test="checkout"]').click();
    await page.locator('[data-test="continue"]').click();
    await expect(page.locator('[data-test="error"]')).toContainText('First Name is required');
  }});
}});
"""
    first_element = elements[0] if elements else None
    locator_line = "page.getByRole('heading').first()"
    if first_element:
        locator_type = first_element["locator_type"] or "text"
        value = (first_element["locator_value"] or first_element["name"] or "").replace("'", "\\'")
        if locator_type == "role":
            locator_line = f"page.getByRole('button', {{ name: /{value}/ }})"
        elif locator_type == "label":
            locator_line = f"page.getByLabel('{value}')"
        elif locator_type == "placeholder":
            locator_line = f"page.getByPlaceholder('{value}')"
        elif locator_type == "testid":
            locator_line = f"page.locator('[data-test=\"{value}\"], [data-testid=\"{value}\"]')"
        else:
            locator_line = f"page.getByText('{value}')"
    return f"""import {{ expect, test }} from '@playwright/test';

test.describe('{title}', () => {{
  test('TC-{item['slug'].upper()}-001 主流程满足验收标准', async ({{ page }}) => {{
    // 打开需求指定目标页面，建立可重复的测试前置状态。
    await page.goto('{url}');

    // 验证探索阶段确认的关键元素可见，证明页面已进入目标状态。
    await expect({locator_line}).toBeVisible({{ timeout: 10_000 }});
  }});
}});
""" 


def ai_test_cases(item: sqlite3.Row) -> str:
    api_key = get_openai_api_key()
    if not api_key:
        return ""
    prompt = test_cases_prompt(item)
    payload = {
        "model": get_openai_model(),
        "input": prompt,
    }
    try:
        body = call_openai_responses(api_key, get_openai_model(), get_openai_base_url(), payload, timeout=18)
        content = parse_openai_text_response(body).strip()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return ""
    return content if valid_cases_markdown(content) else ""


def test_cases_prompt(item: sqlite3.Row) -> str:
    return f"""你是资深 QA 自动化测试专家。请为下面需求生成简洁、可追溯的 Markdown 测试用例表。
表头必须为：ID、优先级、标题、覆盖需求、前置条件/测试数据、步骤、期望结果、自动化说明。
只覆盖真实风险：主流程、关键异常、边界/错误状态、持久化或导航行为；不要堆砌低价值组合。

标题：{item['title']}
需求：{item['requirement']}
目标 URL：{item['target_url']}
角色：{item['role']}
测试数据：{item['test_data']}
验收标准：{item['acceptance']}
排除项：{item['exclusions']}
"""


def valid_cases_markdown(content: str) -> bool:
    return bool(content.strip()) and ("| ID " in content or "| ID |" in content) and len([line for line in content.splitlines() if line.strip().startswith("|")]) >= 3


def extract_playwright_script(content: str) -> str:
    text = content.strip()
    fenced = re.search(r"```(?:ts|typescript)?\s*([\s\S]+?)```", text)
    if fenced:
        return fenced.group(1).strip()
    return text


def basic_typescript_shape_valid(script: str) -> bool:
    stripped = script.lstrip()
    if not stripped.startswith("import "):
        return False
    if re.search(r"^[\u4e00-\u9fff].*?\bimport\s+", script[:300], re.DOTALL):
        return False
    if re.search(r"(?m)^(我会|接下来|以下是|说明|修复思路|诊断)", stripped):
        return False
    if script.count("(") != script.count(")") or script.count("{") != script.count("}") or script.count("[") != script.count("]"):
        return False
    return True


def stream_ai_test_cases_sync(item: sqlite3.Row, artifact_id: str) -> str:
    api_key = get_openai_api_key()
    if not api_key:
        return ""
    payload = {
        "model": get_openai_model(),
        "input": test_cases_prompt(item),
    }
    try:
        content = call_openai_responses_stream(api_key, get_openai_model(), get_openai_base_url(), payload, artifact_id, timeout=18).strip()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return ""
    if not valid_cases_markdown(content):
        return ""
    return content


async def stream_ai_test_cases(item: sqlite3.Row, artifact_id: str) -> str:
    return await asyncio.to_thread(stream_ai_test_cases_sync, item, artifact_id)


def ai_playwright_script(item: sqlite3.Row, elements: list[sqlite3.Row], cases_markdown: str) -> str:
    api_key = get_openai_api_key()
    if not api_key:
        return ""
    prompt = playwright_script_prompt(item, elements, cases_markdown)
    payload = {
        "model": get_openai_model(),
        "input": prompt,
    }
    try:
        body = call_openai_responses(api_key, get_openai_model(), get_openai_base_url(), payload, timeout=24)
        content = parse_openai_text_response(body).strip()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return ""
    script = extract_playwright_script(content)
    return script if valid_playwright_script(script, elements) else ""


def playwright_script_prompt(item: sqlite3.Row, elements: list[sqlite3.Row], cases_markdown: str) -> str:
    element_lines = "\n".join(
        f"- {element['area']} / {element['name']}: {element['locator_type']}={element['locator_value']} ({element['source']})"
        for element in elements[:24]
    )
    domain_guidance = ""
    if is_zzpss_item(item):
        domain_guidance = """
ZZPSS 登录成功判定：
- 登录成功后 URL 应进入 `#/home`。
- 首页真实稳定信号包括 `欢迎您，李宁`、活跃菜单 `.menu-item.menu-active` 包含 `首页`、以及 `基本情况`、`电能质量` 等首页看板标题。
- 不要使用 `navigation`、`menu`、`main`、`aside`、`.el-menu`、`.layout` 等未被页面证据确认的通用 layout selector 作为唯一登录态断言。
"""
    return f"""你是资深 Playwright 自动化工程师。请基于已确认页面元素和测试用例生成 TypeScript Playwright spec。
要求：
- 使用 import {{ expect, test }} from '@playwright/test';
- 每个测试步骤都在相邻位置写中文注释。
- locator 只能来自已确认元素、页面可见文案、ARIA role/name、label、placeholder、稳定 data-test/data-testid 或项目已有约定。
- 使用 web-first assertions；不要使用固定 waitForTimeout。
- 必要 timeout 必须有上限。
{domain_guidance}

标题：{item['title']}
需求：{item['requirement']}
目标 URL：{item['target_url']}
角色：{item['role']}
测试数据：{item['test_data']}
验收标准：{item['acceptance']}
测试用例：
{cases_markdown}

已确认元素：
{element_lines}
"""


def valid_playwright_script(script: str, elements: list[sqlite3.Row] | list[dict[str, Any]]) -> bool:
    if not basic_typescript_shape_valid(script):
        return False
    if "test(" not in script or "expect(" not in script:
        return False
    if "waitForTimeout" in script:
        return False
    locator_values: list[str] = []
    for element in elements[:24]:
        if isinstance(element, sqlite3.Row):
            value = element["locator_value"] or element["name"] or ""
        else:
            value = element.get("locatorValue") or element.get("locator_value") or element.get("name") or ""
        if value:
            locator_values.append(str(value))
    semantic_markers = ["getByRole", "getByLabel", "getByPlaceholder", "getByText", "data-test", "data-testid", "locator("]
    return any(marker in script for marker in semantic_markers) and (not locator_values or any(value in script for value in locator_values[:8]))


def stream_ai_playwright_script_sync(item: sqlite3.Row, elements: list[sqlite3.Row], cases_markdown: str, artifact_id: str) -> str:
    api_key = get_openai_api_key()
    if not api_key:
        return ""
    payload = {
        "model": get_openai_model(),
        "input": playwright_script_prompt(item, elements, cases_markdown),
    }
    try:
        content = call_openai_responses_stream(api_key, get_openai_model(), get_openai_base_url(), payload, artifact_id, timeout=24).strip()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return ""
    script = extract_playwright_script(content)
    if script != content:
        update_flow_artifact(artifact_id, content=script)
    return script if valid_playwright_script(script, elements) else ""


async def stream_ai_playwright_script(item: sqlite3.Row, elements: list[sqlite3.Row], cases_markdown: str, artifact_id: str) -> str:
    return await asyncio.to_thread(stream_ai_playwright_script_sync, item, elements, cases_markdown, artifact_id)


def failure_evidence_summary(failure_log: str) -> str:
    evidence_lines: list[str] = []
    seen_paths: set[str] = set()
    path_pattern = re.compile(r"((?:test-results|playwright-report)/[^\s`]+(?:error-context\.md|test-failed-\d+\.png|video\.webm|\.png|\.webm))")
    for match in path_pattern.finditer(failure_log):
        path_text = match.group(1).rstrip(".,)")
        if path_text in seen_paths:
            continue
        seen_paths.add(path_text)
        path = resolve_workspace_path(path_text)
        evidence_lines.append(f"- 证据路径：`{relative_or_absolute(path)}`")
        if path.name == "error-context.md" and path.exists():
            excerpt = path.read_text(encoding="utf-8", errors="replace")[:4000].strip()
            if excerpt:
                evidence_lines.append(f"```text\n{excerpt}\n```")
    return "\n".join(evidence_lines) if evidence_lines else "未找到 Playwright error-context、截图或视频路径。"


def normalized_script_body(script: str) -> str:
    return re.sub(r"\s+", "", script or "")


def failed_locator_still_present(failure_log: str, script: str) -> bool:
    locator_match = re.search(r"Locator:\s*(.+)", failure_log)
    if not locator_match:
        return False
    locator = locator_match.group(1).strip()
    if not locator:
        return False
    fragments = [
        "getByRole('navigation')",
        'getByRole("navigation")',
        "getByRole('menu')",
        'getByRole("menu")',
        ".el-menu",
        ".layout",
        ".app-main",
        ".navbar",
        ".sidebar-container",
    ]
    return any(fragment in locator and fragment in script for fragment in fragments)


def script_changed_enough(current_script: str, healed_script: str, failure_log: str) -> bool:
    if not healed_script:
        return False
    if normalized_script_body(current_script) == normalized_script_body(healed_script):
        return False
    if failed_locator_still_present(failure_log, healed_script):
        return False
    return True


def ai_healed_script(item: sqlite3.Row, current_script: str, run: sqlite3.Row, failure_log: str, elements: list[sqlite3.Row]) -> str:
    api_key = get_openai_api_key()
    if not api_key:
        return ""
    prompt = healed_script_prompt(item, current_script, run, failure_log, elements)
    payload = {
        "model": get_openai_model(),
        "input": prompt,
    }
    try:
        body = call_openai_responses(api_key, get_openai_model(), get_openai_base_url(), payload, timeout=30)
        content = parse_openai_text_response(body).strip()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return ""
    script = extract_playwright_script(content)
    return script if valid_playwright_script(script, elements) else ""


def healed_script_prompt(item: sqlite3.Row, current_script: str, run: sqlite3.Row, failure_log: str, elements: list[sqlite3.Row]) -> str:
    element_lines = "\n".join(
        f"- {element['locator_type']}={element['locator_value']} ({element['name']})"
        for element in elements[:24]
    )
    evidence = failure_evidence_summary(failure_log)
    return f"""你是资深 Playwright 测试自愈工程师。请只修复测试脚本，不修改产品代码。
允许修改：测试数据、等待策略、selector、断言、Playwright 测试代码。
禁止削弱核心验收断言来掩盖产品问题。返回完整 TypeScript spec，不要解释。
如果 Playwright error-context 显示业务首页、欢迎语或目标成功状态已经出现，应优先用这些真实可见文本、URL 或稳定 CSS 作为断言，而不是继续等待不存在的通用 layout/navigation selector。

需求：{item['requirement']}
目标 URL：{item['target_url']}
失败 spec：{run['spec']}
失败日志：
{failure_log[-6000:]}

Playwright 失败上下文与页面快照摘录：
{evidence}

已确认元素：
{element_lines}

当前脚本：
{current_script}
"""


def stream_ai_healed_script_sync(item: sqlite3.Row, current_script: str, run: sqlite3.Row, failure_log: str, elements: list[sqlite3.Row], artifact_id: str) -> str:
    api_key = get_openai_api_key()
    if not api_key:
        return ""
    payload = {
        "model": get_openai_model(),
        "input": healed_script_prompt(item, current_script, run, failure_log, elements),
    }
    try:
        content = call_openai_responses_stream(api_key, get_openai_model(), get_openai_base_url(), payload, artifact_id, timeout=30).strip()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return ""
    script = extract_playwright_script(content)
    if script != content:
        update_flow_artifact(artifact_id, content=script)
    return script if valid_playwright_script(script, elements) else ""


async def stream_ai_healed_script(item: sqlite3.Row, current_script: str, run: sqlite3.Row, failure_log: str, elements: list[sqlite3.Row], artifact_id: str) -> str:
    return await asyncio.to_thread(stream_ai_healed_script_sync, item, current_script, run, failure_log, elements, artifact_id)


def latest_run_for_work_item(work_item_id: str, latest_run_id: str = "") -> sqlite3.Row | None:
    with get_db() as conn:
        if latest_run_id:
            return conn.execute(
                "SELECT * FROM runs WHERE id = ? AND work_item_id = ?",
                (latest_run_id, work_item_id),
            ).fetchone()
        return conn.execute(
            "SELECT * FROM runs WHERE work_item_id = ? ORDER BY started_at DESC LIMIT 1",
            (work_item_id,),
        ).fetchone()


def write_draft_spec(item: sqlite3.Row, script: str) -> str:
    WORK_ITEM_DRAFT_DIR.mkdir(parents=True, exist_ok=True)
    spec_path = WORK_ITEM_DRAFT_DIR / f"{item['slug']}.draft.spec.ts"
    spec_path.write_text(script, encoding="utf-8")
    return str(spec_path.relative_to(ROOT_DIR))


def report_cell(value: Any, fallback: str = "-") -> str:
    text = str(value or fallback).replace("\n", "<br>").replace("|", "\\|").strip()
    return text or fallback


def report_time(value: str | None) -> str:
    parsed = parse_iso_datetime(value)
    if parsed is None:
        return value or "无"
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def report_duration(started_at: str | None, ended_at: str | None) -> str:
    started = parse_iso_datetime(started_at)
    ended = parse_iso_datetime(ended_at)
    if started is None or ended is None:
        return "无"
    seconds = max(0, int((ended - started).total_seconds()))
    minutes, remaining = divmod(seconds, 60)
    if minutes:
        return f"{minutes}分{remaining}秒"
    return f"{remaining}秒"


def report_run_status(run: sqlite3.Row | None) -> str:
    if run is None:
        return "未执行"
    return {"passed": "通过", "failed": "失败", "running": "执行中"}.get(run["status"], run["status"] or "未知")


def report_case_statistics(cases_markdown: str) -> tuple[list[dict[str, str]], str, str]:
    parsed_cases = parse_cases_markdown(cases_markdown)
    if not parsed_cases:
        return [], "- 用例总数：0\n- P0：0；P1：0；P2：0；其他：0", "未解析到结构化 Markdown 用例；请检查用例表头是否包含 ID、优先级、标题等字段。"
    priority_counts: dict[str, int] = {}
    for case in parsed_cases:
        priority = case.get("priority") or "未标注"
        priority_counts[priority] = priority_counts.get(priority, 0) + 1
    ordered_priorities = ["P0", "P1", "P2"]
    priority_summary = "；".join(
        [f"{priority}：{priority_counts.get(priority, 0)}" for priority in ordered_priorities]
        + [f"{priority}：{count}" for priority, count in sorted(priority_counts.items()) if priority not in ordered_priorities]
    )
    stats = f"- 用例总数：{len(parsed_cases)}\n- 优先级分布：{priority_summary}"
    rows = [
        "| 用例 ID | 优先级 | 标题 | 覆盖需求 | 前置条件/数据 | 期望结果 | 自动化说明 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for case in parsed_cases:
        rows.append(
            "| {external_id} | {priority} | {title} | {requirement} | {preconditions} | {expected} | {automation_notes} |".format(
                external_id=report_cell(case.get("external_id")),
                priority=report_cell(case.get("priority")),
                title=report_cell(case.get("title")),
                requirement=report_cell(case.get("requirement")),
                preconditions=report_cell(case.get("preconditions")),
                expected=report_cell(case.get("expected")),
                automation_notes=report_cell(case.get("automation_notes")),
            )
        )
    return parsed_cases, stats, "\n".join(rows)


def report_log_excerpt(run_id: str, limit: int = 8000) -> str:
    if not run_id:
        return "无运行日志。"
    logs = run_log_text(run_id)
    if not logs:
        return "无运行日志。"
    if len(logs) <= limit:
        return logs
    return f"...（已截断前 {len(logs) - limit} 字符，仅保留最近日志）\n{logs[-limit:]}"


def report_failure_analysis(run: sqlite3.Row | None, reason: str = "") -> str:
    if run is None:
        return "- 当前尚无 Playwright 运行记录，无法判定失败原因。\n- 建议先完成草稿 spec 运行，再结合 HTML report、截图和日志复盘。"
    if run["status"] == "passed":
        return "- 本次 Playwright 运行通过，未发现阻塞性失败。\n- 仍建议结合业务验收标准人工复核关键路径和测试数据有效性。"
    return f"""- 失败结论：{reason or 'Playwright 运行未通过，需结合证据继续定位。'}
- 优先检查：HTML report 中的失败用例、trace/video/screenshot、控制台与网络错误、测试数据和环境可用性。
- 归因建议：先区分产品缺陷、环境/账号/数据问题、selector 失效、等待时序、断言口径不一致，再决定是否进入自愈或提缺陷。"""


def report_quality_risks(run: sqlite3.Row | None) -> str:
    delivery_note = "最终保存的 spec 来自已运行验证后的草稿版本。" if run is not None else "当前报告尚未绑定已完成运行，不能作为最终验证结论。"
    return f"""- selector 风险：未人工确认的候选元素不得作为最终 selector；若页面结构频繁变化，应优先使用稳定语义属性或业务可见文本。
- 环境与数据风险：目标环境、账号权限、测试数据、第三方依赖不可用时，自动化结果可能不能代表产品真实质量。
- 覆盖风险：默认不覆盖未声明的跨浏览器兼容、性能、安全、无障碍、视觉细节和第三方链路。
- 交付风险：{delivery_note}
- 后续建议：失败时优先补充缺陷单、证据截图、复现步骤和影响范围；通过时建议纳入回归套件并持续观察稳定性。"""


def default_report(item: sqlite3.Row, cases: str = "", run: sqlite3.Row | None = None) -> str:
    generated_at = report_time(now_iso())
    run_status = report_run_status(run)
    exit_code = "无"
    run_id = "无"
    spec = f"tests/e2e/{item['slug']}.spec.ts"
    command = f"npx playwright test {spec} --project=chromium --reporter=list,html"
    html_report = relative_or_absolute(REPORT_INDEX)
    screenshot = relative_or_absolute(SCREENSHOT_PATH)
    started_at = "无"
    ended_at = "无"
    duration = "无"
    deliverable_readiness = "否，尚未执行验证。"
    failure_reason = "无"
    parsed_cases, case_stats, coverage_matrix = report_case_statistics(cases)
    log_excerpt = "无运行日志。"
    if run is not None:
        exit_code = str(run["exit_code"])
        run_id = run["id"]
        spec = run["spec"]
        command = f"npx playwright test {spec} --project=chromium --reporter=list,html"
        html_report = relative_or_absolute(run["report_path"] or REPORT_INDEX)
        screenshot = relative_or_absolute(run["screenshot_path"] or SCREENSHOT_PATH)
        started_at = report_time(run["started_at"])
        ended_at = report_time(run["ended_at"])
        duration = report_duration(run["started_at"], run["ended_at"])
        deliverable_readiness = "是，已完成运行验证。" if run["status"] in {"passed", "failed"} else "否，运行尚未完成。"
        failure_reason = "应用或环境问题已记录，详见 HTML report 和日志" if run["status"] == "failed" else "无"
        log_excerpt = report_log_excerpt(run["id"])
    conclusion = (
        "本次自动化验证通过，可作为当前范围内的回归参考。"
        if run is not None and run["status"] == "passed"
        else "本次自动化验证失败，需要结合证据继续定位后再关闭风险。"
        if run is not None and run["status"] == "failed"
        else "尚未执行 Playwright 验证，报告仅描述测试设计与计划。"
    )
    raw_cases = cases or "已保存测试用例见同名 *-test-cases.md 文件。"
    return f"""# {item['title']} 测试报告

## 1. 报告元信息

| 项目 | 内容 |
| --- | --- |
| 报告生成时间 | {report_cell(generated_at)} |
| 工单 ID | {report_cell(item['id'])} |
| 任务标题 | {report_cell(item['title'])} |
| 运行 ID | {report_cell(run_id)} |
| 执行状态 | {report_cell(run_status)} |
| 开始时间 | {report_cell(started_at)} |
| 结束时间 | {report_cell(ended_at)} |
| 执行耗时 | {report_cell(duration)} |

## 2. 测试结论摘要

- 结论：{conclusion}
- 执行状态：{run_status}
- 退出码：{exit_code}
- 是否可作为最终交付物：{deliverable_readiness}
- 证据完整性：已记录测试用例、执行命令、Playwright HTML report、截图/预览路径和运行日志摘录。

## 3. 测试范围与输入

- 需求：{item['requirement']}
- 目标 URL：{item['target_url'] or '未提供'}
- 验收标准：{item['acceptance'] or '未提供'}
- 角色/账号：{item['role'] or '未提供'}
- 测试数据：{item['test_data'] or '未提供'}
- 排除项：{item['exclusions'] or '未明确要求的视觉细节、非目标浏览器和无关业务流程默认范围外'}

## 4. 测试用例统计

{case_stats}

## 5. 覆盖矩阵

{coverage_matrix}

## 6. 原始测试用例

{raw_cases}

## 7. 执行数据支撑

- Spec 路径：`{spec}`
- Playwright HTML report：`{html_report}`
- 截图/预览路径：`{screenshot}`
- 运行用例数：{len(parsed_cases) if parsed_cases else '未解析'}

### 执行命令

```bash
{command}
```

### 运行日志摘录

```text
{log_excerpt}
```

## 8. 失败分析与证据索引

- 失败原因：{failure_reason}
- HTML report：`{html_report}`
- 截图/预览：`{screenshot}`
- 日志来源：`runs/{run_id}/logs`

{report_failure_analysis(run, failure_reason)}

## 9. 质量风险与后续建议

{report_quality_risks(run)}
"""


def svg_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def file_data_url(path_value: str | None) -> str:
    if not path_value:
        return ""
    path = Path(path_value)
    if not path.exists():
        return ""
    mime = "image/png" if path.suffix.lower() == ".png" else "image/svg+xml"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def image_frame_payload(path_value: str | None, reason: str = "step-result") -> dict[str, Any] | None:
    if not path_value:
        return None
    path = Path(path_value)
    if not path.exists() or path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        return None
    return {
        "type": "frame",
        "data": base64.b64encode(path.read_bytes()).decode("ascii"),
        "format": "jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "png",
        "width": DEFAULT_VIEWPORT["width"],
        "height": DEFAULT_VIEWPORT["height"],
        "reason": reason,
    }


def render_exploration_preview(run_id: str, status: str, stage: str, progress: int, target_url: str, lines: list[str]) -> str:
    DISCOVERY_DIR.mkdir(parents=True, exist_ok=True)
    preview_path = DISCOVERY_DIR / f"{run_id}-live.svg"
    recent = "\n".join(lines[-8:]) or "等待 Playwright 浏览器事件..."
    stage_rows = [
        ("准备探索环境", progress >= 8),
        ("启动浏览器", progress >= 22),
        ("打开目标 URL", progress >= 44),
        ("等待页面加载", progress >= 58),
        ("采集候选元素", progress >= 74),
        ("生成页面截图", progress >= 88),
    ]
    row_markup = "\n".join(
        f"""<g transform="translate(0 {index * 38})">
    <circle cx="120" cy="338" r="9" fill="{'#2dd4bf' if done else '#1e293b'}" stroke="{'#99f6e4' if done else '#475569'}"/>
    <text x="142" y="344" fill="{'#e0fdfa' if done else '#94a3b8'}" font-family="Menlo, monospace" font-size="18">{svg_escape(label)}</text>
  </g>"""
        for index, (label, done) in enumerate(stage_rows)
    )
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#031525"/>
      <stop offset="0.52" stop-color="#101827"/>
      <stop offset="1" stop-color="#052e2b"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" x2="1">
      <stop stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#2dd4bf"/>
    </linearGradient>
  </defs>
  <rect width="1440" height="900" fill="url(#bg)"/>
  <rect x="64" y="56" width="1312" height="780" rx="18" fill="#07111f" stroke="#2dd4bf" stroke-opacity="0.42"/>
  <rect x="64" y="56" width="1312" height="54" rx="18" fill="#111827"/>
  <circle cx="102" cy="83" r="7" fill="#fb7185"/>
  <circle cx="128" cy="83" r="7" fill="#facc15"/>
  <circle cx="154" cy="83" r="7" fill="#34d399"/>
  <rect x="206" y="70" width="938" height="28" rx="14" fill="#020617" stroke="#334155"/>
  <text x="226" y="90" fill="#bae6fd" font-family="Menlo, monospace" font-size="15">{svg_escape(target_url or 'about:blank')}</text>
  <text x="1190" y="90" fill="#99f6e4" font-family="Menlo, monospace" font-size="15">run {run_id}</text>

  <text x="100" y="180" fill="#e5f9ff" font-family="Menlo, monospace" font-size="36">调起浏览器实时执行流程</text>
  <text x="100" y="224" fill="#8ddfd5" font-family="Menlo, monospace" font-size="22">{svg_escape(status.upper())} / {svg_escape(stage)}</text>
  <rect x="100" y="252" width="1240" height="16" rx="8" fill="#172033"/>
  <rect x="100" y="252" width="{max(12, int(1240 * progress / 100))}" height="16" rx="8" fill="url(#bar)"/>
  <text x="1284" y="246" fill="#cbd5e1" font-family="Menlo, monospace" font-size="18">{progress}%</text>

  <rect x="96" y="304" width="438" height="286" rx="12" fill="#0b1220" stroke="#1f3b4a"/>
  <text x="120" y="322" fill="#7dd3fc" font-family="Menlo, monospace" font-size="17">Browser lifecycle</text>
  {row_markup}

  <rect x="570" y="304" width="770" height="286" rx="12" fill="#020617" stroke="#1f3b4a"/>
  <text x="596" y="342" fill="#7dd3fc" font-family="Menlo, monospace" font-size="18">Realtime Playwright log</text>
  <foreignObject x="596" y="370" width="710" height="178">
    <pre xmlns="http://www.w3.org/1999/xhtml" style="color:#cbd5e1;font:17px Menlo,monospace;white-space:pre-wrap;margin:0">{svg_escape(recent)}</pre>
  </foreignObject>

  <rect x="96" y="624" width="1244" height="104" rx="12" fill="#091827" stroke="#164e63"/>
  <text x="124" y="662" fill="#ccfbf1" font-family="Menlo, monospace" font-size="20">下一步</text>
  <text x="124" y="698" fill="#94a3b8" font-family="Menlo, monospace" font-size="17">等待最终页面截图和候选 selector；完成后请人工确认元素，再保存探索。</text>
  <text x="100" y="794" fill="#64748b" font-family="Menlo, monospace" font-size="15">Exploration preview · screenshot polling · SQLite persisted evidence</text>
</svg>"""
    preview_path.write_text(svg, encoding="utf-8")
    return str(preview_path)


def write_exploration_log(exploration_run_id: str, level: str, message: str) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO exploration_logs (exploration_run_id, created_at, level, message)
            VALUES (?, ?, ?, ?)
            """,
            (exploration_run_id, now_iso(), level, message),
        )


def update_exploration_run(exploration_run_id: str, **fields: Any) -> None:
    if not fields:
        return
    keys = ", ".join(f"{key} = ?" for key in fields)
    with get_db() as conn:
        conn.execute(f"UPDATE exploration_runs SET {keys} WHERE id = ?", [*fields.values(), exploration_run_id])


def row_to_exploration_run(row: sqlite3.Row, include_logs: bool = True) -> dict[str, Any]:
    result = json.loads(row["result_json"]) if row["result_json"] else None
    preview_data_url = file_data_url(row["preview_path"])
    plan = safe_json_loads(row["plan_json"] if "plan_json" in row.keys() else None, [])
    if result is not None:
        result["preview_data_url"] = preview_data_url
    payload = {
        "id": row["id"],
        "workItemId": row["work_item_id"],
        "targetUrl": row["target_url"],
        "status": row["status"],
        "stage": {"key": row["stage_key"], "label": row["stage_label"]},
        "progress": row["progress"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "screenshotPath": row["screenshot_path"],
        "previewPath": row["preview_path"],
        "previewDataUrl": preview_data_url,
        "error": row["error"],
        "result": result,
        "plan": plan,
        "currentStepIndex": row["current_step_index"] if "current_step_index" in row.keys() else 0,
        "maxSteps": row["max_steps"] if "max_steps" in row.keys() else len(plan),
        "browserSessionId": row["browser_session_id"] if "browser_session_id" in row.keys() else None,
        "resultStatus": row["result_status"] if "result_status" in row.keys() else row["status"],
        "browserSession": None,
        "steps": [],
    }
    if include_logs:
        with get_db() as conn:
            if payload["browserSessionId"]:
                session_row = conn.execute("SELECT * FROM browser_sessions WHERE id = ?", (payload["browserSessionId"],)).fetchone()
                if session_row is not None:
                    payload["browserSession"] = {
                        "id": session_row["id"],
                        "workItemId": session_row["work_item_id"],
                        "explorationRunId": session_row["exploration_run_id"],
                        "status": session_row["status"],
                        "viewport": {"width": session_row["viewport_width"], "height": session_row["viewport_height"]},
                        "targetUrl": session_row["target_url"],
                        "startedAt": session_row["started_at"],
                        "endedAt": session_row["ended_at"],
                        "error": session_row["error"],
                    }
            payload["steps"] = [
                {
                    "id": item["id"],
                    "stepIndex": item["step_index"],
                    "action": item["action"],
                    "target": item["target"],
                    "value": item["value"],
                    "description": item["description"],
                    "status": item["status"],
                    "startedAt": item["started_at"],
                    "endedAt": item["ended_at"],
                    "urlBefore": item["url_before"],
                    "urlAfter": item["url_after"],
                    "title": item["title"],
                    "screenshotPath": item["screenshot_path"],
                    "structure": safe_json_loads(item["structure_json"], {}),
                    "candidates": safe_json_loads(item["candidates_json"], []),
                    "error": item["error"],
                }
                for item in conn.execute(
                    "SELECT * FROM exploration_steps WHERE exploration_run_id = ? ORDER BY step_index ASC",
                    (row["id"],),
                ).fetchall()
            ]
            payload["logs"] = [
                {
                    "id": item["id"],
                    "createdAt": item["created_at"],
                    "level": item["level"],
                    "message": item["message"],
                }
                for item in conn.execute(
                    "SELECT * FROM exploration_logs WHERE exploration_run_id = ? ORDER BY id ASC",
                    (row["id"],),
                ).fetchall()
            ]
    return payload


def get_exploration_run_payload(exploration_run_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM exploration_runs WHERE id = ?", (exploration_run_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Exploration run not found")
    return row_to_exploration_run(row)


async def broadcast_browser_event(runtime: BrowserRuntime, payload: dict[str, Any]) -> None:
    if not runtime.websockets:
        return
    timeout = BROWSER_FRAME_SEND_TIMEOUT_SECONDS if payload.get("type") == "frame" else BROWSER_EVENT_SEND_TIMEOUT_SECONDS
    stale: list[WebSocket] = []
    for websocket in list(runtime.websockets):
        try:
            await asyncio.wait_for(websocket.send_json(payload), timeout=timeout)
        except asyncio.TimeoutError:
            stale.append(websocket)
            if runtime.exploration_run_id is not None:
                write_exploration_log(
                    runtime.exploration_run_id,
                    "warning",
                    f"浏览器事件发送超时，移除慢 WebSocket 连接: {payload.get('type', 'unknown')}",
                )
        except Exception:
            stale.append(websocket)
    for websocket in stale:
        runtime.websockets.discard(websocket)


def schedule_browser_broadcast(runtime: BrowserRuntime, payload: dict[str, Any]) -> None:
    task = asyncio.create_task(broadcast_browser_event(runtime, payload))

    def _consume_result(done: asyncio.Task[None]) -> None:
        with contextlib.suppress(Exception):
            done.result()

    task.add_done_callback(_consume_result)


async def send_worker_command(runtime: BrowserRuntime, payload: dict[str, Any]) -> None:
    if runtime.process is None or runtime.process.stdin is None:
        raise HTTPException(status_code=500, detail="浏览器 worker stdin 不可用")
    runtime.process.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
    await runtime.process.stdin.drain()


def update_browser_session(session_id: str, **fields: Any) -> None:
    if not fields:
        return
    keys = ", ".join(f"{key} = ?" for key in fields)
    with get_db() as conn:
        conn.execute(f"UPDATE browser_sessions SET {keys} WHERE id = ?", [*fields.values(), session_id])


def get_browser_session_row(session_id: str) -> sqlite3.Row:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM browser_sessions WHERE id = ?", (session_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Browser session not found")
    return row


def row_to_browser_session(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "workItemId": row["work_item_id"],
        "explorationRunId": row["exploration_run_id"],
        "status": row["status"],
        "viewport": {"width": row["viewport_width"], "height": row["viewport_height"]},
        "targetUrl": row["target_url"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "error": row["error"],
    }


async def close_browser_runtime(session_id: str, reason: str = "closed") -> None:
    runtime = BROWSER_RUNTIMES.pop(session_id, None)
    if not runtime:
        update_browser_session(session_id, status="closed", ended_at=now_iso(), error=reason)
        return
    runtime.status = "closed"
    if runtime.process is not None and runtime.process.returncode is None:
        with contextlib.suppress(Exception):
            await send_worker_command(runtime, {"type": "control", "action": "stop"})
        with contextlib.suppress(ProcessLookupError):
            runtime.process.terminate()
    update_browser_session(session_id, status="closed", ended_at=now_iso(), error=reason)
    runtime.closed.set()
    await broadcast_browser_event(runtime, {"type": "status", "status": "Closed", "sessionId": session_id, "message": reason})


async def handle_worker_event(runtime: BrowserRuntime, event: dict[str, Any]) -> None:
    event_type = event.get("type")
    runtime.last_worker_event_type = str(event_type or "")
    runtime.last_worker_event_at = now_iso()
    evidence = event.get("evidence") if isinstance(event.get("evidence"), dict) else {}
    event_url = event.get("after") or event.get("url") or evidence.get("url")
    if event_url:
        runtime.last_worker_url = str(event_url)
    if event_type == "ready":
        runtime.status = "live"
        runtime.ready.set()
        update_browser_session(runtime.session_id, status="live")
        await broadcast_browser_event(runtime, {"type": "status", "status": "Live", "sessionId": runtime.session_id})
    elif event_type == "frame":
        runtime.last_frame = event
        schedule_browser_broadcast(runtime, event)
    elif event_type == "step-start":
        if runtime.exploration_run_id is not None:
            step_index = int(event.get("stepIndex", 0))
            update_exploration_step(
                runtime.exploration_run_id,
                step_index,
                status="running",
                started_at=now_iso(),
            )
            write_exploration_log(runtime.exploration_run_id, "info", event.get("message", "步骤开始执行"))
        await broadcast_browser_event(runtime, event)
    elif event_type == "step-result":
        if runtime.exploration_run_id is not None:
            step_index = int(event.get("stepIndex", 0))
            evidence = event.get("evidence") or {}
            update_exploration_step(
                runtime.exploration_run_id,
                step_index,
                status="passed",
                ended_at=now_iso(),
                url_before=event.get("before", ""),
                url_after=event.get("after", ""),
                title=evidence.get("title", ""),
                screenshot_path=evidence.get("screenshotPath", ""),
                structure_json=json.dumps(evidence.get("structure", {}), ensure_ascii=False),
                candidates_json=json.dumps(evidence.get("candidates", []), ensure_ascii=False),
                error="",
            )
            write_exploration_log(
                runtime.exploration_run_id,
                "info",
                f"步骤 {step_index + 1} 证据采集完成：候选元素 {len(evidence.get('candidates', []))} 个",
            )
            runtime.step_results[step_index] = {
                "status": "passed",
                "event": event,
                "evidence": evidence,
            }
            runtime.step_events.setdefault(step_index, asyncio.Event()).set()
            frame_payload = image_frame_payload(evidence.get("screenshotPath", ""), f"step-{step_index + 1}-result")
            if frame_payload:
                schedule_browser_broadcast(runtime, frame_payload)
        await broadcast_browser_event(runtime, event)
    elif event_type == "ack":
        if runtime.exploration_run_id is not None and event.get("status") == "error":
            command_id = event.get("commandId") or ""
            if command_id.startswith("step-"):
                with contextlib.suppress(ValueError):
                    step_index = int(command_id.split("-", 1)[1])
                    update_exploration_step(
                        runtime.exploration_run_id,
                        step_index,
                        status="failed",
                        ended_at=now_iso(),
                        error=event.get("error", "步骤执行失败"),
                    )
                    write_exploration_log(runtime.exploration_run_id, "error", f"步骤 {step_index + 1} 执行失败")
                    runtime.step_results[step_index] = {
                        "status": "failed",
                        "event": event,
                        "error": event.get("error", "步骤执行失败"),
                    }
                    runtime.step_events.setdefault(step_index, asyncio.Event()).set()
        await broadcast_browser_event(runtime, event)
    elif event_type == "log":
        await broadcast_browser_event(runtime, event)
    elif event_type == "closed":
        runtime.status = "closed"
        runtime.closed.set()
        update_browser_session(runtime.session_id, status="closed", ended_at=now_iso())
        await broadcast_browser_event(runtime, {"type": "status", "status": "Closed", "sessionId": runtime.session_id})


async def pump_browser_worker(runtime: BrowserRuntime) -> None:
    assert runtime.process.stdout is not None
    assert runtime.process.stderr is not None
    stderr_task = asyncio.create_task(runtime.process.stderr.read())
    error_message = ""
    try:
        while True:
            raw = await runtime.process.stdout.readline()
            if not raw:
                break
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                event = {"type": "log", "level": "info", "message": line}
            await handle_worker_event(runtime, event)
    except Exception as exc:
        error_message = f"浏览器 worker 事件泵异常: {exc}"
        runtime.last_error = error_message
        if runtime.exploration_run_id is not None:
            write_exploration_log(runtime.exploration_run_id, "error", error_message)
    finally:
        if runtime.process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                runtime.process.terminate()
        try:
            stderr = (await asyncio.wait_for(stderr_task, timeout=2)).decode(errors="replace")
        except asyncio.TimeoutError:
            stderr_task.cancel()
            stderr = ""
        if stderr:
            runtime.last_error = stderr
        elif error_message:
            runtime.last_error = error_message
        runtime.status = "closed"
        runtime.closed.set()
        session_error = stderr[:1000] if stderr else (error_message[:1000] if error_message else None)
        update_browser_session(runtime.session_id, status="closed", ended_at=now_iso(), error=session_error)


async def start_browser_session(work_item_id: str, exploration_run_id: str | None = None) -> dict[str, Any]:
    item = get_work_item_row(work_item_id)
    for runtime in list(BROWSER_RUNTIMES.values()):
        if runtime.work_item_id == work_item_id:
            await close_browser_runtime(runtime.session_id, "同一工单启动新会话，旧会话关闭")
    session_id = uuid.uuid4().hex[:12]
    process = await asyncio.create_subprocess_exec(
        "node",
        str(BROWSER_WORKER_PATH),
        session_id,
        item["target_url"] or "",
        json.dumps(DEFAULT_VIEWPORT),
        cwd=ROOT_DIR,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        limit=BROWSER_WORKER_STREAM_LIMIT_BYTES,
    )
    runtime = BrowserRuntime(session_id, work_item_id, exploration_run_id, item["target_url"] or "", process)
    BROWSER_RUNTIMES[session_id] = runtime
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO browser_sessions (
                id, work_item_id, exploration_run_id, status, viewport_width,
                viewport_height, target_url, started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                work_item_id,
                exploration_run_id,
                "starting",
                DEFAULT_VIEWPORT["width"],
                DEFAULT_VIEWPORT["height"],
                item["target_url"],
                now_iso(),
            ),
        )
    asyncio.create_task(pump_browser_worker(runtime))
    return row_to_browser_session(get_browser_session_row(session_id))


async def start_live_execution_session(work_item_id: str, target_url: str = "") -> dict[str, Any]:
    session_id = uuid.uuid4().hex[:12]
    runtime = BrowserRuntime(session_id, work_item_id, None, target_url, None)
    runtime.status = "starting"
    BROWSER_RUNTIMES[session_id] = runtime
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO browser_sessions (
                id, work_item_id, exploration_run_id, status, viewport_width,
                viewport_height, target_url, started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                work_item_id,
                None,
                "starting",
                DEFAULT_VIEWPORT["width"],
                DEFAULT_VIEWPORT["height"],
                target_url,
                now_iso(),
            ),
        )
    runtime.ready.set()
    return row_to_browser_session(get_browser_session_row(session_id))


async def run_discovery_session(exploration_run_id: str, work_item_id: str, target_url: str) -> None:
    async def push_stage(stage: str, message: str, level: str = "info") -> None:
        key, progress = EXPLORATION_STAGE_META.get(stage, ("explore", 50))
        update_exploration_run(
            exploration_run_id,
            status="running",
            stage_key=key,
            stage_label=stage,
            progress=progress,
        )
        write_exploration_log(exploration_run_id, level, message)

    try:
        item = get_work_item_row(work_item_id)
        with get_db() as conn:
            run_row = conn.execute("SELECT plan_json FROM exploration_runs WHERE id = ?", (exploration_run_id,)).fetchone()
        plan = safe_json_loads(run_row["plan_json"] if run_row else None, [])
        if not plan:
            plan = build_exploration_plan(item, latest_cases_for_work_item(work_item_id))
        session = await start_browser_session(work_item_id, exploration_run_id)
        session_id = session["id"]
        runtime = BROWSER_RUNTIMES[session_id]
        update_exploration_run(
            exploration_run_id,
            plan_json=json.dumps(plan, ensure_ascii=False),
            browser_session_id=session_id,
            max_steps=len(plan),
        )
        await push_stage("准备探索环境", f"生成多步骤探索计划：{len(plan)} 步")
        await push_stage("启动浏览器", f"浏览器会话已创建: {session_id}")
        await runtime.ready.wait()
        await broadcast_browser_event(runtime, {"type": "plan", "items": plan})

        candidates: list[dict[str, Any]] = []
        structures: list[str] = []
        final_screenshot = ""
        status = "passed"
        latest_discovery: dict[str, Any] = {}
        started_at = asyncio.get_running_loop().time()
        budget_deadline = started_at + EXPLORATION_TIME_BUDGET_SECONDS
        for step in plan:
            step_index = step["index"]
            if asyncio.get_running_loop().time() >= budget_deadline:
                status = "partial"
                write_exploration_log(
                    exploration_run_id,
                    "warning",
                    f"探索时间预算 {EXPLORATION_TIME_BUDGET_SECONDS // 60} 分钟已耗尽，剩余步骤标记为 partial",
                )
                update_exploration_step(
                    exploration_run_id,
                    step_index,
                    status="skipped",
                    started_at=now_iso(),
                    ended_at=now_iso(),
                    error="探索时间预算耗尽，未继续执行",
                )
                continue
            if step.get("skipped"):
                update_exploration_step(
                    exploration_run_id,
                    step_index,
                    status="skipped",
                    started_at=now_iso(),
                    ended_at=now_iso(),
                    error="低风险策略跳过潜在危险动作",
                )
                status = "partial"
                write_exploration_log(exploration_run_id, "warning", f"跳过步骤 {step_index + 1}: {step['description']}")
                continue

            step_dir = DISCOVERY_DIR / exploration_run_id
            step_dir.mkdir(parents=True, exist_ok=True)
            step_payload = {
                **step,
                "screenshotPath": str(step_dir / f"step-{step_index + 1}.png"),
            }
            update_exploration_run(
                exploration_run_id,
                current_step_index=step_index + 1,
                stage_key="step",
                stage_label=f"执行步骤 {step_index + 1}/{len(plan)}",
                progress=min(94, 20 + int((step_index + 1) / len(plan) * 72)),
            )
            update_exploration_step(exploration_run_id, step_index, status="running", started_at=now_iso())
            write_exploration_log(exploration_run_id, "info", f"执行步骤 {step_index + 1}/{len(plan)}: {step['description']}")
            await broadcast_browser_event(
                runtime,
                {
                    "type": "status",
                    "status": "Auto Running",
                    "stepIndex": step_index,
                    "message": f"执行步骤 {step_index + 1}/{len(plan)} · {step['action']}",
                },
            )
            runtime.step_events[step_index] = asyncio.Event()
            runtime.step_results.pop(step_index, None)
            await send_worker_command(runtime, {"type": "execute-step", "step": step_payload, "commandId": f"step-{step_index}"})

            deadline = min(asyncio.get_running_loop().time() + EXPLORATION_STEP_TIMEOUT_SECONDS, budget_deadline)
            timeout = max(0.1, deadline - asyncio.get_running_loop().time())
            try:
                await asyncio.wait_for(runtime.step_events[step_index].wait(), timeout=timeout)
            except asyncio.TimeoutError:
                status = "partial"
                diagnostics = (
                    f"runtime_status={runtime.status}; "
                    f"last_worker_event={runtime.last_worker_event_type or 'none'}; "
                    f"last_worker_event_at={runtime.last_worker_event_at or 'none'}; "
                    f"last_worker_url={runtime.last_worker_url or 'none'}; "
                    f"active_websockets={len(runtime.websockets)}; "
                    f"worker_returncode={runtime.process.returncode}"
                )
                update_exploration_step(
                    exploration_run_id,
                    step_index,
                    status="failed",
                    ended_at=now_iso(),
                    error=f"步骤执行超过 {EXPLORATION_STEP_TIMEOUT_SECONDS} 秒，未收到 worker 结果；{diagnostics}",
                )
                write_exploration_log(
                    exploration_run_id,
                    "warning",
                    f"步骤 {step_index + 1} 超时，停止自动探索并保留已采集证据；{diagnostics}",
                )
                await close_browser_runtime(session_id, f"步骤 {step_index + 1} 超时，停止自动探索并保留已采集证据")
                break

            step_result = runtime.step_results.get(step_index, {})
            if step_result.get("status") != "passed":
                status = "partial"
                continue
            evidence = step_result.get("evidence") or {}
            screenshot_path = evidence.get("screenshotPath") or ""
            final_screenshot = screenshot_path or final_screenshot

        await push_stage("采集候选元素", "聚合每个步骤的候选元素和页面结构")
        with get_db() as conn:
            step_rows = conn.execute(
                "SELECT * FROM exploration_steps WHERE exploration_run_id = ? ORDER BY step_index ASC",
                (exploration_run_id,),
            ).fetchall()
        seen_candidates: set[tuple[str, str]] = set()
        for step_row in step_rows:
            step_candidates = safe_json_loads(step_row["candidates_json"], [])
            structure = safe_json_loads(step_row["structure_json"], {})
            if structure:
                structures.append(
                    f"步骤 {step_row['step_index'] + 1}：{structure.get('title', '')}；"
                    f"按钮 {structure.get('buttons', 0)} 个；输入 {structure.get('inputs', 0)} 个；"
                    f"链接 {structure.get('links', 0)} 个；候选元素 {len(step_candidates)} 个"
                )
            if step_row["screenshot_path"]:
                final_screenshot = step_row["screenshot_path"]
            for element in step_candidates:
                locator_key = (element.get("locatorType", ""), element.get("locatorValue", ""))
                if locator_key in seen_candidates or not locator_key[1]:
                    continue
                seen_candidates.add(locator_key)
                source = element.get("source", "")
                element["source"] = f"{source} · 来源步骤 {step_row['step_index'] + 1}"
                element["stepIndex"] = step_row["step_index"]
                element["sourceUrl"] = step_row["url_after"] or step_row["url_before"] or ""
                element["screenshotPath"] = step_row["screenshot_path"] or ""
                candidates.append(element)
        if not candidates:
            try:
                latest_discovery = await discover_page(work_item_id, target_url)
                for element in latest_discovery.get("elements", []):
                    element["source"] = f"{element.get('source', '')} · 来源步骤: 兜底最终页面"
                    candidates.append(element)
                structures.append(latest_discovery.get("page_structure", ""))
                final_screenshot = latest_discovery.get("screenshot_path") or final_screenshot
            except Exception as exc:
                status = "partial"
                latest_discovery = {}
                message = f"兜底最终页面探索失败，保留已采集步骤证据: {exc}"
                structures.append(message)
                write_exploration_log(exploration_run_id, "warning", message)
        if not candidates:
            candidates.append(
                {
                    "area": "探索失败上下文",
                    "name": "目标页面访问失败",
                    "locatorType": "text",
                    "locatorValue": target_url or "页面访问失败",
                    "source": "自动探索未采集到候选元素，请人工编辑或重试",
                    "confirmed": False,
                    "stepIndex": None,
                    "sourceUrl": target_url,
                    "screenshotPath": final_screenshot,
                }
            )
        result_for_db = {
            "notes": f"多步骤探索完成：执行 {len(plan)} 个计划步骤，浏览器会话 {session_id}",
            "screenshot_path": final_screenshot,
            "page_structure": "\n".join([item for item in structures if item]) or latest_discovery.get("page_structure", ""),
            "elements": candidates,
            "plan": plan,
            "browser_session_id": session_id,
        }
        update_exploration_run(
            exploration_run_id,
            status=status,
            stage_key="complete",
            stage_label="完成",
            progress=100,
            ended_at=now_iso(),
            screenshot_path=final_screenshot,
            preview_path="",
            result_json=json.dumps(result_for_db, ensure_ascii=False),
            result_status=status,
            error=None,
        )
        write_exploration_log(
            exploration_run_id,
            "success",
            f"探索完成：采集到 {len(candidates)} 个候选元素，请人工确认 selector",
        )
        await broadcast_browser_event(runtime, {"type": "status", "status": "Live", "message": "自动探索完成，可人工接管"})
        update_work_item(work_item_id, stage="页面探索", status="explored-draft")
    except HTTPException as exc:
        message = str(exc.detail)
        update_exploration_run(
            exploration_run_id,
            status="failed",
            stage_key="complete",
            stage_label="异常结束",
            progress=100,
            ended_at=now_iso(),
            error=message,
        )
        write_exploration_log(exploration_run_id, "error", message)
        update_work_item(work_item_id, stage="页面探索", status="failed")
    except Exception as exc:
        message = f"执行探索异常: {exc}"
        update_exploration_run(
            exploration_run_id,
            status="failed",
            stage_key="complete",
            stage_label="异常结束",
            progress=100,
            ended_at=now_iso(),
            error=message,
        )
        write_exploration_log(exploration_run_id, "error", message)
        update_work_item(work_item_id, stage="页面探索", status="failed")


async def discover_page(
    work_item_id: str,
    target_url: str,
    event_callback: Optional[ExplorationEventCallback] = None,
) -> dict[str, Any]:
    if not target_url:
        raise HTTPException(status_code=400, detail="缺少目标 URL，无法执行探索")
    DISCOVERY_DIR.mkdir(parents=True, exist_ok=True)
    screenshot_path = DISCOVERY_DIR / f"{work_item_id}-{uuid.uuid4().hex[:6]}.png"
    script = r"""
const { chromium } = require('playwright');
const [targetUrl, screenshotPath] = process.argv.slice(1);
const emit = (payload) => console.log(JSON.stringify(payload));
(async () => {
  let browser;
  try {
    emit({ type: 'stage', stage: '启动浏览器', message: '正在启动 Chromium 浏览器' });
    browser = await chromium.launch({ headless: true });
    emit({ type: 'stage', stage: '创建页面', message: '创建 1440x900 浏览器页面' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    emit({ type: 'stage', stage: '打开目标 URL', message: `导航到 ${targetUrl}` });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    emit({ type: 'stage', stage: '等待页面加载', message: '等待 DOM 和网络请求进入稳定状态' });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
      emit({ type: 'log', stage: '等待页面加载', message: 'networkidle 超时，继续基于已加载 DOM 执行探索' });
    });
    const title = await page.title();
    emit({ type: 'stage', stage: '采集候选元素', message: '扫描可见 button、a、input、select 和稳定 test id' });
    const elements = await page.evaluate(() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const labelFor = (el) => {
        if (el.id) {
          const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (label?.innerText?.trim()) return label.innerText.trim();
        }
        return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || '';
      };
      return Array.from(document.querySelectorAll('button,a,input,textarea,select,[data-testid],[data-test]'))
        .filter(visible)
        .slice(0, 24)
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const text = labelFor(el).trim().replace(/\s+/g, ' ').slice(0, 80);
          const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
          const placeholder = el.getAttribute('placeholder');
          const aria = el.getAttribute('aria-label');
          let locatorType = 'text';
          let locatorValue = text;
          if (testId) {
            locatorType = 'testid';
            locatorValue = testId;
          } else if (placeholder) {
            locatorType = 'placeholder';
            locatorValue = placeholder;
          } else if (aria) {
            locatorType = 'role';
            locatorValue = aria;
          }
          return {
            area: document.title || location.pathname,
            name: text || tag,
            locatorType,
            locatorValue: locatorValue || text || tag,
            source: `自动探索 ${tag}${testId ? ' data-test' : placeholder ? ' placeholder' : aria ? ' aria-label' : ' text'}`,
            confirmed: false
          };
        });
    });
    emit({ type: 'stage', stage: '生成页面截图', message: `写入目标页面截图 ${screenshotPath}` });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    emit({ type: 'result', title, elements });
  } catch (error) {
    emit({ type: 'error', message: error?.stack || String(error) });
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
"""
    process = await asyncio.create_subprocess_exec(
        "node",
        "-e",
        script,
        target_url,
        str(screenshot_path),
        cwd=ROOT_DIR,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert process.stdout is not None
    assert process.stderr is not None
    stderr_task = asyncio.create_task(process.stderr.read())
    payload: dict[str, Any] | None = None
    error_message = ""
    while True:
        raw = await process.stdout.readline()
        if not raw:
            break
        line = raw.decode(errors="replace").strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            event = {"type": "log", "stage": "采集候选元素", "message": line}
        if event_callback:
            await event_callback(event)
        if event.get("type") == "result":
            payload = event
        elif event.get("type") == "error":
            error_message = event.get("message", "")

    exit_code = await process.wait()
    stderr = (await stderr_task).decode(errors="replace")
    if process.returncode != 0:
        detail = error_message or stderr or f"退出码 {exit_code}"
        raise HTTPException(status_code=502, detail=f"执行探索失败: {detail}")
    if payload is None:
        detail = stderr or "未收到浏览器探索结果"
        raise HTTPException(status_code=502, detail=f"执行探索失败: {detail}")
    elements = payload.get("elements", [])
    encoded_preview = base64.b64encode(screenshot_path.read_bytes()).decode("ascii") if screenshot_path.exists() else ""
    return {
        "notes": f"自动探索完成：{target_url}",
        "screenshot_path": str(screenshot_path),
        "preview_data_url": f"data:image/png;base64,{encoded_preview}" if encoded_preview else "",
        "page_structure": f"页面标题：{payload.get('title') or '未获取'}；候选元素：{len(elements)} 个。请人工确认后再保存为最终 selector。",
        "elements": elements,
    }


def row_to_run(row: sqlite3.Row) -> dict[str, Any]:
    payload = {
        "id": row["id"],
        "suiteId": row["suite_id"],
        "suiteName": row["suite_name"],
        "spec": row["spec"],
        "status": row["status"],
        "stage": {"key": row["stage_key"], "label": row["stage_label"]},
        "progress": row["progress"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "exitCode": row["exit_code"],
        "reportPath": row["report_path"],
        "screenshotPath": row["screenshot_path"],
        "workItemId": row["work_item_id"] if "work_item_id" in row.keys() else None,
        "browserSessionId": row["browser_session_id"] if "browser_session_id" in row.keys() else None,
        "browserSession": None,
    }
    if payload["browserSessionId"]:
        with get_db() as conn:
            session_row = conn.execute("SELECT * FROM browser_sessions WHERE id = ?", (payload["browserSessionId"],)).fetchone()
        if session_row is not None:
            payload["browserSession"] = row_to_browser_session(session_row)
    return payload


def row_to_automation_flow(row: sqlite3.Row, include_logs: bool = True) -> dict[str, Any]:
    work_item_id = row["work_item_id"] or ""
    latest_run_id = row["latest_run_id"] or ""
    exploration_run_id = row["latest_exploration_run_id"] or ""
    with get_db() as conn:
        feature = feature_summary(conn, row["feature_id"] if "feature_id" in row.keys() else "")
    payload = {
        "id": row["id"],
        "flowRunId": row["id"],
        "workItemId": work_item_id,
        "projectId": "",
        **feature,
        "status": row["status"],
        "stage": row["stage"],
        "progress": row["progress"],
        "currentAttempt": row["current_attempt"],
        "latestRunId": latest_run_id,
        "latestExplorationRunId": exploration_run_id,
        "casesPath": row["cases_path"],
        "specPath": row["spec_path"],
        "reportPath": row["report_path"],
        "htmlReportPath": row["html_report_path"],
        "error": row["error"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "workItem": None,
        "latestRun": None,
        "explorationRun": None,
        "logs": [],
        "flowArtifacts": [],
        "artifacts": {
            "casesPath": row["cases_path"],
            "specPath": row["spec_path"],
            "reportPath": row["report_path"],
            "htmlReportPath": row["html_report_path"],
        },
    }
    if work_item_id:
        with contextlib.suppress(HTTPException):
            payload["workItem"] = get_work_item(work_item_id)
            payload["projectId"] = payload["workItem"].get("projectId", "")
    if latest_run_id:
        with get_db() as conn:
            run_row = conn.execute("SELECT * FROM runs WHERE id = ?", (latest_run_id,)).fetchone()
        if run_row is not None:
            payload["latestRun"] = row_to_run(run_row)
    if exploration_run_id:
        with contextlib.suppress(HTTPException):
            payload["explorationRun"] = get_exploration_run_payload(exploration_run_id)
    if include_logs:
        with get_db() as conn:
            payload["logs"] = [
                {
                    "id": item["id"],
                    "createdAt": item["created_at"],
                    "stage": item["stage"],
                    "level": item["level"],
                    "message": item["message"],
                    "evidenceType": item["evidence_type"],
                    "evidencePath": item["evidence_path"],
                    "linkedRunId": item["linked_run_id"],
                }
                for item in conn.execute(
                    "SELECT * FROM automation_flow_logs WHERE flow_run_id = ? ORDER BY id ASC",
                    (row["id"],),
                ).fetchall()
            ]
            payload["flowArtifacts"] = flow_artifacts(row["id"])
    return payload


def row_to_automation_flow_summary(row: sqlite3.Row) -> dict[str, Any]:
    work_item_id = row["work_item_id"] or ""
    flow_feature_id = row["feature_id"] if "feature_id" in row.keys() else ""
    with get_db() as conn:
        work_item_row = conn.execute("SELECT * FROM work_items WHERE id = ?", (work_item_id,)).fetchone() if work_item_id else None
        project_id = ""
        if work_item_row is not None:
            project_id = work_item_row["project_id"] if "project_id" in work_item_row.keys() and work_item_row["project_id"] else DEFAULT_PROJECT_ID
            feature_id = work_item_row["feature_id"] if "feature_id" in work_item_row.keys() and work_item_row["feature_id"] else flow_feature_id
        else:
            feature_id = flow_feature_id
        feature = feature_summary(conn, feature_id)
    return {
        "id": row["id"],
        "flowRunId": row["id"],
        "workItemId": work_item_id,
        "projectId": project_id,
        **feature,
        "status": row["status"],
        "stage": row["stage"],
        "progress": row["progress"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "error": row["error"],
        "workItem": row_to_work_item_summary(work_item_row) if work_item_row is not None else None,
    }


def get_automation_flow_payload(flow_run_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM automation_flow_runs WHERE id = ?", (flow_run_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Automation flow not found")
    return row_to_automation_flow(row)


def set_flow_stage(flow_run_id: str, stage: str, progress: int, status: str = "running") -> None:
    update_automation_flow(flow_run_id, stage=stage, progress=progress, status=status)


def block_automation_flow(flow_run_id: str, stage: str, message: str) -> None:
    update_automation_flow(flow_run_id, stage=stage, status="blocked", progress=100, ended_at=now_iso(), error=message)
    write_automation_flow_log(flow_run_id, stage, "blocked", message)


def fail_automation_flow(flow_run_id: str, stage: str, message: str) -> None:
    update_automation_flow(flow_run_id, stage=stage, status="failed", progress=100, ended_at=now_iso(), error=message)
    write_automation_flow_log(flow_run_id, stage, "error", message)


def is_sauce_demo_item(item: sqlite3.Row) -> bool:
    text = f"{item['target_url']} {item['title']} {item['requirement']}".lower()
    return "saucedemo" in text or "sauce demo" in text


def selector_confidence(element: dict[str, Any]) -> int:
    locator_type = str(element.get("locatorType", element.get("locator_type", ""))).strip().lower()
    locator_value = str(element.get("locatorValue", element.get("locator_value", ""))).strip()
    source = str(element.get("source", "")).lower()
    source_url = str(element.get("sourceUrl", element.get("source_url", ""))).lower()
    if not locator_value or len(locator_value) > 120:
        return 0
    if locator_value.startswith(("http://", "https://")) or "页面访问失败" in locator_value:
        return 0
    if re.fullmatch(r"[0-9a-f]{8,}(-[0-9a-f]{4,})*", locator_value, re.IGNORECASE):
        return 0
    score = {
        "testid": 100,
        "data-testid": 100,
        "data-test": 100,
        "label": 88,
        "placeholder": 86,
        "role": 76,
        "text": 58,
    }.get(locator_type, 0)
    if "data-test" in source or "data-testid" in source:
        score += 8
    if any(token in locator_value.lower() for token in ["username", "password", "login", "products", "cart", "checkout", "continue", "error"]):
        score += 5
    if any(token in locator_value for token in ["欢迎您", "首页", "基本情况", "电能质量", "工单中心", "线损管理", "供电可靠性"]):
        score += 22
    if "#/home" in source_url:
        score += 10
    return min(score, 100)


def login_success_candidate(element: dict[str, Any]) -> bool:
    locator_value = str(element.get("locatorValue", element.get("locator_value", ""))).strip()
    source_url = str(element.get("sourceUrl", element.get("source_url", ""))).lower()
    return "#/home" in source_url or any(token in locator_value for token in ["欢迎您", "首页", "基本情况", "电能质量", "工单中心", "线损管理", "供电可靠性"])


def auto_confirm_exploration_result(result: dict[str, Any]) -> tuple[dict[str, Any], int]:
    confirmed = 0
    login_success_confirmed = False
    seen: set[tuple[str, str]] = set()
    next_elements: list[dict[str, Any]] = []
    for element in result.get("elements", []):
        locator_type = str(element.get("locatorType", element.get("locator_type", ""))).strip()
        locator_value = str(element.get("locatorValue", element.get("locator_value", ""))).strip()
        key = (locator_type.lower(), locator_value)
        if key in seen:
            continue
        seen.add(key)
        confidence = selector_confidence(element)
        should_confirm = confidence >= 70
        if login_success_candidate({**element, "locatorType": locator_type, "locatorValue": locator_value}) and confidence >= 58:
            should_confirm = True
        next_element = {
            **element,
            "locatorType": locator_type,
            "locatorValue": locator_value,
            "confirmed": should_confirm,
            "source": f"{element.get('source', '')} · 自动置信度 {confidence}",
        }
        if next_element["confirmed"]:
            confirmed += 1
            login_success_confirmed = login_success_confirmed or login_success_candidate(next_element)
        next_elements.append(next_element)
    if next_elements and not login_success_confirmed:
        for element in next_elements:
            if login_success_candidate(element):
                element["confirmed"] = True
                element["source"] = f"{element.get('source', '')} · 自动补充登录后状态元素"
                confirmed += 1
                login_success_confirmed = True
                break
    next_result = {**result, "elements": next_elements}
    return next_result, confirmed


async def wait_for_exploration_result(exploration_run_id: str, timeout_seconds: int = EXPLORATION_TIME_BUDGET_SECONDS + 60) -> dict[str, Any]:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while True:
        payload = get_exploration_run_payload(exploration_run_id)
        if payload["status"] in {"passed", "partial", "failed"}:
            return payload
        if asyncio.get_running_loop().time() >= deadline:
            update_exploration_run(
                exploration_run_id,
                status="failed",
                stage_key="complete",
                stage_label="超时",
                progress=100,
                ended_at=now_iso(),
                error="等待页面探索完成超时",
            )
            return get_exploration_run_payload(exploration_run_id)
        await asyncio.sleep(1)


def run_log_text(run_id: str) -> str:
    with get_db() as conn:
        rows = conn.execute("SELECT level, message FROM logs WHERE run_id = ? ORDER BY id ASC", (run_id,)).fetchall()
    return "\n".join(f"[{row['level']}] {row['message']}" for row in rows)


async def wait_for_no_active_playwright_run(timeout_seconds: int = 90) -> None:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while True:
        with get_db() as conn:
            active = conn.execute("SELECT id FROM runs WHERE status = 'running' LIMIT 1").fetchone()
        if active is None:
            return
        if asyncio.get_running_loop().time() >= deadline:
            raise HTTPException(status_code=409, detail="已有 Playwright 运行仍在执行，无法启动一键全流程验证")
        await asyncio.sleep(1)


async def run_work_item_draft_once(work_item_id: str, flow_run_id: str = "") -> sqlite3.Row:
    item = get_work_item_row(work_item_id)
    script = latest_script_for_work_item(work_item_id)
    if not script:
        raise HTTPException(status_code=400, detail="请先生成或保存草稿 Playwright 脚本")
    if "test(" not in script or "expect(" not in script:
        raise HTTPException(status_code=400, detail="脚本基础校验失败：需要包含 test 和 expect")
    await wait_for_no_active_playwright_run()
    relative_spec = write_draft_spec(item, script)
    with get_db() as conn:
        for case_row in conn.execute("SELECT id FROM test_cases WHERE work_item_id = ?", (work_item_id,)).fetchall():
            conn.execute(
                """
                UPDATE test_cases
                SET spec_path = ?, automation_status = 'automated', updated_at = ?
                WHERE id = ?
                """,
                (relative_spec, now_iso(), case_row["id"]),
            )
    suite = {
        "id": item["slug"],
        "name": item["title"],
        "spec": relative_spec,
        "priority": "P0",
        "cases": 1,
        "description": item["requirement"],
    }
    run_id = uuid.uuid4().hex[:12]
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO runs (
                id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                started_at, report_path, screenshot_path, work_item_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                suite["id"],
                suite["name"],
                suite["spec"],
                "running",
                "prepare",
                "准备环境",
                6,
                now_iso(),
                str(REPORT_INDEX),
                str(SCREENSHOT_PATH),
                work_item_id,
            ),
        )
    update_work_item(work_item_id, stage="运行验证", status="running", latest_run_id=run_id)
    if flow_run_id:
        update_automation_flow(flow_run_id, latest_run_id=run_id)
    write_log(run_id, "info", f"创建测试运行: {suite['name']}")
    render_preview(run_id, "running", "准备环境", 6, [])
    await run_playwright(run_id, suite, work_item_id)
    with get_db() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="Playwright 运行记录丢失")
    return row


def write_temporary_failure_report(flow_run_id: str, item: sqlite3.Row, cases: str, script: str, run: sqlite3.Row | None, reason: str) -> str:
    run_dir = FLOW_RUN_ARTIFACT_DIR / flow_run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    report_path = run_dir / "failure-report.md"
    run_logs = report_log_excerpt(run["id"]) if run is not None else "无运行日志。"
    command = f"npx playwright test {run['spec']} --project=chromium --reporter=list,html" if run is not None else "未启动 Playwright"
    _, case_stats, coverage_matrix = report_case_statistics(cases)
    run_id = run["id"] if run is not None else "无"
    html_report = relative_or_absolute(run["report_path"] or REPORT_INDEX) if run is not None else relative_or_absolute(REPORT_INDEX)
    screenshot = relative_or_absolute(run["screenshot_path"] or SCREENSHOT_PATH) if run is not None else relative_or_absolute(SCREENSHOT_PATH)
    started_at = report_time(run["started_at"]) if run is not None else "无"
    ended_at = report_time(run["ended_at"]) if run is not None else "无"
    duration = report_duration(run["started_at"], run["ended_at"]) if run is not None else "无"
    content = f"""# {item['title']} 临时失败报告

## 1. 报告元信息

| 项目 | 内容 |
| --- | --- |
| 报告生成时间 | {report_cell(report_time(now_iso()))} |
| 工单 ID | {report_cell(item['id'])} |
| Flow Run ID | {report_cell(flow_run_id)} |
| 最近 Run ID | {report_cell(run_id)} |
| 开始时间 | {report_cell(started_at)} |
| 结束时间 | {report_cell(ended_at)} |
| 执行耗时 | {report_cell(duration)} |
| 草稿脚本长度 | {len(script)} 字符 |

## 2. 测试范围与输入

- 需求：{item['requirement']}
- 目标 URL：{item['target_url'] or '未提供'}
- 验收标准：{item['acceptance'] or '未提供'}
- 角色/账号：{item['role'] or '未提供'}
- 测试数据：{item['test_data'] or '未提供'}
- 排除项：{item['exclusions'] or '未明确要求的视觉细节、非目标浏览器和无关业务流程默认范围外'}

## 3. 测试用例统计

{case_stats}

## 4. 覆盖矩阵

{coverage_matrix}

## 5. 原始测试用例

{cases or '未生成测试用例。'}

## 6. 执行数据支撑

- Playwright HTML report：`{html_report}`
- 截图/预览路径：`{screenshot}`
- 最近 run：{run_id}

### 执行命令

```bash
{command}
```

## 7. 失败结论与证据

- 状态：失败。
- 失败原因：{reason}

{report_failure_analysis(run, reason)}

## 8. 失败日志摘录

```text
{run_logs}
```

## 9. 残余风险与下一步建议

- 该报告是临时失败报告，不代表最终已验证产物。
- 自愈仅限测试代码、测试数据、等待策略、selector、断言或必要 Playwright 配置。
- 需要根据 HTML report、截图、trace、console/network 日志继续定位。
- 若三轮自愈后仍失败，应将失败证据、复现路径和影响范围沉淀为缺陷或环境问题记录。
"""
    report_path.write_text(content, encoding="utf-8")
    return relative_or_absolute(report_path)


async def execute_automation_flow(flow_run_id: str) -> None:
    latest_run: sqlite3.Row | None = None
    try:
        set_flow_stage(flow_run_id, "需求分析", 5)
        write_automation_flow_log(flow_run_id, "需求分析", "info", "开始读取需求并创建测试工单")
        with get_db() as conn:
            flow_row = conn.execute("SELECT * FROM automation_flow_runs WHERE id = ?", (flow_run_id,)).fetchone()
        if flow_row is None:
            return
        if not flow_row["work_item_id"]:
            block_automation_flow(flow_run_id, "需求分析", "阻塞：需求文本为空，请先输入需求、PRD、验收标准、缺陷描述或页面说明。")
            return

        item = get_work_item_row(flow_row["work_item_id"])
        analysis = requirement_analysis(item)
        create_flow_artifact(
            flow_run_id,
            item["id"],
            "需求分析",
            "requirement-analysis",
            "需求结构化抽取",
            format_requirement_analysis_artifact(item, analysis),
            status="ready",
            source="ai" if analysis.get("source") == "ai" else "fallback",
        )
        write_automation_flow_log(flow_run_id, "需求分析", "info", f"功能目标：{analysis.get('goal', item['requirement'])}")
        write_automation_flow_log(flow_run_id, "需求分析", "info", f"用户路径：{analysis.get('userPath', item['requirement'])}")
        write_automation_flow_log(flow_run_id, "需求分析", "info", f"验收标准：{analysis.get('acceptance', item['acceptance'] or '未提供')}")
        write_automation_flow_log(flow_run_id, "需求分析", "info", f"角色/测试数据：{analysis.get('role', item['role'] or '未提供')}；{analysis.get('testData', item['test_data'] or '未提供')}")
        if not item["target_url"]:
            block_automation_flow(flow_run_id, "需求分析", "缺少目标 URL，无法执行真实页面探索")
            return
        if not item["test_data"] and not is_sauce_demo_item(item):
            block_automation_flow(flow_run_id, "需求分析", "缺少账号或测试数据，且无法从需求或仓库上下文安全推断")
            return

        set_flow_stage(flow_run_id, "项目预检", 14)
        context = project_context()
        write_automation_flow_log(flow_run_id, "项目预检", "info", f"Playwright 配置：{context['playwrightConfig']}；reporter：{context['reporter']}")
        write_automation_flow_log(flow_run_id, "项目预检", "info", f"测试目录：{context['testDir']}；spec 约定：{context['specPattern']}；用例文档：{context['casePattern']}")
        write_automation_flow_log(flow_run_id, "项目预检", "info", f"包管理脚本：{context['testScript'] or '未发现'}")
        write_automation_flow_log(flow_run_id, "项目预检", "info", f"已有 spec {context['existingSpecs']} 个，用例文档 {context['existingCaseDocs']} 个；locator 风格：{context['locatorStyle']}")

        set_flow_stage(flow_run_id, "用例设计", 25)
        cases_artifact_id = create_flow_artifact(
            flow_run_id,
            item["id"],
            "用例设计",
            "test-cases",
            "可追溯测试用例",
            "",
            status="streaming",
            source="ai" if get_openai_api_key() else "fallback",
        )
        cases_markdown = await stream_ai_test_cases(item, cases_artifact_id)
        if cases_markdown:
            update_flow_artifact(cases_artifact_id, content=cases_markdown, status="ready", source="ai")
        else:
            cases_markdown = default_cases(item)
            update_flow_artifact(cases_artifact_id, content=cases_markdown, status="fallback", source="fallback")
        generate_cases(item["id"], ContentRequest(content=cases_markdown))
        write_automation_flow_log(flow_run_id, "用例设计", "success", "已保存可追溯测试用例，包含 ID、优先级、覆盖需求、步骤和期望结果")

        set_flow_stage(flow_run_id, "页面探索", 38)
        plan_artifact_id = create_flow_artifact(
            flow_run_id,
            item["id"],
            "页面探索",
            "exploration-plan",
            "页面探索计划",
            "正在生成页面探索计划...",
            status="streaming",
            source="ai" if get_openai_api_key() else "fallback",
        )
        exploration = await run_exploration(item["id"])
        update_flow_artifact(
            plan_artifact_id,
            content=format_exploration_plan_artifact(exploration.get("plan") or []),
            status="ready",
            source="ai" if get_openai_api_key() else "fallback",
        )
        exploration_run_id = exploration["id"]
        update_automation_flow(flow_run_id, latest_exploration_run_id=exploration_run_id)
        write_automation_flow_log(flow_run_id, "页面探索", "info", f"真实页面探索已启动: {exploration_run_id}", "exploration-run", "", exploration_run_id)
        exploration_payload = await wait_for_exploration_result(exploration_run_id)
        if exploration_payload["status"] == "failed" or not exploration_payload.get("result"):
            message = exploration_payload.get("error") or "页面探索失败，未获得可用于确认 selector 的真实证据"
            block_automation_flow(flow_run_id, "页面探索", message)
            return
        confirmed_result, confirmed_count = auto_confirm_exploration_result(exploration_payload["result"])
        if confirmed_count == 0:
            block_automation_flow(flow_run_id, "页面探索", "自动探索未发现高置信 selector，请人工确认元素后再生成最终脚本")
            return
        save_exploration(item["id"], ExplorationRequest(
            notes=confirmed_result.get("notes", ""),
            screenshot_path=confirmed_result.get("screenshot_path", ""),
            page_structure=confirmed_result.get("page_structure", ""),
            elements=confirmed_result.get("elements", []),
        ))
        create_flow_artifact(
            flow_run_id,
            item["id"],
            "页面探索",
            "exploration-result",
            "页面探索执行结果",
            format_exploration_result_artifact(exploration_payload),
            status="ready" if exploration_payload["status"] == "passed" else "fallback",
            source="playwright",
            path=confirmed_result.get("screenshot_path", ""),
        )
        create_flow_artifact(
            flow_run_id,
            item["id"],
            "页面探索",
            "confirmed-elements",
            "已确认页面元素",
            format_confirmed_elements_artifact(confirmed_result.get("elements", []), confirmed_count),
            status="ready",
            source="system",
            path=confirmed_result.get("screenshot_path", ""),
        )
        write_automation_flow_log(flow_run_id, "页面探索", "success", f"已自动确认 {confirmed_count} 个高置信 selector")

        set_flow_stage(flow_run_id, "脚本实现", 54)
        item = get_work_item_row(item["id"])
        with get_db() as conn:
            elements = conn.execute(
                "SELECT * FROM confirmed_elements WHERE work_item_id = ? AND confirmed = 1 ORDER BY id ASC",
                (item["id"],),
            ).fetchall()
        script_artifact_id = create_flow_artifact(
            flow_run_id,
            item["id"],
            "脚本实现",
            "playwright-script",
            "Playwright 草稿脚本",
            "",
            status="streaming",
            source="ai" if get_openai_api_key() else "fallback",
        )
        script_content = await stream_ai_playwright_script(item, elements, cases_markdown, script_artifact_id)
        if script_content:
            update_flow_artifact(script_artifact_id, content=script_content, status="ready", source="ai")
        else:
            script_content = default_script(item, elements)
            update_flow_artifact(script_artifact_id, content=script_content, status="fallback", source="fallback")
        generate_script(item["id"], ContentRequest(content=script_content))
        write_automation_flow_log(flow_run_id, "脚本实现", "success", "已生成草稿 Playwright spec，关键 locator 来自已确认页面元素")

        set_flow_stage(flow_run_id, "运行验证", 68)
        latest_run = await run_work_item_draft_once(item["id"], flow_run_id)
        run_summary_artifact_id = create_flow_artifact(
            flow_run_id,
            item["id"],
            "运行验证",
            "execution-summary",
            "Playwright 运行验证摘要",
            format_run_summary_artifact(latest_run),
            status="verified" if latest_run["status"] == "passed" else "failed",
            source="playwright",
            path=relative_or_absolute(latest_run["report_path"] or REPORT_INDEX),
        )
        update_automation_flow(
            flow_run_id,
            latest_run_id=latest_run["id"],
            html_report_path=relative_or_absolute(latest_run["report_path"] or REPORT_INDEX),
        )
        write_automation_flow_log(
            flow_run_id,
            "运行验证",
            "success" if latest_run["status"] == "passed" else "error",
            f"Playwright 真实执行完成，状态 {latest_run['status']}，退出码 {latest_run['exit_code']}",
            "playwright-run",
            latest_run["report_path"] or str(REPORT_INDEX),
            latest_run["id"],
        )

        current_script = latest_script_for_work_item(item["id"])
        if latest_run["status"] != "passed":
            set_flow_stage(flow_run_id, "自愈诊断", 76, status="healing")
            healed = False
            for attempt in range(1, 4):
                update_automation_flow(flow_run_id, current_attempt=attempt, status="healing")
                failure_log = run_log_text(latest_run["id"])
                write_automation_flow_log(flow_run_id, "自愈诊断", "warning", f"第 {attempt} 轮自愈开始：读取失败日志、HTML report 和已确认元素")
                healing_summary_artifact_id = create_flow_artifact(
                    flow_run_id,
                    item["id"],
                    "自愈诊断",
                    "healing-summary",
                    f"第 {attempt} 轮失败诊断",
                    f"""## 第 {attempt} 轮自愈诊断

- 失败日志摘要：{failure_log[-1200:] or '未捕获到失败日志'}
- 允许修改范围：测试数据、等待策略、selector、断言、Playwright 测试代码
- 当前 HTML report：`{relative_or_absolute(latest_run["report_path"] or REPORT_INDEX)}`
""",
                    status="ready",
                    source="playwright",
                    path=relative_or_absolute(latest_run["report_path"] or REPORT_INDEX),
                )
                healed_artifact_id = create_flow_artifact(
                    flow_run_id,
                    item["id"],
                    "自愈诊断",
                    "healed-script",
                    f"第 {attempt} 轮修复脚本",
                    "",
                    status="streaming",
                    source="ai" if get_openai_api_key() else "fallback",
                )
                healed_script = await stream_ai_healed_script(item, current_script, latest_run, failure_log, elements, healed_artifact_id)
                if not script_changed_enough(current_script, healed_script, failure_log):
                    reason = "未生成有效修复脚本" if not healed_script else "修复脚本与上一轮无实质变化或仍包含本轮失败 locator"
                    write_automation_flow_log(flow_run_id, "自愈诊断", "warning", f"第 {attempt} 轮自愈无效：{reason}，停止重复重跑")
                    update_flow_artifact(
                        healed_artifact_id,
                        content=healed_script or current_script,
                        status="rejected",
                        source="ai" if healed_script else "fallback",
                    )
                    update_flow_artifact(
                        healing_summary_artifact_id,
                        content=f"""## 第 {attempt} 轮自愈诊断

- 失败日志摘要：{failure_log[-1200:] or '未捕获到失败日志'}
- 允许修改范围：测试数据、等待策略、selector、断言、Playwright 测试代码
- 本轮结果：修复无效，{reason}
- HTML report：`{relative_or_absolute(latest_run["report_path"] or REPORT_INDEX)}`
""",
                        status="failed",
                        path=relative_or_absolute(latest_run["report_path"] or REPORT_INDEX),
                    )
                    break
                update_flow_artifact(healed_artifact_id, content=healed_script, status="ready", source="ai")
                with get_db() as conn:
                    conn.execute(
                        "INSERT INTO generated_scripts (work_item_id, content, created_at) VALUES (?, ?, ?)",
                        (item["id"], healed_script, now_iso()),
                    )
                    conn.execute(
                        """
                        INSERT INTO healing_attempts (
                            work_item_id, round, failure_summary, proposed_fix, result, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            item["id"],
                            attempt,
                            failure_log[-1200:],
                            "AI 根据失败日志、Playwright error-context、截图路径和已确认 selector 修复测试脚本",
                            "已保存修复脚本并重新执行验证",
                            now_iso(),
                        ),
                    )
                current_script = healed_script
                write_automation_flow_log(flow_run_id, "自愈诊断", "info", f"第 {attempt} 轮已保存修复脚本，准备重新运行")
                latest_run = await run_work_item_draft_once(item["id"], flow_run_id)
                update_flow_artifact(
                    healing_summary_artifact_id,
                    content=f"""## 第 {attempt} 轮自愈诊断

- 失败日志摘要：{failure_log[-1200:] or '未捕获到失败日志'}
- 允许修改范围：测试数据、等待策略、selector、断言、Playwright 测试代码
- 本轮重跑结果：{latest_run["status"]}
- 退出码：{latest_run["exit_code"]}
- HTML report：`{relative_or_absolute(latest_run["report_path"] or REPORT_INDEX)}`
""",
                    status="verified" if latest_run["status"] == "passed" else "failed",
                    path=relative_or_absolute(latest_run["report_path"] or REPORT_INDEX),
                )
                update_flow_artifact(
                    run_summary_artifact_id,
                    content=format_run_summary_artifact(latest_run),
                    status="verified" if latest_run["status"] == "passed" else "failed",
                    path=relative_or_absolute(latest_run["report_path"] or REPORT_INDEX),
                )
                update_automation_flow(
                    flow_run_id,
                    latest_run_id=latest_run["id"],
                    html_report_path=relative_or_absolute(latest_run["report_path"] or REPORT_INDEX),
                    progress=min(94, 76 + attempt * 6),
                )
                write_automation_flow_log(
                    flow_run_id,
                    "自愈诊断",
                    "success" if latest_run["status"] == "passed" else "error",
                    f"第 {attempt} 轮重跑完成，状态 {latest_run['status']}，退出码 {latest_run['exit_code']}",
                    "playwright-run",
                    latest_run["report_path"] or str(REPORT_INDEX),
                    latest_run["id"],
                )
                if latest_run["status"] == "passed":
                    healed = True
                    break
            if not healed:
                failure_path = write_temporary_failure_report(
                    flow_run_id,
                    item,
                    cases_markdown,
                    current_script,
                    latest_run,
                    "三轮测试侧自愈后 Playwright 仍失败",
                )
                update_automation_flow(
                    flow_run_id,
                    status="failed",
                    stage="自愈诊断",
                    progress=100,
                    ended_at=now_iso(),
                    report_path=failure_path,
                    html_report_path=relative_or_absolute(latest_run["report_path"] or REPORT_INDEX),
                    error="三轮测试侧自愈后 Playwright 仍失败",
                )
                create_flow_artifact(
                    flow_run_id,
                    item["id"],
                    "自愈诊断",
                    "final-report",
                    "失败临时报告",
                    f"三轮测试侧自愈后 Playwright 仍失败。\n\n- 失败报告：`{failure_path}`\n- HTML report：`{relative_or_absolute(latest_run['report_path'] or REPORT_INDEX)}`",
                    status="failed",
                    source="system",
                    path=failure_path,
                )
                write_automation_flow_log(flow_run_id, "自愈诊断", "error", "三轮自愈后仍失败，已保存临时失败报告", "manual-report", failure_path, latest_run["id"])
                return

        set_flow_stage(flow_run_id, "保存已验证产物", 96)
        final_item = save_artifacts(item["id"], SaveArtifactsRequest(
            cases_markdown=cases_markdown,
            script_content=latest_script_for_work_item(item["id"]),
            report_content="",
        ))
        update_automation_flow(
            flow_run_id,
            status="completed",
            stage="保存已验证产物",
            progress=100,
            ended_at=now_iso(),
            cases_path=final_item.get("casesPath", ""),
            spec_path=final_item.get("specPath", ""),
            report_path=final_item.get("reportPath", ""),
            html_report_path=relative_or_absolute(latest_run["report_path"] or REPORT_INDEX) if latest_run else relative_or_absolute(REPORT_INDEX),
            error="",
        )
        create_flow_artifact(
            flow_run_id,
            item["id"],
            "保存已验证产物",
            "final-report",
            "最终交付物审阅",
            format_final_report_artifact(final_item, relative_or_absolute(latest_run["report_path"] or REPORT_INDEX) if latest_run else relative_or_absolute(REPORT_INDEX)),
            status="saved",
            source="system",
            path=final_item.get("reportPath", ""),
        )
        write_automation_flow_log(flow_run_id, "保存已验证产物", "success", "已保存最终测试用例、Playwright spec、人工测试报告和 HTML report")
    except HTTPException as exc:
        fail_automation_flow(flow_run_id, "运行验证", str(exc.detail))
    except Exception as exc:
        fail_automation_flow(flow_run_id, "运行验证", f"一键全流程异常: {exc}")


def write_log(run_id: str, level: str, message: str) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)",
            (run_id, now_iso(), level, message),
        )


def update_run(run_id: str, **fields: Any) -> None:
    if not fields:
        return
    keys = ", ".join(f"{key} = ?" for key in fields)
    with get_db() as conn:
        conn.execute(f"UPDATE runs SET {keys} WHERE id = ?", [*fields.values(), run_id])


def find_suite(suite_id: str) -> dict[str, Any]:
    for suite in TEST_SUITES:
        if suite["id"] == suite_id:
            return suite
    raise HTTPException(status_code=404, detail="Test suite not found")


def render_preview(run_id: str, status: str, stage: str, progress: int, lines: list[str]) -> None:
    SCREENSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    recent = "\n".join(lines[-6:]) or "Waiting for Playwright output..."
    escaped = (
        recent.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#061927"/>
      <stop offset="0.54" stop-color="#101d38"/>
      <stop offset="1" stop-color="#052f35"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect x="72" y="72" width="1136" height="536" rx="18" fill="#0a1220" stroke="#2dd4bf" stroke-opacity="0.45"/>
  <rect x="72" y="72" width="1136" height="48" rx="18" fill="#142238"/>
  <circle cx="108" cy="96" r="7" fill="#fb7185"/>
  <circle cx="132" cy="96" r="7" fill="#facc15"/>
  <circle cx="156" cy="96" r="7" fill="#34d399"/>
  <text x="188" y="102" fill="#9fb8d0" font-family="Menlo, monospace" font-size="18">Playwright Browser Preview · {run_id}</text>
  <text x="104" y="188" fill="#e5f9ff" font-family="Menlo, monospace" font-size="34">{status.upper()} / {stage}</text>
  <rect x="104" y="224" width="1072" height="18" rx="9" fill="#1f3045"/>
  <rect x="104" y="224" width="{max(12, int(1072 * progress / 100))}" height="18" rx="9" fill="#2dd4bf"/>
  <text x="104" y="292" fill="#8ddfd5" font-family="Menlo, monospace" font-size="20">Latest automation output</text>
  <foreignObject x="104" y="316" width="1072" height="220">
    <pre xmlns="http://www.w3.org/1999/xhtml" style="color:#cbd5e1;font:18px Menlo,monospace;white-space:pre-wrap;margin:0">{escaped}</pre>
  </foreignObject>
  <text x="104" y="664" fill="#64748b" font-family="Menlo, monospace" font-size="16">Screenshot polling preview · SQLite persisted run evidence</text>
</svg>"""
    SCREENSHOT_PATH.write_text(svg, encoding="utf-8")


LIVE_FIXTURE_SOURCE = r"""
import { test as base, expect } from '@playwright/test';
export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    const sessionId = process.env.QA_LIVE_SESSION_ID || '';
    const emit = (payload) => {
      if (!sessionId) return;
      process.stdout.write(`${JSON.stringify({ ...payload, live: true, sessionId })}\n`);
    };
    let client;
    try {
      client = await page.context().newCDPSession(page);
      client.on('Page.screencastFrame', async (frame) => {
        emit({
          type: 'frame',
          data: frame.data,
          format: frame.metadata?.format || 'jpeg',
          width: frame.metadata?.deviceWidth || 1440,
          height: frame.metadata?.deviceHeight || 900
        });
        await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
      });
      await client.send('Page.startScreencast', { format: 'jpeg', quality: 65, everyNthFrame: 1 });
      emit({ type: 'status', status: 'Live', message: '开始采集真实测试页面画面' });
      await use(page);
    } finally {
      if (client) {
        await client.send('Page.stopScreencast').catch(() => {});
      }
      emit({ type: 'status', status: 'Closing', message: '真实测试页面画面采集结束' });
    }
  }
});
"""


def rewrite_spec_import_for_live(source: str, fixture_relative: str) -> str | None:
    escaped_fixture = fixture_relative.replace("\\", "/")
    patterns = [
        re.compile(r"import\s*\{\s*expect\s*,\s*test\s*\}\s*from\s*['\"](?:@playwright/test|playwright/test)['\"]\s*;"),
    ]
    replacement = f"import {{ expect, test }} from '{escaped_fixture}';"
    for pattern in patterns:
        next_source, count = pattern.subn(replacement, source, count=1)
        if count:
            return next_source

    typed_pattern = re.compile(
        r"import\s*\{\s*expect\s*,\s*type\s+([^,}]+(?:\s*,\s*[^,}]+)*)\s*,\s*test\s*\}\s*from\s*['\"](?:@playwright/test|playwright/test)['\"]\s*;"
    )
    match = typed_pattern.search(source)
    if match:
        types = ", ".join(re.sub(r"^type\s+", "", item.strip()) for item in match.group(1).split(",") if item.strip())
        return typed_pattern.sub(
            f"import {{ expect, test }} from '{escaped_fixture}';\nimport type {{ {types} }} from '@playwright/test';",
            source,
            count=1,
        )
    return None


def prepare_live_execution_spec(run_id: str, spec: str) -> tuple[str, bool]:
    source_path = ROOT_DIR / spec
    if not source_path.exists():
        return spec, False
    run_dir = EXECUTION_LIVE_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    fixture_path = run_dir / "live-fixture.ts"
    fixture_path.write_text(LIVE_FIXTURE_SOURCE.strip() + "\n", encoding="utf-8")
    live_spec_path = run_dir / source_path.name
    fixture_relative = "./live-fixture"
    rewritten = rewrite_spec_import_for_live(source_path.read_text(encoding="utf-8"), fixture_relative)
    if rewritten is None:
        return spec, False
    live_spec_path.write_text(rewritten, encoding="utf-8")
    return str(live_spec_path.relative_to(ROOT_DIR)), True


def js_string(value: str) -> str:
    return json.dumps(value)


def write_execution_playwright_config(run_id: str) -> str:
    config_dir = EXECUTION_CONFIG_DIR / run_id
    config_dir.mkdir(parents=True, exist_ok=True)
    config_path = config_dir / "playwright.config.ts"
    config_path.write_text(
        f"""import {{ defineConfig, devices }} from '@playwright/test';

export default defineConfig({{
  testDir: {js_string(str(ROOT_DIR))},
  timeout: 30_000,
  expect: {{
    timeout: 7_000,
  }},
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', {{ outputFolder: {js_string(str(REPORT_INDEX.parent))}, open: 'never' }}],
  ],
  use: {{
    baseURL: 'https://www.saucedemo.com',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  }},
  projects: [
    {{
      name: 'chromium',
      use: {{ ...devices['Desktop Chrome'] }},
    }},
  ],
}});
""",
        encoding="utf-8",
    )
    return str(config_path.relative_to(ROOT_DIR))


async def handle_execution_live_event(runtime: BrowserRuntime, event: dict[str, Any]) -> None:
    event_type = event.get("type")
    runtime.last_worker_event_type = str(event_type or "")
    runtime.last_worker_event_at = now_iso()
    if event_type == "frame":
        runtime.last_frame = {
            "type": "frame",
            "sessionId": runtime.session_id,
            "data": event.get("data", ""),
            "format": event.get("format", "jpeg"),
            "width": event.get("width", DEFAULT_VIEWPORT["width"]),
            "height": event.get("height", DEFAULT_VIEWPORT["height"]),
        }
        await broadcast_browser_event(runtime, runtime.last_frame)
    elif event_type == "status":
        status = str(event.get("status") or runtime.status)
        runtime.status = status.lower()
        update_browser_session(runtime.session_id, status=runtime.status)
        await broadcast_browser_event(
            runtime,
            {
                "type": "status",
                "status": status,
                "sessionId": runtime.session_id,
                "message": event.get("message", ""),
            },
        )


async def run_playwright(run_id: str, suite: dict[str, Any], work_item_id: str | None = None) -> None:
    collected_lines: list[str] = []
    browser_session_id = ""
    live_spec = suite["spec"]
    live_enabled = False
    execution_config = ""
    try:
        try:
            target_url = ""
            if work_item_id:
                with get_db() as conn:
                    row = conn.execute("SELECT target_url FROM work_items WHERE id = ?", (work_item_id,)).fetchone()
                target_url = row["target_url"] if row else ""
            session = await start_live_execution_session(work_item_id or "", target_url)
            browser_session_id = session["id"]
            update_run(run_id, browser_session_id=browser_session_id)
            write_log(run_id, "info", f"真实执行画面通道已创建: {browser_session_id}")
            live_spec, live_enabled = prepare_live_execution_spec(run_id, suite["spec"])
            if live_enabled:
                write_log(run_id, "info", "开始采集真实测试页面画面")
            else:
                write_log(run_id, "warning", "该脚本导入形态暂不支持实时画面注入，回退为普通 Playwright 执行")
        except Exception as exc:
            write_log(run_id, "warning", f"真实执行画面通道启动失败，继续执行 Playwright: {exc}")

        for key, label, progress in STAGES[:2]:
            update_run(run_id, stage_key=key, stage_label=label, progress=progress)
            write_log(run_id, "info", label)
            render_preview(run_id, "running", label, progress, collected_lines)
            await asyncio.sleep(0.3)

        update_run(run_id, stage_key="execute", stage_label="执行脚本", progress=58)
        execution_config = write_execution_playwright_config(run_id)
        command = [
            "npx",
            "playwright",
            "test",
            "--config",
            execution_config,
            live_spec,
            "--project=chromium",
            "--reporter=list,html",
        ]
        if suite.get("grep"):
            command.extend(["--grep", suite["grep"]])
        write_log(run_id, "info", f"执行命令: {' '.join(command)}")
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=ROOT_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={
                **os.environ,
                "PLAYWRIGHT_HTML_OPEN": "never",
                "QA_LIVE_SESSION_ID": browser_session_id,
            },
            limit=BROWSER_WORKER_STREAM_LIMIT_BYTES,
        )

        assert process.stdout is not None
        live_runtime = BROWSER_RUNTIMES.get(browser_session_id) if browser_session_id else None
        while True:
            raw = await process.stdout.readline()
            if not raw:
                break
            line = raw.decode(errors="replace").rstrip()
            if line:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    event = None
                if event and event.get("live") and live_runtime is not None:
                    await handle_execution_live_event(live_runtime, event)
                    continue
                collected_lines.append(line)
                write_log(run_id, "info", line)
                render_preview(run_id, "running", "执行脚本", 58, collected_lines)

        exit_code = await process.wait()
        if exit_code != 0 and suite.get("grep") and any("No tests found" in line for line in collected_lines):
            escaped_grep = suite["grep"]
            no_match_message = f"未在 spec 中找到匹配用例 ID 的测试标题：{escaped_grep}。请确认 Playwright test 标题包含该用例 ID。"
            collected_lines.append(no_match_message)
            write_log(run_id, "error", no_match_message)
        for key, label, progress in STAGES[3:5]:
            update_run(run_id, stage_key=key, stage_label=label, progress=progress)
            write_log(run_id, "info", label)
            render_preview(run_id, "running", label, progress, collected_lines)
            await asyncio.sleep(0.2)

        status = "passed" if exit_code == 0 else "failed"
        update_run(
            run_id,
            status=status,
            stage_key="complete",
            stage_label="完成",
            progress=100,
            ended_at=now_iso(),
            exit_code=exit_code,
            report_path=str(REPORT_INDEX),
            screenshot_path=str(SCREENSHOT_PATH),
        )
        write_log(run_id, "success" if exit_code == 0 else "error", f"执行完成，退出码 {exit_code}")
        render_preview(run_id, status, "完成", 100, collected_lines)
        if work_item_id:
            update_work_item(work_item_id, stage="运行验证", status=status, latest_run_id=run_id)
        if suite.get("case_id"):
            with get_db() as conn:
                conn.execute(
                    """
                    UPDATE test_cases
                    SET latest_run_id = ?, latest_status = ?, automation_status = 'automated',
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (run_id, status, now_iso(), suite["case_id"]),
                )
                case_row = conn.execute("SELECT project_id, feature_id, title FROM test_cases WHERE id = ?", (suite["case_id"],)).fetchone()
                if case_row is not None:
                    register_deliverable(
                        conn,
                        case_row["project_id"],
                        "html-report",
                        f"{case_row['title']} Playwright HTML Report",
                        REPORT_INDEX,
                        work_item_id=work_item_id or "",
                        case_id=suite["case_id"],
                        run_id=run_id,
                        feature_id=case_row["feature_id"] or "",
                        status=status,
                        summary=f"用例执行状态：{status}",
                    )
                    register_deliverable(
                        conn,
                        case_row["project_id"],
                        "execution-preview",
                        f"{case_row['title']} 执行预览截图",
                        SCREENSHOT_PATH,
                        work_item_id=work_item_id or "",
                        case_id=suite["case_id"],
                        run_id=run_id,
                        feature_id=case_row["feature_id"] or "",
                        status=status,
                        summary="执行测试实时预览截图。",
                    )
        if browser_session_id:
            await close_browser_runtime(browser_session_id, f"执行完成，退出码 {exit_code}")
        with contextlib.suppress(Exception):
            shutil.rmtree(EXECUTION_LIVE_DIR / run_id)
        if execution_config:
            with contextlib.suppress(Exception):
                shutil.rmtree(EXECUTION_CONFIG_DIR / run_id)
    except Exception as exc:
        update_run(
            run_id,
            status="failed",
            stage_key="complete",
            stage_label="异常结束",
            progress=100,
            ended_at=now_iso(),
            exit_code=1,
            screenshot_path=str(SCREENSHOT_PATH),
        )
        write_log(run_id, "error", f"执行异常: {exc}")
        render_preview(run_id, "failed", "异常结束", 100, collected_lines + [str(exc)])
        if browser_session_id:
            await close_browser_runtime(browser_session_id, f"执行异常: {exc}")
        with contextlib.suppress(Exception):
            shutil.rmtree(EXECUTION_LIVE_DIR / run_id)
        if execution_config:
            with contextlib.suppress(Exception):
                shutil.rmtree(EXECUTION_CONFIG_DIR / run_id)


@app.on_event("startup")
async def startup() -> None:
    global AUTOMATION_FLOW_EVENT_LOOP
    AUTOMATION_FLOW_EVENT_LOOP = asyncio.get_running_loop()
    init_db()
    render_preview("idle", "idle", "等待执行", 0, ["Select a suite and start a run."])


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "qa-automation-platform", "ai": current_ai_status()}


@app.get("/api/dashboard-summary")
def dashboard_summary(project_id: str = "all") -> dict[str, Any]:
    return dashboard_summary_payload(project_id)


@app.post("/api/test/reset")
def reset_test_data() -> dict[str, Any]:
    if os.environ.get("QA_TEST_RESET_ENABLED") != "1":
        raise HTTPException(status_code=404, detail="Not found")
    for runtime in list(BROWSER_RUNTIMES.values()):
        with contextlib.suppress(Exception):
            runtime.process.terminate()
    BROWSER_RUNTIMES.clear()
    with get_db() as conn:
        for table in [
            "suite_run_cases",
            "suite_runs",
            "test_suite_cases",
            "test_suites",
            "automation_flow_artifacts",
            "automation_flow_logs",
            "automation_flow_runs",
            "deliverables",
            "test_cases",
            "feature_menus",
            "logs",
            "runs",
            "exploration_logs",
            "exploration_steps",
            "exploration_runs",
            "browser_sessions",
            "confirmed_elements",
            "explorations",
            "generated_cases",
            "generated_scripts",
            "healing_attempts",
            "work_items",
        ]:
            conn.execute(f"DELETE FROM {table}")
    with contextlib.suppress(Exception):
        shutil.rmtree(WORK_ITEM_DRAFT_DIR)
    with contextlib.suppress(Exception):
        shutil.rmtree(EXECUTION_LIVE_DIR)
    with contextlib.suppress(Exception):
        shutil.rmtree(EXECUTION_CONFIG_DIR)
    return {"status": "ok"}


@app.get("/api/ai-config")
def get_ai_config() -> dict[str, Any]:
    status = current_ai_status()
    local_key = get_setting("openai_api_key")
    env_key = os.environ.get("OPENAI_API_KEY", "")
    active_key = env_key or local_key
    masked = f"{active_key[:7]}...{active_key[-4:]}" if len(active_key) > 12 else "已配置" if active_key else ""
    return {**status, "maskedKey": masked, "envLocked": bool(env_key)}


@app.post("/api/ai-config")
def save_ai_config(payload: AIConfigRequest) -> dict[str, Any]:
    api_key = payload.api_key.strip()
    model = payload.model.strip() or "gpt-4.1-mini"
    base_url = normalize_openai_base_url(payload.base_url)
    validate_openai_base_url(base_url)
    if not api_key and not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=400, detail="请输入 OpenAI API Key")
    if api_key:
        set_setting("openai_api_key", api_key)
    set_setting("openai_model", model)
    if not os.environ.get("OPENAI_BASE_URL"):
        set_setting("openai_base_url", base_url)
    return get_ai_config()


@app.post("/api/ai-config/test")
def test_ai_config(payload: AIConfigRequest) -> dict[str, Any]:
    api_key = payload.api_key.strip() or get_openai_api_key()
    model = payload.model.strip() or get_openai_model()
    base_url = normalize_openai_base_url(payload.base_url or get_openai_base_url())
    validate_openai_base_url(base_url)
    if not api_key:
        raise HTTPException(status_code=400, detail="请输入 OpenAI API Key 后再测试连接")

    request_payload = {
        "model": model,
        "input": "Return exactly: ok",
        "max_output_tokens": 8,
    }
    try:
        body = call_openai_responses(api_key, model, base_url, request_payload, timeout=12)
        text = parse_openai_text_response(body).strip()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=openai_error_message(exc)) from exc
    return {
        "ok": True,
        "message": f"连接成功，模型 {model} 已完成一次测试生成。",
        "model": model,
        "baseUrl": base_url,
        "sample": text[:80],
    }


@app.delete("/api/ai-config")
def clear_ai_config() -> dict[str, Any]:
    with get_db() as conn:
        conn.execute("DELETE FROM app_settings WHERE key = 'openai_api_key'")
        if not os.environ.get("OPENAI_BASE_URL"):
            conn.execute("DELETE FROM app_settings WHERE key = 'openai_base_url'")
    return get_ai_config()


@app.get("/api/test-suites")
def test_suites(project_id: str = "") -> list[dict[str, Any]]:
    normalized_project_id = normalize_project_id(project_id)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM test_suites WHERE project_id = ? ORDER BY updated_at DESC",
            (normalized_project_id,),
        ).fetchall()
        suites = [row_to_test_suite(row, conn) for row in rows]
    return suites


def row_to_test_suite(row: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    own_conn = conn is None
    active_conn = conn or get_db()
    try:
        case_rows = active_conn.execute(
            "SELECT case_id FROM test_suite_cases WHERE suite_id = ? ORDER BY created_at ASC",
            (row["id"],),
        ).fetchall()
        case_ids = [item["case_id"] for item in case_rows]
    finally:
        if own_conn:
            active_conn.close()
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "name": row["name"],
        "description": row["description"],
        "filter": safe_json_loads(row["filter_json"], {}),
        "status": row["status"] if "status" in row.keys() and row["status"] else "active",
        "runConfig": normalize_suite_run_config(safe_json_loads(row["run_config_json"] if "run_config_json" in row.keys() else None, {})),
        "scheduleConfig": normalize_suite_schedule_config(safe_json_loads(row["schedule_config_json"] if "schedule_config_json" in row.keys() else None, {})),
        "caseIds": case_ids,
        "caseCount": len(case_ids),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@app.get("/api/projects")
def projects() -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
        return [row_to_project(row) for row in rows]


@app.post("/api/projects")
def create_project(payload: ProjectRequest) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    project_type = validate_project_type(payload.project_type)
    status = validate_project_status(payload.status)
    project_id = uuid.uuid4().hex[:12]
    slug = slugify(name)
    timestamp = now_iso()
    with get_db() as conn:
        project_code = normalize_project_code(payload.project_code) if payload.project_code.strip() else generate_project_code(conn)
        ensure_unique_project_code(conn, project_code)
        existing = conn.execute("SELECT id FROM projects WHERE slug = ?", (slug,)).fetchone()
        if existing:
            slug = f"{slug}-{project_id[:4]}"
        conn.execute(
            """
            INSERT INTO projects (
                id, slug, project_code, name, project_type, status,
                target_url, repository_path, test_dir, description,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                slug,
                project_code,
                name,
                project_type,
                status,
                payload.target_url.strip(),
                payload.repository_path.strip() or str(ROOT_DIR),
                payload.test_dir.strip() or "tests/e2e",
                payload.description.strip(),
                timestamp,
                timestamp,
            ),
        )
    return row_to_project(get_project_row(project_id))


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    project = row_to_project(get_project_row(project_id))
    with get_db() as conn:
        project["stats"] = project_dependency_counts(conn, project_id)
    return project


@app.patch("/api/projects/{project_id}")
def update_project(project_id: str, payload: ProjectPatchRequest) -> dict[str, Any]:
    get_project_row(project_id)
    fields: dict[str, Any] = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="项目名称不能为空")
        fields["name"] = name
    if payload.project_code is not None:
        project_code = normalize_project_code(payload.project_code)
        if not project_code:
            raise HTTPException(status_code=400, detail="项目ID不能为空")
        with get_db() as conn:
            ensure_unique_project_code(conn, project_code, exclude_project_id=project_id)
        fields["project_code"] = project_code
    if payload.project_type is not None:
        fields["project_type"] = validate_project_type(payload.project_type)
    if payload.status is not None:
        fields["status"] = validate_project_status(payload.status)
    for request_key, column in [
        ("target_url", "target_url"),
        ("repository_path", "repository_path"),
        ("test_dir", "test_dir"),
        ("description", "description"),
    ]:
        value = getattr(payload, request_key)
        if value is not None:
            fields[column] = value.strip()
    if fields:
        fields["updated_at"] = now_iso()
        keys = ", ".join(f"{key} = ?" for key in fields)
        with get_db() as conn:
            conn.execute(f"UPDATE projects SET {keys} WHERE id = ?", [*fields.values(), project_id])
    return get_project(project_id)


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str) -> dict[str, Any]:
    project = get_project_row(project_id)
    if project_id == DEFAULT_PROJECT_ID:
        raise HTTPException(status_code=400, detail="默认项目不能删除")
    with get_db() as conn:
        counts = project_dependency_counts(conn, project_id)
        if any(counts.values()):
            raise HTTPException(status_code=400, detail="项目下仍有关联资产，请先清理需求、用例、交付物、套件或执行记录")
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    return {"status": "deleted", "id": project_id, "name": project["name"]}


@app.get("/api/features")
def feature_menus(project_id: str = "") -> dict[str, Any]:
    normalized_project_id = normalize_project_id(project_id)
    get_project_row(normalized_project_id)
    with get_db() as conn:
        return features_payload(conn, normalized_project_id)


@app.post("/api/features")
def create_feature_menu(payload: FeatureMenuRequest) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="功能名称不能为空")
    project_id = normalize_project_id(payload.project_id)
    get_project_row(project_id)
    feature_id = uuid.uuid4().hex[:12]
    timestamp = now_iso()
    with get_db() as conn:
        parent_id = validate_feature_parent(conn, project_id, payload.parent_id)
        conn.execute(
            """
            INSERT INTO feature_menus (
                id, project_id, parent_id, name, description, sort_order,
                is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                feature_id,
                project_id,
                parent_id,
                name,
                payload.description.strip(),
                payload.sort_order,
                1 if payload.is_active else 0,
                timestamp,
                timestamp,
            ),
        )
        row = conn.execute("SELECT * FROM feature_menus WHERE id = ?", (feature_id,)).fetchone()
        rows = conn.execute("SELECT * FROM feature_menus WHERE project_id = ?", (project_id,)).fetchall()
    return row_to_feature(row, {item["id"]: item for item in rows})


@app.patch("/api/features/{feature_id}")
def update_feature_menu(feature_id: str, payload: FeatureMenuPatchRequest) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    with get_db() as conn:
        feature = get_feature_row(conn, feature_id)
        project_id = feature["project_id"]
        if payload.parent_id is not None:
            fields["parent_id"] = validate_feature_parent(conn, project_id, payload.parent_id, feature_id=feature_id)
        if payload.name is not None:
            name = payload.name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="功能名称不能为空")
            fields["name"] = name
        if payload.description is not None:
            fields["description"] = payload.description.strip()
        if payload.sort_order is not None:
            fields["sort_order"] = payload.sort_order
        if payload.is_active is not None:
            fields["is_active"] = 1 if payload.is_active else 0
        if fields:
            fields["updated_at"] = now_iso()
            keys = ", ".join(f"{key} = ?" for key in fields)
            conn.execute(f"UPDATE feature_menus SET {keys} WHERE id = ?", [*fields.values(), feature_id])
        row = conn.execute("SELECT * FROM feature_menus WHERE id = ?", (feature_id,)).fetchone()
        rows = conn.execute("SELECT * FROM feature_menus WHERE project_id = ?", (project_id,)).fetchall()
        case_count = feature_case_count(conn, feature_id)
    return row_to_feature(row, {item["id"]: item for item in rows}, case_count)


@app.delete("/api/features/{feature_id}")
def delete_feature_menu(feature_id: str) -> dict[str, Any]:
    with get_db() as conn:
        feature = get_feature_row(conn, feature_id)
        child_count = conn.execute("SELECT COUNT(*) AS total FROM feature_menus WHERE parent_id = ?", (feature_id,)).fetchone()["total"]
        if child_count:
            raise HTTPException(status_code=400, detail="该功能下仍有子功能，不能删除")
        case_count = feature_case_count(conn, feature_id)
        if case_count:
            raise HTTPException(status_code=400, detail="该功能已绑定测试用例，不能删除")
        conn.execute("DELETE FROM feature_menus WHERE id = ?", (feature_id,))
    return {"status": "deleted", "id": feature_id, "name": feature["name"]}


@app.get("/api/test-cases")
def test_cases(project_id: str = "", work_item_id: str = "", status: str = "", priority: str = "", feature_id: str = "") -> list[dict[str, Any]]:
    clauses = ["project_id = ?"]
    params: list[Any] = [normalize_project_id(project_id)]
    if work_item_id:
        clauses.append("work_item_id = ?")
        params.append(work_item_id)
    if status:
        clauses.append("automation_status = ?")
        params.append(status)
    if priority:
        clauses.append("priority = ?")
        params.append(priority)
    if feature_id:
        clauses.append("feature_id = ?")
        params.append(feature_id)
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM test_cases WHERE {' AND '.join(clauses)} ORDER BY priority ASC, external_id ASC, updated_at DESC",
            params,
        ).fetchall()
    return [row_to_test_case(row) for row in rows]


@app.post("/api/test-cases")
def create_test_case(payload: TestCaseRequest) -> dict[str, Any]:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="用例标题不能为空")
    project_id = normalize_project_id(payload.project_id)
    case_id = uuid.uuid4().hex[:12]
    external_id = payload.external_id.strip() or f"TC-{case_id[:8].upper()}"
    timestamp = now_iso()
    with get_db() as conn:
        feature_id = validate_case_feature(conn, project_id, payload.feature_id)
        conn.execute(
            """
            INSERT INTO test_cases (
                id, project_id, work_item_id, feature_id, external_id, title, priority,
                requirement, preconditions, steps, expected, automation_notes,
                automation_status, spec_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                case_id,
                project_id,
                payload.work_item_id.strip(),
                feature_id,
                external_id,
                title,
                payload.priority.strip() or "P1",
                payload.requirement.strip(),
                payload.preconditions.strip(),
                payload.steps.strip(),
                payload.expected.strip(),
                payload.automation_notes.strip(),
                payload.automation_status.strip() or "manual",
                payload.spec_path.strip(),
                timestamp,
                timestamp,
            ),
        )
        row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (case_id,)).fetchone()
    return row_to_test_case(row)


@app.patch("/api/test-cases/{case_id}")
def update_test_case(case_id: str, payload: TestCasePatchRequest) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    with get_db() as conn:
        existing = conn.execute("SELECT project_id FROM test_cases WHERE id = ?", (case_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Test case not found")
        if payload.feature_id is not None:
            fields["feature_id"] = validate_case_feature(conn, existing["project_id"], payload.feature_id)
        for request_key, column in [
            ("title", "title"),
            ("priority", "priority"),
            ("requirement", "requirement"),
            ("preconditions", "preconditions"),
            ("steps", "steps"),
            ("expected", "expected"),
            ("automation_notes", "automation_notes"),
            ("automation_status", "automation_status"),
            ("spec_path", "spec_path"),
        ]:
            value = getattr(payload, request_key)
            if value is not None:
                fields[column] = value.strip()
        if fields:
            fields["updated_at"] = now_iso()
            keys = ", ".join(f"{key} = ?" for key in fields)
            conn.execute(f"UPDATE test_cases SET {keys} WHERE id = ?", [*fields.values(), case_id])
        row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (case_id,)).fetchone()
    return row_to_test_case(row)


@app.get("/api/deliverables")
def deliverables(
    project_id: str = "",
    work_item_id: str = "",
    case_id: str = "",
    spec_path: str = "",
    deliverable_type: str = "",
    type: str = "",
    status: str = "",
    include_content: bool = True,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if project_id:
        clauses.append("project_id = ?")
        params.append(normalize_project_id(project_id))
    if work_item_id:
        clauses.append("work_item_id = ?")
        params.append(work_item_id)
    if case_id:
        clauses.append("case_id = ?")
        params.append(case_id)
    if spec_path:
        clauses.append(
            """
            (
                file_path = ?
                OR (type = 'test-cases' AND file_path = ?)
            )
            """
        )
        params.extend([spec_path, spec_path.replace(".spec.ts", "-test-cases.md")])
    requested_type = deliverable_type or type
    if requested_type:
        clauses.append("type = ?")
        params.append(requested_type)
    if status:
        clauses.append("status = ?")
        params.append(status)
    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM deliverables {where_sql} ORDER BY updated_at DESC LIMIT 200",
            params,
        ).fetchall()
    return [row_to_deliverable(row, include_content=include_content) for row in rows]


@app.get("/api/delivery-report")
def delivery_report(
    project_id: str = "",
    work_item_id: str = "",
    case_id: str = "",
    q: str = "",
    priority: str = "",
    automation_status: str = "",
    latest_status: str = "",
    deliverable_type: str = "",
    updated_from: str = "",
    updated_to: str = "",
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    clauses: list[str] = []
    params: list[Any] = []
    updated_sql = f"""
        MAX(
            tc.updated_at,
            COALESCE(
                (
                    SELECT MAX(ds.updated_at)
                    FROM deliverables ds
                    WHERE {deliverable_case_match_sql("ds")}
                ),
                tc.updated_at
            )
        )
    """
    if project_id:
        clauses.append("tc.project_id = ?")
        params.append(normalize_project_id(project_id))
    if work_item_id:
        clauses.append("tc.work_item_id = ?")
        params.append(work_item_id)
    if case_id:
        clauses.append("tc.id = ?")
        params.append(case_id)
    if priority:
        clauses.append("tc.priority = ?")
        params.append(priority)
    if automation_status:
        clauses.append("tc.automation_status = ?")
        params.append(automation_status)
    if latest_status:
        clauses.append("COALESCE(tc.latest_status, '') = ?")
        params.append(latest_status)
    if deliverable_type:
        clauses.append(
            f"""
            EXISTS (
                SELECT 1 FROM deliverables df
                WHERE {deliverable_case_match_sql("df")}
                  AND df.type = ?
            )
            """
        )
        params.append(deliverable_type)
    if updated_from:
        updated_from_bound = normalize_report_date_bound(updated_from)
        clauses.append(f"{updated_sql} >= ?")
        params.append(updated_from_bound)
    if updated_to:
        updated_to_bound = normalize_report_date_bound(updated_to, end_of_day=True)
        clauses.append(f"{updated_sql} <= ?")
        params.append(updated_to_bound)
    if q.strip():
        keyword = f"%{q.strip().lower()}%"
        clauses.append(
            f"""
            (
                lower(COALESCE(tc.external_id, '')) LIKE ?
                OR lower(COALESCE(tc.title, '')) LIKE ?
                OR lower(COALESCE(tc.requirement, '')) LIKE ?
                OR lower(COALESCE(tc.preconditions, '')) LIKE ?
                OR lower(COALESCE(tc.steps, '')) LIKE ?
                OR lower(COALESCE(tc.expected, '')) LIKE ?
                OR EXISTS (
                    SELECT 1 FROM projects p
                    WHERE p.id = tc.project_id
                      AND (
                          lower(COALESCE(p.name, '')) LIKE ?
                          OR lower(COALESCE(p.slug, '')) LIKE ?
                      )
                )
                OR EXISTS (
                    SELECT 1 FROM work_items wi
                    WHERE wi.id = tc.work_item_id
                      AND (
                          lower(COALESCE(wi.title, '')) LIKE ?
                          OR lower(COALESCE(wi.requirement, '')) LIKE ?
                      )
                )
                OR EXISTS (
                    SELECT 1 FROM deliverables dq
                    WHERE {deliverable_case_match_sql("dq")}
                      AND (
                          lower(COALESCE(dq.name, '')) LIKE ?
                          OR lower(COALESCE(dq.file_path, '')) LIKE ?
                          OR lower(COALESCE(dq.summary, '')) LIKE ?
                          OR lower(COALESCE(dq.type, '')) LIKE ?
                      )
                )
            )
            """
        )
        params.extend([keyword] * 14)
    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    offset = (page - 1) * page_size
    with get_db() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS total FROM test_cases tc {where_sql}", params).fetchone()["total"]
        rows = conn.execute(
            f"""
            SELECT tc.*, {updated_sql} AS report_updated_at
            FROM test_cases tc
            {where_sql}
            ORDER BY report_updated_at DESC, tc.external_id ASC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()
        items = [row_to_delivery_report_item(conn, row) for row in rows]
    return {
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@app.post("/api/deliverables")
def create_deliverable(payload: DeliverableRequest) -> dict[str, Any]:
    with get_db() as conn:
        project_id = validate_project_id(conn, payload.project_id)
        feature_id = validate_project_feature(conn, project_id, payload.feature_id)
    file_path = payload.file_path.strip()
    content = payload.content
    if not file_path:
        safe_name = slugify(payload.name or payload.type)
        file_path = str(PROJECT_ARTIFACT_DIR / DEFAULT_PROJECT_SLUG / "deliverables" / "manual" / f"{safe_name}.md")
    path = resolve_workspace_path(file_path)
    if content:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    if not path.exists():
        raise HTTPException(status_code=400, detail="交付物文件不存在，请提供 content 或有效 file_path")
    with get_db() as conn:
        deliverable_id = register_deliverable(
            conn,
            project_id,
            payload.type.strip(),
            payload.name.strip() or path.name,
            path,
            work_item_id=payload.work_item_id.strip(),
            case_id=payload.case_id.strip(),
            run_id=payload.run_id.strip(),
            feature_id=feature_id,
            status=payload.status.strip() or "ready",
            summary=payload.summary.strip() or summarize_content(content, "手工登记交付物"),
        )
        row = conn.execute("SELECT * FROM deliverables WHERE id = ?", (deliverable_id,)).fetchone()
    return row_to_deliverable(row, include_content=True)


@app.post("/api/test-suites")
def create_test_suite(payload: SuiteRequest) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="套件名称不能为空")
    suite_id = uuid.uuid4().hex[:12]
    project_id = normalize_project_id(payload.project_id)
    timestamp = now_iso()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO test_suites (
                id, project_id, name, description, filter_json, status,
                run_config_json, schedule_config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                suite_id,
                project_id,
                name,
                payload.description.strip(),
                json.dumps(payload.filter, ensure_ascii=False),
                "disabled" if payload.status == "disabled" else "active",
                json.dumps(normalize_suite_run_config(payload.run_config), ensure_ascii=False),
                json.dumps(normalize_suite_schedule_config(payload.schedule_config), ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )
        row = conn.execute("SELECT * FROM test_suites WHERE id = ?", (suite_id,)).fetchone()
    return row_to_test_suite(row)


@app.get("/api/test-suites/{suite_id}")
def get_test_suite(suite_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM test_suites WHERE id = ?", (suite_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Test suite not found")
        return row_to_test_suite(row, conn)


@app.patch("/api/test-suites/{suite_id}")
def update_test_suite(suite_id: str, payload: SuitePatchRequest) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="套件名称不能为空")
        fields["name"] = name
    if payload.description is not None:
        fields["description"] = payload.description.strip()
    if payload.filter is not None:
        fields["filter_json"] = json.dumps(payload.filter, ensure_ascii=False)
    if payload.status is not None:
        fields["status"] = "disabled" if payload.status == "disabled" else "active"
    if payload.run_config is not None:
        fields["run_config_json"] = json.dumps(normalize_suite_run_config(payload.run_config), ensure_ascii=False)
    if payload.schedule_config is not None:
        fields["schedule_config_json"] = json.dumps(normalize_suite_schedule_config(payload.schedule_config), ensure_ascii=False)
    with get_db() as conn:
        suite = conn.execute("SELECT * FROM test_suites WHERE id = ?", (suite_id,)).fetchone()
        if suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")
        if fields:
            fields["updated_at"] = now_iso()
            keys = ", ".join(f"{key} = ?" for key in fields)
            conn.execute(f"UPDATE test_suites SET {keys} WHERE id = ?", [*fields.values(), suite_id])
        row = conn.execute("SELECT * FROM test_suites WHERE id = ?", (suite_id,)).fetchone()
        return row_to_test_suite(row, conn)


@app.delete("/api/test-suites/{suite_id}")
def delete_test_suite(suite_id: str) -> dict[str, Any]:
    with get_db() as conn:
        suite = conn.execute("SELECT * FROM test_suites WHERE id = ?", (suite_id,)).fetchone()
        if suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")
        conn.execute("DELETE FROM test_suite_cases WHERE suite_id = ?", (suite_id,))
        conn.execute("DELETE FROM test_suites WHERE id = ?", (suite_id,))
    return {"ok": True, "id": suite_id}


@app.put("/api/test-suites/{suite_id}/cases")
def update_test_suite_cases(suite_id: str, payload: SuiteCaseUpdateRequest) -> dict[str, Any]:
    case_ids = list(dict.fromkeys(payload.case_ids))
    with get_db() as conn:
        suite = conn.execute("SELECT * FROM test_suites WHERE id = ?", (suite_id,)).fetchone()
        if suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")
        existing_cases = {
            row["id"]
            for row in conn.execute(
                f"SELECT id FROM test_cases WHERE id IN ({','.join('?' for _ in case_ids)})",
                case_ids,
            ).fetchall()
        } if case_ids else set()
        if len(existing_cases) != len(case_ids):
            raise HTTPException(status_code=400, detail="存在无效用例，不能加入套件")
        cross_project = [
            row["id"]
            for row in conn.execute(
                f"SELECT id FROM test_cases WHERE id IN ({','.join('?' for _ in case_ids)}) AND project_id != ?",
                [*case_ids, suite["project_id"]],
            ).fetchall()
        ] if case_ids else []
        if cross_project:
            raise HTTPException(status_code=400, detail="存在跨项目用例，不能加入套件")
        conn.execute("DELETE FROM test_suite_cases WHERE suite_id = ?", (suite_id,))
        timestamp = now_iso()
        for case_id in case_ids:
            conn.execute(
                "INSERT INTO test_suite_cases (suite_id, case_id, created_at) VALUES (?, ?, ?)",
                (suite_id, case_id, timestamp),
            )
        conn.execute("UPDATE test_suites SET updated_at = ? WHERE id = ?", (timestamp, suite_id))
        row = conn.execute("SELECT * FROM test_suites WHERE id = ?", (suite_id,)).fetchone()
    return row_to_test_suite(row)


def selected_suite_cases(conn: sqlite3.Connection, payload: SuiteRunRequest) -> tuple[str, str, list[sqlite3.Row]]:
    if payload.case_ids:
        placeholders = ",".join("?" for _ in payload.case_ids)
        rows = conn.execute(
            f"SELECT * FROM test_cases WHERE id IN ({placeholders}) ORDER BY priority ASC, external_id ASC",
            payload.case_ids,
        ).fetchall()
        if len(rows) != len(set(payload.case_ids)):
            raise HTTPException(status_code=400, detail="存在无效用例，不能执行")
        project_id = rows[0]["project_id"] if rows else DEFAULT_PROJECT_ID
        return "", project_id, rows
    if payload.suite_id:
        suite = conn.execute("SELECT * FROM test_suites WHERE id = ?", (payload.suite_id,)).fetchone()
        if suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")
        rows = conn.execute(
            """
            SELECT tc.*
            FROM test_cases tc
            JOIN test_suite_cases tsc ON tsc.case_id = tc.id
            WHERE tsc.suite_id = ?
            ORDER BY tc.priority ASC, tc.external_id ASC
            """,
            (payload.suite_id,),
        ).fetchall()
        return suite["id"], suite["project_id"], rows
    raise HTTPException(status_code=400, detail="请选择套件或至少一个用例")


async def execute_suite_run(suite_run_id: str) -> None:
    with get_db() as conn:
        suite_run = conn.execute("SELECT * FROM suite_runs WHERE id = ?", (suite_run_id,)).fetchone()
        case_links = conn.execute(
            "SELECT * FROM suite_run_cases WHERE suite_run_id = ? ORDER BY id ASC",
            (suite_run_id,),
        ).fetchall()
    if suite_run is None:
        return
    if not case_links:
        update_suite_run(suite_run_id, status="skipped", progress=100, ended_at=now_iso())
        return

    update_suite_run(suite_run_id, status="running")
    for index, link in enumerate(case_links, start=1):
        with get_db() as conn:
            case_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (link["case_id"],)).fetchone()
        if case_row is None:
            with get_db() as conn:
                conn.execute(
                    "UPDATE suite_run_cases SET status = 'skipped', ended_at = ?, error = ? WHERE id = ?",
                    (now_iso(), "用例不存在", link["id"]),
                )
            refresh_suite_run_counts(suite_run_id)
            continue

        spec_path = case_row["spec_path"] or ""
        if not spec_path or not resolve_workspace_path(spec_path).exists():
            with get_db() as conn:
                conn.execute(
                    """
                    UPDATE suite_run_cases
                    SET status = 'skipped', started_at = ?, ended_at = ?, error = ?
                    WHERE id = ?
                    """,
                    (now_iso(), now_iso(), "用例尚未绑定可执行 spec", link["id"]),
                )
                conn.execute(
                    "UPDATE test_cases SET latest_status = 'skipped', updated_at = ? WHERE id = ?",
                    (now_iso(), case_row["id"]),
                )
            refresh_suite_run_counts(suite_run_id)
            continue

        run_id = uuid.uuid4().hex[:12]
        suite = {
            "id": case_row["external_id"],
            "name": case_row["title"],
            "spec": spec_path,
            "priority": case_row["priority"] or "P1",
            "cases": 1,
            "description": case_row["requirement"] or case_row["title"],
            "grep": re.escape(case_row["external_id"]),
            "case_id": case_row["id"],
        }
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label,
                    progress, started_at, report_path, screenshot_path, work_item_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    suite["id"],
                    suite["name"],
                    suite["spec"],
                    "running",
                    "prepare",
                    "准备环境",
                    6,
                    now_iso(),
                    str(REPORT_INDEX),
                    str(SCREENSHOT_PATH),
                    case_row["work_item_id"],
                ),
            )
            conn.execute(
                """
                UPDATE suite_run_cases
                SET status = 'running', started_at = ?, run_id = ?
                WHERE id = ?
                """,
                (now_iso(), run_id, link["id"]),
            )
        if case_row["work_item_id"]:
            update_work_item(case_row["work_item_id"], stage="运行验证", status="running", latest_run_id=run_id)
        write_log(run_id, "info", f"套件 {suite_run['name']} 执行用例 {index}/{suite_run['total_cases']}: {case_row['external_id']}")
        render_preview(run_id, "running", "准备环境", 6, [])
        await run_playwright(run_id, suite, case_row["work_item_id"])
        with get_db() as conn:
            run_row = conn.execute("SELECT status FROM runs WHERE id = ?", (run_id,)).fetchone()
            status = run_row["status"] if run_row else "failed"
            conn.execute(
                """
                UPDATE suite_run_cases
                SET status = ?, ended_at = ?, error = ?
                WHERE id = ?
                """,
                (status, now_iso(), "" if status == "passed" else "详见单用例执行日志和 HTML report", link["id"]),
            )
        refresh_suite_run_counts(suite_run_id)

    refresh_suite_run_counts(suite_run_id)
    with get_db() as conn:
        summary = conn.execute("SELECT * FROM suite_runs WHERE id = ?", (suite_run_id,)).fetchone()
    final_status = "failed" if summary["failed_cases"] else "passed" if summary["passed_cases"] else "skipped"
    update_suite_run(suite_run_id, status=final_status, progress=100, ended_at=now_iso(), report_path=relative_or_absolute(REPORT_INDEX))


@app.post("/api/suite-runs")
async def create_suite_run(payload: SuiteRunRequest) -> dict[str, Any]:
    with get_db() as conn:
        suite_id, project_id, rows = selected_suite_cases(conn, payload)
        if not rows:
            raise HTTPException(status_code=400, detail="请至少选择一个用例执行")
        suite_name = "临时用例执行"
        if suite_id:
            suite_row = conn.execute("SELECT name FROM test_suites WHERE id = ?", (suite_id,)).fetchone()
            suite_name = suite_row["name"] if suite_row else suite_name
        suite_run_id = uuid.uuid4().hex[:12]
        timestamp = now_iso()
        conn.execute(
            """
            INSERT INTO suite_runs (
                id, suite_id, project_id, name, status, progress, total_cases,
                passed_cases, failed_cases, skipped_cases, started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (suite_run_id, suite_id, project_id, suite_name, "queued", 0, len(rows), 0, 0, 0, timestamp),
        )
        for case_row in rows:
            conn.execute(
                """
                INSERT INTO suite_run_cases (
                    suite_run_id, case_id, status
                ) VALUES (?, ?, ?)
                """,
                (suite_run_id, case_row["id"], "queued"),
            )
        row = conn.execute("SELECT * FROM suite_runs WHERE id = ?", (suite_run_id,)).fetchone()
    asyncio.create_task(execute_suite_run(suite_run_id))
    return row_to_suite_run(row)


@app.get("/api/suite-runs")
def suite_runs(project_id: str = "") -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM suite_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 20",
            (normalize_project_id(project_id),),
        ).fetchall()
    return [row_to_suite_run(row, include_cases=False) for row in rows]


@app.get("/api/suite-runs/{suite_run_id}")
def get_suite_run(suite_run_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM suite_runs WHERE id = ?", (suite_run_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Suite run not found")
    return row_to_suite_run(row)


@app.get("/api/suite-runs/{suite_run_id}/logs")
def suite_run_logs(suite_run_id: str) -> dict[str, Any]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT logs.*
            FROM logs
            JOIN suite_run_cases src ON src.run_id = logs.run_id
            WHERE src.suite_run_id = ?
            ORDER BY logs.id ASC
            """,
            (suite_run_id,),
        ).fetchall()
    return {
        "items": [
            {
                "id": row["id"],
                "createdAt": row["created_at"],
                "level": row["level"],
                "message": row["message"],
            }
            for row in rows
        ]
    }


@app.get("/api/work-items")
def work_items() -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM work_items ORDER BY updated_at DESC LIMIT 50").fetchall()
    return [row_to_work_item(row) for row in rows]


@app.post("/api/work-items")
def create_work_item(payload: WorkItemRequest) -> dict[str, Any]:
    requirement = payload.requirement.strip()
    if not requirement:
        raise HTTPException(status_code=400, detail="需求内容不能为空")
    analysis = analyze_requirement_with_ai(requirement)
    title = payload.title.strip() or title_from_analysis(requirement, analysis)
    analyzed_environment = str(analysis.get("environment", ""))
    target_url = payload.target_url.strip() or (analyzed_environment if analyzed_environment.startswith(("http://", "https://")) else extract_requirement_url(requirement))
    role = payload.role.strip() or analysis.get("role", "")
    test_data = payload.test_data.strip() or analysis.get("testData", "")
    acceptance = payload.acceptance.strip() or analysis.get("acceptance", "")
    exclusions = payload.exclusions.strip() or analysis.get("exclusions", "")
    work_item_id = uuid.uuid4().hex[:12]
    slug = slug_for_work_item(title, work_item_id)
    timestamp = now_iso()
    with get_db() as conn:
        project_id = validate_project_id(conn, payload.project_id)
        feature_id = validate_project_feature(conn, project_id, payload.feature_id)
        existing = conn.execute("SELECT id FROM work_items WHERE slug = ?", (slug,)).fetchone()
        if existing:
            slug = slug_for_work_item(title, work_item_id)
        conn.execute(
            """
            INSERT INTO work_items (
                id, slug, title, requirement, target_url, role, test_data, acceptance,
                exclusions, stage, status, created_at, updated_at, analysis_json, project_id, feature_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                work_item_id,
                slug,
                title,
                requirement,
                target_url,
                role,
                test_data,
                acceptance,
                exclusions,
                "需求分析",
                "draft",
                timestamp,
                timestamp,
                json.dumps(analysis, ensure_ascii=False),
                project_id,
                feature_id,
            ),
        )
    return get_work_item(work_item_id)


@app.get("/api/work-items/{work_item_id}")
def get_work_item(work_item_id: str) -> dict[str, Any]:
    return row_to_work_item(get_work_item_row(work_item_id), include_detail=True)


@app.get("/api/project-context")
def get_project_context() -> dict[str, Any]:
    return project_context()


@app.get("/api/automation-flows")
def list_automation_flows(limit: int = 50) -> list[dict[str, Any]]:
    normalized_limit = max(1, min(limit, 50))
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM automation_flow_runs
            ORDER BY started_at DESC
            LIMIT ?
            """,
            (normalized_limit,),
        ).fetchall()
    return [row_to_automation_flow_summary(row) for row in rows]


@app.post("/api/automation-flows")
async def create_automation_flow(payload: AutomationFlowRequest) -> dict[str, Any]:
    requirement = payload.requirement.strip()
    flow_run_id = uuid.uuid4().hex[:12]
    timestamp = now_iso()
    work_item_id = ""
    project_id = DEFAULT_PROJECT_ID
    feature_id = ""
    status = "queued"
    stage = "需求分析"
    error = ""
    if requirement:
        with get_db() as conn:
            project_id = validate_project_id(conn, payload.project_id)
            feature_id = validate_project_feature(conn, project_id, payload.feature_id, required=True)
        item = create_work_item(WorkItemRequest(requirement=requirement, project_id=project_id, feature_id=feature_id))
        work_item_id = item["id"]
    else:
        status = "blocked"
        error = "阻塞：需求文本为空，请先输入需求、PRD、验收标准、缺陷描述或页面说明。"
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO automation_flow_runs (
                id, work_item_id, feature_id, status, stage, progress, current_attempt,
                latest_run_id, latest_exploration_run_id, cases_path, spec_path,
                report_path, html_report_path, error, started_at, ended_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                flow_run_id,
                work_item_id,
                feature_id,
                status,
                stage,
                0 if requirement else 100,
                0,
                "",
                "",
                "",
                "",
                "",
                "",
                error,
                timestamp,
                now_iso() if not requirement else None,
            ),
        )
    if error:
        write_automation_flow_log(flow_run_id, "需求分析", "blocked", error)
    else:
        write_automation_flow_log(flow_run_id, "需求分析", "info", f"真实全流程 run 已创建: {flow_run_id}", "work-item", "", work_item_id)
        asyncio.create_task(execute_automation_flow(flow_run_id))
    return get_automation_flow_payload(flow_run_id)


@app.get("/api/automation-flows/{flow_run_id}")
def get_automation_flow(flow_run_id: str) -> dict[str, Any]:
    return get_automation_flow_payload(flow_run_id)


@app.get("/api/automation-flows/{flow_run_id}/artifacts")
def get_automation_flow_artifacts(flow_run_id: str) -> list[dict[str, Any]]:
    get_automation_flow_payload(flow_run_id)
    return flow_artifacts(flow_run_id)


@app.websocket("/ws/automation-flows/{flow_run_id}")
async def automation_flow_socket(websocket: WebSocket, flow_run_id: str) -> None:
    await websocket.accept()
    try:
        payload = get_automation_flow_payload(flow_run_id)
    except HTTPException:
        await websocket.send_json({"type": "error", "message": "自动化全流程不存在或已清理"})
        await websocket.close()
        return
    websockets = AUTOMATION_FLOW_SOCKETS.setdefault(flow_run_id, set())
    websockets.add(websocket)
    await websocket.send_json({
        "type": "snapshot",
        "flow": payload,
        "logs": payload.get("logs", []),
        "flowArtifacts": payload.get("flowArtifacts", []),
    })
    if payload.get("status") in {"completed", "failed", "blocked", "cancelled"}:
        await websocket.send_json({"type": "flow_done", "status": payload.get("status"), "flow": payload})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        websockets.discard(websocket)
    except Exception:
        websockets.discard(websocket)
        with contextlib.suppress(Exception):
            await websocket.close()
    finally:
        if not websockets:
            AUTOMATION_FLOW_SOCKETS.pop(flow_run_id, None)


@app.post("/api/work-items/{work_item_id}/browser-session")
async def create_browser_session(work_item_id: str) -> dict[str, Any]:
    get_work_item_row(work_item_id)
    return await start_browser_session(work_item_id)


@app.websocket("/ws/browser-sessions/{session_id}")
async def browser_session_socket(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    runtime = BROWSER_RUNTIMES.get(session_id)
    if runtime is None:
        await websocket.send_json({"type": "error", "message": "浏览器会话不存在或已关闭"})
        await websocket.close()
        return
    runtime.websockets.add(websocket)
    await websocket.send_json({"type": "status", "status": runtime.status, "sessionId": session_id})
    if runtime.last_frame:
        await websocket.send_json(runtime.last_frame)
    try:
        while True:
            payload = await websocket.receive_json()
            payload.setdefault("commandId", uuid.uuid4().hex[:8])
            if payload.get("type") == "control":
                action = payload.get("action")
                status = {
                    "pause": "Paused",
                    "resume": "Auto Running",
                    "takeover": "Manual Takeover",
                    "stop": "Closed",
                }.get(action, runtime.status)
                update_browser_session(session_id, status=status.lower().replace(" ", "-"))
                await broadcast_browser_event(runtime, {"type": "status", "status": status, "sessionId": session_id})
            await send_worker_command(runtime, payload)
    except WebSocketDisconnect:
        runtime.websockets.discard(websocket)
    except Exception as exc:
        runtime.websockets.discard(websocket)
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "message": str(exc)})


@app.post("/api/work-items/{work_item_id}/explore")
def save_exploration(work_item_id: str, payload: ExplorationRequest) -> dict[str, Any]:
    get_work_item_row(work_item_id)
    cases_markdown = latest_cases_for_work_item(work_item_id)
    if not cases_markdown:
        raise HTTPException(status_code=400, detail="请先根据需求保存可追溯测试用例，再保存页面探索结果")
    if not any(element.get("confirmed") for element in payload.elements):
        raise HTTPException(status_code=400, detail="缺少已确认元素，请先勾选至少一个真实页面候选 selector")
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO explorations (work_item_id, notes, screenshot_path, page_structure, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (work_item_id, payload.notes, payload.screenshot_path, payload.page_structure, now_iso()),
        )
        conn.execute("DELETE FROM confirmed_elements WHERE work_item_id = ?", (work_item_id,))
        for element in payload.elements:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source,
                    confirmed, step_index, source_url, screenshot_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    work_item_id,
                    element.get("area", ""),
                    element.get("name", ""),
                    element.get("locatorType", element.get("locator_type", "")),
                    element.get("locatorValue", element.get("locator_value", "")),
                    element.get("source", ""),
                    1 if element.get("confirmed") else 0,
                    element.get("stepIndex", element.get("step_index")),
                    element.get("sourceUrl", element.get("source_url", "")),
                    element.get("screenshotPath", element.get("screenshot_path", "")),
                ),
            )
    update_work_item(work_item_id, stage="脚本实现", status="explored")
    return get_work_item(work_item_id)


@app.post("/api/work-items/{work_item_id}/explore/run")
async def run_exploration(work_item_id: str) -> dict[str, Any]:
    item = get_work_item_row(work_item_id)
    if not item["target_url"]:
        raise HTTPException(status_code=400, detail="缺少目标 URL，无法执行探索")
    cases_markdown = latest_cases_for_work_item(work_item_id)
    if not cases_markdown:
        raise HTTPException(status_code=400, detail="请先根据需求保存可追溯测试用例，再执行页面探索")
    exploration_run_id = uuid.uuid4().hex[:12]
    plan = build_exploration_plan(item, cases_markdown)
    with get_db() as conn:
        active = conn.execute(
            "SELECT id FROM exploration_runs WHERE work_item_id = ? AND status = 'running' LIMIT 1",
            (work_item_id,),
        ).fetchone()
        if active is not None:
            raise HTTPException(status_code=409, detail="该任务已有探索运行正在执行")
        conn.execute(
            """
            INSERT INTO exploration_runs (
                id, work_item_id, target_url, status, stage_key, stage_label, progress,
                started_at, preview_path, plan_json, current_step_index, max_steps
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                exploration_run_id,
                work_item_id,
                item["target_url"],
                "running",
                "prepare",
                "准备探索环境",
                8,
                now_iso(),
                "",
                json.dumps(plan, ensure_ascii=False),
                0,
                len(plan),
            ),
        )
    for step in plan:
        insert_exploration_step(exploration_run_id, work_item_id, step)
    update_work_item(work_item_id, stage="页面探索", status="exploring")
    write_exploration_log(exploration_run_id, "info", "创建基于测试用例的探索运行，准备调起实时浏览器操控会话")
    asyncio.create_task(run_discovery_session(exploration_run_id, work_item_id, item["target_url"]))
    return get_exploration_run_payload(exploration_run_id)


@app.get("/api/exploration-runs/{exploration_run_id}")
def get_exploration_run(exploration_run_id: str) -> dict[str, Any]:
    return get_exploration_run_payload(exploration_run_id)


@app.post("/api/work-items/{work_item_id}/generate-cases")
def generate_cases(work_item_id: str, payload: ContentRequest) -> dict[str, Any]:
    item = get_work_item_row(work_item_id)
    content = payload.content.strip()
    if not content:
        require_ai()
        content = default_cases(item)
    with get_db() as conn:
        conn.execute(
            "INSERT INTO generated_cases (work_item_id, content, created_at) VALUES (?, ?, ?)",
            (work_item_id, content, now_iso()),
        )
        sync_test_cases_from_markdown(conn, item["project_id"] or DEFAULT_PROJECT_ID, work_item_id, content, default_feature_id=item["feature_id"] if "feature_id" in item.keys() else "")
    update_work_item(work_item_id, stage="页面探索", status="cases-ready")
    return get_work_item(work_item_id)


@app.post("/api/work-items/{work_item_id}/generate-script")
def generate_script(work_item_id: str, payload: ContentRequest) -> dict[str, Any]:
    item = get_work_item_row(work_item_id)
    content = payload.content.strip()
    with get_db() as conn:
        cases_markdown = latest_content(conn, "generated_cases", work_item_id)
        elements = conn.execute(
            "SELECT * FROM confirmed_elements WHERE work_item_id = ? AND confirmed = 1 ORDER BY id ASC",
            (work_item_id,),
        ).fetchall()
    if not cases_markdown:
        raise HTTPException(status_code=400, detail="缺少已保存测试用例，不能生成最终脚本。请先进入用例设计保存测试用例。")
    if not elements:
        raise HTTPException(status_code=400, detail="缺少已确认元素，不能生成最终脚本。请回到探索实验室，勾选至少一个候选元素并点击保存探索。")
    if not content:
        require_ai()
        content = default_script(item, elements)
    with get_db() as conn:
        conn.execute(
            "INSERT INTO generated_scripts (work_item_id, content, created_at) VALUES (?, ?, ?)",
            (work_item_id, content, now_iso()),
        )
    update_work_item(work_item_id, stage="运行验证", status="script-ready")
    return get_work_item(work_item_id)


@app.post("/api/work-items/{work_item_id}/save-artifacts")
def save_artifacts(work_item_id: str, payload: SaveArtifactsRequest) -> dict[str, Any]:
    item = get_work_item_row(work_item_id)
    project_id = item["project_id"] or DEFAULT_PROJECT_ID
    feature_id = item["feature_id"] if "feature_id" in item.keys() else ""
    project = get_project_row(project_id)
    with get_db() as conn:
        cases = payload.cases_markdown.strip() or latest_content(conn, "generated_cases", work_item_id)
        script = payload.script_content.strip() or latest_content(conn, "generated_scripts", work_item_id)
    run = latest_run_for_work_item(work_item_id, item["latest_run_id"] or "")
    if not cases:
        raise HTTPException(status_code=400, detail="缺少测试用例，不能保存最终交付物")
    if not script:
        raise HTTPException(status_code=400, detail="缺少脚本内容，不能保存交付物")
    if "test(" not in script or "expect(" not in script:
        raise HTTPException(status_code=400, detail="脚本基础校验失败：需要包含 test 和 expect")
    validate_script_covers_cases(cases, script)
    if run is None or run["status"] not in {"passed", "failed"}:
        raise HTTPException(status_code=400, detail="请先运行验证草稿脚本，并保留 Playwright HTML report 后再保存最终交付物")

    delivery_dir = project_deliverable_dir(project["slug"], item["slug"])
    delivery_dir.mkdir(parents=True, exist_ok=True)
    cases_path = delivery_dir / f"{item['slug']}-test-cases.md"
    spec_path = delivery_dir / f"{item['slug']}.spec.ts"
    report_path = delivery_dir / f"{item['slug']}-test-report.md"
    cases_path.write_text(cases, encoding="utf-8")
    spec_path.write_text(script, encoding="utf-8")
    report_content = payload.report_content.strip() or default_report(item, cases, run)
    report_path.write_text(report_content, encoding="utf-8")

    relative_spec = relative_or_absolute(spec_path)
    with get_db() as conn:
        case_ids = sync_test_cases_from_markdown(conn, project_id, work_item_id, cases, relative_spec, default_feature_id=feature_id)
        for case_id in case_ids:
            conn.execute(
                """
                UPDATE test_cases
                SET automation_status = 'automated', spec_path = ?, latest_run_id = ?,
                    latest_status = ?, updated_at = ?
                WHERE id = ?
                """,
                (relative_spec, run["id"], run["status"], now_iso(), case_id),
            )
        register_deliverable(
            conn,
            project_id,
            "test-cases",
            f"测试用例：{item['title']}",
            cases_path,
            work_item_id=work_item_id,
            run_id=run["id"],
            feature_id=feature_id,
            status="ready",
            summary=summarize_content(cases, "已保存测试用例 Markdown。"),
        )
        register_deliverable(
            conn,
            project_id,
            "spec",
            f"自动化脚本：{item['title']}",
            spec_path,
            work_item_id=work_item_id,
            run_id=run["id"],
            feature_id=feature_id,
            status="ready",
            summary=summarize_content(script, "已保存 Playwright spec。"),
        )
        register_deliverable(
            conn,
            project_id,
            "manual-report",
            f"人工测试报告：{item['title']}",
            report_path,
            work_item_id=work_item_id,
            run_id=run["id"],
            feature_id=feature_id,
            status=run["status"],
            summary=summarize_content(report_content, "已保存人工测试报告。"),
        )
        register_deliverable(
            conn,
            project_id,
            "html-report",
            f"HTML Report：{item['title']}",
            run["report_path"] or REPORT_INDEX,
            work_item_id=work_item_id,
            run_id=run["id"],
            feature_id=feature_id,
            status=run["status"],
            summary=f"运行验证状态：{run['status']}；可打开渲染后的 Playwright HTML Report。",
        )

    update_work_item(
        work_item_id,
        stage="保存已验证产物",
        status="artifacts-saved",
        cases_path=relative_or_absolute(cases_path),
        spec_path=relative_spec,
        report_path=relative_or_absolute(report_path),
    )
    return get_work_item(work_item_id)


@app.post("/api/work-items/{work_item_id}/run")
async def run_work_item(work_item_id: str) -> dict[str, Any]:
    item = get_work_item_row(work_item_id)
    script = latest_script_for_work_item(work_item_id)
    if not script:
        raise HTTPException(status_code=400, detail="请先生成或保存草稿 Playwright 脚本")
    if "test(" not in script or "expect(" not in script:
        raise HTTPException(status_code=400, detail="脚本基础校验失败：需要包含 test 和 expect")
    with get_db() as conn:
        case_rows = conn.execute(
            "SELECT * FROM test_cases WHERE work_item_id = ? ORDER BY priority ASC, external_id ASC",
            (work_item_id,),
        ).fetchall()
    relative_spec = write_draft_spec(item, script)
    if case_rows:
        with get_db() as conn:
            for case_row in case_rows:
                conn.execute(
                    """
                    UPDATE test_cases
                    SET spec_path = ?, automation_status = 'automated', updated_at = ?
                    WHERE id = ?
                    """,
                    (relative_spec, now_iso(), case_row["id"]),
                )
    suite = {
        "id": item["slug"],
        "name": item["title"],
        "spec": relative_spec,
        "priority": "P0",
        "cases": 1,
        "description": item["requirement"],
    }
    run_id = uuid.uuid4().hex[:12]
    with get_db() as conn:
        active = conn.execute("SELECT id FROM runs WHERE status = 'running' LIMIT 1").fetchone()
        if active is not None:
            raise HTTPException(status_code=409, detail="Another test run is already running")
        conn.execute(
            """
            INSERT INTO runs (
                id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                started_at, report_path, screenshot_path, work_item_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                suite["id"],
                suite["name"],
                suite["spec"],
                "running",
                "prepare",
                "准备环境",
                6,
                now_iso(),
                str(REPORT_INDEX),
                str(SCREENSHOT_PATH),
                work_item_id,
            ),
        )
    update_work_item(work_item_id, stage="运行验证", status="running", latest_run_id=run_id)
    write_log(run_id, "info", f"创建测试运行: {suite['name']}")
    render_preview(run_id, "running", "准备环境", 6, [])
    asyncio.create_task(run_playwright(run_id, suite, work_item_id))
    return get_work_item(work_item_id)


@app.post("/api/work-items/{work_item_id}/self-heal")
def self_heal(work_item_id: str, payload: HealRequest) -> dict[str, Any]:
    get_work_item_row(work_item_id)
    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS total FROM healing_attempts WHERE work_item_id = ?",
            (work_item_id,),
        ).fetchone()["total"]
        if count >= 3:
            raise HTTPException(status_code=400, detail="自愈最多允许 3 轮")
        conn.execute(
            """
            INSERT INTO healing_attempts (
                work_item_id, round, failure_summary, proposed_fix, result, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                work_item_id,
                count + 1,
                payload.failure_summary,
                payload.proposed_fix,
                "已记录，等待重新执行验证",
                now_iso(),
            ),
        )
    update_work_item(work_item_id, stage="自愈诊断", status="healing")
    return get_work_item(work_item_id)


@app.post("/api/runs")
async def create_run(payload: RunRequest) -> dict[str, Any]:
    suite = find_suite(payload.suite_id)
    run_id = uuid.uuid4().hex[:12]
    with get_db() as conn:
        active = conn.execute("SELECT id FROM runs WHERE status = 'running' LIMIT 1").fetchone()
        if active is not None:
            raise HTTPException(status_code=409, detail="Another test run is already running")
        conn.execute(
            """
            INSERT INTO runs (
                id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                started_at, report_path, screenshot_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                suite["id"],
                suite["name"],
                suite["spec"],
                "running",
                "prepare",
                "准备环境",
                6,
                now_iso(),
                str(REPORT_INDEX),
                str(SCREENSHOT_PATH),
            ),
        )
    write_log(run_id, "info", f"创建测试运行: {suite['name']}")
    render_preview(run_id, "running", "准备环境", 6, [])
    asyncio.create_task(run_playwright(run_id, suite))
    return get_run(run_id)


@app.get("/api/runs")
def runs() -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM runs ORDER BY started_at DESC LIMIT 20").fetchall()
    return [row_to_run(row) for row in rows]


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return row_to_run(row)


@app.get("/api/runs/{run_id}/logs")
def run_logs(run_id: str, after: int = 0) -> dict[str, Any]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM logs WHERE run_id = ? AND id > ? ORDER BY id ASC",
            (run_id, after),
        ).fetchall()
    return {
        "items": [
            {
                "id": row["id"],
                "createdAt": row["created_at"],
                "level": row["level"],
                "message": row["message"],
            }
            for row in rows
        ]
    }


@app.get("/api/runs/{run_id}/screenshot")
def run_screenshot(run_id: str) -> dict[str, Optional[str]]:
    with get_db() as conn:
        row = conn.execute("SELECT screenshot_path FROM runs WHERE id = ?", (run_id,)).fetchone()
    path = Path(row["screenshot_path"]) if row and row["screenshot_path"] else SCREENSHOT_PATH
    if not path.exists():
        return {"dataUrl": None}
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return {"dataUrl": f"data:image/svg+xml;base64,{encoded}"}


@app.get("/reports/playwright/")
def playwright_report_index() -> FileResponse:
    if not REPORT_INDEX.exists():
        raise HTTPException(status_code=404, detail="Playwright report not generated yet")
    return FileResponse(REPORT_INDEX)


@app.get("/reports/playwright/{asset_path:path}")
def playwright_report_asset(asset_path: str) -> FileResponse:
    normalized_asset = asset_path.strip("/") or "index.html"
    report_root = REPORT_INDEX.parent
    path = safe_child_path(report_root, normalized_asset)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Report asset not found")
    return FileResponse(path)


@app.get("/reports/deliverables/{deliverable_id}", response_model=None)
def rendered_deliverable_report(deliverable_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM deliverables WHERE id = ?", (deliverable_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Deliverable not found")
    if row["type"] == "html-report":
        return RedirectResponse(url="/reports/playwright/", status_code=307)

    path = resolve_workspace_path(row["file_path"])
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Deliverable file not found")
    if row["type"] == "manual-report" or path.suffix.lower() in {".md", ".markdown"}:
        with contextlib.suppress(UnicodeDecodeError, OSError):
            content = path.read_text(encoding="utf-8")
            return HTMLResponse(rendered_report_page(row["name"], render_markdown_report(content)))
        raise HTTPException(status_code=415, detail="Report file cannot be rendered")
    return FileResponse(path)


@app.get("/reports/file", response_model=None)
def rendered_report_file(path: str):
    if not path:
        raise HTTPException(status_code=400, detail="Report path is required")
    resolved = resolve_workspace_path(path).resolve()
    try:
        resolved.relative_to(ROOT_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Report file not found")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Report file not found")
    normalized_name = resolved.name.lower()
    normalized_path = str(resolved.relative_to(ROOT_DIR.resolve())).lower()
    is_report_path = (
        normalized_name.endswith(("-report.md", "-test-report.md", "index.html"))
        or "failure-report.md" in normalized_path
        or normalized_path.startswith("playwright-report/")
    )
    if not is_report_path:
        raise HTTPException(status_code=404, detail="Report file not found")
    if resolved == REPORT_INDEX.resolve():
        return RedirectResponse(url="/reports/playwright/", status_code=307)
    if resolved.suffix.lower() in {".md", ".markdown"}:
        with contextlib.suppress(UnicodeDecodeError, OSError):
            content = resolved.read_text(encoding="utf-8")
            return HTMLResponse(rendered_report_page(resolved.name, render_markdown_report(content)))
        raise HTTPException(status_code=415, detail="Report file cannot be rendered")
    return FileResponse(resolved)


@app.get("/api/report")
def report() -> RedirectResponse:
    if not REPORT_INDEX.exists():
        raise HTTPException(status_code=404, detail="Playwright report not generated yet")
    return RedirectResponse(url="/reports/playwright/", status_code=307)
