"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/deliverables', platform.deliverables, methods=['GET'])
router.add_api_route('/api/delivery-report', platform.delivery_report, methods=['GET'])
router.add_api_route('/api/case-reports', platform.case_reports, methods=['GET'])
router.add_api_route('/api/case-reports/bulk-delete', platform.bulk_delete_case_reports, methods=['POST'])
router.add_api_route('/api/case-reports/{case_id}/history', platform.case_report_history, methods=['GET'])
router.add_api_route('/api/manual-reports', platform.manual_reports, methods=['GET'])
router.add_api_route('/api/manual-reports/bulk-delete', platform.bulk_delete_manual_reports, methods=['POST'])
router.add_api_route('/api/manual-reports/{work_item_id}/history', platform.manual_report_history, methods=['GET'])
router.add_api_route('/api/report-records/bulk-delete', platform.bulk_delete_report_records, methods=['POST'])
router.add_api_route('/api/report-records/{report_id}', platform.report_record_detail, methods=['GET'])
router.add_api_route('/api/deliverables', platform.create_deliverable, methods=['POST'])
