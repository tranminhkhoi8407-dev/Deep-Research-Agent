"""Ráp graph từ các node trong nodes.py.

2 tầng:
1. interview_builder: sub-graph 1 cuộc phỏng vấn (ask -> search song song
   -> answer -> lặp hoặc dừng -> save -> write_section).
2. builder: graph tổng — sinh analyst -> Send() N interview song song ->
   viết report/intro/conclusion song song -> gộp.

`graph` ở cuối file là export bắt buộc để `langgraph dev` (module-4/studio
pattern) hoặc LangGraph Platform tìm thấy graph qua langgraph.json.

v3: thêm InMemoryStore + load_research_profile / save_research_profile
cho long-term memory (research profile theo user_id).
"""

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.store.memory import InMemoryStore

from agent.memory import load_research_profile, save_research_profile
from agent.nodes import (
    assess_evidence,
    audit_report,
    create_analysts,
    finalize_report,
    generate_answer,
    generate_question,
    generate_search_queries,
    human_feedback,
    human_review_section,
    initiate_all_interviews,
    plan_research,
    route_messages,
    save_interview,
    search_second_source,
    search_web,
    write_conclusion,
    write_introduction,
    write_report,
    write_section,
)
from agent.state import GenerateAnalystsState, InterviewState, ResearchGraphState

# ---------------------------------------------------------------------------
# Sub-graph: 1 cuộc phỏng vấn
# ---------------------------------------------------------------------------

interview_builder = StateGraph(InterviewState)
interview_builder.add_node("ask_question", generate_question)
interview_builder.add_node("generate_search_queries", generate_search_queries)
interview_builder.add_node("search_web", search_web)
interview_builder.add_node("search_second_source", search_second_source)
interview_builder.add_node("assess_evidence", assess_evidence)
interview_builder.add_node("answer_question", generate_answer)
interview_builder.add_node("save_interview", save_interview)
interview_builder.add_node("write_section", write_section)

interview_builder.add_edge(START, "ask_question")
interview_builder.add_edge("ask_question", "generate_search_queries")
interview_builder.add_edge("generate_search_queries", "search_web")
interview_builder.add_edge("generate_search_queries", "search_second_source")
interview_builder.add_edge("search_web", "assess_evidence")
interview_builder.add_edge("search_second_source", "assess_evidence")
interview_builder.add_edge("assess_evidence", "answer_question")
interview_builder.add_conditional_edges(
    "answer_question", route_messages, ["ask_question", "save_interview"]
)
interview_builder.add_edge("save_interview", "write_section")
interview_builder.add_edge("write_section", END)

# A compiled subgraph returns its complete state. Passing that compiled graph
# directly to a Send() node makes every parallel analyst write shared scalar
# fields such as `topic`, which LangGraph correctly rejects as a concurrent
# update. Keep the rich state inside the interview and expose only the two
# reducer-backed outputs that the parent graph needs.
interview_graph = interview_builder.compile()


def conduct_interview(state: InterviewState) -> dict:
    result = interview_graph.invoke(state)
    return {
        "sections": result.get("sections", []),
        "sources": result.get("sources", []),
    }

# ---------------------------------------------------------------------------
# Graph tổng
# ---------------------------------------------------------------------------

builder = StateGraph(ResearchGraphState)
builder.add_node("load_research_profile", load_research_profile)
builder.add_node("plan_research", plan_research)
builder.add_node("create_analysts", create_analysts)
builder.add_node("human_feedback", human_feedback)
builder.add_node("conduct_interview", conduct_interview)
builder.add_node("human_review_section", human_review_section)
builder.add_node("write_report", write_report)
builder.add_node("write_introduction", write_introduction)
builder.add_node("write_conclusion", write_conclusion)
builder.add_node("finalize_report", finalize_report)
builder.add_node("audit_report", audit_report)
builder.add_node("save_research_profile", save_research_profile)

builder.add_edge(START, "load_research_profile")
builder.add_edge("load_research_profile", "plan_research")
builder.add_edge("plan_research", "create_analysts")
builder.add_edge("create_analysts", "human_feedback")
builder.add_conditional_edges(
    "human_feedback", initiate_all_interviews, ["create_analysts", "conduct_interview"]
)
builder.add_edge("conduct_interview", "human_review_section")
builder.add_edge("human_review_section", "write_report")
builder.add_edge("human_review_section", "write_introduction")
builder.add_edge("human_review_section", "write_conclusion")
builder.add_edge(["write_conclusion", "write_report", "write_introduction"], "finalize_report")
builder.add_edge("finalize_report", "audit_report")
builder.add_edge("audit_report", "save_research_profile")
builder.add_edge("save_research_profile", END)

# v3: compile với checkpointer + store + 2 interrupt
memory = MemorySaver()
store = InMemoryStore()
graph = builder.compile(
    interrupt_before=["human_feedback", "human_review_section"],
    checkpointer=memory,
    store=store,
)

# Dùng cho CLI --no-interrupt và REST background jobs. Hai luồng này phải chạy
# xuyên suốt, không được dừng tại các checkpoint dành cho người dùng review.
batch_graph = builder.compile(store=store)
