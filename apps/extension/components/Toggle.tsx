import { Switch } from '@base-ui/react/switch';
import { cn } from '@marklayer/types';

const SIZE = {
  md: { root: 'w-8 h-5', thumb: 'w-4 h-4' },
  sm: { root: 'w-7 h-4', thumb: 'w-3 h-3' },
};

/** The one switch skin; both sizes leave the thumb 2px from either edge. */
export function Toggle({
  checked,
  onChange,
  label,
  size = 'md',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Omit when a wrapping <label> names it. */
  label?: string;
  size?: keyof typeof SIZE;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className={cn(
        SIZE[size].root,
        'relative inline-flex items-center shrink-0 rounded-full cursor-pointer appearance-none border-none p-0',
        'transition-[background-color] duration-150 outline-none',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2',
        'focus-visible:outline-(--ds-focus-color)',
        'data-checked:bg-(--ds-gray-1000) data-unchecked:bg-(--ds-gray-alpha-500)',
      )}
    >
      <Switch.Thumb
        className={cn(
          SIZE[size].thumb,
          'absolute top-0.5 rounded-full bg-(--ds-background-100)',
          '[box-shadow:var(--ds-shadow-border-small)]',
          'transition-[left] duration-150 ease-out',
          'data-checked:left-3.5 data-unchecked:left-0.5',
        )}
      />
    </Switch.Root>
  );
}
