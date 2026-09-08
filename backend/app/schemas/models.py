"""Pydantic request models used by the API routers."""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class RunRequest(BaseModel):
    suite_id: str
    environment_id: str = ""


class WorkItemRunRequest(BaseModel):
    environment_id: str = ""


class WorkItemRequest(BaseModel):
    project_id: str = ""
    feature_id: str = ""
    title: str = ""
    title_mode: Optional[str] = None
    requirement: str
    target_url: str = ""
    role: str = ""
    test_data: str = ""
    acceptance: str = ""
    exclusions: str = ""
    asset_mode: str = "create"
    case_ids: list[str] = Field(default_factory=list)


class WorkItemPatchRequest(BaseModel):
    feature_id: Optional[str] = None
    title: Optional[str] = None
    title_mode: Optional[str] = None
    requirement: Optional[str] = None
    target_url: Optional[str] = None
    role: Optional[str] = None
    test_data: Optional[str] = None
    acceptance: Optional[str] = None
    exclusions: Optional[str] = None


class AutomationFlowRequest(BaseModel):
    requirement: str
    project_id: str = ""
    feature_id: str = ""
    asset_mode: str = "create"
    case_ids: list[str] = Field(default_factory=list)


class DataProvisionApprovalRequest(BaseModel):
    provider_id: str
    plan_hash: str


class ExplorationRequest(BaseModel):
    notes: str = ""
    screenshot_path: str = ""
    page_structure: str = ""
    state_evidence: list[dict[str, Any]] = Field(default_factory=list)
    elements: list[dict[str, Any]] = []


class ExplorationTargetOverride(BaseModel):
    target_id: str
    locator_type: str
    locator_value: str
    locator_role: str = ""
    name: str = ""


class ExplorationRunRequest(BaseModel):
    retry_run_id: str = ""
    journey_id: str = ""
    target_overrides: list[ExplorationTargetOverride] = Field(default_factory=list)


class ContentRequest(BaseModel):
    content: str = ""
    generation_source: str = ""
    fixture_content: str = ""
    asset_mode: str = ""
    case_ids: list[str] = Field(default_factory=list)
    deleted_case_ids: list[str] = Field(default_factory=list)
    regenerate_fixture: bool = False
    base_cases_revision_id: Optional[int] = None
    assistant_proposals: list[dict[str, Any]] = Field(default_factory=list)
    debug_session_id: str = ""


class CaseAssistantTarget(BaseModel):
    case_ids: list[str] = Field(default_factory=list)
    fields: list[str] = Field(default_factory=list)


class CaseAssistantMessageRequest(BaseModel):
    message: str
    draft_markdown: str = ""
    base_cases_revision_id: Optional[int] = None
    target: CaseAssistantTarget = Field(default_factory=CaseAssistantTarget)


class CaseAssistantApplyRequest(BaseModel):
    draft_markdown: str
    operation_ids: list[str] = Field(default_factory=list)


class CaseAssistantRejectRequest(BaseModel):
    reason: str = ""


class GlobalAssistantConversationCreateRequest(BaseModel):
    title: str = ""


class GlobalAssistantConversationPatchRequest(BaseModel):
    title: str


class GlobalAssistantMessageRequest(BaseModel):
    message: str
    request_id: str = ""


class SaveArtifactsRequest(BaseModel):
    run_id: str = ""
    cases_markdown: str = ""
    script_content: str = ""
    report_content: str = ""
    asset_mode: str = ""
    case_ids: list[str] = Field(default_factory=list)


class ScriptDraftRequest(BaseModel):
    content: str = ""


class CaseDebugSessionCreateRequest(BaseModel):
    expected_case_updated_at: str = ""
    execution_policy: Literal["strict-single", "dependency-aware"] = "strict-single"


class CaseDebugCaseDraftRequest(BaseModel):
    content: str
    base_case_revision_id: Optional[int] = None


class CaseDebugScriptDraftRequest(BaseModel):
    content: str = ""


class CaseDebugRunRequest(BaseModel):
    script_version_id: str = ""
    environment_id: str = ""
    execution_scope: Literal["auto", "single", "group"] = "auto"


class CaseDebugPublishRequest(BaseModel):
    run_id: str = ""
    script_version_id: str = ""


class CaseDebugSyncRequest(BaseModel):
    expected_case_updated_at: str = ""


class CaseDebugBatchRequest(BaseModel):
    case_ids: list[str] = Field(default_factory=list)
    environment_id: str = ""


class HealRequest(BaseModel):
    failure_summary: str = ""
    proposed_fix: str = ""
    environment_id: str = ""


class ClearPageDataRequest(BaseModel):
    page: str


class AIConfigRequest(BaseModel):
    id: str = ""
    name: str = ""
    provider: str = "openai"
    api_key: str = ""
    model: str = ""
    base_url: str = ""
    api_protocol: str = ""
    structured_output_mode: str = ""
    capability_verified_at: str = ""


class AIActiveConfigRequest(BaseModel):
    profile_id: str = ""


class ProjectEnvironmentInput(BaseModel):
    id: str = ""
    name: str
    url: str
    is_default: bool = False


class EnvironmentVariableInput(BaseModel):
    name: str
    value: str = ""
    is_secret: bool = False
    clear: bool = False


class EnvironmentVariablesRequest(BaseModel):
    items: list[EnvironmentVariableInput] = Field(default_factory=list)


class TestCaseImportCommitRequest(BaseModel):
    project_id: str
    feature_id: str = ""
    environment_id: str = ""
    verify: bool = False


class ProjectRequest(BaseModel):
    name: str
    project_code: str = ""
    project_type: str = "product"
    status: str = "active"
    target_url: str = ""
    repository_path: str = ""
    test_dir: str = "tests/e2e"
    description: str = ""
    environments: Optional[list[ProjectEnvironmentInput]] = None


class ProjectPatchRequest(BaseModel):
    name: Optional[str] = None
    project_code: Optional[str] = None
    project_type: Optional[str] = None
    status: Optional[str] = None
    target_url: Optional[str] = None
    repository_path: Optional[str] = None
    test_dir: Optional[str] = None
    description: Optional[str] = None
    environments: Optional[list[ProjectEnvironmentInput]] = None


class TestCaseRequest(BaseModel):
    project_id: str = ""
    work_item_id: str = ""
    feature_id: str = ""
    external_id: str = ""
    title: str
    priority: str = "P1"
    requirement: str = ""
    preconditions: str = ""
    steps: str = ""
    expected: str = ""
    automation_notes: str = ""
    automation_status: str = "manual"
    spec_path: str = ""


class TestCasePatchRequest(BaseModel):
    feature_id: Optional[str] = None
    title: Optional[str] = None
    title_mode: Optional[str] = None
    priority: Optional[str] = None
    requirement: Optional[str] = None
    preconditions: Optional[str] = None
    steps: Optional[str] = None
    expected: Optional[str] = None
    automation_notes: Optional[str] = None
    automation_status: Optional[str] = None
    spec_path: Optional[str] = None


class TestCaseBulkDeleteRequest(BaseModel):
    case_ids: list[str] = Field(default_factory=list)


class CaseReportDeleteItem(BaseModel):
    case_id: str = ""
    run_id: str = ""


class CaseReportBulkDeleteRequest(BaseModel):
    items: list[CaseReportDeleteItem] = Field(default_factory=list)


class ManualReportBulkDeleteRequest(BaseModel):
    report_ids: list[str] = Field(default_factory=list)


class ReportRecordBulkDeleteRequest(BaseModel):
    report_ids: list[str] = Field(default_factory=list)


class FeatureMenuRequest(BaseModel):
    project_id: str = ""
    parent_id: str = ""
    name: str
    description: str = ""
    sort_order: int = 0
    is_active: bool = True


class FeatureMenuPatchRequest(BaseModel):
    parent_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class DeliverableRequest(BaseModel):
    project_id: str = ""
    feature_id: str = ""
    work_item_id: str = ""
    case_id: str = ""
    run_id: str = ""
    type: str
    name: str
    status: str = "ready"
    file_path: str = ""
    content: str = ""
    summary: str = ""


class SuiteRequest(BaseModel):
    project_id: str = ""
    name: str
    description: str = ""
    filter: dict[str, Any] = Field(default_factory=dict)
    status: str = "active"
    run_config: dict[str, Any] = Field(default_factory=dict)
    schedule_config: dict[str, Any] = Field(default_factory=dict)


class SuitePatchRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    filter: Optional[dict[str, Any]] = None
    status: Optional[str] = None
    run_config: Optional[dict[str, Any]] = None
    schedule_config: Optional[dict[str, Any]] = None


class SuiteCaseUpdateRequest(BaseModel):
    case_ids: list[str] = Field(default_factory=list)


class SuiteRunRequest(BaseModel):
    suite_id: str = ""
    case_ids: list[str] = Field(default_factory=list)
    environment_id: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    display_name: str = ""
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UserCreateRequest(BaseModel):
    username: str
    display_name: str = ""
    password: str
    role: str = "viewer"
    status: str = "active"


class UserPatchRequest(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    password: str
