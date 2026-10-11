# Troubleshooting

## The app does not start

Check the Node.js version first. The README requires Node.js 22.16+ or 24+. Install dependencies from the repository root and start the development server:

```bash
npm install
npm run dev
```

Open the local URL shown by the app; the README's default is `http://127.0.0.1:4174`.

## Tests or build fail

Run `npm test` and `npm run build` from the repository root. Keep the first complete error message and Node.js version when reporting a failure; redact paths or logs that contain private project data.

## Workspace or connection data is missing

The README identifies `.rumbo/rumbo.sqlite` as the workspace database and `.rumbo/integrations.private.json` as the local integration-credentials file. Check that the app is using the expected local workspace. Back up data before moving or replacing it; do not delete these files as a generic troubleshooting step.

## A provider or tool action is unavailable

Check connection readiness and the reviewed permissions/context in the app. A connected provider account is not automatically available to every agent or workflow; follow the app's permission and review flow.