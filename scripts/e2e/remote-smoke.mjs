/**
 * Playwright smoke against production (court.ursamu.io).
 *
 * Usage:
 *   node scripts/e2e/remote-smoke.mjs
 *   BASE_URL=https://court.ursamu.io node scripts/e2e/remote-smoke.mjs
 *
 * Optional staff theme round-trip (needs STAFF_JWT):
 *   STAFF_JWT=eyJ... node scripts/e2e/remote-smoke.mjs
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";

const BASE = (process.env.BASE_URL || "https://court.ursamu.io").replace(
  /\/$/,
  "",
);
const STAFF_JWT = (process.env.STAFF_JWT || "").trim();
const HEADLESS = process.env.HEADED !== "1";

const results = [];
function ok(name, detail = "") {
  results.push({ name, pass: true, detail });
  console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, pass: false, detail });
  console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
}

async function fetchJson(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text.slice(0, 200) };
  }
  return { res, body, text };
}

async function main() {
  console.log(`\nPlaywright smoke → ${BASE}\n`);

  // ── API preflight ──────────────────────────────────────────────
  {
    const { res, body } = await fetchJson(
      `/site/config.json?t=${Date.now()}`,
    );
    if (res.ok && body.skin && body.skinHref) {
      ok("GET /site/config.json", `skin=${body.skin} gen=${body.gen}`);
    } else {
      fail(
        "GET /site/config.json",
        `status=${res.status} body=${JSON.stringify(body).slice(0, 120)}`,
      );
    }
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // ── Apex public FE ─────────────────────────────────────────────
  try {
    const resp = await page.goto(`${BASE}/`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    const status = resp?.status() ?? 0;
    if (status >= 200 && status < 400) {
      ok("GET / (apex)", `status=${status}`);
    } else {
      fail("GET / (apex)", `status=${status}`);
    }

    const skin = await page.locator("html").getAttribute("data-skin");
    if (skin) ok("html[data-skin]", skin);
    else fail("html[data-skin]", "missing");

    const skinHref = await page
      .locator("link[data-site-skin]")
      .getAttribute("href");
    if (skinHref && skinHref.includes("/site/css/skins/")) {
      ok("link[data-site-skin]", skinHref.split("?")[0]);
    } else {
      fail("link[data-site-skin]", String(skinHref));
    }

    // Nav brand present
    const brand = page.locator("[data-site-brand]");
    if ((await brand.count()) > 0) {
      ok("nav brand", (await brand.first().innerText()).trim().slice(0, 40));
    } else {
      fail("nav brand", "not found");
    }

    // Shell layout
    const shell = page.locator(".site-shell, [data-site-shell], #wrapper");
    if ((await shell.count()) > 0) ok("site shell present");
    else fail("site shell present", "missing");
  } catch (e) {
    fail("apex load", String(e).slice(0, 200));
  }

  // ── Skin CSS loads ─────────────────────────────────────────────
  try {
    const href = await page
      .locator("link[data-site-skin]")
      .getAttribute("href");
    if (href) {
      const url = href.startsWith("http") ? href : `${BASE}${href}`;
      const r = await page.request.get(url);
      if (r.ok()) {
        const ct = r.headers()["content-type"] || "";
        ok("skin CSS fetch", `${r.status()} ${ct.split(";")[0]}`);
      } else {
        fail("skin CSS fetch", `status=${r.status()}`);
      }
    }
  } catch (e) {
    fail("skin CSS fetch", String(e).slice(0, 120));
  }

  // ── /site/ mount ───────────────────────────────────────────────
  try {
    const resp = await page.goto(`${BASE}/site/`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    if (resp && resp.ok()) ok("GET /site/", `status=${resp.status()}`);
    else fail("GET /site/", `status=${resp?.status()}`);
  } catch (e) {
    fail("GET /site/", String(e).slice(0, 120));
  }

  // ── Staff console shell ────────────────────────────────────────
  try {
    const resp = await page.goto(`${BASE}/admin/`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    const status = resp?.status() ?? 0;
    // login redirect or SPA is fine
    if (status >= 200 && status < 500) {
      ok("GET /admin/", `status=${status} url=${page.url()}`);
    } else {
      fail("GET /admin/", `status=${status}`);
    }
    // Wait for Vue login form or app shell
    const pw = page.locator('input[type="password"]');
    const app = page.locator(".topbar, .shell, [data-staff-app]");
    try {
      await Promise.race([
        pw.first().waitFor({ state: "visible", timeout: 15000 }),
        app.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      /* fall through to text check */
    }
    const bodyText = (await page.locator("body").innerText()).replace(
      /\s+/g,
      " ",
    );
    if (
      (await pw.count()) > 0 ||
      (await app.count()) > 0 ||
      /sign in|staff console|dashboard|username|password/i.test(bodyText)
    ) {
      ok("admin UI chrome", "login or app visible");
    } else {
      fail("admin UI chrome", bodyText.slice(0, 100));
    }
  } catch (e) {
    fail("GET /admin/", String(e).slice(0, 120));
  }

  // ── Theme round-trip (optional staff JWT) ──────────────────────
  if (STAFF_JWT) {
    console.log("\n  theme round-trip (STAFF_JWT set)\n");
    const skins = ["default", "changeling", "court"];
    for (const skin of skins) {
      try {
        const act = await fetchJson("/api/v1/admin/site/theme", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${STAFF_JWT}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ activate: skin }),
        });
        if (!act.body?.ok || !act.body?.siteLive) {
          fail(
            `activate ${skin}`,
            JSON.stringify({
              ok: act.body?.ok,
              live: act.body?.siteLive,
              err: act.body?.error,
              status: act.res.status,
            }),
          );
          continue;
        }
        ok(`activate ${skin}`, "siteLive");

        await page.goto(`${BASE}/?t=${Date.now()}`, {
          waitUntil: "networkidle",
          timeout: 20000,
        });
        const dataSkin = await page.locator("html").getAttribute("data-skin");
        const link = await page
          .locator("link[data-site-skin]")
          .getAttribute("href");
        if (dataSkin === skin && link && link.includes(skin)) {
          ok(`FE reflects ${skin}`, `data-skin + href`);
        } else if (dataSkin === skin) {
          // court.css may alias; skin match is enough
          ok(`FE reflects ${skin}`, `data-skin=${dataSkin}`);
        } else {
          fail(
            `FE reflects ${skin}`,
            `data-skin=${dataSkin} href=${link}`,
          );
        }
      } catch (e) {
        fail(`theme ${skin}`, String(e).slice(0, 160));
      }
    }
  } else {
    console.log(
      "\n  (skip theme round-trip — set STAFF_JWT to enable)\n",
    );
  }

  // ── Console errors (soft — ignore common asset 404 noise) ─────
  const serious = consoleErrors.filter(
    (t) =>
      !/favicon|font|third-party|net::ERR_BLOCKED|404|Failed to load resource/i
        .test(t) &&
      t.length < 300,
  );
  if (serious.length === 0) {
    ok(
      "no serious console errors",
      consoleErrors.length
        ? `(ignored ${consoleErrors.length} noise)`
        : "",
    );
  } else {
    fail("console errors", serious.slice(0, 3).join(" | "));
  }

  await browser.close();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
