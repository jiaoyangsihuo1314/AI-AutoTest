import json
import tempfile
import unittest
from pathlib import Path

from backend.app import platform
from backend.app.schemas.models import FeatureMenuRequest, ProjectRequest, WorkItemRequest


class AutomationFlowTerminalReportTests(unittest.TestCase):
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
        platform.DB_PATH = self.root / "terminal-reports.sqlite"
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

        marker = "CODEX_TEST_20260820_TERMINAL_REPORT"
        self.project = platform.create_project(
            ProjectRequest(name=marker, project_code="CODEX-TERMINAL-REPORT")
        )
        self.feature = platform.create_feature_menu(
            FeatureMenuRequest(project_id=self.project["id"], name=f"{marker} feature")
        )

    def tearDown(self):
        for name, value in self.original_paths.items():
            setattr(platform, name, value)
        self.temp_dir.cleanup()

    def create_work_item(self, suffix: str):
        return platform.create_work_item(
            WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                title=f"CODEX_TEST {suffix}",
                requirement=f"CODEX_TEST {suffix} requirement",
                target_url="https://example.test",
            )
        )

    def insert_flow(
        self,
        flow_id: str,
        work_item_id: str,
        *,
        status: str = "running",
        stage: str = "页面探索",
        latest_run_id: str = "",
        error: str = "",
    ) -> None:
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO automation_flow_runs (
                    id, work_item_id, feature_id, status, stage, progress,
                    current_attempt, latest_run_id, asset_mode, case_ids_json,
                    error, started_at, ended_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'create', '[]', ?, ?, ?)
                """,
                (
                    flow_id,
                    work_item_id,
                    self.feature["id"] if work_item_id else "",
                    status,
                    stage,
                    100 if status in {"completed", "failed", "blocked", "cancelled"} else 40,
                    latest_run_id,
                    error,
                    platform.now_iso(),
                    platform.now_iso() if status in {"completed", "failed", "blocked", "cancelled"} else None,
                ),
            )

    def report_count(self, flow_id: str) -> int:
        with platform.get_db() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM report_records WHERE automation_flow_run_id = ?",
                (flow_id,),
            ).fetchone()[0]

    def test_pre_execution_terminal_states_create_only_manual_report(self):
        scenarios = (
            ("blocked", platform.block_automation_flow, "用例设计"),
            ("failed", platform.fail_automation_flow, "页面探索"),
        )
        for status, terminalize, stage in scenarios:
            with self.subTest(status=status):
                item = self.create_work_item(status)
                flow_id = f"CODEX_TEST_FLOW_{status.upper()}"
                self.insert_flow(flow_id, item["id"], stage=stage)
                terminalize(flow_id, stage, f"CODEX_TEST {status} reason")

                flow = platform.get_automation_flow_payload(flow_id)
                artifact_types = [artifact["artifactType"] for artifact in flow["flowArtifacts"]]
                self.assertEqual(flow["status"], status)
                self.assertTrue(platform.resolve_workspace_path(flow["reportPath"]).is_file())
                self.assertEqual(flow["htmlReportPath"], "")
                self.assertEqual(artifact_types.count("manual-report"), 1)
                self.assertNotIn("html-report", artifact_types)
                self.assertEqual(self.report_count(flow_id), 1)

                platform.ensure_automation_flow_terminal_reports(flow_id)
                self.assertEqual(self.report_count(flow_id), 1)

    def test_cancelled_flow_creates_manual_report(self):
        item = self.create_work_item("cancelled")
        flow_id = "CODEX_TEST_FLOW_CANCELLED"
        self.insert_flow(flow_id, item["id"], stage="脚本实现")

        platform.cancel_automation_flow_record(flow_id, "CODEX_TEST user cancelled")

        flow = platform.get_automation_flow_payload(flow_id)
        self.assertEqual(flow["status"], "cancelled")
        self.assertTrue(platform.resolve_workspace_path(flow["reportPath"]).is_file())
        self.assertEqual(flow["htmlReportPath"], "")
        self.assertEqual(self.report_count(flow_id), 1)

    def test_run_without_playwright_file_gets_fallback_html_report(self):
        item = self.create_work_item("run-failed")
        flow_id = "CODEX_TEST_FLOW_RUN_FAILED"
        run_id = "CODEX_TEST_RUN_FAILED"
        report_path = platform.run_html_report_index(run_id)
        timestamp = platform.now_iso()
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label,
                    progress, started_at, ended_at, exit_code, report_path,
                    screenshot_path, work_item_id
                ) VALUES (?, 'suite', 'suite', 'spec.ts', 'failed', 'complete',
                          '服务重启中断', 100, ?, ?, 1, ?, '', ?)
                """,
                (run_id, timestamp, timestamp, platform.relative_or_absolute(report_path), item["id"]),
            )
        self.insert_flow(flow_id, item["id"], stage="运行验证", latest_run_id=run_id)

        platform.fail_automation_flow(flow_id, "运行验证", "CODEX_TEST execution failed")

        flow = platform.get_automation_flow_payload(flow_id)
        artifact_by_type = {artifact["artifactType"]: artifact for artifact in flow["flowArtifacts"]}
        html_path = platform.resolve_workspace_path(flow["htmlReportPath"])
        self.assertTrue(html_path.is_file())
        self.assertIn("执行中断报告", html_path.read_text(encoding="utf-8"))
        self.assertEqual(artifact_by_type["html-report"]["source"], "system")
        self.assertEqual(self.report_count(flow_id), 1)

    def test_restart_recovery_is_idempotent(self):
        item = self.create_work_item("restart")
        flow_id = "CODEX_TEST_FLOW_RESTART"
        self.insert_flow(flow_id, item["id"], stage="页面探索")

        platform.init_db()
        self.assertEqual(platform.recover_interrupted_automation_flow_reports(), 1)
        first = platform.get_automation_flow_payload(flow_id)
        self.assertEqual(first["status"], "failed")
        self.assertTrue(platform.resolve_workspace_path(first["reportPath"]).is_file())
        self.assertEqual(first["htmlReportPath"], "")

        self.assertEqual(platform.recover_interrupted_automation_flow_reports(), 1)
        second = platform.get_automation_flow_payload(flow_id)
        self.assertEqual(self.report_count(flow_id), 1)
        self.assertEqual(
            [artifact["artifactType"] for artifact in second["flowArtifacts"]].count("manual-report"),
            1,
        )

    def test_completed_flow_reuses_existing_reports(self):
        item = self.create_work_item("completed")
        flow_id = "CODEX_TEST_FLOW_COMPLETED"
        run_id = "CODEX_TEST_RUN_COMPLETED"
        timestamp = platform.now_iso()
        html_path = platform.run_html_report_index(run_id)
        html_path.parent.mkdir(parents=True, exist_ok=True)
        html_path.write_text("<html>CODEX_TEST playwright report</html>", encoding="utf-8")
        manual_path = platform.FLOW_RUN_ARTIFACT_DIR / flow_id / "final-report.md"
        manual_path.parent.mkdir(parents=True, exist_ok=True)
        manual_path.write_text("# CODEX_TEST final report", encoding="utf-8")
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label,
                    progress, started_at, ended_at, exit_code, report_path,
                    screenshot_path, work_item_id
                ) VALUES (?, 'suite', 'suite', 'spec.ts', 'passed', 'complete',
                          '完成', 100, ?, ?, 0, ?, '', ?)
                """,
                (run_id, timestamp, timestamp, platform.relative_or_absolute(html_path), item["id"]),
            )
            item_row = conn.execute("SELECT * FROM work_items WHERE id = ?", (item["id"],)).fetchone()
            run_row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
            platform.create_work_item_summary_report(
                conn,
                item_row,
                run_row,
                manual_path.read_text(encoding="utf-8"),
                manual_path,
                automation_flow_run_id=flow_id,
            )
        self.insert_flow(
            flow_id,
            item["id"],
            status="completed",
            stage="保存已验证产物",
            latest_run_id=run_id,
        )

        platform.ensure_automation_flow_terminal_reports(flow_id)
        platform.ensure_automation_flow_terminal_reports(flow_id)

        flow = platform.get_automation_flow_payload(flow_id)
        self.assertEqual(flow["reportPath"], platform.relative_or_absolute(manual_path))
        self.assertEqual(flow["htmlReportPath"], platform.relative_or_absolute(html_path))
        self.assertEqual(flow["outcome"], {})
        self.assertEqual(flow["dataResolution"], {})
        self.assertEqual(self.report_count(flow_id), 1)
        self.assertFalse((platform.FLOW_RUN_ARTIFACT_DIR / flow_id / "terminal-report.md").exists())

    def test_flow_payload_and_history_return_partial_outcome(self):
        item = self.create_work_item("partial-outcome")
        flow_id = "CODEX_TEST_FLOW_PARTIAL_OUTCOME"
        outcome = {
            "mode": "partial",
            "caseResults": [{
                "caseId": "case-p0",
                "externalId": "TC-CODEX-P0",
                "priority": "P0",
                "status": "passed",
                "reason": "Playwright 真实执行通过",
                "runId": "run-partial",
            }],
            "counts": {"total": 1, "passed": 1, "failed": 0, "blocked": 0, "notRun": 0, "p0Passed": 1},
            "passedP0CaseIds": ["TC-CODEX-P0"],
            "hasP0Passed": True,
            "warnings": ["CODEX_TEST 部分完成"],
            "manualWorkbenchRecommended": True,
        }
        self.insert_flow(flow_id, item["id"], status="completed", stage="保存已验证产物")
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE automation_flow_runs SET outcome_json = ? WHERE id = ?",
                (json.dumps(outcome, ensure_ascii=False), flow_id),
            )

        self.assertEqual(platform.get_automation_flow_payload(flow_id)["outcome"], outcome)
        summary = next(item for item in platform.list_automation_flows() if item["id"] == flow_id)
        self.assertEqual(summary["outcome"], outcome)

    def test_empty_requirement_flow_does_not_create_report(self):
        flow_id = "CODEX_TEST_FLOW_EMPTY_REQUIREMENT"
        self.insert_flow(
            flow_id,
            "",
            status="blocked",
            stage="需求分析",
            error="阻塞：需求文本为空",
        )

        self.assertEqual(platform.ensure_automation_flow_terminal_reports(flow_id), {})
        self.assertEqual(self.report_count(flow_id), 0)
        self.assertFalse((platform.FLOW_RUN_ARTIFACT_DIR / flow_id).exists())


if __name__ == "__main__":
    unittest.main()
