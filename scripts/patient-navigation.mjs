// Navigate through the four-section patient workspace rather than old top tabs.
export async function openPatientView(page, label) {
  const record = ["History", "Medications", "Investigations"].includes(label);
  const sections = page.getByRole("navigation", { name: "Patient sections", exact: true });
  await sections.getByRole("link", { name: record ? "Clinical record" : "Visits & journey", exact: true }).click();
  const views = page.getByRole("navigation", { name: record ? "Clinical record views" : "Visits and journey views", exact: true });
  await views.getByRole("link", { name: label, exact: true }).click();
}

export async function openAdmissionDetails(page) {
  const details=page.getByRole("dialog").locator("details.encounter-details").filter({has:page.locator("summary",{hasText:"Presenting symptoms and additional details"})});
  await details.waitFor({state:"visible"});
  if(!await details.evaluate(el=>el.open)) await details.locator("summary").click();
}
