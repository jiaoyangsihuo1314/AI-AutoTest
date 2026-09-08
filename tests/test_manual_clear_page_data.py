import tempfile
import unittest
from pathlib import Path

from backend.app import main


CASES_MARKDOWN = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-CLEAR-001 | P0 | 清空验证 | 验证清空范围 | 页面可访问 | 打开页面 | 页面可见 | 使用稳定 selector |
"""

SCRIPT = """import { expect, test } from '@playwright/test';
test('TC-CODEX-CLEAR-001 清空验证', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.locator('body')).toBeVisible();
});
"""


class ManualClearPageDataTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.originals = {
            "DB_PATH": main.DB_PATH,
            "ROOT_DIR": main.ROOT_DIR,
            "WORK_ITEM_DRAFT_DIR": main.WORK_ITEM_DRAFT_DIR,
            "PLAYWRIGHT_REPORT_ARCHIVE_DIR": main.PLAYWRIGHT_REPORT_ARCHIVE_DIR,
            "REPORT_INDEX": main.REPORT_INDEX,
            "SCREENSHOT_PATH": main.SCREENSHOT_PATH,
            "EXECUTION_CONFIG_DIR": main.EXECUTION_CONFIG_DIR,
        }
        main.DB_PATH = self.root / "test.sqlite"
        main.ROOT_DIR = self.root
        main.WORK_ITEM_DRAFT_DIR = self.root / "tests" / "e2e" / ".draft-runs"
        main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = self.root / "artifacts" / "playwright-reports"
        main.REPORT_INDEX = self.root / "playwright-report" / "index.html"
        main.SCREENSHOT_PATH = self.root / "artifacts" / "browser-preview.svg"
        main.EXECUTION_CONFIG_DIR = self.root / "tests" / "e2e" / ".execution-configs"
        main.init_db()
        self.project = main.create_project(main.ProjectRequest(name="CODEX_TEST_CLEAR_PROJECT", project_type="product", status="active"))
        self.feature = main.create_feature_menu(main.FeatureMenuRequest(project_id=self.project["id"], name="CODEX_TEST_CLEAR_FEATURE"))

    def tearDown(self):
        for key, value in self.originals.items():
            setattr(main, key, value)
        self.temp_dir.cleanup()

    def create_work(self, title="CODEX_TEST_CLEAR_WORK", asset_mode="create", case_ids=None):
        return main.create_work_item(
            main.WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                title=title,
                requirement=f"{title} 验证人工工作台一键清空。",
                target_url="https://example.com",
                asset_mode=asset_mode,
                case_ids=case_ids or [],
            )
        )

    def test_clear_cases_deletes_create_mode_cases_but_keeps_other_work_items(self):
        work = self.create_work("CODEX_TEST_CLEAR_CASES")
        other = self.create_work("CODEX_TEST_CLEAR_CASES_OTHER")
        main.generate_cases(work["id"], main.ContentRequest(content=CASES_MARKDOWN))
        main.generate_cases(other["id"], main.ContentRequest(content=CASES_MARKDOWN.replace("001", "999")))

        result = main.clear_work_item_page_data(work["id"], main.ClearPageDataRequest(page="cases"))

        self.assertEqual(result["status"], "cleared")
        self.assertEqual(result["item"]["casesMarkdown"], "")
        with main.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM generated_cases WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM test_cases WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM generated_cases WHERE work_item_id = ?", (other["id"],)).fetchone()["total"], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM test_cases WHERE work_item_id = ?", (other["id"],)).fetchone()["total"], 1)

    def test_clear_cases_unbinds_refresh_mode_cases_without_deleting_assets(self):
        case_item = main.create_test_case(
            main.TestCaseRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                external_id="TC-CODEX-REFRESH-001",
                title="既有资产",
                priority="P0",
            )
        )
        work = self.create_work("CODEX_TEST_CLEAR_REFRESH", asset_mode="refresh", case_ids=[case_item["id"]])
        refresh_markdown = CASES_MARKDOWN.replace("TC-CODEX-CLEAR-001", "TC-CODEX-REFRESH-001")
        main.generate_cases(work["id"], main.ContentRequest(content=refresh_markdown, asset_mode="refresh", case_ids=[case_item["id"]]))

        main.clear_work_item_page_data(work["id"], main.ClearPageDataRequest(page="cases"))

        with main.get_db() as conn:
            row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (case_item["id"],)).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["work_item_id"], "")

    def test_requirements_page_clear_is_not_supported(self):
        work = self.create_work("CODEX_TEST_CLEAR_REQUIREMENTS_UNSUPPORTED")

        with self.assertRaises(main.HTTPException) as error:
            main.clear_work_item_page_data(work["id"], main.ClearPageDataRequest(page="requirements"))

        self.assertEqual(error.exception.status_code, 400)
        with main.get_db() as conn:
            self.assertIsNotNone(conn.execute("SELECT * FROM work_items WHERE id = ?", (work["id"],)).fetchone())

    def test_clear_exploration_scripts_execution_and_healing_are_scoped(self):
        other = self.create_work("CODEX_TEST_CLEAR_SCOPE_OTHER")
        main.generate_cases(other["id"], main.ContentRequest(content=CASES_MARKDOWN.replace("001", "888")))
        pages = ["exploration", "scripts", "execution", "healing"]
        for page in pages:
            with self.subTest(page=page):
                work = self.create_work(f"CODEX_TEST_CLEAR_{page.upper()}")
                self.seed_page_data(work, page)

                result = main.clear_work_item_page_data(work["id"], main.ClearPageDataRequest(page=page))

                self.assertEqual(result["page"], page)
                with main.get_db() as conn:
                    self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM generated_cases WHERE work_item_id = ?", (other["id"],)).fetchone()["total"], 1)
                    if page == "exploration":
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM explorations WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 0)
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM confirmed_elements WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 0)
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM exploration_runs WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 0)
                    elif page == "scripts":
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM generated_scripts WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 0)
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM test_script_versions WHERE work_item_id = ? AND status != 'active'", (work["id"],)).fetchone()["total"], 0)
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM test_script_versions WHERE work_item_id = ? AND status = 'active'", (work["id"],)).fetchone()["total"], 1)
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM script_generation_batches WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 0)
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM test_fixture_versions WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 1)
                        self.assertEqual(result["item"]["scriptVersions"], [])
                        self.assertEqual(result["item"]["scriptContent"], "")
                        self.assertIsNone(result["item"]["fixtureVersion"])
                    elif page == "execution":
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM runs WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 0)
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM logs WHERE run_id = ?", (f"run-{work['id']}",)).fetchone()["total"], 0)
                    elif page == "healing":
                        self.assertIsNotNone(conn.execute("SELECT * FROM runs WHERE id = ?", (f"source-{work['id']}",)).fetchone())
                        self.assertIsNone(conn.execute("SELECT * FROM runs WHERE id = ?", (f"rerun-{work['id']}",)).fetchone())
                        self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM healing_runs WHERE work_item_id = ?", (work["id"],)).fetchone()["total"], 0)

    def test_active_manual_runs_block_clear_before_any_delete(self):
        scenarios = [
            ("exploration", "exploration_runs", "explore-active"),
            ("execution", "runs", "run-active"),
            ("healing", "healing_runs", "heal-active"),
        ]
        for page, table, record_id in scenarios:
            with self.subTest(page=page):
                work = self.create_work(f"CODEX_TEST_CLEAR_ACTIVE_{page}")
                self.seed_active_record(work, table, record_id)

                with self.assertRaises(main.HTTPException) as error:
                    main.clear_work_item_page_data(work["id"], main.ClearPageDataRequest(page=page))

                self.assertEqual(error.exception.status_code, 409)
                with main.get_db() as conn:
                    self.assertIsNotNone(conn.execute(f"SELECT * FROM {table} WHERE id = ?", (record_id,)).fetchone())

    def seed_page_data(self, work, page):
        timestamp = main.now_iso()
        with main.get_db() as conn:
            if page == "exploration":
                conn.execute("INSERT INTO explorations (work_item_id, notes, screenshot_path, page_structure, created_at) VALUES (?, ?, ?, ?, ?)", (work["id"], "note", "shot.png", "body", timestamp))
                conn.execute("INSERT INTO confirmed_elements (work_item_id, area, name, locator_type, locator_value, source, confirmed) VALUES (?, ?, ?, ?, ?, ?, ?)", (work["id"], "main", "body", "text", "Example", "test", 1))
                conn.execute("INSERT INTO exploration_runs (id, work_item_id, target_url, status, stage_key, stage_label, progress, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (f"explore-{work['id']}", work["id"], "https://example.com", "passed", "complete", "完成", 100, timestamp))
                conn.execute("INSERT INTO exploration_logs (exploration_run_id, created_at, level, message) VALUES (?, ?, ?, ?)", (f"explore-{work['id']}", timestamp, "info", "done"))
                conn.execute("INSERT INTO exploration_steps (exploration_run_id, work_item_id, step_index, action, status) VALUES (?, ?, ?, ?, ?)", (f"explore-{work['id']}", work["id"], 0, "goto", "passed"))
            elif page == "scripts":
                item_row = conn.execute("SELECT * FROM work_items WHERE id = ?", (work["id"],)).fetchone()
                batch_id = f"batch-{work['id']}"
                fixture_row = main.create_fixture_version(conn, item_row, batch_id, main.default_fixture_content(item_row))
                conn.execute(
                    """
                    INSERT INTO script_generation_batches (
                        id, project_id, work_item_id, fixture_version_id,
                        asset_mode, source, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (batch_id, self.project["id"], work["id"], fixture_row["id"], "create", "ai", "ready", timestamp, timestamp),
                )
                draft_id = main.create_script_version(
                    conn,
                    item_row,
                    SCRIPT,
                    asset_mode="create",
                    case_ids=[],
                    generation_batch_id=batch_id,
                    fixture_version_id=fixture_row["id"],
                )
                active_id = main.create_script_version(
                    conn,
                    item_row,
                    SCRIPT.replace("body", "main"),
                    asset_mode="create",
                    case_ids=[],
                    generation_batch_id=batch_id,
                    fixture_version_id=fixture_row["id"],
                )
                conn.execute("UPDATE test_script_versions SET status = 'active' WHERE id = ?", (active_id,))
                conn.execute("INSERT INTO generated_scripts (work_item_id, content, script_version_id, asset_mode, case_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", (work["id"], SCRIPT, draft_id, "create", "[]", timestamp))
                conn.execute("INSERT INTO generated_scripts (work_item_id, content, script_version_id, asset_mode, case_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", (work["id"], SCRIPT, active_id, "create", "[]", timestamp))
            elif page == "execution":
                conn.execute(
                    """
                    INSERT INTO runs (
                        id, suite_id, suite_name, spec, status, stage_key, stage_label,
                        progress, started_at, ended_at, report_path, screenshot_path, work_item_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (f"run-{work['id']}", work["slug"], work["title"], "spec.ts", "passed", "complete", "完成", 100, timestamp, timestamp, "", "", work["id"]),
                )
                conn.execute("INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)", (f"run-{work['id']}", timestamp, "success", "done"))
            elif page == "healing":
                for run_id in [f"source-{work['id']}", f"rerun-{work['id']}"]:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, report_path, screenshot_path, work_item_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (run_id, work["slug"], work["title"], "spec.ts", "failed", "complete", "完成", 100, timestamp, timestamp, "", "", work["id"]),
                    )
                conn.execute("INSERT INTO healing_runs (id, work_item_id, source_run_id, status, current_round, max_rounds, latest_run_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (f"heal-{work['id']}", work["id"], f"source-{work['id']}", "failed", 1, 3, f"rerun-{work['id']}", timestamp))
                conn.execute("INSERT INTO healing_attempts (healing_run_id, work_item_id, source_run_id, rerun_run_id, round, status, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (f"heal-{work['id']}", work["id"], f"source-{work['id']}", f"rerun-{work['id']}", 1, "failed", "failed", timestamp))

    def seed_active_record(self, work, table, record_id):
        timestamp = main.now_iso()
        with main.get_db() as conn:
            if table == "exploration_runs":
                conn.execute("INSERT INTO exploration_runs (id, work_item_id, target_url, status, stage_key, stage_label, progress, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (record_id, work["id"], "https://example.com", "running", "prepare", "准备", 10, timestamp))
            elif table == "runs":
                conn.execute(
                    """
                    INSERT INTO runs (
                        id, suite_id, suite_name, spec, status, stage_key, stage_label,
                        progress, started_at, report_path, screenshot_path, work_item_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (record_id, work["slug"], work["title"], "spec.ts", "running", "execute", "执行", 50, timestamp, "", "", work["id"]),
                )
            else:
                conn.execute("INSERT INTO healing_runs (id, work_item_id, source_run_id, status, current_round, max_rounds, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (record_id, work["id"], "source-run", "queued", 0, 3, timestamp))


if __name__ == "__main__":
    unittest.main()
