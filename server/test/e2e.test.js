// End-to-end test: starts the REAL server and talks to it over HTTP.
// Needs a running MySQL/MariaDB with the migrated schema.
// Gemini is replaced by a fake, so no API key or internet is needed.
//
// Run:  E2E=1 DB_USER=... DB_PASSWORD=... DB_NAME=... npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const RUN = process.env.E2E === "1";
const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProcess;
let cookie = "";

async function api(pathname, options = {}) {
  const response = await fetch(BASE + pathname, {
    ...options,
    headers: { ...(options.headers || {}), cookie },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let body = null;
  try { body = await response.json(); } catch (e) { /* no body */ }
  return { status: response.status, body };
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(BASE + "/");
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Server did not start");
}

test("e2e: recognize -> save -> agents -> stored", { skip: !RUN }, async (t) => {
  serverProcess = spawn("node", ["-r", "./test/preloadFakeGenai.js", "server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: "fake" },
    stdio: "ignore",
  });
  t.after(() => serverProcess.kill());
  await waitForServer();

  const email = `e2e_${Date.now()}@example.com`;

  let r = await api("/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  assert.ok([200, 201].includes(r.status), "signup: " + JSON.stringify(r.body));

  r = await api("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  assert.equal(r.status, 200, "login");
  assert.ok(cookie.startsWith("dietary_session="));

  // Unauthenticated access must be refused
  const saved = cookie; cookie = "";
  r = await api("/food-agents/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ foodImageId: "x" }),
  });
  assert.equal(r.status, 401);
  cookie = saved;

  // Agents need a profile first
  const form0 = new FormData();
  form0.append("foodImage", new Blob([fs.readFileSync(path.join(__dirname, "..", "test-food.jpg"))], { type: "image/jpeg" }), "food.jpg");
  r = await api("/recognize-food", { method: "POST", body: form0 });
  assert.equal(r.status, 200, "recognize: " + JSON.stringify(r.body));
  assert.equal(r.body.foodName, "Chole Bhature");
  assert.equal(r.body.analysis.ingredients.visible.length, 2);
  assert.equal(r.body.analysis.nutritionEstimate.isEstimate, true);
  const foodImageId = r.body.foodImageId;

  r = await api("/food-agents/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ foodImageId }),
  });
  assert.equal(r.status, 404, "no profile yet should be 404");

  r = await api("/patients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Patient", age: 52, gender: "male",
      diseases: ["type 2 diabetes"], allergies: ["peanut"], foodPreferences: ["vegetarian"],
    }),
  });
  assert.ok([200, 201].includes(r.status), "patient: " + JSON.stringify(r.body));

  r = await api("/food-agents/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ foodImageId }),
  });
  assert.equal(r.status, 200, "agents: " + JSON.stringify(r.body));
  assert.deepEqual(r.body.agentErrors, {});
  // fake model said "good", but the patient is allergic to peanut and
  // "Peanut oil" is a suspected ingredient -> guard must raise to caution
  assert.equal(r.body.verdict.overallVerdict, "caution");
  assert.equal(r.body.verdict.allergyGuardTriggered, true);
  assert.equal(r.body.variants.length, 2);
  assert.ok(r.body.personalContext.toolsUsed.length >= 3);

  // Owner-only read works, and another user cannot read it
  r = await api(`/food-images/${foodImageId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.analysis.foodStyle, "Punjabi");

  // Wrong file type is rejected
  const form1 = new FormData();
  form1.append("foodImage", new Blob(["hello"], { type: "text/plain" }), "x.txt");
  r = await api("/recognize-food", { method: "POST", body: form1 });
  assert.equal(r.status, 400);

  // The old USDA route must be gone
  r = await api("/nutrition?food=pizza");
  assert.equal(r.status, 404);

  const second = `e2e2_${Date.now()}@example.com`;
  cookie = "";
  await api("/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: second, password: "password123" }) });
  await api("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: second, password: "password123" }) });
  r = await api(`/food-images/${foodImageId}`);
  assert.equal(r.status, 404, "other users must not read this analysis");
});