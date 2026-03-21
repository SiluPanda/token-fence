export class FenceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'FenceError';
    Object.setPrototypeOf(this, FenceError.prototype);
  }
}

export class BudgetExceededError extends FenceError {
  constructor(
    message: string,
    readonly scope: string,
    readonly limit: number,
    readonly current: number,
    readonly requested: number,
    readonly remaining: number,
    readonly userId?: string,
    readonly sessionId?: string,
    readonly windowResetsAt?: Date,
  ) {
    super(message, 'BUDGET_EXCEEDED');
    this.name = 'BudgetExceededError';
    Object.setPrototypeOf(this, BudgetExceededError.prototype);
  }
}

export class ProtectedExceedsBudgetError extends FenceError {
  constructor(
    message: string,
    readonly scope: string,
    readonly protectedTokens: number,
    readonly budget: number,
  ) {
    super(message, 'PROTECTED_EXCEEDS_BUDGET');
    this.name = 'ProtectedExceedsBudgetError';
    Object.setPrototypeOf(this, ProtectedExceedsBudgetError.prototype);
  }
}

export class FenceConfigError extends FenceError {
  constructor(
    message: string,
    readonly validationErrors: string[],
  ) {
    super(message, 'FENCE_CONFIG_ERROR');
    this.name = 'FenceConfigError';
    Object.setPrototypeOf(this, FenceConfigError.prototype);
  }
}
