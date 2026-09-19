import "./brand.css";

const brandAssets = {
  symbol: "/brand/rumbo-symbol.png",
  appIcon: "/brand/rumbo-app-icon.png",
  wordmark: "/brand/rumbo-wordmark-dark.png",
};

function BrandIcon({
  asset,
  size = 32,
  decorative = false,
  label = "Rumbo",
  className = "",
  style,
  ...props
}) {
  return (
    <img
      {...props}
      src={brandAssets[asset]}
      alt={decorative ? "" : label}
      aria-hidden={decorative || undefined}
      width={typeof size === "number" ? size : 32}
      height={typeof size === "number" ? size : 32}
      className={`rumbo-brand-icon rumbo-brand-icon--${asset} ${className}`.trim()}
      style={{ width: size, height: size, ...style }}
      decoding="async"
      draggable={false}
      data-brand-asset={asset}
    />
  );
}

/** Use the approved standalone mark beside workspace names and product copy. */
export function RumboSymbol(props) {
  return <BrandIcon {...props} asset="symbol" />;
}

/** Use the approved rounded badge for browser, app, and shortcut identities. */
export function RumboAppIcon(props) {
  return <BrandIcon {...props} asset="appIcon" />;
}

/** The approved wordmark has an opaque background, retained in both themes. */
export function RumboWordmark({
  width = 244,
  decorative = false,
  label = "Rumbo",
  className = "",
  style,
  ...props
}) {
  return (
    <span
      {...props}
      className={`rumbo-wordmark ${className}`.trim()}
      style={{ width, ...style }}
      data-brand-asset="wordmark"
    >
      <img
        src={brandAssets.wordmark}
        alt={decorative ? "" : label}
        aria-hidden={decorative || undefined}
        width={1942}
        height={809}
        decoding="async"
        draggable={false}
      />
    </span>
  );
}
