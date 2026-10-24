export interface ResearchOptions {
  reportLanguage: 'auto' | 'vi' | 'en';
  mode: 'research' | 'paper';
  paperInput: string;
  documentId: string;
  documentName: string;
  field: string;
  detail: 'concise' | 'detailed' | 'extended';
  preferredReportLanguage: 'vi' | 'en';
  budget?: { max_searches: number; max_documents: number };
}

export const defaultResearchOptions: ResearchOptions = {
  reportLanguage: 'auto',
  mode: 'research',
  paperInput: '',
  documentId: '',
  documentName: '',
  field: 'auto',
  detail: 'detailed',
  preferredReportLanguage: 'vi',
};

export function initialResearchOptions(): ResearchOptions {
  try {
    const saved = JSON.parse(localStorage.getItem('nexora-report-preferences-v1') || '{}');
    return {
      ...defaultResearchOptions,
      reportLanguage: ['auto', 'vi', 'en'].includes(saved.reportLanguage) ? saved.reportLanguage : 'auto',
      preferredReportLanguage: saved.preferredReportLanguage === 'en' ? 'en' : 'vi',
      detail: ['concise', 'detailed', 'extended'].includes(saved.detail) ? saved.detail : 'detailed',
    };
  } catch {
    return { ...defaultResearchOptions };
  }
}
