"""Single-test-case debugging routes."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/case-debug-batches/preflight', platform.preflight_case_debug_batch, methods=['POST'])
router.add_api_route('/api/case-debug-batches', platform.create_case_debug_batch, methods=['POST'])
router.add_api_route('/api/case-debug-batches/{batch_id}', platform.get_case_debug_batch, methods=['GET'])
router.add_api_route('/api/case-debug-batches/{batch_id}/cancel', platform.cancel_case_debug_batch, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}', platform.get_case_debug_session, methods=['GET'])
router.add_api_route('/api/case-debug-sessions/{session_id}/case-draft', platform.save_case_debug_case_draft, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}/exploration', platform.save_case_debug_exploration, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}/exploration/run', platform.run_case_debug_exploration, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}/generate-script/stream', platform.stream_case_debug_script, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}/script-drafts', platform.save_case_debug_script_draft, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}/run', platform.run_case_debug_session, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}/self-heal', platform.self_heal_case_debug_session, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}/sync', platform.sync_case_debug_session, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}/publish', platform.publish_case_debug_session, methods=['POST'])
router.add_api_route('/api/case-debug-sessions/{session_id}/cancel', platform.cancel_case_debug_session, methods=['POST'])
