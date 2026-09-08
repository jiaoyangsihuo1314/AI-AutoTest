"""Global AI assistant routes."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/global-assistant/conversations', platform.get_global_assistant_conversations, methods=['GET'])
router.add_api_route('/api/global-assistant/conversations', platform.create_global_assistant_conversation, methods=['POST'])
router.add_api_route('/api/global-assistant/conversations/{conversation_id}', platform.update_global_assistant_conversation, methods=['PATCH'])
router.add_api_route('/api/global-assistant/conversations/{conversation_id}', platform.delete_global_assistant_conversation, methods=['DELETE'])
router.add_api_route('/api/global-assistant/conversations/{conversation_id}/messages', platform.get_global_assistant_messages, methods=['GET'])
router.add_api_route('/api/global-assistant/conversations/{conversation_id}/messages/stream', platform.stream_global_assistant_message, methods=['POST'])
router.add_api_route('/api/global-assistant/generations/{request_id}/cancel', platform.cancel_global_assistant_generation, methods=['POST'])
router.add_api_route('/api/global-assistant/actions/{action_id}', platform.get_global_assistant_action, methods=['GET'])
router.add_api_route('/api/global-assistant/actions/{action_id}/approve', platform.approve_global_assistant_action, methods=['POST'])
router.add_api_route('/api/global-assistant/actions/{action_id}/reject', platform.reject_global_assistant_action, methods=['POST'])
