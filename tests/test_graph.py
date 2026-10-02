"""Smoke test: graph compile đúng, schema đúng, không gọi LLM thật.

Chạy: pytest tests/ -v
(Không cần OPENAI_API_KEY/TAVILY_API_KEY cho các test này — chỉ kiểm tra
graph structure, không invoke.)
"""

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from langchain_core.messages import AIMessage

from agent.graph import batch_graph, graph, interview_builder
from agent.state import (
    Analyst,
    EvidenceReview,
    Perspectives,
    ResearchPlan,
    SearchQueries,
    SearchQuery,
)


def test_graph_compiles():
    """Graph tổng phải compile được không lỗi."""
    assert graph is not None


def test_interview_subgraph_compiles():
    """Sub-graph interview phải compile được độc lập."""
    compiled = interview_builder.compile()
    assert compiled is not None


def test_graph_has_expected_nodes():
    """Graph tổng phải có planning, synthesis và evidence audit."""
    node_names = set(graph.get_graph().nodes.keys())
    expected = {
        "load_research_profile",
        "plan_research",
        "create_analysts",
        "human_feedback",
        "human_review_section",
        "conduct_interview",
        "write_report",
        "write_introduction",
        "write_conclusion",
        "finalize_report",
        "audit_report",
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


def test_create_analysts_enforces_requested_limit(monkeypatch):
    """Provider trả dư persona cũng không được fan-out quá lựa chọn của user."""
    import agent.nodes as nodes

    class FakeStructuredLLM:
        def invoke(self, _messages):
            return Perspectives(
                analysts=[
                    Analyst(
                        affiliation="Lab",
                        name=f"Analyst {index}",
                        role="Researcher",
                        description="Evidence review",
                    )
                    for index in range(3)
                ]
            )

    class FakeLLM:
        def with_structured_output(self, _schema):
            return FakeStructuredLLM()

    monkeypatch.setattr(nodes, "get_llm", lambda: FakeLLM())
    result = nodes.create_analysts(
        {
            "topic": "A sufficiently detailed research topic",
            "report_language": "en",
            "research_depth": "deep",
            "research_plan": "Plan",
            "max_analysts": 1,
            "human_analyst_feedback": "",
        }
    )

    assert len(result["analysts"]) == 1


def test_grouped_citations_are_aliased_and_invalid_ids_removed():
    """Citation dạng [ID1, ID2] cũng phải được kiểm tra, không chỉ ID đơn."""
    import agent.nodes as nodes

    sources = [
        {
            "id": "A1-W1",
            "title": "Canonical",
            "url": "https://example.com/source",
        },
        {
            "id": "A2-W1",
            "title": "Duplicate URL",
            "url": "https://example.com/source/",
        },
    ]
    report, canonical = nodes._normalize_citations(
        "Supported [A2-W1, A9-W9] and again [A1-W1].", sources
    )

    assert report == "Supported [A1-W1] and again [A1-W1]."
    assert [source["id"] for source in canonical] == ["A1-W1"]


def test_llm_prefers_groq_when_env_is_configured(monkeypatch):
    """Khi có GROQ_API_KEY, ứng dụng phải chọn model Groq."""
    import agent.nodes as nodes

    monkeypatch.setenv("LLM_PROVIDER", "auto")
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


def test_batch_graph_runs_to_final_report_without_interrupts(monkeypatch):
    """CLI/API batch graph phải chạy xuyên suốt thay vì dừng ở human review."""
    import agent.memory as memory
    import agent.nodes as nodes

    class FakeStructuredLLM:
        def __init__(self, schema):
            self.schema = schema

        def invoke(self, _messages):
            if self.schema is Perspectives:
                return Perspectives(
                    analysts=[
                        Analyst(
                            affiliation="Test Lab",
                            name=f"Test Analyst {index}",
                            role="Researcher",
                            description="Tests the complete batch flow.",
                        )
                        for index in range(2)
                    ]
                )
            if self.schema is ResearchPlan:
                return ResearchPlan(
                    objective="Test the deep research pipeline.",
                    key_questions=[
                        "What evidence supports the topic?",
                        "What evidence contradicts it?",
                        "What are the implementation trade-offs?",
                    ],
                    source_priorities=["primary", "academic"],
                    success_criteria=["traceable citations", "explicit limitations"],
                )
            if self.schema is SearchQueries:
                return SearchQueries(
                    queries=["primary evidence", "counterevidence", "case study"]
                )
            if self.schema is EvidenceReview:
                return EvidenceReview(
                    usable_source_ids=["A1-W1", "A1-K1", "A2-W1", "A2-K1"],
                    evidence_gaps=["Long-term evidence is limited."],
                )
            if self.schema is SearchQuery:
                return SearchQuery(search_query="test query")
            raise AssertionError(f"Unexpected schema: {self.schema}")

    class FakeLLM:
        def with_structured_output(self, schema):
            return FakeStructuredLLM(schema)

        def invoke(self, _messages):
            # Gemini trả content blocks thay vì str; graph phải chuẩn hóa được.
            return AIMessage(
                content=[
                    {
                        "type": "text",
                        "text": "Mock research content with a source [1].",
                    }
                ]
            )

    class FakeTavilySearch:
        def __init__(self, **_kwargs):
            pass

        def invoke(self, _query):
            return {
                "results": [
                    {"url": "https://example.com", "content": "Example evidence."}
                ]
            }

    class FakeWikipediaLoader:
        def __init__(self, **_kwargs):
            pass

        def load(self):
            return [
                SimpleNamespace(
                    metadata={"source": "https://example.org", "page": "Test"},
                    page_content="Secondary evidence.",
                )
            ]

    class FakeExtractor:
        def invoke(self, _messages):
            return {"tool_calls": []}

    monkeypatch.setattr(nodes, "get_llm", lambda: FakeLLM())
    monkeypatch.setattr(nodes, "TavilySearch", FakeTavilySearch)
    monkeypatch.setattr(nodes, "WikipediaLoader", FakeWikipediaLoader)
    monkeypatch.setattr(memory, "get_profile_extractor", lambda: FakeExtractor())

    result = batch_graph.invoke(
        {
            "topic": "Smoke test",
            "research_depth": "deep",
            "report_language": "en",
            "max_analysts": 2,
            "human_analyst_feedback": "approve",
            "human_section_feedback": "approve",
        },
        {"configurable": {"user_id": "batch-test"}},
    )

    assert result["final_report"]
    assert "Mock research content" in result["final_report"]
    assert "https://example.com" in result["final_report"]
    assert result["audit_notes"]


def test_domain_context_is_bounded_and_marks_notebook_unverified():
    import agent.nodes as nodes

    context = nodes._domain_context(
        {
            "research_domain": "artificial-intelligence",
            "research_category": "nlp-llm-agents",
            "research_notes": "A working assumption that must be checked.",
            "latex_context": r"\\mathcal{L} = -\\sum_i y_i \\log p_i",
            "source_preferences": ["arXiv", "Papers with Code"],
        }
    )

    assert "Domain: artificial-intelligence" in context
    assert "Specialty: nlp-llm-agents" in context
    assert "unverified working context" in context
    assert "never independent evidence" in context
    assert "arXiv; Papers with Code" in context


def test_finalize_report_preserves_domain_and_category_metadata():
    import agent.nodes as nodes

    result = nodes.finalize_report(
        {
            "introduction": "# Domain report\n\nIntroduction.",
            "content": "Evidence-led analysis.",
            "conclusion": "## Conclusion\n\nConclusion.",
            "research_depth": "standard",
            "report_language": "en",
            "research_domain": "chemistry",
            "research_category": "materials-chemistry",
            "analysts": [],
            "sources": [],
        }
    )

    assert "**Domain:** chemistry · materials-chemistry." in result["final_report"]
