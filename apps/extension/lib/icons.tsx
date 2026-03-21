import {
  ChevronDown,
  ChevronUp,
  Circle,
  Download,
  Eraser,
  Highlighter,
  MessageCircle,
  Moon,
  MousePointer2,
  MoveUpRight,
  Pen,
  Pencil,
  Redo2,
  Share2,
  Square,
  Sun,
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
  share: Share2,
  download: Download,
  undo: Undo2,
  redo: Redo2,
  clear: Trash2,
  chevDown: ChevronDown,
  chevUp: ChevronUp,
  close: X,
  sun: Sun,
  moon: Moon,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Comp = iconMap[name];
  if (!Comp) return null;
  return <Comp size={size} strokeWidth={2} />;
}
