import type { BudgetConfig, FenceContext, FenceStore, RequestBudget, ScopedBudget, Message, TokenCounter } from './types';
import { approximateTokenCounter, countTotalInputTokens } from './counter';
import { SlidingWindow } from './window';
import { parseWindowDuration } from './validation';

export interface BudgetCheckResult {
  allowed: boolean;
  scope: string;
  scopeId?: string;
  limit: number;
  current: number;
  requested: number;
  remaining: number;
}

/**
 * Check a per-request budget against input tokens.
 * Per-request budgets are stateless — they only compare the current
 * request's token count against the configured limit.
 */
export function checkPerRequest(
  messages: Message[],
  budget: RequestBudget,
  tokenCounter: TokenCounter = approximateTokenCounter,
  messageOverhead: number = 4,
): BudgetCheckResult {
  const requested = countTotalInputTokens(messages, tokenCounter, messageOverhead);
  const limit = budget.maxInputTokens;
  return {
    allowed: requested <= limit,
    scope: 'request',
    limit,
    current: 0,
    requested,
    remaining: Math.max(0, limit - requested),
  };
}

/**
 * Check a scoped (cumulative or windowed) budget.
 * Reads the current usage from the store and compares
 * current + requested against the configured limit.
 */
export function checkScopedBudget(
  scopeName: string,
  scopeId: string,
  budget: ScopedBudget,
  store: FenceStore,
  requested: number,
): BudgetCheckResult {
  const key = `${scopeName}:${scopeId}`;
  let current: number;

  if (budget.window !== undefined) {
    const windowMs = parseWindowDuration(budget.window);
    const win = new SlidingWindow(windowMs, 60, store, key);
    current = win.getTotal();
  } else {
    current = store.get(key) as number;
  }

  const limit = budget.maxInputTokens ?? budget.maxTotalTokens ?? budget.maxOutputTokens ?? Infinity;

  return {
    allowed: current + requested <= limit,
    scope: scopeName,
    scopeId,
    limit,
    current,
    requested,
    remaining: Math.max(0, limit - current),
  };
}

/**
 * Record token usage against a scoped budget.
 * Selects the appropriate usage metric (input, output, or total)
 * based on which limit is configured, and records it in the store.
 */
export function recordUsage(
  scopeName: string,
  scopeId: string,
  budget: ScopedBudget,
  store: FenceStore,
  usage: { input: number; output: number; total: number },
): void {
  const key = `${scopeName}:${scopeId}`;
  const amount = budget.maxInputTokens ? usage.input : budget.maxOutputTokens ? usage.output : usage.total;

  if (budget.window !== undefined) {
    const windowMs = parseWindowDuration(budget.window);
    const win = new SlidingWindow(windowMs, 60, store, key);
    win.record(amount);
  } else {
    store.increment(key, amount);
  }
}

/**
 * Check all configured budgets in precedence order.
 * Stops at the first blocking scope and returns its result.
 * Order: per-request, per-user, per-session, global, custom scopes.
 */
export function checkAllBudgets(
  messages: Message[],
  budgets: BudgetConfig,
  context: FenceContext,
  store: FenceStore,
  tokenCounter: TokenCounter = approximateTokenCounter,
  messageOverhead: number = 4,
): BudgetCheckResult {
  const inputTokens = countTotalInputTokens(messages, tokenCounter, messageOverhead);

  // Per-request
  if (budgets.perRequest) {
    const result = checkPerRequest(messages, budgets.perRequest, tokenCounter, messageOverhead);
    if (!result.allowed) return result;
  }

  // Per-user
  if (budgets.perUser && context.userId) {
    const result = checkScopedBudget('user', context.userId, budgets.perUser, store, inputTokens);
    if (!result.allowed) return result;
  }

  // Per-session
  if (budgets.perSession && context.sessionId) {
    const result = checkScopedBudget('session', context.sessionId, budgets.perSession, store, inputTokens);
    if (!result.allowed) return result;
  }

  // Global
  if (budgets.global) {
    const result = checkScopedBudget('global', 'global', budgets.global, store, inputTokens);
    if (!result.allowed) return result;
  }

  // Custom scopes
  if (budgets.custom && context.scopes) {
    for (const [name, budget] of Object.entries(budgets.custom)) {
      const scopeId = context.scopes[name];
      if (!scopeId) continue;
      const result = checkScopedBudget(`custom:${name}`, scopeId, budget, store, inputTokens);
      if (!result.allowed) return result;
    }
  }

  return { allowed: true, scope: 'none', limit: Infinity, current: 0, requested: inputTokens, remaining: Infinity };
}
