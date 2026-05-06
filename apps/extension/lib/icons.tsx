import {
  BoxSelect,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Copy,
  Crosshair,
  Download,
  Eraser,
  Eye,
  EyeOff,
  HelpCircle,
  Highlighter,
  Link2,
  MessageCircle,
  Minimize2,
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
  settings: Settings,
  help: HelpCircle,
  eye: Eye,
  eyeOff: EyeOff,
  check: Check,
  copy: Copy,
  link: Link2,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Comp = iconMap[name];
  if (!Comp) return null;
  return <Comp size={size} strokeWidth={2} />;
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
