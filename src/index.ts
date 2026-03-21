// token-fence - Token budget enforcement middleware with intelligent truncation
export type {
  TokenCounter,
  EnforcementAction,
  BudgetScope,
  WindowPreset,
  Message,
  RequestBudget,
  ScopedBudget,
  BudgetConfig,
  FenceConfig,
  FenceContext,
  AllowanceResult,
  ScopeAllowance,
  ScopeUsage,
  BlockEvent,
  TruncateEvent,
  WarningEvent,
  UsageEvent,
  FenceMetadata,
  FenceStore,
  TokenFence,
} from './types';
export {
  FenceError,
  BudgetExceededError,
  ProtectedExceedsBudgetError,
  FenceConfigError,
} from './errors';
export { approximateTokenCounter, countMessageTokens, countTotalInputTokens } from './counter';
export { validateConfig, parseWindowDuration } from './validation';
export { InMemoryStore } from './store';
export { SlidingWindow } from './window';
export { checkPerRequest, checkScopedBudget, checkAllBudgets, recordUsage } from './budgets';
export type { BudgetCheckResult } from './budgets';
export { createFence } from './fence';
export type { FenceInstance } from './fence';
