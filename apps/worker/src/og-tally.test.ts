import { describe, expect, it } from 'bun:test';
import { collectTally } from './og-tally';

const base = { id: 'a', color: '#ff0055', lineWidth: 4 };

describe('collectTally', () => {
  it('counts an op whose schema no longer parses', () => {
    // A row written before `compositeOperation` existed still says what it was.
    expect(collectTally([{ tool: 'pen', points: [{ x: 1, y: 1 }] }]).drawings).toBe(1);
  });

  it('counts a comment thread once, not once per reply', () => {
    const thread = { ...base, tool: 'comment', num: 1, text: 'hi', x: 10, y: 10, ts: 0 };
    expect(collectTally([thread, { ...thread, id: 'b', parentId: 'a' }]).comments).toBe(1);
  });

  it('sorts each tool into the line it belongs to', () => {
    const tally = collectTally([
      { ...base, tool: 'circle', centerX: 1, centerY: 1, radius: 5 },
      { ...base, tool: 'text', text: 'note', x: 1, y: 2, fontSize: 14 },
      { ...base, tool: 'comment', num: 1, text: 'hi', x: 1, y: 1, ts: 0 },
    ]);
    expect(tally).toEqual({ comments: 1, drawings: 1, notes: 1 });
  });

  it('counts nothing for tools that are not something said about the page', () => {
    const tally = collectTally([
      { ...base, tool: 'guide', orientation: 'horizontal', position: 40 },
      { ...base, tool: 'eraser', points: [{ x: 1, y: 1 }] },
    ]);
    expect(tally).toEqual({ comments: 0, drawings: 0, notes: 0 });
  });

  it('ignores rows that are not ops at all', () => {
    expect(collectTally([null, 'nope', 42, {}, { tool: 7 }])).toEqual({ comments: 0, drawings: 0, notes: 0 });
  });
});
