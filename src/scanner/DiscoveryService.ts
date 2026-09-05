import axios from 'axios';
import crypto from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { TokenCandidate } from './types';

export class DiscoveryService {
  private proxyAgent?: any;

  constructor(private proxyUrl?: string) {
    const activeProxy = proxyUrl || process.env.https_proxy || process.env.HTTP_PROXY;
    if (activeProxy) {
      this.proxyAgent = new HttpsProxyAgent(activeProxy);
    }
  }

  /**
   * Primary entry point: fetches top volume token candidates on BSC (or specified chain)
   */
  public async getTopTokenCandidates(
    chainId: number = 56,
    limit: number = 50,
    watchlist: string[] = []
  ): Promise<TokenCandidate[]> {
    const candidatesMap = new Map<string, TokenCandidate>();

    // 1. Try OKX Web3 API if credentials exist
    if (process.env.OKX_API_KEY && process.env.OKX_SECRET_KEY) {
      try {
        const okxTokens = await this.fetchOkxToplist(chainId, limit);
        for (const t of okxTokens) {
          candidatesMap.set(t.contractAddress.toLowerCase(), t);
        }
      } catch (err: any) {
        console.warn(`[Discovery] OKX Web3 Toplist API failed: ${err.message}, falling back to public on-chain sources.`);
      }
    }

    // 2. If OKX didn't return enough or no credentials, fetch from GeckoTerminal (BSC Top Pools)
    if (candidatesMap.size < 10) {
      try {
        const geckoTokens = await this.fetchGeckoTerminalTopPools(chainId, limit);
        for (const t of geckoTokens) {
          if (!candidatesMap.has(t.contractAddress.toLowerCase())) {
            candidatesMap.set(t.contractAddress.toLowerCase(), t);
          }
        }
      } catch (err: any) {
        console.warn(`[Discovery] GeckoTerminal fetch error: ${err.message}`);
      }
    }

    // 3. For any token in watchlist that isn't in top volume, fetch via DexScreener
    if (watchlist.length > 0) {
      for (const symbol of watchlist) {
        const exists = Array.from(candidatesMap.values()).some(
          c => c.symbol.toUpperCase() === symbol.toUpperCase()
        );
        if (!exists) {
          try {
            const extra = await this.fetchDexScreenerToken(symbol, chainId);
            if (extra) {
              candidatesMap.set(extra.contractAddress.toLowerCase(), extra);
            }
          } catch {
            // Ignore individual token fetch failure
          }
        }
      }
    }

    return Array.from(candidatesMap.values()).sort(
      (a, b) => (b.volume24hUsd || 0) - (a.volume24hUsd || 0)
    );
  }

  /**
   * Fetch from OKX OnchainOS / Web3 Toplist API
   */
  private async fetchOkxToplist(chainId: number, limit: number): Promise<TokenCandidate[]> {
    const apiKey = process.env.OKX_API_KEY!;
    const secretKey = process.env.OKX_SECRET_KEY!;
    const passphrase = process.env.OKX_API_PASSPHRASE || '';
    const projectId = process.env.OKX_PROJECT_ID || '';

    const path = `/api/v6/dex/market/token/toplist?chainId=${chainId}&sortBy=5&timeFrame=2`;
    const timestamp = new Date().toISOString();
    const sign = crypto
      .createHmac('sha256', secretKey)
      .update(timestamp + 'GET' + path)
      .digest('base64');

    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
    };
    if (projectId) {
      headers['OK-ACCESS-PROJECT'] = projectId;
    }

    const response = await axios.get(`https://web3.okx.com${path}`, {
      headers,
      httpsAgent: this.proxyAgent,
      timeout: 15000,
    });

    if (response.data.code !== '0' && response.data.code !== 0) {
      throw new Error(`OKX Toplist Error: ${response.data.msg || response.data.code}`);
    }

    const list: any[] = response.data.data || [];
    return list.slice(0, limit).map(item => ({
      symbol: (item.tokenSymbol || item.symbol || '').toUpperCase(),
      name: item.tokenName || item.name || '',
      contractAddress: item.tokenContractAddress || item.contractAddress || '',
      chainIndex: chainId,
      chainName: chainId === 56 ? 'BSC' : 'EVM',
      priceUsd: parseFloat(item.price || item.tokenUnitPrice || '0'),
      volume24hUsd: parseFloat(item.volume24h || item.volume || '0'),
      source: 'okx',
    }));
  }

  /**
   * Fallback: Fetch top BSC liquidity pools from GeckoTerminal with retry
   */
  private async fetchGeckoTerminalTopPools(chainId: number, limit: number): Promise<TokenCandidate[]> {
    const network = chainId === 56 ? 'bsc' : chainId === 1 ? 'eth' : chainId === 8453 ? 'base' : 'bsc';
    const pagesToFetch = Math.min(Math.ceil(limit / 20), 3); // Fetch up to 3 pages (60 pools)
    const candidates: TokenCandidate[] = [];
    const ignoredSymbols = new Set(['WBNB', 'USDT', 'USDC', 'BUSD', 'DAI', 'ETH', 'BTC', 'BTCB']);

    for (let page = 1; page <= pagesToFetch; page++) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await axios.get(
            `https://api.geckoterminal.com/api/v2/networks/${network}/pools?page=${page}`,
            {
              httpsAgent: this.proxyAgent,
              headers: { Accept: 'application/json;version=20230302' },
              timeout: 15000,
            }
          );

          const pools = res.data?.data || [];
          for (const pool of pools) {
            const attr = pool.attributes;
            const name: string = attr.name || '';
            const tokensInName = name.split('/')[0]?.trim();
            const baseTokenSymbol = tokensInName.split(' ')[0]?.trim().toUpperCase();

            if (!baseTokenSymbol || ignoredSymbols.has(baseTokenSymbol)) continue;

            const baseTokenRel = pool.relationships?.base_token?.data?.id || '';
            const contractAddress = baseTokenRel.includes('_')
              ? baseTokenRel.split('_')[1]
              : attr.address;

            const priceUsd = parseFloat(attr.base_token_price_usd || '0');
            const vol24h = parseFloat(attr.volume_usd?.h24 || '0');
            const reserve = parseFloat(attr.reserve_in_usd || '0');

            if (priceUsd > 0 && vol24h > 10000) {
              candidates.push({
                symbol: baseTokenSymbol,
                name: baseTokenSymbol,
                contractAddress,
                chainIndex: chainId,
                chainName: 'BSC',
                priceUsd,
                volume24hUsd: vol24h,
                reserveUsd: reserve,
                source: 'geckoterminal',
              });
            }
          }
          break; // Succeeded, exit retry loop
        } catch (err: any) {
          if (attempt === 2) {
            console.warn(`[Discovery] Page ${page} failed after 2 attempts: ${err.message}`);
          } else {
            await new Promise(res => setTimeout(res, 800));
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Fallback for watchlist tokens: search DexScreener
   */
  private async fetchDexScreenerToken(symbol: string, chainId: number): Promise<TokenCandidate | null> {
    try {
      const chainName = chainId === 56 ? 'bsc' : 'bsc';
      const res = await axios.get(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`,
        {
          httpsAgent: this.proxyAgent,
          timeout: 10000,
        }
      );
      const pairs: any[] = res.data?.pairs || [];
      const match = pairs.find(
        p =>
          p.chainId === chainName &&
          p.baseToken?.symbol?.toUpperCase() === symbol.toUpperCase()
      );
      if (match) {
        return {
          symbol: match.baseToken.symbol.toUpperCase(),
          name: match.baseToken.name || match.baseToken.symbol,
          contractAddress: match.baseToken.address,
          chainIndex: chainId,
          chainName: 'BSC',
          priceUsd: parseFloat(match.priceUsd || '0'),
          volume24hUsd: parseFloat(match.volume?.h24 || '0'),
          reserveUsd: parseFloat(match.liquidity?.usd || '0'),
          source: 'dexscreener',
        };
      }
    } catch {
      // Ignore
    }
    return null;
  }
}
