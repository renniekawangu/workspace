# B34ST Staff Workspace

A React + TypeScript staff workspace backed by Firebase Authentication and Cloud Firestore. The current release focuses on the secure staff shell, role-aware task visibility, staff directory, onboarding, announcements, administration and audit history.

## What's improved in this iteration

- Reworked the application shell into a desktop sidebar and responsive mobile navigation.
- Rebuilt the dashboard with live task totals, workload progress, quick links and published announcements.
- Added task status summary cards and status filtering.
- Scoped task reads to the signed-in employee, department managers, or administrators to match the Firestore authorization model. Firestore rules are authorization checks, not query filters; client queries must also be constrained to documents the user is allowed to read.
- Preserved the existing Firebase project configuration pattern and role names.

## Run locally

1. Copy `.env.example` to `.env.local` at this project root and fill in the Firebase web app values.
2. `npm install`
3. `npm run dev`

Run checks with `npm run lint`, `npm run typecheck`, and `npm test`. The project does not use Firebase emulators for local validation; verification is handled through the normal app build and test workflow.

## Local admin scripts

Set `FIREBASE_SERVICE_ACCOUNT_PATH` to a service-account JSON file held outside this repo (or use Application Default Credentials), then run:

`npm run create-user -- --email=person@example.test --name="Seed Person" --password="long-local-password"`

`npm run bootstrap-admin -- --email=admin@example.test`

`npm run disable-user -- --uid=UID --actor-id=ADMIN_UID`

Never put a real service-account key or real personal data in the repo or a shared ZIP archive.

## Placeholder seed data

After generating a replacement service-account key and saving it **outside** this repository, create a local admin and placeholder-only workspace data:

`FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/replacement-key.json npm run seed -- --admin-email=you@example.com --admin-password="a-long-unique-password"`

The command is idempotent for the seed documents and is intended only for initial/local setup. Replace seed data before staff use.

## Planned next phases

1. Full staff profiles and HR workflows (attendance, leave, onboarding/offboarding).
2. Task creation, assignment, due dates, comments, attachments and project milestones.
3. Leads, clients and business development pipeline.
4. Quotations, invoices and finance tracking.
5. Digital operations, content approvals and creative request workflows. (Implemented in Stage 7.)
6. Reporting, notifications, automation and production security review.

New modules should not be exposed as working navigation until their data model, UI, Firestore rules, indexes and tests are implemented together.

## Phase 3: attendance and leave

The workspace now includes attendance check-in/check-out and leave request/approval pages. Review `PHASE_3_UPDATE.md` and `DECISIONS.md` for policy assumptions, required employee `reportsTo` profile data, security boundaries, and pre-deployment checks.

## Phase 4: business development and client records

- Added an admin/bizops-only lead pipeline with manual capture, search, stage changes and follow-up dates.
- Added an admin/bizops-only client directory with searchable relationship records.
- Added restrictive Firestore rules for `leads` and `clients`; no delete access is granted. Lead updates are limited to pipeline stage changes, while client updates are role-restricted.
- Added client-side audit events for lead and client creation and lead stage changes.
- Digital operations, design and employee roles have no access to these records.

Before using live data, review retention policy, client data handling, and the required Firestore indexes. No real client data or sample identities are included.

## Stage 5 — Project delivery management

The Projects workspace provides a portfolio view for authorised business managers and a member-scoped view for assigned staff. Admin and BizOps users can create projects, link an existing client, set a delivery manager and team member UIDs, set dates and priority, change project status, and maintain milestone checklists. Project members can view projects assigned to them. Progress is calculated from completed milestones; projects with no milestones show 0% unless marked completed.

Before deployment, publish the updated `firebase/firestore.rules` and `firebase/firestore.indexes.json`. Project creation currently accepts Firebase Auth UIDs for the manager and additional team members; include each intended viewer's UID in the team member field so Firestore can enforce project visibility. Client linking is optional. Project documents are retained (deletion is denied) and changes are audit logged.

## Stage 6 — Finance and administration
The Admin/BizOps finance workspace is available at `/finance`. It supports client-linked quotations and invoices, ZMW summaries, status tracking and immutable payment entries. Deploy the updated Firestore rules before using this module. This is a record-keeping ledger only: it does not initiate payments, calculate tax/VAT, issue compliant tax invoices, or reconcile bank statements. See `PHASE_6_UPDATE.md` for the data model and deployment notes.

## Stage 7 — Digital Operations

The `/digital` workspace provides the content calendar and internal approval flow, website change requests, campaign planning and manually entered campaign metrics, a summary report, and a URL-based content asset library. Access is enforced in Firestore rules, not only in the UI. See `PHASE_7_UPDATE.md` for collection schemas, role matrix, deployment steps and limitations.

## Stage 8 — Reports and notifications

See `PHASE_8_UPDATE.md` for the reporting, role-scoped in-app attention centre, data access, limitations and verification steps. The Stage 8 pages add no Firestore collections and do not widen the existing security rules. Notifications are computed on open/refresh; no background, push, email or SMS delivery is configured.

## Receipts by email

Recording an invoice payment can email a PDF receipt to the client from the company mailbox. The browser calls `POST /api/send-receipt` (a Vercel function); the function verifies the Firebase ID token, requires an active `admin` or `bizops` role, reads the payment, invoice and **client email from Firestore** (the recipient is never taken from the request), builds the PDF, sends it over SMTP, and records the outcome in `receipts/{paymentId}`. Receipt numbers (`RCT-000001`…) are allocated server-side in a transaction. Set the server-only variables listed in `.env.example` in Vercel (Production and Preview), deploy `firebase/firestore.rules`, and use `vercel dev` (not `npm run dev`) to test the endpoint locally.
# workspace
# workspace
# workspace
# workspace

## Website intake, audit trail and email alerts

**Website intake** (`/business/intake`, admin and bizops). Staff fill in a client's website brief, paste a summary the client sent, or receive one directly from the public form at `/intake/`. From a saved intake you can add it to Leads, make it a Client, start a Project (links are stored on the intake), and copy a ready-to-paste build brief. The public form posts to `POST /api/intake-submit`, which validates with `shared/intake.ts`, rate-limits (5 per IP per hour, 300 per day), uses a honeypot and a minimum fill time, and writes only to `intakes` as `source: client_form`. It never emails the address the client typed.

**Audit trail.** `auditLogs` can no longer be written by browsers (except the admin role-change batches in `userService.ts`). `writeAudit()` calls `POST /api/audit`, which takes the actor from the verified token and accepts an entry only if the target document was changed by that user in the last 10 minutes (or is gone, for deletions). Retried entries are idempotent.

**Email alerts** (`POST /api/notify`, staff-triggered): new lead, leave requested (to the approver), leave decided (to the employee). Recipients always come from stored records, and each event is sent once (`mailLog/`). A daily Vercel Cron (`/api/cron-overdue`, 05:00 UTC) emails one digest of unpaid invoices past their due date.

Server-only variables to set in Vercel, in addition to the SMTP and Firebase ones used by receipts:

| Variable | Purpose |
|---|---|
| `NOTIFY_EMAIL` | Inbox for new intakes, new leads and the overdue digest (falls back to `COMPANY_EMAIL`, then `MAIL_FROM`) |
| `CRON_SECRET` | Any long random string. Vercel sends it as a bearer token to the cron route; without it the route refuses to run |
| `APP_URL` | Optional, e.g. `https://app.b34stweb.com`, used for the link in new-intake emails |
| `INTAKE_ALLOWED_ORIGINS` | Optional, comma-separated origins allowed to post the public form from another site |
| `INTAKE_SALT` | Optional random string used when hashing IPs for rate limiting |

Deploy `firebase/firestore.rules` **before** the app, because browsers can no longer write audit entries. Use `vercel dev` locally so `/api/*` exists. Run `npm run test:all`.
