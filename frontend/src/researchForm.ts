/** Paper input replaces the required research topic, not the other run guards. */
export function hasResearchInput(topic: string, options: {
  mode: 'research' | 'paper'; paperInput: string; documentId: string;
}): boolean {
  return options.mode === 'paper'
    ? Boolean(options.paperInput.trim() || options.documentId.trim())
    : topic.trim().length >= 8;
}

export function researchOutcome(data?: {
  outcome?: 'completed' | 'partial' | 'failed';
  sections: { key: string; claims: { verification?: string }[] }[];
  coverage: { status: string }[];
} | null): 'completed' | 'partial' | 'failed' {
  if (!data) return 'completed'; // legacy Markdown-only reports
  if (data.outcome) return data.outcome;
  const populated = new Set(data.sections.filter(section => section.claims.length).map(section => section.key));
  if (!data.sections.some(section => section.key !== 'scope' && section.claims.length > 0)) return 'failed';
  return !data.coverage.length || data.coverage.some(item => item.status !== 'answered') || data.sections.some(section => section.claims.some(claim => claim.verification !== 'model_checked')) || ['answer', 'mechanism', 'evidence', 'limitations', 'next_steps'].some(key => !populated.has(key)) ? 'partial' : 'completed';
}
