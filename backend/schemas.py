"""Pydantic schemas cho API request/response."""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime


# Request/Response cho REST endpoints
class ResearchRequest(BaseModel):
    topic: str = Field(..., description="Chủ đề nghiên cứu")
    max_analysts: int = Field(default=3, ge=1, le=10, description="Số analyst song song")
    user_id: str = Field(default="default", description="User ID cho long-term memory")
    report_language: Literal["vi", "en"] = Field(
        default="vi", description="Ngôn ngữ của nội dung báo cáo"
    )
    research_depth: Literal["quick", "standard", "deep"] = Field(
        default="standard", description="Mức độ sâu của pipeline nghiên cứu"
    )
    research_domain: str = Field(default="general", max_length=80)
    research_category: str = Field(default="", max_length=120)
    research_notes: str = Field(default="", max_length=10_000)
    latex_context: str = Field(default="", max_length=4_000)
    source_preferences: list[str] = Field(default_factory=list, max_length=12)


class ResearchResponse(BaseModel):
    session_id: str
    status: str = "started"
    message: str = "Research started"


class ProfileUpdateRequest(BaseModel):
    """Editable public profile fields; authentication identity stays provider-owned."""
    # Omission keeps older profile clients compatible; an explicit empty/null
    # name is never allowed to remove a reserved identity or bypass onboarding.
    public_name: str | None = Field(default=None, max_length=120)
    display_name: str = Field(default="", max_length=80)
    bio: str = Field(default="", max_length=360)
    location: str = Field(default="", max_length=80)
    organization: str = Field(default="", max_length=120)
    website: str = Field(default="", max_length=240)
    research_interests: list[str] = Field(default_factory=list, max_length=8)


class ReportResponse(BaseModel):
    session_id: str
    topic: str
    final_report: str
    created_at: datetime
    status: str = "completed"


# WebSocket message types
class WSMessage(BaseModel):
    """Base WebSocket message."""
    event: str
    data: Dict[str, Any] = {}


class WSResearchStart(BaseModel):
    """Client -> Server: bắt đầu research."""
    topic: str
    max_analysts: int = 3
    user_id: str = "default"
    session_id: Optional[str] = None
    research_domain: str = "general"
    research_category: str = ""
    research_notes: str = ""
    latex_context: str = ""
    source_preferences: list[str] = Field(default_factory=list, max_length=12)


class WSNodeUpdate(BaseModel):
    """Server -> Client: update tiến trình node."""
    event: str = "node_complete"
    node: str
    timestamp: datetime
    details: Optional[str] = None


class WSAnalystList(BaseModel):
    """Server -> Client: danh sách analyst sinh ra (tại interrupt 1)."""
    event: str = "analysts_generated"
    analysts: List[Dict[str, str]]  # name, role, affiliation, description


class WSSectionList(BaseModel):
    """Server -> Client: danh sách section hoàn thành (tại interrupt 2)."""
    event: str = "sections_completed"
    sections: List[str]  # section content/title


class WSFEedbackRequest(BaseModel):
    """Server -> Client: yêu cầu feedback từ user."""
    event: str = "feedback_requested"
    interrupt_type: str  # "human_feedback" | "human_review_section"
    message: str
    options: List[str] = []


class WSFeedbackSubmit(BaseModel):
    """Client -> Server: user submit feedback."""
    event: str = "feedback_submit"
    feedback: str


class WSReportComplete(BaseModel):
    """Server -> Client: report hoàn tất."""
    event: str = "report_complete"
    final_report: str
    filepath: str
    source_count: int = 0
    research_depth: str = "standard"
    audit_notes: Optional[str] = None


class WSError(BaseModel):
    """Server -> Client: lỗi."""
    event: str = "error"
    message: str
    details: Optional[str] = None


# Union type cho tất cả message types có thể nhận từ client
class WSClientMessage(BaseModel):
    """Union của các message client có thể gửi."""
    event: str
    topic: Optional[str] = None
    max_analysts: Optional[int] = None
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    feedback: Optional[str] = None
    report_language: Optional[Literal["vi", "en"]] = "vi"
    research_depth: Optional[Literal["quick", "standard", "deep"]] = "standard"
    research_domain: Optional[str] = Field(default="general", max_length=80)
    research_category: Optional[str] = Field(default="", max_length=120)
    research_notes: Optional[str] = Field(default="", max_length=10_000)
    latex_context: Optional[str] = Field(default="", max_length=4_000)
    source_preferences: list[str] = Field(default_factory=list, max_length=12)
