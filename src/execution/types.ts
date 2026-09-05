export interface ExecutionConfig {
  isLiveTrading: boolean; // false = Dry Run (default), true = Live Real Trading
  maxTradeSizeUsd: number; // Maximum single trade size (e.g. $500)
  minNetProfitUsd: number; // Minimum net profit threshold to execute (e.g. $2.00)
  minNetProfitPct: number; // Minimum net profit percentage (e.g. 0.35%)
  maxSlippagePct: number; // Maximum acceptable slippage tolerance (e.g. 0.5%)
  dailyMaxLossUsd: number; // Circuit breaker daily max loss (e.g. $50)
  maxConsecutiveFailures: number; // Circuit breaker after N failures (e.g. 3)
  gasPriceMultiplier: number; // Safe gas price multiplier (default: 1.1x)
  walletAddress?: string;
  rpcUrl?: string;
  proxyUrl?: string;
}

export interface InventoryState {
  walletBnbBalance: number;
  walletUsdtBalance: number;
  walletTokenBalance: number;
  cexUsdtBalance: number;
  cexTokenBalance: number;
  isSufficient: boolean;
  reason?: string;
}

export interface ExecutionResult {
  tradeId: string;
  tokenSymbol: string;
  exchange: string;
  direction: 'DEX_SELL_CEX_BUY' | 'DEX_BUY_CEX_SELL';
  sizeUsd: number;
  mode: 'DRY_RUN' | 'LIVE';
  status: 'SUCCESS' | 'FAILED' | 'REJECTED_BY_RISK_GUARD';
  dexTxHash?: string;
  cexOrderId?: string;
  realizedNetProfitUsd?: number;
  error?: string;
  timestamp: string;
}
