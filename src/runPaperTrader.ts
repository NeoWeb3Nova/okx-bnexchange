import dotenv from 'dotenv';
import { ArbitrageRadar } from './scanner/Radar';
import { PaperTrader } from './paper/PaperTrader';
import { CexPriceService } from './scanner/CexPriceService';
import { DexQuoteService } from './pricing/DexQuoteService';
import { ScannerConfig } from './scanner/types';

dotenv.config();

const args = process.argv.slice(2);
const isOnce = args.includes('--once');

const getArgVal = (flag: string, defaultVal: string): string => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
};

const chainId = parseInt(getArgVal('--chain', '56'), 10);
const minSpreadPct = parseFloat(getArgVal('--min-spread', '0.5'));
const intervalSec = parseInt(getArgVal('--interval', '20'), 10);
const latencyMs = parseInt(getArgVal('--latency', '2500'), 10);
const startBalance = parseFloat(getArgVal('--balance', '10000'));

const config: ScannerConfig = {
  chainId,
  chainName: chainId === 56 ? 'BNB Chain (BSC)' : `Chain ${chainId}`,
  minSpreadPct,
  refreshIntervalSec: intervalSec,
  topCount: 50,
  proxyUrl: process.env.https_proxy || process.env.HTTP_PROXY,
  manualWatchlist: ['BULLA', 'USELESS', 'AKE', 'XPIN', 'MARSCOIN'],
  testSizesUsd: [500, 1000],
};

async function main() {
  const radar = new ArbitrageRadar(config);
  const cexService = new CexPriceService(config.proxyUrl);
  const dexQuoteService = new DexQuoteService(config.proxyUrl);
  const paperTrader = new PaperTrader(cexService, dexQuoteService, startBalance);

  console.log('\n========================================================================================================================');
  console.log(`🎮 STARTING PHASE 3: SHADOW PAPER TRADING ENGINE`);
  console.log(`Starting Portfolio: $${startBalance} | Simulated Block Latency: ${latencyMs}ms | Chain: ${config.chainName}`);
  console.log(`Persistence Tracking: Active | Trade Log: data/paper_trades.json | Safe Mode: 100% Read-Only`);
  console.log('========================================================================================================================\n');

  const executePass = async () => {
    const { opportunities, profitAnalyses } = await radar.scanOnce();

    if (profitAnalyses.length > 0) {
      await paperTrader.processBatch(opportunities, profitAnalyses, latencyMs);
    }

    paperTrader.renderPhase3Dashboard();
  };

  await executePass();

  if (!isOnce) {
    setInterval(async () => {
      await executePass();
    }, config.refreshIntervalSec * 1000);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error in paper trader:', err);
  process.exit(1);
});
