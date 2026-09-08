"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/test-suites', platform.test_suites, methods=['GET'])
router.add_api_route('/api/test-suites', platform.create_test_suite, methods=['POST'])
router.add_api_route('/api/test-suites/{suite_id}', platform.get_test_suite, methods=['GET'])
router.add_api_route('/api/test-suites/{suite_id}', platform.update_test_suite, methods=['PATCH'])
router.add_api_route('/api/test-suites/{suite_id}', platform.delete_test_suite, methods=['DELETE'])
router.add_api_route('/api/test-suites/{suite_id}/cases', platform.update_test_suite_cases, methods=['PUT'])
