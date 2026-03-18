# token-fence -- Specification

## 1. Overview

`token-fence` is a token budget enforcement middleware for LLM API clients. It wraps an LLM SDK client (OpenAI, Anthropic, or any compatible client) and enforces hard token spending limits per request, per user, per session, and over sliding time windows. Before each API call, the middleware counts the tokens in the outgoing request, checks the count against configured budgets, and either allows the request, intelligently truncates the input to fit within the budget, or blocks the request entirely. After each API call, the middleware records the actual token usage (input + output) against the relevant budget scopes. The result is a transparent enforcement layer that prevents token overspending without requiring changes to application logic.

The gap this package fills is specific and well-defined. The LLM tooling ecosystem has packages for token counting (`gpt-tokenizer`, `js-tiktoken`), context window management (`context-budget`, `sliding-context`), cost estimation (`prompt-price`, `ai-cost-compare`), and circuit breaking (`ai-circuit-breaker`). But nothing sits between the application and the LLM API to enforce spending limits as a hard constraint. `context-budget` allocates tokens within a single context window -- it decides how much space each section of a prompt gets. `token-fence` operates at a higher level: it enforces that a user does not exceed 100,000 tokens per hour, that a single request does not exceed 8,000 input tokens, that a conversation session does not consume more than 500,000 tokens total, and that the entire application does not exceed 10 million tokens per day. These are spending limits, not layout allocations. `context-budget` answers "how should I distribute tokens within this request?" while `token-fence` answers "should this request be allowed to proceed at all?"

The distinction from `ai-circuit-breaker` is equally precise. A circuit breaker trips when an API is failing (errors, timeouts, degraded responses) and prevents further calls to a broken service. `token-fence` trips when spending exceeds a budget and prevents further calls to a working service. The circuit breaker protects against unreliable providers. The token fence protects against uncontrolled spending. They are complementary: a production deployment uses both, and `token-fence` integrates with `ai-circuit-breaker` so that a tripped fence can be treated as a circuit break condition.

`token-fence` provides a TypeScript/JavaScript API only. No CLI. The primary interface is a `fence()` middleware function that wraps an LLM client and returns a fenced client with the same API surface. All enforcement is transparent -- the calling code does not need to know the fence exists. When a request is blocked, the fence throws a `BudgetExceededError` with details about which budget was exceeded, how much was spent, and how much remains. When a request is truncated, the fence modifies the messages array before forwarding it to the underlying client, and the response includes metadata indicating truncation occurred.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `fence(client, options)` middleware function that wraps an LLM SDK client and returns a fenced client with identical API surface, transparently enforcing token budgets on every API call.
- Provide a `createFence(config)` factory function that creates a reusable `TokenFence` instance with pre-configured budgets, which can be applied to multiple clients.
- Enforce token budgets at multiple scopes: per-request (single call limit), per-user (identified by a user ID string), per-session (identified by a session ID string), per-time-window (sliding window: per-minute, per-hour, per-day), and global (across all users and sessions).
- Support three enforcement actions when a budget is exceeded: `block` (throw an error, do not send the request), `truncate` (intelligently reduce the input to fit within the budget, then send), and `warn` (send the request but invoke a callback and tag the response).
- Implement intelligent truncation that respects message semantics: truncate conversation history from the oldest end, never truncate the system prompt, never truncate the current user message, preserve tool call/result pairs, and allow configurable priority ordering for which content to remove first.
- Count tokens before sending the request (to enforce input budgets) and record actual token usage after the response (to track cumulative spending against time-window and session budgets).
- Support pluggable token counting: a built-in approximate counter for zero-dependency use, and a pluggable interface for exact counters (tiktoken, gpt-tokenizer).
- Track token spending over sliding time windows with configurable window sizes (1 minute, 1 hour, 1 day, or custom durations), supporting both input tokens, output tokens, and total tokens as separate trackable dimensions.
- Provide a `fence.check(messages)` method that pre-checks whether a set of messages would exceed any budget without actually sending the request, returning an allowance result.
- Provide a `fence.getAllowance(scope)` method that returns how many tokens remain in a given budget scope (user, session, or time window).
- Provide a `fence.getUsage(scope)` method that returns cumulative token usage for a scope.
- Provide a `fence.reset(scope)` method that resets spending counters for a scope (for administrative override).
- Emit events on budget enforcement actions (blocked, truncated, warned) for logging and monitoring integration.
- Keep runtime dependencies at zero. The package uses only built-in JavaScript APIs (Map, Date, Array). Token counting libraries, LLM SDKs, and sibling packages are optional integrations.
- Integrate with sibling packages: use `prompt-price` to convert token counts to dollar costs for cost-based budgets, use `model-price-registry` to resolve model pricing, and coordinate with `ai-circuit-breaker` to trip a circuit when a budget is exhausted.

### Non-Goals

- **Not a context window allocator.** This package enforces spending limits. It does not decide how to distribute tokens across sections of a prompt (system prompt, tools, conversation, RAG). Use `context-budget` for context window allocation within a single request.
- **Not a token counter.** This package includes a rough approximate counter as a convenience. For accurate token counting, the caller provides a `tokenCounter` function. The package does not bundle tiktoken, gpt-tokenizer, or any tokenizer library.
- **Not an LLM API client.** This package wraps an existing client. It does not make HTTP requests, manage API keys, or implement any provider's API. It intercepts calls on the wrapped client and delegates to the original.
- **Not a billing system.** This package tracks token counts and enforces limits. It does not store persistent billing records, generate invoices, or integrate with payment processors. Use `ai-chargeback` for chargeback and billing attribution.
- **Not a rate limiter on API calls.** This package limits token spending, not request count. A user could make 1,000 small requests that collectively stay under the token budget. For request-count rate limiting, use standard rate limiting middleware. However, the sliding window mechanism can be configured to approximate request-rate limiting by setting very low per-request budgets.
- **Not a persistent store.** Spending counters are held in memory by default. When the process restarts, counters reset. For durable budget enforcement across restarts, the caller provides a `store` adapter that persists counters to Redis, a database, or a file.
- **Not a cost optimizer.** This package enforces ceilings. It does not suggest cheaper models, optimize prompts for lower token usage, or route requests to minimize cost. Use `ai-cost-compare` for model cost comparison.

---

## 3. Target Users and Use Cases

### SaaS Platforms Offering AI Features

Teams building SaaS products where end users interact with an LLM (chatbots, AI assistants, document summarization, code generation). Each user has a token quota tied to their subscription tier -- free users get 50,000 tokens/day, pro users get 1,000,000 tokens/day, enterprise is unlimited. The platform wraps the LLM client with `token-fence` configured with per-user daily budgets. When a user exhausts their quota, the fence blocks further requests and the application returns a "quota exceeded" message. The fence handles all the counting, tracking, and enforcement; the application code just calls the LLM client normally.

### Internal AI Tooling Teams

Engineering teams deploying internal AI tools (code review bots, documentation generators, Slack bots) that share a single API key. Without enforcement, one runaway bot can exhaust the organization's monthly token budget in hours. `token-fence` enforces a global daily budget across all tools, plus per-tool session budgets. If the code review bot is consuming tokens faster than expected, the fence throttles it before it impacts the documentation generator's budget.

### Agent Framework Authors

Teams building autonomous agent frameworks where agents loop through many LLM calls to accomplish a task. An agent stuck in a reasoning loop can generate hundreds of calls, consuming millions of tokens. `token-fence` enforces a per-session budget: each agent task gets a session with a 200,000-token ceiling. If the agent has not completed its task within that budget, the fence blocks further calls and the framework can escalate to a human or abort the task.

### Multi-Tenant API Gateways

Teams building API gateways that proxy LLM requests for multiple downstream clients. Each client has a contracted token allocation. The gateway wraps the LLM client with `token-fence` using per-user budgets mapped to client IDs. The fence enforces each client's allocation independently, and the gateway reads `fence.getUsage(clientId)` to populate usage dashboards and billing reports.

### Cost-Conscious Developers

Individual developers and small teams who want guardrails on their LLM spending during development. A misconfigured loop or an unexpectedly large prompt can burn through dollars in minutes. `token-fence` with a global hourly budget acts as a safety net: "never spend more than 500,000 tokens per hour regardless of what my code does." The developer gets immediate feedback (a thrown error) instead of a surprise bill.

---

## 4. Core Concepts

### Token Fence

A token fence is an enforcement boundary placed between application code and an LLM API client. Every request passes through the fence before reaching the API. The fence inspects the request, counts tokens, checks budgets, and decides whether to allow, truncate, or block the request. After the response arrives, the fence records the actual token usage. The metaphor is a physical fence: it controls what passes through and how much.

### Budget Scope

A budget scope is the dimension along which token spending is tracked and limited. Scopes are orthogonal -- a single request is checked against all applicable scopes, and the most restrictive scope determines the outcome. The supported scopes are:

- **Per-request**: A hard limit on tokens in a single API call. Checked before sending. If the request's input tokens exceed this limit, the fence truncates or blocks. This prevents individual oversized requests.
- **Per-user**: A cumulative limit on tokens consumed by a specific user, identified by a string user ID. Tracked across all requests from that user. Typically combined with a time window (per-user-per-day).
- **Per-session**: A cumulative limit on tokens consumed within a specific session, identified by a string session ID. A session typically maps to a conversation, an agent task, or a browser session.
- **Per-time-window**: A sliding window limit on tokens consumed over a time period. Supports per-minute, per-hour, per-day, and custom durations. Can be scoped globally, per-user, or per-session.
- **Global**: A cumulative limit on total tokens consumed by the fenced client, across all users and sessions. Typically used with a time window.

### Enforcement Action

The enforcement action determines what happens when a request would cause a budget to be exceeded:

- **Block**: The fence throws a `BudgetExceededError`. The request is not sent. The application receives an error it can catch and handle (show a "quota exceeded" UI, return a 429 response, escalate to a human).
- **Truncate**: The fence reduces the input to fit within the remaining budget. Truncation is intelligent: it removes conversation history from the oldest end, preserves system prompts and the current user message, and respects message boundaries. The truncated request is sent, and the response includes metadata indicating truncation occurred.
- **Warn**: The fence allows the request to proceed as-is but invokes the `onBudgetWarning` callback and tags the response with warning metadata. This is useful during a migration period when the team wants visibility into budget violations without hard enforcement.

### Intelligent Truncation

When the enforcement action is `truncate`, the fence must decide what to remove from the messages array. Not all messages are equally expendable. The truncation algorithm uses a priority system:

1. **Never truncate**: System prompts (`role: 'system'`) and the most recent user message are never removed. If these alone exceed the budget, the fence falls back to `block` because no safe truncation is possible.
2. **Truncate first**: Oldest conversation history messages are removed first. Each removal drops one user-assistant pair (or a single message if unpaired) from the oldest end of the conversation.
3. **Preserve tool pairs**: If an assistant message with `tool_calls` is removed, all corresponding tool result messages are also removed. Orphaned tool results or tool calls produce malformed requests.
4. **Configurable priorities**: The caller can assign priority levels to messages by role or by custom tags. Lower-priority messages are removed before higher-priority ones.
5. **Whole-message granularity**: Messages are removed whole. The fence does not truncate mid-message because a half-truncated assistant response or user query produces nonsensical context.

### Token Counting

The fence counts tokens at two points in the lifecycle:

1. **Pre-send count**: Before the request is sent, the fence estimates the token count of the input messages. This is used to check per-request budgets and to determine whether truncation is needed. The count uses the configured `tokenCounter` function (default: approximate `Math.ceil(text.length / 4)`).
2. **Post-response record**: After the response arrives, the fence reads the actual token usage from the API response metadata (`usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens` for OpenAI; `usage.input_tokens`, `usage.output_tokens` for Anthropic). This actual usage is recorded against cumulative budget scopes (per-user, per-session, per-time-window, global). Actual API-reported usage is always preferred over estimates for cumulative tracking.

### Sliding Window

Time-based budgets use a sliding window algorithm. Instead of resetting at fixed clock boundaries (midnight, top of the hour), the window slides continuously. A "100,000 tokens per hour" budget means that at any point in time, the total tokens consumed in the preceding 60 minutes must not exceed 100,000. This prevents gaming that occurs with fixed windows (consuming the entire budget in the last minute of one window and the first minute of the next).

The implementation uses a bucketed sliding window. Time is divided into small buckets (default: 1/60th of the window duration). Each bucket records the token count for that sub-interval. The current window's total is the sum of all buckets within the window. Old buckets are evicted when they fall outside the window. This provides O(1) amortized time complexity for recording and checking, with configurable precision via bucket granularity.

---

## 5. Budget Scopes in Detail

### Per-Request Budget

The per-request budget limits the number of input tokens in a single API call. It is checked before the request is sent and operates on the estimated token count of the messages array.

```
Request with 12,000 input tokens
Per-request budget: 8,000 tokens
Action: truncate

→ Fence removes oldest conversation messages until input ≤ 8,000 tokens
→ Request is sent with truncated messages
→ Response includes truncation metadata
```

The per-request budget does not count output tokens because the output size is not known until the response arrives. To limit output tokens, use the `max_tokens` parameter on the API call itself. The fence does not modify `max_tokens` -- that is the caller's responsibility.

### Per-User Budget

The per-user budget limits cumulative token spending by a specific user. The user is identified by a string ID passed in the request context. The budget can be a flat ceiling (user X can spend at most 1,000,000 tokens total) or a time-windowed ceiling (user X can spend at most 100,000 tokens per hour).

```
User "alice" has consumed 95,000 tokens today
Per-user daily budget: 100,000 tokens
New request estimates 8,000 input tokens

→ Pre-check: 95,000 + 8,000 = 103,000 > 100,000
→ Action: block (throw BudgetExceededError)
→ Error includes: remaining = 5,000 tokens, requested = 8,000 tokens
```

User identification is the caller's responsibility. The fence does not authenticate users. The caller passes a `userId` in the request context, and the fence trusts it. In a SaaS application, the `userId` comes from the authenticated session. In an agent framework, it might be the agent's task ID.

### Per-Session Budget

The per-session budget limits cumulative token spending within a session. A session is a logical unit of interaction -- a conversation thread, an agent task execution, a document processing job. The session is identified by a string ID passed in the request context.

```
Session "conv-abc-123" has consumed 180,000 tokens
Per-session budget: 200,000 tokens
New request estimates 15,000 input tokens + expected ~5,000 output tokens

→ Pre-check: 180,000 + 15,000 = 195,000 ≤ 200,000 (passes input check)
→ Request is sent
→ Response reports actual usage: 14,800 input + 6,200 output = 21,000 total
→ Post-record: 180,000 + 21,000 = 201,000 > 200,000
→ Session is now over budget; next request will be blocked
```

The session budget tracks total tokens (input + output) by default, because output tokens cost money too (often more per token than input). The caller can configure whether the session budget tracks input only, output only, or total.

### Per-Time-Window Budget

Time-windowed budgets limit token spending over a sliding time period. They can be scoped globally, per-user, or per-session.

```
Global per-hour budget: 500,000 tokens

Time: 14:00 → 14:15 — consumed 200,000 tokens
Time: 14:15 → 14:30 — consumed 150,000 tokens
Time: 14:30 → 14:45 — consumed 100,000 tokens
Current total (14:00–14:45): 450,000 tokens

New request at 14:46 estimates 60,000 tokens
→ 450,000 + 60,000 = 510,000 > 500,000
→ Action: block

At 15:01, the 14:00–14:15 bucket (200,000 tokens) slides out of the window
→ Current total (14:01–15:01): 250,000 tokens
→ 250,000 remaining budget is now available
```

Common presets:

| Preset | Window Duration | Typical Use |
|---|---|---|
| Per-minute | 60 seconds | Burst protection |
| Per-hour | 3,600 seconds | Sustained rate limiting |
| Per-day | 86,400 seconds | Daily quota |
| Custom | Any duration | Application-specific |

### Global Budget

The global budget limits total token spending across all users and sessions. It is typically time-windowed (global per-day, global per-hour) to prevent runaway spending. A flat global budget (no time window) limits total lifetime spending, which is rarely useful except as an absolute safety cap.

```
Global daily budget: 10,000,000 tokens
Current daily total: 9,500,000 tokens

Any new request consuming more than 500,000 tokens is blocked
regardless of which user or session initiated it.
```

### Scope Precedence

When multiple scopes apply to a request, the fence checks all of them and the most restrictive scope determines the outcome. If the per-request budget allows the request but the per-user budget blocks it, the request is blocked. The `BudgetExceededError` includes which scope caused the block.

Check order:

1. Per-request (input token count vs. request limit)
2. Per-user (cumulative + estimated input vs. user limit)
3. Per-session (cumulative + estimated input vs. session limit)
4. Per-time-window (window total + estimated input vs. window limit)
5. Global (global total + estimated input vs. global limit)

If any scope blocks, the request does not proceed to subsequent checks.

---

## 6. Enforcement Actions in Detail

### Block

The fence throws a `BudgetExceededError` and the request is not sent to the LLM API. The error includes:

- `scope`: Which budget scope was exceeded (`'request'`, `'user'`, `'session'`, `'window'`, `'global'`).
- `limit`: The configured budget limit.
- `current`: The current cumulative usage in that scope.
- `requested`: The estimated tokens for the blocked request.
- `remaining`: How many tokens remain in the scope (`limit - current`).
- `windowResetsAt`: For time-windowed scopes, the timestamp when enough budget will be freed by the sliding window to accommodate the request (if predictable).
- `userId`: The user ID, if the exceeded scope is per-user.
- `sessionId`: The session ID, if the exceeded scope is per-session.

The caller catches this error and decides how to respond: return a quota-exceeded message to the user, queue the request for later, switch to a cheaper model, or escalate.

### Truncate

The fence modifies the messages array to reduce the input token count below the available budget. Truncation follows the intelligent truncation algorithm described in Section 4. After truncation, the fence sends the modified request. The response object returned to the caller is augmented with a `_fence` metadata property:

```typescript
response._fence = {
  truncated: true,
  originalTokens: 12000,
  truncatedTokens: 7800,
  messagesRemoved: 4,
  scope: 'request',
};
```

The calling code can check `response._fence.truncated` to know that the conversation was shortened. This is important for user-facing applications that may want to display a notice like "Some conversation history was trimmed to stay within your budget."

Truncation is only applicable to the per-request scope. For cumulative scopes (per-user, per-session, per-time-window, global), truncation would mean reducing the input to fit within the remaining cumulative budget, which may result in a request so small it is useless. The caller can configure a `minTokensAfterTruncation` threshold: if truncation would reduce the input below this threshold, the fence falls back to `block` instead.

### Warn

The fence sends the request as-is and invokes the `onBudgetWarning` callback with details about which budget would have been exceeded. The response is augmented with warning metadata:

```typescript
response._fence = {
  warning: true,
  scope: 'user',
  limit: 100000,
  current: 95000,
  afterRequest: 108000,
};
```

Warn mode is useful for gradual rollout: deploy the fence in warn mode first, monitor the warnings to understand spending patterns, then switch to block or truncate once budgets are calibrated.

---

## 7. Intelligent Truncation Algorithm

When the fence needs to reduce a messages array to fit within a token budget, it follows this algorithm:

### Step 1: Classify Messages

Each message is classified into one of three categories:

- **Protected**: System messages and the most recent user message. These are never removed. If protected messages alone exceed the budget, truncation fails and the fence falls back to `block`.
- **Paired**: Messages that are part of a tool call/result pair. An assistant message with `tool_calls` and its corresponding tool result messages form a group. The group is removed or kept as a unit.
- **Standard**: All other messages (user/assistant conversation turns). These are candidates for removal.

### Step 2: Calculate Protected Token Count

```
protectedTokens = sum of tokenCount(msg) for all protected messages
```

If `protectedTokens > budget`, throw `BudgetExceededError` with code `PROTECTED_EXCEEDS_BUDGET`. No safe truncation is possible.

### Step 3: Calculate Available Budget for Removable Messages

```
availableForRemovable = budget - protectedTokens
```

### Step 4: Remove Messages from Oldest End

Starting from the oldest non-protected message:

1. If the message is part of a tool pair, identify the entire group (assistant tool_calls message + all tool result messages for those tool calls).
2. Remove the message (or group).
3. Recalculate the total token count of remaining removable messages.
4. If the total of remaining removable messages fits within `availableForRemovable`, stop.
5. Otherwise, continue to the next oldest message.

### Step 5: Validate and Return

After removal, the remaining messages array is:

```
[...protected system messages, ...surviving conversation messages, current user message]
```

Verify that the total token count of the final messages array is within the budget. Return the truncated array.

### Edge Cases

- **All removable messages must be removed**: If removing every non-protected message still does not fit within the budget, the fence falls back to `block`. This means the system prompt + current message exceed the budget.
- **Single-message conversation**: If there is only a system message and a user message, there is nothing to truncate. The fence falls back to `block` if they exceed the budget.
- **No system message**: Some API calls have no system message. The current user message is still protected. All preceding messages are candidates for removal.
- **Multiple system messages**: All system messages are protected. OpenAI allows multiple system messages; Anthropic uses a separate `system` parameter. The fence handles both conventions.

---

## 8. Token Counting

### Built-in Approximate Counter

The default token counter estimates tokens as `Math.ceil(text.length / 4)`. This is the same approximation used by `context-budget` and follows the same accuracy characteristics:

| Content Type | Approximate Accuracy |
|---|---|
| English prose | ~95% |
| Code (JavaScript/Python) | ~85% (overestimates) |
| JSON data | ~75% (overestimates) |
| CJK text | ~35% (severely underestimates) |

Overestimation is safe for budget enforcement: the fence may block a request that would have fit, but it will not allow a request that exceeds the budget. Underestimation (CJK text) is unsafe: the fence may allow requests that actually exceed the budget. Callers working with non-Latin text must provide an exact counter.

### Message Token Counting

When counting tokens for a messages array, the fence counts each message individually and sums them:

```
messageTokens(msg) =
  tokenCounter(msg.content || '')
  + messageOverhead                        // per-message overhead (default: 4)
  + (msg.name ? tokenCounter(msg.name) : 0)
  + (msg.tool_calls ? tokenCounter(JSON.stringify(msg.tool_calls)) : 0)
  + (msg.tool_call_id ? tokenCounter(msg.tool_call_id) : 0)

totalInputTokens = sum of messageTokens(msg) for all messages in the request
```

The `messageOverhead` accounts for role tokens, message delimiters, and other structural tokens that providers add around each message. The default of 4 matches OpenAI's overhead for chat completions.

### Pluggable Exact Counter

The caller provides a `tokenCounter` function for exact counting:

```typescript
import { encode } from 'gpt-tokenizer';

const fenced = fence(client, {
  tokenCounter: (text) => encode(text).length,
  budgets: { /* ... */ },
});
```

### Post-Response Actual Usage

After a response arrives, the fence reads the actual token usage from the API response. OpenAI includes `usage.prompt_tokens` and `usage.completion_tokens`. Anthropic includes `usage.input_tokens` and `usage.output_tokens`. The fence normalizes these into `{ input: number, output: number, total: number }` and records the actual values against cumulative budget scopes. Pre-send estimates are only used for pre-flight budget checks; cumulative tracking always uses actual API-reported values when available.

---

## 9. Sliding Window Tracking

### Algorithm

Time-windowed budgets use a bucketed sliding window algorithm. The window is divided into `bucketCount` equal-duration buckets (default: 60 buckets per window). Each bucket records the token count for its sub-interval.

```
Window: 1 hour (3,600,000 ms)
Buckets: 60 (each bucket = 60,000 ms = 1 minute)

Bucket layout at time T:
[bucket_0] [bucket_1] ... [bucket_59]
 ← oldest                  newest →

When recording usage at time T:
  bucketIndex = floor((T % windowDuration) / bucketDuration)
  buckets[bucketIndex] += tokens

When checking budget at time T:
  total = sum of all buckets within the window [T - windowDuration, T]
  return total
```

### Bucket Eviction

When the window slides forward, old buckets become stale. On each access (record or check), the fence calculates how many buckets have elapsed since the last access. Stale buckets are reset to zero. This is lazy eviction -- no background timers are needed.

```typescript
// On access at time T:
const elapsed = T - lastAccessTime;
const bucketsToEvict = Math.floor(elapsed / bucketDuration);
for (let i = 0; i < Math.min(bucketsToEvict, bucketCount); i++) {
  buckets[(lastBucketIndex + 1 + i) % bucketCount] = 0;
}
```

If the elapsed time exceeds the entire window duration, all buckets are reset (equivalent to a fresh start).

### Precision vs. Memory

The bucket count determines the trade-off between precision and memory:

| Buckets | Precision | Memory per Window |
|---|---|---|
| 10 | ~10% of window duration | ~80 bytes |
| 60 | ~1.7% of window duration | ~480 bytes |
| 360 | ~0.3% of window duration | ~2.9 KB |

The default of 60 buckets provides minute-level precision for hourly windows and second-level precision for minute windows. For most applications, this is more than sufficient.

### Multiple Windows

A single fence can track multiple time windows simultaneously. For example, a configuration might enforce both a per-hour and a per-day budget. Each window has its own bucket array. A request must pass all window checks to proceed.

---

## 10. API Surface

### Installation

```bash
npm install token-fence
```

### Primary Function: `fence`

```typescript
import { fence } from 'token-fence';
import OpenAI from 'openai';

const client = new OpenAI();

const fenced = fence(client, {
  budgets: {
    perRequest: { maxInputTokens: 8000 },
    perUser: { maxTotalTokens: 100000, window: '1h' },
    perSession: { maxTotalTokens: 500000 },
    global: { maxTotalTokens: 10000000, window: '1d' },
  },
  action: 'block',
  tokenCounter: (text) => encode(text).length,
});

// Use exactly like the original client
const response = await fenced.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ],
  // Fence context: identifies user and session for budget tracking
  _fence: { userId: 'alice', sessionId: 'conv-123' },
});
```

### Factory Function: `createFence`

```typescript
import { createFence } from 'token-fence';

const myFence = createFence({
  budgets: {
    perRequest: { maxInputTokens: 8000 },
    perUser: { maxTotalTokens: 100000, window: '1h' },
    perSession: { maxTotalTokens: 500000 },
    global: { maxTotalTokens: 10000000, window: '1d' },
  },
  action: 'block',
  tokenCounter: (text) => encode(text).length,
  onBlock: (event) => console.warn('Blocked:', event),
  onTruncate: (event) => console.log('Truncated:', event),
  onWarning: (event) => console.log('Warning:', event),
});

// Pre-check without sending
const allowance = myFence.check(messages, { userId: 'alice', sessionId: 'conv-123' });
// allowance.allowed → true/false
// allowance.remaining → { request: 3000, user: 45000, session: 320000, global: 8500000 }

// Check remaining allowance for a user
const userAllowance = myFence.getAllowance({ userId: 'alice' });
// userAllowance → { remaining: 45000, limit: 100000, used: 55000, windowResetsAt: Date }

// Get usage report for a session
const usage = myFence.getUsage({ sessionId: 'conv-123' });
// usage → { input: 120000, output: 60000, total: 180000 }

// Reset a user's budget (admin override)
myFence.reset({ userId: 'alice' });

// Apply to a client
const fencedClient = myFence.apply(client);
```

### Type Definitions

```typescript
// ── Fence Configuration ─────────────────────────────────────────────

/** Configuration for the fence middleware. */
interface FenceConfig {
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

// ── Budget Configuration ────────────────────────────────────────────

/** Budget definitions for each scope. */
interface BudgetConfig {
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

/** Budget for a single request. */
interface RequestBudget {
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
interface ScopedBudget {
  /**
   * Maximum input tokens for this scope.
   * Mutually exclusive with maxTotalTokens and maxOutputTokens
   * when used as the sole limit. Can be combined with other limits
   * when multiple limits should apply.
   */
  maxInputTokens?: number;

  /** Maximum output tokens for this scope. */
  maxOutputTokens?: number;

  /** Maximum total tokens (input + output) for this scope. */
  maxTotalTokens?: number;

  /**
   * Sliding window duration.
   * If omitted, the budget is a lifetime cumulative limit (resets only on fence.reset()).
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

// ── Enforcement ─────────────────────────────────────────────────────

type EnforcementAction = 'block' | 'truncate' | 'warn';

// ── Token Counter ───────────────────────────────────────────────────

/** Function that counts the number of tokens in a text string. */
type TokenCounter = (text: string) => number;

// ── Request Context ─────────────────────────────────────────────────

/** Context passed with each request to identify budget scopes. */
interface FenceContext {
  /** User identifier for per-user budgets. */
  userId?: string;

  /** Session identifier for per-session budgets. */
  sessionId?: string;

  /** Custom scope identifiers for custom budgets. */
  scopes?: Record<string, string>;
}

// ── Allowance ───────────────────────────────────────────────────────

/** Result of a pre-flight budget check. */
interface AllowanceResult {
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
interface ScopeAllowance {
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
interface ScopeUsage {
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
interface BlockEvent {
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
interface TruncateEvent {
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
interface WarningEvent {
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
interface UsageEvent {
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
interface FenceMetadata {
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
interface FenceStore {
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

// ── Message Type ────────────────────────────────────────────────────

/** An LLM conversation message. */
interface Message {
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

// ── Error Classes ───────────────────────────────────────────────────

/** Base error for all token-fence errors. */
class FenceError extends Error {
  readonly code: string;
}

/** Thrown when a budget is exceeded and the action is 'block'. */
class BudgetExceededError extends FenceError {
  readonly code = 'BUDGET_EXCEEDED';
  readonly scope: string;
  readonly scopeId?: string;
  readonly limit: number;
  readonly current: number;
  readonly requested: number;
  readonly remaining: number;
  readonly windowResetsAt?: Date;
}

/**
 * Thrown when protected messages (system + current user message)
 * exceed the budget and truncation cannot help.
 */
class ProtectedExceedsBudgetError extends FenceError {
  readonly code = 'PROTECTED_EXCEEDS_BUDGET';
  readonly protectedTokens: number;
  readonly budget: number;
}

/** Thrown when configuration is invalid. */
class FenceConfigError extends FenceError {
  readonly code = 'FENCE_CONFIG_ERROR';
  readonly validationErrors: string[];
}
```

### TokenFence Instance API

```typescript
/**
 * Create a reusable token fence instance.
 *
 * @param config - Fence configuration including budgets, action, and callbacks.
 * @returns A TokenFence instance.
 * @throws FenceConfigError if the configuration is invalid.
 */
function createFence(config: FenceConfig): TokenFence;

/**
 * Wrap an LLM client with fence middleware.
 *
 * @param client - The LLM SDK client to wrap.
 * @param config - Fence configuration.
 * @returns A fenced client with the same API surface.
 * @throws FenceConfigError if the configuration is invalid.
 */
function fence<T>(client: T, config: FenceConfig): T;

/** The token fence instance. */
interface TokenFence {
  /**
   * Apply the fence to an LLM client, returning a fenced client.
   *
   * @param client - The LLM SDK client to wrap.
   * @returns A fenced client with identical API surface.
   */
  apply<T>(client: T): T;

  /**
   * Pre-check whether a set of messages would pass all budget checks.
   * Does not send the request or record usage.
   *
   * @param messages - The messages to check.
   * @param context - Request context (userId, sessionId).
   * @returns An AllowanceResult indicating whether the request would be allowed.
   */
  check(messages: Message[], context?: FenceContext): AllowanceResult;

  /**
   * Get the remaining allowance for a specific scope.
   *
   * @param scope - The scope to query. Must include at least one of
   *   userId, sessionId, or 'global'.
   * @returns The scope's allowance details.
   */
  getAllowance(scope: { userId?: string; sessionId?: string; global?: boolean }): ScopeAllowance;

  /**
   * Get cumulative usage for a specific scope.
   *
   * @param scope - The scope to query.
   * @returns The scope's usage details.
   */
  getUsage(scope: { userId?: string; sessionId?: string; global?: boolean }): ScopeUsage;

  /**
   * Reset spending counters for a scope.
   * Use for administrative overrides (e.g., granting additional quota).
   *
   * @param scope - The scope to reset.
   */
  reset(scope: { userId?: string; sessionId?: string; global?: boolean }): void;

  /**
   * Get the fence configuration.
   */
  getConfig(): Readonly<FenceConfig>;

  /**
   * Update budget limits at runtime.
   * Does not reset existing counters.
   *
   * @param budgets - Partial budget config to merge.
   */
  updateBudgets(budgets: Partial<BudgetConfig>): void;
}
```

### Function Signatures

```typescript
/**
 * Wrap an LLM SDK client with token budget enforcement.
 *
 * The returned client has the same API surface as the original.
 * All chat completion calls are intercepted: tokens are counted,
 * budgets are checked, and usage is recorded.
 *
 * @param client - The LLM SDK client (OpenAI, Anthropic, or compatible).
 * @param config - Fence configuration.
 * @returns A fenced client.
 * @throws FenceConfigError if configuration validation fails:
 *   - No budgets configured.
 *   - Budget limit is not a positive number.
 *   - Window duration is not a positive number or valid string.
 *   - Action is not one of 'block', 'truncate', 'warn'.
 *   - minTokensAfterTruncation is negative.
 *   - windowBuckets is not a positive integer.
 */
function fence<T>(client: T, config: FenceConfig): T;

/**
 * Create a reusable token fence instance that can be applied
 * to multiple clients.
 *
 * @param config - Fence configuration.
 * @returns A TokenFence instance with check, getAllowance,
 *   getUsage, reset, and apply methods.
 * @throws FenceConfigError if configuration validation fails.
 */
function createFence(config: FenceConfig): TokenFence;
```

---

## 11. Configuration

### Full Configuration with All Defaults

```typescript
import { fence } from 'token-fence';

const fenced = fence(client, {
  // Budget definitions
  budgets: {
    perRequest: {
      maxInputTokens: 8000,            // Max input tokens per call
      action: 'truncate',             // Truncate oversized requests
    },
    perUser: {
      maxTotalTokens: 100000,          // 100K tokens per user per hour
      window: '1h',                    // Sliding 1-hour window
      action: 'block',                // Block when exceeded
    },
    perSession: {
      maxTotalTokens: 500000,          // 500K tokens per session lifetime
      // No window → lifetime cumulative
      action: 'block',
    },
    global: {
      maxTotalTokens: 10000000,        // 10M tokens per day globally
      window: '1d',
      action: 'block',
    },
  },

  // Default enforcement action (used when scope does not specify its own)
  action: 'block',                    // Default: 'block'

  // Token counting
  tokenCounter: (text) => Math.ceil(text.length / 4),  // Default: approximate
  messageOverhead: 4,                 // Default: 4

  // Truncation settings
  minTokensAfterTruncation: 100,      // Default: 100

  // Sliding window settings
  windowBuckets: 60,                  // Default: 60

  // Storage adapter
  store: undefined,                   // Default: in-memory Map

  // Event callbacks
  onBlock: (event) => {},
  onTruncate: (event) => {},
  onWarning: (event) => {},
  onUsage: (event) => {},
});
```

### Minimal Configuration

```typescript
// Just a per-request limit — simplest possible setup
const fenced = fence(client, {
  budgets: {
    perRequest: { maxInputTokens: 4000 },
  },
});
```

### SaaS Tier Configuration

```typescript
function createFenceForTier(tier: 'free' | 'pro' | 'enterprise') {
  const limits = {
    free:       { daily: 50_000,    hourly: 10_000,  perRequest: 4_000 },
    pro:        { daily: 1_000_000, hourly: 100_000, perRequest: 16_000 },
    enterprise: { daily: Infinity,  hourly: Infinity, perRequest: 32_000 },
  };

  const l = limits[tier];

  return createFence({
    budgets: {
      perRequest: { maxInputTokens: l.perRequest, action: 'truncate' },
      perUser: { maxTotalTokens: l.hourly, window: '1h' },
      global: { maxTotalTokens: l.daily, window: '1d' },
    },
    action: 'block',
  });
}
```

### Agent Framework Configuration

```typescript
const agentFence = createFence({
  budgets: {
    perRequest: { maxInputTokens: 16000, action: 'truncate' },
    perSession: { maxTotalTokens: 200000, action: 'block' },
  },
  onBlock: (event) => {
    console.error(`Agent session ${event.scopeId} exceeded token budget`);
    // Escalate to human or abort the task
  },
  onTruncate: (event) => {
    console.warn(`Truncated ${event.messagesRemoved} messages from agent context`);
  },
});
```

### Window Duration Formats

The `window` property accepts these formats:

| Format | Duration | Example |
|---|---|---|
| `'1m'` | 1 minute | Burst protection |
| `'5m'` | 5 minutes | Short-term rate limiting |
| `'15m'` | 15 minutes | Quarter-hour budgets |
| `'1h'` | 1 hour | Hourly budgets |
| `'6h'` | 6 hours | Shift-based budgets |
| `'1d'` | 1 day (24 hours) | Daily budgets |
| `'7d'` | 7 days | Weekly budgets |
| `60000` | 60,000 ms (1 minute) | Custom duration in ms |

The string format supports `<number><unit>` where unit is `m` (minutes), `h` (hours), or `d` (days). For other durations, pass milliseconds as a number.

### Configuration Validation

When `fence()` or `createFence()` is called, the configuration is validated:

- At least one budget scope must be configured.
- `maxInputTokens`, `maxOutputTokens`, and `maxTotalTokens` must be positive numbers when specified.
- `window` must be a positive number (milliseconds) or a valid duration string.
- `action` must be one of `'block'`, `'truncate'`, `'warn'`.
- `minTokensAfterTruncation` must be a non-negative number.
- `windowBuckets` must be a positive integer.
- `messageOverhead` must be a non-negative number.
- `truncate` action is only valid for `perRequest` scope. Cumulative scopes with `truncate` action emit a warning and fall back to `block`.

Validation errors are collected and thrown as a `FenceConfigError` with a `validationErrors` array.

---

## 12. Integration with Sibling Packages

### prompt-price

`token-fence` can be configured with cost-based budgets instead of (or in addition to) token-based budgets. Integration with `prompt-price` converts token counts to dollar costs:

```typescript
import { fence } from 'token-fence';
import { getPrice } from 'prompt-price';

const fenced = fence(client, {
  budgets: {
    perUser: { maxTotalTokens: 100000, window: '1d' },
  },
  onUsage: (event) => {
    const cost = getPrice({
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
    });
    console.log(`Request cost: $${cost.total.toFixed(4)}`);
  },
});
```

A future version may support `maxCost` directly in the budget config, using `prompt-price` internally to convert token usage to cost.

### model-price-registry

When the fence needs to look up model pricing for cost-based features, it can use `model-price-registry`:

```typescript
import { getModelPrice } from 'model-price-registry';

// In the onUsage callback or a custom cost tracker:
const pricing = getModelPrice('gpt-4o');
const inputCost = (event.inputTokens / 1_000_000) * pricing.inputPricePerMillion;
const outputCost = (event.outputTokens / 1_000_000) * pricing.outputPricePerMillion;
```

### ai-circuit-breaker

`token-fence` integrates with `ai-circuit-breaker` so that a tripped budget can be treated as a circuit break condition. When a budget is exhausted, the fence can signal the circuit breaker to open, preventing further calls until the budget recovers:

```typescript
import { fence } from 'token-fence';
import { createBreaker } from 'ai-circuit-breaker';

const breaker = createBreaker({ failureThreshold: 3, resetTimeout: 60000 });

const fenced = fence(client, {
  budgets: {
    perUser: { maxTotalTokens: 100000, window: '1h' },
  },
  onBlock: (event) => {
    // Signal the circuit breaker that this user's circuit should open
    breaker.trip(`user:${event.scopeId}`);
  },
});
```

Alternatively, the breaker can wrap the fenced client to catch `BudgetExceededError` as a failure signal:

```typescript
const protectedClient = breaker.wrap(fenced, {
  isFailure: (error) => error instanceof BudgetExceededError,
});
```

### context-budget

`context-budget` and `token-fence` are complementary. `context-budget` decides how to allocate tokens within a single request's context window. `token-fence` decides whether the request should be allowed at all based on spending limits. A typical integration:

```typescript
import { createBudget } from 'context-budget';
import { fence } from 'token-fence';

// Step 1: Allocate context window space (context-budget)
const budget = createBudget({ model: 'gpt-4o', preset: 'agent' });
const allocation = budget.allocate({
  system: 500,
  tools: 2800,
  conversation: 15000,
  currentMessage: 300,
});

// Step 2: Fit content within allocated budgets
const fitted = budget.fit(contents);

// Step 3: Enforce spending limits (token-fence)
const fenced = fence(client, {
  budgets: {
    perUser: { maxTotalTokens: 100000, window: '1h' },
  },
});

// The fitted messages pass through the fence for spending enforcement
const response = await fenced.chat.completions.create({
  model: 'gpt-4o',
  messages: fittedMessages,
  _fence: { userId: 'alice' },
});
```

---

## 13. Testing Strategy

### Unit Tests

Unit tests cover each component in isolation with deterministic inputs and expected outputs.

**Token counting tests**:
- Approximate counter produces expected results for English text, code, JSON, and empty strings.
- Message token counting adds per-message overhead correctly.
- Tool call tokens are counted including the serialized JSON.
- Custom token counter function is invoked correctly.

**Budget scope tests**:
- Per-request budget blocks/truncates when input tokens exceed limit.
- Per-user budget tracks cumulative usage across multiple requests.
- Per-session budget tracks cumulative usage within a session.
- Global budget tracks cumulative usage across all users and sessions.
- Multiple scopes checked simultaneously; most restrictive wins.
- Scopes without matching context (e.g., per-user budget without userId) are skipped gracefully.

**Sliding window tests**:
- Recording usage increments the correct bucket.
- Querying the window sums all buckets within the window.
- Expired buckets are evicted on access.
- Full window rollover (elapsed > window duration) resets all buckets.
- Multiple windows with different durations operate independently.
- Bucket precision matches expected granularity.

**Truncation tests**:
- System messages are never removed.
- Most recent user message is never removed.
- Oldest conversation messages are removed first.
- Tool call/result pairs are removed as a unit.
- Truncation stops as soon as the budget is met.
- When protected messages alone exceed the budget, ProtectedExceedsBudgetError is thrown.
- `minTokensAfterTruncation` threshold is respected.
- Empty messages array returns empty array.

**Enforcement action tests**:
- Block action throws BudgetExceededError with correct properties.
- Truncate action modifies messages and forwards the request.
- Warn action forwards the request and invokes callback.
- Per-scope action overrides default action.

**Configuration validation tests**:
- Empty budgets throws FenceConfigError.
- Negative budget limits throw FenceConfigError.
- Invalid window format throws FenceConfigError.
- Invalid action throws FenceConfigError.
- Valid configurations pass validation.

### Integration Tests

**Client wrapping tests**:
- Fenced OpenAI client has the same API surface as the original.
- Fenced Anthropic client has the same API surface as the original.
- Requests pass through to the underlying client when budgets allow.
- Actual usage from API response is recorded against cumulative scopes.
- `_fence` metadata is attached to responses after truncation or warning.

**Multi-request scenario tests**:
- User makes 10 requests; cumulative tracking is correct after each.
- Session budget is exhausted after N requests; the (N+1)th request is blocked.
- Sliding window budget frees capacity as time passes.
- Reset clears counters; subsequent requests are allowed.

**Store adapter tests**:
- Custom store adapter's get/set/increment/delete methods are called correctly.
- Async store adapter (Promise-returning) works correctly.
- Window bucket operations (getWindow, recordBucket, resetBuckets) work with custom store.

### Edge Case Tests

- Request with zero messages (no tokens to count).
- Request with only a system message and no user message.
- All budgets set to Infinity (no enforcement; passthrough).
- Budget limit of 1 token (extremely restrictive).
- Simultaneous requests from the same user (concurrent access to counters).
- Clock skew in sliding window (system time moves backward).

---

## 14. Performance

### Middleware Overhead

The fence adds minimal overhead to each API call:

- **Pre-send**: Token counting (O(n) in total message length with exact counter, O(1) with approximate counter) + budget checks (O(s) where s is the number of configured scopes, typically 2-5) + sliding window lookup (O(b) where b is bucket count, typically 60). Total: microseconds for approximate counter, low milliseconds for exact counter on large messages.
- **Post-response**: Usage recording (O(s) scope updates, each O(1) amortized for sliding window). Total: microseconds.
- **Truncation**: When truncation is needed, message classification and removal is O(m) where m is the number of messages. For conversations with hundreds of messages, this is sub-millisecond.

The dominant cost is token counting. With the approximate counter, the fence adds negligible overhead (< 0.1ms). With an exact counter on a 100K-token conversation, the fence adds 10-50ms, which is small compared to the LLM API call latency (typically 500ms-30s).

### Memory

- **Per scope**: Each cumulative scope (user, session) stores a single number (8 bytes). With 10,000 active users, cumulative tracking uses ~80 KB.
- **Per sliding window**: Each sliding window stores `bucketCount` numbers. With 60 buckets per window, each window uses ~480 bytes. With 10,000 users each having a per-hour window, sliding window tracking uses ~4.7 MB.
- **No message retention**: The fence does not store messages. Messages are counted, checked, and forwarded. Memory usage is proportional to the number of tracked scopes, not the size of messages.

### Concurrency

The in-memory store uses synchronous operations, which are safe in single-threaded Node.js. For multi-process deployments (cluster mode, multiple serverless instances), the in-memory store is per-process and budgets are not shared. Use a Redis-backed store adapter for shared budget enforcement across processes.

### Recommendations

- Use the approximate counter for development and prototyping.
- Use an exact counter in production when budget precision matters.
- For high-throughput applications (> 100 requests/second), benchmark the token counter overhead and consider caching token counts for repeated system prompts.
- For multi-process deployments, use a Redis store adapter to share budget state.

---

## 15. Dependencies

### Runtime Dependencies

None. `token-fence` uses only built-in JavaScript APIs: `Map` for in-memory storage, `Date.now()` for timestamps, `Math` for arithmetic, and `Array` for bucket management. No external packages are required.

### Peer Dependencies

None. Integration with LLM SDKs (OpenAI, Anthropic), token counting libraries (gpt-tokenizer, js-tiktoken), and sibling packages (prompt-price, model-price-registry, ai-circuit-breaker) is through documented interfaces, not package dependencies. The caller imports those packages separately.

### Development Dependencies

- `typescript` >= 5.0 for compilation.
- `vitest` for testing.
- `eslint` for linting.

---

## 16. File Structure

```
token-fence/
├── package.json
├── tsconfig.json
├── SPEC.md
├── README.md
├── src/
│   ├── index.ts                  # Public API exports (fence, createFence)
│   ├── fence.ts                  # TokenFence class implementation
│   ├── middleware.ts             # Client wrapping / proxy logic
│   ├── budgets.ts                # Budget scope definitions and checking logic
│   ├── truncation.ts             # Intelligent truncation algorithm
│   ├── counter.ts                # Built-in approximate token counter
│   ├── window.ts                 # Sliding window implementation
│   ├── store.ts                  # In-memory store and FenceStore interface
│   ├── types.ts                  # All TypeScript type definitions
│   ├── errors.ts                 # Error classes (BudgetExceededError, etc.)
│   └── __tests__/
│       ├── fence.test.ts         # TokenFence integration tests
│       ├── middleware.test.ts    # Client wrapping tests
│       ├── budgets.test.ts       # Budget scope checking unit tests
│       ├── truncation.test.ts   # Intelligent truncation unit tests
│       ├── counter.test.ts      # Token counter tests
│       ├── window.test.ts       # Sliding window unit tests
│       ├── store.test.ts        # Store adapter tests
│       └── scenarios.test.ts    # Multi-request scenario tests
└── dist/                         # Compiled output (gitignored)
```

---

## 17. Implementation Roadmap

### Phase 1: Core Budget Enforcement

- Implement `FenceConfig` validation and type definitions.
- Implement the in-memory store (Map-based cumulative counters).
- Implement per-request budget checking (count input tokens, compare to limit).
- Implement the `block` enforcement action (throw `BudgetExceededError`).
- Implement `createFence()` and `fence.check()`.
- Write unit tests for per-request budget checking and blocking.
- Verify: a fenced client blocks requests that exceed the per-request limit.

### Phase 2: Intelligent Truncation

- Implement message classification (protected, paired, standard).
- Implement the truncation algorithm (remove from oldest end, preserve pairs).
- Implement the `truncate` enforcement action.
- Implement `minTokensAfterTruncation` fallback to block.
- Write unit tests for all truncation scenarios.
- Verify: oversized requests are truncated correctly and sent.

### Phase 3: Client Middleware

- Implement the Proxy-based client wrapping for OpenAI SDK.
- Implement the Proxy-based client wrapping for Anthropic SDK.
- Implement post-response usage extraction (normalize OpenAI/Anthropic response formats).
- Implement response metadata tagging (`_fence` property).
- Implement the `fence()` convenience function.
- Write integration tests with mocked clients.
- Verify: fenced clients behave identically to original clients under normal conditions.

### Phase 4: Cumulative Budget Scopes

- Implement per-user cumulative budget tracking.
- Implement per-session cumulative budget tracking.
- Implement global cumulative budget tracking.
- Implement scope precedence (most restrictive wins).
- Implement the `warn` enforcement action.
- Implement `getAllowance()`, `getUsage()`, and `reset()`.
- Write unit tests for cumulative tracking across multiple requests.
- Verify: budget exhaustion is detected correctly after multiple requests.

### Phase 5: Sliding Windows

- Implement the bucketed sliding window algorithm.
- Implement lazy bucket eviction.
- Implement window duration parsing (string format to milliseconds).
- Connect sliding windows to per-user, per-session, and global scopes.
- Write unit tests with controlled time (mock `Date.now()`).
- Verify: window budget frees capacity as time passes.

### Phase 6: Events and Callbacks

- Implement `onBlock`, `onTruncate`, `onWarning`, `onUsage` callbacks.
- Implement `updateBudgets()` for runtime reconfiguration.
- Write tests for callback invocation with correct event payloads.

### Phase 7: Store Adapter

- Define the `FenceStore` interface.
- Implement the default in-memory store.
- Implement store integration for cumulative and window-based tracking.
- Write tests with a mock async store.
- Document the interface for Redis and database adapters.

### Phase 8: Integration Testing

- Write end-to-end tests simulating SaaS tier enforcement (free/pro/enterprise).
- Write end-to-end tests simulating agent session budget exhaustion.
- Write multi-user concurrent access tests.
- Performance benchmarking: measure overhead per request for various configurations.
- Integration tests with `prompt-price` for cost logging.
- Integration tests with `ai-circuit-breaker` for coordinated enforcement.

---

## 18. Example Use Cases

### SaaS Platform with Tiered Quotas

A SaaS product where free-tier users get 50,000 tokens per day and pro users get 1,000,000:

```typescript
import { createFence } from 'token-fence';
import OpenAI from 'openai';

const client = new OpenAI();

function createClientForUser(userId: string, tier: 'free' | 'pro') {
  const dailyLimit = tier === 'free' ? 50_000 : 1_000_000;

  const myFence = createFence({
    budgets: {
      perRequest: { maxInputTokens: 8000, action: 'truncate' },
      perUser: { maxTotalTokens: dailyLimit, window: '1d', action: 'block' },
    },
  });

  return myFence.apply(client);
}

// In the API handler:
async function handleChatRequest(userId: string, tier: string, messages: Message[]) {
  const fencedClient = createClientForUser(userId, tier as 'free' | 'pro');

  try {
    const response = await fencedClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      _fence: { userId },
    });
    return response;
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return {
        error: 'quota_exceeded',
        message: `You have ${error.remaining} tokens remaining today.`,
        resetsAt: error.windowResetsAt,
      };
    }
    throw error;
  }
}
```

### Agent Loop with Session Budget

An autonomous agent that must complete its task within a token budget:

```typescript
import { createFence } from 'token-fence';

const agentFence = createFence({
  budgets: {
    perRequest: { maxInputTokens: 16000, action: 'truncate' },
    perSession: { maxTotalTokens: 200000, action: 'block' },
  },
  onTruncate: (event) => {
    console.log(`Agent context truncated: removed ${event.messagesRemoved} messages`);
  },
});

async function runAgent(taskId: string, task: string) {
  const client = agentFence.apply(new OpenAI());
  const sessionId = `agent-${taskId}`;
  const messages: Message[] = [
    { role: 'system', content: 'You are an autonomous agent...' },
    { role: 'user', content: task },
  ];

  for (let step = 0; step < 50; step++) {
    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages,
        _fence: { sessionId },
      });

      const reply = response.choices[0].message;
      messages.push(reply);

      if (reply.content?.includes('TASK_COMPLETE')) break;
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        console.error(`Agent ${taskId} exhausted its token budget after ${step} steps.`);
        // Escalate to human
        return { status: 'budget_exceeded', steps: step };
      }
      throw error;
    }
  }
}
```

### Pre-flight Check for UI

Checking budget availability before enabling the "send" button in a chat UI:

```typescript
import { createFence } from 'token-fence';

const myFence = createFence({
  budgets: {
    perUser: { maxTotalTokens: 100000, window: '1d' },
  },
});

// Called when the user types, to show remaining quota in the UI
function getRemainingQuota(userId: string): { remaining: number; percentage: number } {
  const allowance = myFence.getAllowance({ userId });
  return {
    remaining: allowance.remaining,
    percentage: (allowance.remaining / allowance.limit) * 100,
  };
}

// Called before sending, to check if the specific message would be allowed
function canSend(userId: string, messages: Message[]): boolean {
  const result = myFence.check(messages, { userId });
  return result.allowed;
}
```

### Global Safety Net During Development

A developer adding a safety cap to prevent runaway spending:

```typescript
import { fence } from 'token-fence';
import OpenAI from 'openai';

const client = fence(new OpenAI(), {
  budgets: {
    perRequest: { maxInputTokens: 16000, action: 'truncate' },
    global: { maxTotalTokens: 500000, window: '1h', action: 'block' },
  },
  onBlock: (event) => {
    console.error(
      `SAFETY: Global token budget exceeded. ` +
      `${event.current}/${event.limit} tokens used in the past hour. ` +
      `Request for ${event.requested} tokens blocked.`
    );
  },
});

// Use client normally — the fence silently enforces limits
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

### Multi-Tenant API Gateway

An API gateway proxying LLM requests for multiple clients with contracted allocations:

```typescript
import { createFence } from 'token-fence';

const gatewayFence = createFence({
  budgets: {
    perUser: {
      maxTotalTokens: 1_000_000,  // Default; overridden per client
      window: '1d',
      action: 'block',
    },
    global: {
      maxTotalTokens: 50_000_000,
      window: '1d',
      action: 'block',
    },
  },
});

// Override per-client limits based on their contract
const clientLimits: Record<string, number> = {
  'client-acme': 5_000_000,
  'client-globex': 10_000_000,
  'client-initech': 1_000_000,
};

async function proxyRequest(clientId: string, messages: Message[]) {
  // Check allowance with client-specific context
  const allowance = gatewayFence.check(messages, { userId: clientId });
  if (!allowance.allowed) {
    return { status: 429, error: 'Token quota exceeded', resetsAt: allowance.windowResetsAt };
  }

  const fencedClient = gatewayFence.apply(new OpenAI());
  const response = await fencedClient.chat.completions.create({
    model: 'gpt-4o',
    messages,
    _fence: { userId: clientId },
  });

  // Report usage to billing
  const usage = gatewayFence.getUsage({ userId: clientId });
  console.log(`Client ${clientId}: ${usage.total} tokens used today`);

  return response;
}
```
