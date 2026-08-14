// Generate an OpenObserve v5 dashboard JSON and print it to stdout.
//   STAGE=prod node o2-dashboard-generate.mjs > o2-dashboard-prod.json
//   STAGE=test node o2-dashboard-generate.mjs > o2-dashboard-test.json
//   (unset STAGE  → dashboard with no stage filter — matches all rows)
//
// STAGE injects `WHERE stage = '<stage>'` into every SQL query. The label
// itself is set by the relay via metrics.js from its STAGE env var, exported
// as the `stage` resource attribute on every metric.
//
// Shape follows the v5 structs in openobserve/src/config/src/meta/dashboards/v5.
// Things the importer is strict about, and that are easy to get wrong:
//   * fields.filter must be a FILTER GROUP OBJECT, never an array.
//   * panel.description is a required String (use "" when there is none).
//   * config.show_legends is a required bool on every panel, chart or not.
//   * aggregationFunction is a closed enum — see AGGREGATIONS below. There is
//     no "last"; for custom SQL just omit the field.
//   * layout.i is a number and must be unique within the tab.
//
// `created` is pinned via O2_DASHBOARD_CREATED so regenerating the file does
// not produce a spurious diff on every run.

const STAGE = process.env.STAGE || null;
const STAGE_LABEL = STAGE ? ` — ${STAGE.toUpperCase()}` : "";
// SQL fragment to constrain to this stage. Empty when STAGE is unset.
const WHERE_STAGE = STAGE ? `WHERE stage = '${STAGE.replace(/'/g, "''")}'` : "";

// Valid AggregationFunc variants (serde kebab-case).
const AGGREGATIONS = new Set([
  "count", "count-distinct", "histogram", "sum",
  "min", "max", "avg", "median", "p50", "p90", "p95", "p99",
]);

// PanelFilter::Group with no conditions. An empty array here is a hard
// deserialization error on import.
const EMPTY_FILTER = () => ({
  filterType: "group",
  logicalOperator: "AND",
  conditions: [],
});

const DEFAULT_CONFIG = {
  show_legends: true,
  legends_position: null,
  unit: "",
  unit_custom: null,
  decimals: 2,
  line_thickness: 1.5,
  step_value: "0",
  y_axis_min: null,
  y_axis_max: null,
  top_results_others: false,
  axis_border_show: false,
  label_option: { position: null, rotate: 0 },
  show_symbol: false,
  line_interpolation: "smooth",
  legend_width: { value: null, unit: "px" },
  base_map: { type: "osm" },
  map_type: { type: "world" },
  map_view: { zoom: 1, lat: 0, lng: 0 },
  map_symbol_style: { size: "by Value", size_by_value: { min: 1, max: 100 }, size_fixed: 2 },
  drilldown: [],
  connect_nulls: false,
  no_value_replacement: "",
  wrap_table_cells: false,
  table_transpose: false,
  table_dynamic_columns: false,
};

const DEFAULT_QUERY_CONFIG = {
  promql_legend: "",
  layer_type: "scatter",
  weight_fixed: 1,
  limit: 0,
  min: 0,
  max: 100,
};

function axis({ label, alias, column, agg }) {
  const item = { label, alias, column, color: null };
  // Only emit aggregationFunction when it is a real enum variant; the field is
  // optional and a bad value fails the whole import.
  if (agg && AGGREGATIONS.has(agg)) item.aggregationFunction = agg;
  return item;
}

function panel({ id, i, type, title, description = "", queries, layout, config = {}, unit = "", decimals = 0 }) {
  return {
    id,
    type,
    title,
    description,
    config: { ...DEFAULT_CONFIG, ...config, unit, decimals },
    queryType: "sql",
    queries,
    layout: { ...layout, i },
  };
}

function timeseries({ stream, alias, agg = "sum", breakdown, promql_legend = "" }) {
  const sqlAgg = agg.startsWith("p")
    ? `approx_percentile_cont(value, 0.${agg.slice(1)})`
    : `${agg}(value)`;
  const breakdownSql = breakdown ? `, ${breakdown} AS breakdown_1` : "";
  const groupBy = breakdown ? "x_axis_1, breakdown_1" : "x_axis_1";
  const sql =
    `SELECT histogram(_timestamp) AS x_axis_1, ${sqlAgg} AS y_axis_1${breakdownSql} ` +
    `FROM "${stream}" ${WHERE_STAGE} GROUP BY ${groupBy} ORDER BY x_axis_1`;

  return {
    query: sql,
    vrlFunctionQuery: null,
    customQuery: true,
    fields: {
      stream,
      stream_type: "metrics",
      x: [axis({ label: "Time", alias: "x_axis_1", column: "_timestamp", agg: "histogram" })],
      y: [axis({ label: alias, alias: "y_axis_1", column: "value", agg })],
      breakdown: breakdown ? [axis({ label: breakdown, alias: "breakdown_1", column: breakdown })] : [],
      z: [],
      filter: EMPTY_FILTER(),
    },
    config: { ...DEFAULT_QUERY_CONFIG, promql_legend },
  };
}

// Single-value panel. `sql` overrides the default "latest sample" query.
function scalar({ stream, alias = "v", sql, agg }) {
  const query =
    sql ?? `SELECT last_value(value ORDER BY _timestamp) AS ${alias} FROM "${stream}" ${WHERE_STAGE}`;
  return {
    query,
    vrlFunctionQuery: null,
    customQuery: true,
    fields: {
      stream,
      stream_type: "metrics",
      x: [],
      y: [axis({ label: alias, alias, column: "value", agg })],
      breakdown: [],
      z: [],
      filter: EMPTY_FILTER(),
    },
    config: { ...DEFAULT_QUERY_CONFIG },
  };
}

const dashboard = {
  version: 5,
  dashboardId: "",
  title: `OpenFront Chat — Relay Metrics${STAGE_LABEL}`,
  description: STAGE
    ? `Live analytics for the openfront-chat relay (stage=${STAGE})`
    : "Live analytics for the openfront-chat relay (all stages)",
  role: "",
  owner: process.env.O2_DASHBOARD_OWNER || "openfront-chat",
  created: process.env.O2_DASHBOARD_CREATED || new Date().toISOString(),
  tabs: [{
    tabId: "default",
    name: "Overview",
    panels: [
      // Row 1 — single-value stats
      panel({
        id: "p1", i: 1, type: "metric", title: "Active connections",
        description: "Live WebSocket connections",
        queries: [scalar({ stream: "oftc_active_connections" })],
        layout: { x: 0, y: 0, w: 3, h: 3 },
      }),
      panel({
        id: "p2", i: 2, type: "metric", title: "Active users (5 min)",
        description: "Distinct salted-hashed nicknames, rolling 5-min window",
        queries: [scalar({ stream: "oftc_active_users_5m" })],
        layout: { x: 3, y: 0, w: 3, h: 3 },
      }),
      panel({
        id: "p3", i: 3, type: "metric", title: "Active IPs (5 min)",
        description: "Distinct salted-hashed IPs, rolling 5-min window",
        queries: [scalar({ stream: "oftc_active_ips_5m" })],
        layout: { x: 6, y: 0, w: 3, h: 3 },
      }),
      panel({
        id: "p4", i: 4, type: "metric", title: "Active rooms",
        description: "Rooms with at least one connected socket",
        queries: [scalar({
          stream: "oftc_active_rooms", alias: "total", agg: "sum",
          sql:
            'SELECT sum(v) AS total FROM (' +
            'SELECT last_value(value ORDER BY _timestamp) AS v, room_type ' +
            `FROM "oftc_active_rooms" ${WHERE_STAGE} GROUP BY room_type) AS t`,
        })],
        layout: { x: 9, y: 0, w: 3, h: 3 },
      }),

      // Row 2 — message + filter volume
      panel({
        id: "p5", i: 5, type: "line", title: "Messages per interval, by mode",
        description: "Total chat messages broadcast, split by mode",
        queries: [timeseries({ stream: "oftc_messages_sent_total", alias: "Messages", agg: "sum", breakdown: "mode" })],
        layout: { x: 0, y: 3, w: 6, h: 6 },
      }),
      panel({
        id: "p6", i: 6, type: "bar", title: "Filter drops, by reason",
        description: "Messages the server dropped by content filter",
        queries: [timeseries({ stream: "oftc_filter_hits_total", alias: "Drops", agg: "sum", breakdown: "reason" })],
        layout: { x: 6, y: 3, w: 6, h: 6 },
      }),

      // Row 3 — connect / disconnect + verify latency
      panel({
        id: "p7", i: 7, type: "line", title: "WebSocket connects vs disconnects",
        description: "Socket lifecycle counters",
        queries: [
          timeseries({ stream: "oftc_ws_connections_total", alias: "connects", agg: "sum", promql_legend: "connects" }),
          timeseries({ stream: "oftc_ws_disconnects_total", alias: "disconnects", agg: "sum", promql_legend: "disconnects" }),
        ],
        layout: { x: 0, y: 9, w: 6, h: 6 },
      }),
      panel({
        id: "p8", i: 8, type: "line", title: "Verify API latency (ms)", unit: "ms",
        description: "OpenFront game-existence API latency",
        queries: [
          timeseries({ stream: "oftc_verify_duration_ms", alias: "p50", agg: "p50", promql_legend: "p50" }),
          timeseries({ stream: "oftc_verify_duration_ms", alias: "p95", agg: "p95", promql_legend: "p95" }),
        ],
        layout: { x: 6, y: 9, w: 6, h: 6 },
      }),

      // Row 4 — rate limits + message length
      panel({
        id: "p9", i: 9, type: "bar", title: "Rate-limit hits",
        description: "Messages / connections rejected by rate limits, by kind",
        queries: [timeseries({ stream: "oftc_rate_limit_hits_total", alias: "hits", agg: "sum", breakdown: "kind" })],
        layout: { x: 0, y: 15, w: 6, h: 5 },
      }),
      panel({
        id: "p10", i: 10, type: "line", title: "Message length (chars)", unit: "chars",
        description: "Distribution of broadcast message length",
        queries: [
          timeseries({ stream: "oftc_message_length_chars", alias: "p50", agg: "p50", promql_legend: "p50" }),
          timeseries({ stream: "oftc_message_length_chars", alias: "p95", agg: "p95", promql_legend: "p95" }),
        ],
        layout: { x: 6, y: 15, w: 6, h: 5 },
      }),

      // Row 5 — auth failures + room full
      panel({
        id: "p11", i: 11, type: "bar", title: "Auth failures",
        description: "Handshake rejections at the relay, by reason",
        queries: [timeseries({ stream: "oftc_auth_failures_total", alias: "hits", agg: "sum", breakdown: "reason" })],
        layout: { x: 0, y: 20, w: 6, h: 5 },
      }),
      panel({
        id: "p12", i: 12, type: "bar", title: "Room-full rejections",
        description: "Connections rejected because a room was at capacity",
        queries: [timeseries({ stream: "oftc_room_full_total", alias: "hits", agg: "sum", breakdown: "room_type" })],
        layout: { x: 6, y: 20, w: 6, h: 5 },
      }),

      // Row 6 — age gate
      panel({
        id: "p13", i: 13, type: "bar", title: "Age-gate decisions, by country",
        description: "Verdict per (country, verdict). verdict = pass | reject | no_client_flag. Threshold table lives in relay-example/geo.js.",
        queries: [timeseries({ stream: "oftc_age_gate_decisions_total", alias: "hits", agg: "sum", breakdown: "country" })],
        layout: { x: 0, y: 25, w: 6, h: 5 },
      }),
      panel({
        id: "p14", i: 14, type: "bar", title: "Age-gate decisions, by verdict",
        description: "Same metric grouped by verdict — quick view of reject vs pass rates.",
        queries: [timeseries({ stream: "oftc_age_gate_decisions_total", alias: "hits", agg: "sum", breakdown: "verdict" })],
        layout: { x: 6, y: 25, w: 6, h: 5 },
      }),
    ],
  }],
  variables: { list: [], showDynamicFilters: false },
  defaultDatetimeDuration: { type: "relative", relativeTimePeriod: "6h", startTime: null, endTime: null },
};

process.stdout.write(JSON.stringify(dashboard, null, 2) + "\n");
