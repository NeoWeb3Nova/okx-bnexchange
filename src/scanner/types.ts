export interface TokenCandidate {
  symbol: string;
  name: string;
  contractAddress: string;
  chainIndex: number; // 56 for BSC, 1 for ETH, 8453 for Base, 501 for Solana
  chainName: string;
  priceUsd: number;
  volume24hUsd?: number;
  reserveUsd?: number;
  source: 'okx' | 'geckoterminal' | 'dexscreener' | 'manual';
}

export interface CexMarketPrice {
  exchange: 'binance' | 'okx' | 'gate' | 'bybit';
  symbol: string; // e.g. "AKE/USDT"
  marketType: 'spot' | 'linear';
  bid: number; // best bid (sell price on CEX)
  ask: number; // best ask (buy price on CEX)
  last: number;
  bidQty?: number;
  askQty?: number;
  timestamp: number;
}

export type ArbitrageDirection = 'DEX_SELL_CEX_BUY' | 'DEX_BUY_CEX_SELL';

export interface ArbitrageOpportunity {
  token: TokenCandidate;
  cexPrice: CexMarketPrice;
  dexPriceUsd: number;
  direction: ArbitrageDirection;
  grossSpreadPct: number; // Percentage, e.g. 2.5 means +2.5%
  dexAction: string; // e.g. "Sell AKE on DEX -> get USDT"
  cexAction: string; // e.g. "Buy AKE on Gate.io -> spend USDT"
  timestamp: number;
}

export interface ScannerConfig {
  chainId: number;
  chainName: string;
  minSpreadPct: number; // Minimum gross spread percentage to display (e.g. 0.5%)
  maxSpreadPct?: number; // Spread threshold above which it's likely a symbol collision (default: 25%)
  refreshIntervalSec: number; // Refresh interval in seconds
  topCount: number; // Number of top tokens to scan
  proxyUrl?: string;
  manualWatchlist?: string[]; // Extra token symbols or contracts to always monitor
  testSizesUsd?: number[]; // Trade sizes in USD for Phase 2 exact depth quotes (default: [500, 1000])
}
