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
    image: OG_IMAGE,
  };
}

export function faqSchema(qa: QA[]): object {
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

export function howToSchema(p: { name: string; description: string; steps: { name: string; text: string }[] }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: p.name,
    description: p.description,
    totalTime: 'PT2M',
    step: p.steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

export const PRODUCT_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'MarkLayer',
  description:
    'Free Chrome extension to annotate any webpage with drawings, comments, arrows, and highlights. Share via link with no install required for viewers.',
  brand: { '@type': 'Brand', name: 'MarkLayer' },
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
    url: `${ORIGIN}/pricing`,
  },
};

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
