export type {
  BaseOp,
  CircleOp,
  CommentMeta,
  CommentOp,
  CommentStatus,
  DeviceMode,
  DrawOp,
  FreehandOp,
  LineOp,
  Peer,
  Point,
  RectOp,
  SelectionOp,
  SelectionRect,
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
  | 'selection'
  | 'eraser';
