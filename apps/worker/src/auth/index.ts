// The folder's real surface. `withUser` and the session types stay internal
// until something outside `auth/` actually mounts them.
export { auth } from './routes';
export { userFromCookieHeader } from './session';
export { authStore } from './store';
