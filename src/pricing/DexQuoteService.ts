import axios from 'axios';
import crypto from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface DexQuoteResult {
  fromAmountUsd: number;
  toAmountUsd: number;
  dexFillPrice: number;
  priceImpactPct: number;
  gasFeeUsd: number;
  source: 'okx_aggregator' | 'amm_pool_simulation';
}

export class DexQuoteService {
  private proxyAgent?: any;

  constructor(proxyUrl?: string) {
    const activeProxy = proxyUrl || process.env.https_proxy || process.env.HTTP_PROXY;
    if (activeProxy) {
      this.proxyAgent = new HttpsProxyAgent(activeProxy);
    }
  }

  /**
   * Get exact executable quote on DEX for a given trade size in USD
   */
  public async getDexQuote(params: {
    chainId: number;
    tokenAddress: string;
    tokenPriceUsd: number;
    poolReserveUsd?: number;
    tradeSizeUsd: number;
    direction: 'DEX_SELL_CEX_BUY' | 'DEX_BUY_CEX_SELL';
  }): Promise<DexQuoteResult> {
    const { chainId, tokenAddress, tokenPriceUsd, poolReserveUsd, tradeSizeUsd, direction } = params;

    // 1. Try OKX Aggregator Quote if credentials exist
    if (process.env.OKX_API_KEY && process.env.OKX_SECRET_KEY) {
      try {
        const okxQuote = await this.fetchOkxQuote({
          chainId,
          tokenAddress,
          tradeSizeUsd,
          tokenPriceUsd,
          direction,
        });
        if (okxQuote) return okxQuote;
      } catch (err: any) {
        // Fallback to simulation
      }
    }

    // 2. Fallback: AMM Liquidity Curve Simulation (Constant Product / Concentrated model)
    return this.simulateAmmQuote({
      tokenPriceUsd,
      poolReserveUsd: poolReserveUsd || 500000, // Default 500k reserve if unknown
      tradeSizeUsd,
      direction,
    });
  }

  /**
   * Query OKX DEX Aggregator Quote API
   */
  private async fetchOkxQuote(params: {
    chainId: number;
    tokenAddress: string;
    tradeSizeUsd: number;
    tokenPriceUsd: number;
    direction: 'DEX_SELL_CEX_BUY' | 'DEX_BUY_CEX_SELL';
  }): Promise<DexQuoteResult | null> {
    const { chainId, tokenAddress, tradeSizeUsd, tokenPriceUsd, direction } = params;
    const usdtAddress = '0x55d398326f99059fF775485246999027B3197955'; // BSC USDT

    const fromToken = direction === 'DEX_SELL_CEX_BUY' ? tokenAddress : usdtAddress;
    const toToken = direction === 'DEX_SELL_CEX_BUY' ? usdtAddress : tokenAddress;

    // Estimate amount in wei (assuming 18 decimals for rough quote)
    const tokenAmount = tradeSizeUsd / tokenPriceUsd;
    const amountStr =
      direction === 'DEX_SELL_CEX_BUY'
        ? BigInt(Math.floor(tokenAmount * 1e18)).toString()
        : BigInt(Math.floor(tradeSizeUsd * 1e18)).toString();

    const path = `/api/v6/dex/aggregator/quote?chainIndex=${chainId}&amount=${amountStr}&fromTokenAddress=${fromToken}&toTokenAddress=${toToken}&slippagePercent=0.005`;
    const timestamp = new Date().toISOString();
    const sign = crypto
      .createHmac('sha256', process.env.OKX_SECRET_KEY!)
      .update(timestamp + 'GET' + path)
      .digest('base64');

    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': process.env.OKX_API_KEY!,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': process.env.OKX_API_PASSPHRASE || '',
    };
    if (process.env.OKX_PROJECT_ID) {
      headers['OK-ACCESS-PROJECT'] = process.env.OKX_PROJECT_ID;
    }

    const res = await axios.get(`https://web3.okx.com${path}`, {
      headers,
      httpsAgent: this.proxyAgent,
      timeout: 8000,
    });

    if (res.data.code === '0' && res.data.data?.[0]) {
      const q = res.data.data[0];
      const toAmount = parseFloat(q.toTokenAmount || '0') / 1e18;
      const gasFeeUsd = parseFloat(q.estimateGasFeeUsd || '0.15');
      const priceImpact = parseFloat(q.priceImpact || '0');

      return {
        fromAmountUsd: tradeSizeUsd,
        toAmountUsd: direction === 'DEX_SELL_CEX_BUY' ? toAmount : toAmount * tokenPriceUsd,
        dexFillPrice: direction === 'DEX_SELL_CEX_BUY' ? toAmount / tokenAmount : tradeSizeUsd / toAmount,
        priceImpactPct: priceImpact,
        gasFeeUsd,
        source: 'okx_aggregator',
      };
    }
    return null;
  }

  /**
   * Fallback: Accurate AMM constant-product slippage calculation
   */
  private simulateAmmQuote(params: {
    tokenPriceUsd: number;
    poolReserveUsd: number;
    tradeSizeUsd: number;
    direction: 'DEX_SELL_CEX_BUY' | 'DEX_BUY_CEX_SELL';
  }): DexQuoteResult {
    const { tokenPriceUsd, poolReserveUsd, tradeSizeUsd, direction } = params;

    // In a typical liquidity pool, half the reserve is token and half is quote (USDT/WBNB)
    const sideReserveUsd = Math.max(poolReserveUsd / 2, 50000);
    // Standard AMM price impact: size / (reserve + size)
    const priceImpactPct = (tradeSizeUsd / (sideReserveUsd + tradeSizeUsd)) * 100;
    // Standard DEX swap fee: 0.25%
    const dexFeePct = 0.25;

    const totalDeductionPct = (priceImpactPct + dexFeePct) / 100;
    const effectiveFillPrice =
      direction === 'DEX_SELL_CEX_BUY'
        ? tokenPriceUsd * (1 - totalDeductionPct)
        : tokenPriceUsd * (1 + totalDeductionPct);

    const toAmountUsd = tradeSizeUsd * (1 - totalDeductionPct);
    const gasFeeUsd = 0.15; // Typical BSC Gas fee (~$0.10 - $0.20)

    return {
      fromAmountUsd: tradeSizeUsd,
      toAmountUsd: Number(toAmountUsd.toFixed(3)),
      dexFillPrice: effectiveFillPrice,
      priceImpactPct: Number(priceImpactPct.toFixed(3)),
      gasFeeUsd,
      source: 'amm_pool_simulation',
    };
  }
}
