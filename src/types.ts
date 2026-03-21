// ── Token Counter ───────────────────────────────────────────────────

/** Function that counts the number of tokens in a text string. */
export type TokenCounter = (text: string) => number;

// ── Enforcement ─────────────────────────────────────────────────────

export type EnforcementAction = 'block' | 'truncate' | 'warn';

// ── Budget Scope ─────────────────────────────────────────────────────

export type BudgetScope = 'request' | 'user' | 'session' | 'window' | 'global';

// ── Window Preset ────────────────────────────────────────────────────

/** Sliding window duration: preset string or custom milliseconds. */
export type WindowPreset = 'per-minute' | 'per-hour' | 'per-day' | number;

// ── Message Type ────────────────────────────────────────────────────

/** An LLM conversation message. */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

// ── Budget Configuration ────────────────────────────────────────────

/** Budget for a single request. */
export interface RequestBudget {
  /** Maximum input tokens for a single request. */
  maxInputTokens: number;

  /**
   * Enforcement action for this scope.
   * Overrides the global action.
   * Default: inherits from FenceConfig.action.
   */
  action?: EnforcementAction;
}

/** Budget for a cumulative scope (user, session, global, custom). */
export interface ScopedBudget {
  /**
   * Maximum input tokens for this scope.
   */
  maxInputTokens?: number;

  /** Maximum output tokens for this scope. */
  maxOutputTokens?: number;

  /** Maximum total tokens (input + output) for this scope. */
  maxTotalTokens?: number;

  /**
   * Sliding window duration.
   * If omitted, the budget is a lifetime cumulative limit.
   * Accepted formats: '1m', '5m', '1h', '6h', '1d', '7d', or a number in milliseconds.
   */
  window?: string | number;

  /**
   * Enforcement action for this scope.
   * Overrides the global action.
   * Default: inherits from FenceConfig.action.
   */
  action?: EnforcementAction;
}

/** Budget definitions for each scope. */
export interface BudgetConfig {
  /**
   * Per-request input token limit.
   * Checked before sending. Only counts input tokens.
   */
  perRequest?: RequestBudget;

  /**
   * Per-user cumulative token limit.
   * Requires userId in the request context.
   */
  perUser?: ScopedBudget;

  /**
   * Per-session cumulative token limit.
   * Requires sessionId in the request context.
   */
  perSession?: ScopedBudget;

  /**
   * Time-windowed global token limit.
   * Applies across all users and sessions.
   */
  global?: ScopedBudget;

  /**
   * Additional custom budget scopes.
   * Keys are scope names; the caller passes matching scope IDs
   * in the request context.
   */
  custom?: Record<string, ScopedBudget>;
}

// ── Fence Configuration ─────────────────────────────────────────────

/** Configuration for the fence middleware. */
export interface FenceConfig {
  /**
   * Budget definitions for each scope.
   * All scopes are optional; only configured scopes are enforced.
   */
  budgets: BudgetConfig;

  /**
   * Default enforcement action when a budget is exceeded.
   * Can be overridden per scope in the budget config.
   * Default: 'block'.
   */
  action?: EnforcementAction;

  /**
   * Token counter function.
   * Default: approximate counter (Math.ceil(text.length / 4)).
   */
  tokenCounter?: TokenCounter;

  /**
   * Per-message token overhead (role prefix, delimiters).
   * Default: 4.
   */
  messageOverhead?: number;

  /**
   * Minimum input tokens after truncation. If truncation would
   * reduce the input below this threshold, the fence blocks instead.
   * Default: 100.
   */
  minTokensAfterTruncation?: number;

  /**
   * Pluggable storage adapter for persisting spending counters.
   * Default: in-memory Map.
   */
  store?: FenceStore;

  /**
   * Number of buckets per sliding window.
   * Higher values increase precision at the cost of memory.
   * Default: 60.
   */
  windowBuckets?: number;

  /**
   * Callback invoked when a request is blocked.
   */
  onBlock?: (event: BlockEvent) => void;

  /**
   * Callback invoked when a request is truncated.
   */
  onTruncate?: (event: TruncateEvent) => void;

  /**
   * Callback invoked when a request proceeds with a warning.
   */
  onWarning?: (event: WarningEvent) => void;

  /**
   * Callback invoked after each request completes,
   * with the recorded usage.
   */
  onUsage?: (event: UsageEvent) => void;
}

// ── Request Context ─────────────────────────────────────────────────

/** Context passed with each request to identify budget scopes. */
export interface FenceContext {
  /** User identifier for per-user budgets. */
  userId?: string;

  /** Session identifier for per-session budgets. */
  sessionId?: string;

  /** Custom scope identifiers for custom budgets. */
  scopes?: Record<string, string>;
}

// ── Allowance ───────────────────────────────────────────────────────

/** Result of a pre-flight budget check. */
export interface AllowanceResult {
  /** Whether the request would be allowed under all budgets. */
  allowed: boolean;

  /** Estimated input tokens for the request. */
  estimatedTokens: number;

  /**
   * Per-scope remaining budget.
   * Each key is a scope name; the value is the remaining tokens.
   */
  remaining: Record<string, number>;

  /**
   * The scope that would block the request, if any.
   * Null if allowed.
   */
  blockingScope: string | null;

  /**
   * For time-windowed scopes, when enough budget will be freed
   * to accommodate this request.
   */
  windowResetsAt?: Date;
}

/** Allowance details for a specific scope. */
export interface ScopeAllowance {
  /** Remaining tokens in this scope. */
  remaining: number;

  /** Configured limit for this scope. */
  limit: number;

  /** Tokens used so far in this scope. */
  used: number;

  /** For time-windowed scopes, when the window resets enough to free budget. */
  windowResetsAt?: Date;

  /** The window duration, if this is a time-windowed scope. */
  windowDuration?: number;
}

// ── Usage ───────────────────────────────────────────────────────────

/** Token usage recorded for a scope. */
export interface ScopeUsage {
  /** Input tokens consumed. */
  input: number;

  /** Output tokens consumed. */
  output: number;

  /** Total tokens consumed (input + output). */
  total: number;

  /** Number of requests made. */
  requestCount: number;

  /** Timestamp of first usage. */
  firstUsageAt: Date;

  /** Timestamp of most recent usage. */
  lastUsageAt: Date;
}

// ── Events ──────────────────────────────────────────────────────────

/** Emitted when a request is blocked. */
export interface BlockEvent {
  /** The scope that caused the block. */
  scope: string;

  /** Scope identifier (userId, sessionId, etc.). */
  scopeId?: string;

  /** Configured limit. */
  limit: number;

  /** Current usage in the scope. */
  current: number;

  /** Estimated tokens for the blocked request. */
  requested: number;

  /** Remaining tokens in the scope. */
  remaining: number;

  /** For time-windowed scopes, when budget will be freed. */
  windowResetsAt?: Date;

  /** The messages that were blocked. */
  messages: Message[];

  /** Timestamp of the event. */
  timestamp: Date;
}

/** Emitted when a request is truncated. */
export interface TruncateEvent {
  /** The scope that triggered truncation. */
  scope: string;

  /** Original input token count. */
  originalTokens: number;

  /** Token count after truncation. */
  truncatedTokens: number;

  /** Number of messages removed. */
  messagesRemoved: number;

  /** Timestamp of the event. */
  timestamp: Date;
}

/** Emitted when a request proceeds with a warning. */
export interface WarningEvent {
  /** The scope that triggered the warning. */
  scope: string;

  /** Scope identifier. */
  scopeId?: string;

  /** Configured limit. */
  limit: number;

  /** Current usage in the scope. */
  current: number;

  /** Estimated tokens for the request. */
  requested: number;

  /** Projected usage after this request. */
  projected: number;

  /** Timestamp of the event. */
  timestamp: Date;
}

/** Emitted after each request with recorded usage. */
export interface UsageEvent {
  /** User ID, if applicable. */
  userId?: string;

  /** Session ID, if applicable. */
  sessionId?: string;

  /** Actual input tokens (from API response). */
  inputTokens: number;

  /** Actual output tokens (from API response). */
  outputTokens: number;

  /** Total tokens. */
  totalTokens: number;

  /** Model used. */
  model: string;

  /** Timestamp of the event. */
  timestamp: Date;
}

// ── Fence Response Metadata ─────────────────────────────────────────

/** Metadata attached to responses by the fence. */
export interface FenceMetadata {
  /** Whether the input was truncated. */
  truncated?: boolean;

  /** Original input token count (before truncation). */
  originalTokens?: number;

  /** Input token count after truncation. */
  truncatedTokens?: number;

  /** Number of messages removed during truncation. */
  messagesRemoved?: number;

  /** Whether a budget warning was triggered. */
  warning?: boolean;

  /** The scope that triggered truncation or warning. */
  scope?: string;

  /** Budget limit of the triggered scope. */
  limit?: number;

  /** Usage at the time of the triggered scope. */
  current?: number;

  /** Projected usage after the request. */
  afterRequest?: number;
}

// ── Fence Store (Persistence Adapter) ───────────────────────────────

/**
 * Pluggable storage adapter for persisting spending counters.
 * The default in-memory store uses a Map and resets on process restart.
 */
export interface FenceStore {
  /** Get the current usage for a scope key. Returns 0 if not found. */
  get(key: string): Promise<number> | number;

  /** Set the usage for a scope key. */
  set(key: string, value: number): Promise<void> | void;

  /** Increment the usage for a scope key by a delta. Returns the new value. */
  increment(key: string, delta: number): Promise<number> | number;

  /** Delete a scope key (for reset). */
  delete(key: string): Promise<void> | void;

  /**
   * Get all bucket values for a sliding window scope.
   * Returns an array of numbers, one per bucket.
   */
  getWindow(key: string, bucketCount: number): Promise<number[]> | number[];

  /**
   * Record usage in a specific bucket of a sliding window.
   */
  recordBucket(key: string, bucketIndex: number, delta: number): Promise<void> | void;

  /**
   * Reset specific buckets in a sliding window (for eviction).
   */
  resetBuckets(key: string, bucketIndices: number[]): Promise<void> | void;
}

// ── TokenFence Instance ──────────────────────────────────────────────

/** The token fence instance. */
export interface TokenFence {
  /**
   * Apply the fence to an LLM client, returning a fenced client.
   */
  apply<T>(client: T): T;

  /**
   * Pre-check whether a set of messages would pass all budget checks.
   * Does not send the request or record usage.
   */
  check(messages: Message[], context?: FenceContext): AllowanceResult;

  /**
   * Get the remaining allowance for a specific scope.
   */
  getAllowance(scope: { userId?: string; sessionId?: string; global?: boolean }): ScopeAllowance;

  /**
   * Get cumulative usage for a specific scope.
   */
  getUsage(scope: { userId?: string; sessionId?: string; global?: boolean }): ScopeUsage;

  /**
   * Reset spending counters for a scope.
   */
  reset(scope: { userId?: string; sessionId?: string; global?: boolean }): void;

  /**
   * Get the fence configuration.
   */
  getConfig(): Readonly<FenceConfig>;

  /**
   * Update budget limits at runtime.
   * Does not reset existing counters.
   */
  updateBudgets(budgets: Partial<BudgetConfig>): void;
}

