import { useId } from 'react';

export interface ReportVisual {
  kind: 'flow' | 'table' | 'bar'; title: string; caption: string; section_key: string;
  evidence: { chunk_id: string; quote: string }[];
  nodes?: { id: string; label: string }[];
  edges?: { source: string; target: string; label: string }[];
  columns?: string[]; rows?: { cells: string[] }[]; unit?: string; conditions?: string;
  verification: string;
  omitted_numeric_annotations?: string[];
}

export function ResearchVisual({ visual, vi, onEvidence }: { visual: ReportVisual; vi: boolean; onEvidence: () => void }) {
  const markerId = useId().replace(/:/g, '');
  const nodes = visual.nodes || [], edges = visual.edges || [], rows = visual.rows || [];
  const values = rows.map(row => Number(row.cells[1]?.replace(',', '.')));
  const max = Math.max(1, ...values.filter(Number.isFinite));
  return <figure className="research-visual">
    <figcaption><h3>{visual.title}</h3><p>{visual.caption}</p><small>{vi ? 'Hình tái dựng bởi agent từ bằng chứng; không phải hình gốc của paper.' : 'Agent reconstruction from evidence; not an original paper figure.'}</small></figcaption>
    {!!visual.omitted_numeric_annotations?.length && <small>{vi ? 'Đã bỏ chú thích số chưa được dẫn chứng khỏi nhãn sơ đồ; chỉ giữ quan hệ đã đối chiếu.' : 'Uncited numeric decorations were omitted from node labels; only checked relationships are shown.'}</small>}
    {visual.kind === 'flow' && <div className="research-visual__flow">
      <svg viewBox={'0 0 680 ' + (nodes.length * 106 + 30)} role="img" aria-label={visual.title}>
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor" /></marker></defs>
        {nodes.map((node, index) => <g key={node.id}><rect x="25" y={index * 106 + 10} width="540" height="76" rx="10" /><foreignObject x="38" y={index * 106 + 15} width="514" height="67"><div className="research-visual__node">{node.label}</div></foreignObject></g>)}
        {edges.map((edge, index) => {
          const from = nodes.findIndex(node => node.id === edge.source), to = nodes.findIndex(node => node.id === edge.target);
          if (from < 0 || to < 0) return null;
          const offset = 580 + (index % 6) * 14, y1 = from * 106 + 48, y2 = to * 106 + 48;
          return <g key={index}><path d={'M565 ' + y1 + ' H' + offset + ' V' + y2 + ' H568'} markerEnd={'url(#' + markerId + ')'} /><text x={offset + 3} y={(y1 + y2) / 2}>{index + 1}</text></g>;
        })}
      </svg>
      <ol>{edges.map((edge, index) => <li key={index}>{nodes.find(node => node.id === edge.source)?.label} → {nodes.find(node => node.id === edge.target)?.label}{edge.label ? ': ' + edge.label : ''}</li>)}</ol>
    </div>}
    {visual.kind === 'table' && <div className="research-evidence__table"><table><thead><tr>{visual.columns?.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>}
    {visual.kind === 'bar' && <div className="research-visual__bars">{rows.map((row, index) => <div key={index}><span>{row.cells[0]}</span><div className="research-visual__track"><i style={{ width: (Number.isFinite(values[index]) ? Math.max(0, values[index]) / max * 100 : 0) + '%' }} /></div><strong>{row.cells[1]} {visual.unit}</strong></div>)}</div>}
    {visual.conditions && <p>{vi ? 'Điều kiện / phạm vi: ' : 'Conditions / scope: '}{visual.conditions}</p>}
    <button type="button" onClick={onEvidence}>{vi ? 'Xem nguồn và vị trí dẫn chứng' : 'Inspect source locations'} · {visual.verification === 'model_checked' ? (vi ? 'đã đối chiếu bằng model' : 'model checked') : (vi ? 'chưa kiểm tra ngữ nghĩa' : 'not semantically checked')}</button>
  </figure>;
}
