export type {
  AreaOp,
  BaseOp,
  CircleOp,
  CommentMeta,
  CommentOp,
  CommentStatus,
  DeviceMode,
  DrawOp,
  FreehandOp,
  InspectOp,
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
  | 'eraser'
  | 'inspect'
  | 'multiInspect'
  | 'measure'
  | 'area';
