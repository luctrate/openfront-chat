// Validates an OpenObserve v5 dashboard JSON against the rules the Rust
// importer enforces (src/config/src/meta/dashboards/v5).
//   node validate.mjs o2-dashboard.json
import { readFileSync } from "node:fs";

const AGG = new Set(["count","count-distinct","histogram","sum","min","max","avg","median","p50","p90","p95","p99"]);
const INTERP = new Set(["smooth","linear","step-start","step-end","step-middle"]);
const STREAM_TYPES = new Set(["logs","metrics","traces","enrichment_tables","index","metadata"]);
const PANEL_TYPES = new Set(["area","area-stacked","bar","h-bar","line","scatter","pie","donut","table","stacked","heatmap","h-stacked","metric","gauge","geomap","sankey","html","markdown","custom_chart"]);

const errs = [];
const file = process.argv[2];
let d;
try { d = JSON.parse(readFileSync(file, "utf8")); }
catch (e) { console.error(`${file}: not valid JSON — ${e.message}`); process.exit(1); }

const req = (obj, key, type, where) => {
  if (obj[key] === undefined || obj[key] === null) { errs.push(`${where}: missing required "${key}"`); return false; }
  if (type === "array" ? !Array.isArray(obj[key]) : typeof obj[key] !== type) {
    errs.push(`${where}: "${key}" must be ${type}, got ${Array.isArray(obj[key]) ? "array" : typeof obj[key]}`);
    return false;
  }
  return true;
};

if (d.version !== 5) errs.push(`root: version must be 5, got ${JSON.stringify(d.version)}`);
req(d, "title", "string", "root");
req(d, "description", "string", "root");
if (d.created && Number.isNaN(Date.parse(d.created))) errs.push(`root: "created" is not a parseable RFC3339 timestamp`);
if (d.variables !== undefined && d.variables !== null && !Array.isArray(d.variables?.list))
  errs.push(`root: "variables" must be null or {list: [...]}`);

const seenLayoutI = new Map();
for (const [ti, tab] of (d.tabs ?? []).entries()) {
  const tw = `tabs[${ti}]`;
  req(tab, "tabId", "string", tw);
  req(tab, "name", "string", tw);
  seenLayoutI.set(ti, new Set());

  for (const [pi, p] of (tab.panels ?? []).entries()) {
    const pw = `${tw}.panels[${pi}] (${p.id ?? "?"} "${p.title ?? ""}")`;
    req(p, "id", "string", pw);
    req(p, "title", "string", pw);
    // description is a plain String in the Rust struct — absent means import fails.
    req(p, "description", "string", pw);
    req(p, "queryType", "string", pw);
    req(p, "queries", "array", pw);
    if (p.type && !PANEL_TYPES.has(p.type)) errs.push(`${pw}: unknown panel type "${p.type}"`);

    // --- config ---
    if (req(p, "config", "object", pw)) {
      const c = p.config;
      if (typeof c.show_legends !== "boolean") errs.push(`${pw}.config: "show_legends" is required and must be a bool`);
      if (c.line_interpolation != null && !INTERP.has(c.line_interpolation))
        errs.push(`${pw}.config: bad line_interpolation "${c.line_interpolation}"`);
      for (const k of ["decimals","line_thickness","top_results","y_axis_min","y_axis_max","axis_width"])
        if (c[k] != null && typeof c[k] !== "number") errs.push(`${pw}.config: "${k}" must be a number or null`);
    }

    // --- layout ---
    if (req(p, "layout", "object", pw)) {
      for (const k of ["x","y","w","h","i"])
        if (!Number.isInteger(p.layout[k])) errs.push(`${pw}.layout: "${k}" must be an integer`);
      const s = seenLayoutI.get(ti);
      if (s.has(p.layout.i)) errs.push(`${pw}.layout: duplicate "i" value ${p.layout.i} within the tab`);
      s.add(p.layout.i);
    }

    // --- queries ---
    for (const [qi, q] of (p.queries ?? []).entries()) {
      const qw = `${pw}.queries[${qi}]`;
      if (typeof q.customQuery !== "boolean") errs.push(`${qw}: "customQuery" is required and must be a bool`);
      if (!q.config || typeof q.config.promql_legend !== "string")
        errs.push(`${qw}.config: "promql_legend" is required and must be a string`);

      if (!req(q, "fields", "object", qw)) continue;
      const f = q.fields;
      req(f, "stream", "string", `${qw}.fields`);
      if (!STREAM_TYPES.has(f.stream_type)) errs.push(`${qw}.fields: bad stream_type "${f.stream_type}"`);
      req(f, "x", "array", `${qw}.fields`);
      req(f, "y", "array", `${qw}.fields`);

      // PanelFilter is an untagged enum of two OBJECT variants — an array here
      // is the single most common v5 import failure.
      const flt = f.filter;
      if (Array.isArray(flt)) {
        errs.push(`${qw}.fields: "filter" is an array; v5 needs {"filterType":"group","logicalOperator":"AND","conditions":[]}`);
      } else if (!flt || typeof flt !== "object") {
        errs.push(`${qw}.fields: "filter" is required (filter group object)`);
      } else if (flt.filterType === "group") {
        if (typeof flt.logicalOperator !== "string") errs.push(`${qw}.fields.filter: group needs "logicalOperator"`);
        if (!Array.isArray(flt.conditions)) errs.push(`${qw}.fields.filter: group needs "conditions" array`);
      } else if (flt.filterType !== "condition") {
        errs.push(`${qw}.fields.filter: filterType must be "group" or "condition"`);
      }

      for (const axisKey of ["x","y","z","breakdown"]) {
        for (const [ai, a] of (f[axisKey] ?? []).entries()) {
          const aw = `${qw}.fields.${axisKey}[${ai}]`;
          req(a, "label", "string", aw);
          req(a, "alias", "string", aw);
          req(a, "column", "string", aw);
          if (a.aggregationFunction != null && !AGG.has(a.aggregationFunction))
            errs.push(`${aw}: "${a.aggregationFunction}" is not a valid aggregationFunction (${[...AGG].join(", ")})`);
          // For custom SQL the alias must match what the query actually selects.
          if (q.customQuery && q.query && a.alias && !q.query.includes(a.alias))
            errs.push(`${aw}: alias "${a.alias}" does not appear in the panel SQL`);
        }
      }
    }
  }
}

if (errs.length) {
  console.error(`${file}: ${errs.length} problem(s)\n` + errs.map(e => "  - " + e).join("\n"));
  process.exit(1);
}
console.log(`${file}: OK — v5 schema clean`);
