// Registry statistics (10 Nov 2026, phase 4): descriptive summaries, group comparisons and survival, the methods
// of the Heart Failure Registry's analytics (chi-square, Welch t, Kaplan–Meier, log-rank) plus Fisher's exact test
// for 2×2 tables with small expected counts and Welch's ANOVA for three or more groups. Pure functions; checked
// against published reference values in tests/registry-stats.test.ts. Descriptive output for a registry, not a
// substitute for the statistician's analysis.

export const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
export function sd(x: number[]) {
  if (x.length < 2) return NaN;
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
}
// quantile, linear interpolation between order statistics (R type 7, the default in R and SPSS EXAMINE's HAVERAGE differs slightly)
export function quantile(x: number[], q: number) {
  if (!x.length) return NaN;
  const s = [...x].sort((a, b) => a - b);
  const h = (s.length - 1) * q, lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
}
export const median = (x: number[]) => quantile(x, 0.5);

// ---------- distribution functions ----------
function lnGamma(z: number): number {
  // Lanczos approximation (g = 7, n = 9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}
// regularized lower incomplete gamma P(a, x)
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // continued fraction for Q, Lentz
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
// regularized incomplete beta I_x(a, b)
function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (x: number, a: number, b: number) => {
    let c = 1, d = 1 - ((a + b) * x) / (a + 1);
    if (Math.abs(d) < 1e-300) d = 1e-300;
    d = 1 / d;
    let h = d;
    for (let m = 1; m < 500; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; h *= d * c;
      aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (bt * cf(x, a, b)) / a : 1 - (bt * cf(1 - x, b, a)) / b;
}
/** P(χ² ≥ x) with df degrees of freedom */
export const chiSquareSf = (x: number, df: number) => (x <= 0 ? 1 : 1 - gammaP(df / 2, x / 2));
/** two-sided P(|T| ≥ |t|) */
export const tTwoSided = (t: number, df: number) => betaI(df / (df + t * t), df / 2, 0.5);
/** P(F ≥ f) */
export const fSf = (f: number, d1: number, d2: number) => (f <= 0 ? 1 : betaI(d2 / (d2 + d1 * f), d2 / 2, d1 / 2));

// ---------- tests ----------
export type TestResult = { test: "Chi-square" | "Fisher" | "Welch t" | "Welch ANOVA" | "Log-rank"; stat: number | null; df: number | null; p: number };

/** chi-square test of independence on a rows × columns table of counts (rows or columns that are all zero are dropped) */
export function chiSquare(table: number[][]): (TestResult & { lowExpected: boolean }) | null {
  let t = table.filter((r) => r.some((v) => v > 0));
  const cols = t[0]?.map((_, j) => j).filter((j) => t.some((r) => r[j] > 0)) ?? [];
  t = t.map((r) => cols.map((j) => r[j]));
  if (t.length < 2 || cols.length < 2) return null;
  const rs = t.map((r) => r.reduce((a, b) => a + b, 0)), cs = cols.map((_, j) => t.reduce((a, r) => a + r[j], 0));
  const n = rs.reduce((a, b) => a + b, 0);
  let x2 = 0, low = 0;
  for (let i = 0; i < t.length; i++)
    for (let j = 0; j < cols.length; j++) {
      const e = (rs[i] * cs[j]) / n;
      if (e < 5) low++;
      x2 += (t[i][j] - e) ** 2 / e;
    }
  const df = (t.length - 1) * (cols.length - 1);
  return { test: "Chi-square", stat: x2, df, p: chiSquareSf(x2, df), lowExpected: low / (t.length * cols.length) > 0.2 };
}

/** Fisher's exact test, two-sided (sum of tables no more likely than the observed), for a 2×2 table */
export function fisherExact([[a, b], [c, d]]: number[][]): TestResult {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const lnF = (k: number) => lnGamma(k + 1);
  const p = (x: number) => Math.exp(lnF(r1) + lnF(r2) + lnF(c1) + lnF(n - c1) - lnF(n) - lnF(x) - lnF(r1 - x) - lnF(c1 - x) - lnF(r2 - c1 + x));
  const obs = p(a);
  let total = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const px = p(x);
    if (px <= obs * (1 + 1e-7)) total += px;
  }
  return { test: "Fisher", stat: null, df: null, p: Math.min(1, total) };
}

/** categorical comparison: Fisher for a 2×2 table with low expected counts, otherwise chi-square */
export function compareCounts(table: number[][]): TestResult | null {
  const x = chiSquare(table);
  if (!x) return null;
  const t = table.filter((r) => r.some((v) => v > 0));
  const cols = t[0].map((_, j) => j).filter((j) => t.some((r) => r[j] > 0));
  if (x.lowExpected && t.length === 2 && cols.length === 2) return fisherExact(t.map((r) => cols.map((j) => r[j])));
  return { test: x.test, stat: x.stat, df: x.df, p: x.p };
}

/** Welch's t test (unequal variances) */
export function welchT(a: number[], b: number[]): TestResult | null {
  if (a.length < 2 || b.length < 2) return null;
  const va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length;
  if (va + vb === 0) return null;
  const t = (mean(a) - mean(b)) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return { test: "Welch t", stat: t, df, p: tTwoSided(t, df) };
}

/** Welch's one-way ANOVA (unequal variances); with two groups it equals Welch's t test (F = t²) */
export function welchAnova(groups: number[][]): TestResult | null {
  const g = groups.filter((x) => x.length >= 2);
  if (g.length < 2) return null;
  if (g.length === 2) return welchT(g[0], g[1]);
  const k = g.length;
  const w = g.map((x) => x.length / sd(x) ** 2);
  if (w.some((v) => !Number.isFinite(v))) return null;
  const W = w.reduce((a, b) => a + b, 0);
  const mw = g.reduce((a, x, i) => a + w[i] * mean(x), 0) / W;
  const A = g.reduce((a, x, i) => a + w[i] * (mean(x) - mw) ** 2, 0) / (k - 1);
  const lam = g.reduce((a, x, i) => a + (1 - w[i] / W) ** 2 / (x.length - 1), 0);
  const F = A / (1 + ((2 * (k - 2)) / (k * k - 1)) * lam);
  const df2 = (k * k - 1) / (3 * lam);
  return { test: "Welch ANOVA", stat: F, df: k - 1, p: fSf(F, k - 1, df2) };
}

// ---------- survival ----------
export type SurvivalCase = { time: number; event: boolean };
export type KmStep = { time: number; atRisk: number; events: number; censored: number; survival: number; se: number };

/** Kaplan–Meier estimate with Greenwood standard errors; one step per distinct time with an event or censoring */
export function kaplanMeier(cases: SurvivalCase[]): KmStep[] {
  const times = [...new Set(cases.map((c) => c.time))].sort((a, b) => a - b);
  let atRisk = cases.length, s = 1, gw = 0;
  const out: KmStep[] = [];
  for (const t of times) {
    const here = cases.filter((c) => c.time === t);
    const d = here.filter((c) => c.event).length, cen = here.length - d;
    if (d > 0) {
      s *= 1 - d / atRisk;
      if (atRisk > d) gw += d / (atRisk * (atRisk - d));
    }
    out.push({ time: t, atRisk, events: d, censored: cen, survival: s, se: s * Math.sqrt(gw) });
    atRisk -= here.length;
  }
  return out;
}
/** survival at a time from KM steps, with the number still at risk just after it */
export function survivalAt(steps: KmStep[], t: number, n: number) {
  let s = 1, se = 0, atRisk = n;
  for (const k of steps) {
    if (k.time > t) break;
    s = k.survival; se = k.se; atRisk = k.atRisk - k.events - k.censored;
  }
  return { survival: s, se, atRisk };
}

/** log-rank test across groups (chi-square with groups − 1 degrees of freedom) */
export function logRank(groups: SurvivalCase[][]): TestResult | null {
  const g = groups.filter((x) => x.length > 0);
  if (g.length < 2) return null;
  const all = g.flatMap((x, i) => x.map((c) => ({ ...c, g: i })));
  const times = [...new Set(all.filter((c) => c.event).map((c) => c.time))].sort((a, b) => a - b);
  if (!times.length) return null;
  const k = g.length;
  const O = new Array(k).fill(0), E = new Array(k).fill(0);
  const V = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const t of times) {
    const n = g.map((x) => x.filter((c) => c.time >= t).length);
    const d = g.map((x) => x.filter((c) => c.time === t && c.event).length);
    const N = n.reduce((a, b) => a + b, 0), D = d.reduce((a, b) => a + b, 0);
    if (N < 2) continue;
    for (let i = 0; i < k; i++) {
      O[i] += d[i];
      E[i] += (D * n[i]) / N;
      for (let j = 0; j < k; j++) V[i][j] += ((D * (N - D)) / (N * N * (N - 1))) * n[i] * ((i === j ? N : 0) - n[j]);
    }
  }
  // drop the last group: chi2 = (O−E)' V⁻¹ (O−E) on k − 1 groups
  const m = k - 1;
  const u = O.slice(0, m).map((o, i) => o - E[i]);
  const A = V.slice(0, m).map((r) => r.slice(0, m));
  const x = solve(A, u);
  if (!x) return null;
  const chi2 = u.reduce((a, v, i) => a + v * x[i], 0);
  return { test: "Log-rank", stat: chi2, df: m, p: chiSquareSf(chi2, m) };
}
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** p-value as reported: <0.001, otherwise three decimals */
export const formatP = (p: number | null | undefined) => (p == null || !Number.isFinite(p) ? "" : p < 0.001 ? "<0.001" : p.toFixed(3));
