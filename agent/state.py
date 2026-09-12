"""State schemas cho Deep Research Agent.

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


# ---------------------------------------------------------------------------
# Sub-graph 1: sinh danh sách analyst (có human-in-the-loop ở v2)
# ---------------------------------------------------------------------------


class GenerateAnalystsState(TypedDict):
    topic: str
    max_analysts: int
    human_analyst_feedback: str
    analysts: List[Analyst]


# ---------------------------------------------------------------------------
# Sub-graph 2: 1 cuộc "phỏng vấn" analyst <-> expert (chạy song song qua Send)
# ---------------------------------------------------------------------------


class InterviewState(MessagesState):
    max_num_turns: int
    context: Annotated[list, operator.add]  # search_web + search_wikipedia gộp vào đây
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
    max_analysts: int
    human_analyst_feedback: str
    human_section_feedback: str  # feedback từ interrupt 2 (review section)
    research_profile: str  # profile đã format cho prompt (từ load_research_profile)
    user_id: str  # để track profile trong store
    analysts: List[Analyst]
    sections: Annotated[list, operator.add]  # mỗi interview ghi 1 section vào đây
    introduction: str
    content: str
    conclusion: str
    final_report: str
