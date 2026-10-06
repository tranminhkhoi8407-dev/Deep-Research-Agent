"""Deterministic reading plans and quality checks, not another paid agent.

Heuristics guide reading; they never certify scientific correctness. Calculations
are performed here, never by eval or by trusting a model-provided result.
"""
import math
import re
from decimal import Decimal
from urllib.parse import urlsplit

TOPICS = {
    "problem": r"abstract|introduction|motivation|contribution|background|problem",
    "methods": r"method|framework|architecture|algorithm|proposed|pipeline",
    "training": r"distill|supervised|fine.tun|training|rollout|reasoning bank",
    "equations": r"reward|equation|formula|jaccard|cosine|theorem|lemma|proof",
    "inference": r"inference|candidate|majority|voting|serving|deployment|install|docker",
    "results": r"table\s+[ivx\d]+|benchmark|baseline|accuracy|evaluation|performance",
    "conditions": r"setup|hardware|gpu|memory|latency|dataset|split|parameter|boundary|sample size",
    "ablation": r"ablation|without|w/o|sensitivity|control group",
    "limitations": r"limitation|failure|risk|uncertain|threat|discussion|future|reproducib",
}
SECTION_TOPICS = {
    "answer": ("problem", "methods", "results"),
    "scope": ("problem", "conditions"),
    "mechanism": ("methods", "training", "equations", "inference"),
    "evidence": ("results", "conditions", "ablation"),
    "limitations": ("limitations", "conditions", "ablation"),
    "next_steps": ("inference", "conditions", "limitations"),
}
READING_ANCHORS = {
    "problem": r"^\s*(?:abstract|(?:[ivx\d]+[.)]\s*)?introduction)\b",
    "methods": r"overall.{0,25}(?:pipeline|framework)|(?:stage|step)\s*(?:1|one).*distill|^\s*(?:[ivx\d]+[.)]\s*)?(?:methodology|proposed method)\b",
    "training": r"^\s*(?:[A-Z][.)]\s*)?(?:reasoning\s+)?distillation\b|overall training pipeline|(?:stage|step)\s*1.*distill",
    "equations": r"^\s*(?:[A-Z][.)]\s*)?(?:memory reward|atomic reward|reinforcement learning)\b",
    "inference": r"^\s*(?:[A-Z][.)]\s*)?(?:inference|deployment|serving)\b|inference.{0,40}(?:strategy|procedure|algorithm)",
    "conditions": r"^\s*(?:[A-Z][.)]\s*)?(?:experimental setup|implementation details|datasets|evaluation protocol)\b",
    "ablation": r"^\s*(?:[A-Z][.)]\s*)?ablation\b",
    "limitations": r"^\s*(?:[A-Z][.)]\s*)?(?:limitations|discussion|threats to validity)\b",
}
DETAIL_PROFILES = {
    "concise": {"target_words": [500, 1000], "parts": 1, "call_output": 4500},
    "detailed": {"target_words": [1500, 2500], "parts": 2, "call_output": 7000},
    "extended": {"target_words": [3000, 5000], "parts": 3, "call_output": 9000},
}


def topic_scores(text):
    return {name: min(8, len(re.findall(pattern, text, re.I))) for name, pattern in TOPICS.items()}


def is_reference_chunk(text):
    # Detect bibliography LISTS, not a method paragraph merely citing [12].
    lines = text.splitlines()
    refs = sum(bool(re.match(r"\s*\[\d+\]\s+", line)) for line in lines)
    return refs >= 3 or bool(re.match(r"\s*(?:references|bibliography)\s*\n", text, re.I))


def select_reading(sources, questions, limit, requested=()):
    terms = set(re.findall(r"\w{3,}", " ".join(questions).lower()))
    all_chunks, selected, seen = [], [], set()
    for source in sources:
        for index, chunk in enumerate(source.get("chunks", [])):
            all_chunks.append({**chunk, "id": f"{source['id']}-C{index + 1}", "source_id": source["id"],
                               "url": source["url"], "title": source["title"], "read_status": source["read_status"],
                               "reading_topics": [key for key, score in topic_scores(chunk["text"]).items() if score]})
    by_id = {chunk["id"]: chunk for chunk in all_chunks}
    order = [by_id[key] for key in requested if key in by_id]
    eligible = [chunk for chunk in all_chunks if not is_reference_chunk(chunk["text"])]
    # Round-robin semantic categories protects small but essential setup,
    # distillation and ablation passages against repeated generic summaries.
    for rank in range(3):
        for name, pattern in TOPICS.items():
            ranked = sorted(eligible, key=lambda chunk: len(re.findall(pattern, chunk["text"], re.I)), reverse=True)
            ranked = [chunk for chunk in ranked if name in chunk["reading_topics"]]
            if rank < len(ranked):
                order.append(ranked[rank])
    # At least one excerpt per source, then distributed fallback for unusual
    # disciplinary vocabulary. Do NOT force the tail/bibliography into context.
    for source in sources:
        candidates = [chunk for chunk in eligible if chunk["source_id"] == source["id"]]
        if candidates:
            order.append(candidates[0])
            for fraction in (0.3, 0.6, 0.85):
                order.append(candidates[min(len(candidates) - 1, int(len(candidates) * fraction))])
    order += sorted(eligible, key=lambda chunk: len(terms & set(re.findall(r"\w{3,}", chunk["text"].lower()))), reverse=True)
    used = 0
    for chunk in order:
        fingerprint = " ".join(chunk["text"].split())
        if fingerprint in seen or used + len(chunk["text"]) > limit:
            continue
        selected.append(chunk)
        used += len(chunk["text"])
        seen.add(fingerprint)
    return selected


def reading_dossier(sources, evidence):
    read = {chunk["id"] for chunk in evidence}
    result = []
    for name, pattern in TOPICS.items():
        available = [f"{source['id']}-C{index + 1}" for source in sources
                     for index, chunk in enumerate(source.get("chunks", []))
                     if not is_reference_chunk(chunk["text"]) and re.search(pattern, chunk["text"], re.I)]
        result.append({"topic": name, "selected_chunk_ids": [key for key in available if key in read],
                       "unread_chunk_ids": [key for key in available if key not in read][:6],
                       "status": "selected" if read.intersection(available) else "unread" if available else "not_located"})
    return result


def section_packet(evidence, keys, limit=14000):
    topics = set(topic for key in keys for topic in SECTION_TOPICS[key])
    def score(chunk, topic):
        return topic_scores(chunk["text"])[topic] + (16 if re.search(READING_ANCHORS.get(topic, r"(?!)"), chunk["text"], re.I | re.M) else 0)
    # Prefer actual section headings / overview captions, not a discussion
    # mentioning "method" eight times. Never fill spare space with a reference
    # fragment that has zero relevance to this writing part.
    eligible = [chunk for chunk in evidence if not is_reference_chunk(chunk["text"]) and any(score(chunk, topic) for topic in topics)]
    if not eligible:
        eligible = [chunk for chunk in evidence if not is_reference_chunk(chunk["text"])]
    ranked = sorted(eligible, key=lambda chunk: sum(score(chunk, topic) for topic in topics), reverse=True)
    chosen, used, ids = [], 0, set()
    # Each required topic gets its best candidate before ranking the rest.
    protected = []
    for topic in sorted(topics):
        candidates = sorted(eligible, key=lambda chunk: score(chunk, topic), reverse=True)
        if candidates and score(candidates[0], topic):
            protected.append(candidates[0])
    for chunk in protected + ranked:
        if chunk["id"] in ids or used + len(chunk["text"]) > limit:
            continue
        chosen.append(chunk)
        ids.add(chunk["id"])
        used += len(chunk["text"])
    return chosen


def numbers(text):
    text = re.sub(r'https?://[^\s<>"\x27`]+', "", text)
    # Subscripts/identifiers are checked semantically; this is a conservative
    # measurement filter and intentionally includes numerals in math/code.
    return {Decimal(value.replace(",", ".")) for value in re.findall(r"\d+(?:[.,]\d+)?", text)}


def calculate(calculation, valid_proofs, evidence):
    values = []
    for item in calculation["inputs"]:
        proofs = valid_proofs(item["evidence"], evidence)
        value = float(item["value"])
        signed_values = {Decimal(number.replace(",", ".")) for number in re.findall(r"(?<!\w)[+-]?\d+(?:[.,]\d+)?", " ".join(proof["quote"] for proof in proofs))}
        if not proofs or not math.isfinite(value) or Decimal(str(value)) not in signed_values:
            raise ValueError("Calculation input has no matching cited value")
        values.append(Decimal(str(value)))
    operation = calculation["operation"]
    if operation in {"difference", "percentage_point_difference"} and len(values) == 2:
        result = values[0] - values[1]
    elif operation == "mean":
        result = sum(values) / len(values)
    elif operation == "ratio" and len(values) == 2 and values[1] != 0:
        result = values[0] / values[1]
    else:
        raise ValueError("Invalid calculation operation or denominator")
    return {**calculation, "result": float(result), "verified": "program_computed"}


def visual_as_text(visual):
    return "\n".join([visual["title"], visual["caption"], visual.get("conditions", ""), visual.get("unit", ""),
                       *[node["label"] for node in visual.get("nodes", [])],
                       *[edge.get("label", "") for edge in visual.get("edges", [])],
                       *visual.get("columns", []), *[" | ".join(row["cells"]) for row in visual.get("rows", [])]])


def valid_visual(visual, valid_proofs, evidence, primary_ids=None):
    proofs = valid_proofs(visual.get("evidence", []), evidence)
    if not proofs:
        return None
    index = {chunk["id"]: chunk for chunk in evidence}
    if primary_ids is not None and not any(index[proof["chunk_id"]].get("source_id") in primary_ids for proof in proofs):
        return None
    omitted = []
    if visual["kind"] == "flow":
        # A structural flow does not need an unverified sample-count/latency
        # annotation. Omit ONLY a parenthetical decoration with uncited
        # numerals; never alter numeric data in a chart/table or a main label.
        # The resulting relationships still require the semantic audit.
        allowed = numbers(" ".join(proof["quote"] for proof in proofs))
        nodes = []
        for node in visual.get("nodes", []):
            label = node["label"]
            for match in list(re.finditer(r"\([^()\n]+\)", label))[::-1]:
                if numbers(match.group()) - allowed and label[:match.start()].strip():
                    omitted.append(match.group())
                    label = label[:match.start()] + label[match.end():]
            nodes.append({**node, "label": label.strip()})
        visual = {**visual, "nodes": nodes}
    if not numbers(visual_as_text(visual)) <= numbers(" ".join(proof["quote"] for proof in proofs)):
        return None
    if visual["kind"] == "flow":
        ids = [node["id"] for node in visual.get("nodes", [])]
        if len(ids) < 2 or len(set(ids)) != len(ids) or not visual.get("edges"):
            return None
        if any(edge["source"] not in ids or edge["target"] not in ids or edge["source"] == edge["target"] for edge in visual["edges"]):
            return None
    else:
        width = len(visual.get("columns", []))
        if width < 2 or not visual.get("rows") or any(len(row["cells"]) != width for row in visual["rows"]):
            return None
        if visual["kind"] == "bar":
            if width != 2 or not visual.get("unit") or not visual.get("conditions"):
                return None
            try:
                values = [float(row["cells"][1].replace(",", ".")) for row in visual["rows"]]
                if any(not math.isfinite(value) or value < 0 for value in values):
                    return None
            except ValueError:
                return None
    return {**visual, "evidence": proofs, "verification": "quote_matched", "origin": "agent_reconstruction", "omitted_numeric_annotations": omitted}


def report_metrics(data, detail):
    text = " ".join(claim["text"] for section in data["sections"] for claim in section["claims"])
    # Whitespace word units are transparent and stable across runs; not tokens.
    words = len(text.split())
    target = DETAIL_PROFILES.get(detail, DETAIL_PROFILES["detailed"])["target_words"]
    return {"word_count": words, "count_method": "whitespace_units_excluding_source_appendix", "target_words": target,
            "length_status": "below_target" if words < target[0] else "within_target" if words <= target[1] else "above_target",
            "visual_count": len(data.get("visuals", [])), "detail": detail}


def arxiv_external(paper_input):
    value = (paper_input or "").strip()
    if re.fullmatch(r"\d{4}\.\d{4,5}(?:v\d+)?", value):
        identifier = value
    else:
        try:
            parsed = urlsplit(value)
        except ValueError:
            return None
        if parsed.scheme != "https" or parsed.hostname not in {"arxiv.org", "www.arxiv.org"} or parsed.username or parsed.password or parsed.query or parsed.fragment:
            return None
        identifier = re.sub(r"^/(?:abs|pdf)/", "", parsed.path).removesuffix(".pdf")
        if not re.fullmatch(r"\d{4}\.\d{4,5}(?:v\d+)?", identifier):
            return None
    return {"provider": "arxivisual", "arxiv_id": identifier, "url": "https://www.arxivisual.org/abs/" + identifier,
            "mode": "external_link", "verified": False, "private_pdf_sent": False}
