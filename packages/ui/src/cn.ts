import { createCn } from 'cnfast';
import { TEXT_STEPS } from './type-scale.generated';

export type { ClassValue } from 'cnfast';

/**
 * The type scale's names, taught to the class merger.
 *
 * `cn` is clsx + tailwind-merge (via cnfast, ~3.8x faster with byte-identical
 * output). tailwind-merge resolves an unrecognised `text-*` to the *colour*
 * group, which has a catch-all matcher, so `cn('text-meta', 'text-inherit')`
 * silently dropped the size and the element fell back to the inherited 16px.
 * The names are generated from the `--text-*` steps in the stylesheets'
 * @theme blocks (`bun run gen:type-scale`); a test fails when they drift.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: TEXT_STEPS }],
    },
  },
});
