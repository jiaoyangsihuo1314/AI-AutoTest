import asyncio
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.app import main


class HangingWebSocket:
    async def send_json(self, payload):
        await asyncio.Event().wait()


class FailingWebSocket:
    async def send_json(self, payload):
        raise RuntimeError("send failed")


class FakeStream:
    def __init__(self, chunks):
        self.chunks = list(chunks)

    async def readline(self):
        if self.chunks:
            return self.chunks.pop(0)
        return b""

    async def read(self):
        return b""


class BrowserRuntimeEventTests(unittest.IsolatedAsyncioTestCase):
    def create_project(self, name: str = "单元测试项目"):
        return main.create_project(main.ProjectRequest(name=name, project_type="product", status="active"))

    def create_feature(self, project_id: str, name: str = "默认功能"):
        return main.create_feature_menu(main.FeatureMenuRequest(project_id=project_id, name=name))

    def test_rewrite_spec_import_for_live_plain_playwright_test(self):
        source = "import { expect, test } from '@playwright/test';\n\ntest('ok', async ({ page }) => {});"

        rewritten = main.rewrite_spec_import_for_live(source, "./live-fixture")

        self.assertIsNotNone(rewritten)
        self.assertIn("import { expect, test } from './live-fixture';", rewritten)
        self.assertNotIn("@playwright/test", rewritten.splitlines()[0])

    def test_rewrite_spec_import_for_live_typed_playwright_test(self):
        source = "import { expect, type Page, type Locator, test } from 'playwright/test';\nasync function helper(page: Page) {}"

        rewritten = main.rewrite_spec_import_for_live(source, "./live-fixture")

        self.assertIsNotNone(rewritten)
        self.assertIn("import { expect, test } from './live-fixture';", rewritten)
        self.assertIn("import type { Page, Locator } from '@playwright/test';", rewritten)

    def test_rewrite_spec_import_for_live_unsupported_import(self):
        source = "import { test as base, expect } from '@playwright/test';"

        rewritten = main.rewrite_spec_import_for_live(source, "./live-fixture")

        self.assertIsNone(rewritten)

    async def test_broadcast_removes_hanging_websocket(self):
        runtime = SimpleNamespace(websockets={HangingWebSocket()}, exploration_run_id=None)

        with patch.object(main, "BROWSER_EVENT_SEND_TIMEOUT_SECONDS", 0.01):
            await main.broadcast_browser_event(runtime, {"type": "status"})

        self.assertEqual(runtime.websockets, set())

    async def test_step_result_sets_event_before_broadcast_failure_matters(self):
        runtime = SimpleNamespace(
            session_id="session-1",
            exploration_run_id="run-1",
            status="live",
            websockets={FailingWebSocket()},
            last_frame=None,
            last_worker_event_type="",
            last_worker_event_at="",
            last_worker_url="",
            step_events={2: asyncio.Event()},
            step_results={},
        )
        event = {
            "type": "step-result",
            "stepIndex": 2,
            "before": "https://example.test/login",
            "after": "https://example.test/home",
            "evidence": {
                "title": "Home",
                "url": "https://example.test/home",
                "screenshotPath": "",
                "structure": {"title": "Home", "url": "https://example.test/home"},
                "candidates": [{"locatorType": "text", "locatorValue": "Home"}],
            },
        }

        with (
            patch.object(main, "update_exploration_step") as update_step,
            patch.object(main, "write_exploration_log") as write_log,
        ):
            await main.handle_worker_event(runtime, event)

        self.assertTrue(runtime.step_events[2].is_set())
        self.assertEqual(runtime.step_results[2]["status"], "passed")
        self.assertEqual(runtime.websockets, set())
        self.assertEqual(runtime.last_worker_event_type, "step-result")
        self.assertEqual(runtime.last_worker_url, "https://example.test/home")
        update_step.assert_called_once()
        write_log.assert_called_once()

    async def test_pump_handles_large_worker_event_lines(self):
        large_candidates = [
            {"locatorType": "text", "locatorValue": f"button-{index}", "name": "x" * 2000}
            for index in range(40)
        ]
        event = {
            "type": "step-result",
            "stepIndex": 0,
            "before": "https://example.test",
            "after": "https://example.test/home",
            "evidence": {
                "title": "Home",
                "url": "https://example.test/home",
                "screenshotPath": "",
                "structure": {"title": "Home", "url": "https://example.test/home"},
                "candidates": large_candidates,
            },
        }
        runtime = SimpleNamespace(
            session_id="session-1",
            exploration_run_id="run-1",
            status="live",
            websockets=set(),
            last_frame=None,
            last_worker_event_type="",
            last_worker_event_at="",
            last_worker_url="",
            step_events={0: asyncio.Event()},
            step_results={},
            process=SimpleNamespace(stdout=FakeStream([(json.dumps(event) + "\n").encode(), b""]), stderr=FakeStream([]), returncode=0),
            closed=asyncio.Event(),
            last_error="",
        )

        with (
            patch.object(main, "update_exploration_step"),
            patch.object(main, "write_exploration_log"),
            patch.object(main, "update_browser_session"),
        ):
            await main.pump_browser_worker(runtime)

        self.assertTrue(runtime.step_events[0].is_set())
        self.assertEqual(runtime.step_results[0]["status"], "passed")

    async def test_execution_live_frame_updates_runtime_and_broadcasts(self):
        runtime = SimpleNamespace(
            session_id="session-1",
            status="starting",
            websockets=set(),
            last_frame=None,
            last_worker_event_type="",
            last_worker_event_at="",
        )
        event = {
            "type": "frame",
            "data": "abc",
            "format": "jpeg",
            "width": 100,
            "height": 80,
        }

        with patch.object(main, "broadcast_browser_event") as broadcast:
            await main.handle_execution_live_event(runtime, event)

        self.assertEqual(runtime.last_frame["data"], "abc")
        self.assertEqual(runtime.last_frame["width"], 100)
        broadcast.assert_called_once()


class ProjectCaseDeliverableTests(unittest.IsolatedAsyncioTestCase):
    def create_project(self, name: str = "单元测试项目"):
        return main.create_project(main.ProjectRequest(name=name, project_type="product", status="active"))

    def create_feature(self, project_id: str, name: str = "默认功能"):
        return main.create_feature_menu(main.FeatureMenuRequest(project_id=project_id, name=name))

    async def test_rendered_report_page_keeps_fenced_command_readable(self):
        command = "npx playwright test tests/e2e/.draft-runs/saucedemo-ad3d90.draft.spec.ts --project=chromium --reporter=list,html"
        body = main.render_markdown_report(f"""## 执行命令

```bash
{command}
```

- Playwright HTML report：`playwright-report/index.html`
""")
        page = main.rendered_report_page("manual-report.md", body)

        self.assertIn("<pre><code>", body)
        self.assertIn(f"{command}\n", body)
        self.assertIn("</code></pre>", body)
        self.assertIn("p code, li code", page)
        self.assertIn("pre code { background: transparent;", page)
        self.assertIn("white-space: pre-wrap; overflow-wrap: anywhere;", page)
        self.assertIn(command, page)
        self.assertIn("playwright-report/index.html", page)

    async def test_parse_cases_markdown_extracts_structured_cases(self):
        markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SMOKE-001 | P0 | 登录成功 | 登录 | standard_user/secret_sauce | 打开页面并登录 | 进入商品页 | 待自动化 |
"""

        cases = main.parse_cases_markdown(markdown)

        self.assertEqual(cases[0]["external_id"], "TC-SMOKE-001")
        self.assertEqual(cases[0]["priority"], "P0")
        self.assertEqual(cases[0]["expected"], "进入商品页")

    async def test_parse_cases_markdown_cleans_markdown_wrapped_case_ids(self):
        markdown = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| TC-SAUCEDEMO-4246A6-**TC001** | P0 | **登录成功** |
"""

        cases = main.parse_cases_markdown(markdown)

        self.assertEqual(cases[0]["external_id"], "TC-SAUCEDEMO-4246A6-TC001")
        self.assertEqual(cases[0]["title"], "登录成功")

    async def test_script_case_coverage_reports_missing_external_ids(self):
        cases = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| LGN-001 | P0 | 登录成功 |
| LGN-002 | P0 | 登录失败 |
"""
        script = "import { test, expect } from '@playwright/test';\ntest('LGN-001 登录成功', async () => { expect(true).toBeTruthy(); });"

        missing = main.missing_case_ids_in_script(cases, script)

        self.assertEqual(missing, ["LGN-002"])

    async def test_script_case_coverage_uses_cleaned_case_ids(self):
        cases = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| TC-SAUCEDEMO-4246A6-**TC001** | P0 | 登录成功 |
| TC-SAUCEDEMO-4246A6-**TC002** | P0 | 加入购物车 |
"""
        script = """import { test, expect } from '@playwright/test';
test('TC-SAUCEDEMO-4246A6-TC001 登录成功', async () => { expect(true).toBeTruthy(); });
test('TC-SAUCEDEMO-4246A6-TC002 加入购物车', async () => { expect(true).toBeTruthy(); });
"""

        missing = main.missing_case_ids_in_script(cases, script)

        self.assertEqual(missing, [])

    async def test_execution_config_allows_artifact_specs_to_be_collected(self):
        original_execution_config_dir = main.EXECUTION_CONFIG_DIR
        original_report_index = main.REPORT_INDEX
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            main.EXECUTION_CONFIG_DIR = main.ROOT_DIR / "tests" / "e2e" / ".execution-configs" / "unit-test"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "automation-platform" / "playwright-reports"
            try:
                html_report = main.run_html_report_index("run-config-001")
                blob_dir = main.suite_blob_report_dir("suite-config-001")
                config_path = main.write_execution_playwright_config("run-config-001", html_report, blob_dir)
                config_content = (main.ROOT_DIR / config_path).read_text(encoding="utf-8")

                self.assertIn(f"testDir: {json.dumps(str(main.ROOT_DIR))}", config_content)
                self.assertIn(f"outputFolder: {json.dumps(str(html_report.parent))}", config_content)
                self.assertIn(f"outputDir: {json.dumps(str(blob_dir))}", config_content)
                self.assertTrue(config_path.endswith("playwright.config.ts"))
            finally:
                shutil.rmtree(main.EXECUTION_CONFIG_DIR, ignore_errors=True)
                main.EXECUTION_CONFIG_DIR = original_execution_config_dir
                main.REPORT_INDEX = original_report_index
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir

    async def test_zzpss_default_script_uses_lgn_case_ids(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "登录功能")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 192.168.7.180:12222/zzpss 登录功能，账号 lining，密码 Hlkj@zzgdgs。",
                        target_url="http://192.168.7.180:12222/zzpss/#/login",
                        test_data="username=lining\npassword=Hlkj@zzgdgs",
                    )
                )
                script = main.default_script(main.get_work_item_row(work["id"]), [])

                for index in range(1, 10):
                    self.assertIn(f"LGN-{index:03d}", script)
                self.assertNotIn("TC-LOGIN-", script)
            finally:
                main.DB_PATH = original_db_path

    async def test_default_scripts_include_verbose_step_logging(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "步骤日志")
                zzpss_work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 ZZPSS 登录，账号 lining，密码 Hlkj@zzgdgs。",
                        target_url="http://192.168.7.180:12222/zzpss/#/login",
                        test_data="username=lining\npassword=Hlkj@zzgdgs",
                    )
                )
                sauce_work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 standard_user 可以登录 Sauce Demo 并加购。",
                        target_url="https://www.saucedemo.com",
                        test_data="username=standard_user\npassword=secret_sauce",
                    )
                )
                generic_work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证首页关键元素可见。",
                        target_url="https://example.test",
                    )
                )
                generic_element = {
                    "area": "首页",
                    "name": "欢迎",
                    "locator_type": "text",
                    "locator_value": "欢迎",
                    "source": "unit",
                }

                scripts = [
                    main.default_script(main.get_work_item_row(zzpss_work["id"]), []),
                    main.default_script(main.get_work_item_row(sauce_work["id"]), []),
                    main.default_script(main.get_work_item_row(generic_work["id"]), [generic_element]),
                ]

                for script in scripts:
                    self.assertIn("[步骤开始]", script)
                    self.assertIn("[步骤通过]", script)
                    self.assertIn("[步骤失败]", script)
                    self.assertIn("test.step", script)
                    self.assertTrue(main.script_has_verbose_logging(script))
            finally:
                main.DB_PATH = original_db_path

    async def test_script_generation_prompts_require_verbose_step_logging(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "提示词日志")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证登录页可以提交账号密码。",
                        target_url="https://example.test/login",
                    )
                )
                item = main.get_work_item_row(work["id"])
                elements = [
                    {
                        "area": "登录页",
                        "name": "登录",
                        "locator_type": "role",
                        "locator_value": "登录",
                        "source": "unit",
                    }
                ]
                run = {
                    "spec": "tests/e2e/.draft-runs/unit.spec.ts",
                }

                script_prompt = main.playwright_script_prompt(item, elements, "| ID | 优先级 | 标题 |\n| --- | --- | --- |\n| TC-001 | P0 | 登录 |\n")
                healed_prompt = main.healed_script_prompt(item, "import { test, expect } from '@playwright/test';", run, "Locator: page.getByText('登录')", elements)

                for prompt in [script_prompt, healed_prompt]:
                    self.assertIn("[步骤开始]", prompt)
                    self.assertIn("[步骤通过]", prompt)
                    self.assertIn("[步骤失败]", prompt)
                    self.assertIn("test.step", prompt)
                    self.assertIn("console.log", prompt)
            finally:
                main.DB_PATH = original_db_path

    async def test_generate_script_persists_verbose_logging_for_manual_content(self):
        original_db_path = main.DB_PATH
        original_draft_dir = main.WORK_ITEM_DRAFT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.WORK_ITEM_DRAFT_DIR = root / "tests" / "e2e" / ".draft-runs"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "保存脚本日志")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证登录按钮可见。",
                        target_url="https://example.test/login",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LOG-001 | P0 | 登录按钮可见 | 登录 | 打开登录页 | 查看登录按钮 | 按钮可见 | 已自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=cases))
                main.save_exploration(
                    work["id"],
                    main.ExplorationRequest(
                        notes="确认登录按钮",
                        elements=[
                            {
                                "area": "登录页",
                                "name": "登录按钮",
                                "locatorType": "text",
                                "locatorValue": "登录",
                                "source": "unit",
                                "confirmed": True,
                            }
                        ],
                    ),
                )
                script = """import { test, expect } from '@playwright/test';

test('TC-LOG-001 登录按钮可见', async ({ page }) => {
  await page.goto('https://example.test/login');
  await expect(page.getByText('登录')).toBeVisible();
});
"""

                item = main.generate_script(work["id"], main.ContentRequest(content=script))

                self.assertIn("[步骤开始]", item["scriptContent"])
                self.assertIn("[步骤通过]", item["scriptContent"])
                self.assertIn("[步骤失败]", item["scriptContent"])
                self.assertIn("test.beforeEach", item["scriptContent"])
                self.assertIn("test.step", item["scriptContent"])
            finally:
                main.DB_PATH = original_db_path
                main.WORK_ITEM_DRAFT_DIR = original_draft_dir

    async def test_default_report_includes_audit_detail_and_coverage_matrix(self):
        original_db_path = main.DB_PATH
        original_report_index = main.REPORT_INDEX
        original_screenshot_path = main.SCREENSHOT_PATH
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            main.DB_PATH = root / "test.sqlite"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            main.SCREENSHOT_PATH = root / "artifacts" / "browser-preview.svg"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "登录审计")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 standard_user 可以登录 Sauce Demo 并看到商品页。",
                        target_url="https://www.saucedemo.com",
                        role="standard_user",
                        test_data="secret_sauce",
                        acceptance="登录后进入 Products 页面",
                        exclusions="不覆盖支付真实链路",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AUDIT-001 | P0 | 登录成功 | 登录主路径 | standard_user/secret_sauce | 打开登录页并提交账号 | 进入 Products 页面 | 已自动化 |
| TC-AUDIT-002 | P1 | 密码错误提示 | 登录异常 | locked_out_user/wrong | 提交错误密码 | 展示错误提示 | 待补充 |
"""
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, browser_session_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "run-audit-001",
                            "",
                            work["title"],
                            "tests/e2e/.draft-runs/audit.draft.spec.ts",
                            "passed",
                            "complete",
                            "完成",
                            100,
                            timestamp,
                            timestamp,
                            0,
                            str(main.REPORT_INDEX),
                            str(main.SCREENSHOT_PATH),
                            work["id"],
                            "",
                        ),
                    )
                    conn.execute("INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)", ("run-audit-001", timestamp, "info", "执行命令: npx playwright test"))
                    conn.execute("INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)", ("run-audit-001", timestamp, "success", "执行完成，退出码 0"))
                    run = conn.execute("SELECT * FROM runs WHERE id = ?", ("run-audit-001",)).fetchone()

                report = main.default_report(main.get_work_item_row(work["id"]), cases, run)

                self.assertIn("## 1. 报告元信息", report)
                self.assertIn("## 2. 测试结论摘要", report)
                self.assertIn("## 5. 覆盖矩阵", report)
                self.assertIn("| TC-AUDIT-001 | P0 | 登录成功 | 登录主路径", report)
                self.assertIn("- 用例总数：2", report)
                self.assertIn("- 优先级分布：P0：1；P1：1；P2：0", report)
                self.assertIn("Spec 路径：`tests/e2e/.draft-runs/audit.draft.spec.ts`", report)
                self.assertIn("运行日志摘录", report)
                self.assertIn("[success] 执行完成，退出码 0", report)
                self.assertIn("质量风险与后续建议", report)
            finally:
                main.DB_PATH = original_db_path
                main.REPORT_INDEX = original_report_index
                main.SCREENSHOT_PATH = original_screenshot_path

    async def test_failure_report_includes_evidence_and_truncated_logs(self):
        original_db_path = main.DB_PATH
        original_flow_run_artifact_dir = main.FLOW_RUN_ARTIFACT_DIR
        original_report_index = main.REPORT_INDEX
        original_screenshot_path = main.SCREENSHOT_PATH
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.FLOW_RUN_ARTIFACT_DIR = root / "flow-runs"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            main.SCREENSHOT_PATH = root / "artifacts" / "browser-preview.svg"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "失败报告")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证登录失败时展示错误信息。",
                        target_url="https://www.saucedemo.com",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-FAIL-001 | P0 | 错误登录 | 登录异常 | invalid_user | 登录 | 展示错误 | 已自动化 |
"""
                timestamp = main.now_iso()
                long_log = "x" * 8200
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, browser_session_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "run-fail-001",
                            "",
                            work["title"],
                            "tests/e2e/.draft-runs/fail.draft.spec.ts",
                            "failed",
                            "complete",
                            "完成",
                            100,
                            timestamp,
                            timestamp,
                            1,
                            str(main.REPORT_INDEX),
                            str(main.SCREENSHOT_PATH),
                            work["id"],
                            "",
                        ),
                    )
                    conn.execute("INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)", ("run-fail-001", timestamp, "error", long_log))
                    run = conn.execute("SELECT * FROM runs WHERE id = ?", ("run-fail-001",)).fetchone()

                path = main.write_temporary_failure_report("flow-fail-001", main.get_work_item_row(work["id"]), cases, "test('x', async () => { expect(true).toBeTruthy(); });", run, "断言未通过")
                report = (root / path).read_text(encoding="utf-8")

                self.assertIn("## 1. 报告元信息", report)
                self.assertIn("Flow Run ID", report)
                self.assertIn("## 4. 覆盖矩阵", report)
                self.assertIn("Playwright HTML report", report)
                self.assertIn("失败结论：断言未通过", report)
                self.assertIn("已截断前", report)
                self.assertIn("若三轮自愈后仍失败", report)
                self.assertLess(len(report), 12000)
            finally:
                main.DB_PATH = original_db_path
                main.FLOW_RUN_ARTIFACT_DIR = original_flow_run_artifact_dir
                main.REPORT_INDEX = original_report_index
                main.SCREENSHOT_PATH = original_screenshot_path

    async def test_playwright_script_validation_rejects_narrative_prefix(self):
        script = "我会先修复脚本。import { expect, test } from '@playwright/test';\ntest('ok', async ({ page }) => { await expect(page.getByText('首页')).toBeVisible(); });"

        self.assertFalse(main.valid_playwright_script(script, [{"locatorValue": "首页"}]))

    async def test_extract_playwright_script_accepts_fenced_code(self):
        content = """下面是修复后的脚本：

```ts
import { expect, test } from '@playwright/test';

test('ok', async ({ page }) => {
  await expect(page.getByText('欢迎您，李宁')).toBeVisible();
});
```
"""

        script = main.extract_playwright_script(content)

        self.assertTrue(script.startswith("import { expect, test }"))
        self.assertTrue(main.valid_playwright_script(script, [{"locatorValue": "欢迎您，李宁"}]))

    async def test_failure_evidence_summary_reads_error_context(self):
        original_root_dir = main.ROOT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context_path = root / "test-results" / "case" / "error-context.md"
            context_path.parent.mkdir(parents=True)
            context_path.write_text("- text: 首页 欢迎您，李宁 基本情况\n", encoding="utf-8")
            main.ROOT_DIR = root
            try:
                summary = main.failure_evidence_summary("Error Context: test-results/case/error-context.md")
            finally:
                main.ROOT_DIR = original_root_dir

        self.assertIn("欢迎您，李宁", summary)
        self.assertIn("test-results/case/error-context.md", summary)

    async def test_healed_prompt_includes_playwright_error_context(self):
        original_root_dir = main.ROOT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context_path = root / "test-results" / "case" / "error-context.md"
            context_path.parent.mkdir(parents=True)
            context_path.write_text("- text: 首页 欢迎您，李宁 基本情况\n", encoding="utf-8")
            main.ROOT_DIR = root
            item = {
                "requirement": "验证 ZZPSS 登录成功。",
                "target_url": "http://example.test/zzpss/#/login",
            }
            run = {"spec": "tests/e2e/.draft-runs/zzpss.draft.spec.ts"}
            try:
                prompt = main.healed_script_prompt(
                    item,
                    "import { expect, test } from '@playwright/test';\ntest('x', async ({ page }) => { await expect(page.getByRole('navigation')).toBeVisible(); });",
                    run,
                    "Error Context: test-results/case/error-context.md",
                    [],
                )
            finally:
                main.ROOT_DIR = original_root_dir

        self.assertIn("欢迎您，李宁", prompt)
        self.assertIn("而不是继续等待不存在的通用 layout/navigation selector", prompt)

    async def test_script_changed_enough_rejects_failed_locator(self):
        current_script = "import { expect, test } from '@playwright/test';\ntest('x', async ({ page }) => { await expect(page.getByRole('navigation')).toBeVisible(); });"
        healed_script = current_script.replace("test('x'", "test('y'")
        failure_log = "Locator: getByRole('navigation').or(getByRole('menu'))"

        self.assertFalse(main.script_changed_enough(current_script, healed_script, failure_log))

    async def test_work_item_title_uses_short_qa_name_for_long_requirement(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "标题生成")
                requirement = (
                    "验证标准用户可以在 https://www.saucedemo.com 登录、添加商品到购物车、进入结账流程，"
                    "并在错误账号或缺失信息时展示明确错误。角色为 standard_user，测试数据为用户名 "
                    "standard_user、密码 secret_sauce、商品 Sauce Labs Backpack。不覆盖跨浏览器兼容、支付真实链路和第三方风控。"
                )

                work = main.create_work_item(main.WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement=requirement))

                self.assertNotEqual(work["title"], requirement[:80])
                self.assertLessEqual(len(work["title"]), 28)
                self.assertIn("验证", work["title"])
                self.assertRegex(work["slug"], r"^saucedemo-[0-9a-f]{6}$")
            finally:
                main.DB_PATH = original_db_path

    async def test_work_item_creation_requires_feature_binding(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "需求工单绑定")

                with self.assertRaises(main.HTTPException) as missing_feature:
                    main.create_work_item(main.WorkItemRequest(project_id=project["id"], requirement="验证需求工单必须选择功能。"))
                self.assertEqual(missing_feature.exception.status_code, 400)

                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证需求工单可以绑定项目与功能。",
                    )
                )

                self.assertEqual(work["projectId"], project["id"])
                self.assertEqual(work["featureId"], feature["id"])
                self.assertEqual(work["featurePath"], feature["path"])
            finally:
                main.DB_PATH = original_db_path

    async def test_work_item_title_uses_labeled_requirement_prefix(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "标题生成")
                requirement = "供电所首页登录与菜单可见性：验证用户登录后首页菜单、指标卡片和欢迎语可见。测试数据为账号 lining。"

                work = main.create_work_item(main.WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement=requirement))

                self.assertEqual(work["title"], "供电所首页登录与菜单可见性验证")
            finally:
                main.DB_PATH = original_db_path

    async def test_work_item_title_handles_url_and_mixed_english_requirement(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "英文登录")
                requirement = "https://www.saucedemo.com login smoke: verify standard_user can login and see Products page."

                work = main.create_work_item(main.WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement=requirement))

                self.assertLessEqual(len(work["title"]), 28)
                self.assertIn("Saucedemo", work["title"])
                self.assertIn("验证", work["title"])
                self.assertRegex(work["slug"], r"^saucedemo-[a-z0-9-]+-[0-9a-f]{6}$")
            finally:
                main.DB_PATH = original_db_path

    async def test_work_item_preserves_explicit_title(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "自定义标题")

                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        title="自定义登录回归任务",
                        requirement="验证用户可以登录系统并看到首页。",
                    )
                )

                self.assertEqual(work["title"], "自定义登录回归任务")
                self.assertRegex(work["slug"], r"^qa-task-[0-9a-f]{6}$")
            finally:
                main.DB_PATH = original_db_path

    async def test_save_artifacts_uses_short_deliverable_names_and_stable_paths(self):
        original_db_path = main.DB_PATH
        original_project_artifact_dir = main.PROJECT_ARTIFACT_DIR
        original_report_index = main.REPORT_INDEX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.PROJECT_ARTIFACT_DIR = root / "artifacts" / "projects"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "交付命名")
                requirement = "供电所首页登录与菜单可见性：验证用户登录后首页菜单、指标卡片和欢迎语可见。测试数据为账号 lining。"
                work = main.create_work_item(main.WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement=requirement))
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-NAME-001 | P0 | 首页登录成功 | 首页登录 | lining | 登录后查看首页 | 菜单和欢迎语可见 | 已自动化 |
"""
                script = "import { test, expect } from '@playwright/test';\ntest('TC-NAME-001 首页登录成功', async ({ page }) => { expect(true).toBeTruthy(); });\n"
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO generated_cases (work_item_id, content, created_at)
                        VALUES (?, ?, ?)
                        """,
                        (work["id"], cases, timestamp),
                    )
                    conn.execute(
                        """
                        INSERT INTO generated_scripts (work_item_id, content, created_at)
                        VALUES (?, ?, ?)
                        """,
                        (work["id"], script, timestamp),
                    )
                    run_id = "run-name-001"
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, browser_session_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            run_id,
                            "",
                            work["title"],
                            "tests/e2e/.draft-runs/sample.draft.spec.ts",
                            "passed",
                            "complete",
                            "完成",
                            100,
                            timestamp,
                            timestamp,
                            0,
                            str(main.REPORT_INDEX),
                            "",
                            work["id"],
                            "",
                        ),
                    )
                    conn.execute("UPDATE work_items SET latest_run_id = ? WHERE id = ?", (run_id, work["id"]))

                item = main.save_artifacts(work["id"], main.SaveArtifactsRequest())
                deliverables = main.deliverables(work_item_id=work["id"], include_content=False)
                names = {deliverable["type"]: deliverable["name"] for deliverable in deliverables}

                self.assertEqual(names["test-cases"], f"测试用例：{work['title']}")
                self.assertEqual(names["spec"], f"自动化脚本：{work['title']}")
                self.assertEqual(names["manual-report"], f"人工测试报告：{work['title']}")
                self.assertEqual(names["html-report"], f"HTML Report：{work['title']}")
                self.assertRegex(item["reportPath"], r"qa-task-[0-9a-f]{6}/qa-task-[0-9a-f]{6}-test-report\.md$")
                self.assertLess(len(names["manual-report"]), 50)
            finally:
                main.DB_PATH = original_db_path
                main.PROJECT_ARTIFACT_DIR = original_project_artifact_dir
                main.REPORT_INDEX = original_report_index

    async def test_save_artifacts_rejects_script_without_case_id_in_test_title(self):
        original_db_path = main.DB_PATH
        original_project_artifact_dir = main.PROJECT_ARTIFACT_DIR
        original_report_index = main.REPORT_INDEX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.PROJECT_ARTIFACT_DIR = root / "artifacts" / "projects"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "脚本覆盖校验")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证登录功能。",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LGN-001 | P0 | 登录成功 | 登录 | lining | 登录 | 进入首页 | 已自动化 |
"""
                script = "import { test, expect } from '@playwright/test';\ntest('TC-LOGIN-001 登录成功', async () => { expect(true).toBeTruthy(); });\n"
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO generated_cases (work_item_id, content, created_at)
                        VALUES (?, ?, ?)
                        """,
                        (work["id"], cases, timestamp),
                    )
                    conn.execute(
                        """
                        INSERT INTO generated_scripts (work_item_id, content, created_at)
                        VALUES (?, ?, ?)
                        """,
                        (work["id"], script, timestamp),
                    )
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, browser_session_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "run-missing-case-001",
                            "",
                            work["title"],
                            "tests/e2e/.draft-runs/missing-case.draft.spec.ts",
                            "passed",
                            "complete",
                            "完成",
                            100,
                            timestamp,
                            timestamp,
                            0,
                            str(main.REPORT_INDEX),
                            "",
                            work["id"],
                            "",
                        ),
                    )
                    conn.execute(
                        "UPDATE work_items SET latest_run_id = ? WHERE id = ?",
                        ("run-missing-case-001", work["id"]),
                    )

                with self.assertRaises(main.HTTPException) as raised:
                    main.save_artifacts(work["id"], main.SaveArtifactsRequest())

                self.assertEqual(raised.exception.status_code, 400)
                self.assertIn("LGN-001", raised.exception.detail)
            finally:
                main.DB_PATH = original_db_path
                main.PROJECT_ARTIFACT_DIR = original_project_artifact_dir
                main.REPORT_INDEX = original_report_index

    async def test_suite_run_skips_cases_without_bound_spec(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "套件跳过")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证用户可以在 https://www.saucedemo.com 登录，测试数据为 standard_user/secret_sauce，验收标准为进入商品页。",
                    )
                )
                markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SMOKE-001 | P0 | 登录成功 | 登录 | standard_user/secret_sauce | 打开页面并登录 | 进入商品页 | 待自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=markdown))
                cases = [case for case in main.test_cases(project_id=project["id"]) if case["workItemId"] == work["id"]]

                suite_run = await main.create_suite_run(main.SuiteRunRequest(case_ids=[cases[0]["id"]]))
                await asyncio.sleep(0.2)
                detail = main.get_suite_run(suite_run["id"])

                self.assertEqual(detail["status"], "skipped")
                self.assertEqual(detail["totalCases"], 1)
                self.assertEqual(detail["skippedCases"], 1)
            finally:
                main.DB_PATH = original_db_path

    async def test_suite_run_keeps_per_case_reports_and_sets_suite_report_path(self):
        original_db_path = main.DB_PATH
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        original_report_index = main.REPORT_INDEX
        original_root_dir = main.ROOT_DIR
        original_execution_config_dir = main.EXECUTION_CONFIG_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "automation-platform" / "playwright-reports"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            main.ROOT_DIR = root
            main.EXECUTION_CONFIG_DIR = root / "tests" / "e2e" / ".execution-configs"
            try:
                main.init_db()
                project = self.create_project()
                spec_path = root / "tests" / "e2e" / "suite-report.spec.ts"
                spec_path.parent.mkdir(parents=True, exist_ok=True)
                spec_path.write_text("import { test, expect } from '@playwright/test';\n", encoding="utf-8")
                case_one = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-SUITE-REPORT-001",
                        title="套件报告用例一",
                        priority="P0",
                        automation_status="automated",
                        spec_path=str(spec_path.relative_to(root)),
                    )
                )
                case_two = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-SUITE-REPORT-002",
                        title="套件报告用例二",
                        priority="P1",
                        automation_status="automated",
                        spec_path=str(spec_path.relative_to(root)),
                    )
                )
                suite = main.create_test_suite(main.SuiteRequest(project_id=project["id"], name="套件报告回归"))
                main.update_test_suite_cases(suite["id"], main.SuiteCaseUpdateRequest(case_ids=[case_one["id"], case_two["id"]]))
                suite_report = main.suite_html_report_index("placeholder")

                async def fake_run_playwright(run_id, suite_payload, work_item_id=None):
                    report_path = Path(suite_payload["html_report_path"])
                    report_path.parent.mkdir(parents=True, exist_ok=True)
                    report_path.write_text(f"<html>{run_id}</html>", encoding="utf-8")
                    with main.get_db() as conn:
                        conn.execute(
                            "UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0, report_path = ? WHERE id = ?",
                            (main.now_iso(), main.relative_or_absolute(report_path), run_id),
                        )

                async def fake_merge_suite_html_report(suite_run_id):
                    report_path = main.suite_html_report_index(suite_run_id)
                    report_path.parent.mkdir(parents=True, exist_ok=True)
                    report_path.write_text("<html>suite</html>", encoding="utf-8")
                    return report_path

                with (
                    patch.object(main, "run_playwright", side_effect=fake_run_playwright),
                    patch.object(main, "merge_suite_html_report", side_effect=fake_merge_suite_html_report),
                ):
                    suite_run = await main.create_suite_run(main.SuiteRunRequest(suite_id=suite["id"]))
                    await asyncio.sleep(0.2)

                detail = main.get_suite_run(suite_run["id"])
                run_ids = [item["runId"] for item in detail["cases"]]
                run_report_paths = []
                with main.get_db() as conn:
                    for run_id in run_ids:
                        row = conn.execute("SELECT report_path FROM runs WHERE id = ?", (run_id,)).fetchone()
                        run_report_paths.append(row["report_path"])

                expected_suite_report = main.relative_or_absolute(main.suite_html_report_index(suite_run["id"]))
                self.assertEqual(detail["status"], "passed")
                self.assertEqual(detail["reportPath"], expected_suite_report)
                self.assertEqual(len(set(run_report_paths)), 2)
                self.assertTrue(all("/artifacts/automation-platform/playwright-reports/runs/" in path for path in run_report_paths))
                self.assertTrue(all(path.endswith("/index.html") for path in run_report_paths))
                self.assertNotIn(detail["reportPath"], run_report_paths)
                self.assertNotEqual(detail["reportPath"], main.relative_or_absolute(main.REPORT_INDEX))
                self.assertNotEqual(main.relative_or_absolute(suite_report), detail["reportPath"])
            finally:
                main.DB_PATH = original_db_path
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir
                main.REPORT_INDEX = original_report_index
                main.ROOT_DIR = original_root_dir
                main.EXECUTION_CONFIG_DIR = original_execution_config_dir

    async def test_delete_test_cases_removes_suite_links_but_keeps_history_and_deliverables(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                case_one = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-DELETE-001",
                        title="单条删除用例",
                        priority="P0",
                    )
                )
                case_two = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-DELETE-002",
                        title="批量删除用例",
                        priority="P1",
                    )
                )
                suite = main.create_test_suite(main.SuiteRequest(project_id=project["id"], name="删除回归套件"))
                main.update_test_suite_cases(suite["id"], main.SuiteCaseUpdateRequest(case_ids=[case_one["id"], case_two["id"]]))
                artifact_path = Path(directory) / "delete-case-report.md"
                artifact_path.write_text("保留交付物登记", encoding="utf-8")
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    main.register_deliverable(
                        conn,
                        project["id"],
                        "manual-report",
                        "删除回归交付物",
                        artifact_path,
                        case_id=case_one["id"],
                    )
                    conn.execute(
                        """
                        INSERT INTO suite_runs (
                            id, suite_id, project_id, name, status, progress, total_cases,
                            passed_cases, failed_cases, skipped_cases, started_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        ("suite-run-delete", suite["id"], project["id"], suite["name"], "queued", 0, 1, 0, 0, 0, timestamp),
                    )
                    conn.execute(
                        "INSERT INTO suite_run_cases (suite_run_id, case_id, status) VALUES (?, ?, ?)",
                        ("suite-run-delete", case_one["id"], "queued"),
                    )

                deleted = main.delete_test_case(case_one["id"])
                suite_after_single_delete = main.get_test_suite(suite["id"])
                remaining_cases = main.test_cases(project_id=project["id"])
                with main.get_db() as conn:
                    linked_deliverables = conn.execute("SELECT COUNT(*) AS total FROM deliverables WHERE case_id = ?", (case_one["id"],)).fetchone()["total"]
                    historical_run_cases = conn.execute("SELECT COUNT(*) AS total FROM suite_run_cases WHERE case_id = ?", (case_one["id"],)).fetchone()["total"]

                self.assertEqual(deleted["deleted"], 1)
                self.assertNotIn(case_one["id"], {case["id"] for case in remaining_cases})
                self.assertEqual(suite_after_single_delete["caseIds"], [case_two["id"]])
                self.assertEqual(linked_deliverables, 1)
                self.assertEqual(historical_run_cases, 1)

                with self.assertRaises(main.HTTPException) as empty_raised:
                    main.bulk_delete_test_cases(main.TestCaseBulkDeleteRequest(case_ids=[]))
                self.assertEqual(empty_raised.exception.status_code, 400)

                with self.assertRaises(main.HTTPException) as invalid_raised:
                    main.bulk_delete_test_cases(main.TestCaseBulkDeleteRequest(case_ids=[case_two["id"], "missing-case-id"]))
                self.assertEqual(invalid_raised.exception.status_code, 404)
                self.assertTrue(any(case["id"] == case_two["id"] for case in main.test_cases(project_id=project["id"])))

                bulk_deleted = main.bulk_delete_test_cases(main.TestCaseBulkDeleteRequest(case_ids=[case_two["id"], case_two["id"]]))
                self.assertEqual(bulk_deleted["deleted"], 1)
                self.assertEqual(bulk_deleted["ids"], [case_two["id"]])
                self.assertFalse(main.get_test_suite(suite["id"])["caseIds"])
            finally:
                main.DB_PATH = original_db_path

    async def test_delivery_report_returns_case_rows_including_cases_without_deliverables(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "交付报告")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证交付报告按用例展示，并包含尚未生成交付物的测试用例。",
                    )
                )
                markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-REPORT-001 | P0 | 有交付物用例 | 报表 | 已登录 | 打开报表 | 展示交付物 | 待自动化 |
| TC-REPORT-002 | P1 | 无交付物用例 | 报表 | 已登录 | 打开报表 | 展示待生成 | 待自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=markdown))
                case_rows = [case for case in main.test_cases(project_id=project["id"]) if case["workItemId"] == work["id"]]
                self.assertEqual(len(case_rows), 2)
                artifact_path = Path(directory) / "report-cases.md"
                artifact_path.write_text(markdown, encoding="utf-8")
                with main.get_db() as conn:
                    main.register_deliverable(
                        conn,
                        project["id"],
                        "test-cases",
                        "交付报告测试用例文档",
                        artifact_path,
                        work_item_id=work["id"],
                        case_id=case_rows[0]["id"],
                        status="ready",
                        summary="TC-REPORT-001 交付物",
                    )

                report = main.delivery_report(work_item_id=work["id"], page_size=20)
                returned_titles = {item["case"]["title"] for item in report["items"]}

                self.assertEqual(report["total"], 2)
                self.assertEqual(returned_titles, {"有交付物用例", "无交付物用例"})
                empty_case = next(item for item in report["items"] if item["case"]["title"] == "无交付物用例")
                self.assertFalse(empty_case["deliverableSummary"])
            finally:
                main.DB_PATH = original_db_path

    async def test_delivery_report_filters_by_keyword_and_deliverable_type(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "交付筛选")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证交付物类型筛选只返回已经绑定对应交付物的用例。",
                    )
                )
                markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-REPORT-TYPE-001 | P0 | 类型筛选命中 | 报表 | 已登录 | 查询脚本 | 仅返回命中项 | 待自动化 |
| TC-REPORT-TYPE-002 | P1 | 类型筛选未命中 | 报表 | 已登录 | 查询脚本 | 不返回未命中项 | 待自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=markdown))
                case_rows = {case["title"]: case for case in main.test_cases(project_id=project["id"]) if case["workItemId"] == work["id"]}
                spec_path = Path(directory) / "report-type.spec.ts"
                spec_path.write_text("import { test, expect } from '@playwright/test';\n", encoding="utf-8")
                with main.get_db() as conn:
                    main.register_deliverable(
                        conn,
                        project["id"],
                        "spec",
                        "类型筛选脚本交付物",
                        spec_path,
                        work_item_id=work["id"],
                        case_id=case_rows["类型筛选命中"]["id"],
                        status="ready",
                        summary="keyword-only-spec-deliverable",
                    )

                report = main.delivery_report(q="keyword-only-spec", deliverable_type="spec", page_size=20)

                self.assertEqual(report["total"], 1)
                self.assertEqual(report["items"][0]["case"]["title"], "类型筛选命中")
                self.assertIn("spec", report["items"][0]["deliverableSummary"])
            finally:
                main.DB_PATH = original_db_path

    async def test_delivery_report_summary_uses_full_filtered_result_not_page(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "交付汇总")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证交付报告汇总不受分页影响。",
                    )
                )
                markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SUMMARY-001 | P0 | 完整交付用例 | 报表 | 已登录 | 打开报表 | 展示交付物 | 待自动化 |
| TC-SUMMARY-002 | P1 | 缺人工报告用例 | 报表 | 已登录 | 打开报表 | 展示缺失 | 待自动化 |
| TC-SUMMARY-003 | P2 | 无交付物用例 | 报表 | 已登录 | 打开报表 | 展示缺失 | 待自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=markdown))
                case_rows = {case["title"]: case for case in main.test_cases(project_id=project["id"]) if case["workItemId"] == work["id"]}
                complete_paths = {
                    "test-cases": Path(directory) / "complete-test-cases.md",
                    "spec": Path(directory) / "complete.spec.ts",
                    "manual-report": Path(directory) / "complete-test-report.md",
                    "html-report": Path(directory) / "complete-index.html",
                }
                missing_manual_paths = {
                    "test-cases": Path(directory) / "missing-manual-test-cases.md",
                    "spec": Path(directory) / "missing-manual.spec.ts",
                    "html-report": Path(directory) / "missing-manual-index.html",
                }
                for deliverable_type, path in {**complete_paths, **missing_manual_paths}.items():
                    path.write_text(markdown if deliverable_type == "test-cases" else deliverable_type, encoding="utf-8")
                with main.get_db() as conn:
                    for deliverable_type, path in complete_paths.items():
                        main.register_deliverable(
                            conn,
                            project["id"],
                            deliverable_type,
                            f"完整交付 {deliverable_type}",
                            path,
                            work_item_id=work["id"],
                            case_id=case_rows["完整交付用例"]["id"],
                            status="ready",
                        )
                    for deliverable_type, path in missing_manual_paths.items():
                        main.register_deliverable(
                            conn,
                            project["id"],
                            deliverable_type,
                            f"缺人工报告 {deliverable_type}",
                            path,
                            work_item_id=work["id"],
                            case_id=case_rows["缺人工报告用例"]["id"],
                            status="ready",
                        )

                report = main.delivery_report(work_item_id=work["id"], page=1, page_size=1)

                self.assertEqual(report["total"], 3)
                self.assertEqual(len(report["items"]), 1)
                self.assertEqual(report["summary"]["total"], 3)
                self.assertEqual(report["summary"]["ready"], 1)
                self.assertEqual(report["summary"]["missing"], 2)
                self.assertEqual(report["summary"]["failedRisk"], 0)
                self.assertEqual(report["summary"]["missingByType"]["manual-report"], 2)
                self.assertEqual(report["summary"]["missingByType"]["test-cases"], 1)
                self.assertEqual(report["items"][0]["readiness"], "missing")
            finally:
                main.DB_PATH = original_db_path

    async def test_html_report_deliverable_redirects_to_its_own_report_file(self):
        original_db_path = main.DB_PATH
        original_root_dir = main.ROOT_DIR
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        original_report_index = main.REPORT_INDEX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.ROOT_DIR = root
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "automation-platform" / "playwright-reports"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            try:
                main.init_db()
                project = self.create_project()
                report_index = main.run_html_report_index("run-own-report")
                report_index.parent.mkdir(parents=True, exist_ok=True)
                report_index.write_text("<html>own report</html>", encoding="utf-8")
                with main.get_db() as conn:
                    deliverable_id = main.register_deliverable(
                        conn,
                        project["id"],
                        "html-report",
                        "独立 HTML Report",
                        report_index,
                        run_id="run-own-report",
                    )

                response = main.rendered_deliverable_report(deliverable_id)
                expected_path = main.relative_or_absolute(report_index)

                self.assertEqual(response.status_code, 307)
                self.assertEqual(response.headers["location"], f"/reports/files/{expected_path}")
                self.assertTrue(main.is_report_file_path(report_index.resolve()))
            finally:
                main.DB_PATH = original_db_path
                main.ROOT_DIR = original_root_dir
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir
                main.REPORT_INDEX = original_report_index

    async def test_deliverables_can_expand_historical_spec_bound_case(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                spec_path = Path(directory) / "historical.spec.ts"
                case_doc_path = Path(directory) / "historical-test-cases.md"
                spec_path.write_text("import { test, expect } from '@playwright/test';\ntest('historical', async () => {});\n", encoding="utf-8")
                case_doc_path.write_text("| ID | 优先级 | 标题 |\n| --- | --- | --- |\n| TC-HISTORICAL-001 | P0 | 历史脚本用例 |\n", encoding="utf-8")
                with main.get_db() as conn:
                    main.sync_test_cases_from_markdown(conn, project["id"], "", case_doc_path.read_text(encoding="utf-8"), str(spec_path))
                    main.register_deliverable(conn, project["id"], "spec", "historical.spec.ts", spec_path, summary="历史脚本", bump_version=False)
                    main.register_deliverable(conn, project["id"], "test-cases", "historical-test-cases.md", case_doc_path, summary="历史用例文档", bump_version=False)

                payload = main.deliverables(spec_path=str(spec_path), include_content=True)
                types = {item["type"] for item in payload}

                self.assertEqual(types, {"spec", "test-cases"})
                self.assertTrue(any("historical" in item["content"] for item in payload if item["type"] == "spec"))
            finally:
                main.DB_PATH = original_db_path

    async def test_project_crud_validates_code_status_type_and_delete_guards(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                self.assertEqual(main.projects(), [])

                created = main.create_project(
                    main.ProjectRequest(
                        name="交付项目台账",
                        project_type="delivery",
                        status="planning",
                        repository_path="/tmp/project",
                        test_dir="tests/e2e/project-crud",
                    )
                )

                self.assertRegex(created["projectCode"], r"^PRJ-\d{8}-\d{3}$")
                self.assertEqual(created["projectType"], "delivery")
                self.assertEqual(created["status"], "planning")

                linked_project = self.create_project("关联资产项目")
                self.assertRegex(linked_project["projectCode"], r"^PRJ-\d{8}-\d{3}$")
                self.assertEqual(linked_project["projectType"], "product")
                self.assertEqual(linked_project["status"], "active")

                updated = main.update_project(
                    created["id"],
                    main.ProjectPatchRequest(
                        project_code=" prj-custom-001 ",
                        name="产品项目台账",
                        project_type="product",
                        status="active",
                    ),
                )

                self.assertEqual(updated["projectCode"], "PRJ-CUSTOM-001")
                self.assertEqual(updated["name"], "产品项目台账")
                self.assertEqual(updated["projectType"], "product")
                self.assertEqual(updated["status"], "active")

                with self.assertRaises(main.HTTPException) as duplicate_code:
                    main.create_project(main.ProjectRequest(name="重复项目ID", project_code="PRJ-CUSTOM-001"))
                self.assertEqual(duplicate_code.exception.status_code, 400)

                with self.assertRaises(main.HTTPException) as invalid_type:
                    main.create_project(main.ProjectRequest(name="非法类型", project_type="service"))
                self.assertEqual(invalid_type.exception.status_code, 400)

                with self.assertRaises(main.HTTPException) as invalid_status:
                    main.update_project(created["id"], main.ProjectPatchRequest(status="deleted"))
                self.assertEqual(invalid_status.exception.status_code, 400)

                feature = self.create_feature(linked_project["id"], "项目删除保护")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=linked_project["id"],
                        feature_id=feature["id"],
                        requirement="验证有关联需求工单的项目不能删除。",
                    )
                )
                self.assertTrue(work["id"])
                with self.assertRaises(main.HTTPException) as linked_delete:
                    main.delete_project(linked_project["id"])
                self.assertEqual(linked_delete.exception.status_code, 400)
                self.assertIn("项目下仍有关联资产", linked_delete.exception.detail)

                with main.get_db() as conn:
                    timestamp = main.now_iso()
                    conn.execute(
                        """
                        INSERT INTO projects (
                            id, slug, project_code, name, project_type, status,
                            target_url, repository_path, test_dir, description,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            main.DEFAULT_PROJECT_ID,
                            "legacy-default",
                            main.DEFAULT_PROJECT_CODE,
                            "历史默认项目",
                            "product",
                            "active",
                            "",
                            "",
                            "tests/e2e",
                            "",
                            timestamp,
                            timestamp,
                        ),
                    )
                legacy_deleted = main.delete_project(main.DEFAULT_PROJECT_ID)
                self.assertEqual(legacy_deleted["status"], "deleted")

                deleted = main.delete_project(created["id"])
                self.assertEqual(deleted["status"], "deleted")
                self.assertFalse(any(project["id"] == created["id"] for project in main.projects()))
            finally:
                main.DB_PATH = original_db_path

    async def test_project_scoped_writes_require_explicit_project(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                self.assertEqual(main.feature_menus(), {"items": [], "tree": []})
                self.assertEqual(main.test_cases(), [])
                self.assertEqual(main.test_suites(), [])
                self.assertEqual(main.suite_runs(), [])

                requests = [
                    lambda: main.create_feature_menu(main.FeatureMenuRequest(name="缺少项目功能")),
                    lambda: main.create_test_case(main.TestCaseRequest(title="缺少项目用例")),
                    lambda: main.create_test_suite(main.SuiteRequest(name="缺少项目套件")),
                    lambda: main.create_deliverable(main.DeliverableRequest(type="manual-report", name="缺少项目交付物", content="content")),
                    lambda: main.create_work_item(main.WorkItemRequest(requirement="验证缺少项目时不能创建工单。")),
                ]
                for action in requests:
                    with self.assertRaises(main.HTTPException) as missing_project:
                        action()
                    self.assertEqual(missing_project.exception.status_code, 400)
                    self.assertIn("项目", missing_project.exception.detail)

                with self.assertRaises(main.HTTPException) as missing_flow_project:
                    await main.create_automation_flow(main.AutomationFlowRequest(requirement="验证缺少项目时不能启动全流程。"))
                self.assertEqual(missing_flow_project.exception.status_code, 400)
                self.assertIn("项目", missing_flow_project.exception.detail)
            finally:
                main.DB_PATH = original_db_path


class AuthApiTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = main.DB_PATH
        self.tempdir = tempfile.TemporaryDirectory()
        main.DB_PATH = Path(self.tempdir.name) / "auth-test.sqlite"
        main.init_db()
        with main.get_db() as conn:
            self.admin_row = conn.execute("SELECT * FROM users WHERE username = ?", ("admin",)).fetchone()

    def tearDown(self):
        main.DB_PATH = self.original_db_path
        self.tempdir.cleanup()

    def admin_request(self):
        request = SimpleNamespace()
        request.state = SimpleNamespace(user=main.row_to_user(self.admin_row))
        return request

    def test_default_admin_password_hash_verifies(self):
        with main.get_db() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", ("admin",)).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["role"], "admin")
        self.assertEqual(row["status"], "active")
        self.assertTrue(main.verify_password("admin123456", row["password_hash"]))

    def test_registration_requires_admin_approval_before_login(self):
        registered = main.register(main.RegisterRequest(username="tester1", display_name="测试同学", password="abc12345"))
        self.assertEqual(registered["status"], "pending")
        with main.get_db() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", ("tester1",)).fetchone()
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["role"], "viewer")
        self.assertTrue(main.verify_password("abc12345", row["password_hash"]))

    def test_admin_can_create_user_with_active_status(self):
        created = main.create_user(
            main.UserCreateRequest(
                username="New.User",
                display_name="新同学",
                password="abc12345",
                role="viewer",
                status="active",
            ),
            self.admin_request(),
        )

        self.assertEqual(created["username"], "new.user")
        self.assertEqual(created["displayName"], "新同学")
        self.assertEqual(created["role"], "viewer")
        self.assertEqual(created["status"], "active")
        with main.get_db() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (created["id"],)).fetchone()
        self.assertTrue(main.verify_password("abc12345", row["password_hash"]))

    def test_admin_create_user_rejects_duplicate_username(self):
        payload = main.UserCreateRequest(username="duplicate", password="abc12345")
        main.create_user(payload, self.admin_request())

        with self.assertRaises(main.HTTPException) as duplicate:
            main.create_user(payload, self.admin_request())

        self.assertEqual(duplicate.exception.status_code, 400)
        self.assertIn("账号已存在", duplicate.exception.detail)

    def test_admin_can_update_user_profile_role_and_status(self):
        created = main.create_user(main.UserCreateRequest(username="editor1", password="abc12345"), self.admin_request())

        updated = main.update_user(
            created["id"],
            main.UserPatchRequest(display_name="编辑后", role="executor", status="disabled"),
            self.admin_request(),
        )

        self.assertEqual(updated["displayName"], "编辑后")
        self.assertEqual(updated["role"], "executor")
        self.assertEqual(updated["status"], "disabled")

    def test_disabling_user_clears_sessions(self):
        created = main.create_user(main.UserCreateRequest(username="session-user", password="abc12345"), self.admin_request())
        main.create_session(created["id"])

        main.update_user(created["id"], main.UserPatchRequest(status="disabled"), self.admin_request())

        with main.get_db() as conn:
            sessions = conn.execute("SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = ?", (created["id"],)).fetchone()
        self.assertEqual(sessions["count"], 0)

    def test_admin_can_delete_user_and_clear_sessions(self):
        created = main.create_user(main.UserCreateRequest(username="delete-me", password="abc12345"), self.admin_request())
        main.create_session(created["id"])

        deleted = main.delete_user(created["id"], self.admin_request())

        self.assertEqual(deleted, {"status": "deleted", "id": created["id"]})
        with main.get_db() as conn:
            user = conn.execute("SELECT * FROM users WHERE id = ?", (created["id"],)).fetchone()
            sessions = conn.execute("SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = ?", (created["id"],)).fetchone()
        self.assertIsNone(user)
        self.assertEqual(sessions["count"], 0)

    def test_default_admin_is_protected_from_dangerous_changes(self):
        admin_id = self.admin_row["id"]

        with self.assertRaises(main.HTTPException) as disabled:
            main.update_user(admin_id, main.UserPatchRequest(status="disabled"), self.admin_request())
        with self.assertRaises(main.HTTPException) as downgraded:
            main.update_user(admin_id, main.UserPatchRequest(role="viewer"), self.admin_request())
        with self.assertRaises(main.HTTPException) as deleted:
            main.delete_user(admin_id, self.admin_request())

        self.assertEqual(disabled.exception.status_code, 400)
        self.assertEqual(downgraded.exception.status_code, 400)
        self.assertEqual(deleted.exception.status_code, 400)

    def test_permission_matrix_blocks_viewer_mutations_and_ai_secret(self):
        self.assertEqual(main.path_permission("/api/projects", "POST"), {"admin", "lead"})
        self.assertNotIn("viewer", main.path_permission("/api/projects", "POST"))
        self.assertNotIn("executor", main.path_permission("/api/test-cases/bulk-delete", "POST"))
        self.assertEqual(main.path_permission("/api/ai-config/profile-1/secret", "GET"), {"admin"})
        self.assertIn("executor", main.path_permission("/api/work-items/abc/run", "POST"))
        self.assertEqual(main.path_permission("/api/work-items/abc/save-artifacts", "POST"), {"admin", "lead"})

    def test_auth_failure_response_includes_cors_for_allowed_origin(self):
        request = main.Request({
            "type": "http",
            "method": "GET",
            "path": "/api/projects",
            "headers": [(b"origin", b"http://127.0.0.1:5174")],
        })

        response = main.json_auth_response(request, {"detail": "请先登录"}, 401)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:5174")
        self.assertEqual(response.headers["access-control-allow-credentials"], "true")
        self.assertIn("Origin", response.headers["vary"])

    def test_options_requests_are_allowed_without_auth_for_cors_preflight(self):
        self.assertTrue(main.route_allowed_without_auth("/api/projects", "OPTIONS"))


if __name__ == "__main__":
    unittest.main()
