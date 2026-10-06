import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Atom,
  BookOpenCheck,
  Bot,
  BrainCircuit,
  Check,
  Clipboard,
  ClipboardCheck,
  Dna,
  Download,
  FolderPlus,
  FlaskConical,
  FunctionSquare,
  Lightbulb,
  Microscope,
  NotebookPen,
  Save,
  SearchCheck,
  ShieldCheck,
  Sigma,
  Sparkles,
  Target,
} from 'lucide-react';
import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import type { Language } from './ProductViews';

export type ResearchDomainId = 'mathematics' | 'physics' | 'chemistry' | 'biology' | 'artificial-intelligence';

export interface DomainResearchPayload {
  analysisMode?: 'paper';
  topic: string;
  domain: ResearchDomainId;
  domainLabel: string;
  category: string;
  categoryLabel: string;
  researchNotes: string;
  latexContext: string;
  sourcePreferences: string[];
}

interface DomainCategory {
  id: string;
  code: string;
  vi: { title: string; description: string };
  en: { title: string; description: string };
}

interface DomainTemplate {
  vi: { title: string; topic: string; outcome: string };
  en: { title: string; topic: string; outcome: string };
}

interface DomainDefinition {
  id: ResearchDomainId;
  icon: typeof Sigma;
  shortCode: string;
  vi: {
    title: string;
    subtitle: string;
    description: string;
    methods: string[];
    sourceLanes: string[];
    notePrompts: string[];
  };
  en: {
    title: string;
    subtitle: string;
    description: string;
    methods: string[];
    sourceLanes: string[];
    notePrompts: string[];
  };
  categories: DomainCategory[];
  templates: DomainTemplate[];
  latexPresets: { label: string; value: string }[];
}

export const domains: DomainDefinition[] = [
  {
    id: 'mathematics', icon: Sigma, shortCode: 'MATH',
    vi: {
      title: 'Toán học', subtitle: 'Chứng minh, mô hình và tính đúng đắn',
      description: 'Từ cấu trúc đại số đến mô hình số: tách giả thiết, định lý, phản ví dụ và điều kiện áp dụng trước khi tổng hợp.',
      methods: ['Định nghĩa → bổ đề → định lý', 'Tìm phản ví dụ và biên', 'So sánh chứng minh', 'Kiểm tra giả thiết'],
      sourceLanes: ['arXiv math.*', 'Crossref / DOI', 'Giáo trình học thuật', 'Bài báo peer-reviewed'],
      notePrompts: ['Giả thiết nào đang được sử dụng?', 'Kết quả có phản ví dụ ở biên không?', 'Có cách chứng minh hoặc mô hình thay thế nào?'],
    },
    en: {
      title: 'Mathematics', subtitle: 'Proofs, models, and correctness',
      description: 'From algebraic structures to numerical models: isolate assumptions, theorems, counterexamples, and validity conditions before synthesis.',
      methods: ['Definition → lemma → theorem', 'Counterexamples and edge cases', 'Proof comparison', 'Assumption audit'],
      sourceLanes: ['arXiv math.*', 'Crossref / DOI', 'Academic textbooks', 'Peer-reviewed papers'],
      notePrompts: ['Which assumptions are being used?', 'Does the result fail at a boundary case?', 'Is there an alternative proof or model?'],
    },
    categories: [
      { id: 'algebra', code: 'math.AG / math.RA', vi: { title: 'Đại số', description: 'Đại số tuyến tính, giao hoán, biểu diễn và hình học đại số.' }, en: { title: 'Algebra', description: 'Linear, commutative, representation, and algebraic geometry.' } },
      { id: 'analysis', code: 'math.CA / math.FA', vi: { title: 'Giải tích', description: 'Giải tích thực–phức, hàm, toán tử và phương trình.' }, en: { title: 'Analysis', description: 'Real and complex analysis, functions, operators, and equations.' } },
      { id: 'geometry', code: 'math.DG / math.GT', vi: { title: 'Hình học & Tô pô', description: 'Hình học vi phân, tô pô và bất biến cấu trúc.' }, en: { title: 'Geometry & topology', description: 'Differential geometry, topology, and structural invariants.' } },
      { id: 'probability', code: 'math.PR / math.ST', vi: { title: 'Xác suất & Thống kê', description: 'Quá trình ngẫu nhiên, suy luận và kiểm định.' }, en: { title: 'Probability & statistics', description: 'Stochastic processes, inference, and testing.' } },
      { id: 'applied', code: 'math.OC / math.OPT', vi: { title: 'Toán ứng dụng', description: 'Tối ưu, điều khiển, vận trù và mô hình hóa.' }, en: { title: 'Applied mathematics', description: 'Optimization, control, operations, and modeling.' } },
      { id: 'numerical', code: 'math.NA', vi: { title: 'Giải tích số', description: 'Sai số, hội tụ, ổn định và thuật toán số.' }, en: { title: 'Numerical analysis', description: 'Error, convergence, stability, and numerical algorithms.' } },
    ],
    templates: [
      { vi: { title: 'Bản đồ định lý', topic: 'Xây dựng bản đồ các định lý, giả thiết và quan hệ suy ra cho một chủ đề toán học, kèm phản ví dụ khi bỏ từng giả thiết', outcome: 'Taxonomy + proof map' }, en: { title: 'Theorem map', topic: 'Build a map of theorems, assumptions, and implications for a mathematical topic, including counterexamples when each assumption is removed', outcome: 'Taxonomy + proof map' } },
      { vi: { title: 'So sánh phương pháp', topic: 'So sánh chặt chẽ các phương pháp giải cho một bài toán toán học theo điều kiện áp dụng, độ phức tạp, sai số và khả năng tổng quát hóa', outcome: 'Method decision matrix' }, en: { title: 'Method comparison', topic: 'Rigorously compare solution methods for a mathematical problem by applicability, complexity, error, and generalizability', outcome: 'Method decision matrix' } },
      { vi: { title: 'Audit mô hình', topic: 'Kiểm tra một mô hình toán học từ giả định, tính xác định, độ nhạy, giới hạn đến bằng chứng thực nghiệm hỗ trợ', outcome: 'Model audit' }, en: { title: 'Model audit', topic: 'Audit a mathematical model from assumptions and identifiability through sensitivity, limitations, and supporting empirical evidence', outcome: 'Model audit' } },
    ],
    latexPresets: [
      { label: 'Integral', value: String.raw`\int_{a}^{b} f(x)\,dx` },
      { label: 'Matrix', value: String.raw`A=\begin{bmatrix}a&b\\c&d\end{bmatrix}` },
      { label: 'Theorem', value: String.raw`\forall \varepsilon>0,\;\exists \delta>0:\ |x-a|<\delta \Rightarrow |f(x)-L|<\varepsilon` },
      { label: 'Optimization', value: String.raw`x^*=\operatorname*{arg\,min}_{x\in\mathcal{X}} f(x)` },
    ],
  },
  {
    id: 'physics', icon: Atom, shortCode: 'PHYS',
    vi: {
      title: 'Vật lý', subtitle: 'Định luật, đơn vị và kiểm chứng thực nghiệm',
      description: 'Nghiên cứu hiện tượng từ mô hình lý thuyết đến phép đo, ưu tiên phân tích thứ nguyên, miền hiệu lực và sai số thực nghiệm.',
      methods: ['Phân tích thứ nguyên', 'Miền hiệu lực của mô hình', 'Đối chiếu lý thuyết–thực nghiệm', 'Lan truyền sai số'],
      sourceLanes: ['arXiv physics.*', 'NASA / CERN / NIST', 'Journals & DOI', 'Datasets thực nghiệm'],
      notePrompts: ['Đại lượng quan sát được là gì?', 'Mô hình đúng trong miền tham số nào?', 'Sai số hệ thống và ngẫu nhiên được xử lý ra sao?'],
    },
    en: {
      title: 'Physics', subtitle: 'Laws, units, and empirical validation',
      description: 'Study phenomena from theoretical models to measurements, prioritizing dimensional analysis, validity ranges, and experimental uncertainty.',
      methods: ['Dimensional analysis', 'Model validity range', 'Theory–experiment comparison', 'Error propagation'],
      sourceLanes: ['arXiv physics.*', 'NASA / CERN / NIST', 'Journals & DOI', 'Experimental datasets'],
      notePrompts: ['What is the observable quantity?', 'Over which parameter range is the model valid?', 'How are systematic and random errors handled?'],
    },
    categories: [
      { id: 'classical', code: 'physics.class-ph', vi: { title: 'Cơ học cổ điển', description: 'Động lực học, chất lưu, dao động và hệ phi tuyến.' }, en: { title: 'Classical mechanics', description: 'Dynamics, fluids, oscillations, and nonlinear systems.' } },
      { id: 'electromagnetism', code: 'physics.optics', vi: { title: 'Điện từ & Quang học', description: 'Trường, sóng, quang học và vật liệu điện từ.' }, en: { title: 'Electromagnetism & optics', description: 'Fields, waves, optics, and electromagnetic materials.' } },
      { id: 'quantum', code: 'quant-ph', vi: { title: 'Vật lý lượng tử', description: 'Nền tảng lượng tử, thông tin và hệ nhiều hạt.' }, en: { title: 'Quantum physics', description: 'Quantum foundations, information, and many-body systems.' } },
      { id: 'thermodynamics', code: 'cond-mat.stat-mech', vi: { title: 'Nhiệt & Thống kê', description: 'Entropy, chuyển pha và hệ ngoài cân bằng.' }, en: { title: 'Thermal & statistical physics', description: 'Entropy, phase transitions, and non-equilibrium systems.' } },
      { id: 'relativity', code: 'gr-qc / astro-ph', vi: { title: 'Tương đối & Thiên văn', description: 'Không-thời gian, hấp dẫn, vũ trụ và vật thể thiên văn.' }, en: { title: 'Relativity & astrophysics', description: 'Spacetime, gravity, cosmology, and astronomical objects.' } },
      { id: 'condensed', code: 'cond-mat.*', vi: { title: 'Vật chất ngưng tụ', description: 'Chất rắn, vật liệu, siêu dẫn và hệ mềm.' }, en: { title: 'Condensed matter', description: 'Solids, materials, superconductivity, and soft matter.' } },
    ],
    templates: [
      { vi: { title: 'Lý thuyết vs thực nghiệm', topic: 'Đối chiếu dự đoán lý thuyết với kết quả thực nghiệm của một hiện tượng vật lý, bao gồm thiết bị đo, độ bất định và các sai lệch đã biết', outcome: 'Evidence comparison' }, en: { title: 'Theory vs experiment', topic: 'Compare theoretical predictions with experimental results for a physical phenomenon, including instrumentation, uncertainty, and known discrepancies', outcome: 'Evidence comparison' } },
      { vi: { title: 'Audit hằng số & đơn vị', topic: 'Tổng hợp các phương trình, hằng số, quy ước đơn vị và phân tích thứ nguyên cho một bài toán vật lý cụ thể', outcome: 'Equation & unit audit' }, en: { title: 'Constants & units audit', topic: 'Compile the equations, constants, unit conventions, and dimensional analysis for a specific physics problem', outcome: 'Equation & unit audit' } },
      { vi: { title: 'Bản đồ mô hình', topic: 'So sánh các mô hình vật lý cạnh tranh, miền hiệu lực, tham số, tiên đoán phân biệt và bằng chứng ủng hộ hoặc bác bỏ', outcome: 'Competing-model map' }, en: { title: 'Model landscape', topic: 'Compare competing physical models, validity ranges, parameters, discriminating predictions, and supporting or contradictory evidence', outcome: 'Competing-model map' } },
    ],
    latexPresets: [
      { label: 'Einstein', value: String.raw`E=mc^2` },
      { label: 'Schrödinger', value: String.raw`i\hbar\frac{\partial}{\partial t}\Psi=\hat{H}\Psi` },
      { label: 'Maxwell', value: String.raw`\nabla\cdot\mathbf{E}=\frac{\rho}{\varepsilon_0}` },
      { label: 'Uncertainty', value: String.raw`\sigma_f^2=\sum_i\left(\frac{\partial f}{\partial x_i}\right)^2\sigma_i^2` },
    ],
  },
  {
    id: 'chemistry', icon: FlaskConical, shortCode: 'CHEM',
    vi: {
      title: 'Hóa học', subtitle: 'Cấu trúc, phản ứng và điều kiện an toàn',
      description: 'Theo dõi chất, cơ chế, điều kiện phản ứng, phép phân tích và bằng chứng đặc trưng; phân biệt rõ dữ liệu thực nghiệm với suy luận.',
      methods: ['Cân bằng & stoichiometry', 'Cơ chế phản ứng', 'Phổ và đặc trưng hóa', 'An toàn & điều kiện'],
      sourceLanes: ['CAS / PubChem', 'NIST Chemistry', 'Crossref / DOI', 'SDS & cơ quan quản lý'],
      notePrompts: ['Chất và điều kiện có được định danh đầy đủ?', 'Cơ chế nào cạnh tranh với cơ chế đề xuất?', 'Phổ hoặc phép đo nào xác nhận sản phẩm?'],
    },
    en: {
      title: 'Chemistry', subtitle: 'Structure, reactions, and safe conditions',
      description: 'Track substances, mechanisms, reaction conditions, analytical methods, and characterization evidence while separating measurements from inference.',
      methods: ['Balance & stoichiometry', 'Reaction mechanisms', 'Spectral characterization', 'Safety & conditions'],
      sourceLanes: ['CAS / PubChem', 'NIST Chemistry', 'Crossref / DOI', 'SDS & regulators'],
      notePrompts: ['Are substances and conditions fully identified?', 'Which mechanisms compete with the proposal?', 'Which spectra or measurements confirm the product?'],
    },
    categories: [
      { id: 'organic', code: 'chemistry.organic', vi: { title: 'Hóa hữu cơ', description: 'Tổng hợp, cơ chế, xúc tác và hóa học lập thể.' }, en: { title: 'Organic chemistry', description: 'Synthesis, mechanisms, catalysis, and stereochemistry.' } },
      { id: 'inorganic', code: 'chemistry.inorganic', vi: { title: 'Hóa vô cơ', description: 'Phức chất, kim loại, khoáng và cấu trúc rắn.' }, en: { title: 'Inorganic chemistry', description: 'Complexes, metals, minerals, and solid structures.' } },
      { id: 'physical', code: 'physics.chem-ph', vi: { title: 'Hóa lý', description: 'Nhiệt động, động học, lượng tử và bề mặt.' }, en: { title: 'Physical chemistry', description: 'Thermodynamics, kinetics, quantum chemistry, and surfaces.' } },
      { id: 'analytical', code: 'chemistry.analytical', vi: { title: 'Hóa phân tích', description: 'Sắc ký, quang phổ, cảm biến và kiểm định phương pháp.' }, en: { title: 'Analytical chemistry', description: 'Chromatography, spectroscopy, sensors, and validation.' } },
      { id: 'materials', code: 'cond-mat.mtrl-sci', vi: { title: 'Hóa vật liệu', description: 'Polymer, nano, điện hóa và vật liệu chức năng.' }, en: { title: 'Materials chemistry', description: 'Polymers, nanomaterials, electrochemistry, and functional materials.' } },
      { id: 'biochemistry', code: 'q-bio.BM', vi: { title: 'Hóa sinh', description: 'Protein, enzyme, chuyển hóa và tương tác phân tử.' }, en: { title: 'Biochemistry', description: 'Proteins, enzymes, metabolism, and molecular interactions.' } },
    ],
    templates: [
      { vi: { title: 'Audit phản ứng', topic: 'Đánh giá một phản ứng hóa học theo cân bằng, cơ chế, điều kiện, hiệu suất, phản ứng phụ, phương pháp tinh sạch và bằng chứng đặc trưng hóa', outcome: 'Reaction dossier' }, en: { title: 'Reaction audit', topic: 'Evaluate a chemical reaction by balance, mechanism, conditions, yield, side reactions, purification, and characterization evidence', outcome: 'Reaction dossier' } },
      { vi: { title: 'So sánh phương pháp phân tích', topic: 'So sánh các phương pháp phân tích một chất theo giới hạn phát hiện, độ chọn lọc, độ chính xác, chuẩn bị mẫu và chi phí', outcome: 'Analytical method matrix' }, en: { title: 'Analytical method comparison', topic: 'Compare analytical methods for a substance by detection limit, selectivity, accuracy, sample preparation, and cost', outcome: 'Analytical method matrix' } },
      { vi: { title: 'Hồ sơ vật liệu', topic: 'Xây dựng hồ sơ một vật liệu từ cấu trúc–tính chất, quy trình tổng hợp, phép đặc trưng, độ bền, độc tính đến khả năng mở rộng', outcome: 'Material evidence brief' }, en: { title: 'Material dossier', topic: 'Build a material dossier covering structure–property relations, synthesis, characterization, durability, toxicity, and scale-up', outcome: 'Material evidence brief' } },
    ],
    latexPresets: [
      { label: 'Reaction', value: String.raw`\ce{2H2 + O2 -> 2H2O}` },
      { label: 'Equilibrium', value: String.raw`K_c=\frac{[C]^c[D]^d}{[A]^a[B]^b}` },
      { label: 'Gibbs', value: String.raw`\Delta G=\Delta H-T\Delta S` },
      { label: 'Rate law', value: String.raw`v=k[A]^m[B]^n` },
    ],
  },
  {
    id: 'biology', icon: Dna, shortCode: 'BIO',
    vi: {
      title: 'Sinh học', subtitle: 'Hệ sống, thiết kế nghiên cứu và khả năng tái lập',
      description: 'Tổ chức bằng chứng theo cấp độ phân tử–tế bào–cơ thể–quần thể, chú trọng thiết kế thí nghiệm, cỡ mẫu và giới hạn suy rộng.',
      methods: ['PICO / giả thuyết', 'Thiết kế & đối chứng', 'Cỡ mẫu và bias', 'Tái lập & dữ liệu mở'],
      sourceLanes: ['PubMed / PMC', 'NCBI / UniProt', 'WHO / CDC', 'ClinicalTrials / datasets'],
      notePrompts: ['Đơn vị sinh học và quần thể nghiên cứu là gì?', 'Đối chứng, randomization và blinding thế nào?', 'Kết quả là tương quan hay quan hệ nhân quả?'],
    },
    en: {
      title: 'Biology', subtitle: 'Living systems, study design, and reproducibility',
      description: 'Organize evidence across molecular, cellular, organism, and population levels, emphasizing study design, sample size, and generalizability.',
      methods: ['PICO / hypothesis framing', 'Design & controls', 'Sample size and bias', 'Replication & open data'],
      sourceLanes: ['PubMed / PMC', 'NCBI / UniProt', 'WHO / CDC', 'ClinicalTrials / datasets'],
      notePrompts: ['What is the biological unit and study population?', 'How are controls, randomization, and blinding handled?', 'Is the result correlational or causal?'],
    },
    categories: [
      { id: 'molecular', code: 'q-bio.BM', vi: { title: 'Sinh học phân tử', description: 'DNA, RNA, protein và điều hòa biểu hiện gene.' }, en: { title: 'Molecular biology', description: 'DNA, RNA, proteins, and gene-expression control.' } },
      { id: 'cellular', code: 'q-bio.CB', vi: { title: 'Sinh học tế bào', description: 'Tín hiệu, chu kỳ, bào quan và tương tác tế bào.' }, en: { title: 'Cell biology', description: 'Signaling, cycles, organelles, and cell interactions.' } },
      { id: 'genetics', code: 'q-bio.GN', vi: { title: 'Di truyền & Genomics', description: 'Biến dị, di truyền quần thể và dữ liệu omics.' }, en: { title: 'Genetics & genomics', description: 'Variation, population genetics, and omics data.' } },
      { id: 'ecology', code: 'q-bio.PE', vi: { title: 'Sinh thái & Tiến hóa', description: 'Quần thể, hệ sinh thái, thích nghi và bảo tồn.' }, en: { title: 'Ecology & evolution', description: 'Populations, ecosystems, adaptation, and conservation.' } },
      { id: 'neuroscience', code: 'q-bio.NC', vi: { title: 'Khoa học thần kinh', description: 'Neuron, mạng thần kinh sinh học, hành vi và nhận thức.' }, en: { title: 'Neuroscience', description: 'Neurons, biological networks, behavior, and cognition.' } },
      { id: 'biotechnology', code: 'q-bio.OT', vi: { title: 'Công nghệ sinh học', description: 'Chỉnh sửa gene, synthetic biology và ứng dụng y sinh.' }, en: { title: 'Biotechnology', description: 'Gene editing, synthetic biology, and biomedical applications.' } },
    ],
    templates: [
      { vi: { title: 'Đánh giá bằng chứng sinh học', topic: 'Tổng hợp bằng chứng cho một cơ chế sinh học từ in vitro, mô hình động vật đến nghiên cứu trên người, nêu rõ độ mạnh và giới hạn suy rộng', outcome: 'Evidence ladder' }, en: { title: 'Biological evidence review', topic: 'Synthesize evidence for a biological mechanism from in vitro work and animal models through human studies, stating strength and generalizability limits', outcome: 'Evidence ladder' } },
      { vi: { title: 'Audit thiết kế nghiên cứu', topic: 'Audit thiết kế một nghiên cứu sinh học theo giả thuyết, mẫu, đối chứng, randomization, blinding, endpoint, thống kê và khả năng tái lập', outcome: 'Study design audit' }, en: { title: 'Study-design audit', topic: 'Audit a biological study by hypothesis, sample, controls, randomization, blinding, endpoints, statistics, and reproducibility', outcome: 'Study design audit' } },
      { vi: { title: 'Bản đồ gene–phenotype', topic: 'Lập bản đồ bằng chứng nối gene, biến thể, pathway và phenotype, phân biệt association với quan hệ nhân quả', outcome: 'Mechanism map' }, en: { title: 'Gene–phenotype map', topic: 'Map evidence linking genes, variants, pathways, and phenotypes while separating association from causality', outcome: 'Mechanism map' } },
    ],
    latexPresets: [
      { label: 'Growth', value: String.raw`N(t)=N_0e^{rt}` },
      { label: 'Hardy–Weinberg', value: String.raw`p^2+2pq+q^2=1` },
      { label: 'Michaelis–Menten', value: String.raw`v=\frac{V_{\max}[S]}{K_m+[S]}` },
      { label: 'Odds ratio', value: String.raw`\mathrm{OR}=\frac{ad}{bc}` },
    ],
  },
  {
    id: 'artificial-intelligence', icon: BrainCircuit, shortCode: 'AI',
    vi: {
      title: 'Trí tuệ nhân tạo', subtitle: 'Mô hình, dữ liệu, đánh giá và triển khai',
      description: 'Đi sâu từ nền tảng học máy đến LLM, agent và AI an toàn; tách benchmark khỏi giá trị thực tế, kiểm tra leakage, chi phí và rủi ro.',
      methods: ['Baseline & ablation', 'Dataset / leakage audit', 'Evaluation & uncertainty', 'Safety, cost & deployment'],
      sourceLanes: ['arXiv cs.AI / cs.LG', 'Papers with Code', 'Model cards / datasheets', 'Conference proceedings'],
      notePrompts: ['Baseline và metric có phù hợp bài toán không?', 'Dữ liệu có leakage hoặc shift không?', 'Kết quả có tái lập được với chi phí được công bố?'],
    },
    en: {
      title: 'Artificial intelligence', subtitle: 'Models, data, evaluation, and deployment',
      description: 'Go from machine-learning foundations to LLMs, agents, and AI safety; separate benchmarks from real value and audit leakage, cost, and risk.',
      methods: ['Baselines & ablations', 'Dataset / leakage audit', 'Evaluation & uncertainty', 'Safety, cost & deployment'],
      sourceLanes: ['arXiv cs.AI / cs.LG', 'Papers with Code', 'Model cards / datasheets', 'Conference proceedings'],
      notePrompts: ['Do baselines and metrics match the task?', 'Is there leakage or distribution shift?', 'Can results be reproduced at the reported cost?'],
    },
    categories: [
      { id: 'machine-learning', code: 'cs.LG / stat.ML', vi: { title: 'Machine learning', description: 'Học có giám sát, không giám sát, biểu diễn và lý thuyết học.' }, en: { title: 'Machine learning', description: 'Supervised, unsupervised, representation learning, and theory.' } },
      { id: 'deep-learning', code: 'cs.LG', vi: { title: 'Deep learning', description: 'Kiến trúc, tối ưu, scaling và hiệu quả tính toán.' }, en: { title: 'Deep learning', description: 'Architectures, optimization, scaling, and compute efficiency.' } },
      { id: 'nlp-llm', code: 'cs.CL / cs.AI', vi: { title: 'NLP, LLM & Agents', description: 'Ngôn ngữ, RAG, reasoning, tool use và hệ đa agent.' }, en: { title: 'NLP, LLMs & agents', description: 'Language, RAG, reasoning, tool use, and multi-agent systems.' } },
      { id: 'computer-vision', code: 'cs.CV', vi: { title: 'Computer vision', description: 'Ảnh, video, 3D, multimodal và thị giác tạo sinh.' }, en: { title: 'Computer vision', description: 'Images, video, 3D, multimodal, and generative vision.' } },
      { id: 'reinforcement-learning', code: 'cs.LG / cs.AI', vi: { title: 'Reinforcement learning', description: 'Policy, reward, offline RL và ra quyết định tuần tự.' }, en: { title: 'Reinforcement learning', description: 'Policies, rewards, offline RL, and sequential decisions.' } },
      { id: 'responsible-ai', code: 'cs.CY / cs.AI', vi: { title: 'AI Safety & Evaluation', description: 'Độ tin cậy, bias, red teaming, alignment và governance.' }, en: { title: 'AI safety & evaluation', description: 'Reliability, bias, red teaming, alignment, and governance.' } },
    ],
    templates: [
      { vi: { title: 'Paper-to-production', topic: 'Đánh giá một phương pháp AI từ đóng góp của paper, dataset, baseline, ablation và benchmark đến chi phí, độ trễ, an toàn và khả năng triển khai production', outcome: 'Implementation decision brief' }, en: { title: 'Paper to production', topic: 'Evaluate an AI method from paper contributions, datasets, baselines, ablations, and benchmarks through cost, latency, safety, and production readiness', outcome: 'Implementation decision brief' } },
      { vi: { title: 'Benchmark audit', topic: 'Audit một benchmark AI theo data contamination, metric, statistical significance, compute budget, reproducibility và mức độ phản ánh use case thực tế', outcome: 'Benchmark audit' }, en: { title: 'Benchmark audit', topic: 'Audit an AI benchmark for data contamination, metrics, statistical significance, compute budget, reproducibility, and real-use-case validity', outcome: 'Benchmark audit' } },
      { vi: { title: 'Model landscape', topic: 'So sánh các mô hình AI cho một use case theo chất lượng, dữ liệu, context, tool use, chi phí, độ trễ, privacy, license và rủi ro vận hành', outcome: 'Model selection matrix' }, en: { title: 'Model landscape', topic: 'Compare AI models for a use case by quality, data, context, tool use, cost, latency, privacy, licensing, and operational risk', outcome: 'Model selection matrix' } },
    ],
    latexPresets: [
      { label: 'Cross entropy', value: String.raw`\mathcal{L}=-\sum_{i=1}^{C}y_i\log \hat{y}_i` },
      { label: 'Attention', value: String.raw`\operatorname{Attention}(Q,K,V)=\operatorname{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)V` },
      { label: 'Gradient', value: String.raw`\theta_{t+1}=\theta_t-\eta\nabla_\theta\mathcal{L}(\theta_t)` },
      { label: 'Bayes', value: String.raw`p(\theta\mid D)=\frac{p(D\mid\theta)p(\theta)}{p(D)}` },
    ],
  },
];

type DomainWorkspace = Record<ResearchDomainId, { category: string; notes: string; latex: string; checklist: boolean[] }>;

const createWorkspace = (): DomainWorkspace => Object.fromEntries(domains.map((domain) => [domain.id, {
  category: domain.categories[0].id,
  notes: '',
  latex: domain.latexPresets[0].value,
  checklist: [false, false, false, false],
}])) as DomainWorkspace;

const loadWorkspace = (): DomainWorkspace => {
  const fallback = createWorkspace();
  try {
    const saved = JSON.parse(window.localStorage.getItem('deep-research-domain-workspace') || '{}') as Partial<DomainWorkspace>;
    domains.forEach((domain) => {
      const entry = saved[domain.id];
      if (entry) fallback[domain.id] = { ...fallback[domain.id], ...entry };
    });
  } catch {
    // Corrupt local data should never prevent the domain hub from opening.
  }
  return fallback;
};

const labels = {
  vi: {
    eyebrow: 'RESEARCH DOMAINS', title: 'Nghiên cứu theo từng lĩnh vực.',
    description: 'Chọn ngành, chuyên đề và bộ công cụ phù hợp. Mỗi lựa chọn sẽ tạo context riêng cho analyst, chiến lược nguồn và cấu trúc báo cáo.',
    choose: 'Chọn lĩnh vực', categories: 'Chuyên ngành', methods: 'Khung phương pháp', sources: 'Ưu tiên nguồn',
    sourceHint: 'Đây là định hướng truy vấn và kiểm chứng, không phải cam kết mọi nguồn đều có quyền truy cập.',
    templates: 'Research playbooks', templatesHint: 'Mẫu brief được thiết kế theo chuẩn bằng chứng của lĩnh vực.', useTemplate: 'Dùng playbook',
    toolkit: 'Domain toolkit', latex: 'LaTeX Lab', latexHint: 'Soạn và xem trước công thức bằng KaTeX; Chemistry hỗ trợ cú pháp \\ce{}.',
    display: 'Công thức khối', copy: 'Sao chép', copied: 'Đã sao chép', insert: 'Chèn vào notes', downloadTex: 'Tải .tex',
    notes: 'Ghi chú nhanh trên thiết bị', notesHint: 'Bản nháp cục bộ. Dùng Notebook để viết theo khối, tạo trang con và lưu theo tài khoản.', notePlaceholder: 'Ghi giả thuyết, định nghĩa, paper cần đọc, mâu thuẫn bằng chứng…',
    autoSaved: 'Tự động lưu cục bộ', exportNotes: 'Xuất Markdown', prompts: 'Câu hỏi kiểm tra',
    checklist: ['Câu hỏi nghiên cứu đã đủ cụ thể', 'Đã xác định bằng chứng cần tìm', 'Có lane tìm phản chứng / giới hạn', 'Đã ghi tiêu chí kết luận'],
    builder: 'Brief builder', builderHint: 'Kết hợp chủ đề của bạn với context ngành và notebook.',
    customTopic: 'Câu hỏi hoặc chủ đề cụ thể', customPlaceholder: 'Ví dụ: So sánh Transformer và state-space model cho chuỗi thời gian y sinh…',
    includeNotes: 'Kèm ghi chú', includeLatex: 'Kèm công thức LaTeX', start: 'Mở trong Research workspace',
    selected: 'Đang chọn', savedOnDevice: 'Dữ liệu chỉ nằm trên thiết bị cho đến khi bạn chủ động đưa vào brief.',
    minTopic: 'Nhập ít nhất 8 ký tự để bắt đầu.',
  },
  en: {
    eyebrow: 'RESEARCH DOMAINS', title: 'Research with field-specific rigor.',
    description: 'Choose a discipline, specialty, and tailored toolkit. Each choice adds domain context, evidence priorities, and report structure for the analyst team.',
    choose: 'Choose a field', categories: 'Specialties', methods: 'Method framework', sources: 'Source priorities',
    sourceHint: 'These guide search and verification; they do not guarantee access to every source.',
    templates: 'Research playbooks', templatesHint: 'Brief templates designed around the evidence standards of this field.', useTemplate: 'Use playbook',
    toolkit: 'Domain toolkit', latex: 'LaTeX Lab', latexHint: 'Compose and preview equations with KaTeX; Chemistry supports \\ce{} notation.',
    display: 'Display equation', copy: 'Copy', copied: 'Copied', insert: 'Insert into notes', downloadTex: 'Download .tex',
    notes: 'Device scratchpad', notesHint: 'A local draft. Open Notebook for block editing, nested pages, and account-based storage.', notePlaceholder: 'Capture hypotheses, definitions, papers to read, evidence conflicts…',
    autoSaved: 'Saved locally', exportNotes: 'Export Markdown', prompts: 'Audit questions',
    checklist: ['Research question is specific', 'Required evidence is identified', 'Counterevidence / limitation lane exists', 'Decision criteria are recorded'],
    builder: 'Brief builder', builderHint: 'Combine your topic with the field context and notebook.',
    customTopic: 'Specific question or topic', customPlaceholder: 'Example: Compare Transformers and state-space models for biomedical time series…',
    includeNotes: 'Include notes', includeLatex: 'Include LaTeX', start: 'Open in Research workspace',
    selected: 'Selected', savedOnDevice: 'Data stays on this device until you explicitly include it in a brief.',
    minTopic: 'Enter at least 8 characters to begin.',
  },
} as const;

function downloadText(filename: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function DomainHub({ language, onStartResearch, onOpenNotebook }: { language: Language; onStartResearch: (payload: DomainResearchPayload) => void; onOpenNotebook: (field: ResearchDomainId) => void }) {
  const t = labels[language];
  const [activeDomainId, setActiveDomainId] = useState<ResearchDomainId>(() => {
    const saved = window.localStorage.getItem('deep-research-active-domain') as ResearchDomainId | null;
    return saved && domains.some((domain) => domain.id === saved) ? saved : 'artificial-intelligence';
  });
  const [workspace, setWorkspace] = useState<DomainWorkspace>(loadWorkspace);
  const [displayMode, setDisplayMode] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeLatex, setIncludeLatex] = useState(true);
  const [customTopic, setCustomTopic] = useState('');
  const [copied, setCopied] = useState(false);

  const activeDomain = domains.find((domain) => domain.id === activeDomainId) || domains[0];
  const activeCopy = activeDomain[language];
  const activeWorkspace = workspace[activeDomain.id];
  const activeCategory = activeDomain.categories.find((category) => category.id === activeWorkspace.category) || activeDomain.categories[0];
  const categoryCopy = activeCategory[language];

  useEffect(() => {
    window.localStorage.setItem('deep-research-active-domain', activeDomainId);
  }, [activeDomainId]);

  useEffect(() => {
    window.localStorage.setItem('deep-research-domain-workspace', JSON.stringify(workspace));
  }, [workspace]);

  const latexHtml = useMemo(() => katex.renderToString(activeWorkspace.latex || ' ', {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: 'warn',
  }), [activeWorkspace.latex, displayMode]);

  const updateActive = (patch: Partial<DomainWorkspace[ResearchDomainId]>) => {
    setWorkspace((current) => ({ ...current, [activeDomain.id]: { ...current[activeDomain.id], ...patch } }));
  };

  const launch = (topic: string) => {
    if (topic.trim().length < 8) return;
    onStartResearch({
      topic: topic.trim(),
      domain: activeDomain.id,
      domainLabel: activeCopy.title,
      category: activeCategory.id,
      categoryLabel: categoryCopy.title,
      researchNotes: includeNotes ? activeWorkspace.notes.trim() : '',
      latexContext: includeLatex ? activeWorkspace.latex.trim() : '',
      sourcePreferences: activeCopy.sourceLanes,
    });
  };

  const copyLatex = async () => {
    await navigator.clipboard.writeText(activeWorkspace.latex);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const insertLatexIntoNotes = () => {
    const block = `$$\n${activeWorkspace.latex}\n$$`;
    updateActive({ notes: `${activeWorkspace.notes.trim()}${activeWorkspace.notes.trim() ? '\n\n' : ''}${block}` });
  };

  const exportNotes = () => {
    const checklist = t.checklist.map((item, index) => `- [${activeWorkspace.checklist[index] ? 'x' : ' '}] ${item}`).join('\n');
    const content = `# ${activeCopy.title} — ${categoryCopy.title}\n\n> ${activeCategory.code}\n\n## Research checklist\n\n${checklist}\n\n## Notes\n\n${activeWorkspace.notes || '_Empty_'}\n\n## LaTeX\n\n\`\`\`latex\n${activeWorkspace.latex}\n\`\`\`\n`;
    downloadText(`${activeDomain.id}-research-notes.md`, content, 'text/markdown;charset=utf-8');
  };

  return (
    <div className={`domain-hub domain-${activeDomain.id}`}>
      <section className="domain-hero">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
        <div className="domain-hero__visual" aria-hidden="true">
          <span><FunctionSquare size={23} /></span><span><Atom size={26} /></span><span><Dna size={26} /></span><span><Bot size={25} /></span>
          <strong>Σ</strong>
        </div>
      </section>

      <section className="domain-section" aria-labelledby="domain-picker-title">
        <div className="section-heading compact"><div><span>01</span><h2 id="domain-picker-title">{t.choose}</h2></div></div>
        <div className="domain-picker" role="tablist" aria-label={t.choose} data-tour="field-picker">
          {domains.map((domain) => {
            const Icon = domain.icon;
            const item = domain[language];
            return (
              <button key={domain.id} type="button" role="tab" aria-selected={activeDomain.id === domain.id} className={activeDomain.id === domain.id ? `is-active domain-${domain.id}` : `domain-${domain.id}`} onClick={() => setActiveDomainId(domain.id)}>
                <span className="domain-picker__icon"><Icon size={21} /></span>
                <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                <em>{domain.shortCode}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="domain-profile">
        <div className="domain-profile__intro">
          <span className="domain-code">{activeDomain.shortCode}</span>
          <h2>{activeCopy.title}</h2>
          <p>{activeCopy.description}</p>
          <div className="domain-methods"><strong><Target size={16} />{t.methods}</strong>{activeCopy.methods.map((method) => <span key={method}><Check size={13} />{method}</span>)}</div>
        </div>
        <div className="domain-profile__sources">
          <strong><SearchCheck size={17} />{t.sources}</strong>
          <div>{activeCopy.sourceLanes.map((source) => <span key={source}>{source}</span>)}</div>
          <small><ShieldCheck size={14} />{t.sourceHint}</small>
        </div>
      </section>

      <section className="domain-section" aria-labelledby="category-title">
        <div className="section-heading compact"><div><span>02</span><h2 id="category-title">{t.categories}</h2></div><p>{activeCopy.subtitle}</p></div>
        <div className="domain-categories" data-tour="field-categories">
          {activeDomain.categories.map((category) => {
            const item = category[language];
            const active = activeCategory.id === category.id;
            return (
              <button key={category.id} type="button" aria-pressed={active} className={active ? 'is-active' : ''} onClick={() => updateActive({ category: category.id })}>
                <span>{active ? <Check size={15} /> : <Microscope size={15} />}</span>
                <div><strong>{item.title}</strong><p>{item.description}</p><small>{category.code}</small></div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="domain-section" aria-labelledby="playbook-title">
        <div className="section-heading"><div><span>03</span><div><h2 id="playbook-title">{t.templates}</h2><p>{t.templatesHint}</p></div></div></div>
        <div className="domain-playbooks">
          {activeDomain.templates.map((template, index) => {
            const item = template[language];
            return (
              <article key={item.title}>
                <header><span>0{index + 1}</span><BookOpenCheck size={20} /></header>
                <h3>{item.title}</h3><p>{item.topic}</p><small>{item.outcome}</small>
                <button type="button" onClick={() => launch(item.topic)}>{t.useTemplate}<ArrowRight size={15} /></button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="domain-section" aria-labelledby="toolkit-title">
        <div className="section-heading"><div><span>04</span><div><h2 id="toolkit-title">{t.toolkit}</h2><p>{activeCopy.title} · {categoryCopy.title}</p></div></div></div>
        <div className="domain-toolkit">
          <article className="latex-lab" data-tour="field-latex">
            <header><span><Sigma size={20} /></span><div><h3>{t.latex}</h3><p>{t.latexHint}</p></div></header>
            <div className="latex-presets">{activeDomain.latexPresets.map((preset) => <button key={preset.label} type="button" onClick={() => updateActive({ latex: preset.value })}>{preset.label}</button>)}</div>
            <label className="tool-label" htmlFor="latex-input">LaTeX</label>
            <textarea id="latex-input" className="latex-input" spellCheck={false} value={activeWorkspace.latex} onChange={(event) => updateActive({ latex: event.target.value })} />
            <div className="latex-preview" aria-label="LaTeX preview" dangerouslySetInnerHTML={{ __html: latexHtml }} />
            <div className="tool-actions">
              <label className="compact-check"><input type="checkbox" checked={displayMode} onChange={(event) => setDisplayMode(event.target.checked)} /><span>{t.display}</span></label>
              <button type="button" onClick={() => void copyLatex()}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? t.copied : t.copy}</button>
              <button type="button" onClick={insertLatexIntoNotes}><NotebookPen size={15} />{t.insert}</button>
              <button type="button" onClick={() => downloadText(`${activeDomain.id}-formula.tex`, activeWorkspace.latex, 'application/x-tex;charset=utf-8')}><Download size={15} />{t.downloadTex}</button>
            </div>
          </article>

          <article className="research-notebook" data-tour="field-notes">
            <header><span><NotebookPen size={20} /></span><div><h3>{t.notes}</h3><p>{t.notesHint}</p></div><small><Save size={13} />{t.autoSaved}</small></header>
            <textarea value={activeWorkspace.notes} onChange={(event) => updateActive({ notes: event.target.value })} placeholder={t.notePlaceholder} />
            <div className="notebook-audit">
              <strong><ClipboardCheck size={16} />{t.prompts}</strong>
              {t.checklist.map((item, index) => (
                <label key={item}><input type="checkbox" checked={Boolean(activeWorkspace.checklist[index])} onChange={(event) => {
                  const checklist = [...activeWorkspace.checklist]; checklist[index] = event.target.checked; updateActive({ checklist });
                }} /><span>{item}</span></label>
              ))}
            </div>
            <div className="note-prompts">{activeCopy.notePrompts.map((prompt) => <button key={prompt} type="button" onClick={() => updateActive({ notes: `${activeWorkspace.notes.trim()}${activeWorkspace.notes.trim() ? '\n' : ''}- ${prompt} ` })}><Lightbulb size={14} />{prompt}</button>)}</div>
            <footer><small>{t.savedOnDevice}</small><button type="button" onClick={() => onOpenNotebook(activeDomain.id)}><FolderPlus size={15} />{language === 'vi' ? 'Mở Research Notebook' : 'Open Research Notebook'}</button><button type="button" onClick={exportNotes}><Download size={15} />{t.exportNotes}</button></footer>
          </article>
        </div>
      </section>

      <section className="domain-brief-builder" aria-labelledby="brief-builder-title">
        <div className="brief-builder__summary">
          <span><Sparkles size={20} /></span>
          <div><small>{t.selected}</small><h2 id="brief-builder-title">{activeCopy.title} · {categoryCopy.title}</h2><p>{t.builderHint}</p></div>
        </div>
        <div className="brief-builder__form">
          <label htmlFor="domain-topic">{t.customTopic}</label>
          <textarea id="domain-topic" value={customTopic} onChange={(event) => setCustomTopic(event.target.value)} placeholder={t.customPlaceholder} />
          <div className="brief-builder__options">
            <label><input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} /><span>{t.includeNotes}</span></label>
            <label><input type="checkbox" checked={includeLatex} onChange={(event) => setIncludeLatex(event.target.checked)} /><span>{t.includeLatex}</span></label>
          </div>
          <button className="button button--primary" type="button" disabled={customTopic.trim().length < 8} onClick={() => launch(customTopic)}><Sparkles size={17} />{t.start}<ArrowRight size={16} /></button>
          {customTopic.length > 0 && customTopic.trim().length < 8 && <small className="brief-builder__error">{t.minTopic}</small>}
        </div>
      </section>
    </div>
  );
}
