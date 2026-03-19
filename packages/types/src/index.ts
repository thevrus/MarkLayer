export interface Point {
  x: number;
  y: number;
}

export interface BaseOp {
  id: string;
  color: string;
  lineWidth: number;
}

export interface FreehandOp extends BaseOp {
  tool: 'pen' | 'eraser' | 'highlight';
  points: Point[];
  compositeOperation: string;
}

export interface RectOp extends BaseOp {
  tool: 'rectangle';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface LineOp extends BaseOp {
  tool: 'line';
  arrow?: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface CircleOp extends BaseOp {
  tool: 'circle';
  centerX: number;
  centerY: number;
  radius: number;
}

export type CommentStatus = 'open' | 'in_progress' | 'resolved';

export interface CommentMeta {
  url?: string;
  viewport?: { width: number; height: number };
  browser?: string;
  os?: string;
}

export interface CommentOp extends BaseOp {
  tool: 'comment';
  num: number;
  text: string;
  x: number;
  y: number;
  ts: number;
  resolved?: boolean;
  status?: CommentStatus;
  parentId?: string;
  author?: string;
  meta?: CommentMeta;
}

export interface TextOp extends BaseOp {
  tool: 'text';
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionOp extends BaseOp {
  tool: 'selection';
  /** The actual selected text string */
  text: string;
  /** Bounding rectangles from getClientRects(), in document coordinates */
  rects: SelectionRect[];
  /** Optional comment attached to the selection */
  comment?: string;
  ts: number;
  author?: string;
  status?: CommentStatus;
}

export type DrawOp = FreehandOp | RectOp | LineOp | CircleOp | CommentOp | TextOp | SelectionOp;

/** Peer presence for live cursors */
export interface Peer {
  id: string;
  name: string;
  color: string;
  cursor: Point | null;
  tool?: string;
  lastSeen: number;
}
