import type { Hono } from 'hono';
import type { Env } from './index';
import {
  type Alternatives,
  type Comparison,
  deriveDates,
  formatLastUpdated,
  pricingHtml,
  renderAlternatives,
  renderAlternativesHub,
  renderCompareHub,
  renderComparison,
  renderUseCase,
  renderUseCaseHub,
  type UseCase,
} from './pages';

const LAST_UPDATED = formatLastUpdated(deriveDates('pricing').modified);

// ─────────────────────────────────────────────────────────────────────────────
// COMPARISON PAGES, "MarkLayer vs X"
// ─────────────────────────────────────────────────────────────────────────────

const COMPARISONS: Comparison[] = [
  {
    slug: 'markup-io',
    competitor: 'Markup.io',
    competitorTagline: 'a project-based feedback tool from Pastel for reviewing live websites and PDFs',
    homepage: 'https://markup.io',
    intro:
      'MarkLayer and Markup.io are both visual feedback tools for live websites. The core difference: MarkLayer is a free Chrome extension with no sign-up and works on any page in real time, while Markup.io is a web app that organizes feedback into project-based reviews tied to a team account.',
    bottomLine:
      'Choose MarkLayer for fast, sign-up-free visual feedback on any live page with real-time live cursors. Choose Markup.io if you need persistent project workspaces, version tracking, and a team account tied to client deliverables.',
    rows: [
      { feature: 'Price', ml: 'Free, no tiers, no paywall', them: 'Free tier with limits; paid plans for teams' },
      { feature: 'Sign-up required', ml: 'No', them: 'Yes' },
      {
        feature: 'Works on live websites',
        ml: 'Yes. Annotate the actual live page',
        them: 'Yes. Imports URL into a project',
      },
      { feature: 'Real-time live cursors', ml: 'Yes', them: 'No (comment-based)' },
      {
        feature: 'Drawing tools',
        ml: 'Freehand, shapes, arrows, lines',
        them: 'Limited drawing; primarily pin comments',
      },
      {
        feature: 'Recipient install',
        ml: 'Not required. Share link opens in browser',
        them: 'Not required. Link-based reviewing',
      },
      { feature: 'Open source', ml: 'Yes', them: 'No' },
      { feature: 'Browser', ml: 'Chrome / Chromium', them: 'Web app (no extension required)' },
      {
        feature: 'Best for',
        ml: 'Quick visual feedback on any page',
        them: 'Agency project reviews with version tracking',
      },
    ],
    chooseMl: [
      'You want to mark up live, dynamic web pages without signing up.',
      'You need real-time collaboration with live cursors.',
      'You value open source and want to self-host or audit the code.',
      'You want zero friction. Install once, share a link, done.',
    ],
    chooseThem: [
      'You need persistent project history tied to a team account.',
      'You review static deliverables (PDFs, design files) alongside web pages.',
      'You need agency-grade workflow: project status, approvals, version tracking.',
      'You want integrations with project management tools.',
    ],
    faq: [
      {
        q: 'Is MarkLayer a Markup.io alternative?',
        a: 'Yes. MarkLayer covers the core Markup.io use case (visual feedback on live websites) for free with no sign-up. It does not replace Markup.io for teams that need project-level workflow tooling.',
      },
      {
        q: 'Can I use both?',
        a: 'Yes. Many teams use MarkLayer for ad-hoc feedback and Markup.io for tracked client review cycles. They overlap but serve different stages of feedback workflow.',
      },
      {
        q: 'Does MarkLayer have a free tier or is it fully free?',
        a: 'MarkLayer is fully free with no tiers. There is no paid plan, trial period, or credit-card requirement.',
      },
      {
        q: 'Do recipients need to install MarkLayer to view annotations?',
        a: 'No. Share links open the annotated page in any browser. The Chrome extension is only required to create annotations, not to view them.',
      },
    ],
  },
  {
    slug: 'pastel',
    competitor: 'Pastel',
    competitorTagline: 'a paid visual feedback platform built for design agencies and client review workflows',
    intro:
      'MarkLayer and Pastel both let you annotate live websites and share feedback via a link. The trade-off: Pastel is a polished, paid platform optimized for agency-client workflows; MarkLayer is a free, open-source Chrome extension built for fast, sign-up-free visual feedback.',
    bottomLine:
      'Choose MarkLayer if you want unlimited free visual feedback with no account and open-source code you can self-host. Choose Pastel if you run an agency that needs branded review canvases, integrations with Slack/Trello/Asana/Jira, and a paid SaaS workflow.',
    rows: [
      { feature: 'Price', ml: 'Free, no tiers', them: 'Paid (subscription) with free trial' },
      { feature: 'Sign-up required', ml: 'No', them: 'Yes' },
      { feature: 'Works on live websites', ml: 'Yes', them: 'Yes' },
      { feature: 'Real-time live cursors', ml: 'Yes', them: 'Yes' },
      { feature: 'Drawing tools', ml: 'Freehand, shapes, arrows, lines', them: 'Pin comments + draw tools' },
      { feature: 'Recipient install', ml: 'Not required', them: 'Not required' },
      {
        feature: 'Project workspaces',
        ml: 'No. Link-based, ephemeral',
        them: 'Yes. Persistent canvases per project',
      },
      { feature: 'Integrations', ml: 'Open source. Extend yourself', them: 'Slack, Trello, Asana, Jira, Zapier' },
      { feature: 'Open source', ml: 'Yes', them: 'No' },
      { feature: 'Best for', ml: 'Lightweight, friction-free feedback', them: 'Agencies running client review cycles' },
    ],
    chooseMl: [
      'You want zero cost and zero sign-up friction.',
      'You need ad-hoc feedback, not a persistent project workspace.',
      'You prefer open source.',
      'You collaborate occasionally rather than running a continuous review pipeline.',
    ],
    chooseThem: [
      'You run an agency or studio with recurring client review cycles.',
      'You need persistent project canvases, version history, and approvals.',
      'You depend on Slack, Trello, or Jira integrations to feed feedback into your stack.',
      'You need brand-customized share pages for client-facing reviews.',
    ],
    faq: [
      {
        q: 'Is MarkLayer a free Pastel alternative?',
        a: "Yes. MarkLayer covers the core visual-feedback use case for free, with no sign-up and no project limits. It does not replicate Pastel's agency workflow features.",
      },
      {
        q: 'Does MarkLayer support real-time collaboration like Pastel?',
        a: 'Yes. MarkLayer has live cursors and instant annotation sync via WebSockets, the same way Pastel does.',
      },
      {
        q: 'Can I switch from Pastel to MarkLayer?',
        a: "If your team uses Pastel only for ad-hoc visual comments, MarkLayer is a drop-in replacement. If you depend on Pastel's project workspaces or integrations, you'll lose those.",
      },
      {
        q: 'Is MarkLayer self-hostable?',
        a: 'Yes. MarkLayer is open source and runs on Cloudflare Workers, D1, and Durable Objects. You can fork the repo and deploy your own instance.',
      },
    ],
  },
  {
    slug: 'bugherd',
    competitor: 'BugHerd',
    competitorTagline: 'a paid visual bug tracker that turns annotations into a Kanban-style task board',
    homepage: 'https://bugherd.com',
    intro:
      'MarkLayer and BugHerd both let you annotate web pages with arrows and comments. The difference: BugHerd is a full visual bug-tracking platform with project management, integrations, and team workflows. MarkLayer is a free, lightweight annotation tool focused on quick visual feedback. No Kanban board, no integrations, no account.',
    bottomLine:
      'Choose MarkLayer for free, fast visual feedback you paste into the tracker you already use. Choose BugHerd if you need a built-in Kanban board, automatic browser/OS/console capture, and native Jira/GitHub/Trello sync, and you have budget for a paid bug-tracking platform.',
    rows: [
      { feature: 'Price', ml: 'Free', them: 'Paid (subscription per user)' },
      { feature: 'Sign-up required', ml: 'No', them: 'Yes' },
      { feature: 'Visual annotation on live pages', ml: 'Yes', them: 'Yes' },
      { feature: 'Drawing tools', ml: 'Freehand, shapes, arrows, lines', them: 'Pin comments only' },
      { feature: 'Real-time live cursors', ml: 'Yes', them: 'No' },
      { feature: 'Kanban task board', ml: 'No', them: 'Yes' },
      {
        feature: 'Integrations',
        ml: 'None (open source. Build your own)',
        them: 'Jira, Trello, GitHub, Asana, Slack, Zapier',
      },
      { feature: 'Browser metadata capture', ml: 'No', them: 'Yes. Captures browser, OS, viewport, console errors' },
      { feature: 'Open source', ml: 'Yes', them: 'No' },
      { feature: 'Best for', ml: 'Lightweight feedback', them: 'Full bug-tracking workflow' },
    ],
    chooseMl: [
      'You only need visual feedback, not a full bug-tracking system.',
      'Cost is a constraint or you want zero billing setup.',
      'You want freehand drawing tools, not just pinned comments.',
      'You want real-time collaboration with live cursors.',
    ],
    chooseThem: [
      'You need a structured Kanban board to triage and assign bugs.',
      'You need automatic capture of browser, OS, viewport, and console errors per report.',
      'You need deep integrations with Jira, GitHub, or Trello.',
      'You manage QA at scale and need user roles, permissions, and reporting.',
    ],
    faq: [
      {
        q: 'Is MarkLayer a free BugHerd alternative?',
        a: 'For lightweight visual feedback, yes. MarkLayer is free and does the annotation part well. For full bug-tracking workflows with task boards and integrations, BugHerd remains the heavier-duty tool.',
      },
      {
        q: 'Can MarkLayer capture browser metadata for bug reports?',
        a: 'Not currently. MarkLayer is focused on visual annotation. If you need automatic capture of browser version, OS, viewport, and console errors, BugHerd or a similar tool is a better fit.',
      },
      {
        q: 'Does MarkLayer integrate with Jira or GitHub?',
        a: 'Not out of the box. MarkLayer is open source. The share link can be pasted into any tracker, but there is no native sync.',
      },
      {
        q: 'Can MarkLayer replace BugHerd for small teams?',
        a: 'For small teams that want fast visual feedback without a Kanban board or paid subscription, MarkLayer is a viable replacement. For teams that already depend on BugHerd integrations, switching means giving those up.',
      },
    ],
  },
  {
    slug: 'annotateweb',
    competitor: 'AnnotateWeb',
    competitorTagline:
      'a free, bookmarklet-based web annotation tool with multi-language support, no extension required',
    intro:
      'MarkLayer and AnnotateWeb both let you annotate any webpage for free with no sign-up. The difference is delivery and depth: AnnotateWeb runs as a bookmarklet/web app and is translated into 8 languages, while MarkLayer is a Chrome Web Store extension with threaded comments, multi-page projects, real-time live cursors, longer retention, and an open-source codebase you can self-host.',
    bottomLine:
      "Choose MarkLayer if you want a Chrome Web Store extension with threaded comments, multi-page annotation projects, persistent (90-day) share links, and an open-source codebase. Choose AnnotateWeb if you don't want any browser extension, prefer a bookmarklet, or need an interface translated into Chinese, German, Spanish, Hindi, Japanese, Dutch, or Portuguese.",
    rows: [
      { feature: 'Price', ml: 'Free, no tiers, no paywall', them: 'Free, no tiers' },
      { feature: 'Sign-up required', ml: 'No', them: 'No' },
      { feature: 'Delivery', ml: 'Chrome Web Store extension', them: 'Bookmarklet / web app. No extension' },
      { feature: 'Drawing tools', ml: 'Freehand, shapes, arrows, lines', them: 'Lines, circles, squares, highlighter' },
      {
        feature: 'Threaded comments',
        ml: 'Yes. Pin comments anywhere with replies',
        them: 'Text annotations, no thread structure documented',
      },
      {
        feature: 'Real-time live cursors',
        ml: 'Yes. Named cursors via WebSockets',
        them: 'Yes. Real-time collaboration',
      },
      {
        feature: 'Multi-page projects',
        ml: 'Yes. Bundle multiple pages in one share',
        them: 'Single page per session',
      },
      {
        feature: 'Retention of shared annotations',
        ml: '90 days from last access',
        them: 'Deleted after 2 minutes of inactivity',
      },
      { feature: 'PNG export', ml: 'No. Share via link', them: 'Yes. Visible area or full page' },
      { feature: 'Open source', ml: 'Yes. Self-hostable on Cloudflare', them: 'Closed source' },
      { feature: 'Languages', ml: 'English', them: '8 languages (EN, 中文, DE, ES, हिं, 日本, NL, PT)' },
      {
        feature: 'Best for',
        ml: 'Persistent visual feedback workflows on any page',
        them: 'One-shot ad-hoc annotation in your native language',
      },
    ],
    chooseMl: [
      'You want annotations to persist long enough to fit into a real review cycle (90 days, not 2 minutes).',
      'You need threaded comments and multi-page projects, not just a single annotated screenshot.',
      'You value being installed from the Chrome Web Store (more trust signals than a bookmarklet).',
      'You want open source so you can self-host or audit privacy guarantees.',
      'You need real-time live cursors with named participants, not just shared links.',
    ],
    chooseThem: [
      "You can't or won't install a Chrome extension and prefer a bookmarklet.",
      'You need the interface in Chinese, German, Spanish, Hindi, Japanese, Dutch, or Portuguese.',
      'You only need a quick PNG export of one annotated page. Not a persistent review thread.',
      'You want the lowest possible footprint with no extension permissions of any kind.',
    ],
    faq: [
      {
        q: 'Is MarkLayer a free AnnotateWeb alternative?',
        a: 'Yes. Both are free with no sign-up. MarkLayer adds threaded comments, multi-page projects, 90-day retention (vs 2-minute auto-deletion), and an open-source codebase. AnnotateWeb wins on multi-language support and not requiring a browser extension.',
      },
      {
        q: 'Why does MarkLayer use a Chrome extension instead of a bookmarklet?',
        a: 'A Chrome extension allows real-time collaboration with WebSockets, persistent state, threaded comments, and a richer toolbar. Bookmarklets are constrained by what JavaScript can be injected into a single page. The Chrome Web Store also adds review-based trust that bookmarklets lack.',
      },
      {
        q: 'Does MarkLayer support multiple languages like AnnotateWeb?',
        a: 'Currently MarkLayer is English-only. AnnotateWeb supports 8 languages. If you need a non-English interface today, AnnotateWeb is a better fit. MarkLayer i18n is a roadmap consideration.',
      },
      {
        q: 'How long do MarkLayer share links last vs AnnotateWeb?',
        a: 'MarkLayer share links last 90 days from last access. AnnotateWeb sessions delete after 2 minutes of inactivity. If you need annotations that survive a sleep cycle, MarkLayer is the right tool.',
      },
      {
        q: 'Is MarkLayer open source like AnnotateWeb claims to be?',
        a: 'MarkLayer is open source on GitHub and self-hostable on Cloudflare Workers. AnnotateWeb does not appear to publish source code publicly.',
      },
    ],
  },
  {
    slug: 'jam',
    competitor: 'Jam.dev',
    competitorTagline:
      'a paid bug-reporting Chrome extension that auto-captures console logs, network requests, and device metadata for engineering teams',
    homepage: 'https://jam.dev',
    intro:
      'MarkLayer and Jam.dev are both Chrome extensions for the broad category of "feedback on a web page", but they target different jobs. Jam is a developer-focused bug reporter. One click captures the page state plus console errors, network logs, and reproduction steps for engineers. MarkLayer is a free visual annotation tool. Drawings, arrows, threaded comments, live cursors. Built for design review, client feedback, and lightweight QA.',
    bottomLine:
      'Choose MarkLayer for free visual feedback, design review, and any case where the answer to "what changed" is a circle and an arrow. Choose Jam if you need rich engineering bug reports (auto-captured console errors, network traces, and reproduction recordings) and you have budget for a paid developer-tool subscription.',
    rows: [
      { feature: 'Price', ml: 'Free, no tiers, no paywall', them: 'Free tier with limits; paid plans per user' },
      { feature: 'Sign-up required', ml: 'No', them: 'Yes' },
      { feature: 'Primary job', ml: 'Visual annotation and feedback', them: 'Engineering bug reproduction reports' },
      {
        feature: 'Drawing & shapes',
        ml: 'Freehand, shapes, arrows, lines',
        them: 'Limited drawing inside a captured frame',
      },
      { feature: 'Real-time live cursors', ml: 'Yes', them: 'No. Capture-and-share, not collaborative canvas' },
      { feature: 'Console error capture', ml: 'No', them: 'Yes. Automatic' },
      { feature: 'Network request capture', ml: 'No', them: 'Yes. Automatic' },
      { feature: 'Browser/OS metadata', ml: 'No', them: 'Yes. Automatic' },
      { feature: 'Recipient install required', ml: 'No', them: 'No' },
      { feature: 'Open source', ml: 'Yes', them: 'No' },
      { feature: 'Best for', ml: 'Design, QA, and client feedback workflows', them: 'Dev-team bug intake' },
    ],
    chooseMl: [
      'You want free, anonymous visual feedback with no per-user billing.',
      "You're doing design review, content review, or client feedback. Not engineering bug intake.",
      'You need real-time collaboration with live cursors on the live page.',
      'You want open source so you can self-host or contribute.',
    ],
    chooseThem: [
      'Your team triages production bugs and needs console errors, network traces, and repro recordings auto-captured.',
      "You're already on a paid developer-tool stack and Jam plugs into your engineering workflow.",
      'You want one-click bug reports that include everything an engineer needs to debug.',
    ],
    faq: [
      {
        q: 'Is MarkLayer a free Jam.dev alternative?',
        a: "For visual feedback, yes. MarkLayer is free and covers the annotation half. For Jam's signature feature. Auto-capture of console errors, network logs, and reproduction recordings. MarkLayer is not a replacement.",
      },
      {
        q: 'When should I use MarkLayer vs Jam?',
        a: "Use MarkLayer when the bug is visual or you're giving design or content feedback. Use Jam when the bug is logic-level and the engineer needs the JS console state to debug. Many teams use both.",
      },
      {
        q: 'Does MarkLayer capture browser metadata or network logs?',
        a: 'No. MarkLayer is focused on the annotation step. If you need automatic capture of browser, OS, viewport, console errors, or network requests, Jam.dev or BugHerd are heavier-duty fits.',
      },
      {
        q: 'Can clients view MarkLayer annotations without signing up?',
        a: 'Yes. Share links open in any browser with no install or account. Jam shared reports also open without an account but the originator must sign up to create them.',
      },
    ],
  },
  {
    slug: 'marker-io',
    competitor: 'Marker.io',
    competitorTagline:
      'a paid visual bug-reporting platform with deep Jira, GitHub, Trello, Asana, and ClickUp integrations',
    homepage: 'https://marker.io',
    intro:
      'MarkLayer and Marker.io both let you annotate webpages and share feedback. Marker.io is a paid B2B platform: install a website widget or browser extension, and bug reports flow into your existing tracker (Jira, GitHub, Trello, Asana). MarkLayer is a free, lightweight Chrome extension. No integrations, no sign-up. That produces shareable links you paste into whatever tracker you already use.',
    bottomLine:
      'Choose MarkLayer for free, fast visual feedback that you paste into the tracker you already have. Choose Marker.io if you want bug reports to flow automatically into Jira, GitHub, or Trello with browser metadata attached, and your team is on a paid bug-reporting subscription.',
    rows: [
      { feature: 'Price', ml: 'Free', them: 'Paid (subscription per reporter)' },
      { feature: 'Sign-up required', ml: 'No', them: 'Yes' },
      { feature: 'Native Jira integration', ml: 'No. Paste the share link', them: 'Yes. Two-way sync' },
      { feature: 'Native GitHub integration', ml: 'No', them: 'Yes' },
      { feature: 'Native Trello/Asana/ClickUp', ml: 'No', them: 'Yes' },
      { feature: 'Browser metadata capture', ml: 'No', them: 'Yes. Browser, OS, viewport' },
      { feature: 'Console log capture', ml: 'No', them: 'Yes' },
      { feature: 'Real-time live cursors', ml: 'Yes', them: 'No. Report-style, not collaborative canvas' },
      { feature: 'Drawing tools', ml: 'Freehand, shapes, arrows, lines', them: 'Pin comments + draw' },
      { feature: 'Open source', ml: 'Yes', them: 'No' },
      { feature: 'Best for', ml: 'Lightweight visual feedback', them: 'Tracker-integrated QA workflow' },
    ],
    chooseMl: [
      "You want free annotation and you're fine pasting links into your tracker manually.",
      "You don't want yet another paid SaaS subscription per QA reporter.",
      'You need real-time collaborative review with live cursors, not a report-handoff workflow.',
      'You want open source for security or self-hosting reasons.',
    ],
    chooseThem: [
      'You need bug reports to land in Jira, GitHub, Trello, Asana, or ClickUp automatically. Not pasted by hand.',
      'You want browser, OS, viewport, and console errors captured without thinking about it.',
      'You run a QA team where the integration cost is justified by reporter velocity.',
    ],
    faq: [
      {
        q: 'Is MarkLayer a free Marker.io alternative?',
        a: "For the annotation step itself, yes. For Marker.io's tracker integrations and metadata capture, no. Those are the platform's core differentiators and MarkLayer doesn't replicate them.",
      },
      {
        q: 'Can I integrate MarkLayer with Jira like Marker.io?',
        a: "Not natively. MarkLayer is open source, so a webhook-style integration could be built, but there's nothing out of the box. The standard workflow is pasting the share link into a Jira ticket description.",
      },
      {
        q: 'Does MarkLayer capture browser metadata for bug reports?',
        a: 'No. For automatic capture of browser version, OS, viewport, and console errors, Marker.io or BugHerd or Jam are better fits.',
      },
      {
        q: 'When does MarkLayer make more sense than Marker.io?',
        a: "When you want zero billing setup, no per-reporter pricing, and you're already happy pasting links into Jira/Linear/GitHub Issues yourself.",
      },
    ],
  },
  {
    slug: 'userback',
    competitor: 'Userback',
    competitorTagline:
      'a paid feedback platform whose primary use case is collecting feedback FROM your end users via an embedded widget on your own product',
    intro:
      "MarkLayer and Userback look similar but solve different problems. Userback's main mode is a feedback widget you embed on your own product so end users can submit annotated feedback to you. MarkLayer is a Chrome extension your team uses to annotate any webpage (including third-party pages, staging sites, and competitor products) and share the result.",
    bottomLine:
      'Choose MarkLayer when your team needs to give feedback on any webpage, anywhere on the internet. Choose Userback when you need to collect annotated feedback FROM your end users on your own product via an embedded widget.',
    rows: [
      { feature: 'Price', ml: 'Free', them: 'Paid (subscription per user/month)' },
      { feature: 'Sign-up required', ml: 'No', them: 'Yes' },
      {
        feature: 'Primary use case',
        ml: 'Your team annotating any page',
        them: 'End users giving feedback on your own product',
      },
      { feature: 'Embedded widget on your site', ml: 'No', them: 'Yes. JS snippet you install' },
      {
        feature: 'Works on third-party / competitor pages',
        ml: 'Yes. Annotate any page',
        them: 'No. Widget only on your installed sites',
      },
      { feature: 'Browser/OS metadata capture', ml: 'No', them: 'Yes' },
      { feature: 'Integrations', ml: 'None native', them: 'Jira, Slack, Trello, Asana, GitHub' },
      { feature: 'Real-time live cursors', ml: 'Yes', them: 'No' },
      { feature: 'Open source', ml: 'Yes', them: 'No' },
      {
        feature: 'Best for',
        ml: 'Internal team review on any page',
        them: 'Customer feedback widget on your own product',
      },
    ],
    chooseMl: [
      "You want your team to annotate pages. Including pages you don't own.",
      'You need real-time collaborative review with live cursors.',
      'You want a free, no-sign-up tool for ad-hoc visual feedback.',
      "You're not trying to collect feedback from your own end users right now.",
    ],
    chooseThem: [
      'You need a feedback widget embedded on your own production app for end users.',
      'You need user-submitted bug reports with browser/OS metadata attached.',
      'You need feedback to flow into Jira, Slack, Trello, or GitHub automatically.',
      'You want a customer-facing branded feedback experience.',
    ],
    faq: [
      {
        q: 'Is MarkLayer a free Userback alternative?',
        a: "Only for one direction of Userback's use case. Internal team annotation on any page. MarkLayer does not replace Userback's widget for collecting feedback from your end users on your own product.",
      },
      {
        q: 'Can I embed MarkLayer on my website like Userback?',
        a: 'No. MarkLayer is a Chrome extension your team installs, not a JavaScript widget you embed on your site for visitors. If you need a customer-facing feedback widget, Userback is the right category of tool.',
      },
      {
        q: 'Can my team use MarkLayer to review competitor sites?',
        a: 'Yes. MarkLayer works on any webpage, including third-party sites. Many teams use it for competitive analysis and content review.',
      },
      {
        q: "What's the cleanest split between MarkLayer and Userback?",
        a: 'MarkLayer = your team annotating anything on the web. Userback = your end users annotating your product to give you feedback. Different sides of the table.',
      },
    ],
  },
  {
    slug: 'ruttl',
    competitor: 'Ruttl',
    competitorTagline:
      'a paid visual feedback platform with project workspaces, version comparison, and live website edit mode',
    intro:
      'MarkLayer and Ruttl both annotate live websites with comments and drawings. Ruttl adds a project-workspace layer with version history, side-by-side comparison, and a "live edit" mode where reviewers can suggest CSS/text changes inline. MarkLayer is the simpler, free, open-source alternative. Link-based sharing, real-time cursors, no project hierarchy.',
    bottomLine:
      'Choose MarkLayer for free, instant visual feedback with no project setup and no paid tier. Choose Ruttl if you run an agency that needs project workspaces, version comparison, live CSS edit mode, and PDF/static-image annotation alongside web pages.',
    rows: [
      { feature: 'Price', ml: 'Free, no tiers', them: 'Freemium with project limits; paid plans per user' },
      { feature: 'Sign-up required', ml: 'No', them: 'Yes' },
      { feature: 'Real-time live cursors', ml: 'Yes', them: 'Yes' },
      { feature: 'Drawing tools', ml: 'Freehand, shapes, arrows, lines', them: 'Pin comments + draw' },
      { feature: 'Live edit mode (CSS / text)', ml: 'No', them: 'Yes. Reviewers suggest inline changes' },
      { feature: 'Project workspaces', ml: 'No. Link-based', them: 'Yes. Persistent projects with versions' },
      { feature: 'Version comparison', ml: 'No', them: 'Yes' },
      { feature: 'PDF / image annotation', ml: 'No. Web pages only', them: 'Yes' },
      { feature: 'Recipient install required', ml: 'No', them: 'No' },
      { feature: 'Open source', ml: 'Yes', them: 'No' },
      { feature: 'Best for', ml: 'Lightweight, no-setup feedback', them: 'Agency project workflows with versioning' },
    ],
    chooseMl: [
      'You want zero setup and zero billing. Just install, annotate, share.',
      "You don't need project workspaces, version history, or PDF annotation.",
      'You want open source so you can self-host or audit the code.',
      "You're doing ad-hoc feedback, not running a structured agency review pipeline.",
    ],
    chooseThem: [
      'You run an agency or studio with persistent project workspaces and recurring review cycles.',
      'You need version comparison so clients can see what changed between drafts.',
      'You need live CSS / text edit mode for reviewers to propose specific changes.',
      'You annotate PDFs and static images alongside web pages.',
    ],
    faq: [
      {
        q: 'Is MarkLayer a free Ruttl alternative?',
        a: "For the core visual-feedback workflow on live web pages, yes. For Ruttl's project workspaces, version history, and live edit mode, no. Those are paid-tier features MarkLayer intentionally doesn't replicate.",
      },
      {
        q: 'Does MarkLayer support PDFs or static images?',
        a: 'No. MarkLayer is for live web pages. Ruttl supports PDFs and image files alongside web annotations. If you need that mix, Ruttl is the better fit.',
      },
      {
        q: 'Can MarkLayer compare two versions of a page?',
        a: "Not natively. Ruttl has built-in version comparison; MarkLayer is a single-state tool. You'd handle versioning by sharing two separate annotation links, one per version.",
      },
      {
        q: 'Is MarkLayer open source like Ruttl?',
        a: 'MarkLayer is open source on GitHub and self-hostable on Cloudflare Workers. Ruttl is closed-source SaaS.',
      },
    ],
  },
  {
    slug: 'loom',
    competitor: 'Loom',
    competitorTagline:
      'a popular async video tool for screen and webcam recording with viewer reactions and time-stamped comments',
    homepage: 'https://www.loom.com',
    intro:
      "MarkLayer and Loom solve different sides of the same problem: how do I show someone something on a webpage when we're not in the same room? Loom records a video walkthrough with your voice. MarkLayer captures a single annotated state of the page with arrows, comments, and threaded replies. They complement each other more than they compete.",
    bottomLine:
      'Choose MarkLayer when the message is "this specific thing on this page". You want a fast, focused, durable artifact that survives a Loom video\'s 5-minute attention span. Choose Loom when the message is "watch me walk through this flow" and motion or voice tone matters.',
    rows: [
      { feature: 'Price', ml: 'Free, no tiers', them: 'Free tier (5-min limit, 25 videos); paid plans per user' },
      { feature: 'Sign-up required', ml: 'No', them: 'Yes' },
      { feature: 'Format', ml: 'Static annotated page snapshot', them: 'Video recording with voice' },
      { feature: 'Voice / audio', ml: 'No. Text comments only', them: 'Yes' },
      { feature: 'Time-stamped comments', ml: 'No (page is a single state)', them: 'Yes' },
      { feature: 'Real-time live cursors', ml: 'Yes', them: 'No. Async-only' },
      { feature: 'Drawing tools', ml: 'Yes. Freehand, shapes, arrows', them: 'No live drawing on page' },
      {
        feature: 'Threaded replies on the artifact',
        ml: 'Yes. Pinned to the page',
        them: 'Yes. Pinned to video timestamps',
      },
      { feature: 'Time to consume', ml: 'Seconds. Single screen', them: 'Minutes. Must watch the video' },
      {
        feature: 'Best for',
        ml: 'Specific UI changes, bugs, design notes',
        them: 'Walkthroughs, tutorials, async standups',
      },
    ],
    chooseMl: [
      'You want the recipient to see the annotated state in seconds. Not watch a 3-minute video to find the issue.',
      "You're flagging a specific bug, design issue, or content change. Not narrating a flow.",
      'You want free with no per-user fee. Useful for client engagements at scale.',
      'You want the artifact to be live (real page) rather than a recording of a page.',
    ],
    chooseThem: [
      "You're walking someone through a multi-step flow where motion matters.",
      'Voice tone or facial expression carries part of the message.',
      "You're recording a tutorial, async standup, or onboarding walkthrough.",
      'The recipient needs to see the timing of interactions, not just the result.',
    ],
    faq: [
      {
        q: 'Is MarkLayer a free Loom alternative?',
        a: "Only for the subset of cases where a video would be overkill. If you need motion or voice, Loom is the right tool. MarkLayer is the better fit when one annotated screenshot's worth of information replaces a 3-minute video.",
      },
      {
        q: 'Should I use both Loom and MarkLayer?',
        a: 'Many teams do. Loom for walkthroughs and async standups; MarkLayer for specific bug reports, design notes, and visual feedback where text + arrows beat narrated video.',
      },
      {
        q: 'Does MarkLayer support voice or video recording?',
        a: 'No. MarkLayer is text + drawing-based. If you need voice or video, Loom or its alternatives (Tella, Vidyard, Berrycast) are the right category.',
      },
      {
        q: 'Why pick MarkLayer over Loom for bug reports?',
        a: 'A circle on the broken element with two lines of text gets a developer to "I see it" faster than a 90-second video they need to scrub through. For visual or layout bugs, an annotated link wins.',
      },
    ],
  },
  {
    slug: 'hypothesis',
    competitor: 'Hypothesis',
    competitorTagline: 'an open-source web annotation layer focused on text-based annotation for academia and research',
    homepage: 'https://web.hypothes.is',
    intro:
      'MarkLayer and Hypothesis are both free and open source, but they solve different problems. Hypothesis adds a public, W3C-standard text annotation layer to the web. Useful for research, education, and scholarly markup. MarkLayer is a visual annotation tool for drawings, shapes, arrows, and pinned comments. Closer to a digital whiteboard over any webpage.',
    bottomLine:
      'Choose MarkLayer for visual feedback on any webpage. Drawings, arrows, and pinned comments anywhere on the page. Choose Hypothesis if you need a public, W3C-standard text annotation layer for scholarly research, classroom reading groups, or article-level discussion.',
    rows: [
      { feature: 'Price', ml: 'Free', them: 'Free' },
      { feature: 'Open source', ml: 'Yes', them: 'Yes' },
      { feature: 'Text highlighting + notes', ml: 'Yes', them: 'Yes' },
      { feature: 'Drawing & shapes', ml: 'Yes (freehand, shapes, arrows)', them: 'No. Text-only' },
      { feature: 'Pinned comments anywhere', ml: 'Yes. Pin to any pixel', them: 'No. Anchored to text selections' },
      { feature: 'Real-time live cursors', ml: 'Yes', them: 'No' },
      { feature: 'Sign-up required', ml: 'No', them: 'Yes (for sync; anonymous use limited)' },
      { feature: 'Public annotation layer', ml: 'No. Share-by-link only', them: 'Yes. W3C standard, public groups' },
      {
        feature: 'Best for',
        ml: 'Visual feedback on any webpage',
        them: 'Scholarly text annotation, research, teaching',
      },
    ],
    chooseMl: [
      'You need to draw, point at, or visually mark up parts of a page (not just text).',
      'You want real-time collaboration with live cursors.',
      'You want zero sign-up.',
      "You're reviewing UI, design, or visual content rather than scholarly text.",
    ],
    chooseThem: [
      "You're annotating academic papers, articles, or text-heavy content.",
      'You need a public, persistent, W3C-standard annotation layer.',
      "You're building educational workflows where students annotate readings together.",
      'You want annotations that persist on the web outside any single share link.',
    ],
    faq: [
      {
        q: 'Are MarkLayer and Hypothesis competitors?',
        a: 'They overlap on the surface but solve different problems. Hypothesis is built for scholarly text annotation. MarkLayer is built for visual feedback. Drawings, arrows, comments pinned anywhere on a page.',
      },
      {
        q: 'Can I use both?',
        a: "Yes. They don't conflict. You can run Hypothesis for research workflows and MarkLayer for visual UI feedback on the same browser.",
      },
      {
        q: 'Does MarkLayer support text-based annotation like Hypothesis?',
        a: 'MarkLayer supports highlighting text with comments, but its primary strength is visual annotation. Drawings, shapes, and arrows on the page itself.',
      },
      {
        q: "Is MarkLayer's annotation data public like Hypothesis groups?",
        a: 'No. MarkLayer annotations are private until you share the link. There is no public annotation layer or open group system.',
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ALTERNATIVES PAGES, "Free [X] alternatives"
// ─────────────────────────────────────────────────────────────────────────────

const ALTERNATIVES: Alternatives[] = [
  {
    slug: 'markup-io',
    target: 'Markup.io',
    homepage: 'https://markup.io',
    intro:
      'Looking for a free Markup.io alternative? Below are the strongest options as of 2026, ranked by how cleanly they replace the core Markup.io workflow: visual feedback on live websites with link-based sharing.',
    bottomLine:
      'MarkLayer is the closest free, no-sign-up replacement for Markup.io if all you need is visual feedback on live pages. PageProofer, BugHerd, and Pastel are paid options that add agency workflow features. Hypothesis is free but text-only.',
    options: [
      {
        name: 'MarkLayer',
        url: '/',
        pitch:
          "Free, open-source Chrome extension. Annotate any live webpage with drawings, comments, arrows, and highlights. Share via link. Recipients don't need the extension. Real-time live cursors. No account, no paywall, no trial.",
        bestFor: 'Anyone who wants the core Markup.io use case (live webpage feedback) without sign-up or fees.',
      },
      {
        name: 'PageProofer',
        pitch:
          'Visual feedback on staging sites with sticky-note style comments. Has a free trial; paid plans for teams.',
        bestFor: 'Teams already comfortable with a paid SaaS workflow.',
      },
      {
        name: 'BugHerd',
        url: '/vs/bugherd',
        pitch:
          'Visual bug tracker with a Kanban board and integrations into Jira, GitHub, Trello, and Asana. Paid only.',
        bestFor: 'Teams that need full bug-tracking workflow, not just feedback.',
      },
      {
        name: 'Pastel',
        url: '/vs/pastel',
        pitch:
          "Markup.io's sister product. Project-based visual reviews with agency workflow features. Paid with free trial.",
        bestFor: 'Agencies running structured client review cycles.',
      },
      {
        name: 'Hypothesis',
        url: '/vs/hypothesis',
        pitch:
          'Free, open-source text annotation layer. Best for academic and research-style annotation, not visual feedback.',
        bestFor: 'Scholarly or text-heavy annotation, not UI feedback.',
      },
    ],
    faq: [
      {
        q: 'What is the best free Markup.io alternative?',
        a: 'MarkLayer covers the core Markup.io use case (visual feedback on live websites with link-based sharing) for free, with no sign-up. For agency project workflows, paid tools like Pastel or BugHerd remain stronger.',
      },
      {
        q: 'Why might someone leave Markup.io?',
        a: 'Common reasons: cost as the team scales, friction of mandatory sign-ups for clients, or wanting a tool that works on the actual live page instead of an imported snapshot.',
      },
      {
        q: 'Are these tools open source?',
        a: 'MarkLayer and Hypothesis are open source. The others are commercial SaaS products.',
      },
    ],
  },
  {
    slug: 'pastel',
    target: 'Pastel',
    intro:
      'Looking for a free Pastel alternative? Pastel is a polished but paid platform for agency client reviews. Below are the strongest free or freemium options for visual feedback on live websites in 2026.',
    bottomLine:
      'MarkLayer is the only fully free, open-source Pastel alternative. Chrome extension, real-time live cursors, link-based sharing, no account. Markup.io (Pastel’s sister product) has a free tier with limits. PageProofer and BugHerd are paid alternatives.',
    options: [
      {
        name: 'MarkLayer',
        url: '/',
        pitch:
          'Free, open-source Chrome extension. Real-time visual annotation on any live webpage, with live cursors and link-based sharing. No account, no paywall.',
        bestFor: 'Anyone who needs the core Pastel use case for free.',
      },
      {
        name: 'Markup.io',
        url: '/vs/markup-io',
        pitch: "Pastel's own free tier, with project limits. Same parent company.",
        bestFor: 'Teams who like the Pastel ecosystem but want a free entry point.',
      },
      {
        name: 'PageProofer',
        pitch: 'Visual feedback for staging sites. Paid, with a free trial.',
        bestFor: 'Teams comfortable on a paid SaaS plan.',
      },
      {
        name: 'BugHerd',
        url: '/vs/bugherd',
        pitch: 'Visual bug tracker with full workflow tooling. Paid only.',
        bestFor: 'QA-heavy teams who need a Kanban + integrations.',
      },
    ],
    faq: [
      {
        q: 'Is there a free version of Pastel?',
        a: "Pastel offers a free trial but no permanent free tier. Markup.io (Pastel's sister product) has a free tier with project limits. MarkLayer is fully free.",
      },
      {
        q: "What's the best free Pastel alternative?",
        a: "MarkLayer for the visual-feedback core use case. Markup.io if you're comfortable in the same product family. BugHerd if you need full bug-tracking workflow.",
      },
      {
        q: 'Can I self-host a Pastel alternative?',
        a: 'MarkLayer is open source and self-hostable on Cloudflare Workers. Most other options are closed-source SaaS.',
      },
    ],
  },
  {
    slug: 'annotateweb',
    target: 'AnnotateWeb',
    intro:
      'Looking for an AnnotateWeb alternative? AnnotateWeb is already free, so the question is usually: which free webpage annotation tool fits my workflow better. Multi-language and bookmarklet-based (AnnotateWeb), or extension-based with threaded comments and longer retention (MarkLayer)? Below are the strongest options.',
    bottomLine:
      "MarkLayer is the strongest AnnotateWeb alternative if you want threaded comments, multi-page projects, 90-day retention (vs AnnotateWeb's 2-minute cleanup), and an open-source codebase. Hypothesis is best for scholarly text annotation. Markup.io and Pastel are paid options with deeper agency workflow features.",
    options: [
      {
        name: 'MarkLayer',
        url: '/',
        pitch:
          'Free, open-source Chrome extension. Annotate any live webpage with drawings, threaded comments, arrows, and highlights. Real-time live cursors. Multi-page projects. 90-day retention on share links. No account, no paywall.',
        bestFor:
          'Anyone who needs persistent visual feedback workflows. Design review, QA, client feedback, remote teams.',
      },
      {
        name: 'Hypothesis',
        url: '/vs/hypothesis',
        pitch:
          'Free, open-source W3C-standard text annotation layer. Best for scholarly research, academic reading, and teaching. Not a visual annotation tool.',
        bestFor: 'Researchers, students, and educators annotating articles or papers as text.',
      },
      {
        name: 'Markup.io',
        url: '/vs/markup-io',
        pitch:
          'Project-based feedback platform from Pastel. Free tier with project limits; paid plans for teams. Web app, no extension required.',
        bestFor: 'Agencies who want a free entry point into a paid project-workflow ecosystem.',
      },
      {
        name: 'Pastel',
        url: '/vs/pastel',
        pitch:
          'Paid agency-grade visual feedback platform with branded review canvases, version tracking, and Slack/Trello/Asana/Jira integrations.',
        bestFor: 'Agencies running structured client review cycles.',
      },
      {
        name: 'Ruttl',
        url: '/vs/ruttl',
        pitch: 'Freemium visual feedback platform with project workspaces, version comparison, and live CSS edit mode.',
        bestFor: 'Agencies needing version comparison and live edit mode alongside annotation.',
      },
    ],
    faq: [
      {
        q: 'Is MarkLayer a free AnnotateWeb alternative?',
        a: "Yes. Both are free with no sign-up. MarkLayer adds threaded comments, multi-page projects, 90-day retention (vs AnnotateWeb's 2-minute cleanup), and is open source. AnnotateWeb wins on multi-language UI and not requiring a Chrome extension.",
      },
      {
        q: 'Why would someone leave AnnotateWeb?',
        a: 'Common reasons: 2-minute inactivity deletion is too short for real review cycles, lack of threaded comments, no multi-page projects, or wanting a Chrome Web Store-distributed extension instead of a bookmarklet.',
      },
      {
        q: 'Are these tools open source?',
        a: 'MarkLayer and Hypothesis are open source. Markup.io, Pastel, Ruttl, and AnnotateWeb itself are closed-source.',
      },
      {
        q: "Which is the closest match to AnnotateWeb's bookmarklet model?",
        a: "AnnotateWeb's bookmarklet model is unusual. Most alternatives are either Chrome extensions (MarkLayer, Hypothesis) or web apps (Markup.io, Pastel, Ruttl). If extension-free is non-negotiable, AnnotateWeb stays the strongest fit.",
      },
    ],
  },
  {
    slug: 'jam',
    target: 'Jam.dev',
    homepage: 'https://jam.dev',
    intro:
      'Looking for a free Jam.dev alternative? Jam is a paid bug-reporting Chrome extension. Below are the strongest free options for the two halves of what Jam does. Visual annotation, and engineering bug reproduction with metadata capture.',
    bottomLine:
      'MarkLayer is the closest free alternative for the visual-annotation half of Jam. For the engineering-bug-report half (auto-capturing console errors, network logs, and reproduction recordings), there is no fully free open-source equivalent. BugHerd and Marker.io are paid alternatives.',
    options: [
      {
        name: 'MarkLayer',
        url: '/',
        pitch:
          "Free, open-source Chrome extension for visual annotation. Doesn't auto-capture console or network. Focuses on the annotation step. Real-time live cursors. No sign-up.",
        bestFor: 'Visual feedback, design review, lightweight QA where the bug is visible on the page.',
      },
      {
        name: 'BugHerd',
        url: '/vs/bugherd',
        pitch:
          'Paid visual bug tracker with Kanban board, browser metadata capture, and Jira/GitHub/Trello integrations. Heavier-duty than Jam in some ways.',
        bestFor: 'Teams that need full bug-tracking workflow on top of annotation.',
      },
      {
        name: 'Marker.io',
        url: '/vs/marker-io',
        pitch:
          'Paid bug-reporting platform with deep tracker integrations and browser metadata capture. Closer feature parity with Jam than the free options.',
        bestFor: 'Teams that need bug reports flowing into Jira/GitHub automatically.',
      },
      {
        name: 'GitHub Issues + browser DevTools',
        pitch:
          'Manual workflow: reproduce bug, copy console errors and network state from DevTools, paste into a GitHub issue. Zero cost; high effort per report.',
        bestFor: 'Solo developers and small teams already deep in GitHub.',
      },
    ],
    faq: [
      {
        q: 'Is there a free version of Jam.dev?',
        a: "Jam.dev offers a free tier with limits on the number of jams per month. For unlimited free annotation, MarkLayer is the closest fit, though it does not replicate Jam's console/network auto-capture.",
      },
      {
        q: "What's the closest free Jam alternative for visual feedback?",
        a: 'MarkLayer. It covers visual annotation for free with no sign-up. It does not capture browser metadata, console errors, or network requests. For those, you need a paid tool like BugHerd or Marker.io.',
      },
      {
        q: 'Can MarkLayer replace Jam for QA workflows?',
        a: 'For visual or layout bugs that a designer or QA engineer can describe with arrows and text, yes. For complex production bugs where the engineer needs the JS console state to debug, no. Jam (or DevTools manually) wins.',
      },
    ],
  },
  {
    slug: 'marker-io',
    target: 'Marker.io',
    homepage: 'https://marker.io',
    intro:
      'Looking for a free Marker.io alternative? Marker.io is paid only and built around tracker integrations (Jira, GitHub, Trello, Asana, ClickUp). Below are the strongest free options for the annotation half of the workflow. None of them replicate the integrations.',
    bottomLine:
      "MarkLayer is the best free Marker.io alternative if you're willing to paste the share link into your tracker manually. There is no fully free option that replicates Marker.io's two-way Jira/GitHub sync. That's the paid moat.",
    options: [
      {
        name: 'MarkLayer',
        url: '/',
        pitch:
          'Free, open-source Chrome extension for visual annotation. No native integrations. Paste the share link into Jira, Linear, GitHub Issues. Real-time live cursors.',
        bestFor: 'Teams happy to paste links manually and want zero billing.',
      },
      {
        name: 'Jam.dev',
        url: '/vs/jam',
        pitch:
          "Free tier with usage limits. Auto-captures console errors, network logs, browser metadata. Closer to Marker.io's bug-report style than MarkLayer.",
        bestFor: 'Engineering teams that need browser metadata in bug reports.',
      },
      {
        name: 'BugHerd',
        url: '/vs/bugherd',
        pitch: 'Paid visual bug tracker with Kanban board and integrations. Direct competitor to Marker.io.',
        bestFor: 'Teams shopping the paid bug-tracking category.',
      },
      {
        name: 'GitHub Issues + manual annotation',
        pitch:
          'Free if you already use GitHub. Annotate a screenshot in any tool, attach to issue. Manual but zero new SaaS.',
        bestFor: 'GitHub-native teams with low report volume.',
      },
    ],
    faq: [
      {
        q: 'Is there a free version of Marker.io?',
        a: 'Marker.io offers a free trial but no permanent free tier. For free visual annotation, MarkLayer is the closest fit.',
      },
      {
        q: 'What does MarkLayer not offer compared to Marker.io?',
        a: "Native integrations into Jira, GitHub, Trello, Asana, ClickUp. Browser/OS/console metadata capture. Project-level reporter management. Those are Marker.io's paid moat.",
      },
      {
        q: 'Can I use MarkLayer alongside Marker.io?',
        a: "Yes. Some teams use Marker.io for end-user bug reports and MarkLayer for internal team feedback on staging or competitor pages where the widget isn't installed.",
      },
    ],
  },
  {
    slug: 'userback',
    target: 'Userback',
    intro:
      'Looking for a free Userback alternative? Userback is a paid feedback platform whose primary use case is collecting feedback FROM your end users via an embedded widget. Free options below split into two camps: tools your team uses internally (MarkLayer), and tools that try to replicate the embedded widget model.',
    bottomLine:
      "MarkLayer is the closest free alternative for the internal-team annotation half of Userback. There is no truly free open-source replacement for Userback's embedded customer-feedback widget. That side requires a paid tool.",
    options: [
      {
        name: 'MarkLayer',
        url: '/',
        pitch:
          'Free, open-source Chrome extension your team uses to annotate any page. Including third-party sites and competitor products. No widget on your own site.',
        bestFor: 'Internal team annotation. Not a customer-feedback widget replacement.',
      },
      {
        name: 'BugHerd',
        url: '/vs/bugherd',
        pitch: 'Paid visual bug tracker with widget option. Closer to the Userback feature shape but paid.',
        bestFor: 'Teams comfortable with a paid feedback platform.',
      },
      {
        name: 'Marker.io',
        url: '/vs/marker-io',
        pitch: 'Paid feedback widget + extension with deep tracker integrations.',
        bestFor: 'Tracker-integrated B2B feedback workflows.',
      },
      {
        name: 'GitHub Issues template + screenshots',
        pitch: 'Manual workflow for collecting feedback from technically literate users. Zero SaaS cost; not a widget.',
        bestFor: 'Open-source projects where users open issues directly.',
      },
    ],
    faq: [
      {
        q: 'Is there a free version of Userback?',
        a: 'Userback offers a free trial but no permanent free tier. For free internal team annotation, MarkLayer is the closest fit, but it does not replicate the embedded feedback widget.',
      },
      {
        q: 'Can MarkLayer be embedded on my product like Userback?',
        a: 'No. MarkLayer is a Chrome extension your team installs, not a JavaScript snippet you embed for end users. The two solve different sides of the feedback flow.',
      },
      {
        q: 'When does MarkLayer make sense vs Userback?',
        a: 'MarkLayer when YOUR team needs to annotate any page. Userback when YOUR users need to send annotated feedback about your product.',
      },
    ],
  },
  {
    slug: 'hypothesis',
    target: 'Hypothesis',
    homepage: 'https://web.hypothes.is',
    intro:
      'Looking for a Hypothesis alternative? Hypothesis is already free and open source, so the question is usually: which tool fits my use case better. Text-based scholarly annotation (Hypothesis) or visual annotation with drawings, arrows, and pinned comments (MarkLayer)?',
    bottomLine:
      'MarkLayer is the right Hypothesis alternative if you need visual annotation. Drawings, arrows, comments pinned anywhere on the page. Diigo is a freemium hybrid. Markup.io and Pastel are paid visual-feedback alternatives. Hypothesis itself remains the right tool for scholarly text annotation.',
    options: [
      {
        name: 'MarkLayer',
        url: '/',
        pitch:
          'Free, open-source Chrome extension for visual annotation. Drawings, arrows, threaded comments pinned anywhere on the page. Real-time live cursors.',
        bestFor: 'Visual feedback on UI, design, and live web product. Not scholarly text.',
      },
      {
        name: 'Diigo',
        pitch:
          'Freemium browser bookmarking and annotation tool with text highlights and sticky notes. Closer to Hypothesis in shape.',
        bestFor: 'Personal research and bookmarking with light annotation.',
      },
      {
        name: 'Markup.io',
        url: '/vs/markup-io',
        pitch: 'Project-based visual feedback platform. Free tier with limits.',
        bestFor: 'Agency project review on live websites.',
      },
      {
        name: 'AnnotateWeb',
        url: '/vs/annotateweb',
        pitch: 'Free bookmarklet-based annotation tool with multi-language support.',
        bestFor: 'Quick one-off annotations in your native language with no extension.',
      },
    ],
    faq: [
      {
        q: 'Is MarkLayer like Hypothesis?',
        a: 'Both are free and open source, but they target different jobs. Hypothesis = scholarly text annotation with public groups. MarkLayer = visual annotation on any web page with drawings, arrows, and pinned comments.',
      },
      {
        q: 'Can Hypothesis annotate UI elements visually?',
        a: 'No. Hypothesis is text-anchored. Annotations attach to text selections, not pixels. For visual UI annotation (circling a button, arrowing a layout bug), MarkLayer is the right tool.',
      },
      {
        q: "What's the closest Hypothesis-style tool for visual annotation?",
        a: "There isn't a perfect 1:1 match. Hypothesis is fundamentally text-based. MarkLayer fills the visual-annotation gap with the closest spirit (free, open source, anchored to a page) but with pixel-level pinning instead of text-anchor.",
      },
    ],
  },
  {
    slug: 'bugherd',
    target: 'BugHerd',
    homepage: 'https://bugherd.com',
    intro:
      "Looking for a free BugHerd alternative? BugHerd is a paid visual bug tracker. Below are the strongest free options if you want visual annotation but don't need BugHerd's Kanban board and integrations.",
    bottomLine:
      'MarkLayer is the best free BugHerd alternative for the visual-annotation half of bug reporting. Paste the share link into Jira, Linear, or GitHub Issues. Markup.io has a free tier. GitHub Issues + manual screenshots is the lowest-effort fallback if you already live in GitHub.',
    options: [
      {
        name: 'MarkLayer',
        url: '/',
        pitch:
          'Free, open-source Chrome extension for visual annotation on any webpage. No Kanban or integrations. Just fast, link-based feedback. Real-time live cursors. No sign-up.',
        bestFor: 'Lightweight visual feedback without a paid bug-tracking platform.',
      },
      {
        name: 'Markup.io',
        url: '/vs/markup-io',
        pitch: 'Free tier (with limits) for project-based visual review on live sites.',
        bestFor: 'Project-based feedback workflows.',
      },
      {
        name: 'GitHub Issues + screenshots',
        pitch:
          "Free if you're already on GitHub. Manual workflow: screenshot, annotate in another tool, upload to issue.",
        bestFor: "Teams already deep in GitHub Issues who don't mind the manual loop.",
      },
      {
        name: 'Hypothesis',
        url: '/vs/hypothesis',
        pitch: 'Free open-source web annotation, but text-only. Not a true BugHerd replacement for UI bug reporting.',
        bestFor: 'Scholarly text annotation, not bug reporting.',
      },
    ],
    faq: [
      {
        q: 'Is there a free version of BugHerd?',
        a: 'BugHerd offers a free trial but no permanent free tier. For free visual annotation, MarkLayer is the closest match.',
      },
      {
        q: 'What does MarkLayer not offer compared to BugHerd?',
        a: "MarkLayer doesn't have a Kanban task board, automatic browser/OS/console-error capture, or native Jira / GitHub / Trello integrations. It's focused on the annotation step itself.",
      },
      {
        q: 'Can I use MarkLayer for QA reporting?',
        a: 'Yes. Many QA engineers use MarkLayer to circle bugs on live pages and paste the share link into their existing tracker (Jira, Linear, GitHub Issues). It complements rather than replaces a tracker.',
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// USE-CASE PAGES
// ─────────────────────────────────────────────────────────────────────────────

const USE_CASES: UseCase[] = [
  {
    slug: 'design-review',
    audience: 'designers and design teams',
    title: 'MarkLayer for Design Review: Visual Feedback on Live Sites',
    h1: 'MarkLayer for Design Review',
    intro:
      'Design review usually means screenshots in Figma comments, Slack threads with annotated PNGs, or copy-pasted URLs with vague feedback. MarkLayer collapses that loop: open the live page, draw on it, share a link. Reviewers see the actual page with your annotations on top. No screenshots, no app switching.',
    bottomLine:
      'For design review, MarkLayer replaces the screenshot-and-annotate dance with a single share link to the actual live page. Reviewers see your drawings, arrows, and threaded comments overlaid on the real product. No install, no account, no per-seat fee for clients.',
    problem:
      "Most design review tools force you out of the live product. You screenshot, paste, annotate, then explain what changed. Context lost at every step. Stakeholders argue about which version they're looking at. Comments get stranded in tools nobody opens twice.",
    why: [
      'Annotate the actual live page. Staging URL, production, or local dev.',
      'Real-time live cursors mean async and sync review work the same way.',
      'Share link works for anyone, no install required for reviewers.',
      'Free with no per-seat licensing. Invite the whole client team.',
      'Open source. Audit the code or self-host on your own infrastructure.',
    ],
    steps: [
      { name: 'Open the page', text: 'Open the staging URL or production page you want to review in Chrome.' },
      { name: 'Activate MarkLayer', text: 'Click the MarkLayer extension icon to activate the annotation overlay.' },
      {
        name: 'Mark it up',
        text: 'Draw, add arrows, pin comments, or highlight specific elements. Use freehand for sketches or shapes for precise callouts.',
      },
      { name: 'Share the link', text: 'Click "Share" to generate a link. Send it to designers, PMs, or clients.' },
      {
        name: 'Review in real time',
        text: "Reviewers open the link in any browser. Live cursors show who's where. Comments thread directly on the page.",
      },
    ],
    faq: [
      {
        q: 'Do reviewers need to install MarkLayer to give feedback?',
        a: "To create new annotations they need the extension. To view your annotations and reply to threads via the share link, they don't need any install.",
      },
      {
        q: 'Can I annotate Figma mockups with MarkLayer?',
        a: "MarkLayer works on any live webpage, including Figma's share view. For native Figma comments, use Figma's built-in comments. MarkLayer is best for the staged or live web product.",
      },
      {
        q: 'Does it work on staging environments behind auth?',
        a: "Yes. The extension annotates whatever page you're viewing in Chrome, including authed pages. The share link, however, opens the page via a public URL, so private staging URLs need the recipient to also be authed.",
      },
      {
        q: 'How is this different from Figma comments?',
        a: 'Figma comments live in Figma. MarkLayer comments live on the actual rendered page. So you can review the real product, with real fonts, real interactions, and real bugs, not just the design file.',
      },
    ],
  },
  {
    slug: 'qa-bug-reporting',
    audience: 'QA engineers and developers',
    title: 'MarkLayer for QA & Bug Reporting: Annotate Bugs in Context',
    h1: 'MarkLayer for QA Bug Reporting',
    intro:
      "Bug reports are usually screenshots with arrows in Preview, glued together with steps-to-reproduce in Jira. MarkLayer skips the screenshot step: circle the bug on the live page, write what's wrong, share the link. The dev opens the link and sees the same broken page you saw, with your arrows on it.",
    bottomLine:
      "For QA, MarkLayer replaces screenshot-with-arrows-in-Preview with a share link to the actual broken page. Devs land on the same URL with your annotations overlaid. It doesn't capture browser metadata or console errors. For that, BugHerd or Jam are heavier-duty alternatives.",
    problem:
      "Screenshot-based bug reports lose context. Devs can't tell what state the page was in. Repro steps get out of sync. Half the issue thread is the developer asking what URL you were on, what viewport, what data.",
    why: [
      'Annotate the live broken page. Devs see the same state you saw.',
      'Drawings, arrows, and pinned comments work better than text descriptions.',
      'Share link includes the URL, so devs land on the same page automatically.',
      'No sign-up means QA contractors and external testers can use it instantly.',
      'Real-time cursors let pair-debugging happen live across timezones.',
    ],
    steps: [
      { name: 'Hit the bug', text: 'Reproduce the bug as you normally would in Chrome.' },
      { name: 'Activate MarkLayer', text: 'Click the extension icon to activate the annotation overlay.' },
      {
        name: 'Annotate the bug',
        text: 'Circle the broken element, add an arrow, pin a comment with the bug description and any repro notes.',
      },
      {
        name: 'Share with the developer',
        text: 'Click "Share" and paste the link into your tracker (Jira, Linear, GitHub Issues) or send directly.',
      },
      {
        name: 'Developer reviews',
        text: 'The developer opens the link, sees the live page with your annotations, and starts debugging in context.',
      },
    ],
    faq: [
      {
        q: 'Does MarkLayer capture browser, OS, or console logs automatically?',
        a: 'No. For automatic browser metadata and console-error capture, BugHerd is a heavier-duty alternative. MarkLayer focuses on the visual annotation step.',
      },
      {
        q: 'Can I attach MarkLayer links to Jira tickets?',
        a: 'Yes. Paste the share link into the Jira description or comment field. The link opens directly to the annotated page.',
      },
      {
        q: 'Does it work for pages requiring login?',
        a: "You can annotate any page you're viewing in Chrome, including authed pages. Recipients of the share link will need to be authenticated themselves to see the underlying page.",
      },
      {
        q: 'How does this compare to Loom or Vidyard?',
        a: 'Video tools record what happened. Useful for flow bugs. MarkLayer captures a single annotated state. Useful for visual or layout bugs. Many teams use both.',
      },
    ],
  },
  {
    slug: 'client-feedback',
    audience: 'agencies, freelancers, and client-facing teams',
    title: 'MarkLayer for Client Feedback: No Install Required',
    h1: 'MarkLayer for Client Feedback',
    intro:
      "Asking a client to install a Chrome extension to review your work is friction you can't afford. With MarkLayer, you install the extension, annotate the staging site, and send the client a link. They open it in any browser, see your draft with your notes on top, and reply in the same thread. No account, no install, no onboarding.",
    bottomLine:
      'For client feedback, MarkLayer eliminates the onboarding step entirely. Clients click a link and see the annotated draft in any browser. No account, no install, no per-seat licensing. Free for every engagement. Open source means it passes most security reviews on the client side.',
    problem:
      'Client review usually means PDFs of screenshots with arrows in Preview, or signing the client up for yet another platform. Both are slow, and clients hate both. Feedback gets emailed back instead of staying with the project.',
    why: [
      'Clients view annotations and reply in their browser. No install.',
      'Free means you can use it for every client engagement without per-seat math.',
      'Live cursors enable real-time review calls without screen-sharing.',
      'Open source. Defensible to security-conscious enterprise clients.',
      'No account also means no GDPR/PII headache for casual reviewers.',
    ],
    steps: [
      { name: 'Open the staging URL', text: 'Load your in-progress site in Chrome.' },
      { name: 'Activate MarkLayer', text: 'Click the extension icon to start annotating.' },
      {
        name: 'Walk through the work',
        text: 'Annotate sections you want feedback on, or pin questions for the client to answer.',
      },
      { name: 'Send one link', text: 'Click "Share". Copy the link and email or Slack it to the client.' },
      {
        name: 'Review live or async',
        text: 'Client opens the link in any browser. Either jump on a call with live cursors or let them comment async.',
      },
    ],
    faq: [
      {
        q: 'Will my client need to sign up for anything?',
        a: 'No. Recipients of the share link open the annotated page directly in their browser. No account, no install, nothing to configure.',
      },
      {
        q: 'Can clients add their own annotations?',
        a: "Clients can reply to threaded comments without installing anything. To create new drawings or arrows, they'd need the extension. Most clients only need to comment.",
      },
      {
        q: 'How long do shared links stay live?',
        a: "Annotations stay accessible while they're being used. Inactive annotations are eventually cleaned up. See the Privacy page for current retention rules.",
      },
      {
        q: 'Is this safe for confidential client work?',
        a: 'Annotations are private until you share the link. There is no public feed. The share link itself is the access mechanism, so share it carefully. For maximum control, MarkLayer is open source and can be self-hosted.',
      },
    ],
  },
  {
    slug: 'remote-teams',
    audience: 'remote and distributed teams',
    title: 'MarkLayer for Remote Teams: Visual Collaboration on Any Page',
    h1: 'MarkLayer for Remote Teams',
    intro:
      "Remote teams review web work over Zoom, with one person screen-sharing and three people pointing vaguely with their cursors at things nobody else can see. MarkLayer fixes that: open the page, share the link, everyone sees each other's cursor, draws on the same canvas, and comments thread on the page itself.",
    bottomLine:
      'For remote teams, MarkLayer replaces "imagine I\'m pointing at this thing" Zoom calls with a shared canvas where every cursor is visible. Annotations persist after the call so async teammates can pick up where the live session left off. No seat limits, no sign-up.',
    problem:
      'Remote design and product reviews lose precision. "Make this thing here a bit smaller" doesn\'t survive the Zoom-call-to-Jira-ticket translation. Async review threads fragment across Slack, Notion, and email.',
    why: [
      "Live cursors with names. Everyone sees who's pointing at what.",
      'Same canvas for all participants. No screen-sharing needed.',
      'Annotations persist after the call. Review notes stay with the page.',
      'Free with no seat limits. Bring the whole team.',
      'Works async too. Drop annotations now, teammate reviews tomorrow.',
    ],
    steps: [
      { name: 'Pick the page', text: "Whoever's leading the review opens the relevant page in Chrome." },
      {
        name: 'Activate and share',
        text: 'Activate MarkLayer, click "Share", and drop the link in your team channel.',
      },
      { name: 'Everyone joins', text: 'Teammates open the link. Live cursors show up automatically.' },
      {
        name: 'Annotate together',
        text: 'Draw, comment, point at things. Everyone sees each annotation as it appears.',
      },
      {
        name: 'Pick up async',
        text: 'Notes and comments stay on the page. Anyone can come back later via the same link.',
      },
    ],
    faq: [
      {
        q: 'How many people can collaborate at once?',
        a: 'MarkLayer supports real-time collaboration with multiple participants on the same page. There are no seat limits. Invite the whole team.',
      },
      {
        q: 'Do all participants need the extension?',
        a: 'Only people who want to create new annotations need the extension. Anyone with the share link can view annotations and reply to comment threads.',
      },
      {
        q: 'Does it work for distributed teams across timezones?',
        a: 'Yes. Annotations persist on the share link, so async review works the same as live. Live cursors light up when someone is currently on the page.',
      },
      {
        q: 'How is this different from Figma multiplayer?',
        a: "Figma multiplayer works inside Figma. MarkLayer works on the actual live web product. Staging, production, internal tools, third-party sites. They're complementary.",
      },
    ],
  },
  {
    slug: 'students',
    audience: 'students',
    title: 'MarkLayer for Students: Free Web Annotation for Group Projects',
    h1: 'MarkLayer for Students',
    intro:
      'Studying online means tabs full of articles, lecture notes, and reference pages. None of which let you actually mark up the source. MarkLayer overlays a free annotation canvas on any webpage. Highlight text, draw arrows to connect ideas across paragraphs, pin questions to specific sentences, and share the annotated page with study-group classmates via a single link. No account, no email, no per-student licensing.',
    bottomLine:
      'For students, MarkLayer is a free way to annotate any webpage without signing up. Useful for solo studying, group projects, and sharing marked-up sources with classmates. Threaded comments mean you can argue about a paragraph in context instead of in a Discord channel.',
    problem:
      "Online study tools either lock annotation behind subscriptions, only work inside one platform (Google Docs, Notion), or require everyone in the group to sign up before they can see what you've highlighted. Students end up screenshotting articles, pasting them into Slack, and losing the context.",
    why: [
      'Free forever. No student subscription, no academic email check, no trial.',
      'Anonymous. No sign-up, no email, no profile linked to your study activity.',
      'Works on any webpage. Wikipedia, JSTOR free articles, blog posts, online textbook samples, course websites.',
      'Threaded comments mean group projects can argue specific points in context instead of in chat.',
      'Share links work for classmates without making them install anything.',
      'Multi-page projects bundle several sources into a single shareable link for a study session.',
    ],
    steps: [
      { name: 'Open the source', text: 'Open the article, paper, or web page you want to study.' },
      { name: 'Activate MarkLayer', text: 'Click the MarkLayer extension icon to activate the annotation overlay.' },
      {
        name: 'Highlight and annotate',
        text: 'Highlight key passages, pin questions or summaries to specific sentences, and draw arrows between connected ideas.',
      },
      {
        name: 'Share with the group',
        text: 'Click "Share" and drop the link in your study-group chat. Group members see your highlights without signing up.',
      },
      {
        name: 'Discuss in context',
        text: 'Replies thread on the source itself, so debates about "what does this paragraph really mean" stay anchored to the paragraph.',
      },
    ],
    faq: [
      {
        q: 'Is MarkLayer really free for students?',
        a: 'Yes, 100% free for everyone, including students. No academic email check, no student tier, no future paywall planned.',
      },
      {
        q: 'Do my classmates need an account to see my annotations?',
        a: 'No. They open the share link in any browser and see the source page with your highlights and comments overlaid. Only students who want to add their own annotations need the Chrome extension.',
      },
      {
        q: 'Can I use MarkLayer on JSTOR, Google Scholar, or course pages?',
        a: 'MarkLayer works on any page you can load in Chrome. For paywalled content, classmates viewing the share link will need their own access to the underlying page.',
      },
      {
        q: 'Is this better than Hypothesis for students?',
        a: 'Hypothesis is built for scholarly text annotation with public groups. Great for academic settings. MarkLayer is more visual (drawings, arrows, pinned comments) and lower-friction (no sign-up). Many students use Hypothesis for class-wide reading and MarkLayer for ad-hoc study groups.',
      },
    ],
  },
  {
    slug: 'educators',
    audience: 'teachers and educators',
    title: 'MarkLayer for Educators: Annotate Web Resources for Class',
    h1: 'MarkLayer for Educators',
    intro:
      'Teachers spend lessons explaining what to look at on a webpage, "see this paragraph, ignore that sidebar, notice the chart." MarkLayer turns that explanation into a single share link. Pre-annotate the source with arrows, highlights, and questions; drop the link in your LMS, Google Classroom, or class email. Students open it in any browser, see exactly what to focus on, and reply to your prompts in context.',
    bottomLine:
      'For educators, MarkLayer is a free way to pre-annotate any web resource and share it with students via a single link. No district account setup, no per-student license, no plugin install for the class. Just an annotated page that opens in any browser.',
    problem:
      "Sharing a web article with a class means writing 'read paragraphs 3-7' in the assignment description, then fielding emails when students get lost on the page. Most annotation tools require district IT to approve a new platform, every student to register, and parental consent forms to file.",
    why: [
      'Free with no district subscription, IT approval, or per-student licensing.',
      'Anonymous by design. No student emails or accounts collected.',
      'Pre-annotate any web page once; share to entire class via link.',
      'Threaded comments mean students answer your questions on the source itself, not in a separate doc.',
      'Multi-page projects bundle several sources into one shareable link for a unit.',
      'Open source. Passes most school-district security reviews.',
    ],
    steps: [
      { name: 'Pick the resource', text: 'Open the article, news story, or web page you want students to read.' },
      {
        name: 'Pre-annotate it',
        text: 'Highlight the passages they should focus on. Add arrows pointing at evidence. Pin questions or discussion prompts directly to the relevant sentences.',
      },
      {
        name: 'Generate a share link',
        text: 'Click "Share" to get a single URL.',
      },
      {
        name: 'Distribute to the class',
        text: 'Drop the link in Google Classroom, Canvas, Schoology, your LMS, or class email.',
      },
      {
        name: 'Students engage in context',
        text: 'Students open the link, see the annotated page, and respond to your prompts pinned to the page.',
      },
    ],
    faq: [
      {
        q: 'Do students need to sign up to see my annotations?',
        a: 'No. The share link opens the annotated page in any browser. Students who want to create their own annotations would need the Chrome extension, but for read-and-respond assignments, no install is required.',
      },
      {
        q: 'Is MarkLayer FERPA / student-data safe?',
        a: 'MarkLayer collects no personal data, requires no accounts, and stores no student identifiers. Annotations are tied to anonymous random local display names. The codebase is open source. District IT can audit it directly.',
      },
      {
        q: 'How is this different from Hypothesis or Diigo for classes?',
        a: 'Hypothesis has a stronger education vertical with classroom group features but requires sign-up. MarkLayer is the lower-friction option: zero accounts, instant use, but without the public-group academic structure.',
      },
      {
        q: 'Can I save annotated lessons to reuse next year?',
        a: 'Share links last as long as they are accessed regularly. For a permanent archive, take a screenshot of the annotated page, or self-host MarkLayer on your own infrastructure.',
      },
    ],
  },
  {
    slug: 'researchers',
    audience: 'researchers and academics',
    title: 'MarkLayer for Researchers: Annotate & Share Web Sources',
    h1: 'MarkLayer for Researchers',
    intro:
      'Research workflows live in a tab graveyard. Articles, dataset pages, government reports, blog posts, archived news. MarkLayer adds a free annotation layer over any of them. Highlight passages, pin notes-to-self, draw arrows between connected claims, and share annotated sources with co-authors or peer reviewers via a single link. No account, no upload, no paywall.',
    bottomLine:
      'For researchers, MarkLayer is a free annotation layer over any web source. Highlight, comment, and share with collaborators via a single link. No account, no per-seat fee, no central database holding your reading history.',
    problem:
      'Reference managers (Zotero, Mendeley) handle PDFs well but treat dynamic web sources as second-class. Hypothesis works for text but not for visual annotation of charts, infographics, or layouts. Most paid alternatives charge per-seat for what should be a basic web utility.',
    why: [
      'Free with no per-seat licensing. Useful for collaborative research projects across institutions.',
      'Anonymous. No central account tying your reading list to a profile.',
      'Visual annotation: arrows, drawings, and pinned comments work on charts, infographics, and layouts. Not just text.',
      'Multi-page projects bundle several sources into one shareable link for a literature review.',
      'Open source and self-hostable. Fits institutional security requirements.',
      'Co-authors view annotations without sign-up; replies thread on the source itself.',
    ],
    steps: [
      { name: 'Open the source', text: 'Open the web article, dataset page, or report you want to annotate.' },
      {
        name: 'Annotate findings',
        text: 'Highlight key claims, pin methodology questions to specific paragraphs, and draw arrows between related figures.',
      },
      {
        name: 'Bundle related sources',
        text: 'Use multi-page projects to combine several annotated sources into one share for a literature review or argument.',
      },
      {
        name: 'Send to co-authors or reviewers',
        text: 'Share the project link via email or Slack. Recipients see all annotated sources without signing up.',
      },
      {
        name: 'Discuss in context',
        text: 'Co-authors reply to your pinned comments directly on the source. No parallel Google Doc needed.',
      },
    ],
    faq: [
      {
        q: 'Is MarkLayer better than Hypothesis for researchers?',
        a: 'It depends on the source. Hypothesis is the standard for scholarly text annotation, with W3C-standard anchors and public groups. MarkLayer is better when sources are visual (charts, infographics, layouts) or when you need a no-sign-up share link.',
      },
      {
        q: 'Can I export my annotations for a citation manager?',
        a: 'Not natively. MarkLayer is built around shareable links, not file export. For citation export, pair it with Zotero or Mendeley for the citation itself and use MarkLayer for the working annotations.',
      },
      {
        q: 'Does MarkLayer work on PDFs hosted online?',
        a: 'MarkLayer annotates web pages. PDFs in browser viewers behave differently across platforms. For reliable PDF annotation, use a dedicated PDF tool. For HTML versions of articles, MarkLayer works directly.',
      },
      {
        q: 'Is the data I annotate private?',
        a: 'Annotations stay on your device until you generate a share link. There is no public feed, no profile, and no central account tying annotations to your identity.',
      },
    ],
  },
  {
    slug: 'content-creators',
    audience: 'content creators, writers, and editors',
    title: 'MarkLayer for Content Creators: Visual Feedback on Drafts',
    h1: 'MarkLayer for Content Creators',
    intro:
      'Editing a published article or a draft on a CMS preview URL means leaving comments somewhere. Slack, Google Doc, an email thread. MarkLayer keeps the feedback on the page itself: highlight a sentence that needs work, pin a comment to a specific paragraph, draw an arrow at the awkward CTA. Send the share link; the writer or editor sees the comments overlaid on the actual rendered article.',
    bottomLine:
      'For content creators, MarkLayer replaces "track changes in a Google Doc" with annotations on the actual rendered article. Typography, spacing, CTAs, and copy all in their final visual context. Free, no sign-up for editors or stakeholders.',
    problem:
      'Reviewing articles in Google Docs strips away the visual context. Fonts, spacing, images, sidebars, CTAs. Comments end up disconnected from how the article actually renders. By the time the article is on the CMS preview, feedback fragments across Slack, email, and tracked changes that no longer match the published version.',
    why: [
      'Annotate the rendered article. Typography, image placement, CTAs all in final context.',
      'Free with no per-editor seat license. Share with freelancers, stakeholders, or one-off reviewers.',
      'No sign-up for reviewers. Drop the link, get feedback, no friction.',
      'Threaded comments keep the editorial conversation anchored to the paragraph it relates to.',
      'Works on any CMS preview URL, staging environment, or live published article.',
    ],
    steps: [
      { name: 'Open the article', text: 'Open the CMS preview, staging URL, or published article in Chrome.' },
      { name: 'Activate MarkLayer', text: 'Click the extension icon to activate the annotation overlay.' },
      {
        name: 'Mark up the draft',
        text: 'Highlight passages that need editing, pin comments with suggested rewrites, draw attention to layout or CTA issues.',
      },
      {
        name: 'Share for review',
        text: 'Click "Share" and send the link to writers, editors, or stakeholders.',
      },
      {
        name: 'Iterate in context',
        text: 'Reviewers reply on the page itself. The conversation stays anchored to the paragraph instead of fragmenting across Slack and email.',
      },
    ],
    faq: [
      {
        q: 'Can I use MarkLayer on a staging WordPress / CMS preview URL?',
        a: 'Yes. MarkLayer works on any page Chrome can load, including authenticated CMS previews. Reviewers will need their own access to the underlying preview if it requires login.',
      },
      {
        q: 'Is this better than Google Docs comments for content review?',
        a: "Google Docs is great for structural editing of the manuscript. MarkLayer is better for late-stage review where layout, fonts, image placement, and CTAs matter. Because you're commenting on the final rendered article, not a separated draft.",
      },
      {
        q: 'Can I review mobile rendering with MarkLayer?',
        a: 'Open the page in Chrome with mobile emulation enabled (DevTools), then annotate. The annotations attach to the page state you see.',
      },
      {
        q: 'Do contributors need accounts?',
        a: 'No. Reviewers open share links in any browser without signing up. Only contributors who want to add their own annotations need the Chrome extension.',
      },
    ],
  },
  {
    slug: 'marketers',
    audience: 'marketers and growth teams',
    title: 'MarkLayer for Marketers: Annotate Landing Pages & Campaigns',
    h1: 'MarkLayer for Marketers',
    intro:
      "Marketing teams iterate on landing pages, run competitive teardowns, and review live campaigns with stakeholders who don't live in Figma or Notion. MarkLayer turns any URL into a markup canvas: pin comments on a competitor's headline, suggest edits to a hero CTA on staging, or annotate analytics dashboards with hypotheses for the next test. Share the link; stakeholders see the annotated page in any browser.",
    bottomLine:
      'For marketers, MarkLayer is a free annotation layer for landing pages, competitor sites, ad creatives, and dashboards. Pin hypotheses, suggest copy edits, and run teardowns directly on the live page. No PDF screenshots, no sign-up for stakeholders.',
    problem:
      'Marketing review cycles fragment fast: landing page mockups in Figma, copy in a Google Doc, competitive teardowns in Slack screenshots, dashboard insights in another deck. By the time anyone reads the feedback, the page has changed and the comments are decoupled from what they referenced.',
    why: [
      'Annotate live landing pages, staging URLs, competitor sites, or analytics dashboards.',
      'Free with no per-seat license. Bring stakeholders, freelancers, and clients in without billing complications.',
      'Threaded comments keep CRO hypotheses and copy suggestions anchored to the exact element.',
      'Works on competitor sites. Useful for teardown decks and competitive analysis.',
      'Multi-page projects bundle a full funnel review (landing → pricing → checkout) into one share.',
      'Open source. Passes legal/security review for client-facing work.',
    ],
    steps: [
      { name: 'Open the page', text: 'Open the landing page, competitor site, or campaign URL you want to review.' },
      { name: 'Activate MarkLayer', text: 'Click the extension icon to start annotating.' },
      {
        name: 'Mark up hypotheses',
        text: 'Pin CRO hypotheses to the hero, comment on copy choices, draw arrows at friction points in the funnel.',
      },
      {
        name: 'Bundle related pages',
        text: 'Use multi-page projects for full-funnel reviews: landing → pricing → checkout in one shareable link.',
      },
      {
        name: 'Share with the team',
        text: 'Drop the link in Slack or your project tool. Stakeholders open it without signing up and reply in context.',
      },
    ],
    faq: [
      {
        q: 'Can I annotate competitor sites with MarkLayer?',
        a: 'Yes. MarkLayer works on any webpage, including competitor sites, third-party tools, and SaaS products you do not own. The annotations are private until you share the link.',
      },
      {
        q: 'Is this useful for CRO and A/B test planning?',
        a: 'Yes. Many marketing teams use MarkLayer to pin test hypotheses to specific page elements, then revisit the annotated page after the test to see whether the hypothesis held up.',
      },
      {
        q: 'Does MarkLayer work for ad landing page review?',
        a: 'Yes. It works on any URL, including ad-specific landing pages, paid social destinations, and PPC pages on staging.',
      },
      {
        q: 'How is this different from Userback or BugHerd for marketing teams?',
        a: 'Userback and BugHerd are paid platforms with workflow tooling around feedback. MarkLayer is the free, annotation-only option. Pair with whatever PM/tracker tool you already use.',
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PRICING. Machine-readable for AI agents
// ─────────────────────────────────────────────────────────────────────────────

export const PRICING_MD = `# Pricing. MarkLayer

MarkLayer is a **free app**. There is no pricing. Full stop.

- Price: $0/month
- Annual: $0/year
- Forever: $0
- Paid plan: **None exists**
- Trial: N/A (everything is already free)
- Account required: **No** (anonymous. No sign-up, no email, no login)
- Credit card required: **No**
- Personal data collected: **None**
- Limits: None. Unlimited annotations, unlimited share links, unlimited collaborators

## Every feature is included
- Drawing tools (freehand, shapes, arrows, lines)
- Threaded comments pinned to any spot on a page
- Real-time collaboration with live cursors
- Shareable links (recipients don't need the extension or an account)
- Works on any website
- Open source
- Self-hostable

## What does NOT exist
- No "Pro" tier
- No "Team" or "Enterprise" plan
- No per-seat pricing
- No usage cap or annotation limit
- No trial period (everything is already free)
- No paywall, ever
- No "verified" or "premium" account
- No upsell flow inside the extension

## Why is it free?
MarkLayer exists to make webpage annotation accessible to everyone. Infrastructure runs on Cloudflare's low-cost edge services; the source code is open source on GitHub. There is no business model layered on top of users, and there is no plan to add one.

## Self-hosting
MarkLayer is open source. You can fork the repo, deploy on your own Cloudflare account, and run it as your private tool with no vendor dependency.

- GitHub: https://github.com/thevrus/MarkLayer
- License: see repository

## Links
- Website: https://marklayer.app
- Chrome Web Store (free install): https://chromewebstore.google.com/detail/marklayer/fnfobegjifomgobgilaemihpcpidjamc
- Privacy Policy: https://marklayer.app/privacy

Last updated: ${LAST_UPDATED}
`;

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER + URL LIST (for sitemap)
// ─────────────────────────────────────────────────────────────────────────────

export const SEO_URLS: string[] = [
  '/compare',
  '/alternatives',
  '/use-cases',
  ...COMPARISONS.map((c) => `/vs/${c.slug}`),
  ...ALTERNATIVES.map((a) => `/alternatives/${a.slug}`),
  ...USE_CASES.map((u) => `/for/${u.slug}`),
  '/pricing',
  '/about',
];

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' };

export function mountSeoRoutes(app: Hono<Env>): void {
  const compareHub = renderCompareHub(COMPARISONS);
  const alternativesHub = renderAlternativesHub(ALTERNATIVES);
  const useCaseHub = renderUseCaseHub(USE_CASES);

  // Build slug → entry maps so /vs/X and /alternatives/X cross-link to each other.
  const altBySlug = new Map(ALTERNATIVES.map((a) => [a.slug, a]));
  const compBySlug = new Map(COMPARISONS.map((c) => [c.slug, c]));

  app.get('/compare', (ctx) => ctx.body(compareHub, 200, HTML_HEADERS));
  app.get('/alternatives', (ctx) => ctx.body(alternativesHub, 200, HTML_HEADERS));
  app.get('/use-cases', (ctx) => ctx.body(useCaseHub, 200, HTML_HEADERS));

  for (const c of COMPARISONS) {
    const altMatch = altBySlug.get(c.slug);
    const crossLink = altMatch
      ? { href: `/alternatives/${altMatch.slug}`, label: `Free ${altMatch.target} alternatives` }
      : undefined;
    const html = renderComparison(c, COMPARISONS, crossLink);
    app.get(`/vs/${c.slug}`, (ctx) => ctx.body(html, 200, HTML_HEADERS));
  }
  for (const a of ALTERNATIVES) {
    const compMatch = compBySlug.get(a.slug);
    const crossLink = compMatch
      ? { href: `/vs/${compMatch.slug}`, label: `MarkLayer vs ${compMatch.competitor}` }
      : undefined;
    const html = renderAlternatives(a, ALTERNATIVES, crossLink);
    app.get(`/alternatives/${a.slug}`, (ctx) => ctx.body(html, 200, HTML_HEADERS));
  }
  for (const u of USE_CASES) {
    const html = renderUseCase(u, USE_CASES);
    app.get(`/for/${u.slug}`, (ctx) => ctx.body(html, 200, HTML_HEADERS));
  }
  app.get('/pricing', (ctx) => ctx.body(pricingHtml, 200, HTML_HEADERS));
  app.get('/pricing.md', (ctx) =>
    ctx.body(PRICING_MD, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    }),
  );
}
