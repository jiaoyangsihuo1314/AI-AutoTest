import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.app import platform


class CaseGenerationQualityTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.original_db_path = platform.DB_PATH
        platform.DB_PATH = Path(self.tempdir.name) / "case-quality.sqlite"
        platform.init_db()
        self.project = platform.create_project(platform.ProjectRequest(
            name="CODEX_TEST_20260831_CASE_QUALITY",
            project_code="CODEX-CASE-QUALITY",
        ))
        self.feature = platform.create_feature_menu(platform.FeatureMenuRequest(
            project_id=self.project["id"],
            name="CODEX_TEST_20260831_技能库",
        ))
        self.requirement = (
            "帮我测试下http://192.168.7.181:8080/#/ 网站的技能库页面的相关功能，"
            "无需登录，包括页面的展示、发布skill按钮的页面跳转功能"
        )
        analysis = platform.fallback_requirement_analysis(
            self.requirement,
            target_url="http://192.168.7.181:8080/#/",
            acceptance="技能库页面可在无需登录的情况下访问；页面展示正常；点击发布skill按钮后发生页面跳转。",
        )
        with patch.object(platform, "analyze_requirement_with_ai", return_value=analysis):
            self.work = platform.create_work_item(platform.WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                requirement=self.requirement,
                target_url="http://192.168.7.181:8080/#/",
                acceptance=analysis["acceptance"],
            ))
        self.item = platform.get_work_item_row(self.work["id"])
        self.analysis = platform.requirement_analysis(self.item)
        self.context = {
            "navigationTargets": [
                {"name": "技能库", "role": "link", "href": "http://192.168.7.181:8080/#/skills"},
                {"name": "发布", "role": "link", "href": "http://192.168.7.181:8080/#/publish"},
            ],
            "datasets": [],
        }

    def tearDown(self):
        platform.DB_PATH = self.original_db_path
        self.tempdir.cleanup()

    def test_structured_fallback_splits_explicit_acceptance_items(self):
        content = platform.default_cases(self.item, self.context)
        cases = platform.parse_cases_markdown(content)
        quality = platform.case_quality_report(content, self.analysis, allow_pending_evidence=True)

        self.assertEqual(len(cases), 3)
        self.assertEqual(
            [case["title"] for case in cases],
            [
                "无需登录进入技能库页面成功",
                "技能库核心内容完整展示",
                "未登录点击发布完成页面跳转",
            ],
        )
        self.assertTrue(quality["valid"])
        self.assertEqual((quality["covered"], quality["required"]), (3, 3))
        self.assertIn("点击导航栏“技能库”", cases[1]["steps"])

    def test_quality_gate_rejects_generic_placeholder_case(self):
        content = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-GENERIC-001 | P0 | 冒烟主流程满足已明确验收标准 | 全部需求 | 页面可访问 | 打开目标页面；按需求完成核心操作；观察结果 | 页面出现与明确验收标准对应的核心成功状态 | 自动化 |
"""
        quality = platform.case_quality_report(content, self.analysis)

        self.assertFalse(quality["valid"])
        self.assertTrue(any("通用占位表达" in error for error in quality["errors"]))
        self.assertTrue(any("建议按独立结果拆分" in warning for warning in quality["warnings"]))

    def test_all_false_ai_acceptance_items_are_promoted_to_core_requirements(self):
        raw = {
            "goal": "覆盖登录、加购和进入结账流程",
            "acceptance": "用户可以完成登录、加购并进入结账流程",
            "acceptanceItems": [
                {"id": "A1", "kind": "interaction", "description": "用户能够完成登录操作。", "target": "登录功能", "evidenceRequired": False},
                {"id": "A2", "kind": "interaction", "description": "登录后能够添加商品到购物车。", "target": "购物车添加商品功能", "evidenceRequired": False},
                {"id": "A3", "kind": "navigation", "description": "用户能够从购物车进入结账流程。", "target": "结账流程入口", "evidenceRequired": False},
            ],
        }

        normalized = platform.normalize_requirement_analysis(raw, "测试登录、加购和结账", "ai")

        self.assertTrue(all(item["evidenceRequired"] for item in normalized["acceptanceItems"]))
        self.assertTrue(any("已将用户明确提出的验收项" in warning for warning in normalized["warnings"]))

    def test_ai_timeout_returns_observable_fallback_reason(self):
        with (
            patch.object(platform, "get_openai_api_key", return_value="CODEX_TEST_KEY"),
            patch.object(platform, "get_openai_model", return_value="CODEX_TEST_MODEL"),
            patch.object(platform, "get_openai_base_url", return_value="https://example.test/v1"),
            patch.object(platform, "call_openai_responses_stream", side_effect=TimeoutError()),
        ):
            result = platform.stream_ai_test_cases_sync(self.item, "CODEX_TEST_ARTIFACT", self.context)

        self.assertEqual(result["source"], "fallback")
        self.assertEqual(result["reasonCode"], "ai-request-failed")
        self.assertIn("连接超时", result["reason"])

    def test_exploration_refines_routes_and_preserves_revision_history(self):
        draft = platform.default_cases(self.item, self.context)
        generated = platform.generate_cases(
            self.item["id"],
            platform.ContentRequest(content=draft, generation_source="fallback", asset_mode="create"),
        )
        snapshots = {
            case["id"]: {
                "updatedAt": case["updatedAt"],
                "titleSource": case["titleSource"],
                "externalId": case["externalId"],
            }
            for case in generated["testCases"]
        }
        external_ids = [case["externalId"] for case in generated["testCases"]]
        exploration_payload = {
            "steps": [
                {"caseId": external_ids[0], "status": "passed", "urlBefore": "http://host/#/", "urlAfter": "http://host/#/skills"},
                {"caseId": external_ids[1], "status": "passed", "urlBefore": "http://host/#/skills", "urlAfter": "http://host/#/skills"},
                {
                    "caseId": external_ids[2],
                    "status": "passed",
                    "urlBefore": "http://host/#/skills",
                    "urlAfter": "http://host/#/login?redirect=/publish",
                    "resolvedTarget": {"name": "发布 Skill"},
                },
            ],
            "result": {
                "stateEvidence": [
                    {"caseIds": [external_ids[0]], "url": "http://host/#/skills", "headings": ["技能库"]},
                    {"caseIds": [external_ids[1]], "url": "http://host/#/skills", "headings": ["技能库"]},
                    {"caseIds": [external_ids[2]], "url": "http://host/#/login?redirect=/publish", "headings": ["登录 SkillHub"]},
                ]
            },
        }

        refinement = platform.refine_cases_with_exploration_evidence(
            self.item,
            generated["casesMarkdown"],
            self.analysis,
            exploration_payload,
            snapshots,
            "2000-01-01T00:00:00+00:00",
        )

        self.assertTrue(refinement["valid"], refinement.get("reason"))
        self.assertIn("浏览器地址进入 #/skills", refinement["content"])
        self.assertIn("未登录点击发布 Skill跳转登录页", refinement["content"])
        self.assertIn("浏览器地址进入 #/login?redirect=/publish", refinement["content"])

        before_count = self._revision_count()
        platform.generate_cases(
            self.item["id"],
            platform.ContentRequest(
                content=refinement["content"],
                generation_source="evidence-refined",
                asset_mode="refresh",
                case_ids=refinement["caseIds"],
            ),
        )
        self.assertEqual(self._revision_count(), before_count + 1)

    def test_exploration_refinement_stops_after_concurrent_edit(self):
        draft = platform.default_cases(self.item, self.context)
        generated = platform.generate_cases(
            self.item["id"],
            platform.ContentRequest(content=draft, generation_source="fallback", asset_mode="create"),
        )
        snapshots = {
            case["id"]: {
                "updatedAt": case["updatedAt"],
                "titleSource": case["titleSource"],
                "externalId": case["externalId"],
            }
            for case in generated["testCases"]
        }
        first = generated["testCases"][0]
        platform.update_test_case(first["id"], platform.TestCasePatchRequest(title="人工确认名称", title_mode="manual"))

        refinement = platform.refine_cases_with_exploration_evidence(
            self.item,
            generated["casesMarkdown"],
            self.analysis,
            {"steps": [], "result": {"stateEvidence": []}},
            snapshots,
            "2000-01-01T00:00:00+00:00",
        )

        self.assertFalse(refinement["valid"])
        self.assertIn(first["externalId"], refinement["reason"])
        self.assertIn("人工修改", refinement["reason"])

    def test_navigation_contract_uses_readiness_for_resolved_url(self):
        item = {
            "target_url": "http://host/#/",
            "requirement": "匿名访问首页并进入技能库",
            "acceptance": "首页可匿名访问",
            "role": "匿名访客",
        }
        result = {
            "stateEvidence": [
                {"stateKey": "initial", "url": "http://host/#/skills", "headings": ["技能库"], "caseIds": ["TC-002"]},
                {"stateKey": "initial", "url": "http://host/#/", "headings": ["首页标题"], "caseIds": ["TC-001"]},
            ]
        }

        target = platform.navigation_target_from_result(item, result, [])

        self.assertEqual(target["resolvedUrl"], "http://host/#/")
        self.assertEqual(len(target["readinessSignals"]), 1)
        self.assertEqual(target["readinessSignals"][0]["headings"], ["首页标题"])

    def test_flow_artifact_metadata_is_persisted(self):
        artifact_id = platform.create_flow_artifact(
            "CODEX_TEST_FLOW_METADATA",
            self.item["id"],
            "用例设计",
            "test-cases",
            "测试用例",
            "content",
            status="fallback",
            source="fallback",
            metadata={"reason": "CODEX_TEST timeout", "quality": {"covered": 3, "required": 3}},
        )

        artifact = platform.flow_artifact_by_id(artifact_id)

        self.assertEqual(artifact["metadata"]["reason"], "CODEX_TEST timeout")
        self.assertEqual(artifact["metadata"]["quality"], {"covered": 3, "required": 3})

    def test_skill_library_cases_share_required_state_without_rewriting(self):
        cases = [
            {"external_id": "TC-001", "priority": "P0", "title": "无需登录进入技能库页面成功", "requirement": "无需登录", "preconditions": "", "steps": "打开需求指定 URL；等待目标页面加载完成", "expected": "浏览器地址进入 #/", "automation_notes": ""},
            {"external_id": "TC-002", "priority": "P0", "title": "未登录点击技能库跳转目标页面", "requirement": "进入技能库", "preconditions": "", "steps": "进入技能库页面；点击“技能库”", "expected": "浏览器地址进入 #/skills", "automation_notes": ""},
            {"external_id": "TC-003", "priority": "P0", "title": "技能库核心内容完整展示", "requirement": "技能库页面正常展示", "preconditions": "", "steps": "进入技能库页面；查看分类、部门和排序方式", "expected": "技能库页面展示核心筛选控件、技能数量和技能列表", "automation_notes": ""},
            {"external_id": "TC-004", "priority": "P0", "title": "发布 Skill 入口正常显示", "requirement": "技能库存在发布 Skill", "preconditions": "", "steps": "查看发布 Skill", "expected": "发布 Skill 在技能库页面可见", "automation_notes": ""},
            {"external_id": "TC-005", "priority": "P0", "title": "未登录点击发布跳转登录页", "requirement": "点击发布跳转", "preconditions": "", "steps": "进入技能库页面；点击“发布”", "expected": "浏览器地址进入 #/login?redirect=/publish", "automation_notes": ""},
        ]
        item = {"id": "CODEX_TEST_STATE_WORK", "target_url": "http://host/#/", "requirement": "匿名访问技能库并检查发布入口"}
        preflight = {
            "final_url": "http://host/#/",
            "elements": [
                {"tag": "a", "name": "技能库", "locatorType": "role", "locatorRole": "link", "locatorValue": "技能库", "href": "http://host/#/skills"},
                {"tag": "a", "name": "发布", "locatorType": "role", "locatorRole": "link", "locatorValue": "发布", "href": "http://host/#/publish"},
            ],
        }

        draft, _ = platform.compile_exploration_plan_v5(item, cases, preflight)
        assignments = {item["caseId"]: item for item in draft["caseStateAssignments"]}

        self.assertEqual(assignments["TC-001"]["requiredState"], "root")
        for case_id in ("TC-002", "TC-003", "TC-004", "TC-005"):
            self.assertEqual(assignments[case_id]["requiredState"], "skills")
        self.assertEqual(assignments["TC-005"]["destinationState"], "publish-gate")
        self.assertIn("TC-002", {case["caseId"] for case in draft["blockedCases"]})
        skills_journey = next(journey for journey in draft["journeys"] if set(journey["caseIds"]) == {"TC-003", "TC-004"})
        self.assertEqual(skills_journey["requiredState"], "skills")
        self.assertEqual(sum(step["action"] == "click" for step in skills_journey["steps"]), 1)

    def test_medium_exploration_allows_one_proven_p0_and_degrades_other_cases(self):
        generated = platform.generate_cases(
            self.item["id"],
            platform.ContentRequest(content=platform.default_cases(self.item, self.context), asset_mode="create"),
        )
        external_ids = [case["externalId"] for case in generated["testCases"]]
        result = {
            "navigationTarget": {
                "requestedUrl": self.item["target_url"],
                "resolvedUrl": self.item["target_url"],
                "readinessSignals": [{"selector": "body"}],
                "navigationPathConfirmed": True,
                "requiredAccessMode": "anonymous",
                "accessMode": "anonymous",
            },
            "quality": {
                "level": "medium",
                "provenCaseIds": [external_ids[0]],
                "scriptableCaseIds": [external_ids[0]],
                "blockedCaseIds": external_ids[1:],
            },
            "caseEvidenceCoverage": [
                {"caseId": external_ids[0], "passed": True},
                {"caseId": external_ids[1], "passed": False, "expectedState": "skills", "reachedState": "unreached"},
            ],
        }

        self.assertEqual(platform.exploration_block_reason(self.item, {"status": "failed"}, result), "")

    def test_locator_auto_confirmation_accepts_css_80_but_rejects_text_and_raw_selector(self):
        elements = [
            {"locatorType": "css", "locatorValue": "#submit", "locatorRole": "", "confidence": 80, "matchCount": 1, "autoConfirmEligible": True},
            {"locatorType": "text", "locatorValue": "提交", "locatorRole": "", "confidence": 99, "matchCount": 1, "autoConfirmEligible": True},
            {"locatorType": "selector", "locatorValue": ".submit", "locatorRole": "", "confidence": 99, "matchCount": 1, "autoConfirmEligible": True},
        ]

        confirmed, count = platform.auto_confirm_exploration_result({"resolved_elements": elements, "elements": elements})

        self.assertEqual(count, 1)
        self.assertTrue(confirmed["elements"][0]["confirmed"])
        self.assertFalse(confirmed["elements"][1]["confirmed"])
        self.assertFalse(confirmed["elements"][2]["confirmed"])

    def test_missing_account_data_is_partial_instead_of_blocked(self):
        account_item = {
            "target_url": "https://example.test/login",
            "requirement": "登录后查看个人中心",
            "acceptance": "账号登录成功后展示个人中心",
            "role": "注册用户",
            "test_data": "",
        }

        resolution, _ = platform.build_automation_data_context(account_item, {})

        self.assertEqual(resolution["category"], "account-required")
        self.assertEqual(resolution["status"], "partial")
        self.assertEqual(resolution["source"], "missing-account")

    def test_one_click_missing_account_policy_blocks_and_lists_missing_fields(self):
        account_item = {
            "title": "SauceDemo 购物结账流程",
            "target_url": "https://www.saucedemo.com",
            "requirement": "测试登录、添加商品到购物车、进入结账流程",
            "acceptance": "用户可以完成登录、加购和进入结账",
            "role": "普通用户",
            "test_data": "",
            "exclusions": "",
        }
        preflight = {"final_url": "https://www.saucedemo.com/", "structure": {"hasPasswordInput": True}}

        resolution, _ = platform.build_automation_data_context(
            account_item,
            preflight,
            missing_account_policy="block",
        )

        self.assertEqual(resolution["status"], "blocked")
        self.assertEqual(resolution["missingFields"], ["username", "password"])
        self.assertIn("登录及其后的业务场景均未执行", resolution["reason"])
        self.assertIn("用户名 standard_user、密码 secret_sauce", resolution["actionRequired"])

    def test_one_click_partial_credentials_report_only_missing_field(self):
        base_item = {
            "title": "SauceDemo 登录",
            "target_url": "https://www.saucedemo.com",
            "requirement": "测试 SauceDemo 登录",
            "acceptance": "登录成功",
            "role": "普通用户",
            "exclusions": "",
        }
        preflight = {"final_url": "https://www.saucedemo.com/", "structure": {"hasPasswordInput": True}}

        username_only, _ = platform.build_automation_data_context(
            {**base_item, "test_data": "用户名 standard_user"},
            preflight,
            missing_account_policy="block",
        )
        password_only, _ = platform.build_automation_data_context(
            {**base_item, "test_data": "密码 secret_sauce"},
            preflight,
            missing_account_policy="block",
        )

        self.assertEqual(username_only["missingFields"], ["password"])
        self.assertEqual(password_only["missingFields"], ["username"])

    def test_combined_account_password_format_is_canonical_and_does_not_match_user_suffix(self):
        details = platform.parse_test_data_details("账号密码：standard_user    secret_sauce")

        self.assertEqual(details["values"], {"username": "standard_user", "password": "secret_sauce"})
        self.assertEqual(details["invalidFields"], [])
        self.assertEqual(platform.extract_test_data("账号密码：standard_user    secret_sauce"), "username=standard_user\npassword=secret_sauce")
        self.assertEqual(platform.parse_test_data("standard_user secret_sauce"), {})

    def test_requirement_credentials_override_conflicting_ai_analysis(self):
        normalized = platform.normalize_requirement_analysis(
            {
                "testData": "username=secret_sauce\npassword=standard_user",
                "environment": "https://www.saucedemo.com",
            },
            "测试 SauceDemo 登录。账号密码：standard_user secret_sauce",
            "ai",
        )

        self.assertEqual(normalized["testData"], "username=standard_user\npassword=secret_sauce")
        self.assertTrue(any("与用户原文冲突" in warning for warning in normalized["warnings"]))

    def test_invalid_saucedemo_credential_pair_blocks_before_exploration(self):
        item = {
            "title": "SauceDemo 登录",
            "target_url": "https://www.saucedemo.com",
            "requirement": "验证登录、加购和结账",
            "acceptance": "登录成功",
            "role": "普通用户",
            "test_data": "username=secret_sauce\npassword=standard_user",
            "exclusions": "",
        }

        resolution, _ = platform.build_automation_data_context(
            item,
            {"final_url": "https://www.saucedemo.com/", "structure": {"hasPasswordInput": True}},
            missing_account_policy="block",
        )

        self.assertEqual(resolution["status"], "blocked")
        self.assertEqual(resolution["source"], "invalid-account")
        self.assertEqual(resolution["invalidFields"], ["username", "password"])
        self.assertIn("对应关系有误", resolution["reason"])

    def test_login_failure_precedes_readiness_error_and_records_root_cause(self):
        result = {
            "navigationTarget": {
                "requestedUrl": "https://www.saucedemo.com",
                "resolvedUrl": "https://www.saucedemo.com/",
                "readinessSignals": [],
                "navigationPathConfirmed": True,
            },
            "quality": {"level": "low", "reasons": ["目标页面导航路径或 readiness 证据不足"]},
        }
        payload = {
            "status": "failed",
            "steps": [
                {
                    "caseId": "TC-CODEX-LOGIN",
                    "action": "click",
                    "target": "Login",
                    "description": "点击 Login 并进入商品列表",
                    "status": "failed",
                    "urlAfter": "https://www.saucedemo.com/",
                    "error": "page.waitForFunction timeout",
                },
                {"caseId": "TC-CODEX-CART", "action": "click", "target": "Add to cart", "status": "skipped"},
            ],
        }

        reason = platform.exploration_block_reason(self.item, payload, result)

        self.assertIn("登录未成功", reason)
        self.assertNotIn("readiness signal", reason)
        self.assertEqual(result["rootCause"]["code"], "credential-invalid")
        self.assertEqual(result["rootCause"]["details"]["skippedCaseIds"], ["TC-CODEX-CART"])

    def test_true_readiness_failure_keeps_readiness_missing_root_cause(self):
        result = {
            "navigationTarget": {
                "requestedUrl": "https://example.test",
                "resolvedUrl": "https://example.test",
                "readinessSignals": [],
                "navigationPathConfirmed": True,
            },
        }

        reason = platform.exploration_block_reason(self.item, {"status": "passed", "steps": []}, result)

        self.assertIn("readiness signal", reason)
        self.assertEqual(result["rootCause"]["code"], "readiness-missing")

    def test_saucedemo_one_click_filters_unrequested_negative_and_remove_cases(self):
        item = {
            "title": "SauceDemo 购物流程",
            "target_url": "https://www.saucedemo.com",
            "requirement": "验证登录、添加商品到购物车并进入结账流程",
            "acceptance": "登录成功后完成加购并进入结账信息页",
        }
        markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SAUCE-001 | P0 | 有效账号登录成功 | 登录 | 有效账号 | 输入账号密码；点击 Login | 进入商品页 | 自动化 |
| TC-SAUCE-002 | P1 | 空用户名提示错误 | 登录异常 | 用户名为空 | 清空用户名；点击 Login | 显示错误 | 自动化 |
| TC-SAUCE-003 | P1 | 颠倒凭据登录失败 | 登录异常 | 颠倒凭据 | 输入颠倒凭据；点击 Login | 显示错误 | 自动化 |
| TC-SAUCE-004 | P2 | 移除商品后购物车为空 | 购物车 | 已加购 | 点击 Remove | 购物车为空 | 自动化 |
"""

        filtered, removed = platform.filter_out_of_scope_saucedemo_cases(markdown, item)

        self.assertEqual(removed, ["空用户名提示错误", "颠倒凭据登录失败", "移除商品后购物车为空"])
        self.assertIn("TC-SAUCE-001", filtered)
        self.assertNotIn("TC-SAUCE-002", filtered)
        self.assertNotIn("TC-SAUCE-003", filtered)
        self.assertNotIn("TC-SAUCE-004", filtered)

    def test_original_saucedemo_flow_blocks_in_requirement_analysis_before_case_generation(self):
        requirement = "测试下https://www.saucedemo.com 的登录、添加商品到购物车、进入结账流程"
        raw_analysis = {
            "suggestedTitle": "SauceDemo购物结账流程",
            "goal": "覆盖 SauceDemo 登录、添加商品到购物车、进入结账流程",
            "userPath": "访问网站 -> 登录 -> 加购 -> 进入购物车 -> 进入结账",
            "acceptance": "用户可以完成登录、添加商品到购物车并进入结账流程",
            "acceptanceItems": [
                {"id": "A1", "kind": "interaction", "description": "用户能够完成登录操作。", "target": "登录功能", "evidenceRequired": False},
                {"id": "A2", "kind": "interaction", "description": "登录后能够添加商品到购物车。", "target": "购物车添加商品功能", "evidenceRequired": False},
                {"id": "A3", "kind": "navigation", "description": "用户能够从购物车进入结账流程。", "target": "结账流程入口", "evidenceRequired": False},
            ],
            "role": "未明确",
            "testData": "未提供测试数据，生成脚本前需补齐或在探索中确认",
            "environment": "https://www.saucedemo.com",
            "exclusions": "不完成订单",
            "missing": ["登录使用的账号和密码未提供。"],
            "clarificationNeeded": True,
            "source": "ai",
        }
        with patch.object(platform, "analyze_requirement_with_ai", return_value=raw_analysis):
            work = platform.create_work_item(platform.WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                requirement=requirement,
                target_url="https://www.saucedemo.com",
            ))
        flow_id = "CODEX_TEST_20260904_MISSING_ACCOUNT"
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO automation_flow_runs (
                    id, work_item_id, feature_id, status, stage, progress, current_attempt,
                    latest_run_id, latest_exploration_run_id, asset_mode, case_ids_json,
                    started_at, ended_at
                ) VALUES (?, ?, ?, 'queued', '需求分析', 0, 0, '', '', 'create', '[]', ?, NULL)
                """,
                (flow_id, work["id"], self.feature["id"], platform.now_iso()),
            )
        preflight = {
            "final_url": "https://www.saucedemo.com/",
            "title": "Swag Labs",
            "structure": {"hasPasswordInput": True, "forms": 1, "inputs": 2, "buttons": 1, "links": 0},
            "elements": [],
            "responses": [],
        }

        with (
            patch.object(platform, "analyze_requirement_with_ai", return_value=raw_analysis),
            patch.object(platform, "discover_page", new=AsyncMock(return_value=preflight)),
        ):
            asyncio.run(platform.execute_automation_flow(flow_id))

        flow = platform.get_automation_flow_payload(flow_id)
        self.assertEqual(flow["status"], "blocked")
        self.assertEqual(flow["stage"], "需求分析")
        self.assertIn("登录流程缺少用户名、密码", flow["error"])
        self.assertNotIn("质量门禁", flow["error"])
        self.assertEqual(flow["dataResolution"]["missingFields"], ["username", "password"])
        with platform.get_db() as conn:
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM generated_cases WHERE work_item_id = ?",
                (work["id"],),
            ).fetchone()[0], 0)

    def test_saucedemo_fallback_builds_three_business_p0_cases_with_explicit_credentials(self):
        requirement = (
            "测试下 https://www.saucedemo.com 的登录、添加商品到购物车、进入结账流程。"
            "测试数据为用户名 standard_user、密码 secret_sauce。"
        )
        analysis = platform.fallback_requirement_analysis(
            requirement,
            target_url="https://www.saucedemo.com",
            test_data="用户名 standard_user、密码 secret_sauce",
            acceptance="用户可以完成登录、添加商品到购物车并进入结账流程",
            exclusions="不完成订单",
        )
        self.assertEqual(
            [item["kind"] for item in analysis["acceptanceItems"]],
            ["interaction", "interaction", "navigation"],
        )
        with patch.object(platform, "analyze_requirement_with_ai", return_value=analysis):
            work = platform.create_work_item(platform.WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                requirement=requirement,
                target_url="https://www.saucedemo.com",
                test_data="用户名 standard_user、密码 secret_sauce",
            ))
        item = platform.get_work_item_row(work["id"])

        content = platform.default_cases(item, {})
        cases = platform.parse_cases_markdown(content)
        quality = platform.case_quality_report(content, platform.requirement_analysis(item), allow_pending_evidence=True)

        self.assertEqual([case["title"] for case in cases], [
            "有效账号登录成功",
            "商品成功加入购物车",
            "从购物车进入结账信息页",
        ])
        self.assertTrue(all(case["priority"] == "P0" for case in cases))
        self.assertIn("第一个稳定、可见且启用的商品", cases[1]["steps"])
        self.assertEqual(cases[2]["expected"], "浏览器进入 checkout-step-one.html")
        self.assertTrue(quality["valid"], quality)
        plan, diagnostics = platform.compile_exploration_plan_v5(item, cases, {
            "final_url": "https://www.saucedemo.com/",
            "structure": {"hasPasswordInput": True},
            "elements": [],
        })
        normalized_plan = platform.validate_and_normalize_exploration_plan(plan, item, cases, {})
        checkout_journey = next(journey for journey in normalized_plan["journeys"] if cases[2]["external_id"] in journey["caseIds"])
        self.assertEqual(diagnostics["domainContract"], "saucedemo")
        self.assertEqual(plan["plannedCaseIds"], [case["external_id"] for case in cases])
        self.assertEqual(
            [step["action"] for step in checkout_journey["steps"]],
            ["navigate", "fill", "fill", "click", "click", "click", "click", "snapshot"],
        )
        self.assertNotIn("continue", " ".join(step["description"].lower() for step in checkout_journey["steps"]))
        self.assertNotIn("finish", " ".join(step["description"].lower() for step in checkout_journey["steps"]))
        cart_script = platform.saucedemo_case_script(item, cases[1], "../fixtures/CODEX_TEST_FIXTURE")
        self.assertIn("const requestedProduct = \"\";", cart_script)
        self.assertIn("requiredCredential('QA_USERNAME')", cart_script)
        self.assertIn("requiredCredential('QA_PASSWORD')", cart_script)
        self.assertNotIn("secret_sauce", cart_script)
        self.assertNotIn("Sauce Labs Backpack", cart_script)
        self.assertEqual(platform.playwright_expect_call_count(cart_script), 1)
        self.assertEqual(
            platform.valid_case_playwright_script(
                cart_script,
                cases[1],
                [],
                "../fixtures/CODEX_TEST_FIXTURE",
                enforce_single_primary=True,
            ),
            "",
        )

    def test_saucedemo_script_fallback_rejects_missing_credentials(self):
        requirement = "测试下 https://www.saucedemo.com 的登录、添加商品到购物车、进入结账流程"
        analysis = platform.fallback_requirement_analysis(requirement, target_url="https://www.saucedemo.com")
        with patch.object(platform, "analyze_requirement_with_ai", return_value=analysis):
            work = platform.create_work_item(platform.WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                requirement=requirement,
                target_url="https://www.saucedemo.com",
            ))

        with self.assertRaises(platform.HTTPException) as raised:
            platform.default_script(platform.get_work_item_row(work["id"]), [])

        self.assertIn("缺少用户名、密码", str(raised.exception.detail))
        self.assertIn("禁止使用内置默认账号", str(raised.exception.detail))

    def test_generated_credential_template_is_migrated_idempotently(self):
        item = {
            "test_data": "用户名 standard_user、密码 secret_sauce",
            "requirement": "验证 SauceDemo 登录",
        }
        legacy = """import { test } from '@playwright/test';

const username = \"standard_user\";
const password = \"secret_sauce\";

function sauce(page: Page, testId: string) {
  return page.locator(`[data-test=\"${testId}\"]`);
}
"""
        secured = platform.secure_generated_script_credentials(legacy, item)

        self.assertIn("requiredCredential('QA_USERNAME')", secured)
        self.assertIn("requiredCredential('QA_PASSWORD')", secured)
        self.assertNotIn("secret_sauce", secured)
        self.assertEqual(platform.secure_generated_script_credentials(secured, item), secured)
        self.assertEqual(platform.secure_generated_script_credentials(legacy, {**item, "test_data": "用户名 other、密码 changed123"}), legacy)

    def test_saucedemo_checkout_external_ids_keep_six_distinct_case_scopes(self):
        item = {
            "id": "CODEX_TEST_20260904_SAUCE_SCOPE",
            "title": "SauceDemo 购物流程",
            "target_url": "https://www.saucedemo.com",
            "requirement": "验证登录、商品展示、加购、购物车和进入结账流程",
            "test_data": "账号：standard_user；密码：secret_sauce",
        }
        prefix = "TC-SAUCEDEMO-CODEX-SD-CHECKOUT"
        cases = [
            {"external_id": f"{prefix}-001", "priority": "P0", "title": "访问目标地址展示登录页", "requirement": "访问 SauceDemo 登录页面", "preconditions": "目标 URL", "steps": "打开目标 URL", "expected": "浏览器停留在 SauceDemo 登录页", "automation_notes": "登录表单可见"},
            {"external_id": f"{prefix}-002", "priority": "P0", "title": "有效账号登录进入商品页", "requirement": "使用有效账号成功登录", "preconditions": "账号和密码可用", "steps": "打开目标 URL；输入账号和密码；点击 Login", "expected": "浏览器进入商品列表页", "automation_notes": "断言 URL 包含 inventory.html"},
            {"external_id": f"{prefix}-003", "priority": "P0", "title": "登录成功显示商品列表", "requirement": "登录成功后展示商品列表或商品页面", "preconditions": "已登录成功", "steps": "完成登录；等待商品页面加载", "expected": "商品列表页展示可购买商品记录", "automation_notes": "断言 inventory item 数量大于 0"},
            {"external_id": f"{prefix}-004", "priority": "P0", "title": "添加首个商品更新购物车", "requirement": "选择商品并添加到购物车", "preconditions": "已登录并位于商品列表页", "steps": "记录首个商品名称；点击首个商品的 Add to cart 按钮", "expected": "购物车角标显示 1", "automation_notes": "不硬编码商品名称"},
            {"external_id": f"{prefix}-005", "priority": "P0", "title": "已添加商品显示在购物车", "requirement": "购物车中展示已添加的商品", "preconditions": "已将一个商品加入购物车", "steps": "点击购物车入口；读取购物车商品名称", "expected": "购物车页面展示本次添加的商品名称", "automation_notes": "与同次运行记录名称比较"},
            {"external_id": f"{prefix}-006", "priority": "P0", "title": "购物车结账进入信息页", "requirement": "从购物车进入结账流程", "preconditions": "当前位于购物车页面", "steps": "点击 Checkout 按钮", "expected": "浏览器地址为 https://www.saucedemo.com/checkout-step-one.html", "automation_notes": "不填写结账信息或提交订单"},
        ]

        scopes = [platform.saucedemo_case_scope(case) for case in cases]
        plan = platform.saucedemo_exploration_plan(item, cases)
        normalized = platform.validate_and_normalize_exploration_plan(plan, item, cases, {})
        assignments = {assignment["caseId"]: assignment for assignment in plan["caseStateAssignments"]}
        targets = {target["targetId"]: target for target in plan["targets"]}

        self.assertEqual(scopes, ["login-page", "login", "inventory", "add", "cart", "checkout"])
        self.assertEqual(
            [assignments[case["external_id"]]["semanticDestinationState"] for case in cases],
            ["login-page", "inventory", "inventory", "inventory-added", "cart", "checkout"],
        )
        self.assertEqual(len({assignments[case["external_id"]]["destinationState"] for case in cases}), 6)
        self.assertEqual(targets["sauce-checkout"]["caseIds"], [cases[5]["external_id"]])
        self.assertEqual(targets["sauce-add"]["caseIds"], [case["external_id"] for case in cases[3:]])
        self.assertEqual(
            [step["action"] for step in normalized["journeys"][0]["steps"]],
            ["navigate", "locate", "locate", "locate", "snapshot"],
        )
        self.assertEqual(len({journey["stateKey"] for journey in normalized["journeys"]}), 6)
        self.assertNotIn("continue", json.dumps(plan, ensure_ascii=False).lower())
        self.assertNotIn("finish", json.dumps(plan, ensure_ascii=False).lower())

        for case in cases:
            script = platform.saucedemo_case_script(item, case, "../fixtures/CODEX_TEST_FIXTURE")
            self.assertEqual(platform.playwright_expect_call_count(script), 1, case["external_id"])
            self.assertEqual(
                platform.valid_case_playwright_script(
                    script,
                    case,
                    [],
                    "../fixtures/CODEX_TEST_FIXTURE",
                    enforce_single_primary=True,
                ),
                "",
                case["external_id"],
            )

    def test_one_click_script_generation_degrades_missing_evidence_per_case(self):
        original_draft_dir = platform.WORK_ITEM_DRAFT_DIR
        platform.WORK_ITEM_DRAFT_DIR = Path(self.tempdir.name) / "draft-runs"
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-PARTIAL-001 | P0 | 主要操作成功 | 主要操作 | 页面可访问 | 打开页面；点击主要按钮 | 页面显示主要操作完成 | 自动化 |
| TC-CODEX-PARTIAL-002 | P0 | 次要操作成功 | 次要操作 | 页面可访问 | 打开页面；点击次要按钮 | 页面显示次要操作完成 | 自动化 |
"""
        try:
            with patch.object(platform, "analyze_requirement_with_ai", return_value=platform.fallback_requirement_analysis(
                "验证主要操作和次要操作",
                target_url="https://example.test",
                acceptance="主要操作和次要操作均可完成",
            )):
                work = platform.create_work_item(platform.WorkItemRequest(
                    project_id=self.project["id"],
                    feature_id=self.feature["id"],
                    requirement="验证主要操作和次要操作",
                    target_url="https://example.test",
                ))
            generated = platform.generate_cases(
                work["id"],
                platform.ContentRequest(content=cases_markdown, asset_mode="create"),
            )
            first_case, second_case = generated["testCases"]
            state_evidence = [{
                "evidenceKey": "CODEX_TEST_PARTIAL_STATE",
                "stateKey": "initial",
                "caseIds": [first_case["externalId"]],
                "url": "https://example.test",
                "title": "示例页面",
                "headings": ["示例页面"],
                "texts": ["主要按钮"],
                "readinessLocator": {"kind": "heading", "value": "示例页面"},
            }]
            result = {
                "requestedUrl": "https://example.test",
                "resolvedUrl": "https://example.test",
                "stateEvidence": state_evidence,
                "scriptableCaseIds": [first_case["externalId"], second_case["externalId"]],
                "quality": {
                    "level": "medium",
                    "provenCaseIds": [first_case["externalId"], second_case["externalId"]],
                    "scriptableCaseIds": [first_case["externalId"], second_case["externalId"]],
                    "blockedCaseIds": [],
                },
                "navigationTarget": {
                    "requestedUrl": "https://example.test",
                    "resolvedUrl": "https://example.test",
                    "readinessSignals": state_evidence,
                    "accessMode": "anonymous",
                    "requiredAccessMode": "anonymous",
                    "directNavigationAllowed": True,
                    "navigationPathConfirmed": True,
                    "evidenceConfirmed": True,
                },
            }
            with platform.get_db() as conn:
                conn.execute(
                    """
                    INSERT INTO exploration_runs (
                        id, work_item_id, target_url, status, stage_key, stage_label, progress,
                        started_at, ended_at, result_json, plan_json, current_step_index, max_steps
                    ) VALUES (?, ?, ?, 'passed', 'complete', '完成', 100, ?, ?, ?, '{}', 0, 0)
                    """,
                    (
                        "CODEX_TEST_PARTIAL_EXPLORATION",
                        work["id"],
                        "https://example.test",
                        platform.now_iso(),
                        platform.now_iso(),
                        json.dumps(result, ensure_ascii=False),
                    ),
                )
            platform.save_exploration(work["id"], platform.ExplorationRequest(
                notes="CODEX_TEST 部分脚本证据",
                page_structure="示例页面",
                state_evidence=state_evidence,
                elements=[{
                    "area": "示例页面",
                    "name": "主要按钮",
                    "locatorType": "testid",
                    "locatorValue": "primary-action",
                    "locatorRole": "button",
                    "source": "CODEX_TEST 真实 DOM",
                    "confirmed": True,
                    "caseIds": [first_case["externalId"]],
                    "stateKey": "initial",
                }],
            ))

            with self.assertRaises(platform.HTTPException) as strict_error:
                platform.prepare_script_generation(
                    work["id"],
                    platform.ContentRequest(case_ids=[first_case["id"], second_case["id"]]),
                )
            self.assertIn(second_case["externalId"], str(strict_error.exception.detail))

            with patch.object(platform, "ai_playwright_script", return_value=""):
                partial = platform.generate_script_set(
                    work["id"],
                    platform.ContentRequest(case_ids=[first_case["id"], second_case["id"]]),
                    allow_partial_evidence=True,
                )
            self.assertEqual(partial["successfulCaseIds"], [first_case["id"]])
            self.assertEqual(partial["failedCases"][0]["caseId"], second_case["id"])
            self.assertEqual(partial["failedCases"][0]["explorationRunId"], "CODEX_TEST_PARTIAL_EXPLORATION")
            self.assertEqual(partial["scriptSet"]["status"], "partial")

            with self.assertRaises(platform.HTTPException) as no_p0:
                platform.generate_script_set(
                    work["id"],
                    platform.ContentRequest(case_ids=[second_case["id"]]),
                    allow_partial_evidence=True,
                )
            self.assertIn("没有任何", str(no_p0.exception.detail))
            self.assertIn("可执行 P0", str(no_p0.exception.detail))
        finally:
            platform.WORK_ITEM_DRAFT_DIR = original_draft_dir

    def test_generic_weekly_hot_skill_card_selects_first_safe_candidate_in_region(self):
        case = {
            "external_id": "TC-DISC-008",
            "priority": "P0",
            "title": "本周热门任一技能跳转",
            "requirement": "本周热门技能卡跳转",
            "preconditions": "首页热门区存在目标卡片",
            "steps": "访问首页；在本周热门区域点击第一个目标技能卡",
            "expected": "所点击技能的详情页展示对应技能名称和安全扫描状态",
            "automation_notes": "",
        }
        item = {"id": "CODEX_TEST_20260902_HOT_CARD", "target_url": "http://host/#/", "requirement": "验证本周热门技能卡"}
        preflight = {
            "final_url": "http://host/#/",
            "elements": [
                {"tag": "button", "name": "查看技能 区域外技能", "locatorType": "role", "locatorRole": "button", "locatorValue": "查看技能 区域外技能", "regionName": "推荐", "area": "推荐"},
                {"tag": "button", "name": "查看技能 第一技能", "locatorType": "role", "locatorRole": "button", "locatorValue": "查看技能 第一技能", "regionName": "本周热门", "area": "本周热门"},
                {"tag": "button", "name": "查看技能 第二技能", "locatorType": "role", "locatorRole": "button", "locatorValue": "查看技能 第二技能", "regionName": "本周热门", "area": "本周热门"},
            ],
        }

        draft, diagnostics = platform.compile_exploration_plan_v5(item, [case], preflight)

        self.assertEqual(diagnostics["localMatchedTargetCount"], 1)
        self.assertEqual(draft["targets"][0]["name"], "查看技能 第一技能")
        self.assertEqual(draft["targets"][0]["regionName"], "本周热门")
        self.assertEqual(draft["targets"][0]["selectionPolicy"], "first-safe")
        self.assertEqual([step["action"] for step in draft["journeys"][0]["steps"]], ["navigate", "click", "snapshot"])

    def test_named_skill_card_prefers_exact_candidate_over_dom_order(self):
        case = {
            "external_id": "TC-DISC-009",
            "priority": "P0",
            "title": "本周热门“国网公文排版助手”跳转",
            "requirement": "技能卡跳转",
            "preconditions": "首页热门区存在目标卡片",
            "steps": "点击目标技能卡",
            "expected": "进入目标技能详情页",
            "automation_notes": "",
        }
        item = {"id": "CODEX_TEST_20260902_NAMED_CARD", "target_url": "http://host/#/", "requirement": "验证指定技能"}
        preflight = {
            "final_url": "http://host/#/",
            "elements": [
                {"tag": "button", "name": "查看技能 第一技能", "locatorType": "role", "locatorRole": "button", "locatorValue": "查看技能 第一技能", "regionName": "本周热门", "area": "本周热门"},
                {"tag": "button", "name": "查看技能 国网公文排版助手", "locatorType": "role", "locatorRole": "button", "locatorValue": "查看技能 国网公文排版助手", "regionName": "本周热门", "area": "本周热门"},
            ],
        }

        draft, _ = platform.compile_exploration_plan_v5(item, [case], preflight)

        self.assertEqual(draft["targets"][0]["name"], "查看技能 国网公文排版助手")
        self.assertEqual(draft["targets"][0]["selectionPolicy"], "best-match")

    def test_ordinal_ranking_record_selects_requested_candidate_in_region(self):
        case = {
            "external_id": "TC-DISC-017",
            "priority": "P0",
            "title": "安装总榜第 2 条记录跳转",
            "requirement": "安装总榜列表记录跳转",
            "preconditions": "首页安装总榜已加载",
            "steps": "点击第 2 条记录",
            "expected": "详情页显示目标技能",
            "automation_notes": "在安装榜表格作用域内定位记录",
        }
        item = {"id": "CODEX_TEST_20260902_RANK_ROW", "target_url": "http://host/#/", "requirement": "验证安装总榜记录跳转"}
        preflight = {
            "final_url": "http://host/#/",
            "elements": [
                {"tag": "a", "name": "查看全部 →", "locatorType": "role", "locatorRole": "link", "locatorValue": "查看全部 →", "regionName": "安装总榜", "area": "安装总榜", "href": "http://host/#/rank"},
                {"tag": "tr", "name": "1 第一技能", "locatorType": "role", "locatorRole": "link", "locatorValue": "1 第一技能", "regionName": "安装总榜", "area": "安装总榜"},
                {"tag": "tr", "name": "2 第二技能", "locatorType": "role", "locatorRole": "link", "locatorValue": "2 第二技能", "regionName": "安装总榜", "area": "安装总榜"},
                {"tag": "tr", "name": "3 第三技能", "locatorType": "role", "locatorRole": "link", "locatorValue": "3 第三技能", "regionName": "安装总榜", "area": "安装总榜"},
                {"tag": "tr", "name": "2 其他区域记录", "locatorType": "role", "locatorRole": "link", "locatorValue": "2 其他区域记录", "regionName": "本周热门", "area": "本周热门"},
            ],
        }

        draft, diagnostics = platform.compile_exploration_plan_v5(item, [case], preflight)

        self.assertEqual(diagnostics["blockedCaseCount"], 0)
        self.assertEqual(diagnostics["localMatchedTargetCount"], 1)
        self.assertEqual(draft["targets"][0]["name"], "2 第二技能")
        self.assertEqual(draft["targets"][0]["regionName"], "安装总榜")
        self.assertEqual(draft["targets"][0]["selectionPolicy"], "nth-safe")
        self.assertEqual(draft["targets"][0]["selectionIndex"], 2)
        self.assertEqual([step["action"] for step in draft["journeys"][0]["steps"]], ["navigate", "click", "snapshot"])

        normalized = platform.validate_and_normalize_exploration_plan(draft, item, [case], preflight)
        click_step = next(step for step in normalized["steps"] if step["action"] == "click")
        self.assertEqual(click_step["targetMeta"]["regionName"], "安装总榜")
        self.assertEqual(click_step["targetMeta"]["selectionPolicy"], "nth-safe")
        self.assertEqual(click_step["targetMeta"]["selectionIndex"], 2)

    def test_failed_ordinal_target_returns_ranked_repair_options(self):
        target = {
            "targetId": "target-rank-second",
            "name": "2 第二技能",
            "caseIds": ["TC-DISC-017"],
            "required": True,
            "regionName": "安装总榜",
            "regionAliases": ["安装总榜"],
            "selectionPolicy": "nth-safe",
            "selectionIndex": 2,
        }
        stored_plan = {
            "targets": [target],
            "journeys": [{
                "journeyId": "journey-rank",
                "caseIds": ["TC-DISC-017"],
                "steps": [{"action": "click", "targetId": "target-rank-second"}],
            }],
        }
        result = {
            "missingTargets": [target],
            "elements": [
                {"name": "查看全部 →", "locatorType": "role", "locatorValue": "查看全部 →", "locatorRole": "link", "area": "安装总榜"},
                {"name": "1 第一技能", "locatorType": "text", "locatorValue": "1 第一技能", "area": "安装总榜"},
                {"name": "2 第二技能", "locatorType": "text", "locatorValue": "2 第二技能", "area": "安装总榜"},
                {"name": "2 其他榜单记录", "locatorType": "text", "locatorValue": "2 其他榜单记录", "area": "其他榜单"},
            ],
        }

        groups = platform.exploration_repair_options(stored_plan, result)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["journeyId"], "journey-rank")
        self.assertNotIn("查看全部", [item["name"] for item in groups[0]["candidates"]])
        self.assertEqual(groups[0]["candidates"][0]["name"], "2 第二技能")
        self.assertEqual(groups[0]["candidates"][0]["locatorType"], "selector")
        self.assertIn('text-is("安装总榜")', groups[0]["candidates"][0]["locatorValue"])
        self.assertIn("nth=1", groups[0]["candidates"][0]["locatorValue"])

    def test_manual_repair_plan_accepts_only_candidate_from_failed_run(self):
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-DISC-017 | P0 | 安装总榜第 2 条记录跳转 | 安装总榜列表记录跳转 | 首页安装总榜已加载 | 点击第 2 条记录 | 详情页显示目标技能 | 在安装榜表格作用域内定位记录 |
"""
        saved_cases = platform.generate_cases(
            self.item["id"],
            platform.ContentRequest(content=cases_markdown, asset_mode="create"),
        )
        cases_markdown = saved_cases["casesMarkdown"]
        parsed_case = platform.parse_cases_markdown(cases_markdown)[0]
        preflight = {
            "final_url": "http://host/#/",
            "elements": [
                {"tag": "tr", "name": "1 第一技能", "locatorType": "role", "locatorRole": "link", "locatorValue": "1 第一技能", "regionName": "安装总榜", "area": "安装总榜"},
                {"tag": "tr", "name": "2 第二技能", "locatorType": "role", "locatorRole": "link", "locatorValue": "2 第二技能", "regionName": "安装总榜", "area": "安装总榜"},
            ],
        }
        draft, _ = platform.compile_exploration_plan_v5(self.item, [parsed_case], preflight)
        stored_plan = platform.validate_and_normalize_exploration_plan(draft, self.item, [parsed_case], preflight)
        target = stored_plan["targets"][0]
        stored_plan["journeys"][0]["journeyId"] = "journey-rank"
        result = {
            "missingTargets": [target],
            "elements": [
                {"name": "2 第二技能", "locatorType": "text", "locatorValue": "2 第二技能", "locatorRole": "", "area": "安装总榜"},
            ],
        }
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO exploration_runs (
                    id, work_item_id, target_url, status, stage_key, stage_label, progress,
                    started_at, ended_at, plan_json, result_json, current_step_index, max_steps, debug_session_id
                ) VALUES (?, ?, ?, 'failed', 'complete', '完成', 100, ?, ?, ?, ?, 0, 3, '')
                """,
                (
                    "CODEX_TEST_REPAIR_SOURCE",
                    self.item["id"],
                    self.item["target_url"],
                    platform.now_iso(),
                    platform.now_iso(),
                    json.dumps(stored_plan, ensure_ascii=False),
                    json.dumps(result, ensure_ascii=False),
                ),
            )
        repair_group = platform.exploration_repair_options(stored_plan, result)[0]
        candidate = repair_group["candidates"][0]
        request = platform.ExplorationRunRequest(
            retry_run_id="CODEX_TEST_REPAIR_SOURCE",
            journey_id="journey-rank",
            target_overrides=[{
                "target_id": target["targetId"],
                "locator_type": candidate["locatorType"],
                "locator_value": candidate["locatorValue"],
                "locator_role": candidate["locatorRole"],
                "name": candidate["name"],
            }],
        )

        repair = platform.build_exploration_repair_plan(
            self.item,
            cases_markdown,
            self.item["id"],
            "",
            request,
        )

        self.assertEqual(repair["repairOfRunId"], "CODEX_TEST_REPAIR_SOURCE")
        self.assertEqual(repair["repairJourneyId"], "journey-rank")
        self.assertEqual(len(repair["journeys"]), 1)
        repair_click = next(step for step in repair["steps"] if step["action"] == "click")
        self.assertEqual(repair_click["targetMeta"]["locatorHints"][0]["locatorType"], "selector")

        async def start_repair_run():
            with (
                patch.object(platform, "run_discovery_session", new=AsyncMock(return_value=None)),
                patch.object(platform, "track_exploration_run_task") as track_task,
            ):
                started = await platform.start_exploration_run(
                    self.item["id"],
                    keep_browser_open=False,
                    payload=request,
                )
                await asyncio.sleep(0)
                self.assertTrue(track_task.called)
                return started

        started = asyncio.run(start_repair_run())
        self.assertEqual(started["status"], "running")
        self.assertEqual(started["planSource"], "repair")
        self.assertEqual(started["repairOfRunId"], "CODEX_TEST_REPAIR_SOURCE")
        self.assertEqual(started["repairJourneyId"], "journey-rank")

        forged = request.model_copy(deep=True)
        forged.target_overrides[0].locator_value = "body"
        with self.assertRaises(platform.HTTPException) as caught:
            platform.build_exploration_repair_plan(self.item, cases_markdown, self.item["id"], "", forged)
        self.assertEqual(caught.exception.status_code, 400)

    def test_repair_result_replaces_failed_target_and_recomputes_quality(self):
        target = {"targetId": "target-rank-second", "name": "安装总榜第 2 条记录", "required": True}
        previous = {
            "targets": [target],
            "elements": [{"locatorType": "text", "locatorValue": "2 第二技能", "locatorRole": ""}],
            "resolved_elements": [],
            "missingTargets": [target],
            "targetCoverage": {"total": 1, "covered": 0, "missing": 1, "percent": 0},
            "stateEvidence": [],
            "caseCoverage": [{"caseId": "TC-DISC-017", "status": "blocked-by-exploration", "assetStatus": "blocked"}],
        }
        current = {
            "targets": [target],
            "elements": [{"locatorType": "selector", "locatorValue": "section >> nth=1", "locatorRole": "link"}],
            "resolved_elements": [{
                "targetId": "target-rank-second",
                "locatorType": "selector",
                "locatorValue": "section >> nth=1",
                "locatorRole": "link",
            }],
            "missingTargets": [],
            "stateEvidence": [{"evidenceKey": "state-root", "stateKey": "root", "caseIds": ["TC-DISC-017"]}],
            "caseCoverage": [{"caseId": "TC-DISC-017", "status": "proven", "assetStatus": "proven"}],
        }

        merged = platform.merge_exploration_repair_result(
            previous,
            current,
            ["target-rank-second"],
            ["TC-DISC-017"],
        )

        self.assertEqual(merged["missingTargets"], [])
        self.assertEqual(merged["targetCoverage"], {"total": 1, "covered": 1, "missing": 0, "percent": 100})
        self.assertEqual(merged["quality"]["level"], "high")
        self.assertEqual(merged["quality"]["provenCaseIds"], ["TC-DISC-017"])
        self.assertTrue(merged["repairMerged"])

    def test_interaction_without_target_concept_reports_specific_error(self):
        case = {
            "external_id": "TC-CODEX-MISSING-CONCEPT",
            "priority": "P0",
            "title": "执行交互",
            "requirement": "验证交互",
            "preconditions": "",
            "steps": "点击后观察结果",
            "expected": "页面状态更新",
            "automation_notes": "",
        }
        item = {"id": "CODEX_TEST_20260902_MISSING_CONCEPT", "target_url": "http://host/#/", "requirement": "验证交互", "requirement_revision": 1}

        with patch.object(platform, "get_openai_api_key", return_value=""):
            with self.assertRaises(platform.ExplorationPlanBuildError) as caught:
                platform.planner_v5_exploration_plan(item, platform.case_debug_markdown(case), {"elements": []})

        self.assertEqual(caught.exception.code, "missing_target_concept")
        self.assertIn("没有描述可定位的目标控件", caught.exception.public_message)

    def test_exploration_quality_uses_scoped_case_markdown_for_debug_session(self):
        scoped_case = {
            "external_id": "TC-DISC-008",
            "priority": "P0",
            "title": "本周热门任一技能跳转",
            "requirement": "本周热门技能卡跳转",
            "preconditions": "",
            "steps": "点击第一张技能卡",
            "expected": "所点击技能的详情页展示对应技能名称和安全扫描状态",
            "automation_notes": "",
        }
        navigation_target = {
            "requestedUrl": "http://host/#/",
            "resolvedUrl": "http://host/#/",
            "readinessSignals": [],
            "navigationPathConfirmed": False,
        }

        _, coverage = platform.exploration_quality_assessment(
            self.item,
            [],
            [],
            [],
            navigation_target,
            [],
            cases_markdown=platform.case_debug_markdown(scoped_case),
        )

        self.assertEqual([item["caseId"] for item in coverage], ["TC-DISC-008"])

    def test_first_safe_cache_without_region_metadata_is_recompiled(self):
        fingerprint = "CODEX_TEST_20260902_FIRST_SAFE_CACHE"
        cached_plan = {
            "version": platform.EXPLORATION_PLANNER_VERSION,
            "plannerVersion": platform.EXPLORATION_PLANNER_VERSION,
            "caseContracts": [{
                "caseId": "TC-DISC-008",
                "concepts": [{"selectionPolicy": "first-safe", "regionAliases": ["本周热门"]}],
            }],
            "targets": [{"name": "查看技能 第一技能", "caseIds": ["TC-DISC-008"]}],
            "journeys": [{"journeyId": "cached", "caseIds": ["TC-DISC-008"], "steps": [{"action": "navigate"}]}],
        }
        with platform.get_db() as conn:
            conn.execute(
                """
                INSERT INTO exploration_runs (
                    id, work_item_id, target_url, status, stage_key, stage_label, progress,
                    started_at, plan_json, current_step_index, max_steps, plan_error_code,
                    plan_fingerprint, plan_diagnostics_json
                ) VALUES (?, ?, ?, 'passed', 'complete', '完成', 100, ?, ?, 0, 1, '', ?, '{}')
                """,
                (
                    "CODEXCACHE0902",
                    self.item["id"],
                    self.item["target_url"],
                    platform.now_iso(),
                    json.dumps(cached_plan, ensure_ascii=False),
                    fingerprint,
                ),
            )

        self.assertIsNone(platform.cached_exploration_plan(self.item["id"], fingerprint))

    def test_case_evidence_gate_rejects_wrong_page_and_accepts_shared_skill_state(self):
        assignments = [
            {"caseId": "TC-001", "requiredState": "root", "destinationState": "", "requiredTargets": []},
            {"caseId": "TC-002", "requiredState": "skills", "destinationState": "", "requiredTargets": []},
            {"caseId": "TC-003", "requiredState": "skills", "destinationState": "", "requiredTargets": ["发布 Skill", "分类", "所属部门", "排序方式"]},
            {"caseId": "TC-004", "requiredState": "skills", "destinationState": "", "requiredTargets": ["发布 Skill"]},
            {"caseId": "TC-005", "requiredState": "skills", "destinationState": "publish-gate", "requiredTargets": ["发布 Skill"]},
        ]
        evidence = [
            {"evidenceKey": "root", "stateKey": "root", "caseIds": ["TC-001"], "url": "http://host/#/", "headings": ["首页"]},
            {"evidenceKey": "skills", "stateKey": "skills", "caseIds": ["TC-002", "TC-003", "TC-004"], "url": "http://host/#/skills", "headings": ["技能库", "分类", "所属部门"], "texts": ["发布 Skill", "排序方式"]},
            {"evidenceKey": "publish", "stateKey": "publish-gate", "caseIds": ["TC-005"], "url": "http://host/#/login?redirect=/publish", "headings": ["登录 SkillHub"]},
        ]
        elements = [{"name": "发布 Skill", "caseIds": ["TC-003", "TC-004", "TC-005"]}]

        coverage = platform.build_case_evidence_coverage(assignments, evidence, elements)

        self.assertEqual(platform.case_evidence_coverage_error(coverage), "")
        wrong = [dict(item) for item in evidence]
        wrong[1] = {**wrong[1], "stateKey": "root", "url": "http://host/#/"}
        wrong_coverage = platform.build_case_evidence_coverage(assignments, wrong, elements)
        error = platform.case_evidence_coverage_error(wrong_coverage)
        self.assertIn("TC-003：期望状态 skills，实际状态 root", error)

    def _revision_count(self):
        with platform.get_db() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM generated_cases WHERE work_item_id = ?",
                (self.item["id"],),
            ).fetchone()[0]


if __name__ == "__main__":
    unittest.main()
