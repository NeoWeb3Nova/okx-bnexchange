import dotenv from 'dotenv';
import { ArbitrageRadar } from './scanner/Radar';
import { ScannerConfig } from './scanner/types';

dotenv.config();

console.log('\n========================================================================================================================');
console.log('⚡ OKX-CEX CROSS-MARKET ARBITRAGE SYSTEM (QUANT RADAR & EXECUTION ENGINE)');
console.log('========================================================================================================================\n');

const chainId = 56;
const minSpreadPct = parseFloat(process.env.MIN_SPREAD_PCT || '0.5');
const refreshIntervalSec = parseInt(process.env.REFRESH_INTERVAL_SEC || '20', 10);

const config: ScannerConfig = {
  chainId,
  chainName: 'BNB Chain (BSC)',
  minSpreadPct,
  refreshIntervalSec,
  topCount: 50,
  proxyUrl: process.env.https_proxy || process.env.HTTP_PROXY,
  manualWatchlist: ['BULLA', 'USELESS', 'AKE', 'XPIN', 'MARSCOIN'],
  testSizesUsd: [500, 1000],
};

async function main() {
  const radar = new ArbitrageRadar(config);
  await radar.startLoop();
}

main().catch(err => {
  console.error('Fatal error in application:', err);
  process.exit(1);
});
