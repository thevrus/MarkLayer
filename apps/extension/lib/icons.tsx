import {
  BoxSelect,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  Copy,
  Crosshair,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Grid3x3,
  GripVertical,
  Heart,
  HelpCircle,
  Highlighter,
  Info,
  Link2,
  MessageCircle,
  Minimize2,
  Monitor,
  Moon,
  MousePointer2,
  MoveUpRight,
  Pause,
  Pen,
  Pencil,
  Play,
  Redo2,
  Ruler,
  Settings,
  Share2,
  Square,
  SquareDashedMousePointer,
  Sun,
  Terminal,
  Trash2,
  Type,
  TypeOutline,
  Undo2,
  X,
} from 'lucide-preact';
import type { SimpleIcon } from 'simple-icons';
import { siReact, siSvelte, siTailwindcss, siVuedotjs } from 'simple-icons';

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
  area: BoxSelect,
  eraser: Eraser,
  inspect: Crosshair,
  multiInspect: SquareDashedMousePointer,
  measure: Ruler,
  guide: Grid3x3,
  grip: GripVertical,
  pause: Pause,
  play: Play,
  share: Share2,
  download: Download,
  terminal: Terminal,
  undo: Undo2,
  redo: Redo2,
  clear: Trash2,
  chevDown: ChevronDown,
  chevUp: ChevronUp,
  chevRight: ChevronRight,
  close: X,
  minimize: Minimize2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  settings: Settings,
  help: HelpCircle,
  heart: Heart,
  eye: Eye,
  eyeOff: EyeOff,
  check: Check,
  alert: CircleAlert,
  info: Info,
  copy: Copy,
  link: Link2,
};

export function Icon({ name, size = 18, strokeWidth = 2 }: { name: string; size?: number; strokeWidth?: number }) {
  const Comp = iconMap[name];
  if (!Comp) return null;
  return <Comp size={size} strokeWidth={strokeWidth} />;
}

const brandIconMap = {
  react: siReact,
  vue: siVuedotjs,
  svelte: siSvelte,
  tailwind: siTailwindcss,
} satisfies Record<string, SimpleIcon>;

export type BrandIconName = keyof typeof brandIconMap;

/** Solid-fill brand logos from simple-icons. Uses currentColor so the consumer styles it. */
export function BrandIcon({ name, size = 12 }: { name: BrandIconName; size?: number }) {
  const icon = brandIconMap[name];
  if (!icon) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <title>{icon.title}</title>
      <path d={icon.path} />
    </svg>
  );
}
