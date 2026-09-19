import { cloneElement, useEffect, useId, useRef, useState } from "react";
import { usePopupPosition } from "./usePopupPosition.js";
import "./tooltip.css";

export function Tooltip({ label, children, delay = 350 }) {
  const id = useId();
  const anchor = useRef(null);
  const timer = useRef(null);
  const [visible, setVisible] = useState(false);
  const position = usePopupPosition(visible, anchor, { width: Math.min(280, String(label ?? "").length * 7 + 24), height: 80 });
  function hide() {
    clearTimeout(timer.current);
    setVisible(false);
  }
  function schedule() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (label && anchor.current?.getAttribute("aria-expanded") !== "true") setVisible(true);
    }, delay);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!visible) return;
    function dismiss(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [visible]);
  const props = children.props;
  return <>{cloneElement(children, {
    ref: (element) => {
      anchor.current = element;
      if (typeof props.ref === "function") props.ref(element);
      else if (props.ref) props.ref.current = element;
    },
    title: undefined,
    "aria-describedby": [props["aria-describedby"], visible ? id : null].filter(Boolean).join(" ") || undefined,
    onPointerEnter: (event) => { props.onPointerEnter?.(event); if (event.pointerType !== "touch") schedule(); },
    onPointerLeave: (event) => { props.onPointerLeave?.(event); hide(); },
    onPointerDown: (event) => { props.onPointerDown?.(event); hide(); },
    onFocus: (event) => { props.onFocus?.(event); schedule(); },
    onBlur: (event) => { props.onBlur?.(event); hide(); },
  })}{visible ? <span role="tooltip" id={id} className="rumbo-tooltip" style={position ?? { visibility: "hidden" }}>{label}</span> : null}</>;
}
