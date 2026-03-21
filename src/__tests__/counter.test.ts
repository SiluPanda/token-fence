import { describe, it, expect } from 'vitest';
import { approximateTokenCounter, countMessageTokens, countTotalInputTokens } from '../counter';
import type { Message } from '../types';

describe('approximateTokenCounter', () => {
  it('returns 0 for empty string', () => {
    expect(approximateTokenCounter('')).toBe(0);
  });

  it('returns Math.ceil(5/4) = 2 for "hello"', () => {
    expect(approximateTokenCounter('hello')).toBe(2);
  });

  it('returns Math.ceil(11/4) = 3 for "hello world"', () => {
    expect(approximateTokenCounter('hello world')).toBe(3);
  });

  it('returns 100 for a 400-character string', () => {
    const text = 'a'.repeat(400);
    expect(approximateTokenCounter(text)).toBe(100);
  });

  it('returns 1 for a single character', () => {
    expect(approximateTokenCounter('x')).toBe(1);
  });

  it('counts tokens for a code snippet', () => {
    const code = 'function add(a: number, b: number): number { return a + b; }';
    expect(approximateTokenCounter(code)).toBe(Math.ceil(code.length / 4));
  });

  it('counts tokens for a JSON string', () => {
    const json = JSON.stringify({ name: 'test', values: [1, 2, 3] });
    expect(approximateTokenCounter(json)).toBe(Math.ceil(json.length / 4));
  });
});

describe('countMessageTokens', () => {
  it('counts content plus overhead for a simple user message', () => {
    const msg: Message = { role: 'user', content: 'hello' };
    // "hello" = 5 chars => ceil(5/4) = 2, + overhead 4 = 6
    expect(countMessageTokens(msg)).toBe(6);
  });

  it('adds name field tokens when present', () => {
    const msg: Message = { role: 'tool', content: 'result', name: 'get_weather' };
    const contentTokens = Math.ceil('result'.length / 4); // 2
    const nameTokens = Math.ceil('get_weather'.length / 4); // 3
    expect(countMessageTokens(msg)).toBe(4 + contentTokens + nameTokens);
  });

  it('adds tool_calls tokens when present', () => {
    const toolCalls = [
      { id: 'call-1', type: 'function' as const, function: { name: 'search', arguments: '{"q":"test"}' } },
    ];
    const msg: Message = { role: 'assistant', content: null, tool_calls: toolCalls };
    const serialized = JSON.stringify(toolCalls);
    const toolCallTokens = Math.ceil(serialized.length / 4);
    // content is null => 0 tokens, + overhead 4 + tool_calls tokens
    expect(countMessageTokens(msg)).toBe(4 + toolCallTokens);
  });

  it('adds tool_call_id tokens when present', () => {
    const msg: Message = { role: 'tool', content: 'done', tool_call_id: 'call-abc-123' };
    const contentTokens = Math.ceil('done'.length / 4); // 1
    const idTokens = Math.ceil('call-abc-123'.length / 4); // 3
    expect(countMessageTokens(msg)).toBe(4 + contentTokens + idTokens);
  });

  it('returns only overhead when content is null and no optional fields', () => {
    const msg: Message = { role: 'assistant', content: null };
    expect(countMessageTokens(msg)).toBe(4);
  });

  it('counts all fields when all are present', () => {
    const toolCalls = [
      { id: 'tc-1', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } },
    ];
    const msg: Message = {
      role: 'assistant',
      content: 'I will look that up.',
      name: 'helper',
      tool_calls: toolCalls,
      tool_call_id: 'prev-call',
    };
    const contentTokens = Math.ceil('I will look that up.'.length / 4);
    const nameTokens = Math.ceil('helper'.length / 4);
    const toolCallTokens = Math.ceil(JSON.stringify(toolCalls).length / 4);
    const toolCallIdTokens = Math.ceil('prev-call'.length / 4);
    expect(countMessageTokens(msg)).toBe(
      4 + contentTokens + nameTokens + toolCallTokens + toolCallIdTokens,
    );
  });

  it('uses a custom token counter function', () => {
    const wordCounter = (text: string) => text.split(/\s+/).filter(Boolean).length;
    const msg: Message = { role: 'user', content: 'one two three four five' };
    // 5 words + overhead 4 = 9
    expect(countMessageTokens(msg, wordCounter)).toBe(9);
  });

  it('uses a custom messageOverhead', () => {
    const msg: Message = { role: 'user', content: 'hello' };
    const contentTokens = Math.ceil('hello'.length / 4); // 2
    expect(countMessageTokens(msg, approximateTokenCounter, 10)).toBe(10 + contentTokens);
  });
});

describe('countTotalInputTokens', () => {
  it('counts tokens for a single message', () => {
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    // "hello" = ceil(5/4) = 2 + overhead 4 = 6
    expect(countTotalInputTokens(messages)).toBe(6);
  });

  it('sums tokens across multiple messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const expected =
      countMessageTokens(messages[0]) +
      countMessageTokens(messages[1]) +
      countMessageTokens(messages[2]);
    expect(countTotalInputTokens(messages)).toBe(expected);
  });

  it('returns 0 for an empty array', () => {
    expect(countTotalInputTokens([])).toBe(0);
  });

  it('uses a custom counter', () => {
    const fixedCounter = (_text: string) => 10;
    const messages: Message[] = [
      { role: 'user', content: 'anything' },
      { role: 'assistant', content: 'response' },
    ];
    // Each message: 4 overhead + 10 content = 14, two messages = 28
    expect(countTotalInputTokens(messages, fixedCounter)).toBe(28);
  });

  it('counts messages with mixed roles correctly', () => {
    const messages: Message[] = [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Question?' },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'tc-1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
      ] },
      { role: 'tool', content: 'result data', tool_call_id: 'tc-1' },
      { role: 'assistant', content: 'Here is the answer.' },
    ];
    const expected = messages.reduce(
      (sum, msg) => sum + countMessageTokens(msg),
      0,
    );
    expect(countTotalInputTokens(messages)).toBe(expected);
  });
});
