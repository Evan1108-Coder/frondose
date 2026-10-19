# Security Policy

Talvori is a local-first AI work environment with provider connections, local workspace data, and reviewed tool workflows. Its README states that local integration credentials in `.rumbo/integrations.private.json` are not encrypted. Protect that file and the machine account that stores it.

## Reporting a vulnerability

Do not publish exploit details, credentials, or private workspace data in a public issue. Use GitHub's private vulnerability reporting for this repository if enabled; otherwise, contact the repository owner privately through GitHub with the affected commit, impact, and minimal reproduction steps.

## Safe handling

- Do not commit `.rumbo` workspace data, integration credentials, provider keys, or private project files.
- Review permissions and exact context before running a workflow or external action.
- Rotate credentials that may have been exposed.
- Do not treat the local-first prototype as a public multi-user service.