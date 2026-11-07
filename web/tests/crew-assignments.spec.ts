import { expect, test, type Page } from "@playwright/test";

async function roster(page: Page, needId = "need-1", assigned = false) {
  const need = {
    id: needId, job: "job-1", period: "period-1", role: "role-1", level: "Advanced",
    quantity: 1, customTimes: false, start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "",
  };
  const crew: Record<string, unknown>[] = assigned
    ? [{ id: "assignment-1", job: "job-1", person: "person-1", need: needId, function: "Obsolete free text" }]
    : [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/collections/job_crew/records" && request.method() === "POST") {
      const body = request.postDataJSON();
      expect(body.need).toBe(needId);
      crew.push({ ...body, id: "assignment-1" });
      await route.fulfill({ json: crew[0] });
    } else if (path === "/api/collections/job_crew/records/assignment-1" && request.method() === "DELETE") {
      crew.length = 0;
      await route.fulfill({ status: 204 });
    } else if (path.includes("/records") && request.method() === "GET") {
      const items = path.includes("crew_needs") ? [need]
        : path.includes("crew_roles") ? [{ id: "role-1", name: "Audio operator", levels: ["Basic", "Advanced"] }]
        : path.includes("crew_people") ? [{ id: "person-1", name: "Alex", skills: ["role-1"], skillLevels: { "role-1": "Advanced" }, archived: false }]
        : crew;
      await route.fulfill({ json: { page: 1, perPage: 500, totalItems: items.length, totalPages: 1, items } });
    } else {
      await route.abort();
    }
  });

}

test("an incomplete crew need cannot be used to create a whole-project assignment", async ({ page }) => {
  await roster(page, "");
  await page.goto("/tests/crew-assignments.html");
  await page.getByRole("button", { name: "+ Pick someone", exact: true }).click();
  await page.getByRole("button", { name: /Alex.*Advanced/ }).click();
  await expect(page.getByText("Choose a crew need for this assignment")).toBeVisible();
});

test("the Crew tab offers only crew-need slots, not a whole-project picker", async ({ page }) => {
  await roster(page);
  await page.goto("/tests/crew-assignments.html");
  await expect(page.getByText("1× Audio operator")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Whole project" })).toHaveCount(0);
  await expect(page.getByPlaceholder(/Doing what/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Pick someone", exact: true })).toHaveCount(1);
});

test("the alternative project crew summary has no whole-project assignment controls", async ({ page }) => {
  await roster(page);
  await page.goto("/tests/crew-assignments.html?off");
  await expect(page.getByRole("heading", { name: "Crew", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Doing what?")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("a planner can assign and unassign an appropriate person through a crew need", async ({ page }) => {
  await roster(page);
  await page.goto("/tests/crew-assignments.html");
  await page.getByRole("button", { name: "+ Pick someone", exact: true }).click();
  await expect(page.getByText("Suggested", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Alex.*Advanced/ }).click();
  await expect(page.getByText("1 of 1 slot filled")).toBeVisible();
  await expect(page.getByRole("link", { name: "Alex", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Pick someone", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Take Alex off Audio operator" }).click();
  await expect(page.getByText("0 of 1 slot filled")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Pick someone", exact: true })).toBeVisible();
});

test("project crew summaries describe the person's crew need and schedule item, not free text", async ({ page }) => {
  await roster(page, "need-1", true);
  await page.goto("/tests/crew-assignments.html?summary");
  await expect(page.getByRole("link", { name: "Alex", exact: true })).toBeVisible();
  await expect(page.getByText("Audio operator, Show day", { exact: true })).toBeVisible();
  await expect(page.getByText("Obsolete free text")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Roster crew" })).toBeVisible();
});
