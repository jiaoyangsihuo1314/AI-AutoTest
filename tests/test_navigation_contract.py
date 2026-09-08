import sqlite3
import unittest

from backend.app import platform


class NavigationContractTests(unittest.TestCase):
    def test_navigation_target_preserves_url_shapes_and_replay_steps(self):
        item = {
            "target_url": "https://example.test/app/#/home?from=qa",
            "requirement": "无需登录即可打开详情页",
            "acceptance": "详情标题可见",
            "role": "匿名访问",
        }
        result = {
            "requestedUrl": "https://example.test/app/?tenant=one#/home?from=qa",
            "resolvedUrl": "https://example.test/app/?tenant=one#/detail/42?from=qa",
            "stateEvidence": [
                {
                    "stateKey": "detail",
                    "url": "https://example.test/app/?tenant=one#/detail/42?from=qa",
                    "title": "详情",
                    "headings": ["详情"],
                }
            ],
        }
        target = platform.navigation_target_from_result(
            item,
            result,
            [
                {
                    "action": "click",
                    "status": "passed",
                    "urlBefore": result["requestedUrl"],
                    "urlAfter": result["resolvedUrl"],
                    "resolvedTarget": {
                        "locatorType": "role",
                        "locatorRole": "link",
                        "locatorValue": "详情",
                    },
                }
            ],
        )

        self.assertEqual(target["requestedUrl"], result["requestedUrl"])
        self.assertEqual(target["resolvedUrl"], result["resolvedUrl"])
        self.assertEqual(target["navigationSteps"][0]["urlAfter"], result["resolvedUrl"])
        self.assertEqual(target["accessMode"], "anonymous")
        self.assertTrue(target["evidenceConfirmed"])

    def test_fixture_uses_contract_without_guessing_routes(self):
        item = {"target_url": "https://example.test/products?tenant=one#/home"}
        target = {
            "requestedUrl": "https://example.test/products?tenant=one#/home",
            "resolvedUrl": "https://example.test/products?tenant=one#/detail/42",
            "navigationSteps": [],
            "readinessSignals": [{"headings": ["详情"]}],
            "accessMode": "anonymous",
            "requiredAccessMode": "anonymous",
            "directNavigationAllowed": True,
            "navigationPathConfirmed": True,
            "evidenceConfirmed": True,
        }
        fixture = platform.default_fixture_content(item, target)

        self.assertIn("export const NAVIGATION_TARGET", fixture)
        self.assertIn("export async function openTargetPage", fixture)
        self.assertIn("export function navigationUrlsEquivalent", fixture)
        self.assertIn("navigationUrlsEquivalent(resolved", fixture)
        self.assertIn("navigation-precondition: resolved URL mismatch", fixture)
        self.assertNotIn("requested + 'rank'", fixture)
        self.assertNotIn("requested + \"rank\"", fixture)

    def test_fixture_validation_ignores_unbalanced_delimiters_inside_page_evidence_text(self):
        item = {"target_url": "https://example.test/"}
        target = {
            "requestedUrl": "https://example.test/",
            "resolvedUrl": "https://example.test/",
            "navigationSteps": [],
            "readinessSignals": [{"texts": ["商品规格（测试版", "库存 [可用"]}],
            "accessMode": "anonymous",
            "requiredAccessMode": "anonymous",
            "directNavigationAllowed": True,
            "navigationPathConfirmed": True,
            "evidenceConfirmed": True,
        }

        fixture = platform.default_fixture_content(item, target)

        platform.validate_fixture_content(fixture)
        self.assertTrue(platform.basic_typescript_shape_valid(fixture))

    def test_default_spa_root_hashes_are_equivalent(self):
        variants = [
            "http://example.test",
            "http://example.test/",
            "http://example.test/#",
            "http://example.test/#/",
            "http://example.test/#!/",
        ]

        for expected in variants:
            for actual in variants:
                with self.subTest(expected=expected, actual=actual):
                    self.assertTrue(platform.navigation_urls_equivalent(expected, actual))

    def test_navigation_equivalence_keeps_business_routes_query_and_origin_strict(self):
        self.assertFalse(platform.navigation_urls_equivalent("http://example.test/#/login", "http://example.test/#/detail"))
        self.assertFalse(platform.navigation_urls_equivalent("http://example.test/?tenant=one#/", "http://example.test/?tenant=two#/"))
        self.assertFalse(platform.navigation_urls_equivalent("http://example.test/#/", "https://example.test/#/"))

    def test_navigation_target_keeps_one_short_replay_path(self):
        item = {"target_url": "https://example.test/#/", "requirement": "无需登录查看详情"}
        result = {
            "resolvedUrl": "https://example.test/#/detail",
            "stateEvidence": [
                {
                    "url": "https://example.test/#/detail",
                    "headings": ["详情"],
                    "caseIds": ["TC-FAST"],
                }
            ],
        }
        steps = [
            {"action": "click", "status": "passed", "caseId": "TC-SLOW", "urlAfter": "https://example.test/#/menu"},
            {"action": "click", "status": "passed", "caseId": "TC-SLOW", "urlAfter": "https://example.test/#/detail"},
            {"action": "click", "status": "passed", "caseId": "TC-SLOW", "urlAfter": "https://example.test/#/after"},
            {"action": "click", "status": "passed", "caseId": "TC-FAST", "urlAfter": "https://example.test/#/detail"},
            {"action": "click", "status": "passed", "caseId": "TC-FAST", "urlAfter": "https://example.test/#/after"},
        ]

        target = platform.navigation_target_from_result(item, result, steps)

        self.assertEqual(len(target["navigationSteps"]), 1)
        self.assertEqual(target["navigationSteps"][0]["caseId"], "TC-FAST")
        self.assertEqual(target["navigationSteps"][0]["urlAfter"], result["resolvedUrl"])

    def test_missing_readiness_signal_blocks_exploration(self):
        item = {"requirement": "无需登录查看详情"}
        result = {
            "navigationTarget": {
                "requestedUrl": "https://example.test/",
                "resolvedUrl": "https://example.test/",
                "readinessSignals": [],
                "accessMode": "anonymous",
            },
            "targetCoverage": {},
        }

        reason = platform.exploration_block_reason(item, {"status": "passed"}, result)

        self.assertTrue(reason.startswith("navigation-precondition"))

    def test_incomplete_nested_target_does_not_become_confirmed(self):
        target = platform.navigation_target_from_result(
            {"target_url": "https://example.test/"},
            {
                "navigationTarget": {
                    "requestedUrl": "https://example.test/",
                    "resolvedUrl": "https://example.test/",
                    "readinessSignals": [],
                    "evidenceConfirmed": False,
                }
            },
        )

        self.assertFalse(target["evidenceConfirmed"])

    def test_strict_navigation_script_must_use_shared_helper(self):
        case = {"external_id": "TC-NAV-001", "title": "查看详情"}
        script = """import { expect, test } from '@playwright/test';
import { TARGET_URL } from './fixture';
test('TC-NAV-001 查看详情', async ({ page }) => {
  await page.goto(TARGET_URL);
  await expect(page.getByRole('heading', { name: '详情' })).toBeVisible();
});
"""
        target = {
            "evidenceConfirmed": True,
            "readinessSignals": [{"headings": ["详情"]}],
            "navigationPathConfirmed": True,
        }

        error = platform.valid_case_playwright_script(script, case, [], "./fixture", navigation_target=target)

        self.assertIn("navigation-precondition", error)

    def test_healing_prompt_explains_confirmed_navigation_replay_and_forbids_duplicate_actions(self):
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-DISC-008 | P0 | 本周热门任一技能跳转 | 技能详情 | 首页存在热门技能卡 | 点击第一张技能卡 | 详情页展示技能名称和安全扫描状态 | 自动化 |
"""
        target = {
            "requestedUrl": "http://skillhub.test/#/",
            "resolvedUrl": "http://skillhub.test/#/s/isc-login-integration",
            "navigationSteps": [{
                "action": "click",
                "target": "查看技能 ISC单点登录集成",
                "urlAfter": "http://skillhub.test/#/s/isc-login-integration",
            }],
            "readinessSignals": [{"headings": ["ISC单点登录集成 已通过安全扫描"]}],
            "navigationPathConfirmed": True,
            "evidenceConfirmed": True,
        }

        prompt = platform.healed_script_prompt(
            {
                "id": "CODEX_TEST_NAV_PROMPT",
                "title": "技能详情",
                "requirement": "点击热门技能进入详情页",
                "target_url": "http://skillhub.test/#/",
            },
            "await openTargetPage(page);",
            {"spec": "tc-disc-008.spec.ts"},
            "locator.waitFor timeout",
            [],
            cases_markdown=cases_markdown,
            fixture_import="../fixtures/current",
            navigation_target=target,
        )

        self.assertIn("openTargetPage(page)` 已负责打开 requested URL", prompt)
        self.assertIn("click 查看技能 ISC单点登录集成", prompt)
        self.assertIn("不得在测试体中重复执行", prompt)
        self.assertIn("不得直接调用 `page.goto(...)`", prompt)
        self.assertNotIn("优先把导航改为 `waitUntil: 'commit'`", prompt)

    def test_healing_prompt_keeps_generic_goto_guidance_without_confirmed_contract(self):
        prompt = platform.healed_script_prompt(
            {
                "id": "CODEX_TEST_NAV_FALLBACK",
                "title": "普通页面",
                "requirement": "打开普通页面",
                "target_url": "https://example.test",
            },
            "await page.goto(TARGET_URL);",
            {"spec": "ordinary.spec.ts"},
            "page.goto timeout",
            [],
            navigation_target={"evidenceConfirmed": False},
        )

        self.assertIn("优先把导航改为 `waitUntil: 'commit'`", prompt)
        self.assertNotIn("当前运行存在已确认的共享导航契约", prompt)

    def test_manual_script_dependency_migrates_only_confirmed_target_goto(self):
        script = """import { expect, test } from '@playwright/test';
import { TARGET_URL, runStep } from '../fixtures/legacy';
test('TC-NAV-001 查看详情', async ({ page }) => {
  await runStep('打开页面', async () => {
    await page.goto(TARGET_URL, { waitUntil: 'commit', timeout: 20_000 });
  });
  await expect(page.locator('body')).toBeVisible();
});
"""

        migrated = platform.ensure_case_fixture_dependency(
            script,
            "../fixtures/current",
            migrate_navigation=True,
        )

        self.assertIn("from '../fixtures/current'", migrated)
        self.assertIn("openTargetPage", migrated)
        self.assertIn("await openTargetPage(page);", migrated)
        self.assertNotIn("page.goto(", migrated)

    def test_manual_script_dependency_leaves_business_goto_for_validator(self):
        script = """import { expect, test } from '@playwright/test';
import { openTargetPage, runStep } from '../fixtures/current';
test('TC-NAV-001 查看详情', async ({ page }) => {
  await openTargetPage(page);
  await page.goto('https://example.test/business');
  await expect(page.locator('body')).toBeVisible();
});
"""

        migrated = platform.ensure_case_fixture_dependency(
            script,
            "../fixtures/current",
            migrate_navigation=True,
        )

        self.assertIn("page.goto('https://example.test/business')", migrated)

    def test_access_mode_conflict_blocks_exploration(self):
        item = {"requirement": "无需登录查看详情"}
        result = {
            "navigationTarget": {
                "requestedUrl": "https://example.test/",
                "resolvedUrl": "https://example.test/detail",
                "navigationSteps": [{"action": "click"}],
                "readinessSignals": [{"headings": ["详情"]}],
                "navigationPathConfirmed": True,
                "requiredAccessMode": "anonymous",
                "accessMode": "authentication-required",
            }
        }

        reason = platform.exploration_block_reason(item, {"status": "passed"}, result)

        self.assertIn("访问模式", reason)

    def test_blocked_run_does_not_fail_script_version(self):
        conn = sqlite3.connect(":memory:")
        conn.execute(
            "CREATE TABLE test_script_versions (id TEXT PRIMARY KEY, status TEXT, verified_run_id TEXT, updated_at TEXT)"
        )
        conn.execute(
            "INSERT INTO test_script_versions VALUES ('script-1', 'draft', '', 'before')"
        )

        platform.update_script_version_run(conn, "script-1", "run-blocked", "blocked")

        row = conn.execute("SELECT status, verified_run_id, updated_at FROM test_script_versions WHERE id = 'script-1'").fetchone()
        self.assertEqual(row, ("draft", "", "before"))

    def test_failure_classification_distinguishes_navigation_and_assertions(self):
        self.assertEqual(
            platform.execution_failure_classification("blocked", "navigation-precondition: route mismatch")[0],
            "navigation-precondition",
        )
        self.assertEqual(
            platform.execution_failure_classification("failed", "expect(received).toBe(expected)")[0],
            "business-assertion",
        )

    def test_failure_classification_identifies_login_credentials_without_exposing_values(self):
        category, reason = platform.execution_failure_classification(
            "failed",
            "loginAsTestUser /api/auth/login\nExpected: 0\nReceived: 401\n用户名或密码错误",
        )

        self.assertEqual(category, "environment-configuration")
        self.assertIn("QA_USERNAME", reason)
        self.assertIn("QA_PASSWORD", reason)
        self.assertNotIn("401", reason)

    def test_canary_and_business_batch_use_separate_commands(self):
        commands = platform.playwright_execution_commands(
            "config.ts",
            ["case-1.spec.ts", "case-2.spec.ts"],
            navigation_canary="navigation-canary.spec.ts",
            grep="TC-NAV",
        )

        self.assertEqual([phase for phase, _ in commands], ["导航 Canary", "业务用例批次"])
        self.assertIn("navigation-canary.spec.ts", commands[0][1])
        self.assertNotIn("case-1.spec.ts", commands[0][1])
        self.assertIn("case-1.spec.ts", commands[1][1])
        self.assertIn("--grep", commands[1][1])
        self.assertNotIn("--max-failures=1", " ".join(commands[0][1] + commands[1][1]))


if __name__ == "__main__":
    unittest.main()
