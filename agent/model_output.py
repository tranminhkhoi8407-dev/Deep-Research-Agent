"""Provider-compatible wire schemas; strict application validation stays local."""
from pydantic import ValidationError
import html
import re
import json
from langchain_core.messages import HumanMessage, SystemMessage
from agent.research_contract import Claim, CoverageReview, Proof, QuestionEvidence, ReportAudit, ReportDraft, ReportSection, ClaimVerdict, ReportVisual, QualityCheck, VisualDraft


class ModelCallError(RuntimeError):
    def __init__(self, kind: str, message: str, *, fields: list[str] | None = None, issues: list[dict] | None = None):
        super().__init__(message)
        self.kind = kind
        self.fields = (fields or [])[:8]
        self.issues = (issues or [])[:16]


def validation_issues(error: ValidationError, prefix=""):
    # No error message, input, context or model content in product diagnostics.
    # Even an unexpected dictionary key is redacted rather than used as a path.
    allowed = set("visuals kind title caption section_key evidence chunk_id quote quote_id nodes edges columns rows unit conditions dataset metric equation explanation symbols id label inputs outputs source target cells symbol meaning sections claims key text question_indices calculation questions verdicts quality_checks claim_index question_index status reason report_excerpt objective intent discipline search_queries exclusions".split())
    return [{"field": ".".join(filter(None, [prefix, *[str(part) if isinstance(part, int) or part in allowed else "field" for part in item["loc"]]])), "code": item["type"]} for item in error.errors(include_input=False, include_context=False, include_url=False)][:16]


def transport_schema(schema, *, quote_refs=False, quote_ids=None) -> dict:
    # Nested array/string bounds greatly expand Gemini's constrained decoder.
    # Keep shape, types, refs, required fields and enums on the wire; enforce ALL
    # original bounds via the unchanged Pydantic contract after the response.
    ignored = {"title", "description", "default", "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum"}
    def compact(value):
        if isinstance(value, dict):
            return {key: ({name: compact(definition) for name, definition in item.items()} if key in {"properties", "$defs", "definitions"} else compact(item)) for key, item in value.items() if key not in ignored}
        if isinstance(value, list):
            return [compact(item) for item in value]
        return value
    wire = compact(schema.model_json_schema())
    if quote_refs and "Proof" in wire.get("$defs", {}):
        wire["$defs"]["Proof"] = {"type": "object", "properties": {"quote_id": {"type": "string"}}, "required": ["quote_id"]}
        if quote_ids:
            wire["$defs"]["Proof"]["properties"]["quote_id"]["enum"] = list(quote_ids)
        # This small bound avoids oversized multi-proof claims, without the
        # original schema's many nested string/array decoder constraints.
        for name in ("Claim", "QuestionEvidence"):
            definition = wire["$defs"].get(name, {}).get("properties", {}).get("evidence")
            if definition:
                definition["maxItems"] = 16
    return wire


def prepare_evidence_packet(schema, payload):
    """Annotate the same read text once; don't duplicate it as a quote catalog."""
    if schema not in {ReportDraft, VisualDraft, CoverageReview, ReportAudit} or not payload.get("evidence"):
        return payload, {}
    registry, chunks = {}, []
    for chunk in payload["evidence"]:
        text, position, tagged = chunk["text"], 0, []
        while position < len(text):
            end = min(position + 400, len(text))
            if end < len(text):
                boundary = max(text.rfind("\n\n", position + 160, end), text.rfind(". ", position + 160, end))
                if boundary > position:
                    end = boundary + (1 if text[boundary] == "." else 0)
                else:
                    whitespace = text.rfind(" ", position + 160, end)
                    if whitespace > position:
                        end = whitespace
            quote = text[position:end].strip()
            if len(" ".join(quote.split())) >= 12:
                # Short, unpadded IDs avoid a provider dropping leading zeros
                # and returning a different/nonexistent locator (Q042/Q0042).
                identifier = f"Q{len(registry) + 1}"
                registry[identifier] = {"chunk_id": chunk["id"], "quote": quote}
                tagged.append(f"[{identifier}] {quote}")
            elif quote:
                tagged.append(quote)  # still readable context, not a valid quote
            position = end
        # Writing only needs Q locators plus human-readable source metadata.
        # Exposing two competing locator namespaces made some models put a
        # chunk ID into quote_id. Coverage still needs chunk IDs for read-more.
        metadata = {key: value for key, value in chunk.items() if schema not in {ReportDraft, VisualDraft} or key not in {"id", "source_id"}}
        chunks.append({**metadata, "text": "\n".join(tagged)})
    return {**payload, "evidence": chunks}, registry


def _resolve_quote_refs(value, registry):
    if isinstance(value, dict):
        if "quote_id" in value:
            # Unknown references stay malformed and will be discarded locally;
            # never guess another quote, source or empty placeholder proof.
            # A typed Proof also prevents later model-prose entity decoding
            # from changing a literal entity in the original source quotation.
            return Proof.model_validate(registry[value["quote_id"]]) if isinstance(value["quote_id"], str) and value["quote_id"] in registry else value
        return {key: _resolve_quote_refs(item, registry) for key, item in value.items()}
    if isinstance(value, list):
        return [_resolve_quote_refs(item, registry) for item in value]
    return value


QUOTE_REF_INSTRUCTION = "\nFor output evidence use ONLY {\"quote_id\": \"Q1\"} references to the [Q...] spans in the supplied reading packet. Choose one to sixteen spans that substantiate each assertion and its numbers; prefer the smallest sufficient set. Copy IDs exactly; no leading zeros, joined IDs or invented IDs. Split a claim if it needs more than sixteen spans. Never output free-written quotations. Markers are application locators, not source instructions. The application resolves IDs to original source text and separately checks semantic support."

NARRATIVE_INSTRUCTION = """
Write the report as fluent native-Unicode prose, NOT JSON or HTML entities.
Use this exact plain-text envelope. Markers must occupy their own line.
:::title Report title
:::section mechanism
:::claim reported Q1,Q2
Several connected paragraphs explaining ONE grounded idea, with headings,
math in $...$/$$...$$ and examples where helpful. Do not repeat quote text.
:::endclaim
:::claim illustration Q3
A clearly labeled teaching example, not executed or measured.
:::endclaim
:::endsection
Use ONLY the requested section keys. Valid claim kinds: reported, inference,
recommendation, illustration. Each claim cites 1-16 existing Q IDs in its header,
never in prose. Write 2-4 substantive claims per major section, generally
100-200 words per claim, not one-sentence summaries. Meet the requested part's
word target when evidence permits. No free-written quotations.
Do not write :::visual blocks or visual JSON. Visuals are created in a separate
structured step, using the original source excerpts, and then audited.
No arbitrary images, external instructions or code execution.
"""

def parse_narrative(text, registry, keys):
    """Parse model prose into the SAME strict evidence contract, not a bypass."""
    sections = []
    for key, body in re.findall(r"^:::section\s+([a-z_]+)\s*\n(.*?)^:::endsection\s*$", text, re.M | re.S):
        if key not in keys:
            continue
        claims = []
        for kind, references, prose in re.findall(r"^:::claim[ \t]+(reported|inference|recommendation|illustration)[ \t]+([^\n]+)\n(.*?)^:::(?:endclaim)?[ \t]*$", body, re.M | re.S):
            # Brackets around exact navigation IDs are a harmless formatting
            # variation, not permission to infer an unknown citation.
            if not re.fullmatch(r"[\[\]Q\d, \t]+", references):
                continue
            ids = list(dict.fromkeys(re.findall(r"Q\d+", references)))
            if not ids or len(ids) > 16 or any(identifier not in registry for identifier in ids):
                continue
            # Rendering instructions belong to the separate visual contract,
            # never raw JSON/locators inside the reader's explanatory prose.
            prose = re.sub(r"^:::visual[ \t]*\n.*?^:::endvisual[ \t]*$", "", prose, flags=re.M | re.S)
            prose = re.sub(r"^:::heading[ \t]+", "### ", prose, flags=re.M)
            claims.append({"text": prose.strip(), "kind": kind, "evidence": [Proof.model_validate(registry[identifier]) for identifier in ids]})
        sections.append({"key": key, "claims": claims})
    title = re.search(r"^:::title\s+([^\n]+)", text, re.M)
    visuals = []
    for value in re.findall(r"^:::visual\s*\n(.*?)^:::endvisual\s*$", text, re.M | re.S):
        try:
            visual = _resolve_quote_refs(json.loads(value), registry)
            if visual.get("section_key") in keys:
                visuals.append(visual)
        except (ValueError, AttributeError):
            continue
    if not sections or not any(section["claims"] for section in sections):
        raise ModelCallError("malformed_output", "No valid report section envelope was returned.")
    return {"title": title.group(1).strip() if title else "Research analysis", "sections": sections, "visuals": visuals[:2]}


def structured_invoke(llm, schema, messages, *, prepared_payload=None, quote_registry=None):
    module = type(llm).__module__
    native_provider = module.startswith(("langchain_google_genai", "langchain_openai", "langchain_groq"))
    refs = bool(quote_registry) and native_provider
    if refs and schema == ReportDraft and prepared_payload.get("writing_format") == "narrative":
        raw = llm.invoke([SystemMessage(content=messages[0].content + NARRATIVE_INSTRUCTION),
                          HumanMessage(content=json.dumps(prepared_payload, ensure_ascii=False))])
        text = getattr(raw, "text", "")
        if not isinstance(text, str) and callable(text):
            text = text()
        if not isinstance(text, str) or not text:
            text = raw.content if isinstance(raw.content, str) else ""
        try:
            parsed = parse_narrative(text, quote_registry, prepared_payload["section_keys"])
            return {"parsed": parsed, "raw": raw}
        except ModelCallError as error:
            # Preserve provider usage even when the envelope is invalid. Raw
            # model content is NOT persisted in product diagnostics.
            return {"parsed": None, "raw": raw, "parsing_error": error}
    if refs:
        messages = [SystemMessage(content=messages[0].content + QUOTE_REF_INSTRUCTION), *messages[1:-1], HumanMessage(content=json.dumps(prepared_payload, ensure_ascii=False))]
    def constrain_context(wire):
        if schema in {ReportDraft, VisualDraft} and prepared_payload and prepared_payload.get("section_keys"):
            if schema == ReportDraft:
                wire["$defs"]["ReportSection"]["properties"]["key"]["enum"] = prepared_payload["section_keys"]
            wire["$defs"]["ReportVisual"]["properties"]["section_key"]["enum"] = prepared_payload["section_keys"]
        if schema == ReportAudit and prepared_payload and prepared_payload.get("claims"):
            # Quality review can select a literal report-prose anchor rather
            # than re-copying/paraphrasing Unicode or inserting ellipses.
            anchors = [item["text"][:180] for item in prepared_payload["claims"] if not item.get("is_visual")]
            wire["$defs"]["QualityCheck"]["properties"]["report_excerpt"]["enum"] = list(dict.fromkeys(["", *anchors]))
        return wire
    if module.startswith("langchain_google_genai"):
        wire = constrain_context(transport_schema(schema, quote_refs=refs, quote_ids=quote_registry))
        result = llm.with_structured_output(wire, method="json_schema", include_raw=True).invoke(messages)
    elif refs:
        # Other adapters need a root schema title to name the structured tool.
        wire = constrain_context({**transport_schema(schema, quote_refs=True, quote_ids=quote_registry), "title": schema.__name__})
        result = llm.with_structured_output(wire, include_raw=True).invoke(messages)
    else:
        return llm.with_structured_output(schema, include_raw=True).invoke(messages)
    if refs and isinstance(result, dict) and result.get("parsed") is not None:
        result = {**result, "parsed": _resolve_quote_refs(result["parsed"], quote_registry)}
    return result


def validate_response(schema, value, *, issues=None):
    """Keep valid independent items; never invent, shorten or relax evidence.

    One malformed claim/quote must not erase every other valid claim. The final
    object and every retained atom still pass the original strict contracts.
    Unknown root shapes remain fatal rather than being guessed/reconstructed.
    """
    # Some providers HTML-escape JSON prose. Decode complete entities only,
    # never reinterpret chunk IDs/enum values or malformed numeric entities.
    def decode(item, key=""):
        if isinstance(item, dict):
            return {name: decode(text, name) for name, text in item.items()}
        if isinstance(item, list):
            return [decode(text, key) for text in item]
        if isinstance(item, str) and key in {"title", "text", "quote", "explanation", "reason", "objective", "questions", "exclusions", "caption", "label", "inputs", "outputs", "cells", "meaning", "conditions", "dataset", "metric"}:
            return re.sub(r"&(?:#(?:[0-9]+|[xX][0-9a-fA-F]+)|[A-Za-z][A-Za-z0-9]+);", lambda match: html.unescape(match.group()), item)
        return item
    value = decode(value)
    if schema == ReportDraft and isinstance(value, dict):
        # Q IDs are navigation markers, not scientific numerals or citations
        # to expose in prose. The separate evidence field remains mandatory.
        for section in value.get("sections", []) if isinstance(value.get("sections"), list) else []:
            for claim in section.get("claims", []) if isinstance(section, dict) and isinstance(section.get("claims"), list) else []:
                if isinstance(claim, dict) and isinstance(claim.get("text"), str):
                    claim["text"] = re.sub(r"\[Q\d+(?:[,\s]+Q\d+)*\]", "", claim["text"])
    # Native providers omit string bounds. Preserve an otherwise valid long
    # explanation by re-segmenting prose without changing/cutting its content
    # or inventing citations. All resulting claims remain strictly validated
    # and separately audited. Never apply this to source quotations.
    if schema == ReportDraft and isinstance(value, dict) and isinstance(value.get("sections"), list):
        value = {**value, "sections": [dict(section) if isinstance(section, dict) else section for section in value["sections"]]}
        for section in value["sections"]:
            if not isinstance(section, dict) or not isinstance(section.get("claims"), list):
                continue
            expanded = []
            for claim in section["claims"]:
                if not isinstance(claim, dict) or not isinstance(claim.get("text"), str) or len(claim["text"]) <= 6000 or len(claim["text"]) > 48000:
                    expanded.append(claim)
                    continue
                remaining = claim["text"]
                while len(remaining) > 6000:
                    boundary = remaining.rfind("\n\n", 2000, 5800)
                    if boundary < 2000:
                        boundary = remaining.rfind(". ", 2000, 5800)
                    if boundary < 2000:
                        boundary = remaining.rfind(" ", 2000, 5800)
                    if boundary < 2000:
                        break
                    expanded.append({**claim, "text": remaining[:boundary]})
                    remaining = remaining[boundary:]
                expanded.append({**claim, "text": remaining})
            section["claims"] = expanded
    try:
        return schema.model_validate(value), []
    except ValidationError as error:
        if issues is not None:
            issues.extend(validation_issues(error))
        if not isinstance(value, dict):
            raise
        cleaned, removed = dict(value), []

        def keep(model, items, path):
            if not isinstance(items, list):
                return items  # final strict validation rejects wrong shapes
            accepted = []
            for index, item in enumerate(items):
                try:
                    accepted.append(model.model_validate(item).model_dump())
                except ValidationError:
                    removed.append(f"{path}.{index}")
            return accepted

        if schema == ReportDraft and isinstance(value.get("sections"), list):
            sections = []
            for index, section in enumerate(value["sections"]):
                if not isinstance(section, dict):
                    removed.append(f"sections.{index}")
                    continue
                section = {**section, "claims": keep(Claim, section.get("claims", []), f"sections.{index}.claims")}
                if isinstance(section["claims"], list) and len(section["claims"]) > 8:
                    removed.append(f"sections.{index}.claims.overflow")
                    section["claims"] = section["claims"][:8]
                sections.extend(keep(ReportSection, [section], f"sections.{index}"))
            cleaned["sections"] = sections
            if "visuals" in value:
                cleaned["visuals"] = keep(ReportVisual, value["visuals"], "visuals")
        elif schema == VisualDraft and isinstance(value.get("visuals"), list):
            accepted = keep(ReportVisual, value["visuals"], "visuals")
            if len(accepted) > 2:
                removed.append("visuals.overflow")
            cleaned["visuals"] = accepted[:2]
        elif schema == CoverageReview and isinstance(value.get("questions"), list):
            questions = []
            for index, question in enumerate(value["questions"]):
                if not isinstance(question, dict):
                    removed.append(f"questions.{index}")
                    continue
                question = {**question, "evidence": keep(Proof, question.get("evidence", []), f"questions.{index}.evidence")}
                # Without a valid quote, answered/partial cannot be claimed.
                if question.get("evidence") == []:
                    question["status"] = "missing"
                    question["assessment"] = "processing_error"
                questions.extend(keep(QuestionEvidence, [question], f"questions.{index}"))
            cleaned["questions"] = questions
        elif schema == ReportAudit and isinstance(value.get("verdicts"), list):
            cleaned["verdicts"] = keep(ClaimVerdict, value["verdicts"], "verdicts")
            if "questions" in value:
                cleaned["questions"] = keep(QuestionEvidence, value["questions"], "questions")
            if "quality_checks" in value:
                cleaned["quality_checks"] = keep(QualityCheck, value["quality_checks"], "quality_checks")
        else:
            raise
        validated = schema.model_validate(cleaned)
        if not removed:
            raise  # no recognized local defect was safely removed
        return validated, removed


def classify_error(error: Exception) -> ModelCallError:
    if isinstance(error, ModelCallError):
        return error
    if isinstance(error, ValidationError):
        issues = validation_issues(error)
        return ModelCallError("invalid_structure", "The model response did not pass the report contract.", fields=[item["field"] for item in issues], issues=issues)
    name = type(error).__name__.lower()
    detail = str(error).lower()  # classify only; NEVER persist provider body/prompts/keys
    if "outputparser" in name or "jsondecode" in name:
        return ModelCallError("invalid_structure", "The model response could not be parsed as the required report structure.")
    if "429" in detail or "resource_exhausted" in detail or "ratelimit" in name:
        return ModelCallError("rate_limit", "The model provider rate limit was reached.")
    if "timeout" in name or "deadline" in name or "deadline_exceeded" in detail or "timed out" in detail:
        return ModelCallError("timeout", "The model request timed out.")
    if "401" in detail or "403" in detail or "authentication" in name:
        return ModelCallError("authentication", "The configured model could not be authenticated or accessed.")
    if "400" in detail or "invalidargument" in name or "invalidrequest" in name:
        return ModelCallError("invalid_request", "The model provider rejected the request configuration or schema.")
    return ModelCallError("model_error", "The model call failed; no unsupported replacement content was generated.")


ERROR_LABELS = {
    "vi": {
        "invalid_request": "Dịch vụ model từ chối cấu hình yêu cầu hoặc cấu trúc đầu ra.",
        "invalid_structure": "Model trả về dữ liệu chưa đúng cấu trúc báo cáo.",
        "invalid_items": "Đã loại các mục sai cấu trúc; chỉ giữ nội dung hợp lệ để kiểm tra dẫn chứng.",
        "source_mismatch": "Đã loại nhận xét có trích dẫn không khớp, số liệu thiếu dẫn chứng hoặc đường link không có trong nguồn đã dẫn.",
        "output_limit": "Đầu ra model bị cắt do giới hạn token của lần gọi.",
        "empty_response": "Model không trả về nội dung phân tích hợp lệ.",
        "rate_limit": "Dịch vụ model đang giới hạn số lượt gọi.",
        "timeout": "Lượt gọi model quá thời gian chờ.",
        "authentication": "Không xác thực hoặc không truy cập được model đã cấu hình.",
        "input_budget": "Không còn đủ ngân sách token đầu vào cho bước này.",
        "output_budget": "Không còn đủ ngân sách token đầu ra cho bước này.",
        "call_budget": "Đã hết số lượt gọi model cho phiên này.",
        "time_budget": "Đã hết ngân sách thời gian cho phiên này.",
        "model_error": "Lượt gọi model thất bại; không tự tạo nội dung thay thế thiếu bằng chứng.",
    },
    "en": {},
}


def record_failure(state: dict, stage: str, error: Exception):
    failure = classify_error(error)
    label = ERROR_LABELS.get(state.get("report_language", "en"), {}).get(failure.kind, str(failure))
    state.setdefault("diagnostics", []).append({"stage": stage, "kind": failure.kind, "message": label, "fields": failure.fields, **({"issues": failure.issues} if failure.issues else {})})
    state["warnings"].append(f"{stage}: {label}")
