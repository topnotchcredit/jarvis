import type { ReactNode } from "react";

export function PageHeader({ title, lead, aside }: { title: string; lead?: string; aside?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-2xl sm:text-[1.75rem]">{title}</h1>
        {lead ? <p className="mt-2 text-muted">{lead}</p> : null}
      </div>
      {aside}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel border-dashed px-6 py-10">
      <h2 className="font-sans text-base font-semibold tracking-normal">{title}</h2>
      <div className="mt-2 max-w-xl text-sm text-muted">{children}</div>
    </div>
  );
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="panel divide-y divide-line/60" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-11" />
      ))}
    </div>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "alert" | "idle" | "gold" }) {
  const color = { ok: "bg-ok", alert: "bg-alert", idle: "bg-muted/50", gold: "bg-gold" }[tone];
  return <span className={`mr-2 inline-block h-2 w-2 rounded-full ${color}`} aria-hidden="true" />;
}

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
export function formatUtc(iso: string): string {
  return `${dateTime.format(new Date(iso))} UTC`;
}
