import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { TOOLS } from './tools';

const read = (file: string) =>
  readFileSync(new URL(`../../../apps/site/src/content/agent/${file}`, import.meta.url), 'utf8');

/** Tools the hand-written agent docs deliberately do not list yet. Documenting one means removing it here. */
const NOT_YET_DOCUMENTED = [
  'marklayer_share_preview',
  'marklayer_set_next_steps',
  'marklayer_complete_next_step',
  'marklayer_ask',
  'marklayer_get_feedback',
];

/** The skill file teaches the loop, not the whole catalogue. */
const SKILL_SKIPS = ['marklayer_room_info', 'marklayer_get_annotation'];

const names = TOOLS.map((tool) => tool.name);

describe.each(['llms.txt', 'llms-full.txt', 'SKILL.md'])('%s', (file) => {
  const text = read(file);

  test('names no tool that does not exist', () => {
    for (const [name] of text.matchAll(/marklayer_[a-z_]+/g)) expect(names).toContain(name);
  });

  test.each(names.filter((n) => !NOT_YET_DOCUMENTED.includes(n)))('lists %s', (name) => {
    if (file === 'SKILL.md' && SKILL_SKIPS.includes(name)) return;
    expect(text).toContain(name);
  });

  test('keeps the undocumented list honest', () => {
    for (const name of NOT_YET_DOCUMENTED) expect(text).not.toContain(name);
  });
});
