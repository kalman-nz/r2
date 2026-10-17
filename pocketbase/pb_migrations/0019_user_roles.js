/// <reference path="../pb_data/types.d.ts" />

// R2 has three kinds of user instead of admin / not-admin:
// - admin: everything, including settings, users and imports
// - planner: inventory, contacts, jobs, quotes (the "power user" a pricing
//   tier counts)
// - tech: free basic user — looks things up, scans kit out/in, flags broken
//   gear, prints labels
// Existing admins stay admins. Everyone else was a crew member printing
// labels, which is exactly what a tech does now.
//
// Every rule that checked isAdmin now checks role, including the
// self-escalation guard from 0003/0011: only an admin can set anyone's role,
// their own included.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new SelectField({ name: "role", values: ["admin", "planner", "tech"], maxSelect: 1 }));
    app.save(users);

    for (const user of app.findAllRecords(users)) {
      user.set("role", user.get("isAdmin") === true ? "admin" : "tech");
      app.save(user);
    }

    users.fields.getByName("role").required = true;
    users.fields.removeByName("isAdmin");
    users.createRule = "@request.auth.role = 'admin'";
    users.updateRule =
      "(id = @request.auth.id || @request.auth.role = 'admin') && (@request.body.role:isset = false || @request.auth.role = 'admin')";
    users.deleteRule = "@request.auth.role = 'admin'";
    app.save(users);

    const logs = app.findCollectionByNameOrId("logs");
    logs.listRule = "@request.auth.role = 'admin'";
    logs.viewRule = "@request.auth.role = 'admin'";
    app.save(logs);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new BoolField({ name: "isAdmin" }));
    users.fields.getByName("role").required = false;
    app.save(users);

    for (const user of app.findAllRecords(users)) {
      user.set("isAdmin", user.get("role") === "admin");
      app.save(user);
    }

    users.fields.removeByName("role");
    users.createRule = "@request.auth.isAdmin = true";
    users.updateRule =
      "(id = @request.auth.id || @request.auth.isAdmin = true) && (@request.body.isAdmin:isset = false || @request.auth.isAdmin = true)";
    users.deleteRule = "@request.auth.isAdmin = true";
    app.save(users);

    const logs = app.findCollectionByNameOrId("logs");
    logs.listRule = "@request.auth.isAdmin = true";
    logs.viewRule = "@request.auth.isAdmin = true";
    app.save(logs);
  },
);
