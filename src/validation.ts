import type { FenceConfig, EnforcementAction, ScopedBudget } from './types';
import { FenceConfigError } from './errors';

const VALID_ACTIONS: EnforcementAction[] = ['block', 'truncate', 'warn'];
const DURATION_REGEX = /^(\d+)(m|h|d)$/;
const DURATION_MULTIPLIERS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Parse a window duration string or number to milliseconds.
 */
export function parseWindowDuration(window: string | number): number {
  if (typeof window === 'number') {
    if (window <= 0) throw new Error('Window duration must be positive');
    return window;
  }
  const match = window.match(DURATION_REGEX);
  if (!match) throw new Error(`Invalid window duration format: "${window}". Use "<number><m|h|d>" or a number in ms.`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  return value * DURATION_MULTIPLIERS[unit];
}

/**
 * Validate a FenceConfig. Throws FenceConfigError if invalid.
 */
export function validateConfig(config: FenceConfig): void {
  const errors: string[] = [];
  const { budgets, action, messageOverhead, minTokensAfterTruncation, windowBuckets } = config;

  // Must have at least one budget scope
  if (!budgets || (!budgets.perRequest && !budgets.perUser && !budgets.perSession && !budgets.global && (!budgets.custom || Object.keys(budgets.custom).length === 0))) {
    errors.push('At least one budget scope must be configured');
  }

  // Validate action
  if (action !== undefined && !VALID_ACTIONS.includes(action)) {
    errors.push(`Invalid action "${action}". Must be one of: ${VALID_ACTIONS.join(', ')}`);
  }

  // Validate messageOverhead
  if (messageOverhead !== undefined && messageOverhead < 0) {
    errors.push('messageOverhead must be non-negative');
  }

  // Validate minTokensAfterTruncation
  if (minTokensAfterTruncation !== undefined && minTokensAfterTruncation < 0) {
    errors.push('minTokensAfterTruncation must be non-negative');
  }

  // Validate windowBuckets
  if (windowBuckets !== undefined && (windowBuckets <= 0 || !Number.isInteger(windowBuckets))) {
    errors.push('windowBuckets must be a positive integer');
  }

  // Validate perRequest
  if (budgets?.perRequest) {
    if (budgets.perRequest.maxInputTokens <= 0) {
      errors.push('perRequest.maxInputTokens must be positive');
    }
    if (budgets.perRequest.action && !VALID_ACTIONS.includes(budgets.perRequest.action)) {
      errors.push(`perRequest.action "${budgets.perRequest.action}" is invalid`);
    }
  }

  // Validate scoped budgets (perUser, perSession, global, custom)
  const scopedEntries: [string, ScopedBudget | undefined][] = [
    ['perUser', budgets?.perUser],
    ['perSession', budgets?.perSession],
    ['global', budgets?.global],
    ...Object.entries(budgets?.custom || {}).map(([k, v]) => [`custom.${k}`, v] as [string, ScopedBudget]),
  ];

  for (const [name, scope] of scopedEntries) {
    if (!scope) continue;
    if (scope.maxInputTokens !== undefined && scope.maxInputTokens <= 0) {
      errors.push(`${name}.maxInputTokens must be positive`);
    }
    if (scope.maxOutputTokens !== undefined && scope.maxOutputTokens <= 0) {
      errors.push(`${name}.maxOutputTokens must be positive`);
    }
    if (scope.maxTotalTokens !== undefined && scope.maxTotalTokens <= 0) {
      errors.push(`${name}.maxTotalTokens must be positive`);
    }
    if (scope.window !== undefined) {
      try { parseWindowDuration(scope.window); } catch {
        errors.push(`${name}.window is invalid: ${scope.window}`);
      }
    }
    if (scope.action !== undefined && !VALID_ACTIONS.includes(scope.action)) {
      errors.push(`${name}.action "${scope.action}" is invalid`);
    }
    // Warn if truncate on cumulative scope
    if (scope.action === 'truncate' || (!scope.action && action === 'truncate')) {
      // truncate only valid on perRequest; for cumulative scopes, fall back to block
    }
  }

  if (errors.length > 0) {
    throw new FenceConfigError(`Invalid fence configuration: ${errors.join('; ')}`, errors);
  }
}
