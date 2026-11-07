// Whole-project assignments have no crew need and cannot be mapped reliably.
// Cleanup is intentionally irreversible; restore an external backup to undo it.
migrate(
  (app) => {
    app.db().newQuery("DELETE FROM job_crew WHERE need = '' OR need IS NULL").execute();
    const crew = app.findCollectionByNameOrId("job_crew");
    crew.fields.getByName("need").required = true;
    app.save(crew);
  },
  (app) => {
    const crew = app.findCollectionByNameOrId("job_crew");
    crew.fields.getByName("need").required = false;
    app.save(crew);
  },
);
