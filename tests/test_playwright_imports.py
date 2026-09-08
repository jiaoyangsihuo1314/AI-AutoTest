import asyncio
import json
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from backend.app import platform
from backend.app.playwright_imports import (
    analyze_playwright_dependencies,
    match_cases_to_tests,
    required_environment_names,
)
from backend.app.schemas.models import (
    CaseDebugSessionCreateRequest,
    EnvironmentVariableInput,
    EnvironmentVariablesRequest,
    ProjectRequest,
    TestCaseImportCommitRequest,
)


ATTACHMENT_ROOT = Path("/Users/syj/Documents/my-job/tests/e2e")
CASES_PATH = ATTACHMENT_ROOT / "skillhub-library.test-cases.md"
SPEC_PATH = ATTACHMENT_ROOT / "skillhub-library.spec.ts"


class PlaywrightCaseMatchingTests(unittest.TestCase):
    def test_partial_coverage_ignores_tests_for_cases_no_longer_in_markdown(self):
        cases = [{"external_id": "TC-DISC-013", "title": "目标用例"}]
        tests = [
            {
                "title": "TC-DISC-012 历史测试",
                "fullTitle": "共享 spec › TC-DISC-012 历史测试",
                "line": 12,
            },
            {
                "title": "TC-DISC-013 目标用例",
                "fullTitle": "共享 spec › TC-DISC-013 目标用例",
                "line": 13,
            },
        ]

        with self.assertRaisesRegex(ValueError, "TC-DISC-012 历史测试"):
            match_cases_to_tests(cases, tests)

        bindings = match_cases_to_tests(cases, tests, require_complete_coverage=False)
        self.assertEqual([item["externalId"] for item in bindings], ["TC-DISC-013"])


class FakeUpload:
    def __init__(self, path: Path):
        self.filename = path.name
        self.content = path.read_bytes()

    async def read(self):
        return self.content


class FakeMultipartRequest:
    def __init__(self, project_id: str, cases_path: Path, spec_path: Path):
        self.payload = {
            "project_id": project_id,
            "cases_file": FakeUpload(cases_path),
            "spec_file": FakeUpload(spec_path),
        }

    async def form(self):
        return self.payload


@unittest.skipUnless(CASES_PATH.exists() and SPEC_PATH.exists(), "SkillHub import attachments are unavailable")
class PlaywrightImportCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="CODEX_TEST_IMPORT_20260901_")
        self.root = Path(self.temp.name)
        self.stack = ExitStack()
        self.stack.enter_context(patch.object(platform, "DB_PATH", self.root / "platform.sqlite"))
        self.stack.enter_context(patch.object(platform, "ARTIFACT_DIR", self.root / "artifacts"))
        self.stack.enter_context(patch.object(platform, "PROJECT_ARTIFACT_DIR", self.root / "projects"))
        self.stack.enter_context(patch.object(platform, "FLOW_RUN_ARTIFACT_DIR", self.root / "flow-runs"))
        self.stack.enter_context(patch.object(platform, "IMPORT_STAGING_DIR", self.root / "import-staging"))
        self.stack.enter_context(patch.object(platform, "WORK_ITEM_DRAFT_DIR", self.root / "draft-runs"))
        self.stack.enter_context(patch.object(platform, "EXECUTION_CONFIG_DIR", self.root / "execution-configs"))
        self.stack.enter_context(patch.object(platform, "PLAYWRIGHT_REPORT_ARCHIVE_DIR", self.root / "playwright-reports"))
        self.stack.enter_context(patch.object(platform, "REPORT_INDEX", self.root / "playwright-report" / "index.html"))
        self.stack.enter_context(patch.object(platform, "SECRET_KEY_PATH", self.root / ".secret-key"))
        platform.init_db()
        self.project = platform.create_project(
            ProjectRequest(
                name="CODEX_TEST_IMPORT_20260901",
                project_code="CODEX-IMPORT-20260901",
                target_url="http://127.0.0.1:41731/",
            )
        )
        self.environment_id = self.project["defaultEnvironmentId"]

    def tearDown(self):
        self.stack.close()
        self.temp.cleanup()

    def preview_and_commit(self):
        preview = asyncio.run(
            platform.preview_test_case_import(
                FakeMultipartRequest(self.project["id"], CASES_PATH, SPEC_PATH)
            )
        )
        platform.update_project_environment_variables(
            self.environment_id,
            EnvironmentVariablesRequest(
                items=[
                    EnvironmentVariableInput(name="QA_USERNAME", value="test", is_secret=False),
                    EnvironmentVariableInput(name="QA_PASSWORD", value="CODEX_SECRET_20260901", is_secret=True),
                ]
            ),
        )
        committed = asyncio.run(
            platform.commit_test_case_import(
                preview["id"],
                TestCaseImportCommitRequest(
                    project_id=self.project["id"],
                    environment_id=self.environment_id,
                ),
            )
        )
        return preview, committed

    def test_attachment_preview_discovers_dynamic_tests_and_environment_variables(self):
        preview = asyncio.run(
            platform.preview_test_case_import(
                FakeMultipartRequest(self.project["id"], CASES_PATH, SPEC_PATH)
            )
        )

        self.assertEqual(preview["caseCount"], 10)
        self.assertEqual(preview["testCount"], 10)
        self.assertEqual(preview["playwrightVersion"], "1.60.0")
        self.assertEqual(preview["requiredEnvironmentVariables"], ["QA_PASSWORD", "QA_USERNAME"])
        self.assertEqual(
            [item["externalId"] for item in preview["bindings"]],
            [f"TC-LIB-{index:03d}" for index in range(1, 11)],
        )

    def test_commit_creates_hidden_system_work_item_and_one_shared_script(self):
        _, committed = self.preview_and_commit()

        self.assertEqual(committed["status"], "committed")
        self.assertEqual(committed["missingEnvironmentVariables"], [])
        with platform.get_db() as conn:
            work_item = conn.execute("SELECT * FROM work_items WHERE id = ?", (committed["workItemId"],)).fetchone()
            version = conn.execute("SELECT * FROM test_script_versions WHERE work_item_id = ?", (work_item["id"],)).fetchone()
            case_count = conn.execute("SELECT COUNT(*) AS total FROM test_cases WHERE work_item_id = ?", (work_item["id"],)).fetchone()["total"]
            bindings = conn.execute(
                "SELECT COUNT(*) AS total, COALESCE(SUM(is_active), 0) AS active FROM test_case_script_bindings WHERE script_version_id = ?",
                (version["id"],),
            ).fetchone()
            secret = conn.execute(
                "SELECT value_ciphertext FROM project_environment_variables WHERE environment_id = ? AND name = 'QA_PASSWORD'",
                (self.environment_id,),
            ).fetchone()["value_ciphertext"]

        self.assertEqual(work_item["is_system_import"], 1)
        work_item_payload = platform.get_work_item(work_item["id"])
        self.assertTrue(work_item_payload["systemImport"])
        self.assertEqual(work_item_payload["importId"], committed["id"])
        self.assertEqual(case_count, 10)
        self.assertEqual(version["source"], "external-import")
        self.assertEqual(version["script_layout"], "shared-spec")
        self.assertEqual(bindings["total"], 10)
        self.assertEqual(bindings["active"], 0)
        self.assertNotEqual(secret, "CODEX_SECRET_20260901")
        self.assertNotIn(work_item["id"], [item["id"] for item in platform.work_items()])
        imported_cases = platform.test_cases(project_id=self.project["id"], work_item_id=work_item["id"])
        self.assertEqual(len(imported_cases), 10)
        self.assertTrue(all(not item["scriptVersionId"] for item in imported_cases))
        self.assertTrue(all(item["candidateScriptVersionId"] == version["id"] for item in imported_cases))
        self.assertTrue(all(item["candidateScriptStatus"] == "draft" for item in imported_cases))
        self.assertTrue(all(item["candidateScriptLayout"] == "shared-spec" for item in imported_cases))

    def test_failed_inactive_import_opens_full_shared_spec_private_debug_branch(self):
        _, committed = self.preview_and_commit()
        with platform.get_db() as conn:
            version = conn.execute(
                "SELECT * FROM test_script_versions WHERE work_item_id = ?",
                (committed["workItemId"],),
            ).fetchone()
            conn.execute("UPDATE test_script_versions SET status = 'failed' WHERE id = ?", (version["id"],))
            target_case = conn.execute(
                "SELECT * FROM test_cases WHERE work_item_id = ? AND external_id = 'TC-LIB-001'",
                (committed["workItemId"],),
            ).fetchone()

        session = platform.create_case_debug_session(
            target_case["id"],
            CaseDebugSessionCreateRequest(expected_case_updated_at=target_case["updated_at"]),
        )

        self.assertEqual(session["sourceScriptVersionId"], version["id"])
        self.assertTrue(session["currentScriptVersionId"])
        self.assertTrue(session["sharedScriptDebug"])
        self.assertEqual(session["currentScriptVersion"]["content"], version["content"])
        self.assertEqual(session["currentScriptVersion"]["caseId"], target_case["id"])
        self.assertEqual(session["currentScriptVersion"]["caseIds"], [target_case["id"]])
        self.assertEqual(session["currentScriptVersion"]["source"], "external-import")
        self.assertEqual(session["currentScriptVersion"]["scriptLayout"], "shared-spec")
        self.assertEqual(
            session["debugGrepPattern"],
            platform.exact_test_title_grep_pattern("TC-LIB-001 [P0] 登录后技能库页面完整展示"),
        )
        self.assertEqual(session["dependencyExecution"]["recommendation"], "single")
        self.assertEqual(session["dependencyExecution"]["defaultScope"], "single")

    def test_passed_run_activates_all_bindings_and_saves_four_deliverables(self):
        preview, committed = self.preview_and_commit()
        work_item_id = committed["workItemId"]
        run_id = "CODEXRUN0901"
        report_path = self.root / "reports" / "index.html"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text("<html><body>passed</body></html>", encoding="utf-8")
        timestamp = platform.now_iso()
        with platform.get_db() as conn:
            version = conn.execute("SELECT * FROM test_script_versions WHERE work_item_id = ?", (work_item_id,)).fetchone()
            cases_revision = conn.execute("SELECT id FROM generated_cases WHERE work_item_id = ?", (work_item_id,)).fetchone()
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                    started_at, ended_at, exit_code, report_path, screenshot_path, work_item_id,
                    script_version_id, cases_revision_id
                ) VALUES (?, 'import', 'import', ?, 'passed', 'complete', '完成', 100, ?, ?, 0, ?, '', ?, ?, ?)
                """,
                (run_id, version["spec_path"], timestamp, timestamp, str(report_path), work_item_id, version["id"], cases_revision["id"]),
            )
            conn.execute(
                """
                INSERT INTO run_script_versions (run_id, script_version_id, case_id, result_status, created_at)
                VALUES (?, ?, '', 'passed', ?)
                """,
                (run_id, version["id"], timestamp),
            )
            conn.execute("UPDATE work_items SET latest_run_id = ? WHERE id = ?", (run_id, work_item_id))

        platform.finalize_external_import_run(run_id, "passed", report_path)

        result = platform.get_test_case_import(preview["id"])
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["verificationRunId"], run_id)
        self.assertEqual(result["verificationStatus"], "passed")
        self.assertEqual(result["verificationReportUrl"], f"/reports/playwright/runs/{run_id}")
        with platform.get_db() as conn:
            active = conn.execute(
                "SELECT COUNT(*) AS total FROM test_case_script_bindings WHERE script_version_id = (SELECT id FROM test_script_versions WHERE work_item_id = ?) AND is_active = 1",
                (work_item_id,),
            ).fetchone()["total"]
            automated = conn.execute(
                "SELECT COUNT(*) AS total FROM test_cases WHERE work_item_id = ? AND automation_status = 'automated' AND published_run_id = ?",
                (work_item_id, run_id),
            ).fetchone()["total"]
            deliverables = conn.execute("SELECT type FROM deliverables WHERE work_item_id = ? ORDER BY type", (work_item_id,)).fetchall()
        self.assertEqual(active, 10)
        self.assertEqual(automated, 10)
        self.assertEqual([row["type"] for row in deliverables], ["html-report", "manual-report", "spec", "test-cases"])
        published_cases = platform.test_cases(project_id=self.project["id"], work_item_id=work_item_id)
        self.assertTrue(all(item["scriptVersionId"] for item in published_cases))
        self.assertTrue(all(not item["candidateScriptVersionId"] for item in published_cases))

    def test_partial_run_activates_only_passed_binding_and_keeps_failed_candidates(self):
        preview, committed = self.preview_and_commit()
        work_item_id = committed["workItemId"]
        run_id = "CODEXPARTIAL0901"
        report_path = self.root / "partial-reports" / "index.html"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text("<html><body>partial</body></html>", encoding="utf-8")
        timestamp = platform.now_iso()
        with platform.get_db() as conn:
            version = conn.execute("SELECT * FROM test_script_versions WHERE work_item_id = ?", (work_item_id,)).fetchone()
            cases_revision = conn.execute("SELECT id FROM generated_cases WHERE work_item_id = ?", (work_item_id,)).fetchone()
            cases = conn.execute(
                "SELECT * FROM test_cases WHERE work_item_id = ? ORDER BY external_id",
                (work_item_id,),
            ).fetchall()
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                    started_at, ended_at, exit_code, report_path, screenshot_path, work_item_id,
                    script_version_id, cases_revision_id
                ) VALUES (?, 'import', 'import', ?, 'failed', 'complete', '完成', 100, ?, ?, 1, ?, '', ?, ?, ?)
                """,
                (run_id, version["spec_path"], timestamp, timestamp, str(report_path), work_item_id, version["id"], cases_revision["id"]),
            )
            conn.execute(
                """
                INSERT INTO run_script_versions (run_id, script_version_id, case_id, result_status, created_at)
                VALUES (?, ?, '', 'failed', ?)
                """,
                (run_id, version["id"], timestamp),
            )
            platform.ensure_reports_for_run(conn, run_id, status="queued")
            conn.execute("UPDATE work_items SET latest_run_id = ? WHERE id = ?", (run_id, work_item_id))

            bindings = conn.execute(
                """
                SELECT b.test_title FROM test_case_script_bindings b
                JOIN test_cases tc ON tc.id = b.case_id
                WHERE b.script_version_id = ? ORDER BY tc.external_id
                """,
                (version["id"],),
            ).fetchall()

        result_dir = platform.EXECUTION_CONFIG_DIR / run_id
        result_dir.mkdir(parents=True, exist_ok=True)
        (result_dir / "results.json").write_text(
            json.dumps({
                "suites": [{
                    "title": "shared import",
                    "specs": [
                        {
                            "title": binding["test_title"],
                            "file": version["spec_path"],
                            "tests": [{"results": [{"status": "passed" if index == 0 else "failed"}]}],
                        }
                        for index, binding in enumerate(bindings)
                    ],
                }],
            }),
            encoding="utf-8",
        )
        script_results = platform.update_run_script_case_results(run_id, "failed")
        platform.update_case_execution_reports_for_run(
            run_id,
            "failed",
            failure_reason="CODEX_TEST_20260901 mixed result",
            report_path=report_path,
            script_results=script_results,
        )

        platform.finalize_external_import_run(run_id, "failed", report_path)

        result = platform.get_test_case_import(preview["id"])
        self.assertEqual(result["status"], "partially-verified")
        self.assertEqual(result["verificationRunId"], run_id)
        self.assertEqual(result["passedCaseCount"], 1)
        self.assertEqual(result["failedCaseCount"], 9)
        self.assertEqual(result["unknownCaseCount"], 0)
        with platform.get_db() as conn:
            active_rows = conn.execute(
                """
                SELECT tc.external_id FROM test_case_script_bindings b
                JOIN test_cases tc ON tc.id = b.case_id
                WHERE b.script_version_id = ? AND b.is_active = 1
                """,
                (version["id"],),
            ).fetchall()
            work_item = conn.execute("SELECT status FROM work_items WHERE id = ?", (work_item_id,)).fetchone()
            deliverable_count = conn.execute(
                "SELECT COUNT(*) AS total FROM deliverables WHERE work_item_id = ?",
                (work_item_id,),
            ).fetchone()["total"]
        self.assertEqual([row["external_id"] for row in active_rows], ["TC-LIB-001"])
        self.assertEqual(work_item["status"], "partial")
        self.assertEqual(deliverable_count, 4)
        imported_cases = platform.test_cases(project_id=self.project["id"], work_item_id=work_item_id)
        passed_case = next(item for item in imported_cases if item["externalId"] == "TC-LIB-001")
        failed_case = next(item for item in imported_cases if item["externalId"] == "TC-LIB-002")
        self.assertEqual(passed_case["latestStatus"], "passed")
        self.assertEqual(passed_case["scriptVersionId"], version["id"])
        self.assertEqual(failed_case["latestStatus"], "failed")
        self.assertFalse(failed_case["scriptVersionId"])
        self.assertEqual(failed_case["candidateScriptVersionId"], version["id"])
        self.assertEqual(failed_case["candidateScriptStatus"], "failed")

    def test_passed_case_debug_run_keeps_external_import_script_as_candidate(self):
        preview, committed = self.preview_and_commit()
        work_item_id = committed["workItemId"]
        with platform.get_db() as conn:
            target_case = conn.execute(
                "SELECT * FROM test_cases WHERE work_item_id = ? AND external_id = 'TC-LIB-001'",
                (work_item_id,),
            ).fetchone()
        session = platform.create_case_debug_session(
            target_case["id"],
            CaseDebugSessionCreateRequest(expected_case_updated_at=target_case["updated_at"]),
        )
        run_id = "CODEXDEBUGRUN0901"
        report_path = self.root / "debug-reports" / "index.html"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text("<html><body>passed</body></html>", encoding="utf-8")
        timestamp = platform.now_iso()
        with platform.get_db() as conn:
            version = conn.execute(
                "SELECT * FROM test_script_versions WHERE id = ?",
                (session["currentScriptVersionId"],),
            ).fetchone()
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                    started_at, ended_at, exit_code, report_path, screenshot_path, work_item_id,
                    script_version_id, cases_revision_id, debug_session_id
                ) VALUES (?, 'case-debug', 'case-debug', ?, 'passed', 'complete', '完成', 100,
                          ?, ?, 0, ?, '', ?, ?, ?, ?)
                """,
                (
                    run_id,
                    version["spec_path"],
                    timestamp,
                    timestamp,
                    str(report_path),
                    work_item_id,
                    version["id"],
                    session["caseRevisionId"],
                    session["id"],
                ),
            )
            conn.execute(
                """
                INSERT INTO run_script_versions (
                    run_id, script_version_id, case_id, case_definition_hash, result_status, created_at
                ) VALUES (?, ?, ?, ?, 'passed', ?)
                """,
                (run_id, version["id"], target_case["id"], session["caseDefinitionHash"], timestamp),
            )

        platform.finalize_external_import_run(run_id, "passed", report_path)

        result = platform.get_test_case_import(preview["id"])
        with platform.get_db() as conn:
            active = platform.active_script_binding_for_case(conn, target_case["id"])
            version_status = conn.execute(
                "SELECT status FROM test_script_versions WHERE id = ?",
                (version["id"],),
            ).fetchone()["status"]
            deliverable_count = conn.execute(
                "SELECT COUNT(*) AS total FROM deliverables WHERE run_id = ?",
                (run_id,),
            ).fetchone()["total"]

        self.assertEqual(active, {})
        self.assertNotEqual(version_status, "active")
        self.assertNotEqual(result["status"], "verified")
        self.assertEqual(deliverable_count, 0)

    def test_committed_import_can_start_verification_later(self):
        preview, committed = self.preview_and_commit()
        fake_work_item = {"id": committed["workItemId"], "latestRunId": "CODEXLATER0901"}
        with patch.object(platform, "run_work_item", AsyncMock(return_value=fake_work_item)) as run_mock:
            result = asyncio.run(
                platform.commit_test_case_import(
                    preview["id"],
                    TestCaseImportCommitRequest(
                        project_id=self.project["id"],
                        environment_id=self.environment_id,
                        verify=True,
                    ),
                )
            )
        self.assertEqual(result["workItem"], fake_work_item)
        run_mock.assert_awaited_once()


class EnvironmentDiscoveryTests(unittest.TestCase):
    def test_indirect_required_credential_calls_are_detected(self):
        source = """
function requiredCredential(name: string): string {
  return process.env[name] || '';
}
const username = requiredCredential('QA_USERNAME');
const password = requiredCredential('QA_PASSWORD');
"""
        self.assertEqual(required_environment_names(source), ["QA_PASSWORD", "QA_USERNAME"])

    def test_missing_multipart_returns_structured_503_before_reading_form(self):
        request = FakeMultipartRequest("project", CASES_PATH, SPEC_PATH)
        with patch.object(platform.starlette_formparsers, "multipart", None):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(platform.preview_test_case_import(request))
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail["code"], "missing-python-multipart")
        self.assertIn("完整重启服务", raised.exception.detail["message"])

    def test_health_reports_import_preview_capability(self):
        capability = platform.multipart_form_capability()
        self.assertTrue(capability["ready"])
        self.assertEqual(capability["dependency"], "python-multipart")


class PlaywrightResultParsingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="CODEX_TEST_RESULT_PARSE_20260901_")
        self.root = Path(self.temp.name)
        self.patch = patch.object(platform, "EXECUTION_CONFIG_DIR", self.root)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def write_results(self, run_id: str, specs: list[dict]):
        result_dir = self.root / run_id
        result_dir.mkdir(parents=True, exist_ok=True)
        (result_dir / "results.json").write_text(
            json.dumps({"suites": [{"title": "root", "specs": specs}]}),
            encoding="utf-8",
        )

    def test_result_parser_uses_final_retry_status_per_test_title(self):
        self.write_results("retry-pass", [
            {
                "title": "TC-CODEX-RESULT-001 最终通过",
                "file": "/tmp/shared.spec.ts",
                "tests": [{"results": [{"status": "failed"}, {"status": "passed"}]}],
            },
            {
                "title": "TC-CODEX-RESULT-002 最终失败",
                "file": "/tmp/shared.spec.ts",
                "tests": [{"results": [{"status": "timedOut"}]}],
            },
        ])

        statuses = platform.playwright_case_statuses("retry-pass")

        self.assertEqual(statuses[("shared.spec.ts", "TC-CODEX-RESULT-001 最终通过")], "passed")
        self.assertEqual(statuses[("shared.spec.ts", "TC-CODEX-RESULT-002 最终失败")], "failed")

    def test_result_parser_marks_duplicate_file_and_title_as_unknown(self):
        duplicate = {
            "title": "TC-CODEX-RESULT-003 重复标题",
            "file": "/tmp/shared.spec.ts",
            "tests": [{"results": [{"status": "passed"}]}],
        }
        self.write_results("duplicate-title", [duplicate, duplicate])

        statuses = platform.playwright_case_statuses("duplicate-title")

        self.assertEqual(statuses[("shared.spec.ts", "TC-CODEX-RESULT-003 重复标题")], "unknown")


class PlaywrightDependencyAnalysisTests(unittest.TestCase):
    def analyze(self, source: str, rows: list[tuple[str, str]]) -> dict:
        tests = []
        bindings = []
        for external_id, title in rows:
            line = next(index for index, value in enumerate(source.splitlines(), start=1) if title in value)
            tests.append({"title": title, "fullTitle": title, "file": "sample.spec.ts", "line": line, "column": 1})
            bindings.append({"externalId": external_id, "testTitle": title, "line": line})
        return analyze_playwright_dependencies(source, tests, bindings)

    def test_before_each_helpers_and_loops_remain_independent(self):
        source = """import { test } from '@playwright/test';
const rows = [{ id: 'TC-DEP-002', title: '循环用例' }];
async function login(page) { await page.goto('/login'); }
test.beforeEach(async ({ page }) => { await login(page); });
test('TC-DEP-001 独立用例', async () => {});
for (const row of rows) {
  test(`${row.id} ${row.title}`, async () => {});
}
"""
        analysis = self.analyze(source, [("TC-DEP-001", "TC-DEP-001 独立用例"), ("TC-DEP-002", "`${row.id} ${row.title}`")])
        self.assertEqual(analysis["status"], "independent")
        self.assertTrue(all(item["recommendation"] == "single" for item in analysis["cases"].values()))

    def test_nested_serial_uses_smallest_describe_group(self):
        source = """import { test } from '@playwright/test';
test('TC-DEP-001 外部用例', async () => {});
test.describe('串行组', () => {
  test.describe.configure({ mode: 'serial' });
  test('TC-DEP-002 前置', async () => {});
  test('TC-DEP-003 目标', async () => {});
});
"""
        rows = [("TC-DEP-001", "TC-DEP-001 外部用例"), ("TC-DEP-002", "TC-DEP-002 前置"), ("TC-DEP-003", "TC-DEP-003 目标")]
        analysis = self.analyze(source, rows)
        self.assertEqual(analysis["cases"]["TC-DEP-001"]["recommendation"], "single")
        self.assertEqual(analysis["cases"]["TC-DEP-003"]["recommendation"], "group")
        self.assertEqual(set(analysis["cases"]["TC-DEP-003"]["externalIds"]), {"TC-DEP-002", "TC-DEP-003"})

    def test_before_all_and_mutable_state_are_classified_conservatively(self):
        before_all = """import { test } from '@playwright/test';
test.beforeAll(async () => {});
test('TC-DEP-001 第一条', async () => {});
test('TC-DEP-002 第二条', async () => {});
"""
        grouped = self.analyze(before_all, [("TC-DEP-001", "TC-DEP-001 第一条"), ("TC-DEP-002", "TC-DEP-002 第二条")])
        self.assertTrue(all(item["recommendation"] == "group" for item in grouped["cases"].values()))

        mutable = """import { test } from '@playwright/test';
let sharedId = '';
test('TC-DEP-001 第一条', async () => { sharedId = 'created'; });
test('TC-DEP-002 第二条', async () => { console.log(sharedId); });
"""
        review = self.analyze(mutable, [("TC-DEP-001", "TC-DEP-001 第一条"), ("TC-DEP-002", "TC-DEP-002 第二条")])
        self.assertEqual(review["status"], "review-required")
        self.assertTrue(all(item["manualChoiceRequired"] for item in review["cases"].values()))

if __name__ == "__main__":
    unittest.main()
