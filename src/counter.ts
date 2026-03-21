import type { TokenCounter, Message } from './types';

/**
 * Default approximate token counter.
 * Uses the common heuristic: ~4 characters per token.
 */
export const approximateTokenCounter: TokenCounter = (text: string): number => {
  return Math.ceil(text.length / 4);
};

/**
 * Count tokens for a single message.
 */
export function countMessageTokens(
  msg: Message,
  tokenCounter: TokenCounter = approximateTokenCounter,
  messageOverhead: number = 4,
): number {
  let count = messageOverhead;
  count += tokenCounter(msg.content || '');
  if (msg.name) {
    count += tokenCounter(msg.name);
  }
  if (msg.tool_calls) {
    count += tokenCounter(JSON.stringify(msg.tool_calls));
  }
  if (msg.tool_call_id) {
    count += tokenCounter(msg.tool_call_id);
  }
  return count;
}

/**
 * Count total input tokens for a messages array.
 */
export function countTotalInputTokens(
  messages: Message[],
  tokenCounter: TokenCounter = approximateTokenCounter,
  messageOverhead: number = 4,
): number {
  return messages.reduce(
    (total, msg) => total + countMessageTokens(msg, tokenCounter, messageOverhead),
    0,
  );
}
