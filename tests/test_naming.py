import tempfile
import unittest
from pathlib import Path

from backend.app import platform
from backend.app.schemas.models import (
    ContentRequest,
    FeatureMenuRequest,
    ProjectRequest,
    TestCasePatchRequest,
    WorkItemPatchRequest,
    WorkItemRequest,
)


class NamingContractTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.originals = {
            "DB_PATH": platform.DB_PATH,
            "WORK_ITEM_DRAFT_DIR": platform.WORK_ITEM_DRAFT_DIR,
            "ai_playwright_script": platform.ai_playwright_script,
        }
        platform.DB_PATH = root / "naming.sqlite"
        platform.WORK_ITEM_DRAFT_DIR = root / "drafts"
        platform.ai_playwright_script = lambda *args, **kwargs: ""
        platform.init_db()
        self.project = platform.create_project(
            ProjectRequest(name="CODEX_TEST_NAMING_PROJECT", project_code="CODEX-NAME")
        )
        self.feature = platform.create_feature_menu(
            FeatureMenuRequest(project_id=self.project["id"], name="登录功能")
        )

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(platform, name, value)
        self.temp_dir.cleanup()

    def create_work_item(self, **overrides):
        values = {
            "project_id": self.project["id"],
            "feature_id": self.feature["id"],
            "requirement": "帮我测试下这个网站的登录功能 http://192.168.7.180:12222/login，账号：demo，密码：secret。",
        }
        values.update(overrides)
        return platform.create_work_item(WorkItemRequest(**values))

    def test_work_item_title_removes_request_noise_ip_and_empty_suffixes(self):
        item = self.create_work_item()

        self.assertEqual(item["titleSource"], "auto")
        self.assertEqual(item["title"], "登录功能流程")
        self.assertNotRegex(item["title"], r"(?:\d{1,3}\.){3}\d{1,3}")
        self.assertNotRegex(item["title"], r"(测试|验证|工单|任务)$")

    def test_manual_work_item_title_stays_locked_and_can_restore_auto(self):
        item = self.create_work_item(title="人工登录回归范围")
        updated = platform.update_work_item_details(
            item["id"],
            WorkItemPatchRequest(
                title=item["title"],
                title_mode="manual",
                requirement="验证用户可以登录并进入首页。",
            ),
        )

        self.assertEqual(updated["title"], "人工登录回归范围")
        self.assertEqual(updated["titleSource"], "manual")

        restored = platform.update_work_item_details(
            item["id"],
            WorkItemPatchRequest(title_mode="auto", requirement=updated["requirement"]),
        )
        self.assertEqual(restored["titleSource"], "auto")
        self.assertNotEqual(restored["title"], "人工登录回归范围")

    def test_generated_case_titles_are_normalized_unique_and_manual_edits_are_locked(self):
        item = self.create_work_item()
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-NAME-001 | P0 | TC-CODEX-NAME-001 验证登录成功 | 登录 | 有效账号 | 输入账号密码并登录 | 进入首页 | 自动化 |
| TC-CODEX-NAME-002 | P1 | TC-CODEX-NAME-002 验证登录成功 | 登录 | 密码为空 | 点击登录 | 提示密码必填 | 自动化 |
"""
        generated = platform.generate_cases(
            item["id"],
            ContentRequest(content=cases, generation_source="ai", asset_mode="append"),
        )
        generated_cases = generated["testCases"]

        self.assertEqual({case["titleSource"] for case in generated_cases}, {"auto"})
        self.assertEqual(len({case["title"] for case in generated_cases}), 2)
        self.assertTrue(all(not case["title"].startswith(case["externalId"]) for case in generated_cases))

        locked_case = generated_cases[0]
        platform.update_test_case(
            locked_case["id"],
            TestCasePatchRequest(title="人工确认的登录成功", title_mode="manual"),
        )
        refreshed = platform.generate_cases(
            item["id"],
            ContentRequest(
                content=generated["casesMarkdown"].replace(locked_case["title"], "有效账号登录后进入首页"),
                generation_source="ai",
                asset_mode="refresh",
                case_ids=generated["caseIds"],
            ),
        )
        refreshed_by_id = {case["id"]: case for case in refreshed["testCases"]}
        self.assertEqual(refreshed_by_id[locked_case["id"]]["title"], "人工确认的登录成功")
        self.assertEqual(refreshed_by_id[locked_case["id"]]["titleSource"], "manual")
        self.assertIn("人工确认的登录成功", refreshed["casesMarkdown"])

    def test_script_name_and_test_title_match_case_while_path_uses_stable_id(self):
        item = self.create_work_item()
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-NAME-001 | P0 | 有效账号登录成功 | 登录 | 有效账号 | 输入账号密码并登录 | 进入首页 | 自动化 |
"""
        generated = platform.generate_cases(
            item["id"],
            ContentRequest(content=cases, generation_source="ai", asset_mode="append"),
        )
        case = generated["testCases"][0]
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source, confirmed
                ) VALUES (?, 'body', '页面主体', 'css', 'body', 'unit-test', 1)
                """,
                (item["id"],),
            )

        scripted = platform.generate_script_set(
            item["id"],
            ContentRequest(asset_mode="append", case_ids=[case["id"]]),
        )
        version = scripted["scriptSet"]["scriptVersions"][0]
        expected_name = f"{case['externalId']} {case['title']}"

        self.assertEqual(version["scriptName"], expected_name)
        self.assertEqual(platform.extract_playwright_test_titles(version["content"]), [expected_name])
        self.assertIn(platform.slugify(case["externalId"]), Path(version["specPath"]).name)
        self.assertNotIn(platform.slugify(case["title"]), Path(version["specPath"]).name)


if __name__ == "__main__":
    unittest.main()
