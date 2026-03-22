# token-fence

Token budget enforcement middleware for LLM API clients. Enforce hard spending limits per request, per user, per session, over sliding time windows, and globally -- without changing application logic.

[![npm version](https://img.shields.io/npm/v/token-fence.svg)](https://www.npmjs.com/package/token-fence)
[![license](https://img.shields.io/npm/l/token-fence.svg)](https://opensource.org/licenses/MIT)
[![node](https://img.shields.io/node/v/token-fence.svg)](https://nodejs.org/)

---

## Description

`token-fence` sits between your application code and your LLM API client. Every request passes through the fence, which counts tokens, checks configured budgets, and either allows the request, blocks it by throwing a `BudgetExceededError`, or lets it through with a warning. After the LLM responds, the fence records actual token usage against cumulative and time-windowed budgets.

The package answers the question: **"Should this request be allowed to proceed at all?"** It enforces spending ceilings -- a user cannot exceed 100,000 tokens per hour, a single request cannot exceed 8,000 input tokens, a session cannot consume more than 500,000 tokens total, and the application cannot exceed 10 million tokens per day.

Zero runtime dependencies. Works with any LLM provider (OpenAI, Anthropic, or any compatible client). TypeScript-first with full type definitions.

---

## Installation

```bash
npm install token-fence
```

Requires Node.js >= 18.

---

## Quick Start

```typescript
import { createFence, BudgetExceededError } from 'token-fence';
import type { Message } from 'token-fence';

// Create a fence with budget limits
const fence = createFence({
  budgets: {
    perRequest: { maxInputTokens: 8_000 },
    perUser: { maxTotalTokens: 100_000, window: '1h' },
    global: { maxTotalTokens: 10_000_000, window: '1d' },
  },
  action: 'block',
});

const messages: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Summarize this document...' },
];

// Pre-flight check -- throws BudgetExceededError if any budget is exceeded
try {
  fence.check(messages, { userId: 'alice', sessionId: 'session-1' });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error(
      `Blocked by ${err.scope} budget (limit: ${err.limit}, current: ${err.current}, requested: ${err.requested})`
    );
  }
}

// After the LLM responds, record actual usage to update cumulative counters
fence.record(
  messages,
  { input: 312, output: 88, total: 400 },
  { userId: 'alice', sessionId: 'session-1' }
);
```

---

## Features

- **Multi-scope budgets** -- Enforce limits per request, per user, per session, per time window, globally, and on custom scopes. All scopes are checked on every request; the most restrictive scope determines the outcome.
- **Sliding time windows** -- Time-based budgets use a bucketed sliding window algorithm. A "100,000 tokens per hour" budget means the total tokens in the preceding 60 minutes must not exceed 100,000 at any point. No fixed-boundary gaming.
- **Pluggable token counting** -- Ships with a built-in approximate counter (`Math.ceil(text.length / 4)`). Provide your own exact counter (tiktoken, gpt-tokenizer) via the `tokenCounter` option.
- **Pluggable storage** -- Spending counters are held in memory by default (`InMemoryStore`). Provide a custom `FenceStore` adapter to persist counters to Redis, a database, or any external store.
- **Event callbacks** -- Hook into `onBlock`, `onTruncate`, `onWarning`, and `onUsage` events for logging, monitoring, and alerting.
- **Configuration validation** -- Invalid configurations are caught at construction time with detailed `FenceConfigError` errors listing every validation issue.
- **Zero runtime dependencies** -- Only built-in JavaScript APIs (Map, Date, Array). Token counting libraries and LLM SDKs are optional.
- **TypeScript-first** -- Full type definitions for all configuration, events, errors, and API surfaces.

---

## API Reference

### `createFence(config: FenceConfig): FenceInstance`

Create a fence instance. Validates the configuration on construction and throws `FenceConfigError` if invalid. At least one budget scope must be configured.

```typescript
import { createFence } from 'token-fence';

const fence = createFence({
  budgets: {
    perRequest: { maxInputTokens: 8_000 },
    perUser: { maxTotalTokens: 100_000, window: '1h' },
  },
  action: 'block',
});
```

Returns a `FenceInstance` with `check()` and `record()` methods.

---

### `fence.check(messages, context?): void`

Pre-flight budget check. Iterates all configured budget scopes in precedence order:

1. `perRequest`
2. `perUser` (requires `context.userId`)
3. `perSession` (requires `context.sessionId`)
4. `global`
5. `custom` scopes (requires matching keys in `context.scopes`)

Throws `BudgetExceededError` if any scope is exceeded. Does not mutate counters. Scopes whose required context identifiers are missing are skipped.

```typescript
fence.check(messages, { userId: 'alice', sessionId: 'conv-123' });
```

---

### `fence.record(messages, usage, context?): void`

Record actual token usage after a request completes. Updates cumulative and windowed counters for all applicable scopes (perUser, perSession, global, custom).

The `usage` object must contain `{ input, output, total }` token counts as reported by the LLM API response.

```typescript
fence.record(
  messages,
  { input: 500, output: 120, total: 620 },
  { userId: 'alice', sessionId: 'conv-123' }
);
```

Which metric is tracked depends on the budget configuration for each scope:

| Configured limit | Metric recorded |
|---|---|
| `maxInputTokens` | `usage.input` |
| `maxOutputTokens` | `usage.output` |
| `maxTotalTokens` | `usage.total` |

---

### Token Counting Functions

#### `approximateTokenCounter(text: string): number`

Default token counter using the heuristic of ~4 characters per token.

```typescript
import { approximateTokenCounter } from 'token-fence';

approximateTokenCounter('Hello, world!'); // => 4
```

#### `countMessageTokens(msg, tokenCounter?, messageOverhead?): number`

Count tokens for a single `Message`. Includes content, `name`, `tool_calls` (JSON-serialized), and `tool_call_id`. Adds `messageOverhead` (default: 4) per message.

```typescript
import { countMessageTokens } from 'token-fence';
import type { Message } from 'token-fence';

const msg: Message = { role: 'user', content: 'What is the weather today?' };
const tokens = countMessageTokens(msg); // content tokens + 4 overhead
```

#### `countTotalInputTokens(messages, tokenCounter?, messageOverhead?): number`

Sum `countMessageTokens` across all messages in an array.

```typescript
import { countTotalInputTokens } from 'token-fence';

const total = countTotalInputTokens([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello' },
]);
```

---

### Budget Checking Functions

These lower-level functions are exported for advanced use cases where you need fine-grained control over individual budget checks.

#### `checkPerRequest(messages, budget, tokenCounter?, messageOverhead?): BudgetCheckResult`

Check a per-request budget against input tokens. Stateless -- compares the current request's token count against the configured limit.

```typescript
import { checkPerRequest } from 'token-fence';

const result = checkPerRequest(messages, { maxInputTokens: 8_000 });
// result.allowed: boolean
// result.scope: 'request'
// result.requested: number (estimated input tokens)
// result.remaining: number
```

#### `checkScopedBudget(scopeName, scopeId, budget, store, requested): BudgetCheckResult`

Check a scoped (cumulative or windowed) budget. Reads current usage from the store and compares `current + requested` against the limit. Supports both flat ceilings and sliding-window budgets.

```typescript
import { checkScopedBudget, InMemoryStore } from 'token-fence';

const store = new InMemoryStore();
const result = checkScopedBudget('user', 'alice', { maxInputTokens: 100_000 }, store, 500);
```

#### `checkAllBudgets(messages, budgets, context, store, tokenCounter?, messageOverhead?): BudgetCheckResult`

Check all configured budgets in precedence order. Stops at the first blocking scope. Returns `{ allowed: true, scope: 'none' }` if all scopes pass.

#### `recordUsage(scopeName, scopeId, budget, store, usage): void`

Record token usage against a scoped budget. Selects the appropriate metric (input, output, or total) based on which limit is configured, and records it in the store. For windowed budgets, records into the appropriate sliding window bucket.

---

### `BudgetCheckResult`

Returned by all budget checking functions.

```typescript
interface BudgetCheckResult {
  allowed: boolean;
  scope: string;       // 'request' | 'user' | 'session' | 'global' | 'custom:<name>' | 'none'
  scopeId?: string;    // e.g., 'alice', 's1', 'global'
  limit: number;
  current: number;
  requested: number;
  remaining: number;
}
```

---

### `InMemoryStore`

Default in-memory implementation of `FenceStore`. Uses Maps for cumulative counters and sliding window buckets. All methods are synchronous. Data resets on process restart.

```typescript
import { InMemoryStore } from 'token-fence';

const store = new InMemoryStore();

store.get('user:alice');            // 0 (default for unknown keys)
store.set('user:alice', 500);
store.increment('user:alice', 100); // returns 600
store.delete('user:alice');

// Window operations
store.getWindow('win:key', 60);              // returns number[] of length 60
store.recordBucket('win:key', 5, 100);       // add 100 to bucket index 5
store.resetBuckets('win:key', [0, 1, 2]);    // zero out buckets 0, 1, 2
```

---

### `SlidingWindow`

Bucketed sliding window for tracking token usage over a time period. Divides the window into fixed-size buckets and lazily evicts stale buckets on each access.

```typescript
import { SlidingWindow, InMemoryStore } from 'token-fence';

const store = new InMemoryStore();
const window = new SlidingWindow(
  3_600_000,   // window duration: 1 hour in ms
  60,           // bucket count (default: 60)
  store,        // optional FenceStore
  'user:alice'  // store key prefix
);

window.record(500);                // record 500 tokens at current time
window.record(200, Date.now());    // record with explicit timestamp
const total = window.getTotal();   // sum of all non-expired buckets
```

---

### `validateConfig(config: FenceConfig): void`

Validate a `FenceConfig` object. Throws `FenceConfigError` with a `validationErrors` array listing all issues found. Called automatically by `createFence`.

```typescript
import { validateConfig } from 'token-fence';

validateConfig({
  budgets: { perRequest: { maxInputTokens: 4096 } },
}); // no error

validateConfig({
  budgets: {},
}); // throws FenceConfigError: "At least one budget scope must be configured"
```

### `parseWindowDuration(window: string | number): number`

Parse a window duration string or number to milliseconds.

Accepted formats:

| Input | Output (ms) |
|---|---|
| `'1m'` | `60_000` |
| `'5m'` | `300_000` |
| `'1h'` | `3_600_000` |
| `'6h'` | `21_600_000` |
| `'1d'` | `86_400_000` |
| `'7d'` | `604_800_000` |
| `60000` (number) | `60_000` |

Throws on invalid format or non-positive numbers.

---

## Configuration

### `FenceConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `budgets` | `BudgetConfig` | *required* | Budget definitions for each scope. |
| `action` | `'block' \| 'truncate' \| 'warn'` | `'block'` | Default enforcement action when a budget is exceeded. |
| `tokenCounter` | `(text: string) => number` | `Math.ceil(text.length / 4)` | Custom token counting function. |
| `messageOverhead` | `number` | `4` | Per-message token overhead (role prefix, delimiters). |
| `minTokensAfterTruncation` | `number` | `100` | Minimum input tokens after truncation. Falls back to block if truncation would go below this. |
| `store` | `FenceStore` | `InMemoryStore` | Pluggable storage adapter for persisting spending counters. |
| `windowBuckets` | `number` | `60` | Number of buckets per sliding window. Higher values increase precision. |
| `onBlock` | `(event: BlockEvent) => void` | -- | Callback when a request is blocked. |
| `onTruncate` | `(event: TruncateEvent) => void` | -- | Callback when a request is truncated. |
| `onWarning` | `(event: WarningEvent) => void` | -- | Callback when a request proceeds with a warning. |
| `onUsage` | `(event: UsageEvent) => void` | -- | Callback after each `record()` call with usage details. |

### `BudgetConfig`

| Field | Type | Description |
|---|---|---|
| `perRequest` | `RequestBudget` | Per-request input token limit. Checked before sending. |
| `perUser` | `ScopedBudget` | Per-user cumulative token limit. Requires `userId` in context. |
| `perSession` | `ScopedBudget` | Per-session cumulative token limit. Requires `sessionId` in context. |
| `global` | `ScopedBudget` | Global token limit across all users and sessions. |
| `custom` | `Record<string, ScopedBudget>` | Custom budget scopes. Keys are scope names; pass matching IDs in `context.scopes`. |

### `RequestBudget`

| Field | Type | Description |
|---|---|---|
| `maxInputTokens` | `number` | Maximum input tokens for a single request. |
| `action` | `EnforcementAction` | Override the default action for this scope. |

### `ScopedBudget`

| Field | Type | Description |
|---|---|---|
| `maxInputTokens` | `number` | Maximum input tokens for this scope. |
| `maxOutputTokens` | `number` | Maximum output tokens for this scope. |
| `maxTotalTokens` | `number` | Maximum total tokens (input + output) for this scope. |
| `window` | `string \| number` | Sliding window duration. Accepts `'1m'`, `'5m'`, `'1h'`, `'6h'`, `'1d'`, `'7d'`, or milliseconds. Omit for lifetime cumulative. |
| `action` | `EnforcementAction` | Override the default action for this scope. |

### `FenceContext`

Passed with each `check()` or `record()` call to identify budget scopes.

| Field | Type | Description |
|---|---|---|
| `userId` | `string` | User identifier for per-user budgets. |
| `sessionId` | `string` | Session identifier for per-session budgets. |
| `scopes` | `Record<string, string>` | Custom scope identifiers (key: scope name, value: scope ID). |

---

## Error Handling

All errors extend `FenceError`, which has a `code` property for programmatic error handling.

### `FenceError`

Base error class.

| Property | Type | Description |
|---|---|---|
| `code` | `string` | Machine-readable error code. |
| `message` | `string` | Human-readable description. |

### `BudgetExceededError`

Thrown when a budget limit is exceeded. Code: `'BUDGET_EXCEEDED'`.

| Property | Type | Description |
|---|---|---|
| `scope` | `string` | The scope that caused the block (e.g., `'request'`, `'user'`, `'session'`, `'global'`). |
| `limit` | `number` | Configured token limit for the scope. |
| `current` | `number` | Current usage in the scope before the request. |
| `requested` | `number` | Estimated tokens for the blocked request. |
| `remaining` | `number` | Tokens remaining in the scope (0 if fully exhausted). |
| `userId` | `string \| undefined` | User ID from the request context, if applicable. |
| `sessionId` | `string \| undefined` | Session ID from the request context, if applicable. |
| `windowResetsAt` | `Date \| undefined` | For windowed scopes, when budget will be freed. |

```typescript
import { BudgetExceededError } from 'token-fence';

try {
  fence.check(messages, { userId: 'alice' });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.log(`Scope: ${err.scope}`);
    console.log(`Limit: ${err.limit}`);
    console.log(`Current: ${err.current}`);
    console.log(`Requested: ${err.requested}`);
    console.log(`Remaining: ${err.remaining}`);

    if (err.windowResetsAt) {
      console.log(`Budget frees at: ${err.windowResetsAt.toISOString()}`);
    }
  }
}
```

### `ProtectedExceedsBudgetError`

Thrown when protected messages (system prompts, current user message) alone exceed the budget, making safe truncation impossible. Code: `'PROTECTED_EXCEEDS_BUDGET'`.

| Property | Type | Description |
|---|---|---|
| `scope` | `string` | The scope that triggered the error. |
| `protectedTokens` | `number` | Total tokens in protected messages. |
| `budget` | `number` | Configured budget limit. |

### `FenceConfigError`

Thrown when the fence configuration is invalid. Code: `'FENCE_CONFIG_ERROR'`.

| Property | Type | Description |
|---|---|---|
| `validationErrors` | `string[]` | List of all validation issues found. |

```typescript
import { createFence, FenceConfigError } from 'token-fence';

try {
  createFence({ budgets: {} });
} catch (err) {
  if (err instanceof FenceConfigError) {
    console.log(err.validationErrors);
    // ['At least one budget scope must be configured']
  }
}
```

---

## Advanced Usage

### Custom Token Counter

Replace the approximate counter with an exact tokenizer for accurate budget enforcement.

```typescript
import { createFence } from 'token-fence';
import { encode } from 'gpt-tokenizer'; // or any tokenizer

const fence = createFence({
  budgets: { perRequest: { maxInputTokens: 4096 } },
  tokenCounter: (text: string) => encode(text).length,
});
```

### Custom Storage Adapter

Implement the `FenceStore` interface to persist counters across process restarts.

```typescript
import type { FenceStore } from 'token-fence';

class RedisStore implements FenceStore {
  constructor(private redis: RedisClient) {}

  async get(key: string): Promise<number> {
    const val = await this.redis.get(`fence:${key}`);
    return val ? Number(val) : 0;
  }

  async set(key: string, value: number): Promise<void> {
    await this.redis.set(`fence:${key}`, String(value));
  }

  async increment(key: string, delta: number): Promise<number> {
    return this.redis.incrByFloat(`fence:${key}`, delta);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(`fence:${key}`);
  }

  async getWindow(key: string, bucketCount: number): Promise<number[]> {
    const data = await this.redis.get(`fence:win:${key}`);
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed.length === bucketCount) return parsed;
    }
    const buckets = new Array(bucketCount).fill(0);
    await this.redis.set(`fence:win:${key}`, JSON.stringify(buckets));
    return buckets;
  }

  async recordBucket(key: string, bucketIndex: number, delta: number): Promise<void> {
    const buckets = await this.getWindow(key, 60);
    buckets[bucketIndex] += delta;
    await this.redis.set(`fence:win:${key}`, JSON.stringify(buckets));
  }

  async resetBuckets(key: string, bucketIndices: number[]): Promise<void> {
    const buckets = await this.getWindow(key, 60);
    for (const idx of bucketIndices) {
      buckets[idx] = 0;
    }
    await this.redis.set(`fence:win:${key}`, JSON.stringify(buckets));
  }
}
```

### Pre-filling Usage for Existing Users

Seed the store with existing usage data before creating the fence.

```typescript
import { createFence, InMemoryStore } from 'token-fence';

const store = new InMemoryStore();
store.increment('user:alice', 50_000); // Alice has already used 50k tokens

const fence = createFence({
  budgets: { perUser: { maxInputTokens: 100_000 } },
  store,
});

// Alice's next request will be checked against the remaining 50k
```

### Multiple Budget Scopes

Combine per-request, per-user, per-session, and global budgets. The most restrictive scope wins.

```typescript
const fence = createFence({
  budgets: {
    perRequest: { maxInputTokens: 8_000 },
    perUser: { maxTotalTokens: 100_000, window: '1h' },
    perSession: { maxTotalTokens: 200_000 },
    global: { maxTotalTokens: 10_000_000, window: '1d' },
    custom: {
      team: { maxTotalTokens: 500_000, window: '1d' },
    },
  },
  action: 'block',
});

// Check against all scopes at once
fence.check(messages, {
  userId: 'alice',
  sessionId: 'conv-123',
  scopes: { team: 'engineering' },
});
```

### Event Callbacks for Monitoring

```typescript
const fence = createFence({
  budgets: { perUser: { maxInputTokens: 100_000, window: '1h' } },
  onBlock: (event) => {
    console.warn(
      `[BLOCKED] scope=${event.scope} scopeId=${event.scopeId} ` +
      `limit=${event.limit} current=${event.current} requested=${event.requested}`
    );
  },
  onUsage: (event) => {
    console.log(
      `[USAGE] user=${event.userId} input=${event.inputTokens} ` +
      `output=${event.outputTokens} total=${event.totalTokens}`
    );
  },
});
```

### Windowed Budgets with Recovery

Time-windowed budgets automatically free capacity as time passes. No manual reset needed.

```typescript
const fence = createFence({
  budgets: {
    perUser: { maxInputTokens: 10_000, window: '1m' },
  },
});

const ctx = { userId: 'alice' };

// Record 10,000 tokens -- budget is now exhausted
fence.record(messages, { input: 10_000, output: 0, total: 10_000 }, ctx);

// This will throw BudgetExceededError
fence.check(messages, ctx);

// After 60 seconds, the window slides and capacity is restored
// fence.check(messages, ctx) will pass again
```

---

## TypeScript

All types are exported from the main entry point.

```typescript
import type {
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
} from 'token-fence';

import type { BudgetCheckResult } from 'token-fence';
import type { FenceInstance } from 'token-fence';
```

The package compiles to ES2022 CommonJS modules with full declaration files and source maps.

---

## License

MIT
