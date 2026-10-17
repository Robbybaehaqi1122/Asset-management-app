import { useAuth } from "@/context/AuthContext";
import { avatarUrlFromPath } from "@/lib/avatar";
import { useLanguage } from "@/context/LanguageContext";
import { useClickOutside } from "@/hooks/useClickOutside";

import { getLanguage, languages, type Locale } from "@/i18n/languages";
import { cn } from "@/utils";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { DropdownItem } from "../ui/dropdown/DropdownItem";

/**
 * The IT help desk, in international form.
 *
 * `wa.me` needs the country code and no punctuation at all — no `+`, no spaces,
 * no leading zero. `081180119800` becomes `6281180119800`; handing wa.me the
 * local form opens a chat to a number that does not exist, with no error.
 */
const IT_HELP_PHONE = "6281180119800";

export default function UserDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubDropdownOpen, setIsSubDropdownOpen] = useState(false);
  const subDropdownRef = useRef<HTMLLIElement>(null);
  const { t } = useTranslation();
  const { language: locale, setLanguage } = useLanguage();
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const currentLang = getLanguage(locale as Locale);
  const CurrentFlagIcon = currentLang.FlagIcon;

  // `profiles.full_name` adalah nilai yang dimiliki database. Yang lama,
  // `user_metadata.full_name`, cuma string yang client kirim saat signup dan
  // bisa berbeda dari row-nya, jadi tidak dipakai lagi. Email tetap aman
  // sebagai cadangan karena itu identitas auth-nya sendiri, bukan metadata.
  const displayName =
    profile?.full_name || user?.email || t("userDropdown.accountSettings");
  /**
   * The database reference first, `user_metadata` second.
   *
   * **The order is the whole point.** `user_metadata.avatar_url` is writable by any
   * signed-in user through `supabase.auth.updateUser`, and this component read it for its
   * whole life. If it stayed the primary source then uploading a photo would appear to
   * do nothing — the metadata value would simply keep winning — and the reader would
   * conclude the feature was broken rather than that two sources were racing.
   *
   * The metadata read stays as a fallback because it is still the only thing an account
   * created outside this app can have, and because deleting it would change what the
   * navbar shows for those accounts.
   */
  const avatarUrl =
    avatarUrlFromPath(profile?.avatar_path) ?? user?.user_metadata.avatar_url;
  const email = user?.email ?? "";

  /**
   * The pre-filled WhatsApp message: who is asking, then a blank line for them
   * to say what about.
   *
   * The identity part is assembled here rather than as one interpolated
   * template so the line breaks stay in code where they are visible. Newlines
   * inside a JSON value are easy to lose in a diff, and i18next would escape
   * them into the query string in a way nobody can review.
   *
   * The trailing space after the last label is the point of the whole thing:
   * WhatsApp puts the caret there, so the person continues typing into a
   * prefilled message instead of composing one from scratch and forgetting the
   * details. A `prompt()` dialog was the alternative and was rejected — it is a
   * blocking native dialog in the middle of a themed page, and it loses the
   * text if the user dismisses it.
   *
   * `profile` can be null while it is still loading, and a support request with
   * an empty name is worse than one that says so, so every field falls back to
   * the same "not set" the rest of the app uses.
   */
  const supportMessage = [
    t("userDropdown.helpRequest.greeting"),
    "",
    `${t("userDropdown.helpRequest.name")}: ${profile?.full_name || email || t("profile.notSet")}`,
    `${t("userDropdown.helpRequest.role")}: ${t(
      profile?.role === "admin" ? "users.roles.admin" : "users.roles.staff",
    )}`,
    `${t("userDropdown.helpRequest.department")}: ${profile?.departmentName || t("profile.notSet")}`,
    "",
    `${t("userDropdown.helpRequest.details")} `,
  ].join("\n");

  const supportHref = `https://wa.me/${IT_HELP_PHONE}?text=${encodeURIComponent(
    supportMessage,
  )}`;

  useClickOutside(subDropdownRef, () => {
    setIsSubDropdownOpen(false);
  });

  const handleSelectLanguage = (langId: Locale) => {
    setLanguage(langId);
    setIsSubDropdownOpen(false);
  };

  const handleSignOut = async () => {
    closeDropdown();
    try {
      await signOut();
      navigate("/signin", { replace: true });
    } catch (error) {
      // Sign-out rejected, so the session survives and `navigate` is skipped:
      // the user stays signed in on the page they were already on, which is
      // the safe direction to fail in. Swallowing it here stops it becoming an
      // unhandled rejection inside an event handler.
      //
      // There is no toast primitive in this repo, so the failure is still only
      // visible in the console. That gap is recorded in AGENTS.md rather than
      // solved by inventing a notification system as a side effect of a
      // one-line fix.
      console.error("Sign-out failed", error);
    }
  };

  const toggleDropdown = () => {
    setIsOpen((prev) => !prev);
    setIsSubDropdownOpen(false);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setIsSubDropdownOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={toggleDropdown}
        className="dropdown-toggle flex items-center text-gray-700 dark:text-gray-400"
      >
        <span className="me-3 h-11 w-11 shrink-0 overflow-hidden rounded-full">
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

        <span className="me-1 block max-w-30 truncate text-theme-sm font-medium">
          {displayName}
        </span>
        <svg
          className={`stroke-gray-500 transition-transform duration-200 dark:stroke-gray-400 ${
            isOpen ? "rotate-180" : ""
          }`}
          width="18"
          height="20"
          viewBox="0 0 18 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4.3125 8.65625L9 13.3437L13.6875 8.65625"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="absolute inset-e-0 mt-4.25 flex w-65 flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark"
      >
        <div>
          <span className="block truncate text-theme-sm font-medium text-gray-700 no-underline dark:text-gray-400">
            {displayName}
          </span>
          <span className="mt-0.5 block truncate text-theme-xs text-gray-500 no-underline dark:text-gray-400">
            {email}
          </span>
        </div>

        <ul className="flex flex-col gap-1 border-b border-gray-200 pt-4 pb-3 dark:border-gray-800">
          <li>
            <DropdownItem
              onItemClick={closeDropdown}
              tag="a"
              to="/profile"
              className="group flex items-center gap-3 rounded-lg px-3 py-2 text-theme-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              <svg
                className="fill-gray-500 group-hover:fill-gray-700 dark:fill-gray-400 dark:group-hover:fill-gray-300"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 3.5C7.30558 3.5 3.5 7.30558 3.5 12C3.5 14.1526 4.3002 16.1184 5.61936 17.616C6.17279 15.3096 8.24852 13.5955 10.7246 13.5955H13.2746C15.7509 13.5955 17.8268 15.31 18.38 17.6167C19.6996 16.119 20.5 14.153 20.5 12C20.5 7.30558 16.6944 3.5 12 3.5ZM17.0246 18.8566V18.8455C17.0246 16.7744 15.3457 15.0955 13.2746 15.0955H10.7246C8.65354 15.0955 6.97461 16.7744 6.97461 18.8455V18.856C8.38223 19.8895 10.1198 20.5 12 20.5C13.8798 20.5 15.6171 19.8898 17.0246 18.8566ZM2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12ZM11.9991 7.25C10.8847 7.25 9.98126 8.15342 9.98126 9.26784C9.98126 10.3823 10.8847 11.2857 11.9991 11.2857C13.1135 11.2857 14.0169 10.3823 14.0169 9.26784C14.0169 8.15342 13.1135 7.25 11.9991 7.25ZM8.48126 9.26784C8.48126 7.32499 10.0563 5.75 11.9991 5.75C13.9419 5.75 15.5169 7.32499 15.5169 9.26784C15.5169 11.2107 13.9419 12.7857 11.9991 12.7857C10.0563 12.7857 8.48126 11.2107 8.48126 9.26784Z"
                  fill=""
                />
              </svg>
              {t("userDropdown.profileDetail")}
            </DropdownItem>
          </li>
          {/* Support is not a page. It hands the browser a prefilled WhatsApp
              message to the IT help desk, so this is the one item here that is
              an external link rather than a route. */}
          <li>
            <DropdownItem
              onItemClick={closeDropdown}
              href={supportHref}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 text-theme-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              <svg
                className="fill-gray-500 group-hover:fill-gray-700 dark:fill-gray-400 dark:group-hover:fill-gray-300"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M3.5 12C3.5 7.30558 7.30558 3.5 12 3.5C16.6944 3.5 20.5 7.30558 20.5 12C20.5 16.6944 16.6944 20.5 12 20.5C7.30558 20.5 3.5 16.6944 3.5 12ZM12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM11.0991 7.52507C11.0991 8.02213 11.5021 8.42507 11.9991 8.42507H12.0001C12.4972 8.42507 12.9001 8.02213 12.9001 7.52507C12.9001 7.02802 12.4972 6.62507 12.0001 6.62507H11.9991C11.5021 6.62507 11.0991 7.02802 11.0991 7.52507ZM12.0001 17.3714C11.5859 17.3714 11.2501 17.0356 11.2501 16.6214V10.9449C11.2501 10.5307 11.5859 10.1949 12.0001 10.1949C12.4143 10.1949 12.7501 10.5307 12.7501 10.9449V16.6214C12.7501 17.0356 12.4143 17.3714 12.0001 17.3714Z"
                  fill=""
                />
              </svg>
              {t("userDropdown.support")}
            </DropdownItem>
          </li>
          <li className="relative" ref={subDropdownRef}>
            <button
              type="button"
              onClick={() => setIsSubDropdownOpen((prev) => !prev)}
              className={cn(
                "group flex max-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-theme-sm font-medium transition-colors",
                isSubDropdownOpen
                  ? "bg-gray-100 text-gray-900 dark:bg-white/5 dark:text-white"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300",
              )}
            >
              <span className="flex items-center gap-3 text-theme-sm">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M12.001 2.75C17.1091 2.75 21.2501 6.89178 21.2501 11.9999C21.2501 17.108 17.1091 21.2498 12.001 21.2498M12.001 2.75C6.89289 2.75 2.75195 6.89178 2.75195 11.9999C2.75195 17.108 6.8929 21.2498 12.001 21.2498M12.001 2.75C14.2097 2.75 16.0005 6.8914 16.0005 11.9993C16.0005 17.1073 14.2098 21.2498 12.001 21.2498M12.001 2.75C9.79226 2.75 8.00195 6.89141 8.00195 11.9994C8.00195 17.1073 9.79226 21.2498 12.001 21.2498M3.24561 8.99976H20.7544M3.24561 14.9998H20.7544"
                    stroke="#667085"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>

                <span>{t("userDropdown.language")}</span>
              </span>

              <span className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-theme-xs font-medium text-gray-700 dark:border-gray-800 dark:bg-white/3 dark:text-gray-300">
                <span>{currentLang.shortName}</span>
                <CurrentFlagIcon className="size-3.5 shrink-0 overflow-hidden rounded-full" />
              </span>
            </button>

            {isSubDropdownOpen && (
              <div className="absolute -inset-s-2 top-11 w-62.5 rounded-2xl border border-gray-200 bg-white p-2 shadow-theme-lg md:inset-s-auto md:inset-e-[calc(100%+14px)] md:top-0 dark:border-gray-800 dark:bg-gray-dark">
                <ul className="flex flex-col gap-1">
                  {languages.map((language) => {
                    const isSelected = locale === language.id;
                    const FlagIcon = language.FlagIcon;

                    return (
                      <li key={language.id}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectLanguage(language.id);
                            closeDropdown();
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-theme-sm font-medium transition-colors hover:text-gray-900 dark:text-gray-300 dark:hover:text-white",
                            isSelected
                              ? "bg-brand-50 dark:bg-brand-500/15"
                              : "hover:bg-gray-100 dark:hover:bg-white/5",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full transition-opacity",
                                isSelected
                                  ? "bg-brand-500 opacity-100 dark:bg-brand-400"
                                  : "opacity-0",
                              )}
                            />
                            <FlagIcon className="size-5 shrink-0 overflow-hidden rounded-full" />
                            <span className="truncate">{language.name}</span>
                          </span>

                          {language.badge && (
                            <span className="rounded bg-warning-50 px-1.5 py-0.5 text-theme-xs font-semibold text-warning-600 dark:bg-warning-500/15 dark:text-warning-400">
                              {language.badge}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </li>
        </ul>
        <button
          type="button"
          onClick={handleSignOut}
          className="group mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-theme-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
        >
          <svg
            className="fill-gray-500 group-hover:fill-gray-700 dark:group-hover:fill-gray-300"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M15.1007 19.247C14.6865 19.247 14.3507 18.9112 14.3507 18.497L14.3507 14.245H12.8507V18.497C12.8507 19.7396 13.8581 20.747 15.1007 20.747H18.5007C19.7434 20.747 20.7507 19.7396 20.7507 18.497L20.7507 5.49609C20.7507 4.25345 19.7433 3.24609 18.5007 3.24609H15.1007C13.8581 3.24609 12.8507 4.25345 12.8507 5.49609V9.74501L14.3507 9.74501V5.49609C14.3507 5.08188 14.6865 4.74609 15.1007 4.74609L18.5007 4.74609C18.9149 4.74609 19.2507 5.08188 19.2507 5.49609L19.2507 18.497C19.2507 18.9112 18.9149 19.247 18.5007 19.247H15.1007ZM3.25073 11.9984C3.25073 12.2144 3.34204 12.4091 3.48817 12.546L8.09483 17.1556C8.38763 17.4485 8.86251 17.4487 9.15549 17.1559C9.44848 16.8631 9.44863 16.3882 9.15583 16.0952L5.81116 12.7484L16.0007 12.7484C16.4149 12.7484 16.7507 12.4127 16.7507 11.9984C16.7507 11.5842 16.4149 11.2484 16.0007 11.2484L5.81528 11.2484L9.15585 7.90554C9.44864 7.61255 9.44847 7.13767 9.15547 6.84488C8.86248 6.55209 8.3876 6.55226 8.09481 6.84525L3.52309 11.4202C3.35673 11.5577 3.25073 11.7657 3.25073 11.9984Z"
              fill=""
            />
          </svg>
          {t("userDropdown.signOut")}
        </button>
      </Dropdown>
    </div>
  );
}
