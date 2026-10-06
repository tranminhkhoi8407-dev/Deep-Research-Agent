"""Artifact fidelity, compiler boundaries and account isolation."""
import json
import zipfile
import pytest
from fastapi.testclient import TestClient
from backend import report_export as exports
from backend.auth import current_user
from backend.main import app, _reports_dir

def render_fixture():
    quote = "Fixture only. Distillation precedes RL. Training differs from inference. Method accuracy 67.73; baseline accuracy 55.02 on the same synthetic evaluation."
    proof = {"chunk_id": "A1-K1-C1", "quote": quote}
    body = "### Hai giai đoạn cần phân biệt\n\nĐây là **dữ liệu kiểm thử bố cục**, không phải kết quả phân tích paper thật. Công thức minh họa: $J(A,B)=\\frac{|A\\cap B|}{|A\\cup B|}$; tử số là giao, mẫu số là hợp. Không tuyên bố đã chạy thí nghiệm.\n\n$$\nR = \\alpha R_{exec} + \\beta R_{struct}\n$$\n\nKý hiệu cần đi cùng định nghĩa và điều kiện. Ví dụ SQL tự tạo:\n\n" + chr(96) * 3 + "sql\nSELECT AVG(salary) FROM employees;\n" + chr(96) * 3 + "\n\n| Thành phần | Vai trò |\n|---|---|\n| Distillation | Học từ dữ liệu |\n| RL | Tối ưu bằng phản hồi |\n\nCần giải thích vì sao mỗi giai đoạn tồn tại, không chỉ nêu tên."
    return {"schema_version": "3.0", "language": "vi", "title": "Kiểm thử xuất PDF: tiếng Việt, công thức và sơ đồ", "outcome": "partial",
            "brief": {"objective": "Mẫu tổng hợp chỉ để kiểm tra trình xuất tài liệu. Các số liệu là fixture, không phải benchmark của FINER-SQL.", "questions": ["Phương pháp hoạt động thế nào?"]},
            "sections": [{"key": key, "claims": [{"text": body if key == "mechanism" else "Mục kiểm thử " + key + ": cần đối chiếu bằng chứng và nói rõ các điều kiện áp dụng.", "kind": "illustration", "evidence": [proof], "verification": "model_checked"}]} for key in ["answer", "scope", "mechanism", "evidence", "limitations", "next_steps"]],
            "visuals": [
                {"kind": "flow", "title": "Luồng huấn luyện minh họa", "caption": "Tách huấn luyện khỏi suy luận. Đây là hình fixture.", "section_key": "mechanism", "nodes": [{"id": "sft", "label": "Distillation: học từ dữ liệu"}, {"id": "rl", "label": "RL: tối ưu bằng phản hồi"}, {"id": "infer", "label": "Suy luận: tạo dự đoán, không cập nhật tham số"}], "edges": [{"source": "sft", "target": "rl", "label": "Khởi tạo"}, {"source": "rl", "target": "infer", "label": "Dùng model đã huấn luyện"}], "evidence": [proof], "verification": "model_checked"},
                {"kind": "bar", "title": "Biểu đồ dữ liệu fixture", "caption": "Chỉ kiểm tra cách vẽ, không phải kết quả nghiên cứu.", "section_key": "evidence", "columns": ["Model", "Accuracy"], "rows": [{"cells": ["Method (fixture)", "67.73"]}, {"cells": ["Baseline (fixture)", "55.02"]}], "unit": "%", "conditions": "Cùng điều kiện giả lập trong fixture; không dùng như benchmark.", "evidence": [proof], "verification": "model_checked"}],
            "sources": [{"id": "A1-K1", "title": "Nguồn dữ liệu kiểm thử", "url": "https://example.org/fixture", "used": True}],
            "evidence": [{"id": "A1-K1-C1", "source_id": "A1-K1", "locator": "p. 3", "text": quote}],
            "coverage": [{"question_index": 0, "status": "partial", "explanation": "Đây là fixture; chưa thực hiện nghiên cứu thật."}],
            "audit_notes": "Mọi nhãn model_checked ở fixture là mô phỏng để kiểm tra trình xuất.", "warnings": []}

@pytest.mark.parametrize("raw", [r"\input{secret}", r"\write18{curl secret}", r"\def\foo{bar}", r"\end{document}", r"\href{https://evil}{x}", r"x ^^5c input{secret}", r"x % hide"])
def test_math_never_emits_arbitrary_tex_commands(raw):
    assert exports.safe_math(raw) is None
    tex = exports.prose_tex("$$\n" + raw + "\n$$")
    assert r"\texttt{" in tex
    assert r"\input{secret}" not in tex

def test_real_math_markdown_tables_and_prose_share_the_safe_template():
    tex = exports.render_latex(render_fixture())
    assert r"\frac{|A\cap B|}{|A\cup B|}" in tex
    assert r"\begin{longtable}" in tex and r"\begin{tikzpicture}" in tex
    assert "tiếng Việt" in tex and "[1] p. 3" in tex
    assert r"\renewcommand{\contentsname}{Mục lục}" in tex
    english = {**render_fixture(), "language": "en"}
    assert r"\renewcommand{\contentsname}" not in exports.render_latex(english)
    assert r"\textbackslash{}input\{secret\}" in exports.prose_tex(r"\input{secret}")
    assert r"\end{quote}" not in exports.escape(r"\end{quote}")


@pytest.mark.parametrize("raw", [r"}x{", r"\begin{aligned}x", r"\end{cases}\begin{cases}", r"\begin{cases}x\end{aligned}"])
def test_unbalanced_math_or_environment_cannot_escape_the_template(raw):
    assert exports.safe_math(raw) is None


def test_unused_sources_are_ledger_only_and_invalid_sidecar_visual_is_not_interpolated():
    fixture = render_fixture()
    fixture["sources"].append({"id": "A1-K2", "title": "Unused discovered page", "url": "https://example.org/unused", "used": False})
    assert "Unused discovered page" not in exports.render_latex(fixture)
    fixture["visuals"][0]["nodes"][0]["id"] = r"bad)\input{secret}"
    with pytest.raises(exports.ExportError) as failure:
        exports.render_latex(fixture)
    assert failure.value.code == "invalid_report"
    assert exports.safe_url("https://[invalid") is None


def test_pdf_extraction_control_characters_do_not_break_tex_compilation():
    assert exports.escape("source\x02text\x7f\nnext") == "sourcetext\nnext"
    assert exports.safe_math("x\x02y") is None
    assert exports.escape("\uf8f1") == "[U+F8F1]"

def test_tex_and_zip_do_not_require_a_compiler_and_zip_contains_exact_source(tmp_path, monkeypatch):
    path = tmp_path / "record.md"
    path.write_text("Legacy", encoding="utf-8")
    monkeypatch.setattr(exports, "compiler", lambda: pytest.fail("No compiler for source export"))
    tex_path = exports.export_report(path, render_fixture(), "", "tex")
    zipped = exports.export_report(path, render_fixture(), "", "zip")
    with zipfile.ZipFile(zipped) as archive:
        assert archive.read("report.tex").decode() == tex_path.read_text(encoding="utf-8")
        assert set(archive.namelist()) == {"report.tex", "BUILD.txt"}

def test_changed_report_never_returns_a_stale_cached_pdf(tmp_path, monkeypatch):
    path = tmp_path / "record.md"
    path.write_text("Legacy", encoding="utf-8")
    data, calls = render_fixture(), []
    def compile(tex, destination):
        calls.append(tex)
        destination.write_bytes(b"%PDF-fixture-only")
    monkeypatch.setattr(exports, "compile_pdf", compile)
    exports.export_report(path, data, "", "pdf")
    exports.export_report(path, data, "", "pdf")
    assert len(calls) == 1
    data["title"] = "Changed report"
    def failed(*args): raise exports.ExportError("compile_failed", "No PDF")
    monkeypatch.setattr(exports, "compile_pdf", failed)
    with pytest.raises(exports.ExportError): exports.export_report(path, data, "", "pdf")
    assert json.loads(path.with_suffix(".export.json").read_text())["pdf_ready"] is False
    assert "Changed report" in path.with_suffix(".tex").read_text(encoding="utf-8")

def test_export_routes_are_owner_scoped_and_compiler_failure_explicit(tmp_path, monkeypatch):
    monkeypatch.setenv("REPORTS_DIR", str(tmp_path / "reports"))
    monkeypatch.setenv("AUTH_DATABASE_PATH", str(tmp_path / "auth.db"))
    path = _reports_dir("alice") / "record.md"
    path.write_text("# Record", encoding="utf-8")
    path.with_suffix(".research.json").write_text(json.dumps(render_fixture()), encoding="utf-8")
    app.dependency_overrides[current_user] = lambda: {"id": "alice"}
    try:
        with TestClient(app) as client:
            assert client.get("/api/reports/record.md/export?format=tex").status_code == 200
            assert client.get("/api/reports/record.md/export?format=html").status_code == 422
            def unavailable(): raise exports.ExportError("compiler_unavailable", "Compiler not ready")
            monkeypatch.setattr(exports, "compiler", unavailable)
            response = client.get("/api/reports/record.md/export")
            assert response.status_code == 503 and response.json()["detail"]["code"] == "compiler_unavailable"
            assert client.get("/api/reports/record.md/export?format=tex").status_code == 200
            app.dependency_overrides[current_user] = lambda: {"id": "bob"}
            assert client.get("/api/reports/record.md/export?format=tex").status_code == 404
            app.dependency_overrides[current_user] = lambda: {"id": "alice"}
            assert client.delete("/api/reports/record.md").status_code == 200
            assert not path.with_suffix(".tex").exists()
    finally:
        app.dependency_overrides.clear()
