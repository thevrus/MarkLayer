export type {
  BaseOp,
  CircleOp,
  CommentOp,
  DrawOp,
  FreehandOp,
  LineOp,
  Peer,
  Point,
  RectOp,
  TextOp,
} from '@marklayer/types';

export type Tool =
  | 'navigate'
  | 'highlight'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'circle'
  | 'comment'
  | 'text'
  | 'eraser';
