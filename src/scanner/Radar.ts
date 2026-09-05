import { DiscoveryService } from './DiscoveryService';
import { CexPriceService } from './CexPriceService';
import { SpreadCalculator } from './SpreadCalculator';
import { DexQuoteService } from '../pricing/DexQuoteService';
import { ProfitEngine, DetailedProfitAnalysis } from '../pricing/ProfitEngine';
import { ArbitrageOpportunity, ScannerConfig, TokenCandidate } from './types';

export class ArbitrageRadar {
  private discovery: DiscoveryService;
  private cexService: CexPriceService;
  private dexQuoteService: DexQuoteService;
  private isScanning: boolean = false;
  private maxRealisticSpread: number;
  private testSizesUsd: number[];

  constructor(private config: ScannerConfig) {
    this.discovery = new DiscoveryService(config.proxyUrl);
    this.cexService = new CexPriceService(config.proxyUrl);
    this.dexQuoteService = new DexQuoteService(config.proxyUrl);
    this.maxRealisticSpread = config.maxSpreadPct ?? 25.0;
    this.testSizesUsd = config.testSizesUsd ?? [500, 1000];
  }

  /**
   * Run a single comprehensive scan pass with Phase 1 Radar + Phase 2 Depth Quotes
   */
  public async scanOnce(): Promise<{
    opportunities: ArbitrageOpportunity[];
    profitAnalyses: DetailedProfitAnalysis[];
  }> {
    if (this.isScanning) {
      console.log('[Radar] A scan is already in progress, skipping...');
      return { opportunities: [], profitAnalyses: [] };
    }
    this.isScanning = true;

    try {
      const startTime = Date.now();

      // Step 1: Ensure CEX market catalogs are loaded
      await this.cexService.initMarkets();

      // Step 2: Discover top on-chain volume tokens
      console.log(`[Radar] Fetching Top ${this.config.topCount} volume tokens on ${this.config.chainName}...`);
      const candidates = await this.discovery.getTopTokenCandidates(
        this.config.chainId,
        this.config.topCount,
        this.config.manualWatchlist || ['BULLA', 'USELESS', 'AKE', 'XPIN']
      );
      console.log(`[Radar] Fetched ${candidates.length} candidate tokens from on-chain.`);

      // Step 3: Filter candidates that exist on at least one CEX
      const cexListedCandidates: TokenCandidate[] = [];
      for (const token of candidates) {
        if (this.cexService.hasCexMarket(token.symbol)) {
          cexListedCandidates.push(token);
        }
      }
      console.log(`[Radar] ${cexListedCandidates.length} of ${candidates.length} tokens have CEX USDT markets.`);

      // Step 4: Fetch live CEX prices & calculate coarse spreads
      const allOpportunities: ArbitrageOpportunity[] = [];
      for (const token of cexListedCandidates) {
        const cexPrices = await this.cexService.getCexPricesForToken(token.symbol);
        const opps = SpreadCalculator.calculateOpportunities(
          token,
          cexPrices,
          this.config.minSpreadPct
        );
        allOpportunities.push(...opps);
      }

      // Step 5: Sort opportunities by spread % descending
      allOpportunities.sort((a, b) => b.grossSpreadPct - a.grossSpreadPct);

      // Step 6 (Phase 2): For realistic opportunities, calculate depth-weighted executable net PnL
      const realisticOpps = allOpportunities.filter(
        o => o.grossSpreadPct <= this.maxRealisticSpread
      );
      const profitAnalyses: DetailedProfitAnalysis[] = [];

      if (realisticOpps.length > 0) {
        console.log(`[Phase 2] Evaluating order book depth & exact DEX quotes for ${realisticOpps.length} candidate(s)...`);

        for (const opp of realisticOpps) {
          try {
            // Fetch live order book
            const ob = await this.cexService.getOrderBook(
              opp.cexPrice.exchange,
              opp.cexPrice.symbol,
              20
            );
            if (!ob) continue;

            for (const size of this.testSizesUsd) {
              const dexQuote = await this.dexQuoteService.getDexQuote({
                chainId: opp.token.chainIndex,
                tokenAddress: opp.token.contractAddress,
                tokenPriceUsd: opp.dexPriceUsd,
                poolReserveUsd: opp.token.reserveUsd,
                tradeSizeUsd: size,
                direction: opp.direction,
              });

              const analysis = ProfitEngine.evaluateOpportunity({
                opportunity: opp,
                tradeSizeUsd: size,
                orderBook: ob,
                dexQuote,
              });
              profitAnalyses.push(analysis);
            }
          } catch (err: any) {
            console.warn(`[Phase 2] Quote evaluation failed for ${opp.token.symbol}: ${err.message}`);
          }
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.renderDashboard(
        candidates.length,
        cexListedCandidates.length,
        allOpportunities,
        profitAnalyses,
        elapsed
      );

      return { opportunities: allOpportunities, profitAnalyses };
    } catch (err: any) {
      console.error(`[Radar] Scan error: ${err.message}`);
      return { opportunities: [], profitAnalyses: [] };
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Start continuous scanning loop
   */
  public async startLoop(): Promise<void> {
    console.log(`\n========================================================================================================================`);
    console.log(`🚀 Starting DEX-CEX Arbitrage Radar (Phase 1: Discovery + Phase 2: Executable Depth Quotes)`);
    console.log(`Chain: ${this.config.chainName} (${this.config.chainId}) | Min Spread: ${this.config.minSpreadPct}% | Test Sizes: $${this.testSizesUsd.join(', $')}`);
    console.log(`Safe Mode: Zero private keys, Zero orders, Read-Only Quotes`);
    console.log(`========================================================================================================================\n`);

    // First scan immediately
    await this.scanOnce();

    // Loop
    setInterval(async () => {
      await this.scanOnce();
    }, this.config.refreshIntervalSec * 1000);
  }

  /**
   * Render visually clear terminal table including Phase 1 & Phase 2 results
   */
  private renderDashboard(
    totalTokens: number,
    cexTokens: number,
    opportunities: ArbitrageOpportunity[],
    profitAnalyses: DetailedProfitAnalysis[],
    elapsedSeconds: string
  ) {
    const now = new Date().toLocaleString();

    const realisticOpps = opportunities.filter(o => o.grossSpreadPct <= this.maxRealisticSpread);
    const suspiciousOpps = opportunities.filter(o => o.grossSpreadPct > this.maxRealisticSpread);

    const pad = (str: string, len: number) => (str + ' '.repeat(len)).slice(0, len);
    const rpad = (str: string, len: number) => (' '.repeat(len) + str).slice(-len);

    console.log('\n' + '='.repeat(125));
    console.log(`📊 [${now}] DEX-CEX ARBITRAGE RADAR | ${this.config.chainName} | Scan Time: ${elapsedSeconds}s`);
    console.log(`Scanned: ${totalTokens} tokens | CEX Listed: ${cexTokens} | Realistic Spreads (0.5% ~ ${this.maxRealisticSpread}%): ${realisticOpps.length}`);
    console.log('='.repeat(125));

    // 1. Phase 1 Radar Table
    if (realisticOpps.length > 0) {
      console.log('\n🎯 TARGET ARBITRAGE CANDIDATES (Coarse Spread):');
      console.log(
        pad('#', 4) +
        pad('TOKEN', 10) +
        pad('CONTRACT', 14) +
        rpad('DEX PRICE', 13) + '  ' +
        pad('CEX', 9) +
        rpad('CEX BID', 13) +
        rpad('CEX ASK', 13) +
        rpad('SPREAD', 10) + '   ' +
        pad('ACTION STRATEGY', 36)
      );
      console.log('-'.repeat(125));

      realisticOpps.forEach((opp, i) => {
        const idx = rpad((i + 1).toString(), 2);
        const sym = pad(opp.token.symbol, 9);
        const shortAddr = pad(this.formatAddr(opp.token.contractAddress), 13);
        const dexPx = rpad('$' + this.formatPrice(opp.dexPriceUsd), 13);
        const ex = pad(opp.cexPrice.exchange.toUpperCase(), 9);
        const bid = rpad('$' + this.formatPrice(opp.cexPrice.bid), 13);
        const ask = rpad('$' + this.formatPrice(opp.cexPrice.ask), 13);
        const spread = rpad(`+${opp.grossSpreadPct}%`, 9);

        const strategy =
          opp.direction === 'DEX_SELL_CEX_BUY'
            ? `[DEX Sell] -> [${opp.cexPrice.exchange.toUpperCase()} Buy]`
            : `[DEX Buy]  -> [${opp.cexPrice.exchange.toUpperCase()} Sell]`;

        console.log(
          `${idx}  ${sym} ${shortAddr} ${dexPx}  ${ex} ${bid} ${ask}  ${spread}   ${strategy}`
        );
      });
    } else {
      console.log(`  (No realistic spread between 0.5% and ${this.maxRealisticSpread}% found this pass.)`);
    }

    // 2. Phase 2 Executable Net PnL Table
    if (profitAnalyses.length > 0) {
      console.log('\n💰 PHASE 2: EXECUTABLE NET PROFIT & DEPTH ANALYSIS (二级可执行净利与深度测算):');
      console.log(
        pad('TOKEN', 9) +
        pad('CEX', 8) +
        rpad('SIZE', 8) +
        rpad('DEX SLIP', 10) +
        rpad('CEX SLIP', 10) +
        rpad('FEES+GAS', 10) +
        rpad('NET PNL($)', 12) +
        rpad('NET PNL(%)', 12) + '  ' +
        pad('STATUS', 14) +
        pad('VERDICT', 32)
      );
      console.log('-'.repeat(125));

      profitAnalyses.forEach(p => {
        const sym = pad(p.tokenSymbol, 8);
        const ex = pad(p.exchange, 7);
        const size = rpad(`$${p.tradeSizeUsd}`, 8);
        const dexSlip = rpad(`-${p.dexPriceImpactPct}%`, 9);
        const cexSlip = rpad(`-${p.cexDepthSlippagePct}%`, 9);
        const fees = rpad(`$${p.totalFrictionUsd}`, 9);
        const netSign = p.netProfitUsd >= 0 ? '+' : '';
        const netUsd = rpad(`${netSign}$${p.netProfitUsd}`, 11);
        const netPct = rpad(`${netSign}${p.netProfitPct}%`, 11);
        const status = pad(p.status, 13);

        console.log(
          `${sym} ${ex} ${size} ${dexSlip} ${cexSlip} ${fees} ${netUsd} ${netPct}  ${status} ${p.summary}`
        );
      });
    }

    // 3. Symbol collisions warning section
    if (suspiciousOpps.length > 0) {
      console.log('\n⚠️  SUSPECTED SYMBOL COLLISIONS / FAKE TOKEN ALERTS (Spread > ' + this.maxRealisticSpread + '%):');
      console.log('   (These are different tokens with identical ticker names; do NOT trade without manual contract audit!)');
      suspiciousOpps.slice(0, 5).forEach(opp => {
        const sym = pad(opp.token.symbol, 8);
        const addr = this.formatAddr(opp.token.contractAddress);
        const dexPx = '$' + this.formatPrice(opp.dexPriceUsd);
        const cexPx = '$' + this.formatPrice(opp.cexPrice.last);
        console.log(`   • ${sym} (${addr}): DEX=${dexPx} vs ${opp.cexPrice.exchange.toUpperCase()}=${cexPx} (Spread: +${opp.grossSpreadPct}%)`);
      });
    }

    console.log('\n' + '='.repeat(125) + '\n');
  }

  private formatAddr(addr: string): string {
    if (!addr || addr.length < 10) return addr || '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  private formatPrice(p: number): string {
    if (p >= 100) return p.toFixed(2);
    if (p >= 1) return p.toFixed(4);
    if (p >= 0.01) return p.toFixed(5);
    if (p >= 0.0001) return p.toFixed(7);
    return p.toExponential(3);
  }
}
