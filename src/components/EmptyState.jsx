import { Archive, BookOpen, MessageCircle, Clock, Folder, GitBranch, Search, Bot, Terminal, Inbox, Users } from "./icons.jsx";
import "./empty-state.css";
import { emptyArtCatalog, emptyArtAliases } from './empty-art-catalog.jsx';

const iconKinds = new Map([
  [Archive, "archive"],
  [BookOpen, "memory"],
  [MessageCircle, "chats"],
  [Clock, "work"],
  [Folder, "projects"],
  [GitBranch, "routes"],
  [Search, "search"],
  [Bot, "agents"],
  [Terminal, "work"],
  [Inbox, "inbox"],
  [Users, "teams"],
]);

// Each illustration shares the same directional line language, not an icon tile.
const illustrations = {
  ...emptyArtCatalog,
  teams: (
    <>
      <circle className="empty-art-back" cx="72" cy="48" r="20" />
      <circle className="empty-art-mid" cx="163" cy="48" r="20" />
      <circle cx="117" cy="90" r="24" />
      <path className="empty-art-back" d="M32 110v-8c0-20 16-32 40-32m131 40v-8c0-20-16-32-40-32" />
      <path d="M73 150v-8c0-21 17-29 44-29s44 8 44 29v8M39 137h18m117 0h38m-11-11 11 11-11 11" />
    </>
  ),
  routes: (
    <>
      <path className="empty-art-back" d="m115 20 46 21a6 6 0 0 1 3 5v44l-48-22a6 6 0 0 1-3-5V24q0-5 2-4Z" />
      <path className="empty-art-mid" d="m64 55 46 21a6 6 0 0 1 3 5v44q0 5-4 3L65 108a6 6 0 0 1-3-5V59q0-5 2-4Z" />
      <path d="m23 91 46 21a6 6 0 0 1 3 5v44q0 5-4 3L24 144a6 6 0 0 1-3-5V95q0-5 2-4Z" />
      <path d="M73 150h18c37 0 40-44 73-44h49M136 78c17 8 14 18 40 18h49m-13-13 13 13-13 13" />
    </>
  ),
  projects: (
    <>
      <path className="empty-art-back" d="M63 40V25a6 6 0 0 1 6-6h39l13 15h57a6 6 0 0 1 6 6v75" />
      <path className="empty-art-mid" d="M39 67V48a6 6 0 0 1 6-6h39l13 15h57a6 6 0 0 1 6 6v81" />
      <path d="M25 72h41l13 15h58a6 6 0 0 1 6 6v55a6 6 0 0 1-6 6H25a6 6 0 0 1-6-6V78a6 6 0 0 1 6-6Z" />
      <path d="M46 123h49c40 0 45-24 78-24h44m-13-13 13 13-13 13" />
      <circle cx="40" cy="123" r="6" />
    </>
  ),
  chats: (
    <>
      <path className="empty-art-back" d="M83 26h113a9 9 0 0 1 9 9v66a9 9 0 0 1-9 9h-14v20l-27-20h-29M83 26a9 9 0 0 0-9 9v13" />
      <path d="M29 54h117a9 9 0 0 1 9 9v65a9 9 0 0 1-9 9H70l-30 21v-21H29a9 9 0 0 1-9-9V63a9 9 0 0 1 9-9Z" />
      <path className="empty-art-mid" d="M44 80h78M44 96h51" />
      <path d="M82 114h31c27 0 33-28 58-28h26m-10-10 10 10-10 10" />
    </>
  ),
  memory: (
    <>
      <path className="empty-art-back" d="M73 28V17h91l25 26v79h-20" />
      <path className="empty-art-mid" d="M51 48V34h91l25 26v85h-20" />
      <path d="M29 52h85l24 25v82H29V52Zm85 0v25h24M50 91h51M50 106h37" />
      <circle cx="59" cy="134" r="6" />
      <path d="M65 134h32c41 0 39-34 72-34h41m-12-12 12 12-12 12" />
    </>
  ),
  work: (
    <>
      <path className="empty-art-back" d="M48 37V21h162v101h-18" />
      <rect x="24" y="44" width="162" height="104" rx="6" />
      <path className="empty-art-mid" d="M24 66h162M36 55h2m8 0h2m8 0h2" />
      <path d="m44 90 14 12-14 12m29 0h19M128 92v26l23-13-23-13Z" />
      <path className="empty-art-mid" d="M86 148v14h94c20 0 29-16 29-31" />
      <path d="m199 137 10-10 10 10" />
    </>
  ),
  inbox: (
    <>
      <path className="empty-art-back" d="M63 72V26h91v57M80 45h52M80 59h33" />
      <path className="empty-art-mid" d="M48 84V50h-9L18 116m136-62h30l25 62" />
      <path d="M19 116h52l14 17h49l14-17h62v35a7 7 0 0 1-7 7H26a7 7 0 0 1-7-7v-35Z" />
      <path d="M109 74v36m-12-12 12 12 12-12" />
    </>
  ),
  agents: (
    <>
      <circle className="empty-art-back" cx="65" cy="36" r="17" />
      <circle cx="54" cy="104" r="24" />
      <circle className="empty-art-mid" cx="120" cy="143" r="17" />
      <path className="empty-art-back" d="M83 36h18c37 0 30 44 60 44h44" />
      <path className="empty-art-mid" d="M138 143h10c27 0 23-50 52-50" />
      <path d="M79 104h30c40 0 34-15 63-15h47m-13-13 13 13-13 13M47 99h14m-14 10h14" />
    </>
  ),
  archive: (
    <>
      <path className="empty-art-back" d="M70 36V20h112v97h-17" />
      <path className="empty-art-mid" d="M47 60V41h115v91h-17" />
      <path d="M25 84h130v66a7 7 0 0 1-7 7H32a7 7 0 0 1-7-7V84Zm-5-23h140v23H20V61Zm48 43h41" />
      <path d="M176 143c29-4 29-39 8-47m-3 13-3-17 17 3" />
    </>
  ),
  search: (
    <>
      <path className="empty-art-back" d="M22 44h88M22 62h59M22 119h65M22 137h96" />
      <circle cx="135" cy="81" r="43" />
      <path d="m166 112 38 38m-84-68h30m-10-10 10 10-10 10" />
    </>
  ),
};

export const EMPTY_ART_KINDS = Object.freeze(Object.keys(illustrations));
export function resolveEmptyArtKind(kind) {
  const resolved = emptyArtAliases[kind] ?? kind;
  return Object.hasOwn(illustrations, resolved) ? resolved : 'overview';
}

export function EmptyIllustration({ kind = "overview" }) {
  const resolved = resolveEmptyArtKind(kind);
  return (
    <svg
      className="empty-illustration"
      data-empty-kind={resolved}
      viewBox="0 0 240 180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {illustrations[resolved]}
    </svg>
  );
}

export function EmptyState({
  icon: Icon,
  kind,
  title,
  description,
  action,
  onAction,
  secondaryAction,
  onSecondaryAction,
  actionVariant,
  compact = false,
}) {
  const illustrationKind = kind ?? iconKinds.get(Icon) ?? "overview";
  return (
    <div className={`empty-state rumbo-empty ${compact ? "compact" : "page-empty"}`}>
      <div className="empty-art">
        <EmptyIllustration kind={illustrationKind} />
      </div>
      <div className="empty-copy">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {(action && onAction) || (secondaryAction && onSecondaryAction) ? (
          <div className="empty-actions">
            {action && onAction ? (
              <button
                className={`button ${actionVariant ?? (compact ? "secondary" : "primary")}`}
                type="button"
                onClick={onAction}
              >
                {action}
              </button>
            ) : null}
            {secondaryAction && onSecondaryAction ? (
              <button className="button secondary" type="button" onClick={onSecondaryAction}>
                {secondaryAction}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
