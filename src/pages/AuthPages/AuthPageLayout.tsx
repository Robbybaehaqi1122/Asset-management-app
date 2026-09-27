import GridShape from "@/components/common/GridShape";
import ThemeTogglerTwo from "@/components/common/ThemeTogglerTwo";
import React from "react";
import { Link } from "react-router";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative z-1 bg-white p-6 sm:p-0 dark:bg-gray-900">
      <div className="relative flex h-screen w-full flex-col justify-center sm:p-0 lg:flex-row dark:bg-gray-900">
        {children}
        <div className="hidden h-full w-full items-center bg-brand-950 lg:grid lg:w-1/2 dark:bg-white/5">
          <div className="relative z-1 flex items-center justify-center">
            <GridShape />

            <div className="flex max-w-xs flex-col items-center">
              <Link to="/" className="mb-5 block">
                {/* On a white plate rather than straight onto the panel. The
                    panel is `bg-brand-950` in light mode — a very dark navy —
                    and this wordmark is dark navy too, so without the plate the
                    text would sit at near-zero contrast against it and simply
                    disappear. The plate also means one image works in both
                    themes, where the template's own `auth-logo.svg` was white
                    text and had to be. */}
                <div className="flex justify-center rounded-2xl bg-white px-5 py-4">
                  {/* 425x160, so 231x87 is the real aspect. The template's
                      231x48 was for a 4.8:1 mark; keeping the old height here
                      would have squashed the wordmark. Width/height are set so
                      the browser reserves the box before the image loads, which
                      is what stops the panel shifting as it arrives. */}
                  <img
                    width={231}
                    height={87}
                    src="/images/logo/logo-pgt.png"
                    alt="Patimban Global Gateway Terminal"
                  />
                </div>
              </Link>

              {/* The product name, replacing the template's line about being a
                  free open-source Tailwind dashboard. `text-lg` rather than the
                  size it used to inherit: it is now the only text on the panel,
                  and inheriting made its size depend on the body rule. */}
              <p className="text-center text-lg font-semibold text-white/90 dark:text-white/80">
                Asset Management PGT
              </p>
            </div>
          </div>
        </div>

        <div className="fixed inset-e-6 bottom-6 z-50 hidden sm:block">
          <ThemeTogglerTwo />
        </div>
      </div>
    </div>
  );
}
