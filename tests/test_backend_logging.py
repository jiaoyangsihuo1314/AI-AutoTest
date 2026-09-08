import asyncio
import logging
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from backend.app import main
from backend.app.core import logging as app_logging


class LoggingHelperTests(unittest.TestCase):
    def test_sanitize_log_context_redacts_secrets_and_url_queries(self):
        context = app_logging.sanitize_log_context(
            {
                "work_item_id": "work-123",
                "password": "plain-password",
                "api_key": "sk-secret-value",
                "message": "Authorization: Bearer abc123 password=hunter2",
                "base_url": "https://user:pass@example.test:8443/v1?token=secret",
                "target_url": "https://example.test/login?username=admin&password=secret",
            }
        )

        rendered = " ".join(context.values())
        self.assertIn("work-123", rendered)
        self.assertIn("example.test:8443", rendered)
        self.assertIn("https://example.test/login", rendered)
        self.assertNotIn("plain-password", rendered)
        self.assertNotIn("sk-secret-value", rendered)
        self.assertNotIn("abc123", rendered)
        self.assertNotIn("hunter2", rendered)
        self.assertNotIn("username=admin", rendered)

    def test_log_event_contains_event_and_business_context(self):
        logger = app_logging.get_logger("unit")
        with patch.object(logger, "log") as mocked_log:
            app_logging.log_event(
                logging.INFO,
                "work_item_created",
                component="unit",
                work_item_id="work-123",
                password="must-not-appear",
            )

        message = mocked_log.call_args.args[1]
        self.assertIn("event=work_item_created", message)
        self.assertIn("work_item_id=work-123", message)
        self.assertIn("password=[REDACTED]", message)
        self.assertNotIn("must-not-appear", message)

    def test_configure_logging_is_idempotent_and_honors_log_level(self):
        logger = app_logging.configure_logging()
        handler_count = sum(
            1 for handler in logger.handlers if getattr(handler, "_qa_platform_handler", False)
        )
        with patch.dict("os.environ", {"QA_LOG_LEVEL": "DEBUG"}):
            configured = app_logging.configure_logging()
            configured_again = app_logging.configure_logging()
            self.assertEqual(configured.level, logging.DEBUG)
            self.assertIs(configured, configured_again)
            self.assertEqual(
                sum(
                    1
                    for handler in configured.handlers
                    if getattr(handler, "_qa_platform_handler", False)
                ),
                handler_count,
            )
        app_logging.configure_logging()


class BackgroundTaskLoggingTests(unittest.IsolatedAsyncioTestCase):
    async def test_background_task_exception_is_logged_with_context(self):
        async def fail():
            raise RuntimeError("task failed")

        task = asyncio.create_task(fail())
        await asyncio.sleep(0)
        with patch("backend.app.platform.log_event") as mocked_log:
            main.log_background_task_result(task, "exploration", "explore-123")

        mocked_log.assert_called_once()
        self.assertEqual(mocked_log.call_args.args[:2], (logging.ERROR, "background_task_failed"))
        self.assertEqual(mocked_log.call_args.kwargs["task_type"], "exploration")
        self.assertEqual(mocked_log.call_args.kwargs["task_id"], "explore-123")
        self.assertTrue(mocked_log.call_args.kwargs["exc_info"])

    async def test_cancelled_background_task_is_not_logged_as_error(self):
        task = asyncio.create_task(asyncio.Event().wait())
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        with patch("backend.app.platform.log_event") as mocked_log:
            main.log_background_task_result(task, "automation_flow", "flow-123")
        mocked_log.assert_not_called()


class CoreLifecycleLoggingTests(unittest.IsolatedAsyncioTestCase):
    def test_ai_call_logs_start_and_completion_without_payload(self):
        response = MagicMock()
        response.read.return_value = b'{"output_text":"ok"}'
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        logger = app_logging.get_logger("ai")
        with (
            patch("backend.app.platform.urllib.request.build_opener", return_value=opener),
            patch.object(logger, "log") as mocked_log,
        ):
            body = main.call_openai_responses(
                "sk-do-not-log",
                "test-model",
                "https://api.example.test/v1?token=do-not-log",
                {"model": "test-model", "input": "private prompt"},
                timeout=2,
            )

        self.assertEqual(body["output_text"], "ok")
        messages = [call.args[1] for call in mocked_log.call_args_list]
        self.assertIn("event=ai_call_started", messages[0])
        self.assertIn("event=ai_call_completed", messages[1])
        rendered_calls = " ".join(messages)
        self.assertNotIn("sk-do-not-log", rendered_calls)
        self.assertNotIn("private prompt", rendered_calls)
        self.assertNotIn("token=do-not-log", rendered_calls)

    def test_requirement_analysis_logs_rule_fallback(self):
        with (
            patch.object(main, "get_openai_api_key", return_value=""),
            patch("backend.app.platform.log_event") as mocked_log,
        ):
            result = main.analyze_requirement_with_ai("验证示例登录页面")

        self.assertEqual(result["source"], "fallback")
        mocked_log.assert_any_call(
            logging.INFO,
            "requirement_analysis_fallback",
            component="ai",
            reason="ai_not_configured",
        )

    async def test_browser_ready_event_logs_session_context(self):
        runtime = main.BrowserRuntime(
            "session-123",
            "work-123",
            "explore-123",
            "https://example.test/login",
            SimpleNamespace(pid=4321, returncode=None),
        )
        with (
            patch.object(main, "update_browser_session"),
            patch.object(main, "broadcast_browser_event", new=AsyncMock()),
            patch("backend.app.platform.log_event") as mocked_log,
        ):
            await main.handle_worker_event(runtime, {"type": "ready"})

        mocked_log.assert_any_call(
            logging.INFO,
            "browser_session_ready",
            component="browser",
            session_id="session-123",
            work_item_id="work-123",
            exploration_run_id="explore-123",
            process_id=4321,
        )

    def test_flow_stage_change_logs_progress(self):
        with (
            patch.object(main, "update_automation_flow") as mocked_update,
            patch("backend.app.platform.log_event") as mocked_log,
        ):
            main.set_flow_stage("flow-123", "页面探索", 42, status="running")

        mocked_update.assert_called_once_with(
            "flow-123", stage="页面探索", progress=42, status="running"
        )
        mocked_log.assert_called_once_with(
            logging.INFO,
            "automation_flow_stage_changed",
            component="workflow",
            flow_run_id="flow-123",
            stage="页面探索",
            progress=42,
            status="running",
        )


class AutomationFlowStructuredLogTests(unittest.TestCase):
    def test_structured_flow_log_is_persisted_and_sensitive_values_are_redacted(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(main, "DB_PATH", Path(directory) / "flow-log.sqlite"):
            main.init_db()
            with patch.object(main, "schedule_automation_flow_event") as mocked_schedule:
                main.write_automation_flow_log(
                    "flow-log-test",
                    "运行验证",
                    "info",
                    "password=plain-secret Authorization: Bearer token-value",
                    "playwright-run",
                    "https://example.test/report?token=query-secret",
                    "run-123",
                    step_key="run.url_probe",
                    step_label="目标 URL 探测",
                    step_status="passed",
                    duration_ms=321,
                    details={"password": "detail-secret", "targetUrl": "https://example.test/?api_key=url-secret"},
                )

            payload = main.automation_flow_log_row("flow-log-test", 1)
            self.assertIsNotNone(payload)
            rendered = str(payload)
            self.assertEqual(payload["stepKey"], "run.url_probe")
            self.assertEqual(payload["stepLabel"], "目标 URL 探测")
            self.assertEqual(payload["stepStatus"], "passed")
            self.assertEqual(payload["durationMs"], 321)
            self.assertEqual(payload["details"]["password"], "***")
            self.assertNotIn("plain-secret", rendered)
            self.assertNotIn("token-value", rendered)
            self.assertNotIn("query-secret", rendered)
            self.assertNotIn("detail-secret", rendered)
            self.assertNotIn("url-secret", rendered)
            websocket_event = mocked_schedule.call_args.args[1]
            self.assertEqual(websocket_event["type"], "log")
            self.assertEqual(websocket_event["log"]["stepStatus"], "passed")
            self.assertNotIn("plain-secret", str(websocket_event))

    def test_historical_flow_log_is_redacted_when_serialized(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(main, "DB_PATH", Path(directory) / "historical-log.sqlite"):
            main.init_db()
            with main.get_db() as conn:
                cursor = conn.execute(
                    """
                    INSERT INTO automation_flow_logs (
                        flow_run_id, created_at, stage, level, message,
                        evidence_type, evidence_path, linked_run_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "flow-history",
                        main.now_iso(),
                        "需求分析",
                        "info",
                        "账号 test，密码：history-secret",
                        "work-item",
                        "https://example.test/?password=path-secret",
                        "work-123",
                    ),
                )
                log_id = cursor.lastrowid

            payload = main.automation_flow_log_row("flow-history", log_id)
            rendered = str(payload)
            self.assertNotIn("history-secret", rendered)
            self.assertNotIn("path-secret", rendered)
            self.assertEqual(payload["stepKey"], "")
            self.assertEqual(payload["details"], {})

    def test_playwright_step_markers_are_parsed_without_forwarding_regular_stdout(self):
        self.assertIsNone(main.parse_playwright_flow_step("1 passed (2.1s)"))
        self.assertEqual(
            main.parse_playwright_flow_step("[步骤开始] 输入用户名"),
            {
                "stepStatus": "started",
                "level": "info",
                "stepLabel": "输入用户名",
                "message": "步骤开始：输入用户名",
            },
        )
        failed = main.parse_playwright_flow_step("  [步骤失败] 提交登录: locator 超时")
        self.assertEqual(failed["stepStatus"], "failed")
        self.assertEqual(failed["stepLabel"], "提交登录")
        self.assertEqual(failed["message"], "locator 超时")
        failed_case = main.parse_playwright_flow_step("[步骤失败] 测试用例: TC-001 登录，状态 failed")
        self.assertEqual(failed_case["stepLabel"], "测试用例: TC-001 登录")
        self.assertEqual(failed_case["message"], "状态failed")

    def test_adjacent_duplicate_playwright_step_markers_are_suppressed(self):
        event = main.parse_playwright_flow_step("[步骤开始] 输入用户名")

        self.assertTrue(main.duplicate_playwright_flow_step(("输入用户名", "started"), 10.0, event, 10.05))
        self.assertFalse(main.duplicate_playwright_flow_step(("输入用户名", "started"), 10.0, event, 10.2))
        self.assertFalse(main.duplicate_playwright_flow_step(("输入密码", "started"), 10.0, event, 10.01))


if __name__ == "__main__":
    unittest.main()
