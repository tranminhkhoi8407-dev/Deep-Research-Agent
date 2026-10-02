import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const base = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../src/dark-mode.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries([base, theme].flatMap((css) =>
  [...css.matchAll(/html\[data-theme='dark'\]\s*\{([^}]+)\}/g)]
    .flatMap((block) => [...block[1].matchAll(/(--[\w-]+):\s*(#[\da-f]{3,6})\s*;/gi)]
      .map((match) => [match[1], match[2]]))));

function luminance(hex) {
  const full = hex.length === 4 ? hex.slice(1).split('').map((x) => x + x).join('') : hex.slice(1);
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((x) => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return rgb.reduce((total, x, i) => total + x * [.2126, .7152, .0722][i], 0);
}
function contrast(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + .05) / (b + .05);
}

test('body, secondary copy and selected controls retain readable dark-theme contrast', () => {
  for (const ink of ['--ink', '--muted']) {
    for (const surface of ['--surface', '--surface-soft', '--tone-info']) {
      assert.ok(contrast(tokens[ink], tokens[surface]) >= 4.5, `${ink} on ${surface}`);
    }
  }
  assert.ok(contrast(tokens['--faint'], tokens['--surface-soft']) >= 4.5);
});

test('white button labels remain readable in normal and hover states', () => {
  for (const fill of ['--action-fill', '--action-hover']) {
    assert.ok(contrast(tokens['--on-action'], tokens[fill]) >= 4.5, fill);
  }
});

test('semantic status labels retain contrast on their matching backgrounds', () => {
  for (const tone of ['info', 'success', 'warning', 'danger', 'purple']) {
    assert.ok(contrast(tokens[`--tone-${tone}-ink`], tokens[`--tone-${tone}`]) >= 4.5, tone);
  }
});

test('activity scale gets progressively brighter without white empty cells', () => {
  const levels = [0, 1, 2, 3, 4].map((n) => luminance(tokens[`--activity-${n}`]));
  assert.ok(levels[0] < .08, 'empty cells should recede into the dark canvas');
  levels.slice(1).forEach((level, n) => assert.ok(level > levels[n], `activity level ${n + 1}`));
});

test('completion stylesheet is dark-only and loaded after the visual system', () => {
  const uncommented = theme.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of uncommented.split('}').map((x) => x.trim()).filter(Boolean)) {
    assert.ok(rule.startsWith("html[data-theme='dark']"), `unscoped rule: ${rule.slice(0, 60)}`);
  }
  const entry = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.ok(entry.indexOf("import './dark-mode.css'") > entry.indexOf("import './design.css'"));
});
