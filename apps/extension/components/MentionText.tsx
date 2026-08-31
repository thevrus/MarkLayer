import { cn, type Mention, mentionSegments } from '@marklayer/types';
import { rosterNames } from '../lib/roster';
import { localUser } from '../lib/state';

/**
 * Comment prose with its `@mentions` set apart.
 *
 * The distinction is tonal, not coloured: a tag is the same ink as the sentence
 * it sits in, one step stronger and a weight heavier, and a tag pointing at you
 * is heavier again. A saturated token (or a tinted chip around it) would read as
 * a component-kit badge and fight every other colour in the panel — and the one
 * thing a mention has to do is stay legible inside a sentence.
 *
 * The name shown is the person's current one, not the snapshot the text was
 * written with, which is why a rename needs no rewriting of anyone's prose: the
 * stored name still marks where the tag sits, and the roster says what to call
 * them now.
 */
export function MentionText({ text, mentions }: { text: string; mentions?: Mention[] }) {
  const segments = mentionSegments({ text, mentions });
  // Nothing tagged: return the body untouched rather than subscribing this
  // component to the roster, which every comment in a list would otherwise do.
  if (segments.every((segment) => !segment.mention)) return <span>{text}</span>;
  const current = rosterNames.value;

  return (
    <span>
      {segments.map((segment, i) => {
        const { mention } = segment;
        if (!mention) return <span key={`${i}-plain`}>{segment.text}</span>;
        const me = mention.id === localUser.id;
        const name = current.get(mention.id) ?? mention.name;
        return (
          <span
            // Segments have no id of their own; position in one immutable body is stable.
            key={`${i}-${mention.id}`}
            class={cn('text-(--ds-gray-1000)', me ? 'font-semibold' : 'font-medium')}
            title={me ? 'Mentions you' : `Mentions ${name}`}
          >
            @{name}
          </span>
        );
      })}
    </span>
  );
}
