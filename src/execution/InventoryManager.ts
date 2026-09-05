import { ethers } from 'ethers';
import { Exchange } from 'ccxt';
import { InventoryState } from './types';

export class InventoryManager {
  private provider?: ethers.JsonRpcProvider;
  private walletAddress?: string;

  constructor(
    rpcUrl?: string,
    walletAddress?: string
  ) {
    this.walletAddress = walletAddress;
    if (rpcUrl) {
      try {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
      } catch {
        // Ignore provider init failure
      }
    }
  }

  /**
   * Verify if both legs have sufficient inventory for the trade direction
   */
  public async checkInventoryForTrade(params: {
    exchangeClient?: Exchange;
    tokenSymbol: string;
    tokenAddress: string;
    direction: 'DEX_SELL_CEX_BUY' | 'DEX_BUY_CEX_SELL';
    sizeUsd: number;
    tokenPriceUsd: number;
    isDryRun: boolean;
  }): Promise<InventoryState> {
    const {
      exchangeClient,
      tokenSymbol,
      tokenAddress,
      direction,
      sizeUsd,
      tokenPriceUsd,
      isDryRun,
    } = params;

    const requiredTokens = tokenPriceUsd > 0 ? sizeUsd / tokenPriceUsd : 0;

    // If Dry Run and credentials not fully configured, return a mock sufficient state for simulation
    if (isDryRun && (!this.provider || !this.walletAddress || !exchangeClient?.apiKey)) {
      return {
        walletBnbBalance: 1.5,
        walletUsdtBalance: 5000,
        walletTokenBalance: requiredTokens * 2,
        cexUsdtBalance: 5000,
        cexTokenBalance: requiredTokens * 2,
        isSufficient: true,
      };
    }

    let walletBnb = 0;
    let walletUsdt = 0;
    let walletToken = 0;
    let cexUsdt = 0;
    let cexToken = 0;

    // 1. Fetch On-Chain Wallet Balances
    if (this.provider && this.walletAddress) {
      try {
        const rawBnb = await this.provider.getBalance(this.walletAddress);
        walletBnb = parseFloat(ethers.formatEther(rawBnb));

        const usdtContract = new ethers.Contract(
          '0x55d398326f99059fF775485246999027B3197955', // BSC USDT
          ['function balanceOf(address) view returns (uint256)'],
          this.provider
        );
        const rawUsdt = await usdtContract.balanceOf(this.walletAddress);
        walletUsdt = parseFloat(ethers.formatUnits(rawUsdt, 18));

        if (tokenAddress) {
          const tokenContract = new ethers.Contract(
            tokenAddress,
            ['function balanceOf(address) view returns (uint256)'],
            this.provider
          );
          const rawToken = await tokenContract.balanceOf(this.walletAddress);
          walletToken = parseFloat(ethers.formatUnits(rawToken, 18));
        }
      } catch (err: any) {
        console.warn(`[Inventory] On-chain balance check failed: ${err.message}`);
      }
    }

    // 2. Fetch CEX Balances
    if (exchangeClient && exchangeClient.apiKey) {
      try {
        const balance = await exchangeClient.fetchBalance();
        cexUsdt = (balance.free as any)?.['USDT'] || 0;
        cexToken = (balance.free as any)?.[tokenSymbol.toUpperCase()] || 0;
      } catch (err: any) {
        console.warn(`[Inventory] CEX balance check failed: ${err.message}`);
      }
    }

    // 3. Validation Logic
    const minGasBnb = 0.005; // ~0.005 BNB needed for gas
    if (walletBnb < minGasBnb) {
      return {
        walletBnbBalance: walletBnb,
        walletUsdtBalance: walletUsdt,
        walletTokenBalance: walletToken,
        cexUsdtBalance: cexUsdt,
        cexTokenBalance: cexToken,
        isSufficient: false,
        reason: `Insufficient gas in on-chain wallet: have ${walletBnb.toFixed(4)} BNB, need >= ${minGasBnb} BNB`,
      };
    }

    if (direction === 'DEX_BUY_CEX_SELL') {
      // Need USDT on-chain to buy, and Token on CEX to sell
      if (walletUsdt < sizeUsd) {
        return {
          walletBnbBalance: walletBnb,
          walletUsdtBalance: walletUsdt,
          walletTokenBalance: walletToken,
          cexUsdtBalance: cexUsdt,
          cexTokenBalance: cexToken,
          isSufficient: false,
          reason: `Insufficient on-chain USDT: have $${walletUsdt.toFixed(2)}, need $${sizeUsd}`,
        };
      }
      if (cexToken < requiredTokens) {
        return {
          walletBnbBalance: walletBnb,
          walletUsdtBalance: walletUsdt,
          walletTokenBalance: walletToken,
          cexUsdtBalance: cexUsdt,
          cexTokenBalance: cexToken,
          isSufficient: false,
          reason: `Insufficient CEX ${tokenSymbol}: have ${cexToken.toFixed(2)}, need ${requiredTokens.toFixed(2)}`,
        };
      }
    } else {
      // DEX_SELL_CEX_BUY: Need Token on-chain to sell, and USDT on CEX to buy
      if (walletToken < requiredTokens) {
        return {
          walletBnbBalance: walletBnb,
          walletUsdtBalance: walletUsdt,
          walletTokenBalance: walletToken,
          cexUsdtBalance: cexUsdt,
          cexTokenBalance: cexToken,
          isSufficient: false,
          reason: `Insufficient on-chain ${tokenSymbol}: have ${walletToken.toFixed(2)}, need ${requiredTokens.toFixed(2)}`,
        };
      }
      if (cexUsdt < sizeUsd) {
        return {
          walletBnbBalance: walletBnb,
          walletUsdtBalance: walletUsdt,
          walletTokenBalance: walletToken,
          cexUsdtBalance: cexUsdt,
          cexTokenBalance: cexToken,
          isSufficient: false,
          reason: `Insufficient CEX USDT: have $${cexUsdt.toFixed(2)}, need $${sizeUsd}`,
        };
      }
    }

    return {
      walletBnbBalance: walletBnb,
      walletUsdtBalance: walletUsdt,
      walletTokenBalance: walletToken,
      cexUsdtBalance: cexUsdt,
      cexTokenBalance: cexToken,
      isSufficient: true,
    };
  }
}
