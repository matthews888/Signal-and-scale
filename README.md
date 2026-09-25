# Signal & Scale

Responsive agency website, careers application form and private applicant admin.

## Careers and admin

`/careers.html` displays the job description followed by first name, last name, phone, email and optional media. The job copy is editable in `careers.html`.

`/admin` uses a reusable six-digit code. The dashboard shows the submitted applicant count, two CSV download cards and submitted applications with private media downloads. Each CSV includes every submitted applicant: first/last name plus either phone or email. Counts refresh every 30 seconds while the page is visible. Downloads are generated from the current database, so no manually maintained files are needed.

Applicants and media are stored in Postgres. Media is limited to 3 files and 10 MB combined. One-MB upload chunks avoid serverless request-size limits. Incomplete applications never appear in the applicant count or exports. Expired drafts, sessions and rate-limit records are cleaned up on subsequent submissions. Submitted applications are retained until deliberately removed by the owner. Media is served only as a protected attachment; it has no public file URL.

## Required production setup (not yet completed)

The code is prepared on `careers-application-form`. Do not promote it to production until storage and environment configuration are complete.

1. Connect a dedicated Postgres database to the **signal-and-scale** Vercel project (Neon through Vercel Storage is suitable). Use separate storage for preview/testing if testing with sample applicants.
2. Configure these Vercel server environment variables:
   - `DATABASE_URL`: the database connection URL; use a pooled URL for Neon runtime traffic.
   - `SITE_ORIGIN`: `https://signal-and-scale.vercel.app` (change if a custom domain becomes canonical).
   - `ADMIN_CODE_HASH`: generated with `npm run admin:code`. Keep the accompanying randomly generated reusable code private. The plaintext code is never embedded in HTML or committed.
3. Run `npm run db:migrate` with `DATABASE_URL_UNPOOLED` set to the direct database URL. The additive, repeatable migration is in `db/0001_careers.sql`.
4. Run `npm ci`, `npm test` and `npm run build`. Vercel uses `vercel.json` to build only public frontend files and deploy the API separately.
5. Deploy and verify one test application, admin sign-in, both CSV downloads, media download and logout. Use a preview database for test applicants; never leave test applicants in the production count.

The API returns an honest unavailable error until configuration is present. It never reports successful submission without writing the application. The existing live page is unchanged until this branch is merged.

## Access controls

The code is checked on the server using scrypt and a constant-time comparison. A successful login issues a random, server-tracked, Secure/HttpOnly/SameSite=Strict cookie lasting 12 hours. The six-digit code remains reusable. Logout revokes the session. Changing `ADMIN_CODE_HASH` invalidates existing sessions. Persistent IP and global limits restrict login guesses; all private reads and downloads check the session server-side. POST requests require an allowed same-site Origin.

CSV values are quoted and formula-leading values are prefixed with an apostrophe. This protects spreadsheets and preserves international phone prefixes; a raw CSV reader may display the safety apostrophe. Import the phone column as text in spreadsheet software to preserve formatting.

## Verification

`npm test` runs the real API handlers against an isolated PGlite Postgres engine. It covers draft exclusion, idempotent submission, counts, separate CSVs, formula protection, multi-chunk media integrity, private access, login limits, logout revocation and missing configuration.

## Existing contact details

The site still contains the original placeholder `hello@signalandscale.agency`. Replace it with an address you control before using those general contact links. Careers applications use database storage, not that email address.
