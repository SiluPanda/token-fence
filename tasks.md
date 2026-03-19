# token-fence — Task Breakdown

This file tracks all implementation tasks derived from SPEC.md. Each task is granular, actionable, and maps to a specific requirement from the specification.

---

## Phase 1: Project Scaffolding & Type Definitions

- [ ] **Install dev dependencies** — Add `typescript` (>=5.0), `vitest`, and `eslint` as dev dependencies. Run `npm install` and verify lockfile is generated. | Status: not_done
- [ ] **Configure ESLint** — Add `.eslintrc` or `eslint.config.js` with TypeScript support. Ensure `npm run lint` works against `src/`. | Status: not_done
- [ ] **Verify build pipeline** — Confirm `npm run build` compiles `src/` to `dist/` with declarations and source maps per `tsconfig.json`. Confirm `npm run test` runs vitest. | Status: not_done
- [ ] **Create `src/types.ts`** — Define all TypeScript interfaces and types from the spec: `FenceConfig`, `BudgetConfig`, `RequestBudget`, `ScopedBudget`, `EnforcementAction`, `TokenCounter`, `FenceContext`, `AllowanceResult`, `ScopeAllowance`, `ScopeUsage`, `BlockEvent`, `TruncateEvent`, `WarningEvent`, `UsageEvent`, `FenceMetadata`, `FenceStore`, `Message`, and the `TokenFence` interface. | Status: not_done
- [ ] **Create `src/errors.ts`** — Implement error classes: `FenceError` (base, with `code` property), `BudgetExceededError` (code `BUDGET_EXCEEDED`, with `scope`, `scopeId`, `limit`, `current`, `requested`, `remaining`, `windowResetsAt`), `ProtectedExceedsBudgetError` (code `PROTECTED_EXCEEDS_BUDGET`, with `protectedTokens`, `budget`), and `FenceConfigError` (code `FENCE_CONFIG_ERROR`, with `validationErrors` array). | Status: not_done
- [ ] **Update `src/index.ts` exports** — Export all public API symbols: `fence`, `createFence`, all types, all error classes. Ensure the barrel file re-exports from the correct internal modules. | Status: not_done

---

## Phase 2: Token Counting

- [ ] **Implement `src/counter.ts` — approximate token counter** — Implement the default approximate counter: `Math.ceil(text.length / 4)`. Export it as the default `TokenCounter`. | Status: not_done
- [ ] **Implement message token counting** — Implement `countMessageTokens(msg, tokenCounter, messageOverhead)` that counts tokens for a single message: `tokenCounter(msg.content || '') + messageOverhead + (msg.name ? tokenCounter(msg.name) : 0) + (msg.tool_calls ? tokenCounter(JSON.stringify(msg.tool_calls)) : 0) + (msg.tool_call_id ? tokenCounter(msg.tool_call_id) : 0)`. | Status: not_done
- [ ] **Implement total input token counting** — Implement `countTotalInputTokens(messages, tokenCounter, messageOverhead)` that sums `countMessageTokens` for all messages in the array. | Status: not_done
- [ ] **Write `src/__tests__/counter.test.ts`** — Test approximate counter for English text, code, JSON, empty strings. Test message token counting with overhead. Test tool_calls serialization counting. Test custom token counter function is invoked. Test edge cases (null content, missing fields). | Status: not_done

---

## Phase 3: Configuration Validation

- [ ] **Implement configuration validation logic** — Create a `validateConfig(config: FenceConfig)` function (in `src/fence.ts` or a dedicated `src/validation.ts`). Validate: at least one budget scope configured; `maxInputTokens`/`maxOutputTokens`/`maxTotalTokens` are positive numbers when specified; `window` is positive number or valid duration string; `action` is one of `block`, `truncate`, `warn`; `minTokensAfterTruncation` is non-negative; `windowBuckets` is positive integer; `messageOverhead` is non-negative. Collect all errors and throw `FenceConfigError` with `validationErrors` array. | Status: not_done
- [ ] **Implement window duration parsing** — Implement `parseWindowDuration(window: string | number): number` that converts `'1m'`, `'5m'`, `'15m'`, `'1h'`, `'6h'`, `'1d'`, `'7d'` strings (and `<number><m|h|d>` pattern) to milliseconds. Pass through raw numbers as-is. Throw on invalid format. | Status: not_done
- [ ] **Validate `truncate` action scope restriction** — Emit a warning (console.warn or callback) if `truncate` action is set on a cumulative scope (perUser, perSession, global, custom). Fall back to `block` for those scopes per spec. | Status: not_done
- [ ] **Write `src/__tests__/` config validation tests** — Test empty budgets throws `FenceConfigError`. Test negative budget limits. Test invalid window formats. Test invalid action values. Test valid minimal config passes. Test `truncate` on cumulative scopes falls back to `block`. Test window duration parsing for all formats. | Status: not_done

---

## Phase 4: In-Memory Store

- [ ] **Implement `src/store.ts` — `FenceStore` interface and in-memory implementation** — Export the `FenceStore` interface. Implement `InMemoryStore` using `Map<string, number>` for cumulative counters and `Map<string, number[]>` for window buckets. Implement all methods: `get`, `set`, `increment`, `delete`, `getWindow`, `recordBucket`, `resetBuckets`. All methods are synchronous. | Status: not_done
- [ ] **Write `src/__tests__/store.test.ts`** — Test `get` returns 0 for unknown key. Test `set` and `get` roundtrip. Test `increment` adds delta and returns new value. Test `delete` removes key. Test `getWindow` returns zero-filled array for unknown key. Test `recordBucket` increments specific bucket. Test `resetBuckets` zeroes specified indices. | Status: not_done

---

## Phase 5: Sliding Window Implementation

- [ ] **Implement `src/window.ts` — `SlidingWindow` class** — Implement bucketed sliding window algorithm. Constructor takes `windowDuration` (ms) and `bucketCount` (default 60). Calculate `bucketDuration = windowDuration / bucketCount`. Track `lastAccessTime` and `lastBucketIndex`. | Status: not_done
- [ ] **Implement `record(tokens, timestamp)` method** — Calculate current bucket index from timestamp. Perform lazy eviction of stale buckets between last access and current time. Add tokens to the current bucket. Update `lastAccessTime` and `lastBucketIndex`. | Status: not_done
- [ ] **Implement `getTotal(timestamp)` method** — Perform lazy eviction. Sum all bucket values within the current window. Return the total. | Status: not_done
- [ ] **Implement lazy bucket eviction** — On each access, calculate elapsed buckets since last access. Reset stale buckets to zero. If elapsed exceeds entire window, reset all buckets. | Status: not_done
- [ ] **Implement store-backed sliding window** — Integrate with `FenceStore` interface so window data can be persisted externally. Use `store.getWindow`, `store.recordBucket`, `store.resetBuckets` instead of in-memory arrays when a store is provided. | Status: not_done
- [ ] **Write `src/__tests__/window.test.ts`** — Test recording increments correct bucket. Test `getTotal` sums all buckets. Test expired buckets are evicted on access. Test full window rollover resets all buckets. Test multiple windows with different durations. Test bucket precision (granularity). Test with mocked `Date.now()` for deterministic time control. Test store-backed window operations. | Status: not_done

---

## Phase 6: Budget Scope Checking

- [ ] **Implement `src/budgets.ts` — per-request budget check** — Implement function that counts input tokens for a messages array and compares against `perRequest.maxInputTokens`. Return pass/fail with details. | Status: not_done
- [ ] **Implement per-user budget check** — Check cumulative usage for a given `userId` against `perUser.maxInputTokens`, `perUser.maxOutputTokens`, and/or `perUser.maxTotalTokens`. Support both flat ceiling and time-windowed checking. Skip if no `userId` provided in context. | Status: not_done
- [ ] **Implement per-session budget check** — Check cumulative usage for a given `sessionId` against `perSession` limits. Support flat ceiling and time-windowed. Skip if no `sessionId` in context. | Status: not_done
- [ ] **Implement global budget check** — Check global cumulative usage against `global` limits. Support time-windowed. | Status: not_done
- [ ] **Implement custom scope budget checks** — Support `budgets.custom` with arbitrary scope names. Resolve scope IDs from `context.scopes`. | Status: not_done
- [ ] **Implement scope precedence logic** — Check all applicable scopes in order: per-request, per-user, per-session, per-time-window, global. Stop at the first blocking scope. Return the most restrictive result. | Status: not_done
- [ ] **Implement cumulative usage recording** — After a response, record actual API-reported usage (input, output, total) against per-user, per-session, global, and custom scopes. Use actual API-reported values, not estimates. | Status: not_done
- [ ] **Implement usage normalization for OpenAI and Anthropic** — Normalize OpenAI (`usage.prompt_tokens`, `usage.completion_tokens`) and Anthropic (`usage.input_tokens`, `usage.output_tokens`) response formats into `{ input, output, total }`. | Status: not_done
- [ ] **Write `src/__tests__/budgets.test.ts`** — Test per-request blocks when input exceeds limit. Test per-user tracks cumulative across requests. Test per-session tracks within session. Test global tracks across all scopes. Test multiple scopes; most restrictive wins. Test scopes without matching context are skipped gracefully. Test usage recording with actual API values. Test custom scopes. | Status: not_done

---

## Phase 7: Enforcement Actions

- [ ] **Implement `block` enforcement action** — Throw `BudgetExceededError` with all required properties: `scope`, `scopeId`, `limit`, `current`, `requested`, `remaining`, `windowResetsAt` (for time-windowed scopes). Do not send the request. | Status: not_done
- [ ] **Implement `truncate` enforcement action** — When per-request budget is exceeded, invoke the truncation algorithm on the messages array. Send the truncated request. Attach `_fence` metadata to the response (`truncated`, `originalTokens`, `truncatedTokens`, `messagesRemoved`, `scope`). | Status: not_done
- [ ] **Implement `minTokensAfterTruncation` fallback** — If truncation would reduce input below the `minTokensAfterTruncation` threshold, fall back to `block` instead. Default threshold: 100. | Status: not_done
- [ ] **Implement `warn` enforcement action** — Send the request as-is. Invoke `onBudgetWarning` / `onWarning` callback with event details. Attach `_fence` warning metadata to the response (`warning`, `scope`, `limit`, `current`, `afterRequest`). | Status: not_done
- [ ] **Implement per-scope action override** — Each budget scope can specify its own `action` that overrides `FenceConfig.action`. Resolve the effective action for each scope. | Status: not_done
- [ ] **Write enforcement action tests** — Test `block` throws `BudgetExceededError` with correct properties. Test `truncate` modifies messages and forwards request. Test `warn` forwards request and invokes callback. Test per-scope action override. Test `minTokensAfterTruncation` fallback. | Status: not_done

---

## Phase 8: Intelligent Truncation Algorithm

- [ ] **Implement `src/truncation.ts` — message classification** — Classify messages into: Protected (system messages, most recent user message), Paired (assistant with `tool_calls` + corresponding tool result messages), Standard (all other messages). | Status: not_done
- [ ] **Implement protected token count calculation** — Sum tokens for all protected messages. If protected tokens exceed budget, throw `ProtectedExceedsBudgetError`. | Status: not_done
- [ ] **Implement oldest-first message removal** — Remove standard and paired messages from oldest end first. For paired messages, remove the entire group (assistant `tool_calls` + all tool results). Recalculate total after each removal. Stop when remaining fits within budget. | Status: not_done
- [ ] **Implement tool call/result pair detection** — Identify groups: an assistant message with `tool_calls` and all subsequent tool messages whose `tool_call_id` matches one of the tool call IDs. Ensure the group is removed or kept as a unit. | Status: not_done
- [ ] **Handle edge case: all removable messages removed but still over budget** — If removing every non-protected message does not fit within budget, fall back to `block` (system prompt + current message exceed budget). | Status: not_done
- [ ] **Handle edge case: single-message conversation** — If only system + user message, nothing to truncate. Fall back to `block` if they exceed budget. | Status: not_done
- [ ] **Handle edge case: no system message** — Current user message is still protected. All preceding messages are candidates for removal. | Status: not_done
- [ ] **Handle edge case: multiple system messages** — All system messages are protected (OpenAI allows multiple). | Status: not_done
- [ ] **Handle edge case: empty messages array** — Return empty array without error. | Status: not_done
- [ ] **Support configurable priority ordering** — Allow caller to assign priority levels to messages by role or custom tags. Lower-priority messages are removed before higher-priority ones. | Status: not_done
- [ ] **Write `src/__tests__/truncation.test.ts`** — Test system messages never removed. Test most recent user message never removed. Test oldest messages removed first. Test tool call/result pairs removed as a unit. Test truncation stops when budget is met. Test `ProtectedExceedsBudgetError` when protected exceeds budget. Test `minTokensAfterTruncation` threshold. Test empty messages array. Test no system message. Test multiple system messages. Test single-message conversation. Test priority ordering. | Status: not_done

---

## Phase 9: TokenFence Class (Core Orchestrator)

- [ ] **Implement `src/fence.ts` — `TokenFence` class** — Create the main `TokenFence` class that holds config, store, sliding windows, and orchestrates budget checking, truncation, enforcement, and usage recording. | Status: not_done
- [ ] **Implement `createFence(config)` factory function** — Validate config, create and return a `TokenFence` instance. Throw `FenceConfigError` on invalid config. | Status: not_done
- [ ] **Implement `TokenFence.check(messages, context)` method** — Pre-check whether messages would pass all budget checks without sending the request. Return `AllowanceResult` with `allowed`, `estimatedTokens`, `remaining` per scope, `blockingScope`, and `windowResetsAt`. | Status: not_done
- [ ] **Implement `TokenFence.getAllowance(scope)` method** — Return `ScopeAllowance` for a specific scope: `remaining`, `limit`, `used`, `windowResetsAt`, `windowDuration`. | Status: not_done
- [ ] **Implement `TokenFence.getUsage(scope)` method** — Return `ScopeUsage` for a scope: `input`, `output`, `total`, `requestCount`, `firstUsageAt`, `lastUsageAt`. | Status: not_done
- [ ] **Implement `TokenFence.reset(scope)` method** — Reset spending counters for a scope (user, session, or global). Clear cumulative counters and sliding window buckets. | Status: not_done
- [ ] **Implement `TokenFence.getConfig()` method** — Return a readonly copy of the current fence configuration. | Status: not_done
- [ ] **Implement `TokenFence.updateBudgets(budgets)` method** — Merge partial budget config into existing config at runtime. Do not reset existing counters. | Status: not_done
- [ ] **Implement `TokenFence.apply(client)` method** — Wrap an LLM client using the middleware/proxy logic and return a fenced client. | Status: not_done
- [ ] **Write `src/__tests__/fence.test.ts`** — Test `createFence` with valid config. Test `createFence` throws on invalid config. Test `check` returns correct allowance. Test `getAllowance` returns correct scope details. Test `getUsage` returns correct cumulative usage. Test `reset` clears counters. Test `getConfig` returns config. Test `updateBudgets` merges without resetting counters. Test full lifecycle: check, send, record, check again. | Status: not_done

---

## Phase 10: Client Middleware (Proxy Wrapping)

- [ ] **Implement `src/middleware.ts` — Proxy-based client wrapping for OpenAI SDK** — Use JavaScript `Proxy` to intercept `client.chat.completions.create()` calls. Before forwarding: extract `_fence` context from params, count tokens, check budgets, apply truncation if needed. After response: extract usage from response, record against scopes, attach `_fence` metadata. | Status: not_done
- [ ] **Implement Proxy-based client wrapping for Anthropic SDK** — Intercept `client.messages.create()` calls. Handle Anthropic's `system` parameter (separate from messages array). Normalize Anthropic's response usage format (`usage.input_tokens`, `usage.output_tokens`). | Status: not_done
- [ ] **Implement generic/compatible client wrapping** — Support any client with a `chat.completions.create` or `messages.create` method pattern. Auto-detect SDK type. | Status: not_done
- [ ] **Implement `_fence` context extraction from request params** — Extract `userId`, `sessionId`, and custom `scopes` from the `_fence` property on the request params. Strip `_fence` before forwarding to the underlying client. | Status: not_done
- [ ] **Implement `_fence` metadata attachment on responses** — Attach truncation metadata (`truncated`, `originalTokens`, `truncatedTokens`, `messagesRemoved`) or warning metadata (`warning`, `scope`, `limit`, `current`, `afterRequest`) to `response._fence`. | Status: not_done
- [ ] **Implement the `fence(client, config)` convenience function** — Create a `TokenFence` via `createFence`, then call `apply(client)` and return the fenced client. | Status: not_done
- [ ] **Write `src/__tests__/middleware.test.ts`** — Test fenced OpenAI client has same API surface as original (using mock). Test fenced Anthropic client has same API surface (using mock). Test requests pass through when budgets allow. Test actual usage from API response is recorded. Test `_fence` metadata is attached after truncation. Test `_fence` metadata is attached for warnings. Test `_fence` context is stripped before forwarding. Test non-chat methods pass through unintercepted. | Status: not_done

---

## Phase 11: Events and Callbacks

- [ ] **Implement `onBlock` callback invocation** — When a request is blocked, invoke `onBlock` with a `BlockEvent` containing `scope`, `scopeId`, `limit`, `current`, `requested`, `remaining`, `windowResetsAt`, `messages`, `timestamp`. | Status: not_done
- [ ] **Implement `onTruncate` callback invocation** — When a request is truncated, invoke `onTruncate` with a `TruncateEvent` containing `scope`, `originalTokens`, `truncatedTokens`, `messagesRemoved`, `timestamp`. | Status: not_done
- [ ] **Implement `onWarning` callback invocation** — When a request proceeds with a warning, invoke `onWarning` with a `WarningEvent` containing `scope`, `scopeId`, `limit`, `current`, `requested`, `projected`, `timestamp`. | Status: not_done
- [ ] **Implement `onUsage` callback invocation** — After each request completes, invoke `onUsage` with a `UsageEvent` containing `userId`, `sessionId`, `inputTokens`, `outputTokens`, `totalTokens`, `model`, `timestamp`. | Status: not_done
- [ ] **Write callback tests** — Test each callback is invoked with correct event payload. Test callbacks are not invoked when not configured (no errors). Test callbacks that throw do not break the fence. | Status: not_done

---

## Phase 12: Store Adapter Integration

- [ ] **Implement store integration for cumulative tracking** — When a `FenceStore` is provided in config, use `store.get`, `store.set`, `store.increment`, `store.delete` for cumulative counters instead of in-memory maps. | Status: not_done
- [ ] **Implement store integration for sliding windows** — Use `store.getWindow`, `store.recordBucket`, `store.resetBuckets` for window bucket storage when a store is provided. | Status: not_done
- [ ] **Support async store adapters** — Handle stores that return `Promise` from their methods. Ensure all budget checks and usage recording properly await async store operations. | Status: not_done
- [ ] **Write `src/__tests__/store.test.ts` (integration)** — Test custom store adapter methods are called correctly during budget checks and usage recording. Test async (Promise-returning) store adapter works correctly. Test window bucket operations with custom store. Test `reset` calls `store.delete` for the correct keys. | Status: not_done

---

## Phase 13: Edge Cases & Robustness

- [ ] **Handle request with zero messages** — No tokens to count. Budget checks should pass (0 tokens requested). | Status: not_done
- [ ] **Handle request with only system message, no user message** — Token count should work. Truncation has nothing to truncate. | Status: not_done
- [ ] **Handle all budgets set to `Infinity`** — Passthrough behavior, no enforcement. Requests always allowed. | Status: not_done
- [ ] **Handle extremely restrictive budgets (limit of 1 token)** — Budget check should block practically all requests. Error reporting should be correct. | Status: not_done
- [ ] **Handle concurrent requests from the same user** — In-memory store uses synchronous operations, safe in single-threaded Node.js. Document that multi-process requires a shared store. | Status: not_done
- [ ] **Handle clock skew in sliding window** — If system time moves backward, sliding window should not corrupt state. Ensure stale bucket eviction handles negative elapsed time gracefully. | Status: not_done
- [ ] **Handle missing usage data in API response** — If the API response does not include usage information, skip cumulative recording gracefully (do not throw). Log a warning if `onWarning` is configured. | Status: not_done
- [ ] **Handle messages with `null` content** — The `Message` type allows `content: string | null`. Token counting should treat null as empty string. | Status: not_done
- [ ] **Write `src/__tests__/scenarios.test.ts`** — Multi-request scenarios: user makes 10 requests with cumulative tracking verified after each. Session budget exhaustion after N requests, (N+1)th blocked. Sliding window frees capacity as time passes. Reset clears counters, subsequent requests allowed. SaaS tier enforcement (free/pro/enterprise) end-to-end. Agent session budget exhaustion end-to-end. | Status: not_done

---

## Phase 14: Integration Tests

- [ ] **Write SaaS tier enforcement end-to-end test** — Simulate free-tier user with 50,000 tokens/day. Make requests until budget is exhausted. Verify `BudgetExceededError` on the request that exceeds. Verify `remaining` is accurate. | Status: not_done
- [ ] **Write agent session budget exhaustion test** — Create a session with 200,000-token budget. Simulate agent loop with multiple calls. Verify session is blocked when budget is exhausted. | Status: not_done
- [ ] **Write multi-user concurrent access test** — Multiple users making requests simultaneously. Verify each user's budget is tracked independently. Verify global budget is shared correctly. | Status: not_done
- [ ] **Write sliding window recovery test** — Exhaust a time-windowed budget. Advance time past the window. Verify budget capacity is restored. | Status: not_done
- [ ] **Write truncation + cumulative tracking integration test** — Request is truncated (per-request). Actual usage from response is recorded against cumulative scopes. Verify cumulative counts reflect actual (not estimated) usage. | Status: not_done
- [ ] **Write `fence()` convenience function integration test** — Wrap a mock client with `fence()`. Make requests. Verify budget enforcement, usage recording, and response metadata. | Status: not_done
- [ ] **Write `check()` + `getAllowance()` + `getUsage()` integration test** — Pre-check messages, make request, verify usage, check allowance afterward. | Status: not_done
- [ ] **Write `reset()` integration test** — Exhaust a budget. Reset. Verify subsequent requests are allowed. | Status: not_done
- [ ] **Write `updateBudgets()` integration test** — Update budget limits at runtime. Verify new limits are enforced without resetting counters. | Status: not_done

---

## Phase 15: Performance Verification

- [ ] **Benchmark pre-send overhead with approximate counter** — Measure time for token counting + budget checks on messages of various sizes. Verify < 0.1ms for typical use. | Status: not_done
- [ ] **Benchmark pre-send overhead with exact counter (mocked)** — Measure overhead with a simulated exact counter. Verify low ms range for large messages. | Status: not_done
- [ ] **Benchmark post-response recording overhead** — Measure time for usage recording with multiple scopes and sliding windows. Verify microsecond range. | Status: not_done
- [ ] **Benchmark truncation algorithm** — Measure truncation time for conversations with 10, 50, 100, 500 messages. Verify sub-millisecond for typical sizes. | Status: not_done
- [ ] **Benchmark memory usage** — Verify memory consumption for 10,000 users with cumulative tracking (~80 KB). Verify memory for 10,000 users with sliding windows (~4.7 MB). | Status: not_done

---

## Phase 16: Documentation

- [ ] **Write README.md** — Include: package description, installation, quick start with minimal config, full API reference (`fence`, `createFence`, `TokenFence` methods), configuration reference with all options and defaults, enforcement actions explanation, truncation behavior, sliding window explanation, store adapter interface, integration examples with sibling packages (`prompt-price`, `ai-circuit-breaker`, `context-budget`), error handling guide. | Status: not_done
- [ ] **Add JSDoc comments to all public exports** — Ensure every exported function, class, interface, and type has complete JSDoc documentation matching the spec descriptions. | Status: not_done
- [ ] **Add inline code comments for non-obvious logic** — Especially in the truncation algorithm, sliding window eviction, and proxy wrapping logic. | Status: not_done
- [ ] **Document the `FenceStore` interface for custom adapters** — Provide clear guidance for implementing Redis, database, or file-backed stores. Include example skeleton. | Status: not_done

---

## Phase 17: CI/CD & Publishing Prep

- [ ] **Add `.gitignore` entries** — Ensure `dist/`, `node_modules/`, and `coverage/` are gitignored. | Status: not_done
- [ ] **Verify `package.json` metadata** — Ensure `name`, `version`, `description`, `main`, `types`, `files`, `engines`, `license`, `keywords`, and `publishConfig` are correct. Add relevant keywords (e.g., `token`, `budget`, `llm`, `middleware`, `fence`, `enforcement`). | Status: not_done
- [ ] **Verify `prepublishOnly` script** — Confirm `npm run build` runs before publish. | Status: not_done
- [ ] **Run full test suite and confirm all pass** — `npm run test` passes with 100% of tests green. | Status: not_done
- [ ] **Run lint and confirm clean** — `npm run lint` passes with no errors or warnings. | Status: not_done
- [ ] **Run build and confirm clean** — `npm run build` succeeds, `dist/` contains `.js`, `.d.ts`, `.d.ts.map`, and `.js.map` files. | Status: not_done
- [ ] **Version bump** — Bump `package.json` version per semver before publishing (currently `0.1.0`). | Status: not_done
