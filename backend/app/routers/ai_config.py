"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/ai-config', platform.get_ai_config, methods=['GET'])
router.add_api_route('/api/ai-config', platform.save_ai_config, methods=['POST'])
router.add_api_route('/api/ai-config/active', platform.set_active_ai_config, methods=['POST'])
router.add_api_route('/api/ai-config/{profile_id}/secret', platform.get_ai_config_secret, methods=['GET'])
router.add_api_route('/api/ai-config/test', platform.test_ai_config, methods=['POST'])
router.add_api_route('/api/ai-config', platform.clear_ai_config, methods=['DELETE'])
