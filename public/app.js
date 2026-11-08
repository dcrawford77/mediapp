const serviceGrid = document.querySelector("#service-grid");
const activityList = document.querySelector("#activity-list");
const updatedAt = document.querySelector("#updated-at");
const refreshButton = document.querySelector("#refresh-button");
const liveRegion = document.querySelector("#live-region");
const APP_BASE_PATH = new URL(document.querySelector("base").href).pathname.replace(/\/$/, "");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function titleFor(record) {
  const episodeTitle = record.series?.title && record.episode?.title
    ? `${record.series.title} · ${record.episode.title}`
    : record.series?.title;
  return record.title || episodeTitle || record.movie?.title || record.trackedDownloadState || "Unknown download";
}

function queuePercent(record) {
  const size = Number(record.size) || 0;
  const left = Number(record.sizeleft) || 0;
  if (size <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((size - left) / size) * 100)));
}

function statusLabel(status) {
  return ({
    online: "Online",
    degraded: "Partial",
    offline: "Offline",
    "not-configured": "Setup needed",
  })[status] || "Unknown";
}

function createQueueItem(record) {
  const item = element("div", "queue-item");
  const top = element("div", "queue-item-top");
  top.append(element("span", "queue-title", titleFor(record)));
  const percent = queuePercent(record);
  top.append(element("span", "queue-percent", `${percent}%`));
  item.append(top);

  const track = element("div", "progress-track");
  const fill = element("div", "progress-fill");
  fill.style.width = `${percent}%`;
  track.append(fill);
  item.append(track);

  const meta = element("div", "queue-meta");
  const state = record.trackedDownloadState || record.status || record.trackedDownloadStatus || "Downloading";
  meta.append(element("span", "", state));
  const remaining = Number(record.sizeleft);
  const timeLeft = record.timeleft && record.timeleft !== "00:00:00" ? record.timeleft : "";
  meta.append(element("span", "", [
    Number.isFinite(remaining) && remaining > 0 ? `${formatBytes(remaining)} left` : "",
    timeLeft,
  ].filter(Boolean).join(" · ")));
  item.append(meta);
  return item;
}

function createServiceCard(service) {
  const key = service.name.toLowerCase();
  const card = element("article", "service-card");
  const head = element("div", "card-head");
  const name = element("div", "service-name");
  const logo = element("span", `service-logo ${key}`);
  logo.setAttribute("aria-hidden", "true");
  const image = element("img", "");
  image.src = `${APP_BASE_PATH}/icons/${key}.svg`;
  image.alt = "";
  logo.append(image);
  name.append(logo);
  const nameText = element("div");
  nameText.append(element("h2", "", service.name));
  const version = service.system?.version ? `v${service.system.version}` : service.configured ? "Series & movies" : "Connect your instance";
  nameText.append(element("span", "service-version", version));
  name.append(nameText);
  head.append(name);

  const pill = element("span", `status-pill ${service.status}`);
  pill.append(element("span", "status-dot"));
  pill.append(document.createTextNode(statusLabel(service.status)));
  head.append(pill);
  card.append(head);

  const stats = element("div", "card-stats");
  const downloadStat = element("div", "stat");
  downloadStat.append(element("div", "stat-label", "In queue"));
  const downloadValue = element("div", "stat-value");
  downloadValue.append(document.createTextNode(String(service.queue.totalRecords || 0)));
  downloadValue.append(element("small", "", "downloads"));
  downloadStat.append(downloadValue);
  const healthStat = element("div", "stat");
  healthStat.append(element("div", "stat-label", "Health notices"));
  const healthValue = element("div", "stat-value");
  healthValue.append(document.createTextNode(String(service.health.records.length)));
  healthValue.append(element("small", "", service.health.records.length === 1 ? "notice" : "notices"));
  healthStat.append(healthValue);
  stats.append(downloadStat, healthStat);
  card.append(stats);

  const queueWrap = element("div", "queue-wrap");
  const label = element("div", "section-label");
  label.append(element("span", "", "DOWNLOAD QUEUE"));
  label.append(element("span", "count", service.queue.totalRecords ? `${service.queue.totalRecords} total` : ""));
  queueWrap.append(label);
  const queueList = element("div", "queue-list");
  if (!service.configured) {
    queueList.append(element("p", "empty-state", service.message));
  } else if (service.queue.error) {
    queueList.append(element("p", "empty-state", service.queue.error));
  } else if (service.queue.records.length === 0) {
    queueList.append(element("p", "empty-state", "Nothing in the queue right now."));
  } else {
    service.queue.records.slice(0, 4).forEach((record) => queueList.append(createQueueItem(record)));
  }
  queueWrap.append(queueList);
  card.append(queueWrap);

  const alerts = element("div", "health-alerts");
  if (service.systemError) {
    alerts.append(element("div", "health-alert error", service.systemError));
  }
  if (service.health.error) {
    alerts.append(element("div", "health-alert error", `Health check: ${service.health.error}`));
  } else {
    service.health.records.slice(0, 3).forEach((record) => {
      const level = String(record.type || record.level || "").toLowerCase();
      alerts.append(element("div", `health-alert ${level === "error" ? "error" : ""}`, record.message || record.source || "Service health notice"));
    });
  }
  if (service.history.error) {
    alerts.append(element("div", "health-alert error", `Activity: ${service.history.error}`));
  }
  if (alerts.childNodes.length) card.append(alerts);
  return card;
}

function activityName(record) {
  return record.sourceTitle || record.title || record.series?.title || record.movie?.title || "Media activity";
}

function createActivityItem(item) {
  const { service, record } = item;
  const row = element("article", "activity-item");
  const details = element("div");
  details.append(element("div", "activity-title", activityName(record)));
  const subtitle = [record.eventType, record.quality?.quality?.name, record.quality?.name]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" · ");
  details.append(element("div", "activity-detail", subtitle || "Recorded in service history"));
  row.append(details);

  const side = element("div", "activity-side");
  side.append(element("span", `service-tag ${service.name.toLowerCase()}`, service.name));
  side.append(element("span", "activity-status", formatTime(record.date || record.existingFile?.dateAdded) || "Recently"));
  row.append(side);
  return row;
}

function renderDashboard(data) {
  const services = Object.values(data.services);
  serviceGrid.replaceChildren(...services.map(createServiceCard));
  const activity = services.flatMap((service) => service.history.records.map((record) => ({ service, record })))
    .sort((a, b) => new Date(b.record.date || 0) - new Date(a.record.date || 0))
    .slice(0, 10);
  if (activity.length) {
    activityList.replaceChildren(...activity.map(createActivityItem));
  } else {
    const message = services.every((service) => !service.configured)
      ? "Add your Sonarr and Radarr connection details to see recent activity."
      : services.some((service) => service.history.error)
        ? "Recent activity could not be loaded. Check the service status above."
        : "No recent activity has been recorded yet.";
    activityList.replaceChildren(element("p", "empty-state activity-empty", message));
  }
  const time = formatTime(data.updatedAt);
  updatedAt.textContent = time ? `Updated ${time}` : "Updated just now";
  liveRegion.textContent = "Dashboard refreshed.";
}

async function refresh() {
  refreshButton.disabled = true;
  try {
    const response = await fetch(`${APP_BASE_PATH}/api/dashboard`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Dashboard request failed.");
    renderDashboard(await response.json());
  } catch {
    updatedAt.textContent = "Unable to load dashboard";
    liveRegion.textContent = "Dashboard could not be refreshed.";
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", refresh);
refresh();
window.setInterval(refresh, 30000);
