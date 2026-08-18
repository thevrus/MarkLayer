import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * YAML turns an unquoted `2026-02-22` into a Date but a quoted `"2026-02-22"`
 * into a string. Accept both so hand-edited frontmatter cannot silently change
 * a page's `datePublished`, and normalise to a plain ISO day.
 */
const isoDate = z
  .union([z.string(), z.date()])
  .transform((value) => (typeof value === 'string' ? value : value.toISOString().slice(0, 10)));

const faq = z.array(z.object({ q: z.string(), a: z.string() }));

/**
 * Alternatives can point at an external product or back at one of our own
 * comparison pages, so both absolute URLs and root-relative paths are valid —
 * but a bare `markup.io` or a typo'd `htps://` is not.
 */
const href = z
  .string()
  .refine(
    (v) => v.startsWith('/') || /^https?:\/\//.test(v),
    'Must be an absolute http(s) URL or a root-relative path',
  );

/** Fields every article-shaped page shares. */
const articleBase = {
  /**
   * Position in the hub listings and in "related" grids. Editorial, not
   * alphabetical — the flagship comparison leads. Lower sorts first.
   */
  order: z.number().int(),
  title: z.string(),
  description: z.string(),
  bottomLine: z.string(),
  published: isoDate,
  modified: isoDate,
  faq,
};

const compare = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/compare' }),
  schema: z.object({
    ...articleBase,
    competitor: z.string(),
    competitorTagline: z.string(),
    homepage: z.url().optional(),
    quote: z.string().optional(),
    rows: z.array(z.object({ feature: z.string(), ml: z.string(), them: z.string() })),
    chooseMl: z.array(z.string()),
    chooseThem: z.array(z.string()),
  }),
});

const alternatives = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/alternatives' }),
  schema: z.object({
    ...articleBase,
    target: z.string(),
    homepage: z.url().optional(),
    /** One-liner for the /alternatives hub, so the hub does not duplicate this page's intro. */
    hubBlurb: z.string().optional(),
    options: z.array(z.object({ name: z.string(), url: href.optional(), pitch: z.string(), bestFor: z.string() })),
  }),
});

const useCases = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/use-cases' }),
  schema: z.object({
    ...articleBase,
    h1: z.string(),
    audience: z.string(),
    problem: z.string(),
    why: z.array(z.string()),
    steps: z.array(z.object({ name: z.string(), text: z.string() })),
  }),
});

/**
 * Long-form editorial pages that don't fit the compare/alternatives/use-case
 * molds: roundups, pricing explainers, category guides. The body markdown IS
 * the article; `intro` is the styled lead paragraph above it.
 */
const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    ...articleBase,
    h1: z.string(),
    intro: z.string(),
  }),
});

export const collections = { compare, alternatives, useCases, guides };
