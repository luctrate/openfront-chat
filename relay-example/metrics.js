// OpenTelemetry wiring for the relay. Exports a `metrics` bag with named
// counters/histograms plus helpers for uniqueness tracking. Everything
// aggregated in-process before being pushed to the collector.
//
// Config via env:
//   OTEL_EXPORTER_OTLP_ENDPOINT   base URL, e.g. http://otel-collector.otel.svc.cluster.local:4318
//   OTEL_SERVICE_NAME             logical service name shown in the backend
//   OTEL_METRICS_EXPORT_INTERVAL  ms between pushes (default 30000)
//
// If OTEL_EXPORTER_OTLP_ENDPOINT is empty, metrics are recorded to no-ops
// (safe for local dev without a collector).

import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import crypto from "node:crypto";

const OTLP_BASE = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").replace(/\/$/, "");
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "oftc-relay";
const SERVICE_VERSION = process.env.OTEL_SERVICE_VERSION || "0.3.0";
const STAGE = process.env.STAGE || "prod";
const EXPORT_INTERVAL = Number(process.env.OTEL_METRICS_EXPORT_INTERVAL || 30_000);

const readers = [];
if (OTLP_BASE) {
  readers.push(new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${OTLP_BASE}/v1/metrics` }),
    exportIntervalMillis: EXPORT_INTERVAL,
  }));
  console.log(`[metrics] pushing to ${OTLP_BASE}/v1/metrics every ${EXPORT_INTERVAL/1000}s as service.name=${SERVICE_NAME} stage=${STAGE}`);
} else {
  console.log(`[metrics] OTEL_EXPORTER_OTLP_ENDPOINT unset — metrics are no-ops`);
}

const provider = new MeterProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    // Semantic-convention key for environment.
    "deployment.environment": STAGE,
    // Short alias — easier to type in dashboard filters.
    "stage": STAGE,
  }),
  readers,
});

const meter = provider.getMeter("oftc");

// ---- salted uniqueness -----------------------------------------------------

// Fresh salt per process — no cross-restart correlation possible.
const SALT = crypto.randomBytes(16);
export function hashId(value) {
  return crypto.createHash("sha256").update(SALT).update(String(value)).digest("base64url").slice(0, 12);
}

const seenIps  = new Map(); // hash -> expireTs
const seenNicks = new Map();
const UNIQUE_WINDOW_MS = 5 * 60 * 1000;

function markSeen(map, key) {
  const now = Date.now();
  map.set(key, now + UNIQUE_WINDOW_MS);
  // Opportunistic cleanup when the map grows.
  if (map.size > 500) {
    for (const [k, t] of map) if (t < now) map.delete(k);
  }
}
function uniqueCount(map) {
  const now = Date.now();
  let n = 0;
  for (const t of map.values()) if (t > now) n++;
  return n;
}
export function seenIp(ip)     { if (ip)   markSeen(seenIps,   hashId(ip)); }
export function seenNick(nick) { if (nick) markSeen(seenNicks, hashId(nick)); }

// ---- counters + histograms -------------------------------------------------

export const metrics = {
  messagesSent:      meter.createCounter("oftc_messages_sent_total",   { description: "Chat messages successfully broadcast" }),
  filterHits:        meter.createCounter("oftc_filter_hits_total",     { description: "Chat messages dropped by content filters" }),
  wsConnections:     meter.createCounter("oftc_ws_connections_total",  { description: "WebSocket connections accepted" }),
  wsDisconnects:     meter.createCounter("oftc_ws_disconnects_total",  { description: "WebSocket disconnects, labeled by close code" }),
  verifyCalls:       meter.createCounter("oftc_verify_calls_total",    { description: "Game-verification API lookups" }),
  verifyDuration:    meter.createHistogram("oftc_verify_duration_ms",  { description: "Latency of the OpenFront verification API", unit: "ms" }),
  rateLimitHits:     meter.createCounter("oftc_rate_limit_hits_total", { description: "Requests rejected by rate limiters" }),
  roomFull:          meter.createCounter("oftc_room_full_total",       { description: "Room-cap rejections" }),
  authFailures:      meter.createCounter("oftc_auth_failures_total",   { description: "Handshake auth rejections" }),
  messageLength:     meter.createHistogram("oftc_message_length_chars",{ description: "Chat message length after filtering", unit: "1" }),
};

// ---- gauges (observed from live state) -------------------------------------

// The relay passes a getter for its `sessions` Map / `rooms` Map at init time
// so we don't couple this module to those internals.
export function registerLiveGauges({ getConnections, getRooms }) {
  meter.createObservableGauge("oftc_active_connections", {
    description: "Live WebSocket connections",
  }).addCallback((r) => r.observe(getConnections()));

  meter.createObservableGauge("oftc_active_rooms", {
    description: "Rooms with at least one connected socket, by type",
  }).addCallback((r) => {
    const { global, game } = getRooms();
    r.observe(global, { room_type: "global" });
    r.observe(game,   { room_type: "game" });
  });

  meter.createObservableGauge("oftc_active_users_5m", {
    description: "Distinct salted-hashed nicknames seen in a 5-min rolling window",
  }).addCallback((r) => r.observe(uniqueCount(seenNicks)));

  meter.createObservableGauge("oftc_active_ips_5m", {
    description: "Distinct salted-hashed IPs seen in a 5-min rolling window",
  }).addCallback((r) => r.observe(uniqueCount(seenIps)));
}

// ---- shutdown --------------------------------------------------------------

export async function shutdown() {
  try { await provider.shutdown(); } catch (_) {}
}
