import {
  ChevronDown,
  ChevronUp,
  Circle,
  Crosshair,
  Download,
  Eraser,
  Highlighter,
  MessageCircle,
  Minimize2,
  Moon,
  MousePointer2,
  MoveUpRight,
  Pen,
  Pencil,
  Redo2,
  Share2,
  Square,
  Sun,
  Terminal,
  Trash2,
  Type,
  TypeOutline,
  Undo2,
  X,
} from 'lucide-preact';

const iconMap: Record<string, typeof MousePointer2> = {
  navigate: MousePointer2,
  highlight: Highlighter,
  pen: Pen,
  line: Pencil,
  arrow: MoveUpRight,
  rectangle: Square,
  circle: Circle,
  text: Type,
  comment: MessageCircle,
  selection: TypeOutline,
  eraser: Eraser,
  inspect: Crosshair,
  share: Share2,
  download: Download,
  terminal: Terminal,
  undo: Undo2,
  redo: Redo2,
  clear: Trash2,
  chevDown: ChevronDown,
  chevUp: ChevronUp,
  close: X,
  minimize: Minimize2,
  sun: Sun,
  moon: Moon,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Comp = iconMap[name];
  if (!Comp) return null;
  return <Comp size={size} strokeWidth={2} />;
}
