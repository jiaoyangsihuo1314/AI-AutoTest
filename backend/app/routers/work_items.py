"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform
from ..schemas.models import SaveArtifactsRequest

router = APIRouter()


def save_work_item_artifacts(work_item_id: str, payload: SaveArtifactsRequest):
    return platform.save_artifacts(work_item_id, payload)

router.add_api_route('/api/work-items', platform.work_items, methods=['GET'])
router.add_api_route('/api/work-items', platform.create_work_item, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}', platform.get_work_item, methods=['GET'])
router.add_api_route('/api/work-items/{work_item_id}', platform.update_work_item_details, methods=['PATCH'])
router.add_api_route('/api/work-items/{work_item_id}/clear-page-data', platform.clear_work_item_page_data, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/explore', platform.save_exploration, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/explore/run', platform.run_exploration, methods=['POST'])
router.add_api_route('/api/exploration-runs/{exploration_run_id}', platform.get_exploration_run, methods=['GET'])
router.add_api_route('/api/work-items/{work_item_id}/generate-cases', platform.generate_cases, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/generate-cases/stream', platform.stream_generated_cases, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/case-assistant', platform.get_case_assistant_history, methods=['GET'])
router.add_api_route('/api/work-items/{work_item_id}/case-assistant/messages', platform.send_case_assistant_message, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/case-assistant/proposals/{proposal_id}/apply', platform.apply_case_assistant_proposal, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/case-assistant/proposals/{proposal_id}/reject', platform.reject_case_assistant_proposal, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/generate-script', platform.generate_script, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/generate-script/stream', platform.stream_generated_script, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/save-artifacts', save_work_item_artifacts, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/run', platform.run_work_item, methods=['POST'])
router.add_api_route('/api/work-items/{work_item_id}/self-heal', platform.self_heal, methods=['POST'])
router.add_api_route('/api/healing-runs/{healing_run_id}', platform.get_healing_run, methods=['GET'])
router.add_api_route('/api/healing-runs/{healing_run_id}/logs', platform.healing_run_logs, methods=['GET'])
