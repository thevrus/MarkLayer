export type {
  AnnotationOp,
  AreaOp,
  BaseOp,
  CircleOp,
  CommentMeta,
  CommentOp,
  CommentPriority,
  CommentStatus,
  DeviceMode,
  DrawOp,
  FreehandOp,
  GuideOp,
  InspectOp,
  LineOp,
  Mention,
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
  | 'guide'
  | 'area';
