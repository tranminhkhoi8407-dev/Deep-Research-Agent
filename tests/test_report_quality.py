"""Structured explanation, reconciliation and sourced visual regressions."""
import json
import time
import pytest
from agent import deep_research as research
from agent import report_quality as quality
from agent.research_contract import ReportDraft, ReportAudit, budget_for

def excerpt(text="Training uses distillation followed by RL. Accuracy is 67.73 versus 55.02 under the same evaluation.", id="A1-K1-C1"):
    return {"id": id, "text": text, "source_id": "A1-K1", "locator": "p. 3", "url": "https://example.org/paper", "title": "Paper"}

def proof(chunk):
    return {"chunk_id": chunk["id"], "quote": chunk["text"]}

def claim(chunk, text=None, kind="reported", **extra):
    return {"text": text or chunk["text"], "kind": kind, "evidence": [proof(chunk)], "question_indices": [0], **extra}

def flow(chunk):
    return {"kind": "flow", "title": "Training pipeline", "caption": "Distillation precedes RL.", "section_key": "mechanism",
            "nodes": [{"id": "sft", "label": "Distillation"}, {"id": "rl", "label": "RL"}],
            "edges": [{"source": "sft", "target": "rl", "label": "Followed by"}], "evidence": [proof(chunk)]}

def state(chunk):
    return {"topic": "Explain this paper", "report_language": "en", "report_detail": "detailed", "analysis_mode": "paper",
            "brief": {"questions": ["How does the method work?"], "intent": "paper"}, "sources": [{"id": "A1-K1", "primary": True}],
            "evidence": [chunk], "usage": {"llm_calls": 0, "input_tokens_estimated": 0, "output_tokens_reserved": 0},
            "budget": budget_for("deep").model_dump(), "started_at": time.time(), "warnings": [], "diagnostics": [], "conflicts": []}

def test_reading_protects_small_essential_sections_and_excludes_bibliography():
    texts = ["Abstract: method framework", "Method architecture", "Distillation creates a reasoning bank.",
             "Reward equation Jaccard and cosine", "Inference candidates majority voting",
             "Table 1 accuracy benchmark", "Setup GPU hardware and dataset split", "Ablation without reward",
             "Limitations and failure", "References\n[1] Paper one\n[2] Paper two\n[3] Paper three"]
    sources = [{"id": "A1-K1", "url": "https://example.org", "title": "Paper", "read_status": "full_text_available",
                "chunks": [{"text": text, "page": index + 1} for index, text in enumerate(texts)]}]
    selected = quality.select_reading(sources, ["method"], 1000)
    assert {chunk["page"] for chunk in selected} == set(range(1, 10))
    assert sum(len(chunk["text"]) for chunk in selected) <= 1000
    assert any(item["topic"] == "training" and item["status"] == "selected" for item in quality.reading_dossier(sources, selected))
    assert not quality.is_reference_chunk("Our method cites [1] and reports a result.")
    assert quality.section_packet(selected, ["mechanism"], 200) == quality.section_packet(selected, ["mechanism"], 200)


def test_method_packet_prefers_actual_pipeline_caption_over_repeated_generic_words():
    sources = [excerpt("Method " * 20, "C1"), excerpt("Fig. 2. Overall training pipeline. Step 1: Distillation; Step 2: reinforcement learning.", "C2"), excerpt("T. Smith, J. Jones et al.,", "C3")]
    packet = quality.section_packet(sources, ["mechanism"], 115)
    assert packet[0]["id"] == "C2" and all(item["id"] != "C3" for item in packet)


def test_quality_pass_must_point_to_retained_report_prose_not_praise_the_source(monkeypatch):
    chunk = excerpt()
    working = state(chunk)
    text = "A source-grounded explanatory paragraph. " * 90
    working["report_data"] = research.validate_draft({"sections": [{"key": "mechanism", "claims": [claim(chunk, text)]}]}, [chunk])
    verdict = {"claim_index": 0, "verdict": "supported", "reason": "Supported fixture"}
    for quoted, expected in [("The paper presents a novel method", "partial"), ("A source-grounded explanatory paragraph.", "pass")]:
        audit = ReportAudit(verdicts=[verdict], quality_checks=[{"key": "methods", "status": "pass", "explanation": "Review", "claim_indices": [0], "report_excerpt": quoted}])
        monkeypatch.setattr(research, "_call", lambda *args, **kwargs: audit)
        assert research.audit_evidence(working)["report_data"]["quality_checks"][0]["status"] == expected

def test_illustration_can_teach_with_new_example_values_but_cannot_hide_measurements():
    chunk = excerpt()
    teaching = claim(chunk, "Self-created illustration, not executed: imagine scores 100 and 300.", "illustration")
    checked = research.validate_draft({"sections": [{"key": "mechanism", "claims": [teaching, {**teaching, "kind": "inference"}]}]}, [chunk], {"A1-K1"})
    assert len(checked["sections"][2]["claims"]) == 1
    assert checked["sections"][2]["claims"][0]["kind"] == "illustration"

def test_derived_difference_is_program_computed_and_inputs_must_be_cited():
    chunk = excerpt()
    calc = {"operation": "percentage_point_difference", "inputs": [
        {"label": "method", "value": 67.73, "evidence": [proof(chunk)]},
        {"label": "baseline", "value": 55.02, "evidence": [proof(chunk)]}], "unit": "percentage points"}
    data = research.validate_draft({"sections": [{"key": "evidence", "claims": [claim(chunk, "The difference is 12.71 percentage points.", "derived", calculation=calc)]}]}, [chunk], {"A1-K1"})
    assert data["sections"][3]["claims"][0]["calculation"]["result"] == 12.71
    calc["inputs"][0]["value"] = -67.73
    with pytest.raises(ValueError): quality.calculate(calc, research.valid_proofs, [chunk])
    calc["inputs"][0]["value"] = 98
    with pytest.raises(ValueError): quality.calculate(calc, research.valid_proofs, [chunk])

def test_visuals_require_source_data_valid_relationships_and_comparable_conditions():
    chunk = excerpt()
    diagram = flow(chunk)
    assert quality.valid_visual(diagram, research.valid_proofs, [chunk], {"A1-K1"})
    diagram["edges"][0]["target"] = "invented"
    assert quality.valid_visual(diagram, research.valid_proofs, [chunk]) is None
    chart = {"kind": "bar", "title": "Accuracy", "caption": "Evaluation comparison", "section_key": "evidence",
             "columns": ["Model", "Accuracy"], "rows": [{"cells": ["Method", "67.73"]}, {"cells": ["Baseline", "55.02"]}],
             "unit": "%", "conditions": "Same evaluation set", "evidence": [proof(chunk)]}
    assert quality.valid_visual(chart, research.valid_proofs, [chunk])
    chart["rows"][0]["cells"][1] = "99"
    assert quality.valid_visual(chart, research.valid_proofs, [chunk]) is None
    chart["rows"][0]["cells"][1] = "67.73"
    chart["conditions"] = ""
    assert quality.valid_visual(chart, research.valid_proofs, [chunk]) is None


def test_uncited_optional_flow_annotation_is_omitted_not_changed_or_treated_as_data():
    chunk = excerpt()
    diagram = flow(chunk)
    diagram["nodes"][0]["label"] = "Distillation (999 samples)"
    checked = quality.valid_visual(diagram, research.valid_proofs, [chunk])
    assert checked["nodes"][0]["label"] == "Distillation"
    assert checked["omitted_numeric_annotations"] == ["(999 samples)"]
    diagram["nodes"][0]["label"] = "999 samples for distillation"
    assert quality.valid_visual(diagram, research.valid_proofs, [chunk]) is None

def test_final_coverage_cannot_remain_answered_when_its_claim_was_rejected(monkeypatch):
    chunk = excerpt()
    working = state(chunk)
    working["report_data"] = research.validate_draft({"sections": [{"key": "mechanism", "claims": [claim(chunk)]}], "visuals": [flow(chunk)]}, [chunk], {"A1-K1"})
    audit = ReportAudit(verdicts=[{"claim_index": 0, "verdict": "unsupported", "reason": "Wrong interpretation"},
                                 {"claim_index": 1, "verdict": "unsupported", "reason": "Wrong edge"}],
                        questions=[{"question_index": 0, "status": "answered", "explanation": "Bad stale status", "claim_indices": [0], "evidence": [proof(chunk)]}])
    monkeypatch.setattr(research, "_call", lambda *args, **kwargs: audit)
    result = research.audit_evidence(working)
    assert result["coverage"][0]["status"] == "partial"
    assert result["coverage"][0]["assessment"] == "unverified"
    assert result["report_data"]["visuals"] == []

def test_audit_reconciles_written_answer_using_valid_quote_refs(monkeypatch):
    chunk = excerpt()
    working = state(chunk)
    working["report_data"] = research.validate_draft({"sections": [{"key": "mechanism", "claims": [claim(chunk)]}]}, [chunk])
    audit = ReportAudit(verdicts=[{"claim_index": 0, "verdict": "supported", "reason": "Source support"}],
                        questions=[{"question_index": 0, "status": "answered", "explanation": "Written answer covers the mechanism", "claim_indices": [0], "evidence": [proof(chunk)]}])
    monkeypatch.setattr(research, "_call", lambda *args, **kwargs: audit)
    result = research.audit_evidence(working)
    assert result["coverage"][0]["status"] == "answered"
    assert result["coverage"][0]["claim_indices"] == [0]
    assert result["report_data"]["metrics"]["length_status"] == "below_target"

@pytest.mark.parametrize("detail,parts", [("concise", 1), ("detailed", 4), ("extended", 4)])
def test_explanation_depth_changes_writing_parts_without_exceeding_budget(monkeypatch, detail, parts):
    chunk = excerpt()
    working = state(chunk)
    working["report_detail"] = detail
    working["research_depth"] = "deep"
    working["sources"][0]["chunks_selected"] = 1
    requests = []
    def respond(state, schema, instruction, payload, limit):
        requests.append(payload["section_keys"])
        state["usage"]["llm_calls"] += 1
        return ReportDraft(title="Paper", sections=[{"key": key, "claims": [claim(chunk)]} for key in payload["section_keys"]])
    monkeypatch.setattr(research, "_call", respond)
    result = research.draft_report(working)
    assert len(requests) == parts
    assert all(section["claims"] for section in result["report_data"]["sections"])
    assert result["usage"]["llm_calls"] <= working["budget"]["max_llm_calls"]

def test_repair_does_not_spend_when_the_following_audit_will_not_fit(monkeypatch):
    chunk = excerpt()
    working = state(chunk)
    working["report_data"] = research.validate_draft({"sections": [{"key": "mechanism", "claims": [claim(chunk)]}]}, [chunk])
    working["report_data"]["metrics"] = quality.report_metrics(working["report_data"], "detailed")
    working["usage"]["input_tokens_estimated"] = working["budget"]["max_input_tokens"] - 500
    before = json.dumps(working)
    monkeypatch.setattr(research, "_call", lambda *args: pytest.fail("Must reserve audit first"))
    assert research.improve_report(working) == {}
    assert json.dumps(working) == before

@pytest.mark.parametrize("value", ["https://arxiv.org/abs/2605.03465v1?x=secret", "https://user:secret@arxiv.org/abs/2605.03465v1", "file:///paper.pdf", "https://evil.example/2605.03465"])
def test_external_visual_connector_does_not_accept_private_or_ambiguous_urls(value):
    assert quality.arxiv_external(value) is None

def test_external_visual_connector_preserves_arxiv_version_without_sending_pdf():
    result = quality.arxiv_external("https://arxiv.org/pdf/2605.03465v1.pdf")
    assert result["url"] == "https://www.arxivisual.org/abs/2605.03465v1"
    assert result["private_pdf_sent"] is False and result["verified"] is False
