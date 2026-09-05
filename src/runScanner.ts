import dotenv from 'dotenv';
import { ArbitrageRadar } from './scanner/Radar';
import { ScannerConfig } from './scanner/types';

dotenv.config();

// Parse command line arguments or use defaults
const args = process.argv.slice(2);
const isOnce = args.includes('--once');

const getArgVal = (flag: string, defaultVal: string): string => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
};

const chainId = parseInt(getArgVal('--chain', '56'), 10);
const minSpreadPct = parseFloat(getArgVal('--min-spread', '0.5'));
const intervalSec = parseInt(getArgVal('--interval', '30'), 10);
const topCount = parseInt(getArgVal('--top', '50'), 10);

const config: ScannerConfig = {
  chainId,
  chainName: chainId === 56 ? 'BNB Chain (BSC)' : `Chain ${chainId}`,
  minSpreadPct,
  refreshIntervalSec: intervalSec,
  topCount,
  proxyUrl: process.env.https_proxy || process.env.HTTP_PROXY,
  manualWatchlist: ['BULLA', 'USELESS', 'AKE', 'XPIN', 'CAKE', 'TWT'],
};

async function main() {
  const radar = new ArbitrageRadar(config);

  if (isOnce) {
    console.log('[Runner] Running in single-pass mode (--once)...');
    await radar.scanOnce();
    process.exit(0);
  } else {
    await radar.startLoop();
  }
}

main().catch(err => {
  console.error('Fatal error running scanner:', err);
  process.exit(1);
});
