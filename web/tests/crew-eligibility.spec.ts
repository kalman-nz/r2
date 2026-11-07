import { expect, test, type Page } from "@playwright/test";

const periods = [
  { start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z" },
  { start: "2026-11-07T10:00:00Z", end: "2026-11-07T12:00:00Z" },
  { start: "2026-11-07T12:00:00Z", end: "2026-11-07T14:00:00Z" },
];

function mockCrewApi(page: Page) {
  let createdPeriod: Record<string, unknown> | undefined;
  let submittedNeeds = 0;
  const needs = ["usage-1", "billing-1", "other-1"].map((period, index) => ({
    id: `need-${period}`,
    org: "org-1",
    job: "job-1",
    period,
    role: "role-1",
    level: "",
    quantity: 1,
    customTimes: false,
    start: periods[index].start,
    end: periods[index].end,
    notes: "",
  }));
  page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/collections/crew_roles/records" && request.method() === "GET") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: 1, totalPages: 1, items: [{ id: "role-1", name: "Audio operator", levels: ["Basic"], sortOrder: 0 }] } });
    } else if (path === "/api/collections/crew_people/records" && request.method() === "GET") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: 0, totalPages: 1, items: [] } });
    } else if (path === "/api/collections/crew_needs/records" && request.method() === "GET") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: needs.length, totalPages: 1, items: needs } });
    } else if (path === "/api/collections/job_crew/records" && request.method() === "GET") {
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: 0, totalPages: 1, items: [] } });
    } else if (path === "/api/collections/job_periods/records" && request.method() === "POST") {
      createdPeriod = { id: "new-period", ...request.postDataJSON() };
      await route.fulfill({ json: createdPeriod });
    } else if (path === "/api/jobs/job-1/crew-needs" && request.method() === "POST") {
      submittedNeeds += request.postDataJSON().needs.length;
      await route.fulfill({ json: [] });
    } else {
      await route.abort();
    }
  });
  return {
    created: () => createdPeriod,
    submittedNeeds: () => submittedNeeds,
  };
}

test("schedule list and calendar expose crew controls only on other items", async ({ page }) => {
  mockCrewApi(page);
  await page.goto("/tests/crew-eligibility.html?schedule");
  await expect(page.getByRole("button", { name: "+ Crew need" })).toHaveCount(1);

  await page.getByRole("radio", { name: "Calendar" }).click();
  await page.locator('[title^="Equipment booked:"]').click({ force: true });
  await expect(page.getByRole("heading", { name: "Equipment booked" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Crew need" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  await page.locator('[title^="Charged:"]').first().click({ force: true });
  await expect(page.getByRole("heading", { name: "Charged" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Crew need" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  await page.locator('[title^="Crew call:"]').click({ force: true });
  await expect(page.getByRole("heading", { name: "Crew call" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Crew need" })).toBeVisible();
});

test("switching a new schedule item from other to usage drops its inline crew drafts", async ({ page }) => {
  const api = mockCrewApi(page);
  await page.goto("/tests/crew-eligibility.html?new-item");
  await page.getByRole("button", { name: "Add period" }).click();
  await page.getByRole("button", { name: "+ Crew role" }).click();
  await expect(page.getByLabel("Crew role", { exact: true })).toBeVisible();
  await page.getByLabel("Does").selectOption("usage");
  await expect(page.getByLabel("Crew role", { exact: true })).toHaveCount(0);
  await page.getByLabel("Name").fill("Equipment booking");
  await page.getByRole("button", { name: "Add period" }).last().click();

  await expect.poll(api.created).toMatchObject({ kind: "usage", name: "Equipment booking" });
  expect(api.submittedNeeds()).toBe(0);
});

test("Crew tab lists and adds needs only for other schedule items", async ({ page }) => {
  mockCrewApi(page);
  await page.goto("/tests/crew-eligibility.html?crew");
  await expect(page.getByRole("heading", { name: "Crew call" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Equipment booked" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Charged" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Crew need" })).toHaveCount(1);
});
