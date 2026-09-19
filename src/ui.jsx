import { cloneElement, useEffect, useId, useRef, useState } from "react";
import { X, LoaderCircle, Search, CircleAlert, CircleCheck, Circle, CircleDot, Clock, Minus, Terminal, Sparkles, GitFork, HardDrive } from "./components/icons.jsx";
import { STATUSES, RUN_STATUSES } from "./lib/model.js";
import { registerDialog } from "./components/dialog-manager.js";
import { Tooltip } from "./components/Tooltip.jsx";
import { UiIcon } from "./components/icons.jsx";
import { useApp as useAppContext } from './app-context.js';

export { AppContext, useApp } from "./app-context.js";
export { EmptyState as Empty } from "./components/EmptyState.jsx";
export { SelectField as Select } from "./components/SelectField.jsx";
export function Button({
  children,
  icon: Icon,
  variant = "secondary",
  busy,
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      className={`button ${variant} ${className}`}
      {...props}
      disabled={props.disabled || busy}
    >
      {Icon || busy ? <UiIcon icon={busy ? LoaderCircle : Icon} className={busy ? "spin" : ""} interactive={!busy} /> : null}
      {children}
    </button>
  );
}
export function IconButton({ label, children, ...props }) {
  return (
    <Tooltip label={label}>
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      {...props}
    >
      {children}
    </button>
    </Tooltip>
  );
}
export function PageHeader({ title, description, children }) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="page-actions">{children}</div>
    </header>
  );
}
export function Status({ value, label, item }) {
  const app = useAppContext();
  const custom = item?.workflow_status_id ? app?.data.workspace_items?.find(s => s.id === item.workflow_status_id) : null;
  return (
    <span className={`status status-${value}`}>
      <span className="status-symbol">
        <UiIcon interactive={false} icon={["done", "completed", "connected", "ready_connected"].includes(value)
          ? CircleCheck : ["in_progress", "running"].includes(value) ? CircleDot
            : ["blocked", "needs_input", "failed"].includes(value) ? CircleAlert : value === "queued" ? Clock : Circle} />
      </span>
      {label ?? custom?.name ??
        STATUSES[value] ??
        RUN_STATUSES[value] ??
        String(value ?? "Not connected").replaceAll("_", " ")}
    </span>
  );
}
export function ProviderIcon({ provider, large }) {
  const Icon =
    provider === "github"
      ? GitFork
      : ["google-drive", "google_drive"].includes(provider)
        ? HardDrive
        : provider === "claude"
          ? Sparkles
          : Terminal;
  return (
    <span className={`provider-icon ${large ? "large" : ""}`}>
      <Icon />
    </span>
  );
}
export function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  label,
}) {
  return (
    <div className="search-field">
      <Search />
      <input
        type="search"
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
export function Field({ label, hint, children }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
    </div>
  );
}
export function ErrorMessage({ error }) {
  return error ? (
    <div className="inline-error" role="alert">
      <CircleAlert />
      <span>{typeof error === "string" ? error : error.message}</span>
    </div>
  ) : null;
}
export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(false);
  async function execute(callback) {
    if (ref.current) return;
    ref.current = true;
    setBusy(true);
    setError(null);
    try {
      return await callback();
    } catch (cause) {
      setError(cause);
      return undefined;
    } finally {
      ref.current = false;
      setBusy(false);
    }
  }
  return { busy, error, execute, setError };
}
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
  className = "",
}) {
  const ref = useRef(null);
  const backdropStart = useRef(false);
  // Capture before the commit: a child autoFocus can already own focus by the
  // time this dialog's effect runs, and that child disappears when we close.
  const openerRef = useRef(typeof document === 'undefined' ? null : document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = openerRef.current;
    const manager = registerDialog(ref.current);
    const focusable = () => [...(ref.current?.querySelectorAll(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
    ) ?? [])].filter((element) => element.getClientRects().length && !element.closest("[inert]") && element.tabIndex >= 0);
    const focusFirst = () => (ref.current?.querySelector('[autofocus], input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), [role="combobox"]:not(:disabled)') ?? focusable()[0] ?? ref.current)?.focus();
    const frame = requestAnimationFrame(() => { if (manager.isTop()) focusFirst(); });
    function onKey(event) {
      if (!manager.isTop() || event.defaultPrevented) return;
      if (event.key === "Escape") {
        // An authored select/calendar gets the first Escape. Its own handler
        // stops propagation, so a second Escape closes the containing dialog.
        if (ref.current?.querySelector("[data-rumbo-popup]")) return;
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function containFocus(event) {
      if (manager.isTop() && !ref.current?.contains(event.target)) focusFirst();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", containFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", containFocus);
      manager.remove();
      if (previous?.isConnected && !previous.closest?.("[inert]")) previous.focus?.();
    };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        backdropStart.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropStart.current && event.target === event.currentTarget) onClose();
        backdropStart.current = false;
      }}
    >
      <section
        className={`dialog ${wide ? "wide" : ""} ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="dialog-heading">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Toggle({ label, description, checked, onChange, disabled }) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <input
        className="toggle"
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        role="switch"
      />
    </label>
  );
}
export function Priority({ value }) {
  return (
    <span className={`priority priority-${value}`}>
      <span className="priority-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        {{ urgent: "Urgent", high: "High", medium: "Medium", low: "Low" }[
          value
        ] ?? "None"}
      </span>
    </span>
  );
}
