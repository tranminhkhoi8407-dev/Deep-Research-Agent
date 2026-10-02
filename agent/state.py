"""State schemas cho Nexora Agent.

Tách riêng khỏi node logic (khác bản gốc research_assistant.py gộp
chung 1 file) để dễ import từ nhiều module khi project lớn dần qua
các version v1 -> v4.
"""

import operator
from typing import Annotated, List

from langchain_core.messages import AnyMessage
from langgraph.graph import MessagesState
from pydantic import BaseModel, Field
from typing_extensions import TypedDict


# ---------------------------------------------------------------------------
# Analyst persona
# ---------------------------------------------------------------------------


class Analyst(BaseModel):
    """Một 'nhà phân tích' AI với góc nhìn riêng về chủ đề nghiên cứu."""

    affiliation: str = Field(description="Tổ chức/lĩnh vực mà analyst đại diện.")
    name: str = Field(description="Tên của analyst.")
    role: str = Field(description="Vai trò của analyst trong bối cảnh chủ đề.")
    description: str = Field(
        description="Mô tả trọng tâm, mối quan tâm, và động cơ của analyst."
    )

    @property
    def persona(self) -> str:
        return (
            f"Name: {self.name}\n"
            f"Role: {self.role}\n"
            f"Affiliation: {self.affiliation}\n"
            f"Description: {self.description}\n"
        )


class Perspectives(BaseModel):
    """Wrapper cho structured output khi LLM sinh danh sách analyst."""

    analysts: List[Analyst] = Field(
        description="Danh sách đầy đủ các analyst kèm vai trò và tổ chức đại diện."
    )


class ResearchPlan(BaseModel):
    """Kế hoạch nghiên cứu có cấu trúc được tạo trước khi chia analyst."""

    objective: str = Field(description="Mục tiêu nghiên cứu rõ ràng và có thể kiểm chứng.")
    key_questions: List[str] = Field(
        description="Các câu hỏi trọng tâm mà báo cáo phải trả lời."
    )
    source_priorities: List[str] = Field(
        description="Nhóm nguồn ưu tiên: primary, official, academic, industry."
    )
    success_criteria: List[str] = Field(
        description="Tiêu chí để đánh giá báo cáo đã đủ sâu và hữu ích."
    )


class SearchQueries(BaseModel):
    """Danh sách truy vấn đa góc nhìn cho một câu hỏi nghiên cứu."""

    queries: List[str] = Field(
        description="Các truy vấn độc lập, cụ thể và không trùng ý."
    )


class EvidenceReview(BaseModel):
    """Kết quả sàng lọc nguồn trước khi expert được phép sử dụng."""

    usable_source_ids: List[str] = Field(
        description="ID nguồn liên quan và đủ tin cậy để trả lời câu hỏi hiện tại."
    )
    rejected_source_ids: List[str] = Field(
        default_factory=list,
        description="ID nguồn lạc đề, yếu, quảng cáo hoặc không có bằng chứng hữu ích.",
    )
    evidence_gaps: List[str] = Field(
        default_factory=list,
        description="Các khoảng trống bằng chứng còn lại sau khi sàng lọc.",
    )
    conflicts: List[str] = Field(
        default_factory=list,
        description="Các mâu thuẫn quan trọng giữa những nguồn được giữ lại.",
    )


# ---------------------------------------------------------------------------
# Sub-graph 1: sinh danh sách analyst (có human-in-the-loop ở v2)
# ---------------------------------------------------------------------------


class GenerateAnalystsState(TypedDict):
    topic: str
    report_language: str
    research_depth: str
    research_domain: str
    research_category: str
    research_notes: str
    latex_context: str
    source_preferences: List[str]
    research_plan: str
    max_analysts: int
    human_analyst_feedback: str
    analysts: List[Analyst]


# ---------------------------------------------------------------------------
# Sub-graph 2: 1 cuộc "phỏng vấn" analyst <-> expert (chạy song song qua Send)
# ---------------------------------------------------------------------------


class InterviewState(MessagesState):
    topic: str
    report_language: str
    research_depth: str
    research_domain: str
    research_category: str
    research_notes: str
    latex_context: str
    source_preferences: List[str]
    research_plan: str
    source_prefix: str
    max_num_turns: int
    search_queries: List[str]
    context: Annotated[list, operator.add]  # search_web + search_wikipedia gộp vào đây
    sources: Annotated[list, operator.add]
    verified_source_ids: List[str]
    evidence_summary: str
    analyst: Analyst
    interview: str
    sections: list  # duplicate key để Send() map ngược lên ResearchGraphState


class SearchQuery(BaseModel):
    search_query: str = Field(description="Câu truy vấn dùng cho web search / retrieval.")


# ---------------------------------------------------------------------------
# Graph tổng: gộp N interview -> report hoàn chỉnh
# ---------------------------------------------------------------------------


class ResearchGraphState(TypedDict):
    topic: str
    report_language: str
    research_depth: str
    research_domain: str
    research_category: str
    research_notes: str
    latex_context: str
    source_preferences: List[str]
    research_plan: str
    research_questions: List[str]
    max_analysts: int
    human_analyst_feedback: str
    human_section_feedback: str  # feedback từ interrupt 2 (review section)
    research_profile: str  # profile đã format cho prompt (từ load_research_profile)
    user_id: str  # để track profile trong store
    analysts: List[Analyst]
    sections: Annotated[list, operator.add]  # mỗi interview ghi 1 section vào đây
    sources: Annotated[list, operator.add]
    introduction: str
    content: str
    conclusion: str
    final_report: str
    audit_notes: str
