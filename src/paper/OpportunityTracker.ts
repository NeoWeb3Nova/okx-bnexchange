import { DetailedProfitAnalysis } from '../pricing/ProfitEngine';
import { TrackedOpportunity } from './types';

export class OpportunityTracker {
  private activeMap: Map<string, TrackedOpportunity> = new Map();
  private history: TrackedOpportunity[] = [];

  /**
   * Update tracker with current batch of profitable analyses
   */
  public update(currentAnalyses: DetailedProfitAnalysis[]): void {
    const now = Date.now();
    const currentKeys = new Set<string>();

    // Process currently active profitable opportunities
    for (const item of currentAnalyses) {
      if (item.status !== 'PROFITABLE') continue;

      const id = `${item.tokenSymbol}_${item.exchange}_${item.direction}_${item.tradeSizeUsd}`;
      currentKeys.add(id);

      if (this.activeMap.has(id)) {
        // Existing opportunity - update lifetime and peak values
        const existing = this.activeMap.get(id)!;
        existing.lastSeenAt = now;
        existing.durationSeconds = Number(((now - existing.firstSeenAt) / 1000).toFixed(1));
        existing.lastSpreadPct = item.grossProfitPct;
        existing.peakSpreadPct = Math.max(existing.peakSpreadPct, item.grossProfitPct);
        existing.peakNetProfitUsd = Math.max(existing.peakNetProfitUsd, item.netProfitUsd);
      } else {
        // Brand new opportunity!
        const tracked: TrackedOpportunity = {
          id,
          tokenSymbol: item.tokenSymbol,
          contractAddress: '',
          exchange: item.exchange,
          direction: item.direction,
          firstSeenAt: now,
          lastSeenAt: now,
          durationSeconds: 0,
          initialSpreadPct: item.grossProfitPct,
          peakSpreadPct: item.grossProfitPct,
          lastSpreadPct: item.grossProfitPct,
          initialNetProfitUsd: item.netProfitUsd,
          peakNetProfitUsd: item.netProfitUsd,
          isActive: true,
        };
        this.activeMap.set(id, tracked);
      }
    }

    // Check for opportunities that expired (not in current set)
    for (const [id, opp] of this.activeMap.entries()) {
      if (!currentKeys.has(id)) {
        opp.isActive = false;
        opp.durationSeconds = Number(((opp.lastSeenAt - opp.firstSeenAt) / 1000).toFixed(1));
        this.history.push({ ...opp });
        this.activeMap.delete(id);
      }
    }
  }

  /**
   * Get all currently active tracked opportunities
   */
  public getActiveOpportunities(): TrackedOpportunity[] {
    return Array.from(this.activeMap.values());
  }

  /**
   * Get closed opportunity history
   */
  public getHistory(): TrackedOpportunity[] {
    return this.history;
  }

  /**
   * Calculate average duration across all tracked opportunities
   */
  public getAverageDurationSeconds(): number {
    const all = [...this.history, ...Array.from(this.activeMap.values())];
    if (all.length === 0) return 0;
    const sum = all.reduce((acc, item) => acc + item.durationSeconds, 0);
    return Number((sum / all.length).toFixed(1));
  }
}
