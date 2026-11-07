import { expect, test } from "@playwright/test";

test("adding a matching crew need in the schedule modal increases its quantity", async ({ page }) => {
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
      needs[0].quantity += request.postDataJSON().needs[0].quantity;
      await route.fulfill({ json: [needs[0]] });
    } else {
      await route.abort();
    }
  });

  await page.goto("/tests/crew-needs.html");
  await expect(page.getByText("2× Audio operator")).toBeVisible();
  await page.getByRole("button", { name: "+ Crew need" }).click();
  await page.getByRole("button", { name: "Add crew need" }).click();
  await expect(page.getByText("3× Audio operator")).toBeVisible();
  await expect(page.getByText(/× Audio operator/)).toHaveCount(1);
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
