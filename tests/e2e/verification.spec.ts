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
