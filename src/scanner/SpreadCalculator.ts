import { TokenCandidate, CexMarketPrice, ArbitrageOpportunity } from './types';

export class SpreadCalculator {
  /**
   * Calculate arbitrage opportunities between on-chain DEX price and CEX prices
   */
  public static calculateOpportunities(
    token: TokenCandidate,
    cexPrices: CexMarketPrice[],
    minSpreadPct: number = 0.5
  ): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const dexPrice = token.priceUsd;

    if (!dexPrice || dexPrice <= 0) return opportunities;

    for (const cex of cexPrices) {
      // 1. Case A: DEX is more expensive -> SELL on DEX, BUY on CEX
      if (cex.ask > 0 && dexPrice > cex.ask) {
        const spreadPct = ((dexPrice - cex.ask) / cex.ask) * 100;
        if (spreadPct >= minSpreadPct) {
          opportunities.push({
            token,
            cexPrice: cex,
            dexPriceUsd: dexPrice,
            direction: 'DEX_SELL_CEX_BUY',
            grossSpreadPct: Number(spreadPct.toFixed(2)),
            dexAction: `Sell ${token.symbol} on DEX`,
            cexAction: `Buy ${token.symbol} on ${cex.exchange.toUpperCase()}`,
            timestamp: Date.now(),
          });
        }
      }

      // 2. Case B: CEX is more expensive -> BUY on DEX, SELL on CEX
      if (cex.bid > 0 && cex.bid > dexPrice) {
        const spreadPct = ((cex.bid - dexPrice) / dexPrice) * 100;
        if (spreadPct >= minSpreadPct) {
          opportunities.push({
            token,
            cexPrice: cex,
            dexPriceUsd: dexPrice,
            direction: 'DEX_BUY_CEX_SELL',
            grossSpreadPct: Number(spreadPct.toFixed(2)),
            dexAction: `Buy ${token.symbol} on DEX`,
            cexAction: `Sell ${token.symbol} on ${cex.exchange.toUpperCase()}`,
            timestamp: Date.now(),
          });
        }
      }
    }

    return opportunities;
  }
}
