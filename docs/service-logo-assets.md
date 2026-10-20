# Service logo assets

Frondose imports individual SVG assets from `@iconify-icons/logos` (SVG Logos via Iconify, CC0-1.0). Source: https://github.com/gilbarbara/logos and https://iconify.design/ . Brand names and marks remain their respective owners' trademarks; their presence identifies a service and does not indicate endorsement or a working connection.

Only the selected assets are included in the client build. Codex uses the OpenAI company mark. Monochrome marks retain a white backing for contrast in either theme. Assets are not AI-generated approximations.

OpenRouter uses its monochrome mark from [Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/icons/openrouter.svg), distributed under CC0-1.0. The same bundled mark appears in AI Connections, Agent Studio and conversations.

`src/lib/service-brands.js` is the shared registry. `ServiceLogo` handles known services and explicit web-resource URLs. Unknown websites request `/favicon.ico` directly from that origin, without resource paths, queries or referrers being forwarded; failure displays a link glyph. Some sites do not expose that conventional favicon, so an unknown site's logo cannot be guaranteed. This does not crawl arbitrary pages or use a third-party logo lookup service.
