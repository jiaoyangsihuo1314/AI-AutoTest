import tempfile
import unittest
from pathlib import Path

from backend.app import platform
from backend.app.schemas.models import EnvironmentVariableInput


class FortifyRemediationTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(prefix="CODEX_TEST_20260907_FORTIFY_")
        self.root = Path(self.tempdir.name)
        self.original_db_path = platform.DB_PATH
        self.original_draft_dir = platform.WORK_ITEM_DRAFT_DIR
        self.original_secret_key_path = platform.SECRET_KEY_PATH
        platform.DB_PATH = self.root / "fortify.sqlite"
        platform.WORK_ITEM_DRAFT_DIR = self.root / "draft-runs"
        platform.SECRET_KEY_PATH = self.root / ".secret-key"
        platform.init_db()
        self.project = platform.create_project(platform.ProjectRequest(
            name="CODEX_TEST_20260907_FORTIFY",
            project_code="CODEX-FORTIFY",
            environments=[
                {"name": "CODEX_TEST_20260907_ENV", "url": "https://www.saucedemo.com", "is_default": True},
            ],
        ))
        self.feature = platform.create_feature_menu(platform.FeatureMenuRequest(
            project_id=self.project["id"],
            name="CODEX_TEST_20260907_FORTIFY_FEATURE",
        ))
        self.work = platform.create_work_item(platform.WorkItemRequest(
            project_id=self.project["id"],
            feature_id=self.feature["id"],
            requirement="验证 SauceDemo 登录",
            target_url="https://www.saucedemo.com",
            test_data="用户名 work_user、密码 WorkPass123",
        ))

    def tearDown(self):
        platform.DB_PATH = self.original_db_path
        platform.WORK_ITEM_DRAFT_DIR = self.original_draft_dir
        platform.SECRET_KEY_PATH = self.original_secret_key_path
        self.tempdir.cleanup()

    def test_project_environment_credentials_override_work_item_credentials(self):
        environment_id = self.project["defaultEnvironmentId"]
        platform.update_project_environment_variables(
            environment_id,
            platform.EnvironmentVariablesRequest(items=[
                EnvironmentVariableInput(name="QA_USERNAME", value="environment_user"),
                EnvironmentVariableInput(name="QA_PASSWORD", value="EnvironmentPass123", is_secret=True),
            ]),
        )

        variables = platform.execution_runtime_variables(self.work["id"], environment_id)

        self.assertEqual(variables["QA_USERNAME"], "environment_user")
        self.assertEqual(variables["QA_PASSWORD"], "EnvironmentPass123")

    def test_migration_updates_only_matching_generated_script(self):
        item = platform.get_work_item_row(self.work["id"])
        legacy = """import { test } from '@playwright/test';

const username = \"work_user\";
const password = \"WorkPass123\";

function sauce(page: Page, testId: string) {
  return page.locator(`[data-test=\"${testId}\"]`);
}
"""
        with platform.get_db() as conn:
            generated_cursor = conn.execute(
                "INSERT INTO generated_scripts (work_item_id, content, created_at) VALUES (?, ?, ?)",
                (self.work["id"], legacy, platform.now_iso()),
            )
            generated_id = platform.create_script_version(
                conn,
                item,
                legacy,
                asset_mode="create",
                case_ids=[],
                source_generated_script_id=generated_cursor.lastrowid,
                parameterize_content=False,
            )
            conn.execute(
                "UPDATE generated_scripts SET script_version_id = ? WHERE id = ?",
                (generated_id, generated_cursor.lastrowid),
            )
            imported_id = platform.create_script_version(
                conn,
                item,
                legacy,
                asset_mode="create",
                case_ids=[],
                source="external-import",
                parameterize_content=False,
            )

            self.assertEqual(platform.migrate_generated_script_credentials(conn), 1)
            generated = conn.execute("SELECT * FROM test_script_versions WHERE id = ?", (generated_id,)).fetchone()
            imported = conn.execute("SELECT * FROM test_script_versions WHERE id = ?", (imported_id,)).fetchone()
            linked = conn.execute("SELECT * FROM generated_scripts WHERE id = ?", (generated_cursor.lastrowid,)).fetchone()
            self.assertIn("requiredCredential('QA_PASSWORD')", generated["content"])
            self.assertNotIn("WorkPass123", generated["content"])
            self.assertEqual(linked["content"], generated["content"])
            self.assertEqual(imported["content"], legacy)
            self.assertEqual(platform.migrate_generated_script_credentials(conn), 0)
