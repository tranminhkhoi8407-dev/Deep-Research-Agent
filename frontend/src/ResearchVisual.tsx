import { useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { componentEvidence, numericValue, orderedRows, type ReportVisual, type VisualSelection } from './researchVisualModel';
export type { ReportVisual } from './researchVisualModel';

function MathText({ value, display = false }: { value: string; display?: boolean }) {
  return <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, throwOnError: false, maxExpand: 100, maxSize: 20 }]]} components={{ p: ({ children }) => <span>{children}</span> }}>{display ? `$$\n${value}\n$$` : `$${value}$`}</ReactMarkdown>;
}
export function ResearchVisual({ visual, vi, onEvidence }: { visual: ReportVisual; vi: boolean; onEvidence: (selection: VisualSelection) => void }) {
  const detailId = useId();
  const markerId = useId().replace(/:/g, '');
  const [step, setStep] = useState(0), [symbol, setSymbol] = useState(0);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [order, setOrder] = useState<'source' | 'descending'>('source');
  const nodes = visual.nodes || [], edges = visual.edges || [], rows = visual.rows || [], symbols = visual.symbols || [];
  const node = nodes[step] || nodes[0], chosenSymbol = symbols[symbol] || symbols[0];
  const chartRows = orderedRows(rows, order);
  const max = Math.max(1, ...rows.map(row => numericValue(row.cells[1]) ?? 0));
  const sourceButton = (title: string, text: string, own?: ReportVisual['evidence']) => <button type="button" className="research-visual__source" onClick={() => onEvidence(componentEvidence(visual, title, text, own))}>{own?.length ? (vi ? 'Dẫn chứng riêng' : 'Component evidence') : (vi ? 'Nguồn chung của hình' : 'Figure-level evidence')} ↗</button>;
  const connection = (edge: NonNullable<ReportVisual['edges']>[number], index: number) => {
    const text = `${nodes.find(item => item.id === edge.source)?.label} → ${nodes.find(item => item.id === edge.target)?.label}: ${edge.label}`;
    return <li key={index}><span>{text}</span>{sourceButton(edge.label || (vi ? 'Quan hệ' : 'Connection'), text, edge.evidence)}</li>;
  };
  const table = <><small className="research-visual__table-hint">{vi ? 'Bảng rộng có thể cuộn ngang; bấm “Giải thích & nguồn” để xem từng dòng.' : 'Wide tables scroll horizontally; select “Explain & source” to inspect a row.'}</small><div className="research-evidence__table" tabIndex={0} role="region" aria-label={`${visual.title} · ${vi ? 'Bảng dữ liệu cuộn ngang' : 'Scrollable data table'}`}><table><caption className="sr-only">{visual.title}</caption><thead><tr>{visual.columns?.map((cell, index) => <th key={index} scope="col">{cell}</th>)}<th scope="col">{vi ? 'Chi tiết' : 'Details'}</th></tr></thead><tbody>{chartRows.map(({ row, sourceIndex }) => <tr key={sourceIndex} data-selected={sourceIndex === selectedRow}>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}<td><button type="button" aria-expanded={sourceIndex === selectedRow} aria-controls={detailId} onClick={() => setSelectedRow(sourceIndex === selectedRow ? null : sourceIndex)}>{vi ? 'Giải thích & nguồn' : 'Explain & source'}</button></td></tr>)}</tbody></table></div></>;
  return <figure className="research-visual" data-kind={visual.kind}>
    <figcaption><span className="research-visual__eyebrow">{vi ? 'KHÁM PHÁ TRỰC QUAN' : 'VISUAL EXPLORER'} · {visual.kind}</span><h3>{visual.title}</h3><p>{visual.caption}</p><small>{vi ? 'Hình dựng lại từ bằng chứng, không phải hình gốc của paper. Tương tác không gọi AI.' : 'Reconstructed from evidence, not an original paper figure. Interactions do not call AI.'}</small></figcaption>
    {!!visual.omitted_numeric_annotations?.length && <p className="research-evidence__muted">{vi ? 'Đã bỏ chú thích số chưa có dẫn chứng khỏi nhãn sơ đồ.' : 'Uncited numeric decorations were omitted from node labels.'}</p>}
    {visual.kind === 'flow' && node && <>
      <p className="research-visual__hint">{vi ? 'Chọn một bước để xem cách hoạt động. Số thứ tự là thứ tự đọc; chỉ các quan hệ bên dưới biểu diễn luồng thực tế.' : 'Select a step to explore it. Numbers show reading order; only the listed connections express actual flow.'}</p>
      <div className="research-visual__explorer">
        <div className="research-visual__graph"><ol className="research-visual__steps" aria-label={vi ? 'Các bước của phương pháp' : 'Method steps'}>{nodes.map((item, index) => <li key={item.id}><button type="button" aria-pressed={step === index} aria-controls={detailId} onClick={() => setStep(index)}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><strong>{item.label}</strong></button></li>)}</ol><svg className="research-visual__arrows" width="64" height={nodes.length * 112} viewBox={`0 0 64 ${nodes.length * 112}`} aria-hidden="true"><defs><marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" /></marker></defs>{edges.map((edge, index) => { const from = nodes.findIndex(item => item.id === edge.source), to = nodes.findIndex(item => item.id === edge.target); if (from < 0 || to < 0) return null; const x = 16 + index % 3 * 14, y1 = from * 112 + 56, y2 = to * 112 + 56; return <g key={index}><path d={`M2 ${y1} H${x} V${y2} H2`} markerEnd={`url(#${markerId})`} data-active={edge.source === node.id || edge.target === node.id} /><text x={x + 3} y={(y1 + y2) / 2}>{index + 1}</text></g>; })}</svg></div>
        <div className="research-visual__detail" id={detailId} role="region" aria-label={vi ? 'Giải thích bước đã chọn' : 'Selected step explanation'}>
          <div className="research-visual__stepper"><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} aria-label={vi ? 'Bước trước' : 'Previous step'}>←</button><span>{step + 1} / {nodes.length}</span><button type="button" disabled={step >= nodes.length - 1} onClick={() => setStep(step + 1)} aria-label={vi ? 'Bước tiếp theo' : 'Next step'}>→</button></div>
          <h4>{node.label}</h4><p>{node.explanation || (vi ? 'Report cũ chưa lưu phần giải thích riêng cho bước này. Đọc nội dung phương pháp và nguồn chung bên dưới; không tự sinh chi tiết mới.' : 'This report has no saved explanation for this step. Consult the method prose and figure evidence; no new detail is generated.')}</p>
          {(node.inputs || node.outputs) && <dl>{node.inputs && <><dt>{vi ? 'Đầu vào' : 'Input'}</dt><dd>{node.inputs}</dd></>}{node.outputs && <><dt>{vi ? 'Đầu ra' : 'Output'}</dt><dd>{node.outputs}</dd></>}</dl>}
          {sourceButton(node.label, [node.explanation, node.inputs, node.outputs].filter(Boolean).join('\n\n') || node.label, node.evidence)}
          <ul className="research-visual__connections">{edges.filter(edge => edge.source === node.id || edge.target === node.id).map(connection)}</ul>
        </div>
      </div>
      <details><summary>{vi ? 'Toàn bộ quan hệ trong sơ đồ' : 'All diagram connections'}</summary><ul className="research-visual__connections">{edges.map(connection)}</ul></details>
    </>}
    {visual.kind === 'bar' && <>
      <dl className="research-visual__context">{visual.dataset && <><dt>{vi ? 'Tập dữ liệu' : 'Dataset'}</dt><dd>{visual.dataset}</dd></>}{visual.metric && <><dt>{vi ? 'Phép đo' : 'Metric'}</dt><dd>{visual.metric}</dd></>}<dt>{vi ? 'Đơn vị' : 'Unit'}</dt><dd>{visual.unit || '—'}</dd></dl>
      <div className="research-visual__toolbar"><div role="group" aria-label={vi ? 'Cách hiển thị số liệu' : 'Data display'}><button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>{vi ? 'Biểu đồ' : 'Chart'}</button><button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>{vi ? 'Bảng số liệu' : 'Data table'}</button></div><label>{vi ? 'Sắp xếp' : 'Order'}<select value={order} onChange={event => setOrder(event.target.value as typeof order)}><option value="source">{vi ? 'Theo nguồn' : 'Source order'}</option><option value="descending">{vi ? 'Giá trị giảm dần' : 'Value descending'}</option></select></label></div>
      {view === 'table' ? table : <div className="research-visual__bars" role="group" aria-label={visual.title}>{chartRows.map(({ row, sourceIndex }) => { const value = numericValue(row.cells[1]); return <button type="button" key={sourceIndex} aria-expanded={selectedRow === sourceIndex} aria-controls={detailId} onClick={() => setSelectedRow(selectedRow === sourceIndex ? null : sourceIndex)}><span>{row.cells[0]}</span><span className="research-visual__track" aria-hidden="true">{value !== null && <i style={{ width: `${value / max * 100}%` }} />}</span><strong>{value === null ? (vi ? 'Không có dữ liệu hợp lệ' : 'No valid data') : `${row.cells[1]} ${visual.unit || ''}`}</strong></button>; })}<small>{vi ? 'Trục bắt đầu từ 0. Bấm một cột để xem giải thích và dẫn chứng; ô thiếu không được vẽ thành 0.' : 'Axis starts at zero. Select a bar for explanation and evidence; missing cells are never plotted as zero.'}</small></div>}
    </>}
    {visual.kind === 'table' && table}
    {(visual.kind === 'bar' || visual.kind === 'table') && selectedRow !== null && rows[selectedRow] && <div id={detailId} className="research-visual__detail" role="region" aria-label={vi ? 'Chi tiết dòng dữ liệu' : 'Data row details'}><h4>{rows[selectedRow].cells[0]}</h4><p>{rows[selectedRow].cells.join(' · ')} {visual.kind === 'bar' && visual.unit}</p><p>{rows[selectedRow].explanation || (vi ? 'Report này chưa có diễn giải riêng cho dòng dữ liệu. Xem trích đoạn và điều kiện đo; không suy ra ưu thế chỉ từ thứ hạng.' : 'No row-level interpretation was saved. Inspect the excerpt and measurement conditions; rank alone does not establish superiority.')}</p>{sourceButton(rows[selectedRow].cells[0], [rows[selectedRow].cells.join(' | '), rows[selectedRow].explanation, visual.conditions].filter(Boolean).join('\n\n'), rows[selectedRow].evidence)}</div>}
    {visual.kind === 'equation' && <>
      <div className="research-visual__equation"><MathText value={visual.equation || ''} display /></div><p>{visual.explanation}</p>
      <div className="research-visual__symbols" role="group" aria-label={vi ? 'Chọn ký hiệu để giải thích' : 'Select a symbol'}>{symbols.map((item, index) => <button type="button" key={index} aria-label={item.symbol} aria-pressed={symbol === index} aria-controls={detailId} onClick={() => setSymbol(index)}><MathText value={item.symbol} /></button>)}</div>
      {chosenSymbol && <div className="research-visual__detail" id={detailId} role="region" aria-label={vi ? 'Giải thích ký hiệu' : 'Symbol explanation'}><MathText value={chosenSymbol.symbol} /><p>{chosenSymbol.meaning}</p>{sourceButton(chosenSymbol.symbol, chosenSymbol.meaning, chosenSymbol.evidence)}</div>}
      <small>{vi ? 'Giải thích công thức có nguồn, không phải mô phỏng hay phép chứng minh đã kiểm tra.' : 'Explanation of a sourced formula, not a simulation or a certified proof.'}</small>
    </>}
    {visual.conditions && <p className="research-visual__conditions"><strong>{vi ? 'Điều kiện / phạm vi: ' : 'Conditions / scope: '}</strong>{visual.conditions}</p>}
    <footer><button type="button" className="research-visual__source" onClick={() => onEvidence({ title: visual.title, text: visual.caption, evidence: visual.evidence, verification: visual.verification, aggregate: false })}>{vi ? 'Xem nguồn của hình' : 'Figure evidence'} ↗</button><small>{visual.verification === 'model_checked' ? (vi ? 'Model đã đối chiếu, chưa tái lập độc lập.' : 'Model-checked, not independently reproduced.') : (vi ? 'Chỉ khớp trích đoạn, chưa đối chiếu ngữ nghĩa.' : 'Quote-matched, not semantically checked.')}</small></footer>
  </figure>;
}
