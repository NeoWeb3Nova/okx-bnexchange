export interface CexFillResult {
  tokenQty: number;
  totalUsdt: number;
  vwapPrice: number;
  bestPrice: number;
  slippagePct: number;
  isFullyFilled: boolean;
  availableTokens: number;
  availableUsdt: number;
}

export class OrderBookCalculator {
  /**
   * Simulate BUYING tokens on CEX with spending targetUsdt (eating the asks ladder)
   * Returns how many tokens were bought and the VWAP ask price
   */
  public static buyWithUsdt(asks: number[][], targetUsdt: number): CexFillResult {
    if (!asks || asks.length === 0 || targetUsdt <= 0) {
      return {
        tokenQty: 0,
        totalUsdt: 0,
        vwapPrice: 0,
        bestPrice: 0,
        slippagePct: 0,
        isFullyFilled: false,
        availableTokens: 0,
        availableUsdt: 0,
      };
    }

    const bestAsk = asks[0][0];
    let remainingUsdt = targetUsdt;
    let tokensBought = 0;
    let usdtSpent = 0;
    let totalAskTokens = 0;
    let totalAskUsdt = 0;

    for (const [price, qty] of asks) {
      const levelUsdt = price * qty;
      totalAskTokens += qty;
      totalAskUsdt += levelUsdt;

      if (remainingUsdt > 0) {
        if (remainingUsdt <= levelUsdt) {
          const takeTokens = remainingUsdt / price;
          tokensBought += takeTokens;
          usdtSpent += remainingUsdt;
          remainingUsdt = 0;
        } else {
          tokensBought += qty;
          usdtSpent += levelUsdt;
          remainingUsdt -= levelUsdt;
        }
      }
    }

    const isFullyFilled = remainingUsdt <= 0;
    const vwap = tokensBought > 0 ? usdtSpent / tokensBought : bestAsk;
    const slippagePct = bestAsk > 0 ? ((vwap - bestAsk) / bestAsk) * 100 : 0;

    return {
      tokenQty: tokensBought,
      totalUsdt: usdtSpent,
      vwapPrice: vwap,
      bestPrice: bestAsk,
      slippagePct: Number(slippagePct.toFixed(3)),
      isFullyFilled,
      availableTokens: totalAskTokens,
      availableUsdt: Number(totalAskUsdt.toFixed(2)),
    };
  }

  /**
   * Simulate SELLING a specific token quantity on CEX (eating the bids ladder)
   * Returns how much USDT is received and the VWAP bid price
   */
  public static sellTokenQty(bids: number[][], targetTokenQty: number): CexFillResult {
    if (!bids || bids.length === 0 || targetTokenQty <= 0) {
      return {
        tokenQty: 0,
        totalUsdt: 0,
        vwapPrice: 0,
        bestPrice: 0,
        slippagePct: 0,
        isFullyFilled: false,
        availableTokens: 0,
        availableUsdt: 0,
      };
    }

    const bestBid = bids[0][0];
    let remainingTokens = targetTokenQty;
    let usdtReceived = 0;
    let tokensSold = 0;
    let totalBidTokens = 0;
    let totalBidUsdt = 0;

    for (const [price, qty] of bids) {
      const levelUsdt = price * qty;
      totalBidTokens += qty;
      totalBidUsdt += levelUsdt;

      if (remainingTokens > 0) {
        if (remainingTokens <= qty) {
          usdtReceived += remainingTokens * price;
          tokensSold += remainingTokens;
          remainingTokens = 0;
        } else {
          usdtReceived += levelUsdt;
          tokensSold += qty;
          remainingTokens -= qty;
        }
      }
    }

    const isFullyFilled = remainingTokens <= 0;
    const vwap = tokensSold > 0 ? usdtReceived / tokensSold : bestBid;
    const slippagePct = bestBid > 0 ? ((bestBid - vwap) / bestBid) * 100 : 0;

    return {
      tokenQty: tokensSold,
      totalUsdt: usdtReceived,
      vwapPrice: vwap,
      bestPrice: bestBid,
      slippagePct: Number(slippagePct.toFixed(3)),
      isFullyFilled,
      availableTokens: totalBidTokens,
      availableUsdt: Number(totalBidUsdt.toFixed(2)),
    };
  }
}
