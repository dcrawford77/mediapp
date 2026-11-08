const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createServer, getBasePath, getServiceConfig } = require("../server");

let server;
let origin;
const receivedKeys = [];

before(async () => {
  const mockServices = http.createServer((request, response) => {
    receivedKeys.push(request.headers["x-api-key"]);
    const pathname = new URL(request.url, "http://localhost").pathname.replace("/sonarr", "");
    const responses = {
      "/api/v3/system/status": { version: "4.0.0" },
      "/api/v3/health": [{ type: "warning", message: "Disk space is low" }],
      "/api/v3/queue": { records: [{ title: "Example", size: 1000, sizeleft: 250 }], totalRecords: 1 },
      "/api/v3/history": { records: [{ sourceTitle: "Recently added", date: "2025-01-01T10:00:00Z" }], totalRecords: 1 },
    };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(responses[pathname] || {}));
  });
  await new Promise((resolve) => mockServices.listen(0, "127.0.0.1", resolve));
  const address = mockServices.address();
  origin = `http://127.0.0.1:${address.port}`;

  server = createServer({
    env: {
      SONARR_URL: `${origin}/sonarr/api/v3/`,
      SONARR_API_KEY: "test-sonarr-secret",
      RADARR_URL: "not a valid URL",
      RADARR_API_KEY: "unused-secret",
    },
  });
  server.mockServices = mockServices;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await Promise.all([server, server?.mockServices].filter(Boolean).map(
    (instance) => new Promise((resolve, reject) => instance.close((error) => error ? reject(error) : resolve())),
  ));
});

test("dashboard proxies service status, queue, health, and history without returning keys", async () => {
  const response = await fetch(`${origin}/api/dashboard`);
  assert.equal(response.status, 200);
  const dashboard = await response.json();

  assert.equal(dashboard.services.sonarr.status, "online");
  assert.equal(dashboard.services.sonarr.system.version, "4.0.0");
  assert.equal(dashboard.services.sonarr.queue.records[0].title, "Example");
  assert.equal(dashboard.services.sonarr.queue.totalRecords, 1);
  assert.equal(dashboard.services.sonarr.health.records[0].message, "Disk space is low");
  assert.equal(dashboard.services.sonarr.history.records[0].sourceTitle, "Recently added");
  assert.equal(dashboard.services.radarr.status, "not-configured");
  assert.match(dashboard.services.radarr.message, /RADARR_URL/);
  assert.doesNotMatch(JSON.stringify(dashboard), /test-sonarr-secret|unused-secret/);
  assert.ok(receivedKeys.length >= 4);
  assert.ok(receivedKeys.every((key) => key === "test-sonarr-secret"));
});

test("the header uses the Mediapp logo image", async () => {
  const pageResponse = await fetch(origin);
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  assert.match(page, /class="brand-mark" src="mediapp-logo\.png"/);
  assert.match(page, /rel="icon" type="image\/png" href="mediapp-logo\.png"/);

  const logoResponse = await fetch(`${origin}/mediapp-logo.png`);
  assert.equal(logoResponse.status, 200);
  assert.equal(logoResponse.headers.get("content-type"), "image/png");
  assert.deepEqual(
    [...new Uint8Array(await logoResponse.arrayBuffer()).slice(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
});

test("service URL validation only permits HTTP(S) URLs without embedded credentials", () => {
  assert.equal(getServiceConfig({ SONARR_URL: "ftp://host", SONARR_API_KEY: "key" }, "sonarr").configured, false);
  assert.equal(getServiceConfig({ SONARR_URL: "http://user:pass@host", SONARR_API_KEY: "key" }, "sonarr").configured, false);
  assert.equal(getServiceConfig({ SONARR_URL: "http://host:8989/api/v3", SONARR_API_KEY: "key" }, "sonarr").configured, true);
});

test("service API keys can be read from mounted secret files", () => {
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "mediapp-test-"));
  const secretPath = path.join(secretDir, "sonarr-api-key");
  fs.writeFileSync(secretPath, "file-secret\n");
  try {
    const config = getServiceConfig({
      SONARR_URL: "http://localhost:8989",
      SONARR_API_KEY_FILE: secretPath,
      SONARR_API_KEY: "environment-secret",
    }, "sonarr");
    assert.equal(config.apiKey, "file-secret");
    assert.equal(config.configured, true);
    assert.throws(() => getServiceConfig({
      SONARR_URL: "http://localhost:8989",
      SONARR_API_KEY_FILE: path.join(secretDir, "missing"),
    }, "sonarr"), /Unable to read SONARR_API_KEY_FILE/);
  } finally {
    fs.rmSync(secretDir, { recursive: true, force: true });
  }
});

test("BASE_PATH serves the app and API below a reverse-proxy prefix", async () => {
  assert.equal(getBasePath(" /davelight/mediapp/ "), "/davelight/mediapp");
  assert.equal(getBasePath("/"), "");
  assert.throws(() => getBasePath("/mediapp/../admin"), /BASE_PATH/);

  const prefixedServer = createServer({ env: { BASE_PATH: "/davelight/mediapp" } });
  await new Promise((resolve) => prefixedServer.listen(0, "127.0.0.1", resolve));
  const prefixedOrigin = `http://127.0.0.1:${prefixedServer.address().port}`;
  try {
    const redirect = await fetch(`${prefixedOrigin}/davelight/mediapp`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "/davelight/mediapp/");

    const pageResponse = await fetch(`${prefixedOrigin}/davelight/mediapp/`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /<base href="\/davelight\/mediapp\/">/);

    const iconResponse = await fetch(`${prefixedOrigin}/davelight/mediapp/icons/sonarr.svg`);
    assert.equal(iconResponse.status, 200);
    assert.equal(iconResponse.headers.get("content-type"), "image/svg+xml");

    const dashboardResponse = await fetch(`${prefixedOrigin}/davelight/mediapp/api/dashboard`);
    assert.equal(dashboardResponse.status, 200);
    assert.equal((await dashboardResponse.json()).services.sonarr.status, "not-configured");
    assert.equal((await fetch(`${prefixedOrigin}/api/dashboard`)).status, 404);
  } finally {
    await new Promise((resolve, reject) => prefixedServer.close((error) => error ? reject(error) : resolve()));
  }
});
