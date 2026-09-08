import tempfile
import unittest
from pathlib import Path

from backend.app import main


CASES_MARKDOWN = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-WORK-UPDATE-001 | P0 | 更新验证 | 原始需求 | 页面可访问 | 打开页面 | 页面可见 | 使用稳定 selector |
"""


class WorkItemUpdateTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = main.DB_PATH
        self.tempdir = tempfile.TemporaryDirectory()
        main.DB_PATH = Path(self.tempdir.name) / "work-item-update.sqlite"
        main.init_db()
        self.project = main.create_project(
            main.ProjectRequest(name="CODEX_TEST_WORK_UPDATE_PROJECT", project_type="product", status="active")
        )
        self.feature = main.create_feature_menu(
            main.FeatureMenuRequest(project_id=self.project["id"], name="CODEX_TEST_WORK_UPDATE_FEATURE_A")
        )
        self.next_feature = main.create_feature_menu(
            main.FeatureMenuRequest(project_id=self.project["id"], name="CODEX_TEST_WORK_UPDATE_FEATURE_B")
        )

    def tearDown(self):
        main.DB_PATH = self.original_db_path
        self.tempdir.cleanup()

    def create_work_item(self):
        return main.create_work_item(
            main.WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                title="CODEX_TEST_WORK_UPDATE_ITEM",
                requirement="验证原始需求会展示在人工工作台。",
                target_url="https://example.com/original",
            )
        )

    def test_patch_updates_same_work_item_and_marks_preserved_downstream_for_review(self):
        work_item = self.create_work_item()
        generated = main.generate_cases(work_item["id"], main.ContentRequest(content=CASES_MARKDOWN))
        timestamp = main.now_iso()
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO automation_flow_runs (
                    id, work_item_id, feature_id, status, stage, progress, started_at, ended_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "CODEX_TEST_WORK_UPDATE_FLOW", work_item["id"], self.feature["id"],
                    "completed", "保存已验证产物", 100, timestamp, timestamp,
                ),
            )
            conn.execute(
                """
                INSERT INTO deliverables (
                    id, project_id, work_item_id, feature_id, type, name, status,
                    version, file_path, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "CODEX_TEST_WORK_UPDATE_DELIVERABLE", self.project["id"], work_item["id"],
                    self.feature["id"], "manual-report", "CODEX_TEST_WORK_UPDATE_REPORT",
                    "ready", 1, "report.md", timestamp, timestamp,
                ),
            )

        updated = main.update_work_item_details(
            work_item["id"],
            main.WorkItemPatchRequest(
                feature_id=self.next_feature["id"],
                title="CODEX_TEST_WORK_UPDATE_ITEM_EDITED",
                requirement="更新后的原始需求，需要复核原有自动化资产。",
                target_url="https://example.com/updated",
                role="测试管理员",
                test_data="CODEX_TEST_WORK_UPDATE_DATA",
                acceptance="修改保存后仍然是同一个工单。",
                exclusions="不执行全量回归。",
            ),
        )

        self.assertEqual(updated["id"], work_item["id"])
        self.assertEqual(updated["projectId"], self.project["id"])
        self.assertEqual(updated["featureId"], self.next_feature["id"])
        self.assertEqual(updated["requirementRevision"], 2)
        self.assertTrue(updated["downstreamReviewRequired"])
        self.assertEqual(updated["status"], "review-required")
        self.assertIn("用例设计", updated["staleStages"])
        self.assertEqual(updated["casesMarkdown"], generated["casesMarkdown"])
        self.assertEqual(updated["requirementAnalysis"]["role"], "测试管理员")
        with main.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM work_items").fetchone()["total"], 1)
            case_row = conn.execute("SELECT * FROM test_cases WHERE work_item_id = ?", (work_item["id"],)).fetchone()
            self.assertEqual(case_row["feature_id"], self.next_feature["id"])
            flow_row = conn.execute("SELECT * FROM automation_flow_runs WHERE work_item_id = ?", (work_item["id"],)).fetchone()
            self.assertEqual(flow_row["feature_id"], self.next_feature["id"])
            deliverable_row = conn.execute("SELECT * FROM deliverables WHERE work_item_id = ?", (work_item["id"],)).fetchone()
            self.assertEqual(deliverable_row["feature_id"], self.next_feature["id"])

    def test_patch_is_blocked_while_manual_run_is_active(self):
        work_item = self.create_work_item()
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label,
                    progress, started_at, report_path, screenshot_path, work_item_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "CODEX_TEST_WORK_UPDATE_ACTIVE_RUN",
                    work_item["slug"], work_item["title"], "spec.ts", "running",
                    "execute", "执行", 50, main.now_iso(), "", "", work_item["id"],
                ),
            )

        with self.assertRaises(main.HTTPException) as error:
            main.update_work_item_details(
                work_item["id"],
                main.WorkItemPatchRequest(requirement="运行中不允许修改。"),
            )

        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(main.get_work_item(work_item["id"])["requirementRevision"], 1)


if __name__ == "__main__":
    unittest.main()
