// Entry now presents newly triggered suggestions. Legacy stories explicitly continue care.
export async function continueAfterEntry(page) {
  const button = page.getByRole("button", {name:"Continue data entry",exact:true});
  await Promise.race([button.waitFor({state:"visible"}),page.getByRole("dialog").waitFor({state:"hidden"})]);
  if (await button.isVisible()) await button.click();
}
