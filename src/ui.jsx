import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, LoaderCircle, Search, CircleAlert, CircleCheck, Circle, CircleDot, Clock, Minus } from "./components/icons.jsx";
import { STATUSES, RUN_STATUSES } from "./lib/model.js";
import { registerDialog } from "./components/dialog-manager.js";
import { Tooltip } from "./components/Tooltip.jsx";
import { UiIcon } from "./components/icons.jsx";
import { ServiceLogo } from './components/ServiceLogo.jsx';
import { useApp as useAppContext } from './app-context.js';
import { ErrorNotification } from './components/Notifications.jsx';
import { currentMotionPreference } from './lib/motion.js';

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
  return (
    <span className={`provider-icon ${large ? "large" : ""}`}>
      <ServiceLogo name={provider} />
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
  return <ErrorNotification error={error} />;
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
  const originRef = useRef(null);
  const backdropStart = useRef(false);
  const closeTimer = useRef(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  // Capture before the commit: a child autoFocus can already own focus by the
  // time this dialog's effect runs, and that child disappears when we close.
  const openerRef = useRef(typeof document === 'undefined' ? null : document.activeElement);
  const closeRef = useRef(onClose);
  const requestCloseRef = useRef(null);
  closeRef.current = onClose;
  const requestClose = () => {
    if (closingRef.current) return;
    const { fadeMs } = currentMotionPreference();
    if (!fadeMs || className.includes('command-dialog')) { closeRef.current(); return; }
    closingRef.current = true;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => closeRef.current(), fadeMs);
  };
  requestCloseRef.current = requestClose;
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    const origin = originRef.current, backdrop = ref.current?.closest('.dialog-backdrop');
    if (!origin || !backdrop) return;
    // Portals retain React context but not inherited CSS. Keep Area-specific
    // empty-state colors without copying scroll masks or freezing theme tokens.
    const inherited = origin.ownerDocument.defaultView.getComputedStyle(origin);
    for (const property of ['--empty-icon-color', '--empty-copy-color']) {
      const value = inherited.getPropertyValue(property);
      if (value) backdrop.style.setProperty(property, value);
      else backdrop.style.removeProperty(property);
    }
    const opener = openerRef.current?.getBoundingClientRect?.();
    const panel = ref.current?.getBoundingClientRect();
    if (opener && panel && opener.width && panel.width) {
      const x = Math.max(0, Math.min(panel.width, opener.left + opener.width / 2 - panel.left));
      const y = Math.max(0, Math.min(panel.height, opener.top + opener.height / 2 - panel.top));
      ref.current.style.transformOrigin = `${x}px ${y}px`;
    }
  });
  useEffect(() => {
    const previous = openerRef.current;
    const manager = registerDialog(ref.current);
    const focusable = () => [...(ref.current?.querySelectorAll(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
    ) ?? []), ...document.querySelectorAll('[data-rumbo-notifications] button')].filter((element) => element.getClientRects().length && !element.closest("[inert]") && element.tabIndex >= 0);
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
        requestCloseRef.current();
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
      if (manager.isTop() && !ref.current?.contains(event.target) && !event.target.closest?.('[data-rumbo-notifications]')) focusFirst();
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
  const dialog = (
    <div
      className="dialog-backdrop"
      data-closing={closing ? 'true' : undefined}
      onPointerDown={(event) => {
        backdropStart.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropStart.current && event.target === event.currentTarget) requestClose();
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
          <IconButton label="Close dialog" onClick={requestClose}>
            <X />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
  // A fixed overlay still clips inside a masked or transformed ancestor.
  // Mount at the viewport root so scroll fades remain local to their surface.
  return typeof document === 'undefined' ? dialog : <><span hidden aria-hidden="true" ref={originRef} data-dialog-origin="" />{createPortal(dialog, document.body)}</>;
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
