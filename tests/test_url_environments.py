import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from backend.app import main


CASES = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-ENV-001 | P0 | 环境切换 | URL 参数化 | 页面可访问 | 打开页面 | 页面可见 | 使用运行环境 |
"""

SCRIPT = """import { expect, test } from '@playwright/test';
test('TC-CODEX-ENV-001 环境切换', async ({ page }) => {
  await page.goto('https://old.example.com/app/path?q=1#result');
  await expect(page).toHaveURL(/path/);
});
"""


class UrlEnvironmentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.patchers = [
            patch.object(main, "DB_PATH", self.root / "qa.sqlite"),
            patch.object(main, "ARTIFACT_DIR", self.root / "artifacts"),
            patch.object(main, "PROJECT_ARTIFACT_DIR", self.root / "projects"),
            patch.object(main, "WORK_ITEM_DRAFT_DIR", self.root / "draft-runs"),
            patch.object(main, "PLAYWRIGHT_REPORT_ARCHIVE_DIR", self.root / "playwright-reports"),
            patch.object(main, "REPORT_INDEX", self.root / "report" / "index.html"),
            patch.object(main, "SCREENSHOT_PATH", self.root / "browser-preview.svg"),
        ]
        for patcher in self.patchers:
            patcher.start()
        main.init_db()

    def tearDown(self):
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.tempdir.cleanup()

    def create_project(self):
        return main.create_project(main.ProjectRequest(
            name="CODEX_TEST_URL_ENVIRONMENTS",
            environments=[
                {"name": "测试环境", "url": "https://old.example.com/app", "is_default": True},
                {"name": "预发环境", "url": "https://new.example.com/stage", "is_default": False},
            ],
        ))

    def test_init_db_backfills_legacy_target_url_as_default_environment(self):
        timestamp = main.now_iso()
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO projects (
                    id, slug, project_code, name, project_type, status, target_url,
                    repository_path, test_dir, description, created_at, updated_at
                ) VALUES ('legacy-env', 'legacy-env', 'PRJ-LEGACY-ENV', 'CODEX_TEST_LEGACY_ENV',
                          'product', 'active', 'https://legacy.example.com/app', '', 'tests/e2e', '', ?, ?)
                """,
                (timestamp, timestamp),
            )

        main.init_db()
        project = main.get_project("legacy-env")

        self.assertEqual(project["targetUrl"], "https://legacy.example.com/app")
        self.assertEqual(len(project["environments"]), 1)
        self.assertTrue(project["environments"][0]["isDefault"])

    async def test_suite_default_environment_is_snapshotted_and_protected(self):
        project = self.create_project()
        stage = next(item for item in project["environments"] if item["name"] == "预发环境")
        case = main.create_test_case(main.TestCaseRequest(
            project_id=project["id"],
            external_id="TC-CODEX-SUITE-ENV-001",
            title="CODEX_TEST 套件环境",
            automation_status="automated",
            spec_path="tests/e2e/nonexistent-environment.spec.ts",
        ))
        suite = main.create_test_suite(main.SuiteRequest(
            project_id=project["id"],
            name="CODEX_TEST_ENV_SUITE",
            run_config={"environmentId": stage["id"]},
        ))
        main.update_test_suite_cases(suite["id"], main.SuiteCaseUpdateRequest(case_ids=[case["id"]]))

        with patch.object(main.platform, "execute_suite_run", new=AsyncMock(return_value=None)):
            suite_run = await main.create_suite_run(main.SuiteRunRequest(suite_id=suite["id"]))
            await asyncio.sleep(0)

        updated_environments = [
            {
                "id": item["id"],
                "name": item["name"],
                "url": "https://changed.example.com/stage" if item["id"] == stage["id"] else item["url"],
                "is_default": item["isDefault"],
            }
            for item in project["environments"]
        ]
        main.update_project(project["id"], main.ProjectPatchRequest(environments=updated_environments))
        persisted_run = main.get_suite_run(suite_run["id"])
        self.assertEqual(persisted_run["environment"]["url"], "https://new.example.com/stage")

        with self.assertRaises(HTTPException) as context:
            main.update_project(
                project["id"],
                main.ProjectPatchRequest(environments=[updated_environments[0]]),
            )
        self.assertEqual(context.exception.status_code, 409)

    async def test_work_item_and_healing_keep_environment_snapshots(self):
        project = self.create_project()
        default_environment = next(item for item in project["environments"] if item["isDefault"])
        stage = next(item for item in project["environments"] if item["name"] == "预发环境")
        feature = main.create_feature_menu(main.FeatureMenuRequest(project_id=project["id"], name="CODEX_TEST_ENV_FEATURE"))
        work = main.create_work_item(main.WorkItemRequest(
            project_id=project["id"],
            feature_id=feature["id"],
            requirement="CODEX_TEST URL 环境切换",
            target_url=default_environment["url"],
        ))
        main.generate_cases(work["id"], main.ContentRequest(content=CASES))
        item = main.get_work_item_row(work["id"])
        with main.get_db() as conn:
            case_row = conn.execute("SELECT * FROM test_cases WHERE work_item_id = ? LIMIT 1", (work["id"],)).fetchone()
            main.create_script_version(
                conn,
                item,
                SCRIPT,
                asset_mode="create",
                case_ids=[case_row["id"]],
                case_id=case_row["id"],
                case_external_id=case_row["external_id"],
            )

        run_id, _, _ = await main.create_work_item_draft_run(work["id"], environment_id=default_environment["id"])
        main.update_run(run_id, actual_url="https://old.example.com/app/#/")
        run = main.get_run(run_id)
        self.assertEqual(run["environment"]["id"], default_environment["id"])
        self.assertEqual(run["actualUrl"], "https://old.example.com/app/#/")
        self.assertIn("process.env.QA_TARGET_URL", main.latest_script_for_work_item(work["id"]))
        with main.get_db() as conn:
            conn.execute("UPDATE runs SET status = 'failed', ended_at = ? WHERE id = ?", (main.now_iso(), run_id))

        healing = main.create_healing_run_record(
            work["id"],
            run_id,
            environment={"id": stage["id"], "name": stage["name"], "url": stage["url"]},
        )
        self.assertEqual(healing["sourceEnvironment"]["url"], default_environment["url"])
        self.assertEqual(healing["environment"]["url"], stage["url"])
        self.assertTrue(healing["environmentChanged"])

    async def test_execution_live_url_event_captures_actual_browser_url(self):
        runtime = main.BrowserRuntime(
            "CODEX_TEST_URL_EVENT",
            "",
            None,
            "http://example.test",
            None,
            interactive=False,
        )

        await main.handle_execution_live_event(runtime, {"type": "url", "url": "http://example.test/#/"})

        self.assertEqual(runtime.last_worker_url, "http://example.test/#/")

    def test_typescript_parameterization_rebases_only_application_urls(self):
        source = """const first = 'https://old.example.com/app/path?q=1#result';
const external = 'https://identity.example.com/login';
"""
        transformed = main.parameterize_typescript_source(
            source,
            "https://old.example.com/app",
            "https://new.example.com/stage",
        )

        self.assertIn('https://new.example.com/stage/path?q=1#result', transformed)
        self.assertIn('https://identity.example.com/login', transformed)
        self.assertEqual(
            main.rebase_environment_url(
                "https://old.example.com/app/path?q=1#result",
                "https://old.example.com/app",
                "https://new.example.com/stage",
            ),
            "https://new.example.com/stage/path?q=1#result",
        )

    def test_environment_rebase_preserves_source_hash_and_honors_target_overrides(self):
        self.assertEqual(
            main.rebase_environment_url(
                "http://old.example.com/app/#/",
                "http://old.example.com/app/#/",
                "http://new.example.com/stage",
            ),
            "http://new.example.com/stage/#/",
        )
        self.assertEqual(
            main.rebase_environment_url(
                "http://old.example.com/app/path?source=1#/detail",
                "http://old.example.com/app/#/",
                "http://new.example.com/stage?target=1#/home",
            ),
            "http://new.example.com/stage/path?target=1#/home",
        )

    def test_generated_and_runtime_typescript_use_the_same_environment_mapping(self):
        source = "const url = 'http://old.example.com/app/#/';"
        generated = main.parameterize_typescript_source(
            source,
            "http://old.example.com/app/#/",
            generated=True,
        )
        runtime = main.parameterize_typescript_source(
            source,
            "http://old.example.com/app/#/",
            "http://new.example.com/stage",
        )

        self.assertIn("function qaEnvironmentUrl", generated)
        self.assertIn('qaEnvironmentUrl("http://old.example.com/app/#/")', generated)
        self.assertIn("http://new.example.com/stage/#/", runtime)
        overridden = main.parameterize_typescript_source(
            "const url = 'http://old.example.com/app/path?source=1#/detail';",
            "http://old.example.com/app/#/",
            "http://new.example.com/stage?target=1#/home",
        )
        self.assertIn("http://new.example.com/stage/path?target=1#/home", overridden)


if __name__ == "__main__":
    unittest.main()
