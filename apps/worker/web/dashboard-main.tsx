import { theme } from '@ext/lib/state';
import { effect } from '@preact/signals';
import { render } from 'preact';
import { Route, Router, Switch, useLocation, useParams } from 'wouter-preact';
import { AppBar } from './dashboard/AppBar';
import { Dashboard } from './dashboard/Dashboard';
import { SignIn } from './dashboard/SignIn';
import { claimLink, loadSession, sessionLoading, user } from './dashboard/session';
import { Spinner } from './shared';
import './style.css';

effect(() => {
  const t = theme.value;
  const cls = document.documentElement.classList;
  cls.remove('light', 'dark');
  t !== 'system' && cls.add(t);
});

/** The one thing on screen while a fetch decides what the screen is. */
function Waiting({ label }: { label: string }) {
  return (
    <div class="text-meta flex min-h-dvh items-center justify-center gap-2 text-(--ds-gray-900)">
      <Spinner />
      {label}
    </div>
  );
}

/**
 * Where the viewer's "Save to my links" lands. Claiming needs a session, so an
 * unauthenticated arrival falls through to sign-in and the id survives in the
 * URL — after the magic link redirects back to `/app`, the person re-opens the
 * share link rather than losing the claim silently.
 */
function Claim() {
  const params = useParams();
  const [, navigate] = useLocation();
  const id = params.id;
  if (user.value && id) {
    void claimLink(id).then(() => navigate('/', { replace: true }));
    return <Waiting label="Saving…" />;
  }
  return <SignIn />;
}

/**
 * Signed out, the page is the sign-in card and nothing else — a bar carrying a
 * wordmark above a card that already carries one is the same mark twice.
 */
function Shell() {
  // Content is rendered, never revealed: a signed-out person sees the sign-in
  // form, not an empty page waiting on an effect that may not run.
  if (sessionLoading.value) return <Waiting label="Loading…" />;
  if (!user.value) {
    return (
      <Switch>
        <Route path="/claim/:id" component={Claim} />
        <Route>
          <SignIn />
        </Route>
      </Switch>
    );
  }
  return (
    <>
      <AppBar />
      <Switch>
        <Route path="/claim/:id" component={Claim} />
        <Route>
          <Dashboard />
        </Route>
      </Switch>
    </>
  );
}

function App() {
  return (
    <Router base="/app">
      <main class="min-h-dvh bg-(--ds-background-100) text-(--ds-gray-1000)">
        <Shell />
      </main>
    </Router>
  );
}

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
  void loadSession();
}
