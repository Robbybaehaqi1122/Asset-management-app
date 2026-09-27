import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/context/AuthContext";
import { authErrorKey } from "@/lib/authErrors";
import { completePasswordChange } from "@/lib/profiles";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import Button from "@/components/ui/button/Button";
import PageMeta from "@/components/common/PageMeta";
import { EyeCloseIcon, EyeIcon } from "@/icons";

/**
 * The advisory password gate from migration 00800, as a UI.
 *
 * `must_change_password` is a prompt, not a boundary, and this is the whole of
 * its enforcement. GoTrue has no equivalent of the Windows AD / LDAP
 * `mustChangePassword` flag, so nothing on the server can refuse the temporary
 * credential — the honest fix for that is an emailed reset link, which needs a
 * mail provider this project does not have. What this buys is that the admin's
 * knowledge of the first password stops being permanent the first time the user
 * signs in, and somebody determined to keep the old password still can.
 *
 * It is mounted by `RequireAuth` rather than being a route, which is the part
 * that matters. A route is reachable around: type `/calendar` and the prompt is
 * never shown. Wrapping the outlet means one check covers every protected
 * screen, with no new entry in `App.tsx` and no way to navigate past it.
 *
 * Fails **open**, and that is the opposite of `useIsAdmin` on purpose. Here the
 * unknown case is "the profile row could not be read", and blocking on that
 * would lock a working account out of its own password screen — the one screen
 * that could fix whatever broke. So it gates only on a positively known `true`,
 * and a read failure shows the app rather than a wall.
 */
export default function MustChangePassword({
  children,
}: {
  children: ReactNode;
}) {
  const { profile, isProfileLoading, signOut, refreshProfile } = useAuth();

  if (isProfileLoading) return <Loading />;
  if (profile?.must_change_password !== true) return <>{children}</>;

  return (
    <ChangePasswordForm
      onDone={refreshProfile}
      onSignOut={signOut}
      displayName={profile.full_name || profile.email || ""}
    />
  );
}

function Loading() {
  const { t } = useTranslation("common", { keyPrefix: "mustChangePassword" });
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t("loading")}</p>
    </div>
  );
}

function ChangePasswordForm({
  onDone,
  onSignOut,
  displayName,
}: {
  onDone: () => Promise<void>;
  onSignOut: () => Promise<void>;
  displayName: string;
}) {
  const { t } = useTranslation("common", { keyPrefix: "mustChangePassword" });

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async () => {
    // Both checked here as well as by GoTrue, so a mismatch is a message on the
    // field the user is looking at rather than a round trip that ends in a
    // generic failure.
    if (password.length < 8) {
      setError(t("errors.tooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("errors.mismatch"));
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      // Changes the credential, then clears the flag. The order is
      // `completePasswordChange`'s own: a failed password change must leave the
      // flag set, so the account holder is asked again rather than quietly
      // released from a password the admin still knows.
      await completePasswordChange(password);
      // The cached row still says `true`, and `userId` did not change, so
      // nothing else would re-read it. Without this the gate stays up forever
      // over a password that has already been changed.
      await onDone();
    } catch (caught) {
      // `authErrorKey` returns a path under `auth`, so the prefix is supplied
      // here rather than at the `useTranslation` call. GoTrue is the authority
      // on similarity and confirmation; this only decides which message to
      // show for what it said.
      setError(t(authErrorKey(caught), { keyPrefix: "auth" }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    // Present on purpose. A user who cannot get past this screen still has to be
    // able to leave it, and a gate with no exit is a lockout with extra steps.
    try {
      await onSignOut();
    } catch {
      // Same known gap as `UserDropdown.handleSignOut`: the failure only
      // reaches the console and the user stays signed in. Nothing here is
      // worse for it, and there is still no toast primitive to say so with.
    }
  };

  return (
    <>
      <PageMeta
        title={`${t("pageTitle")} | Asset Management App`}
        description={t("pageDescription")}
      />
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10 dark:bg-gray-900">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-xs sm:p-8 dark:border-gray-800 dark:bg-white/3">
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            {t("title")}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {displayName
              ? t("subtitleNamed", { name: displayName })
              : t("subtitle")}
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="new-password">{t("newPassword")}</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  name="new-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t("newPasswordPlaceholder")}
                  autoComplete="new-password"
                  autoFocus
                  className="pe-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={
                    showPassword ? t("hidePassword") : t("showPassword")
                  }
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {showPassword ? (
                    <EyeCloseIcon className="size-5" />
                  ) : (
                    <EyeIcon className="size-5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="confirm-password">{t("confirmPassword")}</Label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder={t("confirmPasswordPlaceholder")}
                autoComplete="new-password"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isSaving) void handleSubmit();
                }}
              />
            </div>
          </div>

          {error && (
            <p className="mt-4 text-sm text-error-600 dark:text-error-500">
              {error}
            </p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={isSaving}
            className="mt-6 w-full"
          >
            {isSaving ? t("submitting") : t("submit")}
          </Button>

          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={handleSignOut}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {t("signOut")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
