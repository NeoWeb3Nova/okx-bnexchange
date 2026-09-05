import { CexFillResult, OrderBookCalculator } from './OrderBookCalculator';
import { DexQuoteResult } from './DexQuoteService';
import { ArbitrageOpportunity } from '../scanner/types';

export interface DetailedProfitAnalysis {
  tradeSizeUsd: number;
  direction: 'DEX_SELL_CEX_BUY' | 'DEX_BUY_CEX_SELL';
  exchange: string;
  tokenSymbol: string;

  // Pricing details
  dexDisplayPrice: number;
  dexEffectivePrice: number;
  dexPriceImpactPct: number;

  cexTopPrice: number;
  cexVwapPrice: number;
  cexDepthSlippagePct: number;
  cexAvailableDepthUsdt: number;

  // PnL details
  grossProfitUsd: number;
  grossProfitPct: number;

  // Friction costs
  cexFeeUsd: number;
  dexGasFeeUsd: number;
  slippageBufferUsd: number;
  totalFrictionUsd: number;

  // Net PnL
  netProfitUsd: number;
  netProfitPct: number;

  status: 'PROFITABLE' | 'MARGINAL' | 'UNPROFITABLE' | 'INSUFFICIENT_DEPTH';
  summary: string;
}

export class ProfitEngine {
  /**
   * Calculate detailed net PnL by combining DEX quote and CEX orderbook depth
   */
  public static evaluateOpportunity(params: {
    opportunity: ArbitrageOpportunity;
    tradeSizeUsd: number;
    orderBook: { bids: number[][]; asks: number[][] };
    dexQuote: DexQuoteResult;
    cexFeeRate?: number; // default 0.08% taker fee
    slippageBufferRate?: number; // default 0.15% buffer
  }): DetailedProfitAnalysis {
    const {
      opportunity,
      tradeSizeUsd,
      orderBook,
      dexQuote,
      cexFeeRate = 0.0008,
      slippageBufferRate = 0.0015,
    } = params;

    const direction = opportunity.direction;
    const tokenSymbol = opportunity.token.symbol;
    const exchange = opportunity.cexPrice.exchange.toUpperCase();

    let cexFill: CexFillResult;
    let grossProfitUsd = 0;

    if (direction === 'DEX_BUY_CEX_SELL') {
      // 1. Buy tokens on DEX with tradeSizeUsd
      const tokensBoughtOnDex =
        dexQuote.dexFillPrice > 0 ? tradeSizeUsd / dexQuote.dexFillPrice : 0;

      // 2. Sell those tokens on CEX into bids ladder
      cexFill = OrderBookCalculator.sellTokenQty(orderBook.bids, tokensBoughtOnDex);
      grossProfitUsd = cexFill.totalUsdt - tradeSizeUsd;
    } else {
      // 1. Buy tokens on CEX by spending tradeSizeUsd into asks ladder
      cexFill = OrderBookCalculator.buyWithUsdt(orderBook.asks, tradeSizeUsd);

      // 2. Sell those tokens on DEX to receive USDT
      const dexUsdtRevenue = cexFill.tokenQty * dexQuote.dexFillPrice;
      grossProfitUsd = dexUsdtRevenue - tradeSizeUsd;
    }

    const cexFeeUsd = tradeSizeUsd * cexFeeRate;
    const dexGasFeeUsd = dexQuote.gasFeeUsd;
    const slippageBufferUsd = tradeSizeUsd * slippageBufferRate;
    const totalFrictionUsd = cexFeeUsd + dexGasFeeUsd + slippageBufferUsd;

    const netProfitUsd = Number((grossProfitUsd - totalFrictionUsd).toFixed(2));
    const grossProfitPct = Number(((grossProfitUsd / tradeSizeUsd) * 100).toFixed(2));
    const netProfitPct = Number(((netProfitUsd / tradeSizeUsd) * 100).toFixed(2));

    let status: DetailedProfitAnalysis['status'] = 'UNPROFITABLE';
    let summary = '';

    if (!cexFill.isFullyFilled || cexFill.availableUsdt < tradeSizeUsd) {
      status = 'INSUFFICIENT_DEPTH';
      summary = `CEX depth ($${cexFill.availableUsdt.toFixed(0)}) cannot fill $${tradeSizeUsd}`;
    } else if (netProfitUsd >= 1.5 && netProfitPct >= 0.3) {
      status = 'PROFITABLE';
      summary = `Net +$${netProfitUsd} (+${netProfitPct}%) after all fees`;
    } else if (netProfitUsd > 0) {
      status = 'MARGINAL';
      summary = `Marginal +$${netProfitUsd} (+${netProfitPct}%), thin margin`;
    } else {
      status = 'UNPROFITABLE';
      summary = `Loss -$${Math.abs(netProfitUsd)} (-${Math.abs(netProfitPct)}%) eaten by fees/slippage`;
    }

    return {
      tradeSizeUsd,
      direction,
      exchange,
      tokenSymbol,
      dexDisplayPrice: opportunity.dexPriceUsd,
      dexEffectivePrice: dexQuote.dexFillPrice,
      dexPriceImpactPct: dexQuote.priceImpactPct,
      cexTopPrice: cexFill.bestPrice,
      cexVwapPrice: cexFill.vwapPrice,
      cexDepthSlippagePct: cexFill.slippagePct,
      cexAvailableDepthUsdt: cexFill.availableUsdt,
      grossProfitUsd: Number(grossProfitUsd.toFixed(2)),
      grossProfitPct,
      cexFeeUsd: Number(cexFeeUsd.toFixed(2)),
      dexGasFeeUsd: Number(dexGasFeeUsd.toFixed(2)),
      slippageBufferUsd: Number(slippageBufferUsd.toFixed(2)),
      totalFrictionUsd: Number(totalFrictionUsd.toFixed(2)),
      netProfitUsd,
      netProfitPct,
      status,
      summary,
    };
  }
}
