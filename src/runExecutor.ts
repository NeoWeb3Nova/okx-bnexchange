import dotenv from 'dotenv';
import ccxt, { Exchange } from 'ccxt';
import { ArbitrageRadar } from './scanner/Radar';
import { ExecutionEngine } from './execution/ExecutionEngine';
import { ExecutionConfig } from './execution/types';
import { ScannerConfig } from './scanner/types';

dotenv.config();

const args = process.argv.slice(2);
const isLiveFlag = args.includes('--live');
const isOnce = args.includes('--once');

const getArgVal = (flag: string, defaultVal: string): string => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
};

const maxTradeSize = parseFloat(getArgVal('--max-size', '500'));
const minNetProfit = parseFloat(getArgVal('--min-net', '1.5'));
const minNetPct = parseFloat(getArgVal('--min-pct', '0.35'));
const intervalSec = parseInt(getArgVal('--interval', '20'), 10);

// Safety lock: Live trading requires BOTH --live flag AND CONFIRM_LIVE_TRADING=true in .env
let isLiveTrading = false;
if (isLiveFlag) {
  if (process.env.CONFIRM_LIVE_TRADING === 'true') {
    isLiveTrading = true;
  } else {
    console.warn(
      '\n⚠️  [SAFETY WARNING] Flag --live detected, but CONFIRM_LIVE_TRADING=true is NOT set in .env!'
    );
    console.warn('   Falling back to 100% safe DRY-RUN mode to prevent accidental fund loss.\n');
  }
}

const execConfig: ExecutionConfig = {
  isLiveTrading,
  maxTradeSizeUsd: maxTradeSize,
  minNetProfitUsd: minNetProfit,
  minNetProfitPct: minNetPct,
  maxSlippagePct: 0.5,
  dailyMaxLossUsd: 50,
  maxConsecutiveFailures: 3,
  gasPriceMultiplier: 1.1,
  walletAddress: process.env.WALLET_ADDRESS,
  rpcUrl: process.env.EVM_RPC_URL || 'https://binance.llamarpc.com',
  proxyUrl: process.env.https_proxy || process.env.HTTP_PROXY,
};

const scannerConfig: ScannerConfig = {
  chainId: 56,
  chainName: 'BNB Chain (BSC)',
  minSpreadPct: 0.5,
  refreshIntervalSec: intervalSec,
  topCount: 50,
  proxyUrl: execConfig.proxyUrl,
  manualWatchlist: ['BULLA', 'USELESS', 'AKE', 'XPIN', 'MARSCOIN'],
  testSizesUsd: [maxTradeSize],
};

async function main() {
  console.log('\n========================================================================================================================');
  console.log(`⚡ PHASE 4: AUTOMATED ARBITRAGE EXECUTION ENGINE`);
  console.log(`Mode: ${isLiveTrading ? '🔴 LIVE REAL EXECUTION' : '🟢 SAFE DRY RUN (No funds spent)'}`);
  console.log(`Max Trade Size: $${maxTradeSize} | Min Net Profit: $${minNetProfit} (+${minNetPct}%) | Circuit Breaker: $50 daily cap`);
  console.log('========================================================================================================================\n');

  // Initialize CCXT exchange map with credentials if available
  const exchangeClients = new Map<string, Exchange>();
  const proxy = execConfig.proxyUrl;

  const binance = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    httpsProxy: proxy,
    options: { defaultType: 'spot' },
  });
  binance.urls.api.public = 'https://data-api.binance.vision/api/v3';
  exchangeClients.set('binance', binance);

  const gate = new ccxt.gate({
    apiKey: process.env.GATE_API_KEY,
    secret: process.env.GATE_API_SECRET,
    httpsProxy: proxy,
    timeout: 15000,
    options: {
      defaultType: 'spot',
      fetchMarkets: ['spot'],
      swap: { fetchMarkets: false },
      future: { fetchMarkets: false },
    },
  });
  gate.has['fetchCurrencies'] = false;
  exchangeClients.set('gate', gate);

  const okx = new ccxt.okx({
    apiKey: process.env.OKX_API_KEY,
    secret: process.env.OKX_SECRET_KEY,
    password: process.env.OKX_API_PASSPHRASE,
    httpsProxy: proxy,
    options: { defaultType: 'spot' },
  });
  exchangeClients.set('okx', okx);

  const radar = new ArbitrageRadar(scannerConfig);
  const executor = new ExecutionEngine(execConfig, exchangeClients);

  if (isLiveTrading && process.env.EVM_PRIVATE_KEY) {
    executor.setWallet(process.env.EVM_PRIVATE_KEY);
  }

  const runPass = async () => {
    const { opportunities, profitAnalyses } = await radar.scanOnce();

    const actionable = profitAnalyses.filter(
      a => a.status === 'PROFITABLE' && a.tradeSizeUsd <= maxTradeSize
    );

    if (actionable.length > 0) {
      console.log(`\n[Executor] Found ${actionable.length} verified profitable candidate(s) ready for execution:`);

      for (const analysis of actionable) {
        const opp = opportunities.find(
          o => o.token.symbol === analysis.tokenSymbol && o.cexPrice.exchange.toUpperCase() === analysis.exchange
        );
        if (opp) {
          await executor.executeArbitrage({ opportunity: opp, analysis });
        }
      }
    } else {
      console.log('\n[Executor] No opportunities met the execution criteria this pass.');
    }
  };

  await runPass();

  if (!isOnce) {
    setInterval(async () => {
      if (!executor.getRiskGuard().isTripped()) {
        await runPass();
      } else {
        console.warn('[Executor] Execution paused: Circuit breaker is tripped!');
      }
    }, scannerConfig.refreshIntervalSec * 1000);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error in executor:', err);
  process.exit(1);
});
