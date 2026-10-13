import { useTranslation } from "react-i18next";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import PrintSettingPanel from "../components/PrintSettingPanel";

/**
 * System Setting: the screens that configure how this installation behaves.
 *
 * ## It is a group of one, and that is not a placeholder
 *
 * The first sub-item is **Print Setting**, which now holds the real panel — see
 * `PrintSettingPanel.tsx`. **The group was built before its content**, for the same
 * reason `blank.svg` exists in the icon set: a submenu with a single entry is how a
 * second setting gets added without anyone having to decide where it belongs first, and
 * it makes the route real rather than described.
 *
 * What it is *not*: `/asset-settings` already exists and already owns the reference data
 * that feeds the asset form's pickers. This is for settings that are **about the
 * installation** rather than about the inventory, so the two do not merge.
 *
 * **Not gated on the route**, same as `/users`, `/departments`, `/positions` and
 * `/asset-settings`: the page checks `useIsAdmin()` and renders a refusal. A second route
 * guard would be a second place to keep in sync without adding a single row of
 * enforcement.
 *
 * **`adminOnly` sits on the sidebar group rather than on the sub-item.** Everything
 * under System Setting is configuration, so the whole group disappears for a staff
 * member — which is the group-level flag's job, and is why a new sub-item added here
 * inherits the restriction without repeating it.
 */
export default function SystemSettingPage() {
  const { t } = useTranslation("common", { keyPrefix: "systemSetting" });
  const { isProfileLoading } = useAuth();
  const isAdmin = useIsAdmin();

  /**
   * Held while the profile is still arriving, because `useIsAdmin()` **fails closed**.
   *
   * Between the session resolving and the row landing, `profile` is `null` and the hook
   * says `false` — correct for a *write*, which is the reason it fails closed, but wrong
   * for a screen whose whole job is to say "you cannot be here". Flashing the refusal for
   * a frame would tell an admin they are not one.
   */
  if (isProfileLoading) {
    return (
      <div className="p-6">
        <PageMeta
          title={`${t("pageTitle")} | Asset Management App`}
          description={t("pageDescription")}
        />
        <PageBreadcrumb pageTitle={t("pageTitle")} />
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-gray-800 dark:bg-white/5 dark:text-gray-400">
          {t("checkingAccess")}
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <PageMeta
          title={`${t("pageTitle")} | Asset Management App`}
          description={t("pageDescription")}
        />
        <PageBreadcrumb pageTitle={t("pageTitle")} />
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-gray-800 dark:bg-white/5 dark:text-gray-400">
          {t("noAccess")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageMeta
        title={`${t("pageTitle")} | Asset Management App`}
        description={t("pageDescription")}
      />
      <PageBreadcrumb pageTitle={t("pageTitle")} />

      {/*
        The panel is its own component rather than a section of this file, because it is
        the first thing here with state, a service layer and an upload — a page that
        owns all three is a page nobody can read.
      */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/5">
        <PrintSettingPanel />
      </div>
    </div>
  );
}
