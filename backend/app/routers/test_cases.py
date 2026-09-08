"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/test-cases', platform.test_cases, methods=['GET'])
router.add_api_route('/api/test-cases', platform.create_test_case, methods=['POST'])
router.add_api_route('/api/test-cases/{case_id}', platform.update_test_case, methods=['PATCH'])
router.add_api_route('/api/test-cases/bulk-delete', platform.bulk_delete_test_cases, methods=['POST'])
router.add_api_route('/api/test-cases/{case_id}', platform.delete_test_case, methods=['DELETE'])
router.add_api_route('/api/test-cases/{case_id}/debug-sessions', platform.create_case_debug_session, methods=['POST'])
router.add_api_route('/api/test-case-imports/preview', platform.preview_test_case_import, methods=['POST'])
router.add_api_route('/api/test-case-imports/{import_id}/commit', platform.commit_test_case_import, methods=['POST'])
router.add_api_route('/api/test-case-imports/{import_id}', platform.get_test_case_import, methods=['GET'])
router.add_api_route('/api/script-versions/{script_version_id}', platform.get_script_version, methods=['GET'])
router.add_api_route('/api/script-versions/{script_version_id}/draft', platform.create_script_version_draft, methods=['POST'])
