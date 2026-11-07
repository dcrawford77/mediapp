const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC_DIR = path.join(__dirname, "public");
const API_PREFIX = "/api/v3";
const PAGE_SIZE = 15;
const REQUEST_TIMEOUT_MS = 8000;

function loadEnvFile(env = process.env, filePath = path.join(__dirname, ".env")) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return env;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    env[match[1]] = value;
  }
  return env;
}

function getServiceConfig(env, name) {
  const prefix = name.toUpperCase();
  const baseUrl = (env[`${prefix}_URL`] || "").trim();
  const apiKey = (env[`${prefix}_API_KEY`] || "").trim();
  let url;

  if (baseUrl && apiKey) {
    try {
      url = new URL(baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        url = undefined;
      }
    } catch {
      url = undefined;
    }
  }

  if (url) {
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/api\/v3$/i, "");
    url.search = "";
    url.hash = "";
  }

  return {
    name,
    url,
    apiKey: url ? apiKey : undefined,
    configured: Boolean(url && apiKey),
  };
}

function errorMessage(error) {
  if (error && error.statusCode === 401) {
    return "Authentication failed. Check the API key.";
  }
  if (error && error.statusCode) {
    return `Request failed (HTTP ${error.statusCode}).`;
  }
  if (error && error.name === "TimeoutError") {
    return "The service did not respond in time.";
  }
  return "Could not connect to the service. Check its URL and availability.";
}

async function requestJson(config, resource, fetchImpl) {
  const url = new URL(config.url);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${API_PREFIX}/${resource}`;
  if (resource === "queue" || resource === "history") {
    const query = {
      page: "1",
      pageSize: String(PAGE_SIZE),
    };
    if (resource === "queue") {
      Object.assign(query, config.name === "sonarr"
        ? { includeSeries: "true", includeEpisode: "true" }
        : { includeMovie: "true" });
    } else {
      Object.assign(query, { sortKey: "date", sortDirection: "descending" });
    }
    url.search = new URLSearchParams(query);
  }

  const response = await fetchImpl(url, {
    headers: { "X-Api-Key": config.apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error("Request failed");
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

async function getResource(config, resource, fetchImpl) {
  try {
    return { data: await requestJson(config, resource, fetchImpl), error: null };
  } catch (error) {
    return { data: null, error: errorMessage(error) };
  }
}

function recordsFrom(data) {
  return Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : [];
}

function totalFrom(data, records) {
  return Number.isFinite(data?.totalRecords) ? data.totalRecords : records.length;
}

async function getServiceDashboard(config, fetchImpl) {
  const emptyList = { records: [], totalRecords: 0, error: null };
  if (!config.configured) {
    return {
      name: config.name,
      configured: false,
      status: "not-configured",
      system: null,
      health: emptyList,
      queue: emptyList,
      history: emptyList,
      message: `Set ${config.name.toUpperCase()}_URL and ${config.name.toUpperCase()}_API_KEY in .env.`,
    };
  }

  const [systemResult, healthResult, queueResult, historyResult] = await Promise.all([
    getResource(config, "system/status", fetchImpl),
    getResource(config, "health", fetchImpl),
    getResource(config, "queue", fetchImpl),
    getResource(config, "history", fetchImpl),
  ]);
  const healthRecords = recordsFrom(healthResult.data);
  const queueRecords = recordsFrom(queueResult.data);
  const historyRecords = recordsFrom(historyResult.data);
  const anyEndpointFailed = [healthResult, queueResult, historyResult].some((result) => result.error);
  const status = systemResult.error ? "offline" : anyEndpointFailed ? "degraded" : "online";

  return {
    name: config.name,
    configured: true,
    status,
    system: systemResult.data,
    systemError: systemResult.error,
    health: {
      records: healthRecords,
      totalRecords: healthRecords.length,
      error: healthResult.error,
    },
    queue: {
      records: queueRecords,
      totalRecords: totalFrom(queueResult.data, queueRecords),
      error: queueResult.error,
    },
    history: {
      records: historyRecords,
      totalRecords: totalFrom(historyResult.data, historyRecords),
      error: historyResult.error,
    },
  };
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const contentTypes = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
    };
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  });
}

function createServer({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const services = [
    getServiceConfig(env, "sonarr"),
    getServiceConfig(env, "radarr"),
  ];

  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/api/dashboard") {
      const results = await Promise.all(services.map((service) => getServiceDashboard(service, fetchImpl)));
      sendJson(response, 200, {
        updatedAt: new Date().toISOString(),
        services: Object.fromEntries(results.map((service) => [service.name, service])),
      });
      return;
    }
    if (request.method === "GET" && !pathname.startsWith("/api/")) {
      serveStatic(response, pathname);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  });
}

if (require.main === module) {
  loadEnvFile();
  const server = createServer();
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Mediapp is running at http://localhost:${port}`);
  });
}

module.exports = { createServer, getServiceConfig, getServiceDashboard, loadEnvFile };
