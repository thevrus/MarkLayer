import { operations } from '@ext/lib/ops';
import type { DrawOp } from '@ext/lib/types';
import { currentPageIdx, pageUrl, projectId, projectPages } from './projects';

export interface ExportData {
  ops: DrawOp[];
  url?: string;
  /** Project (multi-page) export: page-by-page ops. Present when viewing a project. */
  pages?: { url: string | null; ops: DrawOp[] }[];
}

/** Aggregate ops across all project pages (current page = live, others = cached on load) */
export function buildExportData(): ExportData {
  const pid = projectId.value;
  if (!pid) return { ops: operations.value, url: pageUrl.value || undefined };
  const pages = projectPages.value;
  const idx = currentPageIdx.value;
  const liveOps = operations.value;
  const aggregated = pages.map((p, i) => ({
    url: p.url,
    ops: i === idx ? liveOps : p.ops,
  }));
  return { ops: liveOps, url: pageUrl.value || undefined, pages: aggregated };
}
