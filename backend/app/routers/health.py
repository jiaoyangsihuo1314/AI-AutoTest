"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/health', platform.health, methods=['GET'])
router.add_api_route('/api/test/reset', platform.reset_test_data, methods=['POST'])
