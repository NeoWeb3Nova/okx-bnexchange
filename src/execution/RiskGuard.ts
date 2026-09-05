import { ExecutionConfig, ExecutionResult } from './types';
import { DetailedProfitAnalysis } from '../pricing/ProfitEngine';

export class RiskGuard {
  private consecutiveFailures: number = 0;
  private cumulativeDailyLossUsd: number = 0;
  private isCircuitBreakerTripped: boolean = false;
  private tripReason: string = '';

  // Trusted router whitelist on BSC (Chain 56)
  private static readonly TRUSTED_BSC_ROUTERS = new Set<string>([
    '0x10ed43c718714eb63d5aa57b78b54704e256024e', // PancakeSwap v2 Router
    '0x13f4ea83d0bd40e75c8222255bc855a974568dd4', // PancakeSwap v3 Router
    '0x111111125421ca6dc452d289314280a0f8842a65', // 1inch v5 Aggregator
    '0x2c0d832e85a7fa8ec7235a9d6804a8b7c3d1fb96', // OKX DEX Aggregator Router on BSC
    '0x41f3e7b165fbcfeb0f3b48231e67041a8684bb40', // OKX DEX Router alternate
  ]);

  constructor(private config: ExecutionConfig) {}

  /**
   * Pre-trade safety evaluation
   */
  public evaluatePreTrade(analysis: DetailedProfitAnalysis): {
    approved: boolean;
    reason?: string;
  } {
    // 1. Check circuit breaker state
    if (this.isCircuitBreakerTripped) {
      return {
        approved: false,
        reason: `CIRCUIT_BREAKER_ACTIVE: ${this.tripReason}`,
      };
    }

    // 2. Check single trade size limit
    if (analysis.tradeSizeUsd > this.config.maxTradeSizeUsd) {
      return {
        approved: false,
        reason: `Trade size $${analysis.tradeSizeUsd} exceeds max allowed $${this.config.maxTradeSizeUsd}`,
      };
    }

    // 3. Check minimum expected net profit
    if (analysis.netProfitUsd < this.config.minNetProfitUsd) {
      return {
        approved: false,
        reason: `Net profit $${analysis.netProfitUsd} below minimum threshold $${this.config.minNetProfitUsd}`,
      };
    }

    // 4. Check minimum expected net profit percentage
    if (analysis.netProfitPct < this.config.minNetProfitPct) {
      return {
        approved: false,
        reason: `Net profit ${analysis.netProfitPct}% below minimum threshold ${this.config.minNetProfitPct}%`,
      };
    }

    // 5. Check slippage safety
    if (analysis.dexPriceImpactPct > this.config.maxSlippagePct) {
      return {
        approved: false,
        reason: `DEX slippage ${analysis.dexPriceImpactPct}% exceeds max limit ${this.config.maxSlippagePct}%`,
      };
    }

    return { approved: true };
  }

  /**
   * Whitelist verification for target EVM contract address
   */
  public verifyTargetContract(contractAddress: string): boolean {
    if (!contractAddress) return false;
    const lower = contractAddress.toLowerCase();
    return RiskGuard.TRUSTED_BSC_ROUTERS.has(lower);
  }

  /**
   * Deep Calldata Security Verification:
   * Verifies that the recipient designated in the transaction calldata
   * strictly matches the user's hot wallet address to prevent wallet drain attacks.
   */
  public verifyCalldataRecipient(
    calldata: string,
    expectedRecipient: string
  ): { valid: boolean; reason?: string } {
    if (!calldata || !expectedRecipient) {
      return { valid: false, reason: 'Missing calldata or expected recipient address' };
    }

    const cleanData = calldata.startsWith('0x') ? calldata.slice(2).toLowerCase() : calldata.toLowerCase();
    const cleanRecipient = expectedRecipient.startsWith('0x')
      ? expectedRecipient.slice(2).toLowerCase()
      : expectedRecipient.toLowerCase();

    // In EVM calldata, an address parameter is 0-padded to 32 bytes (64 hex chars)
    const paddedRecipient = '000000000000000000000000' + cleanRecipient;

    if (!cleanData.includes(paddedRecipient) && !cleanData.includes(cleanRecipient)) {
      return {
        valid: false,
        reason: `CRITICAL SECURITY ALERT: Calldata recipient does not match wallet address (${expectedRecipient})! Potential malicious drain attempt!`,
      };
    }

    return { valid: true };
  }

  /**
   * Gas Price Sanity Protection:
   * Protects against the original code's "gasPrice * 10" runaway vulnerability.
   */
  public verifyGasPrice(
    gasPriceGwei: number,
    maxAllowedGwei: number = 5.0
  ): { valid: boolean; reason?: string } {
    if (gasPriceGwei > maxAllowedGwei) {
      return {
        valid: false,
        reason: `Gas price ${gasPriceGwei.toFixed(2)} Gwei exceeds maximum safety cap (${maxAllowedGwei} Gwei)!`,
      };
    }
    return { valid: true };
  }

  /**
   * Update circuit breaker after a trade finishes
   */
  public recordResult(result: ExecutionResult): void {
    if (result.status === 'SUCCESS') {
      this.consecutiveFailures = 0;
      if (result.realizedNetProfitUsd && result.realizedNetProfitUsd < 0) {
        this.cumulativeDailyLossUsd += Math.abs(result.realizedNetProfitUsd);
      }
    } else if (result.status === 'FAILED') {
      this.consecutiveFailures++;
      console.warn(`[RiskGuard] Consecutive failures: ${this.consecutiveFailures}`);

      if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        this.tripCircuitBreaker(
          `Consecutive failures reached limit (${this.consecutiveFailures} >= ${this.config.maxConsecutiveFailures})`
        );
      }
    }

    if (this.cumulativeDailyLossUsd >= this.config.dailyMaxLossUsd) {
      this.tripCircuitBreaker(
        `Daily cumulative loss ($${this.cumulativeDailyLossUsd.toFixed(2)}) exceeded cap ($${this.config.dailyMaxLossUsd})`
      );
    }
  }

  private tripCircuitBreaker(reason: string) {
    this.isCircuitBreakerTripped = true;
    this.tripReason = reason;
    console.error(`\n🚨 [RiskGuard] CIRCUIT BREAKER TRIPPED! ALL TRADING HALTED! Reason: ${reason}\n`);
  }

  public resetCircuitBreaker(): void {
    this.isCircuitBreakerTripped = false;
    this.tripReason = '';
    this.consecutiveFailures = 0;
    this.cumulativeDailyLossUsd = 0;
    console.log('[RiskGuard] Circuit breaker reset manually.');
  }

  public isTripped(): boolean {
    return this.isCircuitBreakerTripped;
  }
}
