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

// Admin-only: every project, its rolled-up rental value, and whether any
// discount was given. Powers the /project-financials page and its export.
//
// Kept deliberately lean — this runs synchronously inside the request, behind
// a Cloudflare gateway with a hard timeout, against a Rentman API that is
// often slow. So: only TWO required upstream calls (projects + subprojects),
// each a single bulk page, and only fields Rentman can return cheaply.
// Notably NOT requested: any *_cost field (Rentman computes those per row and
// a bulk request 504s) and per-record joins for status/type/manager.
//
// Everything lives inside the handler body — PocketBase's JSVM evaluates each
// route handler in isolation, so it can't close over module-scope helpers
// (see the require()-at-top-of-body note on the other handlers in this file).
(function () {
  const { requireAdmin } = require(`${__hooks}/lib/auth.js`);

  routerAdd(
    "GET",
    "/api/projects/financials",
    (e) => {
      const { rentman, idFromRef } = require(`${__hooks}/lib/rentman.js`);

      const PROJECT_FIELDS = "id,name,displayname,number,reference,customer,planperiod_start,usageperiod_start";
      const SUBPROJECT_FIELDS = [
        "id", "name", "project", "in_financial", "project_total_price",
        "project_rental_price", "project_sale_price", "project_crew_price",
        "project_transport_price", "project_other_price", "project_services_price",
        "discount_rental", "discount_sale", "discount_crew", "discount_transport",
        "discount_additional_costs", "discount_services", "discount_subproject",
        "discount_fixed", "discount_fixed_amount",
      ].join(",");
      // Rentman stores percentage discounts as fractions (0.1 === 10%). Bulk
      // reads return a *computed* effective ratio, so tiny values (< 0.5%) are
      // rounding noise from the pricing engine, not a discount someone gave.
      const MIN_DISCOUNT_FRACTION = 0.005;
      // Per-category discount: [percentage field, currency (post-discount) price field, label].
      const CATEGORY_DISCOUNTS = [
        ["discount_rental", "project_rental_price", "rental"],
        ["discount_sale", "project_sale_price", "sale"],
        ["discount_crew", "project_crew_price", "crew"],
        ["discount_transport", "project_transport_price", "transport"],
        ["discount_additional_costs", "project_other_price", "additional costs"],
        ["discount_services", "project_services_price", "services"],
      ];
      const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
      const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
      // Undo a fraction-off discount to recover the amount it removed:
      // if postPrice = pre * (1 - d) then discount = postPrice * d / (1 - d).
      const discountAmount = (postPrice, d) =>
        d >= MIN_DISCOUNT_FRACTION && d < 0.999 ? (num(postPrice) * d) / (1 - d) : 0;

      try {
        const projects = rentman.listAllProjects({ fields: PROJECT_FIELDS });
        const subprojects = rentman.listAllSubprojects({ fields: SUBPROJECT_FIELDS });

        // Customer name is a nice-to-have — a slow or failing contacts walk
        // must not sink the export.
        const contactName = new Map();
        try {
          for (const c of rentman.listAllContacts({ fields: "id,name,displayname" })) {
            contactName.set(String(c.id), c.displayname || c.name || null);
          }
        } catch (err) {
          console.warn("[projects/financials] could not resolve customer names: " + err);
        }

        const subsByProject = new Map();
        for (const s of subprojects) {
          const pid = idFromRef(s.project);
          if (!pid) continue;
          if (!subsByProject.has(pid)) subsByProject.set(pid, []);
          subsByProject.get(pid).push(s);
        }

        const rows = projects.map((p) => {
          const all = subsByProject.get(String(p.id)) || [];
          const subs = all.filter((s) => s.in_financial !== false);

          const discounts = [];
          let totalPrice = 0;
          // Best-effort estimate of the currency value removed by discounts —
          // Rentman's API has no discount-amount field, so it's reconstructed
          // from the fraction fields + the (post-discount) category/total prices.
          let discountValue = 0;

          for (const s of subs) {
            totalPrice += num(s.project_total_price);

            for (const [field, priceField, label] of CATEGORY_DISCOUNTS) {
              const d = num(s[field]);
              if (d < MIN_DISCOUNT_FRACTION) continue;
              discounts.push({ subproject: s.name, type: label, percent: round2(d * 100) });
              discountValue += discountAmount(s[priceField], d);
            }

            const dSub = num(s.discount_subproject);
            if (dSub >= MIN_DISCOUNT_FRACTION) {
              discounts.push({ subproject: s.name, type: "subproject", percent: round2(dSub * 100) });
              discountValue += discountAmount(s.project_total_price, dSub);
            }

            if (s.discount_fixed === true && num(s.discount_fixed_amount) !== 0) {
              const fixed = Math.abs(num(s.discount_fixed_amount));
              discounts.push({ subproject: s.name, type: "fixed", amount: round2(fixed) });
              discountValue += fixed;
            }
          }

          return {
            id: p.id,
            name: p.displayname || p.name || "",
            number: typeof p.number === "number" ? p.number : null,
            reference: p.reference || "",
            customer: contactName.get(idFromRef(p.customer) || "") || null,
            periodStart: p.usageperiod_start || p.planperiod_start || null,
            subprojectCount: all.length,
            totalPrice: round2(totalPrice),
            hasDiscount: discounts.length > 0,
            discountValue: round2(discountValue),
            discounts: discounts,
          };
        });

        rows.sort((a, b) => String(b.periodStart || "").localeCompare(String(a.periodStart || "")));
        return e.json(200, { data: rows, generatedAt: new Date().toISOString() });
      } catch (err) {
        console.error("[projects/financials] " + err);
        return e.json(502, {
          message: "Rentman request failed: " + String(err && err.message ? err.message : err),
        });
      }
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
