"""Opt-in, bounded provider check against a saved report's existing excerpts.

No crawling, no original report mutation, no automatic live calls in pytest.
Run with --live explicitly. Output is a separate visual-only QA artifact, NOT
a regenerated or independently verified version of the original report prose.
"""
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
from agent import deep_research as research
from agent.research_contract import SECTION_KEYS, budget_for


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("tmp/research-visuals-qa/live-generation.json"))
    parser.add_argument("--live", action="store_true", help="Allow up to two creation/repair calls and one audit call to configured provider")
    args = parser.parse_args()
    saved = json.loads(args.report.read_text(encoding="utf-8"))
    if not args.live:
        print(json.dumps({"live": False, "excerpts_available": len(saved.get("evidence", [])), "original_figures": len(saved.get("visuals", []))}))
        return
    if args.report.resolve() == args.output.resolve():
        parser.error("QA output must not overwrite the original report")
    load_dotenv()
    budget = budget_for("deep", {"max_llm_calls": 3, "max_input_tokens": 60000, "max_output_tokens": 12000, "max_seconds": 180, "max_searches": 0}).model_dump()
    state = {"topic": saved["brief"]["objective"], "brief": saved["brief"], "report_language": saved["language"], "report_detail": saved.get("report_detail", "extended"), "research_depth": "deep", "analysis_mode": "research", "started_at": time.time(), "budget": budget, "usage": dict(llm_calls=0, input_tokens_estimated=0, input_tokens_measured=0, output_tokens_reserved=0, output_tokens_measured=0), "diagnostics": [], "warnings": [], "sources": saved["sources"], "evidence": saved["evidence"], "report_data": {"title": "QA visual-only: " + saved["title"], "sections": [{"key": key, "claims": []} for key in SECTION_KEYS], "visuals": []}}
    state.update(research.generate_visuals(state))
    if state["report_data"]["visuals"]:
        state.update(research.audit_evidence(state))
    result = {**saved, **state["report_data"], "outcome": "partial", "usage": {**state["usage"], "elapsed_seconds": round(time.time() - state["started_at"], 1)}, "budget": budget, "diagnostics": state["diagnostics"], "warnings": state["warnings"] + ["Visual-only QA from stored excerpts. Original prose was NOT regenerated or audited."], "audit_notes": state.get("audit_notes", "No visual passed generation for auditing."), "coverage": state.get("coverage", []), "stop_reason": "visual_only_qa", "qa_only": True}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"visual_status": result["visual_status"], "usage": result["usage"], "diagnostics": result["diagnostics"], "output": str(args.output.resolve())}, ensure_ascii=False))
    if result["visual_status"]["status"] != "ready":
        sys.exit(1)


if __name__ == "__main__":
    main()
