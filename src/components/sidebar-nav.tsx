"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAVIGATION } from "@/lib/navigation";

/** Grouped navigation. Areas that are not built yet are shown, dimmed, and say so on their page. */
export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5">
      {NAVIGATION.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-xs text-muted">{group.label}</p>
          <ul>
            {group.sections.map((section) => {
              const href = `/${section.slug}`;
              const active = pathname === href;
              return (
                <li key={section.slug}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`block border-l-2 px-3 py-1.5 text-sm leading-snug transition-colors ${
                      active
                        ? "border-gold bg-raised text-bone"
                        : `border-transparent hover:bg-raised/60 hover:text-bone ${section.status === "live" ? "text-bone/90" : "text-muted"}`
                    }`}
                  >
                    {section.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
