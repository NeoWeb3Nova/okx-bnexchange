import ccxt, { Exchange } from 'ccxt';
import { CexMarketPrice } from './types';

export class CexPriceService {
  private exchanges: Map<string, Exchange> = new Map();
  private marketsInitialized: boolean = false;
  private activeProxy?: string;
  // Map of uppercase symbol (e.g. "AKE") -> list of { exchange: 'gate', symbol: 'AKE/USDT' }
  private symbolIndex: Map<string, Array<{ exchange: string; pair: string }>> = new Map();

  constructor(proxyUrl?: string) {
    this.activeProxy = proxyUrl || process.env.https_proxy || process.env.HTTP_PROXY;
    this.initExchanges();
  }

  private initExchanges() {
    // 1. Binance (using data-api.binance.vision public mirror to bypass regional blocks)
    const binance = new ccxt.binance({
      httpsProxy: this.activeProxy,
      timeout: 15000,
      options: {
        defaultType: 'spot',
        fetchMarkets: ['spot'],
      },
    });
    binance.urls.api.public = 'https://data-api.binance.vision/api/v3';
    this.exchanges.set('binance', binance);

    // 2. OKX Spot
    const okx = new ccxt.okx({
      httpsProxy: this.activeProxy,
      timeout: 15000,
      options: {
        defaultType: 'spot',
        fetchMarkets: ['spot'],
      },
    });
    this.exchanges.set('okx', okx);

    // 3. Gate.io Spot
    const gate = new ccxt.gate({
      httpsProxy: this.activeProxy,
      timeout: 15000,
      options: {
        defaultType: 'spot',
        fetchMarkets: ['spot'],
        swap: { fetchMarkets: false },
        future: { fetchMarkets: false },
      },
    });
    gate.has['fetchCurrencies'] = false;
    this.exchanges.set('gate', gate);

    // 4. Bybit Spot
    const bybit = new ccxt.bybit({
      httpsProxy: this.activeProxy,
      timeout: 15000,
      options: {
        defaultType: 'spot',
        fetchMarkets: ['spot'],
      },
    });
    this.exchanges.set('bybit', bybit);
  }

  /**
   * Preload market symbol tables for all exchanges with automatic retry
   */
  public async initMarkets(): Promise<void> {
    if (this.marketsInitialized) return;

    console.log('[CEX] Loading market catalogs from Binance, OKX, Gate, and Bybit...');
    const tasks: Promise<void>[] = [];

    for (const [name, ex] of this.exchanges.entries()) {
      tasks.push(
        (async () => {
          let loaded = false;
          let lastErr: any = null;

          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await ex.loadMarkets();
              const spotCount = Object.keys(ex.markets || {}).length;
              console.log(`[CEX] ${name.toUpperCase()} markets loaded (${spotCount} spot pairs)`);

              // Index all USDT spot pairs
              for (const market of Object.values(ex.markets || {})) {
                if (market && market.spot && market.quote === 'USDT' && market.base) {
                  const base = market.base.toUpperCase();
                  if (!this.symbolIndex.has(base)) {
                    this.symbolIndex.set(base, []);
                  }
                  this.symbolIndex.get(base)!.push({ exchange: name, pair: market.symbol });
                }
              }
              loaded = true;
              break;
            } catch (err: any) {
              lastErr = err;
              if (err.message && (err.message.includes('403') || err.message.includes('country'))) {
                // Geo-block, do not retry
                break;
              }
              await new Promise(res => setTimeout(res, 1000));
            }
          }

          if (!loaded) {
            console.warn(`[CEX] Skipped ${name}: ${lastErr?.message || 'timeout'}`);
            this.exchanges.delete(name);
          }
        })()
      );
    }

    await Promise.all(tasks);
    this.marketsInitialized = true;
    console.log(`[CEX] Total indexed distinct CEX tokens with USDT pairs: ${this.symbolIndex.size}`);
  }

  /**
   * Quick check if any CEX has a USDT pair for this token
   */
  public hasCexMarket(symbol: string): boolean {
    return this.symbolIndex.has(symbol.toUpperCase());
  }

  /**
   * Get CEX listings for this token
   */
  public getCexListings(symbol: string): Array<{ exchange: string; pair: string }> {
    return this.symbolIndex.get(symbol.toUpperCase()) || [];
  }

  /**
   * Fetch live best bid / best ask for a token across all exchanges where it is listed
   */
  public async getCexPricesForToken(symbol: string): Promise<CexMarketPrice[]> {
    if (!this.marketsInitialized) {
      await this.initMarkets();
    }

    const listings = this.symbolIndex.get(symbol.toUpperCase());
    if (!listings || listings.length === 0) {
      return [];
    }

    const results: CexMarketPrice[] = [];
    const tickerTasks: Promise<void>[] = [];

    for (const item of listings) {
      const ex = this.exchanges.get(item.exchange);
      if (!ex) continue;

      tickerTasks.push(
        (async () => {
          try {
            const ticker = await ex.fetchTicker(item.pair);
            const bid = ticker.bid ?? ticker.last ?? 0;
            const ask = ticker.ask ?? ticker.last ?? 0;
            const last = ticker.last ?? 0;

            if (bid > 0 && ask > 0) {
              results.push({
                exchange: item.exchange as any,
                symbol: item.pair,
                marketType: 'spot',
                bid,
                ask,
                last,
                bidQty: ticker.bidVolume,
                askQty: ticker.askVolume,
                timestamp: ticker.timestamp || Date.now(),
              });
            }
          } catch {
            // Silently catch single-ticker fetch error
          }
        })()
      );
    }

    await Promise.all(tickerTasks);
    return results;
  }

  /**
   * Fetch live order book depth (top bids and asks)
   */
  public async getOrderBook(
    exchangeName: string,
    pair: string,
    limit: number = 20
  ): Promise<{ bids: number[][]; asks: number[][] } | null> {
    const ex = this.exchanges.get(exchangeName.toLowerCase());
    if (!ex) return null;

    try {
      const ob = await ex.fetchOrderBook(pair, limit);
      return {
        bids: (ob.bids as number[][]) || [],
        asks: (ob.asks as number[][]) || [],
      };
    } catch {
      return null;
    }
  }
}

