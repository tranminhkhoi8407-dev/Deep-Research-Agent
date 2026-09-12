"""Smoke test: graph compile đúng, schema đúng, không gọi LLM thật.

Chạy: pytest tests/ -v
(Không cần OPENAI_API_KEY/TAVILY_API_KEY cho các test này — chỉ kiểm tra
graph structure, không invoke.)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agent.graph import graph, interview_builder
from agent.state import Analyst, Perspectives


def test_graph_compiles():
    """Graph tổng phải compile được không lỗi."""
    assert graph is not None


def test_interview_subgraph_compiles():
    """Sub-graph interview phải compile được độc lập."""
    compiled = interview_builder.compile()
    assert compiled is not None


def test_graph_has_expected_nodes():
    """Graph tổng phải có đủ 10 node theo kiến trúc v3 (thêm load/save profile)."""
    node_names = set(graph.get_graph().nodes.keys())
    expected = {
        "load_research_profile",
        "create_analysts",
        "human_feedback",
        "human_review_section",
        "conduct_interview",
        "write_report",
        "write_introduction",
        "write_conclusion",
        "finalize_report",
        "save_research_profile",
    }
    assert expected.issubset(node_names)


def test_analyst_persona_format():
    """Analyst.persona phải chứa đủ 4 trường, đúng format dùng trong prompt."""
    analyst = Analyst(
        affiliation="Test University",
        name="Dr. Test",
        role="Skeptic",
        description="Focuses on failure modes.",
    )
    persona = analyst.persona
    assert "Test University" in persona
    assert "Dr. Test" in persona
    assert "Skeptic" in persona
    assert "Focuses on failure modes." in persona


def test_perspectives_wraps_analyst_list():
    """Perspectives phải nhận đúng 1 list Analyst (dùng cho structured output)."""
    analyst = Analyst(affiliation="A", name="B", role="C", description="D")
    perspectives = Perspectives(analysts=[analyst])
    assert len(perspectives.analysts) == 1
    assert perspectives.analysts[0].name == "B"


def test_llm_prefers_groq_when_env_is_configured(monkeypatch):
    """Khi có GROQ_API_KEY, ứng dụng phải chọn model Groq."""
    import agent.nodes as nodes

    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    nodes._llm = None

    llm = nodes.get_llm()
    assert type(llm).__name__ == "ChatGroq"


def test_memory_profile_functions_work_without_trustcall():
    """Profile loader/save phải hoạt động dù trustcall không cài hoặc config bị bỏ trống."""
    from agent.memory import load_research_profile, save_research_profile

    class FakeStore:
        def __init__(self):
            self.data = {}

        def search(self, namespace):
            key = namespace[-1] if isinstance(namespace, tuple) else namespace
            value = self.data.get(key)
            return [{"value": value}] if value is not None else []

        def put(self, namespace, key, value):
            self.data[key] = value

    store = FakeStore()
    state = {
        "topic": "RAG vs fine-tuning cho chatbot tiếng Việt",
        "human_analyst_feedback": "approve",
        "human_section_feedback": "approve",
    }

    loaded = load_research_profile(state, {"configurable": {"user_id": "u1"}}, store)
    assert isinstance(loaded.get("research_profile", ""), str)

    saved = save_research_profile(state, {"configurable": {"user_id": "u1"}}, store)
    assert isinstance(saved, dict)
    assert store.search(("research_profile", "u1"))
