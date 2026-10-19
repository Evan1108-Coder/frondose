import "./brand.css";

const brandAssets = {
  symbol: "/brand/talvori-symbol.webp",
  appIcon: "/brand/talvori-app-icon.png",
};

function BrandIcon({
  asset,
  size = 32,
  decorative = false,
  label = "Talvori",
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
export function TalvoriSymbol(props) {
  return <BrandIcon {...props} asset="symbol" />;
}

/** Use the approved rounded badge for browser, app, and shortcut identities. */
export function TalvoriAppIcon(props) {
  return <BrandIcon {...props} asset="appIcon" />;
}

/** Live type keeps the wordmark sharp and readable in every theme. */
export function TalvoriWordmark({
  width = 244,
  decorative = false,
  label = "Talvori",
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
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      <img
        src={brandAssets.symbol}
        alt=""
        width={64}
        height={64}
        decoding="async"
        draggable={false}
      />
      <span aria-hidden="true">Talvori</span>
    </span>
  );
}
