import { AUTHOR_EMAIL, AUTHOR_NAME, OG_IMAGE, ORIGIN } from './site';

export type Crumb = { name: string; path?: string };
export type QA = { q: string; a: string };

const AUTHOR = {
  '@type': 'Person',
  name: AUTHOR_NAME,
  url: `${ORIGIN}/about`,
  sameAs: ['https://github.com/thevrus'],
} as const;

export function articleSchema(p: {
  h1: string;
  description: string;
  path: string;
  published: string;
  modified: string;
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: p.h1,
    description: p.description,
    datePublished: p.published,
    dateModified: p.modified,
    author: AUTHOR,
    publisher: {
      '@type': 'Organization',
      name: 'MarkLayer',
      logo: { '@type': 'ImageObject', url: `${ORIGIN}/favicon.svg` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${ORIGIN}${p.path}` },
    image: { '@type': 'ImageObject', url: OG_IMAGE },
  };
}

// A FAQPage with an empty mainEntity fails validation outright — guard it here
// instead of trusting every call site to only pass non-empty content.
export function faqSchema(qa: QA[]): object | null {
  if (qa.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export function breadcrumbSchema(items: Crumb[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => {
      const entry: Record<string, unknown> = { '@type': 'ListItem', position: i + 1, name: it.name };
      if (it.path) entry.item = `${ORIGIN}${it.path}`;
      return entry;
    }),
  };
}

export function howToSchema(p: {
  name: string;
  description: string;
  steps: { name: string; text: string }[];
}): object | null {
  if (p.steps.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: p.name,
    description: p.description,
    step: p.steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

// Expanding `sameAs` with verified profile URLs (LinkedIn, X, Bluesky, personal
// site) strengthens the entity-graph signal Quality Raters look for. A Person
// with a single sameAs link reads as thinly substantiated.
export const PERSON_SCHEMA = {
  '@context': 'https://schema.org',
  ...AUTHOR,
  jobTitle: 'Software engineer',
  email: AUTHOR_EMAIL,
  knowsAbout: [
    'Web annotation tools',
    'Browser extension development',
    'Chrome extensions (Manifest V3)',
    'Cloudflare Workers',
    'Cloudflare Durable Objects',
    'Real-time collaboration',
    'Preact',
    'WebSockets',
  ],
  worksFor: { '@type': 'Organization', name: 'MarkLayer', url: ORIGIN },
};

/**
 * A release page describes a version of the product, not just an article about
 * one. `SoftwareApplication` with `softwareVersion` and `releaseNotes` is the
 * type search engines and assistants read to answer "what's new in MarkLayer" —
 * the Article schema alongside it carries the authorship and the dates.
 *
 * `offers` is a real zero-price offer, not a formality: MarkLayer has no paid
 * plan, and stating the price as 0 is what keeps a "free" claim substantiated.
 */
export function softwareReleaseSchema(p: {
  version: string;
  name: string;
  summary: string;
  path: string;
  date: string;
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `MarkLayer ${p.version}`,
    alternateName: p.name,
    applicationCategory: 'BrowserApplication',
    operatingSystem: 'Chrome, Firefox, Edge, Brave',
    softwareVersion: p.version,
    releaseNotes: `${ORIGIN}${p.path}`,
    datePublished: p.date,
    description: p.summary,
    url: ORIGIN,
    image: { '@type': 'ImageObject', url: OG_IMAGE },
    author: AUTHOR,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}
