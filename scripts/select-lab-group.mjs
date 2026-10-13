// Exercise the multi-group lab controls while selecting one group for a walkthrough.
export async function selectLabGroup(page, label) {
  const groups = page.getByRole("group", { name: "Lab groups", exact: true });
  const escaped = RegExp.escape(label);
  const name = new RegExp(`^${escaped}(?:\s*\d+)?$`);
  const chosen = groups.getByRole("button", { name });
  if (await chosen.getAttribute("aria-pressed") !== "true") await chosen.click();
  const others = groups.getByRole("button", { pressed: true }).filter({ hasNotText: new RegExp(`^${escaped}`) });
  while (await others.count()) await others.first().click();
}
