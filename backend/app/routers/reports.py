"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/reports/playwright/runs/{run_id}', platform.playwright_run_report, methods=['GET'])
router.add_api_route('/reports/playwright/suite-runs/{suite_run_id}', platform.playwright_suite_report, methods=['GET'])
router.add_api_route('/reports/playwright/', platform.playwright_report_index, methods=['GET'])
router.add_api_route('/reports/playwright/{asset_path:path}', platform.playwright_report_asset, methods=['GET'])
router.add_api_route('/reports/deliverables/{deliverable_id}', platform.rendered_deliverable_report, methods=['GET'], response_model=None)
router.add_api_route('/reports/report-records/{report_id}', platform.rendered_report_record, methods=['GET'], response_model=None)
router.add_api_route('/reports/file', platform.rendered_report_file, methods=['GET'], response_model=None)
router.add_api_route('/reports/files/{asset_path:path}', platform.report_file_asset, methods=['GET'])
router.add_api_route('/api/report', platform.report, methods=['GET'])
