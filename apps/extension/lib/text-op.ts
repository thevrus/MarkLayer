import { nanoid } from 'nanoid';
import type { TextOp } from './types';

/** One stack for the textarea and the canvas: committed text must land where it was typed. */
export const TEXT_FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Geist", system-ui, sans-serif';
export const TEXT_LINE_HEIGHT = 1.3;

export const textFontSize = (lineWidth: number) => Math.max(14, lineWidth * 6);

export function makeTextOp({
  text,
  x,
  y,
  color,
  lineWidth,
  viewport,
}: {
  text: string;
  x: number;
  y: number;
  color: string;
  lineWidth: number;
  viewport?: { width: number; height: number };
}): TextOp {
  return {
    id: nanoid(),
    tool: 'text',
    text,
    x,
    y,
    fontSize: textFontSize(lineWidth),
    color,
    lineWidth,
    ...(viewport && { captureViewport: viewport }),
  };
}
