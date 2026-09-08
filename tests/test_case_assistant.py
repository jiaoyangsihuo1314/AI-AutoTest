import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, Request

from backend.app import main


CASES_MARKDOWN = """| ID | 优先级 | 标题 | 覆盖需求 | 前置条件/测试数据 | 步骤 | 期望结果 | 自动化说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODEX-AI-001 | P0 | 登录成功 | 用户可以登录 | 使用有效账号 | 输入账号密码并提交 | 进入首页 | 使用 role 定位 |
| TC-CODEX-AI-002 | P1 | 密码错误 | 错误密码被拒绝 | 使用错误密码 | 输入错误密码并提交 | 显示错误提示 | 验证可见文案 |
"""


class CaseAssistantTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = main.DB_PATH
        main.DB_PATH = Path(self.temp_dir.name) / "case-assistant.sqlite"
        main.init_db()
        self.project = main.create_project(main.ProjectRequest(name="CODEX_TEST_CASE_AI_PROJECT"))
        self.feature = main.create_feature_menu(main.FeatureMenuRequest(project_id=self.project["id"], name="CODEX_TEST_CASE_AI_FEATURE"))
        with patch.object(main.platform, "analyze_requirement_with_ai", return_value={}):
            self.work = main.create_work_item(main.WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                title="CODEX_TEST_CASE_AI_WORK",
                requirement="验证登录测试用例 AI 协作。",
                target_url="https://example.test/login",
            ))
            self.other = main.create_work_item(main.WorkItemRequest(
                project_id=self.project["id"],
                feature_id=self.feature["id"],
                title="CODEX_TEST_CASE_AI_OTHER",
                requirement="验证其他工单不受影响。",
                target_url="https://example.test/other",
            ))
        self.work = main.generate_cases(self.work["id"], main.ContentRequest(content=CASES_MARKDOWN))
        self.cases_markdown = self.work["casesMarkdown"]
        self.case_one_id = main.parse_cases_markdown(self.cases_markdown)[0]["external_id"]

    def tearDown(self):
        main.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def request(self):
        request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
        request.state.user = {"id": "user-codex", "username": "codex", "displayName": "Codex QA", "role": "executor"}
        return request

    def insert_proposal(self, work_item_id, operations, proposal_id="proposal-codex"):
        timestamp = main.now_iso()
        with main.get_db() as conn:
            conn.execute(
                """
                INSERT INTO case_assistant_proposals (
                    id, work_item_id, message_id, base_cases_revision_id, base_draft_hash,
                    summary, operations_json, status, committed_operation_ids_json,
                    created_by_user_id, created_at, updated_at
                ) VALUES (?, ?, '', ?, ?, 'CODEX_TEST 提案', ?, 'pending', '[]', 'user-codex', ?, ?)
                """,
                (proposal_id, work_item_id, self.work["casesRevisionId"], main.case_assistant_draft_hash(CASES_MARKDOWN), main.json.dumps(operations, ensure_ascii=False), timestamp, timestamp),
            )
        return proposal_id

    def test_message_and_proposal_are_persisted_per_work_item(self):
        response = {
            "reply": "建议把期望结果改得更可验证。",
            "needsClarification": False,
            "summary": "明确期望结果",
            "operations": [{
                "id": "op-1",
                "type": "update",
                "targetExternalId": self.case_one_id,
                "reason": "提高可验证性",
                "before": {"expected": "进入首页"},
                "after": {"expected": "首页标题和用户菜单可见"},
            }],
        }
        payload = main.CaseAssistantMessageRequest(
            message=f"修改 {self.case_one_id} 的期望结果",
            draft_markdown=self.cases_markdown,
            base_cases_revision_id=self.work["casesRevisionId"],
        )
        with patch.object(main.platform, "call_case_assistant_model", return_value=response):
            result = main.send_case_assistant_message(self.work["id"], payload, self.request())

        self.assertEqual(result["message"]["proposal"]["operations"][0]["after"]["expected"], "首页标题和用户菜单可见")
        history = main.get_case_assistant_history(self.work["id"])
        other_history = main.get_case_assistant_history(self.other["id"])
        self.assertEqual([item["role"] for item in history["items"]], ["user", "assistant"])
        self.assertEqual(other_history["items"], [])

    def test_failed_ai_request_does_not_leave_orphan_user_message(self):
        payload = main.CaseAssistantMessageRequest(
            message="检查遗漏",
            draft_markdown=self.cases_markdown,
            base_cases_revision_id=self.work["casesRevisionId"],
        )
        with patch.object(main.platform, "call_case_assistant_model", side_effect=HTTPException(status_code=502, detail="CODEX_TEST_AI_ERROR")):
            with self.assertRaises(HTTPException):
                main.send_case_assistant_message(self.work["id"], payload, self.request())

        self.assertEqual(main.get_case_assistant_history(self.work["id"])["items"], [])

    def test_apply_changes_only_returned_draft_and_detects_field_conflict(self):
        summary, operations = main.normalize_case_assistant_operations({
            "summary": "更新期望结果",
            "operations": [{
                "id": "op-1",
                "type": "update",
                "target_external_id": self.case_one_id,
                "reason": "明确断言",
                "changes": {"expected": "首页标题和用户菜单可见"},
            }],
        }, self.cases_markdown)
        proposal_id = self.insert_proposal(self.work["id"], operations)

        result = main.apply_case_assistant_proposal(
            self.work["id"],
            proposal_id,
            main.CaseAssistantApplyRequest(draft_markdown=self.cases_markdown, operation_ids=["op-1"]),
        )
        self.assertEqual(summary, "更新期望结果")
        self.assertIn("首页标题和用户菜单可见", result["content"])
        self.assertEqual(result["conflicts"], [])
        self.assertNotIn("首页标题和用户菜单可见", main.get_work_item(self.work["id"])["casesMarkdown"])

        conflicting = self.cases_markdown.replace("进入首页", "人工已经修改")
        conflict_result = main.apply_case_assistant_proposal(
            self.work["id"],
            proposal_id,
            main.CaseAssistantApplyRequest(draft_markdown=conflicting, operation_ids=["op-1"]),
        )
        self.assertEqual(conflict_result["appliedOperationIds"], [])
        self.assertEqual(conflict_result["conflicts"][0]["targetExternalId"], self.case_one_id)

    def test_multiple_expected_results_are_rejected_before_proposal_is_saved(self):
        with self.assertRaisesRegex(ValueError, "连接多个结果"):
            main.normalize_case_assistant_operations({
                "summary": "更新期望结果",
                "operations": [{
                    "id": "op-multi-expected",
                    "type": "update",
                    "target_external_id": self.case_one_id,
                    "reason": "CODEX_TEST 多期望",
                    "changes": {"expected": "进入首页并且用户菜单可见"},
                }],
            }, self.cases_markdown)

    def test_invalid_stored_proposal_is_not_applied(self):
        operation = [{
            "id": "op-stored-invalid",
            "type": "update",
            "targetExternalId": self.case_one_id,
            "reason": "CODEX_TEST 绕过解析层",
            "before": {"expected": "进入首页"},
            "after": {"expected": "进入首页；用户菜单可见"},
        }]

        content, applied_ids, conflicts, _ = main.apply_case_assistant_operations(
            self.cases_markdown,
            operation,
            ["op-stored-invalid"],
        )

        self.assertEqual(applied_ids, [])
        self.assertIn("只能包含一个业务结果", conflicts[0]["message"])
        self.assertEqual(content, self.cases_markdown)

    def test_apply_escapes_markdown_and_keeps_last_case(self):
        rows = [main.case_assistant_api_row(main.parse_cases_markdown(self.cases_markdown)[0])]
        update = [{
            "id": "op-pipe",
            "type": "update",
            "targetExternalId": self.case_one_id,
            "reason": "验证 Markdown",
            "before": {"expected": "进入首页"},
            "after": {"expected": "标题 | 用户菜单可见"},
        }]
        content, applied_ids, conflicts, _ = main.apply_case_assistant_operations(
            main.serialize_case_assistant_rows(rows), update, ["op-pipe"]
        )
        self.assertEqual(applied_ids, ["op-pipe"])
        self.assertEqual(conflicts, [])
        self.assertIn(r"标题 \| 用户菜单可见", content)
        self.assertEqual(main.parse_cases_markdown(content)[0]["expected"], "标题 | 用户菜单可见")

        delete = [{
            "id": "op-last",
            "type": "delete",
            "targetExternalId": self.case_one_id,
            "reason": "删除最后一条",
            "before": main.case_assistant_api_row(main.parse_cases_markdown(content)[0]),
            "after": None,
        }]
        kept, applied_ids, conflicts, _ = main.apply_case_assistant_operations(content, delete, ["op-last"])
        self.assertEqual(applied_ids, [])
        self.assertEqual(conflicts[0]["message"], "至少保留一条测试用例")
        self.assertEqual(len(main.parse_cases_markdown(kept)), 1)

    def test_save_checks_revision_and_commits_reflected_operations(self):
        _, operations = main.normalize_case_assistant_operations({
            "summary": "更新期望结果",
            "operations": [{
                "id": "op-save",
                "type": "update",
                "target_external_id": self.case_one_id,
                "reason": "明确断言",
                "changes": {"expected": "首页标题可见"},
            }],
        }, self.cases_markdown)
        proposal_id = self.insert_proposal(self.work["id"], operations, "proposal-save")
        applied, _, _, _ = main.apply_case_assistant_operations(self.cases_markdown, operations, ["op-save"])

        saved = main.generate_cases(self.work["id"], main.ContentRequest(
            content=applied,
            case_ids=self.work["caseIds"],
            base_cases_revision_id=self.work["casesRevisionId"],
            assistant_proposals=[{"proposal_id": proposal_id, "operation_ids": ["op-save"]}],
        ))
        self.assertIn("首页标题可见", saved["casesMarkdown"])
        with main.get_db() as conn:
            proposal = conn.execute("SELECT * FROM case_assistant_proposals WHERE id = ?", (proposal_id,)).fetchone()
        self.assertEqual(proposal["status"], "committed")

        with self.assertRaises(HTTPException) as conflict:
            main.generate_cases(self.work["id"], main.ContentRequest(
                content=applied,
                base_cases_revision_id=self.work["casesRevisionId"],
            ))
        self.assertEqual(conflict.exception.status_code, 409)

    def test_clear_cases_removes_only_current_work_item_assistant_history(self):
        operation = [{"id": "op-clear", "type": "delete", "targetExternalId": "TC-CODEX-AI-002", "reason": "CODEX_TEST", "before": {}, "after": None}]
        self.insert_proposal(self.work["id"], operation, "proposal-clear-current")
        self.insert_proposal(self.other["id"], operation, "proposal-clear-other")
        with main.get_db() as conn:
            conn.execute("INSERT INTO case_assistant_messages (id, work_item_id, role, content, actor_user_id, actor_display_name, proposal_id, created_at) VALUES ('message-current', ?, 'assistant', 'CODEX_TEST', '', 'AI', 'proposal-clear-current', ?)", (self.work["id"], main.now_iso()))
            conn.execute("INSERT INTO case_assistant_messages (id, work_item_id, role, content, actor_user_id, actor_display_name, proposal_id, created_at) VALUES ('message-other', ?, 'assistant', 'CODEX_TEST', '', 'AI', 'proposal-clear-other', ?)", (self.other["id"], main.now_iso()))

        main.clear_work_item_page_data(self.work["id"], main.ClearPageDataRequest(page="cases"))

        with main.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM case_assistant_messages WHERE work_item_id = ?", (self.work["id"],)).fetchone()["total"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM case_assistant_proposals WHERE work_item_id = ?", (self.work["id"],)).fetchone()["total"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM case_assistant_messages WHERE work_item_id = ?", (self.other["id"],)).fetchone()["total"], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS total FROM case_assistant_proposals WHERE work_item_id = ?", (self.other["id"],)).fetchone()["total"], 1)


if __name__ == "__main__":
    unittest.main()
