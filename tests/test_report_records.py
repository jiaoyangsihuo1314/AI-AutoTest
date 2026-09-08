import base64
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from backend.app import platform


class ReportRecordTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.original_paths = {
            name: getattr(platform, name)
            for name in (
                "DB_PATH",
                "ROOT_DIR",
                "ARTIFACT_DIR",
                "PROJECT_ARTIFACT_DIR",
                "FLOW_RUN_ARTIFACT_DIR",
                "SCREENSHOT_PATH",
                "REPORT_INDEX",
                "PLAYWRIGHT_REPORT_ARCHIVE_DIR",
                "DISCOVERY_DIR",
                "EXECUTION_LIVE_DIR",
                "WORK_ITEM_DRAFT_DIR",
                "EXECUTION_CONFIG_DIR",
            )
        }
        platform.DB_PATH = self.root / "report-records.sqlite"
        platform.ROOT_DIR = self.root
        platform.ARTIFACT_DIR = self.root / "artifacts" / "automation-platform"
        platform.PROJECT_ARTIFACT_DIR = self.root / "artifacts" / "projects"
        platform.FLOW_RUN_ARTIFACT_DIR = platform.ARTIFACT_DIR / "flow-runs"
        platform.SCREENSHOT_PATH = platform.ARTIFACT_DIR / "browser-preview.svg"
        platform.REPORT_INDEX = self.root / "playwright-report" / "index.html"
        platform.PLAYWRIGHT_REPORT_ARCHIVE_DIR = platform.ARTIFACT_DIR / "playwright-reports"
        platform.DISCOVERY_DIR = platform.ARTIFACT_DIR / "discovery"
        platform.EXECUTION_LIVE_DIR = self.root / "tests" / "e2e" / ".live-runs"
        platform.WORK_ITEM_DRAFT_DIR = self.root / "tests" / "e2e" / ".draft-runs"
        platform.EXECUTION_CONFIG_DIR = self.root / "tests" / "e2e" / ".execution-configs"
        platform.init_db()
        marker = "CODEX_TEST_20260813_REPORT_LEDGER"
        self.project = platform.create_project(
            platform.ProjectRequest(name=marker, project_code="PRJ-CODEX-REPORT-LEDGER")
        )
        self.feature = platform.create_feature_menu(
            platform.FeatureMenuRequest(
                project_id=self.project["id"],
                name=f"{marker} feature",
            )
        )
        self.work_item = platform.create_work_item(
            platform.WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                title=f"{marker} work item",
                requirement=f"{marker} requirement",
            )
        )
        self.case = platform.create_test_case(
            platform.TestCaseRequest(
                project_id=self.project["id"],
                work_item_id=self.work_item["id"],
                feature_id=self.feature["id"],
                external_id="TC-CODEX-REPORT-LEDGER-001",
                title=f"{marker} case",
                priority="P0",
                steps="打开页面",
                expected="页面可见",
            )
        )

    def tearDown(self):
        for name, value in self.original_paths.items():
            setattr(platform, name, value)
        self.temp_dir.cleanup()

    def create_run_report(self, run_id: str, status: str = "passed", report_path: Path | None = None) -> str:
        timestamp = platform.now_iso()
        target = report_path or (platform.PLAYWRIGHT_REPORT_ARCHIVE_DIR / "runs" / run_id / "index.html")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"<html>{run_id}</html>", encoding="utf-8")
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                    started_at, ended_at, exit_code, report_path, screenshot_path, work_item_id
                ) VALUES (?, 'suite', 'suite', 'spec.ts', ?, 'complete', '完成', 100, ?, ?, 0, ?, '', ?)
                """,
                (run_id, status, timestamp, timestamp, platform.relative_or_absolute(target), self.work_item["id"]),
            )
            case_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (self.case["id"],)).fetchone()
            report_id = platform.ensure_case_execution_report(
                conn,
                case_row,
                run_id=run_id,
                status=status,
                started_at=timestamp,
            )
        platform.update_case_execution_reports_for_run(run_id, status, report_path=target)
        return report_id

    def write_playwright_report(self, target: Path, tests: list[dict]) -> None:
        file_id = "file-codex-report"
        summaries = []
        details = []
        for item in tests:
            outcome = item.get("outcome", "expected")
            result_status = "passed" if outcome == "expected" else "failed" if outcome == "unexpected" else "skipped"
            summary = {
                "testId": item["testId"],
                "title": item["title"],
                "projectName": "chromium",
                "location": {"file": item.get("file", "tests/codex-report.spec.ts"), "line": 1, "column": 1},
                "duration": item.get("duration", 25),
                "annotations": [],
                "tags": [],
                "outcome": outcome,
                "path": [],
                "ok": outcome == "expected",
                "results": [{"attachments": [], "startTime": "2026-08-20T01:00:00.000Z", "workerIndex": 0}],
            }
            summaries.append(summary)
            details.append({
                **summary,
                "results": [{
                    "id": f"result-{item['testId']}",
                    "retry": 0,
                    "workerIndex": 0,
                    "parallelIndex": 0,
                    "startTime": "2026-08-20T01:00:00.000Z",
                    "duration": item.get("duration", 25),
                    "status": result_status,
                    "errors": [],
                    "attachments": [],
                    "steps": [{"title": f"STEP {item['testId']}", "duration": 10, "steps": []}],
                }],
            })
        stats = {
            "total": len(summaries),
            "expected": sum(item["outcome"] == "expected" for item in summaries),
            "unexpected": sum(item["outcome"] == "unexpected" for item in summaries),
            "flaky": 0,
            "skipped": sum(item["outcome"] == "skipped" for item in summaries),
            "ok": all(item["outcome"] in {"expected", "skipped"} for item in summaries),
        }
        report = {
            "metadata": {},
            "startTime": 1787187600000,
            "duration": sum(item["duration"] for item in summaries),
            "files": [{
                "fileId": file_id,
                "fileName": "tests/codex-report.spec.ts",
                "tests": summaries,
                "stats": stats,
            }],
            "projectNames": ["chromium"],
            "stats": stats,
            "errors": [],
            "options": {},
            "machines": [],
        }
        detail = {"fileId": file_id, "fileName": "tests/codex-report.spec.ts", "tests": details}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("report.json", json.dumps(report))
            archive.writestr(f"{file_id}.json", json.dumps(detail))
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            "<!doctype html><html><head><title>Playwright Test Report</title></head>"
            "<body><div id=\"root\"></div>"
            f"<template id=\"playwrightReportBase64\">data:application/zip;base64,{encoded}</template>"
            "</body></html>",
            encoding="utf-8",
        )

    def create_batch_report(self, run_id: str, tests: list[dict], status: str = "passed") -> tuple[Path, str, str, dict]:
        second_case = platform.create_test_case(
            platform.TestCaseRequest(
                project_id=self.project["id"],
                work_item_id=self.work_item["id"],
                feature_id=self.feature["id"],
                external_id="TC-CODEX-REPORT-LEDGER-002",
                title="CODEX_TEST second isolated case",
                priority="P1",
                steps="打开第二个页面",
                expected="第二个页面可见",
            )
        )
        target = platform.PLAYWRIGHT_REPORT_ARCHIVE_DIR / "runs" / run_id / "index.html"
        self.write_playwright_report(target, tests)
        timestamp = platform.now_iso()
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                    started_at, ended_at, exit_code, report_path, screenshot_path, work_item_id
                ) VALUES (?, 'suite', 'suite', 'spec.ts', ?, 'complete', '完成', 100, ?, ?, 0, ?, '', ?)
                """,
                (run_id, status, timestamp, timestamp, platform.relative_or_absolute(target), self.work_item["id"]),
            )
            first_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (self.case["id"],)).fetchone()
            second_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (second_case["id"],)).fetchone()
            first_id = platform.ensure_case_execution_report(conn, first_row, run_id=run_id, status=status, started_at=timestamp)
            second_id = platform.ensure_case_execution_report(conn, second_row, run_id=run_id, status=status, started_at=timestamp)
        platform.update_case_execution_reports_for_run(run_id, status, report_path=target)
        return target, first_id, second_id, second_case

    def embedded_report_payload(self, target: Path) -> tuple[dict, dict]:
        bundle = platform.read_playwright_report_bundle(target)
        self.assertIsNotNone(bundle)
        _, _, entries, report = bundle
        file_id = report["files"][0]["fileId"]
        return report, json.loads(entries[f"{file_id}.json"].decode("utf-8"))

    def test_case_report_snapshot_survives_case_update_and_delete(self):
        report_id = self.create_run_report("run-codex-ledger-snapshot")

        platform.update_test_case(
            self.case["id"],
            platform.TestCasePatchRequest(title="CODEX_TEST changed title", steps="changed steps"),
        )
        changed = platform.report_record_detail(report_id)
        self.assertEqual(changed["case"]["title"], self.case["title"])
        self.assertTrue(changed["currentCaseChanged"])
        self.assertFalse(changed["sourceCaseDeleted"])

        platform.delete_test_case(self.case["id"])
        deleted = platform.report_record_detail(report_id)
        self.assertEqual(deleted["case"]["externalId"], "TC-CODEX-REPORT-LEDGER-001")
        self.assertTrue(deleted["sourceCaseDeleted"])
        self.assertEqual(platform.case_reports()["total"], 1)

    def test_case_report_list_returns_latest_and_history(self):
        first_id = self.create_run_report("run-codex-ledger-first", "failed")
        second_id = self.create_run_report("run-codex-ledger-second", "passed")

        listing = platform.case_reports()
        self.assertEqual(listing["total"], 1)
        self.assertEqual(listing["items"][0]["reportId"], second_id)
        self.assertEqual(listing["items"][0]["historyCount"], 2)
        history = platform.case_report_history(self.case["id"])
        self.assertEqual([item["id"] for item in history["items"]], [second_id, first_id])

    def test_case_report_renders_isolated_native_playwright_bundle(self):
        first_title = f"{self.case['externalId']} {self.case['title']}"
        second_title = "TC-CODEX-REPORT-LEDGER-002 CODEX_TEST second isolated case"
        source, first_id, second_id, _ = self.create_batch_report(
            "run-codex-isolated-report",
            [
                {"testId": "test-codex-first", "title": first_title, "outcome": "expected"},
                {"testId": "test-codex-second", "title": second_title, "outcome": "unexpected"},
            ],
            status="failed",
        )

        first_response = platform.rendered_report_record(first_id)
        second_response = platform.rendered_report_record(second_id)
        self.assertEqual(first_response.status_code, 307)
        self.assertEqual(second_response.status_code, 307)

        first_artifact = next(item for item in platform.report_record_detail(first_id)["artifacts"] if item["type"] == "case-html-report")
        second_artifact = next(item for item in platform.report_record_detail(second_id)["artifacts"] if item["type"] == "case-html-report")
        first_path = platform.resolve_workspace_path(first_artifact["filePath"])
        second_path = platform.resolve_workspace_path(second_artifact["filePath"])
        first_report, first_detail = self.embedded_report_payload(first_path)
        second_report, second_detail = self.embedded_report_payload(second_path)

        self.assertEqual(first_report["stats"]["total"], 1)
        self.assertEqual(first_report["files"][0]["tests"][0]["testId"], "test-codex-first")
        self.assertEqual(first_detail["tests"][0]["results"][0]["steps"][0]["title"], "STEP test-codex-first")
        self.assertNotIn("test-codex-second", first_path.read_text(encoding="utf-8"))
        self.assertEqual(second_report["stats"]["total"], 1)
        self.assertEqual(second_detail["tests"][0]["testId"], "test-codex-second")
        self.assertNotIn("test-codex-first", second_path.read_text(encoding="utf-8"))
        self.assertIn("data-case-report-bootstrap", first_path.read_text(encoding="utf-8"))

        platform.bulk_delete_report_records(platform.ReportRecordBulkDeleteRequest(report_ids=[first_id]))
        self.assertTrue(source.exists())
        self.assertTrue(second_path.exists())
        platform.bulk_delete_report_records(platform.ReportRecordBulkDeleteRequest(report_ids=[second_id]))
        self.assertFalse(source.exists())

    def test_case_report_ambiguous_match_falls_back_without_full_run(self):
        duplicated_title = f"{self.case['externalId']} {self.case['title']}"
        source, first_id, _, _ = self.create_batch_report(
            "run-codex-ambiguous-report",
            [
                {"testId": "test-codex-duplicate-a", "title": duplicated_title},
                {"testId": "test-codex-duplicate-b", "title": duplicated_title},
            ],
        )

        response = platform.rendered_report_record(first_id)
        body = response.body.decode("utf-8")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("location", response.headers)
        self.assertIn(self.case["externalId"], body)
        self.assertNotIn("当前执行日志", body)
        self.assertTrue(source.exists())
        self.assertNotIn("case-html-report", {item["type"] for item in platform.report_record_detail(first_id)["artifacts"]})

    def test_active_case_report_refreshes_without_aggregate_logs(self):
        timestamp = platform.now_iso()
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                    started_at, report_path, screenshot_path, work_item_id
                ) VALUES ('run-codex-active-view', 'suite', 'suite', 'spec.ts', 'running', 'execute', '执行脚本', 58, ?, '', '', ?)
                """,
                (timestamp, self.work_item["id"]),
            )
            case_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (self.case["id"],)).fetchone()
            report_id = platform.ensure_case_execution_report(
                conn,
                case_row,
                run_id="run-codex-active-view",
                status="running",
                started_at=timestamp,
            )

        response = platform.rendered_report_record(report_id)
        body = response.body.decode("utf-8")
        self.assertEqual(response.status_code, 200)
        self.assertIn('http-equiv="refresh"', body)
        self.assertIn("58%", body)
        self.assertNotIn("当前执行日志", body)

    def test_summary_versions_are_independent_and_delete_falls_back(self):
        timestamp = platform.now_iso()
        first_path = platform.PROJECT_ARTIFACT_DIR / self.project["slug"] / "report-v1.md"
        second_path = platform.PROJECT_ARTIFACT_DIR / self.project["slug"] / "report-v2.md"
        first_path.parent.mkdir(parents=True, exist_ok=True)
        first_path.write_text("# v1", encoding="utf-8")
        second_path.write_text("# v2", encoding="utf-8")
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                    started_at, ended_at, report_path, screenshot_path, work_item_id
                ) VALUES ('run-summary', 'suite', 'suite', 'spec.ts', 'passed', 'complete', '完成', 100, ?, ?, '', '', ?)
                """,
                (timestamp, timestamp, self.work_item["id"]),
            )
            item = conn.execute("SELECT * FROM work_items WHERE id = ?", (self.work_item["id"],)).fetchone()
            run = conn.execute("SELECT * FROM runs WHERE id = 'run-summary'").fetchone()
            first_id = platform.create_work_item_summary_report(conn, item, run, "# v1", first_path)
            second_id = platform.create_work_item_summary_report(conn, item, run, "# v2", second_path)
            conn.execute(
                "UPDATE work_items SET report_path = ? WHERE id = ?",
                (platform.relative_or_absolute(second_path), self.work_item["id"]),
            )

        history = platform.manual_report_history(self.work_item["id"])
        self.assertEqual([item["version"] for item in history["items"]], [2, 1])
        platform.bulk_delete_report_records(platform.ReportRecordBulkDeleteRequest(report_ids=[second_id]))
        with platform.get_db() as conn:
            work_item = conn.execute("SELECT report_path FROM work_items WHERE id = ?", (self.work_item["id"],)).fetchone()
        self.assertEqual(work_item["report_path"], platform.relative_or_absolute(first_path))
        self.assertTrue(first_path.exists())
        self.assertFalse(second_path.exists())
        self.assertEqual(platform.report_record_detail(first_id)["content"], "# v1")

    def test_failure_summary_records_reason_and_evidence(self):
        timestamp = platform.now_iso()
        failure_path = platform.PROJECT_ARTIFACT_DIR / self.project["slug"] / "failure.md"
        html_path = platform.PLAYWRIGHT_REPORT_ARCHIVE_DIR / "runs" / "run-failure" / "index.html"
        failure_path.parent.mkdir(parents=True, exist_ok=True)
        html_path.parent.mkdir(parents=True, exist_ok=True)
        failure_path.write_text("# failure", encoding="utf-8")
        html_path.write_text("<html>failure</html>", encoding="utf-8")
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label, progress,
                    started_at, ended_at, report_path, screenshot_path, work_item_id
                ) VALUES ('run-failure', 'suite', 'suite', 'spec.ts', 'failed', 'complete', '完成', 100, ?, ?, ?, '', ?)
                """,
                (timestamp, timestamp, platform.relative_or_absolute(html_path), self.work_item["id"]),
            )
            item = conn.execute("SELECT * FROM work_items WHERE id = ?", (self.work_item["id"],)).fetchone()
            run = conn.execute("SELECT * FROM runs WHERE id = 'run-failure'").fetchone()
            report_id = platform.create_work_item_summary_report(
                conn,
                item,
                run,
                "# failure",
                failure_path,
                name="CODEX_TEST 自愈失败诊断",
                status="failed",
                failure_reason="三轮测试侧自愈后仍失败",
                html_report_path=html_path,
            )

        record = platform.report_record_detail(report_id)
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failureReason"], "三轮测试侧自愈后仍失败")
        self.assertEqual({item["type"] for item in record["artifacts"]}, {"markdown", "html-report"})

    def test_shared_artifact_is_removed_only_after_last_report(self):
        shared_path = platform.PLAYWRIGHT_REPORT_ARCHIVE_DIR / "runs" / "shared-run" / "index.html"
        first_id = self.create_run_report("shared-run", report_path=shared_path)
        with platform.get_db() as conn:
            case_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (self.case["id"],)).fetchone()
            second_id = platform.ensure_case_execution_report(conn, case_row, run_id="shared-run-2", status="passed")
            platform.add_report_artifact(conn, second_id, "html-report", shared_path)

        platform.bulk_delete_report_records(platform.ReportRecordBulkDeleteRequest(report_ids=[first_id]))
        self.assertTrue(shared_path.exists())
        platform.bulk_delete_report_records(platform.ReportRecordBulkDeleteRequest(report_ids=[second_id]))
        self.assertFalse(shared_path.exists())

    def test_delete_report_keeps_run_and_logs(self):
        report_id = self.create_run_report("run-codex-ledger-keep-run")
        with platform.get_db() as conn:
            conn.execute(
                "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'info', ?)",
                ("run-codex-ledger-keep-run", platform.now_iso(), "CODEX_TEST keep this log"),
            )

        platform.bulk_delete_report_records(platform.ReportRecordBulkDeleteRequest(report_ids=[report_id]))

        with platform.get_db() as conn:
            run = conn.execute("SELECT * FROM runs WHERE id = 'run-codex-ledger-keep-run'").fetchone()
            log_count = conn.execute(
                "SELECT COUNT(*) AS total FROM logs WHERE run_id = 'run-codex-ledger-keep-run'"
            ).fetchone()["total"]
        self.assertIsNotNone(run)
        self.assertEqual(run["report_path"], "")
        self.assertEqual(log_count, 1)

    def test_skipped_case_report_preserves_reason(self):
        with platform.get_db() as conn:
            case_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (self.case["id"],)).fetchone()
            report_id = platform.ensure_case_execution_report(
                conn,
                case_row,
                suite_run_id="suite-run-codex-skipped",
                status="skipped",
                started_at=platform.now_iso(),
            )
            conn.execute(
                """
                UPDATE report_records
                SET status = 'skipped', failure_reason = ?, ended_at = ?, updated_at = ?
                WHERE id = ?
                """,
                ("用例尚未绑定可执行 spec", platform.now_iso(), platform.now_iso(), report_id),
            )

        record = platform.report_record_detail(report_id)
        self.assertEqual(record["status"], "skipped")
        self.assertEqual(record["failureReason"], "用例尚未绑定可执行 spec")

    def test_reports_block_project_delete_and_execution_clear(self):
        self.create_run_report("run-codex-ledger-guard")

        with self.assertRaises(platform.HTTPException) as project_error:
            platform.delete_project(self.project["id"], cascade=True)
        self.assertEqual(project_error.exception.status_code, 409)
        self.assertEqual(project_error.exception.detail["blockingReports"], 1)

        with self.assertRaises(platform.HTTPException) as clear_error:
            platform.clear_work_item_page_data(
                self.work_item["id"],
                platform.ClearPageDataRequest(page="execution"),
            )
        self.assertEqual(clear_error.exception.status_code, 409)
        self.assertEqual(clear_error.exception.detail["blockingReports"], 1)

    def test_active_report_cannot_be_deleted(self):
        with platform.get_db() as conn:
            case_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (self.case["id"],)).fetchone()
            report_id = platform.ensure_case_execution_report(
                conn,
                case_row,
                run_id="run-codex-active-report",
                status="running",
                started_at=platform.now_iso(),
            )

        with self.assertRaises(platform.HTTPException) as error:
            platform.bulk_delete_report_records(platform.ReportRecordBulkDeleteRequest(report_ids=[report_id]))
        self.assertEqual(error.exception.status_code, 409)
        self.assertIsNotNone(platform.report_record_detail(report_id))


if __name__ == "__main__":
    unittest.main()
