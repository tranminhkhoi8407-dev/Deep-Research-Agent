"""Model wire response -> strict parsing -> source checks -> semantic audit.

Public MediaPipe wording is from the excerpts in the failed user report, not a
hand-authored report figure. Tests use a native-provider double; no paid calls.
"""
import copy
import json
import time
from types import SimpleNamespace

import pytest
from agent import deep_research as research, nodes
from agent.model_output import validate_response, validation_issues
from agent.research_contract import ReportDraft, VisualDraft, budget_for, SECTION_KEYS
from pydantic import ValidationError

SOURCE = "The hand landmarker model bundle contains a palm detection model and a hand landmarks detection model. The Palm detection model locates hands within the input image, and the hand landmarks detection model identifies specific hand landmarks on the cropped hand image defined by the palm detection model."
URL = "https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker"


def working_state():
    proof = {"chunk_id": "C1", "quote": SOURCE}
    return {"topic": "Giải thích MediaPipe với sơ đồ bằng tiếng Việt", "report_language": "vi", "report_detail": "extended", "research_depth": "deep", "analysis_mode": "research", "started_at": time.time(), "budget": budget_for("deep").model_dump(), "usage": dict(llm_calls=0, input_tokens_estimated=0, input_tokens_measured=0, output_tokens_reserved=0, output_tokens_measured=0), "diagnostics": [], "warnings": [], "brief": {"intent": "technical_guide", "objective": "Giải thích luồng MediaPipe", "questions": ["Luồng xử lý là gì?"], "exclusions": []}, "sources": [{"id": "S1", "url": URL, "title": "Hand Landmarker", "chunks_selected": 1}], "evidence": [{"id": "C1", "source_id": "S1", "text": SOURCE, "url": URL, "title": "Hand Landmarker", "locator": "Model bundle"}], "report_data": {"title": "MediaPipe", "sections": [{"key": key, "claims": [{"text": "Bộ model dùng bộ phát hiện lòng bàn tay để xác định vùng ảnh, rồi xác định các điểm bàn tay trong ảnh đã cắt.", "kind": "reported", "evidence": [proof]}] if key == "mechanism" else []} for key in SECTION_KEYS], "visuals": []}}


def wire_visual():
    evidence = [{"quote_id": "Q1"}]
    return {"kind": "flow", "title": "MediaPipe: phát hiện và định vị", "caption": "Sơ đồ do agent dựng lại từ tài liệu.", "section_key": "mechanism", "evidence": evidence, "nodes": [{"id": "palm", "label": "Phát hiện lòng bàn tay", "explanation": "Xác định vùng bàn tay trong ảnh.", "inputs": "Ảnh đầu vào", "outputs": "Vùng ảnh bàn tay", "evidence": evidence}, {"id": "landmarks", "label": "Định vị điểm bàn tay", "explanation": "Xác định các điểm trên ảnh bàn tay đã cắt.", "evidence": evidence}], "edges": [{"source": "palm", "target": "landmarks", "label": "Vùng ảnh được xác định", "evidence": evidence}]}


class NativeProvider:
    def __init__(self, mode="valid", audit="supported"):
        self.mode, self.audit, self.generations, self.requests = mode, audit, 0, []

    def with_structured_output(self, schema, **kwargs):
        assert kwargs == {"method": "json_schema", "include_raw": True}
        assert isinstance(schema, dict)
        return SimpleNamespace(invoke=lambda messages: self.run(schema, messages))

    def invoke(self, messages):
        payload = json.loads(messages[-1].content)
        assert "Do not write :::visual blocks" in messages[0].content
        assert "Optional sourced visuals" not in messages[0].content
        text = ":::title MediaPipe\n" + "\n".join(f":::section {key}\n:::claim reported Q1\nBộ model dùng bộ phát hiện lòng bàn tay để xác định vùng ảnh, rồi xác định các điểm bàn tay trong ảnh đã cắt.\n:::endclaim\n:::endsection" for key in payload["section_keys"])
        return SimpleNamespace(content=text, usage_metadata={"input_tokens": 500, "output_tokens": 600})

    def run(self, schema, messages):
        payload = json.loads(messages[-1].content)
        self.requests.append((schema, payload))
        if "visuals" in schema["properties"]:
            assert "sections" not in schema["properties"], "Separate visual-only schema"
            assert schema["$defs"]["ReportVisual"]["properties"]["section_key"]["enum"] == ["mechanism", "evidence"]
            assert schema["$defs"]["Proof"]["properties"]["quote_id"]["enum"] == ["Q1"]
            assert "id" not in payload["evidence"][0]
            self.generations += 1
            visual = wire_visual()
            if self.mode in {"malformed", "always_malformed"} and (self.generations == 1 or self.mode == "always_malformed"):
                visual["nodes"][0]["id"] = "palm-detect"
            if self.mode == "uncited":
                visual["nodes"][0]["outputs"] = "999 FPS"
            if self.mode == "unknown_quote":
                visual["nodes"][0]["evidence"] = [{"quote_id": "Q404"}]
            result = {"visuals": [visual]}
        else:
            assert "verdicts" in schema["properties"]
            figure = next(item for item in payload["claims"] if item.get("is_visual"))
            assert figure["visual"]["edges"][0]["evidence"][0]["quote"] == SOURCE
            assert figure["visual"]["nodes"][0]["inputs"] == "Ảnh đầu vào"
            assert payload["visuals_requested"] is True
            result = {"verdicts": [{"claim_index": item["claim_index"], "verdict": self.audit if item.get("is_visual") else "supported", "reason": "Wire regression review"} for item in payload["claims"]], "quality_checks": [{"key": "visuals", "status": "not_applicable", "explanation": "Double incorrectly tries N/A"}]}
        return {"parsed": result, "raw": SimpleNamespace(usage_metadata={"input_tokens": 350, "output_tokens": 500}), "parsing_error": None}


NativeProvider.__module__ = "langchain_google_genai.chat_models"


@pytest.mark.parametrize("mode,attempts", [("valid", 1), ("malformed", 2)])
def test_native_wire_generation_repairs_format_then_checks_full_semantics(monkeypatch, mode, attempts):
    llm = NativeProvider(mode)
    monkeypatch.setattr(nodes, "get_llm", lambda: llm)
    state = working_state()
    state.update(research.generate_visuals(state))
    assert state["report_data"]["visual_status"]["attempts"] == attempts
    assert state["report_data"]["visual_status"]["status"] == "pending_audit"
    assert state["report_data"]["visuals"][0]["verification"] == "quote_matched"
    state.update(research.audit_evidence(state))
    assert state["report_data"]["visual_status"]["status"] == "ready"
    assert state["report_data"]["visuals"][0]["verification"] == "model_checked"
    assert state["usage"]["llm_calls"] == attempts + 1
    if mode == "malformed":
        issue = state["diagnostics"][0]["issues"][0]
        assert issue == {"field": "visuals.0.nodes.0.id", "code": "string_pattern_mismatch"}
        assert llm.requests[1][1]["repair_issues"] == [issue]


@pytest.mark.parametrize("mode,status", [("always_malformed", "invalid_structure"), ("uncited", "source_rejected"), ("unknown_quote", "invalid_structure")])
def test_unrepaired_figures_are_not_presented_as_missing_scientific_data(monkeypatch, mode, status):
    monkeypatch.setattr(nodes, "get_llm", lambda: NativeProvider(mode))
    result = research.generate_visuals(working_state())
    assert not result["report_data"]["visuals"]
    assert result["report_data"]["visual_status"]["status"] == status
    assert result["report_data"]["visual_status"]["attempts"] == 2
    assert result["report_data"]["visual_status"]["issues"]
    assert "999 FPS" not in json.dumps(result["diagnostics"])
    assert "palm-detect" not in json.dumps(result["diagnostics"])


def test_visual_quote_matching_never_bypasses_semantic_rejection(monkeypatch):
    monkeypatch.setattr(nodes, "get_llm", lambda: NativeProvider(audit="unsupported"))
    state = working_state()
    state.update(research.generate_visuals(state))
    state.update(research.audit_evidence(state))
    assert not state["report_data"]["visuals"]
    assert state["report_data"]["visual_status"]["status"] == "audit_rejected"
    assert state["report_data"]["quality_checks"][0]["status"] == "partial", "Requested visuals cannot become not_applicable"


@pytest.mark.parametrize("change,kind", [(lambda s: s["usage"].update(llm_calls=7), "call_budget"), (lambda s: s["usage"].update(input_tokens_estimated=99000), "input_budget"), (lambda s: s["usage"].update(output_tokens_reserved=29000), "output_budget"), (lambda s: s.update(started_at=time.time() - 601), "time_budget")])
def test_generation_never_spends_final_audit_reserve(monkeypatch, change, kind):
    monkeypatch.setattr(nodes, "get_llm", lambda: pytest.fail("Must not spend"))
    state = working_state()
    change(state)
    old = copy.deepcopy(state)
    result = research.generate_visuals(state)
    assert result["report_data"]["visual_status"]["status"] == "budget_exhausted"
    assert result["report_data"]["visual_status"]["budget_kind"] == kind
    assert result["usage"] == old["usage"]
    assert state == old, "Never mutate a previous graph checkpoint"


def test_draft_leaves_calls_for_visual_create_repair_and_audit(monkeypatch):
    state = working_state()
    state["usage"]["llm_calls"] = 2
    writes = []
    def call(state, schema, instruction, payload, output_limit):
        assert schema == ReportDraft
        assert "do not embed visual JSON" in instruction
        writes.append(payload["section_keys"])
        state["usage"]["llm_calls"] += 1
        return ReportDraft(title="MediaPipe", sections=[])
    monkeypatch.setattr(research, "_call", call)
    result = research.draft_report(state)
    assert len(writes) == 3
    assert result["usage"]["llm_calls"] == 5


def test_diagnostics_expose_paths_types_only_not_private_values():
    value = {"visuals": [{**wire_visual(), "nodes": [{"id": "PRIVATE secret", "label": "Test"}]}]}
    issues = []
    parsed, removed = validate_response(VisualDraft, value, issues=issues)
    assert not parsed.visuals and removed == ["visuals.0"]
    assert any(item["field"] == "visuals.0.nodes.0.id" for item in issues)
    assert "PRIVATE" not in json.dumps(issues)
    assert all(set(item) == {"field", "code"} for item in issues)
    with pytest.raises(ValidationError) as failure:
        VisualDraft.model_validate(value)
    assert "PRIVATE" not in json.dumps(validation_issues(failure.value))


def test_focused_mechanism_does_not_mix_legacy_or_third_party_wrappers():
    state = working_state()
    # The real brief was labeled research, not technical_guide. Focus must not
    # depend on that classifier being perfect.
    state["brief"]["intent"] = "research"
    state["sources"] += [{"id": "OLD", "url": "https://mediapipe.readthedocs.io/en/latest/solutions/hands.html", "title": "MediaPipe Legacy Solutions"}, {"id": "WRAPPER", "url": "https://github.com/geaxgx/depthai_hand_tracker", "title": "MediaPipe models on DepthAI"}]
    state["evidence"] += [{"id": "C2", "source_id": "OLD", "text": "The legacy static_image_mode method runs detection and tracking."}, {"id": "C3", "source_id": "WRAPPER", "text": "The third-party Solo and Duo mode pipeline uses different settings."}]
    before = copy.deepcopy(state)
    assert {chunk["source_id"] for chunk in research._visual_packet(state)} == {"S1"}
    assert state == before, "Related sources remain in the report ledger"
    state["topic"] = "Compare MediaPipe versus DepthAI"
    assert "WRAPPER" in {chunk["source_id"] for chunk in research._visual_packet(state)}


def test_unavailable_audit_cannot_keep_generated_figures(monkeypatch):
    monkeypatch.setattr(nodes, "get_llm", lambda: NativeProvider())
    state = working_state()
    state.update(research.generate_visuals(state))
    state["usage"]["llm_calls"] = state["budget"]["max_llm_calls"]
    state.update(research.audit_evidence(state))
    assert not state["report_data"]["visuals"]
    assert state["report_data"]["visual_status"]["status"] == "audit_unavailable"


def test_concise_run_without_visual_request_does_not_call_model(monkeypatch):
    monkeypatch.setattr(nodes, "get_llm", lambda: pytest.fail("Unrequested generation"))
    state = working_state()
    state.update(topic="Explain MediaPipe", report_detail="concise")
    result = research.generate_visuals(state)
    assert result["report_data"]["visual_status"]["status"] == "not_requested"
    assert result["usage"]["llm_calls"] == 0


def test_full_native_writing_visual_repair_audit_path_fits_original_deep_caps(monkeypatch):
    llm = NativeProvider("malformed")
    monkeypatch.setattr(nodes, "get_llm", lambda: llm)
    state = working_state()
    # Simulate already completed brief + coverage (same as real report).
    state["usage"]["llm_calls"] = 2
    state["usage"]["input_tokens_estimated"] = 12000
    original_budget = copy.deepcopy(state["budget"])
    state.update(research.draft_report(state))
    assert sum(len(section["claims"]) for section in state["report_data"]["sections"]) == 6
    state.update(research.generate_visuals(state))
    state.update(research.audit_evidence(state))
    assert state["report_data"]["visual_status"]["status"] == "ready"
    assert state["usage"]["llm_calls"] == 8
    assert state["budget"] == original_budget
    assert state["usage"]["input_tokens_estimated"] <= original_budget["max_input_tokens"]
    assert state["usage"]["output_tokens_reserved"] <= original_budget["max_output_tokens"]
