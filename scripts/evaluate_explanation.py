"""Opt-in, bounded evaluation of the real report graph on a local paper.

This sends selected excerpts to the configured model provider only with --live.
Use an isolated evidence store and never overwrite an existing user report.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("paper", type=Path)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("tmp/report-evaluation"))
    parser.add_argument("--detail", choices=["concise", "detailed", "extended"], default="detailed")
    parser.add_argument("--pdf", action="store_true")
    parser.add_argument("--reuse", action="store_true", help="Evaluate only writing/auditing using the already selected evidence")
    parser.add_argument("--debug-output", action="store_true", help="Store private model outputs locally for envelope debugging (never prompts or credentials)")
    parser.add_argument("--replay-written", action="store_true", help="Revalidate the four cached model-written parts and spend only one new audit call")
    args = parser.parse_args()
    if not args.live:
        parser.error("--live is required; model calls may incur charges")
    from dotenv import load_dotenv
    load_dotenv()
    args.output.mkdir(parents=True, exist_ok=True)
    sys.stdout.reconfigure(encoding="utf-8")
    os.environ["RESEARCH_DATA_DIR"] = str((args.output / "private-evidence").resolve())
    from agent.documents import DocumentStore, extract_pdf
    from agent import deep_research as research
    from agent.deep_research import batch_graph
    original_call = research._call
    original_invoke = research.structured_invoke
    sequence = 0
    raw_sequence = 0
    def traced_invoke(*values, **options):
        nonlocal raw_sequence
        result = original_invoke(*values, **options)
        if args.debug_output:
            raw = result.get("raw") if isinstance(result, dict) else None
            content = getattr(raw, "content", "")
            if isinstance(content, list):
                content = "\n".join(item.get("text", "") for item in content if isinstance(item, dict) and item.get("type") == "text")
            if content:
                raw_sequence += 1
                (args.output / ("debug-model-" + str(raw_sequence) + ".json")).write_text(json.dumps(content, ensure_ascii=False), encoding="utf-8")
        return result
    research.structured_invoke = traced_invoke
    def traced_call(state, schema, instruction, payload, output_limit):
        nonlocal sequence
        result = original_call(state, schema, instruction, payload, output_limit)
        sequence += 1
        (args.output / ("call-" + str(sequence) + "-" + schema.__name__ + ".json")).write_text(json.dumps(result.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
        return result
    research._call = traced_call
    content = args.paper.read_bytes()
    document = DocumentStore().save("local:quality-review", {**extract_pdf(content), "title": args.paper.name, "url": ""}, content)
    initial = {"topic": "", "analysis_mode": "paper", "document_id": document["id"], "owner_id": "local:quality-review",
               "report_language": "vi", "preferred_report_language": "vi", "report_detail": args.detail,
               "research_domain": "auto", "research_depth": "deep",
               "budget": {"max_searches": 0, "max_documents": 1, "max_llm_calls": 8, "max_input_tokens": 100000, "max_output_tokens": 30000},
               "human_section_feedback": "approve"}
    final = None
    if args.reuse:
        saved = json.loads((args.output / "report.research.json").read_text(encoding="utf-8"))
        working = {**initial, "topic": saved["brief"]["objective"], "brief": saved["brief"], "research_domain": saved["research_domain"],
                   "budget": saved["budget"], "started_at": time.time(), "sources": [{**source, "primary": True} for source in saved["sources"]],
                   "evidence": saved["evidence"], "dossier": saved["dossier"], "coverage": saved["coverage"], "conflicts": saved["conflicts"],
                   "warnings": [], "diagnostics": [], "stop_reason": "evaluation_selected_evidence",
                   "usage": dict(llm_calls=0, searches=0, documents=0, cache_hits=1, input_tokens_estimated=0, input_tokens_measured=0, output_tokens_reserved=0, output_tokens_measured=0)}
        stages = [research.draft_report, research.audit_evidence, research.improve_report, research.finalize_report]
        if args.replay_written:
            from agent.model_output import parse_narrative, prepare_evidence_packet, validate_response
            from agent.research_contract import ReportDraft
            from agent.report_quality import section_packet
            aggregate = {"title": saved["title"], "sections": [], "visuals": []}
            parts = [["answer", "scope"], ["mechanism"], ["evidence"], ["limitations", "next_steps"]]
            for index, keys in enumerate(parts, start=1):
                text = json.loads((args.output / ("debug-model-" + str(index) + ".json")).read_text(encoding="utf-8"))
                if not isinstance(text, str):
                    text = "\n".join(item.get("text", "") for item in text if isinstance(item, dict))
                _, registry = prepare_evidence_packet(ReportDraft, {"evidence": section_packet(working["evidence"], keys, 8500)})
                parsed, _ = validate_response(ReportDraft, parse_narrative(text, registry, keys))
                aggregate["sections"] += [section.model_dump() for section in parsed.sections]
                aggregate["visuals"] += [visual.model_dump() for visual in parsed.visuals]
            working["report_data"] = research.validate_draft(aggregate, working["evidence"], {source["id"] for source in working["sources"]})
            stages = [research.audit_evidence, research.finalize_report]
        for stage in stages:
            working.update(stage(working))
            print(json.dumps({"stage": stage.__name__, "calls": working["usage"]["llm_calls"]}), flush=True)
        final = working
    else:
        for update in batch_graph.stream(initial, stream_mode="updates"):
            for stage, value in update.items():
                usage = value.get("usage", {}) if isinstance(value, dict) else {}
                print(json.dumps({"stage": stage, "calls": usage.get("llm_calls"), "elapsed": round(time.time(), 1)}, ensure_ascii=False), flush=True)
                if stage == "finalize_report": final = value
    if not final: raise RuntimeError("Graph did not produce a terminal record")
    data = final["report_data"]
    if args.replay_written:
        data["evaluation_mode"] = "cached_model_drafts_revalidated_and_reaudited"
    (args.output / "report.research.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output / "report.md").write_text(final["final_report"], encoding="utf-8")
    from backend.report_export import export_report
    tex = export_report(args.output / "report.md", data, final["final_report"], "tex")
    print(json.dumps({"outcome": data["outcome"], "metrics": data["metrics"], "usage": data["usage"], "domain": data["research_domain"],
                      "diagnostics": data["diagnostics"], "quality": data["quality_checks"], "tex": str(tex)}, ensure_ascii=False), flush=True)
    if args.pdf:
        print(export_report(args.output / "report.md", data, final["final_report"], "pdf"))

if __name__ == "__main__":
    main()
