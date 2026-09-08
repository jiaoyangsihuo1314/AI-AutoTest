"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/users', platform.users, methods=['GET'])
router.add_api_route('/api/users', platform.create_user, methods=['POST'])
router.add_api_route('/api/users/{user_id}', platform.update_user, methods=['PATCH'])
router.add_api_route('/api/users/{user_id}', platform.delete_user, methods=['DELETE'])
router.add_api_route('/api/users/{user_id}/reset-password', platform.reset_user_password, methods=['POST'])
