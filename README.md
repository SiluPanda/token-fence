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

### Budget Enforcement (planned)

```typescript
import { createFence } from 'token-fence';

// createFence() is not yet implemented — coming in a future release.
const fence = createFence({
  budgets: {
    perRequest: { maxInputTokens: 8000 },
    perUser: { maxTotalTokens: 100_000, window: '1h' },
    global: { maxTotalTokens: 10_000_000, window: '1d' },
  },
  action: 'block',
});
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

### Counter API

#### `approximateTokenCounter(text: string): number`

Default token counter using the heuristic of ~4 characters per token: `Math.ceil(text.length / 4)`.

#### `countMessageTokens(msg, tokenCounter?, messageOverhead?): number`

Count tokens for a single `Message`. Includes content, name, tool_calls (JSON-serialized), and tool_call_id. Adds `messageOverhead` (default: 4) per message.

#### `countTotalInputTokens(messages, tokenCounter?, messageOverhead?): number`

Sum `countMessageTokens` across all messages in the array.

## License

MIT
