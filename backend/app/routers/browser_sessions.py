"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/work-items/{work_item_id}/browser-session', platform.create_browser_session, methods=['POST'])
router.add_api_websocket_route('/ws/browser-sessions/{session_id}', platform.browser_session_socket)
