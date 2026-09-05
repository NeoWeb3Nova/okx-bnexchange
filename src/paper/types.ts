export interface TrackedOpportunity {
  id: string; // e.g. "USELESS_GATE_DEX_BUY_CEX_SELL"
  tokenSymbol: string;
  contractAddress: string;
  exchange: string;
  direction: 'DEX_SELL_CEX_BUY' | 'DEX_BUY_CEX_SELL';
  firstSeenAt: number;
  lastSeenAt: number;
  durationSeconds: number;
  initialSpreadPct: number;
  peakSpreadPct: number;
  lastSpreadPct: number;
  initialNetProfitUsd: number;
  peakNetProfitUsd: number;
  isActive: boolean;
}

export interface PaperTradeRecord {
  id: string;
  tokenSymbol: string;
  exchange: string;
  direction: 'DEX_SELL_CEX_BUY' | 'DEX_BUY_CEX_SELL';
  sizeUsd: number;
  triggeredAt: string; // ISO string
  latencyMs: number; // Simulated confirmation time (e.g. 3000ms)

  // Trigger metrics
  triggerSpreadPct: number;
  triggerNetProfitUsd: number;
  triggerDexPrice: number;
  triggerCexPrice: number;

  // Realized metrics after latency
  realizedDexPrice: number;
  realizedCexPrice: number;
  realizedNetProfitUsd: number;
  realizedNetProfitPct: number;
  latencyDecayUsd: number; // Profit eroded by block latency

  status: 'PROFITABLE' | 'DECAYED_TO_LOSS' | 'DEPTH_EXHAUSTED';
  note: string;
}

export interface PaperPortfolioSummary {
  startingBalanceUsd: number;
  currentBalanceUsd: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  totalNetProfitUsd: number;
  avgProfitPerTradeUsd: number;
  avgLatencyDecayUsd: number;
}
