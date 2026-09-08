import asyncio
import hashlib
import json
import os
import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, call, patch

from starlette.websockets import WebSocketDisconnect

from backend.app import main


class HangingWebSocket:
    async def send_json(self, payload):
        await asyncio.Event().wait()


class FailingWebSocket:
    async def send_json(self, payload):
        raise RuntimeError("send failed")


class ScriptedWebSocket:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.sent = []
        self.accepted = False
        self.closed = False

    async def accept(self):
        self.accepted = True

    async def send_json(self, payload):
        self.sent.append(payload)

    async def receive_json(self):
        if self.payloads:
            return self.payloads.pop(0)
        raise WebSocketDisconnect()

    async def close(self, code=1000):
        self.closed = True


class FakeStream:
    def __init__(self, chunks):
        self.chunks = list(chunks)

    async def readline(self):
        if self.chunks:
            return self.chunks.pop(0)
        return b""

    async def read(self):
        return b""


class FakeProcess:
    def __init__(self, pid=12345, exit_on_wait=True):
        self.pid = pid
        self.returncode = None
        self.stdin = SimpleNamespace(write=lambda data: None, drain=self._drain)
        self.stdout = FakeStream([])
        self.stderr = FakeStream([])
        self.terminated = False
        self.exit_on_wait = exit_on_wait

    async def _drain(self):
        return None

    def terminate(self):
        self.terminated = True
        if self.exit_on_wait:
            self.returncode = -15

    async def wait(self):
        if self.exit_on_wait:
            self.returncode = self.returncode if self.returncode is not None else 0
            return self.returncode
        await asyncio.Event().wait()


class SyncLineResponse:
    def __init__(self, lines):
        self.lines = list(lines)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def readline(self):
        return self.lines.pop(0) if self.lines else b""


class RecordingOpener:
    def __init__(self, response):
        self.response = response
        self.request = None
        self.timeout = None

    def open(self, request, timeout):
        self.request = request
        self.timeout = timeout
        return self.response


class AIProtocolCompatibilityTests(unittest.TestCase):
    def setUp(self):
        main.AI_CAPABILITY_CACHE.clear()

    def test_openai_official_defaults_to_responses_json_schema(self):
        capability = main.default_ai_capability("openai", "https://api.openai.com/v1")

        self.assertEqual(capability["api_protocol"], "responses")
        self.assertEqual(capability["structured_output_mode"], "json_schema")

    def test_chat_json_schema_keeps_native_schema(self):
        schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}
        payload = {
            "input": "Return JSON",
            "text": {"format": {"type": "json_schema", "name": "probe", "schema": schema, "strict": True}},
        }

        chat_payload = main.chat_payload_from_responses_payload(
            "test-model",
            payload,
            structured_output_mode="json_schema",
        )

        self.assertEqual(chat_payload["response_format"]["type"], "json_schema")
        self.assertEqual(chat_payload["response_format"]["json_schema"]["schema"], schema)

    def test_deepseek_json_object_prompt_contains_json_and_schema(self):
        schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}
        payload = {
            "input": "返回结果",
            "text": {"format": {"type": "json_schema", "name": "probe", "schema": schema, "strict": True}},
        }

        chat_payload = main.chat_payload_from_responses_payload(
            "deepseek-chat",
            payload,
            structured_output_mode="json_object",
        )

        self.assertEqual(chat_payload["response_format"], {"type": "json_object"})
        instruction = chat_payload["messages"][0]["content"]
        self.assertIn("JSON", instruction)
        self.assertIn('"ok"', instruction)

    def test_capability_probe_falls_back_to_chat_json_schema(self):
        attempts = []

        def call_protocol(*args, **kwargs):
            attempts.append((kwargs["api_protocol"], kwargs["structured_output_mode"]))
            if kwargs["api_protocol"] == "responses":
                raise main.AIRequestError("Responses API unavailable", status_code=404, compatibility_error=True)
            return {"choices": [{"message": {"content": '{"ok": true}'}}]}

        with (
            patch.object(main.platform, "call_ai_protocol", side_effect=call_protocol),
            patch.object(main.platform, "persist_ai_capability") as persist,
        ):
            capability = main.probe_ai_capability("test-key", "test-model", "https://gateway.test/v1", "gpt")

        self.assertEqual(attempts, [("responses", "json_schema"), ("chat_completions", "json_schema")])
        self.assertEqual(capability["structured_output_mode"], "json_schema")
        persist.assert_called_once()

    def test_capability_probe_does_not_fallback_on_auth_error(self):
        with patch.object(
            main.platform,
            "call_ai_protocol",
            side_effect=main.AIRequestError("鉴权失败", status_code=401, compatibility_error=False),
        ) as call_protocol:
            with self.assertRaises(main.AIRequestError):
                main.probe_ai_capability("bad-key", "test-model", "https://gateway.test/v1", "gpt")

        call_protocol.assert_called_once()

    def test_legacy_profile_without_capability_fields_remains_valid(self):
        profile = main.normalize_ai_profile({
            "id": "legacy-profile",
            "provider": "gpt",
            "model": "legacy-model",
            "base_url": "https://gateway.test/v1",
            "api_key": "test-key",
        })

        self.assertEqual(profile["api_protocol"], "")
        self.assertEqual(profile["structured_output_mode"], "")
        self.assertEqual(profile["capability_verified_at"], "")

    def test_custom_deepseek_profile_uses_deepseek_capability_defaults(self):
        capability = main.default_ai_capability("custom", "https://api.deepseek.com/v1")

        self.assertEqual(capability["api_protocol"], "chat_completions")
        self.assertEqual(capability["structured_output_mode"], "json_object")

    def test_changing_saved_model_invalidates_capability(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "ai-config.sqlite"
            try:
                main.init_db()
                verified_at = "2026-08-13T07:00:00+00:00"
                main.AI_CAPABILITY_CACHE[main.ai_capability_cache_key("gpt", "model-a", "https://gateway.test/v1")] = {
                    "api_protocol": "chat_completions",
                    "structured_output_mode": "json_schema",
                    "capability_verified_at": verified_at,
                }
                saved = main.save_ai_config(main.AIConfigRequest(
                    name="CODEX_TEST_AI_CAPABILITY",
                    provider="gpt",
                    api_key="test-key",
                    model="model-a",
                    base_url="https://gateway.test/v1",
                    api_protocol="chat_completions",
                    structured_output_mode="json_schema",
                    capability_verified_at=verified_at,
                ))
                profile = saved["activeProfile"]
                self.assertEqual(profile["apiProtocol"], "chat_completions")

                updated = main.save_ai_config(main.AIConfigRequest(
                    id=profile["id"],
                    name=profile["name"],
                    provider="gpt",
                    model="model-b",
                    base_url="https://gateway.test/v1",
                    api_protocol="chat_completions",
                    structured_output_mode="json_schema",
                    capability_verified_at="2026-08-13T07:00:00+00:00",
                ))

                self.assertEqual(updated["activeProfile"]["apiProtocol"], "")
                self.assertEqual(updated["activeProfile"]["structuredOutputMode"], "")
            finally:
                main.DB_PATH = original_db_path


class BrowserRuntimeEventTests(unittest.IsolatedAsyncioTestCase):
    def create_project(self, name: str = "单元测试项目"):
        return main.create_project(main.ProjectRequest(name=name, project_type="product", status="active"))

    def create_feature(self, project_id: str, name: str = "默认功能"):
        return main.create_feature_menu(main.FeatureMenuRequest(project_id=project_id, name=name))

    def skillhub_preflight(self):
        return {
            "title": "SkillHub",
            "final_url": "http://192.168.7.181:8080/#/",
            "screenshot_path": "/tmp/preflight.png",
            "structure": {
                "title": "SkillHub",
                "url": "http://192.168.7.181:8080/#/",
                "headings": ["发现技能"],
                "forms": 0,
                "inputs": 1,
                "buttons": 1,
                "links": 8,
            },
            "elements": [
                {"tag": "input", "type": "search", "name": "搜索技能、作者、标签", "locatorType": "placeholder", "locatorValue": "搜索技能、作者、标签", "locatorRole": ""},
                {"tag": "a", "type": "", "name": "登录", "locatorType": "role", "locatorValue": "登录", "locatorRole": "link"},
                {"tag": "a", "type": "", "name": "发布 Skill", "locatorType": "role", "locatorValue": "发布 Skill", "locatorRole": "link"},
            ],
        }

    def test_rewrite_spec_import_for_live_plain_playwright_test(self):
        source = "import { expect, test } from '@playwright/test';\n\ntest('ok', async ({ page }) => {});"

        rewritten = main.rewrite_spec_import_for_live(source, "./live-fixture")

        self.assertIsNotNone(rewritten)
        self.assertIn("import { expect, test } from './live-fixture';", rewritten)
        self.assertNotIn("@playwright/test", rewritten.splitlines()[0])

    def test_rewrite_spec_import_for_live_typed_playwright_test(self):
        source = "import { expect, type Page, type Locator, test } from 'playwright/test';\nasync function helper(page: Page) {}"

        rewritten = main.rewrite_spec_import_for_live(source, "./live-fixture")

        self.assertIsNotNone(rewritten)
        self.assertIn("import { expect, test } from './live-fixture';", rewritten)
        self.assertIn("import type { Page, Locator } from '@playwright/test';", rewritten)

    def test_rewrite_spec_import_for_live_runtime_type_and_aliases(self):
        source = "import { expect, test, Page, Locator as PWLocator } from '@playwright/test';\nasync function helper(page: Page) {}"

        rewritten = main.rewrite_spec_import_for_live(source, "./live-fixture")

        self.assertIsNotNone(rewritten)
        self.assertIn("import { expect, test } from './live-fixture';", rewritten)
        self.assertIn("import type { Page, Locator as PWLocator } from '@playwright/test';", rewritten)

    def test_rewrite_spec_import_for_live_multiline_and_ordered_import(self):
        source = """import {
  test,
  expect,
  type BrowserContext,
  Page
} from '@playwright/test';

test('ok', async ({ page }) => {});
"""

        rewritten = main.rewrite_spec_import_for_live(source, "./live-fixture")

        self.assertIsNotNone(rewritten)
        self.assertIn("import { expect, test } from './live-fixture';", rewritten)
        self.assertIn("import type { BrowserContext, Page } from '@playwright/test';", rewritten)

    def test_rewrite_spec_import_for_live_aliases_test_and_expect(self):
        source = "import { test as base, expect } from '@playwright/test';"

        rewritten = main.rewrite_spec_import_for_live(source, "./live-fixture")

        self.assertIsNotNone(rewritten)
        self.assertIn("import { expect, test as base } from './live-fixture';", rewritten)

    def test_rewrite_spec_import_for_live_rejects_missing_test_or_expect(self):
        source = "import { expect, Page } from '@playwright/test';"

        rewritten = main.rewrite_spec_import_for_live(source, "./live-fixture")

        self.assertIsNone(rewritten)

    def test_live_import_failure_guidance_includes_import_excerpt(self):
        source = "import { something } from '@playwright/test';"

        guidance = main.live_import_failure_guidance(source)

        self.assertIn("该脚本导入形态暂不支持实时画面注入", guidance)
        self.assertIn("未支持 import", guidance)
        self.assertIn("import { something } from '@playwright/test';", guidance)

    def test_navigation_environment_risk_detects_goto_and_readiness_timeouts(self):
        goto_log = 'TimeoutError: page.goto: Timeout 30000ms exceeded\n- navigating to "https://www.saucedemo.com/"'
        readiness_log = "TimeoutError: locator.waitFor: Timeout 10000ms exceeded\nwaiting for locator('text=Swag Labs')"

        self.assertIn("目标站点/网络响应不稳定", main.navigation_environment_risk(goto_log))
        self.assertIn("目标站点/网络响应不稳定", main.navigation_environment_risk(readiness_log))
        self.assertEqual(main.navigation_environment_risk("expect(locator).toHaveText failed"), "")

    def test_probe_target_url_rejects_non_http_url(self):
        result = main.probe_target_url("", timeout_seconds=0.01)

        self.assertFalse(result["ok"])
        self.assertIn("未提供可探测", result["error"])

    async def test_requirement_extracts_inline_zzpss_credentials(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_ZZPSS_PARSE")
                feature = self.create_feature(project["id"], "登录解析")
                requirement = """帮我测试下这个网站的登录功能http://192.168.7.180:12222/zzpss/#/login
账号：lining   密码：ExamplePass123!"""

                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement=requirement,
                    )
                )
                item = main.get_work_item_row(work["id"])

                self.assertEqual(item["target_url"], "http://192.168.7.180:12222/zzpss/#/login")
                self.assertIn("username=lining", item["test_data"])
                self.assertIn("password=ExamplePass123!", item["test_data"])
                self.assertEqual(main.parse_test_data(item["test_data"])["username"], "lining")
                self.assertEqual(main.parse_test_data(item["test_data"])["password"], "ExamplePass123!")
            finally:
                main.DB_PATH = original_db_path

    def test_unconfirmed_login_lockout_case_is_downgraded(self):
        item = {
            "title": "登录功能验证",
            "requirement": "帮我测试登录功能，账号：lining 密码：ExamplePass123!",
            "target_url": "http://example.test/#/login",
            "acceptance": "未提供明确验收标准",
            "exclusions": "",
            "test_data": "username=lining\npassword=ExamplePass123!",
        }
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LOGIN-001 | P0 | 正确凭证登录成功 | 登录 | 有效账号 | 输入正确账号密码 | 进入首页 | 可自动化 |
| TC-LOGIN-002 | P1 | 密码错误达到阈值后账号锁定 | 防暴力破解 | 假设阈值为 5 | 连续 5 次错误密码 | 账号已锁定 | 可自动化 |
"""

        filtered, removed = main.filter_unconfirmed_login_security_cases(cases, item)

        self.assertEqual(removed, ["密码错误达到阈值后账号锁定"])
        self.assertIn("TC-LOGIN-001", filtered)
        self.assertNotIn("| TC-LOGIN-002 |", filtered)
        self.assertIn("需业务规则确认", filtered)

    def test_explicit_login_lockout_rule_keeps_case(self):
        item = {
            "title": "登录功能验证",
            "requirement": "连续 5 次错误密码后账号锁定 30 分钟",
            "target_url": "http://example.test/#/login",
            "acceptance": "连续 5 次错误密码后账号锁定 30 分钟",
            "exclusions": "",
            "test_data": "username=lining\npassword=ExamplePass123!",
        }
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LOGIN-002 | P1 | 密码错误达到阈值后账号锁定 | 防暴力破解 | 阈值为 5 | 连续 5 次错误密码 | 账号已锁定 | 可自动化 |
"""

        filtered, removed = main.filter_unconfirmed_login_security_cases(cases, item)

        self.assertEqual(removed, [])
        self.assertIn("TC-LOGIN-002", filtered)

    def test_test_cases_prompt_prefers_smoke_regression_and_real_requirements(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "用例生成约束")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证订单查询页面可以按订单号查询并展示订单详情。",
                        target_url="https://example.test/orders",
                        test_data="orderNo=CODEX_TEST_ORDER_001",
                        acceptance="输入已存在订单号后展示订单详情。",
                    )
                )
                item = main.get_work_item_row(work["id"])

                prompt = main.test_cases_prompt(item)

                self.assertIn("冒烟用例、回归用例为主", prompt)
                self.assertIn("业务规则必须来自实际需求", prompt)
                self.assertIn("每条用例的“覆盖需求”必须能追溯", prompt)
                self.assertIn("每条用例只能有一个最关键的业务期望结果", prompt)
                self.assertIn("主期望选择顺序固定为", prompt)
                self.assertIn("禁止凭空扩展账号锁定、验证码、审批流、权限、金额阈值、库存、状态流转、接口返回规则", prompt)
                self.assertIn("需业务规则确认/可选人工验证", prompt)
            finally:
                main.DB_PATH = original_db_path

    def test_default_cases_do_not_invent_error_or_business_rule_cases(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "兜底用例约束")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证首页可以正常打开并展示欢迎语。",
                        target_url="https://example.test/home",
                        acceptance="首页展示欢迎语。",
                    )
                )
                item = main.get_work_item_row(work["id"])

                cases = main.default_cases(item)
                parsed = main.parse_cases_markdown(cases)

                self.assertEqual(len(parsed), 1)
                self.assertNotIn("冒烟主流程", parsed[0]["title"])
                self.assertIn("首页", parsed[0]["title"])
                self.assertNotIn("关键错误状态", cases)
                self.assertNotIn("缺失或异常数据", cases)
                self.assertNotIn("金额阈值", cases)
                self.assertNotIn("按需求完成核心操作", cases)
            finally:
                main.DB_PATH = original_db_path

    def test_frontend_case_design_context_mentions_smoke_regression_constraint(self):
        source = (Path(__file__).resolve().parents[1] / "frontend" / "src" / "main.jsx").read_text()

        self.assertIn("以冒烟/回归用例为主", source)
        self.assertIn("业务规则必须来自实际需求", source)
        self.assertIn("用例以冒烟/回归为主", source)
        self.assertIn("需业务规则确认", source)

    def test_policy_mismatch_stops_healing_when_success_state_is_visible(self):
        item = {
            "title": "登录功能验证",
            "requirement": "帮我测试登录功能，账号：lining 密码：ExamplePass123!",
            "target_url": "http://example.test/#/login",
            "acceptance": "未提供明确验收标准",
            "exclusions": "",
            "test_data": "username=lining\npassword=ExamplePass123!",
        }
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LOGIN-004 | P1 | 密码错误达到阈值后账号锁定 | 防暴力破解 | 假设阈值为 5 | 连续错误密码 | 账号已锁定 | 可自动化 |
"""
        failure_log = 'Expected pattern: /\\/#\\/login/\nReceived string: "http://example.test/#/home"\ntext: 欢迎您，李宁'

        reason = main.expectation_policy_mismatch_reason(item, failure_log, cases)

        self.assertIn("用例预期与实际产品策略不一致", reason)

    async def test_exploration_plan_is_derived_from_current_requirement_and_cases(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_ZZPSS_PLAN")
                feature = self.create_feature(project["id"], "登录探索")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 ZZPSS 登录，账号：lining 密码：ExamplePass123!",
                        target_url="http://192.168.7.180:12222/zzpss/#/login",
                    )
                )

                item = main.get_work_item_row(work["id"])
                cases = [{
                    "external_id": "TC-LOGIN-001",
                    "priority": "P0",
                    "title": "有效账号登录成功",
                    "requirement": "验证登录",
                    "preconditions": "账号 lining，密码 ExamplePass123!",
                    "steps": "打开页面；填写账号 lining；填写密码 ExamplePass123!；点击登录",
                    "expected": "进入 #/home 并显示欢迎您",
                    "automation_notes": "自动化",
                }]
                raw_plan = {
                    "scenarios": [{
                        "caseId": "TC-LOGIN-001",
                        "title": "有效账号登录成功",
                        "steps": [
                            {"action": "navigate", "description": "打开目标页面", "target": {"kind": "url", "name": "targetUrl", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "textAny": []}},
                            {"action": "fill", "description": "填写账号", "target": {"kind": "textbox", "name": "账号", "aliases": ["用户名"], "exact": False}, "value": "lining", "expected": {"urlContains": "", "textAny": []}},
                            {"action": "fill", "description": "填写密码", "target": {"kind": "password", "name": "密码", "aliases": ["Password"], "exact": False}, "value": "ExamplePass123!", "expected": {"urlContains": "", "textAny": []}},
                            {"action": "click", "description": "点击登录", "target": {"kind": "button", "name": "登录", "aliases": ["Login"], "exact": True}, "value": "", "expected": {"urlContains": "#/home", "textAny": ["欢迎您"]}},
                            {"action": "assert", "description": "验证登录成功", "target": {"kind": "text", "name": "欢迎您", "aliases": [], "exact": False}, "value": "", "expected": {"urlContains": "#/home", "textAny": ["欢迎您"]}},
                            {"action": "snapshot", "description": "保存登录成功证据", "target": {"kind": "text", "name": "", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "textAny": []}},
                        ],
                    }]
                }

                plan = main.validate_and_normalize_exploration_plan(raw_plan, item, cases)

                self.assertEqual(plan["source"], "ai")
                self.assertEqual(plan["version"], 4)
                self.assertEqual(len(plan["scenarios"]), 1)
                self.assertIn("lining", [step.get("value") for step in plan["steps"]])
                self.assertNotIn("standard_user", json.dumps(plan, ensure_ascii=False))
                self.assertNotIn("Sauce Labs", json.dumps(plan, ensure_ascii=False))
                click_step = next(step for step in plan["steps"] if step["action"] == "click")
                self.assertEqual(click_step["targetMeta"]["kind"], "button")
                self.assertNotIn("assert", {step["action"] for step in plan["steps"]})
                self.assertEqual({target["kind"] for target in plan["targets"]}, {"textbox", "password", "button"})
            finally:
                main.DB_PATH = original_db_path

    async def test_partial_exploration_blocks_for_every_site(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_ZZPSS_BLOCK")
                feature = self.create_feature(project["id"], "探索阻塞")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 ZZPSS 登录，账号：lining 密码：ExamplePass123!",
                        target_url="http://192.168.7.180:12222/zzpss/#/login",
                    )
                )
                item = main.get_work_item_row(work["id"])
                result = {"elements": [], "resolved_elements": []}
                payload = {"status": "partial", "steps": [{"status": "failed", "critical": True, "caseId": "TC-LOGIN-001"}], "result": result}

                reason = main.exploration_block_reason(item, payload, result)

                self.assertIn("只有全部测试用例场景通过", reason)
            finally:
                main.DB_PATH = original_db_path

    async def test_exploration_plan_failure_is_persisted_without_starting_browser(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_PLAN_FAILURE")
                feature = self.create_feature(project["id"], "计划失败")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证目标页面可以打开。",
                        target_url="https://example.test",
                    )
                )
                main.generate_cases(
                    work["id"],
                    main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-PLAN-001 | P0 | 页面可打开 | 页面访问 | 页面可访问 | 打开页面 | 页面正常显示 | 自动化 |
"""),
                )
                preflight = {
                    "title": "Example",
                    "final_url": "https://example.test",
                    "screenshot_path": "",
                    "structure": {"title": "Example", "url": "https://example.test", "forms": 0, "inputs": 0, "buttons": 0, "links": 1, "headings": ["Example"]},
                    "elements": [{"tag": "a", "type": "", "name": "Example", "locatorType": "role", "locatorValue": "Example", "locatorRole": "link"}],
                }
                with (
                    patch.object(main.platform, "discover_page", new=AsyncMock(return_value=preflight)),
                    patch.object(
                        main.platform,
                        "build_exploration_plan",
                        new=AsyncMock(side_effect=main.ExplorationPlanBuildError(
                            "ai_request_failed",
                            "AI 页面探索计划生成失败",
                            "服务返回 HTTP 400：password=must-not-leak",
                            {
                                "httpStatus": 400,
                                "technicalReason": "password=must-not-leak",
                                "planFingerprint": "fingerprint-codex-plan-failure",
                                "planDiagnostics": {
                                    "plannerVersion": 5,
                                    "blockedCases": [{"caseId": "TC-CODEX-PLAN-001", "priority": "P0", "missingActions": ["fill"]}],
                                },
                                "draftPlan": {
                                    "version": 5,
                                    "plannerVersion": 5,
                                    "source": "system",
                                    "targets": [],
                                    "journeys": [{
                                        "journeyId": "draft-sensitive",
                                        "caseIds": ["TC-CODEX-PLAN-001"],
                                        "steps": [{"action": "fill", "value": "must-not-persist", "expected": {"valueEquals": "must-not-persist"}}],
                                    }],
                                    "blockedCases": [],
                                },
                            },
                        )),
                    ),
                    patch.object(main.platform, "track_exploration_run_task") as track_task,
                ):
                    result = await main.start_exploration_run(work["id"], keep_browser_open=False)

                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["planErrorCode"], "ai_request_failed")
                self.assertEqual(result["stage"]["label"], "计划生成失败")
                track_task.assert_not_called()
                with main.get_db() as conn:
                    self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM browser_sessions").fetchone()["total"], 0)
                    log_row = conn.execute(
                        "SELECT details_json FROM exploration_logs WHERE exploration_run_id = ? AND level = 'error'",
                        (result["id"],),
                    ).fetchone()
                    run_row = conn.execute(
                        "SELECT plan_json, plan_fingerprint, plan_diagnostics_json FROM exploration_runs WHERE id = ?",
                        (result["id"],),
                    ).fetchone()
                details = json.loads(log_row["details_json"])
                self.assertEqual(details["httpStatus"], 400)
                self.assertNotIn("must-not-leak", details["technicalReason"])
                self.assertIn("password=***", details["technicalReason"])
                persisted_plan = json.loads(run_row["plan_json"])
                self.assertEqual(run_row["plan_fingerprint"], "fingerprint-codex-plan-failure")
                self.assertEqual(json.loads(run_row["plan_diagnostics_json"])["plannerVersion"], 5)
                self.assertEqual(persisted_plan["journeys"][0]["steps"][0]["value"], "[REDACTED]")
                self.assertEqual(persisted_plan["journeys"][0]["steps"][0]["expected"]["valueEquals"], "[REDACTED]")
            finally:
                main.DB_PATH = original_db_path

    async def test_ai_exploration_prompt_uses_only_requirement_url_and_current_cases(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_PLAN_INPUT")
                feature = self.create_feature(project["id"], "输入约束")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证登录，账号 alpha，密码 beta。",
                        target_url="https://example.test/login",
                    )
                )
                with main.get_db() as conn:
                    conn.execute(
                        "UPDATE work_items SET title = ?, role = ?, test_data = ?, acceptance = ?, exclusions = ? WHERE id = ?",
                        ("TITLE_MUST_NOT_APPEAR", "ROLE_MUST_NOT_APPEAR", "DATA_MUST_NOT_APPEAR", "ACCEPTANCE_MUST_NOT_APPEAR", "EXCLUSION_MUST_NOT_APPEAR", work["id"]),
                    )
                item = main.get_work_item_row(work["id"])
                cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-LOGIN-001 | P0 | 登录成功 | 登录 | 账号 alpha，密码 beta | 打开页面；填写账号 alpha；填写密码 beta；点击登录 | 显示欢迎 | 自动化 |
"""
                response = {
                    "scenarios": [{
                        "caseId": "TC-CODEX-LOGIN-001",
                        "title": "登录成功",
                        "steps": [
                            {"action": "navigate", "description": "打开页面", "target": {"kind": "url", "name": "targetUrl", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "textAny": []}},
                            {"action": "fill", "description": "填写账号", "target": {"kind": "textbox", "name": "账号", "aliases": [], "exact": False}, "value": "alpha", "expected": {"urlContains": "", "textAny": []}},
                            {"action": "fill", "description": "填写密码", "target": {"kind": "password", "name": "密码", "aliases": [], "exact": False}, "value": "beta", "expected": {"urlContains": "", "textAny": []}},
                            {"action": "click", "description": "点击登录", "target": {"kind": "button", "name": "登录", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "textAny": ["欢迎"]}},
                            {"action": "assert", "description": "验证欢迎信息", "target": {"kind": "text", "name": "欢迎", "aliases": [], "exact": False}, "value": "", "expected": {"urlContains": "", "textAny": ["欢迎"]}},
                            {"action": "snapshot", "description": "保存证据", "target": {"kind": "text", "name": "", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "textAny": []}},
                        ],
                    }]
                }
                with (
                    patch.object(main.platform, "get_openai_api_key", return_value="test-key"),
                    patch.object(main.platform, "deterministic_exploration_asset_plan", return_value=None),
                    patch.object(main.platform, "call_openai_responses_stream", return_value=json.dumps(response, ensure_ascii=False)) as call_ai,
                ):
                    plan = main.ai_exploration_plan(item, cases_markdown)

                request_payload = call_ai.call_args.args[3]
                prompt = request_payload["input"]
                self.assertIn(item["target_url"], prompt)
                self.assertIn(item["requirement"], prompt)
                self.assertIn("TC-CODEX-LOGIN-001", prompt)
                self.assertNotIn("TITLE_MUST_NOT_APPEAR", prompt)
                self.assertNotIn("ROLE_MUST_NOT_APPEAR", prompt)
                self.assertNotIn("DATA_MUST_NOT_APPEAR", prompt)
                self.assertNotIn("ACCEPTANCE_MUST_NOT_APPEAR", prompt)
                self.assertNotIn("EXCLUSION_MUST_NOT_APPEAR", prompt)
                self.assertIn("仅用于进入发布页面", prompt)
                self.assertEqual(call_ai.call_args.args[4], "")
                self.assertEqual(call_ai.call_args.kwargs["timeout"], 120)
                self.assertEqual(plan["source"], "ai")
            finally:
                main.DB_PATH = original_db_path

    async def test_ai_exploration_prompt_includes_sanitized_preflight_evidence(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_PREFLIGHT_PROMPT")
                feature = self.create_feature(project["id"], "预探索提示词")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"],
                    feature_id=feature["id"],
                    requirement="验证登录，账号 alpha，密码 beta。",
                    target_url="https://example.test",
                ))
                item = main.get_work_item_row(work["id"])
                cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-PREFLIGHT-PROMPT-001 | P0 | 登录成功 | 登录 | 账号 alpha，密码 beta | 打开页面；点击登录；填写账号 alpha；填写密码 beta；点击登录 | 显示欢迎 | 自动化 |
"""
                response = {"scenarios": [{"caseId": "TC-CODEX-PREFLIGHT-PROMPT-001", "title": "登录成功", "steps": [
                    {"action": "navigate", "description": "打开页面", "target": {"kind": "url", "name": "targetUrl", "aliases": [], "exact": True}, "value": "", "expected": {}},
                    {"action": "click", "description": "点击登录入口", "target": {"kind": "link", "name": "登录", "aliases": [], "exact": True}, "value": "", "expected": {}},
                    {"action": "fill", "description": "填写账号", "target": {"kind": "textbox", "name": "账号", "aliases": ["用户名"], "exact": False}, "value": "alpha", "expected": {}},
                    {"action": "fill", "description": "填写密码", "target": {"kind": "password", "name": "密码", "aliases": [], "exact": False}, "value": "beta", "expected": {}},
                    {"action": "click", "description": "点击登录按钮", "target": {"kind": "button", "name": "登录", "aliases": [], "exact": True}, "value": "", "expected": {"textAny": ["欢迎"]}},
                    {"action": "assert", "description": "验证欢迎", "target": {"kind": "text", "name": "欢迎", "aliases": [], "exact": False}, "value": "", "expected": {"textAny": ["欢迎"]}},
                    {"action": "snapshot", "description": "保存证据", "target": {"kind": "text", "name": "", "aliases": [], "exact": True}, "value": "", "expected": {}},
                ]}]}
                preflight = self.skillhub_preflight()
                preflight["elements"].append({"tag": "input", "type": "text", "name": "password=secret-value", "locatorType": "text", "locatorValue": "token=secret-token", "locatorRole": ""})
                with (
                    patch.object(main.platform, "get_openai_api_key", return_value="test-key"),
                    patch.object(main.platform, "deterministic_exploration_asset_plan", return_value=None),
                    patch.object(main.platform, "call_openai_responses_stream", return_value=json.dumps(response, ensure_ascii=False)) as call_ai,
                ):
                    plan = main.ai_exploration_plan(item, cases_markdown, preflight)

                prompt = call_ai.call_args.args[3]["input"]
                self.assertIn("SkillHub", prompt)
                self.assertIn('"locatorRole": "link"', prompt)
                self.assertIn('"name": "登录"', prompt)
                self.assertNotIn("secret-value", prompt)
                self.assertNotIn("secret-token", prompt)
                self.assertNotIn("preflight.png", prompt)
                self.assertEqual(plan["preflight"]["candidateCount"], 4)
            finally:
                main.DB_PATH = original_db_path

    def test_ai_exploration_plan_retries_once_after_structure_validation_failure(self):
        item = {
            "id": "work-retry-plan",
            "requirement": "验证登录，账号 alpha，密码 beta。",
            "target_url": "https://example.test/login",
        }
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-RETRY-001 | P0 | 登录成功 | 登录 | 账号 alpha，密码 beta | 打开页面；填写账号 alpha；填写密码 beta；点击登录 | 显示欢迎 | 自动化 |
"""
        invalid = {
            "scenarios": [{
                "caseId": "TC-CODEX-RETRY-001",
                "title": "登录成功",
                "steps": [
                    {"action": "navigate", "description": "打开页面", "target": {"kind": "url", "name": "targetUrl", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "urlNotContains": "", "textAny": [], "textAbsent": []}},
                    {"action": "fill", "description": "填写账号", "value": "alpha", "expected": {"urlContains": "", "urlNotContains": "", "textAny": [], "textAbsent": []}},
                ],
            }]
        }
        valid = {
            "scenarios": [{
                "caseId": "TC-CODEX-RETRY-001",
                "title": "登录成功",
                "steps": [
                    {"action": "navigate", "description": "打开页面", "target": {"kind": "url", "name": "targetUrl", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "urlNotContains": "", "textAny": [], "textAbsent": []}},
                    {"action": "fill", "description": "填写账号", "target": {"kind": "textbox", "name": "账号", "aliases": [], "exact": False}, "value": "alpha", "expected": {"urlContains": "", "urlNotContains": "", "textAny": [], "textAbsent": []}},
                    {"action": "fill", "description": "填写密码", "target": {"kind": "password", "name": "密码", "aliases": [], "exact": False}, "value": "beta", "expected": {"urlContains": "", "urlNotContains": "", "textAny": [], "textAbsent": []}},
                    {"action": "click", "description": "点击登录", "target": {"kind": "button", "name": "登录", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "urlNotContains": "", "textAny": ["欢迎"], "textAbsent": []}},
                    {"action": "assert", "description": "验证欢迎", "target": {"kind": "text", "name": "欢迎", "aliases": [], "exact": False}, "value": "", "expected": {"urlContains": "", "urlNotContains": "", "textAny": ["欢迎"], "textAbsent": []}},
                    {"action": "snapshot", "description": "保存证据", "target": {"kind": "text", "name": "", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "urlNotContains": "", "textAny": [], "textAbsent": []}},
                ],
            }]
        }
        config = {"provider": "deepseek", "api_key": "test-key", "model": "deepseek-chat", "base_url": "https://api.deepseek.com/v1"}
        capability = {"api_protocol": "chat_completions", "structured_output_mode": "json_object"}
        with (
            patch.object(main.platform, "get_openai_api_key", return_value="test-key"),
            patch.object(main.platform, "deterministic_exploration_asset_plan", return_value=None),
            patch.object(main.platform, "get_openai_model", return_value="deepseek-chat"),
            patch.object(main.platform, "get_openai_base_url", return_value="https://api.deepseek.com/v1"),
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "resolve_ai_capability", return_value=capability),
            patch.object(
                main.platform,
                "call_openai_responses_stream",
                side_effect=[json.dumps(invalid), json.dumps(valid, ensure_ascii=False)],
            ) as call_ai,
        ):
            result = main.ai_exploration_plan(item, cases_markdown)

        self.assertEqual(call_ai.call_count, 2)
        self.assertEqual(len(result["scenarios"]), 1)
        correction_prompt = call_ai.call_args_list[1].args[3]["input"]
        self.assertIn("上一次输出未通过页面探索计划校验", correction_prompt)
        self.assertIn("JSON Schema", correction_prompt)

    def test_ai_exploration_request_error_does_not_format_retry(self):
        item = {"id": "work-http-error", "requirement": "验证页面可访问", "target_url": "https://example.test"}
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-HTTP-001 | P0 | 页面可访问 | 页面访问 | 页面可访问 | 打开页面 | 页面可见 | 自动化 |
"""
        config = {"provider": "gpt", "api_key": "test-key", "model": "test-model", "base_url": "https://gateway.test/v1"}
        capability = {"api_protocol": "responses", "structured_output_mode": "json_schema"}
        request_error = main.AIRequestError("服务返回 HTTP 400：invalid request", status_code=400)
        with (
            patch.object(main.platform, "get_openai_api_key", return_value="test-key"),
            patch.object(main.platform, "deterministic_exploration_asset_plan", return_value=None),
            patch.object(main.platform, "get_openai_model", return_value="test-model"),
            patch.object(main.platform, "get_openai_base_url", return_value="https://gateway.test/v1"),
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "resolve_ai_capability", return_value=capability),
            patch.object(main.platform, "call_openai_responses_stream", side_effect=request_error) as call_ai,
        ):
            with self.assertRaises(main.ExplorationPlanBuildError) as raised:
                main.ai_exploration_plan(item, cases_markdown)

        self.assertEqual(call_ai.call_count, 1)
        self.assertEqual(raised.exception.code, "ai_request_failed")
        self.assertEqual(raised.exception.details["httpStatus"], 400)

    def test_ai_exploration_retries_transient_request_once(self):
        item = {"id": "work-transient", "requirement": "验证页面可访问", "target_url": "https://example.test"}
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-TRANSIENT-001 | P0 | 页面可访问 | 页面访问 | 页面可访问 | 打开页面 | 页面可见 | 自动化 |
"""
        valid = {
            "scenarios": [{
                "caseId": "TC-CODEX-TRANSIENT-001",
                "title": "页面可访问",
                "steps": [
                    {"action": "navigate", "description": "打开页面", "target": {"kind": "url", "name": "targetUrl", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "urlNotContains": "", "textAny": [], "textAbsent": []}},
                    {"action": "assert", "description": "确认打开按钮", "target": {"kind": "button", "name": "打开", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "urlNotContains": "", "textAny": [], "textAbsent": []}},
                    {"action": "snapshot", "description": "保存证据", "target": {"kind": "text", "name": "", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "urlNotContains": "", "textAny": [], "textAbsent": []}},
                ],
            }]
        }
        config = {"provider": "gpt", "api_key": "test-key", "model": "test-model", "base_url": "https://gateway.test/v1"}
        capability = {"api_protocol": "responses", "structured_output_mode": "json_schema"}
        rate_limit = main.AIRequestError("请求被限流", status_code=429, retryable=True)
        with (
            patch.object(main.platform, "get_openai_api_key", return_value="test-key"),
            patch.object(main.platform, "deterministic_exploration_asset_plan", return_value=None),
            patch.object(main.platform, "get_openai_model", return_value="test-model"),
            patch.object(main.platform, "get_openai_base_url", return_value="https://gateway.test/v1"),
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "resolve_ai_capability", return_value=capability),
            patch.object(main.platform, "call_openai_responses_stream", side_effect=[rate_limit, json.dumps(valid)]) as call_ai,
        ):
            result = main.ai_exploration_plan(item, cases_markdown)

        self.assertEqual(call_ai.call_count, 2)
        self.assertEqual(len(result["scenarios"]), 1)

    def test_v4_exploration_plan_merges_duplicate_controls_across_cases(self):
        case_ids = [f"TC-CODEX-ASSET-{index:03d}" for index in range(1, 7)]
        cases = [
            {
                "external_id": case_id,
                "title": f"登录场景 {index}",
                "requirement": "登录",
                "preconditions": "账号 alpha，密码 beta",
                "steps": "填写账号；填写密码；点击登录",
                "expected": "按用例描述处理",
                "automation_notes": "自动化",
            }
            for index, case_id in enumerate(case_ids, start=1)
        ]
        raw = {
            "targets": [
                {"targetId": "username-a", "kind": "textbox", "name": "账号", "aliases": ["用户名"], "caseIds": case_ids[:3], "stateKey": "login", "required": True},
                {"targetId": "username-b", "kind": "textbox", "name": "账号", "aliases": ["账户"], "caseIds": case_ids[3:], "stateKey": "login", "required": True},
                {"targetId": "password", "kind": "password", "name": "密码", "aliases": [], "caseIds": case_ids, "stateKey": "login", "required": True},
                {"targetId": "submit", "kind": "button", "name": "登录", "aliases": [], "caseIds": case_ids, "stateKey": "login", "required": True},
            ],
            "journeys": [{
                "journeyId": "login-surface",
                "title": "登录表单",
                "stateKey": "login",
                "caseIds": case_ids,
                "steps": [
                    {"action": "navigate", "targetId": "", "value": "", "description": "打开页面"},
                    {"action": "fill", "targetId": "username-a", "value": "alpha", "description": "填写账号"},
                    {"action": "fill", "targetId": "password", "value": "beta", "description": "填写密码"},
                    {"action": "click", "targetId": "submit", "value": "", "description": "点击登录", "expected": {"stateChanged": True}},
                    {"action": "snapshot", "targetId": "", "value": "", "description": "记录登录状态"},
                ],
            }],
        }

        result = main.validate_and_normalize_exploration_plan(
            raw,
            {"requirement": "验证登录，账号 alpha，密码 beta。", "target_url": "https://example.test/login"},
            cases,
        )

        self.assertEqual(result["version"], 4)
        self.assertEqual(len(result["targets"]), 3)
        username = next(target for target in result["targets"] if target["kind"] == "textbox")
        self.assertEqual(username["caseIds"], case_ids)
        self.assertEqual(len(result["journeys"]), 1)
        self.assertNotIn("assert", {step["action"] for step in result["steps"]})

    def test_gpt55_asset_plan_uses_low_reasoning_and_does_not_retry_timeout(self):
        item = {"id": "work-gpt55", "requirement": "验证登录按钮可操作", "target_url": "https://example.test/login"}
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-GPT55-001 | P0 | 登录按钮 | 登录 | 页面可访问 | 点击登录 | 打开登录页 | 自动化 |
"""
        config = {"provider": "openai", "api_key": "test-key", "model": "gpt-5.5", "base_url": "https://gateway.test"}
        capability = {"api_protocol": "responses", "structured_output_mode": "json_schema"}
        with (
            patch.object(main.platform, "get_openai_api_key", return_value="test-key"),
            patch.object(main.platform, "deterministic_exploration_asset_plan", return_value=None),
            patch.object(main.platform, "get_openai_model", return_value="gpt-5.5"),
            patch.object(main.platform, "get_openai_base_url", return_value="https://gateway.test"),
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "resolve_ai_capability", return_value=capability),
            patch.object(main.platform, "call_openai_responses_stream", side_effect=TimeoutError("slow")) as call_ai,
        ):
            with self.assertRaises(main.ExplorationPlanBuildError) as raised:
                main.ai_exploration_plan(item, cases_markdown)

        self.assertEqual(call_ai.call_count, 1)
        self.assertIn("生成超时", raised.exception.public_message)
        payload = call_ai.call_args.args[3]
        self.assertEqual(payload["reasoning"], {"effort": "low"})
        self.assertEqual(payload["text"]["verbosity"], "low")
        self.assertEqual(payload["max_output_tokens"], 8192)

    def test_asset_coverage_blocks_missing_controls_and_allows_complete_assets(self):
        missing = {
            "targetCoverage": {"total": 2, "covered": 1, "missing": 1, "percent": 50},
            "missingTargets": [{"targetId": "submit", "name": "登录按钮", "caseIds": ["TC-CODEX-001"]}],
            "resolved_elements": [{"targetId": "username"}],
        }
        complete = {
            "targetCoverage": {"total": 2, "covered": 2, "missing": 0, "percent": 100},
            "missingTargets": [],
            "resolved_elements": [{"targetId": "username"}, {"targetId": "submit"}],
        }

        reason = main.exploration_block_reason({"id": "work-assets"}, {"status": "failed"}, missing)

        self.assertIn("登录按钮", reason)
        self.assertIn("TC-CODEX-001", reason)
        self.assertEqual(main.exploration_block_reason({"id": "work-assets"}, {"status": "failed"}, complete), "")

    def test_save_exploration_persists_case_mapping_fallbacks_and_state_evidence(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_ASSET_PERSIST")
                feature = self.create_feature(project["id"], "元素资产")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"],
                    feature_id=feature["id"],
                    requirement="验证登录按钮",
                    target_url="https://example.test/login",
                ))
                main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-ASSET-001 | P0 | 登录按钮 | 登录 | 页面可访问 | 点击登录 | 打开登录页 | 自动化 |
"""))
                result = main.save_exploration(work["id"], main.ExplorationRequest(
                    notes="asset discovery",
                    state_evidence=[{"stateKey": "initial", "caseIds": ["TC-CODEX-ASSET-001"], "url": "https://example.test/login", "texts": ["登录"]}],
                    elements=[{
                        "area": "Login",
                        "name": "登录",
                        "locatorType": "testid",
                        "locatorValue": "login-button",
                        "locatorRole": "",
                        "source": "真实 DOM 稳定 test id",
                        "confirmed": True,
                        "targetId": "submit",
                        "caseIds": ["TC-CODEX-ASSET-001"],
                        "stateKey": "initial",
                        "fallbacks": [{"locatorType": "role", "locatorRole": "button", "locatorValue": "登录"}],
                    }],
                ))

                self.assertEqual(result["elements"][0]["targetId"], "submit")
                self.assertEqual(result["elements"][0]["caseIds"], ["TC-CODEX-ASSET-001"])
                self.assertEqual(result["elements"][0]["fallbacks"][0]["locatorRole"], "button")
                self.assertEqual(result["explorations"][0]["stateEvidence"][0]["stateKey"], "initial")
            finally:
                main.DB_PATH = original_db_path

    def test_exploration_plan_validation_rejects_untraceable_or_unsafe_content(self):
        item = {
            "id": "work-plan-validation",
            "requirement": "验证登录，账号 alpha，密码 beta。",
            "target_url": "https://example.test/login",
        }
        cases = [{
            "external_id": "TC-PLAN-001",
            "priority": "P0",
            "title": "登录成功",
            "requirement": "登录",
            "preconditions": "账号 alpha，密码 beta",
            "steps": "打开页面；填写账号 alpha；填写密码 beta；点击登录",
            "expected": "显示欢迎",
            "automation_notes": "自动化",
        }]

        def scenario(steps, case_id="TC-PLAN-001"):
            return {"scenarios": [{"caseId": case_id, "title": "登录成功", "steps": steps}]}

        navigate = {"action": "navigate", "description": "打开页面", "target": {"kind": "url", "name": "targetUrl", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "textAny": []}}
        snapshot = {"action": "snapshot", "description": "保存证据", "target": {"kind": "text", "name": "", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "textAny": []}}

        invalid_plans = [
            ("target_case_mapping_missing", scenario([navigate, {"action": "assert", "description": "确认登录按钮", "target": {"kind": "button", "name": "登录", "aliases": [], "exact": True}, "value": "", "expected": {}}, snapshot], case_id="TC-EXTRA-001")),
            ("invented_test_data", scenario([navigate, {"action": "fill", "description": "填写账号", "target": {"kind": "textbox", "name": "账号", "aliases": [], "exact": True}, "value": "invented-user", "expected": {"urlContains": "", "textAny": []}}, snapshot])),
            ("invented_selector", scenario([navigate, {"action": "click", "description": "点击登录", "target": {"kind": "selector", "name": "#invented-login", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "textAny": []}}, snapshot])),
            ("dangerous_action", scenario([navigate, {"action": "click", "description": "点击删除账号", "target": {"kind": "button", "name": "删除", "aliases": [], "exact": True}, "value": "", "expected": {"urlContains": "", "textAny": []}}, snapshot])),
            ("empty_targets", scenario([navigate, {"action": "assert", "description": "验证进入系统", "target": {"kind": "text", "name": "系统可用页面", "aliases": [], "exact": False}, "value": "", "expected": {"urlContains": "", "textAny": ["系统可用页面"]}}, snapshot])),
        ]
        for expected_code, raw_plan in invalid_plans:
            with self.subTest(error_code=expected_code):
                with self.assertRaises(main.ExplorationPlanBuildError) as raised:
                    main.validate_and_normalize_exploration_plan(raw_plan, item, cases)
                self.assertEqual(raised.exception.code, expected_code)

    def test_exploration_plan_allows_publish_entry_navigation_without_publishing(self):
        item = {
            "id": "work-publish-entry",
            "requirement": "点击发布入口进入发布页面，但不要提交或发布内容。",
            "target_url": "https://example.test",
        }
        cases = [{
            "external_id": "TC-PUBLISH-ENTRY-001",
            "priority": "P0",
            "title": "发布入口跳转",
            "requirement": "发布入口跳转",
            "preconditions": "页面可访问",
            "steps": "打开页面；点击发布入口；进入发布页面",
            "expected": "发布页面可见",
            "automation_notes": "只验证入口跳转，不提交发布",
        }]
        preflight = {
            "final_url": "https://example.test",
            "elements": [{
                "tag": "a",
                "name": "发布",
                "locatorType": "role",
                "locatorRole": "link",
                "locatorValue": "发布",
            }],
        }
        raw_plan = {
            "targets": [{
                "targetId": "publish-entry",
                "kind": "link",
                "name": "发布",
                "aliases": ["发布skill"],
                "caseIds": ["TC-PUBLISH-ENTRY-001"],
                "stateKey": "initial",
                "required": True,
            }],
            "journeys": [{
                "journeyId": "publish-entry-navigation",
                "title": "发布入口跳转",
                "stateKey": "initial",
                "caseIds": ["TC-PUBLISH-ENTRY-001"],
                "steps": [
                    {
                        "action": "navigate",
                        "targetId": "",
                        "value": "",
                        "description": "访问目标 URL，进入可见发布入口的首页状态",
                        "expected": {},
                    },
                    {
                        "action": "click",
                        "targetId": "publish-entry",
                        "value": "",
                        "description": "点击发布入口进入发布页面",
                        "expected": {"stateChanged": True},
                    },
                    {
                        "action": "snapshot",
                        "targetId": "",
                        "value": "",
                        "description": "记录发布页面",
                        "expected": {},
                    },
                ],
            }],
        }

        result = main.validate_and_normalize_exploration_plan(raw_plan, item, cases, preflight)

        self.assertEqual([step["action"] for step in result["steps"]], ["navigate", "click", "snapshot"])

    def test_planner_v5_compiles_publish_navigation_without_case_mapping_pollution(self):
        item = {
            "id": "work-v5-publish",
            "requirement": "验证技能库页面展示、发布入口和技能详情。",
            "target_url": "https://example.test/#/",
        }
        cases = [
            {
                "external_id": "TC-CODEX-V5-STATIC-001",
                "priority": "P0",
                "title": "技能库展示",
                "requirement": "页面展示正常",
                "preconditions": "页面可访问",
                "steps": "打开页面；读取标题",
                "expected": "显示技能库",
                "automation_notes": "自动化",
            },
            {
                "external_id": "TC-CODEX-V5-PUBLISH-002",
                "priority": "P0",
                "title": "发布入口跳转",
                "requirement": "点击发布skill后进入发布页",
                "preconditions": "发布入口可见",
                "steps": "打开页面；点击“发布skill”按钮",
                "expected": "浏览器地址进入发布路由",
                "automation_notes": "不提交发布表单",
            },
        ]
        preflight = {
            "final_url": item["target_url"],
            "elements": [
                {"tag": "a", "name": "技能库", "locatorType": "role", "locatorValue": "技能库", "locatorRole": "link", "href": "https://example.test/#/skills"},
                {"tag": "a", "name": "发布", "locatorType": "role", "locatorValue": "发布", "locatorRole": "link", "href": "https://example.test/#/publish"},
                {"tag": "input", "type": "search", "name": "搜索技能", "locatorType": "placeholder", "locatorValue": "搜索技能", "locatorRole": ""},
            ],
        }

        draft, diagnostics = main.compile_exploration_plan_v5(item, cases, preflight)
        plan = main.validate_and_normalize_exploration_plan(draft, item, cases, preflight)

        publish_targets = [target for target in plan["targets"] if target["caseIds"] == ["TC-CODEX-V5-PUBLISH-002"]]
        self.assertEqual([(target["kind"], target["name"]) for target in publish_targets], [("link", "发布")])
        self.assertFalse(any("TC-CODEX-V5-PUBLISH-002" in target["caseIds"] and target["name"] in {"技能库", "搜索技能"} for target in plan["targets"]))
        publish_click = next(step for step in plan["steps"] if step.get("caseId") == "TC-CODEX-V5-PUBLISH-002" and step["action"] == "click")
        self.assertEqual(publish_click["expected"]["urlContains"], "#/publish")
        self.assertEqual(publish_click["targetMeta"]["safety"]["class"], "same-origin-navigation")
        self.assertEqual(diagnostics["blockedCaseCount"], 0)

    def test_planner_v5_is_deterministic_for_identical_input(self):
        item = {"id": "work-v5-repeat", "requirement": "验证发布入口", "target_url": "https://example.test/#/"}
        cases = [{
            "external_id": "TC-CODEX-V5-REPEAT-001",
            "priority": "P0",
            "title": "发布入口",
            "requirement": "点击发布skill进入发布页",
            "preconditions": "页面可访问",
            "steps": "点击“发布skill”按钮",
            "expected": "进入发布路由",
            "automation_notes": "不提交",
        }]
        preflight = {"elements": [{
            "tag": "a", "name": "发布", "locatorType": "role", "locatorValue": "发布", "locatorRole": "link", "href": "https://example.test/#/publish",
        }]}

        outputs = [
            json.dumps(main.compile_exploration_plan_v5(item, cases, preflight)[0], ensure_ascii=False, sort_keys=True)
            for _ in range(20)
        ]

        self.assertEqual(len(set(outputs)), 1)

    def test_planner_v5_blocks_p0_and_degrades_optional_unresolved_cases(self):
        item = {"id": "work-v5-priority", "requirement": "验证页面和未知入口", "target_url": "https://example.test"}
        static_case = {
            "external_id": "TC-CODEX-V5-STATIC-P0",
            "priority": "P0",
            "title": "页面展示",
            "requirement": "页面展示正常",
            "preconditions": "页面可访问",
            "steps": "打开页面；读取标题",
            "expected": "标题可见",
            "automation_notes": "自动化",
        }
        optional_case = {
            "external_id": "TC-CODEX-V5-OPTIONAL-P1",
            "priority": "P1",
            "title": "未知入口",
            "requirement": "点击不存在的业务入口",
            "preconditions": "入口待确认",
            "steps": "点击“不存在的业务入口”",
            "expected": "进入目标页面",
            "automation_notes": "待探索",
        }

        optional_draft, _ = main.compile_exploration_plan_v5(item, [static_case, optional_case], {"elements": []})
        optional_plan = main.validate_and_normalize_exploration_plan(optional_draft, item, [static_case, optional_case], {"elements": []})
        self.assertEqual(optional_plan["plannedCaseIds"], ["TC-CODEX-V5-STATIC-P0"])
        self.assertEqual(optional_plan["blockedCases"][0]["priority"], "P1")

        p0_case = {**optional_case, "external_id": "TC-CODEX-V5-BLOCKED-P0", "priority": "P0"}
        p0_draft, _ = main.compile_exploration_plan_v5(item, [static_case, p0_case], {"elements": []})
        self.assertEqual([case["caseId"] for case in p0_draft["blockedCases"]], ["TC-CODEX-V5-BLOCKED-P0"])

    def test_planner_v5_does_not_call_ai_when_dom_evidence_is_complete(self):
        item = {"id": "work-v5-no-ai", "requirement": "验证发布入口", "target_url": "https://example.test/#/"}
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-V5-NOAI-001 | P0 | 发布入口 | 点击发布skill | 页面可访问 | 点击“发布skill”按钮 | 进入发布页 | 不提交发布表单 |
"""
        preflight = {"elements": [{
            "tag": "a", "name": "发布", "locatorType": "role", "locatorValue": "发布", "locatorRole": "link", "href": "https://example.test/#/publish",
        }]}
        with (
            patch.object(main.platform, "cached_exploration_plan", return_value=None),
            patch.object(main.platform, "ai_exploration_gap_mappings", side_effect=AssertionError("完整 DOM 证据不应调用 AI")) as ai_mapping,
        ):
            plan = main.planner_v5_exploration_plan(item, cases_markdown, preflight)

        ai_mapping.assert_not_called()
        self.assertEqual(plan["source"], "system")
        self.assertEqual(plan["blockedCases"], [])

    def test_planner_v5_calls_ai_gap_mapper_once_and_keeps_optional_case_blocked(self):
        item = {"id": "work-v5-one-ai", "requirement": "验证页面和未知入口", "target_url": "https://example.test"}
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-V5-ONEAI-P0 | P0 | 页面展示 | 页面展示 | 页面可访问 | 打开页面；读取标题 | 标题可见 | 自动化 |
| TC-CODEX-V5-ONEAI-P1 | P1 | 未知入口 | 点击未知入口 | 入口待确认 | 点击“不存在业务入口” | 进入目标页 | 待探索 |
"""
        response = {"mappings": [{
            "caseId": "TC-CODEX-V5-ONEAI-P1",
            "conceptKey": "quoted-" + hashlib.sha256("不存在业务入口".encode("utf-8")).hexdigest()[:8],
            "candidateId": "",
            "semanticName": "不存在业务入口",
        }]}
        config = {"provider": "openai", "api_key": "test-key", "model": "gpt-5.5", "base_url": "https://gateway.test"}
        with (
            patch.object(main.platform, "cached_exploration_plan", return_value=None),
            patch.object(main.platform, "get_openai_api_key", return_value="test-key"),
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "call_openai_responses_stream", return_value=json.dumps(response)) as ai_call,
        ):
            plan = main.planner_v5_exploration_plan(item, cases_markdown, {"elements": []})

        self.assertEqual(ai_call.call_count, 1)
        self.assertEqual(plan["source"], "hybrid")
        self.assertEqual(plan["plannedCaseIds"], ["TC-CODEX-V5-ONEAI-P0"])
        self.assertEqual(plan["blockedCases"][0]["caseId"], "TC-CODEX-V5-ONEAI-P1")

    def test_planner_v5_reuses_successful_plan_fingerprint_cache(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "planner-cache.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_PLANNER_CACHE")
                feature = self.create_feature(project["id"], "计划缓存")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"],
                    feature_id=feature["id"],
                    requirement="点击发布skill进入发布页",
                    target_url="https://example.test/#/",
                ))
                generated = main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-V5-CACHE-001 | P0 | 发布入口 | 点击发布skill | 页面可访问 | 点击“发布skill”按钮 | 进入发布页 | 不提交 |
"""))
                item = main.get_work_item_row(work["id"])
                cases_markdown = generated["casesMarkdown"]
                preflight = {"elements": [{
                    "tag": "a", "name": "发布", "locatorType": "role", "locatorValue": "发布", "locatorRole": "link", "href": "https://example.test/#/publish",
                }]}
                first = main.planner_v5_exploration_plan(item, cases_markdown, preflight)
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO exploration_runs (
                            id, work_item_id, target_url, status, stage_key, stage_label, progress,
                            started_at, plan_json, plan_source, plan_error_code, plan_fingerprint,
                            plan_diagnostics_json, current_step_index, max_steps
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "cache-source-run", work["id"], item["target_url"], "failed", "complete", "执行失败", 100,
                            main.now_iso(), json.dumps(first, ensure_ascii=False), first["source"], "", first["planFingerprint"],
                            json.dumps(first["planDiagnostics"], ensure_ascii=False), 0, len(first["steps"]),
                        ),
                    )
                with patch.object(main.platform, "compile_exploration_plan_v5", side_effect=AssertionError("缓存命中后不应重新编译")):
                    cached = main.planner_v5_exploration_plan(item, cases_markdown, preflight)

                self.assertEqual(cached["source"], "cache")
                self.assertTrue(cached["planDiagnostics"]["cacheHit"])
                self.assertEqual(cached["planFingerprint"], first["planFingerprint"])
            finally:
                main.DB_PATH = original_db_path

    def test_planner_v6_compiles_sort_cases_as_one_combobox_with_real_option_values(self):
        item = {"id": "work-v6-sort", "requirement": "验证三种排序", "target_url": "https://example.test/#/"}
        cases = [
            {
                "external_id": f"TC-CODEX-V6-SORT-{index}", "priority": "P1", "title": f"{label}排序",
                "requirement": f"按{label}排序正确", "preconditions": "技能库可访问", "steps": f"打开页面；选择“{label}”排序；读取列表",
                "expected": "排序正确", "automation_notes": "自动化",
            }
            for index, label in enumerate(["安装量", "本周热度", "更新时间"], start=1)
        ]
        preflight = {
            "states": [
                {
                    "stateKey": "initial", "requested_url": "https://example.test/#/", "final_url": "https://example.test/#/",
                    "elements": [{"tag": "a", "name": "技能库", "locatorType": "role", "locatorValue": "技能库", "locatorRole": "link", "href": "https://example.test/#/skills"}],
                },
                {
                    "stateKey": "skills", "requested_url": "https://example.test/#/skills", "final_url": "https://example.test/#/skills",
                    "elements": [{
                        "tag": "select", "name": "排序方式", "locatorType": "label", "locatorValue": "排序方式", "locatorRole": "",
                        "locatorHints": [{"locatorType": "css", "locatorValue": "#sort", "locatorRole": ""}],
                        "options": [
                            {"label": "按安装量", "value": "dl"},
                            {"label": "按本周热度", "value": "wk"},
                            {"label": "按更新时间", "value": "upd"},
                        ],
                    }],
                },
            ],
        }

        draft, _ = main.compile_exploration_plan_v5(item, cases, preflight)
        plan = main.validate_and_normalize_exploration_plan(draft, item, cases, preflight)
        select_steps = [step for step in plan["steps"] if step["action"] == "select"]

        self.assertEqual(plan["plannerVersion"], 6)
        self.assertEqual([step["value"] for step in select_steps], ["dl", "wk", "upd"])
        self.assertTrue(all(step["targetMeta"]["kind"] == "combobox" for step in select_steps))
        self.assertEqual([step["targetMeta"]["desiredOption"]["label"] for step in select_steps], ["按安装量", "按本周热度", "按更新时间"])
        self.assertEqual(plan["blockedCases"], [])

    def test_planner_v6_detects_hash_route_authentication_gate(self):
        state = {
            "final_url": "https://example.test/#/login?redirect=/publish",
            "structure": {"hasPasswordInput": True},
            "elements": [{"tag": "input", "type": "password", "name": "密码"}],
        }

        gate = main.exploration_access_gate("https://example.test/#/publish", state)

        self.assertEqual(gate["type"], "authentication")
        self.assertTrue(gate["required"])
        self.assertEqual(gate["redirectTarget"], "/publish")

    def test_exploration_quality_keeps_behavior_mismatch_case_scriptable(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "behavior-finding.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_V6_BEHAVIOR")
                feature = self.create_feature(project["id"], "行为差异")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"], feature_id=feature["id"],
                    requirement="无需登录点击发布进入发布页", target_url="https://example.test/#/",
                ))
                generated = main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-V6-BEHAVIOR-001 | P0 | 发布入口 | 点击发布 | 无需登录 | 打开页面；点击发布 | 进入发布页 | 自动化 |
"""))
                external_id = generated["testCases"][0]["externalId"]
                target_meta = {"caseIds": [external_id], "targetId": "publish", "stateKey": "initial"}
                rows = [
                    {
                        "critical": 1, "status": "passed", "action": "navigate", "screenshot_path": "", "structure_json": "{}", "candidates_json": "[]",
                        "case_id": external_id, "target_json": json.dumps({"caseIds": [external_id]}), "expected_json": "{}", "resolved_target_json": "{}",
                        "step_index": 0, "target": "https://example.test/#/", "url_after": "https://example.test/#/",
                    },
                    {
                        "critical": 1, "status": "passed", "action": "click", "screenshot_path": "/tmp/publish.png", "structure_json": "{}", "candidates_json": "[]",
                        "case_id": external_id, "target_json": json.dumps(target_meta),
                        "expected_json": json.dumps({"urlContains": "#/publish", "behaviorPolicy": "record"}),
                        "resolved_target_json": json.dumps({
                            "locatorType": "role", "locatorValue": "发布", "role": "link", "resolutionStatus": "passed", "actionStatus": "passed",
                            "postconditionStatus": "mismatch", "behaviorFinding": {
                                "code": "behavior_mismatch", "message": "期望 URL 包含 #/publish，实际为 #/login?redirect=/publish",
                                "actualUrl": "https://example.test/#/login?redirect=/publish",
                            },
                        }),
                        "step_index": 1, "target": "发布", "url_after": "https://example.test/#/login?redirect=/publish",
                    },
                    {
                        "critical": 0, "status": "passed", "action": "snapshot", "screenshot_path": "/tmp/publish.png",
                        "structure_json": json.dumps({"title": "登录"}), "candidates_json": "[]", "case_id": external_id,
                        "target_json": json.dumps({"caseIds": [external_id]}), "expected_json": "{}", "resolved_target_json": "{}",
                        "step_index": 2, "target": "", "url_after": "https://example.test/#/login?redirect=/publish",
                    },
                ]
                quality, coverage = main.exploration_quality_assessment(
                    main.get_work_item_row(work["id"]),
                    [{"targetId": "publish", "name": "发布", "required": True, "caseIds": [external_id]}],
                    rows,
                    [],
                    {
                        "requestedUrl": "https://example.test/#/", "resolvedUrl": "https://example.test/#/",
                        "readinessSignals": [{"title": "SkillHub"}], "navigationPathConfirmed": True,
                    },
                    [{"targetId": "publish", "confidence": 95, "autoConfirmEligible": True}],
                )

                self.assertEqual(quality["level"], "high")
                self.assertEqual(quality["scriptableCaseIds"], [external_id])
                self.assertEqual(quality["blockedCaseIds"], [])
                self.assertEqual(len(quality["behaviorFindings"]), 1)
                self.assertEqual(coverage[0]["assetStatus"], "proven")
                self.assertEqual(coverage[0]["behaviorStatus"], "mismatch")
                self.assertEqual(
                    main.exploration_block_reason(
                        main.get_work_item_row(work["id"]),
                        {"status": "passed", "planErrorCode": ""},
                        {"quality": quality},
                    ),
                    "",
                )
            finally:
                main.DB_PATH = original_db_path

    def test_script_generation_allows_scriptable_static_page_and_static_api_cases(self):
        original_db_path = main.DB_PATH
        original_draft_dir = main.WORK_ITEM_DRAFT_DIR
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "static-generation.sqlite"
            main.WORK_ITEM_DRAFT_DIR = Path(directory) / "drafts"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_STATIC_GENERATION")
                feature = self.create_feature(project["id"], "静态脚本生成")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"], feature_id=feature["id"],
                    requirement="验证技能列表、技能跳转和概览统计", target_url="https://example.test/#/",
                ))
                generated = main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-STATIC-001 | P0 | 技能列表展示 | 页面列表与接口一致 | GET /api/skills?size=60 | 打开页面；读取技能列表 | 页面展示的技能均来自接口 | 自动化 |
| TC-CODEX-INTERACTION-002 | P0 | 技能详情跳转 | 点击技能进入详情 | 页面存在技能卡片 | 点击技能卡片 | 进入详情页 | 自动化 |
| TC-CODEX-STATIC-003 | P2 | 概览统计展示 | 页面统计与接口一致 | GET /api/stats/overview | 打开页面；读取概览数字 | 页面概览统计与接口一致 | 自动化 |
"""))
                cases = generated["testCases"]
                cases_by_title = {case["title"]: case for case in cases}
                list_case = cases_by_title["技能列表展示"]
                interaction_case = cases_by_title["技能详情跳转"]
                overview_case = cases_by_title["概览统计展示"]
                external_ids = [case["externalId"] for case in cases]
                state_evidence = [{
                    "evidenceKey": "state-static-initial",
                    "stateKey": "initial",
                    "caseIds": [interaction_case["externalId"]],
                    "url": "https://example.test/#/",
                    "title": "SkillHub",
                    "headings": ["技能库"],
                    "texts": ["技能列表", "概览统计"],
                    "readinessLocator": {"kind": "heading", "value": "技能库"},
                    "readOnlyResponses": [],
                    "screenshotPath": "/tmp/static.png",
                }]
                result = {
                    "stateEvidence": state_evidence,
                    "scriptableCaseIds": external_ids,
                    "quality": {"level": "high", "scriptableCaseIds": external_ids, "provenCaseIds": external_ids, "blockedCaseIds": []},
                }
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO exploration_runs (
                            id, work_item_id, target_url, status, stage_key, stage_label, progress,
                            started_at, ended_at, result_json, plan_json, current_step_index, max_steps
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "static-generation-run", work["id"], "https://example.test/#/", "passed", "complete", "完成", 100,
                            main.now_iso(), main.now_iso(), json.dumps(result, ensure_ascii=False), "{}", 0, 0,
                        ),
                    )
                main.save_exploration(work["id"], main.ExplorationRequest(
                    notes="静态证据",
                    screenshot_path="/tmp/static.png",
                    page_structure="技能库",
                    state_evidence=state_evidence,
                    elements=[{
                        "area": "技能库", "name": "查看技能 Alpha", "locatorType": "role", "locatorValue": "查看技能 Alpha",
                        "locatorRole": "button", "source": "真实 DOM", "confirmed": True, "targetId": "detail",
                        "caseIds": [interaction_case["externalId"]], "stateKey": "initial", "fallbacks": [],
                    }],
                ))

                context = main.prepare_script_generation(work["id"], main.ContentRequest(case_ids=[case["id"] for case in cases]))

                modes = {case["external_id"]: context["case_generation_mode"][case["id"]] for case in context["ordered_cases"]}
                self.assertEqual(modes[list_case["externalId"]], "static-api")
                self.assertEqual(modes[interaction_case["externalId"]], "interaction")
                self.assertEqual(modes[overview_case["externalId"]], "static-api")
                self.assertTrue(context["case_state_evidence"][list_case["id"]])
                self.assertTrue(context["case_state_evidence"][overview_case["id"]])
                self.assertTrue(context["case_datasets"][list_case["id"]][0]["url"].endswith("/api/skills?size=60"))
                self.assertTrue(context["case_datasets"][overview_case["id"]][0]["url"].endswith("/api/stats/overview"))

                with patch.object(main.platform, "get_openai_api_key", return_value=""):
                    scripts = main.generate_script_set(work["id"], main.ContentRequest(case_ids=[case["id"] for case in cases]))

                self.assertEqual(len(scripts["successfulCaseIds"]), 3)
                self.assertEqual(scripts["failedCases"], [])
                with main.get_db() as conn:
                    contents = [row["content"] for row in conn.execute(
                        "SELECT content FROM test_script_versions WHERE work_item_id = ? ORDER BY created_at ASC",
                        (work["id"],),
                    ).fetchall()]
                self.assertTrue(any("/api/skills?size=60" in content for content in contents))
                self.assertTrue(any("/api/stats/overview" in content for content in contents))
            finally:
                main.DB_PATH = original_db_path
                main.WORK_ITEM_DRAFT_DIR = original_draft_dir

    def test_script_generation_still_blocks_unproven_static_case_without_evidence(self):
        original_db_path = main.DB_PATH
        original_draft_dir = main.WORK_ITEM_DRAFT_DIR
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "static-negative.sqlite"
            main.WORK_ITEM_DRAFT_DIR = Path(directory) / "drafts"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_STATIC_NEGATIVE")
                feature = self.create_feature(project["id"], "静态负例")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"], feature_id=feature["id"], requirement="验证未知静态内容", target_url="https://example.test",
                ))
                generated = main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-STATIC-NEGATIVE | P0 | 未知静态内容 | 页面展示 | 无证据 | 打开页面；读取未知内容 | 未知内容可见 | 自动化 |
"""))
                with self.assertRaisesRegex(main.HTTPException, "没有可复用的页面状态证据"):
                    main.prepare_script_generation(work["id"], main.ContentRequest(case_ids=[generated["testCases"][0]["id"]]))
            finally:
                main.DB_PATH = original_db_path
                main.WORK_ITEM_DRAFT_DIR = original_draft_dir

    async def test_static_snapshots_merge_case_ids_into_shared_state_evidence(self):
        original_db_path = main.DB_PATH
        original_discovery_dir = main.DISCOVERY_DIR

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = "<!doctype html><html><head><title>Shared Static State</title></head><body><nav><a href='/'>首页</a></nav><main><h1>技能库</h1><p>概览统计</p></main></body></html>".encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "shared-state.sqlite"
            main.DISCOVERY_DIR = Path(directory) / "discovery"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_SHARED_STATIC_STATE")
                feature = self.create_feature(project["id"], "共享静态状态")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"], feature_id=feature["id"],
                    requirement="验证技能库页面和概览统计", target_url=f"http://127.0.0.1:{server.server_port}/",
                ))
                generated = main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-SHARED-001 | P0 | 技能库展示 | 页面展示 | 页面可访问 | 打开页面；读取标题 | 技能库可见 | 自动化 |
| TC-CODEX-SHARED-002 | P1 | 概览统计展示 | 页面展示 | 页面可访问 | 打开页面；读取统计 | 概览统计可见 | 自动化 |
"""))
                with patch.object(main.platform, "get_openai_api_key", return_value=""):
                    started = await main.start_exploration_run(work["id"], keep_browser_open=False)
                    completed = await main.wait_for_exploration_result(started["id"], timeout_seconds=45)

                evidence = (completed.get("result") or {}).get("stateEvidence") or []
                external_ids = {case["externalId"] for case in generated["testCases"]}
                self.assertEqual(len(evidence), 1)
                self.assertEqual(set(evidence[0]["caseIds"]), external_ids)
                self.assertTrue(evidence[0]["evidenceKey"].startswith("state-"))
                self.assertEqual(evidence[0]["readinessLocator"], {"kind": "heading", "value": "技能库"})
                self.assertEqual(len(evidence[0]["screenshotPaths"]), 2)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
                main.DB_PATH = original_db_path
                main.DISCOVERY_DIR = original_discovery_dir

    def test_automation_flow_attributes_script_generation_failures_to_script_stage(self):
        source = Path(main.platform.__file__).read_text(encoding="utf-8")

        self.assertIn('fail_automation_flow(flow_run_id, "脚本实现", message)', source)
        self.assertIn('fail_automation_flow(flow_run_id, current_flow_stage, str(exc.detail))', source)
        self.assertIn('current_flow_stage = "运行验证"\n        set_flow_stage(flow_run_id, current_flow_stage, 68)', source)

    def test_navigation_contract_prefers_confirmed_initial_anonymous_state_over_scenario_auth_redirect(self):
        item = {
            "target_url": "https://example.test/#/",
            "requirement": "无需登录访问页面并点击发布入口",
            "acceptance": "首页匿名可访问",
            "role": "匿名访客",
        }
        result = {
            "navigationTarget": {
                "requestedUrl": "https://example.test/#/",
                "resolvedUrl": "https://example.test/#/skills",
                "accessMode": "authentication-required",
                "navigationSteps": [{"action": "click", "target": "发布"}],
            },
            "stateEvidence": [{
                "stateKey": "initial",
                "url": "https://example.test/#/",
                "title": "SkillHub",
                "headings": ["技能库"],
                "caseIds": ["TC-CODEX-STATIC-001"],
            }],
        }

        target = main.navigation_target_from_result(item, result)

        self.assertEqual(target["accessMode"], "anonymous")
        self.assertEqual(target["requiredAccessMode"], "anonymous")
        self.assertEqual(target["navigationSteps"], [])
        self.assertTrue(target["directNavigationAllowed"])

    def test_execution_status_uses_phase_exit_codes_not_canary_title_text(self):
        business_failure = {
            "canary": {"executed": True, "status": "passed", "exitCode": 0},
            "business": {"executed": True, "status": "failed", "exitCode": 1},
        }
        canary_failure = {
            "canary": {"executed": True, "status": "failed", "exitCode": 1},
            "business": {"executed": False, "status": "not-executed", "exitCode": None},
        }

        self.assertEqual(main.execution_status_from_phase_results(business_failure), ("failed", 1))
        self.assertEqual(main.execution_status_from_phase_results(canary_failure), ("blocked", 1))
        self.assertEqual(
            main.execution_failure_classification("failed", "navigation-precondition canary passed\n4 failed")[0],
            "business-assertion",
        )

    def test_legacy_phase_recovery_recognizes_passed_canary_and_failed_business_batch(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "legacy-phase.sqlite"
            try:
                main.init_db()
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, failure_category
                        ) VALUES ('legacy-business-failure', '', 'Legacy', '[]', 'blocked', 'complete', '完成', 100, ?, ?, 1, 'navigation-precondition')
                        """,
                        (timestamp, timestamp),
                    )
                    messages = [
                        "导航 Canary命令: npx playwright test navigation-canary.spec.ts",
                        "✓ navigation-precondition canary",
                        "导航 Canary 已通过，开始执行完整业务用例批次",
                        "业务用例批次命令: npx playwright test failed.spec.ts",
                        "✘ [chromium] › failed.spec.ts:4:1 › TC-CODEX-FAILED",
                        "1 failed",
                    ]
                    conn.executemany(
                        "INSERT INTO logs (run_id, created_at, level, message) VALUES ('legacy-business-failure', ?, 'info', ?)",
                        [(timestamp, message) for message in messages],
                    )
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, failure_category
                        ) VALUES ('legacy-canary-failure', '', 'Legacy', '[]', 'blocked', 'complete', '完成', 100, ?, ?, 1, 'navigation-precondition')
                        """,
                        (timestamp, timestamp),
                    )
                    conn.executemany(
                        "INSERT INTO logs (run_id, created_at, level, message) VALUES ('legacy-canary-failure', ?, 'info', ?)",
                        [
                            (timestamp, "导航 Canary命令: npx playwright test navigation-canary.spec.ts"),
                            (timestamp, "✘ navigation-precondition canary"),
                            (timestamp, "1 failed"),
                        ],
                    )

                business = main.run_execution_phase_summary("legacy-business-failure")
                canary = main.run_execution_phase_summary("legacy-canary-failure")

                self.assertEqual(business["classificationSource"], "legacy-log")
                self.assertEqual(business["canary"]["status"], "passed")
                self.assertEqual(business["business"]["status"], "failed")
                self.assertEqual(business["effectiveFailureCategory"], "business-assertion")
                self.assertEqual(canary["canary"]["status"], "failed")
                self.assertEqual(canary["business"]["status"], "not-executed")
                self.assertEqual(canary["effectiveFailureCategory"], "navigation-precondition")
            finally:
                main.DB_PATH = original_db_path

    def test_preflight_identifies_one_safe_login_entry(self):
        entry = main.exploration_login_entry(self.skillhub_preflight())

        self.assertIsNotNone(entry)
        self.assertEqual(entry["locatorRole"], "link")
        self.assertEqual(entry["locatorValue"], "登录")
        self.assertEqual(main.exploration_recovery_policy(self.skillhub_preflight())["maxAttempts"], 1)

    def test_preflight_prompt_payload_excludes_screenshot_and_sensitive_values(self):
        preflight = self.skillhub_preflight()
        preflight["screenshot_path"] = "/tmp/private-screenshot.png"
        preflight["elements"].append({
            "tag": "input",
            "type": "text",
            "name": "password=super-secret",
            "locatorType": "text",
            "locatorValue": "token=private-token",
            "locatorRole": "",
        })

        payload = main.preflight_prompt_payload(preflight)
        rendered = json.dumps(payload, ensure_ascii=False)

        self.assertNotIn("private-screenshot", rendered)
        self.assertNotIn("super-secret", rendered)
        self.assertNotIn("private-token", rendered)
        self.assertIn("password=***", rendered)
        self.assertIn("token=***", rendered)

    def test_preflight_rejects_ambiguous_login_entries(self):
        preflight = self.skillhub_preflight()
        preflight["elements"].append({"tag": "button", "type": "", "name": "登录", "locatorType": "role", "locatorValue": "登录", "locatorRole": "button"})

        self.assertIsNone(main.exploration_login_entry(preflight))
        self.assertEqual(main.exploration_recovery_policy(preflight), {})

    def test_preflight_rejects_missing_and_unsafe_login_entries(self):
        preflight = self.skillhub_preflight()
        preflight["elements"] = [
            {"tag": "a", "type": "", "name": "注册", "locatorType": "role", "locatorValue": "注册", "locatorRole": "link"},
            {"tag": "button", "type": "", "name": "发布", "locatorType": "role", "locatorValue": "发布", "locatorRole": "button"},
            {"tag": "button", "type": "", "name": "删除", "locatorType": "role", "locatorValue": "删除", "locatorRole": "button"},
        ]

        self.assertIsNone(main.exploration_login_entry(preflight))
        self.assertEqual(main.exploration_recovery_policy(preflight), {})

    def test_plan_requires_login_entry_before_login_surface(self):
        item = {"id": "work-entry", "requirement": "验证登录，账号 alpha，密码 beta。", "target_url": "https://example.test"}
        cases = [{
            "external_id": "TC-ENTRY-001",
            "priority": "P0",
            "title": "登录成功",
            "requirement": "登录",
            "preconditions": "账号 alpha，密码 beta",
            "steps": "打开页面；填写账号 alpha；填写密码 beta；点击登录",
            "expected": "显示欢迎",
            "automation_notes": "自动化",
        }]
        plan = {"scenarios": [{"caseId": "TC-ENTRY-001", "title": "登录成功", "steps": [
            {"action": "navigate", "description": "打开页面", "target": {"kind": "url", "name": "targetUrl", "aliases": [], "exact": True}, "value": "", "expected": {}},
            {"action": "fill", "description": "填写账号", "target": {"kind": "textbox", "name": "账号", "aliases": ["用户名"], "exact": False}, "value": "alpha", "expected": {}},
            {"action": "fill", "description": "填写密码", "target": {"kind": "password", "name": "密码", "aliases": [], "exact": False}, "value": "beta", "expected": {}},
            {"action": "click", "description": "提交登录", "target": {"kind": "button", "name": "登录", "aliases": [], "exact": True}, "value": "", "expected": {"stateChanged": True}},
            {"action": "snapshot", "description": "保存证据", "target": {"kind": "text", "name": "", "aliases": [], "exact": True}, "value": "", "expected": {}},
        ]}]}

        result = main.validate_and_normalize_exploration_plan(plan, item, cases, self.skillhub_preflight())

        fill = next(step for step in result["steps"] if step["action"] == "fill")
        self.assertEqual(fill["recoveryPolicy"]["entry"]["locatorRole"], "link")

    def test_plan_accepts_real_login_link_and_attaches_recovery(self):
        item = {"id": "work-entry-ok", "requirement": "验证登录，账号 alpha，密码 beta。", "target_url": "https://example.test"}
        cases = [{
            "external_id": "TC-ENTRY-OK-001",
            "priority": "P0",
            "title": "登录成功",
            "requirement": "登录",
            "preconditions": "账号 alpha，密码 beta",
            "steps": "打开页面；点击登录；填写账号 alpha；填写密码 beta；点击登录",
            "expected": "显示欢迎",
            "automation_notes": "自动化",
        }]
        plan = {"scenarios": [{"caseId": "TC-ENTRY-OK-001", "title": "登录成功", "steps": [
            {"action": "navigate", "description": "打开页面", "target": {"kind": "url", "name": "targetUrl", "aliases": [], "exact": True}, "value": "", "expected": {}},
            {"action": "click", "description": "点击登录入口", "target": {"kind": "link", "name": "登录", "aliases": ["Sign in"], "exact": True}, "value": "", "expected": {}},
            {"action": "fill", "description": "填写账号", "target": {"kind": "textbox", "name": "账号", "aliases": ["用户名"], "exact": False}, "value": "alpha", "expected": {}},
            {"action": "fill", "description": "填写密码", "target": {"kind": "password", "name": "密码", "aliases": [], "exact": False}, "value": "beta", "expected": {}},
            {"action": "click", "description": "点击登录按钮", "target": {"kind": "button", "name": "登录", "aliases": [], "exact": True}, "value": "", "expected": {"textAny": ["欢迎"]}},
            {"action": "assert", "description": "验证欢迎", "target": {"kind": "text", "name": "欢迎", "aliases": [], "exact": False}, "value": "", "expected": {"textAny": ["欢迎"]}},
            {"action": "snapshot", "description": "保存证据", "target": {"kind": "text", "name": "", "aliases": [], "exact": True}, "value": "", "expected": {}},
        ]}]}

        result = main.validate_and_normalize_exploration_plan(plan, item, cases, self.skillhub_preflight())

        self.assertEqual(result["version"], 4)
        self.assertEqual(result["preflight"]["candidateCount"], 3)
        entry_step = next(step for step in result["steps"] if step["action"] == "click" and step["targetMeta"]["kind"] == "link")
        self.assertTrue(entry_step["targetMeta"]["exact"])
        fill = next(step for step in result["steps"] if step["action"] == "fill")
        self.assertEqual(fill["recoveryPolicy"]["entry"]["locatorRole"], "link")

    def test_compound_login_control_assertion_is_rejected(self):
        item = {"id": "work-controls", "requirement": "验证登录页表单", "target_url": "https://example.test"}
        cases = [{"external_id": "TC-CONTROLS-001", "title": "登录表单", "requirement": "登录页", "preconditions": "", "steps": "打开页面；等待表单", "expected": "账号框、密码框和登录按钮可见", "automation_notes": "自动化"}]
        raw = main.deterministic_exploration_asset_plan(item, cases, self.skillhub_preflight())
        result = main.validate_and_normalize_exploration_plan(raw, item, cases, self.skillhub_preflight())

        self.assertNotIn("assert", {step["action"] for step in result["steps"]})
        self.assertEqual({target["kind"] for target in result["targets"]}, {"link", "textbox", "password", "button"})
        login_locates = [step for step in result["steps"] if step["action"] == "locate" and step["targetMeta"].get("stateKey") == "login"]
        self.assertTrue(login_locates)
        self.assertTrue(all(step.get("recoveryPolicy", {}).get("type") == "unique_login_entry" for step in login_locates))
        self.assertTrue(all("recoveryPolicy" not in step for step in result["steps"] if step["targetMeta"].get("stateKey") == "initial"))

    def test_search_asset_plan_uses_real_preflight_input_and_ignores_negative_login_context(self):
        item = {
            "id": "work-search-assets",
            "requirement": "帮我测试搜索功能，不需要登录，分别按照技能、作者、标签进行查询验证",
            "target_url": "http://192.168.7.181:8080/#/",
        }
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-QA-TASK-262991-SEARCH-001 | P0 | 无需登录进入搜索页成功 | 验收标准：无需登录访问目标网站搜索功能 | 目标 URL；未登录浏览器会话 | 1. 打开目标 URL<br>2. 定位搜索功能入口或搜索输入区域 | 页面可正常访问；未跳转登录页；搜索功能入口或搜索输入区域可见且可操作 | Playwright 冒烟用例 |
| TC-QA-TASK-262991-SEARCH-002 | P0 | 技能输入QA自动化测试返回匹配结果 | 按技能查询验证 | 技能=QA自动化测试；未登录浏览器会话 | 1. 打开目标 URL<br>2. 进入搜索功能<br>3. 选择或输入技能查询条件<br>4. 输入 QA自动化测试 并执行搜索<br>5. 查看搜索结果列表 | 搜索结果成功展示；无登录拦截 | Playwright P0 冒烟主流程 |
| TC-QA-TASK-262991-SEARCH-003 | P1 | 作者输入孙英杰返回匹配结果 | 按作者查询验证 | 作者=孙英杰；未登录浏览器会话 | 1. 打开目标 URL<br>2. 进入搜索功能<br>3. 选择或输入作者查询条件<br>4. 输入 孙英杰 并执行搜索<br>5. 查看搜索结果列表 | 搜索结果成功展示；无登录拦截 | Playwright 回归用例 |
| TC-QA-TASK-262991-SEARCH-004 | P1 | 标签输入3D大屏返回匹配结果 | 按标签查询验证 | 标签=3D大屏；未登录浏览器会话 | 1. 打开目标 URL<br>2. 进入搜索功能<br>3. 选择或输入标签查询条件<br>4. 输入 3D大屏 并执行搜索<br>5. 查看搜索结果列表 | 搜索结果成功展示；无登录拦截 | Playwright 回归用例 |
| TC-QA-TASK-262991-SEARCH-005 | P2 | 切换查询条件后结果随条件更新 | 分别按技能、作者、标签执行查询 | 技能、作者、标签；未登录浏览器会话 | 1. 打开目标 URL<br>2. 先按技能 QA自动化测试 搜索并记录结果状态<br>3. 切换为作者 孙英杰 搜索并记录结果状态<br>4. 切换为标签 3D大屏 搜索并记录结果状态 | 每次切换查询条件后结果区域刷新 | 覆盖搜索状态刷新与查询条件切换风险 |
"""
        cases = main.parse_cases_markdown(cases_markdown)

        raw = main.deterministic_exploration_asset_plan(item, cases, self.skillhub_preflight())
        result = main.validate_and_normalize_exploration_plan(raw, item, cases, self.skillhub_preflight())

        self.assertEqual(main.exploration_case_step_fragments(cases[1]), [
            "打开目标 URL",
            "进入搜索功能",
            "选择或输入技能查询条件",
            "输入 QA自动化测试 并执行搜索",
            "查看搜索结果列表",
        ])
        self.assertEqual(len(result["targets"]), 1)
        target = result["targets"][0]
        self.assertEqual(target["kind"], "textbox")
        self.assertEqual(target["name"], "搜索技能、作者、标签")
        self.assertEqual(target["caseIds"], [case["external_id"] for case in cases])
        self.assertNotIn("login", {target["stateKey"] for target in result["targets"]})
        rendered = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("<br>", rendered)
        self.assertNotIn("切换风险", rendered)
        self.assertNotIn("查询条件后结果随条件更新", rendered)

    def test_low_confidence_step_phrases_fall_back_instead_of_becoming_targets(self):
        item = {"id": "work-low-confidence", "requirement": "验证筛选状态更新", "target_url": "https://example.test"}
        cases = [{
            "external_id": "TC-LOW-CONFIDENCE-001",
            "title": "切换查询条件后结果随条件更新",
            "requirement": "状态更新",
            "preconditions": "",
            "steps": "1. 打开页面<br>2. 切换查询条件后记录结果状态",
            "expected": "结果区域刷新",
            "automation_notes": "覆盖切换风险",
        }]
        preflight = {**self.skillhub_preflight(), "elements": self.skillhub_preflight()["elements"][1:]}

        self.assertIsNone(main.deterministic_exploration_asset_plan(item, cases, preflight))

    def test_exploration_target_quality_rejects_html_and_abstract_step_fragments(self):
        self.assertEqual(main.sanitize_exploration_phrase("选择条件<br>4. 输入关键词"), "选择条件 4. 输入关键词")
        self.assertIn("HTML", main.exploration_target_quality_error("选择条件<br>4. 输入关键词"))
        self.assertIn("复合步骤", main.exploration_target_quality_error("选择条件 4. 输入关键词"))
        self.assertIn("抽象结果", main.exploration_target_quality_error("查看搜索结果列表"))
        self.assertEqual(main.exploration_target_quality_error("搜索技能、作者、标签"), "")

    def test_transition_case_rejects_locate_only_false_positive_plan(self):
        item = {
            "id": "work-false-positive",
            "requirement": "输入关键词并执行搜索",
            "target_url": "https://example.test",
        }
        cases = [{
            "external_id": "TC-CODEX-EXPLORE-001",
            "priority": "P0",
            "title": "关键词搜索返回结果",
            "requirement": "搜索",
            "preconditions": "关键词=自动化",
            "steps": "打开页面；在搜索框输入自动化；执行搜索；查看结果",
            "expected": "展示匹配结果",
            "automation_notes": "自动化",
        }]
        raw = {
            "targets": [{
                "targetId": "search-input",
                "kind": "textbox",
                "name": "搜索技能、作者、标签",
                "aliases": [],
                "caseIds": ["TC-CODEX-EXPLORE-001"],
                "stateKey": "initial",
                "required": True,
            }],
            "journeys": [{
                "journeyId": "search",
                "title": "搜索",
                "stateKey": "initial",
                "caseIds": ["TC-CODEX-EXPLORE-001"],
                "steps": [
                    {"action": "navigate", "targetId": "", "value": "", "description": "打开页面", "expected": {}},
                    {"action": "locate", "targetId": "search-input", "value": "", "description": "确认搜索框", "expected": {}},
                    {"action": "snapshot", "targetId": "", "value": "", "description": "保存证据", "expected": {}},
                ],
            }],
        }

        with self.assertRaises(main.ExplorationPlanBuildError) as raised:
            main.validate_and_normalize_exploration_plan(raw, item, cases, self.skillhub_preflight())

        self.assertEqual(raised.exception.code, "incomplete_case_journey")

    def test_clickable_property_uses_actionability_but_click_transition_stays_strict(self):
        actionable_case = {
            "external_id": "TC-CODEX-ACTIONABLE-001",
            "priority": "P0",
            "title": "帮助链接可见且可点击",
            "requirement": "链接可点击",
            "preconditions": "",
            "steps": "打开页面；确认 More information 链接可见并可点击",
            "expected": "链接可操作",
            "automation_notes": "自动化",
        }
        transition_case = {
            **actionable_case,
            "external_id": "TC-CODEX-ACTIONABLE-002",
            "title": "点击帮助链接后进入说明页",
            "steps": "打开页面；点击 More information 链接；确认进入说明页",
            "expected": "进入说明页面",
        }

        self.assertTrue(main.exploration_case_requires_actionability(actionable_case))
        self.assertTrue(main.exploration_case_is_actionability_only(actionable_case))
        self.assertTrue(main.exploration_case_requires_link_href(actionable_case))
        self.assertNotIn("click", main.exploration_case_required_actions(actionable_case))
        self.assertFalse(main.exploration_case_requires_interaction(actionable_case))
        self.assertIn("click", main.exploration_case_required_actions(transition_case))
        self.assertTrue(main.exploration_case_requires_interaction(transition_case))
        self.assertFalse(main.exploration_case_is_actionability_only(transition_case))

    def test_anonymous_visitor_without_credentials_is_anonymous_access(self):
        item = {
            "title": "Example Domain 页面",
            "requirement": "角色为匿名访客，不需要账号和密码。",
            "acceptance": "页面可直接访问",
            "exclusions": "不覆盖登录流程",
            "role": "匿名访客",
        }

        self.assertTrue(main.explicitly_anonymous_item(item))
        self.assertEqual(main.infer_access_mode(item), "anonymous")
        self.assertFalse(main.is_login_like_item(item))

    def test_example_domain_actionability_has_deterministic_exploration_fallback(self):
        item = {
            "id": "work-example-fallback",
            "requirement": "访问 https://example.com，验证 Example Domain 标题和 More information... 链接可见并可点击。",
            "target_url": "https://example.com",
        }
        cases = [
            {
                "external_id": "TC-EXAMPLE-001",
                "priority": "P0",
                "title": "页面显示 Example Domain 标题",
                "requirement": "标题展示",
                "preconditions": "",
                "steps": "打开页面；观察 Example Domain 标题",
                "expected": "页面显示 Example Domain",
                "automation_notes": "自动化",
            },
            {
                "external_id": "TC-EXAMPLE-002",
                "priority": "P1",
                "title": "More information 链接可点击",
                "requirement": "链接可点击",
                "preconditions": "",
                "steps": "打开页面；点击 More information... 链接确认其可点击",
                "expected": "链接可操作",
                "automation_notes": "自动化",
            },
        ]
        preflight = {
            "final_url": "https://example.com",
            "title": "Example Domain",
            "structure": {"headings": ["Example Domain"], "links": 1},
            "elements": [{
                "tag": "a",
                "type": "",
                "name": "More information...",
                "locatorType": "role",
                "locatorRole": "link",
                "locatorValue": "More information...",
            }],
        }

        raw = main.deterministic_exploration_asset_plan(item, cases, preflight)
        result = main.validate_and_normalize_exploration_plan(raw, item, cases, preflight)
        with patch.object(main.platform, "call_openai_responses_stream", side_effect=AssertionError("规则计划完整时不应调用 AI")):
            fallback = main.ai_exploration_plan(item, main.serialize_case_assistant_rows([
                main.case_assistant_api_row(case) for case in cases
            ]), preflight)

        self.assertEqual(len(result["targets"]), 1)
        self.assertIn("TC-EXAMPLE-002", result["targets"][0]["caseIds"])
        self.assertIn("locate", {step["action"] for step in result["steps"]})
        self.assertNotIn("click", {step["action"] for step in result["steps"]})
        self.assertEqual(fallback["source"], "system")

    def test_actionable_link_evidence_proves_static_p0_case(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "actionability-quality.sqlite"
            try:
                main.init_db()
                project = main.create_project(main.ProjectRequest(name="CODEX_TEST_ACTIONABILITY"))
                feature = self.create_feature(project["id"], "静态链接")
                with patch.object(main.platform, "analyze_requirement_with_ai", return_value={}):
                    work = main.create_work_item(main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="访问 https://example.com，确认帮助链接可见且可点击。",
                        target_url="https://example.com",
                    ))
                generated = main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-ACTIONABLE-P0 | P0 | 帮助链接可见且可点击 | 链接 actionability | Example Domain | 打开页面；确认 More information 链接可见并可点击 | 链接可操作 | 自动化 |
"""))
                case_id = generated["testCases"][0]["externalId"]
                item = main.get_work_item_row(work["id"])
                target = {"targetId": "more-info", "name": "More information...", "required": True, "caseIds": [case_id]}
                rows = [
                    {
                        "critical": 1,
                        "status": "passed",
                        "action": "locate",
                        "screenshot_path": "",
                        "structure_json": "",
                        "candidates_json": "[]",
                        "case_id": case_id,
                        "target_json": json.dumps({"caseIds": [case_id], "targetId": "more-info"}),
                        "expected_json": "{}",
                        "resolved_target_json": json.dumps({
                            "actionable": True,
                            "visible": True,
                            "enabled": True,
                            "href": "https://www.iana.org/help/example-domains",
                        }),
                    },
                    {
                        "critical": 0,
                        "status": "passed",
                        "action": "snapshot",
                        "screenshot_path": "/tmp/actionable.png",
                        "structure_json": json.dumps({"title": "Example Domain"}),
                        "candidates_json": "[]",
                        "case_id": case_id,
                        "target_json": json.dumps({"caseIds": [case_id], "targetId": "more-info"}),
                        "expected_json": "{}",
                        "resolved_target_json": "{}",
                    },
                ]
                quality, coverage = main.exploration_quality_assessment(
                    item,
                    [target],
                    rows,
                    [],
                    {
                        "requestedUrl": "https://example.com",
                        "resolvedUrl": "https://example.com",
                        "readinessSignals": [{"title": "Example Domain"}],
                        "navigationPathConfirmed": True,
                    },
                    [{"targetId": "more-info", "confidence": 95, "matchCount": 1, "autoConfirmEligible": True}],
                )

                self.assertEqual(quality["level"], "high")
                self.assertEqual(coverage[0]["status"], "proven")
                self.assertTrue(coverage[0]["actionabilityVerified"])
            finally:
                main.DB_PATH = original_db_path

    def test_static_heading_case_uses_unscoped_snapshot_evidence(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "static-quality.sqlite"
            try:
                main.init_db()
                project = main.create_project(main.ProjectRequest(name="CODEX_TEST_STATIC_EVIDENCE"))
                feature = self.create_feature(project["id"], "静态标题")
                with patch.object(main.platform, "analyze_requirement_with_ai", return_value={}):
                    work = main.create_work_item(main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="访问 https://example.com，验证页面显示 Example Domain 标题。",
                        target_url="https://example.com",
                    ))
                generated = main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-STATIC-P0 | P0 | 页面显示 Example Domain 标题 | 标题展示 | Example Domain | 打开页面；观察页面标题 | 页面显示 Example Domain | 自动化 |
"""))
                item = main.get_work_item_row(work["id"])
                snapshot_row = {
                    "critical": 0,
                    "status": "passed",
                    "action": "snapshot",
                    "screenshot_path": "/tmp/static.png",
                    "structure_json": json.dumps({"title": "Example Domain", "headings": ["Example Domain"], "texts": []}),
                    "candidates_json": "[]",
                    "case_id": "",
                    "target_json": json.dumps({"caseIds": []}),
                    "expected_json": "{}",
                    "resolved_target_json": "{}",
                }
                quality, coverage = main.exploration_quality_assessment(
                    item,
                    [],
                    [snapshot_row],
                    [],
                    {
                        "requestedUrl": "https://example.com",
                        "resolvedUrl": "https://example.com",
                        "readinessSignals": [{"title": "Example Domain"}],
                        "navigationPathConfirmed": True,
                    },
                    [],
                )

                self.assertEqual(quality["level"], "medium")
                self.assertEqual(coverage[0]["status"], "proven")
                self.assertTrue(coverage[0]["staticEvidenceVerified"])
                self.assertEqual(generated["testCases"][0]["externalId"], coverage[0]["caseId"])
            finally:
                main.DB_PATH = original_db_path

    def test_plan_preserves_postconditions_and_fill_value_evidence(self):
        item = {"id": "work-expected", "requirement": "点击登录入口", "target_url": "https://example.test"}
        cases = [{
            "external_id": "TC-CODEX-EXPECTED-001",
            "priority": "P0",
            "title": "进入登录页面",
            "requirement": "登录入口",
            "preconditions": "",
            "steps": "打开页面；点击登录",
            "expected": "显示账号输入框",
            "automation_notes": "自动化",
        }]
        raw = {
            "targets": [{
                "targetId": "login-entry",
                "kind": "link",
                "name": "登录",
                "aliases": [],
                "caseIds": ["TC-CODEX-EXPECTED-001"],
                "stateKey": "initial",
                "required": True,
            }],
            "journeys": [{
                "journeyId": "login",
                "title": "登录入口",
                "stateKey": "initial",
                "caseIds": ["TC-CODEX-EXPECTED-001"],
                "steps": [
                    {"action": "navigate", "targetId": "", "value": "", "description": "打开页面", "expected": {}},
                    {
                        "action": "click",
                        "targetId": "login-entry",
                        "value": "",
                        "description": "点击登录",
                        "expected": {"urlContains": "/login", "urlNotContains": "", "textAny": ["账号"], "textAbsent": [], "stateChanged": True},
                    },
                    {"action": "snapshot", "targetId": "", "value": "", "description": "保存证据", "expected": {}},
                ],
            }],
        }

        result = main.validate_and_normalize_exploration_plan(raw, item, cases, self.skillhub_preflight())
        click = next(step for step in result["steps"] if step["action"] == "click")

        self.assertEqual(click["expected"]["urlContains"], "/login")
        self.assertEqual(click["expected"]["textAny"], ["账号"])
        self.assertTrue(click["expected"]["stateChanged"])

    def test_auto_confirm_requires_unique_stable_non_text_locator(self):
        result = {
            "resolved_elements": [
                {"locatorType": "testid", "locatorValue": "submit", "locatorRole": "", "confidence": 98, "matchCount": 1, "autoConfirmEligible": True},
                {"locatorType": "text", "locatorValue": "登录", "locatorRole": "", "confidence": 95, "matchCount": 1, "autoConfirmEligible": True},
                {"locatorType": "role", "locatorValue": "登录", "locatorRole": "button", "confidence": 90, "matchCount": 2, "autoConfirmEligible": False},
            ],
            "elements": [
                {"locatorType": "testid", "locatorValue": "submit", "locatorRole": "", "source": "resolved"},
                {"locatorType": "text", "locatorValue": "登录", "locatorRole": "", "source": "candidate"},
                {"locatorType": "role", "locatorValue": "登录", "locatorRole": "button", "source": "ambiguous"},
            ],
        }

        confirmed, count = main.auto_confirm_exploration_result(result)

        self.assertEqual(count, 1)
        self.assertTrue(confirmed["elements"][0]["confirmed"])
        self.assertFalse(confirmed["elements"][1]["confirmed"])
        self.assertFalse(confirmed["elements"][2]["confirmed"])

    def test_exploration_quality_balances_p0_proof_and_optional_case_gaps(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "quality.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_EXPLORATION_QUALITY")
                feature = self.create_feature(project["id"], "探索质量")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"],
                    feature_id=feature["id"],
                    requirement="CODEX_TEST_EXPLORATION_QUALITY 验证搜索和可选筛选",
                    target_url="https://example.test/search",
                ))
                generated = main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-QUALITY-P0 | P0 | 搜索主流程 | 搜索 | 关键词=alpha | 输入 alpha；点击搜索 | 展示结果 | 自动化 |
| TC-CODEX-QUALITY-P1 | P1 | 可选筛选 | 筛选 | 已进入搜索页 | 选择标签 | 结果更新 | 自动化 |
"""))
                item = main.get_work_item_row(work["id"])
                generated_cases = generated["testCases"]
                p0_external_id = next(case["externalId"] for case in generated_cases if case["priority"] == "P0")
                p1_external_id = next(case["externalId"] for case in generated_cases if case["priority"] == "P1")

                def row(case_id, action, *, snapshot=False, expected=None, target_id="search"):
                    return {
                        "critical": 0 if snapshot else 1,
                        "status": "passed",
                        "action": action,
                        "screenshot_path": "/tmp/evidence.png" if snapshot else "",
                        "structure_json": json.dumps({"title": "Search"}) if snapshot else "",
                        "candidates_json": "[]",
                        "case_id": case_id,
                        "target_json": json.dumps({"caseIds": [case_id], "targetId": target_id}),
                        "expected_json": json.dumps(expected or {}),
                        "resolved_target_json": json.dumps({"expectedChecks": [{"type": "stateChanged", "passed": True}]}) if not snapshot else "{}",
                    }

                p0_rows = [
                    row(p0_external_id, "fill", expected={"valueEquals": "alpha"}),
                    row(p0_external_id, "click", expected={"stateChanged": True}),
                    row(p0_external_id, "snapshot", snapshot=True),
                ]
                targets = [
                    {"targetId": "search", "name": "搜索", "required": True, "caseIds": [p0_external_id]},
                    {"targetId": "filter", "name": "标签筛选", "required": True, "caseIds": [p1_external_id]},
                ]
                navigation = {
                    "requestedUrl": "https://example.test/search",
                    "resolvedUrl": "https://example.test/search",
                    "readinessSignals": [{"title": "Search"}],
                    "navigationPathConfirmed": True,
                }
                resolved = [{
                    "targetId": "search", "confidence": 98, "matchCount": 1,
                    "autoConfirmEligible": True,
                }]

                medium, coverage = main.exploration_quality_assessment(
                    item,
                    targets,
                    p0_rows,
                    [{"targetId": "filter", "name": "标签筛选", "caseIds": [p1_external_id]}],
                    navigation,
                    resolved,
                )
                self.assertEqual(medium["level"], "medium")
                self.assertEqual(medium["provenCaseIds"], [p0_external_id])
                self.assertEqual(next(case for case in coverage if case["caseId"] == p1_external_id)["status"], "blocked-by-exploration")

                p1_rows = [
                    row(p1_external_id, "select", expected={"stateChanged": True}, target_id="filter"),
                    row(p1_external_id, "snapshot", snapshot=True, target_id="filter"),
                ]
                high, high_coverage = main.exploration_quality_assessment(
                    item,
                    targets,
                    [*p0_rows, *p1_rows],
                    [],
                    navigation,
                    [
                        *resolved,
                        {"targetId": "filter", "confidence": 90, "matchCount": 1, "autoConfirmEligible": True},
                    ],
                )
                self.assertEqual(high["level"], "high")
                self.assertTrue(all(case["status"] == "proven" for case in high_coverage))

                low, _ = main.exploration_quality_assessment(
                    item,
                    targets,
                    [],
                    targets,
                    navigation,
                    [],
                )
                self.assertEqual(low["level"], "low")
            finally:
                main.DB_PATH = original_db_path

    def test_run_7ea343a100de_negative_login_constraints_do_not_create_login_assets(self):
        item = {
            "id": "work-e948fb",
            "requirement": "帮我测试搜索功能，不需要登录，分别按照技能、作者、标签进行查询验证",
            "target_url": "http://192.168.7.181:8080/#/",
        }
        cases_markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-QA-TASK-E948FB-SEARCH-001 | P0 | 无登录访问搜索页成功 | 目标 URL 无需登录可访问；排除登录/注册流程 | 未登录浏览器上下文 | 1. 打开未登录浏览器上下文<br>2. 访问目标 URL<br>3. 观察页面是否包含搜索入口 | 页面可正常访问；未跳转登录/注册页；可找到搜索入口 | 断言搜索输入框可见 |
| TC-QA-TASK-E948FB-SEARCH-002 | P0 | 技能关键词返回相关结果 | 按技能执行搜索 | 技能查询词 | 1. 访问目标 URL<br>2. 在搜索入口输入关键词<br>3. 执行查询 | 返回相关结果；无登录拦截 | 主流程 |
| TC-QA-TASK-E948FB-SEARCH-003 | P0 | 作者关键词返回相关结果 | 按作者执行搜索 | 作者查询词 | 1. 访问目标 URL<br>2. 在搜索入口输入作者<br>3. 执行查询 | 返回相关结果 | 主流程 |
| TC-QA-TASK-E948FB-SEARCH-004 | P0 | 标签关键词返回相关结果 | 按标签执行搜索 | 标签查询词 | 1. 访问目标 URL<br>2. 在搜索入口输入标签<br>3. 执行查询 | 返回相关结果 | 主流程 |
| TC-QA-TASK-E948FB-SEARCH-005 | P1 | 切换查询条件结果更新 | 切换搜索条件 | 三组查询词 | 1. 访问目标 URL<br>2. 切换搜索条件 | 结果随条件更新 | 回归 |
| TC-QA-TASK-E948FB-SEARCH-006 | P1 | 空关键词提交显示反馈 | 搜索边界 | 空关键词 | 1. 访问目标 URL<br>2. 执行空搜索 | 显示预期反馈 | 候选 |
| TC-QA-TASK-E948FB-SEARCH-007 | P2 | 查询后刷新状态正常 | 搜索刷新 | 任一查询词 | 1. 访问目标 URL<br>2. 执行搜索<br>3. 刷新页面 | 页面状态正常；无登录拦截 | 非强制回归 |
"""
        cases = main.parse_cases_markdown(cases_markdown)

        raw = main.deterministic_exploration_asset_plan(item, cases, self.skillhub_preflight())
        result = main.validate_and_normalize_exploration_plan(raw, item, cases, self.skillhub_preflight())

        self.assertTrue(all(not main.exploration_case_requires_login(case, item["requirement"]) for case in cases))
        self.assertEqual([(target["kind"], target["name"]) for target in result["targets"]], [("textbox", "搜索技能、作者、标签")])
        target = result["targets"][0]
        self.assertEqual(target["evidenceSource"], "preflight")
        self.assertEqual(target["locatorHints"], [{
            "locatorType": "placeholder",
            "locatorValue": "搜索技能、作者、标签",
            "locatorRole": "",
        }])
        navigate, locate, snapshot = result["steps"]
        self.assertEqual(navigate["readiness"]["preflightCandidateCount"], 3)
        self.assertEqual(navigate["readinessHints"], target["locatorHints"])
        self.assertNotIn("recoveryPolicy", locate)
        self.assertEqual(snapshot["action"], "snapshot")

    def test_browser_worker_collects_login_button_and_validates_expected_click_state(self):
        worker_source = main.BROWSER_WORKER_PATH.read_text(encoding="utf-8")
        readiness_source = main.BROWSER_WORKER_PATH.with_name("page_readiness.cjs").read_text(encoding="utf-8")

        self.assertIn("resolveSemanticTarget", worker_source)
        self.assertIn("page.getByRole(kind", worker_source)
        self.assertIn("start-scenario", worker_source)
        self.assertIn("browser.newContext({ viewport })", worker_source)
        self.assertIn("verifyPostcondition(step", worker_source)
        self.assertIn("window.location.href.includes(fragment)", worker_source)
        self.assertIn("resolveWithControlledRecovery", worker_source)
        self.assertIn("scenarioRecoveryAttempts >= maxAttempts", worker_source)
        self.assertIn("LOGIN_ENTRY_PATTERN", worker_source)
        self.assertIn("matches.length !== 1", worker_source)
        self.assertIn("scenarioRecoveryAttempts = 0", worker_source)
        self.assertIn("role=${kind} exact name=${name}", worker_source)
        self.assertIn("if (!exact) addStrategy", worker_source)
        self.assertIn("const waitForPageStable", worker_source)
        self.assertIn("TARGET_RESOLVE_TIMEOUT_MS = 6000", worker_source)
        self.assertIn("Page did not become stable", readiness_source)
        self.assertIn("target_ambiguous", worker_source)
        self.assertIn("target_not_found", worker_source)
        self.assertIn("page_not_ready", worker_source)
        self.assertIn("const maxAttempts = 2", worker_source)
        self.assertIn("selectionPolicy === 'first-safe'", worker_source)
        self.assertIn('[data-testid="${escaped}"], [data-test="${escaped}"]', readiness_source)

    async def test_browser_worker_waits_for_delayed_spa_and_retries_blank_navigation_once(self):
        class Handler(BaseHTTPRequestHandler):
            retry_requests = 0

            def do_GET(self):
                if self.path == "/favicon.ico":
                    self.send_response(204)
                    self.end_headers()
                    return
                if self.path.startswith("/missing"):
                    body = "<html><body></body></html>"
                elif self.path.startswith("/unique-action"):
                    body = """<html><body>
<h1>Ready</h1><button data-test="go-action" onclick="document.querySelector('h1').textContent='Done'">Go</button>
</body></html>"""
                elif self.path.startswith("/first-safe"):
                    body = """<html><body>
<input placeholder="First safe"><h1>Ready</h1>
<button data-test="add-to-cart-first" onclick="document.querySelector('h1').textContent='First selected'">Add to cart</button>
<button data-test="add-to-cart-second" onclick="document.querySelector('h1').textContent='Second selected'">Add to cart</button>
</body></html>"""
                elif self.path.startswith("/duplicate-action"):
                    body = """<html><body><h1>Ready</h1><button>Save</button><button>Save</button></body></html>"""
                elif self.path.startswith("/overlay"):
                    body = """<html><body>
<div class="loading-mask" style="position:fixed;inset:0;z-index:100;background:white">Loading</div>
<input placeholder="Overlay search">
<script>setTimeout(() => document.querySelector('.loading-mask').remove(), 700);</script>
</body></html>"""
                elif self.path.startswith("/retry"):
                    Handler.retry_requests += 1
                    body = (
                        "<html><body></body></html>"
                        if Handler.retry_requests == 1
                        else '<html><body><input placeholder="Retry search"></body></html>'
                    )
                else:
                    body = """<html><body><script>
setTimeout(() => {
  document.body.innerHTML = '<input placeholder="Delayed search">';
}, 900);
</script></body></html>"""
                encoded = body.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, format, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        async def run_worker_step(url, placeholder, timeout_ms, expect_error=False, action_step=None):
            artifact_dir = tempfile.mkdtemp(prefix="CODEX_TEST_EXPLORATION_WORKER_")
            process = await asyncio.create_subprocess_exec(
                "node",
                str(main.BROWSER_WORKER_PATH),
                f"session-{placeholder.lower().replace(' ', '-')}",
                url,
                json.dumps({"width": 960, "height": 640}),
                cwd=main.ROOT_DIR,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=16 * 1024 * 1024,
            )

            async def read_until(predicate, timeout=12):
                events = []
                while True:
                    raw = await asyncio.wait_for(process.stdout.readline(), timeout=timeout)
                    if not raw:
                        await asyncio.wait_for(process.wait(), timeout=2)
                        stderr = (await asyncio.wait_for(process.stderr.read(), timeout=2)).decode(errors="replace")
                        self.fail(stderr or f"browser worker exited with {process.returncode}")
                    event = json.loads(raw.decode())
                    events.append(event)
                    if predicate(event):
                        return events, event

            async def command(payload):
                process.stdin.write((json.dumps(payload) + "\n").encode())
                await process.stdin.drain()
                return await read_until(lambda event: event.get("type") == "ack" and event.get("commandId") == payload.get("commandId"))

            try:
                await read_until(lambda event: event.get("type") == "ready")
                _, scenario_ack = await command({"type": "start-scenario", "scenario": {"scenarioIndex": 0}, "commandId": "scenario-0"})
                self.assertEqual(scenario_ack["status"], "ok")
                events, step_ack = await command({
                    "type": "execute-step",
                    "commandId": "step-0",
                    "step": {
                        "index": 0,
                        "action": "navigate",
                        "target": url,
                        "description": "打开延迟页面",
                        "readinessHints": [{"locatorType": "placeholder", "locatorValue": placeholder, "locatorRole": ""}],
                        "readiness": {"minInteractive": 1, "preflightCandidateCount": 1, "timeoutMs": timeout_ms},
                        "screenshotPath": str(Path(artifact_dir) / f"{placeholder.replace(' ', '-')}.png"),
                    },
                })
                if expect_error:
                    self.assertEqual(step_ack["status"], "error", step_ack)
                    return step_ack
                self.assertEqual(step_ack["status"], "ok", step_ack)
                step_result = next(event for event in events if event.get("type") == "step-result")
                if action_step is not None:
                    action_payload = {
                        **action_step,
                        "index": 1,
                        "readiness": {"minInteractive": 1, "preflightCandidateCount": 1, "timeoutMs": 3000},
                        "screenshotPath": str(Path(artifact_dir) / "action.png"),
                    }
                    action_events, action_ack = await command({
                        "type": "execute-step",
                        "commandId": "step-1",
                        "step": action_payload,
                    })
                    action_result = next((event for event in action_events if event.get("type") == "step-result"), None)
                    return {"readiness": step_result["diagnostics"]["readiness"], "ack": action_ack, "result": action_result}
                return step_result["diagnostics"]["readiness"]
            finally:
                if process.returncode is None:
                    process.stdin.write((json.dumps({"type": "control", "action": "stop", "commandId": "stop"}) + "\n").encode())
                    await process.stdin.drain()
                    process.stdin.close()
                    await process.stdin.wait_closed()
                    await asyncio.wait_for(process.wait(), timeout=5)
                shutil.rmtree(artifact_dir, ignore_errors=True)

        try:
            base_url = f"http://127.0.0.1:{server.server_port}"
            repeated = [
                await run_worker_step(f"{base_url}/delayed?run={index}", "Delayed search", 3000)
                for index in range(5)
            ]
            delayed = repeated[0]
            overlay = await run_worker_step(f"{base_url}/overlay", "Overlay search", 3500)
            unique_action = await run_worker_step(
                f"{base_url}/unique-action",
                "Go",
                3000,
                action_step={
                    "action": "click",
                    "target": "Go",
                    "description": "点击唯一按钮",
                    "targetMeta": {
                        "kind": "button",
                        "name": "Go",
                        "aliases": [],
                        "exact": True,
                        "locatorHints": [{"locatorType": "testid", "locatorValue": "go-action", "locatorRole": ""}],
                    },
                    "expected": {"textAny": ["Done"], "stateChanged": True},
                },
            )
            first_safe_action = await run_worker_step(
                f"{base_url}/first-safe",
                "First safe",
                3000,
                action_step={
                    "action": "click",
                    "target": "Add to cart",
                    "description": "选择首个安全候选",
                    "targetMeta": {
                        "kind": "button",
                        "name": "Add to cart",
                        "aliases": [],
                        "exact": True,
                        "selectionPolicy": "first-safe",
                        "locatorHints": [{"locatorType": "css", "locatorValue": "[data-test^=\"add-to-cart-\"]", "locatorRole": "button"}],
                    },
                    "expected": {"textAny": ["First selected"], "stateChanged": True},
                },
            )
            duplicate_action = await run_worker_step(
                f"{base_url}/duplicate-action",
                "Save",
                3000,
                action_step={
                    "action": "click",
                    "target": "Save",
                    "description": "点击重复按钮",
                    "targetMeta": {"kind": "button", "name": "Save", "aliases": [], "exact": True},
                    "expected": {"stateChanged": True},
                },
            )
            retried = await run_worker_step(f"{base_url}/retry", "Retry search", 1800)
            missing = await run_worker_step(f"{base_url}/missing", "Missing search", 1800, expect_error=True)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(delayed["retryCount"], 0)
        self.assertGreaterEqual(delayed["readinessMs"], 800)
        self.assertTrue(all(result["retryCount"] == 0 for result in repeated))
        self.assertEqual(len({result["visibleHintCount"] for result in repeated}), 1)
        self.assertEqual(overlay["retryCount"], 0)
        self.assertGreaterEqual(overlay["readinessMs"], 1400)
        self.assertEqual(overlay["blockingOverlayCount"], 0)
        self.assertEqual(unique_action["ack"]["status"], "ok")
        self.assertGreaterEqual(unique_action["result"]["resolvedTarget"]["confidence"], 85)
        self.assertTrue(unique_action["result"]["resolvedTarget"]["autoConfirmEligible"])
        self.assertEqual({check["type"] for check in unique_action["result"]["expectedChecks"]}, {"textAny", "stateChanged"})
        self.assertEqual(first_safe_action["ack"]["status"], "ok")
        self.assertEqual(first_safe_action["result"]["resolvedTarget"]["locatorValue"], "add-to-cart-first")
        self.assertTrue(first_safe_action["result"]["resolvedTarget"]["autoConfirmEligible"])
        self.assertEqual(duplicate_action["ack"]["status"], "error")
        self.assertEqual(duplicate_action["ack"]["errorCode"], "target_ambiguous")
        self.assertEqual(retried["retryCount"], 1)
        self.assertEqual(Handler.retry_requests, 2)
        self.assertEqual(missing["errorCode"], "page_not_ready")
        self.assertTrue(missing["retryable"])
        self.assertEqual(missing["diagnostics"]["candidateCount"], 0)
        self.assertTrue(missing["evidence"]["screenshotPath"])

    async def test_browser_worker_repairs_ordinal_target_with_region_selector(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = """<html><body>
<input placeholder="Ordinal ready">
<h1>Ready</h1>
<section><h2>安装总榜</h2><a>查看全部</a><table><tbody>
<tr role="link" onclick="document.querySelector('h1').textContent='Opened first'"><td>1 第一技能</td></tr>
<tr role="link" onclick="document.querySelector('h1').textContent='Opened second'"><td>2 第二技能</td></tr>
<tr role="link" onclick="document.querySelector('h1').textContent='Opened third'"><td>3 第三技能</td></tr>
</tbody></table></section>
<section><h2>其他榜单</h2><table><tr role="link"><td>2 错误记录</td></tr></table></section>
</body></html>"""
                encoded = body.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, format, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        artifact_dir = tempfile.mkdtemp(prefix="CODEX_TEST_20260902_ORDINAL_WORKER_")
        url = f"http://127.0.0.1:{server.server_port}/ordinal"
        process = await asyncio.create_subprocess_exec(
            "node",
            str(main.BROWSER_WORKER_PATH),
            "session-ordinal-repair",
            url,
            json.dumps({"width": 960, "height": 640}),
            cwd=main.ROOT_DIR,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=16 * 1024 * 1024,
        )

        async def read_until(predicate, timeout=15):
            events = []
            while True:
                raw = await asyncio.wait_for(process.stdout.readline(), timeout=timeout)
                if not raw:
                    stderr = (await process.stderr.read()).decode(errors="replace")
                    self.fail(stderr or f"browser worker exited with {process.returncode}")
                event = json.loads(raw.decode())
                events.append(event)
                if predicate(event):
                    return events, event

        async def command(payload):
            process.stdin.write((json.dumps(payload) + "\n").encode())
            await process.stdin.drain()
            return await read_until(lambda event: event.get("type") == "ack" and event.get("commandId") == payload["commandId"])

        try:
            await read_until(lambda event: event.get("type") == "ready")
            _, scenario_ack = await command({"type": "start-scenario", "scenario": {"scenarioIndex": 0}, "commandId": "scenario-ordinal"})
            self.assertEqual(scenario_ack["status"], "ok")
            _, navigate_ack = await command({
                "type": "execute-step",
                "commandId": "step-navigate",
                "step": {
                    "index": 0,
                    "action": "navigate",
                    "target": url,
                    "description": "打开榜单页面",
                    "readinessHints": [{"locatorType": "placeholder", "locatorValue": "Ordinal ready", "locatorRole": ""}],
                    "readiness": {"minInteractive": 1, "preflightCandidateCount": 1, "timeoutMs": 3000},
                    "screenshotPath": str(Path(artifact_dir) / "navigate.png"),
                },
            })
            self.assertEqual(navigate_ack["status"], "ok")
            events, click_ack = await command({
                "type": "execute-step",
                "commandId": "step-click",
                "step": {
                    "index": 1,
                    "action": "click",
                    "target": "2 第二技能",
                    "description": "点击安装总榜第 2 条记录",
                    "targetMeta": {
                        "kind": "link",
                        "name": "安装总榜第 2 条记录",
                        "aliases": [],
                        "exact": True,
                        "locatorHints": [{"locatorType": "role", "locatorValue": "不存在的完整行名称", "locatorRole": "link"}],
                        "regionName": "安装总榜",
                        "regionAliases": ["安装总榜"],
                        "selectionPolicy": "nth-safe",
                        "selectionIndex": 2,
                        "safety": {"class": "same-origin-navigation", "sameOrigin": True},
                    },
                    "expected": {"textAny": ["Opened second"], "stateChanged": True},
                    "readiness": {"minInteractive": 1, "preflightCandidateCount": 1, "timeoutMs": 3000},
                    "screenshotPath": str(Path(artifact_dir) / "click.png"),
                },
            })
            result = next(event for event in events if event.get("type") == "step-result")
            self.assertEqual(click_ack["status"], "ok")
            self.assertEqual(result["runtimeRepair"]["type"], "ordinal-region-fallback")
            self.assertEqual(result["resolvedTarget"]["locatorType"], "selector")
            self.assertIn("nth=1", result["resolvedTarget"]["locatorValue"])
            self.assertGreaterEqual(result["resolvedTarget"]["confidence"], 85)
            self.assertEqual({check["type"] for check in result["expectedChecks"]}, {"textAny", "stateChanged"})

            _, repair_scenario_ack = await command({"type": "start-scenario", "scenario": {"scenarioIndex": 1}, "commandId": "scenario-manual-repair"})
            self.assertEqual(repair_scenario_ack["status"], "ok")
            _, repair_navigate_ack = await command({
                "type": "execute-step",
                "commandId": "repair-navigate",
                "step": {
                    "index": 2,
                    "action": "navigate",
                    "target": url,
                    "description": "重新打开榜单页面",
                    "readinessHints": [{"locatorType": "placeholder", "locatorValue": "Ordinal ready", "locatorRole": ""}],
                    "readiness": {"minInteractive": 1, "preflightCandidateCount": 1, "timeoutMs": 3000},
                    "screenshotPath": str(Path(artifact_dir) / "repair-navigate.png"),
                },
            })
            self.assertEqual(repair_navigate_ack["status"], "ok")
            manual_selector = 'section:has(:is(h1,h2,h3,[role="heading"]):text-is("安装总榜")) tr[role="link"] >> nth=1'
            repair_events, repair_click_ack = await command({
                "type": "execute-step",
                "commandId": "repair-click",
                "step": {
                    "index": 3,
                    "action": "click",
                    "target": "安装总榜第 2 条记录",
                    "description": "使用人工确认 selector 点击第 2 条记录",
                    "targetMeta": {
                        "kind": "link",
                        "name": "安装总榜第 2 条记录",
                        "aliases": [],
                        "exact": True,
                        "locatorHints": [{"locatorType": "selector", "locatorValue": manual_selector, "locatorRole": "link"}],
                        "evidenceSource": "manual-repair",
                        "regionName": "安装总榜",
                        "regionAliases": ["安装总榜"],
                        "selectionPolicy": "nth-safe",
                        "selectionIndex": 2,
                        "safety": {"class": "same-origin-navigation", "sameOrigin": True},
                    },
                    "expected": {"textAny": ["Opened second"], "stateChanged": True},
                    "readiness": {"minInteractive": 1, "preflightCandidateCount": 1, "timeoutMs": 3000},
                    "screenshotPath": str(Path(artifact_dir) / "repair-click.png"),
                },
            })
            repair_result = next(event for event in repair_events if event.get("type") == "step-result")
            self.assertEqual(repair_click_ack["status"], "ok")
            self.assertEqual(repair_result["resolvedTarget"]["confidence"], 88)
            self.assertTrue(repair_result["resolvedTarget"]["autoConfirmEligible"])
            self.assertEqual(repair_result["resolvedTarget"]["source"], "人工确认区域序号 selector")
        finally:
            if process.returncode is None:
                process.stdin.write((json.dumps({"type": "control", "action": "stop", "commandId": "stop"}) + "\n").encode())
                await process.stdin.drain()
                process.stdin.close()
                await process.stdin.wait_closed()
                await asyncio.wait_for(process.wait(), timeout=5)
            shutil.rmtree(artifact_dir, ignore_errors=True)
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    async def test_preflight_failure_stops_before_ai_plan_generation(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "preflight-failure.sqlite"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_PREFLIGHT_FAILURE")
                feature = self.create_feature(project["id"], "页面预探索失败")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"],
                    feature_id=feature["id"],
                    requirement="CODEX_TEST_PREFLIGHT_FAILURE 验证登录页",
                    target_url="https://example.test",
                ))
                main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-PREFLIGHT-001 | P0 | 页面可访问 | 页面访问 | 页面可访问 | 打开页面 | 页面可见 | 自动化 |
"""))
                with (
                    patch.object(main.platform, "discover_page", new=AsyncMock(side_effect=main.HTTPException(status_code=502, detail="页面预探索未采集到可用 DOM 证据"))),
                    patch.object(main.platform, "build_exploration_plan", new=AsyncMock()) as build_plan,
                    patch.object(main.platform, "track_exploration_run_task") as track_task,
                ):
                    result = await main.start_exploration_run(work["id"], keep_browser_open=False)

                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["planErrorCode"], "page_preflight_failed")
                self.assertEqual(result["stage"]["label"], "页面预探索失败")
                build_plan.assert_not_awaited()
                track_task.assert_not_called()
                with main.get_db() as conn:
                    self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM browser_sessions").fetchone()["total"], 0)
            finally:
                main.DB_PATH = original_db_path

    async def test_preflight_capacity_rejection_releases_temporary_runtime(self):
        capacity_id = "preflight-explore-capacity-reject"
        with (
            patch.object(main.BROWSER_CAPACITY, "reserve", new=AsyncMock(return_value=False)),
            patch.object(main.BROWSER_CAPACITY, "release", new=AsyncMock()) as release,
        ):
            with self.assertRaises(main.HTTPException) as raised:
                await main.discover_page(
                    "work-capacity-reject",
                    "https://example.test",
                    exploration_run_id="explore-capacity-reject",
                )

        self.assertEqual(raised.exception.status_code, 503)
        release.assert_awaited_once_with(capacity_id)
        self.assertNotIn(capacity_id, main.BROWSER_RUNTIMES)

    async def test_preflight_success_releases_temporary_runtime(self):
        capacity_id = "preflight-explore-success"
        result_event = {
            "type": "result",
            "title": "Example",
            "finalUrl": "https://example.test/",
            "structure": {"title": "Example", "url": "https://example.test/", "headings": ["Example"], "forms": 0, "inputs": 0, "buttons": 0, "links": 1},
            "elements": [{"tag": "a", "type": "", "name": "Example", "locatorType": "role", "locatorValue": "Example", "locatorRole": "link"}],
        }
        process = FakeProcess()
        process.stdout = FakeStream([(json.dumps(result_event) + "\n").encode()])
        with (
            patch.object(main.BROWSER_CAPACITY, "reserve", new=AsyncMock(return_value=True)),
            patch.object(main.BROWSER_CAPACITY, "release", new=AsyncMock()) as release,
            patch.object(main.asyncio, "create_subprocess_exec", new=AsyncMock(return_value=process)),
        ):
            result = await main.discover_page(
                "work-success",
                "https://example.test",
                exploration_run_id="explore-success",
            )

        self.assertEqual(result["final_url"], "https://example.test/")
        release.assert_awaited_once_with(capacity_id)
        self.assertNotIn(capacity_id, main.BROWSER_RUNTIMES)

    async def test_preflight_process_failure_releases_temporary_runtime(self):
        capacity_id = "preflight-explore-process-failure"
        process = FakeProcess()
        process.returncode = 1
        process.stdout = FakeStream([b'{"type":"error","message":"browser failed"}\n'])
        with (
            patch.object(main.BROWSER_CAPACITY, "reserve", new=AsyncMock(return_value=True)),
            patch.object(main.BROWSER_CAPACITY, "release", new=AsyncMock()) as release,
            patch.object(main.asyncio, "create_subprocess_exec", new=AsyncMock(return_value=process)),
        ):
            with self.assertRaises(main.HTTPException) as raised:
                await main.discover_page(
                    "work-process-failure",
                    "https://example.test",
                    exploration_run_id="explore-process-failure",
                )

        self.assertEqual(raised.exception.status_code, 502)
        release.assert_awaited_once_with(capacity_id)
        self.assertNotIn(capacity_id, main.BROWSER_RUNTIMES)

    async def test_recovery_events_are_persisted_with_step_context(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "recovery-events.sqlite"
            try:
                main.init_db()
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        "INSERT INTO exploration_runs (id, work_item_id, status, stage_key, stage_label, progress, started_at, current_step_index, max_steps) VALUES (?, ?, 'running', 'step', '执行步骤', 50, ?, 1, 1)",
                        ("run-recovery-events", "work-recovery-events", timestamp),
                    )
                    conn.execute(
                        "INSERT INTO exploration_steps (exploration_run_id, work_item_id, step_index, action, description, status, case_id, scenario_index, scenario_step_index, critical) VALUES (?, ?, 0, 'fill', '填写账号', 'running', 'TC-RECOVERY-001', 0, 1, 1)",
                        ("run-recovery-events", "work-recovery-events"),
                    )
                runtime = SimpleNamespace(
                    session_id="session-recovery-events",
                    exploration_run_id="run-recovery-events",
                    status="live",
                    websockets=set(),
                    last_frame=None,
                    last_worker_event_type="",
                    last_worker_event_at="",
                    last_worker_url="",
                )
                recovery = {
                    "type": "unique_login_entry",
                    "attempt": 1,
                    "entry": {"locatorType": "role", "locatorRole": "link", "locatorValue": "登录", "name": "登录"},
                    "beforeUrl": "https://example.test/",
                    "afterUrl": "https://example.test/login",
                    "status": "passed",
                }

                await main.handle_worker_event(runtime, {"type": "recovery-start", "stepIndex": 0, "recovery": {**recovery, "status": "running"}})
                await main.handle_worker_event(runtime, {"type": "recovery-result", "stepIndex": 0, "recovery": recovery})

                with main.get_db() as conn:
                    rows = conn.execute(
                        "SELECT message, case_id, scenario_index, step_index, step_status, details_json FROM exploration_logs WHERE exploration_run_id = ? ORDER BY id",
                        ("run-recovery-events",),
                    ).fetchall()
                self.assertEqual(len(rows), 2)
                self.assertIn("自动进入唯一登录入口", rows[0]["message"])
                self.assertIn("自动进入登录入口成功", rows[1]["message"])
                self.assertEqual(rows[1]["case_id"], "TC-RECOVERY-001")
                self.assertEqual(rows[1]["step_index"], 1)
                self.assertEqual(json.loads(rows[1]["details_json"])["recovery"]["entry"]["locatorRole"], "link")
            finally:
                main.DB_PATH = original_db_path

    def test_default_case_script_clicks_confirmed_login_entry_before_assertion(self):
        item = {"target_url": "https://example.test", "title": "登录流程"}
        case_row = {
            "external_id": "TC-CODEX-SCRIPT-ENTRY-001",
            "title": "登录页表单可见",
            "requirement": "验证登录页",
            "preconditions": "",
            "steps": "打开首页；进入登录页；验证账号和密码",
            "expected": "账号框和密码框可见",
            "automation_notes": "自动化",
        }
        elements = [
            {"id": 1, "locator_type": "role", "locator_role": "link", "locator_value": "登录", "name": "登录", "source": "受控恢复真实解析"},
            {"id": 2, "locator_type": "placeholder", "locator_role": "", "locator_value": "账号", "name": "账号", "source": "语义目标真实解析"},
        ]

        script = main.default_case_script(item, case_row, elements, "./live-fixture")

        navigation_index = script.index("openTargetPage(page)")
        entry_index = script.index("getByRole('link', { name: '登录', exact: true })")
        assertion_index = script.index("getByPlaceholder('账号')")
        self.assertLess(navigation_index, entry_index)
        self.assertLess(entry_index, assertion_index)

    def test_auto_confirmation_keeps_same_name_link_and_button_distinct(self):
        result = {
            "resolved_elements": [
                {"locatorType": "role", "locatorValue": "登录", "locatorRole": "link", "confidence": 90, "matchCount": 1, "autoConfirmEligible": True},
                {"locatorType": "role", "locatorValue": "登录", "locatorRole": "button", "confidence": 90, "matchCount": 1, "autoConfirmEligible": True},
            ],
            "elements": [
                {"name": "登录入口", "locatorType": "role", "locatorValue": "登录", "locatorRole": "link", "source": "unit"},
                {"name": "登录按钮", "locatorType": "role", "locatorValue": "登录", "locatorRole": "button", "source": "unit"},
            ],
        }

        confirmed, count = main.auto_confirm_exploration_result(result)

        self.assertEqual(count, 2)
        self.assertTrue(all(element["confirmed"] for element in confirmed["elements"]))
        self.assertEqual({element["locatorRole"] for element in confirmed["elements"]}, {"link", "button"})

    async def test_broadcast_removes_hanging_websocket(self):
        runtime = SimpleNamespace(websockets={HangingWebSocket()}, exploration_run_id=None)

        with patch.object(main, "BROWSER_EVENT_SEND_TIMEOUT_SECONDS", 0.01):
            await main.broadcast_browser_event(runtime, {"type": "status"})

        self.assertEqual(runtime.websockets, set())

    async def test_browser_socket_ignores_commands_for_read_only_execution_session(self):
        runtime = main.BrowserRuntime(
            "browser-read-only-001",
            "work-read-only-001",
            None,
            "https://example.test",
            None,
            interactive=False,
        )
        runtime.status = "live"
        websocket = ScriptedWebSocket([
            {"type": "mouse", "action": "move", "x": 100, "y": 80, "commandId": "readonly-command"}
        ])
        main.BROWSER_RUNTIMES[runtime.session_id] = runtime
        try:
            with (
                patch.object(main.platform, "current_user_from_websocket", return_value=SimpleNamespace(id="user-001")),
                patch.object(main.platform, "send_worker_command", new=AsyncMock()) as send_command,
            ):
                await main.browser_session_socket(websocket, runtime.session_id)

            self.assertTrue(websocket.accepted)
            self.assertEqual(websocket.sent[1], {
                "type": "ack",
                "commandId": "readonly-command",
                "status": "ignored",
                "message": "执行阶段实时浏览器仅支持只读预览",
            })
            send_command.assert_not_awaited()
            self.assertEqual(runtime.status, "live")
            self.assertEqual(runtime.websockets, set())
        finally:
            main.BROWSER_RUNTIMES.clear()

    async def test_browser_socket_forwards_commands_for_interactive_session(self):
        process = FakeProcess()
        runtime = main.BrowserRuntime(
            "browser-interactive-001",
            "work-interactive-001",
            None,
            "https://example.test",
            process,
            interactive=True,
        )
        runtime.status = "live"
        command = {"type": "mouse", "action": "click", "x": 12, "y": 34, "commandId": "interactive-command"}
        websocket = ScriptedWebSocket([command.copy()])
        main.BROWSER_RUNTIMES[runtime.session_id] = runtime
        try:
            with (
                patch.object(main.platform, "current_user_from_websocket", return_value=SimpleNamespace(id="user-001")),
                patch.object(main.platform, "send_worker_command", new=AsyncMock()) as send_command,
            ):
                await main.browser_session_socket(websocket, runtime.session_id)

            send_command.assert_awaited_once_with(runtime, command)
            self.assertEqual(runtime.websockets, set())
        finally:
            main.BROWSER_RUNTIMES.clear()

    async def test_browser_socket_reports_ended_interactive_session_without_stdin_error(self):
        process = FakeProcess()
        process.returncode = 0
        runtime = main.BrowserRuntime(
            "browser-ended-001",
            "work-ended-001",
            None,
            "https://example.test",
            process,
            interactive=True,
        )
        runtime.status = "closed"
        websocket = ScriptedWebSocket([
            {"type": "keyboard", "action": "press", "key": "Enter", "commandId": "ended-command"}
        ])
        main.BROWSER_RUNTIMES[runtime.session_id] = runtime
        try:
            with (
                patch.object(main.platform, "current_user_from_websocket", return_value=SimpleNamespace(id="user-001")),
                patch.object(main.platform, "send_worker_command", new=AsyncMock()) as send_command,
            ):
                await main.browser_session_socket(websocket, runtime.session_id)

            self.assertEqual(websocket.sent[-1], {"type": "error", "message": "浏览器会话已结束"})
            self.assertNotIn("stdin", json.dumps(websocket.sent, ensure_ascii=False))
            self.assertTrue(websocket.closed)
            send_command.assert_not_awaited()
            self.assertEqual(runtime.websockets, set())
        finally:
            main.BROWSER_RUNTIMES.clear()

    async def test_close_browser_runtime_waits_for_worker_shutdown(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                process = FakeProcess(exit_on_wait=True)
                runtime = main.BrowserRuntime("browser-close-001", "work-001", None, "https://example.test", process)
                runtime.ready.set()
                main.BROWSER_RUNTIMES[runtime.session_id] = runtime
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO browser_sessions (
                            id, work_item_id, exploration_run_id, status, viewport_width,
                            viewport_height, target_url, started_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (runtime.session_id, runtime.work_item_id, None, "live", 1440, 900, runtime.target_url, main.now_iso()),
                    )

                with patch.object(main, "terminate_process_tree") as terminate_tree:
                    await main.close_browser_runtime(runtime.session_id, "unit closed")

                self.assertNotIn(runtime.session_id, main.BROWSER_RUNTIMES)
                self.assertIsNotNone(process.returncode)
                terminate_tree.assert_not_called()
                row = main.get_browser_session_row(runtime.session_id)
                self.assertEqual(row["status"], "closed")
                self.assertEqual(row["error"], "unit closed")
            finally:
                main.BROWSER_RUNTIMES.clear()
                main.DB_PATH = original_db_path

    async def test_close_browser_runtime_kills_worker_tree_when_worker_hangs(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                process = FakeProcess(exit_on_wait=False)
                runtime = main.BrowserRuntime("browser-close-002", "work-002", None, "https://example.test", process)
                runtime.ready.set()
                main.BROWSER_RUNTIMES[runtime.session_id] = runtime
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO browser_sessions (
                            id, work_item_id, exploration_run_id, status, viewport_width,
                            viewport_height, target_url, started_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (runtime.session_id, runtime.work_item_id, None, "live", 1440, 900, runtime.target_url, main.now_iso()),
                    )

                async def fake_terminate_tree(proc, label, grace_seconds=0):
                    proc.returncode = -9
                    return True

                with (
                    patch.object(main, "BROWSER_PROCESS_GRACE_SECONDS", 0.01),
                    patch.object(main, "terminate_process_tree", side_effect=fake_terminate_tree) as terminate_tree,
                ):
                    await main.close_browser_runtime(runtime.session_id, "unit forced closed")

                terminate_tree.assert_called_once()
                self.assertNotIn(runtime.session_id, main.BROWSER_RUNTIMES)
                row = main.get_browser_session_row(runtime.session_id)
                self.assertEqual(row["status"], "closed")
                self.assertEqual(row["error"], "unit forced closed")
            finally:
                main.BROWSER_RUNTIMES.clear()
                main.DB_PATH = original_db_path

    async def test_step_result_sets_event_before_broadcast_failure_matters(self):
        runtime = SimpleNamespace(
            session_id="session-1",
            exploration_run_id="run-1",
            status="live",
            websockets={FailingWebSocket()},
            last_frame=None,
            last_worker_event_type="",
            last_worker_event_at="",
            last_worker_url="",
            step_events={2: asyncio.Event()},
            step_results={},
        )
        event = {
            "type": "step-result",
            "stepIndex": 2,
            "before": "https://example.test/login",
            "after": "https://example.test/home",
            "evidence": {
                "title": "Home",
                "url": "https://example.test/home",
                "screenshotPath": "",
                "structure": {"title": "Home", "url": "https://example.test/home"},
                "candidates": [{"locatorType": "text", "locatorValue": "Home"}],
            },
        }

        with (
            patch.object(main, "update_exploration_step") as update_step,
            patch.object(main, "write_exploration_log") as write_log,
        ):
            await main.handle_worker_event(runtime, event)

        self.assertTrue(runtime.step_events[2].is_set())
        self.assertEqual(runtime.step_results[2]["status"], "passed")
        self.assertEqual(runtime.websockets, set())
        self.assertEqual(runtime.last_worker_event_type, "step-result")
        self.assertEqual(runtime.last_worker_url, "https://example.test/home")
        update_step.assert_called_once()
        write_log.assert_called_once()

    async def test_pump_handles_large_worker_event_lines(self):
        large_candidates = [
            {"locatorType": "text", "locatorValue": f"button-{index}", "name": "x" * 2000}
            for index in range(40)
        ]
        event = {
            "type": "step-result",
            "stepIndex": 0,
            "before": "https://example.test",
            "after": "https://example.test/home",
            "evidence": {
                "title": "Home",
                "url": "https://example.test/home",
                "screenshotPath": "",
                "structure": {"title": "Home", "url": "https://example.test/home"},
                "candidates": large_candidates,
            },
        }
        runtime = SimpleNamespace(
            session_id="session-1",
            exploration_run_id="run-1",
            status="live",
            websockets=set(),
            last_frame=None,
            last_worker_event_type="",
            last_worker_event_at="",
            last_worker_url="",
            step_events={0: asyncio.Event()},
            step_results={},
            process=SimpleNamespace(stdout=FakeStream([(json.dumps(event) + "\n").encode(), b""]), stderr=FakeStream([]), returncode=0),
            ready=asyncio.Event(),
            closed=asyncio.Event(),
            last_error="",
        )

        with (
            patch.object(main, "update_exploration_step"),
            patch.object(main, "write_exploration_log"),
            patch.object(main, "update_browser_session"),
        ):
            await main.pump_browser_worker(runtime)

        self.assertTrue(runtime.step_events[0].is_set())
        self.assertEqual(runtime.step_results[0]["status"], "passed")

    def test_browser_worker_ready_after_command_listener_and_no_startup_navigation(self):
        worker_source = main.BROWSER_WORKER_PATH.read_text(encoding="utf-8")
        ready_index = worker_source.rfind("emit({ type: 'ready'")
        listener_index = worker_source.rfind("rl.on('line'")

        self.assertGreater(ready_index, listener_index)
        self.assertNotIn("navigateTo(targetUrl, 'initial target')", worker_source)
        self.assertNotIn("for (let attempt = 1; attempt <= 3", worker_source)
        self.assertIn("await page.goto(url, { waitUntil: 'commit', timeout: 20000 });", worker_source)
        self.assertIn("process.on('SIGTERM'", worker_source)
        self.assertIn("process.on('uncaughtException'", worker_source)
        self.assertIn("shutdown(true)", worker_source)

    async def test_manual_exploration_starts_without_long_lived_browser(self):
        expected = {"id": "explore-manual-001", "status": "running"}

        with patch.object(main.platform, "start_exploration_run", new=AsyncMock(return_value=expected)) as start_run:
            result = await main.run_exploration("work-manual-001")

        self.assertEqual(result, expected)
        start_run.assert_awaited_once_with("work-manual-001", keep_browser_open=False)

    def test_completed_exploration_uses_session_scoped_browser_cleanup(self):
        source = Path(main.platform.__file__).read_text(encoding="utf-8")

        self.assertIn("async def start_exploration_run(work_item_id: str, keep_browser_open: bool = True)", source)
        self.assertIn("async def run_exploration(work_item_id: str) -> dict[str, Any]:", source)
        self.assertIn('start_exploration_run(item["id"], keep_browser_open=False)', source)
        self.assertIn('return await start_exploration_run(work_item_id, keep_browser_open=False)', source)
        self.assertIn('close_browser_runtime(session_id, "页面探索完成，关闭实时浏览器")', source)

    async def test_passed_and_partial_exploration_close_browser_session(self):
        original_db_path = main.DB_PATH
        try:
            for expected_status in ("passed", "partial"):
                with self.subTest(status=expected_status), tempfile.TemporaryDirectory() as directory:
                    main.DB_PATH = Path(directory) / "test.sqlite"
                    main.BROWSER_RUNTIMES.clear()
                    main.init_db()
                    project = self.create_project(f"CODEX_TEST_EXPLORATION_CLOSE_{expected_status.upper()}")
                    feature = self.create_feature(project["id"], "探索完成关闭浏览器")
                    work = main.create_work_item(
                        main.WorkItemRequest(
                            project_id=project["id"],
                            feature_id=feature["id"],
                            requirement=f"CODEX_TEST_EXPLORATION_CLOSE_{expected_status.upper()}",
                            target_url="https://example.test",
                        )
                    )
                    exploration_run_id = f"explore-close-{expected_status}"
                    session_id = f"browser-close-{expected_status}"
                    step = {
                        "index": 0,
                        "caseId": "TC-CODEX-CLOSE-001",
                        "scenarioIndex": 0,
                        "scenarioStepIndex": 0,
                        "action": "snapshot",
                        "target": "",
                        "targetMeta": {"kind": "text", "name": "", "aliases": [], "exact": True},
                        "value": "",
                        "description": "采集页面证据",
                        "critical": False,
                        "expected": {"urlContains": "", "textAny": []},
                    }
                    plan = {"version": 2, "source": "ai", "scenarios": [{"caseId": "TC-CODEX-CLOSE-001", "title": "页面证据", "scenarioIndex": 0, "steps": [step]}], "steps": [step]}
                    with main.get_db() as conn:
                        conn.execute(
                            """
                            INSERT INTO exploration_runs (
                                id, work_item_id, target_url, status, stage_key, stage_label, progress,
                                started_at, preview_path, plan_json, current_step_index, max_steps
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                exploration_run_id,
                                work["id"],
                                "https://example.test",
                                "running",
                                "prepare",
                                "准备探索环境",
                                8,
                                main.now_iso(),
                                "",
                                json.dumps(plan, ensure_ascii=False),
                                0,
                                1,
                            ),
                        )
                    main.insert_exploration_step(exploration_run_id, work["id"], step)

                    runtime = SimpleNamespace(
                        ready=asyncio.Event(),
                        status="live",
                        step_events={},
                        step_results={},
                        command_events={},
                        command_results={},
                        process=SimpleNamespace(returncode=None),
                        websockets=set(),
                        last_worker_event_type="",
                        last_worker_event_at="",
                        last_worker_url="",
                    )
                    runtime.ready.set()

                    async def fake_start_browser_session(work_item_id, exploration_run_id=None):
                        main.BROWSER_RUNTIMES[session_id] = runtime
                        return {"id": session_id}

                    async def fake_send_worker_command(active_runtime, payload):
                        if payload.get("type") == "start-scenario":
                            command_id = payload["commandId"]
                            active_runtime.command_results[command_id] = {"status": "ok", "commandId": command_id}
                            active_runtime.command_events[command_id].set()
                            return
                        if payload.get("type") != "execute-step":
                            return
                        step_index = payload["step"]["index"]
                        active_runtime.step_results[step_index] = {
                            "status": "passed" if expected_status == "passed" else "failed",
                            "evidence": {},
                        }
                        active_runtime.step_events[step_index].set()

                    discovery = {
                        "elements": [
                            {
                                "area": "Example",
                                "name": "Example",
                                "locatorType": "text",
                                "locatorValue": "Example",
                                "source": "unit discovery",
                                "confirmed": False,
                            }
                        ],
                        "page_structure": "Example page",
                        "screenshot_path": "",
                    }
                    with (
                        patch.object(main.platform, "start_browser_session", side_effect=fake_start_browser_session),
                        patch.object(main.platform, "send_worker_command", side_effect=fake_send_worker_command),
                        patch.object(main.platform, "broadcast_browser_event", new=AsyncMock()),
                        patch.object(main.platform, "discover_page", new=AsyncMock(return_value=discovery)),
                        patch.object(main.platform, "close_browser_runtime", new=AsyncMock()) as close_runtime,
                    ):
                        await main.run_discovery_session(
                            exploration_run_id,
                            work["id"],
                            "https://example.test",
                            keep_browser_open=False,
                        )

                    run = main.get_exploration_run_payload(exploration_run_id)
                    self.assertEqual(run["status"], expected_status)
                    close_runtime.assert_awaited_once_with(session_id, "页面探索完成，关闭实时浏览器")
        finally:
            main.BROWSER_RUNTIMES.clear()
            main.DB_PATH = original_db_path

    async def test_run_discovery_session_fails_fast_when_worker_never_ready(self):
        original_db_path = main.DB_PATH
        original_ready_timeout = main.BROWSER_WORKER_READY_TIMEOUT_SECONDS
        original_time_budget = main.EXPLORATION_TIME_BUDGET_SECONDS
        original_step_timeout = main.EXPLORATION_STEP_TIMEOUT_SECONDS
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.BROWSER_WORKER_READY_TIMEOUT_SECONDS = 0.05
            main.EXPLORATION_TIME_BUDGET_SECONDS = 5
            main.EXPLORATION_STEP_TIMEOUT_SECONDS = 1
            try:
                main.init_db()
                project = self.create_project("页面探索阻塞测试项目")
                feature = self.create_feature(project["id"], "页面探索阻塞")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证页面探索在 worker 无法启动时会快速失败。",
                        target_url="https://example.test",
                        test_data="CODEX_TEST_RUN_DISCOVERY_FAIL_FAST",
                    )
                )
                main.generate_cases(
                    work["id"],
                    main.ContentRequest(
                        content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-READY-001 | P0 | 页面探索阻塞 | 页面探索 | CODEX_TEST_RUN_DISCOVERY_FAIL_FAST | 打开目标页面 | 应快速失败 | 待自动化 |
""",
                    ),
                )
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO exploration_runs (
                            id, work_item_id, target_url, status, stage_key, stage_label, progress,
                            started_at, preview_path, plan_json, current_step_index, max_steps
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "explore-run-001",
                            work["id"],
                            "https://example.test",
                            "running",
                            "prepare",
                            "准备探索环境",
                            8,
                            main.now_iso(),
                            "",
                            json.dumps(
                                [
                                    {
                                        "index": 0,
                                        "action": "navigate",
                                        "target": "https://example.test",
                                        "value": "",
                                        "description": "打开目标页面",
                                    }
                                ],
                                ensure_ascii=False,
                            ),
                            0,
                            1,
                        ),
                    )

                session = SimpleNamespace(
                    ready=asyncio.Event(),
                    closed=asyncio.Event(),
                    status="starting",
                    last_error="Cannot find module 'playwright'",
                    process=SimpleNamespace(returncode=1),
                    exploration_run_id=None,
                )

                async def fake_start_browser_session(work_item_id, exploration_run_id=None):
                    session.exploration_run_id = exploration_run_id
                    session_id = "browser-fail-001"
                    main.BROWSER_RUNTIMES[session_id] = session
                    with main.get_db() as conn:
                        conn.execute(
                            """
                            INSERT INTO browser_sessions (
                                id, work_item_id, exploration_run_id, status, viewport_width,
                                viewport_height, target_url, started_at, error
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                session_id,
                                work["id"],
                                exploration_run_id,
                                "starting",
                                1440,
                                900,
                                "https://example.test",
                                main.now_iso(),
                                "Cannot find module 'playwright'",
                            ),
                        )
                    return {
                        "id": session_id,
                        "workItemId": work["id"],
                        "explorationRunId": exploration_run_id,
                        "status": "starting",
                        "viewport": {"width": 1440, "height": 900},
                        "targetUrl": "https://example.test",
                        "startedAt": main.now_iso(),
                        "endedAt": None,
                        "error": "Cannot find module 'playwright'",
                    }

                async def fake_close_browser_runtime(session_id, reason="closed"):
                    session.ready.set()
                    session.closed.set()
                    session.status = "closed"
                    session.last_error = reason
                    main.BROWSER_RUNTIMES.pop(session_id, None)
                    with main.get_db() as conn:
                        conn.execute(
                            "UPDATE browser_sessions SET status = ?, ended_at = ?, error = ? WHERE id = ?",
                            ("closed", main.now_iso(), reason, session_id),
                        )

                async def fake_broadcast_browser_event(runtime, payload):
                    return None

                async def fake_send_worker_command(runtime, payload):
                    return None

                async def fake_discover_page(work_item_id, target_url, event_callback=None):
                    return {"elements": [], "page_structure": "", "screenshot_path": ""}

                with (
                    patch.object(main, "start_browser_session", side_effect=fake_start_browser_session),
                    patch.object(main, "close_browser_runtime", side_effect=fake_close_browser_runtime),
                    patch.object(main, "broadcast_browser_event", side_effect=fake_broadcast_browser_event),
                    patch.object(main, "send_worker_command", side_effect=fake_send_worker_command),
                    patch.object(main, "discover_page", side_effect=fake_discover_page),
                ):
                    await main.run_discovery_session("explore-run-001", work["id"], "https://example.test")

                run = main.get_exploration_run_payload("explore-run-001")
                self.assertEqual(run["status"], "failed")
                self.assertEqual(run["stage"]["label"], "浏览器启动失败")
                self.assertIn("Cannot find module 'playwright'", run["error"])
            finally:
                main.DB_PATH = original_db_path
                main.BROWSER_WORKER_READY_TIMEOUT_SECONDS = original_ready_timeout
                main.EXPLORATION_TIME_BUDGET_SECONDS = original_time_budget
                main.EXPLORATION_STEP_TIMEOUT_SECONDS = original_step_timeout

    async def test_execution_live_frame_updates_runtime_and_broadcasts(self):
        runtime = SimpleNamespace(
            session_id="session-1",
            status="starting",
            websockets=set(),
            last_frame=None,
            last_worker_event_type="",
            last_worker_event_at="",
        )
        event = {
            "type": "frame",
            "data": "abc",
            "format": "jpeg",
            "width": 100,
            "height": 80,
        }

        with patch.object(main, "broadcast_browser_event") as broadcast:
            await main.handle_execution_live_event(runtime, event)

        self.assertEqual(runtime.last_frame["data"], "abc")
        self.assertEqual(runtime.last_frame["width"], 100)
        broadcast.assert_called_once()


class ProjectCaseDeliverableTests(unittest.IsolatedAsyncioTestCase):
    def create_project(self, name: str = "单元测试项目"):
        return main.create_project(main.ProjectRequest(name=name, project_type="product", status="active"))

    def create_feature(self, project_id: str, name: str = "默认功能"):
        return main.create_feature_menu(main.FeatureMenuRequest(project_id=project_id, name=name))

    def create_verified_run_snapshot(self, work, cases: str, script: str, run_id: str, status: str = "passed"):
        timestamp = main.now_iso()
        version_id = f"version-{run_id}"
        with main.get_db() as conn:
            cases_cursor = conn.execute(
                """
                INSERT INTO generated_cases (work_item_id, content, asset_mode, case_ids_json, created_at)
                VALUES (?, ?, 'create', '[]', ?)
                """,
                (work["id"], cases, timestamp),
            )
            version_number = conn.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM test_script_versions WHERE work_item_id = ?",
                (work["id"],),
            ).fetchone()["version"]
            conn.execute(
                """
                INSERT INTO test_script_versions (
                    id, project_id, work_item_id, version, status, spec_path, content,
                    content_hash, asset_mode, case_ids_json, verified_run_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'create', '[]', ?, ?, ?)
                """,
                (
                    version_id,
                    work["projectId"],
                    work["id"],
                    version_number,
                    "verified" if status == "passed" else "failed",
                    f"tests/e2e/.draft-runs/{version_id}.draft.spec.ts",
                    script,
                    main.content_hash(script),
                    run_id,
                    timestamp,
                    timestamp,
                ),
            )
            conn.execute(
                """
                INSERT INTO generated_scripts (
                    work_item_id, content, script_version_id, asset_mode, case_ids_json, created_at
                ) VALUES (?, ?, ?, 'create', '[]', ?)
                """,
                (work["id"], script, version_id, timestamp),
            )
            conn.execute(
                """
                INSERT INTO runs (
                    id, suite_id, suite_name, spec, status, stage_key, stage_label,
                    progress, started_at, ended_at, exit_code, report_path,
                    screenshot_path, work_item_id, browser_session_id, script_version_id,
                    cases_revision_id
                ) VALUES (?, '', ?, ?, ?, 'complete', '完成', 100, ?, ?, ?, ?, '', ?, '', ?, ?)
                """,
                (
                    run_id,
                    work["title"],
                    f"tests/e2e/.draft-runs/{version_id}.draft.spec.ts",
                    status,
                    timestamp,
                    timestamp,
                    0 if status == "passed" else 1,
                    str(main.REPORT_INDEX),
                    work["id"],
                    version_id,
                    cases_cursor.lastrowid,
                ),
            )
            conn.execute(
                "UPDATE work_items SET latest_run_id = ?, status = ? WHERE id = ?",
                (run_id, status, work["id"]),
            )
        return {"run_id": run_id, "version_id": version_id, "cases_revision_id": cases_cursor.lastrowid}

    async def run_self_healing_scenario(
        self,
        root: Path,
        rerun_statuses: list[str],
        *,
        unchanged_script: bool = False,
        policy_reason: str = "",
    ):
        original_paths = {
            "DB_PATH": main.DB_PATH,
            "ROOT_DIR": main.ROOT_DIR,
            "WORK_ITEM_DRAFT_DIR": main.WORK_ITEM_DRAFT_DIR,
            "PLAYWRIGHT_REPORT_ARCHIVE_DIR": main.PLAYWRIGHT_REPORT_ARCHIVE_DIR,
            "REPORT_INDEX": main.REPORT_INDEX,
            "SCREENSHOT_PATH": main.SCREENSHOT_PATH,
        }
        main.DB_PATH = root / "test.sqlite"
        main.ROOT_DIR = root
        main.WORK_ITEM_DRAFT_DIR = root / "tests" / "e2e" / ".draft-runs"
        main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "playwright-reports"
        main.REPORT_INDEX = root / "playwright-report" / "index.html"
        main.SCREENSHOT_PATH = root / "artifacts" / "browser-preview.svg"
        try:
            main.init_db()
            project = self.create_project("CODEX_TEST_人工自愈项目")
            feature = self.create_feature(project["id"], "CODEX_TEST_人工自愈功能")
            work = main.create_work_item(
                main.WorkItemRequest(
                    project_id=project["id"],
                    feature_id=feature["id"],
                    requirement="CODEX_TEST_验证人工自愈生成修复脚本并最多重跑三轮。",
                    target_url="https://example.com",
                )
            )
            cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-HEAL-001 | P0 | 人工自愈 | 自愈主流程 | 页面可访问 | 打开页面 | 页面可见 | 使用稳定 selector |
"""
            main.generate_cases(work["id"], main.ContentRequest(content=cases))
            work = main.get_work_item(work["id"])
            case_external_id = work["testCases"][0]["externalId"]
            with main.get_db() as conn:
                conn.executemany(
                    """
                    INSERT INTO confirmed_elements (
                        work_item_id, area, name, locator_type, locator_value, source, confirmed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (work["id"], "main", "旧状态", "testid", "old-state", "test", 1),
                        (work["id"], "main", "修复状态", "testid", "healed-state", "test", 1),
                    ],
                )
            initial_script = f"""import {{ expect, test }} from '@playwright/test';
test('{case_external_id} 人工自愈', async ({{ page }}) => {{
  await page.goto('https://example.com');
  await expect(page.locator('[data-test="old-state"]')).toBeVisible();
}});
"""
            main.generate_script(work["id"], main.ContentRequest(content=initial_script))
            stored_initial_script = main.latest_script_for_work_item(work["id"])
            timestamp = main.now_iso()
            with main.get_db() as conn:
                version = main.latest_script_version_for_work_item(conn, work["id"])
                conn.execute(
                    """
                    INSERT INTO runs (
                        id, suite_id, suite_name, spec, status, stage_key, stage_label,
                        progress, started_at, ended_at, exit_code, report_path,
                        screenshot_path, work_item_id, script_version_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "run-source-failed",
                        work["slug"],
                        work["title"],
                        version["spec_path"],
                        "failed",
                        "complete",
                        "完成",
                        100,
                        timestamp,
                        timestamp,
                        1,
                        str(main.REPORT_INDEX),
                        str(main.SCREENSHOT_PATH),
                        work["id"],
                        version["id"],
                    ),
                )
                conn.execute(
                    "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)",
                    ("run-source-failed", timestamp, "error", "Locator: [data-test=old-state] not found"),
                )
            main.update_work_item(work["id"], stage="运行验证", status="failed", latest_run_id="run-source-failed")
            healing_run = main.create_healing_run_record(work["id"], "run-source-failed")
            generated_round = 0
            rerun_round = 0

            async def fake_generate(*args, **kwargs):
                nonlocal generated_round
                generated_round += 1
                if unchanged_script:
                    return stored_initial_script
                fixture_import = kwargs.get("fixture_import", "")
                return f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{fixture_import}';
	test('{case_external_id} 人工自愈', async ({{ page }}) => {{
	  await runStep('打开页面', async () => {{ await page.goto(TARGET_URL); }});
	  await runStep('验证修复状态', async () => {{
	    // 主断言：页面可见
	    await expect(page.locator('[data-testid="healed-state"]')).toHaveAttribute('data-round', '{generated_round}');
	  }});
	}});
"""

            async def fake_rerun(
                work_item_id: str,
                flow_run_id: str = "",
                on_run_created=None,
                selected_script_version_ids=None,
                **kwargs,
            ):
                nonlocal rerun_round
                status = rerun_statuses[rerun_round]
                rerun_round += 1
                run_id = f"run-healed-{rerun_round}"
                ended_at = main.now_iso()
                with main.get_db() as conn:
                    version = main.latest_script_version_for_work_item(conn, work_item_id)
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, script_version_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            run_id,
                            work["slug"],
                            work["title"],
                            version["spec_path"],
                            status,
                            "complete",
                            "完成",
                            100,
                            ended_at,
                            ended_at,
                            0 if status == "passed" else 1,
                            str(main.REPORT_INDEX),
                            str(main.SCREENSHOT_PATH),
                            work_item_id,
                            version["id"],
                        ),
                    )
                    if status == "failed":
                        conn.execute(
                            "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)",
                            (run_id, ended_at, "error", f"round {rerun_round} failed"),
                        )
                    run_row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
                if on_run_created is not None:
                    on_run_created(run_id)
                    exposed = main.get_healing_run_payload(healing_run["id"])
                    self.assertEqual(exposed["latestRunId"], run_id)
                    self.assertEqual(exposed["attempts"][-1]["rerunRunId"], run_id)
                return run_row

            with patch.object(main.platform, "expectation_policy_mismatch_reason", return_value=policy_reason), patch.object(
                main.platform,
                "generate_healed_script",
                new=AsyncMock(side_effect=fake_generate),
            ), patch.object(
                main.platform,
                "run_work_item_draft_once",
                new=AsyncMock(side_effect=fake_rerun),
            ):
                result = await main.execute_self_healing(healing_run["id"])
            return result, main.get_work_item(work["id"]), generated_round, rerun_round
        finally:
            for name, value in original_paths.items():
                setattr(main, name, value)

    async def test_manual_self_healing_stops_on_pass_and_caps_three_rounds(self):
        scenarios = [
            (["passed", "passed"], "passed", 1, 2),
            (["failed", "failed", "passed", "passed"], "passed", 3, 4),
            (["failed", "failed", "failed"], "failed", 3, 3),
        ]
        for index, (statuses, expected_status, expected_attempts, expected_reruns) in enumerate(scenarios, start=1):
            with self.subTest(statuses=statuses), tempfile.TemporaryDirectory() as directory:
                result, work, generated_round, rerun_round = await self.run_self_healing_scenario(
                    Path(directory) / f"scenario-{index}",
                    statuses,
                )
                self.assertEqual(result["status"], expected_status)
                self.assertEqual(len(result["attempts"]), expected_attempts)
                self.assertEqual(generated_round, expected_attempts)
                self.assertEqual(rerun_round, expected_reruns)
                self.assertEqual(work["status"], expected_status)
                self.assertEqual(result["attempts"][-1]["status"], expected_status)

    async def test_manual_self_healing_rejects_unchanged_script_without_rerun(self):
        with tempfile.TemporaryDirectory() as directory:
            result, work, generated_round, rerun_round = await self.run_self_healing_scenario(
                Path(directory) / "unchanged",
                ["passed"],
                unchanged_script=True,
            )
            self.assertEqual(result["status"], "failed")
            self.assertEqual(len(result["attempts"]), 3)
            self.assertTrue(all(attempt["status"] == "rejected" for attempt in result["attempts"]))
            self.assertIn("无实质变化", result["error"])
            self.assertEqual(generated_round, 3)
            self.assertEqual(rerun_round, 0)
            self.assertEqual(work["status"], "failed")

    async def test_navigation_canary_healing_reruns_original_versions_without_ai_script_repair(self):
        original_db_path = main.DB_PATH
        original_draft_dir = main.WORK_ITEM_DRAFT_DIR
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "navigation-healing.sqlite"
            main.WORK_ITEM_DRAFT_DIR = Path(directory) / "drafts"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_NAVIGATION_HEALING")
                feature = self.create_feature(project["id"], "导航契约恢复")
                work = main.create_work_item(main.WorkItemRequest(
                    project_id=project["id"], feature_id=feature["id"],
                    requirement="匿名访问首页", target_url="https://example.test/#/",
                ))
                generated = main.generate_cases(work["id"], main.ContentRequest(content="""| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-NAV-HEAL-001 | P0 | 首页访问 | 匿名访问 | 页面可访问 | 打开页面 | 首页可见 | 自动化 |
"""))
                case = generated["testCases"][0]
                timestamp = main.now_iso()
                version_id = "navigation-script-version"
                script_path = main.WORK_ITEM_DRAFT_DIR / "navigation-script.spec.ts"
                script_path.parent.mkdir(parents=True, exist_ok=True)
                script_content = f"""import {{ expect, test }} from '@playwright/test';
test('{case['externalId']} 首页访问', async ({{ page }}) => {{
  await page.goto('https://example.test/#/');
  await expect(page.getByRole('heading', {{ name: '首页' }})).toBeVisible();
}});
"""
                script_path.write_text(script_content, encoding="utf-8")
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO test_script_versions (
                            id, project_id, work_item_id, case_id, version, status, spec_path,
                            content, content_hash, generation_batch_id, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 1, 'draft', ?, ?, ?, '', ?, ?)
                        """,
                        (
                            version_id, project["id"], work["id"], case["id"], str(script_path), script_content,
                            main.content_hash(script_content), timestamp, timestamp,
                        ),
                    )
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, failure_category, failure_reason
                        ) VALUES (?, '', ?, ?, 'blocked', 'complete', '完成', 100, ?, ?, 1, ?, '', ?, 'navigation-precondition', ?)
                        """,
                        (
                            "navigation-source-run", work["title"], json.dumps([str(script_path)]), timestamp, timestamp,
                            str(main.REPORT_INDEX), work["id"], "目标页面导航或 readiness 前置条件未通过，业务用例批次未执行。",
                        ),
                    )
                    conn.execute(
                        "INSERT INTO run_script_versions (run_id, script_version_id, case_id, created_at, result_status) VALUES (?, ?, ?, ?, 'unknown')",
                        ("navigation-source-run", version_id, case["id"], timestamp),
                    )
                    conn.executemany(
                        "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, 'error', ?)",
                        [
                            ("navigation-source-run", timestamp, "导航 Canary命令: npx playwright test navigation-canary.spec.ts"),
                            ("navigation-source-run", timestamp, "navigation-precondition: resolved URL mismatch"),
                        ],
                    )
                    conn.execute(
                        "UPDATE work_items SET latest_run_id = ?, stage = '自愈诊断', status = 'healing' WHERE id = ?",
                        ("navigation-source-run", work["id"]),
                    )
                healing_run = main.create_healing_run_record(work["id"], "navigation-source-run")

                async def fake_navigation_rerun(*args, **kwargs):
                    ended_at = main.now_iso()
                    with main.get_db() as conn:
                        conn.execute(
                            """
                            INSERT INTO runs (
                                id, suite_id, suite_name, spec, status, stage_key, stage_label,
                                progress, started_at, ended_at, exit_code, report_path,
                                screenshot_path, work_item_id, failure_category, failure_reason
                            ) VALUES (?, '', ?, ?, 'passed', 'complete', '完成', 100, ?, ?, 0, ?, '', ?, '', '')
                            """,
                            (
                                "navigation-retry-passed", work["title"], json.dumps([str(script_path)]), ended_at, ended_at,
                                str(main.REPORT_INDEX), work["id"],
                            ),
                        )
                        return conn.execute("SELECT * FROM runs WHERE id = 'navigation-retry-passed'").fetchone()

                with (
                    patch.object(main.platform, "run_work_item_draft_once", new=AsyncMock(side_effect=fake_navigation_rerun)) as rerun,
                    patch.object(main.platform, "generate_healed_script", new=AsyncMock()) as generate_healed,
                ):
                    result = await main.execute_self_healing(healing_run["id"])

                self.assertEqual(result["status"], "passed")
                self.assertEqual(result["latestRunId"], "navigation-retry-passed")
                self.assertEqual(len(result["attempts"]), 1)
                self.assertEqual(result["attempts"][0]["status"], "passed")
                self.assertEqual(rerun.await_count, 1)
                self.assertEqual(rerun.call_args.kwargs["selected_script_version_ids"], [version_id])
                self.assertEqual(rerun.call_args.kwargs["run_scope"], "navigation-contract-retry")
                generate_healed.assert_not_awaited()
            finally:
                main.DB_PATH = original_db_path
                main.WORK_ITEM_DRAFT_DIR = original_draft_dir

    async def test_manual_self_healing_blocks_policy_mismatch_without_changing_script(self):
        with tempfile.TemporaryDirectory() as directory:
            result, work, generated_round, rerun_round = await self.run_self_healing_scenario(
                Path(directory) / "policy-mismatch",
                ["passed"],
                policy_reason="需求未明确该业务策略，停止测试侧自愈",
            )
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(len(result["attempts"]), 1)
            self.assertEqual(result["attempts"][0]["status"], "blocked")
            self.assertEqual(generated_round, 0)
            self.assertEqual(rerun_round, 0)
            self.assertEqual(work["status"], "blocked")

    async def test_manual_self_heal_start_validates_required_inputs(self):
        item = {"id": "work-heal-validation", "latest_run_id": "run-failed"}
        failed_run = {"id": "run-failed", "status": "failed"}
        with patch.object(main.platform, "get_work_item_row", return_value=item), patch.object(
            main.platform,
            "latest_cases_for_work_item",
            return_value="",
        ):
            with self.assertRaises(Exception) as missing_cases:
                await main.self_heal(item["id"], main.HealRequest())
            self.assertIn("缺少已保存测试用例", str(missing_cases.exception))

        with patch.object(main.platform, "get_work_item_row", return_value=item), patch.object(
            main.platform,
            "latest_cases_for_work_item",
            return_value="cases",
        ), patch.object(main.platform, "latest_script_for_work_item", return_value="script"), patch.object(
            main.platform,
            "latest_run_for_work_item",
            return_value=None,
        ):
            with self.assertRaises(Exception) as missing_run:
                await main.self_heal(item["id"], main.HealRequest())
            self.assertIn("请先执行草稿脚本", str(missing_run.exception))

        with patch.object(main.platform, "get_work_item_row", return_value=item), patch.object(
            main.platform,
            "latest_cases_for_work_item",
            return_value="cases",
        ), patch.object(main.platform, "latest_script_for_work_item", return_value="script"), patch.object(
            main.platform,
            "latest_run_for_work_item",
            return_value=failed_run,
        ), patch.object(main.platform, "get_openai_api_key", return_value=""):
            with self.assertRaises(Exception) as missing_ai:
                await main.self_heal(item["id"], main.HealRequest())
            self.assertIn("AI 未配置", str(missing_ai.exception))

    async def test_manual_self_healing_allows_only_one_active_session_per_work_item(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                first = main.create_healing_run_record("work-concurrent", "run-source-1")
                with self.assertRaises(Exception) as duplicate:
                    main.create_healing_run_record("work-concurrent", "run-source-1")
                self.assertIn("已有自愈任务", str(duplicate.exception))
                main.update_healing_run(first["id"], status="failed", ended_at=main.now_iso())
                second = main.create_healing_run_record("work-concurrent", "run-source-2")
                self.assertNotEqual(first["id"], second["id"])
            finally:
                main.DB_PATH = original_db_path

    async def test_rendered_report_page_keeps_fenced_command_readable(self):
        command = "npx playwright test tests/e2e/.draft-runs/saucedemo-ad3d90.draft.spec.ts --project=chromium --reporter=list,html"
        body = main.render_markdown_report(f"""## 执行命令

```bash
{command}
```

- Playwright HTML report：`playwright-report/index.html`
""")
        page = main.rendered_report_page("manual-report.md", body)

        self.assertIn("<pre><code>", body)
        self.assertIn(f"{command}\n", body)
        self.assertIn("</code></pre>", body)
        self.assertIn("p code, li code", page)
        self.assertIn("pre code { background: transparent;", page)
        self.assertIn("white-space: pre-wrap; overflow-wrap: anywhere;", page)
        self.assertIn(command, page)
        self.assertIn("playwright-report/index.html", page)

    async def test_run_report_shows_current_execution_until_html_report_exists(self):
        original_db_path = main.DB_PATH
        original_root_dir = main.ROOT_DIR
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            main.DB_PATH = root / "test.sqlite"
            main.ROOT_DIR = root
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "playwright-reports"
            try:
                main.init_db()
                report_path = main.run_html_report_index("run-report-live")
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, report_path
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "run-report-live", "TC-REPORT-LIVE", "当前报告用例", "tests/e2e/current.spec.ts",
                            "running", "execute", "执行脚本", 58, main.now_iso(), main.relative_or_absolute(report_path),
                        ),
                    )
                    conn.execute(
                        "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)",
                        ("run-report-live", main.now_iso(), "info", "正在执行当前用例"),
                    )

                waiting = main.playwright_run_report("run-report-live")
                waiting_body = waiting.body.decode("utf-8")
                self.assertEqual(waiting.status_code, 200)
                self.assertIn('http-equiv="refresh"', waiting_body)
                self.assertIn("当前报告用例", waiting_body)
                self.assertIn("正在执行当前用例", waiting_body)
                self.assertIn("执行中 · 58%", waiting_body)
                self.assertEqual(waiting.headers["cache-control"], "no-store, max-age=0")

                report_path.parent.mkdir(parents=True, exist_ok=True)
                report_path.write_text("<html>current run report</html>", encoding="utf-8")
                ready = main.playwright_run_report("run-report-live")
                self.assertEqual(ready.status_code, 307)
                self.assertIn("/reports/files/artifacts/playwright-reports/runs/run-report-live/index.html", ready.headers["location"])
            finally:
                main.DB_PATH = original_db_path
                main.ROOT_DIR = original_root_dir
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir

    async def test_suite_report_uses_selected_suite_and_active_run_progress(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO suite_runs (
                            id, project_id, name, status, progress, total_cases,
                            passed_cases, failed_cases, skipped_cases, started_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        ("suite-report-live", "project-report-live", "当前监控套件", "running", 0, 2, 0, 0, 0, main.now_iso()),
                    )
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, report_path
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "run-in-suite", "TC-IN-SUITE", "当前套件用例", "tests/e2e/suite.spec.ts",
                            "running", "execute", "执行脚本", 60, main.now_iso(), "",
                        ),
                    )
                    conn.execute(
                        "INSERT INTO suite_run_cases (suite_run_id, case_id, run_id, status, started_at) VALUES (?, ?, ?, ?, ?)",
                        ("suite-report-live", "case-in-suite", "run-in-suite", "running", main.now_iso()),
                    )
                    conn.execute(
                        "INSERT INTO suite_run_cases (suite_run_id, case_id, status) VALUES (?, ?, ?)",
                        ("suite-report-live", "case-waiting", "queued"),
                    )
                    conn.execute(
                        "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)",
                        ("run-in-suite", main.now_iso(), "info", "当前套件日志"),
                    )

                response = main.playwright_suite_report("suite-report-live")
                body = response.body.decode("utf-8")
                self.assertEqual(response.status_code, 200)
                self.assertIn("当前监控套件", body)
                self.assertIn("run-in-suite", body)
                self.assertIn("当前套件日志", body)
                self.assertIn("执行中 · 30%", body)

                generic_response = main.playwright_report_index()
                generic_body = generic_response.body.decode("utf-8")
                self.assertIn("当前监控套件", generic_body)
                self.assertIn("当前套件日志", generic_body)
            finally:
                main.DB_PATH = original_db_path

    async def test_parse_cases_markdown_extracts_structured_cases(self):
        markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SMOKE-001 | P0 | 登录成功 | 登录 | standard_user/secret_sauce | 打开页面并登录 | 进入商品页 | 待自动化 |
"""

        cases = main.parse_cases_markdown(markdown)

        self.assertEqual(cases[0]["external_id"], "TC-SMOKE-001")
        self.assertEqual(cases[0]["priority"], "P0")
        self.assertEqual(cases[0]["expected"], "进入商品页")

    async def test_parse_cases_markdown_cleans_markdown_wrapped_case_ids(self):
        markdown = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| TC-SAUCEDEMO-4246A6-**TC001** | P0 | **登录成功** |
"""

        cases = main.parse_cases_markdown(markdown)

        self.assertEqual(cases[0]["external_id"], "TC-SAUCEDEMO-4246A6-TC001")
        self.assertEqual(cases[0]["title"], "登录成功")

    async def test_script_case_coverage_reports_missing_external_ids(self):
        cases = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| LGN-001 | P0 | 登录成功 |
| LGN-002 | P0 | 登录失败 |
"""
        script = "import { test, expect } from '@playwright/test';\ntest('LGN-001 登录成功', async () => { expect(true).toBeTruthy(); });"

        missing = main.missing_case_ids_in_script(cases, script)

        self.assertEqual(missing, ["LGN-002"])

    async def test_script_case_coverage_explains_single_test_for_multiple_cases(self):
        cases = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| TC-SAUCEDEMO-953E60-TC01 | P0 | 登录成功 |
| TC-SAUCEDEMO-953E60-TC02 | P1 | 锁定用户 |
| TC-SAUCEDEMO-953E60-TC03 | P1 | 错误密码 |
| TC-SAUCEDEMO-953E60-TC04 | P1 | 空用户名 |
| TC-SAUCEDEMO-953E60-TC05 | P1 | 空密码 |
| TC-SAUCEDEMO-953E60-TC06 | P1 | 登录后访问登录页 |
"""
        script = """import { test, expect } from '@playwright/test';
test('TC-SAUCEDEMO-953E60-001 主流程满足验收标准', async () => { expect(true).toBeTruthy(); });
"""

        message = main.script_case_coverage_error(cases, script)

        self.assertIn("脚本运行通过但未逐条覆盖用例 ID", message)
        self.assertIn("TC-SAUCEDEMO-953E60-TC01", message)
        self.assertIn("当前仅检测到 1 个 test 标题", message)

    async def test_script_case_coverage_uses_cleaned_case_ids(self):
        cases = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| TC-SAUCEDEMO-4246A6-**TC001** | P0 | 登录成功 |
| TC-SAUCEDEMO-4246A6-**TC002** | P0 | 加入购物车 |
"""
        script = """import { test, expect } from '@playwright/test';
test('TC-SAUCEDEMO-4246A6-TC001 登录成功', async () => { expect(true).toBeTruthy(); });
test('TC-SAUCEDEMO-4246A6-TC002 加入购物车', async () => { expect(true).toBeTruthy(); });
"""

        missing = main.missing_case_ids_in_script(cases, script)

        self.assertEqual(missing, [])

    async def test_execution_config_allows_artifact_specs_to_be_collected(self):
        original_execution_config_dir = main.EXECUTION_CONFIG_DIR
        original_report_index = main.REPORT_INDEX
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            main.EXECUTION_CONFIG_DIR = main.ROOT_DIR / "tests" / "e2e" / ".execution-configs" / "unit-test"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "automation-platform" / "playwright-reports"
            try:
                html_report = main.run_html_report_index("run-config-001")
                blob_dir = main.suite_blob_report_dir("suite-config-001")
                config_path = main.write_execution_playwright_config("run-config-001", html_report, blob_dir)
                config_content = (main.ROOT_DIR / config_path).read_text(encoding="utf-8")

                self.assertIn(f"testDir: {json.dumps(str(main.ROOT_DIR))}", config_content)
                self.assertIn(f"outputFolder: {json.dumps(str(html_report.parent))}", config_content)
                self.assertIn(f"outputDir: {json.dumps(str(blob_dir))}", config_content)
                self.assertIn("timeout: 60_000", config_content)
                self.assertIn("timeout: 10_000", config_content)
                self.assertIn("fullyParallel: false", config_content)
                self.assertIn("workers: 1", config_content)
                self.assertIn("actionTimeout: 15_000", config_content)
                self.assertIn("navigationTimeout: 15_000", config_content)
                self.assertTrue(config_path.endswith("playwright.config.ts"))
            finally:
                shutil.rmtree(main.EXECUTION_CONFIG_DIR, ignore_errors=True)
                main.EXECUTION_CONFIG_DIR = original_execution_config_dir
                main.REPORT_INDEX = original_report_index
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir

    async def test_zzpss_default_script_uses_saved_full_case_ids(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "登录功能")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 192.168.7.180:12222/zzpss 登录功能，账号 lining，密码 ExamplePass123!。",
                        target_url="http://192.168.7.180:12222/zzpss/#/login",
                        test_data="username=lining\npassword=ExamplePass123!",
                    )
                )
                cases = "\n".join(
                    [
                        "| ID | 优先级 | 标题 |",
                        "| --- | --- | --- |",
                        "| TC-192-168-81514E-LOGIN-001 | P0 | 使用有效账号密码成功登录 |",
                        "| TC-192-168-81514E-LOGIN-002 | P0 | 正确账号错误密码登录失败 |",
                        "| TC-192-168-81514E-LOGIN-003 | P0 | 错误账号正确密码登录失败 |",
                        "| TC-192-168-81514E-LOGIN-004 | P1 | 账号为空时阻止登录 |",
                        "| TC-192-168-81514E-LOGIN-005 | P1 | 密码为空时阻止登录 |",
                        "| TC-192-168-81514E-LOGIN-006 | P1 | 账号和密码均为空时阻止登录 |",
                    ]
                )
                main.generate_cases(work["id"], main.ContentRequest(content=cases))
                with main.get_db() as conn:
                    external_ids = [
                        row["external_id"]
                        for row in conn.execute(
                            "SELECT external_id FROM test_cases WHERE work_item_id = ? ORDER BY external_id",
                            (work["id"],),
                        ).fetchall()
                    ]

                script = main.default_script(main.get_work_item_row(work["id"]), [])

                self.assertEqual(len(external_ids), 6)
                for external_id in external_ids:
                    self.assertIn(external_id, script)
                self.assertNotIn("LGN-001", script)
                normalized_cases = "\n".join(["| ID | 优先级 | 标题 |", "| --- | --- | --- |", *[f"| {external_id} | P1 | 用例 |" for external_id in external_ids]])
                self.assertEqual(main.missing_case_ids_in_script(normalized_cases, script), [])
            finally:
                main.DB_PATH = original_db_path

    async def test_default_scripts_include_verbose_step_logging(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "步骤日志")
                zzpss_work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 ZZPSS 登录，账号 lining，密码 ExamplePass123!。",
                        target_url="http://192.168.7.180:12222/zzpss/#/login",
                        test_data="username=lining\npassword=ExamplePass123!",
                    )
                )
                sauce_work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 standard_user 可以登录 Sauce Demo 并加购。",
                        target_url="https://www.saucedemo.com",
                        test_data="username=standard_user\npassword=secret_sauce",
                    )
                )
                generic_work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证首页关键元素可见。",
                        target_url="https://example.test",
                    )
                )
                generic_element = {
                    "area": "首页",
                    "name": "欢迎",
                    "locator_type": "text",
                    "locator_value": "欢迎",
                    "source": "unit",
                }

                scripts = [
                    main.default_script(main.get_work_item_row(zzpss_work["id"]), []),
                    main.default_script(main.get_work_item_row(sauce_work["id"]), []),
                    main.default_script(main.get_work_item_row(generic_work["id"]), [generic_element]),
                ]

                for script in scripts:
                    self.assertIn("[步骤开始]", script)
                    self.assertIn("[步骤通过]", script)
                    self.assertIn("[步骤失败]", script)
                    self.assertIn("test.step", script)
                    self.assertTrue(main.script_has_verbose_logging(script))
            finally:
                main.DB_PATH = original_db_path

    async def test_script_generation_prompts_require_verbose_step_logging(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "提示词日志")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证登录页可以提交账号密码。",
                        target_url="https://example.test/login",
                    )
                )
                item = main.get_work_item_row(work["id"])
                elements = [
                    {
                        "area": "登录页",
                        "name": "登录",
                        "locator_type": "role",
                        "locator_value": "登录",
                        "source": "unit",
                    }
                ]
                run = {
                    "spec": "tests/e2e/.draft-runs/unit.spec.ts",
                }

                script_prompt = main.playwright_script_prompt(item, elements, "| ID | 优先级 | 标题 |\n| --- | --- | --- |\n| TC-001 | P0 | 登录 |\n")
                healed_prompt = main.healed_script_prompt(item, "import { test, expect } from '@playwright/test';", run, "Locator: page.getByText('登录')", elements)

                for prompt in [script_prompt, healed_prompt]:
                    self.assertIn("[步骤开始]", prompt)
                    self.assertIn("[步骤通过]", prompt)
                    self.assertIn("[步骤失败]", prompt)
                    self.assertIn("test.step", prompt)
                    self.assertIn("console.log", prompt)
                    self.assertIn("每个 `ID` 必须原样出现在至少一个 Playwright", prompt)
                    self.assertIn("不得删除、改写、缩短、重编号、合并或遗漏", prompt)

                self.assertIn("waitUntil: 'commit'", script_prompt)
                self.assertIn("真实页面可操作信号", script_prompt)
                self.assertIn("不要把 `domcontentloaded` 或 `load` 当作核心就绪条件", script_prompt)
                self.assertIn("test.setTimeout", script_prompt)
                self.assertIn("禁止生成 `test('...', { timeout: ... }, async (...) => ...)`", script_prompt)
            finally:
                main.DB_PATH = original_db_path

    async def test_saucedemo_generation_prompts_require_stable_navigation_and_logout(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "Sauce 稳定化")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="测试下https://www.saucedemo.com登录功能",
                    )
                )
                item = main.get_work_item_row(work["id"])
                elements = [
                    {
                        "area": "登录页",
                        "name": "登录按钮",
                        "locator_type": "testid",
                        "locator_value": "login-button",
                        "source": "unit",
                    }
                ]
                run = {"spec": "tests/e2e/.draft-runs/sauce.draft.spec.ts"}

                script_prompt = main.playwright_script_prompt(item, elements, "| ID | 优先级 | 标题 |\n| --- | --- | --- |\n| TC-001 | P0 | 登录 |\n")
                healed_prompt = main.healed_script_prompt(
                    item,
                    "import { test, expect } from '@playwright/test';\ntest('x', { timeout: 60000 }, async ({ page }) => { await page.locator('#logout_sidebar_link').click(); });",
                    run,
                    "TimeoutError: page.goto: Timeout 30000ms exceeded\nlocator.click: element is outside of the viewport\n#logout_sidebar_link",
                    elements,
                )

                for prompt in [script_prompt, healed_prompt]:
                    self.assertIn("waitUntil: 'commit'", prompt)
                    self.assertIn("test.setTimeout", prompt)
                    self.assertIn("tabindex", prompt)
                    self.assertIn("bounding box", prompt)
                    self.assertIn("logout-sidebar-link", prompt)
                self.assertIn("openSauceLogin(page)", script_prompt)
                self.assertIn("loginAs(page, username, password)", script_prompt)
                self.assertIn("logout(page)", script_prompt)
                self.assertIn("不要把多条用例合并成一个主流程测试", script_prompt)
                self.assertIn("page.goto` timeout", healed_prompt)
                self.assertIn("outside of the viewport", healed_prompt)
                self.assertIn("element is not stable", healed_prompt)
            finally:
                main.DB_PATH = original_db_path

    async def test_saucedemo_default_script_uses_commit_navigation_stable_logout_and_case_ids(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "Sauce 默认脚本")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 Sauce Demo 登录和登出。",
                        target_url="https://www.saucedemo.com",
                        test_data="用户名 standard_user、密码 secret_sauce",
                    )
                )
                cases = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| TC-SAUCEDEMO-UNIT-TC01 | P0 | 登录成功 |
| TC-SAUCEDEMO-UNIT-TC02 | P1 | 锁定用户 |
| TC-SAUCEDEMO-UNIT-TC03 | P1 | 错误密码 |
| TC-SAUCEDEMO-UNIT-TC04 | P1 | 空用户名 |
| TC-SAUCEDEMO-UNIT-TC05 | P1 | 空密码 |
| TC-SAUCEDEMO-UNIT-TC06 | P1 | 登录后直接访问登录页 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=cases))

                script = main.default_script(main.get_work_item_row(work["id"]), [])
                with main.get_db() as conn:
                    external_ids = [
                        row["external_id"]
                        for row in conn.execute(
                            "SELECT external_id FROM test_cases WHERE work_item_id = ? ORDER BY external_id",
                            (work["id"],),
                        ).fetchall()
                    ]

                self.assertIn("async function openSauceLogin(page: Page)", script)
                self.assertIn("async function loginAs(page: Page", script)
                self.assertIn("async function logout(page: Page)", script)
                self.assertIn("waitUntil: 'commit'", script)
                self.assertIn("test.setTimeout(60_000)", script)
                self.assertIn("tabIndex !== '-1'", script)
                self.assertIn("boundingBox()", script)
                self.assertIn("sauceLocator(page, 'username')", script)
                self.assertNotIn("sauceLocator(page, 'login-container')", script)
                self.assertNotIn("waitUntil: 'domcontentloaded'", script)
                self.assertEqual(len(external_ids), 6)
                for external_id in external_ids:
                    self.assertIn(external_id, script)
                normalized_cases = "\n".join(["| ID | 优先级 | 标题 |", "| --- | --- | --- |", *[f"| {external_id} | P1 | 用例 |" for external_id in external_ids]])
                self.assertEqual(main.missing_case_ids_in_script(normalized_cases, script), [])
            finally:
                main.DB_PATH = original_db_path

    def test_valid_playwright_script_rejects_timeout_details_and_allows_set_timeout(self):
        timeout_details_script = """import { expect, test } from '@playwright/test';
test('x', { timeout: 60000 }, async ({ page }) => {
  await expect(page.locator('[data-test="login-button"]')).toBeVisible();
});
"""
        set_timeout_script = """import { expect, test } from '@playwright/test';
test('x', async ({ page }) => {
  test.setTimeout(60_000);
  await expect(page.locator('[data-test="login-button"]')).toBeVisible();
});
"""

        self.assertFalse(main.valid_playwright_script(timeout_details_script, []))
        self.assertTrue(main.valid_playwright_script(set_timeout_script, []))

    async def test_generate_script_persists_verbose_logging_for_manual_content(self):
        original_db_path = main.DB_PATH
        original_draft_dir = main.WORK_ITEM_DRAFT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.WORK_ITEM_DRAFT_DIR = root / "tests" / "e2e" / ".draft-runs"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "保存脚本日志")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证登录按钮可见。",
                        target_url="https://example.test/login",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LOG-001 | P0 | 登录按钮可见 | 登录 | 打开登录页 | 查看登录按钮 | 按钮可见 | 已自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=cases))
                with main.get_db() as conn:
                    external_id = conn.execute(
                        "SELECT external_id FROM test_cases WHERE work_item_id = ? ORDER BY external_id LIMIT 1",
                        (work["id"],),
                    ).fetchone()["external_id"]
                main.save_exploration(
                    work["id"],
                    main.ExplorationRequest(
                        notes="确认登录按钮",
                        elements=[
                            {
                                "area": "登录页",
                                "name": "登录按钮",
                                "locatorType": "text",
                                "locatorValue": "登录",
                                "source": "unit",
                                "confirmed": True,
                            }
                        ],
                    ),
                )
                script = f"""import {{ test, expect }} from '@playwright/test';

test('{external_id} 登录按钮可见', async ({{ page }}) => {{
  await page.goto('https://example.test/login');
  await expect(page.getByText('登录')).toBeVisible();
}});
"""

                item = main.generate_script(work["id"], main.ContentRequest(content=script))

                self.assertIn("[步骤开始]", item["scriptContent"])
                self.assertIn("[步骤通过]", item["scriptContent"])
                self.assertIn("[步骤失败]", item["scriptContent"])
                self.assertIn("test.beforeEach", item["scriptContent"])
                self.assertIn("test.step", item["scriptContent"])
            finally:
                main.DB_PATH = original_db_path
                main.WORK_ITEM_DRAFT_DIR = original_draft_dir

    async def test_generate_script_rejects_short_login_case_ids_before_persisting(self):
        original_db_path = main.DB_PATH
        original_draft_dir = main.WORK_ITEM_DRAFT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.WORK_ITEM_DRAFT_DIR = root / "tests" / "e2e" / ".draft-runs"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "脚本 ID 校验")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 ZZPSS 登录功能。",
                        target_url="http://192.168.7.180:12222/zzpss/#/login",
                        test_data="username=lining\npassword=ExamplePass123!",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-192-168-81514E-LOGIN-001 | P0 | 登录成功 | 登录 | lining | 登录 | 进入首页 | 已自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=cases))
                with main.get_db() as conn:
                    external_id = conn.execute(
                        "SELECT external_id FROM test_cases WHERE work_item_id = ? ORDER BY external_id LIMIT 1",
                        (work["id"],),
                    ).fetchone()["external_id"]
                main.save_exploration(
                    work["id"],
                    main.ExplorationRequest(
                        notes="确认登录按钮",
                        elements=[
                            {
                                "area": "登录页",
                                "name": "登录按钮",
                                "locatorType": "text",
                                "locatorValue": "登录",
                                "source": "unit",
                                "confirmed": True,
                            }
                        ],
                    ),
                )
                script = """import { test, expect } from '@playwright/test';
test('LGN-001 登录成功', async ({ page }) => {
  await expect(page.getByText('首页')).toBeVisible();
});
"""

                with self.assertRaises(main.HTTPException) as raised:
                    main.generate_script(work["id"], main.ContentRequest(content=script))

                self.assertEqual(raised.exception.status_code, 400)
                self.assertIn(external_id, raised.exception.detail)
                with main.get_db() as conn:
                    count = conn.execute(
                        "SELECT COUNT(*) AS count FROM generated_scripts WHERE work_item_id = ?",
                        (work["id"],),
                    ).fetchone()["count"]
                self.assertEqual(count, 0)
            finally:
                main.DB_PATH = original_db_path
                main.WORK_ITEM_DRAFT_DIR = original_draft_dir

    async def test_script_version_draft_rejects_short_login_case_ids(self):
        original_db_path = main.DB_PATH
        original_draft_dir = main.WORK_ITEM_DRAFT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.WORK_ITEM_DRAFT_DIR = root / "tests" / "e2e" / ".draft-runs"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "草稿 ID 校验")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 ZZPSS 登录功能。",
                        target_url="http://192.168.7.180:12222/zzpss/#/login",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-192-168-81514E-LOGIN-001 | P0 | 登录成功 | 登录 | lining | 登录 | 进入首页 | 已自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=cases))
                with main.get_db() as conn:
                    case_ids = main.case_ids_for_work_item(conn, work["id"])
                    external_id = conn.execute(
                        "SELECT external_id FROM test_cases WHERE work_item_id = ? ORDER BY external_id LIMIT 1",
                        (work["id"],),
                    ).fetchone()["external_id"]
                    good_script = f"""import {{ test, expect }} from '@playwright/test';
test('{external_id} 登录成功', async ({{ page }}) => {{
  await expect(page.getByText('首页')).toBeVisible();
}});
"""
                    version_id = main.create_script_version(
                        conn,
                        main.get_work_item_row(work["id"]),
                        good_script,
                        asset_mode="create",
                        case_ids=case_ids,
                    )
                    before_count = conn.execute(
                        "SELECT COUNT(*) AS count FROM test_script_versions WHERE work_item_id = ?",
                        (work["id"],),
                    ).fetchone()["count"]
                bad_script = """import { test, expect } from '@playwright/test';
test('LGN-001 登录成功', async ({ page }) => {
  await expect(page.getByText('首页')).toBeVisible();
});
"""

                with self.assertRaises(main.HTTPException) as raised:
                    main.create_script_version_draft(version_id, main.ScriptDraftRequest(content=bad_script))

                self.assertEqual(raised.exception.status_code, 400)
                self.assertIn(external_id, raised.exception.detail)
                with main.get_db() as conn:
                    after_count = conn.execute(
                        "SELECT COUNT(*) AS count FROM test_script_versions WHERE work_item_id = ?",
                        (work["id"],),
                    ).fetchone()["count"]
                self.assertEqual(after_count, before_count)
            finally:
                main.DB_PATH = original_db_path
                main.WORK_ITEM_DRAFT_DIR = original_draft_dir

    async def test_default_report_includes_audit_detail_and_coverage_matrix(self):
        original_db_path = main.DB_PATH
        original_report_index = main.REPORT_INDEX
        original_screenshot_path = main.SCREENSHOT_PATH
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            main.DB_PATH = root / "test.sqlite"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            main.SCREENSHOT_PATH = root / "artifacts" / "browser-preview.svg"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "登录审计")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证 standard_user 可以登录 Sauce Demo 并看到商品页。",
                        target_url="https://www.saucedemo.com",
                        role="standard_user",
                        test_data="secret_sauce",
                        acceptance="登录后进入 Products 页面",
                        exclusions="不覆盖支付真实链路",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AUDIT-001 | P0 | 登录成功 | 登录主路径 | standard_user/secret_sauce | 打开登录页并提交账号 | 进入 Products 页面 | 已自动化 |
| TC-AUDIT-002 | P1 | 密码错误提示 | 登录异常 | locked_out_user/wrong | 提交错误密码 | 展示错误提示 | 待补充 |
"""
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, browser_session_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "run-audit-001",
                            "",
                            work["title"],
                            "tests/e2e/.draft-runs/audit.draft.spec.ts",
                            "passed",
                            "complete",
                            "完成",
                            100,
                            timestamp,
                            timestamp,
                            0,
                            str(main.REPORT_INDEX),
                            str(main.SCREENSHOT_PATH),
                            work["id"],
                            "",
                        ),
                    )
                    conn.execute("INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)", ("run-audit-001", timestamp, "info", "执行命令: npx playwright test"))
                    conn.execute("INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)", ("run-audit-001", timestamp, "success", "执行完成，退出码 0"))
                    run = conn.execute("SELECT * FROM runs WHERE id = ?", ("run-audit-001",)).fetchone()

                report = main.default_report(main.get_work_item_row(work["id"]), cases, run)

                self.assertIn("## 1. 报告元信息", report)
                self.assertIn("## 2. 测试结论摘要", report)
                self.assertIn("## 5. 覆盖矩阵", report)
                self.assertIn("| TC-AUDIT-001 | P0 | 登录成功 | 登录主路径", report)
                self.assertIn("- 用例总数：2", report)
                self.assertIn("- 优先级分布：P0：1；P1：1；P2：0", report)
                self.assertIn("Spec 路径：`tests/e2e/.draft-runs/audit.draft.spec.ts`", report)
                self.assertIn("运行日志摘录", report)
                self.assertIn("[success] 执行完成，退出码 0", report)
                self.assertIn("质量风险与后续建议", report)
            finally:
                main.DB_PATH = original_db_path
                main.REPORT_INDEX = original_report_index
                main.SCREENSHOT_PATH = original_screenshot_path

    async def test_failure_report_includes_evidence_and_truncated_logs(self):
        original_db_path = main.DB_PATH
        original_flow_run_artifact_dir = main.FLOW_RUN_ARTIFACT_DIR
        original_report_index = main.REPORT_INDEX
        original_screenshot_path = main.SCREENSHOT_PATH
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.FLOW_RUN_ARTIFACT_DIR = root / "flow-runs"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            main.SCREENSHOT_PATH = root / "artifacts" / "browser-preview.svg"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "失败报告")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证登录失败时展示错误信息。",
                        target_url="https://www.saucedemo.com",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-FAIL-001 | P0 | 错误登录 | 登录异常 | invalid_user | 登录 | 展示错误 | 已自动化 |
"""
                timestamp = main.now_iso()
                long_log = "x" * 8200
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, browser_session_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "run-fail-001",
                            "",
                            work["title"],
                            "tests/e2e/.draft-runs/fail.draft.spec.ts",
                            "failed",
                            "complete",
                            "完成",
                            100,
                            timestamp,
                            timestamp,
                            1,
                            str(main.REPORT_INDEX),
                            str(main.SCREENSHOT_PATH),
                            work["id"],
                            "",
                        ),
                    )
                    conn.execute("INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)", ("run-fail-001", timestamp, "error", long_log))
                    run = conn.execute("SELECT * FROM runs WHERE id = ?", ("run-fail-001",)).fetchone()

                path = main.write_temporary_failure_report("flow-fail-001", main.get_work_item_row(work["id"]), cases, "test('x', async () => { expect(true).toBeTruthy(); });", run, "断言未通过")
                report = (root / path).read_text(encoding="utf-8")

                self.assertIn("## 1. 报告元信息", report)
                self.assertIn("Flow Run ID", report)
                self.assertIn("## 4. 覆盖矩阵", report)
                self.assertIn("Playwright HTML report", report)
                self.assertIn("失败结论：断言未通过", report)
                self.assertIn("已截断前", report)
                self.assertIn("若三轮自愈后仍失败", report)
                self.assertLess(len(report), 12000)
            finally:
                main.DB_PATH = original_db_path
                main.FLOW_RUN_ARTIFACT_DIR = original_flow_run_artifact_dir
                main.REPORT_INDEX = original_report_index
                main.SCREENSHOT_PATH = original_screenshot_path

    async def test_self_heal_failure_registers_diagnostic_artifacts_and_deliverables(self):
        original_db_path = main.DB_PATH
        original_root_dir = main.ROOT_DIR
        original_flow_run_artifact_dir = main.FLOW_RUN_ARTIFACT_DIR
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        original_report_index = main.REPORT_INDEX
        original_screenshot_path = main.SCREENSHOT_PATH
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.ROOT_DIR = root
            main.FLOW_RUN_ARTIFACT_DIR = root / "artifacts" / "automation-platform" / "flow-runs"
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "automation-platform" / "playwright-reports"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            main.SCREENSHOT_PATH = root / "artifacts" / "browser-preview.svg"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_自愈失败产物")
                feature = self.create_feature(project["id"], "CODEX_TEST_自愈诊断")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="CODEX_TEST_验证三轮自愈失败后展示诊断报告。",
                        target_url="https://www.saucedemo.com",
                    )
                )
                timestamp = main.now_iso()
                report_index = main.run_html_report_index("run-heal-failed")
                report_index.parent.mkdir(parents=True, exist_ok=True)
                report_index.write_text("<html>failed report</html>", encoding="utf-8")
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO automation_flow_runs (
                            id, work_item_id, feature_id, status, stage, progress,
                            current_attempt, started_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "flow-heal-failed",
                            work["id"],
                            feature["id"],
                            "healing",
                            "自愈诊断",
                            90,
                            3,
                            timestamp,
                        ),
                    )
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, browser_session_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "run-heal-failed",
                            "",
                            work["title"],
                            "tests/e2e/.draft-runs/heal-failed.draft.spec.ts",
                            "failed",
                            "complete",
                            "完成",
                            100,
                            timestamp,
                            timestamp,
                            1,
                            main.relative_or_absolute(report_index),
                            str(main.SCREENSHOT_PATH),
                            work["id"],
                            "",
                        ),
                    )
                    run = conn.execute("SELECT * FROM runs WHERE id = ?", ("run-heal-failed",)).fetchone()

                failure_path = main.write_temporary_failure_report(
                    "flow-heal-failed",
                    main.get_work_item_row(work["id"]),
                    "| ID | 优先级 | 标题 |\n| --- | --- | --- |\n| TC-CODEX-HEAL-001 | P0 | 自愈失败产物 |\n",
                    "import { test, expect } from '@playwright/test';",
                    run,
                    "三轮测试侧自愈后 Playwright 仍失败",
                )
                main.update_automation_flow(
                    "flow-heal-failed",
                    status="failed",
                    stage="自愈诊断",
                    progress=100,
                    ended_at=timestamp,
                    report_path=failure_path,
                    html_report_path=main.relative_or_absolute(report_index),
                    error="三轮测试侧自愈后 Playwright 仍失败",
                )
                main.record_self_heal_failure_deliverables("flow-heal-failed", main.get_work_item_row(work["id"]), run, failure_path)

                flow = main.get_automation_flow_payload("flow-heal-failed")
                artifacts = flow["flowArtifacts"]
                artifact_types = {artifact["artifactType"]: artifact for artifact in artifacts}
                with main.get_db() as conn:
                    deliverables = conn.execute(
                        "SELECT * FROM deliverables WHERE work_item_id = ? ORDER BY type ASC",
                        (work["id"],),
                    ).fetchall()

                self.assertEqual(flow["status"], "failed")
                self.assertEqual(flow["stage"], "自愈诊断")
                self.assertIn("manual-report", artifact_types)
                self.assertIn("html-report", artifact_types)
                self.assertEqual(artifact_types["manual-report"]["stage"], "自愈诊断")
                self.assertEqual(artifact_types["manual-report"]["status"], "failed")
                self.assertTrue(artifact_types["manual-report"]["path"].endswith("failure-report.md"))
                self.assertEqual(artifact_types["html-report"]["stage"], "自愈诊断")
                self.assertEqual(artifact_types["html-report"]["status"], "failed")
                self.assertTrue(artifact_types["html-report"]["path"].endswith("/index.html"))
                deliverables_by_type = {row["type"]: row for row in deliverables}
                self.assertEqual(deliverables_by_type["manual-report"]["status"], "failed")
                self.assertTrue(deliverables_by_type["manual-report"]["file_path"].endswith("failure-report.md"))
                self.assertEqual(deliverables_by_type["html-report"]["status"], "failed")
                self.assertTrue(deliverables_by_type["html-report"]["file_path"].endswith("/index.html"))
            finally:
                main.DB_PATH = original_db_path
                main.ROOT_DIR = original_root_dir
                main.FLOW_RUN_ARTIFACT_DIR = original_flow_run_artifact_dir
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir
                main.REPORT_INDEX = original_report_index
                main.SCREENSHOT_PATH = original_screenshot_path

    async def test_playwright_script_validation_rejects_narrative_prefix(self):
        script = "我会先修复脚本。import { expect, test } from '@playwright/test';\ntest('ok', async ({ page }) => { await expect(page.getByText('首页')).toBeVisible(); });"

        self.assertFalse(main.valid_playwright_script(script, [{"locatorValue": "首页"}]))

    async def test_playwright_script_validation_accepts_stable_locator_outside_confirmed_elements(self):
        script = "import { expect, test } from '@playwright/test';\ntest('ok', async ({ page }) => { await expect(page.getByText('登录成功')).toBeVisible(); });"

        self.assertTrue(main.valid_playwright_script(script, [{"locatorValue": "登录按钮"}]))

    async def test_extract_playwright_script_accepts_fenced_code(self):
        content = """下面是修复后的脚本：

```ts
import { expect, test } from '@playwright/test';

test('ok', async ({ page }) => {
  await expect(page.getByText('欢迎您，李宁')).toBeVisible();
});
```
"""

        script = main.extract_playwright_script(content)

        self.assertTrue(script.startswith("import { expect, test }"))
        self.assertTrue(main.valid_playwright_script(script, [{"locatorValue": "欢迎您，李宁"}]))

    async def test_failure_evidence_summary_reads_error_context(self):
        original_root_dir = main.ROOT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context_path = root / "test-results" / "case" / "error-context.md"
            context_path.parent.mkdir(parents=True)
            context_path.write_text("- text: 首页 欢迎您，李宁 基本情况\n", encoding="utf-8")
            main.ROOT_DIR = root
            try:
                summary = main.failure_evidence_summary("Error Context: test-results/case/error-context.md")
            finally:
                main.ROOT_DIR = original_root_dir

        self.assertIn("欢迎您，李宁", summary)
        self.assertIn("test-results/case/error-context.md", summary)

    async def test_healed_prompt_includes_playwright_error_context(self):
        original_root_dir = main.ROOT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context_path = root / "test-results" / "case" / "error-context.md"
            context_path.parent.mkdir(parents=True)
            context_path.write_text("- text: 首页 欢迎您，李宁 基本情况\n", encoding="utf-8")
            main.ROOT_DIR = root
            item = {
                "requirement": "验证 ZZPSS 登录成功。",
                "target_url": "http://example.test/zzpss/#/login",
            }
            run = {"spec": "tests/e2e/.draft-runs/zzpss.draft.spec.ts"}
            try:
                prompt = main.healed_script_prompt(
                    item,
                    "import { expect, test } from '@playwright/test';\ntest('x', async ({ page }) => { await expect(page.getByRole('navigation')).toBeVisible(); });",
                    run,
                    "Error Context: test-results/case/error-context.md",
                    [],
                )
            finally:
                main.ROOT_DIR = original_root_dir

        self.assertIn("欢迎您，李宁", prompt)
        self.assertIn("而不是继续等待不存在的通用 layout/navigation selector", prompt)

    async def test_script_changed_enough_rejects_failed_locator(self):
        current_script = "import { expect, test } from '@playwright/test';\ntest('x', async ({ page }) => { await expect(page.getByRole('navigation')).toBeVisible(); });"
        healed_script = current_script.replace("test('x'", "test('y'")
        failure_log = "Locator: getByRole('navigation').or(getByRole('menu'))"

        self.assertFalse(main.script_changed_enough(current_script, healed_script, failure_log))

    async def test_healing_rejects_added_credential_normalization(self):
        current_script = """function requiredCredential(name: string): string {
  return process.env[name] || '';
}
const username = requiredCredential('QA_USERNAME');
"""
        healed_script = """function requiredCredential(name: string): string {
  return process.env[name] || '';
}
function normalizeUsername(username: string): string {
  return username === 'amdin' ? 'admin' : username;
}
const username = normalizeUsername(requiredCredential('QA_USERNAME'));
"""

        self.assertIn(
            "不得硬编码、纠正或归一化",
            main.added_credential_override_reason(current_script, healed_script),
        )

    async def test_confirmed_credential_failure_points_to_environment_variables(self):
        summary = main.confirmed_non_script_failure_summary(
            {
                "category": "test-data-environment",
                "evidence": ["应用明确返回登录凭据无效", "提交后仍停留在登录页"],
            }
        )

        self.assertIn("QA_USERNAME/QA_PASSWORD", summary)
        self.assertIn("不会改写凭据", summary)

    async def test_valid_login_auth_rejection_is_blocked_with_environment_guidance(self):
        item = {
            "title": "SkillHub 登录功能",
            "requirement": "使用正确账号登录 SkillHub。",
            "target_url": "http://skillhub.test/#/",
            "acceptance": "正确账号应登录成功。",
            "test_data": "账号 test，密码：secret",
            "exclusions": "",
        }
        case = {
            "external_id": "TC-CODEX-LOGIN-001",
            "title": "有效账号登录成功",
            "requirement": "正确账号登录",
            "preconditions": "有效账号",
            "steps": "填写账号密码并点击登录",
            "expected": "进入首页",
        }
        version = {"spec_path": "tests/e2e/login.spec.ts"}
        failure_log = '''Received string: "http://skillhub.test/#/login"
- heading "登录 SkillHub"
- alert: 用户名或密码错误
'''

        diagnosis = main.diagnose_healing_target(item, version, case, "", failure_log)

        self.assertEqual(diagnosis["category"], "test-data-environment")
        self.assertEqual(diagnosis["confidence"], "high")
        self.assertEqual(diagnosis["action"], "block")
        self.assertIn("QA_USERNAME/QA_PASSWORD", diagnosis["summary"])
        self.assertIn("不会改写凭据", diagnosis["summary"])
        self.assertIn("应用明确返回登录凭据无效", diagnosis["evidence"])

    async def test_strict_mode_report_is_classified_for_repair_without_source_pollution(self):
        item = {
            "title": "SkillHub 登录功能",
            "requirement": "使用正确账号登录 SkillHub。",
            "target_url": "http://skillhub.test/#/",
            "acceptance": "正确账号应登录成功。",
            "test_data": "账号 test，密码 secret",
            "exclusions": "",
        }
        case = {
            "external_id": "TC-CODEX-LOGIN-STRICT",
            "title": "正确账号密码登录成功",
            "requirement": "正确账号登录",
            "preconditions": "有效账号",
            "steps": "填写账号密码并点击登录",
            "expected": "进入首页",
        }
        failure_log = '''# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('link', { name: '登录' }) resolved to 2 elements
```

# Page snapshot

```yaml
- banner:
  - link "登录":
    - /url: "#/login"
- main:
  - heading "发现技能"
```

# Test source

```ts
await page.goto(TARGET_URL, { waitUntil: 'commit', timeout: 30_000 });
await expect(page.getByText(/用户名或密码错误/)).toBeVisible();
```
'''

        diagnosis = main.diagnose_healing_target(
            item,
            {"spec_path": "tests/e2e/login.spec.ts"},
            case,
            "",
            failure_log,
        )

        self.assertEqual(diagnosis["category"], "test-code")
        self.assertEqual(diagnosis["confidence"], "high")
        self.assertEqual(diagnosis["action"], "repair")
        self.assertNotIn("应用明确返回登录凭据无效", diagnosis["evidence"])
        self.assertNotIn("提交后仍停留在登录页", diagnosis["evidence"])

    async def test_test_source_auth_text_does_not_fake_observed_rejection(self):
        failure_log = '''# Error details

```
Error: expect(received).toBe(expected)
```

# Page snapshot

```yaml
- main:
  - heading "发现技能"
```

# Test source

```ts
await expect(page.getByText(/用户名或密码错误/)).toBeVisible();
```
'''

        diagnosis = main.diagnose_healing_target(
            {
                "title": "SkillHub 登录功能",
                "requirement": "使用正确账号登录。",
                "target_url": "http://skillhub.test/#/",
                "acceptance": "登录成功。",
                "test_data": "",
                "exclusions": "",
            },
            {"spec_path": "tests/e2e/login.spec.ts"},
            {
                "external_id": "TC-CODEX-LOGIN-SOURCE",
                "title": "正确账号登录成功",
                "requirement": "正确账号登录",
                "preconditions": "有效账号",
                "steps": "登录",
                "expected": "进入首页",
            },
            "",
            failure_log,
        )

        self.assertEqual(diagnosis["category"], "unknown")
        self.assertEqual(diagnosis["action"], "repair")
        self.assertEqual(diagnosis["evidence"], [])

    async def test_login_link_in_snapshot_does_not_mean_current_login_page(self):
        homepage_snapshot = '''- banner:
  - link "登录":
    - /url: "#/login"
- main:
  - heading "发现技能"
'''
        login_snapshot = '''- main:
  - heading "登录 SkillHub"
  - textbox "用户名"
  - textbox "密码"
'''

        self.assertFalse(main.observed_login_page(homepage_snapshot))
        self.assertTrue(main.observed_login_page(login_snapshot))

    async def test_real_navigation_timeout_is_classified_for_confirmation(self):
        failure_log = '''# Error details

```
Error: page.goto: Timeout 30000ms exceeded.
Call log:
  - navigating to "http://skillhub.test/", waiting until "commit"
```

# Test source

```ts
await page.goto(TARGET_URL, { timeout: 30_000 });
```
'''

        diagnosis = main.diagnose_healing_target(
            {
                "title": "SkillHub 首页",
                "requirement": "打开 SkillHub。",
                "target_url": "http://skillhub.test/#/",
                "acceptance": "首页可见。",
                "test_data": "",
                "exclusions": "",
            },
            {"spec_path": "tests/e2e/home.spec.ts"},
            None,
            "",
            failure_log,
        )

        self.assertEqual(diagnosis["category"], "test-data-environment")
        self.assertEqual(diagnosis["action"], "confirm")

    async def test_healed_prompt_keeps_strict_error_details_from_large_report(self):
        failure_log = f'''# Error details

```
Error: strict mode violation: getByRole('button', {{ name: '登录' }}) resolved to 2 elements
1) aka getByRole('button', {{ name: '登录', exact: true }})
```

# Page snapshot

```yaml
{'x' * 9000}
```

# Test source

```ts
const SOURCE_ONLY_MARKER = '用户名或密码错误';
```
'''

        prompt = main.healed_script_prompt(
            {
                "title": "SkillHub 登录",
                "requirement": "验证 SkillHub 登录",
                "target_url": "http://skillhub.test/#/login",
            },
            "import { expect, test } from '@playwright/test';\ntest('x', async ({ page }) => { await expect(page.getByRole('button', { name: '登录' })).toBeVisible(); });",
            {"spec": "tests/e2e/login.spec.ts"},
            failure_log,
            [],
        )

        self.assertIn("strict mode violation", prompt)
        self.assertIn("exact: true", prompt)
        self.assertNotIn("SOURCE_ONLY_MARKER", prompt)

    async def test_script_change_rejects_unchanged_strict_locator(self):
        current_script = "const loginButton = page.getByRole('button', { name: '登录' });"
        failure_log = "Error: strict mode violation: getByRole('button', { name: '登录' }) resolved to 2 elements"

        self.assertFalse(
            main.script_changed_enough(
                current_script,
                current_script + "\nconst unrelated = true;",
                failure_log,
            )
        )
        self.assertTrue(
            main.script_changed_enough(
                current_script,
                "const loginButton = page.getByRole('button', { name: '登录', exact: true });",
                failure_log,
            )
        )

    async def test_archived_failure_context_is_scoped_to_target_case(self):
        original_root_dir = main.ROOT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir = root / "artifacts" / "reports" / "run-1" / "data"
            data_dir.mkdir(parents=True)
            (data_dir / "case-a.md").write_text(
                "# Test info\n- Name: login-a.spec.ts >> TC-CODEX-A\n# Error details\n用户名或密码错误\n",
                encoding="utf-8",
            )
            (data_dir / "case-b.md").write_text(
                "# Test info\n- Name: login-b.spec.ts >> TC-CODEX-B\n# Error details\nLocator: .missing-button\n",
                encoding="utf-8",
            )
            main.ROOT_DIR = root
            try:
                context = main.failure_context_from_archived_report(
                    {"report_path": "artifacts/reports/run-1/index.html"},
                    {"spec_path": "tests/e2e/login-a.spec.ts"},
                    {"external_id": "TC-CODEX-A"},
                )
            finally:
                main.ROOT_DIR = original_root_dir

        self.assertIn("TC-CODEX-A", context)
        self.assertIn("用户名或密码错误", context)
        self.assertNotIn(".missing-button", context)

    async def test_healed_prompt_scopes_zzpss_selector_guidance_to_zzpss(self):
        current_script = "import { expect, test } from '@playwright/test';\ntest('x', async ({ page }) => { await expect(page.getByRole('button', { name: '登录' })).toBeVisible(); });"
        run = {"spec": "tests/e2e/login.spec.ts"}
        skillhub_prompt = main.healed_script_prompt(
            {
                "title": "SkillHub 登录",
                "requirement": "验证 SkillHub 登录",
                "target_url": "http://skillhub.test/#/login",
            },
            current_script,
            run,
            "Locator: getByRole('button', { name: '登录' })",
            [],
        )
        zzpss_prompt = main.healed_script_prompt(
            {
                "title": "ZZPSS 登录",
                "requirement": "验证 ZZPSS 登录",
                "target_url": "http://example.test/zzpss/#/login",
            },
            current_script,
            run,
            "Locator: getByRole('button', { name: '登录' })",
            [],
        )

        self.assertNotIn("ZZPSS 自愈约束", skillhub_prompt)
        self.assertNotIn("其他站点不得凭空引入", skillhub_prompt)
        self.assertIn("ZZPSS 自愈约束", zzpss_prompt)
        self.assertIn(".login-button", zzpss_prompt)

    async def test_healing_rejects_unsupported_new_css_locator(self):
        current_script = "const loginButton = page.getByRole('button', { name: '登录', exact: true });"
        healed_script = "const loginButton = page.locator('.login-button');"

        self.assertEqual(
            main.unsupported_new_css_locator(current_script, healed_script, "- button \"登录\""),
            ".login-button",
        )
        self.assertEqual(
            main.unsupported_new_css_locator(current_script, healed_script, "Locator: locator('.login-button')"),
            "",
        )

    async def test_work_item_title_uses_short_qa_name_for_long_requirement(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "标题生成")
                requirement = (
                    "验证标准用户可以在 https://www.saucedemo.com 登录、添加商品到购物车、进入结账流程，"
                    "并在错误账号或缺失信息时展示明确错误。角色为 standard_user，测试数据为用户名 "
                    "standard_user、密码 secret_sauce、商品 Sauce Labs Backpack。不覆盖跨浏览器兼容、支付真实链路和第三方风控。"
                )

                work = main.create_work_item(main.WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement=requirement))

                self.assertNotEqual(work["title"], requirement[:80])
                self.assertLessEqual(len(work["title"]), 28)
                self.assertNotRegex(work["title"], r"(测试|验证|工单|任务)$")
                self.assertNotIn("https://", work["title"])
                self.assertRegex(work["slug"], r"^saucedemo-[0-9a-f]{6}$")
            finally:
                main.DB_PATH = original_db_path

    async def test_work_item_creation_requires_feature_binding(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "需求工单绑定")

                with self.assertRaises(main.HTTPException) as missing_feature:
                    main.create_work_item(main.WorkItemRequest(project_id=project["id"], requirement="验证需求工单必须选择功能。"))
                self.assertEqual(missing_feature.exception.status_code, 400)

                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证需求工单可以绑定项目与功能。",
                    )
                )

                self.assertEqual(work["projectId"], project["id"])
                self.assertEqual(work["featureId"], feature["id"])
                self.assertEqual(work["featurePath"], feature["path"])
            finally:
                main.DB_PATH = original_db_path

    async def test_work_item_title_uses_labeled_requirement_prefix(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "标题生成")
                requirement = "供电所首页登录与菜单可见性：验证用户登录后首页菜单、指标卡片和欢迎语可见。测试数据为账号 lining。"

                work = main.create_work_item(main.WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement=requirement))

                self.assertEqual(work["title"], "供电所首页登录与菜单可见性")
            finally:
                main.DB_PATH = original_db_path

    async def test_work_item_title_handles_url_and_mixed_english_requirement(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "英文登录")
                requirement = "https://www.saucedemo.com login smoke: verify standard_user can login and see Products page."

                work = main.create_work_item(main.WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement=requirement))

                self.assertLessEqual(len(work["title"]), 28)
                self.assertIn("SauceDemo", work["title"])
                self.assertNotRegex(work["title"], r"(测试|验证|工单|任务)$")
                self.assertRegex(work["slug"], r"^saucedemo-[a-z0-9-]+-[0-9a-f]{6}$")
            finally:
                main.DB_PATH = original_db_path

    def test_extract_requirement_url_stops_at_chinese_text_and_trailing_punctuation(self):
        examples = {
            "测试下https://www.saucedemo.com登录功能": "https://www.saucedemo.com",
            "测试下 https://www.saucedemo.com 登录功能": "https://www.saucedemo.com",
            "验证https://example.com/login?role=user#main登录": "https://example.com/login?role=user#main",
            "打开https://example.com。": "https://example.com",
        }

        for requirement, expected_url in examples.items():
            with self.subTest(requirement=requirement):
                self.assertEqual(main.extract_requirement_url(requirement), expected_url)

    def test_normalize_requirement_analysis_strips_ai_environment_suffix(self):
        analysis = main.normalize_requirement_analysis(
            {
                "environment": "https://example.com；浏览器范围为 Chromium。",
                "goal": "验证示例页面",
                "userPath": "打开页面",
                "acceptance": "显示标题",
                "role": "匿名访客",
                "testData": "公开页面",
                "exclusions": "跨浏览器",
                "missing": [],
                "clarificationNeeded": False,
            },
            "访问 https://example.com，验证页面显示标题。",
            "ai",
        )

        self.assertEqual(analysis["environment"], "https://example.com")

    def test_work_item_target_url_precedence_is_requirement_then_project_then_ai(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "target-precedence.sqlite"
            try:
                main.init_db()
                project = main.create_project(main.ProjectRequest(
                    name="CODEX_TEST_URL_PRIORITY",
                    target_url="https://project.example.com",
                ))
                with main.get_db() as conn:
                    from_requirement = main.resolve_work_item_target_url(
                        conn,
                        project["id"],
                        "访问 https://requirement.example.com/path，检查页面。",
                        ai_environment="https://ai.example.com；AI 描述",
                    )
                    from_project = main.resolve_work_item_target_url(
                        conn,
                        project["id"],
                        "检查项目默认页面。",
                        ai_environment="https://ai.example.com；AI 描述",
                    )
                self.assertEqual(from_requirement, "https://requirement.example.com/path")
                self.assertEqual(from_project, "https://project.example.com")
            finally:
                main.DB_PATH = original_db_path

    async def test_automation_flow_creation_does_not_wait_for_ai_analysis(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "fast-flow.sqlite"
            try:
                main.init_db()
                project = main.create_project(main.ProjectRequest(
                    name="CODEX_TEST_FAST_FLOW",
                    target_url="https://example.com",
                ))
                feature = self.create_feature(project["id"], "快速入队")
                execute_flow = AsyncMock()
                with (
                    patch.object(main.platform, "execute_automation_flow", execute_flow),
                    patch.object(main.platform, "analyze_requirement_with_ai", side_effect=AssertionError("同步请求不应调用 AI")) as analyze,
                ):
                    started_at = asyncio.get_running_loop().time()
                    flow = await main.create_automation_flow(main.AutomationFlowRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="访问 https://example.com，验证 Example Domain 标题。",
                    ))
                    elapsed = asyncio.get_running_loop().time() - started_at
                    await asyncio.sleep(0)

                self.assertLess(elapsed, 2)
                self.assertEqual(flow["status"], "queued")
                self.assertTrue(flow["workItemId"])
                self.assertEqual(flow["workItem"]["targetUrl"], "https://example.com")
                analyze.assert_not_called()
                execute_flow.assert_awaited_once_with(flow["id"])
            finally:
                main.DB_PATH = original_db_path

    async def test_work_item_target_url_strips_chinese_suffix_from_requirement_url(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "登录功能")
                requirement = "测试下https://www.saucedemo.com登录功能"

                work = main.create_work_item(main.WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement=requirement))

                self.assertEqual(work["targetUrl"], "https://www.saucedemo.com")
                self.assertEqual(work["requirement"], requirement)
            finally:
                main.DB_PATH = original_db_path

    async def test_work_item_preserves_explicit_title(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "自定义标题")

                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        title="自定义登录回归任务",
                        requirement="验证用户可以登录系统并看到首页。",
                    )
                )

                self.assertEqual(work["title"], "自定义登录回归任务")
                self.assertRegex(work["slug"], r"^qa-task-[0-9a-f]{6}$")
            finally:
                main.DB_PATH = original_db_path

    async def test_save_artifacts_uses_short_deliverable_names_and_stable_paths(self):
        original_db_path = main.DB_PATH
        original_project_artifact_dir = main.PROJECT_ARTIFACT_DIR
        original_report_index = main.REPORT_INDEX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.PROJECT_ARTIFACT_DIR = root / "artifacts" / "projects"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "交付命名")
                requirement = "供电所首页登录与菜单可见性：验证用户登录后首页菜单、指标卡片和欢迎语可见。测试数据为账号 lining。"
                work = main.create_work_item(main.WorkItemRequest(project_id=project["id"], feature_id=feature["id"], requirement=requirement))
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-NAME-001 | P0 | 首页登录成功 | 首页登录 | lining | 登录后查看首页 | 菜单和欢迎语可见 | 已自动化 |
"""
                script = "import { test, expect } from '@playwright/test';\ntest('TC-NAME-001 首页登录成功', async ({ page }) => { expect(true).toBeTruthy(); });\n"
                snapshot = self.create_verified_run_snapshot(work, cases, script, "run-name-001")

                item = main.save_artifacts(work["id"], main.SaveArtifactsRequest(run_id=snapshot["run_id"]))
                deliverables = main.platform.deliverables(work_item_id=work["id"], include_content=False)
                names = {deliverable["type"]: deliverable["name"] for deliverable in deliverables}

                self.assertEqual(names["test-cases"], f"测试用例：{work['title']}")
                self.assertEqual(names["spec"], f"自动化脚本：{work['title']}")
                self.assertEqual(names["manual-report"], f"人工测试报告：{work['title']}")
                self.assertEqual(names["html-report"], f"HTML Report：{work['title']}")
                self.assertRegex(item["reportPath"], r"qa-task-[0-9a-f]{6}/qa-task-[0-9a-f]{6}-test-report\.md$")
                self.assertLess(len(names["manual-report"]), 50)
            finally:
                main.DB_PATH = original_db_path
                main.PROJECT_ARTIFACT_DIR = original_project_artifact_dir
                main.REPORT_INDEX = original_report_index

    async def test_save_artifacts_rejects_script_without_case_id_in_test_title(self):
        original_db_path = main.DB_PATH
        original_project_artifact_dir = main.PROJECT_ARTIFACT_DIR
        original_report_index = main.REPORT_INDEX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.PROJECT_ARTIFACT_DIR = root / "artifacts" / "projects"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "脚本覆盖校验")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证登录功能。",
                    )
                )
                cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LGN-001 | P0 | 登录成功 | 登录 | lining | 登录 | 进入首页 | 已自动化 |
"""
                script = "import { test, expect } from '@playwright/test';\ntest('TC-LOGIN-001 登录成功', async () => { expect(true).toBeTruthy(); });\n"
                snapshot = self.create_verified_run_snapshot(work, cases, script, "run-missing-case-001")

                with self.assertRaises(main.HTTPException) as raised:
                    main.save_artifacts(work["id"], main.SaveArtifactsRequest(run_id=snapshot["run_id"]))

                self.assertEqual(raised.exception.status_code, 400)
                self.assertIn("LGN-001", raised.exception.detail)
            finally:
                main.DB_PATH = original_db_path
                main.PROJECT_ARTIFACT_DIR = original_project_artifact_dir
                main.REPORT_INDEX = original_report_index

    async def test_save_artifacts_publishes_only_the_selected_run_snapshot(self):
        original_db_path = main.DB_PATH
        original_project_artifact_dir = main.PROJECT_ARTIFACT_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.PROJECT_ARTIFACT_DIR = root / "artifacts" / "projects"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "验证快照发布")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证保存交付物时只发布通过 Run 对应的版本。",
                    )
                )
                verified_cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SNAPSHOT-001 | P0 | 发布通过快照 | 快照发布 | 已有通过 Run | 保存交付物 | 只保存通过版本 | 已自动化 |
"""
                verified_script = "import { test, expect } from '@playwright/test';\ntest('TC-SNAPSHOT-001 发布通过快照', async () => { expect(true).toBeTruthy(); });\n"
                snapshot = self.create_verified_run_snapshot(work, verified_cases, verified_script, "run-snapshot-001")
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO generated_cases (work_item_id, content, asset_mode, case_ids_json, created_at)
                        VALUES (?, ?, 'create', '[]', ?)
                        """,
                        (work["id"], verified_cases.replace("发布通过快照", "未验证用例修改"), main.now_iso()),
                    )
                    conn.execute(
                        """
                        INSERT INTO generated_scripts (work_item_id, content, asset_mode, case_ids_json, created_at)
                        VALUES (?, ?, 'create', '[]', ?)
                        """,
                        (work["id"], verified_script.replace("expect(true)", "expect(false)"), main.now_iso()),
                    )

                item = main.save_artifacts(
                    work["id"],
                    main.SaveArtifactsRequest(
                        run_id=snapshot["run_id"],
                        cases_markdown="未验证客户端用例内容",
                        script_content="未验证客户端脚本内容",
                    ),
                )

                self.assertEqual(Path(item["casesPath"]).read_text(encoding="utf-8"), verified_cases)
                self.assertEqual(Path(item["specPath"]).read_text(encoding="utf-8"), verified_script)
                with self.assertRaises(main.HTTPException) as raised:
                    main.save_artifacts(work["id"], main.SaveArtifactsRequest(run_id=snapshot["run_id"]))
                self.assertEqual(raised.exception.status_code, 409)
            finally:
                main.DB_PATH = original_db_path
                main.PROJECT_ARTIFACT_DIR = original_project_artifact_dir

    async def test_save_artifacts_rejects_legacy_run_without_version_bindings(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "历史运行发布校验")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证历史运行缺少版本绑定时必须重新执行。",
                    )
                )
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id
                        ) VALUES (?, '', ?, '', 'passed', 'complete', '完成', 100, ?, ?, 0, '', '', ?)
                        """,
                        ("run-legacy-001", work["title"], timestamp, timestamp, work["id"]),
                    )
                    conn.execute(
                        "UPDATE work_items SET latest_run_id = ?, status = 'passed' WHERE id = ?",
                        ("run-legacy-001", work["id"]),
                    )

                with self.assertRaises(main.HTTPException) as raised:
                    main.save_artifacts(work["id"], main.SaveArtifactsRequest(run_id="run-legacy-001"))

                self.assertEqual(raised.exception.status_code, 400)
                self.assertIn("重新执行验证", raised.exception.detail)
            finally:
                main.DB_PATH = original_db_path

    async def test_suite_run_skips_cases_without_bound_spec(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "套件跳过")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证用户可以在 https://www.saucedemo.com 登录，测试数据为 standard_user/secret_sauce，验收标准为进入商品页。",
                    )
                )
                markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SMOKE-001 | P0 | 登录成功 | 登录 | standard_user/secret_sauce | 打开页面并登录 | 进入商品页 | 待自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=markdown))
                cases = [case for case in main.test_cases(project_id=project["id"]) if case["workItemId"] == work["id"]]

                suite_run = await main.create_suite_run(main.SuiteRunRequest(case_ids=[cases[0]["id"]]))
                await asyncio.sleep(0.2)
                detail = main.get_suite_run(suite_run["id"])

                self.assertEqual(detail["status"], "skipped")
                self.assertEqual(detail["totalCases"], 1)
                self.assertEqual(detail["skippedCases"], 1)
            finally:
                main.DB_PATH = original_db_path

    async def test_suite_run_keeps_per_case_reports_and_sets_suite_report_path(self):
        original_db_path = main.DB_PATH
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        original_report_index = main.REPORT_INDEX
        original_root_dir = main.ROOT_DIR
        original_execution_config_dir = main.EXECUTION_CONFIG_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "automation-platform" / "playwright-reports"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            main.ROOT_DIR = root
            main.EXECUTION_CONFIG_DIR = root / "tests" / "e2e" / ".execution-configs"
            try:
                main.init_db()
                project = self.create_project()
                spec_path = root / "tests" / "e2e" / "suite-report.spec.ts"
                spec_path.parent.mkdir(parents=True, exist_ok=True)
                spec_path.write_text("import { test, expect } from '@playwright/test';\n", encoding="utf-8")
                case_one = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-SUITE-REPORT-001",
                        title="套件报告用例一",
                        priority="P0",
                        automation_status="automated",
                        spec_path=str(spec_path.relative_to(root)),
                    )
                )
                case_two = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-SUITE-REPORT-002",
                        title="套件报告用例二",
                        priority="P1",
                        automation_status="automated",
                        spec_path=str(spec_path.relative_to(root)),
                    )
                )
                suite = main.create_test_suite(main.SuiteRequest(project_id=project["id"], name="套件报告回归"))
                main.update_test_suite_cases(suite["id"], main.SuiteCaseUpdateRequest(case_ids=[case_one["id"], case_two["id"]]))
                suite_report = main.suite_html_report_index("placeholder")

                async def fake_run_playwright(run_id, suite_payload, work_item_id=None):
                    report_path = Path(suite_payload["html_report_path"])
                    report_path.parent.mkdir(parents=True, exist_ok=True)
                    report_path.write_text(f"<html>{run_id}</html>", encoding="utf-8")
                    with main.get_db() as conn:
                        conn.execute(
                            "UPDATE runs SET status = 'passed', ended_at = ?, exit_code = 0, report_path = ? WHERE id = ?",
                            (main.now_iso(), main.relative_or_absolute(report_path), run_id),
                        )

                async def fake_merge_suite_html_report(suite_run_id):
                    report_path = main.suite_html_report_index(suite_run_id)
                    report_path.parent.mkdir(parents=True, exist_ok=True)
                    report_path.write_text("<html>suite</html>", encoding="utf-8")
                    return report_path

                with (
                    patch.object(main, "run_playwright", side_effect=fake_run_playwright),
                    patch.object(main, "merge_suite_html_report", side_effect=fake_merge_suite_html_report),
                ):
                    suite_run = await main.create_suite_run(main.SuiteRunRequest(suite_id=suite["id"]))
                    await asyncio.sleep(0.2)

                detail = main.get_suite_run(suite_run["id"])
                run_ids = [item["runId"] for item in detail["cases"]]
                run_report_paths = []
                with main.get_db() as conn:
                    for run_id in run_ids:
                        row = conn.execute("SELECT report_path FROM runs WHERE id = ?", (run_id,)).fetchone()
                        run_report_paths.append(row["report_path"])

                expected_suite_report = main.relative_or_absolute(main.suite_html_report_index(suite_run["id"]))
                self.assertEqual(detail["status"], "passed")
                self.assertEqual(detail["reportPath"], expected_suite_report)
                self.assertEqual(len(set(run_report_paths)), 2)
                self.assertTrue(all("/artifacts/automation-platform/playwright-reports/runs/" in path for path in run_report_paths))
                self.assertTrue(all(path.endswith("/index.html") for path in run_report_paths))
                self.assertNotIn(detail["reportPath"], run_report_paths)
                self.assertNotEqual(detail["reportPath"], main.relative_or_absolute(main.REPORT_INDEX))
                self.assertNotEqual(main.relative_or_absolute(suite_report), detail["reportPath"])
            finally:
                main.DB_PATH = original_db_path
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir
                main.REPORT_INDEX = original_report_index
                main.ROOT_DIR = original_root_dir
                main.EXECUTION_CONFIG_DIR = original_execution_config_dir

    async def test_delete_suite_run_removes_monitor_record_but_keeps_run_evidence(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                case_item = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-CODEX-SUITE-RUN-DELETE-001",
                        title="删除执行监控记录保留证据",
                        priority="P0",
                    )
                )
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id, browser_session_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "run-suite-delete-evidence",
                            "",
                            "CODEX_TEST_SUITE_RUN_DELETE",
                            "tests/e2e/.draft-runs/suite-delete.draft.spec.ts",
                            "passed",
                            "complete",
                            "完成",
                            100,
                            timestamp,
                            timestamp,
                            0,
                            "playwright-report/index.html",
                            "",
                            "",
                            "",
                        ),
                    )
                    conn.execute(
                        "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)",
                        ("run-suite-delete-evidence", timestamp, "success", "执行完成"),
                    )
                    conn.execute(
                        """
                        INSERT INTO suite_runs (
                            id, suite_id, project_id, name, status, progress, total_cases,
                            passed_cases, failed_cases, skipped_cases, started_at, ended_at, report_path
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "suite-run-delete-done",
                            "",
                            project["id"],
                            "CODEX_TEST_SUITE_RUN_DELETE",
                            "passed",
                            100,
                            1,
                            1,
                            0,
                            0,
                            timestamp,
                            timestamp,
                            "playwright-report/index.html",
                        ),
                    )
                    conn.execute(
                        "INSERT INTO suite_run_cases (suite_run_id, case_id, run_id, status, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)",
                        ("suite-run-delete-done", case_item["id"], "run-suite-delete-evidence", "passed", timestamp, timestamp),
                    )

                deleted = main.delete_suite_run("suite-run-delete-done")

                self.assertEqual(deleted, {"status": "deleted", "id": "suite-run-delete-done"})
                with main.get_db() as conn:
                    self.assertIsNone(conn.execute("SELECT * FROM suite_runs WHERE id = ?", ("suite-run-delete-done",)).fetchone())
                    self.assertEqual(
                        conn.execute("SELECT COUNT(*) AS total FROM suite_run_cases WHERE suite_run_id = ?", ("suite-run-delete-done",)).fetchone()["total"],
                        0,
                    )
                    self.assertIsNotNone(conn.execute("SELECT * FROM runs WHERE id = ?", ("run-suite-delete-evidence",)).fetchone())
                    self.assertEqual(
                        conn.execute("SELECT COUNT(*) AS total FROM logs WHERE run_id = ?", ("run-suite-delete-evidence",)).fetchone()["total"],
                        1,
                    )
                    self.assertIsNotNone(conn.execute("SELECT * FROM audit_logs WHERE event_type = ?", ("suite_run_deleted",)).fetchone())
            finally:
                main.DB_PATH = original_db_path

    async def test_delete_suite_run_rejects_active_or_missing_records(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO suite_runs (
                            id, suite_id, project_id, name, status, progress, total_cases,
                            passed_cases, failed_cases, skipped_cases, started_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        ("suite-run-delete-active", "", project["id"], "CODEX_TEST_SUITE_RUN_ACTIVE", "running", 20, 1, 0, 0, 0, timestamp),
                    )

                with self.assertRaises(main.HTTPException) as active_error:
                    main.delete_suite_run("suite-run-delete-active")
                self.assertEqual(active_error.exception.status_code, 400)
                self.assertIn("不能删除", active_error.exception.detail)

                with self.assertRaises(main.HTTPException) as missing_error:
                    main.delete_suite_run("missing-suite-run")
                self.assertEqual(missing_error.exception.status_code, 404)
            finally:
                main.DB_PATH = original_db_path

    async def test_delete_test_cases_removes_suite_links_but_keeps_history_and_deliverables(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                case_one = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-DELETE-001",
                        title="单条删除用例",
                        priority="P0",
                    )
                )
                case_two = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-DELETE-002",
                        title="批量删除用例",
                        priority="P1",
                    )
                )
                suite = main.create_test_suite(main.SuiteRequest(project_id=project["id"], name="删除回归套件"))
                main.update_test_suite_cases(suite["id"], main.SuiteCaseUpdateRequest(case_ids=[case_one["id"], case_two["id"]]))
                artifact_path = Path(directory) / "delete-case-report.md"
                artifact_path.write_text("保留交付物登记", encoding="utf-8")
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    main.register_deliverable(
                        conn,
                        project["id"],
                        "manual-report",
                        "删除回归交付物",
                        artifact_path,
                        case_id=case_one["id"],
                    )
                    conn.execute(
                        """
                        INSERT INTO suite_runs (
                            id, suite_id, project_id, name, status, progress, total_cases,
                            passed_cases, failed_cases, skipped_cases, started_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        ("suite-run-delete", suite["id"], project["id"], suite["name"], "queued", 0, 1, 0, 0, 0, timestamp),
                    )
                    conn.execute(
                        "INSERT INTO suite_run_cases (suite_run_id, case_id, status) VALUES (?, ?, ?)",
                        ("suite-run-delete", case_one["id"], "queued"),
                    )

                deleted = main.delete_test_case(case_one["id"])
                suite_after_single_delete = main.get_test_suite(suite["id"])
                remaining_cases = main.test_cases(project_id=project["id"])
                with main.get_db() as conn:
                    linked_deliverables = conn.execute("SELECT COUNT(*) AS total FROM deliverables WHERE case_id = ?", (case_one["id"],)).fetchone()["total"]
                    historical_run_cases = conn.execute("SELECT COUNT(*) AS total FROM suite_run_cases WHERE case_id = ?", (case_one["id"],)).fetchone()["total"]
                    tombstone_count = conn.execute(
                        "SELECT COUNT(*) AS total FROM deleted_test_cases WHERE project_id = ? AND external_id = ?",
                        (project["id"], "TC-DELETE-001"),
                    ).fetchone()["total"]
                    main.sync_test_cases_from_markdown(
                        conn,
                        project["id"],
                        "",
                        "| ID | 优先级 | 标题 |\n| --- | --- | --- |\n| TC-DELETE-001 | P0 | 单条删除用例复活来源 |\n",
                        asset_mode="append",
                    )

                self.assertEqual(deleted["deleted"], 1)
                self.assertNotIn(case_one["id"], {case["id"] for case in remaining_cases})
                self.assertEqual(suite_after_single_delete["caseIds"], [case_two["id"]])
                self.assertEqual(linked_deliverables, 1)
                self.assertEqual(historical_run_cases, 1)
                self.assertEqual(tombstone_count, 1)
                self.assertFalse(any(case["externalId"] == "TC-DELETE-001" for case in main.test_cases(project_id=project["id"])))

                with self.assertRaises(main.HTTPException) as empty_raised:
                    main.bulk_delete_test_cases(main.TestCaseBulkDeleteRequest(case_ids=[]))
                self.assertEqual(empty_raised.exception.status_code, 400)

                with self.assertRaises(main.HTTPException) as invalid_raised:
                    main.bulk_delete_test_cases(main.TestCaseBulkDeleteRequest(case_ids=[case_two["id"], "missing-case-id"]))
                self.assertEqual(invalid_raised.exception.status_code, 404)
                self.assertTrue(any(case["id"] == case_two["id"] for case in main.test_cases(project_id=project["id"])))

                bulk_deleted = main.bulk_delete_test_cases(main.TestCaseBulkDeleteRequest(case_ids=[case_two["id"], case_two["id"]]))
                self.assertEqual(bulk_deleted["deleted"], 1)
                self.assertEqual(bulk_deleted["ids"], [case_two["id"]])
                self.assertFalse(main.get_test_suite(suite["id"])["caseIds"])
                with main.get_db() as conn:
                    main.sync_test_cases_from_markdown(
                        conn,
                        project["id"],
                        "",
                        "| ID | 优先级 | 标题 |\n| --- | --- | --- |\n| TC-DELETE-002 | P1 | 批量删除用例复活来源 |\n",
                        asset_mode="append",
                    )
                self.assertFalse(any(case["externalId"] == "TC-DELETE-002" for case in main.test_cases(project_id=project["id"])))

                recreated = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-DELETE-002",
                        title="手动重建批量删除用例",
                    )
                )
                self.assertEqual(recreated["externalId"], "TC-DELETE-002")
                with main.get_db() as conn:
                    remaining_tombstones = conn.execute(
                        "SELECT COUNT(*) AS total FROM deleted_test_cases WHERE project_id = ? AND external_id = ?",
                        (project["id"], "TC-DELETE-002"),
                    ).fetchone()["total"]
                self.assertEqual(remaining_tombstones, 0)
            finally:
                main.DB_PATH = original_db_path

    async def test_delivery_report_returns_case_rows_including_cases_without_deliverables(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "交付报告")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证交付报告按用例展示，并包含尚未生成交付物的测试用例。",
                    )
                )
                markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-REPORT-001 | P0 | 有交付物用例 | 报表 | 已登录 | 打开报表 | 展示交付物 | 待自动化 |
| TC-REPORT-002 | P1 | 无交付物用例 | 报表 | 已登录 | 打开报表 | 展示待生成 | 待自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=markdown))
                case_rows = [case for case in main.test_cases(project_id=project["id"]) if case["workItemId"] == work["id"]]
                self.assertEqual(len(case_rows), 2)
                artifact_path = Path(directory) / "report-cases.md"
                artifact_path.write_text(markdown, encoding="utf-8")
                with main.get_db() as conn:
                    main.register_deliverable(
                        conn,
                        project["id"],
                        "test-cases",
                        "交付报告测试用例文档",
                        artifact_path,
                        work_item_id=work["id"],
                        case_id=case_rows[0]["id"],
                        status="ready",
                        summary="TC-REPORT-001 交付物",
                    )

                report = main.delivery_report(work_item_id=work["id"], page_size=20)
                returned_titles = {item["case"]["title"] for item in report["items"]}

                self.assertEqual(report["total"], 2)
                self.assertEqual(returned_titles, {"有交付物用例", "无交付物用例"})
                empty_case = next(item for item in report["items"] if item["case"]["title"] == "无交付物用例")
                self.assertFalse(empty_case["deliverableSummary"])
            finally:
                main.DB_PATH = original_db_path

    async def test_delivery_report_filters_by_keyword_and_deliverable_type(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "交付筛选")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证交付物类型筛选只返回已经绑定对应交付物的用例。",
                    )
                )
                markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-REPORT-TYPE-001 | P0 | 类型筛选命中 | 报表 | 已登录 | 查询脚本 | 仅返回命中项 | 待自动化 |
| TC-REPORT-TYPE-002 | P1 | 类型筛选未命中 | 报表 | 已登录 | 查询脚本 | 不返回未命中项 | 待自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=markdown))
                case_rows = {case["title"]: case for case in main.test_cases(project_id=project["id"]) if case["workItemId"] == work["id"]}
                spec_path = Path(directory) / "report-type.spec.ts"
                spec_path.write_text("import { test, expect } from '@playwright/test';\n", encoding="utf-8")
                with main.get_db() as conn:
                    main.register_deliverable(
                        conn,
                        project["id"],
                        "spec",
                        "类型筛选脚本交付物",
                        spec_path,
                        work_item_id=work["id"],
                        case_id=case_rows["类型筛选命中"]["id"],
                        status="ready",
                        summary="keyword-only-spec-deliverable",
                    )

                report = main.delivery_report(q="keyword-only-spec", deliverable_type="spec", page_size=20)

                self.assertEqual(report["total"], 1)
                self.assertEqual(report["items"][0]["case"]["title"], "类型筛选命中")
                self.assertIn("spec", report["items"][0]["deliverableSummary"])
            finally:
                main.DB_PATH = original_db_path

    async def test_delivery_report_summary_uses_full_filtered_result_not_page(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "交付汇总")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="验证交付报告汇总不受分页影响。",
                    )
                )
                markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SUMMARY-001 | P0 | 完整交付用例 | 报表 | 已登录 | 打开报表 | 展示交付物 | 待自动化 |
| TC-SUMMARY-002 | P1 | 缺人工报告用例 | 报表 | 已登录 | 打开报表 | 展示缺失 | 待自动化 |
| TC-SUMMARY-003 | P2 | 无交付物用例 | 报表 | 已登录 | 打开报表 | 展示缺失 | 待自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=markdown))
                case_rows = {case["title"]: case for case in main.test_cases(project_id=project["id"]) if case["workItemId"] == work["id"]}
                complete_paths = {
                    "test-cases": Path(directory) / "complete-test-cases.md",
                    "spec": Path(directory) / "complete.spec.ts",
                    "manual-report": Path(directory) / "complete-test-report.md",
                    "html-report": Path(directory) / "complete-index.html",
                }
                missing_manual_paths = {
                    "test-cases": Path(directory) / "missing-manual-test-cases.md",
                    "spec": Path(directory) / "missing-manual.spec.ts",
                    "html-report": Path(directory) / "missing-manual-index.html",
                }
                for deliverable_type, path in {**complete_paths, **missing_manual_paths}.items():
                    path.write_text(markdown if deliverable_type == "test-cases" else deliverable_type, encoding="utf-8")
                with main.get_db() as conn:
                    for deliverable_type, path in complete_paths.items():
                        main.register_deliverable(
                            conn,
                            project["id"],
                            deliverable_type,
                            f"完整交付 {deliverable_type}",
                            path,
                            work_item_id=work["id"],
                            case_id=case_rows["完整交付用例"]["id"],
                            status="ready",
                        )
                    for deliverable_type, path in missing_manual_paths.items():
                        main.register_deliverable(
                            conn,
                            project["id"],
                            deliverable_type,
                            f"缺人工报告 {deliverable_type}",
                            path,
                            work_item_id=work["id"],
                            case_id=case_rows["缺人工报告用例"]["id"],
                            status="ready",
                        )

                report = main.delivery_report(work_item_id=work["id"], page=1, page_size=1)

                self.assertEqual(report["total"], 3)
                self.assertEqual(len(report["items"]), 1)
                self.assertEqual(report["summary"]["total"], 3)
                self.assertEqual(report["summary"]["ready"], 1)
                self.assertEqual(report["summary"]["missing"], 2)
                self.assertEqual(report["summary"]["failedRisk"], 0)
                self.assertEqual(report["summary"]["missingByType"]["manual-report"], 2)
                self.assertEqual(report["summary"]["missingByType"]["test-cases"], 1)
                self.assertEqual(report["items"][0]["readiness"], "missing")
            finally:
                main.DB_PATH = original_db_path

    async def test_case_reports_use_latest_single_case_run_and_keep_cases_without_reports(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "CODEX_TEST_CASE_REPORTS")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="CODEX_TEST_CASE_REPORTS 验证单用例报告不回退到批量 Run。",
                    )
                )
                markdown = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-CASE-REPORT-001 | P0 | 有单用例报告 | 报告 | 已登录 | 执行 | 通过 | 自动化 |
| TC-CODEX-CASE-REPORT-002 | P1 | 只有批量报告 | 报告 | 已登录 | 执行 | 通过 | 自动化 |
"""
                main.generate_cases(work["id"], main.ContentRequest(content=markdown))
                case_rows = {
                    case["title"]: case
                    for case in main.platform.test_cases(project_id=project["id"])
                    if case["workItemId"] == work["id"]
                }
                with main.get_db() as conn:
                    for run_id, started_at, ended_at in [
                        ("run-codex-single", "2026-07-28T01:00:00+00:00", "2026-07-28T01:01:00+00:00"),
                        ("run-codex-batch", "2026-07-29T01:00:00+00:00", "2026-07-29T01:02:00+00:00"),
                    ]:
                        conn.execute(
                            """
                            INSERT INTO runs (
                                id, suite_id, suite_name, spec, status, stage_key, stage_label,
                                progress, started_at, ended_at, exit_code, report_path, screenshot_path, work_item_id
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                run_id,
                                run_id,
                                run_id,
                                "[]",
                                "passed",
                                "complete",
                                "完成",
                                100,
                                started_at,
                                ended_at,
                                0,
                                f"reports/{run_id}/index.html",
                                "",
                                work["id"],
                            ),
                        )
                    conn.execute(
                        "INSERT INTO run_script_versions (run_id, script_version_id, case_id, created_at) VALUES (?, ?, ?, ?)",
                        ("run-codex-single", "version-codex-single", case_rows["有单用例报告"]["id"], "2026-07-28T01:00:00+00:00"),
                    )
                    for index, case_id in enumerate([
                        case_rows["有单用例报告"]["id"],
                        case_rows["只有批量报告"]["id"],
                    ]):
                        conn.execute(
                            "INSERT INTO run_script_versions (run_id, script_version_id, case_id, created_at) VALUES (?, ?, ?, ?)",
                            ("run-codex-batch", f"version-codex-batch-{index}", case_id, "2026-07-29T01:00:00+00:00"),
                        )

                report = main.case_reports(work_item_id=work["id"], page_size=20)
                report_by_title = {item["case"]["title"]: item for item in report["items"]}

                self.assertEqual(report["total"], 2)
                self.assertEqual(report_by_title["有单用例报告"]["latestRun"]["id"], "run-codex-single")
                self.assertTrue(report_by_title["有单用例报告"]["reportAvailable"])
                self.assertIsNone(report_by_title["只有批量报告"]["latestRun"])
                self.assertFalse(report_by_title["只有批量报告"]["reportAvailable"])
                self.assertEqual(main.case_reports(work_item_id=work["id"], status="passed")["total"], 1)
                self.assertEqual(main.case_reports(work_item_id=work["id"], status="no_report")["total"], 1)
            finally:
                main.DB_PATH = original_db_path

    async def test_manual_reports_return_latest_report_per_work_item(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                feature = self.create_feature(project["id"], "CODEX_TEST_MANUAL_REPORTS")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=project["id"],
                        feature_id=feature["id"],
                        requirement="CODEX_TEST_MANUAL_REPORTS 验证人工报告按工单取最新版本。",
                    )
                )
                old_path = Path(directory) / "old-manual-report.md"
                new_path = Path(directory) / "new-manual-report.md"
                old_path.write_text("old", encoding="utf-8")
                new_path.write_text("new", encoding="utf-8")
                with main.get_db() as conn:
                    old_id = main.register_deliverable(
                        conn,
                        project["id"],
                        "manual-report",
                        "CODEX_TEST 旧人工报告",
                        old_path,
                        work_item_id=work["id"],
                        status="failed",
                        summary="旧版摘要",
                    )
                    new_id = main.register_deliverable(
                        conn,
                        project["id"],
                        "manual-report",
                        "CODEX_TEST 最新人工报告",
                        new_path,
                        work_item_id=work["id"],
                        status="passed",
                        summary="keyword-codex-latest-manual-report",
                    )
                    conn.execute("UPDATE deliverables SET updated_at = ?, version = 1 WHERE id = ?", ("2026-07-28T01:00:00+00:00", old_id))
                    conn.execute("UPDATE deliverables SET updated_at = ?, version = 2 WHERE id = ?", ("2026-07-29T01:00:00+00:00", new_id))

                report = main.manual_reports(project_id=project["id"], page_size=20)

                self.assertEqual(report["total"], 1)
                self.assertEqual(report["items"][0]["report"]["id"], new_id)
                self.assertEqual(report["items"][0]["report"]["version"], 2)
                self.assertEqual(main.manual_reports(work_item_id=work["id"])["total"], 1)
                self.assertEqual(main.manual_reports(work_item_id="missing-work-item")["total"], 0)
                self.assertEqual(main.manual_reports(q="keyword-codex-latest", status="passed")["total"], 1)
                self.assertEqual(main.manual_reports(status="failed")["total"], 0)
            finally:
                main.DB_PATH = original_db_path

    async def test_bulk_delete_case_reports_removes_report_artifact_but_keeps_run_evidence(self):
        original_db_path = main.DB_PATH
        original_root_dir = main.ROOT_DIR
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        original_report_index = main.REPORT_INDEX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.ROOT_DIR = root
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "automation-platform" / "playwright-reports"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_REPORT_DELETE_PROJECT")
                case_item = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project["id"],
                        external_id="TC-CODEX-REPORT-DELETE-001",
                        title="删除报告保留执行证据",
                    )
                )
                run_id = "run-codex-report-delete"
                report_index = main.run_html_report_index(run_id)
                report_index.parent.mkdir(parents=True, exist_ok=True)
                report_index.write_text("<html>CODEX_TEST_REPORT_DELETE</html>", encoding="utf-8")
                screenshot_path = root / "artifacts" / "screenshots" / "codex-report-delete.png"
                screenshot_path.parent.mkdir(parents=True, exist_ok=True)
                screenshot_path.write_bytes(b"codex-screenshot")
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    conn.execute(
                        """
                        INSERT INTO runs (
                            id, suite_id, suite_name, spec, status, stage_key, stage_label,
                            progress, started_at, ended_at, exit_code, report_path,
                            screenshot_path, work_item_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            run_id,
                            "suite-codex-report-delete",
                            "CODEX_TEST_REPORT_DELETE",
                            "tests/e2e/codex-report-delete.spec.ts",
                            "passed",
                            "complete",
                            "完成",
                            100,
                            timestamp,
                            timestamp,
                            0,
                            main.relative_or_absolute(report_index),
                            main.relative_or_absolute(screenshot_path),
                            "",
                        ),
                    )
                    conn.execute(
                        "INSERT INTO logs (run_id, created_at, level, message) VALUES (?, ?, ?, ?)",
                        (run_id, timestamp, "success", "CODEX_TEST_REPORT_DELETE 执行完成"),
                    )
                    conn.execute(
                        "INSERT INTO run_script_versions (run_id, script_version_id, case_id, created_at) VALUES (?, ?, ?, ?)",
                        (run_id, "version-codex-report-delete", case_item["id"], timestamp),
                    )
                    conn.execute(
                        """
                        INSERT INTO suite_runs (
                            id, suite_id, project_id, name, status, progress, total_cases,
                            passed_cases, failed_cases, skipped_cases, started_at, ended_at, report_path
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            "suite-run-codex-report-delete",
                            "suite-codex-report-delete",
                            project["id"],
                            "CODEX_TEST_REPORT_DELETE",
                            "passed",
                            100,
                            1,
                            1,
                            0,
                            0,
                            timestamp,
                            timestamp,
                            "",
                        ),
                    )
                    conn.execute(
                        "INSERT INTO suite_run_cases (suite_run_id, case_id, run_id, status, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)",
                        ("suite-run-codex-report-delete", case_item["id"], run_id, "passed", timestamp, timestamp),
                    )
                    deliverable_id = main.register_deliverable(
                        conn,
                        project["id"],
                        "html-report",
                        "CODEX_TEST_REPORT_DELETE HTML Report",
                        report_index,
                        case_id=case_item["id"],
                        run_id=run_id,
                    )

                result = main.bulk_delete_case_reports(
                    main.CaseReportBulkDeleteRequest(
                        items=[{"case_id": case_item["id"], "run_id": run_id}]
                    )
                )

                self.assertEqual(result["deleted"], 1)
                self.assertFalse(report_index.parent.exists())
                self.assertTrue(screenshot_path.exists())
                self.assertIsNone(main.case_reports()["items"][0]["latestRun"])
                self.assertEqual(main.case_reports(status="passed")["total"], 0)
                with main.get_db() as conn:
                    run_row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
                    self.assertIsNotNone(run_row)
                    self.assertEqual(run_row["report_path"], "")
                    self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM logs WHERE run_id = ?", (run_id,)).fetchone()["total"], 1)
                    self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM run_script_versions WHERE run_id = ?", (run_id,)).fetchone()["total"], 1)
                    self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM suite_run_cases WHERE run_id = ?", (run_id,)).fetchone()["total"], 1)
                    self.assertIsNotNone(conn.execute("SELECT * FROM test_cases WHERE id = ?", (case_item["id"],)).fetchone())
                    self.assertIsNone(conn.execute("SELECT * FROM deliverables WHERE id = ?", (deliverable_id,)).fetchone())
                    self.assertIsNotNone(conn.execute("SELECT * FROM audit_logs WHERE event_type = 'case_reports_bulk_deleted'").fetchone())
            finally:
                main.DB_PATH = original_db_path
                main.ROOT_DIR = original_root_dir
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir
                main.REPORT_INDEX = original_report_index

    async def test_bulk_delete_case_reports_rejects_active_run_without_partial_delete(self):
        original_db_path = main.DB_PATH
        original_root_dir = main.ROOT_DIR
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        original_report_index = main.REPORT_INDEX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.ROOT_DIR = root
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "automation-platform" / "playwright-reports"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_REPORT_DELETE_ATOMIC")
                cases = [
                    main.create_test_case(main.TestCaseRequest(project_id=project["id"], external_id=f"TC-CODEX-REPORT-ATOMIC-{index}", title=f"原子删除 {index}"))
                    for index in (1, 2)
                ]
                timestamp = main.now_iso()
                for case_item, status in zip(cases, ("passed", "running")):
                    run_id = f"run-codex-report-atomic-{status}"
                    report_index = main.run_html_report_index(run_id)
                    report_index.parent.mkdir(parents=True, exist_ok=True)
                    report_index.write_text(status, encoding="utf-8")
                    with main.get_db() as conn:
                        conn.execute(
                            "INSERT INTO runs (id, suite_id, suite_name, spec, status, stage_key, stage_label, progress, started_at, report_path, screenshot_path) VALUES (?, '', ?, '[]', ?, 'run', '执行', 50, ?, ?, '')",
                            (run_id, run_id, status, timestamp, main.relative_or_absolute(report_index)),
                        )
                        conn.execute(
                            "INSERT INTO run_script_versions (run_id, script_version_id, case_id, created_at) VALUES (?, ?, ?, ?)",
                            (run_id, f"version-{status}", case_item["id"], timestamp),
                        )

                payload = main.CaseReportBulkDeleteRequest(items=[
                    {"case_id": cases[0]["id"], "run_id": "run-codex-report-atomic-passed"},
                    {"case_id": cases[1]["id"], "run_id": "run-codex-report-atomic-running"},
                ])
                with self.assertRaises(main.HTTPException) as error:
                    main.bulk_delete_case_reports(payload)

                self.assertEqual(error.exception.status_code, 409)
                with main.get_db() as conn:
                    passed_run = conn.execute("SELECT report_path FROM runs WHERE id = 'run-codex-report-atomic-passed'").fetchone()
                    self.assertTrue(passed_run["report_path"])
                self.assertTrue(main.run_html_report_index("run-codex-report-atomic-passed").exists())
            finally:
                main.DB_PATH = original_db_path
                main.ROOT_DIR = original_root_dir
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir
                main.REPORT_INDEX = original_report_index

    async def test_bulk_delete_manual_reports_deletes_exclusive_file_and_preserves_shared_file(self):
        original_db_path = main.DB_PATH
        original_root_dir = main.ROOT_DIR
        original_project_artifact_dir = main.PROJECT_ARTIFACT_DIR
        original_report_index = main.REPORT_INDEX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.ROOT_DIR = root
            main.PROJECT_ARTIFACT_DIR = root / "artifacts" / "projects"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            try:
                main.init_db()
                project = self.create_project("CODEX_TEST_MANUAL_REPORT_DELETE")
                exclusive_path = main.PROJECT_ARTIFACT_DIR / project["id"] / "deliverables" / "manual" / "custom-summary.md"
                shared_path = main.PROJECT_ARTIFACT_DIR / project["id"] / "deliverables" / "manual" / "shared-summary.md"
                exclusive_path.parent.mkdir(parents=True, exist_ok=True)
                exclusive_path.write_text("exclusive", encoding="utf-8")
                shared_path.write_text("shared", encoding="utf-8")
                timestamp = main.now_iso()
                with main.get_db() as conn:
                    for work_id, report_path in (("work-exclusive", exclusive_path), ("work-shared", shared_path)):
                        conn.execute(
                            """
                            INSERT INTO work_items (
                                id, slug, title, requirement, stage, status, created_at, updated_at,
                                report_path, project_id, asset_mode
                            ) VALUES (?, ?, ?, ?, 'delivery', 'artifacts-saved', ?, ?, ?, ?, 'create')
                            """,
                            (work_id, work_id, work_id, work_id, timestamp, timestamp, main.relative_or_absolute(report_path), project["id"]),
                        )
                    exclusive_id = main.register_deliverable(
                        conn,
                        project["id"],
                        "manual-report",
                        "CODEX_TEST 独占工单总结报告",
                        exclusive_path,
                        work_item_id="work-exclusive",
                    )
                    shared_id = main.register_deliverable(
                        conn,
                        project["id"],
                        "manual-report",
                        "CODEX_TEST 共享工单总结报告",
                        shared_path,
                        work_item_id="work-shared",
                    )
                    main.register_deliverable(
                        conn,
                        project["id"],
                        "test-cases",
                        "CODEX_TEST 共享文件引用",
                        shared_path,
                    )

                with self.assertRaises(main.HTTPException) as missing_error:
                    main.bulk_delete_manual_reports(
                        main.ManualReportBulkDeleteRequest(report_ids=[exclusive_id, "missing-codex-report"])
                    )
                self.assertEqual(missing_error.exception.status_code, 404)
                self.assertTrue(exclusive_path.exists())

                result = main.bulk_delete_manual_reports(
                    main.ManualReportBulkDeleteRequest(report_ids=[exclusive_id, shared_id])
                )

                self.assertEqual(result["deleted"], 2)
                self.assertFalse(exclusive_path.exists())
                self.assertTrue(shared_path.exists())
                with main.get_db() as conn:
                    self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM deliverables WHERE id IN (?, ?)", (exclusive_id, shared_id)).fetchone()["total"], 0)
                    self.assertEqual(conn.execute("SELECT report_path FROM work_items WHERE id = 'work-exclusive'").fetchone()["report_path"], "")
                    self.assertEqual(conn.execute("SELECT report_path FROM work_items WHERE id = 'work-shared'").fetchone()["report_path"], "")
                    self.assertIsNotNone(conn.execute("SELECT * FROM audit_logs WHERE event_type = 'manual_reports_bulk_deleted'").fetchone())
            finally:
                main.DB_PATH = original_db_path
                main.ROOT_DIR = original_root_dir
                main.PROJECT_ARTIFACT_DIR = original_project_artifact_dir
                main.REPORT_INDEX = original_report_index

    async def test_html_report_deliverable_redirects_to_its_own_report_file(self):
        original_db_path = main.DB_PATH
        original_root_dir = main.ROOT_DIR
        original_report_archive_dir = main.PLAYWRIGHT_REPORT_ARCHIVE_DIR
        original_report_index = main.REPORT_INDEX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.DB_PATH = root / "test.sqlite"
            main.ROOT_DIR = root
            main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = root / "artifacts" / "automation-platform" / "playwright-reports"
            main.REPORT_INDEX = root / "playwright-report" / "index.html"
            try:
                main.init_db()
                project = self.create_project()
                report_index = main.run_html_report_index("run-own-report")
                report_index.parent.mkdir(parents=True, exist_ok=True)
                report_index.write_text("<html>own report</html>", encoding="utf-8")
                with main.get_db() as conn:
                    deliverable_id = main.register_deliverable(
                        conn,
                        project["id"],
                        "html-report",
                        "独立 HTML Report",
                        report_index,
                        run_id="run-own-report",
                    )

                response = main.rendered_deliverable_report(deliverable_id)
                expected_path = main.relative_or_absolute(report_index)

                self.assertEqual(response.status_code, 307)
                self.assertEqual(response.headers["location"], f"/reports/files/{expected_path}")
                self.assertTrue(main.is_report_file_path(report_index.resolve()))
            finally:
                main.DB_PATH = original_db_path
                main.ROOT_DIR = original_root_dir
                main.PLAYWRIGHT_REPORT_ARCHIVE_DIR = original_report_archive_dir
                main.REPORT_INDEX = original_report_index

    async def test_deliverables_can_expand_historical_spec_bound_case(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project = self.create_project()
                spec_path = Path(directory) / "historical.spec.ts"
                case_doc_path = Path(directory) / "historical-test-cases.md"
                spec_path.write_text("import { test, expect } from '@playwright/test';\ntest('historical', async () => {});\n", encoding="utf-8")
                case_doc_path.write_text("| ID | 优先级 | 标题 |\n| --- | --- | --- |\n| TC-HISTORICAL-001 | P0 | 历史脚本用例 |\n", encoding="utf-8")
                with main.get_db() as conn:
                    main.sync_test_cases_from_markdown(conn, project["id"], "", case_doc_path.read_text(encoding="utf-8"), str(spec_path))
                    main.register_deliverable(conn, project["id"], "spec", "historical.spec.ts", spec_path, summary="历史脚本", bump_version=False)
                    main.register_deliverable(conn, project["id"], "test-cases", "historical-test-cases.md", case_doc_path, summary="历史用例文档", bump_version=False)

                payload = main.deliverables(spec_path=str(spec_path), include_content=True)
                types = {item["type"] for item in payload}

                self.assertEqual(types, {"spec", "test-cases"})
                self.assertTrue(any("historical" in item["content"] for item in payload if item["type"] == "spec"))
            finally:
                main.DB_PATH = original_db_path

    async def test_project_crud_validates_code_status_type_and_delete_guards(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                self.assertEqual(main.projects(), [])

                created = main.create_project(
                    main.ProjectRequest(
                        name="交付项目台账",
                        project_type="delivery",
                        status="planning",
                        repository_path="/tmp/project",
                        test_dir="tests/e2e/project-crud",
                    )
                )

                self.assertRegex(created["projectCode"], r"^PRJ-\d{8}-\d{3}$")
                self.assertEqual(created["projectType"], "delivery")
                self.assertEqual(created["status"], "planning")

                linked_project = self.create_project("关联资产项目")
                self.assertRegex(linked_project["projectCode"], r"^PRJ-\d{8}-\d{3}$")
                self.assertEqual(linked_project["projectType"], "product")
                self.assertEqual(linked_project["status"], "active")

                updated = main.update_project(
                    created["id"],
                    main.ProjectPatchRequest(
                        project_code=" prj-custom-001 ",
                        name="产品项目台账",
                        project_type="product",
                        status="active",
                    ),
                )

                self.assertEqual(updated["projectCode"], "PRJ-CUSTOM-001")
                self.assertEqual(updated["name"], "产品项目台账")
                self.assertEqual(updated["projectType"], "product")
                self.assertEqual(updated["status"], "active")

                with self.assertRaises(main.HTTPException) as duplicate_code:
                    main.create_project(main.ProjectRequest(name="重复项目ID", project_code="PRJ-CUSTOM-001"))
                self.assertEqual(duplicate_code.exception.status_code, 400)

                with self.assertRaises(main.HTTPException) as invalid_type:
                    main.create_project(main.ProjectRequest(name="非法类型", project_type="service"))
                self.assertEqual(invalid_type.exception.status_code, 400)

                with self.assertRaises(main.HTTPException) as invalid_status:
                    main.update_project(created["id"], main.ProjectPatchRequest(status="deleted"))
                self.assertEqual(invalid_status.exception.status_code, 400)

                feature = self.create_feature(linked_project["id"], "项目删除保护")
                work = main.create_work_item(
                    main.WorkItemRequest(
                        project_id=linked_project["id"],
                        feature_id=feature["id"],
                        requirement="验证有关联需求工单的项目不能删除。",
                    )
                )
                self.assertTrue(work["id"])
                with self.assertRaises(main.HTTPException) as linked_delete:
                    main.delete_project(linked_project["id"])
                self.assertEqual(linked_delete.exception.status_code, 400)
                self.assertIn("项目下仍有关联资产", linked_delete.exception.detail)

                with main.get_db() as conn:
                    timestamp = main.now_iso()
                    conn.execute(
                        """
                        INSERT INTO projects (
                            id, slug, project_code, name, project_type, status,
                            target_url, repository_path, test_dir, description,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            main.DEFAULT_PROJECT_ID,
                            "legacy-default",
                            main.DEFAULT_PROJECT_CODE,
                            "历史默认项目",
                            "product",
                            "active",
                            "",
                            "",
                            "tests/e2e",
                            "",
                            timestamp,
                            timestamp,
                        ),
                    )
                legacy_deleted = main.delete_project(main.DEFAULT_PROJECT_ID)
                self.assertEqual(legacy_deleted["status"], "deleted")

                deleted = main.delete_project(created["id"])
                self.assertEqual(deleted["status"], "deleted")
                self.assertFalse(any(project["id"] == created["id"] for project in main.projects()))
            finally:
                main.DB_PATH = original_db_path

    async def test_test_cases_can_list_all_projects_or_single_project(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project_one = self.create_project("CODEX_TEST_PROJECT_ONE")
                project_two = self.create_project("CODEX_TEST_PROJECT_TWO")
                case_one = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project_one["id"],
                        external_id="TC-CODEX-LIST-001",
                        title="项目一用例",
                        priority="P0",
                    )
                )
                case_two = main.create_test_case(
                    main.TestCaseRequest(
                        project_id=project_two["id"],
                        external_id="TC-CODEX-LIST-002",
                        title="项目二用例",
                        priority="P1",
                    )
                )

                project_one_cases = main.test_cases(project_id=project_one["id"])
                all_cases = main.test_cases(project_id="all")
                default_cases = main.test_cases()

                self.assertEqual({case["id"] for case in project_one_cases}, {case_one["id"]})
                self.assertEqual({case["id"] for case in all_cases}, {case_one["id"], case_two["id"]})
                self.assertEqual({case["id"] for case in default_cases}, {case_one["id"], case_two["id"]})
            finally:
                main.DB_PATH = original_db_path

    async def test_suite_runs_filter_by_project_and_name_before_limit(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                project_one = self.create_project("CODEX_TEST_SUITE_QUERY_ONE")
                project_two = self.create_project("CODEX_TEST_SUITE_QUERY_TWO")

                def insert_suite_run(run_id: str, project_id: str, name: str, sequence: int) -> None:
                    with main.get_db() as conn:
                        conn.execute(
                            """
                            INSERT INTO suite_runs (
                                id, suite_id, project_id, name, status, progress, total_cases,
                                passed_cases, failed_cases, skipped_cases, started_at
                            ) VALUES (?, ?, ?, ?, 'passed', 100, 1, 1, 0, 0, ?)
                            """,
                            (run_id, "", project_id, name, f"2026-07-29T00:{sequence:02d}:00+00:00"),
                        )

                insert_suite_run("suite-query-alpha", project_one["id"], "CODEX Search Target Alpha", 0)
                insert_suite_run("suite-query-beta", project_two["id"], "CODEX search target Beta", 1)
                for index in range(2, 27):
                    insert_suite_run(
                        f"suite-query-recent-{index}",
                        project_one["id"],
                        f"CODEX 普通回归套件 {index}",
                        index,
                    )

                recent_all = main.platform.suite_runs(project_id="all")
                self.assertEqual(len(recent_all), 20)
                self.assertNotIn("suite-query-alpha", {item["id"] for item in recent_all})

                name_matches = main.platform.suite_runs(project_id="all", suite_name="  SEARCH TARGET ")
                self.assertEqual({item["id"] for item in name_matches}, {"suite-query-alpha", "suite-query-beta"})

                project_matches = main.platform.suite_runs(project_id=project_one["id"], suite_name="target")
                self.assertEqual([item["id"] for item in project_matches], ["suite-query-alpha"])
                self.assertEqual([item["id"] for item in main.platform.suite_runs(project_id=project_two["id"])], ["suite-query-beta"])

                for index in range(30, 52):
                    insert_suite_run(
                        f"suite-query-limit-{index}",
                        project_one["id"],
                        f"CODEX Limit Match {index}",
                        index,
                    )
                limited_matches = main.platform.suite_runs(project_id="all", suite_name="limit match")
                self.assertEqual(len(limited_matches), 20)
                self.assertEqual(limited_matches[0]["id"], "suite-query-limit-51")
                self.assertEqual(limited_matches[-1]["id"], "suite-query-limit-32")
            finally:
                main.DB_PATH = original_db_path

    async def test_project_scoped_writes_require_explicit_project(self):
        original_db_path = main.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DB_PATH = Path(directory) / "test.sqlite"
            try:
                main.init_db()
                self.assertEqual(main.feature_menus(), {"items": [], "tree": []})
                self.assertEqual(main.test_suites(), [])
                self.assertEqual(main.suite_runs(), [])

                requests = [
                    lambda: main.create_feature_menu(main.FeatureMenuRequest(name="缺少项目功能")),
                    lambda: main.create_test_case(main.TestCaseRequest(title="缺少项目用例")),
                    lambda: main.create_test_suite(main.SuiteRequest(name="缺少项目套件")),
                    lambda: main.create_deliverable(main.DeliverableRequest(type="manual-report", name="缺少项目交付物", content="content")),
                    lambda: main.create_work_item(main.WorkItemRequest(requirement="验证缺少项目时不能创建工单。")),
                ]
                for action in requests:
                    with self.assertRaises(main.HTTPException) as missing_project:
                        action()
                    self.assertEqual(missing_project.exception.status_code, 400)
                    self.assertIn("项目", missing_project.exception.detail)

                with self.assertRaises(main.HTTPException) as missing_flow_project:
                    await main.create_automation_flow(main.AutomationFlowRequest(requirement="验证缺少项目时不能启动全流程。"))
                self.assertEqual(missing_flow_project.exception.status_code, 400)
                self.assertIn("项目", missing_flow_project.exception.detail)
            finally:
                main.DB_PATH = original_db_path


class ManualStageAlignmentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.original_db_path = main.DB_PATH
        self.original_draft_dir = main.WORK_ITEM_DRAFT_DIR
        main.DB_PATH = self.root / "manual-stage-test.sqlite"
        main.WORK_ITEM_DRAFT_DIR = self.root / "tests" / "e2e" / ".draft-runs"
        main.init_db()

    async def asyncTearDown(self):
        main.DB_PATH = self.original_db_path
        main.WORK_ITEM_DRAFT_DIR = self.original_draft_dir
        self.tempdir.cleanup()

    def create_work_item(self, requirement: str = "CODEX_TEST_人工工作台登录验证"):
        project = main.create_project(main.ProjectRequest(name="CODEX_TEST_人工阶段对齐项目"))
        feature = main.create_feature_menu(main.FeatureMenuRequest(project_id=project["id"], name="CODEX_TEST_人工阶段对齐功能"))
        with patch.object(main.platform, "analyze_requirement_with_ai", return_value={}):
            return main.create_work_item(main.WorkItemRequest(
                project_id=project["id"],
                feature_id=feature["id"],
                requirement=requirement,
                target_url="https://example.test/login",
            ))

    async def collect_ndjson_events(self, response):
        text = ""
        async for chunk in response.body_iterator:
            text += chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
        return [json.loads(line) for line in text.splitlines() if line.strip()]

    def test_openai_and_deepseek_streams_share_delta_parser(self):
        response_events = SyncLineResponse([
            b'data: {"type":"response.output_text.delta","delta":"A"}\n',
            b'\n',
            b'data: [DONE]\n',
            b'\n',
        ])
        response_opener = RecordingOpener(response_events)
        with patch.object(main.platform.urllib.request, "build_opener", return_value=response_opener):
            response_chunks = list(main.iter_openai_stream_deltas(
                "test-key", "test-model", "https://example.test/v1", {"input": "test"}, timeout=60, provider="openai"
            ))

        chat_events = SyncLineResponse([
            b'data: {"choices":[{"delta":{"content":"B"}}]}\n',
            b'\n',
            b'data: [DONE]\n',
            b'\n',
        ])
        chat_opener = RecordingOpener(chat_events)
        with patch.object(main.platform.urllib.request, "build_opener", return_value=chat_opener):
            chat_chunks = list(main.iter_openai_stream_deltas(
                "test-key", "test-model", "https://api.deepseek.com/v1", {"input": "test"}, timeout=60, provider="deepseek"
            ))

        self.assertEqual(response_chunks, ["A"])
        self.assertEqual(chat_chunks, ["B"])
        self.assertEqual(response_opener.timeout, 60)
        self.assertEqual(chat_opener.timeout, 60)
        self.assertTrue(response_opener.request.full_url.endswith("/responses"))
        self.assertTrue(chat_opener.request.full_url.endswith("/chat/completions"))

    def test_automation_flow_stream_wrapper_keeps_artifact_deltas(self):
        with (
            patch.object(main.platform, "iter_openai_stream_deltas", return_value=iter(["A", "B"])),
            patch.object(main.platform, "append_flow_artifact_content") as append_artifact,
        ):
            content = main.call_openai_responses_stream(
                "test-key",
                "test-model",
                "https://example.test/v1",
                {"input": "test"},
                "artifact-codex-stream",
                timeout=18,
            )

        self.assertEqual(content, "AB")
        self.assertEqual(
            append_artifact.call_args_list,
            [
                call("artifact-codex-stream", "A"),
                call("artifact-codex-stream", "B"),
            ],
        )

    def test_manual_healing_stream_wrapper_does_not_require_artifact(self):
        with (
            patch.object(main.platform, "iter_openai_stream_deltas", return_value=iter(["A", "B"])),
            patch.object(main.platform, "append_flow_artifact_content") as append_artifact,
        ):
            content = main.call_openai_responses_stream(
                "test-key",
                "test-model",
                "https://example.test/v1",
                {"input": "test"},
                "",
                timeout=60,
            )

        self.assertEqual(content, "AB")
        append_artifact.assert_not_called()

    async def test_manual_healing_uses_streaming_generation_without_flow_artifact(self):
        with patch.object(
            main.platform,
            "stream_ai_healed_script",
            new=AsyncMock(return_value="healed script"),
        ) as stream_healing:
            result = await main.generate_healed_script({}, "current", {}, "failure", [], artifact_id="")

        self.assertEqual(result, "healed script")
        stream_healing.assert_awaited_once()
        self.assertEqual(stream_healing.call_args.args[5], "")

    def test_manual_healing_reports_ai_timeout_reason(self):
        with (
            patch.object(main.platform, "get_openai_api_key", return_value="test-key"),
            patch.object(main.platform, "get_openai_model", return_value="test-model"),
            patch.object(main.platform, "get_openai_base_url", return_value="https://example.test/v1"),
            patch.object(main.platform, "healed_script_prompt", return_value="test prompt"),
            patch.object(main.platform, "call_openai_responses_stream", side_effect=TimeoutError) as ai_call,
        ):
            with self.assertRaisesRegex(main.platform.HealingScriptGenerationError, "AI 生成修复脚本失败：连接超时"):
                main.stream_ai_healed_script_sync({}, "current", {}, "failure", [], "")

        self.assertEqual(ai_call.call_args.kwargs["timeout"], 60)

    async def test_case_stream_emits_deltas_then_persists_completed_content(self):
        work = self.create_work_item("CODEX_TEST_人工用例流式成功")
        generated = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-STREAM-001 | P0 | 流式生成成功 | CODEX_TEST_人工用例流式成功 | 页面可访问 | 打开页面；等待页面加载完成 | 页面可见 | 自动化 |
"""
        chunks = [generated[:80], generated[80:]]
        config = {"provider": "openai", "api_key": "test-key", "model": "test-model", "base_url": "https://example.test/v1"}

        with (
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "iter_openai_stream_deltas", return_value=iter(chunks)) as stream_call,
        ):
            response = main.stream_generated_cases(work["id"], main.ContentRequest(content=""))
            events = await self.collect_ndjson_events(response)

        stream_call.assert_called_once()
        self.assertEqual(stream_call.call_args.kwargs["timeout"], 60)
        self.assertEqual([event["type"] for event in events], ["start", "delta", "delta", "complete"])
        self.assertEqual(events[-1]["source"], "ai")
        self.assertIn("流式生成成功", main.get_work_item(work["id"])["casesMarkdown"])

    async def test_case_stream_timeout_reports_and_persists_fallback(self):
        work = self.create_work_item("CODEX_TEST_人工用例流式超时")
        config = {"provider": "deepseek", "api_key": "test-key", "model": "test-model", "base_url": "https://api.deepseek.com/v1"}

        with (
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "iter_openai_stream_deltas", side_effect=TimeoutError()),
        ):
            response = main.stream_generated_cases(work["id"], main.ContentRequest(content=""))
            events = await self.collect_ndjson_events(response)

        event_types = [event["type"] for event in events]
        self.assertEqual(event_types, ["start", "fallback", "complete"])
        self.assertIn("连接超时", events[1]["reason"])
        self.assertEqual(events[-1]["source"], "fallback")
        self.assertNotIn("冒烟主流程满足已明确验收标准", main.get_work_item(work["id"])["casesMarkdown"])
        self.assertIn("CODEX", main.get_work_item(work["id"])["casesMarkdown"])

    async def test_script_stream_validates_coverage_before_persisting(self):
        work = self.create_work_item("CODEX_TEST_人工脚本流式成功")
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-SCRIPT-STREAM-001 | P0 | 页面可见 | 页面访问 | 页面可访问 | 打开页面 | 主区域可见 | 自动化 |
"""
        item = main.generate_cases(work["id"], main.ContentRequest(content=cases))
        case_id = item["testCases"][0]["externalId"]
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source, confirmed
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (work["id"], "main", "主区域", "testid", "main-panel", "CODEX_TEST", 1),
            )
        config = {"provider": "openai", "api_key": "test-key", "model": "test-model", "base_url": "https://example.test/v1"}

        def script_stream(*args, **kwargs):
            prompt = args[3]["input"]
            fixture_start = prompt.index("../fixtures/")
            fixture_import = prompt[fixture_start:prompt.index("'", fixture_start)]
            generated_script = f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{fixture_import}';
test('{case_id} 页面可见', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{
    await page.goto(TARGET_URL);
  }});
  await runStep('验证主区域', async () => {{
    await expect(page.locator('[data-testid="main-panel"]')).toBeVisible();
  }});
}});
"""
            return iter([generated_script])

        with (
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "iter_openai_stream_deltas", side_effect=script_stream),
        ):
            response = main.stream_generated_script(work["id"], main.ContentRequest(content=""))
            events = await self.collect_ndjson_events(response)

        self.assertEqual([event["type"] for event in events], ["start", "case-start", "delta", "case-complete", "complete"])
        self.assertEqual(events[-1]["source"], "ai")
        self.assertIn(case_id, main.get_work_item(work["id"])["scriptContent"])

    async def test_script_stream_generates_cases_sequentially_and_persists_each_completion(self):
        work = self.create_work_item("CODEX_TEST_人工脚本逐用例串行生成")
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-SERIAL-001 | P0 | 主区域可见 | 页面访问 | 页面可访问 | 打开页面 | 主区域可见 | 自动化 |
| TC-CODEX-SERIAL-002 | P1 | 次区域可见 | 页面访问 | 页面可访问 | 打开页面 | 次区域可见 | 自动化 |
"""
        item = main.generate_cases(work["id"], main.ContentRequest(content=cases))
        external_ids = [case["externalId"] for case in item["testCases"]]
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source, confirmed
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (work["id"], "main", "主区域", "testid", "main-panel", "CODEX_TEST", 1),
            )
        config = {"provider": "openai", "api_key": "test-key", "model": "test-model", "base_url": "https://example.test/v1"}
        call_order = []

        def script_stream(*args, **kwargs):
            prompt = args[3]["input"]
            external_id = next(case_id for case_id in external_ids if case_id in prompt)
            if call_order:
                with main.get_db() as conn:
                    persisted = conn.execute(
                        "SELECT COUNT(*) AS total FROM generated_scripts WHERE work_item_id = ?",
                        (work["id"],),
                    ).fetchone()["total"]
                self.assertEqual(persisted, len(call_order))
            call_order.append(external_id)
            fixture_start = prompt.index("../fixtures/")
            fixture_import = prompt[fixture_start:prompt.index("'", fixture_start)]
            script = f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{fixture_import}';
test('{external_id} 页面区域可见', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{ await page.goto(TARGET_URL); }});
  await runStep('验证区域', async () => {{ await expect(page.locator('[data-testid="main-panel"]')).toBeVisible(); }});
}});
"""
            midpoint = len(script) // 2
            return iter([script[:midpoint], script[midpoint:]])

        with (
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "iter_openai_stream_deltas", side_effect=script_stream),
        ):
            response = main.stream_generated_script(work["id"], main.ContentRequest(content=""))
            events = await self.collect_ndjson_events(response)

        self.assertEqual(call_order, external_ids)
        self.assertEqual(
            [event["type"] for event in events],
            [
                "start",
                "case-start", "delta", "delta", "case-complete",
                "case-start", "delta", "delta", "case-complete",
                "complete",
            ],
        )
        self.assertEqual(events[0]["total"], 2)
        self.assertEqual(events[-1]["successfulCaseIds"], item["caseIds"])
        self.assertFalse(events[-1]["failedCases"])
        self.assertEqual(len(main.get_work_item(work["id"])["scriptVersions"]), 2)

    async def test_script_stream_continues_after_case_failure(self):
        work = self.create_work_item("CODEX_TEST_人工脚本失败续跑")
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-CONTINUE-001 | P0 | 第一条失败 | 页面访问 | 页面可访问 | 打开页面 | 主区域可见 | 自动化 |
| TC-CODEX-CONTINUE-002 | P1 | 第二条继续 | 页面访问 | 页面可访问 | 打开页面 | 主区域可见 | 自动化 |
"""
        item = main.generate_cases(work["id"], main.ContentRequest(content=cases))
        first_case_id = item["caseIds"][0]
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source, confirmed
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (work["id"], "main", "主区域", "testid", "main-panel", "CODEX_TEST", 1),
            )
        original_persist = main.persist_generated_case_script

        def persist_with_first_failure(context, case_row, content):
            if case_row["id"] == first_case_id:
                raise main.HTTPException(status_code=400, detail="CODEX_TEST 首条模拟失败")
            return original_persist(context, case_row, content)

        config = {"provider": "openai", "api_key": "", "model": "test-model", "base_url": "https://example.test/v1"}
        with (
            patch.object(main.platform, "ai_runtime_config", return_value=config),
            patch.object(main.platform, "persist_generated_case_script", side_effect=persist_with_first_failure),
        ):
            response = main.stream_generated_script(work["id"], main.ContentRequest(content=""))
            events = await self.collect_ndjson_events(response)

        event_types = [event["type"] for event in events]
        self.assertEqual(event_types.count("case-error"), 1)
        self.assertEqual(event_types.count("case-complete"), 1)
        self.assertEqual(events[-1]["failedCases"][0]["caseId"], first_case_id)
        self.assertEqual(events[-1]["successfulCaseIds"], [item["caseIds"][1]])

    def test_single_case_generation_preserves_all_work_item_case_bindings(self):
        work = self.create_work_item("CODEX_TEST_人工脚本子集生成保留绑定")
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-BINDING-001 | P0 | 第一条 | 页面访问 | 页面可访问 | 打开页面 | 主区域可见 | 自动化 |
| TC-CODEX-BINDING-002 | P1 | 第二条 | 页面访问 | 页面可访问 | 打开页面 | 主区域可见 | 自动化 |
"""
        item = main.generate_cases(work["id"], main.ContentRequest(content=cases))
        target_case_id = item["caseIds"][0]
        target_external_id = item["testCases"][0]["externalId"]
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source, confirmed
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (work["id"], "main", "主区域", "testid", "main-panel", "CODEX_TEST", 1),
            )

        def generate_single(item_row, elements, cases_markdown, fixture_import):
            return f"""import {{ expect, test }} from '@playwright/test';
import {{ TARGET_URL, runStep }} from '{fixture_import}';
test('{target_external_id} 页面可见', async ({{ page }}) => {{
  await runStep('打开页面', async () => {{ await page.goto(TARGET_URL); }});
  await runStep('验证区域', async () => {{ await expect(page.locator('[data-testid="main-panel"]')).toBeVisible(); }});
}});
"""

        with patch.object(main.platform, "ai_playwright_script", side_effect=generate_single):
            result = main.generate_script(
                work["id"],
                main.ContentRequest(content="", case_ids=[target_case_id]),
            )

        self.assertEqual(result["caseIds"], item["caseIds"])
        self.assertEqual([version["caseId"] for version in result["scriptVersions"]], [target_case_id])

    def test_empty_cases_content_uses_ai_and_shared_policy_filter(self):
        work = self.create_work_item()
        generated = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-MANUAL-001 | P0 | 登录成功 | 登录主流程 | 有效账号 | 输入账号密码并提交 | 进入首页 | 自动化 |
| TC-CODEX-MANUAL-002 | P1 | 连续失败锁定账号 | 登录安全策略 | 有效账号 | 连续输错密码 | 账号锁定 | 自动化 |
"""

        with patch.object(main.platform, "ai_test_cases", return_value=generated) as ai_generate:
            item = main.generate_cases(work["id"], main.ContentRequest(content=""))

        ai_generate.assert_called_once()
        self.assertIn("登录成功", item["casesMarkdown"])
        saved_titles = [case["title"] for case in main.parse_cases_markdown(item["casesMarkdown"])]
        self.assertNotIn("连续失败锁定账号", saved_titles)
        self.assertIn("需业务规则确认", item["casesMarkdown"])

    def test_empty_cases_content_falls_back_without_ai(self):
        work = self.create_work_item("CODEX_TEST_人工工作台普通页面验证")

        with patch.object(main.platform, "ai_test_cases", return_value=""):
            item = main.generate_cases(work["id"], main.ContentRequest(content=""))

        self.assertIn("冒烟主流程满足已明确验收标准", item["casesMarkdown"])
        self.assertEqual(item["status"], "cases-ready")

    def test_manual_cases_content_requires_valid_markdown_table(self):
        work = self.create_work_item()

        with self.assertRaises(main.HTTPException) as invalid:
            main.generate_cases(work["id"], main.ContentRequest(content="不是 Markdown 用例表格"))

        self.assertEqual(invalid.exception.status_code, 400)
        self.assertIn("测试用例格式无效", invalid.exception.detail)

    def test_manual_case_save_deletes_bound_case_and_suite_link_transactionally(self):
        work = self.create_work_item("CODEX_TEST_结构化编辑保存删除")
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-STRUCTURED-001 | P0 | 保留用例 | 主流程 | 页面可访问 | 打开页面 | 页面可见 | 自动化 |
| TC-CODEX-STRUCTURED-002 | P1 | 删除用例 | 异常流程 | 页面可访问 | 执行异常操作 | 展示错误 | 自动化 |
"""
        item = main.generate_cases(work["id"], main.ContentRequest(content=cases))
        keep_case = next(case for case in item["testCases"] if case["title"] == "保留用例")
        delete_case = next(case for case in item["testCases"] if case["title"] == "删除用例")
        suite = main.create_test_suite(main.SuiteRequest(project_id=item["projectId"], name="CODEX_TEST_结构化删除套件"))
        main.update_test_suite_cases(suite["id"], main.SuiteCaseUpdateRequest(case_ids=[keep_case["id"], delete_case["id"]]))
        remaining_markdown = "\n".join(
            line for line in item["casesMarkdown"].splitlines() if delete_case["externalId"] not in line
        )

        result = main.generate_cases(
            work["id"],
            main.ContentRequest(
                content=remaining_markdown,
                asset_mode="create",
                case_ids=[keep_case["id"]],
                deleted_case_ids=[delete_case["id"]],
            ),
        )

        self.assertEqual(result["caseIds"], [keep_case["id"]])
        self.assertEqual([case["id"] for case in result["testCases"]], [keep_case["id"]])
        self.assertEqual(main.get_test_suite(suite["id"])["caseIds"], [keep_case["id"]])
        with main.get_db() as conn:
            self.assertIsNone(conn.execute("SELECT id FROM test_cases WHERE id = ?", (delete_case["id"],)).fetchone())
            self.assertIsNotNone(conn.execute(
                "SELECT id FROM deleted_test_cases WHERE project_id = ? AND external_id = ?",
                (item["projectId"], delete_case["externalId"]),
            ).fetchone())

    def test_manual_case_save_rejects_cross_work_item_delete_without_writes(self):
        work = self.create_work_item("CODEX_TEST_结构化编辑非法删除来源")
        other_work = self.create_work_item("CODEX_TEST_结构化编辑非法删除目标")
        cases = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| TC-CODEX-SCOPE-001 | P0 | 当前工单用例 |
"""
        other_cases = """| ID | 优先级 | 标题 |
| --- | --- | --- |
| TC-CODEX-SCOPE-002 | P0 | 其他工单用例 |
"""
        item = main.generate_cases(work["id"], main.ContentRequest(content=cases))
        other_item = main.generate_cases(other_work["id"], main.ContentRequest(content=other_cases))
        with main.get_db() as conn:
            version_count_before = conn.execute(
                "SELECT COUNT(*) AS total FROM generated_cases WHERE work_item_id = ?",
                (work["id"],),
            ).fetchone()["total"]

        with self.assertRaises(main.HTTPException) as raised:
            main.generate_cases(
                work["id"],
                main.ContentRequest(
                    content=item["casesMarkdown"],
                    case_ids=item["caseIds"],
                    deleted_case_ids=other_item["caseIds"],
                ),
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("不属于当前工单绑定", raised.exception.detail)
        with main.get_db() as conn:
            version_count_after = conn.execute(
                "SELECT COUNT(*) AS total FROM generated_cases WHERE work_item_id = ?",
                (work["id"],),
            ).fetchone()["total"]
            self.assertEqual(version_count_after, version_count_before)
            self.assertIsNotNone(conn.execute("SELECT id FROM test_cases WHERE id = ?", (other_item["caseIds"][0],)).fetchone())

    def test_empty_script_content_uses_shared_ai_generator(self):
        work = self.create_work_item("CODEX_TEST_人工工作台脚本生成")
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-SCRIPT-001 | P0 | 页面可见 | 页面访问 | 页面可访问 | 打开页面 | 主区域可见 | 自动化 |
"""
        item = main.generate_cases(work["id"], main.ContentRequest(content=cases))
        case_id = item["testCases"][0]["externalId"]
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source, confirmed
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (work["id"], "main", "主区域", "testid", "main-panel", "CODEX_TEST", 1),
            )
        generated_script = f"""import {{ expect, test }} from '@playwright/test';
test('{case_id} 页面可见', async ({{ page }}) => {{
  await page.goto('https://example.test/login');
  await expect(page.locator('[data-testid="main-panel"]')).toBeVisible();
}});
"""

        with patch.object(main.platform, "ai_playwright_script", return_value=generated_script) as ai_generate:
            result = main.generate_script(work["id"], main.ContentRequest(content=""))

        ai_generate.assert_called_once()
        self.assertIn(case_id, result["scriptContent"])
        self.assertEqual(result["status"], "script-ready")

    def test_empty_script_content_falls_back_without_ai(self):
        work = self.create_work_item("CODEX_TEST_人工工作台脚本规则兜底")
        cases = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-SCRIPT-FALLBACK-001 | P0 | 页面可见 | 页面访问 | 页面可访问 | 打开页面 | 主区域可见 | 自动化 |
"""
        item = main.generate_cases(work["id"], main.ContentRequest(content=cases))
        case_id = item["testCases"][0]["externalId"]
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO confirmed_elements (
                    work_item_id, area, name, locator_type, locator_value, source, confirmed
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (work["id"], "main", "主区域", "testid", "main-panel", "CODEX_TEST", 1),
            )

        with patch.object(main.platform, "ai_playwright_script", return_value=""):
            result = main.generate_script(work["id"], main.ContentRequest(content=""))

        self.assertIn(case_id, result["scriptContent"])
        self.assertIn("test(", result["scriptContent"])
        self.assertIn("expect(", result["scriptContent"])

    def test_exploration_payload_adds_read_only_recommendations(self):
        work = self.create_work_item()
        result = {
            "notes": "CODEX_TEST 推荐确认",
            "resolved_elements": [
                {"name": "用户名", "locatorType": "testid", "locatorValue": "username", "confidence": 98, "matchCount": 1, "autoConfirmEligible": True},
            ],
            "elements": [
                {"name": "用户名", "locatorType": "testid", "locatorValue": "username", "confirmed": False},
                {"name": "说明文本", "locatorType": "text", "locatorValue": "普通说明", "confirmed": False},
            ],
        }
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO exploration_runs (
                    id, work_item_id, target_url, status, stage_key, stage_label,
                    progress, started_at, result_json, plan_json, result_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "explore-codex-recommend",
                    work["id"],
                    "https://example.test/login",
                    "passed",
                    "complete",
                    "完成",
                    100,
                    main.now_iso(),
                    json.dumps(result, ensure_ascii=False),
                    "[]",
                    "passed",
                ),
            )

        payload = main.get_exploration_run("explore-codex-recommend")

        self.assertEqual(payload["recommendedConfirmationCount"], 1)
        self.assertTrue(payload["result"]["elements"][0]["recommended"])
        self.assertFalse(payload["result"]["elements"][1]["recommended"])
        self.assertFalse(payload["result"]["elements"][0]["confirmed"])

    async def test_manual_run_returns_while_shared_draft_runner_continues_in_background(self):
        run_id = "run-codex-shared"
        suite = {"id": "suite-codex-shared", "name": "CODEX_TEST shared run"}
        returned_item = {
            "id": "work-codex-shared",
            "latestRunId": run_id,
            "latestRun": {"id": run_id, "status": "running"},
        }
        execution_gate = asyncio.Event()

        async def execute_run(*args):
            await execution_gate.wait()
            return {"id": run_id, "status": "passed"}

        with (
            patch.object(
                main.platform,
                "create_work_item_draft_run",
                new=AsyncMock(return_value=(run_id, suite, "script-version-codex-shared")),
            ) as create_run,
            patch.object(main.platform, "execute_work_item_draft_run", new=AsyncMock(side_effect=execute_run)) as execute_run_mock,
            patch.object(main.platform, "write_audit_log") as audit_log,
            patch.object(main.platform, "get_work_item", return_value=returned_item),
        ):
            result = await main.run_work_item(returned_item["id"])
            create_run.assert_awaited_once_with(returned_item["id"])
            self.assertEqual(result["latestRun"]["status"], "running")
            self.assertFalse(execution_gate.is_set())
            await asyncio.sleep(0)
            execute_run_mock.assert_awaited_once_with(
                run_id,
                suite,
                returned_item["id"],
                "script-version-codex-shared",
            )
            execution_gate.set()
            await asyncio.sleep(0)

        audit_log.assert_called_once()
        self.assertEqual(result, returned_item)

    async def test_shared_draft_runner_still_waits_for_execution_completion(self):
        run_id = "run-codex-awaited"
        suite = {"id": "suite-codex-awaited", "name": "CODEX_TEST awaited run"}
        completed_run = {"id": run_id, "status": "passed"}
        on_run_created = Mock()

        async def execute_after_exposure(*args):
            on_run_created.assert_called_once_with(run_id)
            return completed_run

        with (
            patch.object(
                main.platform,
                "create_work_item_draft_run",
                new=AsyncMock(return_value=(run_id, suite, "script-version-codex-awaited")),
            ) as create_run,
            patch.object(
                main.platform,
                "execute_work_item_draft_run",
                new=AsyncMock(side_effect=execute_after_exposure),
            ) as execute_run,
        ):
            result = await main.run_work_item_draft_once(
                "work-codex-awaited",
                "flow-codex-awaited",
                on_run_created=on_run_created,
            )

        create_run.assert_awaited_once_with("work-codex-awaited", "flow-codex-awaited")
        execute_run.assert_awaited_once_with(
            run_id,
            suite,
            "work-codex-awaited",
            "script-version-codex-awaited",
        )
        on_run_created.assert_called_once_with(run_id)
        self.assertEqual(result, completed_run)


class AuthApiTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = main.DB_PATH
        self.tempdir = tempfile.TemporaryDirectory()
        main.DB_PATH = Path(self.tempdir.name) / "auth-test.sqlite"
        main.init_db()
        with main.get_db() as conn:
            self.admin_row = conn.execute("SELECT * FROM users WHERE username = ?", ("admin",)).fetchone()

    def tearDown(self):
        main.DB_PATH = self.original_db_path
        self.tempdir.cleanup()

    def admin_request(self):
        request = SimpleNamespace()
        request.state = SimpleNamespace(user=main.row_to_user(self.admin_row))
        return request

    def test_default_admin_password_hash_verifies(self):
        with main.get_db() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", ("admin",)).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["role"], "admin")
        self.assertEqual(row["status"], "active")
        self.assertTrue(main.verify_password(os.environ["QA_BOOTSTRAP_ADMIN_PASSWORD"], row["password_hash"]))

    def test_new_database_requires_bootstrap_admin_password(self):
        with main.get_db() as conn:
            conn.execute("DELETE FROM users WHERE username = ?", ("admin",))
        with patch.dict(os.environ, {"QA_BOOTSTRAP_ADMIN_PASSWORD": ""}):
            with self.assertRaises(RuntimeError) as raised:
                main.init_db()
        self.assertIn("QA_BOOTSTRAP_ADMIN_PASSWORD", str(raised.exception))

    def test_existing_admin_does_not_require_bootstrap_password(self):
        with patch.dict(os.environ, {"QA_BOOTSTRAP_ADMIN_PASSWORD": ""}):
            main.init_db()

    def test_session_token_returns_user_with_account_status(self):
        _, token = main.create_session(self.admin_row["id"])

        user = main.user_from_session_token(token, refresh=False)

        self.assertIsNotNone(user)
        self.assertEqual(user["id"], self.admin_row["id"])
        self.assertEqual(user["status"], "active")

    def test_registration_requires_admin_approval_before_login(self):
        registered = main.register(main.RegisterRequest(username="tester1", display_name="测试同学", password="abc12345"))
        self.assertEqual(registered["status"], "pending")
        with main.get_db() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", ("tester1",)).fetchone()
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["role"], "viewer")
        self.assertTrue(main.verify_password("abc12345", row["password_hash"]))

    def test_admin_can_create_user_with_active_status(self):
        created = main.create_user(
            main.UserCreateRequest(
                username="New.User",
                display_name="新同学",
                password="abc12345",
                role="viewer",
                status="active",
            ),
            self.admin_request(),
        )

        self.assertEqual(created["username"], "new.user")
        self.assertEqual(created["displayName"], "新同学")
        self.assertEqual(created["role"], "viewer")
        self.assertEqual(created["status"], "active")
        with main.get_db() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (created["id"],)).fetchone()
        self.assertTrue(main.verify_password("abc12345", row["password_hash"]))

    def test_admin_create_user_rejects_duplicate_username(self):
        payload = main.UserCreateRequest(username="duplicate", password="abc12345")
        main.create_user(payload, self.admin_request())

        with self.assertRaises(main.HTTPException) as duplicate:
            main.create_user(payload, self.admin_request())

        self.assertEqual(duplicate.exception.status_code, 400)
        self.assertIn("账号已存在", duplicate.exception.detail)

    def test_admin_can_update_user_profile_role_and_status(self):
        created = main.create_user(main.UserCreateRequest(username="editor1", password="abc12345"), self.admin_request())

        updated = main.update_user(
            created["id"],
            main.UserPatchRequest(display_name="编辑后", role="executor", status="disabled"),
            self.admin_request(),
        )

        self.assertEqual(updated["displayName"], "编辑后")
        self.assertEqual(updated["role"], "executor")
        self.assertEqual(updated["status"], "disabled")

    def test_disabling_user_clears_sessions(self):
        created = main.create_user(main.UserCreateRequest(username="session-user", password="abc12345"), self.admin_request())
        main.create_session(created["id"])

        main.update_user(created["id"], main.UserPatchRequest(status="disabled"), self.admin_request())

        with main.get_db() as conn:
            sessions = conn.execute("SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = ?", (created["id"],)).fetchone()
        self.assertEqual(sessions["count"], 0)

    def test_admin_can_delete_user_and_clear_sessions(self):
        created = main.create_user(main.UserCreateRequest(username="delete-me", password="abc12345"), self.admin_request())
        main.create_session(created["id"])

        deleted = main.delete_user(created["id"], self.admin_request())

        self.assertEqual(deleted, {"status": "deleted", "id": created["id"]})
        with main.get_db() as conn:
            user = conn.execute("SELECT * FROM users WHERE id = ?", (created["id"],)).fetchone()
            sessions = conn.execute("SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = ?", (created["id"],)).fetchone()
        self.assertIsNone(user)
        self.assertEqual(sessions["count"], 0)

    def test_default_admin_is_protected_from_dangerous_changes(self):
        admin_id = self.admin_row["id"]

        with self.assertRaises(main.HTTPException) as disabled:
            main.update_user(admin_id, main.UserPatchRequest(status="disabled"), self.admin_request())
        with self.assertRaises(main.HTTPException) as downgraded:
            main.update_user(admin_id, main.UserPatchRequest(role="viewer"), self.admin_request())
        with self.assertRaises(main.HTTPException) as deleted:
            main.delete_user(admin_id, self.admin_request())

        self.assertEqual(disabled.exception.status_code, 400)
        self.assertEqual(downgraded.exception.status_code, 400)
        self.assertEqual(deleted.exception.status_code, 400)

    def test_permission_matrix_blocks_viewer_mutations_and_ai_secret(self):
        self.assertEqual(main.path_permission("/api/projects", "POST"), {"admin", "lead"})
        self.assertNotIn("viewer", main.path_permission("/api/projects", "POST"))
        self.assertNotIn("executor", main.path_permission("/api/test-cases/bulk-delete", "POST"))
        self.assertEqual(main.path_permission("/api/ai-config/profile-1/secret", "GET"), {"admin"})
        self.assertIn("executor", main.path_permission("/api/work-items/abc/run", "POST"))
        self.assertEqual(main.path_permission("/api/work-items/abc/save-artifacts", "POST"), {"admin", "lead"})
        self.assertEqual(main.path_permission("/api/suite-runs/suite-run-1", "DELETE"), {"admin", "lead", "executor"})
        self.assertNotIn("viewer", main.path_permission("/api/suite-runs/suite-run-1", "DELETE"))

    def test_auth_failure_response_includes_cors_for_allowed_origin(self):
        request = main.Request({
            "type": "http",
            "method": "GET",
            "path": "/api/projects",
            "headers": [(b"origin", b"http://127.0.0.1:5174")],
        })

        response = main.json_auth_response(request, {"detail": "请先登录"}, 401)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:5174")
        self.assertEqual(response.headers["access-control-allow-credentials"], "true")
        self.assertIn("Origin", response.headers["vary"])

    def test_options_requests_are_allowed_without_auth_for_cors_preflight(self):
        self.assertTrue(main.route_allowed_without_auth("/api/projects", "OPTIONS"))


class AutomationDataDiscoveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_db_path = main.DB_PATH
        self.tempdir = tempfile.TemporaryDirectory()
        main.DB_PATH = Path(self.tempdir.name) / "automation-data-discovery.sqlite"
        main.init_db()
        self.project = main.create_project(main.ProjectRequest(
            name="CODEX_TEST_DATA_DISCOVERY",
            project_type="product",
            status="active",
        ))
        self.feature = main.create_feature_menu(main.FeatureMenuRequest(
            project_id=self.project["id"],
            name="数据自发现",
        ))

    def tearDown(self):
        main.DB_PATH = self.original_db_path
        self.tempdir.cleanup()

    def preflight(self, *, password=False):
        return {
            "requested_url": "https://skillhub.test/#/rank",
            "title": "SkillHub",
            "final_url": "https://skillhub.test/#/rank",
            "screenshot_path": "/tmp/CODEX_TEST_DATA_DISCOVERY.png",
            "structure": {
                "title": "SkillHub",
                "url": "https://skillhub.test/#/rank",
                "headings": ["排行榜", "贡献者榜", "部门分布"],
                "hasPasswordInput": password,
                "forms": 0,
                "inputs": 0,
                "buttons": 2,
                "links": 8,
            },
            "elements": [
                {"tag": "button", "type": "button", "name": "累计安装", "locatorType": "role", "locatorValue": "累计安装", "locatorRole": "button"},
                {"tag": "button", "type": "button", "name": "本周热度", "locatorType": "role", "locatorValue": "本周热度", "locatorRole": "button"},
            ],
            "responses": [
                {
                    "method": "GET",
                    "url": "https://skillhub.test/api/stats/rank?mode=dl",
                    "status": 200,
                    "itemCount": 2,
                    "body": {"data": [
                        {"rank": 1, "slug": "alpha", "name": "Alpha", "value": 9},
                        {"rank": 2, "slug": "beta", "name": "Beta", "value": 4},
                    ]},
                },
            ],
        }

    def insert_flow(self, work_item_id, flow_id):
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO automation_flow_runs (
                    id, work_item_id, feature_id, status, stage, progress,
                    current_attempt, asset_mode, case_ids_json, started_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (flow_id, work_item_id, self.feature["id"], "running", "需求分析", 0, 0, "create", "[]", main.now_iso()),
            )

    def test_read_only_ranking_without_user_test_data_resolves_from_api(self):
        item = {
            "title": "排行榜",
            "requirement": "无需登录，验证排行榜、贡献者榜、部门分布和排名正确性",
            "acceptance": "累计安装和本周热度可以切换",
            "exclusions": "",
            "target_url": "https://skillhub.test/#/rank",
            "role": "",
            "test_data": "",
        }

        resolution, context = main.build_automation_data_context(item, self.preflight())

        self.assertEqual(resolution["category"], "discoverable")
        self.assertEqual(resolution["status"], "resolved")
        self.assertEqual(resolution["source"], "api")
        self.assertEqual(context["accessMode"], "anonymous")
        self.assertEqual(context["datasets"][0]["itemCount"], 2)
        self.assertIn("rank", context["datasets"][0]["fields"])
        self.assertTrue(any("名次连续" in hint for hint in context["assertionHints"]))

    def test_login_requirement_without_account_remains_blocked(self):
        item = {
            "title": "登录",
            "requirement": "验证用户使用账号密码登录后进入首页",
            "acceptance": "登录成功",
            "exclusions": "",
            "target_url": "https://skillhub.test/#/login",
            "role": "普通用户",
            "test_data": "",
        }

        resolution, context = main.build_automation_data_context(
            item,
            self.preflight(password=True),
            missing_account_policy="block",
        )

        self.assertEqual(resolution["category"], "account-required")
        self.assertEqual(resolution["status"], "blocked")
        self.assertEqual(context["accessMode"], "authentication-required")

    def test_ranking_fallback_scripts_use_runtime_api_oracle(self):
        item = {
            "title": "排行榜",
            "requirement": "验证排行榜累计安装、本周热度、贡献者、部门和技能跳转",
            "acceptance": "",
            "exclusions": "",
            "target_url": "https://skillhub.test/#/rank",
            "role": "",
        }
        titles = [
            "三类榜单完整展示",
            "累计安装排名与数据源一致",
            "本周热度排名与数据源一致",
            "贡献者和部门统计一致",
            "技能记录跳转详情正确",
        ]
        scripts = []
        for index, title in enumerate(titles, 1):
            case = {
                "external_id": f"TC-CODEX-RANK-{index:03d}",
                "title": title,
                "requirement": title,
                "steps": title,
                "expected": title,
                "automation_notes": "",
            }
            script = main.ranking_case_script(item, case, "../fixtures/rank-fixture")
            self.assertIsNotNone(script)
            self.assertEqual(main.valid_case_playwright_script(script, case, [], "../fixtures/rank-fixture"), "")
            self.assertEqual(main.single_primary_assertion_error(script, case["expected"]), "")
            scripts.append(script)

        combined = "\n".join(scripts)
        self.assertIn("/api/stats/rank?mode=dl", combined)
        self.assertIn("/api/stats/rank?mode=wk", combined)
        self.assertIn("/api/stats/contributors", combined)
        self.assertIn("/api/stats/depts", combined)
        self.assertIn("record.slug", combined)

    async def test_preflight_captures_only_small_same_origin_get_json_and_redacts_secrets(self):
        class Handler(BaseHTTPRequestHandler):
            def send_body(self, body, content_type="application/json"):
                encoded = body.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def do_GET(self):
                if self.path == "/":
                    self.send_body("""<!doctype html><button>排行榜</button><script>
                      fetch('/api/data');
                      fetch('/api/large');
                      fetch('/api/post', { method: 'POST' });
                    </script>""", "text/html; charset=utf-8")
                elif self.path == "/api/data":
                    self.send_body(json.dumps({"data": [{"rank": 1, "password": "secret", "nested": {"token": "abc"}}]}))
                elif self.path == "/api/large":
                    self.send_body(json.dumps({"data": "x" * (129 * 1024)}))
                else:
                    self.send_error(404)

            def do_POST(self):
                self.send_body(json.dumps({"data": {"created": True}}))

            def log_message(self, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(main.platform, "DISCOVERY_DIR", Path(self.tempdir.name) / "discovery"):
                result = await main.discover_page("work-json-capture", f"http://127.0.0.1:{server.server_port}/")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(len(result["responses"]), 1)
        response = result["responses"][0]
        self.assertTrue(response["url"].endswith("/api/data"))
        record = response["body"]["data"][0]
        self.assertEqual(record["password"], "[REDACTED]")
        self.assertEqual(record["nested"]["token"], "[REDACTED]")

    async def test_flow_without_test_data_reaches_case_design_after_preflight(self):
        work = main.create_work_item(main.WorkItemRequest(
            project_id=self.project["id"],
            feature_id=self.feature["id"],
            requirement="无需登录，测试 https://skillhub.test/#/rank 的排行榜、贡献者榜和部门分布。",
            target_url="https://skillhub.test/#/rank",
        ))
        flow_id = "flow-data-discovery"
        self.insert_flow(work["id"], flow_id)
        cases = main.default_cases(main.get_work_item_row(work["id"]), {"datasets": [{"name": "rank"}]})
        with (
            patch.object(main.platform, "discover_page", new=AsyncMock(return_value=self.preflight())),
            patch.object(main.platform, "stream_ai_test_cases", new=AsyncMock(return_value=cases)) as generate_cases,
            patch.object(main.platform, "start_exploration_run", new=AsyncMock(return_value={
                "id": "explore-stop-after-cases",
                "status": "failed",
                "error": "CODEX_TEST_STOP_AFTER_CASES",
                "planErrorCode": "test-stop",
            })),
        ):
            await main.execute_automation_flow(flow_id)

        generate_cases.assert_awaited_once()
        flow = main.get_automation_flow_payload(flow_id)
        self.assertEqual(flow["dataResolution"]["status"], "resolved")
        self.assertEqual(flow["dataResolution"]["source"], "api")
        self.assertEqual(flow["error"], "CODEX_TEST_STOP_AFTER_CASES")
        self.assertNotIn("缺少账号或测试数据", flow["error"])
        self.assertIn("data-context", {artifact["artifactType"] for artifact in flow["flowArtifacts"]})
        saved_cases = main.latest_cases_for_work_item(work["id"])
        self.assertEqual(len(main.parse_cases_markdown(saved_cases)), 6)
        self.assertNotIn("需业务规则确认的可选人工验证", saved_cases)

    async def test_formal_exploration_reuses_flow_preflight_snapshot(self):
        work = main.create_work_item(main.WorkItemRequest(
            project_id=self.project["id"],
            feature_id=self.feature["id"],
            requirement="无需登录，验证排行榜展示。",
            target_url="https://skillhub.test/#/rank",
        ))
        main.generate_cases(work["id"], main.ContentRequest(content=main.default_cases(main.get_work_item_row(work["id"]))))
        flow_id = "flow-reuse-preflight"
        self.insert_flow(work["id"], flow_id)
        main.update_automation_flow(flow_id, preflight_json=json.dumps(self.preflight(), ensure_ascii=False))
        with (
            patch.object(main.platform, "discover_page", new=AsyncMock()) as discover,
            patch.object(main.platform, "build_exploration_plan", new=AsyncMock(side_effect=main.ExplorationPlanBuildError("stop", "CODEX_TEST_REUSED_PREFLIGHT"))),
        ):
            result = await main.start_exploration_run(work["id"], keep_browser_open=False)

        discover.assert_not_awaited()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["planErrorCode"], "stop")


if __name__ == "__main__":
    unittest.main()
