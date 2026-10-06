import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, BookmarkPlus, Check, ExternalLink, FileText, FolderPlus, LibraryBig, LoaderCircle, NotebookPen, Search, Sparkles, Star, Trash2 } from 'lucide-react';
import type { Language } from './ProductViews';
import { getScholarlyField, type ScholarlyFieldId } from './ScholarlyCatalog';

type Source = 'arxiv' | 'journal';
type Status = 'to_read' | 'reading' | 'read' | 'archived';
type Mode = 'discover' | 'saved' | 'collections';

interface Paper {
  id: string;
  field: ScholarlyFieldId;
  source: 'arxiv' | 'crossref';
  arxiv_id: string;
  title: string;
  abstract: string;
  authors: string[];
  published_at: string;
  updated_at: string;
  primary_category: string;
  categories: string[];
  doi: string;
  journal: string;
  url: string;
  pdf_url: string;
  license: string;
  venue_type: string;
}

interface SavedPaper extends Paper {
  status: Status;
  starred: boolean;
  note: string;
  saved_at: string;
  collection_ids: string[];
  fields: ScholarlyFieldId[];
}

interface Collection { id: string; name: string; field: ScholarlyFieldId; paper_count: number; created_at: string }

const copy = {
  en: {
    sub: 'Discover research, build collections, and keep reading notes in one place.',
    discover: 'Discover', saved: 'My papers', collections: 'Collections', source: 'Source', arxiv: 'arXiv preprints', journal: 'Field journals',
    category: 'Research area', allCategories: 'All topics', journals: 'Field journals', allJournals: 'All selected journals', search: 'Search title, topic, or author…', searchJournal: 'Search within these journals…', go: 'Search',
    latest: 'Latest papers', results: 'results', loading: 'Loading papers…', retry: 'Try again', emptySearch: 'No papers matched. Try another term or category.',
    save: 'Save paper', savedAction: 'Saved', openSource: 'Open original', openPdf: 'Read PDF', doi: 'Open DOI',
    readStatus: 'Reading status', to_read: 'To read', reading: 'Reading', read: 'Read', archived: 'Archived',
    note: 'Research notes', noteHint: 'Record the contribution, method, limitations, or questions to revisit. LaTeX notation can be kept here too.', saveNote: 'Save note', noteSaved: 'Note saved',
    citation: 'Copy BibTeX', research: 'Research this paper', collection: 'Collections', create: 'Create collection', collectionName: 'Collection name',
    allSaved: 'All saved', starred: 'Starred', anyStatus: 'Any reading status', noSaved: 'No papers saved yet. Discover a paper and add it to your library.',
    noCollection: 'No collections yet. Create one to organize your reading.', noCollectionPapers: 'This collection is empty. Add a saved paper from its detail view.',
    remove: 'Remove from library', removeCollection: 'Delete collection', confirmRemove: 'Remove this paper and its collection links?', confirmCollection: 'Delete this collection? Saved papers will remain in your library.',
    select: 'Select a paper to inspect its abstract and notes.', providerIssue: 'The scholarly source is unavailable right now.', backendOutdated: 'The backend has not loaded the paper library API yet. Restart the backend and retry.', all: 'All',
    copyright: 'Metadata is for discovery. Full text may require publisher access; no PDF is stored here. Interdisciplinary papers can appear in a field journal; a listing is not an endorsement of every article.',
    venue: 'Publication', preprint: 'Preprint', journalType: 'Journal article', previous: 'Previous', next: 'Next', citationCopied: 'BibTeX copied', copyFailed: 'Could not copy BibTeX. Check clipboard permission.',
  },
  vi: {
    sub: 'Khám phá nghiên cứu, tạo bộ sưu tập và ghi chú đọc paper ở một nơi.',
    discover: 'Khám phá', saved: 'Paper của tôi', collections: 'Bộ sưu tập', source: 'Nguồn', arxiv: 'Bản thảo arXiv', journal: 'Tạp chí theo lĩnh vực',
    category: 'Chủ đề nghiên cứu', allCategories: 'Tất cả chủ đề', journals: 'Tạp chí theo lĩnh vực', allJournals: 'Tất cả tạp chí đã chọn', search: 'Tìm tiêu đề, chủ đề hoặc tác giả…', searchJournal: 'Tìm trong các tạp chí này…', go: 'Tìm kiếm',
    latest: 'Paper mới nhất', results: 'kết quả', loading: 'Đang tải paper…', retry: 'Thử lại', emptySearch: 'Chưa thấy paper phù hợp. Hãy đổi từ khóa hoặc lĩnh vực.',
    save: 'Lưu paper', savedAction: 'Đã lưu', openSource: 'Mở bài gốc', openPdf: 'Đọc PDF', doi: 'Mở DOI',
    readStatus: 'Tiến độ đọc', to_read: 'Muốn đọc', reading: 'Đang đọc', read: 'Đã đọc', archived: 'Lưu trữ',
    note: 'Ghi chú nghiên cứu', noteHint: 'Ghi đóng góp, phương pháp, hạn chế, câu hỏi cần tìm hiểu. Bạn cũng có thể lưu ký hiệu LaTeX ở đây.', saveNote: 'Lưu ghi chú', noteSaved: 'Đã lưu ghi chú',
    citation: 'Sao chép BibTeX', research: 'Nghiên cứu paper này', collection: 'Bộ sưu tập', create: 'Tạo bộ sưu tập', collectionName: 'Tên bộ sưu tập',
    allSaved: 'Tất cả paper', starred: 'Đánh dấu sao', anyStatus: 'Mọi trạng thái đọc', noSaved: 'Chưa lưu paper nào. Hãy khám phá và thêm paper vào thư viện.',
    noCollection: 'Chưa có bộ sưu tập. Tạo một bộ để sắp xếp paper cần đọc.', noCollectionPapers: 'Bộ sưu tập còn trống. Thêm paper đã lưu từ phần chi tiết.',
    remove: 'Bỏ khỏi thư viện', removeCollection: 'Xóa bộ sưu tập', confirmRemove: 'Bỏ paper này và liên kết với các bộ sưu tập?', confirmCollection: 'Xóa bộ sưu tập này? Paper đã lưu vẫn còn trong thư viện.',
    select: 'Chọn một paper để xem abstract và ghi chú.', providerIssue: 'Nguồn học thuật đang tạm thời không phản hồi.', backendOutdated: 'Backend chưa nạp API thư viện paper. Hãy khởi động lại backend rồi thử lại.', all: 'Tất cả',
    copyright: 'Metadata dùng để khám phá. Toàn văn có thể cần quyền truy cập từ nhà xuất bản; trang này không lưu PDF. Bài liên ngành vẫn có thể xuất hiện trong tạp chí của lĩnh vực; danh sách không bảo đảm chất lượng từng bài.',
    venue: 'Nơi công bố', preprint: 'Bản thảo', journalType: 'Tạp chí', previous: 'Trước', next: 'Tiếp', citationCopied: 'Đã sao chép BibTeX', copyFailed: 'Không thể sao chép BibTeX. Hãy kiểm tra quyền clipboard.',
  },
} as const;

function paperDate(value: string, language: Language): string {
  if (!value) return '—';
  if (/^\d{4}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) {
    const month = new Date(`${value}-01T00:00:00Z`);
    return Number.isNaN(month.getTime()) ? value : new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(month);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function bibtex(paper: Paper): string {
  const first = paper.authors[0]?.split(' ').pop()?.replace(/\W/g, '') || 'Paper';
  const year = paper.published_at.slice(0, 4) || 'n.d.';
  const key = `${first}${year}${paper.id.replace(/\W/g, '').slice(-8)}`;
  return `@article{${key},\n  title={${paper.title}},\n  author={${paper.authors.join(' and ')}},\n  year={${year}},\n  ${paper.journal ? `journal={${paper.journal}},\n  ` : ''}${paper.doi ? `doi={${paper.doi}},\n  ` : ''}url={${paper.url}}\n}`;
}

export function PaperLibrary({ language, apiBase, fieldId, onStartResearch }: { language: Language; apiBase: string; fieldId: ScholarlyFieldId; onStartResearch: (topic: string, paper: { input: string; field: string }) => void }) {
  const t = copy[language];
  const field = getScholarlyField(fieldId);
  const fieldText = field[language];
  const [mode, setMode] = useState<Mode>('discover');
  const [source, setSource] = useState<Source>('arxiv');
  const [category, setCategory] = useState('');
  const [journal, setJournal] = useState('');
  const [showAllJournals, setShowAllJournals] = useState(false);
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [searchNonce, setSearchNonce] = useState(0);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [saved, setSaved] = useState<SavedPaper[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [savedFilter, setSavedFilter] = useState<'all' | 'starred'>('all');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [savedQuery, setSavedQuery] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}/api/papers${path}`, { credentials: 'include', ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
    if (!response.ok) {
      if (response.status === 404 && (path.startsWith('/search') || (path.startsWith('/library?') && !init?.method))) throw new Error(t.backendOutdated);
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.detail === 'string' ? body.detail : t.providerIssue);
    }
    return response.json() as Promise<T>;
  };

  const refreshLibrary = async () => {
    const [paperResponse, collectionResponse] = await Promise.all([
      api<{ papers: SavedPaper[] }>(`/library?field=${fieldId}`), api<{ collections: Collection[] }>(`/collections?field=${fieldId}`),
    ]);
    setSaved(paperResponse.papers);
    setCollections(collectionResponse.collections);
  };

  useEffect(() => { void refreshLibrary().catch((reason: Error) => setError(reason.message)); }, []); // account changes remount the workspace

  useEffect(() => {
    const controller = new AbortController();
    setSearchBusy(true);
    setError('');
    setPapers([]);
    setTotal(0);
    setSelectedId(null);
    const params = new URLSearchParams({ source, field: fieldId, q: query, category: source === 'arxiv' ? category : '', journal: source === 'journal' ? journal : '', page: String(page) });
    api<{ papers: Paper[]; total: number }>(`/search?${params}`, { signal: controller.signal })
      .then((data) => { setPapers(data.papers); setTotal(data.total); setSelectedId((current) => current && data.papers.some((paper) => paper.id === current) ? current : data.papers[0]?.id || null); })
      .catch((reason: Error) => { if (!controller.signal.aborted) { setError(reason.message); setPapers([]); setTotal(0); } })
      .finally(() => { if (!controller.signal.aborted) setSearchBusy(false); });
    return () => controller.abort();
  }, [source, category, journal, fieldId, query, page, searchNonce]);

  const filteredSaved = useMemo(() => saved.filter((paper) => {
    const matchingCollection = mode !== 'collections' || !activeCollection || paper.collection_ids.includes(activeCollection);
    const matchingStar = mode !== 'saved' || savedFilter !== 'starred' || paper.starred;
    const matchingStatus = mode !== 'saved' || statusFilter === 'all' || paper.status === statusFilter;
    const matchingQuery = mode !== 'saved' || `${paper.title} ${paper.authors.join(' ')} ${paper.abstract} ${paper.journal} ${paper.doi} ${paper.note}`.toLowerCase().includes(savedQuery.toLowerCase());
    return matchingCollection && matchingStar && matchingStatus && matchingQuery;
  }), [saved, mode, activeCollection, savedFilter, statusFilter, savedQuery]);
  const visiblePapers = mode === 'discover' ? papers : filteredSaved;
  const selectedPaper = visiblePapers.find((paper) => paper.id === selectedId) || visiblePapers[0] || null;
  const savedPaper = selectedPaper ? saved.find((paper) => paper.id === selectedPaper.id) : null;

  useEffect(() => { setNoteDraft(savedPaper?.note || ''); }, [selectedPaper?.id, savedPaper?.note]);

  const act = async (operation: () => Promise<void>, success?: string) => {
    setBusy(true); setError('');
    try { await operation(); if (success) { setNotice(success); window.setTimeout(() => setNotice(''), 2500); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : t.providerIssue); }
    finally { setBusy(false); }
  };

  const savePaper = (paper: Paper) => act(async () => {
    const result = await api<{ paper: SavedPaper }>('/library', { method: 'POST', body: JSON.stringify({ paper }) });
    setSaved((current) => [result.paper, ...current.filter((item) => item.id !== paper.id)]);
  }, t.savedAction);

  const updatePaper = (id: string, change: Partial<Pick<SavedPaper, 'status' | 'starred' | 'note'>>, success?: string) => act(async () => {
    const result = await api<{ paper: SavedPaper }>(`/library/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(change) });
    setSaved((current) => current.map((paper) => paper.id === id ? result.paper : paper));
  }, success);

  const removePaper = (id: string) => {
    if (!window.confirm(t.confirmRemove)) return;
    void act(async () => { await api(`/library/${encodeURIComponent(id)}`, { method: 'DELETE' }); await refreshLibrary(); });
  };

  const submitSearch = (event: FormEvent) => { event.preventDefault(); setPage(1); setQuery(draftQuery.trim()); setSearchNonce((value) => value + 1); };
  const createCollection = (event: FormEvent) => { event.preventDefault(); if (!collectionName.trim()) return; void act(async () => { const result = await api<{ collection: Collection }>('/collections', { method: 'POST', body: JSON.stringify({ name: collectionName, field: fieldId }) }); setCollections((items) => [result.collection, ...items]); setActiveCollection(result.collection.id); setCollectionName(''); }); };
  const toggleCollection = (collectionId: string, paperId: string, included: boolean) => act(async () => {
    await api(`/collections/${collectionId}/papers${included ? `/${encodeURIComponent(paperId)}` : ''}`, included ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ paper_id: paperId }) });
    await refreshLibrary();
  });
  const removeCollection = (collectionId: string) => { if (!window.confirm(t.confirmCollection)) return; void act(async () => { await api(`/collections/${collectionId}`, { method: 'DELETE' }); setActiveCollection(null); await refreshLibrary(); }); };
  const beginResearch = (paper: Paper) => onStartResearch((language === 'vi' ? 'Phân tích và giải thích bài báo bằng tiếng Việt: ' : 'Analyze and explain this paper in English: ') + paper.title, { input: paper.pdf_url || paper.url, field: fieldId });
  const copyCitation = async (paper: Paper) => {
    try { await navigator.clipboard.writeText(bibtex(paper)); setNotice(t.citationCopied); }
    catch { setError(t.copyFailed); }
  };

  return <div className="paper-library">
    <header className="paper-library__hero" data-tour="paper-hero">
      <div><span className="eyebrow">ACADEMIC DISCOVERY · {fieldText.title.toUpperCase()}</span><h2>{fieldText.title} {language === 'vi' ? '· Thư viện' : 'library'}</h2><p>{fieldText.description} {t.sub}</p></div>
      <div className="paper-library__stats"><span><strong>{saved.length}</strong>{t.saved}</span><span><strong>{collections.length}</strong>{t.collections}</span></div>
    </header>

    <div className="paper-library__tabs" role="tablist" aria-label={fieldText.title}>
      {([['discover', Search, t.discover], ['saved', LibraryBig, t.saved], ['collections', BookOpen, t.collections]] as const).map(([id, Icon, label]) => <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? 'is-active' : ''} onClick={() => { setMode(id); setSelectedId(null); }}><Icon size={18} />{label}{id === 'saved' && <small>{saved.length}</small>}</button>)}
    </div>

    {mode === 'discover' && <form className="paper-library__search" data-tour="paper-search" onSubmit={submitSearch}>
      <label><span>{t.source}</span><select value={source} onChange={(event) => { setSource(event.target.value as Source); setCategory(''); setJournal(''); setDraftQuery(''); setQuery(''); setPage(1); setSelectedId(null); }}><option value="arxiv">{t.arxiv}</option><option value="journal">{t.journal}</option></select></label>
      {source === 'arxiv' ? <label><span>{t.category}</span><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">{t.allCategories}</option>{field.categories.map((item) => <option key={item.id} value={item.id}>{item[language]} · {item.id}</option>)}</select></label> : <label><span>{t.journals}</span><select value={journal} onChange={(event) => { setJournal(event.target.value); setPage(1); }}><option value="">{t.allJournals}</option>{field.journals.map((item) => <option key={item.issn} value={item.issn}>{item.name}</option>)}</select></label>}
      <label className="paper-library__query"><span>{t.go}</span><div><Search size={18} /><input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder={source === 'arxiv' ? t.search : t.searchJournal} maxLength={120} /></div></label>
      <button className="button button--primary" type="submit"><Search size={17} />{t.go}</button>
    </form>}

    {mode === 'discover' && <div className="paper-library__journal-shortcuts"><div><strong>{t.journals} · {field.journals.length}</strong><span>{language === 'vi' ? 'Kết quả tạp chí luôn giới hạn trong danh sách này; chọn một tạp chí hoặc tìm trên cả nhóm.' : 'Journal results are always limited to this field’s list. Select one journal or search across the group.'}</span></div><div>{(showAllJournals ? field.journals : field.journals.slice(0, 3)).map((item) => <button key={item.issn} type="button" className={source === 'journal' && journal === item.issn ? 'is-active' : ''} onClick={() => { setSource('journal'); setJournal(item.issn); setCategory(''); setDraftQuery(''); setQuery(''); setPage(1); setSelectedId(null); }}>{item.name}<ArrowRight size={15} /></button>)}<button className="paper-library__more-journals" type="button" aria-expanded={showAllJournals} onClick={() => setShowAllJournals((value) => !value)}>{showAllJournals ? (language === 'vi' ? 'Thu gọn' : 'Show less') : `+${field.journals.length - 3} ${language === 'vi' ? 'tạp chí khác' : 'more journals'}`}</button></div></div>}

    {mode === 'saved' && <div className="paper-library__saved-tools"><label className="search-control"><Search size={17} /><input value={savedQuery} onChange={(event) => setSavedQuery(event.target.value)} placeholder={t.search} /></label><select aria-label={t.readStatus} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Status | 'all')}><option value="all">{t.anyStatus}</option>{(['to_read', 'reading', 'read', 'archived'] as Status[]).map((value) => <option key={value} value={value}>{t[value]}</option>)}</select><div className="paper-library__mini-tabs"><button type="button" className={savedFilter === 'all' ? 'is-active' : ''} onClick={() => setSavedFilter('all')}>{t.allSaved}</button><button type="button" className={savedFilter === 'starred' ? 'is-active' : ''} onClick={() => setSavedFilter('starred')}><Star size={15} />{t.starred}</button></div></div>}

    {mode === 'collections' && <div className="paper-library__collection-tools">
      <form onSubmit={createCollection}><FolderPlus size={18} /><input value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder={t.collectionName} maxLength={80} /><button type="submit" disabled={busy || !collectionName.trim()}>{t.create}</button></form>
      <div className="paper-library__collection-list"><button type="button" className={!activeCollection ? 'is-active' : ''} onClick={() => setActiveCollection(null)}>{t.allSaved}<small>{saved.length}</small></button>{collections.map((collection) => <div key={collection.id}><button type="button" className={activeCollection === collection.id ? 'is-active' : ''} onClick={() => setActiveCollection(collection.id)}>{collection.name}<small>{collection.paper_count}</small></button><button type="button" className="paper-library__remove-collection" aria-label={`${t.removeCollection}: ${collection.name}`} onClick={() => removeCollection(collection.id)}><Trash2 size={15} /></button></div>)}</div>
      {!collections.length && <p>{t.noCollection}</p>}
    </div>}

    {error && <div className="paper-library__error" role="alert">{error}{mode === 'discover' && <button type="button" onClick={() => setSearchNonce((value) => value + 1)}>{t.retry}</button>}</div>}
    {notice && <div className="paper-library__notice" role="status"><Check size={16} />{notice}</div>}

    <div className="paper-library__body">
      <section className="paper-library__results" data-tour="paper-results" aria-label={t.results}>
        <div className="paper-library__results-heading"><strong>{mode === 'discover' ? (query ? t.results : t.latest) : t.saved}</strong><span>{mode === 'discover' ? total : visiblePapers.length} {t.results}</span></div>
        {searchBusy && mode === 'discover' ? <div className="paper-library__empty"><LoaderCircle className="spin" size={27} /><p>{t.loading}</p></div> : visiblePapers.length ? <div className="paper-library__list">{visiblePapers.map((paper) => <button key={paper.id} type="button" className={selectedPaper?.id === paper.id ? 'is-active' : ''} onClick={() => setSelectedId(paper.id)}><div><span className={`paper-library__source is-${paper.source}`}>{paper.source === 'arxiv' ? 'arXiv' : t.journalType}</span><small>{paperDate(paper.published_at, language)}</small></div><strong>{paper.title}</strong><small>{paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}</small><span className="paper-library__list-foot">{paper.primary_category || paper.journal || paper.doi}{saved.some((item) => item.id === paper.id) && <Check size={14} />}</span></button>)}</div> : <div className="paper-library__empty"><BookOpen size={30} /><p>{mode === 'discover' ? t.emptySearch : mode === 'collections' && activeCollection ? t.noCollectionPapers : t.noSaved}</p></div>}
        {mode === 'discover' && total > 20 && <div className="paper-library__pager"><button type="button" disabled={page === 1 || searchBusy} onClick={() => setPage(page - 1)}><ArrowLeft size={15} />{t.previous}</button><span>{page}</span><button type="button" disabled={page * 20 >= total || searchBusy} onClick={() => setPage(page + 1)}>{t.next}<ArrowRight size={15} /></button></div>}
      </section>

      <section className="paper-library__detail" data-tour="paper-detail" aria-label={selectedPaper?.title || t.select}>
        {!selectedPaper ? <div className="paper-library__detail-empty"><FileText size={34} /><p>{t.select}</p></div> : <>
          <div className="paper-library__detail-top"><div><span className={`paper-library__source is-${selectedPaper.source}`}>{selectedPaper.source === 'arxiv' ? 'arXiv · preprint' : t.journalType}</span>{selectedPaper.primary_category && <span className="paper-library__category">{selectedPaper.primary_category}</span>}</div><button type="button" className={savedPaper?.starred ? 'paper-library__star is-active' : 'paper-library__star'} disabled={!savedPaper || busy} title={t.starred} aria-label={t.starred} onClick={() => savedPaper && void updatePaper(selectedPaper.id, { starred: !savedPaper.starred })}><Star size={19} fill={savedPaper?.starred ? 'currentColor' : 'none'} /></button></div>
          <h3>{selectedPaper.title}</h3>
          <p className="paper-library__authors">{selectedPaper.authors.join(', ')}</p>
          <div className="paper-library__metadata"><span>{paperDate(selectedPaper.published_at, language)}</span>{selectedPaper.journal && <span>{t.venue}: {selectedPaper.journal}</span>}{selectedPaper.doi && <span>DOI: {selectedPaper.doi}</span>}{selectedPaper.arxiv_id && <span>ID: {selectedPaper.arxiv_id}</span>}</div>
          <div className="paper-library__actions"><a className="button button--secondary" href={selectedPaper.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />{t.openSource}</a>{selectedPaper.pdf_url && <a className="button button--secondary" href={selectedPaper.pdf_url} target="_blank" rel="noopener noreferrer"><FileText size={16} />{t.openPdf}</a>}{!savedPaper ? <button type="button" className="button button--primary" disabled={busy} onClick={() => void savePaper(selectedPaper)}><BookmarkPlus size={17} />{t.save}</button> : <span className="paper-library__saved-badge"><Check size={16} />{t.savedAction}</span>}</div>
          {selectedPaper.arxiv_id && <div className="paper-library__actions"><a className="button button--secondary" href={'https://arxivisual.org/abs/' + encodeURIComponent(selectedPaper.arxiv_id)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />arXivisual</a><small>{language === 'vi' ? 'Dịch vụ ngoài, mở tùy chọn; có thể dùng phiên bản khác. Chưa kiểm chứng video, không gửi PDF riêng tư.' : 'Optional external service; may use another version. Video not verified; private PDFs are not sent.'}</small></div>}
          <div className="paper-library__abstract"><h4>Abstract</h4><p>{selectedPaper.abstract || '—'}</p></div>
          <div className="paper-library__utility"><button type="button" onClick={() => void copyCitation(selectedPaper)}><FileText size={16} />{t.citation}</button><button type="button" onClick={() => beginResearch(selectedPaper)}><Sparkles size={17} />{t.research}<ArrowRight size={15} /></button></div>
          {savedPaper && <div className="paper-library__personal"><h4><NotebookPen size={18} />{t.note}</h4><label>{t.readStatus}<select value={savedPaper.status} disabled={busy} onChange={(event) => void updatePaper(selectedPaper.id, { status: event.target.value as Status })}>{(['to_read', 'reading', 'read', 'archived'] as Status[]).map((value) => <option key={value} value={value}>{t[value]}</option>)}</select></label><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder={t.noteHint} maxLength={20000} /><button type="button" className="button button--primary" disabled={busy || noteDraft === savedPaper.note} onClick={() => void updatePaper(selectedPaper.id, { note: noteDraft }, t.noteSaved)}>{t.saveNote}</button><div className="paper-library__attach"><strong>{t.collection}</strong>{collections.length ? <div>{collections.map((collection) => <label key={collection.id}><input type="checkbox" checked={savedPaper.collection_ids.includes(collection.id)} disabled={busy} onChange={() => void toggleCollection(collection.id, selectedPaper.id, savedPaper.collection_ids.includes(collection.id))} />{collection.name}</label>)}</div> : <p>{t.noCollection}</p>}</div><button type="button" className="paper-library__remove-paper" disabled={busy} onClick={() => removePaper(selectedPaper.id)}><Trash2 size={16} />{t.remove}</button></div>}
          <p className="paper-library__attribution">{t.copyright} {selectedPaper.source === 'arxiv' && <a href="https://info.arxiv.org/help/api/index.html" target="_blank" rel="noopener noreferrer">Thank you to arXiv for use of its open access interoperability.</a>}</p>
        </>}
      </section>
    </div>
  </div>;
}
