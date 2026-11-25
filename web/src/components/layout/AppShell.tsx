"use client";

import { BrandMark } from "@/components/shared/BrandMark";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ANALYZE_ENABLED } from "@/lib/features";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Flame,
  Images,
  LayoutDashboard,
  LibraryBig,
  History,
  ImageUp,
  Menu,
  Palette,
  ScrollText,
  Settings,
  Sparkles,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "./ThemeToggle";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { SidebarFolders } from "@/components/folders/SidebarFolders";
import { SystemApi } from "@/api/system.api";
import { usd } from "@/lib/catalog";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  accent?: "iris" | "flame";
}

const NAV: { section?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/create", label: "Create", icon: WandSparkles, accent: "iris" },
      { href: "/flows", label: "Flows", icon: Workflow, accent: "iris" },
      { href: "/prompts", label: "Prompts", icon: ScrollText },
    ],
  },
  {
    section: "Library",
    items: [
      { href: "/ads", label: "My Ads", icon: Images },
      { href: "/uploads", label: "Uploads", icon: ImageUp },
      { href: "/templates", label: "Templates", icon: LibraryBig },
      { href: "/brand-kit", label: "Brand Kit", icon: Palette },
      { href: "/history", label: "History", icon: History },
    ],
  },
  ...(ANALYZE_ENABLED
    ? [{ section: "Tools", items: [{ href: "/analyze", label: "Analyze an ad", icon: Flame, accent: "flame" } as NavItem] }]
    : []),
  {
    section: "Account",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/create") return pathname.startsWith("/create") || pathname.startsWith("/generations");
  if (href === "/analyze") return pathname.startsWith("/analyze") || pathname.startsWith("/analyses");
  return pathname.startsWith(href);
}

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
      <BrandMark className="h-8 w-8 shrink-0" />
      <span className="font-display text-lg font-bold tracking-tight text-foreground">
        BackdropAds
      </span>
    </Link>
  );
}

function SidebarCtas({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="space-y-2 border-b border-sidebar-border px-4 py-4">
      <Button asChild size="sm" className="w-full">
        <Link href="/create" onClick={onNavigate}>
          <WandSparkles className="mr-1.5 h-4 w-4" />
          Create new ad
        </Link>
      </Button>
    </div>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const groups = NAV;
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto scrollbar-thin px-3 py-5">
      {groups.map((group, gi) => (
        <Fragment key={gi}>
        <div className="space-y-0.5">
          {group.section && <p className="eyebrow mb-2 px-3">{group.section}</p>}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active && item.accent === "iris" && "text-iris",
                    active && item.accent === "flame" && "text-flame",
                    active && !item.accent && "text-foreground",
                    !active && "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                {item.label}
                {item.accent && (
                  <span
                    className={cn(
                      "ml-auto h-1.5 w-1.5 rounded-full opacity-0 transition-opacity",
                      active && "opacity-100",
                      item.accent === "iris" ? "bg-iris" : "bg-flame"
                    )}
                  />
                )}
              </Link>
            );
          })}
        </div>
        {group.section === "Library" && <SidebarFolders pathname={pathname} onNavigate={onNavigate} />}
        </Fragment>
      ))}
    </nav>
  );
}

/** Sidebar footer: what you've generated lately and roughly what it cost — or what's missing to get started. */
function UsageCard() {
  const system = useQuery({ queryKey: ["system"], queryFn: () => SystemApi.get(), staleTime: 60_000 });
  const s = system.data;
  if (!s) return null;
  const hasKey = s.providers.some((p) => p.configured);

  return (
    <div className="mx-3 mb-4 rounded-lg border border-border bg-card p-4">
      {s.mockMode ? (
        <>
          <p className="font-display text-sm font-semibold">Demo mode</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Results are placeholders. Nothing is sent to an AI provider.</p>
        </>
      ) : !hasKey ? (
        <>
          <p className="font-display text-sm font-semibold">Add an API key</p>
          <p className="mb-3 mt-1 text-xs leading-relaxed text-muted-foreground">Connect Google or OpenAI to start generating.</p>
          <Button asChild size="sm" className="w-full">
            <Link href="/settings?tab=system">Set up</Link>
          </Button>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <p className="font-display text-sm font-semibold">Last 30 days</p>
            <span className="font-mono text-[11px] text-muted-foreground" title="Estimated cost at your AI providers' list prices">
              ≈ {usd(s.totals.costUsd30d)}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {s.totals.images30d.toLocaleString()} {s.totals.images30d === 1 ? "image" : "images"} · {s.totals.videos30d.toLocaleString()}{" "}
            {s.totals.videos30d === 1 ? "video" : "videos"}. You pay your AI providers directly.
          </p>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <Logo />
        </div>
        <div className="px-3 pt-3">
          <WorkspaceSwitcher />
        </div>
        <SidebarCtas />
        <NavLinks pathname={pathname} />
        <UsageCard />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          {/* Mobile nav */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex h-16 items-center border-b border-sidebar-border px-4">
                <Logo />
              </div>
              <div className="px-3 pt-3">
                <WorkspaceSwitcher />
              </div>
              <SidebarCtas onNavigate={() => setMobileOpen(false)} />
              <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
              <UsageCard />
            </SheetContent>
          </Sheet>

          <div className="lg:hidden">
            <Logo />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild size="sm">
              <Link href="/create">
                <WandSparkles className="mr-1.5 h-4 w-4" />
                Create new ad
              </Link>
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
