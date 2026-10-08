import { describe, expect, test } from 'bun:test';
import { commentMetaSchema, MAX_PAGE_ERROR_TEXT, MAX_PAGE_ERRORS } from '@marklayer/types';
import { ingestPageErrors, pageErrors } from './page-errors';

describe('ingestPageErrors', () => {
  // The relay is page-controlled; whatever it sends must still fit the schema the Durable Object enforces.
  test('clamps an oversize or overlong payload so the comment meta still validates', () => {
    ingestPageErrors(
      Array.from({ length: MAX_PAGE_ERRORS + 5 }, (_, i) => ({
        message: 'x'.repeat(MAX_PAGE_ERROR_TEXT * 2),
        source: 'y'.repeat(MAX_PAGE_ERROR_TEXT * 2),
        line: 3,
        at: i,
      })),
    );
    expect(pageErrors.value).toHaveLength(MAX_PAGE_ERRORS);
    expect(pageErrors.value[MAX_PAGE_ERRORS - 1]?.at).toBe(MAX_PAGE_ERRORS + 4);
    expect(commentMetaSchema.safeParse({ errors: pageErrors.value }).success).toBe(true);
  });

  test('drops malformed entries and non-arrays', () => {
    ingestPageErrors([{ message: 1, at: 1 }, null, 'nope', { message: 'ok', at: 2, line: 1.5 }]);
    expect(pageErrors.value).toEqual([{ message: 'ok', at: 2 }]);
    ingestPageErrors('garbage');
    expect(pageErrors.value).toEqual([{ message: 'ok', at: 2 }]);
  });

  test('an empty list clears the previous page', () => {
    ingestPageErrors([{ message: 'old', at: 1 }]);
    ingestPageErrors([]);
    expect(pageErrors.value).toEqual([]);
  });
});
