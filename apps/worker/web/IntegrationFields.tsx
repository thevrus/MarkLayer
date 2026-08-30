import { geist } from '@ext/lib/geist';
import { cn } from '@marklayer/types';
import type { ConfigFieldInfo } from './integrations';

/**
 * The generic config field, drawn the same way wherever it is asked for.
 *
 * Two surfaces ask: the settings panel that connects a destination, and the
 * thread control that files one annotation and needs the token the room
 * deliberately did not keep. They ask for different fields at different moments,
 * but a token box that looks like a token box in one place and not the other is
 * how the two drift apart on the next focus-ring change.
 */

/** The line under the field, whether or not `helpUrl` makes it a link. */
const HELP = 'text-meta leading-snug text-(--ds-gray-900)';

/**
 * `helpUrl` only decides whether the line is clickable; the copy is the same
 * either way, so it is resolved once rather than in each branch.
 */
export const helpFor = (field: ConfigFieldInfo) => (field.helpUrl ? (field.help ?? 'How to get one') : field.help);

/**
 * One config input.
 *
 * `secret` renders as a password field: a room is configured on a shared screen
 * as often as not, and an API token sitting in a readable box is a token read
 * over somebody's shoulder. It is also why nothing here is ever prefilled — the
 * server never sends a stored config back.
 */
export function Input({
  id,
  field,
  value,
  onInput,
  onEnter,
}: {
  id?: string;
  field: ConfigFieldInfo;
  value: string;
  onInput: (name: string, value: string) => void;
  onEnter: () => void;
}) {
  const type = field.type === 'url' ? 'url' : field.type === 'secret' ? 'password' : 'text';
  return (
    <input
      id={id}
      name={field.name}
      type={type}
      value={value}
      placeholder={field.placeholder}
      aria-label={field.label}
      spellcheck={false}
      autocomplete="off"
      class={cn(geist.input, 'min-w-0 flex-1')}
      onInput={(e) => onInput(field.name, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter();
      }}
    />
  );
}

/** The help line under a field, as a link where the provider gave one. */
export function Help({ field, text }: { field: ConfigFieldInfo; text?: string }) {
  if (!text) return null;
  return field.helpUrl ? (
    <a
      href={field.helpUrl}
      target="_blank"
      rel="noreferrer noopener"
      class={cn(HELP, 'underline underline-offset-2 hover:text-(--ds-gray-1000)')}
    >
      {text}
    </a>
  ) : (
    <span class={HELP}>{text}</span>
  );
}

/** A labelled field in its box, which is how both callers draw more than one. */
export function LabelledField({
  id,
  field,
  label,
  value,
  onInput,
  onEnter,
}: {
  id: string;
  field: ConfigFieldInfo;
  label: string;
  value: string;
  onInput: (name: string, value: string) => void;
  onEnter: () => void;
}) {
  return (
    <div class="flex flex-col gap-1">
      {/* Visible, not just an aria-label. Boxes in a column are only tellable
          apart by a placeholder that vanishes the moment somebody types. */}
      <label for={id} class={geist.sectionLabel}>
        {label}
      </label>
      <div class={cn(geist.field, 'flex items-center py-0 px-2.5')}>
        <Input id={id} field={field} value={value} onInput={onInput} onEnter={onEnter} />
      </div>
      <Help field={field} text={helpFor(field)} />
    </div>
  );
}
