# AERO-SPECTRA

Aero-Spectra is an offline-first, browser-based indoor environmental screening workstation. It brings five physics-informed labs into one responsive interface: optical aerosol reference scenarios, HVAC airflow estimation, clean-air mass balance, Fanger thermal comfort and CO exposure/alarm-cadence education.

## Run locally

```sh
npm ci
npm run dev
```

The Vite development server starts the standalone Python solver and proxies same-origin `/api` requests to it. Set `AERO_DISABLE_PYTHON_API=1` to disable that helper. To exercise the production-style SvelteKit route locally instead, run `AERO_USE_SVELTEKIT_API=1 npm run dev` (the Python helper and `/api` proxy are then bypassed). `src/routes/api/aero_environmental_solver/+server.js` is the deployable same-origin endpoint included by `adapter-vercel`; it runs the five JavaScript mirrors and optional audit sync. `api/aero_environmental_solver.py` remains the separately testable Python solver/reference endpoint, but adapter-vercel does not bundle root-level Python files into the SvelteKit deployment. The serverless optical response uses the UI's educational scattering envelope; the Python module retains the full Mie-series implementation.

Optional remote audit sync requires applying the private Supabase table migration at `supabase/migrations/20261124000000_aero_audit_sync.sql` and setting server-only environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the deployment. Keep the service-role key server-side only. Same-origin web sync needs no CORS setting; for a Capacitor Android build using the default `https://aero-spectra.vercel.app` API origin, allow the WebView origin with `AERO_ALLOWED_ORIGINS=https://localhost` (and configure `VITE_AERO_API_BASE_URL` as a GitHub Actions variable only if a different API origin is required). Without database configuration, audit records remain queued locally and the UI reports that sync is unavailable. A successful local build or mocked sync test does not verify a deployed Vercel project or an applied Supabase migration.

```sh
npm run check
npm run audit:zero-ts
npm test
npm run test:python
npm run build
```

The UI and scientific engines use pure JavaScript/Svelte; the repository intentionally contains no TypeScript source or `tsconfig.json`.

## Scientific and safety limits

- Camera scattering is an uncalibrated visual experiment, not a PM₂.₅/PM₁₀ counter. Particle mass needs calibrated optics and a known sample volume.
- Microphone-derived airflow is a geometry-based estimate, not a balometer or code-compliance measurement. Validate with a calibrated flow hood/anemometer.
- The CSTR, Fanger and COHb pages are models with stated assumptions. COHb output is not a blood test, the phone cannot detect carbon monoxide, and no alarm decoder replaces a listed smoke/CO alarm.
- If a CO alarm sounds or exposure is suspected: evacuate immediately to fresh air and call emergency services. Do not wait for this app.
- Environmental audit summaries are stored locally by default. Sync is optional; raw camera/audio media is not uploaded.

## Android package

Capacitor configuration and native Camera2 / AudioRecord / environmental-sensor plugins are under `android/`. The GitHub Actions workflow assembles a debug-keystore-signed release APK for testing and uploads it as a workflow artifact. A version tag such as `v1.21.0` also publishes the APK and SHA-256 checksum to GitHub Releases. Replace the debug signing configuration with a securely managed production key before app-store distribution.

When no built APK is available, the UI downloads a clearly labeled preview ZIP—not an installable package. The genuine release APK is linked when its versioned GitHub release exists.
