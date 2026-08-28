/// <reference path="../pb_data/types.d.ts" />
// Each handler does its own require() at the top of its own function body —
// see routes_assets.pb.js for why.

routerAdd(
  "GET",
  "/api/projects",
  (e) => {
    const { rentman } = require(`${__hooks}/lib/rentman.js`);
    // Unlike equipment/serial numbers (a bounded, all-relevant-now catalog),
    // a workshop's project history can span years — take the single largest
    // page Rentman allows (1500) rather than walking every page.
    const query = e.requestInfo().query;
    return e.json(
      200,
      rentman.listProjects({
        limit: query.limit ? Number(query.limit) : 1500,
        offset: query.offset ? Number(query.offset) : undefined,
      }),
    );
  },
  $apis.requireAuth(),
);

routerAdd(
  "GET",
  "/api/projects/{id}",
  (e) => {
    const { rentman } = require(`${__hooks}/lib/rentman.js`);
    const id = e.request.pathValue("id");
    try {
      const project = rentman.getProject(id);
      const subprojects = rentman.listSubprojects(id);
      return e.json(200, Object.assign({}, project, { subprojects: subprojects.data }));
    } catch (err) {
      console.error(err);
      throw new NotFoundError("Project not found");
    }
  },
  $apis.requireAuth(),
);

// Admin-only financial overview: every project with its rolled-up money
// (totals + costs summed across its in_financial subprojects) and a flag +
// breakdown for any discount applied on a subproject. Powers the
// /project-financials page and its CSV/JSON export.
//
// Rentman keeps the money on subprojects, not the project, and only returns
// the computed *_price / *_cost fields when an explicit `fields=` list is
// requested — hence the long field lists below.
(function () {
  const { requireAdmin } = require(`${__hooks}/lib/auth.js`);

  const PROJECT_FIELDS = [
    "id", "name", "displayname", "number", "reference", "customer",
    "account_manager", "project_type", "planperiod_start", "planperiod_end",
    "usageperiod_start", "usageperiod_end", "already_invoiced",
  ].join(",");

  const SUBPROJECT_FIELDS = [
    "id", "name", "project", "order", "status", "in_financial",
    "project_total_price", "project_total_price_cancelled",
    "project_rental_price", "project_sale_price", "project_crew_price",
    "project_transport_price", "project_other_price", "project_insurance_price",
    "project_services_price", "estimated_cost", "planned_cost", "actual_cost",
    "discount_rental", "discount_sale", "discount_crew", "discount_transport",
    "discount_additional_costs", "discount_services", "discount_subproject",
    "discount_fixed", "discount_fixed_amount",
  ].join(",");

  // Rentman stores percentage discounts as fractions (0.1 === 10%).
  const PERCENT_DISCOUNT_FIELDS = [
    ["discount_rental", "rental"],
    ["discount_sale", "sale"],
    ["discount_crew", "crew"],
    ["discount_transport", "transport"],
    ["discount_additional_costs", "additional costs"],
    ["discount_services", "services"],
    ["discount_subproject", "subproject"],
  ];

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  routerAdd(
    "GET",
    "/api/projects/financials",
    (e) => {
      const { rentman, idFromRef } = require(`${__hooks}/lib/rentman.js`);

      const projects = rentman.listAllProjects({ fields: PROJECT_FIELDS });
      const subprojects = rentman.listAllSubprojects({ fields: SUBPROJECT_FIELDS });

      const nameById = (records) => {
        const map = new Map();
        for (const r of records) map.set(String(r.id), r.displayname || r.name || null);
        return map;
      };
      const statusName = nameById(rentman.listStatuses({ limit: 1500 }).data);
      const typeName = nameById(rentman.listProjectTypes({ limit: 1500 }).data);
      // Customer/account-manager names are a nice-to-have — a slow or failing
      // contacts/crew walk shouldn't sink the whole financial report.
      let contactName = new Map();
      let crewName = new Map();
      try {
        contactName = nameById(rentman.listAllContacts({ fields: "id,name,displayname" }));
        crewName = nameById(rentman.listAllCrew({ fields: "id,name,displayname" }));
      } catch (err) {
        console.warn("[projects/financials] could not resolve contact/crew names: " + err);
      }

      const subsByProject = new Map();
      for (const s of subprojects) {
        const pid = idFromRef(s.project);
        if (!pid) continue;
        if (!subsByProject.has(pid)) subsByProject.set(pid, []);
        subsByProject.get(pid).push(s);
      }

      const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

      const rows = projects.map((p) => {
        const all = (subsByProject.get(String(p.id)) || []).slice().sort((a, b) => num(a.order) - num(b.order));
        const subs = all.filter((s) => s.in_financial !== false);
        const sum = (f) => subs.reduce((acc, s) => acc + num(s[f]), 0);

        const discounts = [];
        for (const s of subs) {
          for (const [field, label] of PERCENT_DISCOUNT_FIELDS) {
            if (num(s[field]) > 0) {
              discounts.push({ subproject: s.name, type: label, percent: round2(num(s[field]) * 100) });
            }
          }
          if (s.discount_fixed === true && num(s.discount_fixed_amount) !== 0) {
            discounts.push({ subproject: s.name, type: "fixed", amount: round2(num(s.discount_fixed_amount)) });
          }
        }

        const totalPrice = sum("project_total_price");
        const actualCost = sum("actual_cost");

        return {
          id: p.id,
          name: p.displayname || p.name || "",
          number: typeof p.number === "number" ? p.number : null,
          reference: p.reference || "",
          customer: contactName.get(idFromRef(p.customer) || "") || null,
          accountManager: crewName.get(idFromRef(p.account_manager) || "") || null,
          projectType: typeName.get(idFromRef(p.project_type) || "") || null,
          status: subs.length ? statusName.get(idFromRef(subs[0].status) || "") || null : null,
          periodStart: p.usageperiod_start || p.planperiod_start || null,
          periodEnd: p.usageperiod_end || p.planperiod_end || null,
          subprojectCount: all.length,
          totalPrice: round2(totalPrice),
          rentalPrice: round2(sum("project_rental_price")),
          salePrice: round2(sum("project_sale_price")),
          crewPrice: round2(sum("project_crew_price")),
          transportPrice: round2(sum("project_transport_price")),
          otherPrice: round2(sum("project_other_price")),
          insurancePrice: round2(sum("project_insurance_price")),
          servicesPrice: round2(sum("project_services_price")),
          estimatedCost: round2(sum("estimated_cost")),
          plannedCost: round2(sum("planned_cost")),
          actualCost: round2(actualCost),
          margin: round2(totalPrice - actualCost),
          alreadyInvoiced: round2(num(p.already_invoiced)),
          hasDiscount: discounts.length > 0,
          discounts: discounts,
        };
      });

      rows.sort((a, b) => String(b.periodStart || "").localeCompare(String(a.periodStart || "")));

      return e.json(200, { data: rows, generatedAt: new Date().toISOString() });
    },
    $apis.requireAuth(),
    requireAdmin,
  );
})();

// projectequipment has no project/subproject field of its own — it's scoped
// via projectequipmentgroup, which does: group-by-project, then
// equipment-lines-by-group.
routerAdd(
  "GET",
  "/api/projects/{id}/equipment",
  (e) => {
    const { rentman } = require(`${__hooks}/lib/rentman.js`);
    const id = e.request.pathValue("id");
    const groups = rentman.listProjectEquipmentGroups({ project: "/projects/" + id });
    const lineLists = groups.data.map(
      (g) => rentman.listProjectEquipment({ equipment_group: "/projectequipmentgroup/" + g.id }).data,
    );
    return e.json(200, { lines: [].concat.apply([], lineLists), groups: groups.data });
  },
  $apis.requireAuth(),
);
