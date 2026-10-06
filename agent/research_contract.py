"""Versioned contracts for the evidence-first workflow; not free-form Markdown."""
import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, Field


class LanguageConflict(ValueError):
    pass


def resolve_language(topic: str, selected: str = "auto") -> str:
    """An explicit request must not silently lose to a UI preference."""
    normalized = "".join(character for character in unicodedata.normalize("NFD", topic.lower().replace("đ", "d")) if not unicodedata.combining(character))
    aliases = {"vietnamese": "vi", "tieng viet": "vi", "english": "en", "tieng anh": "en"}
    languages = r"vietnamese|tieng\s+viet|english|tieng\s+anh|french|german|spanish|japanese|korean|chinese|tieng\s+(?:phap|duc|tay ban nha|nhat|han|trung)"
    output_actions = r"\b(?:answer|respond|write|explain|report|summarize|translate|tra loi|viet|giai thich|bao cao|tom tat|trinh bay|dich|phan tich)\b"
    source_actions = r"\b(?:read|search|find|retrieve|crawl|look up|doc|tim|tra cuu|lay nguon)\b"
    explicit = set()
    mentions = list(re.finditer(r"\b(?:in|into|bang|sang|dung|su dung)\s+(" + languages + r")\b", normalized))
    mentions += list(re.finditer(output_actions + r"\s+(?:(?:only|solely|chi|hoan toan|cho tui|cho minh)\s+)?(" + languages + r")\b", normalized))
    for mention in mentions:
        # Source language and output language are independent. A read/search
        # instruction must not conflict with a later instruction to answer.
        context = re.split(r"[\n!?;,]|\.(?:\s|$)", normalized[:mention.start()])[-1][-160:]
        output = list(re.finditer(output_actions, context))
        source = list(re.finditer(source_actions, context))
        direct_output = bool(re.match(output_actions, mention.group(0)))
        if not direct_output and source and (not output or source[-1].end() > output[-1].end()):
            continue
        if not direct_output and not output and re.search(r"\b(?:sources?|docs?|documentation|references?|nguon|tai lieu)\b", context):
            continue
        language_name = " ".join(mention.group(1).split())
        if language_name not in aliases:
            raise LanguageConflict("This release supports Vietnamese/English reports only. / Phiên bản này mới hỗ trợ báo cáo Việt–Anh; hãy chọn một ngôn ngữ đã hỗ trợ.")
        explicit.add(aliases[language_name])
    if len(explicit) > 1 or (explicit and selected != "auto" and selected not in explicit):
        raise LanguageConflict("Prompt and report language conflict. Select Auto or clarify the requested language. / Ngôn ngữ trong prompt và lựa chọn báo cáo mâu thuẫn; chọn Auto hoặc làm rõ yêu cầu.")
    if explicit:
        return explicit.pop()
    if selected in {"vi", "en"}:
        return selected
    return "vi" if re.search(r"[ăâđêôơưàảãạắằẳẵặấầẩẫậéẻẽẹếềểễệíỉĩịóỏõọốồổỗộớờởỡợúủũụứừửữựýỷỹỵ]|\btui\b|\bgiup\b|\btieng viet\b", topic, re.I) else "en"


def resolve_research_topic(topic: str, mode: str, language: str) -> str:
    """A selected paper is the task; a user prompt only narrows its focus."""
    topic = topic.strip()
    if mode == "paper":
        if topic:
            return topic
        return (
            "Phân tích tổng quan bài báo đã chọn theo lĩnh vực: bài toán nghiên cứu, "
            "đóng góp, phương pháp và công thức, kết quả và điều kiện đánh giá, "
            "hạn chế và khả năng tái lập. Giải thích rõ ràng với dẫn chứng từ bài báo; "
            "nêu những phần chưa đủ bằng chứng."
            if language == "vi" else
            "Analyze the selected paper for its discipline: research problem, "
            "contributions, methods and equations, results and evaluation conditions, "
            "limitations and reproducibility. Explain clearly with evidence from the "
            "paper and disclose gaps."
        )
    if len(topic) < 8:
        raise ValueError("Topic needs at least 8 characters.")
    return topic


class ResearchBudget(BaseModel):
    max_searches: int = Field(default=6, ge=0, le=16)
    max_documents: int = Field(default=8, ge=1, le=20)
    max_rounds: int = Field(default=2, ge=1, le=4)
    max_llm_calls: int = Field(default=6, ge=2, le=10)
    max_input_tokens: int = Field(default=60000, ge=6000, le=100000)
    max_output_tokens: int = Field(default=24000, ge=2000, le=30000)
    max_seconds: int = Field(default=360, ge=30, le=900)


def budget_for(depth: str, overrides: dict | None = None) -> ResearchBudget:
    defaults = {
        "quick": dict(max_searches=2, max_documents=3, max_rounds=1, max_llm_calls=4, max_input_tokens=18000, max_output_tokens=8000, max_seconds=180),
        "standard": {},
        "deep": dict(max_searches=10, max_documents=12, max_rounds=3, max_llm_calls=8, max_input_tokens=100000, max_output_tokens=30000, max_seconds=600),
    }
    return ResearchBudget(**{**defaults.get(depth, {}), **(overrides or {})})


class Brief(BaseModel):
    objective: str = Field(max_length=1000)
    intent: Literal["research", "technical_guide", "paper"] = "research"
    questions: list[str] = Field(min_length=1, max_length=7)
    search_queries: list[str] = Field(default_factory=list, max_length=6)
    exclusions: list[str] = Field(default_factory=list, max_length=5)
    discipline: Literal["general", "mathematics", "physics", "chemistry", "biology", "artificial-intelligence"] = "general"


class Proof(BaseModel):
    chunk_id: str
    quote: str = Field(min_length=12, max_length=500)


class QuestionEvidence(BaseModel):
    question_index: int = Field(ge=0)
    status: Literal["answered", "partial", "missing"]
    explanation: str = Field(max_length=800)
    evidence: list[Proof] = Field(default_factory=list, max_length=16)
    assessment: Literal["evidence", "unverified", "processing_error"] = "evidence"
    claim_indices: list[int] = Field(default_factory=list, max_length=12)


class CoverageReview(BaseModel):
    questions: list[QuestionEvidence] = Field(max_length=7)
    follow_up_queries: list[str] = Field(default_factory=list, max_length=4)
    conflicts: list[str] = Field(default_factory=list, max_length=6)
    read_more_chunk_ids: list[str] = Field(default_factory=list, max_length=8)


class CalculationInput(BaseModel):
    label: str = Field(max_length=120)
    value: float
    evidence: list[Proof] = Field(min_length=1, max_length=4)


class Calculation(BaseModel):
    operation: Literal["difference", "mean", "ratio", "percentage_point_difference"]
    inputs: list[CalculationInput] = Field(min_length=2, max_length=8)
    unit: str = Field(default="", max_length=60)


class Claim(BaseModel):
    text: str = Field(min_length=5, max_length=6000)
    kind: Literal["reported", "inference", "recommendation", "illustration", "derived"]
    evidence: list[Proof] = Field(min_length=1, max_length=16)
    question_indices: list[int] = Field(default_factory=list, max_length=7)
    calculation: Calculation | None = None


class VisualNode(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,24}$")
    label: str = Field(min_length=1, max_length=180)


class VisualEdge(BaseModel):
    source: str = Field(max_length=25)
    target: str = Field(max_length=25)
    label: str = Field(default="", max_length=120)


class VisualRow(BaseModel):
    cells: list[str] = Field(min_length=1, max_length=6)


class ReportVisual(BaseModel):
    kind: Literal["flow", "table", "bar"]
    title: str = Field(min_length=1, max_length=180)
    caption: str = Field(min_length=1, max_length=1000)
    section_key: Literal["answer", "scope", "mechanism", "evidence", "limitations", "next_steps"]
    evidence: list[Proof] = Field(min_length=1, max_length=16)
    nodes: list[VisualNode] = Field(default_factory=list, max_length=8)
    edges: list[VisualEdge] = Field(default_factory=list, max_length=12)
    columns: list[str] = Field(default_factory=list, max_length=6)
    rows: list[VisualRow] = Field(default_factory=list, max_length=10)
    unit: str = Field(default="", max_length=60)
    conditions: str = Field(default="", max_length=800)


SECTION_KEYS = ("answer", "scope", "mechanism", "evidence", "limitations", "next_steps")
SECTION_TITLES = {
    "vi": ("Trả lời trực tiếp", "Phạm vi và câu hỏi", "Giải thích cơ chế / phương pháp", "Kết quả và đối chiếu bằng chứng", "Phản biện và giới hạn", "Áp dụng và kiểm chứng tiếp"),
    "en": ("Direct answer", "Scope and questions", "Mechanism / methods", "Results and evidence comparison", "Critical review and limitations", "Application and next checks"),
}


class ReportSection(BaseModel):
    key: Literal["answer", "scope", "mechanism", "evidence", "limitations", "next_steps"]
    claims: list[Claim] = Field(default_factory=list, max_length=8)


class ReportDraft(BaseModel):
    title: str = Field(max_length=240)
    sections: list[ReportSection] = Field(max_length=6)
    # Nodes reference validated mechanism claims. No invented numeric chart data.
    diagram_claim_indices: list[int] = Field(default_factory=list, max_length=8)
    visuals: list[ReportVisual] = Field(default_factory=list, max_length=6)


class ClaimVerdict(BaseModel):
    claim_index: int = Field(ge=0)
    verdict: Literal["supported", "partial", "unsupported"]
    reason: str = Field(max_length=500)


class QualityCheck(BaseModel):
    key: Literal["explanation", "methods", "results", "critical_review", "reproducibility", "visuals"]
    status: Literal["pass", "partial", "missing", "not_applicable"]
    explanation: str = Field(max_length=800)
    claim_indices: list[int] = Field(default_factory=list, max_length=12)
    report_excerpt: str = Field(default="", max_length=400)


class ReportAudit(BaseModel):
    verdicts: list[ClaimVerdict] = Field(max_length=54)
    questions: list[QuestionEvidence] = Field(default_factory=list, max_length=7)
    quality_checks: list[QualityCheck] = Field(default_factory=list, max_length=6)
