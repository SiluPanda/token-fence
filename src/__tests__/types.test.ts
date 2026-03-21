import { describe, it, expect } from 'vitest';
import type {
  Message,
  FenceContext,
  BudgetConfig,
  EnforcementAction,
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
  TokenCounter,
  RequestBudget,
  ScopedBudget,
  FenceConfig,
} from '../types';

// Compile-time shape checks via assignment. These tests verify that the type
// definitions accept valid values — if a type is wrong, TypeScript compilation
// fails and the test suite will not run.

describe('Message type', () => {
  it('can be constructed with required fields only', () => {
    const msg: Message = { role: 'user', content: 'hello' };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('accepts null content', () => {
    const msg: Message = { role: 'assistant', content: null };
    expect(msg.content).toBeNull();
  });

  it('accepts all optional fields', () => {
    const msg: Message = {
      role: 'tool',
      content: 'result',
      tool_call_id: 'call-abc',
      name: 'get_weather',
      tool_calls: [
        { id: 'call-abc', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
      ],
    };
    expect(msg.tool_call_id).toBe('call-abc');
    expect(msg.name).toBe('get_weather');
  });

  it('accepts system role', () => {
    const msg: Message = { role: 'system', content: 'You are helpful.' };
    expect(msg.role).toBe('system');
  });

  it('accepts assistant role with tool_calls', () => {
    const msg: Message = {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'tc-1', type: 'function', function: { name: 'search', arguments: '{"q":"test"}' } },
      ],
    };
    expect(msg.tool_calls).toHaveLength(1);
  });
});

describe('FenceContext type', () => {
  it('with just userId is valid', () => {
    const ctx: FenceContext = { userId: 'alice' };
    expect(ctx.userId).toBe('alice');
    expect(ctx.sessionId).toBeUndefined();
  });

  it('with just sessionId is valid', () => {
    const ctx: FenceContext = { sessionId: 'sess-123' };
    expect(ctx.sessionId).toBe('sess-123');
    expect(ctx.userId).toBeUndefined();
  });

  it('empty object is valid (all fields optional)', () => {
    const ctx: FenceContext = {};
    expect(ctx.userId).toBeUndefined();
    expect(ctx.sessionId).toBeUndefined();
  });

  it('accepts custom scopes', () => {
    const ctx: FenceContext = { userId: 'bob', scopes: { orgId: 'org-xyz' } };
    expect(ctx.scopes?.orgId).toBe('org-xyz');
  });
});

describe('BudgetConfig type', () => {
  it('with no fields is valid (all optional)', () => {
    const config: BudgetConfig = {};
    expect(config.perRequest).toBeUndefined();
    expect(config.perUser).toBeUndefined();
    expect(config.perSession).toBeUndefined();
    expect(config.global).toBeUndefined();
  });

  it('accepts perRequest budget', () => {
    const config: BudgetConfig = { perRequest: { maxInputTokens: 8000 } };
    expect(config.perRequest?.maxInputTokens).toBe(8000);
  });

  it('accepts perUser budget with window', () => {
    const config: BudgetConfig = {
      perUser: { maxTotalTokens: 100000, window: '1h', action: 'block' },
    };
    expect(config.perUser?.maxTotalTokens).toBe(100000);
    expect(config.perUser?.window).toBe('1h');
  });

  it('accepts global budget with numeric window', () => {
    const config: BudgetConfig = {
      global: { maxTotalTokens: 10000000, window: 86400000 },
    };
    expect(config.global?.window).toBe(86400000);
  });

  it('accepts custom budgets', () => {
    const config: BudgetConfig = {
      custom: { myScope: { maxTotalTokens: 50000 } },
    };
    expect(config.custom?.myScope?.maxTotalTokens).toBe(50000);
  });
});

describe('RequestBudget type', () => {
  it('requires maxInputTokens', () => {
    const rb: RequestBudget = { maxInputTokens: 4096 };
    expect(rb.maxInputTokens).toBe(4096);
  });

  it('accepts optional action', () => {
    const rb: RequestBudget = { maxInputTokens: 4096, action: 'truncate' };
    expect(rb.action).toBe('truncate');
  });
});

describe('ScopedBudget type', () => {
  it('accepts empty object (all optional)', () => {
    const sb: ScopedBudget = {};
    expect(sb.maxTotalTokens).toBeUndefined();
  });

  it('accepts maxInputTokens only', () => {
    const sb: ScopedBudget = { maxInputTokens: 5000 };
    expect(sb.maxInputTokens).toBe(5000);
  });

  it('accepts maxOutputTokens only', () => {
    const sb: ScopedBudget = { maxOutputTokens: 2000 };
    expect(sb.maxOutputTokens).toBe(2000);
  });
});

describe('EnforcementAction union', () => {
  it('block is a valid EnforcementAction', () => {
    const action: EnforcementAction = 'block';
    expect(action).toBe('block');
  });

  it('truncate is a valid EnforcementAction', () => {
    const action: EnforcementAction = 'truncate';
    expect(action).toBe('truncate');
  });

  it('warn is a valid EnforcementAction', () => {
    const action: EnforcementAction = 'warn';
    expect(action).toBe('warn');
  });

  it('all values can be checked exhaustively', () => {
    const actions: EnforcementAction[] = ['block', 'truncate', 'warn'];
    // Exhaustive check: function with never type ensures all branches covered
    const describe = (a: EnforcementAction): string => {
      switch (a) {
        case 'block':
          return 'block';
        case 'truncate':
          return 'truncate';
        case 'warn':
          return 'warn';
        default: {
          const _exhaustive: never = a;
          return _exhaustive;
        }
      }
    };
    expect(actions.map(describe)).toEqual(['block', 'truncate', 'warn']);
  });
});

describe('AllowanceResult type', () => {
  it('can be constructed with required fields', () => {
    const result: AllowanceResult = {
      allowed: true,
      estimatedTokens: 500,
      remaining: { request: 7500, user: 45000 },
      blockingScope: null,
    };
    expect(result.allowed).toBe(true);
    expect(result.blockingScope).toBeNull();
  });

  it('blockingScope can be a string', () => {
    const result: AllowanceResult = {
      allowed: false,
      estimatedTokens: 8000,
      remaining: { user: 1000 },
      blockingScope: 'user',
      windowResetsAt: new Date(),
    };
    expect(result.blockingScope).toBe('user');
  });
});

describe('ScopeAllowance type', () => {
  it('can be constructed with required fields', () => {
    const allowance: ScopeAllowance = { remaining: 45000, limit: 100000, used: 55000 };
    expect(allowance.remaining).toBe(45000);
    expect(allowance.limit).toBe(100000);
    expect(allowance.used).toBe(55000);
  });

  it('accepts optional windowResetsAt and windowDuration', () => {
    const allowance: ScopeAllowance = {
      remaining: 45000,
      limit: 100000,
      used: 55000,
      windowResetsAt: new Date(),
      windowDuration: 3600000,
    };
    expect(allowance.windowDuration).toBe(3600000);
  });
});

describe('ScopeUsage type', () => {
  it('can be constructed with all fields', () => {
    const usage: ScopeUsage = {
      input: 10000,
      output: 5000,
      total: 15000,
      requestCount: 3,
      firstUsageAt: new Date('2026-03-21T10:00:00Z'),
      lastUsageAt: new Date('2026-03-21T11:00:00Z'),
    };
    expect(usage.total).toBe(15000);
    expect(usage.requestCount).toBe(3);
  });
});

describe('Event types', () => {
  it('BlockEvent can be constructed', () => {
    const event: BlockEvent = {
      scope: 'user',
      limit: 100000,
      current: 95000,
      requested: 8000,
      remaining: 5000,
      messages: [{ role: 'user', content: 'hello' }],
      timestamp: new Date(),
    };
    expect(event.scope).toBe('user');
    expect(event.messages).toHaveLength(1);
  });

  it('TruncateEvent can be constructed', () => {
    const event: TruncateEvent = {
      scope: 'request',
      originalTokens: 12000,
      truncatedTokens: 7800,
      messagesRemoved: 4,
      timestamp: new Date(),
    };
    expect(event.messagesRemoved).toBe(4);
  });

  it('WarningEvent can be constructed', () => {
    const event: WarningEvent = {
      scope: 'user',
      limit: 100000,
      current: 95000,
      requested: 8000,
      projected: 103000,
      timestamp: new Date(),
    };
    expect(event.projected).toBe(103000);
  });

  it('UsageEvent can be constructed', () => {
    const event: UsageEvent = {
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
      model: 'gpt-4o',
      timestamp: new Date(),
    };
    expect(event.model).toBe('gpt-4o');
  });
});

describe('FenceMetadata type', () => {
  it('all fields are optional', () => {
    const meta: FenceMetadata = {};
    expect(meta.truncated).toBeUndefined();
    expect(meta.warning).toBeUndefined();
  });

  it('accepts truncation fields', () => {
    const meta: FenceMetadata = {
      truncated: true,
      originalTokens: 12000,
      truncatedTokens: 7800,
      messagesRemoved: 4,
      scope: 'request',
    };
    expect(meta.truncated).toBe(true);
  });

  it('accepts warning fields', () => {
    const meta: FenceMetadata = {
      warning: true,
      scope: 'user',
      limit: 100000,
      current: 95000,
      afterRequest: 108000,
    };
    expect(meta.warning).toBe(true);
    expect(meta.afterRequest).toBe(108000);
  });
});

describe('TokenCounter type', () => {
  it('accepts a function matching the signature', () => {
    const counter: TokenCounter = (text: string) => Math.ceil(text.length / 4);
    expect(counter('hello world')).toBe(3);
  });
});

describe('FenceConfig type', () => {
  it('requires budgets field', () => {
    const config: FenceConfig = { budgets: {} };
    expect(config.budgets).toBeDefined();
  });

  it('accepts all optional fields', () => {
    const config: FenceConfig = {
      budgets: { perRequest: { maxInputTokens: 8000 } },
      action: 'block',
      tokenCounter: (t) => Math.ceil(t.length / 4),
      messageOverhead: 4,
      minTokensAfterTruncation: 100,
      windowBuckets: 60,
      onBlock: () => {},
      onTruncate: () => {},
      onWarning: () => {},
      onUsage: () => {},
    };
    expect(config.action).toBe('block');
    expect(config.windowBuckets).toBe(60);
  });
});

describe('FenceStore interface', () => {
  it('can be implemented with sync methods', () => {
    const store: FenceStore = {
      get: (_key: string) => 0,
      set: (_key: string, _value: number) => {},
      increment: (_key: string, delta: number) => delta,
      delete: (_key: string) => {},
      getWindow: (_key: string, bucketCount: number) => new Array(bucketCount).fill(0) as number[],
      recordBucket: (_key: string, _bucketIndex: number, _delta: number) => {},
      resetBuckets: (_key: string, _bucketIndices: number[]) => {},
    };
    expect(store.get('test')).toBe(0);
    expect(store.increment('test', 5)).toBe(5);
  });

  it('can be implemented with async methods', async () => {
    const store: FenceStore = {
      get: async (_key: string) => Promise.resolve(42),
      set: async (_key: string, _value: number) => Promise.resolve(),
      increment: async (_key: string, delta: number) => Promise.resolve(delta),
      delete: async (_key: string) => Promise.resolve(),
      getWindow: async (_key: string, bucketCount: number) =>
        Promise.resolve(new Array(bucketCount).fill(0) as number[]),
      recordBucket: async (_key: string, _bucketIndex: number, _delta: number) =>
        Promise.resolve(),
      resetBuckets: async (_key: string, _bucketIndices: number[]) => Promise.resolve(),
    };
    expect(await store.get('test')).toBe(42);
  });
});

// TokenFence is an interface — verify it compiles with a minimal implementation
describe('TokenFence interface', () => {
  it('can be satisfied by a class implementation', () => {
    class MockFence implements TokenFence {
      apply<T>(client: T): T {
        return client;
      }
      check(_messages: Message[], _context?: FenceContext): AllowanceResult {
        return { allowed: true, estimatedTokens: 0, remaining: {}, blockingScope: null };
      }
      getAllowance(_scope: {
        userId?: string;
        sessionId?: string;
        global?: boolean;
      }): ScopeAllowance {
        return { remaining: 100000, limit: 100000, used: 0 };
      }
      getUsage(_scope: {
        userId?: string;
        sessionId?: string;
        global?: boolean;
      }): ScopeUsage {
        return {
          input: 0,
          output: 0,
          total: 0,
          requestCount: 0,
          firstUsageAt: new Date(),
          lastUsageAt: new Date(),
        };
      }
      reset(_scope: { userId?: string; sessionId?: string; global?: boolean }): void {}
      getConfig(): Readonly<FenceConfig> {
        return { budgets: {} };
      }
      updateBudgets(_budgets: Partial<BudgetConfig>): void {}
    }

    const fence: TokenFence = new MockFence();
    const client = { name: 'openai' };
    expect(fence.apply(client)).toBe(client);

    const allowance = fence.check([{ role: 'user', content: 'hi' }]);
    expect(allowance.allowed).toBe(true);

    const scopeAllowance = fence.getAllowance({ userId: 'alice' });
    expect(scopeAllowance.remaining).toBe(100000);

    const usage = fence.getUsage({ sessionId: 'sess-1' });
    expect(usage.total).toBe(0);

    fence.reset({ global: true });
    const config = fence.getConfig();
    expect(config.budgets).toBeDefined();
  });
});
