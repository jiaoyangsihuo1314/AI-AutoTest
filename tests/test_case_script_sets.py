import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.app import platform
from backend.app.schemas.models import ContentRequest, FeatureMenuRequest, ProjectRequest, SaveArtifactsRequest, WorkItemRequest


CASES_MARKDOWN = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-SET-001 | P0 | 页面可以访问 | 页面访问 | 无 | 打开页面 | 页面显示 | 自动化 |
| TC-CODEX-SET-002 | P1 | 核心区域可见 | 核心展示 | 无 | 查看页面 | 核心区域可见 | 自动化 |
"""


class CaseScriptSetTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.root = root
        self.originals = {
            "DB_PATH": platform.DB_PATH,
            "WORK_ITEM_DRAFT_DIR": platform.WORK_ITEM_DRAFT_DIR,
            "PROJECT_ARTIFACT_DIR": platform.PROJECT_ARTIFACT_DIR,
            "PLAYWRIGHT_REPORT_ARCHIVE_DIR": platform.PLAYWRIGHT_REPORT_ARCHIVE_DIR,
            "EXECUTION_CONFIG_DIR": platform.EXECUTION_CONFIG_DIR,
            "ai_playwright_script": platform.ai_playwright_script,
            "render_preview": platform.render_preview,
        }
        platform.DB_PATH = root / "test.sqlite"
        platform.WORK_ITEM_DRAFT_DIR = root / "drafts"
        platform.PROJECT_ARTIFACT_DIR = root / "projects"
        platform.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "reports"
        platform.EXECUTION_CONFIG_DIR = root / "execution-configs"
        platform.ai_playwright_script = lambda *args, **kwargs: ""
        platform.render_preview = lambda *args, **kwargs: None
        platform.init_db()

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(platform, name, value)
        self.temp_dir.cleanup()

    def save_static_page_evidence(self, item):
        external_ids = [case["externalId"] for case in item.get("testCases") or []]
        platform.save_exploration(item["id"], platform.ExplorationRequest(
            notes="CODEX_TEST 脚本集静态页面证据",
            page_structure="示例页面",
            state_evidence=[{
                "caseIds": external_ids,
                "headings": ["示例页面"],
                "readinessLocator": {"kind": "heading", "value": "示例页面"},
            }],
            elements=[],
        ))

    def create_work_item_with_cases(self, cases_markdown=CASES_MARKDOWN):
        project = platform.create_project(
            ProjectRequest(name="CODEX_TEST_SCRIPT_SET", project_code="CODEX-SET", target_url="https://example.com")
        )
        feature = platform.create_feature_menu(
            FeatureMenuRequest(project_id=project["id"], name="CODEX_TEST_FEATURE")
        )
        item = platform.create_work_item(
            WorkItemRequest(
                project_id=project["id"],
                feature_id=feature["id"],
                requirement="验证示例页面核心区域。",
                target_url="https://example.com",
            )
        )
        item = platform.generate_cases(item["id"], ContentRequest(content=cases_markdown, asset_mode="append"))
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source, confirmed
                ) VALUES (?, ?, ?, ?, ?, ?, 1)
                """,
                (item["id"], "body", "页面主体", "css", "body", "unit-test"),
            )
        self.save_static_page_evidence(item)
        return item

    def mark_work_item_as_automation_flow(self, item, flow_id="flow-codex-library"):
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO automation_flow_runs (
                    id, work_item_id, feature_id, status, stage, progress, current_attempt,
                    asset_mode, case_ids_json, started_at
                ) VALUES (?, ?, ?, 'running', '用例设计', 25, 0, 'create', '[]', ?)
                """,
                (flow_id, item["id"], item["featureId"], platform.now_iso()),
            )

    def create_automation_work_item_with_cases(self, cases_markdown=CASES_MARKDOWN):
        project = platform.create_project(
            ProjectRequest(name="CODEX_TEST_DELAYED_LIBRARY", project_code="CODEX-DELAY", target_url="https://example.com")
        )
        feature = platform.create_feature_menu(
            FeatureMenuRequest(project_id=project["id"], name="CODEX_TEST_DELAYED_FEATURE")
        )
        item = platform.create_work_item(
            WorkItemRequest(
                project_id=project["id"],
                feature_id=feature["id"],
                requirement="验证一键自动化用例延迟进入用例库。",
                target_url="https://example.com",
            )
        )
        self.mark_work_item_as_automation_flow(item)
        item = platform.generate_cases(item["id"], ContentRequest(content=cases_markdown, asset_mode="create"))
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source, confirmed
                ) VALUES (?, ?, ?, ?, ?, ?, 1)
                """,
                (item["id"], "body", "页面主体", "css", "body", "unit-test"),
            )
        self.save_static_page_evidence(item)
        return item

    def test_single_primary_expectation_rejects_multiple_results(self):
        self.assertEqual(platform.single_primary_expectation_error("页面进入首页"), "")
        self.assertIn("分号", platform.single_primary_expectation_error("页面进入首页；用户菜单可见"))
        self.assertIn("连接多个结果", platform.single_primary_expectation_error("页面进入首页并且用户菜单可见"))

        invalid_cases = CASES_MARKDOWN.replace("页面显示", "页面显示；标题正确")
        self.assertIn("TC-CODEX-SET-001", platform.generated_cases_expectation_error(invalid_cases))

    def test_expect_counter_ignores_comments_and_strings(self):
        script = """import { expect, test } from '@playwright/test';
const example = 'expect(value)';
// expect(commentOnly)
test('TC-CODEX-SET-001 页面可以访问', async ({ page }) => {
  // 主断言：页面显示
  await expect(page.locator('body')).toBeVisible();
});
"""
        self.assertEqual(platform.playwright_expect_call_count(script), 1)
        self.assertEqual(platform.primary_assertion_markers(script), ["页面显示"])
        self.assertIn(
            "当前检测到 2 个",
            platform.single_primary_assertion_error(script + "\nexpect(true).toBeTruthy();", "页面显示"),
        )

    def test_fallback_scripts_have_exactly_one_traced_assertion(self):
        item = self.create_work_item_with_cases()

        result = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )

        with platform.get_db() as conn:
            case_rows = {
                row["id"]: row
                for row in conn.execute(
                    "SELECT * FROM test_cases WHERE work_item_id = ?",
                    (item["id"],),
                ).fetchall()
            }
            elements = conn.execute(
                "SELECT * FROM confirmed_elements WHERE work_item_id = ? AND confirmed = 1",
                (item["id"],),
            ).fetchall()
        for version in result["scriptVersions"]:
            case_row = case_rows[version["caseId"]]
            fixture_import = f"../fixtures/{version['fixtureVersionId']}"
            self.assertEqual(platform.playwright_expect_call_count(version["content"]), 1)
            self.assertEqual(
                platform.valid_case_playwright_script(
                    version["content"],
                    case_row,
                    elements,
                    fixture_import,
                    enforce_single_primary=True,
                ),
                "",
            )

    def test_invalid_ai_script_uses_single_assertion_fallback(self):
        single_case = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-AI-FALLBACK-001 | P0 | AI 违规时规则兜底 | 生成稳定脚本 | 无 | 打开页面 | 页面可见 | 自动化 |
"""
        item = self.create_work_item_with_cases(single_case)
        invalid_ai_script = """import { expect, test } from '@playwright/test';

test('TC-CODEX-AI-FALLBACK-001 AI 违规时规则兜底', async ({ page }) => {
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveURL(/example/);
});
"""

        with patch.object(platform, "ai_playwright_script", return_value=invalid_ai_script):
            result = platform.generate_script_set(
                item["id"],
                ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
            )

        version = result["scriptVersions"][0]
        self.assertEqual(result["scriptSet"]["source"], "fallback")
        self.assertEqual(platform.playwright_expect_call_count(version["content"]), 1)
        self.assertEqual(platform.primary_assertion_markers(version["content"]), ["页面可见"])

    def test_manual_provided_script_keeps_legacy_multiple_assertions(self):
        single_case = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-MANUAL-001 | P0 | 人工脚本保持兼容 | 人工维护 | 无 | 打开页面 | 页面可见 | 人工脚本 |
"""
        item = self.create_work_item_with_cases(single_case)
        script = """import { expect, test } from '@playwright/test';

test('TC-CODEX-MANUAL-001 人工脚本保持兼容', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveURL(/example/);
});
"""

        result = platform.generate_script_set(
            item["id"],
            ContentRequest(content=script, asset_mode="append", case_ids=item["caseIds"]),
        )

        version = result["scriptVersions"][0]
        self.assertEqual(platform.playwright_expect_call_count(version["content"]), 2)
        self.assertEqual(result["scriptSet"]["source"], "provided")

    def test_manual_provided_script_migrates_confirmed_target_navigation(self):
        single_case = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-MANUAL-NAV-001 | P0 | 人工脚本导航兼容 | 人工维护 | 无 | 打开页面 | 页面可见 | 人工脚本 |
"""
        item = self.create_work_item_with_cases(single_case)
        script = """import { expect, test } from '@playwright/test';

test('TC-CODEX-MANUAL-NAV-001 人工脚本导航兼容', async ({ page }) => {
  await page.goto(TARGET_URL, { waitUntil: 'commit', timeout: 20_000 });
  await expect(page.locator('body')).toBeVisible();
});
"""
        navigation_target = {
            "requestedUrl": "https://example.com",
            "resolvedUrl": "https://example.com",
            "navigationSteps": [],
            "readinessSignals": [{"selector": "body"}],
            "accessMode": "anonymous",
            "requiredAccessMode": "anonymous",
            "directNavigationAllowed": True,
            "navigationPathConfirmed": True,
            "evidenceConfirmed": True,
        }

        with patch.object(platform, "navigation_target_for_work_item", return_value=navigation_target):
            result = platform.generate_script_set(
                item["id"],
                ContentRequest(content=script, asset_mode="append", case_ids=item["caseIds"]),
            )

        version = result["scriptVersions"][0]
        self.assertIn("await openTargetPage(page);", version["content"])
        self.assertNotIn("page.goto(", version["content"])
        self.assertIn("export async function openTargetPage", version["fixtureVersion"]["content"])

    def test_automation_flow_cases_stay_internal_until_artifacts_are_saved(self):
        item = self.create_automation_work_item_with_cases()

        self.assertEqual({case["libraryStatus"] for case in item["testCases"]}, {"draft"})
        self.assertEqual(platform.test_cases(project_id=item["projectId"]), [])
        self.assertEqual(platform.get_project(item["projectId"])["stats"]["testCases"], 0)
        feature = platform.feature_menus(item["projectId"])["items"][0]
        self.assertEqual(feature["caseCount"], 0)
        self.assertEqual(platform.dashboard_summary_payload(item["projectId"])["totals"]["testCases"], 0)
        self.assertEqual(platform.delivery_report(project_id=item["projectId"])["total"], 0)

        suite = platform.create_test_suite(
            platform.SuiteRequest(project_id=item["projectId"], name="CODEX_TEST_DELAYED_SUITE")
        )
        with self.assertRaises(platform.HTTPException) as suite_error:
            platform.update_test_suite_cases(
                suite["id"],
                platform.SuiteCaseUpdateRequest(case_ids=[item["caseIds"][0]]),
            )
        self.assertEqual(suite_error.exception.status_code, 400)

        with self.assertRaises(platform.HTTPException) as debug_error:
            platform.create_case_debug_session(item["caseIds"][0], platform.CaseDebugSessionCreateRequest())
        self.assertEqual(debug_error.exception.status_code, 404)

    def test_failed_artifact_save_keeps_automation_cases_as_drafts(self):
        item = self.create_automation_work_item_with_cases()
        generated = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="create", case_ids=item["caseIds"]),
        )
        run_id, _, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?",
                (platform.now_iso(), run_id),
            )

        with self.assertRaises(platform.HTTPException) as raised:
            platform.save_artifacts(item["id"], SaveArtifactsRequest(run_id=run_id))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(platform.test_cases(project_id=item["projectId"]), [])
        with platform.get_db() as conn:
            statuses = {
                row["library_status"]
                for row in conn.execute(
                    "SELECT library_status FROM test_cases WHERE work_item_id = ?",
                    (item["id"],),
                ).fetchall()
            }
        self.assertEqual(statuses, {"draft"})
        self.assertEqual(len(generated["scriptVersions"]), 2)

    def test_successful_artifact_save_publishes_automation_cases(self):
        item = self.create_automation_work_item_with_cases()
        platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="create", case_ids=item["caseIds"]),
        )
        run_id, _, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        timestamp = platform.now_iso()
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE runs SET status = 'passed', stage_key = 'complete', stage_label = '完成', progress = 100, ended_at = ?, exit_code = 0 WHERE id = ?",
                (timestamp, run_id),
            )
            conn.execute(
                "UPDATE work_items SET latest_run_id = ?, status = 'passed', updated_at = ? WHERE id = ?",
                (run_id, timestamp, item["id"]),
            )

        delivered = platform.save_artifacts(item["id"], SaveArtifactsRequest(run_id=run_id))
        published = platform.test_cases(project_id=item["projectId"])

        self.assertEqual(delivered["status"], "artifacts-saved")
        self.assertEqual(len(published), 2)
        self.assertEqual({case["libraryStatus"] for case in published}, {"published"})
        self.assertEqual({case["publishedRunId"] for case in published}, {run_id})
        self.assertTrue(all(case["publishedAt"] for case in published))
        self.assertEqual(platform.get_project(item["projectId"])["stats"]["testCases"], 2)
        self.assertEqual(platform.feature_menus(item["projectId"])["items"][0]["caseCount"], 2)
        self.assertEqual(platform.dashboard_summary_payload(item["projectId"])["totals"]["testCases"], 2)

    def test_partial_artifact_save_publishes_all_cases_and_activates_only_passed_script(self):
        item = self.create_automation_work_item_with_cases()
        generated = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="create", case_ids=item["caseIds"]),
        )
        run_id, _, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        timestamp = platform.now_iso()
        passed_case_id, failed_case_id = item["caseIds"]
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE runs SET status = 'failed', stage_key = 'complete', stage_label = '完成', progress = 100, ended_at = ?, exit_code = 1 WHERE id = ?",
                (timestamp, run_id),
            )
            conn.execute(
                "UPDATE work_items SET latest_run_id = ?, status = 'failed', updated_at = ? WHERE id = ?",
                (run_id, timestamp, item["id"]),
            )
            conn.execute(
                "UPDATE run_script_versions SET result_status = CASE WHEN case_id = ? THEN 'passed' ELSE 'failed' END WHERE run_id = ?",
                (passed_case_id, run_id),
            )
        outcome = platform.build_automation_flow_outcome(item["id"], run_id, warnings=["CODEX_TEST 部分完成"])

        delivered = platform.save_artifacts(
            item["id"],
            SaveArtifactsRequest(run_id=run_id),
            automation_flow_run_id="flow-codex-library",
            allow_partial=True,
            outcome=outcome,
        )

        with platform.get_db() as conn:
            case_rows = conn.execute(
                "SELECT id, library_status, latest_status FROM test_cases WHERE work_item_id = ? ORDER BY external_id",
                (item["id"],),
            ).fetchall()
            active_case_ids = {
                row["case_id"]
                for row in conn.execute(
                    "SELECT case_id FROM test_case_script_bindings WHERE is_active = 1",
                ).fetchall()
            }
            version_statuses = {
                row["case_id"]: row["status"]
                for row in conn.execute(
                    "SELECT case_id, status FROM test_script_versions WHERE id IN (?, ?)",
                    tuple(version["id"] for version in generated["scriptVersions"]),
                ).fetchall()
            }

        self.assertEqual(delivered["status"], "partial")
        self.assertEqual({row["library_status"] for row in case_rows}, {"published"})
        self.assertEqual({row["id"]: row["latest_status"] for row in case_rows}, {passed_case_id: "passed", failed_case_id: "failed"})
        self.assertEqual(active_case_ids, {passed_case_id})
        self.assertEqual(version_statuses[passed_case_id], "active")
        self.assertNotEqual(version_statuses[failed_case_id], "active")

    def test_manual_and_existing_published_cases_remain_visible(self):
        item = self.create_work_item_with_cases()
        existing_case_ids = item["caseIds"]
        self.assertEqual({case["libraryStatus"] for case in platform.test_cases(project_id=item["projectId"])}, {"published"})

        self.mark_work_item_as_automation_flow(item, flow_id="flow-codex-refresh")
        refreshed = platform.generate_cases(
            item["id"],
            ContentRequest(
                content=item["casesMarkdown"].replace("页面可以访问", "页面仍然可以访问"),
                asset_mode="refresh",
                case_ids=existing_case_ids,
            ),
        )

        self.assertEqual(refreshed["caseIds"], existing_case_ids)
        visible = platform.test_cases(project_id=item["projectId"])
        self.assertEqual(len(visible), 2)
        self.assertEqual({case["libraryStatus"] for case in visible}, {"published"})

    def test_init_db_backfills_legacy_cases_as_published(self):
        legacy_db = self.root / "legacy.sqlite"
        timestamp = "2026-08-14T00:00:00+00:00"
        with sqlite3.connect(legacy_db) as conn:
            conn.execute(
                """
                CREATE TABLE test_cases (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    work_item_id TEXT,
                    feature_id TEXT,
                    external_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    title_source TEXT NOT NULL DEFAULT 'manual',
                    suggested_title TEXT,
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
            conn.execute(
                """
                INSERT INTO test_cases (
                    id, project_id, external_id, title, automation_status, created_at, updated_at
                ) VALUES ('legacy-case', 'legacy-project', 'TC-CODEX-LEGACY-001', '历史用例', 'manual', ?, ?)
                """,
                (timestamp, timestamp),
            )

        current_db = platform.DB_PATH
        try:
            platform.DB_PATH = legacy_db
            platform.init_db()
            with platform.get_db() as conn:
                row = conn.execute("SELECT * FROM test_cases WHERE id = 'legacy-case'").fetchone()
            self.assertEqual(row["library_status"], "published")
            self.assertEqual(row["published_at"], timestamp)
            self.assertEqual(row["published_run_id"] or "", "")
        finally:
            platform.DB_PATH = current_db

    def test_generate_script_set_creates_one_spec_per_case(self):
        item = self.create_work_item_with_cases()

        result = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )

        script_set = result["scriptSet"]
        versions = script_set["scriptVersions"]
        self.assertEqual(script_set["status"], "ready")
        self.assertEqual(len(versions), 2)
        self.assertEqual(len({version["caseId"] for version in versions}), 2)
        self.assertTrue(script_set["fixtureVersion"]["content"].strip())
        self.assertTrue(all("../fixtures/" in version["content"] for version in versions))
        self.assertTrue(all(Path(version["specPath"]).exists() for version in versions))

    def test_case_save_updates_script_workbench_cases_and_marks_script_set_stale(self):
        item = self.create_work_item_with_cases()
        scripted = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )
        original_revision_id = scripted["casesRevisionId"]
        self.assertEqual(scripted["scriptSet"]["casesRevisionId"], original_revision_id)

        updated_markdown = item["casesMarkdown"].replace("核心区域可见", "最新核心区域可见")
        updated = platform.generate_cases(
            item["id"],
            ContentRequest(
                content=updated_markdown,
                asset_mode="append",
                case_ids=item["caseIds"],
                base_cases_revision_id=original_revision_id,
            ),
        )

        self.assertNotEqual(updated["casesRevisionId"], original_revision_id)
        self.assertIn("最新核心区域可见", [case["title"] for case in updated["testCases"]])
        self.assertEqual(updated["scriptSet"]["casesRevisionId"], original_revision_id)

        resynced = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=updated["caseIds"]),
        )
        self.assertEqual(resynced["scriptSet"]["casesRevisionId"], updated["casesRevisionId"])
        self.assertIn("最新核心区域可见", [case["title"] for case in resynced["testCases"]])

    def test_self_healing_selects_ninth_failed_spec_and_scopes_prompt_to_one_case(self):
        case_rows = "\n".join(
            f"| TC-CODEX-HEAL-{index:03d} | P{0 if index == 1 else 1} | 用例 {index} | 页面验证 | 无 | 打开页面 | 页面显示 | 自动化 |"
            for index in range(1, 11)
        )
        cases_markdown = f"""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
{case_rows}
"""
        item = self.create_work_item_with_cases(cases_markdown)
        generated = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )
        run_id, suite, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        versions = generated["scriptSet"]["scriptVersions"]
        failed_version = versions[8]

        with platform.get_db() as conn:
            conn.execute(
                "UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?",
                (platform.now_iso(), run_id),
            )
            for version in versions:
                conn.execute(
                    "UPDATE test_script_versions SET status = ?, verified_run_id = ? WHERE id = ?",
                    ("failed" if version["id"] == failed_version["id"] else "verified", run_id, version["id"]),
                )
                conn.execute(
                    "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'info', ?)",
                    (run_id, platform.now_iso(), f"已归档本轮执行 spec 快照: artifacts/{Path(version['specPath']).name}"),
                )
            conn.execute(
                "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'error', ?)",
                (
                    run_id,
                    platform.now_iso(),
                    f"  ✘  9 [chromium] › tests/e2e/.live-runs/{run_id}/{Path(failed_version['specPath']).name}:4:1 › {failed_version['case']['externalId']}",
                ),
            )
            selected = platform.failure_script_version_for_run(conn, run_id)
            failed_case = conn.execute("SELECT * FROM test_cases WHERE id = ?", (failed_version["caseId"],)).fetchone()
            scoped_cases = platform.cases_markdown_for_case_ids(conn, [failed_case["id"]])
            elements = conn.execute(
                "SELECT * FROM confirmed_elements WHERE work_item_id = ? AND confirmed = 1",
                (item["id"],),
            ).fetchall()
            item_row = conn.execute("SELECT * FROM work_items WHERE id = ?", (item["id"],)).fetchone()

        self.assertIsNotNone(selected)
        self.assertEqual(selected["id"], failed_version["id"])
        fixture_import = f"../fixtures/{failed_version['fixtureVersionId']}"
        prompt = platform.healed_script_prompt(
            item_row,
            failed_version["content"],
            {"spec": json.dumps(suite["specs"], ensure_ascii=False)},
            f"Error at {Path(failed_version['specPath']).name}",
            elements,
            cases_markdown=scoped_cases,
            fixture_import=fixture_import,
        )
        healed_script = f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{fixture_import}';

test('{failed_case["external_id"]} {failed_case["title"]}', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{ await page.goto(TARGET_URL); }});
  await runStep('验证页面', async () => {{
    // 主断言：{failed_case["expected"]}
    await expect(page.locator('body')).toBeVisible();
  }});
}});
"""

        self.assertIn("必须且只能包含一个 Playwright `test(...)`", prompt)
        self.assertIn(failed_case["external_id"], prompt)
        self.assertIn(fixture_import, prompt)
        for version in versions[:8] + versions[9:]:
            self.assertNotIn(version["case"]["externalId"], prompt)
        self.assertEqual(platform.valid_case_playwright_script(healed_script, failed_case, elements, fixture_import), "")

    def test_self_healing_repairs_all_failed_cases_then_runs_subset_and_full_set(self):
        item = self.create_work_item_with_cases()
        generated = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )
        versions = generated["scriptSet"]["scriptVersions"]
        external_ids = [version["case"]["externalId"] for version in versions]
        source_run_id, _, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?",
                (platform.now_iso(), source_run_id),
            )
            for version in versions:
                conn.execute(
                    "UPDATE test_script_versions SET status = ?, verified_run_id = ? WHERE id = ?",
                    ("failed", source_run_id, version["id"]),
                )
                conn.execute(
                    "UPDATE run_script_versions SET result_status = 'failed' WHERE run_id = ? AND script_version_id = ?",
                    (source_run_id, version["id"]),
                )
                conn.execute(
                    "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'error', ?)",
                    (source_run_id, platform.now_iso(), f"  ✘  1 [chromium] › {Path(version['specPath']).name}:4:1 › {version['case']['externalId']}"),
                )
        platform.update_work_item(item["id"], stage="运行验证", status="failed", latest_run_id=source_run_id)
        healing_run = platform.create_healing_run_record(item["id"], source_run_id)
        self.assertEqual([script["externalId"] for script in healing_run["failedScripts"]], external_ids)
        generated_targets = []
        rerun_round = 0
        rerun_scopes = []

        async def fake_generate(*args, **kwargs):
            target_case = platform.parse_cases_markdown(kwargs["cases_markdown"])[0]
            target = target_case["external_id"]
            generated_targets.append(target)
            return f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{kwargs["fixture_import"]}';

test('{target} {target_case["title"]}', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{ await page.goto(TARGET_URL); }});
  await runStep('验证修复状态', async () => {{
    // 主断言：{target_case["expected"]}
    await expect(page.locator('body')).toHaveAttribute('data-heal-round', '{len(generated_targets)}');
  }});
}});
"""

        async def fake_rerun(
            work_item_id: str,
            flow_run_id: str = "",
            on_run_created=None,
            selected_script_version_ids=None,
        ):
            nonlocal rerun_round
            rerun_round += 1
            rerun_scopes.append(list(selected_script_version_ids) if selected_script_version_ids is not None else None)
            run_id, _, _ = await platform.create_work_item_draft_run(
                work_item_id,
                flow_run_id,
                selected_script_version_ids,
            )
            if on_run_created is not None:
                on_run_created(run_id)
            status = "passed"
            with platform.get_db() as conn:
                run_versions = conn.execute(
                    """
                    SELECT v.*
                    FROM run_script_versions rv
                    JOIN test_script_versions v ON v.id = rv.script_version_id
                    WHERE rv.run_id = ?
                    ORDER BY rv.created_at ASC
                    """,
                    (run_id,),
                ).fetchall()
                conn.execute(
                    "UPDATE runs SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?",
                    (status, platform.now_iso(), 1 if status == "failed" else 0, run_id),
                )
                for version in run_versions:
                    conn.execute(
                        "UPDATE test_script_versions SET status = ?, verified_run_id = ? WHERE id = ?",
                        ("verified", run_id, version["id"]),
                    )
                return conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()

        with patch.object(platform, "expectation_policy_mismatch_reason", return_value=""), patch.object(
            platform,
            "generate_healed_script",
            new=AsyncMock(side_effect=fake_generate),
        ), patch.object(
            platform,
            "run_work_item_draft_once",
            new=AsyncMock(side_effect=fake_rerun),
        ):
            result = asyncio.run(platform.execute_self_healing(healing_run["id"]))

        self.assertEqual(result["status"], "passed")
        self.assertEqual(generated_targets, external_ids)
        self.assertEqual(rerun_round, 2)
        self.assertEqual(len(rerun_scopes[0]), 2)
        self.assertIsNone(rerun_scopes[1])
        self.assertTrue(all(external_id in result["attempts"][0]["result"] for external_id in external_ids))

    def test_self_healing_rejects_multiple_assertion_candidate_without_overwrite(self):
        single_case = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-HEAL-001 | P0 | 自愈保持主断言 | 自愈约束 | 无 | 打开页面 | 页面可见 | 自动化 |
"""
        item = self.create_work_item_with_cases(single_case)
        generated = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )
        version = generated["scriptVersions"][0]
        source_run_id, _, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?",
                (platform.now_iso(), source_run_id),
            )
            conn.execute(
                "UPDATE test_script_versions SET status = 'failed', verified_run_id = ? WHERE id = ?",
                (source_run_id, version["id"]),
            )
            conn.execute(
                "UPDATE run_script_versions SET result_status = 'failed' WHERE run_id = ? AND script_version_id = ?",
                (source_run_id, version["id"]),
            )
            conn.execute(
                "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'error', ?)",
                (source_run_id, platform.now_iso(), f"Error: expect failed at {Path(version['specPath']).name}:8:3"),
            )
            original_version_count = conn.execute(
                "SELECT COUNT(*) AS total FROM test_script_versions WHERE work_item_id = ?",
                (item["id"],),
            ).fetchone()["total"]
        platform.update_work_item(item["id"], stage="运行验证", status="failed", latest_run_id=source_run_id)
        healing_run = platform.create_healing_run_record(item["id"], source_run_id)

        async def invalid_healed_script(*args, **kwargs):
            target_case = platform.parse_cases_markdown(kwargs["cases_markdown"])[0]
            return f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{kwargs["fixture_import"]}';

test('{target_case["external_id"]} {target_case["title"]}', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{ await page.goto(TARGET_URL); }});
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveURL(/example/);
}});
"""

        rerun = AsyncMock()
        with patch.object(platform, "expectation_policy_mismatch_reason", return_value=""), patch.object(
            platform,
            "generate_healed_script",
            new=AsyncMock(side_effect=invalid_healed_script),
        ), patch.object(platform, "run_work_item_draft_once", new=rerun):
            result = asyncio.run(platform.execute_self_healing(healing_run["id"]))

        with platform.get_db() as conn:
            final_version_count = conn.execute(
                "SELECT COUNT(*) AS total FROM test_script_versions WHERE work_item_id = ?",
                (item["id"],),
            ).fetchone()["total"]
        self.assertEqual(result["status"], "failed")
        self.assertEqual(final_version_count, original_version_count)
        rerun.assert_not_awaited()

    def test_regenerating_one_case_preserves_other_case_in_same_batch(self):
        item = self.create_work_item_with_cases()
        initial = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )
        initial_versions = {version["caseId"]: version for version in initial["scriptVersions"]}
        target_case_id = item["caseIds"][0]

        regenerated = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=[target_case_id]),
        )
        regenerated_versions = {version["caseId"]: version for version in regenerated["scriptVersions"]}

        self.assertEqual(regenerated["scriptSet"]["generationBatchId"], initial["scriptSet"]["generationBatchId"])
        self.assertEqual(len(regenerated_versions), 2)
        self.assertNotEqual(regenerated_versions[target_case_id]["id"], initial_versions[target_case_id]["id"])
        other_case_id = item["caseIds"][1]
        self.assertEqual(regenerated_versions[other_case_id]["id"], initial_versions[other_case_id]["id"])

    def test_run_and_delivery_keep_case_script_versions_separate(self):
        item = self.create_work_item_with_cases()
        generated = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )

        run_id, suite, script_version_ids = asyncio.run(platform.create_work_item_draft_run(item["id"]))

        self.assertEqual(len(suite["specs"]), 2)
        self.assertEqual(len(script_version_ids), 2)
        with platform.get_db() as conn:
            linked_count = conn.execute(
                "SELECT COUNT(*) AS count FROM run_script_versions WHERE run_id = ?",
                (run_id,),
            ).fetchone()["count"]
            conn.execute(
                "UPDATE runs SET status = 'passed', stage_key = 'complete', stage_label = '完成', progress = 100, ended_at = ?, exit_code = 0 WHERE id = ?",
                (platform.now_iso(), run_id),
            )
            conn.execute(
                "UPDATE work_items SET latest_run_id = ?, status = 'passed', updated_at = ? WHERE id = ?",
                (run_id, platform.now_iso(), item["id"]),
            )
        self.assertEqual(linked_count, 2)

        delivered = platform.save_artifacts(item["id"], SaveArtifactsRequest(run_id=run_id))

        with platform.get_db() as conn:
            spec_rows = conn.execute(
                "SELECT * FROM deliverables WHERE work_item_id = ? AND type = 'spec' ORDER BY case_id",
                (item["id"],),
            ).fetchall()
        self.assertEqual(delivered["status"], "artifacts-saved")
        self.assertEqual(len(spec_rows), 2)
        self.assertEqual({row["case_id"] for row in spec_rows}, set(item["caseIds"]))
        self.assertTrue(all(Path(row["file_path"]).exists() for row in spec_rows))
        self.assertEqual(len(generated["scriptVersions"]), 2)

    def test_json_report_updates_each_case_status_independently(self):
        item = self.create_work_item_with_cases()
        generated = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )
        run_id, suite, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        result_dir = platform.EXECUTION_CONFIG_DIR / run_id
        result_dir.mkdir(parents=True, exist_ok=True)
        result_dir.joinpath("results.json").write_text(
            json.dumps({
                "suites": [{
                    "specs": [
                        {"file": suite["specs"][0], "tests": [{"results": [{"status": "passed"}]}]},
                        {"file": suite["specs"][1], "tests": [{"results": [{"status": "failed"}]}]},
                    ]
                }]
            }),
            encoding="utf-8",
        )

        script_results = platform.update_run_script_case_results(run_id, "failed")
        platform.write_failed_script_logs(run_id, script_results)

        versions = {version["caseId"]: version for version in platform.get_work_item(item["id"])["scriptVersions"]}
        with platform.get_db() as conn:
            cases = {
                row["id"]: row["latest_status"]
                for row in conn.execute("SELECT id, latest_status FROM test_cases WHERE work_item_id = ?", (item["id"],)).fetchall()
            }
        self.assertEqual(versions[item["caseIds"][0]]["status"], "verified")
        self.assertEqual(versions[item["caseIds"][1]]["status"], "failed")
        self.assertEqual(cases[item["caseIds"][0]], "passed")
        self.assertEqual(cases[item["caseIds"][1]], "failed")
        failed_script = platform.get_run(run_id)["failedScripts"]
        self.assertEqual(len(failed_script), 1)
        self.assertEqual(failed_script[0]["caseId"], item["caseIds"][1])
        self.assertEqual(failed_script[0]["externalId"], "TC-CODEX-SET-002")
        self.assertEqual(failed_script[0]["title"], "核心区域可见")
        self.assertEqual(failed_script[0]["specPath"], suite["specs"][1])
        log_text = platform.run_log_text(run_id)
        self.assertIn("失败用例脚本：TC-CODEX-SET-002 核心区域可见", log_text)
        self.assertNotIn("失败用例脚本：TC-CODEX-SET-001", log_text)

    def test_run_script_results_remain_bound_to_historical_run(self):
        item = self.create_work_item_with_cases()
        platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )
        first_run_id, first_suite, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        first_result_dir = platform.EXECUTION_CONFIG_DIR / first_run_id
        first_result_dir.mkdir(parents=True, exist_ok=True)
        first_result_dir.joinpath("results.json").write_text(
            json.dumps({
                "suites": [{
                    "specs": [
                        {"file": first_suite["specs"][0], "tests": [{"results": [{"status": "failed"}]}]},
                        {"file": first_suite["specs"][1], "tests": [{"results": [{"status": "passed"}]}]},
                    ]
                }]
            }),
            encoding="utf-8",
        )
        platform.update_run_script_case_results(first_run_id, "failed")
        platform.update_run(first_run_id, status="failed")

        second_run_id, second_suite, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        second_result_dir = platform.EXECUTION_CONFIG_DIR / second_run_id
        second_result_dir.mkdir(parents=True, exist_ok=True)
        second_result_dir.joinpath("results.json").write_text(
            json.dumps({
                "suites": [{
                    "specs": [
                        {"file": second_suite["specs"][0], "tests": [{"results": [{"status": "passed"}]}]},
                        {"file": second_suite["specs"][1], "tests": [{"results": [{"status": "failed"}]}]},
                    ]
                }]
            }),
            encoding="utf-8",
        )
        platform.update_run_script_case_results(second_run_id, "failed")

        self.assertEqual(
            [item["externalId"] for item in platform.get_run(first_run_id)["failedScripts"]],
            ["TC-CODEX-SET-001"],
        )
        self.assertEqual(
            [item["externalId"] for item in platform.get_run(second_run_id)["failedScripts"]],
            ["TC-CODEX-SET-002"],
        )

    def test_failed_script_detection_uses_log_fallback_without_misreporting_batch(self):
        item = self.create_work_item_with_cases()
        platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )
        run_id, suite, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        failed_filename = Path(suite["specs"][1]).name
        platform.write_log(run_id, "info", f"Error: expect failed at {failed_filename}:18:7")

        script_results = platform.update_run_script_case_results(run_id, "failed")

        by_external_id = {item["externalId"]: item["resultStatus"] for item in script_results}
        self.assertEqual(by_external_id["TC-CODEX-SET-001"], "unknown")
        self.assertEqual(by_external_id["TC-CODEX-SET-002"], "failed")

    def test_failed_script_detection_marks_single_script_and_reports_unresolved_batch(self):
        item = self.create_work_item_with_cases()
        generated = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=item["caseIds"]),
        )
        versions = generated["scriptVersions"]
        single_run_id, _, _ = asyncio.run(platform.create_work_item_draft_run(
            item["id"],
            selected_script_version_ids=[versions[0]["id"]],
        ))
        single_results = platform.update_run_script_case_results(single_run_id, "failed")
        self.assertEqual(single_results[0]["resultStatus"], "failed")
        platform.update_run(single_run_id, status="failed")

        batch_run_id, _, _ = asyncio.run(platform.create_work_item_draft_run(item["id"]))
        batch_results = platform.update_run_script_case_results(batch_run_id, "failed")
        platform.write_failed_script_logs(batch_run_id, batch_results)

        self.assertEqual({item["resultStatus"] for item in batch_results}, {"unknown"})
        self.assertEqual(platform.get_run(batch_run_id)["failedScripts"], [])
        self.assertIn("未能从 Playwright 结果中定位具体失败用例脚本", platform.run_log_text(batch_run_id))


class SaveArtifactsRouteContractTests(unittest.TestCase):
    def test_save_artifacts_openapi_accepts_flat_request_body(self):
        from backend.app.main import app

        operation = app.openapi()["paths"]["/api/work-items/{work_item_id}/save-artifacts"]["post"]
        schema = operation["requestBody"]["content"]["application/json"]["schema"]

        self.assertEqual(schema, {"$ref": "#/components/schemas/SaveArtifactsRequest"})

    def test_save_artifacts_route_forwards_payload_without_wrapper_object(self):
        from backend.app.routers import work_items

        payload = SaveArtifactsRequest(run_id="CODEX_TEST_PASSED_RUN", report_content="")
        with patch.object(platform, "save_artifacts", return_value={"id": "CODEX_TEST_WORK_ITEM"}) as save:
            result = work_items.save_work_item_artifacts("CODEX_TEST_WORK_ITEM", payload)

        self.assertEqual(result, {"id": "CODEX_TEST_WORK_ITEM"})
        save.assert_called_once_with("CODEX_TEST_WORK_ITEM", payload)


if __name__ == "__main__":
    unittest.main()
