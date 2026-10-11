import { test } from "node:test";
import assert from "node:assert/strict";
import { maskDate, parseDate, validDate } from "../shared/dates.js";
test("eight typed digits reach a complete day/month/year without manual separators", () => {
  let text = "";
  for (const digit of "18112026") text = maskDate(text + digit);
  assert.equal(text, "18/11/2026");
  assert.equal(parseDate(text), "2026-11-18");
  assert.equal(parseDate(maskDate("1/2/2028")), "2028-02-01");
});
test("partial and impossible dates cannot become persisted calendar days", () => {
  for (const text of ["18/11/202", "31/02/2026", "29/02/2027", "00/12/2026"])
    assert.equal(parseDate(text), null);
  assert.equal(parseDate("29/02/2028"), "2028-02-29");
  assert.equal(validDate("2026-02-31"), false);
});
