"""Interactive details are evidence, not an unchecked UI decoration."""
import copy
import pytest
import agent.deep_research as research
from agent.deep_research import valid_proofs, validate_draft
from agent.report_quality import valid_visual, visual_as_text
from agent.research_contract import ReportAudit, ReportDraft
from agent.model_output import parse_narrative, validate_response
from backend.report_export import render_latex, ExportError


@pytest.fixture
def rich_visuals():
    chunks = [{"id": "C1", "source_id": "P", "text": "Distillation learns from demonstrations. Its output initializes RL, which optimizes feedback."},
              {"id": "C2", "source_id": "P", "text": "Model Alpha scores 67.73 on DevSet under single-candidate accuracy evaluation."},
              {"id": "C3", "source_id": "P", "text": "Model Beta scores 55.02 on DevSet under single-candidate accuracy evaluation."},
              {"id": "C4", "source_id": "P", "text": r"J(A,B)=\frac{|A\cap B|}{|A\cup B|}. A and B are sets; J measures overlap, not correctness."}]
    p = lambda idx: {"chunk_id": chunks[idx]["id"], "quote": chunks[idx]["text"]}
    flow = {"kind": "flow", "title": "Method", "caption": "Distillation initializes RL.", "section_key": "mechanism", "evidence": [p(0)],
            "nodes": [{"id": "sft", "label": "Distillation", "explanation": "Learns from demonstrations.", "inputs": "Demonstrations", "outputs": "Initialization for RL", "evidence": [p(0)]}, {"id": "rl", "label": "RL", "explanation": "Optimizes feedback.", "evidence": [p(0)]}],
            "edges": [{"source": "sft", "target": "rl", "label": "Initializes", "evidence": [p(0)]}]}
    bar = {"kind": "bar", "title": "Dev evaluation", "caption": "Same evaluation setting.", "section_key": "evidence", "evidence": [p(1), p(2)], "columns": ["Model", "Accuracy"], "unit": "%", "conditions": "single-candidate evaluation", "dataset": "DevSet", "metric": "Accuracy",
           "rows": [{"cells": ["Alpha", "67.73"], "explanation": "Score on DevSet, not a production guarantee.", "evidence": [p(1)]}, {"cells": ["Beta", "55.02"], "evidence": [p(2)]}]}
    equation = {"kind": "equation", "title": "Set overlap", "caption": "Similarity, not correctness.", "section_key": "mechanism", "evidence": [p(3)], "equation": r"J(A,B)=\frac{|A\cap B|}{|A\cup B|}", "explanation": "Intersection divided by union measures overlap.", "symbols": [{"symbol": "A", "meaning": "A is a set.", "evidence": [p(3)]}, {"symbol": "B", "meaning": "B is a set.", "evidence": [p(3)]}]}
    return chunks, [flow, bar, equation]


def test_rich_visuals_preserve_component_proofs_and_all_auditable_text(rich_visuals):
    chunks, visuals = rich_visuals
    for visual in visuals:
        draft, removed = validate_response(ReportDraft, {"title": "Report", "sections": [], "visuals": [visual]})
        assert not removed
        checked = valid_visual(draft.model_dump()["visuals"][0], valid_proofs, chunks, {"P"})
        assert checked and checked["verification"] == "quote_matched"
    text = visual_as_text(visuals[0])
    assert "sft" not in text and "Distillation -> RL" in text
    assert "Initialization for RL" in text and "Learns from demonstrations." in text


@pytest.mark.parametrize("field", ["explanation", "inputs", "outputs"])
def test_interactive_details_cannot_hide_fabricated_numbers(rich_visuals, field):
    chunks, visuals = rich_visuals
    visual = copy.deepcopy(visuals[0])
    visual["nodes"][0][field] = "Uses 999 candidates."
    assert valid_visual(visual, valid_proofs, chunks) is None


def test_row_cannot_borrow_another_rows_value_and_rich_details_require_own_proof(rich_visuals):
    chunks, visuals = rich_visuals
    bar = copy.deepcopy(visuals[1])
    bar["rows"][0]["cells"][1] = "55.02"
    assert valid_visual(bar, valid_proofs, chunks) is None
    flow = copy.deepcopy(visuals[0])
    flow["nodes"][0]["evidence"] = []
    assert valid_visual(flow, valid_proofs, chunks) is None
    flow = copy.deepcopy(visuals[0])
    flow["edges"][0]["evidence"][0]["quote"] = "This quoted relationship was invented."
    assert valid_visual(flow, valid_proofs, chunks) is None


def test_equations_share_export_security_policy_and_require_symbol_sources(rich_visuals):
    chunks, visuals = rich_visuals
    equation = copy.deepcopy(visuals[2])
    equation["equation"] = r"\input{private}"
    assert valid_visual(equation, valid_proofs, chunks) is None
    equation = copy.deepcopy(visuals[2])
    equation["symbols"][0]["evidence"] = []
    assert valid_visual(equation, valid_proofs, chunks) is None


def test_narrative_transport_resolves_nested_quote_references(rich_visuals):
    chunks, visuals = rich_visuals
    import json
    visual = copy.deepcopy(visuals[0])
    visual["evidence"] = [{"quote_id": "Q1"}]
    for part in visual["nodes"] + visual["edges"]:
        part["evidence"] = [{"quote_id": "Q1"}]
    prose = ":::title Report\n:::section mechanism\n:::claim reported Q1\nDistillation initializes RL; RL optimizes feedback.\n:::endclaim\n:::endsection\n:::visual\n" + json.dumps(visual) + "\n:::endvisual"
    packet = {"Q1": {"chunk_id": "C1", "quote": chunks[0]["text"]}}
    parsed = parse_narrative(prose, packet, ["mechanism"])
    draft, removed = validate_response(ReportDraft, parsed)
    assert not removed and draft.visuals[0].nodes[0].evidence[0].chunk_id == "C1"


@pytest.mark.parametrize("verdict", ["supported", "partial", "unsupported"])
def test_semantic_audit_receives_bindings_and_omits_any_unapproved_visual(monkeypatch, rich_visuals, verdict):
    chunks, visuals = rich_visuals
    checked = validate_draft({"title": "Report", "sections": [{"key": "mechanism", "claims": [{
        "text": "Distillation initializes RL, which optimizes feedback.", "kind": "reported", "evidence": visuals[0]["evidence"]}]}], "visuals": [visuals[0]]}, chunks)
    def audit_call(state, schema, instruction, payload, cap):
        assert schema is ReportAudit
        assert len(payload["claims"]) == 2
        visual = payload["claims"][1]
        assert visual["is_visual"] and "Distillation -> RL" in visual["text"]
        assert visual["visual"]["nodes"][0]["evidence"] == visuals[0]["nodes"][0]["evidence"]
        assert visual["visual"]["edges"][0]["evidence"] == visuals[0]["edges"][0]["evidence"]
        return ReportAudit(verdicts=[{"claim_index": 0, "verdict": "supported", "reason": "Sourced explanation"},
                                    {"claim_index": 1, "verdict": verdict, "reason": "Per-component review"}],
                           quality_checks=[{"key": "visuals", "status": "pass", "explanation": "Audit fixture"}])
    monkeypatch.setattr(research, "_call", audit_call)
    result = research.audit_evidence({"report_data": checked, "evidence": chunks,
                                      "brief": {"questions": ["How does it work?"], "intent": "paper_analysis"},
                                      "report_language": "en", "usage": {}, "warnings": [], "analysis_mode": "paper",
                                      "research_domain": "artificial-intelligence"})["report_data"]
    assert len(result["visuals"]) == (1 if verdict == "supported" else 0)
    assert result["quality_checks"][0]["status"] == ("pass" if verdict == "supported" else "partial")


def test_export_preserves_all_details_and_component_locations(rich_visuals):
    chunks, visuals = rich_visuals
    data = validate_draft({"title": "Report", "sections": [], "visuals": visuals}, chunks)
    for visual in data["visuals"]:
        visual["verification"] = "model_checked"
    data.update(language="en", sources=[{"id": "P", "title": "Primary paper", "url": "https://example.org"}],
                evidence=[{**chunk, "locator": f"p. {index + 1}"} for index, chunk in enumerate(chunks)])
    tex = render_latex(data)
    for detail in ["Learns from demonstrations.", "Initialization for RL", "Optimizes feedback.", "A is a set.", "B is a set.", "DevSet", "[1] p. 4"]:
        assert detail in tex
    assert r"\frac{|A\cap B|}{|A\cup B|}" in tex
    data["visuals"][2]["equation"] = r"\write18{private}"
    with pytest.raises(ExportError): render_latex(data)
