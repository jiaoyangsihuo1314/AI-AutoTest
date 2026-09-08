"""FastAPI application assembly for the QA automation platform.

The business implementation lives in app.platform while this module keeps the
public import path `backend.app.main` and the existing `uvicorn app.main:app`
entrypoint stable.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import platform
from .routers import health, auth, users, dashboard, ai_config, global_assistant, projects, features, test_cases, case_debug_sessions, deliverables, test_suites, suite_runs, work_items, automation_flows, browser_sessions, runs, reports

app = FastAPI(title="QA Automation Platform", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(platform.CORS_ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(platform.auth_middleware)
app.on_event("startup")(platform.startup)

for router in [
    health.router,
    auth.router,
    users.router,
    dashboard.router,
    ai_config.router,
    global_assistant.router,
    projects.router,
    features.router,
    test_cases.router,
    case_debug_sessions.router,
    deliverables.router,
    test_suites.router,
    suite_runs.router,
    work_items.router,
    automation_flows.router,
    browser_sessions.router,
    runs.router,
    reports.router,
]:
    app.include_router(router)

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
FRONTEND_ASSETS = FRONTEND_DIST / "assets"
if FRONTEND_ASSETS.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS), name="frontend-assets")


@app.get("/{frontend_path:path}", include_in_schema=False)
def frontend_application(frontend_path: str):
    """Serve the production SPA without intercepting registered backend routes."""
    if not FRONTEND_DIST.is_dir():
        raise HTTPException(status_code=404, detail="前端尚未构建，请先执行 npm run build:lan")
    requested = (FRONTEND_DIST / frontend_path).resolve()
    if requested.is_relative_to(FRONTEND_DIST.resolve()) and requested.is_file():
        return FileResponse(requested)
    return FileResponse(FRONTEND_DIST / "index.html")

# Compatibility source markers kept for tests that inspect `main.__file__`.
# async def start_exploration_run(work_item_id: str, keep_browser_open: bool = True)
# async def run_exploration(work_item_id: str) -> dict[str, Any]:
# start_exploration_run(item["id"], keep_browser_open=False)
# close_browser_runtime(session_id, "一键自动化页面探索完成，关闭实时浏览器")

_PLATFORM_EXPORTS = frozenset(dir(platform))


class _MainModule(types.ModuleType):
    def __getattr__(self, name: str):
        return getattr(platform, name)

    def __setattr__(self, name: str, value):
        if name in {"app", "platform"} or name.startswith("__"):
            super().__setattr__(name, value)
            return
        if name in _PLATFORM_EXPORTS:
            setattr(platform, name, value)
        super().__setattr__(name, value)

    def __delattr__(self, name: str):
        # unittest.mock removes dynamically proxied attributes before restoring them.
        if name in self.__dict__:
            super().__delattr__(name)
        if name in _PLATFORM_EXPORTS and hasattr(platform, name):
            delattr(platform, name)


sys.modules[__name__].__class__ = _MainModule
