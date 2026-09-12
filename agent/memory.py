"""Long-term memory cho Deep Research Agent (v3).

Sử dụng InMemoryStore (langgraph) + Trustcall để duy trì research profile
theo user_id — càng dùng càng cá nhân hoá.
"""

import os

try:
    from trustcall import create_extractor
except ImportError:  # pragma: no cover - optional dependency fallback
    create_extractor = None

from pydantic import BaseModel, Field
from typing import Any, Optional

from langgraph.store.base import BaseStore


class ResearchProfile(BaseModel):
    """Sở thích research của user, học dần qua các lần dùng."""

    preferred_sources: list[str] = Field(
        default_factory=list,
        description="Nguồn user hay yêu cầu ưu tiên, vd: ['arxiv', 'tiếng Việt only', 'tavily']",
    )
    preferred_depth: str = Field(
        default="balanced",
        description="'quick' | 'balanced' | 'deep' — độ sâu report user thường muốn",
    )
    past_topics: list[str] = Field(
        default_factory=list, description="Các topic đã research trước đây"
    )
    language: str = Field(
        default="vi",
        description="Ngôn ngữ ưu tiên cho report: 'vi' | 'en' | 'both'",
    )
    avoid_topics: list[str] = Field(
        default_factory=list,
        description="Chủ đề user không muốn research lại",
    )


# Lazy LLM initialization for tests
_llm = None
_profile_extractor = None


def get_llm():
    global _llm
    if _llm is None:
        groq_key = os.getenv("GROQ_API_KEY")
        if groq_key:
            try:
                from langchain_groq import ChatGroq

                model_name = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
                _llm = ChatGroq(
                    model=model_name,
                    groq_api_key=groq_key,
                    temperature=0,
                )
                return _llm
            except ImportError:
                pass

        gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if gemini_key:
            try:
                from langchain_google_genai import ChatGoogleGenerativeAI

                _llm = ChatGoogleGenerativeAI(
                    model="gemini-3.6-flash",
                    google_api_key=gemini_key,
                    temperature=0,
                )
                return _llm
            except ImportError:
                pass

        openai_key = os.getenv("OPENAI_API_KEY")
        if openai_key:
            from langchain_openai import ChatOpenAI
            _llm = ChatOpenAI(model="gpt-4o", temperature=0)
            return _llm

        raise RuntimeError(
            "No supported LLM API key found. Set GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY."
        )
    return _llm


def get_profile_extractor():
    global _profile_extractor
    if _profile_extractor is None:
        if create_extractor is None:
            class _FallbackExtractor:
                def invoke(self, *args, **kwargs):
                    return {"tool_calls": []}

            _profile_extractor = _FallbackExtractor()
        else:
            _profile_extractor = create_extractor(
                get_llm(), tools=[ResearchProfile], tool_choice="ResearchProfile"
            )
    return _profile_extractor


PROFILE_NAMESPACE = "research_profile"


def get_profile_namespace(user_id: str) -> tuple:
    """Namespace cho store: (collection, user_id)."""
    return (PROFILE_NAMESPACE, user_id)


def load_research_profile(
    state: dict, config: Optional[dict] = None, store: Optional[BaseStore] = None
) -> dict:
    """Node: đọc research profile từ store và đưa vào state.

    Đặt trước create_analysts để profile ảnh hưởng đến cách sinh analyst.
    Cũng hỗ trợ các phiên bản LangGraph cũ hơn, nơi config/store có thể
    không được tự inject đúng cách.
    """
    config = config or {}
    configurable = config.get("configurable", {}) if isinstance(config, dict) else {}
    user_id = configurable.get("user_id", state.get("user_id", "default"))
    namespace = get_profile_namespace(user_id)

    profile = {}
    if store is not None:
        try:
            existing = store.search(namespace)
            profile = existing[0].value if existing else {}
        except Exception:
            profile = {}

    # Format profile thành string để inject vào system prompt
    profile_str = _format_profile_for_prompt(profile)

    return {"research_profile": profile_str, "user_id": user_id}


def _format_profile_for_prompt(profile: dict) -> str:
    """Format profile thành string inject vào ANALYST_INSTRUCTIONS."""
    if not profile:
        return "Chưa có profile — dùng mặc định."

    parts = []
    if profile.get("preferred_sources"):
        parts.append(f"Nguồn ưu tiên: {', '.join(profile['preferred_sources'])}")
    if profile.get("preferred_depth"):
        parts.append(f"Độ sâu: {profile['preferred_depth']}")
    if profile.get("language"):
        parts.append(f"Ngôn ngữ: {profile['language']}")
    if profile.get("past_topics"):
        parts.append(f"Đã research: {', '.join(profile['past_topics'][-5:])}")  # 5 gần nhất
    if profile.get("avoid_topics"):
        parts.append(f"Tránh: {', '.join(profile['avoid_topics'])}")

    return "\n".join(parts) if parts else "Profile rỗng."


def save_research_profile(
    state: dict, config: Optional[dict] = None, store: Optional[BaseStore] = None
) -> dict:
    """Node: cập nhật profile sau khi hoàn thành 1 lần research.

    Dùng Trustcall extractor để trích xuất thông tin mới từ conversation
    và upsert vào store. Nếu dependency không sẵn, chỉ lưu profile tối thiểu
    vào state hiện có để graph vẫn chạy.
    """
    config = config or {}
    configurable = config.get("configurable", {}) if isinstance(config, dict) else {}
    user_id = configurable.get("user_id", state.get("user_id", "default"))
    namespace = get_profile_namespace(user_id)

    if store is None:
        return {}

    # Lấy profile hiện tại
    try:
        existing = store.search(namespace)
        current_profile = existing[0].value if existing else {}
    except Exception:
        current_profile = {}

    # Thêm topic hiện tại vào past_topics
    topic = state.get("topic", "")
    if topic and topic not in current_profile.get("past_topics", []):
        current_profile.setdefault("past_topics", []).append(topic)

    updated_profile = {}
    try:
        context = f"""
Current profile: {current_profile}
New research topic: {topic}
User feedback during research: {state.get('human_analyst_feedback', '')}
Section feedback: {state.get('human_section_feedback', '')}
"""

        result = get_profile_extractor().invoke(
            [{"role": "user", "content": context}]
        )

        for tool_call in result.get("tool_calls", []):
            if tool_call["name"] == "ResearchProfile":
                updated_profile = tool_call["args"]
                break
    except Exception:
        updated_profile = {}

    merged = {**current_profile, **updated_profile}
    if "past_topics" in current_profile:
        merged["past_topics"] = list(set(current_profile["past_topics"] + merged.get("past_topics", [])))

    try:
        store.put(namespace, user_id, merged)
    except Exception:
        pass

    return {}


def get_profile_for_analyst_instructions(user_id: str, store: BaseStore) -> str:
    """Helper: lấy profile đã format sẵn để inject vào ANALYST_INSTRUCTIONS.

    Dùng trong create_analysts node (cần truyền store qua config).
    """
    namespace = get_profile_namespace(user_id)
    existing = store.search(namespace)
    profile = existing[0].value if existing else {}
    return _format_profile_for_prompt(profile)