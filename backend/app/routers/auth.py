"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/auth/login', platform.login, methods=['POST'])
router.add_api_route('/api/auth/logout', platform.logout, methods=['POST'])
router.add_api_route('/api/auth/register', platform.register, methods=['POST'])
router.add_api_route('/api/auth/me', platform.auth_me, methods=['GET'])
router.add_api_route('/api/auth/change-password', platform.change_password, methods=['POST'])
