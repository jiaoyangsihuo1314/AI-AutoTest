"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/runs', platform.create_run, methods=['POST'])
router.add_api_route('/api/runs', platform.runs, methods=['GET'])
router.add_api_route('/api/runs/{run_id}', platform.get_run, methods=['GET'])
router.add_api_route('/api/runs/{run_id}/logs', platform.run_logs, methods=['GET'])
router.add_api_route('/api/runs/{run_id}/screenshot', platform.run_screenshot, methods=['GET'])
