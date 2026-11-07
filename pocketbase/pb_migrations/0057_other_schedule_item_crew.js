/// <reference path="../pb_data/types.d.ts" />

// Crew needs belong only to "other" schedule items. Remove incompatible
// legacy needs and their assignments across every organisation and project.
migrate(
  (app) => {
    const periods = app
      .findRecordsByFilter("job_periods", "kind = 'usage' || kind = 'billing'", "", 0, 0)
      .filter((period) => period.getString("kind") === "usage" || period.getString("kind") === "billing");

    for (const period of periods) {
      for (const need of app.findRecordsByFilter("crew_needs", "period = {:period}", "", 0, 0, { period: period.id })) {
        for (const assignment of app.findRecordsByFilter("job_crew", "need = {:need}", "", 0, 0, { need: need.id })) {
          app.delete(assignment);
        }
        app.delete(need);
      }
    }
  },
  () => {},
);
