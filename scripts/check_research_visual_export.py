"""Local synthetic PDF layout check. No credentials or provider calls.

Run from the repository root with the project Python. Requires the configured
LaTeX compiler. This is a UI/export fixture, NOT an actual paper analysis.
"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.report_export import compile_pdf, render_latex

quote = "Training uses demonstrations; RL optimizes feedback. Alpha scores 67.73; Beta scores 55.02 under the same Synthetic evaluation. J(A,B) measures intersection over union of two sets."
proof = {"chunk_id": "Fixture-C1", "quote": quote}
data = {"title": "Khám phá báo cáo trực quan - mẫu kiểm thử", "language": "vi", "outcome": "partial",
        "brief": {"objective": "Dữ liệu mô phỏng để kiểm tra giao diện và bản xuất. Không phải kết quả hay phân tích một paper thực tế.", "questions": []},
        "sections": [{"key": key, "claims": [{"text": "Nội dung mô phỏng để kiểm tra khả năng hiển thị tiếng Việt, phương pháp và dẫn chứng. Không tái lập thí nghiệm; nhãn kiểm chứng ở fixture chỉ dùng để thử chức năng xuất.", "kind": "reported", "evidence": [proof], "verification": "model_checked"}]} for key in ["answer", "scope", "mechanism", "evidence", "limitations", "next_steps"]],
        "visuals": [
            {"kind": "flow", "title": "Các giai đoạn của phương pháp - fixture", "caption": "Mũi tên chỉ quan hệ được lưu; thứ tự thẻ chỉ là thứ tự đọc.", "section_key": "mechanism", "verification": "model_checked", "evidence": [proof],
             "nodes": [{"id": "sft", "label": "Học từ ví dụ", "explanation": "Giai đoạn mô phỏng sử dụng các ví dụ hướng dẫn để học tham số. Đầu ra không phải một kết quả benchmark.", "inputs": "Các ví dụ tổng hợp của fixture", "outputs": "Model đã học", "evidence": [proof]}, {"id": "rl", "label": "Tối ưu bằng phản hồi", "explanation": "Giải thích vai trò của phản hồi và cách các bước liên hệ. Mọi nội dung ở đây là tổng hợp để kiểm tra xuất PDF, không đại diện cho kết luận nghiên cứu.", "inputs": "Model khởi tạo và phản hồi", "outputs": "Model đã điều chỉnh", "evidence": [proof]}],
             "edges": [{"source": "sft", "target": "rl", "label": "Khởi tạo tham số", "evidence": [proof]}]},
            {"kind": "equation", "title": "Giải thích ký hiệu - fixture", "caption": "Công thức và mọi ký hiệu đều có trong PDF tĩnh.", "section_key": "mechanism", "verification": "model_checked", "evidence": [proof], "equation": r"J(A,B)=\frac{|A\cap B|}{|A\cup B|}", "explanation": "Tỷ lệ chồng lấp minh họa quan hệ giữa giao và hợp. Đây không phải mô phỏng thực nghiệm hay chứng minh tính đúng của dự đoán.", "symbols": [{"symbol": "A", "meaning": "Tập hợp A trong ví dụ minh họa.", "evidence": [proof]}, {"symbol": "B", "meaning": "Tập hợp B được đem ra đối chiếu.", "evidence": [proof]}]},
            {"kind": "bar", "title": "Số liệu tổng hợp của fixture", "caption": "Không phải kết quả paper, không dùng để so sánh các model thật.", "section_key": "evidence", "verification": "model_checked", "evidence": [proof], "columns": ["Model", "Accuracy"], "unit": "%", "dataset": "Synthetic", "metric": "Accuracy", "conditions": "Cùng điều kiện tổng hợp để kiểm tra bố cục.", "rows": [{"cells": ["Alpha", "67.73"], "explanation": "Dòng dữ liệu Alpha của mẫu kiểm thử.", "evidence": [proof]}, {"cells": ["Beta", "55.02"], "explanation": "Dòng dữ liệu Beta của mẫu kiểm thử.", "evidence": [proof]}]},
        ], "sources": [{"id": "Fixture", "title": "Nguồn dữ liệu tổng hợp", "url": "https://example.org/fixture"}],
        "evidence": [{"id": "Fixture-C1", "source_id": "Fixture", "locator": "p. 1 (fixture)", "text": quote}],
        "warnings": ["Các nhãn model_checked chỉ là dữ liệu mô phỏng để kiểm tra chức năng."], "audit_notes": "Không gọi model hay tải tài liệu ngoài.", "coverage": []}

directory = Path("tmp/pdfs/research-visuals")
directory.mkdir(parents=True, exist_ok=True)
source = render_latex(data)
(directory / "fixture.tex").write_text(source, encoding="utf-8")
compile_pdf(source, directory / "fixture.pdf")
print(directory / "fixture.pdf")
