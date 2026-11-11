import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, safeGradient, safeTheme, themeStyle } from '../src/ui/themes.js';

// 回归：老校验的字符白名单只允许 a-f，#deg 里的 g 被误杀 → 所有内置渐变失效。
test('内置主题必须全部通过校验（角度单位不能被字符白名单误杀）', () => {
  for (const t of THEMES) {
    const s = safeTheme({ type: 'gradient', value: t.value });
    assert.ok(s, `${t.name} 应通过校验`);
    assert.equal(themeStyle(s), t.value);
  }
});

test('safeGradient：支持 deg / turn / 关键字方向与多色标', () => {
  assert.ok(safeGradient('linear-gradient(90deg, #ffffff 0%, #000000 100%)'));
  assert.ok(safeGradient('linear-gradient(0.25turn, #123456, #abcdef)'));
  assert.ok(safeGradient('linear-gradient(to right, #123456, #abcdef)'));
});

test('safeGradient：拒绝 CSS 注入面', () => {
  assert.equal(safeGradient('linear-gradient(red);background:url(x)'), null);
  assert.equal(safeGradient('linear-gradient(90deg, "#fff")'), null);
  assert.equal(safeGradient('url(javascript:alert(1))'), null);
  assert.equal(safeGradient('linear-gradient(90deg, #12, #ffffff)'), null, '非法十六进制长度');
});

test('safeTheme：图片主题只接受 data:image', () => {
  assert.ok(safeTheme({ type: 'image', url: 'data:image/png;base64,AAAA' }));
  assert.equal(safeTheme({ type: 'image', url: 'https://example.com/x.png' }), null);
  assert.equal(safeTheme(null), null);
  assert.equal(safeTheme({ type: 'unknown' }), null);
});
