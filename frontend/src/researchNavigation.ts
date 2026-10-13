export type ResearchScreen = 'chat' | 'classic';

// Research is the parent; report creation is an explicit child, not a sticky
// preference that redirects the next click on the global Research navigation.
export function researchScreenFromHash(hash: string): ResearchScreen | null {
  if (hash === '#/research' || hash === '#/research/chat') return 'chat';
  if (hash === '#/research/reports') return 'classic';
  return null;
}

export function researchHash(screen: ResearchScreen): string {
  return screen === 'classic' ? '#/research/reports' : '#/research';
}
