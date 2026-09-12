// Frontend example: React + TypeScript + WebSocket
// Chạy: npx create-react-app frontend --template typescript
// Sau đó copy file này vào src/App.tsx

import React, { useState, useEffect, useRef } from 'react';

interface Analyst {
  name: string;
  role: string;
  affiliation: string;
  description: string;
}

interface WSMessage {
  event: string;
  [key: string]: any;
}

const App: React.FC = () => {
  const [topic, setTopic] = useState('');
  const [maxAnalysts, setMaxAnalysts] = useState(3);
  const [userId, setUserId] = useState('default');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'feedback_analysts' | 'feedback_sections' | 'completed' | 'error'>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [analysts, setAnalysts] = useState<Analyst[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [finalReport, setFinalReport] = useState('');
  const [feedback, setFeedback] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string>('');

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const connect = () => {
    if (!topic.trim()) {
      alert('Nhập chủ đề nghiên cứu');
      return;
    }

    const ws = new WebSocket('ws://localhost:8000/ws/research');
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('running');
      addLog('🔌 Connected to server');
      // Gửi start_research
      ws.send(JSON.stringify({
        event: 'start_research',
        topic,
        max_analysts: maxAnalysts,
        user_id: userId,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('Parse error:', e);
      }
    };

    ws.onclose = () => {
      addLog('🔌 Disconnected');
      if (status !== 'completed' && status !== 'error') {
        setStatus('idle');
      }
    };

    ws.onerror = (err) => {
      addLog(`❌ WebSocket error: ${err}`);
      setStatus('error');
    };
  };

  const handleMessage = (msg: WSMessage) => {
    switch (msg.event) {
      case 'node_complete':
        addLog(`▶ Node: ${msg.node} — ${msg.details || ''}`);
        break;

      case 'analysts_generated':
        setAnalysts(msg.analysts);
        setStatus('feedback_analysts');
        addLog(`📋 Generated ${msg.analysts.length} analysts — awaiting feedback`);
        break;

      case 'sections_completed':
        setSections(msg.sections);
        setStatus('feedback_sections');
        addLog(`📄 Completed ${msg.sections.length} sections — awaiting feedback`);
        break;

      case 'feedback_requested':
        addLog(`💬 ${msg.message}`);
        break;

      case 'report_complete':
        setFinalReport(msg.final_report);
        setStatus('completed');
        addLog(`✅ Report completed! Saved to: ${msg.filepath}`);
        break;

      case 'error':
        addLog(`❌ Error: ${msg.message}`);
        setStatus('error');
        break;

      default:
        addLog(`📨 ${msg.event}: ${JSON.stringify(msg)}`);
    }
  };

  const sendFeedback = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      event: 'feedback_submit',
      feedback: feedback || 'approve',
    }));

    setFeedback('');
    setStatus('running');
  };

  const downloadReport = () => {
    if (!finalReport) return;
    const blob = new Blob([finalReport], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>🔬 Deep Research Agent</h1>
      <p style={{ color: '#666' }}>Multi-agent research assistant với WebSocket streaming</p>

      {/* Input form */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Chủ đề nghiên cứu
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ví dụ: So sánh RAG vs fine-tuning cho chatbot tiếng Việt"
              style={{ width: '100%', padding: '8px', fontSize: '16px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '5px' }}>Số analyst</label>
            <input
              type="number"
              value={maxAnalysts}
              onChange={(e) => setMaxAnalysts(parseInt(e.target.value) || 3)}
              min={1} max={10}
              style={{ width: '80px', padding: '8px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '5px' }}>User ID</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              style={{ width: '120px', padding: '8px' }}
            />
          </div>
          <button
            onClick={connect}
            disabled={status !== 'idle'}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              background: status === 'idle' ? '#007bff' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: status === 'idle' ? 'pointer' : 'not-allowed',
            }}
          >
            {status === 'idle' ? '🚀 Bắt đầu Research' : 'Đang chạy...'}
          </button>
        </div>
      </div>

      {/* Analyst feedback */}
      {status === 'feedback_analysts' && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ffc107', borderRadius: '8px', background: '#fff8e1' }}>
          <h3>📋 Review Danh sách Analyst</h3>
          <ul>
            {analysts.map((a, i) => (
              <li key={i} style={{ marginBottom: '10px', padding: '10px', background: 'white', borderRadius: '4px' }}>
                <strong>{a.name}</strong> — {a.role} @ {a.affiliation}<br/>
                <small>{a.description}</small>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Feedback (để trống = approve)"
              style={{ flex: 1, padding: '8px' }}
            />
            <button onClick={sendFeedback} style={{ padding: '8px 16px' }}>
              Gửi Feedback
            </button>
            <button onClick={() => { setFeedback('approve'); sendFeedback(); }} style={{ padding: '8px 16px' }}>
              ✅ Approve
            </button>
          </div>
        </div>
      )}

      {/* Section feedback */}
      {status === 'feedback_sections' && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ffc107', borderRadius: '8px', background: '#fff8e1' }}>
          <h3>📄 Review Các Section</h3>
          <ul>
            {sections.map((s, i) => (
              <li key={i} style={{ marginBottom: '5px', padding: '8px', background: 'white', borderRadius: '4px' }}>
                {i + 1}. {s}
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Feedback (để trống = approve)"
              style={{ flex: 1, padding: '8px' }}
            />
            <button onClick={sendFeedback} style={{ padding: '8px 16px' }}>
              Gửi Feedback
            </button>
            <button onClick={() => { setFeedback('approve'); sendFeedback(); }} style={{ padding: '8px 16px' }}>
              ✅ Approve
            </button>
          </div>
        </div>
      )}

      {/* Final report */}
      {status === 'completed' && finalReport && (
        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button onClick={downloadReport} style={{ padding: '10px 20px', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}>
              📥 Download Report
            </button>
          </div>
          <div
            style={{
              maxHeight: '500px',
              overflow: 'auto',
              padding: '20px',
              border: '1px solid #ddd',
              borderRadius: '8px',
              background: '#fafafa',
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
              fontSize: '14px',
              lineHeight: '1.6',
            }}
          >
            {finalReport}
          </div>
        </div>
      )}

      {/* Logs */}
      <details style={{ marginTop: '20px' }}>
        <summary>📜 Logs ({logs.length})</summary>
        <div style={{
          maxHeight: '300px',
          overflow: 'auto',
          padding: '10px',
          background: '#1e1e1e',
          color: '#d4d4d4',
          fontFamily: 'monospace',
          fontSize: '12px',
          borderRadius: '4px',
        }}>
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      </details>
    </div>
  );
};

export default App;