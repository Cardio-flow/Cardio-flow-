// 10 Nov 2026 — registry statistics checked against published reference values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chiSquareSf, tTwoSided, fSf, chiSquare, fisherExact, compareCounts, welchT, welchAnova, kaplanMeier, survivalAt, logRank, mean, sd, median, quantile, formatP } from "../shared/stats.js";

const near = (a: number, b: number, tol: number, msg?: string) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≉ ${b}`);

test("distribution tails at the textbook critical values", () => {
  near(chiSquareSf(3.841459, 1), 0.05, 1e-6, "χ² 1 df");
  near(chiSquareSf(5.991465, 2), 0.05, 1e-6, "χ² 2 df");
  near(chiSquareSf(11.0705, 5), 0.05, 1e-5, "χ² 5 df");
  near(chiSquareSf(24.725, 11), 0.01, 1e-5, "χ² 11 df");
  near(tTwoSided(2.228139, 10), 0.05, 1e-6, "t 10 df");
  near(tTwoSided(1.959964, 1e7), 0.05, 1e-6, "t → normal");
  near(tTwoSided(12.7062, 1), 0.05, 1e-5, "t 1 df");
  near(fSf(4.964603, 1, 10), 0.05, 1e-6, "F(1,10)");
  near(fSf(3.354131, 2, 27), 0.05, 1e-6, "F(2,27)");
  near(fSf(2.533555, 5, 30), 0.05, 1e-6, "F(5,30)");
});

test("descriptives", () => {
  const x = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(mean(x), 5);
  near(sd(x), 2.13809, 1e-5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
  assert.equal(formatP(0.0004), "<0.001");
  assert.equal(formatP(0.04567), "0.046");
});

test("Fisher's exact test: dieting example (Wikipedia; R fisher.test p = 0.002759)", () => {
  near(fisherExact([[1, 9], [11, 3]]).p, 0.002759, 2e-6);
  // expected counts all ≥5 here: compareCounts keeps the chi-square test
  assert.equal(compareCounts([[1, 9], [11, 3]])!.test, "Chi-square");
  // Fisher's tea-tasting table (expected 2 per cell): Fisher, p = 0.4857
  const tea = compareCounts([[3, 1], [1, 3]])!;
  assert.equal(tea.test, "Fisher");
  near(tea.p, 0.4857, 5e-5);
});

test("chi-square test of independence (R chisq.test, correct = FALSE)", () => {
  // matrix(c(762, 327, 468, 484, 239, 477), nrow = 2) — Agresti's party identification: X² = 30.07, df 2
  const r = chiSquare([[762, 327, 468], [484, 239, 477]])!;
  near(r.stat!, 30.0701, 1e-3);
  assert.equal(r.df, 2);
  assert.ok(r.p < 1e-6);
  assert.equal(compareCounts([[762, 327, 468], [484, 239, 477]])!.test, "Chi-square");
  assert.equal(chiSquare([[5, 0], [3, 0]]), null, "one non-empty column: no test");
});

test("Welch's t test: Wikipedia example 1 (t = −2.46, df = 24.99, p = 0.021; df checked independently in Python)", () => {
  const a = [27.5, 21.0, 19.0, 23.6, 17.0, 17.9, 16.9, 20.1, 21.9, 22.6, 23.1, 19.6, 19.0, 21.7, 21.4];
  const b = [27.1, 22.0, 20.8, 23.4, 23.4, 23.5, 25.8, 22.0, 24.8, 20.2, 21.9, 22.1, 22.9, 20.5, 24.4];
  const r = welchT(a, b)!;
  near(r.stat!, -2.46, 0.005);
  near(r.df!, 24.9885, 0.0005);
  near(r.p, 0.021, 0.0006);
  // two groups: Welch ANOVA is the same test
  near(welchAnova([a, b])!.p, r.p, 1e-12);
});

test("Welch's ANOVA: R oneway.test(var.equal = FALSE) on three groups", () => {
  // PlantGrowth (R datasets): ctrl, trt1, trt2 → F = 5.181, num df = 2, denom df = 17.128, p = 0.01739
  const ctrl = [4.17, 5.58, 5.18, 6.11, 4.5, 4.61, 5.17, 4.53, 5.33, 5.14];
  const trt1 = [4.81, 4.17, 4.41, 3.59, 5.87, 3.83, 6.03, 4.89, 4.32, 4.69];
  const trt2 = [6.31, 5.12, 5.54, 5.5, 5.37, 5.29, 4.92, 6.15, 5.8, 5.26];
  const r = welchAnova([ctrl, trt1, trt2])!;
  near(r.stat!, 5.181, 0.001);
  assert.equal(r.df, 2);
  near(r.p, 0.01739, 0.00005);
});

// Gehan (1965) leukaemia remission data: 6-MP vs placebo (R survival::gehan)
const mp: [number, boolean][] = [[6, true], [6, true], [6, true], [6, false], [7, true], [9, false], [10, true], [10, false], [11, false], [13, true], [16, true], [17, false], [19, false], [20, false], [22, true], [23, true], [25, false], [32, false], [32, false], [34, false], [35, false]];
const placebo: [number, boolean][] = [[1, true], [1, true], [2, true], [2, true], [3, true], [4, true], [4, true], [5, true], [5, true], [8, true], [8, true], [8, true], [8, true], [11, true], [11, true], [12, true], [12, true], [15, true], [17, true], [22, true], [23, true]];
const cases = (x: [number, boolean][]) => x.map(([time, event]) => ({ time, event }));

test("Kaplan–Meier: 6-MP arm of the Gehan data (R survfit)", () => {
  const km = kaplanMeier(cases(mp));
  const at = (t: number) => survivalAt(km, t, mp.length);
  near(at(6).survival, 0.857, 0.0005);
  near(at(10).survival, 0.753, 0.0005);
  near(at(13).survival, 0.69, 0.0005);
  near(at(16).survival, 0.627, 0.0005);
  near(at(22).survival, 0.538, 0.0005);
  near(at(23).survival, 0.448, 0.0005);
  near(at(6).se, 0.0764, 0.0005, "Greenwood SE");
  assert.equal(at(23).atRisk, 5);
});

test("log-rank: Gehan data, 6-MP vs placebo (R survdiff: χ² = 16.8, 1 df, p = 4e-5)", () => {
  const r = logRank([cases(mp), cases(placebo)])!;
  near(r.stat!, 16.79, 0.01);
  assert.equal(r.df, 1);
  assert.ok(r.p < 5e-5 && r.p > 3e-5);
  assert.equal(logRank([cases(mp)]), null);
});
