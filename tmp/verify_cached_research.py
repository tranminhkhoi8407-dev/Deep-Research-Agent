"""Opt-in live verification: JSON on stdin, cached evidence only, no web discovery.

Run only with the user's in-scope model configured. Writes nothing; emits the
real model output and accounting for review, not a fabricated golden report.
"""
import argparse
import json
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
from agent import deep_research as research
from agent.research_contract import budget_for, resolve_research_topic

parser = argparse.ArgumentParser()
parser.add_argument("--mode", choices=["paper", "research"], required=True)
parser.add_argument("--depth", choices=["quick", "standard", "deep"], default="deep")
parser.add_argument("--pdf", help="Explicit original paper path, re-extracted locally using the current reader")
parser.add_argument("--writer-only", action="store_true", help="One diagnostic writer call, no new planning/coverage/audit")
parser.add_argument("--coverage-only", action="store_true", help="One diagnostic coverage call, no writer/audit")
parser.add_argument("--reuse-brief", action="store_true", help="Reuse a localized paper brief; verify reading, writing and audit only")
args = parser.parse_args()
cached = json.load(sys.stdin)
topic = resolve_research_topic("", "paper", "vi") if args.mode == "paper" else cached["title"]
base = {"topic": topic, "report_language": "vi", "research_depth": args.depth, "analysis_mode": args.mode, "research_domain": "artificial-intelligence"}
if args.mode == "paper" and not args.writer_only and not args.coverage_only and not args.reuse_brief:
    state = research.understand_brief(base)
else:
    # Reuse the old coverage to isolate writer/audit compatibility. This does
    # not verify discovery coverage or claim to replace a full research run.
    state = {**base, "started_at": time.time(), "budget": budget_for(args.depth).model_dump(), "usage": dict(llm_calls=0, searches=0, documents=0, cache_hits=0, input_tokens_estimated=0, input_tokens_measured=0, output_tokens_reserved=0, output_tokens_measured=0), "warnings": [], "diagnostics": [], "brief": {**cached["brief"], "objective": topic, "intent": "paper" if args.mode == "paper" else "technical_guide", "exclusions": []}, "stop_reason": cached["stop_reason"], "coverage": cached["coverage"], "conflicts": cached["conflicts"]}
    if args.mode == "paper":
        state["brief"]["questions"] = ["Bài toán và đóng góp là gì?", "Phương pháp và công thức hoạt động thế nào?", "Kết quả, so sánh và điều kiện đánh giá?", "Hạn chế và khả năng tái lập?"]
        # A new localized brief cannot inherit old question-index semantics.
        # Writer-only is deliberately unaudited, not a full-coverage probe.
        state["coverage"] = []
state.update(sources=cached["sources"], evidence=cached["evidence"], pending_queries=[], pending_reads=[], searched_queries=[], rounds=1, human_section_feedback="approve")
if args.pdf and args.mode == "paper":
    from agent.documents import extract_pdf
    primary = next(source for source in cached["sources"] if source.get("primary"))
    primary = {**primary, **extract_pdf(Path(args.pdf).read_bytes())}
    state["sources"] = [primary]
    state["evidence"] = research._budget_reading_packet(state, research._select_evidence([primary], state["brief"]["questions"], {"quick": 9000, "standard": 18000, "deep": 28000}[args.depth]))
    primary.update(chunks_available=len(primary["chunks"]), chunks_selected=len(state["evidence"]))
else:
    state["evidence"] = research._budget_reading_packet(state, state["evidence"])
    for source in state["sources"]:
        source["chunks_selected"] = sum(chunk["source_id"] == source["id"] for chunk in state["evidence"])
if args.writer_only or args.coverage_only:
    original_response = research.validate_response
    def debug_response(schema, value):
        if schema in {research.ReportDraft, research.CoverageReview}:
            from pydantic import ValidationError
            try:
                schema.model_validate(value)
            except ValidationError as error:
                items = [item for section in value.get("sections", []) for item in section.get("claims", [])] if schema == research.ReportDraft else value.get("questions", [])
                print(json.dumps({"validation": [{"loc": item["loc"], "type": item["type"]} for item in error.errors(include_input=False, include_context=False)], "reference_shapes": [{"kind": item.get("kind"), "evidence": [entry.model_dump() if hasattr(entry, "model_dump") else entry for entry in item.get("evidence", [])]} for item in items]}, ensure_ascii=False), flush=True)
        return original_response(schema, value)
    research.validate_response = debug_response
if args.mode == "paper" and not args.writer_only:
    state.update(research.assess_coverage(state))
if args.coverage_only:
    print(json.dumps({"coverage": state["coverage"], "diagnostics": state["diagnostics"], "usage": state["usage"]}, ensure_ascii=False))
    sys.exit(0)
if args.writer_only:
    original = research.validate_draft
    def debug_validation(draft, evidence, primary_ids=None):
        print(json.dumps({"raw_draft": draft}, ensure_ascii=False), flush=True)
        return original(draft, evidence, primary_ids)
    research.validate_draft = debug_validation
state.update(research.draft_report(state))
before = sum(len(section["claims"]) for section in state["report_data"]["sections"])
if not args.writer_only:
    state.update(research.audit_evidence(state))
else:
    state["audit_notes"] = "Writer-only diagnostic; no semantic audit performed."
state.update(research.finalize_report(state))
data = state["report_data"]
print(json.dumps({"verification_scope": "Cached excerpts, no searches or new downloads", "outcome": data["outcome"], "language": data["language"], "brief": data["brief"], "before_audit": before, "claims_by_section": {section["key"]: len(section["claims"]) for section in data["sections"]}, "coverage": data["coverage"], "diagnostics": data["diagnostics"], "usage": data["usage"], "counts": data["counts"], "sections": data["sections"], "report_markdown": state["final_report"]}, ensure_ascii=False))
