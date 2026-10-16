import { describe, expect, it } from 'vitest';

describe('test runner smoke', () => {
  it('executes assertions', () => {
    expect([1, 2, 3].reduce((a, b) => a + b, 0)).toBe(6);
    expect(typeof globalThis).toBe('object');
  });
});
