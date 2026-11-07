import { cn } from '@marklayer/ui/cn';
import type * as Real from '../../components/PriorityMenu';
import { PRIORITY_LEVELS, PRIORITY_META } from '../../lib/priority';

// Widget stand-in: the platform's own select, laid invisibly over the same trigger, so Base UI's Menu stays out.

export const PriorityMenu: typeof Real.PriorityMenu = ({ value, onChange, class: cls, children }) => (
  <span
    class={cn(
      cls,
      'relative has-focus-visible:outline-solid has-focus-visible:outline-2 has-focus-visible:outline-(--ds-focus-color)',
    )}
  >
    {children}
    <select
      aria-label="Priority"
      value={value ?? ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(PRIORITY_LEVELS.find((level) => level === e.currentTarget.value))}
      class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
    >
      <option value="">No priority</option>
      {[...PRIORITY_LEVELS].reverse().map((level) => (
        <option key={level} value={level}>
          {PRIORITY_META[level].label}
        </option>
      ))}
    </select>
  </span>
);
