import { useSidebar } from "@/context/SidebarContext";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import {
  BoxCubeIcon,
  CalenderIcon,
  ChevronDownIcon,
  HorizontaLDots,
} from "../icons";
import { cn } from "../utils";

type NavSubItem = {
  name: string;
  key?: string;
  path: string;
  target?: string;
};

type MenuGroup = "main" | "others";

type OpenSubmenu = { type: MenuGroup; index: number };

type NavItem = {
  name: string;
  key?: string;
  icon: React.ReactNode;
  path?: string;
  target?: string;
  subItems?: NavSubItem[];
  /** Renders as a non-interactive placeholder instead of a link or submenu. */
  disabled?: boolean;
};

const navItems: NavItem[] = [
  {
    icon: <CalenderIcon fontSize={24} />,
    name: "Calendar",
    key: "calendar",
    path: "/calendar",
  },
  {
    icon: <BoxCubeIcon fontSize={24} />,
    name: "Asset Management",
    key: "assetManagement",
    disabled: true,
  },
];

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered, setIsMobileOpen } =
    useSidebar();
  const { t } = useTranslation();
  const location = useLocation();
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
  for (let index = 0; index < navItems.length; index += 1) {
    if (navItems[index].subItems?.some((subItem) => isActive(subItem.path))) {
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
            <>
              <img
                className="dark:hidden"
                src="/images/logo/logo.svg"
                alt="Logo"
                width={150}
                height={40}
              />
              <img
                className="hidden dark:block"
                src="/images/logo/logo-dark.svg"
                alt="Logo"
                width={150}
                height={40}
              />
            </>
          ) : (
            <img
              src="/images/logo/logo-icon.svg"
              alt="Logo"
              width={32}
              height={32}
            />
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
              {renderMenuItems(navItems, "main")}
            </div>
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;
