# Contributing

Read [README.md](README.md), the repository's [AGENTS.md](AGENTS.md), and the relevant design or product-status documents before changing behavior.

- Keep changes focused and preserve the product's local-first, human-reviewed permission boundaries.
- Do not make an agent or workflow execute a terminal command, external action, or credential-bearing request without the documented review and permission flow.
- Never commit workspace databases, integration credentials, provider keys, or user data. The README notes that local integration credentials are stored in `.rumbo/integrations.private.json` and are not encrypted.
- Add or update tests for behavior changes.

## Validate

Use the Node version required by the README (22.16+ or 24+), then run:

```bash
npm test
npm run build
```

In the pull request, summarize changed behavior, permission implications, and checks performed.