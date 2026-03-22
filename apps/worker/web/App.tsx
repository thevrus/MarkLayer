import { lazy, Suspense } from 'preact/compat';
import { Landing } from './Landing';
import { isLanding } from './signals';

export { Logo } from './shared';
// Re-export for consumers
export { deviceMode, opMatchesDevice, pushDeviceOp } from './signals';

const Viewer = lazy(() => import('./Viewer'));

export function App() {
  if (isLanding.value) return <Landing />;
  return (
    <Suspense fallback={<div class="h-screen grid place-items-center bg-ml-bg-viewer" />}>
      <Viewer />
    </Suspense>
  );
}
