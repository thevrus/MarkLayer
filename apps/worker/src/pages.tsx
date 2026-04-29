/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { Fragment } from 'hono/jsx';
import type { JSX } from 'hono/jsx/jsx-runtime';
import seoCss from '../web/seo.css?inline';

// ─── Constants ───────────────────────────────────────────────────────────────

export const ORIGIN = 'https://marklayer.app';
export const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc';
export const OG_IMAGE = `${ORIGIN}/og.jpg`;
export const LAST_UPDATED = 'April 2026';
const COPYRIGHT_YEAR = new Date().getFullYear();

export function renderHtml(node: JSX.Element): string {
  return `<!DOCTYPE html>${node}`;
}

// ─── Schema helpers ───────────────────────────────────────────────────────────

const AUTHOR = {
  '@type': 'Person',
  name: 'Vadym Rusin',
  url: 'https://github.com/thevrus',
  sameAs: ['https://github.com/thevrus'],
} as const;

export function articleSchema(p: { h1: string; description: string; path: string }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: p.h1,
    description: p.description,
    datePublished: '2026-04-01',
    dateModified: '2026-04-28',
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

export function faqSchema(qa: { q: string; a: string }[]): object {
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

export function breadcrumbSchema(items: { name: string; path?: string }[]): object {
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

// ─── Shared components ────────────────────────────────────────────────────────

function Head({
  title,
  description,
  canonical,
  ogType = 'article',
  extraLinks = [],
  schema = [],
}: {
  title: string;
  description: string;
  canonical: string;
  ogType?: string;
  extraLinks?: JSX.Element[];
  schema?: object[];
}) {
  return (
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:site_name" content="MarkLayer" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={OG_IMAGE} />
      <meta name="robots" content="max-image-preview:large, max-snippet:-1" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM-readable summary" />
      {extraLinks}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: seoCss }} />
      {schema.map((s) => (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(s) }} />
      ))}
    </head>
  );
}

function SiteFooter({ showPricing = true }: { showPricing?: boolean }) {
  return (
    <footer>
      <nav>
        <a href="/">Home</a>
        {showPricing && <a href="/pricing">Pricing</a>}
        <a href="/privacy">Privacy</a>
        <a href="https://github.com/thevrus/MarkLayer">GitHub</a>
      </nav>
      <p>
        &copy; {COPYRIGHT_YEAR} MarkLayer · Free webpage annotation tool ·{' '}
        <a href={CHROME_STORE_URL}>Chrome Web Store</a>
      </p>
    </footer>
  );
}

type Crumb = { name: string; path?: string };

function ArticlePage({
  title,
  description,
  path,
  h1,
  intro,
  bottomLine,
  breadcrumbs,
  schema,
  extraLinks,
  children,
}: {
  title: string;
  description: string;
  path: string;
  h1: string;
  intro: Child;
  bottomLine?: string;
  breadcrumbs?: Crumb[];
  schema?: object[];
  extraLinks?: JSX.Element[];
  children: Child;
}) {
  const crumbs: Crumb[] = breadcrumbs ?? [{ name: 'MarkLayer', path: '/' }, { name: h1 }];
  const allSchema: object[] = [...(schema ?? []), breadcrumbSchema(crumbs)];
  return (
    <html lang="en">
      <Head
        title={title}
        description={description}
        canonical={`${ORIGIN}${path}`}
        schema={allSchema}
        extraLinks={extraLinks}
      />
      <body>
        <nav class="mb-6 text-sm text-[#6b7280] [&_a]:text-[#6b7280]" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <Fragment>
              {i > 0 && '  ›  '}
              {c.path ? <a href={c.path}>{c.name}</a> : <span>{c.name}</span>}
            </Fragment>
          ))}
        </nav>
        <h1>{h1}</h1>
        <p class="mb-6 text-sm text-[#6b7280] [&_a]:text-[#6b7280] [&_a]:underline">
          By <a href="/about">Vadym Rusin</a> · Last updated: {LAST_UPDATED}
        </p>
        {bottomLine && (
          <p class="my-6 rounded-lg border-l-4 border-[#2563eb] bg-[#eff6ff] px-4 py-3 text-[15px] leading-relaxed text-[#1e3a8a]">
            <strong>Bottom line:</strong> {bottomLine}
          </p>
        )}
        <p class="mt-0 mb-8 text-lg text-[#374151]">{intro}</p>
        {children}
        <h2>Try MarkLayer</h2>
        <p>
          MarkLayer is free, requires no sign-up, and works on any webpage. Recipients of your share links don't need to
          install anything.
        </p>
        <a
          class="my-6 inline-block rounded-lg bg-[#111827] px-5 py-3 font-semibold text-white no-underline hover:bg-black hover:text-white hover:no-underline"
          href={CHROME_STORE_URL}
        >
          Add to Chrome · It's Free
        </a>
        <SiteFooter />
      </body>
    </html>
  );
}

function FAQ({ qa }: { qa: { q: string; a: string }[] }) {
  return (
    <>
      <h2>Frequently asked questions</h2>
      <dl>
        {qa.map((x) => (
          <Fragment>
            <dt>{x.q}</dt>
            <dd>{x.a}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}

function Related({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <>
      <h2>{title}</h2>
      <div class="my-6 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        {links.map((l) => (
          <a
            class="block rounded-lg border border-[#e5e7eb] bg-white px-4 py-3.5 font-medium text-[#111827] no-underline hover:border-[#111827] hover:no-underline"
            href={l.href}
          >
            {l.label}
          </a>
        ))}
      </div>
    </>
  );
}

// ─── Comparison pages ─────────────────────────────────────────────────────────

export type ComparisonRow = { feature: string; ml: string; them: string };
export type Comparison = {
  slug: string;
  competitor: string;
  competitorTagline: string;
  homepage?: string;
  intro: string;
  bottomLine: string;
  rows: ComparisonRow[];
  chooseMl: string[];
  chooseThem: string[];
  faq: { q: string; a: string }[];
};

function linkifyFirst(text: string, term: string, href?: string): Child {
  if (!href) return text;
  const idx = text.indexOf(term);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <a href={href} rel="noopener noreferrer" target="_blank">
        {term}
      </a>
      {text.slice(idx + term.length)}
    </>
  );
}

export function renderComparison(
  c: Comparison,
  all: Comparison[],
  crossLink?: { href: string; label: string },
): string {
  const path = `/vs/${c.slug}`;
  const title = `MarkLayer vs ${c.competitor}: Free Annotation Tool Compared (2026)`;
  const description = `Side-by-side comparison of MarkLayer and ${c.competitor}. Pricing, features, real-time collaboration, and when to choose each. Updated ${LAST_UPDATED}.`;
  const h1 = `MarkLayer vs ${c.competitor}`;
  const related = [
    ...(crossLink ? [crossLink] : []),
    ...all
      .filter((x) => x.slug !== c.slug)
      .map((x) => ({ href: `/vs/${x.slug}`, label: `MarkLayer vs ${x.competitor}` })),
  ];
  const breadcrumbs: Crumb[] = [
    { name: 'MarkLayer', path: '/' },
    { name: 'Comparisons', path: '/compare' },
    { name: h1 },
  ];

  return renderHtml(
    <ArticlePage
      title={title}
      description={description}
      path={path}
      h1={h1}
      intro={linkifyFirst(c.intro, c.competitor, c.homepage)}
      bottomLine={c.bottomLine}
      breadcrumbs={breadcrumbs}
      schema={[articleSchema({ h1, description, path }), faqSchema(c.faq)]}
    >
      <h2>At a glance</h2>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>MarkLayer</th>
            <th>{c.competitor}</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r) => (
            <tr>
              <td>
                <strong>{r.feature}</strong>
              </td>
              <td>{r.ml}</td>
              <td>{r.them}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>About {c.competitor}</h2>
      <p>
        {c.homepage ? (
          <a href={c.homepage} rel="noopener noreferrer" target="_blank">
            {c.competitor}
          </a>
        ) : (
          c.competitor
        )}{' '}
        is {c.competitorTagline}.
      </p>
      <h2>About MarkLayer</h2>
      <p>
        MarkLayer is a free, open-source Chrome extension that lets you annotate any live webpage with drawings,
        comments, arrows, and highlights, then share a single link so anyone can view the annotations without installing
        anything. There is no account, no paywall, and no trial period.
      </p>
      <h2>When to choose MarkLayer</h2>
      <ul>
        {c.chooseMl.map((x) => (
          <li>{x}</li>
        ))}
      </ul>
      <h2>When to choose {c.competitor}</h2>
      <ul>
        {c.chooseThem.map((x) => (
          <li>{x}</li>
        ))}
      </ul>
      <FAQ qa={c.faq} />
      <Related title="Related comparisons" links={related} />
    </ArticlePage>,
  );
}

// ─── Alternatives pages ───────────────────────────────────────────────────────

export type AlternativeEntry = { name: string; url?: string; pitch: string; bestFor: string };
export type Alternatives = {
  slug: string;
  target: string;
  homepage?: string;
  intro: string;
  bottomLine: string;
  options: AlternativeEntry[];
  faq: { q: string; a: string }[];
};

export function renderAlternatives(
  a: Alternatives,
  all: Alternatives[],
  crossLink?: { href: string; label: string },
): string {
  const path = `/alternatives/${a.slug}`;
  const title = `Free ${a.target} Alternatives: ${LAST_UPDATED} Comparison`;
  const description = `The best free and open-source ${a.target} alternatives in 2026. Compare features, pricing, and workflow trade-offs. Updated ${LAST_UPDATED}.`;
  const h1 = `Free ${a.target} Alternatives`;
  const related = [
    ...(crossLink ? [crossLink] : []),
    ...all
      .filter((x) => x.slug !== a.slug)
      .map((x) => ({ href: `/alternatives/${x.slug}`, label: `Free ${x.target} alternatives` })),
  ];
  const breadcrumbs: Crumb[] = [
    { name: 'MarkLayer', path: '/' },
    { name: 'Alternatives', path: '/alternatives' },
    { name: h1 },
  ];

  return renderHtml(
    <ArticlePage
      title={title}
      description={description}
      path={path}
      h1={h1}
      intro={linkifyFirst(a.intro, a.target, a.homepage)}
      bottomLine={a.bottomLine}
      breadcrumbs={breadcrumbs}
      schema={[articleSchema({ h1, description, path }), faqSchema(a.faq)]}
    >
      <h2>Top free {a.target} alternatives</h2>
      {a.options.map((o, i) => (
        <Fragment>
          <h3>
            {i + 1}. {o.url ? <a href={o.url}>{o.name}</a> : o.name}
          </h3>
          <p>{o.pitch}</p>
          <p>
            <strong>Best for:</strong> {o.bestFor}
          </p>
        </Fragment>
      ))}
      <FAQ qa={a.faq} />
      <Related title="Related comparisons" links={related} />
    </ArticlePage>,
  );
}

// ─── Use-case pages ───────────────────────────────────────────────────────────

export type UseCase = {
  slug: string;
  audience: string;
  title: string;
  h1: string;
  intro: string;
  bottomLine: string;
  problem: string;
  why: string[];
  steps: { name: string; text: string }[];
  faq: { q: string; a: string }[];
};

export function renderUseCase(u: UseCase, all: UseCase[]): string {
  const path = `/for/${u.slug}`;
  const related = all.filter((x) => x.slug !== u.slug).map((x) => ({ href: `/for/${x.slug}`, label: x.h1 }));
  const breadcrumbs: Crumb[] = [
    { name: 'MarkLayer', path: '/' },
    { name: 'Use cases', path: '/use-cases' },
    { name: u.h1 },
  ];

  return renderHtml(
    <ArticlePage
      title={u.title}
      description={u.intro.slice(0, 160)}
      path={path}
      h1={u.h1}
      intro={u.intro}
      bottomLine={u.bottomLine}
      breadcrumbs={breadcrumbs}
      schema={[articleSchema({ h1: u.h1, description: u.intro.slice(0, 160), path }), faqSchema(u.faq)]}
    >
      <h2>The problem</h2>
      <p>{u.problem}</p>
      <h2>Why MarkLayer fits {u.audience}</h2>
      <ul>
        {u.why.map((x) => (
          <li>{x}</li>
        ))}
      </ul>
      <h2>How it works</h2>
      <ol>
        {u.steps.map((s, i) => (
          <li>
            <strong>
              {i + 1}. {s.name}.
            </strong>{' '}
            {s.text}
          </li>
        ))}
      </ol>
      <FAQ qa={u.faq} />
      <h2>Other use cases</h2>
      <div class="my-6 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        {related.map((r) => (
          <a
            class="block rounded-lg border border-[#e5e7eb] bg-white px-4 py-3.5 font-medium text-[#111827] no-underline hover:border-[#111827] hover:no-underline"
            href={r.href}
          >
            {r.label}
          </a>
        ))}
      </div>
    </ArticlePage>,
  );
}

// ─── Hub index pages ─────────────────────────────────────────────────────────

function HubItem({ href, title, blurb }: { href: string; title: string; blurb: string }) {
  return (
    <Fragment>
      <h3>
        <a href={href}>{title}</a>
      </h3>
      <p>{blurb}</p>
    </Fragment>
  );
}

export function renderCompareHub(comparisons: Comparison[]): string {
  const path = '/compare';
  const title = 'MarkLayer Comparisons: vs Markup.io, Pastel, BugHerd, Hypothesis';
  const description =
    'Side-by-side comparisons of MarkLayer against the leading visual feedback and annotation tools. Pricing, features, and trade-offs.';
  const h1 = 'MarkLayer comparisons';
  const intro =
    'How does MarkLayer compare to other webpage annotation and visual feedback tools? Below are head-to-head breakdowns of the most common alternatives, covering pricing, features, real-time collaboration, and when each tool is the better fit.';

  return renderHtml(
    <ArticlePage
      title={title}
      description={description}
      path={path}
      h1={h1}
      intro={intro}
      breadcrumbs={[{ name: 'MarkLayer', path: '/' }, { name: 'Comparisons' }]}
      schema={[articleSchema({ h1, description, path })]}
    >
      <h2>All comparisons</h2>
      {comparisons.map((c) => (
        <HubItem href={`/vs/${c.slug}`} title={`MarkLayer vs ${c.competitor}`} blurb={c.intro} />
      ))}
    </ArticlePage>,
  );
}

export function renderAlternativesHub(alternatives: Alternatives[]): string {
  const path = '/alternatives';
  const title = 'Free Annotation Tool Alternatives: Markup.io, Pastel, BugHerd';
  const description =
    'Free alternatives to the top paid webpage annotation and visual feedback tools. Compare options, pricing, and workflow trade-offs.';
  const h1 = 'Free annotation tool alternatives';
  const intro =
    'Looking for a free alternative to a paid annotation or visual feedback platform? Below are roundups of the strongest free options for each major tool, ranked by how cleanly they replace the core workflow.';

  return renderHtml(
    <ArticlePage
      title={title}
      description={description}
      path={path}
      h1={h1}
      intro={intro}
      breadcrumbs={[{ name: 'MarkLayer', path: '/' }, { name: 'Alternatives' }]}
      schema={[articleSchema({ h1, description, path })]}
    >
      <h2>Free alternatives by tool</h2>
      {alternatives.map((a) => (
        <HubItem href={`/alternatives/${a.slug}`} title={`Free ${a.target} alternatives`} blurb={a.intro} />
      ))}
    </ArticlePage>,
  );
}

export function renderUseCaseHub(useCases: UseCase[]): string {
  const path = '/use-cases';
  const title = 'MarkLayer Use Cases: Design Review, QA, Client Feedback';
  const description =
    'How teams use MarkLayer for design review, QA bug reporting, client feedback, and remote collaboration. Workflows, examples, and step-by-step guides.';
  const h1 = 'MarkLayer use cases';
  const intro =
    'MarkLayer fits any workflow that involves giving visual feedback on a live webpage. Below are the most common ways teams use it, with step-by-step walkthroughs and trade-offs vs other tools.';

  return renderHtml(
    <ArticlePage
      title={title}
      description={description}
      path={path}
      h1={h1}
      intro={intro}
      breadcrumbs={[{ name: 'MarkLayer', path: '/' }, { name: 'Use cases' }]}
      schema={[articleSchema({ h1, description, path })]}
    >
      <h2>By workflow</h2>
      {useCases.map((u) => (
        <HubItem href={`/for/${u.slug}`} title={u.h1} blurb={u.intro} />
      ))}
    </ArticlePage>,
  );
}

// ─── Pricing page ─────────────────────────────────────────────────────────────

const PRODUCT_SCHEMA = {
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

function PricingPage() {
  return (
    <html lang="en">
      <Head
        title="MarkLayer Pricing: Free, No Tiers, No Paywall"
        description="MarkLayer is completely free. No paid plan, no trial, no per-seat pricing. Open source and self-hostable."
        canonical={`${ORIGIN}/pricing`}
        ogType="website"
        schema={[PRODUCT_SCHEMA]}
        extraLinks={[<link rel="alternate" type="text/markdown" href="/pricing.md" title="Machine-readable pricing" />]}
      />
      <body>
        <nav class="mb-6 text-sm text-[#6b7280] [&_a]:text-[#6b7280]">
          <a href="/">MarkLayer</a>
          {'  ›  '}
          <span>Pricing</span>
        </nav>
        <p class="mt-0 mb-3 text-sm font-semibold tracking-[0.04em] text-[#059669] uppercase">
          No plans · No tiers · No paywall
        </p>
        <h1>MarkLayer is 100% free.</h1>
        <p class="mb-8 text-sm text-[#6b7280] [&_a]:text-[#6b7280] [&_a]:underline">
          By <a href="/about">Vadym Rusin</a> · Last updated: {LAST_UPDATED}
        </p>
        <p class="mt-0 mb-8 text-lg text-[#374151]">
          There is no pricing. MarkLayer is a free app, full stop. No paid plan, no trial, no per-seat fee, no premium
          tier, no usage cap, no upsell. This page exists only to confirm that.
        </p>
        <h2>What you get for $0</h2>
        <table>
          <tbody>
            <tr>
              <td>
                <strong>Price</strong>
              </td>
              <td>$0/month, $0/year, $0/forever</td>
            </tr>
            <tr>
              <td>
                <strong>Annotations</strong>
              </td>
              <td>Unlimited</td>
            </tr>
            <tr>
              <td>
                <strong>Share links</strong>
              </td>
              <td>Unlimited</td>
            </tr>
            <tr>
              <td>
                <strong>Collaborators per session</strong>
              </td>
              <td>Unlimited</td>
            </tr>
            <tr>
              <td>
                <strong>Account / sign-up</strong>
              </td>
              <td>Not required (anonymous)</td>
            </tr>
            <tr>
              <td>
                <strong>Email required</strong>
              </td>
              <td>No</td>
            </tr>
            <tr>
              <td>
                <strong>Credit card required</strong>
              </td>
              <td>No</td>
            </tr>
            <tr>
              <td>
                <strong>Trial period</strong>
              </td>
              <td>N/A (everything is free, forever)</td>
            </tr>
            <tr>
              <td>
                <strong>Self-hosting</strong>
              </td>
              <td>Open source: fork and deploy on your own Cloudflare account</td>
            </tr>
          </tbody>
        </table>
        <h2>Every feature is included</h2>
        <ul>
          <li>Drawing tools: freehand, shapes, arrows, and lines</li>
          <li>Threaded comments pinned to any spot on a page</li>
          <li>Real-time collaboration with live cursors</li>
          <li>Shareable links: recipients don't need the extension or an account</li>
          <li>Works on any website</li>
          <li>Open source and self-hostable</li>
        </ul>
        <h2>
          What does <em>not</em> exist
        </h2>
        <ul>
          <li>No "Pro" tier.</li>
          <li>No "Team" or "Enterprise" plan.</li>
          <li>No per-seat pricing.</li>
          <li>No usage cap or annotation limit.</li>
          <li>No trial period; everything is already free.</li>
          <li>No paywall, ever.</li>
          <li>No "verified" or "premium" account.</li>
          <li>No upsell flow inside the extension.</li>
        </ul>
        <h2>Why is it free?</h2>
        <p>
          MarkLayer exists to make webpage annotation accessible to everyone. Infrastructure runs on Cloudflare's
          low-cost edge services, and the code is open source, so you can audit, fork, or self-host. There is no
          business model on top of users. There is no plan to add one.
        </p>
        <h2>Machine-readable pricing</h2>
        <p>
          For AI agents and automated tools: a structured version of this page is available at{' '}
          <a href="/pricing.md">/pricing.md</a>.
        </p>
        <a
          class="my-6 inline-block rounded-lg bg-[#111827] px-5 py-3 font-semibold text-white no-underline hover:bg-black hover:text-white hover:no-underline"
          href={CHROME_STORE_URL}
        >
          Add to Chrome · It's Free
        </a>
        <SiteFooter showPricing={false} />
      </body>
    </html>
  );
}

export const pricingHtml = renderHtml(<PricingPage />);

// ─── Privacy page ─────────────────────────────────────────────────────────────

function PrivacyPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Privacy Policy · MarkLayer</title>
        <style dangerouslySetInnerHTML={{ __html: seoCss }} />
      </head>
      <body>
        <h1>Privacy Policy</h1>
        <p>
          <strong>Last updated:</strong> March 2026
        </p>
        <h2>What we collect</h2>
        <p>MarkLayer does not collect personal information. No account, email, or sign-up is required.</p>
        <p>
          When you use the annotation tools, a randomly generated display name and cursor color are stored in your
          browser's local storage. These are never sent to our servers except as part of real-time collaboration
          sessions you initiate.
        </p>
        <h2>Annotation data</h2>
        <p>
          Annotations you create (drawings, comments, text) are sent to our server only when you choose to share them.
          Shared annotations are stored temporarily and automatically deleted after their expiration period.
        </p>
        <h2>Page content</h2>
        <p>
          The extension does not read, collect, or transmit the content of any webpage you visit. It only renders its
          own overlay on top of the page.
        </p>
        <h2>Analytics</h2>
        <p>
          Our website (marklayer.app) uses <a href="https://posthog.com">PostHog</a> for basic usage analytics: page
          views, session duration, and session replays, so we can understand how people use the site and improve it. IP
          addresses are anonymized and we do not track individual clicks or form inputs. No analytics are collected by
          the browser extension.
        </p>
        <h2>Third parties</h2>
        <p>
          We use PostHog for analytics as described above. We do not sell, share, or transfer any data to other third
          parties.
        </p>
        <h2>Contact</h2>
        <p>
          Questions? Open an issue on our <a href="https://github.com/thevrus/MarkLayer">GitHub repository</a>.
        </p>
      </body>
    </html>
  );
}

export const privacyHtml = renderHtml(<PrivacyPage />);

// ─── About / author page ─────────────────────────────────────────────────────

const PERSON_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Vadym Rusin',
  url: `${ORIGIN}/about`,
  sameAs: ['https://github.com/thevrus'],
  jobTitle: 'Software engineer',
  knowsAbout: [
    'Web annotation tools',
    'Browser extension development',
    'Cloudflare Workers',
    'Real-time collaboration',
    'Preact',
  ],
  worksFor: { '@type': 'Organization', name: 'MarkLayer' },
};

function AboutPage() {
  const path = '/about';
  const title = 'About the author · MarkLayer';
  const description =
    'MarkLayer is built and maintained by Vadym Rusin. Background, contact, and editorial approach for the MarkLayer site.';
  return (
    <html lang="en">
      <Head
        title={title}
        description={description}
        canonical={`${ORIGIN}${path}`}
        ogType="profile"
        schema={[PERSON_SCHEMA, breadcrumbSchema([{ name: 'MarkLayer', path: '/' }, { name: 'About' }])]}
      />
      <body>
        <nav class="mb-6 text-sm text-[#6b7280] [&_a]:text-[#6b7280]" aria-label="Breadcrumb">
          <a href="/">MarkLayer</a>
          {'  ›  '}
          <span>About</span>
        </nav>
        <h1>About the author</h1>
        <p class="mt-0 mb-8 text-lg text-[#374151]">
          MarkLayer is built and maintained by Vadym Rusin. This page exists so you know who is behind the comparisons,
          alternatives, and use-case guides on this site.
        </p>
        <h2>Vadym Rusin</h2>
        <p>
          I'm a software engineer working primarily on browser extensions, real-time collaboration, and Cloudflare
          Workers. MarkLayer started as a tool I wanted for design review and visual feedback on live pages. The full
          source is on <a href="https://github.com/thevrus/MarkLayer">GitHub</a> if you'd like to read or fork it.
        </p>
        <h2>Editorial approach</h2>
        <p>
          Comparison and alternatives pages on this site are written from hands-on use, public documentation, and
          competitor pricing pages at the time of last review. When MarkLayer is genuinely the wrong fit for a workflow,
          the relevant page says so and points to a better tool. Pricing and feature claims about other products are
          dated to the last time they were checked, listed at the top of every article.
        </p>
        <h2>Contact</h2>
        <p>
          The fastest way to reach me is by opening an issue on{' '}
          <a href="https://github.com/thevrus/MarkLayer/issues">GitHub</a>. Corrections to anything stated about another
          product are welcome and get fixed quickly.
        </p>
        <SiteFooter />
      </body>
    </html>
  );
}

export const aboutHtml = renderHtml(<AboutPage />);
