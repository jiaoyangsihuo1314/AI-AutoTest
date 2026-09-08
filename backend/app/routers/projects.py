"""Route registrations for this platform domain."""

from fastapi import APIRouter

from .. import platform

router = APIRouter()

router.add_api_route('/api/projects', platform.projects, methods=['GET'])
router.add_api_route('/api/projects', platform.create_project, methods=['POST'])
router.add_api_route('/api/projects/{project_id}', platform.get_project, methods=['GET'])
router.add_api_route('/api/projects/{project_id}', platform.update_project, methods=['PATCH'])
router.add_api_route('/api/projects/{project_id}', platform.delete_project, methods=['DELETE'])
router.add_api_route('/api/project-environments/{environment_id}/variables', platform.project_environment_variables, methods=['GET'])
router.add_api_route('/api/project-environments/{environment_id}/variables', platform.update_project_environment_variables, methods=['PUT'])
router.add_api_route('/api/project-context', platform.get_project_context, methods=['GET'])
