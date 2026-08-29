import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGesture } from '../src/ui/gestures.js';

test('小位移短按 → tap', () => {
  assert.equal(resolveGesture({ dx: 3, dy: 2, durMs: 80 }), 'tap');
});
test('长按未移动 → long', () => {
  assert.equal(resolveGesture({ dx: 0, dy: 0, durMs: 900, longFired: true }), 'long');
});
test('横移超阈值 → right/left', () => {
  assert.equal(resolveGesture({ dx: 80, dy: 5, durMs: 200 }), 'right');
  assert.equal(resolveGesture({ dx: -80, dy: 5, durMs: 200 }), 'left');
});
test('纵滑不产生手势（留给页面滚动）', () => {
  assert.equal(resolveGesture({ dx: 5, dy: 90, durMs: 200 }), null);
});
test('位移不足阈值 → tap 兜底', () => {
  assert.equal(resolveGesture({ dx: 30, dy: 4, durMs: 150 }), 'tap');
});
