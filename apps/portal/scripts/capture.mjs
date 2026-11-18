// Captures Launchbay's README screenshots and demo video from a running Launchbay.
//
//   node scripts/capture.mjs screenshots      PNGs into docs/media/
//   node scripts/capture.mjs demo [name]      a real launch of <name> (default nova-api), recorded
//                                             and cut into docs/media/demo/launchbay-demo.mp4 + .gif
//
// Point it at another portal with LAUNCHBAY_URL (default http://localhost:5173). The video needs
// ffmpeg on PATH (or FFMPEG=<path>). Frames come from Chrome's screencast at full quality rather
// than Playwright's video recorder, so small text stays sharp.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.LAUNCHBAY_URL ?? "http://localhost:5173";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MEDIA = join(ROOT, "docs", "media");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const VIEWPORT = { width: 1440, height: 900 };
const FAST = 10; // fast-forward for the minutes a real pipeline and Argo CD sync take

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Screenshots

async function screenshots() {
  mkdirSync(MEDIA, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const shot = (name, target = page) => target.screenshot({ path: join(MEDIA, `${name}.png`) });
  const section = (text) => page.locator("section").filter({ has: page.getByText(text, { exact: true }) }).first();
  const settle = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    await sleep(2600); // in-view animations
  };

  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(3500);
  await shot("mission-control");

  for (const [name, text] of [
    ["guardrails", "Every launch passes four guardrails"],
    ["fleet-scorecards", "How the fleet measures up"],
  ]) {
    const s = page.locator("section").filter({ hasText: text }).first();
    await settle(s);
    await shot(name, s);
  }

  await page.goto(`${BASE}/launch`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Python API/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Service name").fill("orbit-api");
  await page.getByLabel("Owner").fill("team-platform");
  await page.getByLabel("Description").fill("Tracks satellites and the ground stations that talk to them.");
  await page.getByRole("checkbox", { name: /Object storage/ }).click();
  await page.getByRole("checkbox", { name: /Key-value table/ }).click();
  await page.getByText("orbit-api is available").waitFor();
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1500);
  await shot("launch-wizard");

  await page.goto(`${BASE}/services/quasar-api`, { waitUntil: "networkidle" });
  await sleep(3000);
  await shot("service-live");
  for (const [name, text] of [
    ["cloud-resources", "Cloud resources"],
    ["scorecard", "Scorecard"],
  ]) {
    const s = section(text);
    await settle(s);
    await shot(name, s);
  }

  await page.goto(`${BASE}/services/flare-api`, { waitUntil: "networkidle" });
  const explain = page.locator("section").filter({ has: page.getByText(/Explained by|Built-in rules/) }).first();
  await settle(explain);
  await sleep(1500);
  await shot("failure-explained", explain);

  await page.goto(`${BASE}/services`, { waitUntil: "networkidle" });
  await sleep(3000);
  await shot("catalog");

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
  await phone.goto(`${BASE}/services/quasar-api`, { waitUntil: "networkidle" });
  await sleep(3000);
  await phone.screenshot({ path: join(MEDIA, "phone.png") });

  await browser.close();
  console.log(`Screenshots in ${MEDIA}`);
}

// ---------------------------------------------------------------------------------------------
// Demo video

// A visible cursor (headless Chrome has none) with a ripple on click, and a corner badge.
const overlay = () => {
  const install = () => {
    if (document.getElementById("__cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "__cursor";
    cursor.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 8.5-6.6 1.6L9 19z" fill="#fff" stroke="#0b0b12" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, {
      position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
      transform: "translate(-100px,-100px)", filter: "drop-shadow(0 2px 6px rgba(0,0,0,.5))",
    });
    document.documentElement.appendChild(cursor);
    addEventListener("mousemove", (e) => (cursor.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`), true);
    addEventListener("mousedown", (e) => {
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "fixed", left: `${e.clientX - 18}px`, top: `${e.clientY - 18}px`, width: "36px", height: "36px",
        borderRadius: "50%", border: "2px solid rgba(167,139,250,.9)", zIndex: "2147483646", pointerEvents: "none",
        transition: "transform .45s ease-out, opacity .45s ease-out",
      });
      document.documentElement.appendChild(ring);
      requestAnimationFrame(() => Object.assign(ring.style, { transform: "scale(1.8)", opacity: "0" }));
      setTimeout(() => ring.remove(), 500);
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install);
  else install();
};

async function badge(page, text) {
  await page.evaluate((text) => {
    document.getElementById("__badge")?.remove();
    if (!text) return;
    const b = document.createElement("div");
    b.id = "__badge";
    b.textContent = text;
    Object.assign(b.style, {
      position: "fixed", right: "24px", bottom: "24px", zIndex: "2147483647", padding: "10px 16px",
      borderRadius: "999px", font: "600 14px Inter Variable, system-ui, sans-serif", color: "#f5f3ff",
      background: "rgba(124,92,255,.9)", boxShadow: "0 10px 40px -10px #7c5cff", pointerEvents: "none",
    });
    document.documentElement.appendChild(b);
  }, text);
}

async function demo(name) {
  const frames = mkdtempSync(join(tmpdir(), "launchbay-frames-"));
  const out = join(MEDIA, "demo");
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript(overlay);
  const page = await context.newPage();

  // Record every frame Chrome paints, with its timestamp.
  const cdp = await context.newCDPSession(page);
  const shots = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(frames, `${String(shots.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    shots.push({ file, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const marks = {};
  const mark = (key) => (marks[key] = Date.now() / 1000);

  // Smooth, human-paced mouse movement.
  let mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  const glide = async (locator, { click = true, pause = 350 } = {}) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const steps = Math.max(12, Math.round(Math.hypot(to.x - mouse.x, to.y - mouse.y) / 18));
    await page.mouse.move(to.x, to.y, { steps });
    mouse = to;
    await sleep(pause);
    if (click) await page.mouse.click(to.x, to.y);
  };
  const scrollTo = async (top, wait = 1400) => {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), top);
    await sleep(wait);
  };

  await page.goto(BASE, { waitUntil: "networkidle" });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  mark("start");
  try {
    await page.mouse.move(mouse.x, mouse.y);
    await sleep(4000);

    // Mission control: the platform at a glance.
    for (const top of [620, 1180, 2000, 2700]) await scrollTo(top, 2200);
    await scrollTo(0, 1200);

    // Launch a service.
    await glide(page.getByRole("navigation").getByRole("link", { name: "Launch" }));
    await sleep(1500);
    for (const t of ["Node API", "Static Site"]) await glide(page.getByRole("button", { name: new RegExp(t) }), { click: false, pause: 500 });
    await glide(page.getByRole("button", { name: /Python API/ }));
    await sleep(700);
    await glide(page.getByRole("button", { name: /Continue/ }));
    await sleep(900);
    const field = page.getByLabel("Service name");
    await glide(field);
    await field.pressSequentially(name, { delay: 90 });
    await page.getByText(`${name} is available`).waitFor();
    await sleep(600);
    const owner = page.getByLabel("Owner");
    await glide(owner);
    await owner.fill("");
    await owner.pressSequentially("team-platform", { delay: 45 });
    const description = page.getByLabel("Description");
    await glide(description);
    await description.pressSequentially("Catalogues new stars as the survey telescopes report them.", { delay: 22 });
    await glide(page.getByRole("checkbox", { name: /Object storage/ }));
    await glide(page.getByRole("checkbox", { name: /Message queue/ }));
    await sleep(800);
    await glide(page.getByRole("button", { name: /Continue/ }));
    await sleep(2500);
    await glide(page.getByRole("button", { name: `Launch ${name}` }));
    await page.waitForURL(new RegExp(`/services/${name}$`), { timeout: 30_000 });
    await sleep(4000);

    // The real launch: repo, Terraform, CI, GitOps, Argo CD. Minutes, so fast-forwarded.
    mark("fastStart");
    await badge(page, `▶▶ ${FAST}× speed`);
    const live = page.getByText(`${name} is live`);
    const failed = page.getByText("Launch failed");
    await live.or(failed).waitFor({ timeout: 15 * 60_000 });
    await badge(page, null);
    mark("fastEnd");
    await sleep(5000);

    // What it got: cloud resources and a scorecard.
    const cloud = page.locator("section").filter({ has: page.getByText("Cloud resources", { exact: true }) }).first();
    await glide(cloud, { click: false });
    await sleep(3500);
    const score = page.locator("section").filter({ has: page.getByText("Scorecard", { exact: true }) }).first();
    if (await score.count()) {
      await score.scrollIntoViewIfNeeded();
      await sleep(4500);
    }

    // A failed launch, explained: jump there with the command palette.
    await scrollTo(0, 800);
    await page.keyboard.press("Control+k");
    await sleep(600);
    await page.keyboard.type("flare", { delay: 110 });
    await sleep(700);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/services\/flare-api$/);
    await sleep(2500);
    const again = page.getByRole("button", { name: /Explain again/ });
    await glide(again);
    mark("thinkStart");
    await badge(page, "▶▶ 3× speed");
    await page.waitForResponse((r) => r.url().includes("/explain"), { timeout: 120_000 }).catch(() => {});
    await badge(page, null);
    mark("thinkEnd");
    await sleep(7000);

    await glide(page.getByRole("navigation").getByRole("link", { name: "Catalog" }));
    await sleep(4000);
  } finally {
    // Whatever happened after the launch, keep what was recorded.
    mark("end");
    await cdp.send("Page.stopScreencast").catch(() => {});
    await browser.close();
    console.log(`${shots.length} frames; marks:`, marks);
    if (marks.fastEnd) encode(shots, marks, out);
    rmSync(frames, { recursive: true, force: true });
  }
}

// Turns the variable-rate frames into a 30 fps MP4, fast-forwarding the waits, plus a short GIF.
function encode(shots, marks, out) {
  const speedAt = (t) =>
    t >= marks.fastStart && t < marks.fastEnd ? FAST : t >= marks.thinkStart && t < marks.thinkEnd ? 3 : 1;
  const list = [];
  let videoTime = 0;
  const gif = {};
  for (let i = 0; i < shots.length; i++) {
    const { file, t } = shots[i];
    const next = i + 1 < shots.length ? shots[i + 1].t : marks.end;
    const shown = Math.max(next - t, 0) / speedAt(t);
    if (gif.start === undefined && t >= marks.fastStart - 22) gif.start = videoTime;
    if (gif.end === undefined && t >= marks.fastEnd + 4) gif.end = videoTime;
    videoTime += shown;
    list.push(`file '${file.replace(/\\/g, "/")}'`, `duration ${shown.toFixed(4)}`);
  }
  list.push(`file '${shots.at(-1).file.replace(/\\/g, "/")}'`);
  const listFile = join(dirname(shots[0].file), "frames.txt");
  writeFileSync(listFile, list.join("\n"));

  const mp4 = join(out, "launchbay-demo.mp4");
  execFileSync(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-movflags", "+faststart", mp4,
  ]);
  console.log(`Video: ${mp4} (${videoTime.toFixed(1)}s)`);

  // The README GIF: from filling in the wizard to the service going live.
  const gifFile = join(out, "launch.gif");
  const span = ["-ss", gif.start.toFixed(2), "-t", (gif.end - gif.start).toFixed(2)];
  execFileSync(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error", ...span, "-i", mp4, "-vf",
    "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    gifFile,
  ]);
  console.log(`GIF: ${gifFile}`);
}

const [mode, arg] = process.argv.slice(2);
if (mode === "screenshots") await screenshots();
else if (mode === "demo") await demo(arg ?? "nova-api");
else {
  console.error("Usage: node scripts/capture.mjs screenshots | demo [service-name]");
  process.exit(1);
}
