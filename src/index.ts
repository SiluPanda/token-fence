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
