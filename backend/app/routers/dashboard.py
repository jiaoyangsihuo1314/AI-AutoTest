"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/dashboard-summary', platform.dashboard_summary, methods=['GET'])
