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
    create_analysts,
    finalize_report,
    generate_answer,
    generate_question,
    human_feedback,
    human_review_section,
    initiate_all_interviews,
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
interview_builder.add_node("search_web", search_web)
interview_builder.add_node("search_second_source", search_second_source)
interview_builder.add_node("answer_question", generate_answer)
interview_builder.add_node("save_interview", save_interview)
interview_builder.add_node("write_section", write_section)

interview_builder.add_edge(START, "ask_question")
interview_builder.add_edge("ask_question", "search_web")
interview_builder.add_edge("ask_question", "search_second_source")  # fan-out song song
interview_builder.add_edge("search_web", "answer_question")
interview_builder.add_edge("search_second_source", "answer_question")  # fan-in tự động
interview_builder.add_conditional_edges(
    "answer_question", route_messages, ["ask_question", "save_interview"]
)
interview_builder.add_edge("save_interview", "write_section")
interview_builder.add_edge("write_section", END)

# ---------------------------------------------------------------------------
# Graph tổng
# ---------------------------------------------------------------------------

builder = StateGraph(ResearchGraphState)
builder.add_node("load_research_profile", load_research_profile)
builder.add_node("create_analysts", create_analysts)
builder.add_node("human_feedback", human_feedback)
builder.add_node("conduct_interview", interview_builder.compile())
builder.add_node("human_review_section", human_review_section)
builder.add_node("write_report", write_report)
builder.add_node("write_introduction", write_introduction)
builder.add_node("write_conclusion", write_conclusion)
builder.add_node("finalize_report", finalize_report)
builder.add_node("save_research_profile", save_research_profile)

builder.add_edge(START, "load_research_profile")
builder.add_edge("load_research_profile", "create_analysts")
builder.add_edge("create_analysts", "human_feedback")
builder.add_conditional_edges(
    "human_feedback", initiate_all_interviews, ["create_analysts", "conduct_interview"]
)
builder.add_edge("conduct_interview", "human_review_section")
builder.add_edge("human_review_section", "write_report")
builder.add_edge("human_review_section", "write_introduction")
builder.add_edge("human_review_section", "write_conclusion")
builder.add_edge(["write_conclusion", "write_report", "write_introduction"], "finalize_report")
builder.add_edge("finalize_report", "save_research_profile")
builder.add_edge("save_research_profile", END)

# v3: compile với checkpointer + store + 2 interrupt
memory = MemorySaver()
store = InMemoryStore()
graph = builder.compile(
    interrupt_before=["human_feedback", "human_review_section"],
    checkpointer=memory,
    store=store,
)
