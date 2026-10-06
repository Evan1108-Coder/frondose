import { useRef } from 'react';

export function SidebarPagePreview({ geometry, onChange, onOpen, onExit }) {
  const drag = useRef(null);
  const start = (event, kind) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, xPointer: event.clientX, yPointer: event.clientY, ...geometry };
  };
  const move = event => {
    if (!drag.current) return;
    const start = drag.current;
    if (start.kind === 'move') onChange({ x: start.x + event.clientX - start.xPointer, y: start.y + event.clientY - start.yPointer, width: start.width });
    else onChange({ x: start.x, y: start.y, width: start.width + event.clientX - start.xPointer });
  };
  const end = () => { drag.current = null; };
  const moveKeys = event => {
    const step = event.shiftKey ? 60 : 20;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (delta) { event.preventDefault(); onChange({ x: geometry.x + delta[0], y: geometry.y + delta[1], width: geometry.width }); }
    if (event.key === 'Escape') { event.preventDefault(); onExit(); }
  };
  const resizeKeys = event => {
    if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      onChange({ x: geometry.x, y: geometry.y, width: geometry.width + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 24 : -24) });
    }
    if (event.key === 'Escape') { event.preventDefault(); onExit(); }
  };
  return <div className="sidebar-page-preview-controls" style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }} aria-label="Page preview">
    <button type="button" className="sidebar-page-preview-open" onClick={onOpen} aria-label="Open page at normal size"><span>Open page</span></button>
    <button type="button" className="sidebar-page-preview-move" aria-label="Move page preview. Use arrow keys to move; Shift moves faster." onPointerDown={event => start(event, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={moveKeys}>Move preview</button>
    <button type="button" className="sidebar-page-preview-resize" aria-label={`Resize page preview, ${geometry.width} pixels wide. Use arrow keys to resize.`} onPointerDown={event => start(event, 'resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={resizeKeys}>Resize</button>
  </div>;
}
