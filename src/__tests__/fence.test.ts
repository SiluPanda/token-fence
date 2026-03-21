import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFence } from '../fence';
import { BudgetExceededError, FenceConfigError } from '../errors';
import { InMemoryStore } from '../store';
import type { Message, FenceContext } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────

function msg(role: Message['role'], content: string): Message {
  return { role, content };
}

// ── createFence — config validation ─────────────────────────────────

describe('createFence — config validation', () => {
  it('throws FenceConfigError when no budget scope is configured', () => {
    expect(() =>
      createFence({ budgets: {} }),
    ).toThrow(FenceConfigError);
  });

  it('throws FenceConfigError for invalid action', () => {
    expect(() =>
      createFence({
        budgets: { perRequest: { maxInputTokens: 1000 } },
        action: 'invalid' as never,
      }),
    ).toThrow(FenceConfigError);
  });

  it('creates successfully with a valid config', () => {
    const fence = createFence({
      budgets: { perRequest: { maxInputTokens: 1000 } },
    });
    expect(fence).toBeDefined();
    expect(typeof fence.check).toBe('function');
    expect(typeof fence.record).toBe('function');
  });
});

// ── check — happy path ───────────────────────────────────────────────

describe('createFence — check() happy path', () => {
  it('does not throw when request is under per-request limit', () => {
    const fence = createFence({
      budgets: { perRequest: { maxInputTokens: 10_000 } },
    });
    const messages: Message[] = [msg('user', 'hello')];
    expect(() => fence.check(messages)).not.toThrow();
  });

  it('does not throw when cumulative usage is under per-user limit', () => {
    const fence = createFence({
      budgets: { perUser: { maxInputTokens: 10_000 } },
    });
    const messages: Message[] = [msg('user', 'hello')];
    expect(() => fence.check(messages, { userId: 'alice' })).not.toThrow();
  });

  it('does not throw when context has no userId and perUser budget is configured', () => {
    const fence = createFence({
      budgets: { perUser: { maxInputTokens: 1 } }, // would block if checked
    });
    const messages: Message[] = [msg('user', 'hello')];
    // No userId in context — perUser scope is skipped
    expect(() => fence.check(messages, {})).not.toThrow();
  });

  it('does not throw when all configured scopes pass', () => {
    const fence = createFence({
      budgets: {
        perRequest: { maxInputTokens: 100_000 },
        perUser: { maxInputTokens: 100_000 },
        perSession: { maxInputTokens: 100_000 },
        global: { maxInputTokens: 100_000 },
      },
    });
    const messages: Message[] = [msg('user', 'hello')];
    const context: FenceContext = { userId: 'alice', sessionId: 's1' };
    expect(() => fence.check(messages, context)).not.toThrow();
  });
});

// ── check — budget exceeded ──────────────────────────────────────────

describe('createFence — check() budget exceeded', () => {
  it('throws BudgetExceededError when per-request limit is exceeded', () => {
    const fence = createFence({
      budgets: { perRequest: { maxInputTokens: 1 } },
    });
    const messages: Message[] = [msg('user', 'hello')];
    expect(() => fence.check(messages)).toThrow(BudgetExceededError);
  });

  it('BudgetExceededError has correct scope on per-request block', () => {
    const fence = createFence({
      budgets: { perRequest: { maxInputTokens: 1 } },
    });
    const messages: Message[] = [msg('user', 'hello')];
    let caught: BudgetExceededError | undefined;
    try {
      fence.check(messages);
    } catch (err) {
      caught = err as BudgetExceededError;
    }
    expect(caught).toBeInstanceOf(BudgetExceededError);
    expect(caught!.scope).toBe('request');
    expect(caught!.limit).toBe(1);
    expect(caught!.requested).toBeGreaterThan(1);
    expect(caught!.remaining).toBe(0);
  });

  it('throws BudgetExceededError when per-user cumulative limit is exceeded', () => {
    const store = new InMemoryStore();
    // Pre-fill the user budget to near-exhaustion
    store.increment('user:alice', 9999);

    const fence = createFence({
      budgets: { perUser: { maxInputTokens: 10_000 } },
      store,
    });
    const messages: Message[] = [msg('user', 'hello')];

    let caught: BudgetExceededError | undefined;
    try {
      fence.check(messages, { userId: 'alice' });
    } catch (err) {
      caught = err as BudgetExceededError;
    }
    expect(caught).toBeInstanceOf(BudgetExceededError);
    expect(caught!.scope).toBe('user');
    expect(caught!.userId).toBe('alice');
  });

  it('throws BudgetExceededError when global limit is exceeded', () => {
    const store = new InMemoryStore();
    store.increment('global:global', 9999);

    const fence = createFence({
      budgets: { global: { maxInputTokens: 10_000 } },
      store,
    });
    const messages: Message[] = [msg('user', 'hello')];

    expect(() => fence.check(messages)).toThrow(BudgetExceededError);
  });

  it('error message includes scope, limit, current, and requested', () => {
    const store = new InMemoryStore();
    // Pre-fill to 998 so any realistic message (>=3 tokens) pushes over 1000
    store.increment('user:bob', 998);

    const fence = createFence({
      budgets: { perUser: { maxInputTokens: 1000 } },
      store,
    });
    const messages: Message[] = [msg('user', 'hello')];

    let caught: BudgetExceededError | undefined;
    try {
      fence.check(messages, { userId: 'bob' });
    } catch (err) {
      caught = err as BudgetExceededError;
    }
    expect(caught).toBeInstanceOf(BudgetExceededError);
    expect(caught!.message).toContain('user');
    expect(caught!.code).toBe('BUDGET_EXCEEDED');
  });
});

// ── check — onBlock callback ─────────────────────────────────────────

describe('createFence — check() onBlock callback', () => {
  it('invokes onBlock when a budget is exceeded', () => {
    const onBlock = vi.fn();
    const fence = createFence({
      budgets: { perRequest: { maxInputTokens: 1 } },
      onBlock,
    });
    const messages: Message[] = [msg('user', 'hello')];
    expect(() => fence.check(messages)).toThrow(BudgetExceededError);
    expect(onBlock).toHaveBeenCalledOnce();
    const event = onBlock.mock.calls[0][0];
    expect(event.scope).toBe('request');
    expect(event.messages).toBe(messages);
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it('does not invoke onBlock when request is within budget', () => {
    const onBlock = vi.fn();
    const fence = createFence({
      budgets: { perRequest: { maxInputTokens: 10_000 } },
      onBlock,
    });
    fence.check([msg('user', 'hello')]);
    expect(onBlock).not.toHaveBeenCalled();
  });
});

// ── record — usage accumulation ──────────────────────────────────────

describe('createFence — record() usage accumulation', () => {
  it('accumulates per-user usage so subsequent checks are blocked', () => {
    const store = new InMemoryStore();
    const fence = createFence({
      budgets: { perUser: { maxInputTokens: 100 } },
      store,
    });
    const messages: Message[] = [msg('user', 'hello')];
    const context: FenceContext = { userId: 'alice' };

    // First request should pass
    expect(() => fence.check(messages, context)).not.toThrow();

    // Record enough usage to exhaust the budget
    fence.record(messages, { input: 100, output: 0, total: 100 }, context);

    // Subsequent check should now be blocked
    expect(() => fence.check(messages, context)).toThrow(BudgetExceededError);
  });

  it('accumulates per-session usage independently per session', () => {
    const store = new InMemoryStore();
    const fence = createFence({
      budgets: { perSession: { maxInputTokens: 100 } },
      store,
    });
    const messages: Message[] = [msg('user', 'hello')];

    // Exhaust session s1
    fence.record(messages, { input: 100, output: 0, total: 100 }, { sessionId: 's1' });

    // s1 is blocked
    expect(() => fence.check(messages, { sessionId: 's1' })).toThrow(BudgetExceededError);

    // s2 is unaffected
    expect(() => fence.check(messages, { sessionId: 's2' })).not.toThrow();
  });

  it('accumulates global usage across all requests', () => {
    const store = new InMemoryStore();
    const fence = createFence({
      budgets: { global: { maxInputTokens: 100 } },
      store,
    });
    const messages: Message[] = [msg('user', 'hello')];

    // Record from user A
    fence.record(messages, { input: 60, output: 0, total: 60 }, { userId: 'alice' });
    // Check from user B — global is now at 60, but 60 + request tokens > 100
    fence.record(messages, { input: 50, output: 0, total: 50 }, { userId: 'bob' });

    // Global should now be at 110 — next check should be blocked
    expect(() => fence.check(messages)).toThrow(BudgetExceededError);
  });

  it('record with no context does not throw', () => {
    const fence = createFence({
      budgets: { global: { maxInputTokens: 10_000 } },
    });
    const messages: Message[] = [msg('user', 'hello')];
    expect(() =>
      fence.record(messages, { input: 10, output: 5, total: 15 }),
    ).not.toThrow();
  });

  it('invokes onUsage callback after record', () => {
    const onUsage = vi.fn();
    const fence = createFence({
      budgets: { global: { maxInputTokens: 10_000 } },
      onUsage,
    });
    const messages: Message[] = [msg('user', 'hello')];
    fence.record(messages, { input: 10, output: 5, total: 15 }, { userId: 'alice' });
    expect(onUsage).toHaveBeenCalledOnce();
    const event = onUsage.mock.calls[0][0];
    expect(event.inputTokens).toBe(10);
    expect(event.outputTokens).toBe(5);
    expect(event.totalTokens).toBe(15);
    expect(event.userId).toBe('alice');
    expect(event.timestamp).toBeInstanceOf(Date);
  });
});

// ── check + record — windowed budgets ────────────────────────────────

describe('createFence — windowed budget check + record', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks when windowed usage exceeds limit, recovers after window expires', () => {
    const store = new InMemoryStore();
    const fence = createFence({
      budgets: { perUser: { maxInputTokens: 100, window: '1m' } },
      store,
    });
    const messages: Message[] = [msg('user', 'hi')];
    const context: FenceContext = { userId: 'alice' };

    // Record enough to exhaust the window budget
    fence.record(messages, { input: 100, output: 0, total: 100 }, context);

    // Should be blocked
    expect(() => fence.check(messages, context)).toThrow(BudgetExceededError);

    // Advance past the window
    vi.advanceTimersByTime(60_000);

    // Budget should recover
    expect(() => fence.check(messages, context)).not.toThrow();
  });
});

// ── custom store ─────────────────────────────────────────────────────

describe('createFence — custom store', () => {
  it('uses the provided store for tracking', () => {
    const store = new InMemoryStore();
    // Pre-fill to 9998 so any message (>=3 tokens) pushes over 10_000
    store.increment('user:alice', 9998);

    const fence = createFence({
      budgets: { perUser: { maxInputTokens: 10_000 } },
      store,
    });
    const messages: Message[] = [msg('user', 'hello')];

    expect(() => fence.check(messages, { userId: 'alice' })).toThrow(BudgetExceededError);
  });
});

// ── custom token counter ─────────────────────────────────────────────

describe('createFence — custom tokenCounter', () => {
  it('uses the custom counter for check()', () => {
    // Counter that returns a huge number, guaranteeing per-request block
    const bigCounter = (_text: string) => 999_999;
    const fence = createFence({
      budgets: { perRequest: { maxInputTokens: 1000 } },
      tokenCounter: bigCounter,
    });
    const messages: Message[] = [msg('user', 'hello')];
    expect(() => fence.check(messages)).toThrow(BudgetExceededError);
  });
});
