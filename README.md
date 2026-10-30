# R2

Rental and production management for small AV hire and production companies, NZ/AU first: inventory, availability, jobs, quotes with GST, packing and scanning, labels, Xero export. One PocketBase server with a React front end, installable on phones as a web app.

This repo started as Rentman+, a label-printing companion that read everything from Rentman. R2 owns its own data now, and Rentman is just something you can import from.

## Run it locally

You need Node 22+, pnpm and python3 (for PDFs).

```sh
pnpm install
pnpm dev:pb        # PocketBase on :3001 (downloads the version pinned in pocketbase/Dockerfile, and a Python venv for PDFs, into .pb/)
pnpm dev:web       # Vite on :5173, proxying /api to :3001 (R2_API_URL to point it elsewhere)
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
- Labels reach each venue's Brother printers through a **print agent** there (below), since a cloud server can't reach their networks. `docker-compose.yml` sets `R2_DIRECT_PRINTING=0`, so the server never connects to printer addresses itself; set it to 1 only when R2 runs on the same network as the printers.

## Tests

```sh
pnpm test     # unit tests: availability engine, pricing/GST maths, Xero file, iCal feed, maintenance dates, sync merge and mappings
pnpm smoke    # end-to-end API checks against a running server (needs PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD)
pnpm sync:e2e # live sync end to end, against the mock Rentman and Momentus servers (see Live sync)
```

`pnpm smoke` and `pnpm sync:e2e` create records and leave them, so point them at a throwaway database. The smoke test's PDF checks need the server's Python set up, which `pnpm dev:pb` does.

## How it fits together

```
pocketbase/
  pb_migrations/     schema (0020_r2_core.js is the R2 data model)
  pb_hooks/
    lib/             availability.js, pricing.js, xero.js, ical.js, time.js, dates.js: pure, unit-tested
                     availabilityData.js, jobs.js, scan.js, repairs.js, maintenance.js, imports.js, pdf.js…: database + business rules
    routes_*.pb.js   custom API routes
    records_validation.pb.js   rules enforced on every save
  tests/             node --test unit tests for the pure modules
web/                 React + TanStack Query + Tailwind SPA (public/sw.js is the service worker)
print/               Python helpers: r2_pdf.py (PDFs, with Inter fonts), print_label.py (Brother QL) and r2_find_photo.py (item photo search)
scripts/             dev launcher, demo seed, API smoke test
```

Plain records (items, units, contacts, venues, jobs) go straight through the PocketBase SDK, gated by collection rules and the validation hooks. Anything with business logic goes through custom routes, and those collections can't be written any other way. That covers job lines (kit and accessory expansion), quotes (frozen snapshots), scans, repairs, maintenance, availability, imports, exports and PDFs.

### Organisations and people

One database holds every organisation. Every business record has an `org`, and collection rules plus `requireOrg()` in the routes keep each organisation's data to its members (`pb_migrations/0022_organisations.js`, `pb_hooks/lib/orgs.js`). Barcodes, job numbers and settings are per organisation.

- **Accounts** belong to people, not organisations. Anyone can sign up; a new account sees nothing until an organisation invites its address.
- **Invitations:** an organisation's admins invite an email with a role (Settings → Users & access). The person signs up (or signs in) with that address, verifies it, and accepts on their Organisations page. Someone can be in several organisations with a different role in each, and switches between them from the header.
- **Platform admins** (`isPlatformAdmin` on the account) run the admin panel at `/admin`: every organisation (create, invite its first admin, rename, suspend, delete) and every account (verify by hand, grant platform admin, delete). They don't see organisations' business data unless they're also members. Organisations are created by platform admins for now; self-serve sign-up comes with billing.
- Every organisation keeps at least one admin. Its `features` field says which features it uses (see below).

### How each business works

Every organisation starts set up the usual way, and can change it to fit how it actually works (Settings → How you work):

- **Features.** Projects, equipment tracking, repairs, maintenance plans, labels, prices and quotes, crew rostering, live sync and the Xero export can each be turned off. They're what an organisation pays for, so only platform admins change them (admin panel → the organisation → Features, `PATCH /api/admin/orgs/{id}/features`); the organisation's own admins see what's included in Settings → Features. A theatre with a small crew might not scan kit or keep repair jobs; a touring production company wants both. Off, a feature is hidden for everyone and the server stops doing it: its permissions count for nobody, its routes refuse, and its records can't be written through the API (`records_features.pb.js`). Nothing's deleted, so turning it back on picks up where it left off. A feature that needs another is off while that one is. With repairs off, a unit can be flagged In repair by hand (`lib/features.js`, `organisations.features`).
- **Projects off** makes R2 an inventory and maintenance system, for a venue that plans its shows somewhere else (Momentus, say). Contacts and locations go with projects (they're its clients and venues), and so do equipment tracking, prices and quotes (and the Xero export) and crew rostering. Home's At a glance shows maintenance, repairs and units out of service instead; items show what's in service and their replacement cost, without bookings or project history; repairs don't ask which project the damage came from; search, the calendar feed and imports leave projects and contacts out. Live sync carries on for inventory: Rentman syncs equipment only, and Momentus can still be sent inventory but doesn't pull events, orders or quotes. The sync's own settings are kept as they were, for when projects are back (`lib/sync.js` `getConfig`).
- **Presets.** A new organisation starts from what it's for (first-run setup, or the admin panel): Hire and production company (everything), Venue with its own shows (projects, tracking, crew, repairs, maintenance; no prices), or Inventory and maintenance. The admin panel offers the same as one-click starting points for an existing organisation, and every switch can still be changed on its own (`PRESETS` in `lib/features.js` and `web/src/lib/workflow.ts`).
- **Project statuses.** Each organisation names, orders and colours its own (Confirmed → Prepping → Prepped → Loaded → Out, say). Each sits on one of six fixed stages that availability, scanning, the calendar feed and the Xero export run on: enquiry (holds nothing), pencilled in, confirmed, out, done and cancelled. A project keeps both: `jobStatus` (its status) and `status` (that status's stage), kept together on every save. Equipment tracking offers the next status as its kit goes out and comes back (see below). Removing a status asks where its projects go; changing a status's stage takes its projects with it (`lib/jobStatuses.js`).
- **Repair statuses** work the same way, on three stages (see Repairs and maintenance).
- **Equipment tracking steps** too: the steps kit goes through on its way to a project and back (see Equipment tracking).
- **Crew roles**: what crew are booked to do (see Crew rostering).

New organisations get the defaults from a hook when they're created, however they're made.

### Home, dashboards and saved views

People see what they need rather than one page for everyone: a workshop tech sees what to prep next, crew see their own projects, the office sees what's waiting on a decision.

- **Dashboards.** Home shows a dashboard: panels picked and put in order from a set (at a glance, my projects, to prep next with packing progress, going out, coming back, out now, needs confirming, maintenance, repairs, quotes; `web/src/lib/home.ts`). Anyone can design their own, or copy someone else's to change. Each organisation starts with Overview (everyone's Home until they pick their own), Workshop and My projects. Panels for a turned-off feature, or one someone's role can't see (quotes), don't show for them.
- **Saved views.** Every list page works like Home: Inventory, Projects, Contacts, Locations, Crew and Rostering each have views that keep the page's filters and column settings (on Inventory, the columns' widths and sort too; searches aren't kept). One dropdown picks a view (yours, shared with you, everyone's, or Standard, the page as it comes), with edit, save changes, new, copy, share and manage at its foot; the page says "edited" when it's changed since. Your pick is remembered per page on your account (`memberships.views`), and people who can publish set the organisation's default for each page. A link with its own filter (the sidebar's Projects → Mine) wins over the saved view (`list_views`, `pb_migrations/0038_page_views.js`).
- **Sharing.** Dashboards and views are their owner's until they share them: with people they pick, or with everyone in the organisation. Sharing with everyone, and picking the default Home, take the "Share dashboards and views with everyone" permission, which only Admin has to start with. People use and copy what's shared with them; only the owner changes it. The organisation's own (the defaults) can be changed by anyone with that permission (`lib/sharing.js`, `routes_views.pb.js`).
- **Crew.** People on a project see it under My projects and in Projects → Mine (see Crew rostering).

### Crew rostering

Crew are booked by what they do and when, not just "on the project" (`pb_migrations/0041_crew_rostering.js`, `lib/crew.js`). A feature: off, planners just add people to a project with what they're doing.

- **Crew roles.** Each organisation's own list of what crew are booked to do (Audio operator, Technical labour, Rigger…), in Settings → Crew roles. Not the permission roles in Settings → Users & access.
- **The crew list** (Crew, in the sidebar): everyone who can be rostered. Every member is on it under their account's name; freelancers who don't log in are added there (name, phone, email). Skills are the crew roles someone does. "Add freelancers to the crew list and set people's crew skills" is its own permission, Admin's and Planner's to start with. Someone who's been rostered is archived rather than deleted, and members who leave are archived for them.
- **Crew needs.** A schedule item says what crew it needs: 1× Audio operator and 3× Technical labour for the pack in. A need runs over its item's times and moves with it, unless it has its own (audio in an hour early). Removing the item takes its needs, and whoever was on them, with it.
- **Rostering.** A project's Crew tab lists each schedule item's needs with a slot for each person; picking someone offers the people with that skill first, and says where else anyone's booked at the time. Double bookings are allowed but marked. The Rostering page does the same across every project over a week or more, by day or by person (who's free). Each person fills a slot once, and a need takes no more people than it asks for. People can also be on a whole project (a project manager). `job_crew.user` is filled in from the person, so My projects still reads it.

### Roles and permissions

Each organisation defines its own roles (Settings → Users & access, alongside its members). A role is a name plus a set of per-action permissions, such as "Add items", "Delete units", "Issue quotes", "Track kit going out" or "Invite and remove people". The catalogue is in `pocketbase/pb_hooks/lib/permissions.js`. Every member can look up inventory, jobs, contacts and venues; everything else needs a permission.

- Every organisation starts with **Admin** alone (locked: always every permission, including ones added later, and can't be edited or deleted). It makes the other roles it needs; a role someone has, or an invitation is waiting with, can't be deleted until they're given another.
- Some permissions need others: seeing quotes needs seeing prices, and issuing quotes needs seeing them. The editor ticks these for you, and the server enforces them.
- **Nobody can hand out more than they have.** Creating, changing, deleting or assigning a role needs every permission in it, and only admins can make or remove admins. Every organisation keeps at least one admin.
- The server checks permissions in both places: in collection rules, through a join on the member's own membership row, so a permission held in one organisation never counts in another (`pb_migrations/0024_custom_roles.js`); and in the routes, via `requireOrg(e, "permission")` (`pb_hooks/lib/orgs.js`). The web app only hides what you can't use.

Adding a permission: add it to `lib/permissions.js`, check it where it applies, and add it to existing Admin roles in a migration.

### Availability

- A job holds its kit from **prep** to **return**, plus a turnaround buffer: a global one in Settings → Pricing, plus any extra per item.
- Enquiries hold nothing; provisional (pencilled) and confirmed jobs do. Shortages say when they'd go away if pencilled holds were released. (These are stages: an organisation's own statuses each sit on one.)
- "Free" over a window is the **minimum** at any moment in it, so a one-hour overlap counts. Negative means overbooked, and it's shown as such.
- Bulk stock = quantity − out of service. Serialised stock = active units. A kit owns nothing and is only as available as its scarcest part.
- The engine (`lib/availability.js`) already takes stock changes over time, so subhires and repair tickets slot straight in.

### Pricing, quotes and PDFs

- Prices are NZD ex GST. Maths runs in integer cents, and GST is worked out once on the total.
- Equipment lines are day rate × quantity × a day factor (Settings → Pricing, e.g. `1, 1.5, 2…`). Custom lines can be flat or per day.
- Days come from the show dates, or prep → return for a dry hire, or a per-job override. Each started 24 hours counts as a day.
- Issuing a quote freezes everything it prints into a numbered snapshot (`Q1042-2`), so later changes never alter it.
- Quote, packing list and label PDFs are drawn server-side by `print/r2_pdf.py` (fpdf2, with Inter embedded so macrons print). Dates on them use the time zone in Settings → Business.

### Addresses

Contacts' billing addresses and locations' addresses look themselves up as you type: pick a match and it's filled in a line at a time (building or business name, street, suburb, town and postcode, and the country when it's not yours), still editable for a level or PO box. It's Photon (photon.komoot.io), OpenStreetMap's free search-as-you-type geocoder, called from the server (`GET /api/addresses`, `lib/addresses.js`) and biased to the organisation's country from its time zone. New Zealand's street addresses in OpenStreetMap come from LINZ, so they're good; venue names often aren't there, so search a venue by its street address. Swapping in a paid service (NZ Post, Addy, Google) only touches `lib/addresses.js`.

### Item photos

"Find photo" under an item's photo searches the web (Bing images, no API key) and saves the best match. A local vision model in Ollama does the thinking: it turns the item's name, folder, description and custom fields into a search query, then looks at the top results and picks the one showing exactly that item. `print/r2_find_photo.py` does the work; set `R2_OLLAMA_URL` and `R2_VISION_MODEL` (default `gemma4:12b-it-qat`, any Ollama model with vision works). It takes 5–20 seconds. A server without `R2_OLLAMA_URL` doesn't offer it (`pnpm dev:pb` sets it to Ollama on your machine).

### Repairs and maintenance

Everything that keeps the kit working lives under Maintenance: what's due, repairs, repeating plans, and the record of what's been done.

- **Repairs** are for broken kit: some units of an item, or a quantity of a bulk item. Opening one takes them out of service (units go In repair, bulk stock is counted out of service).
- **Repair statuses** are each organisation's own (Settings → Repair statuses): named, ordered and coloured to suit the business, like Backlog, To repair, In repair, Waiting for parts, Repaired, Unrepairable (the defaults, plus one). Each has a stage that decides what happens to the kit: out of service while the repair's there, repaired (back in service) or unrepairable (units retired, bulk stock down). Moving a repair back from repaired or unrepairable takes the kit out of service again. A status with repairs in it keeps its stage and can't be removed. A unit on an open repair can't be put back to Active by hand: the repair does that (`lib/repairs.js`).
- A repair can record the **project** the kit came back damaged from (the project page lists them), and carries **files**: photos of the damage, the repairer's report, quotes, invoices, POs. Files go on maintenance jobs too: any type, up to 25 MB each, and only the organisation's members can open them (`lib/files.js`). Each repair has an activity trail from the organisation's log.
- **Plans** are repeating maintenance: an annual PPE inspection, test & tag every 3 months, a hazer service every 6. A plan covers items; each active unit of a serialised item, and each bulk item as a whole, gets its own **scheduled job**. Recording it (pass or fail) schedules the next, counted from the day it was done. A fail can open a repair straight away, in the default status. New units join their item's plans; lost and retired units drop out (`lib/maintenance.js`).
- **One-off jobs** are scheduled for a day, on units, an item, or nothing in particular.
- **Test & tag** plans keep each unit's "Next test & tag" date on its next scheduled test, so the units list and labels show it, and moving the date on a unit moves the test. A unit's existing date (from Rentman, say) carries on when it joins a plan.
- **Record by scanning** is for inspection and test & tag days: scan each unit, see what's due on it, pass or fail it. Passes can also be ticked off in a batch.
- Due and done dates are calendar days ("2026-10-22", `lib/dates.js`), so they never shift with time zones. The server's "today" is in the organisation's zone (Settings → Business).
- Setting up plans needs the "Set up repeating maintenance" permission; recording and scheduling work and repairs needs the one techs have for reporting broken gear.

### Labels

The label designer's templates can be any size. Brother QL tape widths (12/29/62mm) print straight to the networked printer. Every size, including the Zebra presets, can be downloaded as a PDF: one page per label at its real size, for any printer with a driver.

**Print agents.** R2 in the cloud can't reach a venue's printers, and a web page can't send to them either (browsers don't allow the raw network connection a Brother takes). So a small program runs on a computer at the venue that stays on: `print/r2_print_agent.py`, Python 3.8+ with nothing to install, on a Raspberry Pi, the venue's server or anything else that's on its network (`lib/printAgents.js`, `pb_migrations/0048_print_agents.js`).

- Settings → Printer setup → Print agents makes one and shows its token once, in the commands that set it up: on Linux `sudo python3 r2_print_agent.py --install --url … --token …` makes it a service that starts with the machine (logs: `journalctl -u r2-print-agent -f`), or one `docker run` line, or plain `python3 r2_print_agent.py --url … --token …` anywhere else (Task Scheduler on Windows, with `py`). The script downloads from the server (`GET /api/print-agent/script`).
- Each printer says what it prints through: an agent, or (self-hosted) this server. A printer behind an agent keeps its network address; the agent uses it.
- The agent only connects out to R2, so nothing needs opening at the venue. It asks for labels with a long poll (`GET /api/print-agent/jobs?wait=20`, `Authorization: Bearer r2pa_…`), sends each one to its printer on port 9100, reports how it went, and every 30 seconds says which of its printers answer (the dots in Printer setup and the print dialog).
- Printing to a printer behind an agent works like printing to one the server reaches itself: the server turns the label into the printer's raster commands (`print_label.py --raster-out`), queues them (`print_jobs`) and waits up to 15 seconds for the agent's answer. Printed, couldn't reach it (the app tries the next printer with the same stock) or failed. An agent not heard from in a minute counts as offline, so printing fails straight away and the app moves on.
- Tokens are stored hashed. A new token retires the old one; an agent a printer still uses can't be removed. Queued labels are gone within the hour.

### Equipment tracking

Every bit of equipment on a project has its own status, so the audio can be loaded while the lighting's only prepped. Kit is scanned to a **step**: each organisation's own list (Settings → Equipment tracking), starting as Prepped → Loaded → Returned. Each step sits on one of three fixed stages: getting ready (pulled for the project, still in the building), gone (left with the project) and back (returned to stock) (`lib/tracking.js`, `pb_migrations/0037_tracking_steps.js`).

- Kit can skip steps (a workshop that loads straight from the shelves doesn't need a prep step), and a unit can go back one (unloaded to the bay).
- **Boards.** The Equipment tracking page shows every tracked project going out, out or back in the last fortnight as a board, a column per step (or as a list). A project's own tracking page does the same with its equipment, one card per line. A card sits under the step it's working towards once any of its kit has got there ("71/78 Prepped"), else the furthest step all of it has reached. Cards move as kit is scanned, not by dragging (`GET /api/tracking/projects`).
- Each line on a project gets its share of its item's units, furthest along first, so every line, every heading and the whole project shows where it's at: the furthest step everything's reached, and how much has reached the next.
- A project's status is set by people, never by tracking. But a step can name a status to **offer** once everything's reached it: scan the last unit onto the truck and you're asked "Everything's Loaded. Set the project to Out?" (Prepped → Prepped, Loaded → Out, Returned → Returned to start with). Only forwards, and only the status the kit's actually reached can be taken up (`POST /api/jobs/{id}/tracking-status`), so whoever's scanning can do it without being able to edit the project.
- Any project can go **without tracking**, with the feature on (a small dry hire, say): planners switch it off on the project, once nothing it tracked is still out (`jobs.untracked`).
- The scan ledger (`scans`) keeps the step each scan took kit to and from. Its direction is "out" when kit leaves stock, "move" between steps on the same project, "in" when it comes back. Getting ready and gone steps need "Track kit going out"; back steps need "Track kit coming back".
- A step kit's been tracked to keeps its stage. Removing one moves its kit to the next step on the same stage (or, for the last getting-ready step, the first gone one).

The scan page takes a Bluetooth/USB barcode scanner (it types the code and presses Enter) or the phone camera. The camera uses the browser's own barcode reader where there is one (Chrome on Android), and otherwise loads the ZXing decoder on demand (iPhone, iPad, Firefox). Every scan rule is checked on the server.

When kit comes back damaged, **Report fault** next to a scanned-in unit opens a repair for it on the spot, linked to the project it came back from.

The service worker caches the app shell so the app opens on bad Wi-Fi and shows an Offline badge. It never caches `/api/`: stock, availability and scans are always live, and nothing is queued offline yet (that's v2).

### Xero

Exports → Xero builds a file for Xero's sales invoice import. Each job becomes a draft invoice from its latest accepted (or issued) quote, numbered from the job (`R2-1042`). Xero refuses a number it already has, so a job can't be invoiced twice. Free kit contents are listed in their parent line, and a job discount becomes its own line. The account code, tax rate name, payment terms and number prefix are in Settings → Accounting. They have to match the Xero organisation's own. Xero recalculates GST per line, so its total can differ from R2's by a cent.

### Bringing data in

Settings → Import data takes spreadsheets of items (and, with projects, contacts). Rentman comes in through live sync (below): its first sync links up anything already in R2 rather than copying it again.

### Live sync: Rentman and Momentus

Settings → Integrations keeps R2 in step with Rentman (two-way) or with event bookings in Momentus Enterprise. Admins only (`integrations.manage`), and organisations can turn it off as a feature.

- **Engine** (`lib/sync.js`): `sync_links` records which R2 record is which remote one, with `base`, the fields both sides last agreed on. Every sync is a field-by-field three-way merge (`lib/merge.js`): a field changed on one side goes to the other; changed on both is a conflict, settled by the organisation's rule (newest edit, theirs, or R2's) and listed in the sync history. Nothing is sent from inside a save: record hooks (`records_sync.pb.js`) and webhooks queue work in `sync_queue`, and a cron worker (`routes_sync.pb.js`) runs it every minute, with retries and backoff, then each connector's catch-up pass when it's due. The sync's own writes skip the hooks. Deletes never cross over: removed on one side means archived on the other.
- **Rentman** (`lib/rentmanSync.js`): the import's own steps, merging instead of overwriting, so both share one mapping (`lib/rentmanMap.js`). Items, contacts and locations sync both ways; everything else comes in only. Rentman's API doesn't let other apps change projects, so projects and their lines come in only, and an R2 project can be sent as a project request, which links back up once accepted in Rentman. Rentman's webhook (address on the settings page) only says what changed; R2 re-reads it with the organisation's token, so a forged webhook can only cause a harmless re-read. Rentman's webhook signature format isn't published, so it isn't checked.
- **Momentus** (`lib/momentus.js`, `lib/momentusSync.js`): events → projects (account as client, first room as location, the venue's statuses mapped to R2's), AV orders → project lines, issued quotes → an order on the event, items → Momentus resources (with a spreadsheet fallback for licences that won't allow it). Polled, as Momentus has no webhooks R2 relies on. **Built without access to a Momentus instance**: Momentus only documents its API inside each instance (`/api/help`). Every path, field name and the sign-in handshake are in `lib/momentus.js`, marked unconfirmed, and an organisation can override paths in Settings. Check them against a real instance before a venue relies on it.
- **Trying it locally:** `node scripts/mock-rentman.mjs` and `node scripts/mock-momentus.mjs` stand in for both (Momentus with address `http://127.0.0.1:4200`, organisation code `10`, API user `R2API`, secret `mock-secret`). Start PocketBase with `RENTMAN_BASE_URL=http://127.0.0.1:4100 R2_ALLOW_HTTP_MOMENTUS=1 pnpm dev:pb`, then `pnpm sync:e2e`. `POST /api/sync/tick` (superusers) runs the worker without waiting for its minute.

### PocketBase JSVM gotchas (all hit while building this)

- Route handlers and middleware are run from their source text in a separate VM. They can't see anything from their file's scope, so `require()` inside each handler, and keep middleware self-contained.
- Throw `BadRequestError` (not `Error`) from hooks, or the user only sees "Failed to create record."
- An empty string bound to a filter placeholder (`parent = {:parent}` with `""`) becomes `'""'` in SQL and never matches. Write `parent = ''` instead.
- `e.string()` sends text/plain whatever Content-Type you set; use `e.blob(status, type, toBytes(text))` for CSV/iCal.
- On macOS, PocketBase loading the hook files itself fires the change events its hook watcher listens for, so with the watcher on it restarts itself every few seconds, forever. The dev script runs it with `--hooksWatch=false`.
- With no superuser, PocketBase opens its "create a superuser" page in the browser on every start. The dev script creates one up front.

## Status

The brief's MVP is built:

- **Inventory:** items, categories, bulk and serialised stock, photos, day rates, units with barcodes, custom fields, bulk edits.
- **Labels:** QR/barcode labels to a Brother QL (from the cloud through a print agent at the venue), or as PDFs with Brother and Zebra size presets.
- **Availability:** with turnaround buffers, shortage warnings per job line, and a 60-day timeline per item.
- **Projects:** schedules with usage and billing periods, subprojects, equipment headings, clients, venues and statuses.
- **Quotes:** GST, day factors and discounts, as frozen snapshots and server-side PDFs.
- **Kits and accessories:** a kit's contents and an item's accessories are added to a job automatically.
- **Warehouse:** a packing list PDF, and equipment tracking (prepped, loaded, returned) from an installable web app (scanner or camera, iPhone included).
- **Getting data in:** CSV import for items and contacts; Rentman through live sync.
- **Live sync:** two-way with Rentman; Momentus events, orders, quotes and inventory for venues (Momentus not yet checked against a real instance).
- **Getting data out:** the iCal feed and the Xero CSV export.
- **Accounts:** organisations, invitations with email verification, custom roles with per-action permissions in each organisation, a platform admin panel, and first-run setup.
- **Fits each business:** features it can turn off, and its own project and repair statuses on fixed stages.
- **Fits each person:** dashboards and saved views of their own, shared with people or (by admins) with everyone.
- **Crew:** crew roles, a crew list of members and freelancers with skills, crew needs on schedule items, and rostering per project and across projects.

From the brief's v1 so far:

- **Repairs and maintenance:** repair jobs with each organisation's own statuses, files and the project the damage came from; repeating plans (inspections, test & tag, services), one-off jobs, recording by scanning, and repair and maintenance costs per item.

Next, from the brief's v1:

- invoices and deposits with a live Xero connection
- subhires
- online quote acceptance
- vehicles, and crew availability (days off)
- the hosting control plane

The offline scan queue is v2.
