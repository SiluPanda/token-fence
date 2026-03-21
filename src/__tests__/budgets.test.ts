import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkPerRequest, checkScopedBudget, checkAllBudgets, recordUsage } from '../budgets';
import type { Message, BudgetConfig, FenceContext, ScopedBudget } from '../types';
import { InMemoryStore } from '../store';
import { approximateTokenCounter, countTotalInputTokens } from '../counter';

// ── Helpers ──────────────────────────────────────────────────────────

function msg(role: Message['role'], content: string): Message {
  return { role, content };
}

// ── checkPerRequest ──────────────────────────────────────────────────

describe('checkPerRequest', () => {
  it('allows when input tokens are under limit', () => {
    const messages: Message[] = [msg('user', 'hello')];
    const result = checkPerRequest(messages, { maxInputTokens: 1000 });
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe('request');
    expect(result.requested).toBeGreaterThan(0);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('blocks when input tokens exceed limit', () => {
    // "hello" => ceil(5/4) = 2 + 4 overhead = 6 tokens per message
    const messages: Message[] = [msg('user', 'hello')];
    const result = checkPerRequest(messages, { maxInputTokens: 1 });
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe('request');
    expect(result.remaining).toBe(0);
  });

  it('allows when input tokens exactly equal limit', () => {
    const messages: Message[] = [msg('user', 'hello')];
    const tokens = countTotalInputTokens(messages, approximateTokenCounter, 4);
    const result = checkPerRequest(messages, { maxInputTokens: tokens });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('uses custom token counter when provided', () => {
    const counter = (text: string) => text.length; // 1 token per char
    const messages: Message[] = [msg('user', 'hi')];
    const result = checkPerRequest(messages, { maxInputTokens: 100 }, counter, 4);
    expect(result.allowed).toBe(true);
    // "hi" = 2 chars + 4 overhead = 6
    expect(result.requested).toBe(6);
  });

  it('current is always 0 for per-request checks', () => {
    const messages: Message[] = [msg('user', 'test')];
    const result = checkPerRequest(messages, { maxInputTokens: 1000 });
    expect(result.current).toBe(0);
  });
});

// ── checkScopedBudget ────────────────────────────────────────────────

describe('checkScopedBudget', () => {
  it('allows when cumulative usage is under limit', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxInputTokens: 1000 };
    const result = checkScopedBudget('user', 'alice', budget, store, 100);
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe('user');
    expect(result.scopeId).toBe('alice');
    expect(result.current).toBe(0);
    expect(result.remaining).toBe(1000);
  });

  it('blocks when cumulative usage exceeds limit', () => {
    const store = new InMemoryStore();
    store.increment('user:alice', 900);
    const budget: ScopedBudget = { maxInputTokens: 1000 };
    const result = checkScopedBudget('user', 'alice', budget, store, 200);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(900);
    expect(result.remaining).toBe(100);
  });

  it('tracks cumulative usage across multiple calls', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxInputTokens: 500 };

    // First check — 200 tokens
    let result = checkScopedBudget('user', 'bob', budget, store, 200);
    expect(result.allowed).toBe(true);
    store.increment('user:bob', 200);

    // Second check — another 200 tokens (total 400)
    result = checkScopedBudget('user', 'bob', budget, store, 200);
    expect(result.allowed).toBe(true);
    store.increment('user:bob', 200);

    // Third check — another 200 tokens (total would be 600, exceeds 500)
    result = checkScopedBudget('user', 'bob', budget, store, 200);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(400);
  });

  it('uses maxTotalTokens when maxInputTokens not set', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxTotalTokens: 500 };
    const result = checkScopedBudget('session', 's1', budget, store, 100);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(500);
  });

  it('uses maxOutputTokens when others not set', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxOutputTokens: 300 };
    const result = checkScopedBudget('session', 's1', budget, store, 100);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(300);
  });

  it('defaults to Infinity when no limit is set', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = {};
    const result = checkScopedBudget('user', 'u1', budget, store, 99999);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(Infinity);
  });
});

// ── checkScopedBudget with windowed budget ───────────────────────────

describe('checkScopedBudget (windowed)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses sliding window when budget.window is set', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxInputTokens: 1000, window: '1m' };

    // No usage yet — should be allowed
    const result = checkScopedBudget('user', 'alice', budget, store, 500);
    expect(result.allowed).toBe(true);
  });

  it('blocks when windowed usage exceeds limit', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxInputTokens: 1000, window: '1m' };

    // Record 800 tokens via recordUsage
    recordUsage('user', 'alice', budget, store, { input: 800, output: 0, total: 800 });

    // Try to add 300 more (800 + 300 = 1100 > 1000)
    const result = checkScopedBudget('user', 'alice', budget, store, 300);
    expect(result.allowed).toBe(false);
  });

  it('window duration accepts number in ms', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxInputTokens: 500, window: 60000 };

    recordUsage('user', 'u1', budget, store, { input: 400, output: 0, total: 400 });

    // 400 + 200 = 600 > 500
    const result = checkScopedBudget('user', 'u1', budget, store, 200);
    expect(result.allowed).toBe(false);
  });

  it('windowed budget frees capacity after window expires', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxInputTokens: 500, window: '1m' };

    recordUsage('user', 'u1', budget, store, { input: 500, output: 0, total: 500 });

    // Blocked now
    let result = checkScopedBudget('user', 'u1', budget, store, 100);
    expect(result.allowed).toBe(false);

    // Advance past window
    vi.advanceTimersByTime(60_000);

    result = checkScopedBudget('user', 'u1', budget, store, 100);
    expect(result.allowed).toBe(true);
  });
});

// ── recordUsage ──────────────────────────────────────────────────────

describe('recordUsage', () => {
  it('increments store for cumulative (non-windowed) budget', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxInputTokens: 1000 };

    recordUsage('user', 'alice', budget, store, { input: 100, output: 50, total: 150 });
    expect(store.get('user:alice')).toBe(100); // maxInputTokens is set, so uses input

    recordUsage('user', 'alice', budget, store, { input: 200, output: 100, total: 300 });
    expect(store.get('user:alice')).toBe(300);
  });

  it('records output tokens when only maxOutputTokens is set', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxOutputTokens: 1000 };

    recordUsage('user', 'bob', budget, store, { input: 100, output: 50, total: 150 });
    expect(store.get('user:bob')).toBe(50);
  });

  it('records total tokens when only maxTotalTokens is set', () => {
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxTotalTokens: 1000 };

    recordUsage('user', 'carol', budget, store, { input: 100, output: 50, total: 150 });
    expect(store.get('user:carol')).toBe(150);
  });

  it('records into sliding window when budget.window is set', () => {
    vi.useFakeTimers();
    const store = new InMemoryStore();
    const budget: ScopedBudget = { maxInputTokens: 1000, window: '1m' };

    recordUsage('user', 'dave', budget, store, { input: 200, output: 0, total: 200 });

    // Verify via checkScopedBudget that the usage is tracked
    const result = checkScopedBudget('user', 'dave', budget, store, 0);
    expect(result.current).toBe(200);

    vi.useRealTimers();
  });
});

// ── checkAllBudgets ──────────────────────────────────────────────────

describe('checkAllBudgets', () => {
  it('returns allowed when no budgets are configured', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hello')];
    const result = checkAllBudgets(messages, {}, {}, store);
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe('none');
  });

  it('per-request blocks first before checking other scopes', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hello world, this is a long message')];
    const budgets: BudgetConfig = {
      perRequest: { maxInputTokens: 1 },
      perUser: { maxInputTokens: 100000 },
    };
    const context: FenceContext = { userId: 'alice' };
    const result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe('request');
  });

  it('per-user blocks when cumulative exceeds limit', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hello')];
    const inputTokens = countTotalInputTokens(messages, approximateTokenCounter, 4);

    // Pre-fill user usage to just under limit
    store.increment('user:alice', 1000 - inputTokens + 1);

    const budgets: BudgetConfig = {
      perUser: { maxInputTokens: 1000 },
    };
    const context: FenceContext = { userId: 'alice' };
    const result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe('user');
    expect(result.scopeId).toBe('alice');
  });

  it('per-session blocks when cumulative exceeds limit', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'test')];
    const inputTokens = countTotalInputTokens(messages, approximateTokenCounter, 4);

    store.increment('session:s1', 500);

    const budgets: BudgetConfig = {
      perSession: { maxInputTokens: 500 + inputTokens - 1 },
    };
    const context: FenceContext = { sessionId: 's1' };
    const result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe('session');
    expect(result.scopeId).toBe('s1');
  });

  it('global blocks when cumulative exceeds limit', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hi')];
    const inputTokens = countTotalInputTokens(messages, approximateTokenCounter, 4);

    store.increment('global:global', 2000);

    const budgets: BudgetConfig = {
      global: { maxInputTokens: 2000 + inputTokens - 1 },
    };
    const result = checkAllBudgets(messages, budgets, {}, store);
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe('global');
    expect(result.scopeId).toBe('global');
  });

  it('custom scope blocks when cumulative exceeds limit', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'test')];
    const inputTokens = countTotalInputTokens(messages, approximateTokenCounter, 4);

    store.increment('custom:team:engineering', 750);

    const budgets: BudgetConfig = {
      custom: {
        team: { maxInputTokens: 750 + inputTokens - 1 },
      },
    };
    const context: FenceContext = { scopes: { team: 'engineering' } };
    const result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe('custom:team');
    expect(result.scopeId).toBe('engineering');
  });

  it('most restrictive scope wins', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hello')];
    const inputTokens = countTotalInputTokens(messages, approximateTokenCounter, 4);

    // perRequest allows, perUser allows, but perSession blocks
    store.increment('session:s1', 50);

    const budgets: BudgetConfig = {
      perRequest: { maxInputTokens: 10000 },
      perUser: { maxInputTokens: 10000 },
      perSession: { maxInputTokens: 50 + inputTokens - 1 },
    };
    const context: FenceContext = { userId: 'alice', sessionId: 's1' };
    const result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe('session');
  });

  it('scopes without matching context are skipped', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hello')];

    // perUser is configured but no userId in context — should be skipped
    const budgets: BudgetConfig = {
      perUser: { maxInputTokens: 1 }, // would block if checked
      perSession: { maxInputTokens: 1 }, // would block if checked
    };
    const context: FenceContext = {}; // no userId, no sessionId
    const result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(true);
  });

  it('custom scopes without matching context.scopes entry are skipped', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hello')];

    const budgets: BudgetConfig = {
      custom: {
        team: { maxInputTokens: 1 }, // would block if checked
      },
    };
    // No scopes at all in context
    const context: FenceContext = {};
    const result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(true);
  });

  it('custom scope skipped when scope name not in context.scopes', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hello')];

    const budgets: BudgetConfig = {
      custom: {
        team: { maxInputTokens: 1 }, // would block
        project: { maxInputTokens: 100000 },
      },
    };
    // Only project is in context, team is not
    const context: FenceContext = { scopes: { project: 'proj1' } };
    const result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(true);
  });

  it('all scopes pass returns allowed with scope "none"', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hello')];

    const budgets: BudgetConfig = {
      perRequest: { maxInputTokens: 100000 },
      perUser: { maxInputTokens: 100000 },
      perSession: { maxInputTokens: 100000 },
      global: { maxInputTokens: 100000 },
    };
    const context: FenceContext = { userId: 'alice', sessionId: 's1' };
    const result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe('none');
    expect(result.remaining).toBe(Infinity);
  });

  it('uses custom token counter', () => {
    const store = new InMemoryStore();
    const messages: Message[] = [msg('user', 'hi')];
    // Custom counter: 1 token per character
    const counter = (text: string) => text.length;

    const budgets: BudgetConfig = {
      perRequest: { maxInputTokens: 5 }, // "hi" = 2 chars + 4 overhead = 6, should block
    };
    const result = checkAllBudgets(messages, budgets, {}, store, counter, 4);
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe('request');
    expect(result.requested).toBe(6);
  });
});

// ── Per-user tracking across multiple requests ──────────────────────

describe('per-user tracking across multiple requests', () => {
  it('tracks cumulative usage across multiple checkAllBudgets calls', () => {
    const store = new InMemoryStore();
    const budgets: BudgetConfig = {
      perUser: { maxInputTokens: 100 },
    };
    const context: FenceContext = { userId: 'alice' };

    const messages: Message[] = [msg('user', 'hello')];
    const inputTokens = countTotalInputTokens(messages, approximateTokenCounter, 4);

    // First request
    let result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(true);
    store.increment('user:alice', inputTokens);

    // Second request
    result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(true);
    store.increment('user:alice', inputTokens);

    // Keep going until blocked
    let requestCount = 2;
    while (requestCount < 100) {
      result = checkAllBudgets(messages, budgets, context, store);
      if (!result.allowed) break;
      store.increment('user:alice', inputTokens);
      requestCount++;
    }

    expect(result.allowed).toBe(false);
    expect(result.scope).toBe('user');
    expect(store.get('user:alice')).toBeLessThanOrEqual(100);
  });
});

// ── Per-session tracking ─────────────────────────────────────────────

describe('per-session tracking', () => {
  it('different sessions tracked independently', () => {
    const store = new InMemoryStore();
    const budgets: BudgetConfig = {
      perSession: { maxInputTokens: 200 },
    };

    const messages: Message[] = [msg('user', 'hello')];
    const inputTokens = countTotalInputTokens(messages, approximateTokenCounter, 4);

    // Session 1 uses some budget
    store.increment('session:s1', 150);
    // Session 2 is fresh

    const result1 = checkAllBudgets(messages, budgets, { sessionId: 's1' }, store);
    const result2 = checkAllBudgets(messages, budgets, { sessionId: 's2' }, store);

    // s1 might be blocked (150 + inputTokens > 200 if inputTokens > 50)
    // s2 should be allowed (0 + inputTokens <= 200)
    expect(result2.allowed).toBe(true);

    if (150 + inputTokens > 200) {
      expect(result1.allowed).toBe(false);
    }
  });
});

// ── Global tracking ─────────────────────────────────────────────────

describe('global tracking', () => {
  it('global budget is shared across all users', () => {
    const store = new InMemoryStore();
    const budgets: BudgetConfig = {
      global: { maxInputTokens: 300 },
    };

    const messages: Message[] = [msg('user', 'hello')];
    const inputTokens = countTotalInputTokens(messages, approximateTokenCounter, 4);

    // User A uses some global budget
    store.increment('global:global', 150);

    // User B uses more
    store.increment('global:global', 100);

    // Now global is at 250, check if another request fits
    const result = checkAllBudgets(messages, budgets, { userId: 'userC' }, store);
    if (250 + inputTokens > 300) {
      expect(result.allowed).toBe(false);
      expect(result.scope).toBe('global');
    } else {
      expect(result.allowed).toBe(true);
    }
  });
});

// ── Time-windowed budget with SlidingWindow ─────────────────────────

describe('time-windowed budget with SlidingWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('windowed global budget tracks via sliding window', () => {
    const store = new InMemoryStore();
    const budgets: BudgetConfig = {
      global: { maxInputTokens: 500, window: '1m' },
    };
    const messages: Message[] = [msg('user', 'test')];
    const inputTokens = countTotalInputTokens(messages, approximateTokenCounter, 4);

    // Record some usage via recordUsage
    recordUsage('global', 'global', budgets.global!, store, { input: 400, output: 0, total: 400 });

    // Check — 400 + inputTokens might exceed 500
    let result = checkAllBudgets(messages, budgets, {}, store);
    if (400 + inputTokens > 500) {
      expect(result.allowed).toBe(false);
    }

    // Advance past window — capacity should be freed
    vi.advanceTimersByTime(60_000);

    result = checkAllBudgets(messages, budgets, {}, store);
    expect(result.allowed).toBe(true);
  });

  it('windowed per-user budget recovers after window expires', () => {
    const store = new InMemoryStore();
    const budgets: BudgetConfig = {
      perUser: { maxInputTokens: 100, window: '1h' },
    };
    const context: FenceContext = { userId: 'alice' };
    const messages: Message[] = [msg('user', 'hi')];

    // Fill up the budget
    recordUsage('user', 'alice', budgets.perUser!, store, { input: 100, output: 0, total: 100 });

    // Should be blocked
    let result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(false);

    // Advance past the 1-hour window
    vi.advanceTimersByTime(3_600_000);

    // Should be allowed again
    result = checkAllBudgets(messages, budgets, context, store);
    expect(result.allowed).toBe(true);
  });
});
