import { getCommentStatus, STATUS_LABELS } from './state';
import type { CommentOp, DrawOp, SelectionOp, TextOp } from './types';

interface ExportMeta {
  url?: string;
  generatedAt?: number;
  /** Optional list of (url, ops) tuples to render multi-page projects */
  pages?: { url: string | null; ops: DrawOp[] }[];
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function quote(text: string): string {
  return text.replace(/\r?\n/g, '\n> ');
}

function partition(ops: DrawOp[]) {
  const roots: CommentOp[] = [];
  const replies = new Map<string, CommentOp[]>();
  const selections: SelectionOp[] = [];
  const texts: TextOp[] = [];
  for (const op of ops) {
    if (op.tool === 'comment') {
      if (op.parentId) {
        let arr = replies.get(op.parentId);
        if (!arr) {
          arr = [];
          replies.set(op.parentId, arr);
        }
        arr.push(op);
      } else {
        roots.push(op);
      }
    } else if (op.tool === 'selection') {
      selections.push(op);
    } else if (op.tool === 'text') {
      texts.push(op);
    }
  }
  return { roots, replies, selections, texts };
}

function renderSection(
  ops: DrawOp[],
  headingLevel: number,
  out: string[],
): { comments: number; selections: number; texts: number } {
  const h = '#'.repeat(headingLevel);
  const sub = '#'.repeat(headingLevel + 1);
  const { roots, replies, selections, texts } = partition(ops);

  if (roots.length) {
    out.push(`${h} Comments`, '');
    for (const c of roots) {
      const status = getCommentStatus(c);
      const author = c.author || 'Anonymous';
      out.push(`${sub} #${c.num} — ${author} _(${STATUS_LABELS[status]})_`);
      if (c.meta) {
        const metaParts = [
          c.meta.browser,
          c.meta.os,
          c.meta.viewport && `${c.meta.viewport.width}×${c.meta.viewport.height}`,
        ].filter(Boolean);
        if (metaParts.length) out.push(`_${metaParts.join(' · ')}_`);
      }
      out.push('', c.text);
      const reps = replies.get(c.id) ?? [];
      for (const r of reps) {
        out.push('', `> **${r.author || 'Anonymous'}:** ${quote(r.text)}`);
      }
      out.push('');
    }
  }

  if (selections.length) {
    out.push(`${h} Highlighted selections`, '');
    for (const s of selections) {
      const status = s.status ?? 'open';
      const oneLine = s.text.replace(/\s+/g, ' ').trim();
      out.push(`${sub} "${oneLine}" _(${STATUS_LABELS[status]})_`);
      if (s.comment) out.push('', `> ${quote(s.comment)}`);
      out.push('');
    }
  }

  if (texts.length) {
    out.push(`${h} Text labels`, '');
    for (const t of texts) {
      out.push(`- ${t.text.replace(/\r?\n/g, ' ')}`);
    }
    out.push('');
  }

  return { comments: roots.length, selections: selections.length, texts: texts.length };
}

export function buildMarkdownExport(ops: DrawOp[], meta: ExportMeta = {}): string {
  const out: string[] = [];
  out.push('# MarkLayer annotations', '');
  if (meta.url) out.push(`**URL:** ${meta.url}`);
  const generated = new Date(meta.generatedAt ?? Date.now()).toLocaleString();
  out.push(`**Generated:** ${generated}`);

  if (meta.pages && meta.pages.length > 1) {
    let totalC = 0;
    let totalS = 0;
    let totalT = 0;
    for (const p of meta.pages) {
      const { roots, selections, texts } = partition(p.ops);
      totalC += roots.length;
      totalS += selections.length;
      totalT += texts.length;
    }
    const totals: string[] = [];
    if (totalC) totals.push(pluralize(totalC, 'comment'));
    if (totalS) totals.push(pluralize(totalS, 'selection'));
    if (totalT) totals.push(pluralize(totalT, 'text label'));
    out.push(`**Pages:** ${meta.pages.length}`);
    if (totals.length) out.push(`**Totals:** ${totals.join(', ')}`);
    out.push('');
    meta.pages.forEach((page, i) => {
      let label = `Page ${i + 1}`;
      if (page.url) {
        const u = new URL(page.url);
        label = u.hostname + u.pathname;
      }
      out.push(`## Page ${i + 1} — ${label}`, '');
      if (page.url) out.push(`<${page.url}>`, '');
      renderSection(page.ops, 3, out);
    });
    return `${out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()}\n`;
  }

  const rendered: string[] = [];
  const counts = renderSection(ops, 2, rendered);
  const totals: string[] = [];
  if (counts.comments) totals.push(pluralize(counts.comments, 'comment'));
  if (counts.selections) totals.push(pluralize(counts.selections, 'selection'));
  if (counts.texts) totals.push(pluralize(counts.texts, 'text label'));
  if (totals.length) out.push(`**Totals:** ${totals.join(', ')}`);
  out.push('');
  out.push(...rendered);
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

export function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function defaultExportFilename(url?: string): string {
  let stub = 'marklayer';
  if (url) {
    try {
      stub = new URL(url).hostname.replace(/^www\./, '') || stub;
    } catch {
      /* */
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  return `${stub}-annotations-${date}.md`;
}
