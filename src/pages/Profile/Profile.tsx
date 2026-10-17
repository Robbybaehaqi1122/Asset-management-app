import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import Badge from "@/components/ui/badge/Badge";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { avatarUrlFromPath } from "@/lib/avatar";
import { useTranslation } from "react-i18next";

import AvatarUploader from "./AvatarUploader";

/**
 * The signed-in user's own `profiles` row, with the avatar editable.
 *
 * Everything else here is read-only, and the comment that used to sit above this
 * component said so outright: "Everything here comes from the database except the email
 * and the avatar, which are the auth identity and have no column of their own." **That is
 * no longer true of the avatar** — `profiles.avatar_path` exists as of migration `03600`,
 * so the avatar is now the one thing on this screen that is both stored here and
 * writable here.
 *
 * `role` is still displayed rather than edited, and for the same reason as before:
 * `profiles_update_own` would allow a user to write their own row, and
 * `protect_profile_role` stops them changing `role` on it.
 *
 * The two identity fields remain sourced from `auth.users` rather than the row, because
 * PostgREST cannot reach that table at all — `profiles.email` is a copy, and the address
 * that actually authenticates the sign-in is not this screen's to change.
 */
export default function Profile() {
  const { t } = useTranslation("common", { keyPrefix: "profile" });
  const { language: locale } = useLanguage();
  const { user, profile, isProfileLoading, refreshProfile } = useAuth();
  const isAdmin = useIsAdmin();

  const email = user?.email ?? "";

  /**
   * The database reference first, `user_metadata` second.
   *
   * The order matters for the same reason it does in `UserDropdown`: metadata is
   * writable by the account holder through the auth API, so if it stayed the primary
   * source an upload would look like it had done nothing.
   */
  const avatarUrl =
    avatarUrlFromPath(profile?.avatar_path) ?? user?.user_metadata.avatar_url;

  const displayName = profile?.full_name || email || t("notSet");

  const memberSince = profile?.created_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
        new Date(profile.created_at),
      )
    : null;

  return (
    <div>
      <PageMeta
        title={`${t("pageTitle")} | Asset Management App`}
        description="Your account details and role in the Asset Management App"
      />
      <PageBreadcrumb pageTitle={t("pageTitle")} />

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/3">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <span className="size-20 shrink-0 overflow-hidden rounded-full">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="size-full object-cover"
              />
            ) : (
              <img src="/images/user/owner.png" alt={displayName} />
            )}
          </span>

          <div className="min-w-0 flex-1 text-center sm:text-start">
            <h3 className="truncate text-lg font-semibold text-gray-800 dark:text-white/90">
              {displayName}
            </h3>
            <p className="truncate text-sm text-gray-500 dark:text-gray-400">
              {email}
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {/* `useIsAdmin()` rather than reading `profile.role` inline, so the
                  rule and its fail-closed default stay in one place. Until the
                  row arrives this reads false and the badge shows the quieter
                  variant, which is the safe direction for anything role-shaped. */}
              <Badge
                color={isAdmin ? "primary" : "light"}
                variant={isAdmin ? "solid" : "light"}
              >
                {isAdmin ? t("roles.admin") : t("roles.staff")}
              </Badge>
            </div>
          </div>
        </div>

        {isProfileLoading ? (
          // Deliberately not the field list. Rendering it during the fetch would
          // print "Not set" for every value, which claims the data is missing
          // when in fact it has simply not arrived yet.
          <p className="mt-6 border-t border-gray-200 pt-6 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {t("loading")}
          </p>
        ) : (
          <>
            <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 border-t border-gray-200 pt-6 sm:grid-cols-2 dark:border-gray-800">
              <div className="min-w-0">
                <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {t("fullName")}
                </dt>
                <dd className="mt-1 truncate text-sm text-gray-800 dark:text-white/90">
                  {profile?.full_name ?? t("notSet")}
                </dd>
              </div>

              <div className="min-w-0">
                <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {t("email")}
                </dt>
                <dd className="mt-1 truncate text-sm text-gray-800 dark:text-white/90">
                  {email || t("notSet")}
                </dd>
              </div>

              <div className="min-w-0">
                <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {t("department")}
                </dt>
                <dd className="mt-1 truncate text-sm text-gray-800 dark:text-white/90">
                  {profile?.departmentName ?? t("notSet")}
                </dd>
              </div>

              <div className="min-w-0">
                <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {t("memberSince")}
                </dt>
                <dd className="mt-1 truncate text-sm text-gray-800 dark:text-white/90">
                  {memberSince ?? t("notSet")}
                </dd>
              </div>
            </dl>
          </>
        )}

        {/*
          The one writable thing on this screen.

          **Gated on `user?.id` rather than on the profile row**, because the uploader
          needs an id to build the storage path with — the first path segment *is* the
          id, which is what `avatars_objects_*_own_or_admin` checks. Rendering it with a
          null id would offer a control that could only ever be refused by the database.

          `refreshProfile` rather than local state, and for the documented reason: the
          profile row is cached in `AuthContext`, its `userId` has not changed, and the
          upload effect keys on exactly that — so nothing else would re-read the row and
          the new photo would not appear until a full reload. This is the same trap the
          self-demotion case needed it for.
        */}
        {!isProfileLoading && user?.id && (
          <AvatarUploader
            userId={user.id}
            currentPath={profile?.avatar_path ?? null}
            onSaved={() => void refreshProfile()}
          />
        )}
      </div>
    </div>
  );
}
