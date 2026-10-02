import type { Language } from "./ProductViews";

export function researchTemplate(
  field: string,
  language: Language,
  kind: "study" | "paper",
): string {
  const vi = language === "vi";
  if (kind === "paper")
    return vi
      ? `## Thông tin bài báo\n\n- Tiêu đề:\n- Tác giả, năm:\n- DOI / URL:\n- Trạng thái: Chưa đọc\n\n## Câu hỏi và đóng góp chính\n\n> Ghi lại đóng góp bằng lời của bạn; phân biệt tuyên bố của tác giả và nhận xét cá nhân.\n\n## Phương pháp\n\n\n## Bằng chứng và kết quả\n\n| Tuyên bố | Bằng chứng / vị trí | Nhận xét |\n| --- | --- | --- |\n| | | |\n\n## Giả định và hạn chế\n\n\n## Ý tưởng cần kiểm chứng\n\n- [ ] Kiểm tra nguồn dữ liệu\n- [ ] Đối chiếu một nghiên cứu khác\n- [ ] Ghi lại câu hỏi còn mở\n\n## Trích dẫn và nguồn liên quan\n\n`
      : `## Paper details\n\n- Title:\n- Authors, year:\n- DOI / URL:\n- Reading status: To read\n\n## Research question and contributions\n\n> Summarize in your own words; separate the authors' claims from your interpretation.\n\n## Method\n\n\n## Evidence and results\n\n| Claim | Evidence / location | Interpretation |\n| --- | --- | --- |\n| | | |\n\n## Assumptions and limitations\n\n\n## Questions to investigate\n\n- [ ] Check data provenance\n- [ ] Compare with another study\n- [ ] Record open questions\n\n## Citations and related work\n\n`;
  const sections: Record<string, [string[], string[]]> = {
    mathematics: [
      [
        "Định nghĩa và ký hiệu",
        "Giả thiết và miền xác định",
        "Mệnh đề cần chứng minh",
        "Bổ đề",
        "Chứng minh từng bước",
        "Phản ví dụ và trường hợp biên",
        "Câu hỏi mở",
      ],
      [
        "Definitions and notation",
        "Assumptions and domain",
        "Proposition",
        "Lemmas",
        "Step-by-step proof",
        "Counterexamples and boundary cases",
        "Open questions",
      ],
    ],
    physics: [
      [
        "Câu hỏi và mô hình",
        "Đại lượng, đơn vị và hệ quy chiếu",
        "Giả thiết và điều kiện biên",
        "Phương pháp đo hoặc mô phỏng",
        "Kết quả và độ bất định",
        "Kiểm tra thứ nguyên và tính nhất quán",
        "Giới hạn của mô hình",
      ],
      [
        "Question and model",
        "Quantities, units and reference frame",
        "Assumptions and boundary conditions",
        "Measurement or simulation method",
        "Results and uncertainty",
        "Dimensional and consistency checks",
        "Model limitations",
      ],
    ],
    chemistry: [
      [
        "Câu hỏi và tổng quan tài liệu",
        "Cấu trúc và tính chất",
        "Phương trình và cơ chế phản ứng",
        "Điều kiện được báo cáo trong tài liệu",
        "Phương pháp phân tích",
        "Bằng chứng và khả năng tái lập",
        "Rủi ro và giới hạn được nguồn ghi nhận",
      ],
      [
        "Question and literature context",
        "Structure and properties",
        "Equations and reaction mechanism",
        "Conditions reported in the literature",
        "Analytical method",
        "Evidence and reproducibility",
        "Source-reported risks and limitations",
      ],
    ],
    biology: [
      [
        "Câu hỏi và giả thuyết",
        "Hệ sinh học và phạm vi",
        "Thiết kế nghiên cứu và nhóm đối chứng",
        "Dữ liệu và tiêu chí đánh giá",
        "Kết quả và phân tích",
        "Yếu tố nhiễu và hạn chế",
        "Nguồn dữ liệu và lưu ý đạo đức",
      ],
      [
        "Question and hypothesis",
        "Biological system and scope",
        "Study design and controls",
        "Data and evaluation criteria",
        "Results and analysis",
        "Confounders and limitations",
        "Data provenance and ethics notes",
      ],
    ],
    "artificial-intelligence": [
      [
        "Bài toán và giả thuyết",
        "Các paper liên quan",
        "Dữ liệu, license và cách chia tập",
        "Mô hình và baseline",
        "Cấu hình, seed và môi trường",
        "Chỉ số và bảng kết quả",
        "Ablation và phân tích lỗi",
        "Chi phí, giới hạn và hướng tiếp theo",
      ],
      [
        "Problem and hypothesis",
        "Related papers",
        "Data, licenses and dataset splits",
        "Model and baselines",
        "Configuration, seeds and environment",
        "Metrics and results",
        "Ablations and error analysis",
        "Cost, limitations and next steps",
      ],
    ],
  };
  const headings =
    sections[field]?.[vi ? 0 : 1] ||
    (vi
      ? ["Câu hỏi", "Phương pháp", "Bằng chứng", "Kết luận"]
      : ["Question", "Method", "Evidence", "Conclusion"]);
  return `${vi ? "> Bản khung nghiên cứu: điền nội dung và dẫn nguồn; các mục bên dưới chưa phải kết quả nghiên cứu." : "> Research outline: fill in the content and cite sources; these sections are not research findings."}\n\n${headings.map((heading) => `## ${heading}\n\n`).join("\n")}## ${vi ? "Nguồn tham khảo" : "References"}\n\n## ${vi ? "Việc tiếp theo" : "Next steps"}\n\n- [ ] ${vi ? "Hoàn thiện câu hỏi nghiên cứu" : "Refine the research question"}\n- [ ] ${vi ? "Thu thập và đối chiếu nguồn" : "Collect and cross-check sources"}\n- [ ] ${vi ? "Nhờ thành viên phản biện" : "Request a peer review"}\n`;
}
