// AddScheduleMenu.tsx
// + menu: enter schedules or add fund/direct entities.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Theme } from "../../theme";
import {
  THEME_DROPDOWN_OPTION_CLASS,
  getDropdownOptionStyle,
  getDropdownPanelStyle,
  getPrimaryActionButtonStyle,
  zIndex,
} from "../../theme";

export type AddMenuAction =
  | { action: "schedule"; target: "fund" | "direct" }
  | { action: "entity"; target: "fund" | "direct" };

type AddScheduleMenuProps = {
  theme: Theme;
  onSelect: (item: AddMenuAction) => void;
};

const MENU_ITEMS: { item: AddMenuAction; label: string; icon: string; dividerBefore?: boolean }[] = [
  { item: { action: "schedule", target: "fund" }, label: "Fund", icon: "table" },
  { item: { action: "schedule", target: "direct" }, label: "Direct", icon: "table" },
  { item: { action: "entity", target: "fund" }, label: "Add fund", icon: "account_balance", dividerBefore: true },
  { item: { action: "entity", target: "direct" }, label: "Add direct", icon: "corporate_fare" },
];

export function AddScheduleMenu({ theme: t, onSelect }: AddScheduleMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const btnStyle: CSSProperties = {
    ...getPrimaryActionButtonStyle(t),
    width: 44,
    height: 44,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: t.radius.md,
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="raise-ai-add-btn"
        style={btnStyle}
        aria-label="Add"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>
          add
        </span>
      </button>
      {open && (
        <>
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, zIndex: zIndex.dropdownPortalBackdrop }}
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="raise-ai-add-menu-panel"
            style={{
              ...getDropdownPanelStyle(t, "down"),
              position: "absolute",
              right: 0,
              left: "auto",
              minWidth: 168,
              zIndex: zIndex.dropdownPortal,
            }}
          >
            {MENU_ITEMS.map(({ item, label, icon, dividerBefore }) => (
              <div key={`${item.action}-${item.target}`}>
                {dividerBefore && (
                  <div style={{ height: 1, backgroundColor: t.colors.border, margin: `${t.spacing(1)} 0` }} />
                )}
                <button
                  type="button"
                  role="menuitem"
                  className={THEME_DROPDOWN_OPTION_CLASS}
                  style={{
                    ...getDropdownOptionStyle(t, false),
                    display: "flex",
                    alignItems: "center",
                    gap: t.spacing(2),
                  }}
                  onClick={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: t.colors.primary }} aria-hidden>
                    {icon}
                  </span>
                  {label}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
