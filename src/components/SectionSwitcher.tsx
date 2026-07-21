"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AccountIcon,
  CheckIcon,
  ChevronDownIcon,
  IssuesIcon,
  MachinesIcon,
  ProjectsIcon,
  ScansIcon,
} from "./icons";

export type SectionKey = "projects" | "issues" | "scans" | "machines" | "account";

interface Section {
  key: SectionKey;
  label: string;
  path: string;
  Icon: React.ComponentType<{ size?: number }>;
}

const SECTIONS: Section[] = [
  { key: "projects", label: "Projects", path: "/projects", Icon: ProjectsIcon },
  { key: "issues",   label: "Issues",   path: "/issues",   Icon: IssuesIcon },
  { key: "scans",    label: "Scans",    path: "/scans",    Icon: ScansIcon },
  { key: "machines", label: "Machines", path: "/machines", Icon: MachinesIcon },
  { key: "account",  label: "Account",  path: "/account",  Icon: AccountIcon },
];

export default function SectionSwitcher({ current }: { current: SectionKey }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = SECTIONS.find((s) => s.key === current) ?? SECTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="section-switcher" ref={wrapRef}>
      <button
        type="button"
        className={`section-switcher-trigger${open ? " open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <active.Icon size={18} />
        <span className="section-switcher-label">{active.label}</span>
        <ChevronDownIcon size={14} />
      </button>
      {open && (
        <div className="section-switcher-menu" role="menu">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="menuitem"
              className={`section-switcher-item${s.key === current ? " active" : ""}`}
              onClick={() => {
                setOpen(false);
                if (s.key !== current) router.push(s.path);
              }}
            >
              <s.Icon size={18} />
              <span>{s.label}</span>
              <span className="section-switcher-check">
                {s.key === current && <CheckIcon size={16} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
