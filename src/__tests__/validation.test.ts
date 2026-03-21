import { describe, it, expect } from 'vitest';
import { parseWindowDuration, validateConfig } from '../validation';
import { FenceConfigError } from '../errors';
import type { FenceConfig } from '../types';

describe('parseWindowDuration', () => {
  it('parses "1m" to 60000 ms', () => {
    expect(parseWindowDuration('1m')).toBe(60_000);
  });

  it('parses "5m" to 300000 ms', () => {
    expect(parseWindowDuration('5m')).toBe(300_000);
  });

  it('parses "1h" to 3600000 ms', () => {
    expect(parseWindowDuration('1h')).toBe(3_600_000);
  });

  it('parses "6h" to 21600000 ms', () => {
    expect(parseWindowDuration('6h')).toBe(21_600_000);
  });

  it('parses "1d" to 86400000 ms', () => {
    expect(parseWindowDuration('1d')).toBe(86_400_000);
  });

  it('parses "7d" to 604800000 ms', () => {
    expect(parseWindowDuration('7d')).toBe(604_800_000);
  });

  it('passes through a positive number as-is', () => {
    expect(parseWindowDuration(5000)).toBe(5000);
  });

  it('passes through a large number as-is', () => {
    expect(parseWindowDuration(86_400_000)).toBe(86_400_000);
  });

  it('throws on invalid string format', () => {
    expect(() => parseWindowDuration('10s')).toThrow('Invalid window duration format');
  });

  it('throws on empty string', () => {
    expect(() => parseWindowDuration('')).toThrow('Invalid window duration format');
  });

  it('throws on gibberish string', () => {
    expect(() => parseWindowDuration('abc')).toThrow('Invalid window duration format');
  });

  it('throws on zero duration (number)', () => {
    expect(() => parseWindowDuration(0)).toThrow('Window duration must be positive');
  });

  it('throws on negative duration (number)', () => {
    expect(() => parseWindowDuration(-1000)).toThrow('Window duration must be positive');
  });
});

describe('validateConfig', () => {
  const minimalValid: FenceConfig = {
    budgets: {
      perRequest: { maxInputTokens: 4096 },
    },
  };

  it('passes with a valid minimal config (perRequest only)', () => {
    expect(() => validateConfig(minimalValid)).not.toThrow();
  });

  it('passes with a valid config using all scopes', () => {
    const config: FenceConfig = {
      budgets: {
        perRequest: { maxInputTokens: 4096 },
        perUser: { maxInputTokens: 100_000, window: '1d' },
        perSession: { maxTotalTokens: 200_000 },
        global: { maxInputTokens: 1_000_000, window: '1h' },
        custom: {
          team: { maxTotalTokens: 500_000, window: '7d' },
        },
      },
      action: 'block',
      messageOverhead: 4,
      minTokensAfterTruncation: 100,
      windowBuckets: 60,
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws FenceConfigError when no budget scopes are configured', () => {
    const config: FenceConfig = { budgets: {} };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
  });

  it('throws with "At least one budget scope" message for empty budgets', () => {
    const config: FenceConfig = { budgets: {} };
    try {
      validateConfig(config);
    } catch (err) {
      expect(err).toBeInstanceOf(FenceConfigError);
      expect((err as FenceConfigError).validationErrors).toContain('At least one budget scope must be configured');
    }
  });

  it('throws when perRequest.maxInputTokens is negative', () => {
    const config: FenceConfig = {
      budgets: { perRequest: { maxInputTokens: -100 } },
    };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('perRequest.maxInputTokens must be positive');
    }
  });

  it('throws when perRequest.maxInputTokens is zero', () => {
    const config: FenceConfig = {
      budgets: { perRequest: { maxInputTokens: 0 } },
    };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
  });

  it('throws when scoped budget maxInputTokens is negative', () => {
    const config: FenceConfig = {
      budgets: { perUser: { maxInputTokens: -500 } },
    };
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('perUser.maxInputTokens must be positive');
    }
  });

  it('throws when scoped budget maxOutputTokens is negative', () => {
    const config: FenceConfig = {
      budgets: { perSession: { maxOutputTokens: -1 } },
    };
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('perSession.maxOutputTokens must be positive');
    }
  });

  it('throws when scoped budget maxTotalTokens is zero', () => {
    const config: FenceConfig = {
      budgets: { global: { maxTotalTokens: 0 } },
    };
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('global.maxTotalTokens must be positive');
    }
  });

  it('throws for invalid top-level action', () => {
    const config = {
      budgets: { perRequest: { maxInputTokens: 1000 } },
      action: 'explode' as any,
    } as FenceConfig;
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors[0]).toMatch(/Invalid action "explode"/);
    }
  });

  it('throws for invalid scope-level action', () => {
    const config: FenceConfig = {
      budgets: {
        perUser: { maxInputTokens: 1000, action: 'nuke' as any },
      },
    };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('perUser.action "nuke" is invalid');
    }
  });

  it('throws for negative messageOverhead', () => {
    const config: FenceConfig = {
      budgets: { perRequest: { maxInputTokens: 1000 } },
      messageOverhead: -1,
    };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('messageOverhead must be non-negative');
    }
  });

  it('allows messageOverhead of zero', () => {
    const config: FenceConfig = {
      budgets: { perRequest: { maxInputTokens: 1000 } },
      messageOverhead: 0,
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws for negative minTokensAfterTruncation', () => {
    const config: FenceConfig = {
      budgets: { perRequest: { maxInputTokens: 1000 } },
      minTokensAfterTruncation: -10,
    };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('minTokensAfterTruncation must be non-negative');
    }
  });

  it('throws for non-integer windowBuckets', () => {
    const config: FenceConfig = {
      budgets: { perRequest: { maxInputTokens: 1000 } },
      windowBuckets: 3.5,
    };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('windowBuckets must be a positive integer');
    }
  });

  it('throws for zero windowBuckets', () => {
    const config: FenceConfig = {
      budgets: { perRequest: { maxInputTokens: 1000 } },
      windowBuckets: 0,
    };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
  });

  it('throws for negative windowBuckets', () => {
    const config: FenceConfig = {
      budgets: { perRequest: { maxInputTokens: 1000 } },
      windowBuckets: -5,
    };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
  });

  it('throws for invalid window format in a scoped budget', () => {
    const config: FenceConfig = {
      budgets: {
        perUser: { maxInputTokens: 1000, window: 'forever' },
      },
    };
    expect(() => validateConfig(config)).toThrow(FenceConfigError);
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('perUser.window is invalid: forever');
    }
  });

  it('accepts valid window durations in scoped budgets', () => {
    const config: FenceConfig = {
      budgets: {
        perUser: { maxInputTokens: 1000, window: '1h' },
        global: { maxTotalTokens: 50000, window: 3600000 },
      },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('collects multiple errors and includes all in validationErrors', () => {
    const config: FenceConfig = {
      budgets: {},
      action: 'bad' as any,
      messageOverhead: -1,
      windowBuckets: 0,
    };
    try {
      validateConfig(config);
    } catch (err) {
      const ce = err as FenceConfigError;
      expect(ce.validationErrors.length).toBeGreaterThanOrEqual(3);
      expect(ce.validationErrors).toContain('At least one budget scope must be configured');
      expect(ce.validationErrors).toContain('messageOverhead must be non-negative');
      expect(ce.validationErrors).toContain('windowBuckets must be a positive integer');
    }
  });

  it('validates custom scope budgets', () => {
    const config: FenceConfig = {
      budgets: {
        custom: {
          team: { maxTotalTokens: -100 },
        },
      },
    };
    try {
      validateConfig(config);
    } catch (err) {
      expect((err as FenceConfigError).validationErrors).toContain('custom.team.maxTotalTokens must be positive');
    }
  });

  it('passes with only a custom scope configured', () => {
    const config: FenceConfig = {
      budgets: {
        custom: {
          department: { maxInputTokens: 500_000, window: '1d' },
        },
      },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });
});
