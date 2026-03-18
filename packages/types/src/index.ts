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

export interface CommentOp extends BaseOp {
  tool: 'comment';
  num: number;
  text: string;
  x: number;
  y: number;
  ts: number;
  resolved?: boolean;
  parentId?: string;
  author?: string;
}

export interface TextOp extends BaseOp {
  tool: 'text';
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export type DrawOp = FreehandOp | RectOp | LineOp | CircleOp | CommentOp | TextOp;

/** Peer presence for live cursors */
export interface Peer {
  id: string;
  name: string;
  color: string;
  cursor: Point | null;
  tool?: string;
  lastSeen: number;
}
