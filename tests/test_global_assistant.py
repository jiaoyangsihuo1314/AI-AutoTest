import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, Request

from backend.app import main


TEST_MARKER = "CODEX_TEST_GLOBAL_AI_CANCEL_20260902"
TOOLS_MARKER = "CODEX_TEST_GLOBAL_AI_TOOLS_20260902"


class GlobalAssistantTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = main.DB_PATH
        main.DB_PATH = Path(self.temp_dir.name) / "global-assistant.sqlite"
        main.init_db()
        main.GLOBAL_ASSISTANT_GENERATIONS.clear()
        main.GLOBAL_ASSISTANT_CANCELLED_REQUESTS.clear()

    def tearDown(self):
        main.GLOBAL_ASSISTANT_GENERATIONS.clear()
        main.GLOBAL_ASSISTANT_CANCELLED_REQUESTS.clear()
        main.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def insert_case(self, case_id, external_id, title):
        timestamp = main.now_iso()
        with main.get_db() as conn:
            conn.execute(
                """INSERT INTO test_cases
                (id, project_id, work_item_id, feature_id, external_id, title, title_source, suggested_title,
                 priority, requirement, preconditions, steps, expected, automation_notes, automation_status,
                 spec_path, latest_run_id, latest_status, library_status, published_at, published_run_id, created_at, updated_at)
                VALUES (?, 'project-tools', NULL, NULL, ?, ?, 'manual', '', 'P1', ?, '', '打开页面', '显示成功', '',
                        'candidate', '', '', '', 'published', ?, '', ?, ?)""",
                (case_id, external_id, title, TOOLS_MARKER, timestamp, timestamp, timestamp),
            )

    def request(self, user_id="global-user-one", role="viewer"):
        request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
        request.state.user = {"id": user_id, "username": user_id, "displayName": user_id, "role": role}
        return request

    def create_conversation(self, request=None):
        return main.create_global_assistant_conversation(
            main.GlobalAssistantConversationCreateRequest(title=f"{TEST_MARKER}_CHAT"),
            request or self.request(),
        )

    def test_message_request_accepts_text_and_request_id_contract(self):
        self.assertEqual(set(main.GlobalAssistantMessageRequest.model_fields), {"message", "request_id"})

    @staticmethod
    async def collect_stream(response):
        chunks = []
        async for chunk in response.body_iterator:
            chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
        return [json.loads(line) for line in "".join(chunks).splitlines() if line.strip()]

    def runtime_config(self):
        return {
            "profile_id": "profile-test",
            "provider": "openai",
            "api_key": "test-key",
            "model": "test-model",
            "base_url": "https://example.test/v1",
        }

    def test_conversations_are_isolated_by_owner(self):
        first = self.create_conversation(self.request("global-user-one"))
        second = self.create_conversation(self.request("global-user-two"))

        first_items = main.get_global_assistant_conversations(self.request("global-user-one"))["items"]
        second_items = main.get_global_assistant_conversations(self.request("global-user-two"))["items"]
        self.assertEqual([item["id"] for item in first_items], [first["id"]])
        self.assertEqual([item["id"] for item in second_items], [second["id"]])

        with self.assertRaises(HTTPException) as denied:
            main.delete_global_assistant_conversation(first["id"], self.request("global-user-two"))
        self.assertEqual(denied.exception.status_code, 404)

    def test_stream_uses_text_only_and_persists_model_snapshot(self):
        request = self.request()
        conversation = self.create_conversation(request)
        payload = main.GlobalAssistantMessageRequest(message=f"{TEST_MARKER} 分析登录失败")
        captured = {}

        def response_stream(api_key, model, base_url, request_payload, **kwargs):
            captured["prompt"] = request_payload["input"]
            yield "先检查环境。"
            yield "再检查账号。"

        with patch.object(main.platform, "ai_runtime_config", return_value=self.runtime_config()), patch.object(
            main.platform, "iter_openai_stream_deltas", side_effect=response_stream,
        ):
            events = asyncio.run(self.collect_stream(main.stream_global_assistant_message(conversation["id"], payload, request)))

        self.assertEqual([event["type"] for event in events], ["started", "delta", "delta", "completed"])
        messages = main.get_global_assistant_messages(conversation["id"], request)["items"]
        self.assertEqual([item["role"] for item in messages], ["user", "assistant"])
        self.assertEqual(messages[1]["content"], "先检查环境。再检查账号。")
        self.assertEqual(messages[1]["modelProfileId"], "profile-test")
        self.assertEqual(messages[1]["model"], "test-model")
        self.assertNotIn("context", messages[0])
        self.assertIn("请从用户的文字描述中识别所在页面", captured["prompt"])
        self.assertIn("不要猜测用户当前所在页面", captured["prompt"])

    def test_legacy_context_column_is_ignored_in_message_response(self):
        request = self.request()
        conversation = self.create_conversation(request)
        timestamp = main.now_iso()
        with main.get_db() as conn:
            conn.execute(
                "INSERT INTO global_assistant_messages (id, conversation_id, role, content, status, context_json, model_profile_id, provider, model, error_code, created_at, updated_at) VALUES (?, ?, 'user', ?, 'completed', ?, '', '', '', '', ?, ?)",
                (f"{TEST_MARKER}_LEGACY", conversation["id"], "旧消息", '{"project":{"name":"旧项目"}}', timestamp, timestamp),
            )

        message = main.get_global_assistant_messages(conversation["id"], request)["items"][0]
        self.assertEqual(message["content"], "旧消息")
        self.assertNotIn("context", message)

    def test_provider_failure_keeps_question_and_marks_reply_failed(self):
        request = self.request()
        conversation = self.create_conversation(request)

        def fail_stream(*args, **kwargs):
            raise main.AIRequestError("CODEX_TEST_PROVIDER_FAILURE", provider_code="provider_failure")
            yield ""

        with patch.object(main.platform, "ai_runtime_config", return_value=self.runtime_config()), patch.object(
            main.platform, "iter_openai_stream_deltas", side_effect=fail_stream,
        ):
            events = asyncio.run(self.collect_stream(main.stream_global_assistant_message(
                conversation["id"],
                main.GlobalAssistantMessageRequest(message=f"{TEST_MARKER} 失败测试"),
                request,
            )))

        self.assertEqual(events[-1]["type"], "error")
        messages = main.get_global_assistant_messages(conversation["id"], request)["items"]
        self.assertEqual(messages[0]["status"], "completed")
        self.assertEqual(messages[1]["status"], "failed")
        self.assertEqual(messages[1]["errorCode"], "provider_failure")

    def test_closed_stream_marks_partial_reply_cancelled(self):
        request = self.request()
        conversation = self.create_conversation(request)

        def slow_stream(*args, **kwargs):
            yield "部分回复"
            yield "不应继续"

        async def consume_then_close(response):
            first = await anext(response.body_iterator)
            second = await anext(response.body_iterator)
            await response.body_iterator.aclose()
            return first, second

        with patch.object(main.platform, "ai_runtime_config", return_value=self.runtime_config()), patch.object(
            main.platform, "iter_openai_stream_deltas", side_effect=slow_stream,
        ):
            response = main.stream_global_assistant_message(
                conversation["id"],
                main.GlobalAssistantMessageRequest(message=f"{TEST_MARKER} 取消测试"),
                request,
            )
            asyncio.run(consume_then_close(response))

        messages = main.get_global_assistant_messages(conversation["id"], request)["items"]
        self.assertEqual(messages[1]["status"], "cancelled")
        self.assertEqual(messages[1]["content"], "部分回复")
        self.assertNotIn("global-user-one", main.GLOBAL_ASSISTANT_GENERATIONS)

    def test_explicit_cancel_releases_lock_and_old_stream_cannot_clear_new_generation(self):
        request = self.request()
        conversation = self.create_conversation(request)

        def slow_stream(*args, **kwargs):
            yield "部分回复"
            yield "取消后的迟到内容"

        async def exercise():
            first = main.stream_global_assistant_message(
                conversation["id"],
                main.GlobalAssistantMessageRequest(
                    message=f"{TEST_MARKER} 第一问",
                    request_id="request_cancel_20260902_first",
                ),
                request,
            )
            started = json.loads(await anext(first.body_iterator))
            delta = json.loads(await anext(first.body_iterator))
            cancelled = main.cancel_global_assistant_generation(started["requestId"], request)

            second = main.stream_global_assistant_message(
                conversation["id"],
                main.GlobalAssistantMessageRequest(
                    message=f"{TEST_MARKER} 第二问",
                    request_id="request_cancel_20260902_second",
                ),
                request,
            )
            second_started = json.loads(await anext(second.body_iterator))
            cancelled_event = json.loads(await anext(first.body_iterator))
            with self.assertRaises(StopAsyncIteration):
                await anext(first.body_iterator)
            active_after_old_exit = main.GLOBAL_ASSISTANT_GENERATIONS["global-user-one"]["request_id"]
            await second.body_iterator.aclose()
            return started, delta, cancelled, second_started, cancelled_event, active_after_old_exit

        with patch.object(main.platform, "ai_runtime_config", return_value=self.runtime_config()), patch.object(
            main.platform, "iter_openai_stream_deltas", side_effect=slow_stream,
        ):
            started, delta, cancelled, second_started, cancelled_event, active_after_old_exit = asyncio.run(exercise())

        self.assertEqual(started["requestId"], "request_cancel_20260902_first")
        self.assertEqual(delta["delta"], "部分回复")
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(cancelled_event["type"], "cancelled")
        self.assertEqual(second_started["requestId"], "request_cancel_20260902_second")
        self.assertEqual(active_after_old_exit, "request_cancel_20260902_second")
        self.assertNotIn("global-user-one", main.GLOBAL_ASSISTANT_GENERATIONS)
        messages = main.get_global_assistant_messages(conversation["id"], request)["items"]
        self.assertEqual(messages[1]["status"], "cancelled")
        self.assertEqual(messages[1]["content"], "部分回复")

    def test_cancel_before_stream_registration_is_remembered(self):
        request = self.request()
        conversation = self.create_conversation(request)
        request_id = "request_cancel_20260902_early"
        result = main.cancel_global_assistant_generation(request_id, request)
        self.assertEqual(result["status"], "not-active")

        with patch.object(main.platform, "ai_runtime_config", return_value=self.runtime_config()), patch.object(
            main.platform, "iter_openai_stream_deltas", return_value=iter(["不应调用模型"]),
        ) as mocked_stream:
            response = main.stream_global_assistant_message(
                conversation["id"],
                main.GlobalAssistantMessageRequest(message=f"{TEST_MARKER} 提前停止", request_id=request_id),
                request,
            )
            events = asyncio.run(self.collect_stream(response))

        self.assertEqual([event["type"] for event in events], ["started", "cancelled"])
        mocked_stream.assert_not_called()
        self.assertNotIn("global-user-one", main.GLOBAL_ASSISTANT_GENERATIONS)
        messages = main.get_global_assistant_messages(conversation["id"], request)["items"]
        self.assertEqual(messages[1]["status"], "cancelled")

    def test_cancel_is_idempotent_owner_scoped_and_validated(self):
        request = self.request()
        other_request = self.request("global-user-two")
        self.assertEqual(
            main.cancel_global_assistant_generation("request_cancel_20260902_none", request)["status"],
            "not-active",
        )
        self.assertEqual(
            main.cancel_global_assistant_generation("request_cancel_20260902_none", other_request)["status"],
            "not-active",
        )
        with self.assertRaises(HTTPException) as invalid:
            main.cancel_global_assistant_generation("bad id", request)
        self.assertEqual(invalid.exception.status_code, 400)

    def test_unconfigured_ai_and_concurrent_request_are_rejected(self):
        request = self.request()
        conversation = self.create_conversation(request)
        empty_config = {**self.runtime_config(), "api_key": ""}
        with patch.object(main.platform, "ai_runtime_config", return_value=empty_config):
            with self.assertRaises(HTTPException) as unconfigured:
                main.stream_global_assistant_message(
                    conversation["id"], main.GlobalAssistantMessageRequest(message=TEST_MARKER), request,
                )
        self.assertEqual(unconfigured.exception.status_code, 409)

        main.GLOBAL_ASSISTANT_GENERATIONS["global-user-one"] = {
            "request_id": "request_cancel_20260902_active",
            "started_at": main.time.monotonic(),
            "cancelled": False,
        }
        with patch.object(main.platform, "ai_runtime_config", return_value=self.runtime_config()):
            with self.assertRaises(HTTPException) as concurrent:
                main.stream_global_assistant_message(
                    conversation["id"], main.GlobalAssistantMessageRequest(message=TEST_MARKER), request,
                )
        self.assertEqual(concurrent.exception.status_code, 429)

    def test_long_input_accepts_over_8000_and_rejects_over_safety_limit(self):
        request = self.request()
        conversation = self.create_conversation(request)
        long_message = TOOLS_MARKER + "x" * 9000
        with patch.object(main.platform, "ai_runtime_config", return_value=self.runtime_config()), patch.object(
            main.platform, "iter_openai_stream_deltas", return_value=iter(["已接收长输入"]),
        ):
            events = asyncio.run(self.collect_stream(main.stream_global_assistant_message(
                conversation["id"], main.GlobalAssistantMessageRequest(message=long_message), request,
            )))
        self.assertEqual(events[-1]["type"], "completed")
        self.assertEqual(main.get_global_assistant_messages(conversation["id"], request)["items"][0]["content"], long_message)

        with patch.object(main.platform, "ai_runtime_config", return_value=self.runtime_config()):
            with self.assertRaises(HTTPException) as too_long:
                main.stream_global_assistant_message(
                    conversation["id"], main.GlobalAssistantMessageRequest(message="x" * 200001), request,
                )
        self.assertEqual(too_long.exception.status_code, 400)

    def test_prompt_truncates_middle_and_requires_disclosure(self):
        prompt = main.global_assistant_history_prompt([], "a" * 70000)
        self.assertIn("中间内容已因模型上下文预算被裁剪", prompt)
        self.assertIn("必须明确说明未完整读取中间内容", prompt)
        self.assertLessEqual(len(prompt), main.GLOBAL_ASSISTANT_MODEL_INPUT_BUDGET + 2000)

    def test_read_tool_returns_ambiguous_candidates_without_model_call(self):
        request = self.request()
        conversation = self.create_conversation(request)
        self.insert_case(f"{TOOLS_MARKER}_A", "TC-TOOLS-001", "登录成功")
        self.insert_case(f"{TOOLS_MARKER}_B", "TC-TOOLS-002", "登录失败")
        with patch.object(main.platform, "ai_runtime_config", return_value=self.runtime_config()), patch.object(
            main.platform, "iter_openai_stream_deltas",
        ) as model_stream:
            events = asyncio.run(self.collect_stream(main.stream_global_assistant_message(
                conversation["id"], main.GlobalAssistantMessageRequest(message="查询用例 登录"), request,
            )))
        self.assertEqual([event["type"] for event in events], ["started", "tool_started", "tool_result", "completed"])
        self.assertTrue(events[2]["result"]["ambiguous"])
        self.assertEqual(len(events[2]["result"]["items"]), 2)
        model_stream.assert_not_called()

    def test_action_is_owner_scoped_rejectable_and_viewer_cannot_approve(self):
        owner = self.request("tools-owner", "viewer")
        conversation = self.create_conversation(owner)
        action = main.create_global_assistant_action(
            owner.state.user, conversation["id"], "message-tools", "create_case_debug_session", {"caseId": "missing-case"},
        )
        with self.assertRaises(HTTPException) as denied_owner:
            main.get_global_assistant_action(action["id"], self.request("tools-other", "admin"))
        self.assertEqual(denied_owner.exception.status_code, 404)
        with self.assertRaises(HTTPException) as denied_role:
            asyncio.run(main.approve_global_assistant_action(action["id"], owner))
        self.assertEqual(denied_role.exception.status_code, 403)
        rejected = main.reject_global_assistant_action(action["id"], owner)
        self.assertEqual(rejected["status"], "rejected")
        self.assertEqual(main.reject_global_assistant_action(action["id"], owner)["status"], "rejected")


if __name__ == "__main__":
    unittest.main()
