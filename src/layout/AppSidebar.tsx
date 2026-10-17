import { useSidebar } from "@/context/SidebarContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { ChevronDownIcon, HorizontaLDots } from "../icons";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMenuAccess } from "@/modules/permissions/useMenuAccess";
import type { NavItem } from "./navItems";
import { visibleNavItems } from "./navItems";
import { cn } from "../utils";

/**
 * Which render pass a row belongs to.
 *
 * Stays here rather than in `navItems.tsx`: it describes how the sidebar paints the
 * menu, not what the menu contains, and the command palette has no notion of it.
 */
type MenuGroup = "main" | "others";

type OpenSubmenu = { type: MenuGroup; index: number };

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered, setIsMobileOpen } =
    useSidebar();
  const { t } = useTranslation();
  const location = useLocation();
  const isAdmin = useIsAdmin();
  const { profile } = useAuth();

  /**
   * The reader's own unit, from the department on their profile row.
   *
   * **Trimmed, and compared as-is otherwise.** The unit strings in `navItems` are the
   * pinned `IT`/`HSSE` pair, which is also what `getCategoryUnits()` returns for those
   * two, so the comparison is between identical strings. A member of a department that
   * has no asset route sees neither asset row, which is honest: there is nothing for them
   * to open.
   */
  const readerUnit = profile?.department?.name.trim() ?? null;
  /**
   * Per-person menu overrides from `user_menu_permissions`.
   *
   * Read through the hook rather than inlined here, so this file does not carry its own
   * copy of the "is admin, then everything" rule — the same rule the pages consult when
   * they ask whether to render a write button. See `useMenuAccess` for why two
   * consumers fetching independently is a deliberate trade rather than a missing context.
   */
  const { access: menuAccess } = useMenuAccess();
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {},
  );
  // index null berarti pengguna menutup submenu yang terbuka secara default.
  const [manualSubmenu, setManualSubmenu] = useState<{
    path: string;
    type: MenuGroup;
    index: number | null;
  } | null>(null);
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /**
   * Filtered once, here, and through the shared predicate.
   *
   * **Not during render, and not inline any more.** Filtering inside the `map` would
   * shift the indices this file's submenu state is keyed by, so the open marker would
   * point at the wrong row. And the predicate itself lives in `navItems.tsx` because
   * `CommandPalette` has to reach exactly these destinations — two copies of this rule
   * would let the palette offer a screen the sidebar refuses to draw.
   *
   * `canViewMenu` is passed in rather than read from the hook here, because the hook is
   * a hook and this module is plain data.
   */
  const visibleItems = useMemo(
    () =>
      visibleNavItems({
        isAdmin,
        readerUnit,
        canViewMenu: (key: string) => menuAccess(key).canView,
      }),
    [isAdmin, readerUnit, menuAccess],
  );

  // Auto-close sidebar on mobile after route change
  useEffect(() => {
    if (isMobileOpen) {
      setIsMobileOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // const isActive = (path: string) => location.pathname === path;
  const isActive = useCallback(
    (path: string) => location.pathname === path,
    [location.pathname],
  );

  // Submenu yang memuat route aktif terbuka secara default. Diturunkan saat
  // render, bukan disimpan, supaya tidak ada setState di dalam effect.
  let openSubmenu: OpenSubmenu | null = null;
  for (let index = 0; index < visibleItems.length; index += 1) {
    if (
      visibleItems[index].subItems?.some((subItem) => isActive(subItem.path))
    ) {
      openSubmenu = { type: "main", index };
      break;
    }
  }

  // Toggle manual menimpa hasil turunan di atas, tapi hanya selama pathname
  // tidak berubah. Begitu navigasi, keadaan kembali mengikuti route.
  if (manualSubmenu?.path === location.pathname) {
    openSubmenu =
      manualSubmenu.index === null
        ? null
        : { type: manualSubmenu.type, index: manualSubmenu.index };
  }

  // openSubmenu adalah objek baru tiap render, jadi effect tidak boleh
  // bergantung padanya langsung: kunci string-nya yang dipakai supaya effect
  // hanya jalan saat submenu benar-benar berganti. Updater di bawah juga
  // mengembalikan state lama kalau tinggi tidak berubah, supaya tidak
  // memicu render berulang.
  const openSubmenuKey = openSubmenu
    ? `${openSubmenu.type}-${openSubmenu.index}`
    : null;

  useEffect(() => {
    if (openSubmenuKey === null) return;
    const element = subMenuRefs.current[openSubmenuKey];
    if (!element) return;
    const height = element.scrollHeight || 0;
    setSubMenuHeight((prev) =>
      prev[openSubmenuKey] === height
        ? prev
        : { ...prev, [openSubmenuKey]: height },
    );
  }, [openSubmenuKey]);

  const handleSubmenuToggle = (index: number, menuType: MenuGroup) => {
    const isClosing =
      manualSubmenu?.path === location.pathname &&
      manualSubmenu.type === menuType &&
      manualSubmenu.index === index;
    setManualSubmenu({
      path: location.pathname,
      type: menuType,
      index: isClosing ? null : index,
    });
  };

  const renderMenuItems = (items: NavItem[], menuType: MenuGroup) => (
    <ul className="flex flex-col gap-1">
      {items.map((nav, index) => {
        const isOpen =
          openSubmenu?.type === menuType && openSubmenu?.index === index;
        const showLabel = isExpanded || isHovered || isMobileOpen;
        const label = nav.key ? t(`sidebar.items.${nav.key}`) : nav.name;

        // Placeholder entry: visible so the intended landing spot for future
        // features is obvious, but not interactive and not a dead link.
        if (nav.disabled) {
          return (
            <li key={nav.name}>
              <div
                aria-disabled="true"
                className="menu-item cursor-not-allowed menu-item-inactive opacity-60"
              >
                <span className="menu-item-icon-inactive">{nav.icon}</span>
                {showLabel && <span>{label}</span>}
              </div>
            </li>
          );
        }

        return (
          <li key={nav.name}>
            {nav.subItems ? (
              <button
                onClick={() => handleSubmenuToggle(index, menuType)}
                className={`group menu-item ${
                  isOpen ? "menu-item-active" : "menu-item-inactive"
                } cursor-pointer ${
                  !isExpanded && !isHovered
                    ? "xl:justify-center"
                    : "xl:justify-start"
                }`}
              >
                <span
                  className={
                    isOpen ? "menu-item-icon-active" : "menu-item-icon-inactive"
                  }
                >
                  {nav.icon}
                </span>

                {showLabel && <span>{label}</span>}
                {showLabel && (
                  <ChevronDownIcon
                    className={`ms-auto h-5 w-5 transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-brand-500" : ""
                    }`}
                  />
                )}
              </button>
            ) : (
              nav.path && (
                <Link
                  to={nav.path}
                  target={nav.target}
                  className={`group menu-item ${
                    isActive(nav.path)
                      ? "menu-item-active"
                      : "menu-item-inactive"
                  }`}
                >
                  <span
                    className={
                      isActive(nav.path)
                        ? "menu-item-icon-active"
                        : "menu-item-icon-inactive"
                    }
                  >
                    {nav.icon}
                  </span>
                  {showLabel && <span>{label}</span>}
                </Link>
              )
            )}
            {nav.subItems && showLabel && (
              <div
                ref={(el) => {
                  subMenuRefs.current[`${menuType}-${index}`] = el;
                }}
                className="overflow-hidden transition-all duration-300"
                style={{
                  height: isOpen
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
                }}
              >
                <ul className="ms-9 mt-2 space-y-1">
                  {nav.subItems.map((subItem) => (
                    <li key={subItem.name}>
                      <Link
                        to={subItem.path}
                        target={subItem.target}
                        className={`menu-dropdown-item ${
                          isActive(subItem.path)
                            ? "menu-dropdown-item-active"
                            : "menu-dropdown-item-inactive"
                        }`}
                      >
                        {subItem.key
                          ? t(`sidebar.items.${subItem.key}`)
                          : subItem.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <aside
      className={cn(
        "fixed inset-s-0 top-0 z-50 flex h-screen flex-col border-e border-gray-200 bg-white px-5 text-gray-900 transition-all duration-300 ease-in-out xl:translate-x-0 xl:rtl:translate-x-0 dark:border-gray-800 dark:bg-gray-900",
        isExpanded || isMobileOpen ? "w-72.5" : isHovered ? "w-72.5" : "w-22.5",
        isMobileOpen
          ? "translate-x-0"
          : "-translate-x-full rtl:translate-x-full",
      )}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={cn(
          "flex py-8",
          !isExpanded && !isHovered ? "xl:justify-center" : "justify-start",
        )}
      >
        <Link to="/">
          {isExpanded || isHovered || isMobileOpen ? (
            /* One image, not a light and a dark variant. The PGT wordmark is
               dark navy on transparent, so it reads directly on this panel in
               light mode (`bg-white`) and needs a white plate only in dark mode
               (`dark:bg-gray-900`), which is why the plate is `dark:bg-white`
               rather than unconditional — on the light sidebar it would be
               invisible anyway. Same reason the login panel needed one.
               425x160, so 150x56 is the real aspect. */
            <div className="flex items-center rounded-xl py-1 dark:bg-white">
              <img
                src="/images/logo/logo-pgt.png"
                alt="Patimban Global Gateway Terminal"
                width={150}
                height={56}
              />
            </div>
          ) : (
            /* Collapsed the panel is `w-22.5` — about 50px of usable width once
               the padding is taken, and the wordmark at that size is unreadable.
               So the emblem is cropped out of the same file rather than keeping a
               second asset: `h-10` scales the 2.66:1 image to 40px tall, and
               `w-8` keeps only the left 32px of the resulting ~106px, which is
               the mark and stops just short of the first letter.

               That boundary is a property of *this* image, not of the component:
               the emblem ends at about 26% of the width, and a replacement logo
               with a different proportion would be clipped at the wrong place. If
               that happens, give this state its own square asset instead of
               retuning the number. */
            <div className="flex size-10 items-center justify-center overflow-hidden rounded-xl dark:bg-white">
              <img
                src="/images/logo/logo-pgt.png"
                alt="Patimban Global Gateway Terminal"
                className="h-10 w-8 object-cover object-left"
              />
            </div>
          )}
        </Link>
      </div>

      <div className="no-scrollbar flex flex-col overflow-y-auto duration-300 ease-linear">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2
                className={`mb-4 flex text-xs leading-5 text-gray-400 uppercase ${
                  !isExpanded && !isHovered
                    ? "xl:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  t("sidebar.groups.menu")
                ) : (
                  <HorizontaLDots className="size-6" />
                )}
              </h2>
              {renderMenuItems(visibleItems, "main")}
            </div>
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;
