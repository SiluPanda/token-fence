import { describe, it, expect } from 'vitest';
import {
  FenceError,
  BudgetExceededError,
  ProtectedExceedsBudgetError,
  FenceConfigError,
} from '../errors';

describe('FenceError', () => {
  it('has correct name, code, and message', () => {
    const err = new FenceError('something failed', 'SOME_CODE');
    expect(err.message).toBe('something failed');
    expect(err.code).toBe('SOME_CODE');
    expect(err.name).toBe('FenceError');
  });

  it('is instanceof Error and FenceError', () => {
    const err = new FenceError('test', 'CODE');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof FenceError).toBe(true);
  });

  it('prototype chain works correctly', () => {
    const err = new FenceError('test', 'CODE');
    expect(Object.getPrototypeOf(err)).toBe(FenceError.prototype);
  });
});

describe('BudgetExceededError', () => {
  const makeErr = (extra?: { userId?: string; sessionId?: string; windowResetsAt?: Date }) =>
    new BudgetExceededError(
      'budget exceeded',
      'user',
      100000,
      95000,
      8000,
      5000,
      extra?.userId,
      extra?.sessionId,
      extra?.windowResetsAt,
    );

  it('has correct code BUDGET_EXCEEDED', () => {
    expect(makeErr().code).toBe('BUDGET_EXCEEDED');
  });

  it('has correct name', () => {
    expect(makeErr().name).toBe('BudgetExceededError');
  });

  it('has all required fields accessible', () => {
    const err = makeErr({ userId: 'alice', sessionId: 'sess-1' });
    expect(err.message).toBe('budget exceeded');
    expect(err.scope).toBe('user');
    expect(err.limit).toBe(100000);
    expect(err.current).toBe(95000);
    expect(err.requested).toBe(8000);
    expect(err.remaining).toBe(5000);
    expect(err.userId).toBe('alice');
    expect(err.sessionId).toBe('sess-1');
  });

  it('has windowResetsAt when provided', () => {
    const date = new Date('2026-03-21T12:00:00Z');
    const err = makeErr({ windowResetsAt: date });
    expect(err.windowResetsAt).toBe(date);
  });

  it('has optional fields as undefined when not provided', () => {
    const err = makeErr();
    expect(err.userId).toBeUndefined();
    expect(err.sessionId).toBeUndefined();
    expect(err.windowResetsAt).toBeUndefined();
  });

  it('is instanceof FenceError', () => {
    expect(makeErr() instanceof FenceError).toBe(true);
  });

  it('is instanceof BudgetExceededError', () => {
    expect(makeErr() instanceof BudgetExceededError).toBe(true);
  });

  it('is instanceof Error', () => {
    expect(makeErr() instanceof Error).toBe(true);
  });

  it('prototype chain works correctly', () => {
    const err = makeErr();
    expect(Object.getPrototypeOf(err)).toBe(BudgetExceededError.prototype);
  });
});

describe('ProtectedExceedsBudgetError', () => {
  const makeErr = () =>
    new ProtectedExceedsBudgetError(
      'protected tokens exceed budget',
      'request',
      9000,
      8000,
    );

  it('has correct code PROTECTED_EXCEEDS_BUDGET', () => {
    expect(makeErr().code).toBe('PROTECTED_EXCEEDS_BUDGET');
  });

  it('has correct name', () => {
    expect(makeErr().name).toBe('ProtectedExceedsBudgetError');
  });

  it('has all fields accessible', () => {
    const err = makeErr();
    expect(err.message).toBe('protected tokens exceed budget');
    expect(err.scope).toBe('request');
    expect(err.protectedTokens).toBe(9000);
    expect(err.budget).toBe(8000);
  });

  it('is instanceof FenceError', () => {
    expect(makeErr() instanceof FenceError).toBe(true);
  });

  it('is instanceof ProtectedExceedsBudgetError', () => {
    expect(makeErr() instanceof ProtectedExceedsBudgetError).toBe(true);
  });

  it('is instanceof Error', () => {
    expect(makeErr() instanceof Error).toBe(true);
  });

  it('prototype chain works correctly', () => {
    const err = makeErr();
    expect(Object.getPrototypeOf(err)).toBe(ProtectedExceedsBudgetError.prototype);
  });
});

describe('FenceConfigError', () => {
  const makeErr = () =>
    new FenceConfigError('invalid config', ['field A is required', 'field B must be positive']);

  it('has correct code FENCE_CONFIG_ERROR', () => {
    expect(makeErr().code).toBe('FENCE_CONFIG_ERROR');
  });

  it('has correct name', () => {
    expect(makeErr().name).toBe('FenceConfigError');
  });

  it('has validationErrors array accessible', () => {
    const err = makeErr();
    expect(err.validationErrors).toEqual(['field A is required', 'field B must be positive']);
  });

  it('has the correct message', () => {
    expect(makeErr().message).toBe('invalid config');
  });

  it('is instanceof FenceError', () => {
    expect(makeErr() instanceof FenceError).toBe(true);
  });

  it('is instanceof FenceConfigError', () => {
    expect(makeErr() instanceof FenceConfigError).toBe(true);
  });

  it('is instanceof Error', () => {
    expect(makeErr() instanceof Error).toBe(true);
  });

  it('prototype chain works correctly', () => {
    const err = makeErr();
    expect(Object.getPrototypeOf(err)).toBe(FenceConfigError.prototype);
  });
});
