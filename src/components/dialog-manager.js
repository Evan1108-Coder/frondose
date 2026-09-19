const dialogs = [];
const inertElements = new Map();
let bodyOverflow;
let documentOverflow;

function restoreInert() {
  for (const [element, previous] of inertElements) element.inert = previous;
  inertElements.clear();
}

function updateInert() {
  restoreInert();
  const top = dialogs.at(-1)?.element;
  if (!top) return;
  let current = top.closest(".dialog-backdrop") ?? top;
  while (current.parentElement && current !== document.body) {
    for (const sibling of current.parentElement.children) {
      if (sibling === current || ["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName)) continue;
      inertElements.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    current = current.parentElement;
  }
}

export function registerDialog(element) {
  const record = { element };
  if (!dialogs.length) {
    bodyOverflow = document.body.style.overflow;
    documentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }
  dialogs.push(record);
  updateInert();
  return {
    isTop: () => dialogs.at(-1) === record,
    remove() {
      const index = dialogs.indexOf(record);
      if (index >= 0) dialogs.splice(index, 1);
      updateInert();
      if (!dialogs.length) {
        document.body.style.overflow = bodyOverflow;
        document.documentElement.style.overflow = documentOverflow;
      }
    },
  };
}
