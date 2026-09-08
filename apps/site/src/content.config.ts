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

/**
 * Shipped releases, one file per public version. The extension's version is the
 * product's public version number, so `version` here must match the value in
 * apps/extension/package.json for that release.
 *
 * The filename is the URL slug, as in every other collection: `v0-5-0.md` serves
 * `/changelog/v0-5-0`. Dots are avoided in the path segment because the asset
 * server treats a trailing `.0` as a file extension.
 *
 * These notes cover the TOOL only: what an annotator, a reviewer or an agent
 * can now do that they could not before. Infrastructure, refactors, CI, the
 * marketing site and internal plumbing are deliberately absent — a changelog
 * that lists a build-system change alongside a new drawing tool teaches a reader
 * to stop reading it.
 *
 * Every change is one entry in a single ordered `changes` list rather than three
 * separate arrays: the file then reads in the order the notes were written, and
 * the template does the grouping. `text` is required on all three kinds - a
 * release note that names a thing without saying what it does for you is a
 * commit subject, not a release note.
 */
const releases = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/releases' }),
  schema: z.object({
    /** Dotted semver, e.g. "0.5.0". The slug is the filename (`v0-5-0`). */
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be a dotted semver, e.g. 0.5.0'),
    /** The release's name. Used as the h1 and as the hub's linked heading. */
    name: z.string(),
    date: isoDate,
    title: z.string(),
    description: z.string(),
    /** One or two sentences. The lede on the release page and the blurb on the hub. */
    summary: z.string(),
    changes: z
      .array(
        z.object({
          kind: z.enum(['new', 'improved', 'fixed']),
          title: z.string(),
          text: z.string(),
        }),
      )
      .min(1),
  }),
});

export const collections = { compare, alternatives, useCases, guides, releases };
