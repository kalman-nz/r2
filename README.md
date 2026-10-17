# R2

Rental and production management for small AV hire and production companies, NZ/AU first: inventory, availability, jobs, quotes with GST, packing and scanning, labels, Xero export. One PocketBase server with a React front end, installable on phones as a web app.

This repo started as Rentman+, a label-printing companion that read everything from Rentman. R2 owns its own data now, and Rentman is just something you can import from.

## Run it locally

You need Node 22+, pnpm and python3 (for PDFs).

```sh
pnpm install
pnpm dev:pb        # PocketBase on :3001 (downloads the version pinned in pocketbase/Dockerfile, and a Python venv for PDFs, into .pb/)
pnpm dev:web       # Vite on :5173, proxying /api to :3001
```

Open the app. On a brand-new database it asks you to create the first account. That account is a **platform admin** and the admin of a first organisation named after your business. Open a fresh install straight after deploying it: the setup screen closes for good once any account exists.

Locally, `pnpm dev:pb` sets `R2_DEV_TRUST_EMAILS=1`, so invitations can be accepted without verifying an email address (there's no mail server to verify with). Never set it in production.

`pnpm dev:pb` also makes a PocketBase superuser for the local database, for the dashboard at http://127.0.0.1:3001/_/, and saves its login in `.pb/superuser.txt`. Hook files aren't reloaded on save: restart `pnpm dev:pb` after editing anything in `pocketbase/pb_hooks` (see the gotchas below for why).

For something to click around in, load a fictional demo company into an empty database. It prints the logins it creates: an admin (who's also a platform admin) and a tech, plus a second, empty organisation that has invited the admin:

```sh
pnpm seed:demo
```

## Deploying

One container (`docker compose up`): PocketBase with the hooks and migrations, the built front end, and a Python venv for PDFs and the Brother label printer. See `.env.example`.

Serve it over **HTTPS** (e.g. behind Caddy). Phones only allow camera scanning, installing the app and its offline shell on https:// sites (localhost is the exception for development).

For a hosted, multi-organisation install:

- Set `R2_APP_URL` to the public address (e.g. `https://app.example.com`). Links in emails use it, and it overrides the dashboard's Application URL on every start.
- Set up SMTP in the PocketBase dashboard (Settings → Mail settings), with a sender name and address. Without it, sign-up verification and password-reset emails can't go out, and invitations show a link for the inviter to pass on. People can't accept an invitation until their email is verified, so mail is effectively required. A platform admin can mark someone verified by hand in the admin panel.
- Brother label printing over the LAN only works when R2 runs on the same network as the printer. Hosted organisations print labels as PDFs.

## Tests

```sh
pnpm test     # unit tests: availability engine, pricing/GST maths, Xero file, iCal feed
pnpm smoke    # end-to-end API checks against a running server (needs PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD)
```

`pnpm smoke` creates records and leaves them, so point it at a throwaway database. Its PDF checks need the server's Python set up, which `pnpm dev:pb` does.

## How it fits together

```
pocketbase/
  pb_migrations/     schema (0020_r2_core.js is the R2 data model)
  pb_hooks/
    lib/             availability.js, pricing.js, xero.js, ical.js, time.js: pure, unit-tested
                     availabilityData.js, jobs.js, scan.js, imports.js, pdf.js…: database + business rules
    routes_*.pb.js   custom API routes
    records_validation.pb.js   rules enforced on every save
  tests/             node --test unit tests for the pure modules
web/                 React + TanStack Query + Tailwind SPA (public/sw.js is the service worker)
print/               Python helpers: r2_pdf.py (PDFs, with Inter fonts) and print_label.py (Brother QL)
scripts/             dev launcher, demo seed, API smoke test
```

Plain records (items, units, contacts, venues, jobs) go straight through the PocketBase SDK, gated by collection rules and the validation hooks. Anything with business logic goes through custom routes, and those collections can't be written any other way. That covers job lines (kit and accessory expansion), quotes (frozen snapshots), scans, availability, imports, exports and PDFs.

### Organisations and people

One database holds every organisation. Every business record has an `org`, and collection rules plus `requireOrg()` in the routes keep each organisation's data to its members (`pb_migrations/0022_organisations.js`, `pb_hooks/lib/orgs.js`). Barcodes, job numbers and settings are per organisation.

- **Accounts** belong to people, not organisations. Anyone can sign up; a new account sees nothing until an organisation invites its address.
- **Invitations:** an organisation's admins invite an email with a role (Settings → Team). The person signs up (or signs in) with that address, verifies it, and accepts on their Organisations page. Someone can be in several organisations with a different role in each, and switches between them from the header.
- **Platform admins** (`isPlatformAdmin` on the account) run the admin panel at `/admin`: every organisation (create, invite its first admin, rename, suspend, delete) and every account (verify by hand, grant platform admin, delete). They don't see organisations' business data unless they're also members. Organisations are created by platform admins for now; self-serve sign-up comes with billing.
- Every organisation keeps at least one admin. Organisations have a `features` field ready for per-organisation feature toggles.

### Roles and permissions

Each organisation defines its own roles (Settings → Roles). A role is a name plus a set of per-action permissions, such as "Add items", "Delete units", "Issue quotes", "Scan kit out" or "Invite and remove people". The catalogue is in `pocketbase/pb_hooks/lib/permissions.js`. Every member can look up inventory, jobs, contacts and venues; everything else needs a permission.

- Every organisation starts with **Admin** (locked: always every permission, including ones added later), **Planner** and **Tech**. Planner and Tech can be edited or deleted like any other role.
- Some permissions need others: seeing quotes needs seeing prices, and issuing quotes needs seeing them. The editor ticks these for you, and the server enforces them.
- **Nobody can hand out more than they have.** Creating, changing, deleting or assigning a role needs every permission in it, and only admins can make or remove admins. Every organisation keeps at least one admin.
- The server checks permissions in both places: in collection rules, through a join on the member's own membership row, so a permission held in one organisation never counts in another (`pb_migrations/0024_custom_roles.js`); and in the routes, via `requireOrg(e, "permission")` (`pb_hooks/lib/orgs.js`). The web app only hides what you can't use.

Adding a permission: add it to `lib/permissions.js`, check it where it applies, and add it to existing Admin roles in a migration.

### Availability

- A job holds its kit from **prep** to **return**, plus a turnaround buffer: a global one in Settings → Pricing, plus any extra per item.
- Enquiries hold nothing; provisional (pencilled) and confirmed jobs do. Shortages say when they'd go away if pencilled holds were released.
- "Free" over a window is the **minimum** at any moment in it, so a one-hour overlap counts. Negative means overbooked, and it's shown as such.
- Bulk stock = quantity − out of service. Serialised stock = active units. A kit owns nothing and is only as available as its scarcest part.
- The engine (`lib/availability.js`) already takes stock changes over time, so subhires and repair tickets slot straight in.

### Pricing, quotes and PDFs

- Prices are NZD ex GST. Maths runs in integer cents, and GST is worked out once on the total.
- Equipment lines are day rate × quantity × a day factor (Settings → Pricing, e.g. `1, 1.5, 2…`). Custom lines can be flat or per day.
- Days come from the show dates, or prep → return for a dry hire, or a per-job override. Each started 24 hours counts as a day.
- Issuing a quote freezes everything it prints into a numbered snapshot (`Q1042-2`), so later changes never alter it.
- Quote, packing list and label PDFs are drawn server-side by `print/r2_pdf.py` (fpdf2, with Inter embedded so macrons print). Dates on them use the time zone in Settings → Business.

### Labels

The label designer's templates can be any size. Brother QL tape widths (12/29/62mm) print straight to the networked printer. Every size, including the Zebra presets, can be downloaded as a PDF: one page per label at its real size, for any printer with a driver.

### Scanning

The scan page takes a Bluetooth/USB barcode scanner (it types the code and presses Enter) or the phone camera. The camera uses the browser's own barcode reader where there is one (Chrome on Android), and otherwise loads the ZXing decoder on demand (iPhone, iPad, Firefox). Every scan rule is checked on the server.

The service worker caches the app shell so the app opens on bad Wi-Fi and shows an Offline badge. It never caches `/api/`: stock, availability and scans are always live, and nothing is queued offline yet (that's v2).

### Xero

Exports → Xero builds a file for Xero's sales invoice import. Each job becomes a draft invoice from its latest accepted (or issued) quote, numbered from the job (`R2-1042`). Xero refuses a number it already has, so a job can't be invoiced twice. Free kit contents are listed in their parent line, and a job discount becomes its own line. The account code, tax rate name, payment terms and number prefix are in Settings → Accounting. They have to match the Xero organisation's own. Xero recalculates GST per line, so its total can differ from R2's by a cent.

### Rentman import

Settings → Import pulls equipment, units, folders (as categories), stock locations and custom field names from the customer's own Rentman account with their own token. Re-running updates what it brought in before (matched on Rentman ids) and never deletes. Contacts and projects aren't imported from Rentman yet because their API field names haven't been checked against a live account; contacts can come in by CSV.

### PocketBase JSVM gotchas (all hit while building this)

- Route handlers and middleware are run from their source text in a separate VM. They can't see anything from their file's scope, so `require()` inside each handler, and keep middleware self-contained.
- Throw `BadRequestError` (not `Error`) from hooks, or the user only sees "Failed to create record."
- An empty string bound to a filter placeholder (`parent = {:parent}` with `""`) becomes `'""'` in SQL and never matches. Write `parent = ''` instead.
- `e.string()` sends text/plain whatever Content-Type you set; use `e.blob(status, type, toBytes(text))` for CSV/iCal.
- On macOS, PocketBase loading the hook files itself fires the change events its hook watcher listens for, so with the watcher on it restarts itself every few seconds, forever. The dev script runs it with `--hooksWatch=false`.
- With no superuser, PocketBase opens its "create a superuser" page in the browser on every start. The dev script creates one up front.

## Status

The brief's MVP is built:

- **Inventory:** items, categories, bulk and serialised stock, photos, day rates, units with barcodes.
- **Labels:** QR/barcode labels to a Brother QL, or as PDFs with Brother and Zebra size presets.
- **Availability:** with turnaround buffers, shortage warnings per job line, and a 60-day timeline per item.
- **Jobs:** prep/show/return dates, clients, venues and statuses.
- **Quotes:** GST, day factors and discounts, as frozen snapshots and server-side PDFs.
- **Kits and accessories:** a kit's contents and an item's accessories are added to a job automatically.
- **Warehouse:** a packing list PDF, and scan out/in from an installable web app (scanner or camera, iPhone included).
- **Getting data in:** CSV import for items and contacts, plus Rentman import, brought forward from v1.
- **Getting data out:** the iCal feed and the Xero CSV export.
- **Accounts:** organisations, invitations with email verification, custom roles with per-action permissions in each organisation, a platform admin panel, and first-run setup.

Next, from the brief's v1:

- invoices and deposits with a live Xero connection
- subhires
- repair tickets and test & tag
- online quote acceptance
- crew basics and vehicles
- Rentman contact/project import
- the hosting control plane

The offline scan queue is v2.
