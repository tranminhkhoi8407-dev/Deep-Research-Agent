// Real chat component; browser tests intercept ALL API requests. No model calls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ResearchChat } from '../src/ResearchChat';
import '../src/styles.css';
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
createRoot(document.getElementById('root')!).render(<React.StrictMode><ResearchChat apiBase="" language={params.get('lang') === 'en' ? 'en' : 'vi'} userId="browser-fixture" onClassic={() => { document.title = 'Classic requested'; }} onReportsChanged={() => { Object.assign(window, { reportsChanged: true }); }} /></React.StrictMode>);
