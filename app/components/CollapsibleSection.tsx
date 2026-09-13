"use client";

import { useState } from "react";

export interface CollapsibleSectionProps {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * The Figma "Detail view"'s collapsible "⚙️ Customize parameters" disclosure,
 * factored out as a small reusable wrapper since both /usecases/[id]
 * (StartScenarioForm, pre-Start) and /lists/[id] (ListWorkspace, persisted)
 * wrap the same `ScenarioSlotEditor` in one of these.
 */
export default function CollapsibleSection({ title, icon, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm font-semibold text-ink active:scale-[0.98]"
      >
        <span>
          {icon ? `${icon} ` : ""}
          {title}
        </span>
        <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="fade-in mt-2.5">{children}</div>}
    </div>
  );
}
