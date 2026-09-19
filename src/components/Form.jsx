import { useId, useState } from "react";

// Browser constraints are useful; browser validation bubbles are not our UI.
export function Form({ children, onSubmit, onInput, ...props }) {
  const [error, setError] = useState(null);
  const errorId = useId();
  return <form {...props} noValidate onInput={(event) => { setError(null); onInput?.(event); }}
    onSubmit={(event) => {
      const form = event.currentTarget;
      const invalid = [...form.elements].find((field) => field.willValidate && !field.validity.valid)
        ?? form.querySelector('[role="combobox"][aria-required="true"][data-empty="true"]:not(:disabled)');
      if (invalid) {
        event.preventDefault();
        const label = invalid.getAttribute('aria-label') || invalid.labels?.[0]?.textContent || 'this field';
        const validity = invalid.validity;
        const message = validity?.customError ? invalid.validationMessage : validity?.typeMismatch ? `Enter a valid ${invalid.type === 'url' ? 'URL' : invalid.type} for ${label.toLowerCase()}.`
          : validity?.rangeUnderflow || validity?.rangeOverflow ? `Choose a value within the allowed range for ${label.toLowerCase()}.`
          : validity?.patternMismatch || validity?.badInput ? `Check the format of ${label.toLowerCase()}.`
          : `Complete ${label.toLowerCase()} before continuing.`;
        setError(message);
        invalid.focus();
        return;
      }
      setError(null);
      onSubmit?.(event);
    }}>
    {error ? <div id={errorId} className="inline-error form-validation-error" role="alert">{error}</div> : null}
    {children}
  </form>;
}
