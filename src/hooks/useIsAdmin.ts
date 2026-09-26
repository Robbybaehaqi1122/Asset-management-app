import { useAuth } from "@/context/AuthContext";

/**
 * `true` when the signed-in user has `profiles.role = 'admin'`.
 *
 * This is the supported way for a component to branch. Comparing
 * `profile?.role === "admin"` by hand means rewriting the same rule in every
 * screen, and the easiest place to get it wrong is the window before the
 * profile arrives, where the honest answer is still "not known yet".
 *
 * It fails closed on purpose: until the profile is known the hook returns
 * `false`, so admin-only write actions are not rendered at all. A button that
 * never appears is better than one that appears and is then rejected by RLS
 * when clicked.
 *
 * A screen that needs to tell "still loading" apart from "not an admin" should
 * read `isProfileLoading` from `useAuth` and render its own loading state.
 *
 * This is a UI concern only. RLS remains the sole authority on access:
 * hiding a button does not replace the policy in the database.
 */
export function useIsAdmin(): boolean {
  const { profile } = useAuth();
  return profile?.role === "admin";
}
