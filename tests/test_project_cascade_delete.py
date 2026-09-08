import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import platform


class ProjectCascadeDeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.original_paths = {
            name: getattr(platform, name)
            for name in (
                "DB_PATH",
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
        platform.DB_PATH = self.root / "automation-platform.sqlite"
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
        platform.BROWSER_RUNTIMES.clear()
        platform.AUTOMATION_FLOW_TASKS.clear()
        platform.EXPLORATION_RUN_TASKS.clear()
        platform.HEALING_RUN_TASKS.clear()
        platform.init_db()

    def tearDown(self):
        for name, value in self.original_paths.items():
            setattr(platform, name, value)
        platform.BROWSER_RUNTIMES.clear()
        platform.AUTOMATION_FLOW_TASKS.clear()
        platform.EXPLORATION_RUN_TASKS.clear()
        platform.HEALING_RUN_TASKS.clear()
        self.temp_dir.cleanup()

    def create_project_graph(self, marker: str = "CODEX_TEST_20260806_CASCADE"):
        project = platform.create_project(
            platform.ProjectRequest(name=marker, project_code=f"PRJ-{marker[-8:]}")
        )
        feature = platform.create_feature_menu(
            platform.FeatureMenuRequest(project_id=project["id"], name=f"{marker}-FEATURE")
        )
        work_item = platform.create_work_item(
            platform.WorkItemRequest(
                project_id=project["id"],
                feature_id=feature["id"],
                requirement=f"{marker} requirement",
            )
        )
        case = platform.create_test_case(
            platform.TestCaseRequest(
                project_id=project["id"],
                work_item_id=work_item["id"],
                feature_id=feature["id"],
                external_id=f"TC-{marker[-8:]}",
                title=f"{marker} case",
            )
        )
        timestamp = platform.now_iso()
        ids = {
            "suite": f"suite-{marker[-8:]}",
            "suite_run": f"suite-run-{marker[-8:]}",
            "run": f"run-{marker[-8:]}",
            "exploration": f"explore-{marker[-8:]}",
            "browser": f"browser-{marker[-8:]}",
            "flow": f"flow-{marker[-8:]}",
            "healing": f"heal-{marker[-8:]}",
            "script": f"script-{marker[-8:]}",
            "fixture": f"fixture-{marker[-8:]}",
            "batch": f"batch-{marker[-8:]}",
            "debug": f"debug-{marker[-8:]}",
        }

        project_dir = platform.PROJECT_ARTIFACT_DIR / project["slug"]
        generated_file = project_dir / "deliverables" / "generated.spec.ts"
        generated_file.parent.mkdir(parents=True, exist_ok=True)
        generated_file.write_text("generated", encoding="utf-8")
        source_file = self.root / "repository" / "tests" / "e2e" / "source.spec.ts"
        source_file.parent.mkdir(parents=True, exist_ok=True)
        source_file.write_text("source", encoding="utf-8")
        report_file = platform.PLAYWRIGHT_REPORT_ARCHIVE_DIR / "runs" / ids["run"] / "index.html"
        report_file.parent.mkdir(parents=True, exist_ok=True)
        report_file.write_text("report", encoding="utf-8")
        flow_file = platform.FLOW_RUN_ARTIFACT_DIR / ids["flow"] / "result.json"
        flow_file.parent.mkdir(parents=True, exist_ok=True)
        flow_file.write_text("{}", encoding="utf-8")

        with platform.get_db() as conn:
            conn.execute(
                "INSERT INTO test_suites (id, project_id, name, description, filter_json, status, created_at, updated_at) VALUES (?, ?, ?, '', '{}', 'active', ?, ?)",
                (ids["suite"], project["id"], f"{marker} suite", timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO test_suite_cases (suite_id, case_id, created_at) VALUES (?, ?, ?)",
                (ids["suite"], case["id"], timestamp),
            )
            conn.execute(
                "INSERT INTO suite_runs (id, suite_id, project_id, name, status, progress, total_cases, passed_cases, failed_cases, skipped_cases, started_at, ended_at, report_path) VALUES (?, ?, ?, ?, 'passed', 100, 1, 1, 0, 0, ?, ?, ?)",
                (
                    ids["suite_run"],
                    ids["suite"],
                    project["id"],
                    f"{marker} suite run",
                    timestamp,
                    timestamp,
                    str(platform.PLAYWRIGHT_REPORT_ARCHIVE_DIR / "suites" / ids["suite_run"] / "index.html"),
                ),
            )
            conn.execute(
                "INSERT INTO runs (id, suite_id, suite_name, spec, status, stage_key, stage_label, progress, started_at, ended_at, report_path, work_item_id) VALUES (?, ?, ?, ?, 'passed', 'completed', '完成', 100, ?, ?, ?, ?)",
                (ids["run"], ids["suite"], f"{marker} suite", str(generated_file), timestamp, timestamp, str(report_file), work_item["id"]),
            )
            conn.execute(
                "INSERT INTO suite_run_cases (suite_run_id, case_id, run_id, status, started_at, ended_at) VALUES (?, ?, ?, 'passed', ?, ?)",
                (ids["suite_run"], case["id"], ids["run"], timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'INFO', ?)",
                (ids["run"], timestamp, marker),
            )
            conn.execute(
                "INSERT INTO test_fixture_versions (id, project_id, work_item_id, version, status, file_path, content, content_hash, created_at, updated_at) VALUES (?, ?, ?, 1, 'draft', ?, 'fixture', 'hash', ?, ?)",
                (ids["fixture"], project["id"], work_item["id"], str(project_dir / "fixture.ts"), timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO script_generation_batches (id, project_id, work_item_id, fixture_version_id, asset_mode, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'create', 'workflow', 'ready', ?, ?)",
                (ids["batch"], project["id"], work_item["id"], ids["fixture"], timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO test_script_versions (id, project_id, work_item_id, version, status, spec_path, content, content_hash, asset_mode, case_ids_json, created_at, updated_at, case_id, generation_batch_id, fixture_version_id) VALUES (?, ?, ?, 1, 'active', ?, 'test', 'hash', 'create', ?, ?, ?, ?, ?, ?)",
                (ids["script"], project["id"], work_item["id"], str(generated_file), f'["{case["id"]}"]', timestamp, timestamp, case["id"], ids["batch"], ids["fixture"]),
            )
            conn.execute(
                "INSERT INTO test_case_script_bindings (id, case_id, script_version_id, external_id, is_active, bound_by_source, bound_at) VALUES (?, ?, ?, ?, 1, 'workflow', ?)",
                (f"binding-{marker[-8:]}", case["id"], ids["script"], case["externalId"], timestamp),
            )
            conn.execute(
                "INSERT INTO run_script_versions (run_id, script_version_id, case_id, created_at, result_status) VALUES (?, ?, ?, ?, 'passed')",
                (ids["run"], ids["script"], case["id"], timestamp),
            )
            conn.execute(
                "INSERT INTO generated_cases (work_item_id, content, asset_mode, case_ids_json, source, created_at) VALUES (?, 'cases', 'create', ?, 'workflow', ?)",
                (work_item["id"], f'["{case["id"]}"]', timestamp),
            )
            conn.execute(
                "INSERT INTO generated_scripts (work_item_id, content, script_version_id, asset_mode, case_ids_json, created_at) VALUES (?, 'script', ?, 'create', ?, ?)",
                (work_item["id"], ids["script"], f'["{case["id"]}"]', timestamp),
            )
            conn.execute(
                "INSERT INTO exploration_runs (id, work_item_id, target_url, status, stage_key, stage_label, progress, started_at, ended_at, screenshot_path, preview_path, current_step_index, max_steps, result_status) VALUES (?, ?, '', 'passed', 'completed', '完成', 100, ?, ?, ?, ?, 1, 1, 'passed')",
                (ids["exploration"], work_item["id"], timestamp, timestamp, str(platform.DISCOVERY_DIR / ids["exploration"] / "shot.png"), str(platform.DISCOVERY_DIR / f'{ids["exploration"]}-live.svg')),
            )
            conn.execute(
                "INSERT INTO exploration_logs (exploration_run_id, created_at, level, message) VALUES (?, ?, 'INFO', ?)",
                (ids["exploration"], timestamp, marker),
            )
            conn.execute(
                "INSERT INTO exploration_steps (exploration_run_id, work_item_id, step_index, action, status, screenshot_path) VALUES (?, ?, 0, 'inspect', 'passed', ?)",
                (ids["exploration"], work_item["id"], str(platform.DISCOVERY_DIR / ids["exploration"] / "step.png")),
            )
            conn.execute(
                "INSERT INTO browser_sessions (id, work_item_id, exploration_run_id, status, viewport_width, viewport_height, target_url, started_at, ended_at) VALUES (?, ?, ?, 'closed', 1440, 900, '', ?, ?)",
                (ids["browser"], work_item["id"], ids["exploration"], timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO confirmed_elements (work_item_id, area, name, locator_type, locator_value, source, confirmed) VALUES (?, 'main', 'button', 'role', 'button', 'test', 1)",
                (work_item["id"],),
            )
            conn.execute(
                "INSERT INTO explorations (work_item_id, notes, screenshot_path, page_structure, created_at) VALUES (?, ?, ?, '{}', ?)",
                (work_item["id"], marker, str(platform.DISCOVERY_DIR / f'{work_item["id"]}-shot.png'), timestamp),
            )
            conn.execute(
                "INSERT INTO automation_flow_runs (id, work_item_id, feature_id, status, stage, progress, current_attempt, latest_run_id, latest_exploration_run_id, started_at, ended_at) VALUES (?, ?, ?, 'completed', 'completed', 100, 1, ?, ?, ?, ?)",
                (ids["flow"], work_item["id"], feature["id"], ids["run"], ids["exploration"], timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO automation_flow_logs (flow_run_id, created_at, stage, level, message, evidence_path, linked_run_id) VALUES (?, ?, 'completed', 'INFO', ?, ?, ?)",
                (ids["flow"], timestamp, marker, str(flow_file), ids["run"]),
            )
            conn.execute(
                "INSERT INTO automation_flow_artifacts (id, flow_run_id, work_item_id, stage, artifact_type, title, status, source, path, created_at, updated_at) VALUES (?, ?, ?, 'completed', 'json', ?, 'ready', 'workflow', ?, ?, ?)",
                (f"flow-artifact-{marker[-8:]}", ids["flow"], work_item["id"], marker, str(flow_file), timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO healing_runs (id, work_item_id, source_run_id, status, current_round, max_rounds, latest_run_id, started_at, ended_at) VALUES (?, ?, ?, 'passed', 1, 3, ?, ?, ?)",
                (ids["healing"], work_item["id"], ids["run"], ids["run"], timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO healing_attempts (work_item_id, healing_run_id, source_run_id, rerun_run_id, script_version_id, round, result, status, created_at, ended_at) VALUES (?, ?, ?, ?, ?, 1, 'passed', 'passed', ?, ?)",
                (work_item["id"], ids["healing"], ids["run"], ids["run"], ids["script"], timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO case_debug_sessions (id, project_id, work_item_id, case_id, case_definition_hash, current_script_version_id, latest_run_id, status, created_at, updated_at, ended_at) VALUES (?, ?, ?, ?, 'hash', ?, ?, 'published', ?, ?, ?)",
                (ids["debug"], project["id"], work_item["id"], case["id"], ids["script"], ids["run"], timestamp, timestamp, timestamp),
            )
            conn.execute(
                "INSERT INTO deleted_test_cases (id, project_id, external_id, previous_case_id, title, deleted_at) VALUES (?, ?, ?, ?, ?, ?)",
                (f"tombstone-{marker[-8:]}", project["id"], f"TC-DELETED-{marker[-8:]}", case["id"], marker, timestamp),
            )
            for index, path in enumerate((generated_file, source_file), start=1):
                conn.execute(
                    "INSERT INTO deliverables (id, project_id, work_item_id, case_id, run_id, feature_id, type, name, status, version, file_path, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'spec', ?, 'ready', 1, ?, ?, ?, ?)",
                    (f"deliverable-{index}-{marker[-8:]}", project["id"], work_item["id"], case["id"], ids["run"], feature["id"], path.name, str(path), marker, timestamp, timestamp),
                )

        return project, work_item, generated_file, source_file, report_file, flow_file, ids

    def test_non_cascade_delete_still_rejects_dependencies(self):
        project, *_ = self.create_project_graph("CODEX_TEST_20260806_GUARD")

        with self.assertRaises(platform.HTTPException) as failure:
            platform.delete_project(project["id"])

        self.assertEqual(failure.exception.status_code, 400)
        self.assertIsNotNone(platform.get_project_row(project["id"]))

    def test_cascade_delete_removes_full_graph_and_preserves_source_file(self):
        project, work_item, generated_file, source_file, report_file, flow_file, ids = self.create_project_graph()

        result = platform.delete_project(project["id"], cascade=True)

        self.assertTrue(result["cascade"])
        self.assertGreater(result["deletedDependencies"]["workItems"], 0)
        self.assertGreater(result["deletedDependencies"]["runs"], 0)
        self.assertEqual(result["fileCleanupWarnings"], [])
        self.assertFalse(generated_file.exists())
        self.assertFalse(report_file.exists())
        self.assertFalse(flow_file.exists())
        self.assertTrue(source_file.exists())
        with platform.get_db() as conn:
            self.assertIsNone(conn.execute("SELECT id FROM projects WHERE id = ?", (project["id"],)).fetchone())
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM work_items WHERE id = ?", (work_item["id"],)).fetchone()["total"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM runs WHERE id = ?", (ids["run"],)).fetchone()["total"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM logs WHERE run_id = ?", (ids["run"],)).fetchone()["total"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM automation_flow_logs WHERE flow_run_id = ?", (ids["flow"],)).fetchone()["total"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM exploration_logs WHERE exploration_run_id = ?", (ids["exploration"],)).fetchone()["total"], 0)
            audit = conn.execute("SELECT metadata_json FROM audit_logs WHERE event_type = 'project_deleted' ORDER BY created_at DESC LIMIT 1").fetchone()
            self.assertIsNotNone(audit)
            self.assertIn('"cascade": true', audit["metadata_json"])

    def test_cascade_delete_rejects_active_run_without_partial_cleanup(self):
        project, _, generated_file, source_file, _, _, ids = self.create_project_graph("CODEX_TEST_20260806_ACTIVE")
        with platform.get_db() as conn:
            conn.execute("UPDATE runs SET status = 'running', ended_at = NULL WHERE id = ?", (ids["run"],))

        with self.assertRaises(platform.HTTPException) as failure:
            platform.delete_project(project["id"], cascade=True)

        self.assertEqual(failure.exception.status_code, 409)
        self.assertIn("活动任务", failure.exception.detail)
        self.assertIsNotNone(platform.get_project_row(project["id"]))
        self.assertTrue(generated_file.exists())
        self.assertTrue(source_file.exists())

    def test_cascade_delete_reports_nonfatal_file_cleanup_failure(self):
        project, _, generated_file, source_file, *_ = self.create_project_graph("CODEX_TEST_20260806_WARNING")

        with patch.object(platform, "remove_report_target", side_effect=OSError("cleanup denied")):
            result = platform.delete_project(project["id"], cascade=True)

        self.assertTrue(result["fileCleanupWarnings"])
        self.assertTrue(generated_file.exists())
        self.assertTrue(source_file.exists())
        with self.assertRaises(platform.HTTPException):
            platform.get_project_row(project["id"])


if __name__ == "__main__":
    unittest.main()
