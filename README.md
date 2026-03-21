# token-fence

Token budget enforcement middleware with intelligent truncation for LLM API calls.

## Installation

```bash
npm install token-fence
```

## Quick Start

### Token Counting

```typescript
import {
  approximateTokenCounter,
  countMessageTokens,
  countTotalInputTokens,
} from 'token-fence';
import type { Message } from 'token-fence';

// Count tokens in a string (~4 chars per token)
const tokens = approximateTokenCounter('Hello, world!');
// => 4

// Count tokens for a single message (includes per-message overhead)
const msg: Message = { role: 'user', content: 'What is the weather today?' };
const msgTokens = countMessageTokens(msg);

// Count total input tokens for a conversation
const messages: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'What is the weather today?' },
];
const total = countTotalInputTokens(messages);
```

### Budget Enforcement

```typescript
import { createFence, BudgetExceededError } from 'token-fence';
import type { Message } from 'token-fence';

const fence = createFence({
  budgets: {
    perRequest: { maxInputTokens: 8000 },
    perUser: { maxTotalTokens: 100_000, window: '1h' },
    global: { maxTotalTokens: 10_000_000, window: '1d' },
  },
  action: 'block',
});

const messages: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Summarise this document...' },
];

// Pre-flight check — throws BudgetExceededError if any budget is exceeded
try {
  fence.check(messages, { userId: 'alice', sessionId: 'session-1' });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error(`Blocked by ${err.scope} budget (limit ${err.limit}, current ${err.current})`);
  }
}

// After the LLM responds, record actual usage to update cumulative counters
fence.record(messages, { input: 312, output: 88, total: 400 }, { userId: 'alice', sessionId: 'session-1' });
```

## Available Exports

### Types

All TypeScript interfaces and type aliases for configuration, messages, events, and the fence API:

- `TokenCounter`, `EnforcementAction`, `BudgetScope`, `WindowPreset`
- `Message`, `RequestBudget`, `ScopedBudget`, `BudgetConfig`, `FenceConfig`
- `FenceContext`, `AllowanceResult`, `ScopeAllowance`, `ScopeUsage`
- `BlockEvent`, `TruncateEvent`, `WarningEvent`, `UsageEvent`
- `FenceMetadata`, `FenceStore`, `TokenFence`

### Error Classes

- `FenceError` -- Base error with a `code` property.
- `BudgetExceededError` -- Thrown when a budget limit is exceeded (`code: 'BUDGET_EXCEEDED'`).
- `ProtectedExceedsBudgetError` -- Thrown when protected messages alone exceed the budget (`code: 'PROTECTED_EXCEEDS_BUDGET'`).
- `FenceConfigError` -- Thrown for invalid configuration (`code: 'FENCE_CONFIG_ERROR'`).

### Fence API

#### `createFence(config: FenceConfig): FenceInstance`

Create a fence instance. Validates `config` on construction and throws `FenceConfigError` if invalid. At least one budget scope must be configured.

**`config` fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `budgets` | `BudgetConfig` | required | Budget scopes to enforce. |
| `action` | `'block' \| 'truncate' \| 'warn'` | `'block'` | Default enforcement action. |
| `tokenCounter` | `(text: string) => number` | approximate (÷4) | Custom token counting function. |
| `messageOverhead` | `number` | `4` | Per-message token overhead. |
| `store` | `FenceStore` | `InMemoryStore` | Pluggable persistence adapter. |
| `onBlock` | `(event: BlockEvent) => void` | — | Called when a request is blocked. |
| `onUsage` | `(event: UsageEvent) => void` | — | Called after each `record()` call. |

#### `fence.check(messages, context?): void`

Pre-flight check. Iterates all configured budget scopes in order (perRequest → perUser → perSession → global → custom). Throws `BudgetExceededError` if any scope is exceeded. Does not mutate counters.

#### `fence.record(messages, usage, context?): void`

Record actual token usage after a request completes. Updates cumulative and windowed counters for all applicable scopes (perUser, perSession, global, custom). `usage` must contain `{ input, output, total }` token counts as returned by the LLM API.

### Counter API

#### `approximateTokenCounter(text: string): number`

Default token counter using the heuristic of ~4 characters per token: `Math.ceil(text.length / 4)`.

#### `countMessageTokens(msg, tokenCounter?, messageOverhead?): number`

Count tokens for a single `Message`. Includes content, name, tool_calls (JSON-serialized), and tool_call_id. Adds `messageOverhead` (default: 4) per message.

#### `countTotalInputTokens(messages, tokenCounter?, messageOverhead?): number`

Sum `countMessageTokens` across all messages in the array.

## License

MIT
