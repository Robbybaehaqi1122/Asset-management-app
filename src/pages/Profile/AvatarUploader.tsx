import { useState } from "react";
import { useTranslation } from "react-i18next";

import Label from "@/components/form/Label";
import FileInput from "@/components/form/input/FileInput";
import {
  AvatarError,
  AVATAR_ACCEPT,
  setAvatar,
  type AvatarErrorCode,
} from "@/lib/avatar";

/**
 * Pick a photo, and it saves itself.
 *
 * ## Why there is no Save button
 *
 * There is nothing to confirm. The alternatives are a preview-then-save step, which adds
 * a click and a "are you sure" moment to an action that is trivially reversible — a
 * second pick undoes it — and a Save button the reader has to discover is live. So the
 * file input is the whole interaction, and the states below it say what happened.
 *
 * ## The input is cleared after every pick
 *
 * `<input type="file">` keeps its own value, so choosing the same file twice in a row
 * fires no `change` event and the second attempt silently does nothing. That is the shape
 * of a control that looks broken, and `event.target.value = ""` is the fix — it has to
 * happen on the element's own target, not on the `File`.
 *
 * ## Errors are worded per stage
 *
 * `upload_failed` and `link_failed` leave the app in different states — the first changed
 * nothing, the second left the bytes in the bucket — so they do not share a sentence. A
 * generic "upload failed" on the second would be false, in the same way `reset-password`
 * refuses to report a credential change as a failure when only the flag write missed.
 */

/**
 * Every failure code to its sentence, as a **total** mapping.
 *
 * **`Record<AvatarErrorCode, string>` rather than an interpolated key** — `t(`errors.${code}`)`
 * compiles for any string, so a code added to the union without a matching key would
 * render `profile.avatar.errors.whatever` on screen and nothing would complain until
 * somebody clicked. Typed as a Record, adding a code without a key is a build error.
 *
 * The values are **relative to the component's `keyPrefix`**, not full paths. Writing
 * `profile.avatar.errors.too_large` here would resolve to
 * `profile.avatar.profile.avatar.errors.too_large` and silently fall through to
 * rendering the key — the same double-scoping trap the Organisation page hit once.
 *
 * `remove_failed` is in the mapping even though nothing surfaces it today: `setAvatar`
 * swallows it deliberately, because the reference has already moved by then and calling a
 * successful upload a failure would be the worse lie. It is here so the mapping stays
 * total rather than carrying a code with no sentence.
 */
const ERROR_KEYS: Record<AvatarErrorCode, string> = {
  unsupported_type: "errors.unsupported_type",
  too_large: "errors.too_large",
  upload_failed: "errors.upload_failed",
  link_failed: "errors.link_failed",
  remove_failed: "errors.remove_failed",
};

export default function AvatarUploader({
  userId,
  currentPath,
  onSaved,
}: {
  /** The signed-in reader's id, which is also the first path segment. */
  userId: string;
  currentPath: string | null;
  /** Called after the reference has moved, so the caller can re-read its own copy. */
  onSaved: () => void;
}) {
  const { t } = useTranslation("common", { keyPrefix: "profile.avatar" });

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];

    // Cleared first and unconditionally, so it happens whether this attempt succeeds,
    // fails, or has no file at all.
    input.value = "";

    if (!file) return;

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await setAvatar(file, userId, currentPath);
      setNotice(t("saved"));
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof AvatarError
          ? t(ERROR_KEYS[caught.code])
          : t("errors.unknown"),
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="border-t border-gray-200 pt-6 dark:border-gray-800">
      <Label htmlFor="avatar-file">{t("label")}</Label>

      {/*
        No Save button, and no Refresh either.

        The refresh looked plausible and was not: every upload lands on a **new** object
        path, so the URL `avatarUrlFromPath` produces is different and the browser fetches
        the new file on its own. A button labelled Refresh that re-read state without
        changing the URL is a control that does nothing — and `onSaved` already carries
        the re-read it would have done.

        No Remove either, deliberately. Picking a second photo replaces the first, which
        covers the ordinary case of uploading the wrong one, and a Remove control would
        need its own `avatar_path = null` write and its own error states for a situation
        uploading a better photo already solves.
      */}
      <FileInput
        id="avatar-file"
        accept={AVATAR_ACCEPT}
        onChange={(event) => void handleChange(event)}
        disabled={isBusy}
        className="mt-2 sm:max-w-md"
      />

      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
        {t("hint")}
      </p>

      {/*
        Both messages live outside any modal, for the reason every other screen in this
        app puts its outcomes there: the outcome is raised after the interaction has
        finished, and anything rendered inside a closed surface is written and never seen.
      */}
      {isBusy && (
        <p
          role="status"
          className="mt-3 text-sm text-gray-500 dark:text-gray-400"
        >
          {t("uploading")}
        </p>
      )}

      {!isBusy && notice && (
        <p
          role="status"
          className="mt-3 rounded-2xl border border-success-200 bg-success-50 p-4 text-sm text-success-700 dark:border-success-800/60 dark:bg-success-500/10 dark:text-green-300"
        >
          {notice}
        </p>
      )}

      {!isBusy && error && (
        <p
          role="alert"
          className="mt-3 rounded-2xl border border-error-200 bg-error-50 p-4 text-sm text-error-700 dark:border-error-800/60 dark:bg-error-500/10 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
