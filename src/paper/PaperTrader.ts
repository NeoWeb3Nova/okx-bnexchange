import { DetailedProfitAnalysis, ProfitEngine } from '../pricing/ProfitEngine';
import { DexQuoteService } from '../pricing/DexQuoteService';
import { CexPriceService } from '../scanner/CexPriceService';
import { ArbitrageOpportunity } from '../scanner/types';
import { PaperLedger } from './PaperLedger';
import { OpportunityTracker } from './OpportunityTracker';
import { PaperTradeRecord } from './types';

export class PaperTrader {
  private ledger: PaperLedger;
  private tracker: OpportunityTracker;
  private inFlightTrades: Set<string> = new Set();

  constructor(
    private cexService: CexPriceService,
    private dexQuoteService: DexQuoteService,
    startingBalanceUsd: number = 10000
  ) {
    this.ledger = new PaperLedger(startingBalanceUsd);
    this.tracker = new OpportunityTracker();
  }

  /**
   * Process a batch of profit analyses from the radar
   */
  public async processBatch(
    opportunities: ArbitrageOpportunity[],
    analyses: DetailedProfitAnalysis[],
    simulatedLatencyMs: number = 2500
  ): Promise<void> {
    // 1. Update opportunity tracker (lifetimes & persistence)
    this.tracker.update(analyses);

    // 2. Select top profitable candidates for paper execution
    const candidates = analyses.filter(a => a.status === 'PROFITABLE');

    for (const analysis of candidates) {
      const tradeKey = `${analysis.tokenSymbol}_${analysis.exchange}_${analysis.direction}_${analysis.tradeSizeUsd}`;
      if (this.inFlightTrades.has(tradeKey)) continue;

      const opp = opportunities.find(
        o => o.token.symbol === analysis.tokenSymbol && o.cexPrice.exchange.toUpperCase() === analysis.exchange
      );
      if (!opp) continue;

      this.inFlightTrades.add(tradeKey);

      // Execute simulated trade with latency check asynchronously (or sequentially)
      await this.simulateExecution(opp, analysis, simulatedLatencyMs);

      this.inFlightTrades.delete(tradeKey);
    }
  }

  /**
   * Simulate realistic execution with block latency & price drift
   */
  private async simulateExecution(
    opp: ArbitrageOpportunity,
    triggerAnalysis: DetailedProfitAnalysis,
    latencyMs: number
  ): Promise<void> {
    const symbol = opp.token.symbol;
    const exchange = opp.cexPrice.exchange.toUpperCase();
    const size = triggerAnalysis.tradeSizeUsd;

    console.log(`\n[PaperTrader] ⚡ Simulating order for ${symbol} on ${exchange} ($${size})...`);
    console.log(`[PaperTrader] ⏳ Waiting ${latencyMs}ms for BSC block confirmation & network transit...`);

    const triggerTime = new Date().toISOString();

    // Wait simulated block confirmation time
    await new Promise(resolve => setTimeout(resolve, latencyMs));

    // Post-latency re-evaluation: Re-query live CEX orderbook & DEX quote!
    try {
      const ob = await this.cexService.getOrderBook(
        opp.cexPrice.exchange,
        opp.cexPrice.symbol,
        20
      );

      if (!ob || ob.bids.length === 0 || ob.asks.length === 0) {
        this.recordExhaustedTrade(opp, triggerAnalysis, triggerTime, latencyMs);
        return;
      }

      const postDexQuote = await this.dexQuoteService.getDexQuote({
        chainId: opp.token.chainIndex,
        tokenAddress: opp.token.contractAddress,
        tokenPriceUsd: opp.dexPriceUsd,
        poolReserveUsd: opp.token.reserveUsd,
        tradeSizeUsd: size,
        direction: opp.direction,
      });

      const postAnalysis = ProfitEngine.evaluateOpportunity({
        opportunity: opp,
        tradeSizeUsd: size,
        orderBook: ob,
        dexQuote: postDexQuote,
      });

      const realizedNetProfitUsd = postAnalysis.netProfitUsd;
      const realizedNetProfitPct = postAnalysis.netProfitPct;
      const decayUsd = Number((triggerAnalysis.netProfitUsd - realizedNetProfitUsd).toFixed(2));

      const status: PaperTradeRecord['status'] =
        realizedNetProfitUsd > 0 ? 'PROFITABLE' : 'DECAYED_TO_LOSS';

      const tradeRecord: PaperTradeRecord = {
        id: `PT-${Date.now().toString().slice(-6)}`,
        tokenSymbol: symbol,
        exchange,
        direction: opp.direction,
        sizeUsd: size,
        triggeredAt: triggerTime,
        latencyMs,
        triggerSpreadPct: triggerAnalysis.grossProfitPct,
        triggerNetProfitUsd: triggerAnalysis.netProfitUsd,
        triggerDexPrice: triggerAnalysis.dexEffectivePrice,
        triggerCexPrice: triggerAnalysis.cexVwapPrice,
        realizedDexPrice: postAnalysis.dexEffectivePrice,
        realizedCexPrice: postAnalysis.cexVwapPrice,
        realizedNetProfitUsd,
        realizedNetProfitPct,
        latencyDecayUsd: decayUsd,
        status,
        note:
          status === 'PROFITABLE'
            ? `Successfully filled after ${latencyMs}ms latency (Decay: $${decayUsd})`
            : `Spread decayed into negative during block confirmation (Decay: $${decayUsd})`,
      };

      this.ledger.recordTrade(tradeRecord);
      this.printExecutionSlip(tradeRecord);
    } catch (err: any) {
      console.warn(`[PaperTrader] Simulated confirmation error: ${err.message}`);
    }
  }

  private recordExhaustedTrade(
    opp: ArbitrageOpportunity,
    triggerAnalysis: DetailedProfitAnalysis,
    triggerTime: string,
    latencyMs: number
  ) {
    const tradeRecord: PaperTradeRecord = {
      id: `PT-${Date.now().toString().slice(-6)}`,
      tokenSymbol: opp.token.symbol,
      exchange: opp.cexPrice.exchange.toUpperCase(),
      direction: opp.direction,
      sizeUsd: triggerAnalysis.tradeSizeUsd,
      triggeredAt: triggerTime,
      latencyMs,
      triggerSpreadPct: triggerAnalysis.grossProfitPct,
      triggerNetProfitUsd: triggerAnalysis.netProfitUsd,
      triggerDexPrice: triggerAnalysis.dexEffectivePrice,
      triggerCexPrice: triggerAnalysis.cexVwapPrice,
      realizedDexPrice: 0,
      realizedCexPrice: 0,
      realizedNetProfitUsd: -triggerAnalysis.totalFrictionUsd,
      realizedNetProfitPct: -0.25,
      latencyDecayUsd: triggerAnalysis.netProfitUsd,
      status: 'DEPTH_EXHAUSTED',
      note: 'Order book liquidity was pulled before block confirmation',
    };
    this.ledger.recordTrade(tradeRecord);
    this.printExecutionSlip(tradeRecord);
  }

  /**
   * Render simulated execution receipt
   */
  private printExecutionSlip(t: PaperTradeRecord) {
    const sign = t.realizedNetProfitUsd >= 0 ? '+' : '';
    const icon = t.status === 'PROFITABLE' ? '✅' : '❌';

    console.log('\n' + '┌' + '─'.repeat(70) + '┐');
    console.log(`│ ${icon} PAPER TRADE EXECUTION SLIP [${t.id}]`.padEnd(71) + '│');
    console.log('├' + '─'.repeat(70) + '┤');
    console.log(`│ Token: ${t.tokenSymbol.padEnd(10)} Exchange: ${t.exchange.padEnd(10)} Size: $${t.sizeUsd}`.padEnd(71) + '│');
    console.log(`│ Trigger PnL:  +$${t.triggerNetProfitUsd} (+${t.triggerSpreadPct}%)`.padEnd(71) + '│');
    console.log(`│ Latency:      ${t.latencyMs}ms (BSC block transit)`.padEnd(71) + '│');
    console.log(`│ Realized PnL: ${sign}$${t.realizedNetProfitUsd} (${sign}${t.realizedNetProfitPct}%)`.padEnd(71) + '│');
    console.log(`│ Price Drift:  Decay -$${t.latencyDecayUsd}`.padEnd(71) + '│');
    console.log(`│ Status:       ${t.status} - ${t.note}`.padEnd(71) + '│');
    console.log('└' + '─'.repeat(70) + '┘\n');
  }

  /**
   * Render Phase 3 Portfolio Summary & Opportunity Lifetimes Table
   */
  public renderPhase3Dashboard(): void {
    const summary = this.ledger.getSummary();
    const activeOpps = this.tracker.getActiveOpportunities();
    const avgLifetime = this.tracker.getAverageDurationSeconds();

    const pad = (str: string, len: number) => (str + ' '.repeat(len)).slice(0, len);
    const rpad = (str: string, len: number) => (' '.repeat(len) + str).slice(-len);

    console.log('\n' + '='.repeat(125));
    console.log('📈 PHASE 3: PAPER PORTFOLIO & PERSISTENCE SCOREBOARD');
    console.log('='.repeat(125));

    console.log(
      `💼 Virtual Balance: $${summary.currentBalanceUsd} (Initial: $${summary.startingBalanceUsd}) | ` +
      `Total Trades: ${summary.totalTrades} | Win Rate: ${summary.winRatePct}% (${summary.winningTrades}W / ${summary.losingTrades}L)`
    );
    console.log(
      `💵 Cumulative Net PnL: ${summary.totalNetProfitUsd >= 0 ? '+' : ''}$${summary.totalNetProfitUsd} | ` +
      `Avg PnL/Trade: $${summary.avgProfitPerTradeUsd} | Avg Latency Decay: -$${summary.avgLatencyDecayUsd} | Avg Opportunity Lifetime: ${avgLifetime}s`
    );

    if (activeOpps.length > 0) {
      console.log('\n⏱️  OPPORTUNITY PERSISTENCE (How long spreads survive):');
      console.log(
        pad('TOKEN', 10) +
        pad('EXCHANGE', 10) +
        pad('DIRECTION', 20) +
        rpad('DURATION', 12) +
        rpad('PEAK SPREAD', 14) +
        rpad('PEAK NET PNL', 14)
      );
      console.log('-'.repeat(125));

      activeOpps.forEach(o => {
        const sym = pad(o.tokenSymbol, 9);
        const ex = pad(o.exchange, 9);
        const dir = pad(o.direction === 'DEX_SELL_CEX_BUY' ? 'DEX Sell/CEX Buy' : 'DEX Buy/CEX Sell', 19);
        const dur = rpad(`${o.durationSeconds}s`, 11);
        const peakSpr = rpad(`+${o.peakSpreadPct}%`, 13);
        const peakPnl = rpad(`+$${o.peakNetProfitUsd}`, 13);
        console.log(`${sym} ${ex} ${dir} ${dur} ${peakSpr} ${peakPnl}`);
      });
    }

    console.log('='.repeat(125) + '\n');
  }
}
