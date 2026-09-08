"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/suite-runs', platform.create_suite_run, methods=['POST'])
router.add_api_route('/api/suite-runs', platform.suite_runs, methods=['GET'])
router.add_api_route('/api/suite-runs/{suite_run_id}', platform.get_suite_run, methods=['GET'])
router.add_api_route('/api/suite-runs/{suite_run_id}', platform.delete_suite_run, methods=['DELETE'])
router.add_api_route('/api/suite-runs/{suite_run_id}/logs', platform.suite_run_logs, methods=['GET'])
