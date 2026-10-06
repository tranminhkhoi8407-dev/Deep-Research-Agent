"""Provider compatibility and granular validation; no network/model spending."""
import json
import re
import time
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from agent import deep_research as research, nodes
from agent.model_output import ModelCallError, _resolve_quote_refs, classify_error, parse_narrative, prepare_evidence_packet, record_failure, transport_schema, validate_response
from agent.research_contract import Brief, CoverageReview, ReportAudit, ReportDraft, budget_for


def state():
    return {"report_language": "vi", "started_at": time.time(), "budget": budget_for("deep").model_dump(), "usage": dict(llm_calls=0, input_tokens_estimated=0, input_tokens_measured=0, output_tokens_reserved=0, output_tokens_measured=0), "warnings": [], "diagnostics": []}


def proof(quote="The method uses two stages."):
    return {"chunk_id": "A1-K1-C1", "quote": quote}


def claim():
    return {"text": "The method uses two stages.", "kind": "reported", "evidence": [proof()]}


def test_wire_schema_preserves_real_property_names_shape_and_enums():
    wire = transport_schema(ReportDraft)
    assert "title" in wire["properties"]
    assert "title" in wire["required"]
    assert wire["$defs"]["Claim"]["properties"]["kind"]["enum"] == ["reported", "inference", "recommendation", "illustration", "derived"]
    assert wire["$defs"]["Proof"]["required"] == ["chunk_id", "quote"]
    assert "maxLength" not in json.dumps(wire)
    assert "maxItems" not in json.dumps(wire)
    with pytest.raises(ValidationError):
        ReportDraft.model_validate({"title": "x" * 241, "sections": []})


def test_one_bad_claim_does_not_destroy_other_strictly_valid_claims():
    invalid = {**claim(), "evidence": []}
    raw = {"title": "Paper", "sections": [{"key": "answer", "claims": [claim(), invalid]}, {"key": "mechanism", "claims": [claim()]}]}
    parsed, removed = validate_response(ReportDraft, raw)
    assert len(parsed.sections[0].claims) == 1
    assert len(parsed.sections[1].claims) == 1
    assert removed == ["sections.0.claims.1"]
    assert raw["sections"][0]["claims"][1]["evidence"] == []
    assert ReportDraft.model_validate(parsed)


def test_invalid_quote_is_removed_not_shortened_or_invented():
    raw = {"questions": [{"question_index": 0, "status": "answered", "explanation": "Method", "evidence": [proof("x" * 501)]}, {"question_index": 1, "status": "answered", "explanation": "Method", "evidence": [proof()]}]}
    parsed, removed = validate_response(CoverageReview, raw)
    assert parsed.questions[0].status == "missing"
    assert not parsed.questions[0].evidence
    assert parsed.questions[1].evidence[0].quote == proof()["quote"]
    assert removed == ["questions.0.evidence.0"]


def test_bad_audit_item_is_omitted_not_changed_to_supported():
    raw = {"verdicts": [{"claim_index": 0, "verdict": "supported", "reason": "Source"}, {"claim_index": 1, "verdict": "probably", "reason": "Not valid"}]}
    parsed, removed = validate_response(ReportAudit, raw)
    assert len(parsed.verdicts) == 1 and parsed.verdicts[0].claim_index == 0
    assert removed == ["verdicts.1"]


@pytest.mark.parametrize("raw", [None, [], {"title": "x" * 241, "sections": []}, {"title": "Paper", "sections": "not an array"}])
def test_invalid_root_contract_still_fails(raw):
    with pytest.raises(ValidationError):
        validate_response(ReportDraft, raw)


def test_native_google_schema_is_compact_but_local_validation_is_strict(monkeypatch):
    class GoogleDouble:
        def with_structured_output(self, schema, **kwargs):
            assert isinstance(schema, dict) and kwargs == {"method": "json_schema", "include_raw": True}
            return SimpleNamespace(invoke=lambda messages: {"parsed": {"objective": "x" * 1001, "questions": ["Question"]}, "raw": SimpleNamespace(usage_metadata={"input_tokens": 20, "output_tokens": 30}), "parsing_error": None})
    GoogleDouble.__module__ = "langchain_google_genai.chat_models"
    monkeypatch.setattr(nodes, "get_llm", lambda: GoogleDouble())
    working = state()
    with pytest.raises(ValidationError):
        research._call(working, Brief, "Parse", {}, 1200)
    assert working["usage"]["llm_calls"] == 1
    assert working["usage"]["output_tokens_reserved"] == 30


def test_truncated_output_and_provider_error_are_distinct_and_safe(monkeypatch):
    class LLMDouble:
        def with_structured_output(self, *args, **kwargs):
            return SimpleNamespace(invoke=lambda messages: {"parsed": None, "raw": SimpleNamespace(response_metadata={"finish_reason": "MAX_TOKENS"}, usage_metadata={"output_tokens": 50}), "parsing_error": None})
    monkeypatch.setattr(nodes, "get_llm", lambda: LLMDouble())
    working = state()
    with pytest.raises(ModelCallError) as failure:
        research._call(working, Brief, "Parse", {}, 1200)
    assert failure.value.kind == "output_limit"
    record_failure(working, "draft_report", RuntimeError("400 INVALID_ARGUMENT secret-key raw private source"))
    assert working["diagnostics"][-1]["kind"] == "invalid_request"
    assert "secret-key" not in json.dumps(working["diagnostics"])
    assert "private source" not in " ".join(working["warnings"])


@pytest.mark.parametrize("kind,change", [
    ("call_budget", lambda s: s["usage"].update(llm_calls=8)),
    ("input_budget", lambda s: s["usage"].update(input_tokens_estimated=s["budget"]["max_input_tokens"])),
    ("output_budget", lambda s: s["usage"].update(output_tokens_reserved=s["budget"]["max_output_tokens"] - 100)),
    ("time_budget", lambda s: s.update(started_at=time.time() - 601)),
])
def test_budgets_stop_before_model_construction(monkeypatch, kind, change):
    monkeypatch.setattr(nodes, "get_llm", lambda: pytest.fail("Must stop before spending"))
    working = state()
    change(working)
    with pytest.raises(ModelCallError) as failure:
        research._call(working, Brief, "Parse", {}, 1200)
    assert failure.value.kind == kind


def test_validation_diagnostics_never_include_the_rejected_model_text():
    working = state()
    try:
        Brief(objective="PRIVATE" * 200, questions=["Question"])
    except ValidationError as error:
        record_failure(working, "understand_brief", error)
    assert working["diagnostics"][0]["fields"] == ["objective"]
    assert "PRIVATE" not in json.dumps(working["diagnostics"])
    assert classify_error(TimeoutError()).kind == "timeout"


def test_html_escaped_prose_decodes_without_changing_ids_or_malformed_entities():
    raw = {"title": "Ph&#226;n t&#237;ch", "sections": [{"key": "answer", "claims": [{"text": "Explain &lt;think&gt; tags", "kind": "reported", "evidence": [{"chunk_id": "A1-K1-C1", "quote": "Use &lt;think&gt; to separate reasoning."}]}]}]}
    parsed, removed = validate_response(ReportDraft, raw)
    assert not removed
    assert parsed.title == "Phân tích"
    assert parsed.sections[0].claims[0].evidence[0].quote == "Use <think> to separate reasoning."
    assert parsed.sections[0].claims[0].evidence[0].chunk_id == "A1-K1-C1"
    raw["title"] = "t&#7ed5;ng"
    assert validate_response(ReportDraft, raw)[0].title == raw["title"]


def test_quote_packet_uses_original_substrings_without_duplicating_reading_text():
    text = ("First paragraph contains exact original evidence and a documented result. " * 9) + "\n\n" + ("Second paragraph. " * 35)
    payload = {"evidence": [{"id": "A1-K1-C1", "text": text, "page": 2}], "questions": ["Method?"]}
    prepared, registry = prepare_evidence_packet(ReportDraft, payload)
    assert prepared is not payload and payload["evidence"][0]["text"] == text
    assert prepared["evidence"][0]["page"] == 2
    assert len(registry) >= 3
    assert " ".join(re.sub(r"\[Q\d+\] ", "", prepared["evidence"][0]["text"]).split()) == " ".join(text.split())
    for identifier, item in registry.items():
        assert 12 <= len(item["quote"]) <= 400
        assert item["quote"] in text and item["chunk_id"] == "A1-K1-C1"
        assert f"[{identifier}]" in prepared["evidence"][0]["text"]
    # Small unquotable fragments remain context, and hard-wrapped/long words
    # cannot cause the segmenter to stop advancing.
    _, long_registry = prepare_evidence_packet(ReportDraft, {"evidence": [{"id": "X", "text": "x" * 801}]})
    assert len(long_registry) == 2
    assert prepare_evidence_packet(Brief, payload) == (payload, {})


def test_unknown_quote_references_are_discarded_never_guessed():
    _, registry = prepare_evidence_packet(ReportDraft, {"evidence": [{"id": "A1-K1-C1", "text": "The method uses two stages."}]})
    raw = {"title": "Paper", "sections": [{"key": "mechanism", "claims": [
        {**claim(), "evidence": [{"quote_id": "Q1"}]},
        {**claim(), "evidence": [{"quote_id": "UNKNOWN"}]},
        {**claim(), "evidence": [{"quote_id": ["Q1"]}]},
    ]}]}
    parsed, removed = validate_response(ReportDraft, _resolve_quote_refs(raw, registry))
    assert len(parsed.sections[0].claims) == 1
    assert parsed.sections[0].claims[0].evidence[0].model_dump() == proof()
    assert removed == ["sections.0.claims.1", "sections.0.claims.2"]


def test_resolved_source_quote_is_not_html_decoded_as_model_prose():
    literal = "The documentation literally uses &lt;think&gt; as its example."
    _, registry = prepare_evidence_packet(ReportDraft, {"evidence": [{"id": "A1-K1-C1", "text": literal}]})
    raw = {"title": "Ph&#226;n t&#237;ch", "sections": [{"key": "answer", "claims": [{**claim(), "evidence": [{"quote_id": "Q1"}]}]}]}
    parsed, removed = validate_response(ReportDraft, _resolve_quote_refs(raw, registry))
    assert not removed and parsed.title == "Phân tích"
    assert parsed.sections[0].claims[0].evidence[0].quote == literal


def test_native_google_quote_refs_resolve_before_strict_contract_validation(monkeypatch):
    class GoogleDouble:
        def with_structured_output(self, schema, **kwargs):
            assert schema["$defs"]["Proof"]["required"] == ["quote_id"]
            assert schema["$defs"]["Proof"]["properties"]["quote_id"]["enum"] == ["Q1"]
            assert schema["$defs"]["Claim"]["properties"]["evidence"]["maxItems"] == 16
            assert kwargs == {"method": "json_schema", "include_raw": True}
            def invoke(messages):
                assert 'ONLY {"quote_id"' in messages[0].content
                payload = json.loads(messages[-1].content)
                assert "[Q1] The method uses two stages." == payload["evidence"][0]["text"]
                return {"parsed": {"title": "Paper", "sections": [{"key": "mechanism", "claims": [{**claim(), "evidence": [{"quote_id": "Q1"}]}]}]}, "raw": SimpleNamespace(usage_metadata={}), "parsing_error": None}
            return SimpleNamespace(invoke=invoke)
    GoogleDouble.__module__ = "langchain_google_genai.chat_models"
    monkeypatch.setattr(nodes, "get_llm", lambda: GoogleDouble())
    parsed = research._call(state(), ReportDraft, "Explain", {"evidence": [{"id": "A1-K1-C1", "text": proof()["quote"]}]}, 1200)
    assert parsed.sections[0].claims[0].evidence[0].model_dump() == proof()


@pytest.mark.parametrize("module", ["langchain_openai.chat_models.base", "langchain_groq.chat_models"])
def test_tool_based_native_providers_keep_required_schema_title(monkeypatch, module):
    from langchain_core.utils.function_calling import convert_to_openai_function
    class NativeDouble:
        def with_structured_output(self, schema, **kwargs):
            converted = convert_to_openai_function(schema)
            assert converted["name"] == "ReportDraft" and kwargs == {"include_raw": True}
            assert schema["$defs"]["Proof"]["properties"]["quote_id"]["enum"] == ["Q1"]
            return SimpleNamespace(invoke=lambda messages: {"parsed": {"title": "Paper", "sections": [{"key": "mechanism", "claims": [{**claim(), "evidence": [{"quote_id": "Q1"}]}]}]}, "raw": SimpleNamespace(usage_metadata={})})
    NativeDouble.__module__ = module
    monkeypatch.setattr(nodes, "get_llm", lambda: NativeDouble())
    parsed = research._call(state(), ReportDraft, "Explain", {"evidence": [{"id": "A1-K1-C1", "text": proof()["quote"]}]}, 1200)
    assert parsed.sections[0].claims[0].evidence[0].model_dump() == proof()


def test_quote_ref_overhead_is_counted_before_model_spending(monkeypatch):
    monkeypatch.setattr(nodes, "get_llm", lambda: pytest.fail("Must stop before spending"))
    working = state()
    working["budget"]["max_input_tokens"] = 1
    with pytest.raises(ModelCallError) as failure:
        research._call(working, ReportDraft, "Explain", {"evidence": [{"id": "A1-K1-C1", "text": proof()["quote"]}]}, 1200)
    assert failure.value.kind == "input_budget" and working["usage"]["llm_calls"] == 0


def test_authentication_and_timeout_diagnostics_are_not_generic_request_errors():
    class InvalidRequestError(RuntimeError):
        pass
    assert classify_error(InvalidRequestError("403 permission denied")).kind == "authentication"
    assert classify_error(RuntimeError("DEADLINE_EXCEEDED")).kind == "timeout"


def test_narrative_envelope_preserves_unicode_and_only_exact_registered_proofs():
    registry = {"Q1": proof(), "Q2": proof("Training is separate from inference.")}
    prose = "Hai giai đoạn khác nhau: học từ dữ liệu rồi tối ưu bằng phản hồi.\n\nCông thức $R=R_{exec}$ đi cùng định nghĩa."
    text = ":::title Phân tích paper\n:::section mechanism\n:::claim reported [Q1], Q2\n" + prose + "\n:::endclaim\n:::claim inference Q999\nKhông được đoán nguồn.\n:::endclaim\n:::endsection"
    parsed, removed = validate_response(ReportDraft, parse_narrative(text, registry, ["mechanism"]))
    assert not removed and parsed.title == "Phân tích paper"
    assert len(parsed.sections[0].claims) == 1
    assert parsed.sections[0].claims[0].text == prose
    bare = text.replace(":::endclaim", ":::")
    assert parse_narrative(bare, registry, ["mechanism"])["sections"][0]["claims"][0]["text"] == prose
    assert [item.model_dump() for item in parsed.sections[0].claims[0].evidence] == list(registry.values())
    with pytest.raises(ModelCallError):
        parse_narrative(text, registry, ["answer"])
    with pytest.raises(ModelCallError):
        parse_narrative(text.replace("[Q1], Q2", "A1-K1-C1"), registry, ["mechanism"])


def test_narrative_visual_unknown_proof_does_not_get_silently_rebound():
    text = ":::title Paper\n:::section mechanism\n:::claim reported Q1\nThe method uses two stages.\n:::endclaim\n:::endsection\n:::visual\n" + json.dumps({"kind": "flow", "title": "Method", "caption": "Source reconstruction", "section_key": "mechanism", "evidence": [{"quote_id": "A1-K1-C1"}]}) + "\n:::endvisual"
    parsed, removed = validate_response(ReportDraft, parse_narrative(text, {"Q1": proof()}, ["mechanism"]))
    assert parsed.sections[0].claims and not parsed.visuals
    assert removed == ["visuals.0"]


def test_nested_visual_markup_does_not_leak_json_or_navigation_ids_into_prose():
    text = ':::title Paper\n:::section mechanism\n:::claim illustration Q1\n:::heading Overview\nTeaching illustration, not an experiment.\n:::visual\n{"section_key":"mechanism","evidence":[{"quote_id":"Q1"}]}\n:::endvisual\n:::endclaim\n:::endsection'
    parsed = parse_narrative(text, {"Q1": proof()}, ["mechanism"])
    prose = parsed["sections"][0]["claims"][0]["text"]
    assert prose.startswith("### Overview")
    assert ":::visual" not in prose and "quote_id" not in prose and "Q1" not in prose


def test_native_narrative_writer_usage_accounted_and_invalid_envelope_explicit(monkeypatch):
    class GoogleDouble:
        def invoke(self, messages):
            assert "NOT JSON" in messages[0].content
            payload = json.loads(messages[-1].content)
            assert "id" not in payload["evidence"][0]
            return SimpleNamespace(text=self.text, content=self.text, usage_metadata={"input_tokens": 41, "output_tokens": 83})
        text = ":::title Paper\n:::section mechanism\n:::claim reported Q1\nThe method uses two stages.\n:::endclaim\n:::endsection"
    GoogleDouble.__module__ = "langchain_google_genai.chat_models"
    model = GoogleDouble()
    monkeypatch.setattr(nodes, "get_llm", lambda: model)
    payload = {"writing_format": "narrative", "section_keys": ["mechanism"], "evidence": [{"id": "A1-K1-C1", "text": proof()["quote"]}]}
    working = state()
    parsed = research._call(working, ReportDraft, "Explain", payload, 1200)
    assert parsed.sections[0].claims[0].evidence[0].model_dump() == proof()
    assert working["usage"]["output_tokens_reserved"] == 83
    assert working["usage"]["input_tokens_measured"] == 41
    model.text = ":::section mechanism\n:::endsection"
    with pytest.raises(ModelCallError) as failure:
        research._call(working, ReportDraft, "Explain", payload, 1200)
    assert failure.value.kind == "malformed_output"
    assert working["usage"]["output_tokens_reserved"] == 166


def test_long_prose_resegmented_without_rewriting_sources_or_erasing_entire_section():
    long_text = ("A connected explanation with a documented relationship. " * 220)
    raw = {"title": "Paper", "sections": [{"key": "mechanism", "claims": [{**claim(), "text": long_text}]}]}
    parsed, removed = validate_response(ReportDraft, raw)
    assert not removed and len(parsed.sections[0].claims) > 1
    assert "".join(item.text for item in parsed.sections[0].claims) == long_text
    assert all(item.evidence[0].model_dump() == proof() for item in parsed.sections[0].claims)
    raw = {"title": "Paper", "sections": [{"key": "mechanism", "claims": [claim() for _ in range(9)]}]}
    parsed, removed = validate_response(ReportDraft, raw)
    assert len(parsed.sections[0].claims) == 8 and removed == ["sections.0.claims.overflow"]


@pytest.mark.parametrize("kind", ["reported", "inference", "recommendation"])
def test_invented_or_misspelled_urls_do_not_pass_any_claim_kind(kind):
    source = "Our code is available at https://github.com/example/paper."
    evidence = [{"id": "A1-K1-C1", "source_id": "A1-K1", "url": "https://arxiv.org/pdf/1234.5678", "text": source}]
    evidence_proof = {"chunk_id": "A1-K1-C1", "quote": source}
    claims = [{"kind": kind, "text": text, "evidence": [evidence_proof]} for text in [
        "Inspect https://github.com/example/paper for reproduction.",
        "Inspect https://github.1s.ru/example/paper for reproduction.",
        "Read [source](https://arxiv.org/pdf/1234.5678).",
    ]]
    parsed = research.validate_draft({"title": "Paper", "sections": [{"key": "next_steps", "claims": claims}]}, evidence)
    retained = next(section for section in parsed["sections"] if section["key"] == "next_steps")["claims"]
    assert len(retained) == 2 and all("github.1s.ru" not in item["text"] for item in retained)
