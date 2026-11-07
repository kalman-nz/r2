// The user guide on the Help page (pages/HelpPage.tsx). Written for the
// people using R2, not for developers: what things are and how to do them.
// Everyone sees all of it, whatever their role or features.
//
// Blocks:
//   "text"                       a paragraph
//   { h }                        a subheading (linkable: /help/topic#slug)
//   { list } / { steps }         bullets / numbered steps
//   { tip }                      a best practice, one paragraph
//   { practice: [blocks] }       a best practice with tables, lists or pictures
//   { table: { head, rows } }    examples, settings, comparisons
//   { ui, caption? }             a picture or a piece of the screen (components/help/HelpVisuals.tsx)
// Everything outside tip/practice says how R2 works; advice goes in those.
// Inline: **bold** for anything on screen, [text](/help/topic#section) for links.

import type { VisualId } from "../components/help/HelpVisuals";

export type HelpBlock =
  | string
  | { h: string }
  | { list: string[] }
  | { steps: string[] }
  | { tip: string }
  | { practice: HelpBlock[] }
  | { table: { head: string[]; rows: string[][] } }
  | { ui: VisualId; caption?: string };

export interface HelpTopic {
  id: string;
  title: string;
  blocks: HelpBlock[];
}

export interface HelpGroup {
  title: string;
  topics: HelpTopic[];
}

// In the order of the app's sidebar, so help for a page is under its name.
export const HELP: HelpGroup[] = [
  {
    title: "Home",
    topics: [
      {
        id: "dashboards",
        title: "Home and dashboards",
        blocks: [
          "Home shows a dashboard: panels with what needs doing. The buttons at the top (**New project**, **Track equipment**, **Create repair**) start the most common jobs.",
          { ui: "dashboard" },
          { h: "Panels" },
          {
            table: {
              head: ["Panel", "Shows"],
              rows: [
                ["At a glance", "Going out today, due back today, overdue back, and out on hire. Without projects: maintenance overdue, due this week, open repairs, units in repair and units lost."],
                ["My projects", "Projects you're on the crew of."],
                ["To prep next", "Confirmed projects going out soonest, with how much is packed."],
                ["Going out", "Projects whose kit leaves soon."],
                ["Coming back", "Projects whose kit is due back soon."],
                ["Out now", "Projects with kit out."],
                ["Needs confirming", "Enquiries and pencilled-in projects coming up."],
                ["Maintenance due", "Maintenance that's due or overdue."],
                ["Open repairs", "Repairs not finished yet."],
                ["Quotes waiting", "Issued quotes the client hasn't answered."],
              ],
            },
          },
          { h: "Making your own dashboard" },
          {
            steps: [
              "Open the dashboard menu at the top of Home (it shows the dashboard's name).",
              "Choose **New dashboard**, or **Copy this dashboard** to start from one that's close.",
              "Name it, like \"Workshop\" or \"My week\".",
              "**Add a panel** for each one you want. They show in the order listed.",
              "Save. It's yours, and only you see it until you share it.",
            ],
          },
          { h: "Sharing a dashboard" },
          "Choose **Share…** in the dashboard menu, and pick people, or everyone in the business. They can use it and copy it; only you can change it.",
          "People who can share with everyone can also **Make default**: the dashboard everyone sees until they pick their own.",
          { tip: "Make a dashboard per job, not per person: \"Warehouse\", \"Office\", \"Workshop\". Share it with the team, and everyone in that job sees the same thing." },
        ],
      },
      {
        id: "views",
        title: "Lists, filters and views",
        blocks: [
          "**Inventory**, **Projects**, **Contacts**, **Locations**, **Crew** and **Rostering** are lists that all work the same way.",
          { h: "Searching and filtering" },
          {
            list: [
              "The search box at the top searches the list, including custom fields.",
              "The main filter next to it (like **Any client** or **All item types**) narrows it quickly.",
              "**Filters** has the rest: more filters, **Sort** (by more than one column), and **Group** (and subgroup), like projects grouped by status then client.",
              "**Columns** picks which columns show. Drag a column's edge to change its width.",
            ],
          },
          { ui: "filters" },
          { h: "Saved views" },
          "A view saves the filters, columns, widths, sorting and grouping, so you can get back to them in one click. Searches aren't saved.",
          { ui: "view-menu" },
          {
            list: [
              "Pick a view from the dropdown at the top of the list: yours, ones shared with you, the business's, or **Standard** (the list as it comes).",
              "Change something and the view says **edited**. Save the change to the view, or save it as a new view, from the same dropdown.",
              "**Edit view…**, **New view…**, **Copy this view…**, **Share…** and **Manage views…** are at the foot of the dropdown.",
              "R2 remembers the view you last used on each list.",
            ],
          },
          { tip: "Name views for what they're for: \"Hire desk\", \"Overdue\", \"Audio\", \"This week's prep\". Keep one for each question you ask often, rather than re-filtering each time." },
          { h: "Doing things to lots at once" },
          "Tick the boxes on the left of a list to act on several rows, like setting projects' status, printing labels or editing items. The actions show in a bar above the list.",
        ],
      },
      {
        id: "search",
        title: "Search and scanning codes",
        blocks: [
          "The search box in the header finds anything: items, units, projects, contacts and locations, by name, number, code or barcode.",
          { ui: "search" },
          { h: "Scanning a label" },
          {
            list: [
              "**With a barcode scanner**: click in the search box and scan. R2 opens whatever the label is on.",
              "**With your phone**: tap the camera icon in the search box and point it at the label.",
            ],
          },
          "Scanning a unit's label opens the unit's page, with its status, where it's kept, its maintenance and its scan history.",
        ],
      },
    ],
  },
  {
    title: "Projects",
    topics: [
      {
        id: "projects",
        title: "Creating and managing projects",
        blocks: [
          "A project is a show, event or hire: who it's for, where it is, when it happens, what equipment and crew it needs, and what it costs.",
          { h: "Creating a project" },
          {
            steps: [
              "Go to **Projects** and choose **New project**. (Or from a contact or location's page, to fill them in.)",
              "Type the **Project name**, like \"Spring Gala Dinner 2026\".",
              "Choose the **Client** and **Location**.",
              "Set when equipment is booked (**Equipment booked from / until**) and charged (**Billed from / until**).",
              "Save, then add [equipment](/help/equipment) and the rest of the [schedule](/help/schedule).",
            ],
          },
          { tip: "Name projects the way the client does, plus the year for repeat events: \"Spring Gala Dinner 2026\". The project number is added for you." },
          { h: "The project page" },
          {
            table: {
              head: ["Tab", "What's on it"],
              rows: [
                ["General", "The details, totals, schedule at a glance, quotes, crew, equipment tracking, files and custom fields."],
                ["Schedule", "Every time on the project: when kit is booked and charged, and crew calls, rehearsals and the like."],
                ["Equipment", "What it needs: equipment, services and custom lines, under headings, with prices and availability."],
                ["Crew", "Who's working on it, if your business uses crew rostering."],
              ],
            },
          },
          { h: "Project details" },
          {
            table: {
              head: ["Field", "What it's for"],
              rows: [
                ["Project name", "What everyone calls it."],
                ["Client", "Who it's for. A contact."],
                ["Location", "Where it is. A location, and its space."],
                ["Status", "Where it's up to. See [Project statuses](/help/statuses)."],
                ["Client reference", "Their PO or job number. Printed on the quote and invoice."],
                ["Project discount (%)", "Off the whole project."],
                ["Charge for days", "Overrides how many days are charged."],
                ["Notes on the quote", "Printed on the quote for the client."],
                ["Internal notes", "For the team only."],
              ],
            },
          },
          { h: "Finding projects" },
          {
            list: [
              "The **Projects** list filters by client, location, crew (**Anyone**, **Someone**) and **When** (on today, next 7 days, next 30 days, not started yet, finished).",
              "Choose **Mine** in the **Show** filter for the projects you're on. They're under **My projects** on Home too.",
              "Group by status or start month to see the pipeline.",
            ],
          },
          { h: "Copying a project" },
          "For a repeat event, choose **Copy project…** from the project's **More** menu and give it a new name and start date. The copy keeps the client, location, notes, custom fields, schedule (moved to the new start), equipment and crew needs. Quotes, scans and who was rostered stay with the original.",
          { h: "Overdue" },
          "A project shows as **Overdue** when it's out past its return time, or when it's been set to returned but some of its kit hasn't been scanned back in.",
          { h: "Deleting" },
          "**Delete** removes a project for good.",
          { tip: "Only delete a project made by mistake. Set one that didn't go ahead to Cancelled, so its history stays." },
        ],
      },
      {
        id: "schedule",
        title: "Schedule and subprojects",
        blocks: [
          "The **Schedule** tab holds every time on the project. There are three kinds:",
          { ui: "schedule" },
          {
            table: {
              head: ["Kind", "Does"],
              rows: [
                ["Usage", "Books the equipment: it's held from the start to the end, and unavailable to other projects. Usually prep to return."],
                ["Billing", "Charged: the days on the quote are counted from these, each period on its own."],
                ["Schedule only", "Crew calls, pack in, rehearsals, show times. On the plan and the documents, but doesn't book or charge."],
              ],
            },
          },
          "Every project has at least one usage and one billing period. Choose **Add period** for more, like a second show week with a gap in between.",
          { h: "Adding to the schedule" },
          {
            steps: [
              "On the **Schedule** tab, choose **Add period**.",
              "Pick the kind, name it (\"Pack in\", \"Show\", \"Rehearsal\"), and set its start and end.",
              "Pick the **Space** at the location, if it has them.",
              "Add the crew it needs, if any. See [Rostering crew](/help/rostering).",
            ],
          },
          "Switch between **List** and **Calendar** at the top. In the calendar, drag a bar's end to change it.",
          { tip: "Book usage from when kit leaves your building to when it's back on the shelf. Book billing for what the client agreed to pay for, usually the show days. A dry hire's billing is usually prep to return." },
          { h: "How days are charged" },
          "Each started 24 hours of billing counts as a day. **Charge for days** on the project overrides it.",
          { h: "Subprojects" },
          "A subproject is part of a project with its own times and equipment, like a second stage, a pre-rig day or a breakout room.",
          {
            steps: [
              "Choose **Add subproject** on the Schedule or Equipment tab.",
              "Name it, like \"Finale stage\".",
              "Set when its equipment is booked, and whether it's **Charged for the same time** or its own.",
            ],
          },
          "Its equipment is booked for its own times, and competes with the main project's for stock.",
        ],
      },
      {
        id: "equipment",
        title: "Equipment on a project",
        blocks: [
          "The **Equipment** tab lists everything on the project, under headings, with quantity, availability, rate, discount and amount.",
          { ui: "job-lines" },
          { h: "Adding equipment" },
          {
            steps: [
              "Choose **Add equipment**.",
              "Search for the item by name, code or barcode, and set how many.",
              "It's added under the heading you're in.",
            ],
          },
          "Adding a kit adds what's in it underneath. Use **See contents** to show them.",
          { h: "Headings" },
          "**Add heading** groups lines, like Audio, Lighting, Staging, Services. Headings print on quotes and packing lists. Move lines with **Move to another heading**, or **Move up** / **Move down**.",
          { tip: "Use the same headings on every project (Audio, Lighting, Video, Staging, Services). Quotes read consistently and the warehouse knows where to look." },
          { h: "Custom lines" },
          "**Custom line** adds a service or anything that isn't inventory: delivery, labour, consumables, a subhire. Set the **Description**, **Quantity**, **Price (ex GST)** and how it's **Charged**: **Once (each)**, **Per hour**, **Per day** or **Per week**.",
          { h: "Discounts" },
          "Set **Disc %** on a line, or **Project discount (%)** on the whole project.",
          { h: "Availability on each line" },
          "The **Availability** column shows how many are free for the project's dates, and a shortage when there aren't enough. See [Shortages](/help/availability#shortages).",
        ],
      },
      {
        id: "quotes",
        title: "Prices and quotes",
        blocks: [
          "Prices in R2 are ex GST. GST is added once on the total.",
          { h: "How a price is worked out" },
          "An equipment line is **day rate × quantity × day factor**, less any discount. The day factor turns the number of days into what's charged, so longer hires get cheaper per day. With the day factors you start with:",
          {
            table: {
              head: ["Days", "Day factor", "A $100/day item costs"],
              rows: [
                ["1", "1", "$100"],
                ["2", "1.5", "$150"],
                ["3", "2", "$200"],
                ["4", "2.5", "$250"],
                ["5 to 7 (a week)", "3", "$300"],
                ["Each day after a week", "+0.5", "+$50"],
              ],
            },
          },
          "Your business's day factors, **Each extra day adds**, the **GST rate (%)**, **Quotes valid for (days)** and **Quote terms** are in **Settings → Pricing & tax**. Items priced per hour, week or each are charged that way instead.",
          { h: "Issuing a quote" },
          {
            steps: [
              "Check the equipment, schedule, discount and **Notes on the quote**.",
              "Choose **Issue quote** on the project.",
              "Open the quote to print it or save it as a PDF, and send it to the client.",
            ],
          },
          "Each quote is numbered from the project, like **Q1042-2** (the second quote for project 1042). An issued quote never changes, even if the project does. If the project changes, issue a new one.",
          { h: "Quote statuses" },
          {
            table: {
              head: ["Status", "Means"],
              rows: [
                ["Issued", "Sent, waiting to hear back"],
                ["Accepted", "The client said yes. This is the one invoiced."],
                ["Declined", "The client said no"],
                ["Void", "Superseded or withdrawn"],
              ],
            },
          },
          { tip: "Mark the quote Accepted as soon as the client confirms, and set the project to Confirmed at the same time. The Xero export invoices from the accepted quote." },
        ],
      },
      {
        id: "documents",
        title: "Documents and packing lists",
        blocks: [
          "The **Documents** menu on a project prints its **Packing list** and any other documents your business has made.",
          "The packing list is what the warehouse packs from: every item and unit under its heading, with where it's kept.",
          { h: "Making your own documents" },
          "In **Settings → Documents** (or **Manage documents…** in the menu), make documents like a technical handover, a delivery docket or a return check. A document is made of parts, in order:",
          {
            table: {
              head: ["Part", "Prints"],
              rows: [
                ["Heading", "Starts a new section"],
                ["Instructions", "Text, like a reminder or terms"],
                ["Short answer / Long answer", "Lines to write on"],
                ["Tick box", "A box to tick"],
                ["Date and time", "Spaces for a date and time"],
                ["Signature", "Name, signature and date"],
              ],
            },
          },
          "Choose what equipment it shows: **No equipment**, an **Equipment list**, a **Checklist** (a box to tick for each item, with where it's kept), or a **Return check** (how many went out, and spaces for how many came back). It can also show the schedule and the project's notes.",
        ],
      },
      {
        id: "statuses",
        title: "Project statuses",
        blocks: [
          "A status says where a project's up to. Each business names its own in **Settings → Statuses** (under Planning). These are what you start with:",
          { ui: "status-stages" },
          "Every status sits on one of six fixed stages, which decide what it does to availability, tracking and invoicing:",
          {
            table: {
              head: ["Stage", "Kit", "Means"],
              rows: [
                ["Enquiry", "Holds nothing", "A price check"],
                ["Pencilled in", "Holds", "Likely, but shortages say it could be released"],
                ["Confirmed", "Holds", "Booked"],
                ["Out", "Out", "The kit's left the building"],
                ["Done", "Holds nothing", "Finished, and ready to invoice"],
                ["Cancelled", "Holds nothing", "Didn't go ahead"],
              ],
            },
          },
          { h: "Setting a project's status" },
          "Use the status at the top of the project, or tick projects in the Projects list and choose **Set status…**. Equipment tracking can also offer the next status once everything's been scanned. See [Equipment tracking](/help/tracking#moving-the-project-on).",
          { h: "Changing your statuses" },
          "In **Settings → Statuses**, each status has a name, a colour, and options:",
          {
            list: [
              "**Project** (open, finished or cancelled) and **Equipment** (released, pencilled, held or out): its stage.",
              "**Crew planning**: its projects are on the Rostering page.",
              "**Calendar**: its projects are in the calendar feed.",
              "**Invoicing**: its projects can go in the Xero export.",
              "**Default**: new projects start here.",
            ],
          },
          "Removing a status asks where its projects should go.",
          { tip: "Keep statuses to what people act on. If nobody does anything different when a project moves to a status, you don't need it." },
        ],
      },
      {
        id: "calendar",
        title: "Calendar feed",
        blocks: [
          "Your projects can show in Google Calendar, Outlook or Apple Calendar, and keep themselves up to date.",
          {
            steps: [
              "Go to **Settings → Calendar feed** and choose **Copy**.",
              "In your calendar app, add a calendar from a URL (sometimes called subscribe) and paste it.",
            ],
          },
          "Which statuses show is set per status in **Settings → Statuses**.",
          "Keep the address private: anyone with it can see your projects. If it gets out, **Make a new address**. Everyone subscribed will need to add the new one.",
        ],
      },
    ],
  },
  {
    title: "Rostering and crew",
    topics: [
      {
        id: "rostering",
        title: "Rostering crew",
        blocks: [
          "Crew are booked by what they do and when: 1 audio operator and 3 technical labour for the pack in, 1 lighting operator for the show.",
          { ui: "crew-needs" },
          { h: "Saying what crew you need" },
          {
            steps: [
              "On the project's **Schedule** tab, find the schedule item (like \"Pack in\") or add one.",
              "Under it, add a crew need: how many, the **Crew role**, and the level (or **Any level**).",
              "If they're needed at a different time from the item, like an hour early, give the need its own **Start** and **Finish**.",
              "Add notes if needed, like \"bring PPE\".",
            ],
          },
          { h: "Filling the slots" },
          {
            steps: [
              "Open the project's **Crew** tab. Each need has a slot per person.",
              "Choose a slot. R2 suggests people with that skill and level who are free first, then people who do the role but are booked or a lower level, then everyone else.",
              "Pick someone. Double bookings are allowed, but marked.",
            ],
          },
          "People can also be on the **Whole project**, like a project manager. Say what they're doing.",
          "Everyone rostered sees the project under **My projects** on Home.",
          { h: "The Rostering page" },
          "**Rostering** shows every project's crew needs over a week or more. Use it to fill slots across projects and see who's free.",
          {
            list: [
              "**By day**: each day's needs, filled and empty.",
              "**By person**: each person's bookings, and when they're free.",
              "**Show**: just **Slots to fill**, or just **Double bookings**.",
              "**How long**: 1 week, 2 weeks, 4 weeks or everything. **Earlier** and **Later** move along.",
            ],
          },
          "Only projects whose status is set for crew planning show here. See [Project statuses](/help/statuses).",
        ],
      },
      {
        id: "crew",
        title: "Crew list and roles",
        blocks: [
          "**Crew** lists everyone who can be rostered: every member of the business, plus freelancers who don't log in. It shows each person's skills, when they're next booked, and whether they're free in the next 60 days.",
          { h: "Adding a freelancer" },
          {
            steps: [
              "Go to **Crew** and choose **New freelancer**.",
              "Enter their name, phone and email.",
              "Tick their **Skills**: the crew roles they do, and the level for each.",
            ],
          },
          "Members are on the list automatically. Set their skills the same way on their page.",
          { h: "Crew roles" },
          "Crew roles are what people are booked to do: Audio operator, Lighting operator, Rigger, Driver, Technical labour. They're set up in **Settings → Crew roles**.",
          "A role can have levels, lowest first, separated by commas, like **Basic, Advanced, Senior** or **1F, 2F, 4F** for drivers. A crew need can ask for a level or above.",
          { tip: "Make crew roles the jobs you quote and roster for, not job titles. \"Audio operator\" and \"Audio tech\" as two roles splits the people who can do the same job." },
          "Crew roles aren't the same as the roles in **Users & access**, which control what people can do in R2.",
          { h: "A person's page" },
          "**General** has their details, skills and next bookings. **Bookings** lists every project they're on, coming up and past.",
          { h: "Archiving" },
          "**Archive** a freelancer you no longer use; they won't be offered for new projects. People who leave the business are archived for you.",
        ],
      },
    ],
  },
  {
    title: "Inventory",
    topics: [
      {
        id: "inventory-setup",
        title: "Setting up your inventory",
        blocks: [
          "Inventory is what people search, quote, pack and scan. How R2 stores it is in [Items](/help/items), [Units](/help/units) and [Kits](/help/kits); this topic adds how to set it up well.",
          { h: "Naming items" },
          "An item's **Name** shows in search, on quotes, packing lists, labels and documents. One item covers every one of that model: ten SM58s are one item with ten units.",
          {
            practice: [
              "Name items **Brand Model Human name Specs**: who makes it, the exact model, what anyone would call it, then any specs, like a rating or length. Specs always go last, after the human name. Everyone can find it whether they search for \"SM58\", \"Shure\" or \"mic\", and the name on a quote or packing list makes sense to a client and to a new casual.",
              { ui: "naming" },
              {
                table: {
                  head: ["Good", "Avoid", "Why"],
                  rows: [
                    ["Shure SM58 Vocal Mic", "SM58", "Nobody new knows what it is"],
                    ["d&b Y10P Speaker", "Y10P d&b spkr", "Abbreviations don't search"],
                    ["Martin MAC Aura XB Wash Light", "Aura", "Too vague"],
                    ["Yamaha CL5 Mixing Console", "Big Yamaha desk", "Not the model"],
                    ["Shure ULXD2 Handheld Wireless Mic", "Wireless mic 3", "Number the units, not the item"],
                    ["XLR Cable 10m", "10m XLR", "Lead with what it is when there's no brand"],
                    ["Power Lead 15A 5m", "15A lead (Bens)", "Ownership and notes go in notes"],
                    ["Chauvet Rogue R2X Spot Moving Head", "Rogue R2 X SPOT ML", "Keep the maker's model as written, then plain words"],
                    ["Prolyte H30V Truss 2m", "Prolyte 2m H30V Truss", "Specs go last, not between brand and model"],
                    ["Doughty Trigger Clamp 48mm", "Doughty 48mm Trigger Clamp", "Specs go last, after the human name"],
                    ["Apple MacBook Pro M5 14in", "Apple MacBook Pro Laptop 14in M5", "M5 is a code, so it's the model; 14in has a unit, so it's a spec. MacBook already says laptop."],
                    ["Power Lead 10A 5m", "10A AC Power Lead 5m", "The rating is a spec, so it goes last; AC only if you also stock DC leads"],
                  ],
                },
              },
              {
                list: [
                  "Write the brand and model the way the manufacturer does (d&b, not D&B or DB).",
                  "For things with no brand, start with what it is, then its specs: \"Sandbag 10kg\", \"Box Truss 290mm 2m\", \"Gaffer Tape Black 48mm\".",
                  "Specs (size, length, rating, angle) go at the very end, after the human name, in the same order every time: what kind it is first (rating, colour, profile), then its length or size last. \"Power Lead 15A 5m\" and \"Power Lead 15A 10m\" sit together in a list, and a search for \"15A\" finds both.",
                  "Skip the human name when the model already says what it is to someone outside the industry: \"Apple MacBook Pro M5 14in\", \"Apple iPad Air M3 11in\". Keep it when it doesn't: SM58, Y10P and H30V mean nothing to a client or a new casual.",
                  "Model or spec? If it has a unit (10A, 5m, 2m, 14in, 48mm), it's a spec and goes last. If it's a maker's code (SM58, H30V, QL5, M5), it's the model and goes before the human name.",
                  "Don't put a quantity, location, owner or condition in the name. They have their own fields.",
                ],
              },
            ],
          },
          { h: "Folders" },
          "Folders can sit inside folders, as deep as you like. Each item is in one folder, and the folder shows in its breadcrumbs, filters and labels.",
          {
            practice: [
              "Use two or three levels: department, then type, then (if it helps) a subtype. Arrange them the way people look for gear on the shelves and on a quote, not by supplier or purchase date.",
              { ui: "folders" },
            ],
          },
          { h: "Bulk or serialised?" },
          "A bulk item is counted: R2 knows how many you have. A serialised item has a unit for each one, with its own barcode, status, location, scan history and maintenance. An item can't change from serialised to bulk once it has units.",
          {
            practice: [
              {
                table: {
                  head: ["Make it serialised when…", "Make it bulk when…"],
                  rows: [
                    ["It has a serial number", "They're all the same and nobody cares which one"],
                    ["It needs test & tag, inspection or service per unit", "It's cheap or consumable"],
                    ["You want to know where each one is and its history", "Counting is enough: cables, clamps, sandbags, tape"],
                    ["It's worth more than about $200", "You'd never label each one"],
                  ],
                },
              },
              "Power leads and anything else that's tested individually should be serialised, even if they're cheap, so each one has its own test & tag record.",
            ],
          },
          { h: "Kits" },
          "A kit is quoted as one line, and adds everything in it to the project. See [Kits](/help/kits).",
          { tip: "Make a kit when things always go out together and are quoted as one: \"Wireless Mic Pack (4ch)\", \"DJ Pack\", \"Small PA\". If they only sometimes go together, add them separately." },
          { h: "Codes and barcodes" },
          {
            list: [
              "Leave **Item code** and **Barcode / asset tag** blank and R2 makes them. Barcodes are 7 digits with a check digit, so a mistyped one won't match the wrong unit.",
              "Existing asset tags can be typed or scanned in instead, and keep working.",
            ],
          },
          { tip: "Put the label somewhere it'll survive being packed and that you can reach with a scanner when the gear's in its case." },
          { h: "Getting it all in" },
          "**Settings → Import data** takes a spreadsheet of items. See [Importing spreadsheets](/help/import).",
          { tip: "If you have a list already, import it rather than typing it in. Set up folders and storage locations first, so the import can put things in the right place." },
        ],
      },
      {
        id: "items",
        title: "Items",
        blocks: [
          "**Inventory** lists everything you own, with folders down the side. Choose a folder to see what's in it, or search everything.",
          { h: "Adding an item" },
          {
            steps: [
              "Go to **Inventory** and choose **New item**. (Opening a folder first puts the item in it.)",
              "Type the **Name**, like \"Shure SM58 Vocal Mic\". See [Naming items](/help/inventory-setup#naming-items).",
              "Choose the **Folder**.",
              "Choose the **Kind**: **Physical item**, or **Kit**.",
              "For a physical item, choose the **Item type**: **Bulk** (counted) or **Serialised** (each one tracked).",
              "Fill in the price and anything else you know, and save.",
              "For a serialised item, add its units on the **Units** tab. For a bulk item, set **Quantity owned**.",
            ],
          },
          { ui: "item-kind" },
          "You can't change a serialised item to bulk once it has units.",
          { h: "The item page" },
          {
            table: {
              head: ["Tab", "What's on it"],
              rows: [
                ["General", "Price, free now, stock and where it's kept at the top; then its details in cards, and its availability for the next 60 days."],
                ["Units", "Serialised items: every unit with its barcode, serial number, status and location."],
                ["Contents", "Kits: what's in the kit."],
                ["Maintenance", "When it's next due, its repairs, plans and what's been spent on it."],
                ["History", "The projects it's booked on (coming up) and has been on (past)."],
              ],
            },
          },
          { h: "Fields" },
          {
            table: {
              head: ["Field", "What it's for"],
              rows: [
                ["Name", "Brand Model Human name Specs. Shows on quotes, packing lists and labels."],
                ["Item code", "A short number for the item. Leave blank to have one made."],
                ["Barcode", "Bulk items and kits: one barcode for the item. Units have their own."],
                ["Folder", "Where it sits in Inventory."],
                ["Kind", "Physical item or kit."],
                ["Item type", "Bulk or serialised."],
                ["Price (ex GST)", "What you charge to hire it, per day, hour, week or each (/day, /hr, /week, /ea)."],
                ["Replacement cost", "What it would cost to replace. For your reference and insurance."],
                ["Quantity owned", "Bulk items: how many you have."],
                ["Storage location, Shelf / bin", "Where to find it, like Main warehouse, Bay 3 top shelf."],
                ["Extra turnaround (h)", "Extra hours this item needs between projects, on top of the business's usual. See [Turnaround](/help/availability#turnaround)."],
                ["Weight (kg), Power (W)", "For planning trucks, rigging and power."],
                ["Internal notes", "Anything the team should know. Never printed for clients."],
                ["Custom fields", "Your business's own fields. See [Custom fields](/help/custom-fields)."],
              ],
            },
          },
          { h: "Photos" },
          "Add a photo on the item's General tab. **Find photo** searches the web and picks the best match for that model; check it's right. It takes a few seconds.",
          { tip: "Use a clean product photo of the exact model. It helps people pick the right thing when searching and packing." },
          { h: "Changing lots of items at once" },
          {
            steps: [
              "In **Inventory**, tick the items.",
              "Choose **Edit** in the bar above the list.",
              "Tick what to change (price, priced per, replacement cost, extra turnaround, weight, power, folder) and set it. Everything else stays as it is on each item.",
            ],
          },
          { h: "Archiving and deleting" },
          "**Archive** hides an item from lists and pickers and keeps its history. Tick **Show archived items** in the list to find it again and **Restore** it. **Delete** removes the item for good.",
          { tip: "Archive gear you've sold or stopped hiring. Only delete an item added by mistake." },
        ],
      },
      {
        id: "units",
        title: "Units and barcodes",
        blocks: [
          "Every unit of a serialised item has its own barcode, its own status and its own record of where it's been and what's been done to it.",
          { ui: "item-units" },
          { h: "Adding units" },
          {
            steps: [
              "Open the item and go to the **Units** tab.",
              "Choose **Add unit**.",
              "Scan or type its **Barcode / asset tag**, or leave it blank to have one made.",
              "Add the **Manufacturer serial**, and where it's kept.",
              "Give it a **Name** if you like, such as \"Desk 2\".",
              "Choose **Done**, or carry on adding the next one.",
            ],
          },
          { tip: "Only name units people need to tell apart by eye. Adding lots? Leave the barcode blank, add them all, then tick them and print their labels in one go." },
          { h: "Unit statuses" },
          {
            table: {
              head: ["Status", "Means", "Bookable?"],
              rows: [
                ["Active", "In service", "Yes"],
                ["In repair", "Being fixed. A repair sets this and puts it back to Active when it's done.", "No"],
                ["Lost", "Missing", "No"],
                ["Retired", "Written off or sold", "No"],
              ],
            },
          },
          "Change a unit's status on its page. Say what happened; it's added to the unit's notes. A unit on an open repair can only go back to Active through the repair.",
          { h: "Changing lots of units" },
          "On the **Units** tab, tick units and use the bar above: **Edit** (location, shelf, notes), **Repair** (opens one repair for all of them), **Retire**, **Print** labels, or **Delete**.",
          { h: "The unit page" },
          {
            list: [
              "**Details**: barcode, manufacturer serial, name, storage location, shelf / bin, purchase date, purchase cost and notes.",
              "**Maintenance**: what's due, what's been done, and its repairs.",
              "**Scan history**: every time it was scanned out and back, on which project.",
              "**Open repair** starts a repair for this unit.",
            ],
          },
          "To find a unit, scan or type its barcode into the search box at the top of any page.",
          { h: "Deleting a unit" },
          "Deleting a unit removes it and its history.",
          { tip: "Only delete a unit added by mistake. Mark one that's gone for good **Retired** or **Lost**, so its history stays." },
        ],
      },
      {
        id: "kits",
        title: "Kits",
        blocks: [
          "A kit is a set of items that go out together and are quoted as one line, like a wireless mic pack. A kit owns no stock: it's made of other items, and it's only as available as its scarcest part.",
          { ui: "kit" },
          { h: "Making a kit" },
          {
            steps: [
              "Choose **New item** and set the **Kind** to **Kit**. Name it, like \"Wireless Mic Pack (4ch)\".",
              "Give it a price: the price of the kit as a whole.",
              "Save, then open the **Contents** tab.",
              "**Add** each item in it and how many.",
              "Tick **Chargeable** on a content line to charge it on top of the kit's price.",
            ],
          },
          "Adding a kit to a project adds what's in it, so the packing list and scanning show every piece. If one of its contents is short, the kit shows **Contents short**.",
          "An item's **Used in** list shows the kits it's part of.",
          { tip: "Price kits at what you'd quote for the set, not the sum of its parts. Leave contents unticked for Chargeable so the client sees one line." },
        ],
      },
      {
        id: "bulk-stock",
        title: "Bulk stock and storage locations",
        blocks: [
          "A bulk item is counted: you have 40 of this cable, and any 4 of them will do.",
          { h: "How many you have" },
          "Set **Quantity owned** on the item. If it's kept in more than one place, use the item's **Storage locations** card: choose **Edit**, then add each location with its shelf or bin and how many are there. The total is what you own.",
          { h: "Out of service" },
          "Mark some out of service from the item page: say how many and why. They stop counting as available until you put them back. A [repair](/help/repairs#opening-a-repair) also takes stock out of service, and keeps track of the fix.",
          { tip: "Use a repair for anything being fixed, and out of service for stock that's away or waiting on a decision." },
          { h: "Storage locations" },
          "Storage locations are where you keep stock: \"Main warehouse\", \"Theatre store\", \"Truck 1\". Your admin sets them up in **Settings → Storage locations**. Items and units each have a storage location and a shelf or bin.",
          { tip: "Keep storage locations to buildings or big areas, and use Shelf / bin for the exact spot (\"Bay 3, top shelf\"). That way the location list stays short and filters stay useful." },
          "Storage locations aren't the same as **Locations** in the sidebar: those are the venues and sites projects happen at.",
        ],
      },
      {
        id: "folders",
        title: "Folders",
        blocks: [
          "Folders organise Inventory. They show down the side of the Inventory page.",
          {
            list: [
              "**New folder**: from the folder list, or **New folder inside** on a folder.",
              "**Rename** and **Move**: from a folder's options (⋯).",
              "**Delete**: choose whether to delete what's in it, or move its contents up a level.",
              "Move items between folders by editing their **Folder**, or in bulk with **Edit** on ticked items.",
            ],
          },
          "See [Folders](/help/inventory-setup#folders) in Setting up your inventory for how to arrange them.",
        ],
      },
      {
        id: "availability",
        title: "Availability",
        blocks: [
          "R2 works out how many of each item are free at every moment, from what you own and what projects have booked.",
          { ui: "availability-timeline", caption: "A project holds its kit from prep to return, plus turnaround. A project starting during that time clashes." },
          { h: "How it's worked out" },
          {
            list: [
              "A project holds its equipment for its **usage period** (prep to return), plus turnaround.",
              "Enquiries hold nothing. Pencilled-in and confirmed projects do.",
              "Free over a period is the **lowest** number free at any moment in it. A one-hour overlap still counts as a clash.",
              "Stock is quantity owned minus out of service for bulk items, and active units for serialised items.",
              "A kit is only as available as its scarcest part.",
              "Free can go below zero: you're overbooked, and it shows in red.",
            ],
          },
          { h: "Turnaround" },
          "Turnaround is time after a project's kit comes back before it can go out again: unpacking, checking, charging, cleaning. It's two numbers added together:",
          {
            list: [
              "**Turnaround buffer (hours)** in **Settings → Pricing & tax**, for every item.",
              "**Extra turnaround (h)** on an item, for gear that needs longer, like a hazer that needs cleaning or a console that needs resetting.",
            ],
          },
          { h: "The availability graph" },
          "Every item's General tab shows a bar for each of the next 60 days: how many are free at the tightest moment that day. Red means none free or overbooked.",
          { ui: "availability-strip" },
          "Hover over a day (or tap it on a phone) to see how many are free and which projects have it. Click a project to open it.",
          { h: "Shortages" },
          "On a project's **Equipment** tab, the **Availability** column shows how many are free for that project's dates. When there aren't enough it shows how many you're short, and whether releasing pencilled-in holds on other projects would cover it.",
          {
            practice: [
              "Ways to fix a shortage, roughly in order:",
              {
                list: [
                  "Swap in a similar item.",
                  "Release (cancel or move) a pencilled-in project that's holding it.",
                  "Fix or find broken or lost units.",
                  "Hire some in, and add it to the project as a custom line.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "custom-fields",
        title: "Custom fields",
        blocks: [
          "When you need to record something R2 doesn't have a field for, add your own.",
          {
            table: {
              head: ["For", "Set up in"],
              rows: [
                ["Items", "Settings → Custom item fields"],
                ["Projects, contacts and locations", "Settings → Custom fields (under Planning)"],
              ],
            },
          },
          "Each field is **Text**, **Number**, **Yes / no**, **Date** or **Dropdown** (with its choices separated by commas). Fill them in on a record's **Custom fields** card. Lists can show them as columns and search them, and group by yes/no and dropdown fields. Label templates can print item fields.",
          { tip: "Only add a field you'll filter, sort or print by. For one-off information, use Internal notes." },
        ],
      },
    ],
  },
  {
    title: "Equipment tracking",
    topics: [
      {
        id: "tracking",
        title: "Equipment tracking",
        blocks: [
          "Equipment tracking follows kit to a project and back by scanning it. Each piece has its own step, so the audio can be loaded while the lighting's still being prepped.",
          { h: "Tracking steps" },
          "Kit is scanned to a step. Each business sets its own in **Settings → Tracking steps**. You start with:",
          { ui: "tracking-steps" },
          "Each step is one of three kinds: getting ready (still in the building), gone (left with the project) or back (returned to stock). Kit can skip steps, and go back one (like unloaded back to the bay).",
          { h: "Scanning" },
          { ui: "scan" },
          {
            steps: [
              "Open **Equipment tracking** in the sidebar and pick the project (search by number, name or client). Or use **Scan →** on the project.",
              "Pick the **Tracking step** you're scanning to, like Prepped.",
              "Scan each unit's barcode with a scanner, or with the camera. For bulk items, set how many the scan counts as first.",
              "Each scan shows on the list below. **On this project** shows what's still to do.",
            ],
          },
          "R2 refuses a scan that doesn't make sense, like a unit that's on another project, in repair, or not on this project, and says why.",
          { tip: "Pick the step once and scan everything for it in one go. A Bluetooth scanner clipped to a phone is the quickest way to do a big prep." },
          { h: "Moving the project on" },
          "When everything reaches a step, R2 can offer to move the project's status on. Scan the last unit onto the truck and it asks:",
          { ui: "tracking-offer" },
          "Whoever's scanning can say yes, even if they can't otherwise edit the project.",
          { h: "The boards" },
          { ui: "tracking-board" },
          "The **Equipment tracking** page shows every project going out, out, or back in the last fortnight, in a column for each step. A project's own tracking page shows its equipment the same way, one card per line. Cards move as kit is scanned. Switch between **Board** and **List** at the top.",
          "Planners can drag a project to a step that has a status, and the project takes that status. That's handy for businesses that don't scan every piece.",
          { h: "Damaged kit" },
          "When kit comes back broken, choose **Report fault** next to the unit after scanning it in. It opens a repair for it on the spot, linked to the project it came back from.",
        ],
      },
    ],
  },
  {
    title: "Maintenance",
    topics: [
      {
        id: "maintenance",
        title: "Maintenance overview",
        blocks: [
          "Everything that keeps your kit working is under **Maintenance**. The buttons at the top start the main jobs: **Schedule job**, **Create repair** and **New plan**.",
          {
            table: {
              head: ["Tab", "What's on it"],
              rows: [
                ["Due", "Maintenance due or overdue, soonest first."],
                ["Repairs", "Broken kit being fixed. See [Repairs](/help/repairs)."],
                ["Plans", "Maintenance that repeats. See [Plans](/help/plans)."],
                ["History", "Everything that's been done."],
              ],
            },
          },
          { h: "Due" },
          "Shows work due within **How far ahead** (a month, 30 days, 90 days or everything). Filter by plan or one-off jobs, or search by item, barcode or what the work is.",
          {
            list: [
              "Open a job to record it. See [Recording maintenance](/help/recording-maintenance).",
              "Tick jobs and choose **Mark passed** to record lots at once.",
              "Tick jobs and choose **Move due date…** to reschedule them.",
            ],
          },
          { h: "History" },
          "Everything done, with the result, cost, files and who did it. Filter by how far back and by result (passed, failed). **Download CSV** gives you a spreadsheet of what's shown, for audits and insurance.",
        ],
      },
      {
        id: "repairs",
        title: "Repairs",
        blocks: [
          "A repair is for broken kit: some units of an item, or a number of a bulk item. While it's open, the kit is out of service and can't be booked or scanned out.",
          { h: "Opening a repair" },
          {
            list: [
              "**Create repair** on Home, Maintenance or an item's page.",
              "**Open repair** on a unit's page.",
              "**Report fault** when scanning kit back in.",
              "Failing a maintenance job.",
              "Ticking units and choosing **Repair**.",
            ],
          },
          {
            table: {
              head: ["Field", "What it's for"],
              rows: [
                ["Item and units", "What's broken. For bulk items, how many."],
                ["What's wrong", "The fault, specifically: \"Crackles when the cable moves\"."],
                ["Status", "Where it's up to."],
                ["Came back damaged from", "The project it came back broken from. That project lists it."],
                ["Start on", "When the work's planned."],
                ["Assigned to", "Someone on the team, or a supplier."],
                ["Expected back", "When it should be fixed by."],
                ["Files", "Photos of the damage, the repairer's report, quotes, invoices."],
              ],
            },
          },
          { tip: "Write the fault so whoever picks it up can find it: what happens, when, and on which channel or part. \"No output on channel 3 when warm\" beats \"broken\"." },
          { h: "Repair statuses" },
          { ui: "repair-flow" },
          "Each business names its own in **Settings → Repair statuses**. Each status says what happens to the kit:",
          {
            table: {
              head: ["Kit", "Means"],
              rows: [
                ["Out of service", "Still being fixed. Can't be booked."],
                ["Back in service", "Fixed. Units go back to Active; bulk stock is available again."],
                ["Retired", "Can't be fixed. Units are retired; bulk stock goes down."],
              ],
            },
          },
          "A status can also **close the repair**. Moving a repair back to an out-of-service status takes the kit out of service again.",
          { h: "Working on a repair" },
          "The repair's page has its details, notes (quotes, parts ordered, what was done), cost, files, and an activity trail of every change. Move it through the statuses as the work happens.",
          "The **Repairs** tab lists them all, with who they're assigned to, when they're expected back and what they've cost.",
        ],
      },
      {
        id: "plans",
        title: "Plans",
        blocks: [
          "A plan is maintenance that repeats: an annual PPE inspection, test & tag every 3 months, a hazer service every 6 months.",
          { h: "Making a plan" },
          {
            steps: [
              "In **Maintenance**, choose **New plan**.",
              "Name it for the work: \"Annual PPE inspection\", \"Test & tag\", \"Hazer service\".",
              "Set **How often**: every so many days, weeks, months or years.",
              "Choose when the next one is due after each: **On a set day** or **After completion**.",
              "Set when the **Next one due** is.",
              "Add the items it covers. **Add a whole folder…** adds everything in a folder.",
              "Add **Instructions**: what to check, and what fails it. They show on every job.",
            ],
          },
          { ui: "plan-repeat" },
          {
            table: {
              head: ["Repeats", "Next one due", "Use for"],
              rows: [
                ["On a set day", "Same date every time, however late it was done", "Compliance with fixed dates, like an annual inspection every March"],
                ["After completion", "Counted from the day it was actually done", "Servicing by use, like every 6 months after the last service"],
              ],
            },
          },
          { h: "What a plan does" },
          "Each unit of a serialised item, and each bulk item as a whole, gets its own scheduled job. New units join their item's plans by themselves; lost and retired units drop out.",
          "Open a plan to see each unit's last done and next due, or **Find a unit…**. **Change plan** edits it.",
          { tip: "Write instructions as a checklist with clear fail points: \"Fail if webbing is cut, frayed or burnt.\" Anyone can then do the inspection the same way." },
        ],
      },
      {
        id: "recording-maintenance",
        title: "Recording maintenance",
        blocks: [
          "Every job, from a plan or one-off, is recorded when it's done. Recording a plan's job schedules its next one.",
          { h: "Recording a job" },
          {
            steps: [
              "Open the job from **Due**, or from the item or unit.",
              "Choose **Record it**.",
              "Pass or fail it. For bulk items, say **How many failed**.",
              "Set **Done on**, **Done by** (who did it, or which company), and add **Notes**: readings, what was done, parts used.",
              "On a fail, say **What's wrong?** and R2 opens a repair for it.",
            ],
          },
          "Add the **Cost** and files (certificates, photos, invoices) to the job.",
          { h: "Lots at once" },
          "On the **Due** tab, tick jobs and choose **Mark passed** to record them all as passed, with one date and who did it.",
          { tip: "On a test & tag or inspection day, record the fails one by one as you find them, then mark everything else passed in one go at the end." },
          { tip: "Scan a unit's barcode into the search box to open it and see what's due on it straight away." },
          { h: "One-off jobs" },
          "For work that doesn't repeat, choose **Schedule job**: what needs doing (\"Replace the fan, update firmware\"), when it's due, and what it's on: an item, some of its units (none ticked means the item as a whole), or nothing in particular.",
        ],
      },
    ],
  },
  {
    title: "Labels",
    topics: [
      {
        id: "labels",
        title: "Printing labels",
        blocks: [
          "Labels carry a barcode or QR code that R2 scans, plus whatever text helps people: the item's name, its code, the business name, the next test & tag date.",
          { ui: "label" },
          { h: "Printing" },
          {
            list: [
              "**One unit or item**: use **Print** on its page.",
              "**Lots**: tick units or items in a list, then **Print** in the bar above.",
              "**Anything else**: **Print label** in the sidebar prints a one-off label, built from scratch or **From template**, like a case label or a sign.",
            ],
          },
          "The print dialog shows each label before it prints. Pick the **Template**, the **Printer** and how many **Copies**, then **Print labels**. If the printer doesn't answer, R2 tries the next printer with the same labels loaded.",
          { tip: "Print a test label and scan it before doing a big batch." },
          "Any label can be downloaded as a PDF instead, to print on any printer.",
        ],
      },
      {
        id: "label-templates",
        title: "Designing label templates",
        blocks: [
          "**Settings → Label templates** lists your designs. **New template** opens the designer; **Make default** sets the one used unless someone picks another.",
          { h: "The designer" },
          {
            list: [
              "Choose the label size first, to match what's in the printer.",
              "Add **Text**: typed text, or a **Data field** that fills in for each label (name, code, barcode, folder levels, custom fields).",
              "Add a **Barcode** or QR code. Tick **Print the value under the bars** to print the number too.",
              "Add images (like your logo), boxes and lines.",
              "Drag things into place. Snapping and the grid line things up; the layers list sets what's on top.",
              "**Shrink to fit** keeps long names on the label.",
            ],
          },
          { tip: "Keep labels simple: a big QR code, the item name and the barcode number. Small text on small labels is hard to read in a dark truck." },
          "**Export** saves a template to a file, to keep or to use in another business.",
        ],
      },
      {
        id: "printers",
        title: "Printers and print agents",
        blocks: [
          "**Settings → Printer setup** lists your label printers.",
          { h: "Adding a printer" },
          {
            steps: [
              "Choose **Add printer**.",
              "Give it a name people will recognise, like \"Workshop Brother\".",
              "Enter its **Network address** (like 192.168.1.50) and **Model**.",
              "Set what it's **Loaded with**: the label size in it now.",
              "Choose what it **Prints through**: a print agent, or this server.",
            ],
          },
          "Under **Label sizes**, add the sizes you use: Brother tape, Brother die-cut labels, or other sizes (Zebra, sheets) printed from a PDF.",
          { h: "Print agents" },
          "If R2 runs in the cloud, it can't reach printers on your network by itself. A print agent is a small program on a computer at your venue that's always on, like a Raspberry Pi. It collects labels from R2 and sends them to your printers.",
          {
            steps: [
              "Choose **Add print agent**, name it, and pick where it runs: **Raspberry Pi or Linux**, **Docker**, or **Windows or Mac**.",
              "Copy the setup command shown and run it on that computer. The token is only shown once.",
              "Set your printers to print through it.",
            ],
          },
          "The dots next to printers show whether they're answering.",
        ],
      },
    ],
  },
  {
    title: "Contacts and locations",
    topics: [
      {
        id: "contacts",
        title: "Contacts",
        blocks: [
          "**Contacts** are your clients: companies and people you do projects for.",
          {
            table: {
              head: ["Field", "What it's for"],
              rows: [
                ["Name", "The business, or the person if it's a private client."],
                ["Contact person", "Who you deal with there."],
                ["Email, Phone", "How to reach them."],
                ["Billing address", "Printed on quotes and invoices. Look it up as you type."],
                ["Internal notes", "For the team only."],
              ],
            },
          },
          "A contact's page shows their next and last project, and all their projects coming up and past. **New project** on it starts one for them.",
          { tip: "Name contacts by the business that pays, exactly as on their invoices: \"Harbour Events Ltd\". Put the person in Contact person." },
          "**Archive** a contact you no longer work with. They're hidden from lists and pickers; their projects stay.",
        ],
      },
      {
        id: "locations",
        title: "Locations and spaces",
        blocks: [
          "**Locations** are the venues and sites your projects happen at.",
          {
            list: [
              "**Address**: looks itself up as you type. Pick a match and it's filled in; **Map ↗** opens it.",
              "**On-site contact**: who to call when you get there.",
              "**Spaces**: rooms or areas at the location, like a theatre's Main Stage and Studio, or a hotel's ballroom and terrace. **Add space** to add one. Schedule items can be put in a space.",
              "**Notes**: access, parking, power, loading dock.",
            ],
          },
          "A location's page shows what's on there now and its projects coming up and past.",
          { tip: "Put loading dock, access times and power details in a location's notes once, and every crew member can find them for every show there." },
        ],
      },
    ],
  },
  {
    title: "Xero export",
    topics: [
      {
        id: "xero",
        title: "Xero export",
        blocks: [
          "**Xero export** builds a file of draft invoices for Xero's sales invoice import.",
          { h: "Exporting" },
          {
            steps: [
              "Go to **Xero export**.",
              "Set **Projects back from** to the dates you're invoicing for.",
              "Check the **Invoice date**.",
              "Check the list: each project shows its client, status, when it came back, its quote and the total incl GST. Projects with **No quote** can't be invoiced until one is issued.",
              "Choose **Download Xero file**, and import it in Xero under Sales → Invoices → Import.",
            ],
          },
          "A project that's **Changed since** its quote won't invoice the changes: issue a new quote first.",
          { h: "How invoices are made" },
          {
            list: [
              "Each project becomes one draft invoice, from its latest accepted quote (or latest issued one, if none's accepted).",
              "Invoices are numbered from the project, like **R2-1042**. Xero refuses a number it already has, so a project can't be invoiced twice.",
              "Only projects whose status is set for invoicing are included.",
              "Xero works out GST line by line, so its total can be a cent different from R2's.",
            ],
          },
          { h: "Setting it up" },
          "In **Settings → Accounting**, set the **Sales account code**, **Tax rate name**, **Payment terms (days)** and **Invoice number prefix**. They must match your Xero organisation's exactly.",
        ],
      },
    ],
  },
  {
    title: "Settings",
    topics: [
      {
        id: "settings",
        title: "Settings overview",
        blocks: [
          "Settings is where your business is set up. You see the sections your role can change.",
          {
            table: {
              head: ["Group", "Sections"],
              rows: [
                ["Organisation", "Business details, Users & access, Audit log"],
                ["Planning", "Statuses, Custom fields, Documents, Calendar feed, Crew roles"],
                ["Warehouse", "Storage locations, Custom item fields, Tracking steps, Repair statuses, Label templates, Printer setup"],
                ["Finance", "Pricing & tax, Accounting"],
                ["Data", "Import data, Integrations"],
              ],
            },
          },
          { h: "Business details" },
          {
            list: [
              "**Business name** and **Short name**: printed on quotes and documents; the short name shows in the browser tab.",
              "**Address**, **Phone**, **Email**, **GST number**: printed on quotes.",
              "**Time zone**: used for dates on documents and for what \"today\" means for maintenance.",
            ],
          },
          { h: "Audit log" },
          "Every change, by whom and when. Search it by person or what changed, or **Download JSON**. The usage snapshot at the top shows active projects, items, units, kits, contacts and labels printed.",
        ],
      },
      {
        id: "people",
        title: "People and roles",
        blocks: [
          "**Settings → Users & access** has two tabs: **Members** (who's in the business) and **Roles & permissions** (what they can do).",
          { h: "Inviting someone" },
          {
            steps: [
              "In **Members**, choose **Invite someone**.",
              "Enter their **Email** and pick a **Role**.",
              "They get an email. They sign up with that address, verify it, and accept. You can also **Copy** the invitation link and send it yourself.",
            ],
          },
          "**Remove from team** takes someone out of the business. Their history stays.",
          { h: "Roles" },
          "A role is a name and a list of what it's allowed to do, grouped as Inventory, Projects, Crew, Prices and quotes, Warehouse, Contacts and locations, Labels, Imports and exports, and Administration. Each business makes its own.",
          {
            list: [
              "**Admin** can always do everything, including anything added later. It can't be changed.",
              "**New role** starts one; **Duplicate** copies one to change.",
              "Everyone in the business can look things up. Roles control what people can change.",
              "Some permissions need others: issuing quotes needs seeing them, and seeing quotes needs seeing prices. They're ticked for you.",
              "Nobody can give someone more than they can do themselves.",
            ],
          },
          { ui: "roles" },
          { tip: "Make roles for jobs, like Planner, Warehouse, Technician, Crew. Give each the least it needs. Keep Admin to a couple of people." },
        ],
      },
      {
        id: "features",
        title: "Features",
        blocks: [
          "Projects, equipment tracking, repairs, maintenance plans, labels, prices and quotes, crew rostering, live sync and the Xero export can each be on or off for your business. A feature that's off is hidden for everyone. Nothing's deleted, so turning it back on picks up where it left off.",
          "Some features need others: equipment tracking, quotes, crew rostering and the Xero export need projects.",
          "Features are set for your business as a whole, not in Settings. To change them, ask whoever runs R2 for your business.",
        ],
      },
      {
        id: "import",
        title: "Importing spreadsheets",
        blocks: [
          "**Settings → Import data** brings in items or contacts from a spreadsheet saved as CSV.",
          {
            steps: [
              "Choose what you're importing, and choose the file.",
              "Check the **Columns**: R2 matches your column headings to its fields. Change any it got wrong, or set them to **Not imported**.",
              "Check the **Preview**.",
              "Import. If any rows have problems, nothing is saved: R2 lists the rows to fix. Fix them in the spreadsheet and choose the file again.",
            ],
          },
          {
            table: {
              head: ["Importing", "Columns R2 understands"],
              rows: [
                ["Items", "Name, Code, Category (the folder), Quantity, Unit barcodes, Item barcode, Price, Price per, Replacement cost, Weight (kg), Power (W), Storage location, Shelf / bin, Description, Internal notes"],
                ["Contacts", "Name, Contact person, Email, Phone, Billing address, Notes"],
              ],
            },
          },
          { tip: "Set up folders and storage locations first. Clean up names before importing (Brand Model Human name Specs), and import a few rows first to check: fixing 10 items is easier than 1,000." },
        ],
      },
      {
        id: "integrations",
        title: "Rentman and Momentus",
        blocks: [
          "**Settings → Integrations** keeps R2 in step with Rentman or Momentus.",
          { h: "Rentman" },
          {
            list: [
              "Paste your **Rentman API token** and choose **Start syncing with Rentman**.",
              "Equipment, clients and locations sync both ways. Projects and their equipment come in from Rentman only.",
              "R2 projects can be sent to Rentman as project requests.",
              "Add the **Webhook address** in Rentman so changes come across straight away.",
            ],
          },
          { h: "Momentus" },
          "For venues: events come in as projects, AV orders as their equipment, issued quotes go back as orders, and inventory can be sent as resources. Enter the Momentus address, organisation code and API user, and choose what to bring in.",
          { h: "When both sides change" },
          "Changes are copied across every minute or so. If the same thing changed on both sides, your rule decides: **Newest edit wins**, the other system's wins, or **R2 wins**. Conflicts are listed in the sync history.",
          "Deleting something on one side archives it on the other.",
        ],
      },
    ],
  },
];

// A heading's anchor: /help/topic#its-slug.
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function blockText(b: HelpBlock): string[] {
  if (typeof b === "string") return [b];
  if ("h" in b) return [b.h];
  if ("list" in b) return b.list;
  if ("steps" in b) return b.steps;
  if ("tip" in b) return [b.tip];
  if ("practice" in b) return b.practice.flatMap(blockText);
  if ("table" in b) return [...b.table.head, ...b.table.rows.flat()];
  return b.caption ? [b.caption] : [];
}

function plain(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

// Every topic split at its subheadings, for search: a result takes you
// to the part of the page that matched.
export interface HelpSection {
  topic: HelpTopic;
  heading: string | null;
  anchor: string;
  text: string;
}

export const SECTIONS: HelpSection[] = HELP.flatMap((g) =>
  g.topics.flatMap((topic) => {
    const out: HelpSection[] = [];
    let current: HelpSection = { topic, heading: null, anchor: "", text: topic.title };
    for (const b of topic.blocks) {
      if (typeof b === "object" && "h" in b) {
        out.push(current);
        current = { topic, heading: b.h, anchor: slug(b.h), text: b.h };
      } else {
        current.text += " " + blockText(b).join(" ");
      }
    }
    out.push(current);
    return out.map((s) => ({ ...s, text: plain(s.text) }));
  }),
);
