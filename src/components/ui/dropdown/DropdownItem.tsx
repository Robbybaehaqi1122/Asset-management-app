import type React from "react";
import { Link } from "react-router";

interface DropdownItemProps {
  tag?: "a" | "button";
  to?: string;
  /**
   * An absolute external URL, opened in a new tab.
   *
   * Separate from `to` because that renders a react-router `Link`, which
   * intercepts the click and tries to route — sending a `wa.me` link through it
   * would navigate inside the SPA instead of opening WhatsApp. `rel="noreferrer"`
   * because the destination is a third party and `target="_blank"` without it
   * hands that party a `window.opener` reference back to this page.
   */
  href?: string;
  onClick?: () => void;
  onItemClick?: () => void;
  baseClassName?: string;
  className?: string;
  children: React.ReactNode;
}

export const DropdownItem: React.FC<DropdownItemProps> = ({
  tag = "button",
  to,
  href,
  onClick,
  onItemClick,
  baseClassName = "block w-full text-start px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900",
  className = "",
  children,
}) => {
  const combinedClasses = `${baseClassName} ${className}`.trim();

  const handleClick = (event: React.MouseEvent) => {
    if (tag === "button") {
      event.preventDefault();
    }
    if (onClick) onClick();
    if (onItemClick) onItemClick();
  };

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={combinedClasses}
        onClick={handleClick}
      >
        {children}
      </a>
    );
  }

  if (tag === "a" && to) {
    return (
      <Link to={to} className={combinedClasses} onClick={handleClick}>
        {children}
      </Link>
    );
  }

  return (
    <button onClick={handleClick} className={combinedClasses}>
      {children}
    </button>
  );
};
