"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/automation-flows', platform.list_automation_flows, methods=['GET'])
router.add_api_route('/api/automation-flows', platform.create_automation_flow, methods=['POST'])
router.add_api_route('/api/automation-flows/{flow_run_id}', platform.get_automation_flow, methods=['GET'])
router.add_api_route('/api/automation-flows/{flow_run_id}/cancel', platform.cancel_automation_flow, methods=['POST'])
router.add_api_route('/api/automation-flows/{flow_run_id}/retry-exploration', platform.retry_automation_flow_exploration, methods=['POST'])
router.add_api_route('/api/automation-flows/{flow_run_id}/data-provision/approve', platform.approve_automation_data_provision, methods=['POST'])
router.add_api_route('/api/automation-flows/{flow_run_id}/artifacts', platform.get_automation_flow_artifacts, methods=['GET'])
router.add_api_websocket_route('/ws/automation-flows/{flow_run_id}', platform.automation_flow_socket)
