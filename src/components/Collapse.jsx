import { useLayoutEffect, useRef, useState } from "react";
import { currentMotionPreference, MOTION } from "../lib/motion.js";

// A deliberately bounded layout animation for navigation disclosures. It does
// not scale text, measure on every frame, or run on lists/live message content.
// CSS transitions retarget from the current rendered height on rapid reversal.
export function Collapse({ open, id, className = "", children }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const initialized = useRef(false);
  const [height, setHeight] = useState(open ? "auto" : 0);
  const [animate, setAnimate] = useState(false);
  useLayoutEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    const movement = currentMotionPreference().movement;
    setAnimate(movement);
    if (!movement) {
      setHeight(open ? "auto" : 0);
      return;
    }
    const from = outer.current.getBoundingClientRect().height;
    setHeight(from);
    let settle;
    const frame = requestAnimationFrame(() => {
      setHeight(open ? inner.current.scrollHeight : 0);
      settle = setTimeout(() => setHeight(open ? "auto" : 0), MOTION.disclosureMs + MOTION.disclosureLeadMs + 40);
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(settle); };
  }, [open]);
  return <div ref={outer} id={id} className="rumbo-collapse" data-open={open ? "true" : "false"}
    data-animate={animate ? "true" : "false"} aria-hidden={!open || undefined} inert={!open || undefined}
    style={{ height }}>
    <div ref={inner} className={`rumbo-collapse-content ${className}`}>{children}</div>
  </div>;
}
