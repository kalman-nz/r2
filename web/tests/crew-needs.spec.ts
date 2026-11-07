import { expect, test } from "@playwright/test";

test("the schedule modal filters exact matches but allows a different level", async ({ page }) => {
  const needs = [{
    id: "need-1", job: "job-1", period: "period-1", role: "role-1", level: "",
    quantity: 2, customTimes: false, start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "",
  }];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/collections/crew_needs/records" && request.method() === "GET") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: needs.length, totalPages: 1, items: needs } });
    } else if (path === "/api/collections/crew_needs/records" && request.method() === "POST") {
      needs.push({ ...needs[0], ...request.postDataJSON(), id: "need-2" });
      await route.fulfill({ json: needs[1] });
    } else if (path === "/api/jobs/job-1/crew-needs" && request.method() === "POST") {
      needs.push({ ...needs[0], ...request.postDataJSON().needs[0], id: "need-2" });
      await route.fulfill({ json: [needs[1]] });
    } else {
      await route.abort();
    }
  });

  await page.goto("/tests/crew-needs.html");
  await expect(page.getByText("2× Audio operator")).toBeVisible();
  await page.getByRole("button", { name: "+ Crew need" }).click();
  await expect(page.getByLabel("Audio operator level")).toHaveValue("Basic");
  await expect(page.getByLabel("Audio operator level").getByRole("option", { name: "Any level" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add crew need" }).click();
  await expect(page.getByText("1× Audio operator Basic")).toBeVisible();
  await expect(page.getByText("2× Audio operator")).toBeVisible();
});

test("the schedule modal shows a consolidation error without changing the need", async ({ page }) => {
  const need = {
    id: "need-1", job: "job-1", period: "period-1", role: "role-1", level: "",
    quantity: 99, customTimes: false, start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "",
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/collections/crew_needs/records" && request.method() === "GET") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: 1, totalPages: 1, items: [need] } });
    } else if (path === "/api/jobs/job-1/crew-needs" && request.method() === "POST") {
      await route.fulfill({ status: 400, json: { message: "Combined crew quantity cannot exceed 99" } });
    } else {
      await route.abort();
    }
  });

  await page.goto("/tests/crew-needs.html");
  await expect(page.getByText("99× Audio operator")).toBeVisible();
  await page.getByRole("button", { name: "+ Crew need" }).click();
  await page.getByRole("button", { name: "Add crew need" }).click();
  await expect(page.getByText("Couldn't save it: Combined crew quantity cannot exceed 99")).toBeVisible();
  await expect(page.getByText("99× Audio operator")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add crew need" })).toBeVisible();
});

test("changing a crew role resets its level and submits the selected quantity", async ({ page }) => {
  let submitted: unknown;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/collections/crew_needs/records" && request.method() === "GET") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: 0, totalPages: 1, items: [] } });
    } else if (path === "/api/jobs/job-1/crew-needs" && request.method() === "POST") {
      submitted = request.postDataJSON();
      await route.fulfill({ json: [] });
    } else {
      await route.abort();
    }
  });

  await page.goto("/tests/crew-needs.html");
  await page.getByRole("button", { name: "+ Crew need" }).click();
  await page.getByLabel("Audio operator level").selectOption("Advanced");
  await page.getByLabel("Crew role").selectOption("role-2");
  await expect(page.getByLabel("Lighting operator level")).toHaveValue("");
  await page.getByLabel("Lighting operator level").selectOption("Senior");
  await page.getByLabel("How many").fill("3");
  await page.getByRole("button", { name: "Add crew need" }).click();
  await expect(page.getByRole("button", { name: "+ Crew need" })).toBeVisible();
  expect(submitted).toEqual({ needs: [{
    role: "role-2", level: "Senior", quantity: 3, customTimes: false,
    start: "", end: "", notes: "", period: "period-1",
  }] });
});

test("a role without levels is filtered only for its existing time window", async ({ page }) => {
  const needs = [{
    id: "need-1", job: "job-1", period: "period-1", role: "role-3", level: "",
    quantity: 1, customTimes: false, start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "",
  }];
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/collections/crew_needs/records") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: 1, totalPages: 1, items: needs } });
    } else {
      await route.abort();
    }
  });
  await page.goto("/tests/crew-needs.html");
  await expect(page.getByText("1× Stagehand")).toBeVisible();
  await page.getByRole("button", { name: "+ Crew need" }).click();
  await expect(page.getByLabel("Crew role").getByRole("option", { name: "Stagehand" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Their own times/ }).check();
  const start = await page.getByLabel("Start").inputValue();
  const end = await page.getByLabel("Finish").inputValue();
  await page.getByLabel("Start").fill("2030-01-01T08:00");
  await page.getByLabel("Finish").fill("2030-01-01T10:00");
  await page.getByLabel("Crew role").selectOption("role-3");
  await expect(page.getByRole("button", { name: "Add crew need" })).toBeEnabled();
  await page.getByLabel("Start").fill(start);
  await page.getByLabel("Finish").fill(end);
  await expect(page.getByText(/That crew need already exists for these times/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add crew need" })).toBeDisabled();
});

test("new schedule items offer only unused role and level combinations", async ({ page }) => {
  await page.goto("/tests/crew-needs.html?inline");
  const add = page.getByRole("button", { name: "+ Crew role" });
  await add.click();
  await expect(page.getByLabel("Audio operator level").nth(0)).toHaveValue("");
  await add.click();
  await expect(page.getByLabel("Audio operator level").nth(1)).toHaveValue("Basic");
  await expect(page.getByLabel("Audio operator level").nth(1).getByRole("option", { name: "Any level" })).toHaveCount(0);
  await add.click();
  await expect(page.getByLabel("Audio operator level").nth(2)).toHaveValue("Advanced");
  await add.click();
  await expect(page.getByLabel("Crew role", { exact: true }).nth(3)).toHaveValue("role-2");
  await expect(page.getByLabel("Crew role", { exact: true }).nth(3).getByRole("option", { name: "Audio operator" })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove this crew role" }).first().click();
  await expect(page.getByLabel("Crew role", { exact: true }).nth(2).getByRole("option", { name: "Audio operator" })).toHaveCount(1);
});

test("when every choice is taken the planner can choose a different time window", async ({ page }) => {
  const combinations = [
    ["role-1", ""], ["role-1", "Basic"], ["role-1", "Advanced"],
    ["role-2", ""], ["role-2", "Junior"], ["role-2", "Senior"], ["role-3", ""],
  ];
  const needs = combinations.map(([role, level], index) => ({
    id: `need-${index}`, job: "job-1", period: "period-1", role, level, quantity: 1,
    customTimes: false, start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "",
  }));
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/collections/crew_needs/records") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: needs.length, totalPages: 1, items: needs } });
    } else {
      await route.abort();
    }
  });
  await page.goto("/tests/crew-needs.html");
  await expect(page.getByText("1× Stagehand")).toBeVisible();
  await page.getByRole("button", { name: "+ Crew need" }).click();
  await expect(page.getByText(/No unused crew role and level/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add crew need" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Their own times/ }).check();
  await page.getByLabel("Start").fill("2030-01-01T08:00");
  await page.getByLabel("Finish").fill("2030-01-01T10:00");
  await page.getByLabel("Crew role", { exact: true }).selectOption("role-3");
  await expect(page.getByRole("button", { name: "Add crew need" })).toBeEnabled();
});

test("an existing need can be edited even when historical duplicates exist", async ({ page }) => {
  const existing = {
    job: "job-1", period: "period-1", role: "role-3", level: "", quantity: 1,
    customTimes: false, start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "",
  };
  let updated: unknown;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/collections/crew_needs/records" && request.method() === "GET") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: 2, totalPages: 1, items: [
        { ...existing, id: "need-1" }, { ...existing, id: "need-2" },
      ] } });
    } else if (path === "/api/collections/crew_needs/records/need-1" && request.method() === "PATCH") {
      updated = request.postDataJSON();
      await route.fulfill({ json: { ...existing, id: "need-1", ...request.postDataJSON() } });
    } else {
      await route.abort();
    }
  });
  await page.goto("/tests/crew-needs.html?edit");
  await page.getByLabel("How many").fill("2");
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => updated).toMatchObject({ role: "role-3", level: "", quantity: 2 });
});
