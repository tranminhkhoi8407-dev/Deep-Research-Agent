import { ArrowLeft, ChevronRight, MessageSquare, NotebookText } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Language } from './ProductViews';
import './ResearchReportsWorkspace.css';

export function ResearchReportsWorkspace({ language, running, onBack, onExit, children }: {
  language: Language; running: boolean; onBack: () => void; onExit: () => void; children: ReactNode;
}) {
  const vi = language === 'vi';
  return <section className="research-reports" aria-label={vi ? 'Báo cáo trong Research' : 'Reports in Research'}>
    <header className="research-reports__toolbar">
      <button className="research-reports__back" type="button" onClick={onBack} aria-label={vi ? 'Quay lại trò chuyện' : 'Back to chat'}>
        <ArrowLeft size={18} /><MessageSquare className="research-reports__chat-icon" size={16} /><span className="research-reports__back-label">{vi ? 'Quay lại trò chuyện' : 'Back to chat'}</span><span className="research-reports__back-short">Chat</span>
      </button>
      <ChevronRight className="research-reports__separator" size={15} aria-hidden="true" />
      <span className="research-reports__title"><NotebookText size={17} /><strong>{vi ? 'Báo cáo' : 'Reports'}</strong></span>
      {running && <span className="research-reports__running" role="status"><i aria-hidden="true" />{vi ? 'Đang nghiên cứu' : 'Research running'}</span>}
      <button className="research-reports__exit" type="button" onClick={onExit} aria-label={vi ? 'Về Nexora' : 'Back to Nexora'}><ArrowLeft size={16} /><span>Nexora</span></button>
    </header>
    <div className="research-reports__content">{children}</div>
  </section>;
}
