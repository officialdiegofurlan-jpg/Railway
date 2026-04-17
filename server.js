const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || null; // Optional: set to protect endpoint

// ── Middleware: optional API key auth ─────────────────────────────────────────
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const key = req.headers["x-api-key"] || req.query.apiKey;
  if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", service: "therapyportal-scraper" }));

// ── Main endpoint ─────────────────────────────────────────────────────────────
// POST /availability
// Body:
//   portalUrl  - full availability URL (required)
//   startDate  - "M/d/yyyy" format, defaults to today
//   clinician  - clinician ID, defaults to -1 (any)
//   appointmentType - 0=therapy intake, 1=therapy session, 2=psych intake, 3=psych session, defaults to 0
//   isExistingPatient - true/false, defaults to false
//   location   - location ID, defaults to -1 (any)
//   weeks      - number of weeks to fetch, defaults to 1 (max 4)
app.post("/availability", async (req, res) => {
  const {
    portalUrl,
    startDate,
    clinician = -1,
    appointmentType = 0,
    isExistingPatient = false,
    location = -1,
    weeks = 1,
  } = req.body;

  if (!portalUrl) {
    return res.status(400).json({ error: "portalUrl is required" });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // Capture the loadavailability response
    let availabilityData = null;
    let setupData = null;

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("loadsetup")) {
        try {
          const body = await response.text();
          setupData = JSON.parse(body);
        } catch (_) {}
      }
      if (url.includes("loadavailability")) {
        try {
          const body = await response.text();
          availabilityData = JSON.parse(body);
        } catch (_) {}
      }
    });

    // Navigate to the portal page — this establishes the session
    console.log(`Loading portal: ${portalUrl}`);
    await page.goto(portalUrl, { waitUntil: "networkidle", timeout: 30000 });

    // Wait for setup to load (the availability checker auto-fires on load)
    await page.waitForTimeout(3000);

    if (!setupData) {
      return res.status(502).json({
        error: "Could not load practice setup data. Portal may be unavailable.",
      });
    }

    // Now trigger availability load by injecting the AJAX call
    // We use the page's own JS context so the session is fully established
    const today = startDate || new Date().toLocaleDateString("en-US");

    const slots = await page.evaluate(
      async ({ clinician, appointmentType, isExistingPatient, location, startDate }) => {
        return new Promise((resolve, reject) => {
          const endDate = (() => {
            const d = new Date(startDate);
            d.setDate(d.getDate() + 6);
            return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
          })();

          const msg = new TherapyNotes.Util.Ajax.Message(
            "/portal/practice/appointments/availability/loadavailability.aspx"
          );
          msg.AddPostDataKey("clinician", clinician);
          msg.AddPostDataKey("appointmentType", appointmentType);
          msg.AddPostDataKey("isExistingPatient", isExistingPatient);
          msg.AddPostDataKey("location", location);
          msg.AddPostDataKey("startDate", startDate);
          msg.AddPostDataKey("endDate", endDate);
          msg.AddOnCompletedEvent((m) => {
            try {
              resolve(JSON.parse(m.responseText));
            } catch (e) {
              reject("Failed to parse response: " + m.responseText);
            }
          });
          msg.AddOnErrorEvent((m) => {
            reject("AJAX error: status " + m.responseStatus);
          });
          ajaxConnection.AddToQueue(msg);
        });
      },
      { clinician, appointmentType, isExistingPatient, location, startDate: today }
    );

    // Normalize slots into a clean format
    const available = (slots.AvailableTimeSlots || []).map((slot) => ({
      startTime: slot.StartDate,
      clinicianId: slot.ClinicianID || null,
      locationId: slot.LocationID || null,
    }));

    return res.json({
      success: true,
      practiceInfo: {
        clinicians: (setupData.Clinicians || []).map((c) => ({
          id: c.ID,
          name: c.DisplayName,
          title: c.DisplayTitle,
        })),
        locations: (setupData.Locations || []).map((l) => ({
          id: l.ID,
          name: l.Name,
        })),
      },
      query: { startDate: today, clinician, appointmentType, isExistingPatient, location },
      displayStartDate: slots.DisplayStartDate,
      displayEndDate: slots.DisplayEndDate,
      timeZone: slots.TimeZoneAbbreviation,
      totalSlots: available.length,
      slots: available,
      rawSetup: setupData,
      rawAvailability: slots,
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  } finally {
    if (browser) await browser.close();
  }
});

// ── Setup endpoint (practice info only, no availability) ─────────────────────
app.post("/setup", async (req, res) => {
  const { portalUrl } = req.body;
  if (!portalUrl) return res.status(400).json({ error: "portalUrl is required" });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    let setupData = null;
    page.on("response", async (response) => {
      if (response.url().includes("loadsetup")) {
        try {
          setupData = JSON.parse(await response.text());
        } catch (_) {}
      }
    });

    await page.goto(portalUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    if (!setupData) return res.status(502).json({ error: "Could not load setup data" });

    return res.json({
      clinicians: (setupData.Clinicians || []).map((c) => ({
        id: c.ID,
        name: c.DisplayName,
        title: c.DisplayTitle,
        isPsychotherapy: c.IsPsychotherapy,
        isPsychiatry: c.IsPsychiatry,
      })),
      locations: (setupData.Locations || []).map((l) => ({ id: l.ID, name: l.Name })),
      appointmentTypes: setupData.AppointmentTypes || [],
      isTelehealthEnabled: setupData.IsTelehealthEnabled,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`TherapyPortal scraper running on port ${PORT}`);
  if (API_KEY) console.log("API key auth enabled");
});
