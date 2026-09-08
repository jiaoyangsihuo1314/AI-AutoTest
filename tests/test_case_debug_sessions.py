import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.app import platform
from backend.app.schemas.models import (
    CaseDebugPublishRequest,
    CaseDebugBatchRequest,
    CaseDebugRunRequest,
    CaseDebugSessionCreateRequest,
    CaseDebugCaseDraftRequest,
    CaseDebugScriptDraftRequest,
    ContentRequest,
    ExplorationRequest,
    FeatureMenuRequest,
    HealRequest,
    ProjectRequest,
    TestCasePatchRequest,
    WorkItemRequest,
)


CASES = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-DEBUG-001 | P0 | 调试目标用例 | 单用例调试 | 无 | 点击页面主体 | 页面显示 | 自动化 |
| TC-CODEX-DEBUG-002 | P1 | 不相关用例 | 回归保护 | 无 | 点击页面主体 | 页面显示 | 自动化 |
"""


class CaseDebugSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
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
        self.item = self.create_scripted_item()

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(platform, name, value)
        self.temp_dir.cleanup()

    def create_scripted_item(self):
        project = platform.create_project(ProjectRequest(name="CODEX_TEST_DEBUG", project_code="CODEX-DEBUG", target_url="https://example.com"))
        feature = platform.create_feature_menu(FeatureMenuRequest(project_id=project["id"], name="CODEX_TEST_DEBUG_FEATURE"))
        item = platform.create_work_item(WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement="验证单用例调试。", target_url="https://example.com"))
        item = platform.generate_cases(item["id"], ContentRequest(content=CASES, asset_mode="append"))
        with platform.get_db() as conn:
            conn.execute(
                "INSERT INTO confirmed_elements (work_item_id, area, name, locator_type, locator_value, source, confirmed) VALUES (?, 'body', '页面主体', 'css', 'body', 'unit-test', 1)",
                (item["id"],),
            )
        generated = platform.generate_script_set(item["id"], ContentRequest(asset_mode="append", case_ids=item["caseIds"]))
        with platform.get_db() as conn:
            for version in generated["scriptSet"]["scriptVersions"]:
                case_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (version["caseId"],)).fetchone()
                conn.execute("UPDATE test_script_versions SET status = 'active' WHERE id = ?", (version["id"],))
                conn.execute(
                    "INSERT INTO test_case_script_bindings (id, case_id, script_version_id, external_id, test_title, grep_pattern, is_active, bound_by_source, bound_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'unit-test', ?)",
                    (platform.uuid.uuid4().hex[:12], case_row["id"], version["id"], case_row["external_id"], case_row["external_id"], case_row["external_id"], platform.now_iso()),
                )
        return platform.get_work_item(item["id"])

    def create_session(self, execution_policy="dependency-aware"):
        case = self.item["testCases"][0]
        return platform.create_case_debug_session(case["id"], CaseDebugSessionCreateRequest(expected_case_updated_at=case["updatedAt"], execution_policy=execution_policy))

    def create_failed_debug_run_with_extra_case(self, session, *, target_status="failed", other_status="failed"):
        other_case_id = next(case_id for case_id in self.item["caseIds"] if case_id != session["caseId"])
        with platform.get_db() as conn:
            other_version_id = platform.active_script_binding_for_case(conn, other_case_id)["scriptVersionId"]
        run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )
        with platform.get_db() as conn:
            other_version = conn.execute("SELECT * FROM test_script_versions WHERE id = ?", (other_version_id,)).fetchone()
            conn.execute(
                "INSERT INTO run_script_versions (run_id, script_version_id, case_id, case_definition_hash, result_status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (run_id, other_version_id, other_case_id, other_version["case_definition_hash"] or "", other_status, platform.now_iso()),
            )
            conn.execute(
                "UPDATE run_script_versions SET result_status = ? WHERE run_id = ? AND script_version_id = ?",
                (target_status, run_id, session["currentScriptVersionId"]),
            )
            conn.execute("UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?", (platform.now_iso(), run_id))
            conn.execute("UPDATE case_debug_sessions SET status = 'failed', latest_run_id = ?, updated_at = ? WHERE id = ?", (run_id, platform.now_iso(), session["id"]))
        return run_id, other_case_id

    def test_debug_session_ignores_work_item_healing_history_and_filters_failed_scripts(self):
        session = self.create_session()
        history_run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[version["id"] for version in self.item["scriptVersions"]],
            )
        )
        with platform.get_db() as conn:
            conn.execute("UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?", (platform.now_iso(), history_run_id))
            conn.execute("UPDATE run_script_versions SET result_status = 'failed' WHERE run_id = ?", (history_run_id,))
        history = platform.create_healing_run_record(session["workItemId"], history_run_id)
        self.assertEqual(len(history["failedScripts"]), 2)
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE healing_runs SET status = 'failed', ended_at = ? WHERE id = ?",
                (platform.now_iso(), history["id"]),
            )

        run_id, _ = self.create_failed_debug_run_with_extra_case(session)
        before = platform.get_case_debug_session(session["id"])
        self.assertIsNone(before["latestHealingRun"])

        healing = platform.create_healing_run_record(
            session["workItemId"],
            run_id,
            debug_session_id=session["id"],
            scope="case",
        )
        refreshed = platform.get_case_debug_session(session["id"])

        self.assertNotEqual(history["id"], healing["id"])
        self.assertEqual(refreshed["latestHealingRun"]["id"], healing["id"])
        self.assertEqual(refreshed["latestHealingRun"]["targetCaseId"], session["caseId"])
        self.assertEqual([item["caseId"] for item in refreshed["latestHealingRun"]["failedScripts"]], [session["caseId"]])
        self.assertEqual(refreshed["latestHealingRun"]["debugExecutionScope"], "single")

    def test_case_scoped_healing_targets_only_debug_session_case(self):
        session = self.create_session()
        run_id, _ = self.create_failed_debug_run_with_extra_case(session)
        healing = platform.create_healing_run_record(
            session["workItemId"],
            run_id,
            debug_session_id=session["id"],
            scope="case",
        )
        diagnosed_case_ids = []

        def fake_diagnosis(item, target_version, target_case, cases_markdown, failure_log):
            diagnosed_case_ids.append(target_case["id"])
            return {
                "category": "test-data-environment",
                "confidence": "high",
                "signature": "scope-filter",
                "summary": "停止在策略边界。",
                "evidence": ["scope filter"],
                "action": "block",
                "target": target_case["external_id"],
            }

        with patch.object(platform, "diagnose_healing_target", side_effect=fake_diagnosis):
            result = asyncio.run(platform.execute_self_healing(healing["id"]))

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(diagnosed_case_ids, [session["caseId"]])

    def test_case_scoped_healing_validates_against_debug_draft_instead_of_published_case(self):
        published_expected = "旧详情页结果；旧安全扫描结果"
        draft_expected = "所点击技能的详情页展示对应技能名称和安全扫描状态"
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE test_cases SET expected = ?, updated_at = ? WHERE id = ?",
                (published_expected, platform.now_iso(), self.item["caseIds"][0]),
            )
        self.item = platform.get_work_item(self.item["id"])
        session = self.create_session(execution_policy="strict-single")
        draft = platform.save_case_debug_case_draft(
            session["id"],
            CaseDebugCaseDraftRequest(
                content=session["draftCaseMarkdown"].replace(published_expected, draft_expected),
                base_case_revision_id=session["caseRevisionId"],
            ),
        )
        generated = platform.generate_script_set(
            session["workItemId"],
            ContentRequest(asset_mode="refresh", case_ids=[session["caseId"]], debug_session_id=session["id"]),
        )
        version = max(
            (item for item in generated["scriptVersions"] if item["caseId"] == session["caseId"]),
            key=lambda item: item["version"],
        )
        source_run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[version["id"]],
                debug_session_id=session["id"],
            )
        )
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE case_debug_sessions SET current_script_version_id = ?, latest_run_id = ?, status = 'failed', updated_at = ? WHERE id = ?",
                (version["id"], source_run_id, platform.now_iso(), session["id"]),
            )
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
                (source_run_id, platform.now_iso(), f"Error: locator failed at {Path(version['specPath']).name}:8:3"),
            )
        platform.update_work_item(session["workItemId"], stage="运行验证", status="failed", latest_run_id=source_run_id)
        healing = platform.create_healing_run_record(
            session["workItemId"],
            source_run_id,
            debug_session_id=session["id"],
            scope="case",
        )
        observed_cases = []

        async def fake_generate(*args, **kwargs):
            target_case = platform.parse_cases_markdown(kwargs["cases_markdown"])[0]
            observed_cases.append(target_case)
            return f"""import {{ expect, test }} from '@playwright/test';
import {{ openTargetPage, runStep }} from '{kwargs["fixture_import"]}';

test('{target_case["external_id"]} {target_case["title"]}', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{ await openTargetPage(page); }});
  await runStep('验证修复结果', async () => {{
    // 主断言：{target_case["expected"]}
    await expect(page.locator('body')).toHaveAttribute('data-healed', 'true');
  }});
}});
"""

        async def fake_rerun(
            work_item_id: str,
            flow_run_id: str = "",
            on_run_created=None,
            selected_script_version_ids=None,
            debug_session_id: str = "",
        ):
            run_id, _, _ = await platform.create_work_item_draft_run(
                work_item_id,
                flow_run_id,
                selected_script_version_ids,
                debug_session_id=debug_session_id,
            )
            if on_run_created is not None:
                on_run_created(run_id)
            with platform.get_db() as conn:
                conn.execute(
                    "UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0 WHERE id = ?",
                    (platform.now_iso(), run_id),
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
            result = asyncio.run(platform.execute_self_healing(healing["id"]))

        self.assertEqual(result["status"], "passed")
        self.assertEqual(draft["case"]["expected"], draft_expected)
        self.assertEqual([item["expected"] for item in observed_cases], [draft_expected])
        self.assertNotIn("；", observed_cases[0]["expected"])
        healed_version_id = result["attempts"][-1]["scriptVersionId"]
        with platform.get_db() as conn:
            healed_version = conn.execute(
                "SELECT case_definition_hash FROM test_script_versions WHERE id = ?",
                (healed_version_id,),
            ).fetchone()
            healed_run_version = conn.execute(
                "SELECT case_definition_hash FROM run_script_versions WHERE run_id = ? AND script_version_id = ?",
                (result["latestRunId"], healed_version_id),
            ).fetchone()
        self.assertEqual(healed_version["case_definition_hash"], draft["caseDefinitionHash"])
        self.assertEqual(healed_run_version["case_definition_hash"], draft["caseDefinitionHash"])

    def test_case_scoped_healing_migrates_confirmed_target_goto_before_validation(self):
        session = self.create_session(execution_policy="strict-single")
        source_run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )
        with platform.get_db() as conn:
            version = conn.execute(
                "SELECT * FROM test_script_versions WHERE id = ?",
                (session["currentScriptVersionId"],),
            ).fetchone()
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
                (source_run_id, platform.now_iso(), f"Error: locator failed at {Path(version['spec_path']).name}:8:3"),
            )
            conn.execute(
                "UPDATE case_debug_sessions SET latest_run_id = ?, status = 'failed', updated_at = ? WHERE id = ?",
                (source_run_id, platform.now_iso(), session["id"]),
            )
        platform.update_work_item(session["workItemId"], stage="运行验证", status="failed", latest_run_id=source_run_id)
        healing = platform.create_healing_run_record(
            session["workItemId"],
            source_run_id,
            debug_session_id=session["id"],
            scope="case",
        )
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
        rerun_scripts = []

        async def fake_generate(*args, **kwargs):
            target_case = platform.parse_cases_markdown(kwargs["cases_markdown"])[0]
            return f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{kwargs["fixture_import"]}';

test('{target_case["external_id"]} {target_case["title"]}', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{ await page.goto(TARGET_URL, {{ waitUntil: 'commit' }}); }});
  await runStep('验证修复结果', async () => {{
    // 主断言：{target_case["expected"]}
    await expect(page.locator('body')).toHaveAttribute('data-healed', 'true');
  }});
}});
"""

        async def fake_rerun(
            work_item_id: str,
            flow_run_id: str = "",
            on_run_created=None,
            selected_script_version_ids=None,
            debug_session_id: str = "",
        ):
            selected = list(selected_script_version_ids or [])
            with platform.get_db() as conn:
                rerun_scripts.extend(
                    row["content"]
                    for row in conn.execute(
                        f"SELECT content FROM test_script_versions WHERE id IN ({','.join('?' for _ in selected)})",
                        selected,
                    ).fetchall()
                )
            run_id, _, _ = await platform.create_work_item_draft_run(
                work_item_id,
                flow_run_id,
                selected,
                debug_session_id=debug_session_id,
            )
            if on_run_created is not None:
                on_run_created(run_id)
            with platform.get_db() as conn:
                conn.execute(
                    "UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0 WHERE id = ?",
                    (platform.now_iso(), run_id),
                )
                return conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()

        with patch.object(platform, "navigation_target_for_work_item", return_value=navigation_target), patch.object(
            platform,
            "expectation_policy_mismatch_reason",
            return_value="",
        ), patch.object(
            platform,
            "generate_healed_script",
            new=AsyncMock(side_effect=fake_generate),
        ), patch.object(
            platform,
            "run_work_item_draft_once",
            new=AsyncMock(side_effect=fake_rerun),
        ):
            result = asyncio.run(platform.execute_self_healing(healing["id"]))

        self.assertEqual(result["status"], "passed")
        self.assertEqual(len(rerun_scripts), 1)
        self.assertIn("openTargetPage(page)", rerun_scripts[0])
        self.assertNotIn("page.goto(", rerun_scripts[0])
        validation_log = next(
            item for item in platform.healing_run_logs(healing["id"])["items"]
            if item["stepKey"] == "healing.validate" and item["level"] == "success"
        )
        self.assertTrue(validation_log["details"]["candidateNavigation"]["navigationMigrated"])
        self.assertTrue(validation_log["details"]["candidateNavigation"]["usesOpenTargetPage"])

    def test_case_scoped_healing_feeds_navigation_rejection_into_next_round(self):
        session = self.create_session(execution_policy="strict-single")
        source_run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )
        with platform.get_db() as conn:
            version = conn.execute(
                "SELECT * FROM test_script_versions WHERE id = ?",
                (session["currentScriptVersionId"],),
            ).fetchone()
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
                (source_run_id, platform.now_iso(), f"Error: locator failed at {Path(version['spec_path']).name}:8:3"),
            )
            conn.execute(
                "UPDATE case_debug_sessions SET latest_run_id = ?, status = 'failed', updated_at = ? WHERE id = ?",
                (source_run_id, platform.now_iso(), session["id"]),
            )
        platform.update_work_item(session["workItemId"], stage="运行验证", status="failed", latest_run_id=source_run_id)
        healing = platform.create_healing_run_record(
            session["workItemId"],
            source_run_id,
            debug_session_id=session["id"],
            scope="case",
        )
        navigation_target = {
            "requestedUrl": "https://example.com",
            "resolvedUrl": "https://example.com/detail",
            "navigationSteps": [{
                "action": "click",
                "target": "查看技能 第一技能",
                "urlAfter": "https://example.com/detail",
            }],
            "readinessSignals": [{"headings": ["第一技能 已通过安全扫描"]}],
            "accessMode": "anonymous",
            "requiredAccessMode": "anonymous",
            "navigationPathConfirmed": True,
            "evidenceConfirmed": True,
        }
        generation_guidance = []

        async def fake_generate(*args, **kwargs):
            target_case = platform.parse_cases_markdown(kwargs["cases_markdown"])[0]
            generation_guidance.append(kwargs["operator_guidance"])
            self.assertEqual(kwargs["navigation_target"], navigation_target)
            business_navigation = "await page.goto('https://example.com/business');" if len(generation_guidance) == 1 else ""
            return f"""import {{ expect, test }} from '@playwright/test';
import {{ openTargetPage, runStep }} from '{kwargs["fixture_import"]}';

test('{target_case["external_id"]} {target_case["title"]}', async ({{ page }}) => {{
  await runStep('回放已确认导航', async () => {{ await openTargetPage(page); }});
  {business_navigation}
  await runStep('验证 helper 到达后的业务结果', async () => {{
    // 主断言：{target_case["expected"]}
    await expect(page.locator('body')).toHaveAttribute('data-healed', 'true');
  }});
}});
"""

        async def fake_rerun(
            work_item_id: str,
            flow_run_id: str = "",
            on_run_created=None,
            selected_script_version_ids=None,
            debug_session_id: str = "",
        ):
            run_id, _, _ = await platform.create_work_item_draft_run(
                work_item_id,
                flow_run_id,
                selected_script_version_ids,
                debug_session_id=debug_session_id,
            )
            if on_run_created is not None:
                on_run_created(run_id)
            with platform.get_db() as conn:
                conn.execute(
                    "UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0 WHERE id = ?",
                    (platform.now_iso(), run_id),
                )
                return conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()

        with patch.object(platform, "navigation_target_for_work_item", return_value=navigation_target), patch.object(
            platform,
            "expectation_policy_mismatch_reason",
            return_value="",
        ), patch.object(
            platform,
            "generate_healed_script",
            new=AsyncMock(side_effect=fake_generate),
        ), patch.object(
            platform,
            "run_work_item_draft_once",
            new=AsyncMock(side_effect=fake_rerun),
        ):
            result = asyncio.run(platform.execute_self_healing(healing["id"]))

        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["currentRound"], 2)
        self.assertEqual(len(generation_guidance), 2)
        self.assertNotIn("上一轮候选脚本已被本地校验拒绝", generation_guidance[0])
        self.assertIn("脚本不得绕过共享导航 helper 直接调用 page.goto", generation_guidance[1])
        rejected_log = next(
            item for item in platform.healing_run_logs(healing["id"])["items"]
            if item["stepKey"] == "healing.validate" and item["level"] == "error"
        )
        self.assertTrue(rejected_log["details"]["candidateNavigation"]["containsDirectPageGoto"])
        self.assertFalse(rejected_log["details"]["candidateNavigation"]["navigationMigrated"])

    def test_case_debug_self_heal_rejects_dependency_only_failure(self):
        session = self.create_session()
        self.create_failed_debug_run_with_extra_case(session, target_status="passed", other_status="failed")

        with patch.object(platform, "require_ai", return_value=None):
            with self.assertRaisesRegex(platform.HTTPException, "失败来自依赖组中的其他用例"):
                asyncio.run(platform.self_heal_case_debug_session(session["id"], HealRequest()))

    def test_batch_preflight_accepts_same_project_cases(self):
        payload = platform.preflight_case_debug_batch(CaseDebugBatchRequest(case_ids=self.item["caseIds"]))

        self.assertEqual(payload["projectId"], self.item["projectId"])
        self.assertEqual(payload["totalCases"], 2)
        self.assertEqual(payload["readyCases"], 2)
        self.assertEqual([entry["caseId"] for entry in payload["items"]], self.item["caseIds"])

    def test_batch_preflight_rejects_cross_project_cases(self):
        project = platform.create_project(ProjectRequest(name="CODEX_TEST_DEBUG_OTHER", project_code="CODEX-DEBUG-OTHER", target_url="https://example.com"))
        feature = platform.create_feature_menu(FeatureMenuRequest(project_id=project["id"], name="CODEX_TEST_DEBUG_OTHER_FEATURE"))
        item = platform.create_work_item(WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement="验证跨项目限制。", target_url="https://example.com"))
        other = platform.generate_cases(item["id"], ContentRequest(content=CASES.splitlines()[0] + "\n" + CASES.splitlines()[1] + "\n" + CASES.splitlines()[2].replace("TC-CODEX-DEBUG-001", "TC-CODEX-DEBUG-OTHER-001"), asset_mode="append"))

        with self.assertRaisesRegex(Exception, "同一项目"):
            platform.preflight_case_debug_batch(CaseDebugBatchRequest(case_ids=[self.item["caseIds"][0], other["caseIds"][0]]))

    def test_batch_execution_continues_after_failure(self):
        sessions = [
            platform.create_case_debug_session(case["id"], CaseDebugSessionCreateRequest(expected_case_updated_at=case["updatedAt"]))
            for case in self.item["testCases"]
        ]
        batch_id = "batchcontinue"
        timestamp = platform.now_iso()
        with platform.get_db() as conn:
            conn.execute(
                "INSERT INTO case_debug_batches (id, project_id, status, total_cases, created_at, updated_at) VALUES (?, ?, 'queued', 2, ?, ?)",
                (batch_id, self.item["projectId"], timestamp, timestamp),
            )
            for position, (case_id, session) in enumerate(zip(self.item["caseIds"], sessions), start=1):
                conn.execute(
                    "INSERT INTO case_debug_batch_items (batch_id, case_id, debug_session_id, position, status) VALUES (?, ?, ?, ?, 'queued')",
                    (batch_id, case_id, session["id"], position),
                )

        calls = []

        async def fake_run(session_id, payload):
            calls.append(session_id)
            status = "failed" if len(calls) == 1 else "passed"
            run_id = f"run-{len(calls)}"
            with platform.get_db() as conn:
                conn.execute(
                    "UPDATE case_debug_sessions SET status = ?, latest_run_id = ?, updated_at = ? WHERE id = ?",
                    (status, run_id, platform.now_iso(), session_id),
                )
            return {"latestRunId": run_id}

        with patch.object(platform, "run_case_debug_session", new=AsyncMock(side_effect=fake_run)):
            asyncio.run(platform.execute_case_debug_batch(batch_id))

        batch = platform.get_case_debug_batch(batch_id)
        self.assertEqual(len(calls), 2)
        self.assertEqual([item["status"] for item in batch["items"]], ["failed", "passed"])
        self.assertEqual(batch["status"], "failed")

    def create_inactive_shared_spec(self, *, serial: bool = False):
        target_case = self.item["testCases"][0]
        other_case = self.item["testCases"][1]
        shared_content = f"""import {{ expect, test }} from '@playwright/test';

const loopCases = [
  {{ id: '{other_case["externalId"]}', title: '{other_case["title"]}' }},
] as const;

async function openPage(page) {{
  await page.goto('https://example.com');
}}

test.beforeEach(async ({{ page }}) => {{
  await openPage(page);
}});

test.describe('共享 spec', () => {{
  {"test.describe.configure({ mode: 'serial' });" if serial else ""}
  test('{target_case["externalId"]} {target_case["title"]}', async ({{ page }}) => {{
    await expect(page.locator('body')).toBeVisible();
  }});

  for (const item of loopCases) {{
    test(`${{item.id}} ${{item.title}}`, async ({{ page }}) => {{
      await expect(page.locator('body')).toBeVisible();
    }});
  }}
}});
"""
        with platform.get_db() as conn:
            item_row = conn.execute("SELECT * FROM work_items WHERE id = ?", (self.item["id"],)).fetchone()
            conn.execute(
                f"UPDATE test_case_script_bindings SET is_active = 0 WHERE case_id IN ({','.join('?' for _ in self.item['caseIds'])})",
                self.item["caseIds"],
            )
            source_id = platform.create_script_version(
                conn,
                item_row,
                shared_content,
                asset_mode="create",
                case_ids=self.item["caseIds"],
                source="external-import",
                script_layout="shared-spec",
                parameterize_content=False,
            )
            conn.execute("UPDATE test_script_versions SET status = 'failed' WHERE id = ?", (source_id,))
            for case_item in self.item["testCases"]:
                conn.execute(
                    """
                    INSERT INTO test_case_script_bindings (
                        id, case_id, script_version_id, external_id, test_title,
                        grep_pattern, is_active, bound_by_source, bound_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 0, 'external-import', ?)
                    """,
                    (
                        platform.uuid.uuid4().hex[:12],
                        case_item["id"],
                        source_id,
                        case_item["externalId"],
                        f"{case_item['externalId']} {case_item['title']}",
                        platform.case_external_id_grep_pattern(case_item["externalId"]),
                        platform.now_iso(),
                    ),
                )
        return target_case, other_case, source_id, shared_content

    def test_serial_shared_spec_defaults_to_minimum_dependency_group(self):
        target_case, other_case, _, _ = self.create_inactive_shared_spec(serial=True)
        session = platform.create_case_debug_session(target_case["id"], CaseDebugSessionCreateRequest(execution_policy="dependency-aware"))

        dependency = session["dependencyExecution"]
        self.assertEqual(dependency["recommendation"], "group")
        self.assertEqual(dependency["defaultScope"], "group")
        self.assertFalse(dependency["manualChoiceRequired"])
        self.assertEqual(set(dependency["externalIds"]), {target_case["externalId"], other_case["externalId"]})
        with self.assertRaisesRegex(platform.HTTPException, "必须执行最小依赖组"):
            asyncio.run(
                platform.create_work_item_draft_run(
                    session["workItemId"],
                    selected_script_version_ids=[session["currentScriptVersionId"]],
                    debug_session_id=session["id"],
                    debug_execution_scope="single",
                )
            )

        run_id, suite, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )
        self.assertEqual(suite["debug_execution_scope"], "group")
        self.assertEqual(set(suite["debug_scope_case_ids"]), {target_case["id"], other_case["id"]})
        self.assertEqual(len(suite["debug_scope_test_titles"]), 2)
        with platform.get_db() as conn:
            run = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        self.assertEqual(run["debug_execution_scope"], "group")
        self.assertEqual(set(platform.safe_json_loads(run["debug_scope_case_ids_json"], [])), {target_case["id"], other_case["id"]})

    def test_shared_group_healed_version_reanalyzes_dependency_scope(self):
        target_case, other_case, _, _ = self.create_inactive_shared_spec(serial=True)
        session = platform.create_case_debug_session(target_case["id"], CaseDebugSessionCreateRequest(execution_policy="dependency-aware"))
        with platform.get_db() as conn:
            item = conn.execute("SELECT * FROM work_items WHERE id = ?", (session["workItemId"],)).fetchone()
        healed_id = platform.save_healed_script(
            item,
            session["currentScriptVersion"]["content"] + "\n// group-healing verification\n",
            source_script_version_id=session["currentScriptVersionId"],
        )
        healed = platform.get_script_version(healed_id)

        self.assertEqual(healed["scriptLayout"], "shared-spec")
        analysis = healed["dependencyAnalysis"]
        self.assertEqual(analysis["cases"][target_case["externalId"]]["recommendation"], "group")
        self.assertEqual(
            set(analysis["cases"][target_case["externalId"]]["externalIds"]),
            {target_case["externalId"], other_case["externalId"]},
        )

    def test_create_reuses_work_item_and_active_session(self):
        first = self.create_session()
        second = platform.create_case_debug_session(first["caseId"], CaseDebugSessionCreateRequest())

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["workItemId"], self.item["id"])
        self.assertEqual(len(first["workItem"]["testCases"]), 1)
        self.assertNotIn("TC-CODEX-DEBUG-002", first["draftCaseMarkdown"])
        self.assertNotEqual(first["currentScriptVersionId"], first["sourceScriptVersionId"])

    def test_single_case_draft_is_isolated_from_regular_work_item(self):
        session = self.create_session(execution_policy="strict-single")
        updated_markdown = session["draftCaseMarkdown"].replace("调试目标用例", "调试目标用例草稿")

        saved = platform.save_case_debug_case_draft(
            session["id"],
            CaseDebugCaseDraftRequest(content=updated_markdown, base_case_revision_id=session["caseRevisionId"]),
        )
        regular = platform.get_work_item(self.item["id"])

        self.assertEqual(saved["case"]["title"], "调试目标用例草稿")
        self.assertEqual(saved["workItem"]["caseIds"], [session["caseId"]])
        self.assertEqual(len(saved["workItem"]["testCases"]), 1)
        self.assertEqual(len(regular["testCases"]), 2)
        self.assertNotIn("调试目标用例草稿", regular["casesMarkdown"])
        self.assertIn("不相关用例", regular["casesMarkdown"])

        with self.assertRaisesRegex(platform.HTTPException, "只能保存一条"):
            platform.save_case_debug_case_draft(
                session["id"],
                CaseDebugCaseDraftRequest(content=CASES, base_case_revision_id=saved["caseRevisionId"]),
            )

    def test_single_case_exploration_is_scoped_to_debug_session(self):
        session = self.create_session(execution_policy="strict-single")
        before = platform.get_work_item(self.item["id"])
        payload = ExplorationRequest(
            notes="CODEX_TEST_20260902 单用例探索",
            elements=[{
                "area": "body",
                "name": "单用例页面主体",
                "locatorType": "css",
                "locatorValue": "body",
                "source": "unit-test",
                "confirmed": True,
            }],
        )

        saved = platform.save_case_debug_exploration(session["id"], payload)
        after = platform.get_work_item(self.item["id"])

        self.assertEqual(saved["exploration"]["notes"], payload.notes)
        self.assertEqual(len(saved["exploration"]["elements"]), 1)
        self.assertEqual([item["name"] for item in after["elements"]], [item["name"] for item in before["elements"]])
        with platform.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM confirmed_elements WHERE debug_session_id = ?", (session["id"],)).fetchone()[0], 1)

    def test_generated_debug_script_matches_current_case_draft(self):
        session = self.create_session(execution_policy="strict-single")
        saved = platform.save_case_debug_case_draft(
            session["id"],
            CaseDebugCaseDraftRequest(
                content=session["draftCaseMarkdown"].replace("调试目标用例", "调试目标用例新草稿"),
                base_case_revision_id=session["caseRevisionId"],
            ),
        )
        platform.save_case_debug_exploration(
            session["id"],
            ExplorationRequest(
                notes="CODEX_TEST_20260902 脚本状态",
                elements=[{
                    "area": "body",
                    "name": "单用例页面主体",
                    "locatorType": "css",
                    "locatorValue": "body",
                    "source": "unit-test",
                    "confirmed": True,
                }],
            ),
        )

        generated = platform.generate_script_set(
            session["workItemId"],
            ContentRequest(asset_mode="refresh", case_ids=[session["caseId"]], debug_session_id=session["id"]),
        )
        version = max(
            (item for item in generated["scriptVersions"] if item["caseId"] == session["caseId"]),
            key=lambda item: item["version"],
        )
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE case_debug_sessions SET current_script_version_id = ?, status = 'draft', updated_at = ? WHERE id = ?",
                (version["id"], platform.now_iso(), session["id"]),
            )

        refreshed = platform.get_case_debug_session(session["id"])

        self.assertEqual(refreshed["case"]["title"], "调试目标用例新草稿")
        self.assertEqual(refreshed["currentScriptVersionId"], version["id"])
        self.assertEqual(refreshed["currentScriptVersion"]["caseDefinitionHash"], refreshed["caseDefinitionHash"])
        self.assertFalse(refreshed["stale"])
        self.assertFalse(refreshed["scriptOutdated"])

    def test_save_debug_script_automatically_updates_renamed_case_title(self):
        session = self.create_session(execution_policy="strict-single")
        renamed = platform.save_case_debug_case_draft(
            session["id"],
            CaseDebugCaseDraftRequest(
                content=session["draftCaseMarkdown"].replace("调试目标用例", "本周热门国网公文排版助手跳转"),
                base_case_revision_id=session["caseRevisionId"],
            ),
        )
        old_title = f'{session["case"]["externalId"]} {session["case"]["title"]}'
        expected_title = f'{renamed["case"]["externalId"]} {renamed["case"]["title"]}'
        old_content = session["currentScriptVersion"]["content"]
        self.assertIn(old_title, old_content)

        saved = platform.save_case_debug_script_draft(
            session["id"],
            CaseDebugScriptDraftRequest(content=old_content),
        )

        self.assertIn(expected_title, saved["currentScriptVersion"]["content"])
        self.assertNotIn(old_title, saved["currentScriptVersion"]["content"])
        self.assertEqual(saved["currentScriptVersion"]["caseDefinitionHash"], saved["caseDefinitionHash"])
        self.assertFalse(saved["scriptOutdated"])

    def test_save_debug_script_rejects_unsafe_title_rewrite(self):
        session = self.create_session(execution_policy="strict-single")
        platform.save_case_debug_case_draft(
            session["id"],
            CaseDebugCaseDraftRequest(
                content=session["draftCaseMarkdown"].replace("调试目标用例", "修改后的单用例名称"),
                base_case_revision_id=session["caseRevisionId"],
            ),
        )
        content = session["currentScriptVersion"]["content"]
        without_case_id = content.replace(
            f'{session["case"]["externalId"]} {session["case"]["title"]}',
            "完全无关的脚本标题",
        )
        with self.assertRaisesRegex(platform.HTTPException, "缺少用例 ID"):
            platform.save_case_debug_script_draft(
                session["id"],
                CaseDebugScriptDraftRequest(content=without_case_id),
            )

        multiple_tests = content + "\ntest('TC-CODEX-DEBUG-001 第二个测试', async ({ page }) => { await expect(page.locator('body')).toBeVisible(); });\n"
        with self.assertRaisesRegex(platform.HTTPException, "无法自动同步测试标题"):
            platform.save_case_debug_script_draft(
                session["id"],
                CaseDebugScriptDraftRequest(content=multiple_tests),
            )

    def test_strict_single_session_rejects_dependency_group_scope(self):
        session = self.create_session(execution_policy="strict-single")
        with self.assertRaisesRegex(platform.HTTPException, "严格单用例"):
            asyncio.run(platform.run_case_debug_session(
                session["id"],
                CaseDebugRunRequest(execution_scope="group"),
            ))

    def test_publish_applies_case_draft_without_changing_other_case(self):
        session = self.create_session(execution_policy="strict-single")
        other_case = next(item for item in self.item["testCases"] if item["id"] != session["caseId"])
        saved = platform.save_case_debug_case_draft(
            session["id"],
            CaseDebugCaseDraftRequest(
                content=session["draftCaseMarkdown"].replace("调试目标用例", "调试目标用例已验证"),
                base_case_revision_id=session["caseRevisionId"],
            ),
        )
        generated = platform.generate_script_set(
            session["workItemId"],
            ContentRequest(asset_mode="refresh", case_ids=[session["caseId"]], debug_session_id=session["id"]),
        )
        version = max(
            (item for item in generated["scriptVersions"] if item["caseId"] == session["caseId"]),
            key=lambda item: item["version"],
        )
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE case_debug_sessions SET current_script_version_id = ?, status = 'draft', updated_at = ? WHERE id = ?",
                (version["id"], platform.now_iso(), session["id"]),
            )
        run_id, _, _ = asyncio.run(platform.create_work_item_draft_run(
            session["workItemId"],
            selected_script_version_ids=[version["id"]],
            debug_session_id=session["id"],
            debug_execution_scope="single",
        ))
        with platform.get_db() as conn:
            conn.execute("UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0 WHERE id = ?", (platform.now_iso(), run_id))
            conn.execute("UPDATE run_script_versions SET result_status = 'passed' WHERE run_id = ?", (run_id,))
            conn.execute("UPDATE case_debug_sessions SET status = 'passed', latest_run_id = ? WHERE id = ?", (run_id, session["id"]))

        published = platform.publish_case_debug_session(
            session["id"],
            CaseDebugPublishRequest(run_id=run_id, script_version_id=version["id"]),
        )
        refreshed = platform.get_work_item(self.item["id"])
        refreshed_by_id = {item["id"]: item for item in refreshed["testCases"]}

        self.assertEqual(published["status"], "published")
        self.assertEqual(refreshed_by_id[session["caseId"]]["title"], "调试目标用例已验证")
        self.assertEqual(refreshed_by_id[other_case["id"]]["title"], other_case["title"])

    def test_publish_reconciles_legacy_passed_healing_hashes_for_current_draft(self):
        session = self.create_session(execution_policy="strict-single")
        saved = platform.save_case_debug_case_draft(
            session["id"],
            CaseDebugCaseDraftRequest(
                content=session["draftCaseMarkdown"].replace("调试目标用例", "调试目标用例自愈发布"),
                base_case_revision_id=session["caseRevisionId"],
            ),
        )
        generated = platform.generate_script_set(
            session["workItemId"],
            ContentRequest(asset_mode="refresh", case_ids=[session["caseId"]], debug_session_id=session["id"]),
        )
        version = max(
            (item for item in generated["scriptVersions"] if item["caseId"] == session["caseId"]),
            key=lambda item: item["version"],
        )
        run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[version["id"]],
                debug_session_id=session["id"],
                debug_execution_scope="single",
            )
        )
        legacy_hash = session["sourceCaseDefinitionHash"]
        healing_run_id = "CODEXHEAL0902"
        timestamp = platform.now_iso()
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0 WHERE id = ?",
                (timestamp, run_id),
            )
            conn.execute(
                "UPDATE run_script_versions SET result_status = 'passed', case_definition_hash = ? WHERE run_id = ? AND script_version_id = ?",
                (legacy_hash, run_id, version["id"]),
            )
            conn.execute(
                "UPDATE test_script_versions SET status = 'verified', verified_run_id = ?, case_definition_hash = ? WHERE id = ?",
                (run_id, legacy_hash, version["id"]),
            )
            conn.execute(
                "UPDATE case_debug_sessions SET current_script_version_id = ?, latest_run_id = ?, status = 'passed', updated_at = ? WHERE id = ?",
                (version["id"], run_id, timestamp, session["id"]),
            )
            conn.execute(
                """
                INSERT INTO healing_runs (
                    id, work_item_id, source_run_id, status, current_round, max_rounds,
                    latest_run_id, started_at, ended_at, debug_session_id, scope
                ) VALUES (?, ?, ?, 'passed', 1, 3, ?, ?, ?, ?, 'case')
                """,
                (healing_run_id, session["workItemId"], run_id, run_id, timestamp, timestamp, session["id"]),
            )
            conn.execute(
                """
                INSERT INTO healing_attempts (
                    healing_run_id, work_item_id, source_run_id, rerun_run_id,
                    script_version_id, round, status, result, created_at, ended_at
                ) VALUES (?, ?, ?, ?, ?, 1, 'passed', 'CODEX_TEST 旧哈希自愈通过', ?, ?)
                """,
                (healing_run_id, session["workItemId"], run_id, run_id, version["id"], timestamp, timestamp),
            )

        published = platform.publish_case_debug_session(
            session["id"],
            CaseDebugPublishRequest(run_id=run_id, script_version_id=version["id"]),
        )

        with platform.get_db() as conn:
            persisted_version_hash = conn.execute(
                "SELECT case_definition_hash FROM test_script_versions WHERE id = ?",
                (version["id"],),
            ).fetchone()["case_definition_hash"]
            persisted_run_hash = conn.execute(
                "SELECT case_definition_hash FROM run_script_versions WHERE run_id = ? AND script_version_id = ?",
                (run_id, version["id"]),
            ).fetchone()["case_definition_hash"]
        self.assertEqual(published["status"], "published")
        self.assertEqual(persisted_version_hash, saved["caseDefinitionHash"])
        self.assertEqual(persisted_run_hash, saved["caseDefinitionHash"])

    def test_publish_does_not_reconcile_unproven_hash_mismatch(self):
        session = self.create_session(execution_policy="strict-single")
        run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
                debug_execution_scope="single",
            )
        )
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0 WHERE id = ?",
                (platform.now_iso(), run_id),
            )
            conn.execute(
                "UPDATE run_script_versions SET result_status = 'passed', case_definition_hash = 'mismatch' WHERE run_id = ?",
                (run_id,),
            )
            conn.execute(
                "UPDATE test_script_versions SET status = 'verified', verified_run_id = ?, case_definition_hash = 'mismatch' WHERE id = ?",
                (run_id, session["currentScriptVersionId"]),
            )
            conn.execute(
                "UPDATE case_debug_sessions SET status = 'passed', latest_run_id = ? WHERE id = ?",
                (run_id, session["id"]),
            )

        with self.assertRaisesRegex(platform.HTTPException, "通过的 Run 与当前用例或候选脚本版本不一致"):
            platform.publish_case_debug_session(
                session["id"],
                CaseDebugPublishRequest(run_id=run_id, script_version_id=session["currentScriptVersionId"]),
            )

    def test_inactive_shared_spec_creates_full_private_branch_and_saves_multiple_tests(self):
        target_case, _, source_id, shared_content = self.create_inactive_shared_spec()

        session = platform.create_case_debug_session(
            target_case["id"],
            CaseDebugSessionCreateRequest(expected_case_updated_at=target_case["updatedAt"]),
        )

        self.assertEqual(session["sourceScriptVersionId"], source_id)
        self.assertNotEqual(session["currentScriptVersionId"], source_id)
        self.assertTrue(session["sharedScriptDebug"])
        self.assertEqual(
            session["debugGrepPattern"],
            platform.exact_test_title_grep_pattern(f"{target_case['externalId']} {target_case['title']}"),
        )
        self.assertEqual(session["currentScriptVersion"]["content"], shared_content)
        self.assertEqual(session["currentScriptVersion"]["caseId"], target_case["id"])
        self.assertEqual(session["currentScriptVersion"]["caseIds"], [target_case["id"]])
        self.assertEqual(session["currentScriptVersion"]["source"], "external-import")
        self.assertEqual(session["currentScriptVersion"]["scriptLayout"], "shared-spec")

        edited = shared_content.replace("test.describe('共享 spec'", "test.describe('共享 spec 私有分支'")
        saved = platform.save_case_debug_script_draft(
            session["id"],
            CaseDebugScriptDraftRequest(content=edited),
        )
        self.assertEqual(saved["currentScriptVersion"]["content"], edited)
        self.assertEqual(saved["currentScriptVersion"]["scriptLayout"], "shared-spec")
        self.assertEqual(saved["currentScriptVersion"]["caseIds"], [target_case["id"]])

        without_target = edited.replace(target_case["externalId"], "TC-REMOVED-001")
        with self.assertRaisesRegex(platform.HTTPException, "必须保留执行范围内的用例 ID"):
            platform.save_case_debug_script_draft(
                session["id"],
                CaseDebugScriptDraftRequest(content=without_target),
            )

    def test_shared_spec_draft_save_allows_tests_for_deleted_cases(self):
        target_case, other_case, _, shared_content = self.create_inactive_shared_spec()
        with platform.get_db() as conn:
            conn.execute("DELETE FROM test_cases WHERE id = ?", (other_case["id"],))

        session = platform.create_case_debug_session(
            target_case["id"],
            CaseDebugSessionCreateRequest(expected_case_updated_at=target_case["updatedAt"]),
        )
        saved = platform.save_case_debug_script_draft(
            session["id"],
            CaseDebugScriptDraftRequest(content=shared_content),
        )

        self.assertEqual(saved["currentScriptVersion"]["content"], shared_content)
        self.assertEqual(saved["currentScriptVersion"]["caseIds"], [target_case["id"]])

    def test_existing_empty_session_is_lazily_repaired_from_inactive_shared_spec(self):
        target_case, _, source_id, shared_content = self.create_inactive_shared_spec()
        session_id = "CODEXDBG0901"
        with platform.get_db() as conn:
            case_row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (target_case["id"],)).fetchone()
            revision_id, _ = platform.case_debug_snapshot(conn, self.item["id"], target_case["id"], session_id)
            timestamp = platform.now_iso()
            conn.execute(
                """
                INSERT INTO case_debug_sessions (
                    id, project_id, work_item_id, case_id, case_revision_id, case_definition_hash,
                    source_script_version_id, current_script_version_id, latest_run_id, status,
                    created_by, created_at, updated_at, ended_at
                ) VALUES (?, ?, ?, ?, ?, ?, '', '', '', 'draft', '', ?, ?, NULL)
                """,
                (
                    session_id,
                    case_row["project_id"],
                    self.item["id"],
                    target_case["id"],
                    revision_id,
                    platform.test_case_definition_hash(case_row),
                    timestamp,
                    timestamp,
                ),
            )

        repaired = platform.get_case_debug_session(session_id)

        self.assertEqual(repaired["sourceScriptVersionId"], source_id)
        self.assertTrue(repaired["currentScriptVersionId"])
        self.assertEqual(repaired["currentScriptVersion"]["content"], shared_content)
        with platform.get_db() as conn:
            row = conn.execute("SELECT * FROM case_debug_sessions WHERE id = ?", (session_id,)).fetchone()
        self.assertEqual(row["source_script_version_id"], source_id)
        self.assertEqual(row["current_script_version_id"], repaired["currentScriptVersionId"])

    def test_shared_spec_debug_run_uses_exact_title_grep_and_publish_only_rebinds_target(self):
        target_case, other_case, source_id, _ = self.create_inactive_shared_spec()
        session = platform.create_case_debug_session(target_case["id"], CaseDebugSessionCreateRequest())
        with patch.object(platform, "execute_case_debug_run_task", new=AsyncMock(return_value=None)) as execute_mock:
            started = asyncio.run(platform.run_case_debug_session(session["id"], CaseDebugRunRequest()))

        suite = execute_mock.call_args.args[2]
        expected_grep = platform.exact_test_titles_grep_pattern([f"{target_case['externalId']} {target_case['title']}"])
        self.assertEqual(suite["grep"], expected_grep)
        commands = platform.playwright_execution_commands("config.ts", suite["specs"], grep=suite["grep"])
        self.assertEqual(commands[-1][1][-2:], ["--grep", expected_grep])

        run_id = started["latestRunId"]
        with platform.get_db() as conn:
            other_before = [
                tuple(row)
                for row in conn.execute(
                    "SELECT script_version_id, is_active FROM test_case_script_bindings WHERE case_id = ? ORDER BY bound_at, id",
                    (other_case["id"],),
                ).fetchall()
            ]
            conn.execute("UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0 WHERE id = ?", (platform.now_iso(), run_id))
            conn.execute("UPDATE case_debug_sessions SET status = 'passed', latest_run_id = ? WHERE id = ?", (run_id, session["id"]))

        published = platform.publish_case_debug_session(
            session["id"],
            CaseDebugPublishRequest(run_id=run_id, script_version_id=session["currentScriptVersionId"]),
        )

        with platform.get_db() as conn:
            target_active = platform.active_script_binding_for_case(conn, target_case["id"])
            other_after = [
                tuple(row)
                for row in conn.execute(
                    "SELECT script_version_id, is_active FROM test_case_script_bindings WHERE case_id = ? ORDER BY bound_at, id",
                    (other_case["id"],),
                ).fetchall()
            ]
            source_row = conn.execute("SELECT status FROM test_script_versions WHERE id = ?", (source_id,)).fetchone()
        self.assertEqual(published["status"], "published")
        self.assertEqual(target_active["scriptVersionId"], session["currentScriptVersionId"])
        self.assertEqual(target_active["testTitle"], f"{target_case['externalId']} {target_case['title']}")
        self.assertEqual(
            target_active["grepPattern"],
            platform.exact_test_title_grep_pattern(f"{target_case['externalId']} {target_case['title']}"),
        )
        self.assertEqual(other_after, other_before)
        self.assertEqual(source_row["status"], "failed")

    def test_shared_spec_dynamic_case_uses_exact_rendered_title_grep(self):
        _, dynamic_case, _, _ = self.create_inactive_shared_spec()

        session = platform.create_case_debug_session(dynamic_case["id"], CaseDebugSessionCreateRequest())

        self.assertEqual(
            session["debugGrepPattern"],
            platform.exact_test_title_grep_pattern(f"{dynamic_case['externalId']} {dynamic_case['title']}"),
        )

    def test_playwright_list_preflight_selects_one_test_when_filename_contains_case_id(self):
        parent = platform.ROOT_DIR / "tests" / "e2e" / ".execution-configs"
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="CODEX_TEST_20260901_GREP_", dir=parent) as directory:
            root = Path(directory)
            config_path = root / "playwright.config.ts"
            spec_path = root / "tc-lib-001.private.spec.ts"
            config_path.write_text(
                "import { defineConfig } from '@playwright/test';\n"
                "export default defineConfig({ testDir: '.', projects: [{ name: 'chromium', use: {} }] });\n",
                encoding="utf-8",
            )
            loop_rows = ",\n".join(
                f"  {{ id: 'TC-LIB-{index:03d}', title: '用例 {index}' }}" for index in range(2, 11)
            )
            spec_path.write_text(
                f"""import {{ expect, test }} from '@playwright/test';

const cases = [
{loop_rows}
] as const;

test('TC-LIB-001 [P0] 登录后技能库页面完整展示', async ({{ page }}) => {{
  await expect(page.locator('body')).toBeVisible();
}});

for (const item of cases) {{
  test(`${{item.id}} ${{item.title}}`, async ({{ page }}) => {{
    await expect(page.locator('body')).toBeVisible();
  }});
}}
""",
                encoding="utf-8",
            )
            config = platform.relative_or_absolute(config_path)
            spec = platform.relative_or_absolute(spec_path)
            broad_command = platform.playwright_list_command(
                config,
                [spec],
                platform.case_external_id_grep_pattern("TC-LIB-001"),
            )
            broad_exit, _, broad_titles = asyncio.run(
                platform.discover_playwright_test_titles(broad_command, dict(os.environ))
            )
            exact_command = platform.playwright_list_command(
                config,
                [spec],
                platform.exact_test_title_grep_pattern("TC-LIB-001 [P0] 登录后技能库页面完整展示"),
            )
            exact_exit, _, exact_titles = asyncio.run(
                platform.discover_playwright_test_titles(exact_command, dict(os.environ))
            )
            missing_command = platform.playwright_list_command(
                config,
                [spec],
                platform.exact_test_title_grep_pattern("TC-LIB-999 不存在的测试"),
            )
            missing_exit, _, missing_titles = asyncio.run(
                platform.discover_playwright_test_titles(missing_command, dict(os.environ))
            )
            group_titles = ["TC-LIB-001 [P0] 登录后技能库页面完整展示", "TC-LIB-002 用例 2"]
            group_command = platform.playwright_list_command(
                config,
                [spec],
                platform.exact_test_titles_grep_pattern(group_titles),
            )
            group_exit, _, discovered_group_titles = asyncio.run(
                platform.discover_playwright_test_titles(group_command, dict(os.environ))
            )

        self.assertEqual(broad_exit, 0)
        self.assertEqual(len(broad_titles), 10)
        self.assertEqual(exact_exit, 0)
        self.assertEqual(exact_titles, ["TC-LIB-001 [P0] 登录后技能库页面完整展示"])
        self.assertNotEqual(missing_exit, 0)
        self.assertEqual(missing_titles, [])
        self.assertEqual(group_exit, 0)
        self.assertEqual(set(discovered_group_titles), set(group_titles))

    def test_debug_scope_preflight_blocks_before_browser_when_multiple_tests_match(self):
        target_case, _, _, _ = self.create_inactive_shared_spec()
        session = platform.create_case_debug_session(target_case["id"], CaseDebugSessionCreateRequest())
        run_id, suite, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )
        suite["grep"] = platform.case_external_id_grep_pattern(target_case["externalId"])
        with patch.object(
            platform,
            "probe_target_url",
            return_value={"ok": True, "status": 200, "elapsed_ms": 1, "error": ""},
        ), patch.object(
            platform,
            "write_execution_playwright_config",
            return_value="playwright.config.ts",
        ), patch.object(
            platform,
            "discover_playwright_test_titles",
            new=AsyncMock(return_value=(0, "", ["target", "other"])),
        ), patch.object(
            platform,
            "start_live_execution_session",
            new=AsyncMock(),
        ) as start_browser:
            asyncio.run(platform.run_playwright(run_id, suite, session["workItemId"]))

        start_browser.assert_not_awaited()
        with platform.get_db() as conn:
            run = conn.execute("SELECT status, failure_category, failure_reason FROM runs WHERE id = ?", (run_id,)).fetchone()
        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["failure_category"], "script-structure")
        self.assertIn("预期 1 条，实际 2 条", platform.run_log_text(run_id))

    def test_shared_spec_without_unique_test_title_is_blocked_before_run_creation(self):
        target_case, other_case, source_id, _ = self.create_inactive_shared_spec()
        with platform.get_db() as conn:
            target_binding = conn.execute(
                "SELECT test_title FROM test_case_script_bindings WHERE case_id = ? AND script_version_id = ?",
                (target_case["id"], source_id),
            ).fetchone()
            conn.execute(
                "UPDATE test_case_script_bindings SET test_title = ? WHERE case_id = ? AND script_version_id = ?",
                (target_binding["test_title"], other_case["id"], source_id),
            )
        session = platform.create_case_debug_session(target_case["id"], CaseDebugSessionCreateRequest())

        self.assertEqual(session["debugGrepPattern"], "")
        with self.assertRaisesRegex(platform.HTTPException, "唯一完整测试标题"):
            asyncio.run(platform.run_case_debug_session(session["id"], CaseDebugRunRequest()))

    def test_selected_debug_run_contains_only_target_script(self):
        session = self.create_session()
        run_id, suite, version_ids = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )

        self.assertEqual(len(suite["specs"]), 1)
        self.assertEqual(version_ids, [session["currentScriptVersionId"]])
        with platform.get_db() as conn:
            links = conn.execute("SELECT * FROM run_script_versions WHERE run_id = ?", (run_id,)).fetchall()
            run = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0]["case_id"], session["caseId"])
        self.assertEqual(run["debug_session_id"], session["id"])

    def test_save_legacy_navigation_draft_creates_new_fixture_and_preserves_history(self):
        session = self.create_session()
        legacy_fixture_id = "legacyfixture"
        legacy_fixture = """import { test } from '@playwright/test';

export const TARGET_URL = 'https://example.com';

export async function runStep(title: string, action: () => Promise<void>) {
  await test.step(title, action);
}
"""
        legacy_script = f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '../fixtures/{legacy_fixture_id}';

test('{session["case"]["externalId"]} {session["case"]["title"]}', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{
    await page.goto(TARGET_URL, {{ waitUntil: 'commit', timeout: 20_000 }});
  }});
  await runStep('验证页面', async () => {{
    await expect(page.locator('body')).toBeVisible();
  }});
}});
"""
        with platform.get_db() as conn:
            current = conn.execute(
                "SELECT * FROM test_script_versions WHERE id = ?",
                (session["currentScriptVersionId"],),
            ).fetchone()
            fixture_path = platform.fixture_version_path(
                conn.execute("SELECT * FROM work_items WHERE id = ?", (session["workItemId"],)).fetchone(),
                current["generation_batch_id"],
                legacy_fixture_id,
            )
            platform.resolve_workspace_path(fixture_path).write_text(legacy_fixture, encoding="utf-8")
            conn.execute(
                """
                INSERT INTO test_fixture_versions (
                    id, project_id, work_item_id, version, status, file_path,
                    content, content_hash, created_at, updated_at
                ) VALUES (?, ?, ?, 99, 'active', ?, ?, ?, ?, ?)
                """,
                (
                    legacy_fixture_id,
                    current["project_id"],
                    current["work_item_id"],
                    fixture_path,
                    legacy_fixture,
                    platform.content_hash(legacy_fixture),
                    platform.now_iso(),
                    platform.now_iso(),
                ),
            )
            conn.execute(
                "UPDATE test_script_versions SET content = ?, content_hash = ?, fixture_version_id = ? WHERE id = ?",
                (
                    legacy_script,
                    platform.content_hash(legacy_script),
                    legacy_fixture_id,
                    current["id"],
                ),
            )
            platform.resolve_workspace_path(current["spec_path"]).write_text(legacy_script, encoding="utf-8")

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
            saved = platform.save_case_debug_script_draft(
                session["id"],
                CaseDebugScriptDraftRequest(content=legacy_script),
            )

        self.assertNotEqual(saved["currentScriptVersionId"], session["currentScriptVersionId"])
        self.assertIn("openTargetPage(page)", saved["currentScriptVersion"]["content"])
        self.assertNotIn("page.goto(", saved["currentScriptVersion"]["content"])
        self.assertNotEqual(saved["currentScriptVersion"]["fixtureVersionId"], legacy_fixture_id)
        self.assertIn("export async function openTargetPage", saved["currentScriptVersion"]["fixtureVersion"]["content"])
        with platform.get_db() as conn:
            previous = conn.execute(
                "SELECT content, fixture_version_id FROM test_script_versions WHERE id = ?",
                (session["currentScriptVersionId"],),
            ).fetchone()
            stored_legacy_fixture = conn.execute(
                "SELECT content FROM test_fixture_versions WHERE id = ?",
                (legacy_fixture_id,),
            ).fetchone()
        self.assertEqual(previous["content"], legacy_script)
        self.assertEqual(previous["fixture_version_id"], legacy_fixture_id)
        self.assertEqual(stored_legacy_fixture["content"], legacy_fixture)

    def test_repeated_modern_navigation_draft_save_reuses_fixture(self):
        session = self.create_session()
        fixture_id = session["currentScriptVersion"]["fixtureVersionId"]
        with platform.get_db() as conn:
            fixture_count = conn.execute("SELECT COUNT(*) FROM test_fixture_versions").fetchone()[0]

        first = platform.save_case_debug_script_draft(
            session["id"],
            CaseDebugScriptDraftRequest(content=session["currentScriptVersion"]["content"]),
        )
        second = platform.save_case_debug_script_draft(
            session["id"],
            CaseDebugScriptDraftRequest(content=first["currentScriptVersion"]["content"]),
        )

        with platform.get_db() as conn:
            saved_fixture_count = conn.execute("SELECT COUNT(*) FROM test_fixture_versions").fetchone()[0]
        self.assertEqual(first["currentScriptVersion"]["fixtureVersionId"], fixture_id)
        self.assertEqual(second["currentScriptVersion"]["fixtureVersionId"], fixture_id)
        self.assertEqual(saved_fixture_count, fixture_count)
        self.assertEqual(second["currentScriptVersion"]["content"].count("openTargetPage"), 2)

    def test_business_goto_is_not_auto_migrated(self):
        session = self.create_session()
        fixture_import = f"../fixtures/{session['currentScriptVersion']['fixtureVersionId']}"
        script = f"""import {{ expect, test }} from '@playwright/test';
import {{ openTargetPage, runStep }} from '{fixture_import}';

test('{session["case"]["externalId"]} {session["case"]["title"]}', async ({{ page }}) => {{
  await openTargetPage(page);
  await page.goto('https://example.com/business');
  await runStep('验证页面', async () => {{
    await expect(page.locator('body')).toBeVisible();
  }});
}});
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
            with self.assertRaisesRegex(platform.HTTPException, "不得绕过共享导航 helper"):
                platform.save_case_debug_script_draft(
                    session["id"],
                    CaseDebugScriptDraftRequest(content=script),
                )

    def test_case_change_blocks_debug_run(self):
        session = self.create_session()
        platform.update_test_case(session["caseId"], TestCasePatchRequest(title="调试目标用例已更新"))

        with self.assertRaisesRegex(platform.HTTPException, "同步最新用例"):
            asyncio.run(platform.run_case_debug_session(session["id"], CaseDebugRunRequest()))

    def test_publish_replaces_only_target_active_binding(self):
        session = self.create_session()
        with platform.get_db() as conn:
            other_case_id = next(case_id for case_id in self.item["caseIds"] if case_id != session["caseId"])
            other_before = platform.active_script_binding_for_case(conn, other_case_id)["scriptVersionId"]
        run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )
        with platform.get_db() as conn:
            conn.execute("UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0 WHERE id = ?", (platform.now_iso(), run_id))
            conn.execute("UPDATE case_debug_sessions SET status = 'passed', latest_run_id = ? WHERE id = ?", (run_id, session["id"]))

        published = platform.publish_case_debug_session(
            session["id"],
            CaseDebugPublishRequest(run_id=run_id, script_version_id=session["currentScriptVersionId"]),
        )

        with platform.get_db() as conn:
            target_after = platform.active_script_binding_for_case(conn, session["caseId"])["scriptVersionId"]
            other_after = platform.active_script_binding_for_case(conn, other_case_id)["scriptVersionId"]
            deliverables = conn.execute(
                "SELECT type, case_id, run_id FROM deliverables WHERE work_item_id = ? AND run_id = ? ORDER BY type",
                (session["workItemId"], run_id),
            ).fetchall()
        self.assertEqual(published["status"], "published")
        self.assertEqual(target_after, session["currentScriptVersionId"])
        self.assertEqual(other_after, other_before)
        self.assertEqual([row["type"] for row in deliverables], ["html-report", "spec"])
        self.assertTrue(all(row["case_id"] == session["caseId"] for row in deliverables))

    def test_debug_permission_matrix_limits_publish_to_admin_and_lead(self):
        self.assertEqual(
            platform.path_permission("/api/case-debug-sessions/session-1/publish", "POST"),
            {"admin", "lead"},
        )
        self.assertEqual(
            platform.path_permission("/api/case-debug-sessions/session-1/run", "POST"),
            {"admin", "lead", "executor"},
        )
        self.assertEqual(
            platform.path_permission("/api/case-debug-sessions/session-1", "GET"),
            platform.USER_ROLES,
        )

    def test_run_endpoint_schedules_only_selected_version(self):
        session = self.create_session()
        with patch.object(platform, "execute_case_debug_run_task", new=AsyncMock(return_value=None)):
            started = asyncio.run(platform.run_case_debug_session(session["id"], CaseDebugRunRequest()))
        self.assertEqual(started["status"], "running")
        self.assertEqual(started["latestRun"]["debugSessionId"], session["id"])

    def test_self_healing_confirms_same_non_script_failure_once_then_blocks(self):
        session = self.create_session()
        source_run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )
        with platform.get_db() as conn:
            version = conn.execute(
                "SELECT * FROM test_script_versions WHERE id = ?",
                (session["currentScriptVersionId"],),
            ).fetchone()
            case = conn.execute("SELECT * FROM test_cases WHERE id = ?", (session["caseId"],)).fetchone()
            conn.execute(
                "UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?",
                (platform.now_iso(), source_run_id),
            )
            conn.execute(
                "UPDATE run_script_versions SET result_status = 'failed' WHERE run_id = ?",
                (source_run_id,),
            )
            conn.execute(
                "UPDATE test_script_versions SET status = 'failed', verified_run_id = ? WHERE id = ?",
                (source_run_id, version["id"]),
            )
            conn.execute(
                "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'error', ?)",
                (source_run_id, platform.now_iso(), f"  ✘  1 [chromium] › {Path(version['spec_path']).name}:4:1 › {case['external_id']}"),
            )
        platform.update_work_item(session["workItemId"], stage="运行验证", status="failed", latest_run_id=source_run_id)
        healing = platform.create_healing_run_record(
            session["workItemId"],
            source_run_id,
            debug_session_id=session["id"],
            scope="case",
        )
        rerun_scopes = []

        async def fake_rerun(
            work_item_id: str,
            flow_run_id: str = "",
            on_run_created=None,
            selected_script_version_ids=None,
            debug_session_id: str = "",
        ):
            selected = list(selected_script_version_ids or [])
            rerun_scopes.append(selected)
            run_id, _, _ = await platform.create_work_item_draft_run(
                work_item_id,
                flow_run_id,
                selected,
                debug_session_id=debug_session_id,
            )
            if on_run_created is not None:
                on_run_created(run_id)
            with platform.get_db() as conn:
                conn.execute(
                    "UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?",
                    (platform.now_iso(), run_id),
                )
                conn.execute(
                    "UPDATE run_script_versions SET result_status = 'failed' WHERE run_id = ?",
                    (run_id,),
                )
                return conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()

        diagnosis = {
            "category": "test-data-environment",
            "confidence": "high",
            "signature": "same-auth-rejection",
            "summary": "有效登录用例被应用明确拒绝。",
            "evidence": ["用户名或密码错误", "提交后仍停留在登录页"],
            "action": "confirm",
            "target": case["external_id"],
        }
        generate = AsyncMock(return_value="")
        with patch.object(platform, "diagnose_healing_target", return_value=diagnosis), patch.object(
            platform,
            "generate_healed_script",
            new=generate,
        ), patch.object(
            platform,
            "run_work_item_draft_once",
            new=AsyncMock(side_effect=fake_rerun),
        ):
            result = asyncio.run(platform.execute_self_healing(healing["id"]))

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["currentRound"], 1)
        self.assertEqual(result["diagnosis"]["category"], "test-data-environment")
        self.assertEqual(result["diagnosis"]["action"], "block")
        self.assertEqual(rerun_scopes, [[session["currentScriptVersionId"]]])
        generate.assert_not_awaited()
        healing_logs = platform.healing_run_logs(healing["id"])["items"]
        healing_messages = [item["message"] for item in healing_logs]
        healing_step_labels = [item["stepLabel"] for item in healing_logs]
        self.assertTrue(any("启动自愈诊断" in message for message in healing_messages))
        self.assertIn("读取失败证据", healing_step_labels)
        self.assertIn("自愈诊断阻塞", healing_step_labels)

    def test_healing_logs_are_independent_and_support_incremental_reads(self):
        session = self.create_session()
        source_run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )
        with platform.get_db() as conn:
            source_log_count = conn.execute("SELECT COUNT(*) FROM logs WHERE run_id = ?", (source_run_id,)).fetchone()[0]
        healing = platform.create_healing_run_record(
            session["workItemId"],
            source_run_id,
            debug_session_id=session["id"],
            scope="case",
        )

        initial = platform.healing_run_logs(healing["id"])
        self.assertTrue(any(item["stepKey"] == "healing.lifecycle" for item in initial["items"]))

        platform.write_healing_log(
            healing["id"],
            "info",
            "读取失败证据",
            round=1,
            step_key="healing.diagnose",
            step_label="读取失败证据",
        )
        latest = platform.healing_run_logs(healing["id"], after=initial["items"][-1]["id"])
        self.assertEqual([item["message"] for item in latest["items"]], ["读取失败证据"])

        with platform.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM logs WHERE run_id = ?", (source_run_id,)).fetchone()[0], source_log_count)

    def test_self_healing_repairs_script_target_and_confirms_environment_target_together(self):
        session = self.create_session()
        with platform.get_db() as conn:
            other_case = conn.execute(
                "SELECT * FROM test_cases WHERE work_item_id = ? AND id != ? ORDER BY id LIMIT 1",
                (session["workItemId"], session["caseId"]),
            ).fetchone()
            other_version = platform.active_script_binding_for_case(conn, other_case["id"])["scriptVersionId"]
        selected_source_versions = [session["currentScriptVersionId"], other_version]
        source_run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=selected_source_versions,
            )
        )
        with platform.get_db() as conn:
            conn.execute(
                "UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?",
                (platform.now_iso(), source_run_id),
            )
            conn.execute(
                "UPDATE run_script_versions SET result_status = 'failed' WHERE run_id = ?",
                (source_run_id,),
            )
            for version_id in selected_source_versions:
                conn.execute(
                    "UPDATE test_script_versions SET status = 'failed', verified_run_id = ? WHERE id = ?",
                    (source_run_id, version_id),
                )
                version = conn.execute("SELECT * FROM test_script_versions WHERE id = ?", (version_id,)).fetchone()
                case = conn.execute("SELECT * FROM test_cases WHERE id = ?", (version["case_id"],)).fetchone()
                conn.execute(
                    "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'error', ?)",
                    (source_run_id, platform.now_iso(), f"  ✘  1 [chromium] › {Path(version['spec_path']).name}:4:1 › {case['external_id']}"),
                )
        platform.update_work_item(session["workItemId"], stage="运行验证", status="failed", latest_run_id=source_run_id)
        healing = platform.create_healing_run_record(session["workItemId"], source_run_id)
        rerun_scopes = []

        def fake_diagnosis(item, target_version, target_case, cases_markdown, failure_log):
            if target_case["id"] == session["caseId"]:
                return {
                    "category": "test-data-environment",
                    "confidence": "high",
                    "signature": "stable-environment-signature",
                    "summary": "环境问题待确认。",
                    "evidence": ["应用明确拒绝"],
                    "action": "confirm",
                    "target": target_case["external_id"],
                }
            return {
                "category": "test-code",
                "confidence": "high",
                "signature": "locator-signature",
                "summary": "locator 需要修复。",
                "evidence": ["element not found"],
                "action": "repair",
                "target": target_case["external_id"],
            }

        async def fake_generate(*args, **kwargs):
            target_case = platform.parse_cases_markdown(kwargs["cases_markdown"])[0]
            target = f"{target_case['external_id']} {target_case['title']}"
            return f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{kwargs["fixture_import"]}';

test('{target}', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{ await page.goto(TARGET_URL); }});
  // 主断言：页面显示
  await runStep('验证页面', async () => {{ await expect(page.locator('body')).toBeVisible(); }});
}});
"""

        async def fake_rerun(
            work_item_id: str,
            flow_run_id: str = "",
            on_run_created=None,
            selected_script_version_ids=None,
            debug_session_id: str = "",
        ):
            selected = list(selected_script_version_ids or [])
            rerun_scopes.append(selected)
            run_id, _, _ = await platform.create_work_item_draft_run(work_item_id, flow_run_id, selected)
            if on_run_created is not None:
                on_run_created(run_id)
            with platform.get_db() as conn:
                conn.execute(
                    "UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?",
                    (platform.now_iso(), run_id),
                )
                conn.execute(
                    "UPDATE run_script_versions SET result_status = CASE WHEN case_id = ? THEN 'failed' ELSE 'passed' END WHERE run_id = ?",
                    (session["caseId"], run_id),
                )
                return conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()

        generate = AsyncMock(side_effect=fake_generate)
        with patch.object(platform, "diagnose_healing_target", side_effect=fake_diagnosis), patch.object(
            platform,
            "generate_healed_script",
            new=generate,
        ), patch.object(
            platform,
            "run_work_item_draft_once",
            new=AsyncMock(side_effect=fake_rerun),
        ):
            result = asyncio.run(platform.execute_self_healing(healing["id"]))

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(generate.await_count, 1)
        self.assertEqual(len(rerun_scopes), 1)
        self.assertEqual(len(rerun_scopes[0]), 2)
        self.assertIn(session["currentScriptVersionId"], rerun_scopes[0])
        self.assertNotIn(other_version, rerun_scopes[0])

    def test_case_scoped_self_healing_stops_after_subset_passes(self):
        session = self.create_session()
        source_run_id, _, _ = asyncio.run(
            platform.create_work_item_draft_run(
                session["workItemId"],
                selected_script_version_ids=[session["currentScriptVersionId"]],
                debug_session_id=session["id"],
            )
        )
        with platform.get_db() as conn:
            version = conn.execute(
                "SELECT * FROM test_script_versions WHERE id = ?",
                (session["currentScriptVersionId"],),
            ).fetchone()
            case = conn.execute("SELECT * FROM test_cases WHERE id = ?", (session["caseId"],)).fetchone()
            conn.execute(
                "UPDATE runs SET status = 'failed', ended_at = ?, exit_code = 1 WHERE id = ?",
                (platform.now_iso(), source_run_id),
            )
            conn.execute(
                "UPDATE test_script_versions SET status = 'failed', verified_run_id = ? WHERE id = ?",
                (source_run_id, version["id"]),
            )
            conn.execute(
                "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'error', ?)",
                (source_run_id, platform.now_iso(), f"  ✘  1 [chromium] › {Path(version['spec_path']).name}:4:1 › {case['external_id']}"),
            )
        platform.update_work_item(session["workItemId"], stage="运行验证", status="failed", latest_run_id=source_run_id)
        healing = platform.create_healing_run_record(
            session["workItemId"],
            source_run_id,
            debug_session_id=session["id"],
            scope="case",
        )
        rerun_scopes = []

        async def fake_generate(*args, **kwargs):
            target_case = platform.parse_cases_markdown(kwargs["cases_markdown"])[0]
            target = f"{target_case['external_id']} {target_case['title']}"
            return f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{kwargs["fixture_import"]}';

test('{target}', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{ await page.goto(TARGET_URL); }});
  // 主断言：页面显示
  await runStep('验证页面', async () => {{ await expect(page.locator('body')).toBeVisible(); }});
}});
"""

        async def fake_rerun(
            work_item_id: str,
            flow_run_id: str = "",
            on_run_created=None,
            selected_script_version_ids=None,
            debug_session_id: str = "",
        ):
            rerun_scopes.append((list(selected_script_version_ids or []), debug_session_id))
            run_id, _, _ = await platform.create_work_item_draft_run(
                work_item_id,
                flow_run_id,
                selected_script_version_ids,
                debug_session_id=debug_session_id,
            )
            if on_run_created is not None:
                on_run_created(run_id)
            with platform.get_db() as conn:
                conn.execute(
                    "UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0 WHERE id = ?",
                    (platform.now_iso(), run_id),
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
            result = asyncio.run(platform.execute_self_healing(healing["id"]))

        self.assertEqual(result["status"], "passed")
        self.assertEqual(len(rerun_scopes), 1)
        self.assertEqual(len(rerun_scopes[0][0]), 1)
        self.assertEqual(rerun_scopes[0][1], session["id"])


if __name__ == "__main__":
    unittest.main()
