import type { ChatJob } from './researchChatModel';

// Only a run actually observed in progress can announce a completion. Loading
// historical completed runs is silent; waiting for a human is not completion.
export class CompletionTracker {
  private observed = new Set<string>();
  observe(jobs: readonly ChatJob[]): string[] {
    const completed: string[] = [];
    for (const job of jobs) {
      if (['queued', 'running', 'awaiting_input'].includes(job.status)) this.observed.add(job.id);
      else if (this.observed.delete(job.id) && job.status === 'completed') completed.push(job.id);
    }
    return completed;
  }
}
