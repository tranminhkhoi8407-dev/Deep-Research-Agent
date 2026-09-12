"""Entry point CLI: chạy Deep Research Agent cho 1 topic, xuất report .md.

Usage (v2 — human-in-the-loop):
    python main.py "So sánh RAG vs fine-tuning cho chatbot domain-specific" --max-analysts 3

v2 behavior:
- Chạy đến interrupt đầu tiên (human_feedback): dừng để bạn review/sửa danh sách analyst
- Bạn gõ feedback (hoặc Enter để approve) -> graph resume
- Chạy N interview song song -> interrupt thứ 2 (human_review_section): dừng để bạn review từng section
- Bạn gõ feedback cho từng section (hoặc Enter để approve) -> graph resume -> xuất final report

v1 behavior (single-shot, no interrupt): dùng --no-interrupt flag.
"""

import argparse
import os
import uuid
from datetime import datetime

from dotenv import load_dotenv
from langgraph.types import Command

from agent.graph import graph


def run_v3_interactive(
    topic: str, max_analysts: int, user_id: str, output_dir: str = "reports"
) -> str:
    """Chạy graph v3 với long-term memory + 2 interrupt.

    Trả về đường dẫn file report đã ghi.
    """
    thread = {"configurable": {"thread_id": str(uuid.uuid4()), "user_id": user_id}}

    initial_state = {
        "topic": topic,
        "max_analysts": max_analysts,
        "human_analyst_feedback": "",
    }

    print(f"\n{'='*60}")
    print(f"🔬 Deep Research Agent v3 — Long-term Memory")
    print(f"Topic: {topic}")
    print(f"Max analysts: {max_analysts}")
    print(f"User: {user_id}")
    print(f"{'='*60}\n")

    # --- INTERRUPT 1: human_feedback (review analyst list) ---
    print("▶ Đang tải research profile & sinh danh sách analyst...")
    for event in graph.stream(initial_state, thread, stream_mode="values"):
        pass

    state = graph.get_state(thread)
    analysts = state.values.get("analysts", [])
    research_profile = state.values.get("research_profile", "")

    if research_profile and research_profile != "Chưa có profile — dùng mặc định.":
        print(f"\n👤 Research Profile (từ các lần trước):\n   {research_profile.replace(chr(10), chr(10)+'   ')}")

    print(f"\n📋 Đã sinh {len(analysts)} analyst:")
    for i, a in enumerate(analysts, 1):
        print(f"  {i}. {a.name} — {a.role} @ {a.affiliation}")
        print(f"     {a.description}")

    feedback = input(
        "\n💬 Feedback (Enter để approve, hoặc gõ góp ý để LLM sinh lại analyst): "
    ).strip()

    graph.update_state(
        thread,
        {"human_analyst_feedback": feedback or "approve"},
        as_node="human_feedback",
    )

    if feedback:
        print(f"\n🔄 Đang sinh lại analyst với feedback: {feedback}")
        for event in graph.stream(None, thread, stream_mode="values"):
            pass
        state = graph.get_state(thread)
        analysts = state.values.get("analysts", [])
        print(f"\n📋 Danh sách analyst mới ({len(analysts)}):")
        for i, a in enumerate(analysts, 1):
            print(f"  {i}. {a.name} — {a.role} @ {a.affiliation}")

    print("\n▶ Đang chạy N interview song song (mỗi analyst interview 1 expert)...")

    # --- Run interviews until interrupt 2 ---
    for event in graph.stream(None, thread, stream_mode="values"):
        pass

    state = graph.get_state(thread)
    sections = state.values.get("sections", [])

    print(f"\n📄 Đã hoàn thành {len(sections)} section từ interview:")
    for i, section in enumerate(sections, 1):
        lines = section.strip().split("\n")
        title = lines[0] if lines else f"Section {i}"
        print(f"  {i}. {title}")

    # --- INTERRUPT 2: human_review_section ---
    review_feedback = input(
        "\n💬 Feedback chung cho các section (Enter để approve all, "
        "hoặc gõ yêu cầu để LLM viết lại report): "
    ).strip()

    graph.update_state(
        thread,
        {"human_section_feedback": review_feedback or "approve"},
        as_node="human_review_section",
    )

    if review_feedback:
        print(f"\n🔄 Đang viết lại report với feedback: {review_feedback}")
        for event in graph.stream(None, thread, stream_mode="values"):
            pass

    # --- Final result ---
    final_state = graph.get_state(thread)
    final_report = final_state.values.get("final_report", "")

    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_topic = "".join(c if c.isalnum() or c in " -_" else "" for c in topic)[:50].strip()
    filename = f"{timestamp}-{safe_topic or 'report'}.md".replace(" ", "-")
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(final_report)

    print(f"\n✅ Xong. Report đã lưu tại: {filepath}")
    print(f"💾 Research profile đã được cập nhật cho user: {user_id}")
    return filepath


def run_v1_single_shot(topic: str, max_analysts: int, user_id: str, output_dir: str = "reports") -> str:
    """Chạy graph v1 (không interrupt) — cho automation/batch."""
    thread = {"configurable": {"thread_id": str(uuid.uuid4()), "user_id": user_id}}

    initial_state = {
        "topic": topic,
        "max_analysts": max_analysts,
        "human_analyst_feedback": "approve",
        "human_section_feedback": "approve",
    }

    print(f"Đang research (v1 single-shot): {topic} | {max_analysts} analysts | user: {user_id}...")
    result = graph.invoke(initial_state, thread)

    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_topic = "".join(c if c.isalnum() or c in " -_" else "" for c in topic)[:50].strip()
    filename = f"{timestamp}-{safe_topic or 'report'}.md".replace(" ", "-")
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(result["final_report"])

    return filepath


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Deep Research Agent — multi-agent research CLI")
    parser.add_argument("topic", help="Chủ đề nghiên cứu")
    parser.add_argument(
        "--max-analysts", type=int, default=3, help="Số lượng analyst song song (default: 3)"
    )
    parser.add_argument(
        "--output-dir", default="reports", help="Thư mục ghi report (default: reports/)"
    )
    parser.add_argument(
        "--user-id", default="default", help="User ID cho long-term memory (default: 'default')"
    )
    parser.add_argument(
        "--no-interrupt", action="store_true", help="Chạy v1 single-shot (không interrupt, dùng cho CI/batch)"
    )
    args = parser.parse_args()

    if args.no_interrupt:
        filepath = run_v1_single_shot(args.topic, args.max_analysts, args.user_id, args.output_dir)
        print(f"\nXong. Report đã lưu tại: {filepath}")
    else:
        filepath = run_v3_interactive(args.topic, args.max_analysts, args.user_id, args.output_dir)


if __name__ == "__main__":
    main()