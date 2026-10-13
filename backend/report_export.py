"""One structured report -> editable LaTeX -> the same compiled PDF.

Only trusted templates emit commands. Prose is escaped, math uses an allowlist,
URLs are restricted, and compilation never enables shell escape/cloud uploads.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import unicodedata
import zipfile
from urllib.parse import urlsplit

import mistune
from pydantic import ValidationError
from agent.research_contract import SECTION_TITLES, SECTION_KEYS, ReportVisual
from agent.report_quality import visual_proofs
from agent.report_math import safe_math

TEMPLATE_VERSION = "nexora-tex-3"
_compile_slots = threading.BoundedSemaphore(2)
_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


class ExportError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def escape(value):
    mapping = {"\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "$": r"\$", "&": r"\&", "%": r"\%", "#": r"\#", "_": r"\_", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(value)).replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", " - ")
    # PDF font-encoded private-use glyphs have no portable Unicode meaning.
    # Show their exact code point instead of guessing a brace/symbol or silently
    # losing it. The original evidence and PDF page remain available.
    return "".join(mapping.get(char, "[U+" + format(ord(char), "04X") + "]" if unicodedata.category(char) == "Co" else char) for char in text)




def safe_url(value):
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
        return None
    if any(char in value for char in "{}\\\r\n"):
        return None
    return value.replace("%", r"\%").replace("#", r"\#").replace("&", r"\&").replace("_", r"\_")


def table_tex(columns, rows):
    width = len(columns)
    if not 1 <= width <= 6 or any(len(row) != width for row in rows):
        return ""
    spec = "".join(r">{\raggedright\arraybackslash}p{" + f"{0.88 / width:.3f}" + r"\linewidth}" for _ in columns)
    head = " & ".join(r"\textbf{" + escape(cell) + "}" for cell in columns) + r" \\ \hline"
    body = "\n".join(" & ".join(escape(cell) for cell in row) + r" \\" for row in rows)
    return "\n" + r"\begin{longtable}{" + spec + "}\n" + head + "\n" + r"\endfirsthead" + "\n" + head + "\n" + r"\endhead" + "\n" + body + "\n" + r"\end{longtable}" + "\n"


def prose_tex(text):
    parser = mistune.create_markdown(renderer="ast", plugins=["table", "math", "strikethrough"])

    def plain(token):
        return token.get("raw", "") + "".join(plain(child) for child in token.get("children", []))

    def render(tokens):
        parts = []
        for token in tokens:
            kind, raw = token["type"], token.get("raw", "")
            children = render(token.get("children", []))
            if kind in {"text", "inline_html", "block_html"}:
                parts.append(escape(raw))
            elif kind in {"paragraph", "block_text"}:
                parts.append(children + "\n\n")
            elif kind == "heading":
                parts.append(r"\subsection*{" + children + "}\n")
            elif kind == "strong":
                parts.append(r"\textbf{" + children + "}")
            elif kind in {"emphasis", "strikethrough"}:
                parts.append(r"\emph{" + children + "}")
            elif kind in {"inline_math", "block_math"}:
                math = safe_math(raw)
                parts.append((r"\[" + math + r"\]" if kind == "block_math" else "$" + math + "$") if math is not None else r"\texttt{" + escape(raw) + "}")
            elif kind == "codespan":
                parts.append(r"\texttt{" + escape(raw) + "}")
            elif kind == "block_code":
                # Escaped text, not raw verbatim that a source could close.
                lines = [r"\noindent " + escape(line) + r"\par" for line in raw.splitlines()]
                parts.append("\n" + r"\begin{quote}\small\ttfamily\raggedright" + "\n" + "\n".join(lines) + "\n" + r"\end{quote}" + "\n")
            elif kind == "link":
                url = safe_url(token.get("attrs", {}).get("url", ""))
                parts.append(r"\href{" + url + "}{" + children + "}" if url else children)
            elif kind == "image":
                parts.append(children)  # never fetch arbitrary source images
            elif kind == "list":
                env = "enumerate" if token.get("attrs", {}).get("ordered") else "itemize"
                parts.append(r"\begin{" + env + "}\n" + children + r"\end{" + env + "}\n")
            elif kind == "list_item":
                parts.append(r"\item " + children)
            elif kind == "block_quote":
                parts.append(r"\begin{quote}" + children + r"\end{quote}")
            elif kind == "table":
                columns, rows = [], []
                for child in token.get("children", []):
                    if child["type"] == "table_head":
                        columns = [plain(cell) for cell in child.get("children", [])]
                    elif child["type"] == "table_body":
                        rows = [[plain(cell) for cell in row.get("children", [])] for row in child.get("children", [])]
                parts.append(table_tex(columns, rows))
            elif kind in {"linebreak", "softbreak"}:
                parts.append("\n")
            elif kind == "thematic_break":
                parts.append(r"\par\smallskip\hrule\smallskip" + "\n")
            else:
                parts.append(children)
        return "".join(parts)

    return render(parser(text))


def visual_tex(visual, vi, citations=lambda proofs: ""):
    annotations_omitted = bool(visual.get("omitted_numeric_annotations"))
    # Sidecars can outlive a schema revision or be malformed. Never interpolate
    # unchecked model node identifiers into trusted TikZ/PGF commands.
    try:
        visual = ReportVisual.model_validate(visual).model_dump()
        if visual["kind"] == "flow":
            ids = [node["id"] for node in visual["nodes"]]
            if len(ids) < 2 or len(ids) != len(set(ids)) or not visual["edges"] or any(edge["source"] not in ids or edge["target"] not in ids for edge in visual["edges"]):
                raise ValueError("Invalid flow topology")
        elif visual["kind"] == "equation":
            if not visual["symbols"] or not visual["explanation"] or safe_math(visual["equation"]) is None:
                raise ValueError("Invalid or unsafe equation")
            if any(safe_math(symbol["symbol"]) is None for symbol in visual["symbols"]):
                raise ValueError("Invalid or unsafe symbol")
        else:
            if len(visual["columns"]) < 2 or not visual["rows"] or any(len(row["cells"]) != len(visual["columns"]) for row in visual["rows"]):
                raise ValueError("Invalid table shape")
            if visual["kind"] == "bar":
                import math
                values = [float(row["cells"][1].replace(",", ".")) for row in visual["rows"]]
                if len(visual["columns"]) != 2 or not visual["unit"] or not visual["conditions"] or any(not math.isfinite(value) or value < 0 for value in values):
                    raise ValueError("Invalid chart data")
    except (ValidationError, ValueError, KeyError, TypeError) as error:
        raise ExportError("invalid_report", "A saved visual is invalid. Source data must be corrected before exporting this report.") from error
    title = r"\subsection*{" + escape(visual["title"]) + "}\n"
    caption = r"\begin{quote}\small " + escape(("Minh họa dựng lại từ nguồn. " if vi else "Agent reconstruction from sources. ") + visual["caption"]) + r"\end{quote}" + "\n"
    if annotations_omitted:
        caption += prose_tex("Đã bỏ chú thích số chưa được dẫn chứng khỏi nhãn; chỉ giữ quan hệ được đối chiếu." if vi else "Uncited numeric annotations were omitted from node labels; only checked relationships are shown.")
    if visual["kind"] == "flow":
        nodes = visual["nodes"]
        diagram = [r"\begin{center}\begin{tikzpicture}[node distance=0.55cm,every node/.style={font=\small},nexoraStep/.style={draw=blue!50,fill=blue!4,rounded corners,align=center,text width=11.5cm,inner sep=7pt}]"]
        for index, node in enumerate(nodes):
            position = "" if not index else ",below=of " + nodes[index - 1]["id"]
            diagram.append(r"\node[nexoraStep" + position + "] (" + node["id"] + ") {" + escape(node["label"]) + "};")
        for index, edge in enumerate(visual["edges"]):
            diagram.append(r"\draw[-{Stealth},blue!70] (" + edge["source"] + ".east) to[bend left=" + str(25 + index % 3 * 10) + r"] node[right,font=\scriptsize] {" + str(index + 1) + "} (" + edge["target"] + ".east);")
        diagram.append(r"\end{tikzpicture}\end{center}")
        relations = "\n".join(r"\item " + escape(next(node["label"] for node in nodes if node["id"] == edge["source"])) + r" $\rightarrow$ " + escape(next(node["label"] for node in nodes if node["id"] == edge["target"])) + (": " + escape(edge["label"]) if edge.get("label") else "") for edge in visual["edges"])
        body = "\n".join(diagram) + "\n" + r"\begin{enumerate}\small" + "\n" + relations + "\n" + r"\end{enumerate}"
    elif visual["kind"] == "bar":
        rows = visual["rows"]
        ticks = ",".join(str(index + 1) for index in range(len(rows)))
        labels = ",".join("{" + escape(row["cells"][0]) + "}" for row in rows)
        coords = " ".join("(" + str(float(row["cells"][1].replace(",", "."))) + "," + str(index + 1) + ")" for index, row in enumerate(rows))
        body = r"\begin{center}\begin{tikzpicture}\begin{axis}[xbar,width=10.5cm,height=" + str(max(4, len(rows) * 0.65 + 1.5)) + "cm,xmin=0,ytick={" + ticks + "},yticklabels={" + labels + r"},yticklabel style={font=\scriptsize,text width=4cm,align=right},xlabel={" + escape(visual["unit"]) + r"},nodes near coords,point meta=x,axis lines*=left]" + "\n" + r"\addplot[fill=blue!35,draw=blue!65] coordinates {" + coords + r"};\end{axis}\end{tikzpicture}\end{center}"
    elif visual["kind"] == "equation":
        body = r"\[" + visual["equation"] + r"\]" + "\n" + prose_tex(visual["explanation"])
    else:
        body = table_tex(visual["columns"], [row["cells"] for row in visual["rows"]])
    # The PDF is a complete static equivalent, not a screenshot of the current
    # web selection. Preserve every explanatory detail and its exact location.
    details = []
    for node in visual["nodes"] if visual["kind"] == "flow" else []:
        if node["explanation"] or node["inputs"] or node["outputs"]:
            details.append(r"\paragraph{" + escape(node["label"]) + "}\n" + prose_tex(node["explanation"]))
            for field, label in (("inputs", "Đầu vào" if vi else "Input"), ("outputs", "Đầu ra" if vi else "Output")):
                if node[field]:
                    details.append(r"\textbf{" + label + ":} " + escape(node[field]) + r"\par")
            details.append(citations(node["evidence"]))
    for edge in visual["edges"] if visual["kind"] == "flow" else []:
        if edge["evidence"]:
            node_labels = {node["id"]: node["label"] for node in visual["nodes"]}
            details.append(prose_tex(node_labels[edge["source"]] + " -> " + node_labels[edge["target"]] + ": " + edge["label"]) + citations(edge["evidence"]))
    for row in visual["rows"] if visual["kind"] in {"table", "bar"} else []:
        if row["explanation"] or row["evidence"]:
            details.append(r"\paragraph{" + escape(row["cells"][0]) + "}\n" + prose_tex(row["explanation"]) + citations(row["evidence"]))
    for symbol in visual["symbols"] if visual["kind"] == "equation" else []:
        details.append("$" + symbol["symbol"] + "$: " + escape(symbol["meaning"]) + citations(symbol["evidence"]))
    context = "; ".join(visual[key] for key in ("dataset", "metric", "unit", "conditions") if visual[key])
    return title + body + "\n" + caption + (r"\noindent\textit{" + escape(context) + "}\n" if context else "") + "\n".join(details)


def render_latex(data, legacy=""):
    vi = data.get("language") == "vi"
    labels = {"reported": "Nguồn báo cáo" if vi else "Source-reported", "inference": "Suy luận" if vi else "Inference", "recommendation": "Đề xuất có điều kiện" if vi else "Conditional recommendation", "illustration": "Ví dụ tự tạo - chưa chạy thực nghiệm" if vi else "Self-created illustration - not executed", "derived": "Tính toán từ số liệu nguồn" if vi else "Calculation from sourced inputs"}
    evidence_index = {chunk["id"]: chunk for chunk in data.get("evidence", [])}
    proofs = [proof for section in data.get("sections", []) for claim in section["claims"] for proof in claim["evidence"]]
    proofs += [proof for visual in data.get("visuals", []) if visual.get("verification") == "model_checked" for proof in visual_proofs(visual)]
    used_ids = {evidence_index.get(proof["chunk_id"], {}).get("source_id") for proof in proofs}
    source_index = {source["id"]: (index + 1, source) for index, source in enumerate(source for source in data.get("sources", []) if source["id"] in used_ids)}

    def citations(proofs):
        locators = []
        for proof in proofs:
            chunk = evidence_index.get(proof["chunk_id"], {})
            source = source_index.get(chunk.get("source_id"))
            if source:
                locators.append("[" + str(source[0]) + "] " + chunk.get("locator", ""))
        return r"\par{\footnotesize\color{gray}" + escape("; ".join(dict.fromkeys(locators))) + "}\n"

    body = ([r"\renewcommand{\contentsname}{Mục lục}"] if vi else []) + [r"\maketitle", r"\tableofcontents", r"\newpage"]
    if data.get("outcome", "partial") != "completed":
        body.append(r"\noindent\textbf{" + ("Báo cáo một phần / chưa hoàn tất kiểm chứng." if vi else "Partial report / verification incomplete.") + "}\n")
    if data.get("brief"):
        body.append(prose_tex(data["brief"]["objective"]))
    if data.get("sections"):
        for section in data["sections"]:
            body.append(r"\section{" + SECTION_TITLES["vi" if vi else "en"][SECTION_KEYS.index(section["key"])] + "}")
            if not section["claims"]:
                body.append("Chưa đủ nội dung đã kiểm chứng để viết mục này." if vi else "Insufficient verified content to populate this section.")
            for claim in section["claims"]:
                body.append(r"\noindent{\small\color{blue!60!black}" + escape(labels[claim["kind"]]) + r"}\par")
                body.append(prose_tex(claim["text"]))
                calc = claim.get("calculation")
                if calc and calc.get("verified") == "program_computed":
                    body.append(r"\noindent\textbf{" + ("Kết quả tính bằng chương trình: " if vi else "Program-computed result: ") + escape(str(calc["result"]) + " " + calc.get("unit", "")) + "}\n")
                body.append(citations(claim["evidence"]))
            for visual in data.get("visuals", []):
                if visual["section_key"] == section["key"] and visual.get("verification") == "model_checked":
                    body.append(visual_tex(visual, vi, citations))
                    body.append(citations(visual["evidence"]))
    else:
        body.append(prose_tex(legacy))
    body.append(r"\section{" + ("Câu hỏi và giới hạn còn lại" if vi else "Remaining questions and limitations") + "}")
    for item in data.get("coverage", []):
        if item["status"] != "answered":
            question = data["brief"]["questions"][item["question_index"]]
            body.append(prose_tex(question + ": " + item["explanation"]))
    body.append(prose_tex(data.get("audit_notes", "")))
    for warning in data.get("warnings", []):
        body.append(prose_tex(warning))
    for check in data.get("quality_checks", []):
        body.append(prose_tex(check["key"] + " (" + check["status"] + "): " + check["explanation"]))
    external = data.get("external_visualization")
    if external:
        url = safe_url(external["url"])
        if url:
            body.append(r"\section{arXivisual}\noindent\href{" + url + "}{" + escape("Mở phần giải thích bổ sung" if vi else "Open supplementary explanation") + "}. " + escape("Dịch vụ ngoài; nội dung và phiên bản chưa được Nexora kiểm chứng. PDF riêng tư không được gửi." if vi else "External service; explanation and version not verified by Nexora. Private PDFs are not sent."))
    body.append(r"\section{" + ("Tài liệu tham khảo" if vi else "References") + "}")
    for number, source in source_index.values():
        url = safe_url(source.get("url", ""))
        title = escape(source.get("title", ""))
        body.append(r"\noindent [" + str(number) + "] " + (r"\href{" + url + "}{" + title + "}" if url else title) + r"\par\smallskip")
    body.append(r"\appendix\section{" + ("Dẫn chứng có vị trí nguồn" if vi else "Located supporting excerpts") + "}")
    if any(unicodedata.category(char) == "Co" for proof in proofs for char in proof["quote"]):
        body.append(prose_tex("Một số ký tự font riêng trong PDF gốc được hiển thị bằng mã U+… thay vì đoán ký hiệu. Mở trang PDF gốc để đối chiếu bảng và công thức." if vi else "Some original-PDF private-font glyphs are shown by their U+ code point instead of guessing a symbol. Inspect the original PDF page for tables and equations."))
    seen = set()
    for proof in proofs:
        key = (proof["chunk_id"], proof["quote"])
        if key in seen:
            continue
        seen.add(key)
        body.append(citations([proof]) + r"\begin{quote}\small " + escape(proof["quote"]) + r"\end{quote}")
    preamble = r"""% Generated from one verified structured report. Compile with Tectonic or XeLaTeX.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\setmainfont{texgyrepagella-regular.otf}[BoldFont=texgyrepagella-bold.otf,ItalicFont=texgyrepagella-italic.otf,BoldItalicFont=texgyrepagella-bolditalic.otf]
\setmonofont{lmmono10-regular.otf}
\usepackage[margin=2.3cm]{geometry}
\usepackage{amsmath,amssymb,mathtools}
\usepackage{xcolor,array,longtable,booktabs}
\usepackage{tikz,pgfplots}
\usetikzlibrary{positioning,arrows.meta}
\pgfplotsset{compat=1.18}
\usepackage[unicode,colorlinks=true,urlcolor=blue!60!black,linkcolor=blue!50!black]{hyperref}
\usepackage{fancyhdr}
\pagestyle{fancy}\fancyhf{}\fancyhead[L]{Nexora Research}\fancyfoot[C]{\thepage}
\setlength{\headheight}{14pt}
\setlength{\parindent}{0pt}\setlength{\parskip}{5pt}
\emergencystretch=2em
\title{"""
    return preamble + escape(data.get("title", "Research report")) + "}\n" + r"\author{Nexora Research Agent}\date{}\begin{document}" + "\n" + "\n\n".join(body) + "\n" + r"\end{document}" + "\n"


def compiler():
    configured = os.getenv("NEXORA_LATEX_BIN", "")
    local = Path(__file__).resolve().parents[1] / ".tools" / "tectonic" / "tectonic.exe"
    executable = configured or shutil.which("tectonic") or shutil.which("xelatex") or (str(local) if local.is_file() else "")
    if not executable:
        raise ExportError("compiler_unavailable", "PDF compiler is not installed. LaTeX source remains available. Install Tectonic/XeLaTeX or set NEXORA_LATEX_BIN.")
    executable = str(Path(executable).resolve()) if Path(executable).is_file() else (shutil.which(executable) or "")
    if not executable or Path(executable).stem.lower() not in {"tectonic", "xelatex"}:
        raise ExportError("compiler_unavailable", "NEXORA_LATEX_BIN must point to Tectonic or XeLaTeX.")
    return executable


def compile_pdf(tex, destination):
    executable = compiler()
    if len(tex.encode("utf-8")) > 2_000_000:
        raise ExportError("document_too_large", "Report exceeds the safe compilation size limit.")
    if not _compile_slots.acquire(timeout=2):
        raise ExportError("compiler_busy", "PDF compiler is busy. Please retry shortly.")
    try:
        with tempfile.TemporaryDirectory(prefix="nexora-tex-") as directory:
            scratch = Path(directory)
            source = scratch / "report.tex"
            source.write_text(tex, encoding="utf-8")
            if Path(executable).stem.lower() == "tectonic":
                command = [executable, "--untrusted", "--keep-logs", "--outdir", str(scratch), str(source)]
                if os.getenv("NEXORA_TEX_OFFLINE", "false").lower() == "true":
                    command.insert(1, "--only-cached")
            else:
                command = [executable, "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-output-directory=" + str(scratch), str(source)]
            allowed = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "FONTCONFIG_PATH", "TECTONIC_CACHE_DIR"}
            environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
            environment.update(openin_any="p", openout_any="p")
            runs = 1 if Path(executable).stem.lower() == "tectonic" else 2
            try:
                for _ in range(runs):
                    result = subprocess.run(command, cwd=scratch, env=environment, capture_output=True, timeout=120, shell=False,
                                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    if result.returncode:
                        raise ExportError("compile_failed", "LaTeX compilation failed. Source is preserved; no placeholder PDF was returned.")
            except subprocess.TimeoutExpired as error:
                raise ExportError("compile_timeout", "PDF compilation timed out. Source is preserved; retry after checking compiler resources.") from error
            pdf = scratch / "report.pdf"
            if not pdf.is_file() or pdf.stat().st_size < 100 or pdf.read_bytes()[:5] != b"%PDF-":
                raise ExportError("compile_failed", "Compiler did not produce a valid PDF.")
            log = (scratch / "report.log").read_text(encoding="utf-8", errors="replace") if (scratch / "report.log").is_file() else ""
            if "Missing character:" in log or "Undefined control sequence" in log:
                raise ExportError("render_invalid", "PDF contains missing glyphs or unsupported commands. Source is preserved for correction.")
            destination.write_bytes(pdf.read_bytes())
    finally:
        _compile_slots.release()


def export_report(path, data, legacy, output_format):
    if output_format not in {"tex", "pdf", "zip"}:
        raise ExportError("invalid_format", "Supported report formats are tex, pdf and zip.")
    try:
        source = render_latex(data or {"title": path.stem, "language": "vi" if "Nguồn tham khảo" in legacy else "en"}, legacy)
    except (KeyError, TypeError, ValueError) as error:
        raise ExportError("invalid_report", "The saved report structure is invalid. The original report remains unchanged.") from error
    digest = hashlib.sha256((TEMPLATE_VERSION + source).encode("utf-8")).hexdigest()
    tex_path, pdf_path, manifest_path = path.with_suffix(".tex"), path.with_suffix(".pdf"), path.with_suffix(".export.json")
    with _locks_guard:
        lock = _locks.setdefault(str(path.resolve()), threading.Lock())
    if not lock.acquire(timeout=2):
        raise ExportError("compiler_busy", "This report is already being exported. Retry shortly.")
    try:
        previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
        fresh = previous.get("sha256") == digest
        if not fresh:
            manifest_path.write_text(json.dumps({"sha256": digest, "pdf_ready": False}), encoding="utf-8")
            tex_path.write_text(source, encoding="utf-8")
        elif not tex_path.is_file():
            tex_path.write_text(source, encoding="utf-8")
        if output_format == "pdf":
            if not fresh or not previous.get("pdf_ready") or not pdf_path.is_file():
                compile_pdf(source, pdf_path)
                manifest_path.write_text(json.dumps({"sha256": digest, "pdf_ready": True}), encoding="utf-8")
            return pdf_path
        if output_format == "zip":
            zipped = path.with_suffix(".source.zip")
            with zipfile.ZipFile(zipped, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("report.tex", source)
                archive.writestr("BUILD.txt", "Compile report.tex with Tectonic, or run XeLaTeX twice. Fonts: TeX Gyre Pagella and Latin Modern Mono. Tables/diagrams are embedded in the source. No private PDF or original paper is included.\nTemplate: " + TEMPLATE_VERSION)
            return zipped
        return tex_path
    except (OSError, ValueError) as error:
        raise ExportError("export_failed", "Report export could not be written; the original report remains unchanged.") from error
    finally:
        lock.release()
