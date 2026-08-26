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
