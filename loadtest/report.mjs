// Turn k6's loadtest/summary.json into a Markdown table (CI job summary, issue comments).
//   node loadtest/report.mjs [summary.json] [title]
import { readFileSync } from "node:fs";

const [file = "loadtest/summary.json", title = "Load test"] = process.argv.slice(2);
const { metrics } = JSON.parse(readFileSync(file, "utf8"));
const ms = (v) => (v === undefined ? "–" : `${Math.round(v)} ms`);
const rows = ["me", "next", "photo", "cast", "upload"].map((ep) => {
  const m = metrics[`http_req_duration{ep:${ep}}`];
  const v = m?.values ?? {};
  const failed = (m?.thresholds && Object.values(m.thresholds).some((t) => !t.ok)) ? " ❌" : "";
  return `| ${ep} | ${ms(v.med)} | ${ms(v["p(95)"])} | ${ms(v["p(99)"])} | ${ms(v.max)}${failed} |`;
});
const reqs = metrics.http_reqs?.values ?? {};
const failRate = metrics.http_req_failed?.values?.rate ?? 0;
console.log([
  `### ${title}`,
  "",
  "| endpoint | median | p95 | p99 | max |",
  "|---|---|---|---|---|",
  ...rows,
  "",
  `${reqs.count ?? 0} requests (${(reqs.rate ?? 0).toFixed(1)}/s), ${(failRate * 100).toFixed(2)} % failed.`,
].join("\n"));
