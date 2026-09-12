"""Node functions cho Deep Research Agent (v1 — core loop).

Kiến trúc: create_analysts -> [human_feedback: no-op, dùng cho v2] ->
initiate_all_interviews (Send x N) -> N x conduct_interview (sub-graph) ->
write_report / write_introduction / write_conclusion (song song) ->
finalize_report.

Mỗi conduct_interview lại tự fan-out search_web + search_second_source
song song (parallelization lồng trong map-reduce lồng trong sub-graph —
đúng 3 tầng kỹ thuật của module-4).
"""

import os

from langchain_community.document_loaders import ArxivLoader, WikipediaLoader
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    get_buffer_string,
)
from langchain_tavily import TavilySearch
from langgraph.types import Send

from agent import prompts
from agent.state import (
    Analyst,
    GenerateAnalystsState,
    InterviewState,
    Perspectives,
    ResearchGraphState,
    SearchQuery,
)

# Lazy LLM initialization — avoids requiring API key at import time (for tests)
_llm = None


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


# "wikipedia" hoặc "arxiv" — đổi tuỳ chủ đề nghiên cứu (kỹ thuật/học thuật
# nên dùng "arxiv"; chủ đề phổ thông giữ "wikipedia"). Xem README phần v1.
SECOND_SOURCE = "wikipedia"


def _ensure_user_final_turn(messages: list):
    """Gemini requires the final message in a request to be a user or function response.
    LangGraph often leaves the final turn as an AI message, which triggers
    "model prefilling" errors. Append a neutral human message when needed."""
    if not messages or isinstance(messages[-1], HumanMessage):
        return messages
    return messages + [HumanMessage(content="Continue with the task.")]


# ---------------------------------------------------------------------------
# Sub-graph 1: sinh danh sách analyst
# ---------------------------------------------------------------------------


def create_analysts(state: GenerateAnalystsState) -> dict:
    """Sinh N analyst persona dựa trên topic (+ feedback nếu có, dùng ở v2)."""
    topic = state["topic"]
    max_analysts = state["max_analysts"]
    human_analyst_feedback = state.get("human_analyst_feedback", "")

    llm = get_llm()
    structured_llm = llm.with_structured_output(Perspectives)
    system_message = prompts.ANALYST_INSTRUCTIONS.format(
        topic=topic,
        human_analyst_feedback=human_analyst_feedback,
        max_analysts=max_analysts,
    )
    messages = [SystemMessage(content=system_message), HumanMessage(content="Generate the set of analysts.")]
    analysts = structured_llm.invoke(messages)
    return {"analysts": analysts.analysts}


def human_feedback(state: GenerateAnalystsState) -> None:
    """No-op node — v1 không interrupt ở đây; v2 sẽ compile với
    interrupt_before=["human_feedback"] để dừng graph tại đúng chỗ này."""
    pass


# ---------------------------------------------------------------------------
# Sub-graph 2: 1 cuộc phỏng vấn analyst <-> expert
# ---------------------------------------------------------------------------


def generate_question(state: InterviewState) -> dict:
    """Analyst đặt câu hỏi tiếp theo dựa trên persona + lịch sử hội thoại."""
    analyst = state["analyst"]
    messages = state["messages"]

    llm = get_llm()
    system_message = prompts.QUESTION_INSTRUCTIONS.format(goals=analyst.persona)
    prompt_messages = _ensure_user_final_turn([SystemMessage(content=system_message)] + messages)
    question = llm.invoke(prompt_messages)
    return {"messages": [question]}


def search_web(state: InterviewState) -> dict:
    """Nhánh song song 1/2: tìm kiếm Tavily dựa trên câu hỏi cuối cùng."""
    tavily_search = TavilySearch(max_results=3)

    llm = get_llm()
    structured_llm = llm.with_structured_output(SearchQuery)
    prompt_messages = _ensure_user_final_turn(
        [SystemMessage(content=prompts.SEARCH_INSTRUCTIONS)] + state["messages"]
    )
    search_query = structured_llm.invoke(prompt_messages)

    data = tavily_search.invoke({"query": search_query.search_query})
    search_docs = data.get("results", data)

    formatted_search_docs = "\n\n---\n\n".join(
        f'<Document href="{doc["url"]}"/>\n{doc["content"]}\n</Document>'
        for doc in search_docs
    )
    return {"context": [formatted_search_docs]}


def search_second_source(state: InterviewState) -> dict:
    """Nhánh song song 2/2: Wikipedia hoặc arXiv, tuỳ SECOND_SOURCE.

    Dùng arXiv khi chủ đề kỹ thuật/học thuật (paper, thuật toán, model),
    giữ Wikipedia cho chủ đề phổ thông hơn — đổi cờ SECOND_SOURCE ở đầu
    file, không cần sửa graph.
    """
    llm = get_llm()
    structured_llm = llm.with_structured_output(SearchQuery)
    prompt_messages = _ensure_user_final_turn(
        [SystemMessage(content=prompts.SEARCH_INSTRUCTIONS)] + state["messages"]
    )
    search_query = structured_llm.invoke(prompt_messages)

    try:
        if SECOND_SOURCE == "arxiv":
            search_docs = ArxivLoader(query=search_query.search_query, load_max_docs=2).load()
            formatted_search_docs = "\n\n---\n\n".join(
                f'<Document source="{doc.metadata.get("Entry ID", "")}" '
                f'title="{doc.metadata.get("Title", "")}"/>\n'
                f"{doc.page_content}\n</Document>"
                for doc in search_docs
            )
        else:
            search_docs = WikipediaLoader(query=search_query.search_query, load_max_docs=2).load()
            formatted_search_docs = "\n\n---\n\n".join(
                f'<Document source="{doc.metadata["source"]}" '
                f'page="{doc.metadata.get("page", "")}"/>\n'
                f"{doc.page_content}\n</Document>"
                for doc in search_docs
            )
    except Exception:
        formatted_search_docs = ""

    return {"context": [formatted_search_docs]}


def generate_answer(state: InterviewState) -> dict:
    """Expert trả lời dựa trên context đã gộp từ cả 2 nhánh search."""
    analyst = state["analyst"]
    messages = state["messages"]
    context = state["context"]

    llm = get_llm()
    system_message = prompts.ANSWER_INSTRUCTIONS.format(goals=analyst.persona, context=context)
    prompt_messages = _ensure_user_final_turn([SystemMessage(content=system_message)] + messages)
    answer = llm.invoke(prompt_messages)
    answer.name = "expert"
    return {"messages": [answer]}


def save_interview(state: InterviewState) -> dict:
    """Chuyển toàn bộ transcript hội thoại thành 1 string để lưu/dùng sau."""
    messages = state["messages"]
    interview = get_buffer_string(messages)
    return {"interview": interview}


def route_messages(state: InterviewState, name: str = "expert") -> str:
    """Router: hỏi tiếp hay dừng phỏng vấn.

    2 điều kiện dừng: (a) đã đủ max_num_turns, hoặc (b) analyst tự nói
    câu kết thúc quy ước ("Thank you so much for your help").
    """
    messages = state["messages"]
    max_num_turns = state.get("max_num_turns", 2)

    num_responses = len(
        [m for m in messages if isinstance(m, AIMessage) and m.name == name]
    )
    if num_responses >= max_num_turns:
        return "save_interview"

    last_question = messages[-2]
    if "Thank you so much for your help" in last_question.content:
        return "save_interview"
    return "ask_question"


def write_section(state: InterviewState) -> dict:
    """Viết 1 section báo cáo dựa trên context thu thập được trong interview."""
    context = state["context"]
    analyst = state["analyst"]

    llm = get_llm()
    system_message = prompts.SECTION_WRITER_INSTRUCTIONS.format(focus=analyst.description)
    section = llm.invoke(
        [SystemMessage(content=system_message)]
        + [HumanMessage(content=f"Use this source to write your section: {context}")]
    )
    return {"sections": [section.content]}


# ---------------------------------------------------------------------------
# Graph tổng: map-reduce N interview -> report
# ---------------------------------------------------------------------------


def initiate_all_interviews(state: ResearchGraphState):
    """Conditional edge kiêm map step: Send() 1 lệnh conduct_interview cho
    mỗi analyst — N analyst chạy N interview hoàn toàn song song."""
    human_analyst_feedback = state.get("human_analyst_feedback", "approve")
    if human_analyst_feedback.lower() != "approve":
        return "create_analysts"

    topic = state["topic"]
    return [
        Send(
            "conduct_interview",
            {
                "analyst": analyst,
                "messages": [
                    HumanMessage(content=f"So you said you were writing an article on {topic}?")
                ],
            },
        )
        for analyst in state["analysts"]
    ]


def write_report(state: ResearchGraphState) -> dict:
    """Gộp toàn bộ section thành nội dung chính của report."""
    sections = state["sections"]
    topic = state["topic"]
    human_section_feedback = state.get("human_section_feedback", "")

    llm = get_llm()
    formatted_str_sections = "\n\n".join(sections)
    system_message = prompts.REPORT_WRITER_INSTRUCTIONS.format(
        topic=topic, context=formatted_str_sections
    )

    user_prompt = "Write a report based upon these memos."
    if human_section_feedback and human_section_feedback.lower() != "approve":
        user_prompt += f"\n\nEditorial feedback to incorporate: {human_section_feedback}"

    report = llm.invoke(
        [SystemMessage(content=system_message)]
        + [HumanMessage(content=user_prompt)]
    )
    return {"content": report.content}


def write_introduction(state: ResearchGraphState) -> dict:
    sections = state["sections"]
    topic = state["topic"]

    llm = get_llm()
    formatted_str_sections = "\n\n".join(sections)
    instructions = prompts.INTRO_CONCLUSION_INSTRUCTIONS.format(
        topic=topic, formatted_str_sections=formatted_str_sections
    )
    intro = llm.invoke(
        [SystemMessage(content=instructions)]
        + [HumanMessage(content="Write the report introduction")]
    )
    return {"introduction": intro.content}


def write_conclusion(state: ResearchGraphState) -> dict:
    sections = state["sections"]
    topic = state["topic"]

    llm = get_llm()
    formatted_str_sections = "\n\n".join(sections)
    instructions = prompts.INTRO_CONCLUSION_INSTRUCTIONS.format(
        topic=topic, formatted_str_sections=formatted_str_sections
    )
    conclusion = llm.invoke(
        [SystemMessage(content=instructions)]
        + [HumanMessage(content="Write the report conclusion")]
    )
    return {"conclusion": conclusion.content}


def finalize_report(state: ResearchGraphState) -> dict:
    """Reduce step cuối: ghép intro + content + conclusion + sources."""
    content = state["content"]
    if content.startswith("## Insights"):
        content = content.strip("## Insights")

    sources = None
    if "## Sources" in content:
        try:
            content, sources = content.split("\n## Sources\n")
        except ValueError:
            sources = None

    final_report = state["introduction"] + "\n\n---\n\n" + content + "\n\n---\n\n" + state["conclusion"]
    if sources is not None:
        final_report += "\n\n## Sources\n" + sources
    return {"final_report": final_report}


def human_review_section(state: ResearchGraphState) -> None:
    """No-op node — v2 interrupt_before dừng tại đây để user review
    từng section trước khi gộp vào report. Xem graph.py:interrupt_before."""
    pass
