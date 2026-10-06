import type { ResearchDomainId } from './DomainHub';

export interface ProfileCompletion {
  returnHash: string;
  field: ResearchDomainId | null;
}

const fields = ['mathematics', 'physics', 'chemistry', 'biology', 'artificial-intelligence'];
const notebookRoute = /^#\/(?:collab(?:\/(?:page|project)\/[a-f0-9]{32})?|fields(?:\/(?:guide|toolkit|(?:mathematics|physics|chemistry|biology|artificial-intelligence)(?:\/page\/[a-f0-9]{32})?))?)$/;

export function profileSetupHash(request: ProfileCompletion): string {
  const params = new URLSearchParams({ complete: 'name', return: notebookRoute.test(request.returnHash) ? request.returnHash : '#/collab' });
  if (request.field && fields.includes(request.field)) params.set('field', request.field);
  return `#/profile?${params}`;
}

export function profileCompletionFromHash(hash: string): ProfileCompletion | null {
  if (!hash.startsWith('#/profile?')) return null;
  const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1));
  const returnHash = params.get('return') || '#/collab';
  if (params.get('complete') !== 'name' || !notebookRoute.test(returnHash)) return null;
  const field = params.get('field');
  return { returnHash, field: field && fields.includes(field) ? field as ResearchDomainId : null };
}
