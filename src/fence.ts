import type { FenceConfig, FenceContext, Message } from './types';
import { approximateTokenCounter } from './counter';
import { InMemoryStore } from './store';
import { validateConfig } from './validation';
import { checkAllBudgets, recordUsage } from './budgets';
import { BudgetExceededError } from './errors';

export interface FenceInstance {
  /**
   * Check whether a set of messages is within all configured budgets.
   * Throws BudgetExceededError if any budget is exceeded.
   */
  check(messages: Message[], context?: FenceContext): void;

  /**
   * Record actual token usage after a request completes.
   * Updates cumulative and windowed counters in all applicable scopes.
   */
  record(
    messages: Message[],
    usage: { input: number; output: number; total: number },
    context?: FenceContext,
  ): void;
}

/**
 * Create a token fence instance that enforces token budgets across requests.
 *
 * @param config - Budget configuration. At least one budget scope must be configured.
 * @returns A FenceInstance with check() and record() methods.
 * @throws FenceConfigError if the configuration is invalid.
 *
 * @example
 * ```typescript
 * const fence = createFence({
 *   budgets: {
 *     perRequest: { maxInputTokens: 8000 },
 *     perUser: { maxTotalTokens: 100_000, window: '1h' },
 *     global: { maxTotalTokens: 10_000_000, window: '1d' },
 *   },
 *   action: 'block',
 * });
 *
 * // Pre-flight check — throws BudgetExceededError if over budget
 * fence.check(messages, { userId: 'alice', sessionId: 'session-1' });
 *
 * // After the LLM responds, record actual usage
 * fence.record(messages, { input: 312, output: 88, total: 400 }, { userId: 'alice' });
 * ```
 */
export function createFence(config: FenceConfig): FenceInstance {
  validateConfig(config);

  const store = config.store ?? new InMemoryStore();
  const tokenCounter = config.tokenCounter ?? approximateTokenCounter;
  const messageOverhead = config.messageOverhead ?? 4;

  return {
    check(messages: Message[], context: FenceContext = {}): void {
      const result = checkAllBudgets(
        messages,
        config.budgets,
        context,
        store,
        tokenCounter,
        messageOverhead,
      );

      if (!result.allowed) {
        const err = new BudgetExceededError(
          `Budget exceeded: ${result.scope} limit of ${result.limit} tokens reached (current: ${result.current}, requested: ${result.requested})`,
          result.scope,
          result.limit,
          result.current,
          result.requested,
          result.remaining,
          context.userId,
          context.sessionId,
        );

        if (config.onBlock) {
          config.onBlock({
            scope: result.scope,
            scopeId: result.scopeId,
            limit: result.limit,
            current: result.current,
            requested: result.requested,
            remaining: result.remaining,
            messages,
            timestamp: new Date(),
          });
        }

        throw err;
      }
    },

    record(
      messages: Message[],
      usage: { input: number; output: number; total: number },
      context: FenceContext = {},
    ): void {
      if (config.budgets.perUser && context.userId) {
        recordUsage('user', context.userId, config.budgets.perUser, store, usage);
      }

      if (config.budgets.perSession && context.sessionId) {
        recordUsage('session', context.sessionId, config.budgets.perSession, store, usage);
      }

      if (config.budgets.global) {
        recordUsage('global', 'global', config.budgets.global, store, usage);
      }

      if (config.budgets.custom && context.scopes) {
        for (const [name, budget] of Object.entries(config.budgets.custom)) {
          const scopeId = context.scopes[name];
          if (!scopeId) continue;
          recordUsage(`custom:${name}`, scopeId, budget, store, usage);
        }
      }

      if (config.onUsage) {
        config.onUsage({
          userId: context.userId,
          sessionId: context.sessionId,
          inputTokens: usage.input,
          outputTokens: usage.output,
          totalTokens: usage.total,
          model: '',
          timestamp: new Date(),
        });
      }
    },
  };
}
