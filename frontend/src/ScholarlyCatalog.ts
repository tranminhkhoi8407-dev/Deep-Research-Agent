export type ScholarlyFieldId = 'mathematics' | 'physics' | 'chemistry' | 'biology' | 'artificial-intelligence';

export interface ScholarlyCategory {
  id: string;
  en: string;
  vi: string;
}

export interface ScholarlyJournal {
  issn: string;
  name: string;
}

export interface ScholarlyField {
  id: ScholarlyFieldId;
  code: string;
  en: { title: string; subtitle: string; description: string };
  vi: { title: string; subtitle: string; description: string };
  categories: ScholarlyCategory[];
  journals: ScholarlyJournal[];
}

// ISSNs were checked against Crossref's journal catalog. These are discovery
// shortcuts, not an assertion that every returned article has been reviewed.
export const scholarlyFields: ScholarlyField[] = [
  {
    id: 'mathematics', code: '01 / MATH',
    en: { title: 'Mathematics', subtitle: 'Proofs, structures & models', description: 'Follow theorems, assumptions, methods and mathematical preprints.' },
    vi: { title: 'Toán học', subtitle: 'Chứng minh, cấu trúc & mô hình', description: 'Theo dõi định lý, giả thiết, phương pháp và bản thảo toán học.' },
    categories: [
      { id: 'math.AG', en: 'Algebraic geometry', vi: 'Hình học đại số' },
      { id: 'math.CA', en: 'Analysis', vi: 'Giải tích' },
      { id: 'math.DG', en: 'Differential geometry', vi: 'Hình học vi phân' },
      { id: 'math.PR', en: 'Probability', vi: 'Xác suất' },
      { id: 'math.OC', en: 'Optimization & control', vi: 'Tối ưu & điều khiển' },
      { id: 'math.NA', en: 'Numerical analysis', vi: 'Giải tích số' },
    ],
    journals: [
      { issn: '0003-486X', name: 'Annals of Mathematics' },
      { issn: '0894-0347', name: 'Journal of the AMS' },
      { issn: '0036-1399', name: 'SIAM Journal on Applied Mathematics' },
      { issn: '0020-9910', name: 'Inventiones mathematicae' },
      { issn: '0001-5962', name: 'Acta Mathematica' },
      { issn: '0012-7094', name: 'Duke Mathematical Journal' },
      { issn: '0022-040X', name: 'Journal of Differential Geometry' },
    ],
  },
  {
    id: 'physics', code: '02 / PHYSICS',
    en: { title: 'Physics', subtitle: 'Matter, energy & the universe', description: 'Explore quantum systems, condensed matter, cosmology and experiments.' },
    vi: { title: 'Vật lý', subtitle: 'Vật chất, năng lượng & vũ trụ', description: 'Khám phá lượng tử, vật chất ngưng tụ, vũ trụ học và thực nghiệm.' },
    categories: [
      { id: 'quant-ph', en: 'Quantum physics', vi: 'Vật lý lượng tử' },
      { id: 'cond-mat.mtrl-sci', en: 'Materials science', vi: 'Khoa học vật liệu' },
      { id: 'astro-ph.HE', en: 'High-energy astrophysics', vi: 'Thiên văn năng lượng cao' },
      { id: 'hep-th', en: 'High-energy theory', vi: 'Lý thuyết năng lượng cao' },
      { id: 'gr-qc', en: 'Relativity & cosmology', vi: 'Tương đối & vũ trụ học' },
      { id: 'physics.comp-ph', en: 'Computational physics', vi: 'Vật lý tính toán' },
    ],
    journals: [
      { issn: '0031-9007', name: 'Physical Review Letters' },
      { issn: '1745-2473', name: 'Nature Physics' },
      { issn: '2160-3308', name: 'Physical Review X' },
      { issn: '0034-6861', name: 'Reviews of Modern Physics' },
      { issn: '2470-0010', name: 'Physical Review D' },
      { issn: '0004-637X', name: 'The Astrophysical Journal' },
      { issn: '1126-6708', name: 'Journal of High Energy Physics' },
    ],
  },
  {
    id: 'chemistry', code: '03 / CHEMISTRY',
    en: { title: 'Chemistry', subtitle: 'Molecules, reactions & materials', description: 'Browse chemical physics, materials and leading chemistry journals.' },
    vi: { title: 'Hóa học', subtitle: 'Phân tử, phản ứng & vật liệu', description: 'Tìm hóa lý, vật liệu và bài báo từ các tạp chí hóa học tiêu biểu.' },
    categories: [
      { id: 'physics.chem-ph', en: 'Chemical physics', vi: 'Hóa lý' },
      { id: 'physics.atm-clus', en: 'Atoms & molecules', vi: 'Nguyên tử & phân tử' },
      { id: 'cond-mat.mtrl-sci', en: 'Materials science', vi: 'Khoa học vật liệu' },
      { id: 'cond-mat.soft', en: 'Soft matter & polymers', vi: 'Vật chất mềm & polymer' },
    ],
    journals: [
      { issn: '0002-7863', name: 'Journal of the American Chemical Society' },
      { issn: '1755-4330', name: 'Nature Chemistry' },
      { issn: '1433-7851', name: 'Angewandte Chemie International Edition' },
      { issn: '0009-2665', name: 'Chemical Reviews' },
      { issn: '2155-5435', name: 'ACS Catalysis' },
      { issn: '2041-6520', name: 'Chemical Science' },
      { issn: '1523-7060', name: 'Organic Letters' },
    ],
  },
  {
    id: 'biology', code: '04 / BIOLOGY',
    en: { title: 'Biology', subtitle: 'Life from molecules to ecosystems', description: 'Study biomolecules, genomics, cells, evolution and quantitative biology.' },
    vi: { title: 'Sinh học', subtitle: 'Sự sống từ phân tử đến hệ sinh thái', description: 'Nghiên cứu phân tử, gene, tế bào, tiến hóa và sinh học định lượng.' },
    categories: [
      { id: 'q-bio.BM', en: 'Biomolecules', vi: 'Phân tử sinh học' },
      { id: 'q-bio.CB', en: 'Cell behavior', vi: 'Tế bào' },
      { id: 'q-bio.GN', en: 'Genomics', vi: 'Hệ gene' },
      { id: 'q-bio.NC', en: 'Neurons & cognition', vi: 'Thần kinh & nhận thức' },
      { id: 'q-bio.PE', en: 'Evolution & populations', vi: 'Tiến hóa & quần thể' },
      { id: 'q-bio.QM', en: 'Quantitative methods', vi: 'Phương pháp định lượng' },
    ],
    journals: [
      { issn: '1061-4036', name: 'Nature Genetics' },
      { issn: '0261-4189', name: 'The EMBO Journal' },
      { issn: '1544-9173', name: 'PLOS Biology' },
      { issn: '0092-8674', name: 'Cell' },
      { issn: '1097-2765', name: 'Molecular Cell' },
      { issn: '1474-760X', name: 'Genome Biology' },
      { issn: '2050-084X', name: 'eLife' },
    ],
  },
  {
    id: 'artificial-intelligence', code: '05 / AI',
    en: { title: 'Artificial Intelligence', subtitle: 'Models, agents & evaluation', description: 'Trace AI methods across preprints and research journals.' },
    vi: { title: 'Trí tuệ nhân tạo', subtitle: 'Mô hình, tác tử & đánh giá', description: 'Theo dõi phương pháp AI qua bản thảo và tạp chí nghiên cứu.' },
    categories: [
      { id: 'cs.AI', en: 'Artificial intelligence', vi: 'Trí tuệ nhân tạo' },
      { id: 'cs.LG', en: 'Machine learning', vi: 'Học máy' },
      { id: 'stat.ML', en: 'Statistical ML', vi: 'Học máy thống kê' },
      { id: 'cs.CL', en: 'NLP & language', vi: 'Ngôn ngữ & NLP' },
      { id: 'cs.CV', en: 'Computer vision', vi: 'Thị giác máy tính' },
      { id: 'cs.RO', en: 'Robotics', vi: 'Robot' },
      { id: 'cs.MA', en: 'Multi-agent systems', vi: 'Hệ đa tác tử' },
      { id: 'cs.NE', en: 'Neural computing', vi: 'Tính toán thần kinh' },
      { id: 'cs.IR', en: 'Information retrieval', vi: 'Truy xuất thông tin' },
      { id: 'cs.HC', en: 'Human–AI interaction', vi: 'Tương tác người–AI' },
      { id: 'cs.CY', en: 'AI & society', vi: 'AI & xã hội' },
    ],
    journals: [
      { issn: '2522-5839', name: 'Nature Machine Intelligence' },
      { issn: '1532-4435', name: 'Journal of Machine Learning Research' },
      { issn: '0162-8828', name: 'IEEE TPAMI' },
      { issn: '0004-3702', name: 'Artificial Intelligence' },
      { issn: '0885-6125', name: 'Machine Learning' },
      { issn: '0893-6080', name: 'Neural Networks' },
      { issn: '0031-3203', name: 'Pattern Recognition' },
    ],
  },
];

export function getScholarlyField(id: ScholarlyFieldId): ScholarlyField {
  return scholarlyFields.find((field) => field.id === id) || scholarlyFields[4];
}
