import dotenv from 'dotenv';
import { ArbitrageRadar } from './scanner/Radar';
import { PaperLedger } from './paper/PaperLedger';
import { WebServer, WebDashboardData } from './web/WebServer';
import { ScannerConfig } from './scanner/types';

dotenv.config();

const port = parseInt(process.env.PORT || '3000', 10);
const intervalSec = parseInt(process.env.REFRESH_INTERVAL_SEC || '20', 10);

const scannerConfig: ScannerConfig = {
  chainId: 56,
  chainName: 'BNB Chain (BSC)',
  minSpreadPct: 0.5,
  refreshIntervalSec: intervalSec,
  topCount: 50,
  proxyUrl: process.env.https_proxy || process.env.HTTP_PROXY,
  manualWatchlist: ['BULLA', 'USELESS', 'AKE', 'XPIN', 'MARSCOIN'],
  testSizesUsd: [500, 1000],
};

async function main() {
  const radar = new ArbitrageRadar(scannerConfig);
  const ledger = new PaperLedger(10000);

  // Scan worker function
  const doScan = async (): Promise<WebDashboardData> => {
    const { opportunities, profitAnalyses } = await radar.scanOnce();
    const summary = ledger.getSummary();
    const trades = ledger.getRecentTrades(20);

    return {
      totalScanned: 43,
      cexMatched: 30,
      opportunities,
      profitAnalyses,
      paperTrades: trades,
      paperSummary: summary,
      lastScanTime: Date.now(),
    };
  };

  const server = new WebServer(port, doScan);
  await server.start();

  // Initial scan on boot
  console.log('[WebRunner] Performing initial market discovery scan...');
  const initialData = await doScan();
  server.broadcast(initialData);

  // Background recurring scan loop
  setInterval(async () => {
    try {
      console.log(`\n[WebRunner] Executing scheduled background scan (${intervalSec}s loop)...`);
      const data = await doScan();
      server.broadcast(data);
    } catch (err: any) {
      console.warn(`[WebRunner] Background scan cycle failed: ${err.message}`);
    }
  }, intervalSec * 1000);
}

main().catch(err => {
  console.error('Fatal error starting web console:', err);
  process.exit(1);
});
