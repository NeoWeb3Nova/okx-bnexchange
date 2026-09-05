import fs from 'fs';
import path from 'path';
import { PaperPortfolioSummary, PaperTradeRecord } from './types';

export class PaperLedger {
  private logFilePath: string;
  private trades: PaperTradeRecord[] = [];
  private startingBalanceUsd: number;

  constructor(startingBalanceUsd: number = 10000, dataDir?: string) {
    this.startingBalanceUsd = startingBalanceUsd;
    const targetDir = dataDir || path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    this.logFilePath = path.join(targetDir, 'paper_trades.json');
    this.loadHistory();
  }

  private loadHistory() {
    if (fs.existsSync(this.logFilePath)) {
      try {
        const raw = fs.readFileSync(this.logFilePath, 'utf-8');
        this.trades = JSON.parse(raw);
      } catch {
        this.trades = [];
      }
    }
  }

  private saveHistory() {
    try {
      fs.writeFileSync(this.logFilePath, JSON.stringify(this.trades, null, 2));
    } catch (err: any) {
      console.warn(`[PaperLedger] Failed to write paper trades: ${err.message}`);
    }
  }

  /**
   * Record a new paper trade and persist to file
   */
  public recordTrade(trade: PaperTradeRecord): void {
    this.trades.push(trade);
    this.saveHistory();
  }

  /**
   * Calculate real-time portfolio performance summary
   */
  public getSummary(): PaperPortfolioSummary {
    const totalTrades = this.trades.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalNetProfitUsd = 0;
    let totalDecayUsd = 0;

    for (const t of this.trades) {
      totalNetProfitUsd += t.realizedNetProfitUsd;
      totalDecayUsd += t.latencyDecayUsd;
      if (t.realizedNetProfitUsd > 0) {
        winningTrades++;
      } else {
        losingTrades++;
      }
    }

    const winRatePct = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;
    const avgProfitPerTradeUsd = totalTrades > 0 ? Number((totalNetProfitUsd / totalTrades).toFixed(2)) : 0;
    const avgLatencyDecayUsd = totalTrades > 0 ? Number((totalDecayUsd / totalTrades).toFixed(2)) : 0;

    return {
      startingBalanceUsd: this.startingBalanceUsd,
      currentBalanceUsd: Number((this.startingBalanceUsd + totalNetProfitUsd).toFixed(2)),
      totalTrades,
      winningTrades,
      losingTrades,
      winRatePct,
      totalNetProfitUsd: Number(totalNetProfitUsd.toFixed(2)),
      avgProfitPerTradeUsd,
      avgLatencyDecayUsd,
    };
  }

  public getRecentTrades(limit: number = 10): PaperTradeRecord[] {
    return this.trades.slice(-limit);
  }
}
