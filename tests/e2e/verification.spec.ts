import { test, expect } from "@playwright/test";

test("email verification accepts a code, handles expiry, and offers resend", async ({
  page,
}) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { hosted: true } }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({ status: 401, json: { error: "Sign in to continue" } }),
  );
  let valid = false;
  await page.route("**/api/auth/email-otp/verify-email", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "owner@example.com",
      otp: "123456",
    });
    await route.fulfill({
      status: valid ? 200 : 400,
      json: valid ? { status: true } : { message: "Verification code expired" },
    });
  });
  await page.route(
    "**/api/auth/email-otp/send-verification-otp",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        email: "owner@example.com",
        type: "email-verification",
      });
      await route.fulfill({ json: { success: true } });
    },
  );
  await page.goto("/?verify=1");
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByText("Verification code expired")).toBeVisible();
  await page
    .getByRole("button", { name: "Resend verification code", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "new verification code was requested",
  );
  valid = true;
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Email verified. Sign in to enter your workspace.",
  );
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("hosted login opens the dashboard without reloading the document", async ({
  page,
}) => {
  let signedIn = false,
    documents = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) documents++;
  });
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { hosted: true } }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: signedIn ? 200 : 401,
      json: signedIn
        ? {
            actor: "test-clinician",
            role: "clinician",
            csrf: "test-csrf",
            email: "owner@example.com",
          }
        : { error: "Sign in to continue" },
    }),
  );
  await page.route("**/api/auth/sign-in/email", (route) => {
    signedIn = true;
    return route.fulfill({ json: { user: { id: "test-clinician" } } });
  });
  await page.route("**/api/overview", (route) =>
    route.fulfill({
      json: {
        patients: 0,
        open_tasks: 0,
        overdue: 0,
        due: 0,
        drafts: 0,
        awaiting_review: 0,
        reviewed: 0,
        episodes: 0,
        presentations: [],
      },
    }),
  );
  await page.route("**/api/care/board", (route) =>
    route.fulfill({ json: { entries: [], encounters: [] } }),
  );
  await page.route("**/api/patients", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/tasks", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My Worklist", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Worklist summary").getByText(/inpatients/),
  ).toBeVisible();
  expect(documents).toBe(1);
});

test("a failed JavaScript download shows recovery instead of a blank page", async ({
  page,
}) => {
  await page.route("**/src/main.tsx*", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByText("The app could not load. Reload to get the latest version."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload workspace" }),
  ).toBeVisible();
});
