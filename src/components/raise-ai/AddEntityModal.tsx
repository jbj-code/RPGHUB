// AddEntityModal.tsx
// Create a new fund or direct investment entity (local state until Supabase).

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Theme } from "../../theme";
import {
  THEME_DROPDOWN_OPTION_CLASS,
  getDropdownOptionStyle,
  getDropdownPanelStyle,
  getDropdownTriggerStyle,
  getFieldInputStyle,
  getModalBackdropStyle,
  getPrimaryActionButtonStyle,
  shadows,
  zIndex,
} from "../../theme";

export type RaiseFundRecord = {
  id: string;
  name: string;
  manager: string;
  currency: string;
  vintageYear: string;
};

export type RaiseDirectRecord = {
  id: string;
  name: string;
};

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
  { value: "CAD", label: "CAD" },
];

type AddEntityModalProps = {
  theme: Theme;
  open: boolean;
  mode: "fund" | "direct";
  onClose: () => void;
  onSaveFund: (fund: RaiseFundRecord) => void;
  onSaveDirect: (direct: RaiseDirectRecord) => void;
};

function makeId(): string {
  return crypto.randomUUID?.() ?? `raise-${Date.now()}`;
}

function EntityDropdown(props: {
  theme: Theme;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const { theme: t, value, options, onChange, open, setOpen } = props;
  const display = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ ...getDropdownTriggerStyle(t), width: "100%", margin: 0 }}
        aria-expanded={open}
      >
        <span style={{ flex: 1, textAlign: "left" }}>{display}</span>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
          expand_more
        </span>
      </button>
      {open && (
        <>
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, zIndex: zIndex.dropdownPortalBackdrop }}
            onClick={() => setOpen(false)}
          />
          <div style={{ ...getDropdownPanelStyle(t, "down"), zIndex: zIndex.dropdownPortal, minWidth: "100%" }}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={THEME_DROPDOWN_OPTION_CLASS}
                style={getDropdownOptionStyle(t, value === o.value)}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AddEntityModal({ theme: t, open, mode, onClose, onSaveFund, onSaveDirect }: AddEntityModalProps) {
  const [name, setName] = useState("");
  const [manager, setManager] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [vintageYear, setVintageYear] = useState("");
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setManager("");
    setCurrency("USD");
    setVintageYear("");
    setError(null);
  }, [open, mode]);

  const fieldLabel: CSSProperties = {
    display: "block",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: t.colors.textMuted,
    marginBottom: t.spacing(1),
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  if (!open) return null;

  function handleSave() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (mode === "fund") {
      onSaveFund({
        id: makeId(),
        name: name.trim(),
        manager: manager.trim(),
        currency,
        vintageYear: vintageYear.trim(),
      });
    } else {
      onSaveDirect({ id: makeId(), name: name.trim() });
    }
    onClose();
  }

  return (
    <div
      className="raise-ai-modal-backdrop"
      style={{
        ...getModalBackdropStyle(t, zIndex.modalBackdrop),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: t.spacing(4),
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="raise-ai-modal-panel"
        style={{
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.lg,
          border: `1px solid ${t.colors.border}`,
          boxShadow: shadows.modal,
          width: "100%",
          maxWidth: 440,
          padding: t.spacing(5),
          zIndex: zIndex.modal,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: `0 0 ${t.spacing(4)}`, fontSize: "1.125rem", fontWeight: t.typography.headingWeight }}>
          {mode === "fund" ? "Add fund" : "Add direct"}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(3) }}>
          <div>
            <span style={fieldLabel}>{mode === "fund" ? "Fund name" : "Direct name"}</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={getFieldInputStyle(t)} />
          </div>
          {mode === "fund" && (
            <>
              <div>
                <span style={fieldLabel}>Manager / GP</span>
                <input type="text" value={manager} onChange={(e) => setManager(e.target.value)} style={getFieldInputStyle(t)} />
              </div>
              <div>
                <span style={fieldLabel}>Currency</span>
                <EntityDropdown
                  theme={t}
                  value={currency}
                  options={CURRENCY_OPTIONS}
                  onChange={setCurrency}
                  open={currencyOpen}
                  setOpen={setCurrencyOpen}
                />
                <p style={{ margin: `${t.spacing(1)} 0 0`, fontSize: "0.75rem", color: t.colors.textMuted }}>
                  Schedules for this fund will use this currency for cost and fair value.
                </p>
              </div>
              <div>
                <span style={fieldLabel}>Vintage year</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="2021"
                  value={vintageYear}
                  onChange={(e) => setVintageYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  style={getFieldInputStyle(t)}
                />
              </div>
            </>
          )}
        </div>
        {error && (
          <p style={{ color: t.colors.danger, fontSize: "0.875rem", margin: `${t.spacing(3)} 0 0` }} role="alert">
            {error}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: t.spacing(2), marginTop: t.spacing(4) }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: `${t.spacing(2)} ${t.spacing(4)}`,
              borderRadius: t.radius.md,
              border: `1px solid ${t.colors.border}`,
              background: "transparent",
              cursor: "pointer",
              color: t.colors.textMuted,
              fontFamily: t.typography.fontFamily,
            }}
          >
            Cancel
          </button>
          <button type="button" onClick={handleSave} style={getPrimaryActionButtonStyle(t)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
