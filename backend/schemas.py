"""Pydantic schemas cho API request/response."""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# Request/Response cho REST endpoints
class ResearchRequest(BaseModel):
    topic: str = Field(..., description="Chủ đề nghiên cứu")
    max_analysts: int = Field(default=3, ge=1, le=10, description="Số analyst song song")
    user_id: str = Field(default="default", description="User ID cho long-term memory")


class ResearchResponse(BaseModel):
    session_id: str
    status: str = "started"
    message: str = "Research started"


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