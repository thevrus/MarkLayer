import { secondaryBtn, submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { cn } from '@marklayer/types';
import { useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { Logo } from '../shared';
import { requestSignIn } from './session';

/** Geist's card: the hairline comes from the shadow's first layer, so no border. */
const CARD = 'rounded-xl bg-(--ds-background-100) p-5 [box-shadow:var(--ds-shadow-border-small)]';

function Frame({ children }: { children: ComponentChildren }) {
  return (
    <div class="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div class="w-full max-w-[23rem]">{children}</div>
    </div>
  );
}

export function SignIn() {
  const email = useSignal('');
  const error = useSignal<string | null>(null);
  const sending = useSignal(false);
  const sent = useSignal(false);

  async function submit(event: Event) {
    event.preventDefault();
    const address = email.value.trim();
    if (!address || sending.value) return;
    sending.value = true;
    error.value = null;
    const failure = await requestSignIn(address);
    sending.value = false;
    if (failure) error.value = failure;
    else sent.value = true;
  }

  if (sent.value) {
    return (
      <Frame>
        <div class="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={28} />
          <h1 class="text-title tracking-display font-semibold text-(--ds-gray-1000)">Check your email</h1>
        </div>
        <div class={cn(CARD, 'text-center')}>
          <p class="text-ui leading-body text-balance text-(--ds-gray-900)">
            A sign-in link is on its way to <span class="font-medium text-(--ds-gray-1000)">{email.value.trim()}</span>.
            It works once and expires in 15 minutes.
          </p>
          <button
            type="button"
            class={cn(secondaryBtn, 'mt-5 h-11 w-full sm:h-10')}
            onClick={() => {
              sent.value = false;
            }}
          >
            Use a different address
          </button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div class="mb-6 flex flex-col items-center gap-3 text-center">
        <Logo size={28} />
        <h1 class="text-title tracking-display font-semibold text-(--ds-gray-1000)">Your links</h1>
        <p class="text-meta leading-body text-balance text-(--ds-gray-900)">
          Sign in to keep the links you make, so they are still here next week.
        </p>
      </div>

      <form class={cn(CARD, 'flex flex-col gap-2')} onSubmit={submit}>
        <label class="text-meta font-medium text-(--ds-gray-900)" for="ml-email">
          Email
        </label>
        <div class={cn(geist.field, 'flex h-11 items-center px-3 sm:h-10')}>
          <input
            id="ml-email"
            type="email"
            required
            autofocus
            autocomplete="email"
            placeholder="you@studio.com"
            aria-invalid={error.value ? 'true' : undefined}
            aria-describedby={error.value ? 'ml-email-error' : undefined}
            value={email.value}
            onInput={(event) => {
              email.value = event.currentTarget.value;
            }}
            /* 16px, not the text-ui step: iOS Safari zooms into any focused input below it. */
            class={cn(geist.input, 'w-full text-base')}
          />
        </div>
        {error.value ? (
          <p id="ml-email-error" role="alert" class="text-meta text-(--ds-red-700)">
            {error.value}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={sending.value}
          class={cn(submitBtn, 'mt-2 h-11 w-full disabled:opacity-50 sm:h-10')}
        >
          {sending.value ? 'Sending…' : 'Email me a link'}
        </button>
      </form>

      <p class="text-meta leading-body mt-4 text-balance text-center text-(--ds-gray-900)">
        No password. Annotating never needs an account, and links you already shared are unaffected.
      </p>
    </Frame>
  );
}
