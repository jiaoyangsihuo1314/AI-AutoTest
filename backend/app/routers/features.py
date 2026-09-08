"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/features', platform.feature_menus, methods=['GET'])
router.add_api_route('/api/features', platform.create_feature_menu, methods=['POST'])
router.add_api_route('/api/features/{feature_id}', platform.update_feature_menu, methods=['PATCH'])
router.add_api_route('/api/features/{feature_id}', platform.delete_feature_menu, methods=['DELETE'])
