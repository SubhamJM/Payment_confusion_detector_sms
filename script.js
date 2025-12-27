/**
 * THE CLARITY GUARDIAN - CONSENT OPTIMIZED
 * 1. Eye-capture initializes ONLY after explicit consent.
 * 2. Amount display popup appears below the box.
 * 3. Escalation chat is smaller and static (no bounce).
 */

// --- GLOBAL STATE ---
let isCalibrated = false;
let isPaused = false;
let calibrationPoints = {};
const CLICKS_PER_POINT = 5;

// Stabilization & Filter State
let lastRawGaze = { x: 0, y: 0 };
let highPassGaze = { x: 0, y: 0 };
const HPF_ALPHA = 0.8;
const SMOOTHING_BUFFER_SIZE = 10;
let gazeBufferX = [];
let gazeBufferY = [];

let totalSaccadeDistance = 0;
let interventionStartTime = null;
const dismissedPopups = new Set();
let chatEscalationDismissed = false;

let zoneMetrics = {
  "zone-shipping": {
    dwellTime: 0,
    revisits: 0,
    lastEntry: null,
    isInside: false,
  },
  "zone-payment": {
    dwellTime: 0,
    revisits: 0,
    lastEntry: null,
    isInside: false,
  },
  "zone-items": { dwellTime: 0, revisits: 0, lastEntry: null, isInside: false },
  "zone-summary": {
    dwellTime: 0,
    revisits: 0,
    lastEntry: null,
    isInside: false,
  },
};

// --- CORE INITIALIZATION (CONSENT-BASED) ---
async function initEyeTracker() {
  try {
    await webgazer
      .setGazeListener(function (data, elapsedTime) {
        if (data == null || !isCalibrated || isPaused) return;

        const hpfMovement = applyHighPassFilter(data.x, data.y);
        const saccadeStrength = Math.sqrt(
          hpfMovement.x ** 2 + hpfMovement.y ** 2
        );
        const stableGaze = getStabilizedGaze(data.x, data.y);

        checkConfusionZones(stableGaze.x, stableGaze.y, saccadeStrength);
      })
      .begin();

    webgazer.applyKalmanFilter(true);
    webgazer.showVideoPreview(false).showPredictionPoints(true);

    window.addEventListener("click", (e) => {
      if (isCalibrated)
        webgazer.recordScreenPosition(e.clientX, e.clientY, "click");
    });
  } catch (err) {
    console.error("WebGazer failed to initialize:", err);
  }
}

// --- FILTERS & STABILIZATION ---
function applyHighPassFilter(currentX, currentY) {
  highPassGaze.x = HPF_ALPHA * (highPassGaze.x + currentX - lastRawGaze.x);
  highPassGaze.y = HPF_ALPHA * (highPassGaze.y + currentY - lastRawGaze.y);
  lastRawGaze.x = currentX;
  lastRawGaze.y = currentY;
  return { x: highPassGaze.x, y: highPassGaze.y };
}

function getStabilizedGaze(x, y) {
  gazeBufferX.push(x);
  gazeBufferY.push(y);
  if (gazeBufferX.length > SMOOTHING_BUFFER_SIZE) {
    gazeBufferX.shift();
    gazeBufferY.shift();
  }
  const avgX = gazeBufferX.reduce((a, b) => a + b, 0) / gazeBufferX.length;
  const avgY = gazeBufferY.reduce((a, b) => a + b, 0) / gazeBufferY.length;
  return { x: avgX, y: avgY };
}

// --- CALIBRATION ---
function startCalibration() {
  document.getElementById("intro-screen").classList.add("hidden");
  document.getElementById("dots-container").classList.remove("hidden");

  const dots = document.querySelectorAll(".calib-point");
  dots.forEach((dot) => {
    const dotId = dot.style.top + "-" + dot.style.left;
    calibrationPoints[dotId] = 0;

    dot.addEventListener("click", (e) => {
      calibrationPoints[dotId]++;
      dot.style.opacity = 1 - calibrationPoints[dotId] * 0.15;
      webgazer.recordScreenPosition(e.clientX, e.clientY, "click");

      if (calibrationPoints[dotId] >= CLICKS_PER_POINT) {
        dot.classList.add("pointer-events-none");
        dot.style.backgroundColor = "#22c55e";
        checkCalibrationStatus();
      }
    });
  });
}

function checkCalibrationStatus() {
  const totalPoints = Object.keys(calibrationPoints).length;
  let completedPoints = 0;
  for (let key in calibrationPoints) {
    if (calibrationPoints[key] >= CLICKS_PER_POINT) completedPoints++;
  }

  if (completedPoints === totalPoints) {
    isCalibrated = true;
    document.getElementById("calibration-overlay").classList.add("hidden");
    document.getElementById("status-dot").style.backgroundColor = "green";
    document.querySelector("#tracking-status span").innerText =
      "TRACKING ACTIVE";
  }
}

// --- CONFUSION LOGIC & POPUPS ---
function checkConfusionZones(x, y, saccadeStrength) {
  const now = Date.now();
  if (saccadeStrength > 15) totalSaccadeDistance += saccadeStrength;

  for (let zoneId in zoneMetrics) {
    const zone = zoneMetrics[zoneId];
    const element = document.getElementById(zoneId);
    if (!element) continue;

    const rect = element.getBoundingClientRect();
    const isLooking =
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

    if (isLooking) {
      if (!zone.isInside) {
        zone.isInside = true;
        zone.revisits++;
        zone.lastEntry = now;
      } else {
        zone.dwellTime += (now - zone.lastEntry) / 1000;
        zone.lastEntry = now;
      }

      if (
        zone.dwellTime > 5 &&
        (zone.revisits > 3 || totalSaccadeDistance > 6000)
      ) {
        triggerSmartResponse(zoneId);
      }
    } else {
      zone.isInside = false;
    }
  }
}

function triggerSmartResponse(zoneId) {
  if (dismissedPopups.has(zoneId)) return;

  const element = document.getElementById(zoneId);
  if (!element) return;

  if (!interventionStartTime) interventionStartTime = Date.now();

  // Highlight the container (Yellow state)
  element.classList.add("confusion-highlight");

  showCustomPopup(zoneId, element);

  const sustainedTime = (Date.now() - interventionStartTime) / 1000;
  if (sustainedTime > 15 && !chatEscalationDismissed) showChatEscalation();
}

function showCustomPopup(zoneId, anchorElement) {
  if (document.querySelector(`.custom-popup[data-zone="${zoneId}"]`)) return;

  const popups = {
    "zone-shipping": {
      title: "Shipping Hubs",
      body: "Check your saved addresses for express delivery.",
      color: "blue",
      align: "side",
    },
    "zone-payment": {
      title: "Payment Safety",
      body: "Encrypted via Clarity Guardian.",
      color: "indigo",
      align: "side",
    },
    "zone-summary": {
      title: "Pricing Detail",
      body: "Includes carbon offsets and surge fees.",
      color: "emerald",
      align: "bottom",
    },
    "zone-items": {
      title: "Inventory",
      body: "Item ready for immediate dispatch.",
      color: "amber",
      align: "side",
    },
  };

  const content = popups[zoneId];
  const popup = document.createElement("div");
  popup.className = `custom-popup absolute z-[100] bg-white border-l-4 border-${content.color}-500 p-4 shadow-2xl rounded-r-xl w-64 text-left`;
  popup.setAttribute("data-zone", zoneId);

  if (content.align === "bottom") {
    popup.style.top = "100%";
    popup.style.left = "0px";
    popup.style.marginTop = "10px";
  } else {
    popup.style.top = "10px";
    popup.style.right = "-270px";
  }

  popup.innerHTML = `
        <h4 class="text-xs font-bold text-gray-900 uppercase mb-1">${content.title}</h4>
        <p class="text-[10px] text-gray-600 leading-relaxed">${content.body}</p>
        <button onclick="dismissPopup('${zoneId}', this.parentElement)" class="mt-2 text-[9px] font-bold text-${content.color}-600 uppercase tracking-widest hover:underline">Dismiss</button>
    `;

  anchorElement.style.position = "relative";
  anchorElement.appendChild(popup);
}

/**
 * UPDATED: Returns the box to its previous state (white) when dismissed.
 */
function dismissPopup(zoneId, popupElement) {
  dismissedPopups.add(zoneId); // Never show again

  // Find the parent container that was highlighted
  const zoneElement = document.getElementById(zoneId);
  if (zoneElement) {
    // Remove the yellow highlight class so it returns to white
    zoneElement.classList.remove("confusion-highlight");
  }

  popupElement.remove(); // Remove the actual popup box
}

function showChatEscalation() {
  if (document.getElementById("chat-offer") || chatEscalationDismissed) return;
  const chatDiv = document.createElement("div");
  chatDiv.id = "chat-offer";
  chatDiv.className =
    "fixed bottom-6 right-6 bg-white p-4 rounded-2xl shadow-2xl border-2 border-indigo-600 z-50 max-w-[210px]";
  chatDiv.innerHTML = `
        <p class="text-[11px] font-bold mb-1">Still reviewing? 🤝</p>
        <p class="text-[9px] text-gray-500 mb-3 leading-tight">Our assistant is online for walkthroughs.</p>
        <button onclick="dismissChat(this.parentElement)" class="bg-indigo-600 text-white px-3 py-2 rounded-lg text-[9px] font-bold w-full hover:bg-indigo-700">Connect to Expert</button>
    `;
  document.body.appendChild(chatDiv);
}

function dismissChat(element) {
  chatEscalationDismissed = true;
  element.remove();
}

// --- PRIVACY & CONSENT ---
function declinePrivacy() {
  document.getElementById("privacy-modal").classList.add("hidden");
  document.getElementById("calibration-overlay").classList.add("hidden");
  const statusDot = document.getElementById("status-dot");
  const statusSpan = document.querySelector("#tracking-status span");
  if (statusDot) statusDot.style.backgroundColor = "red";
  if (statusSpan) statusSpan.innerText = "EYE-TRACKING INACTIVE";
  isCalibrated = false;
}

function acceptPrivacy() {
  document.getElementById("privacy-modal").classList.add("hidden");
  initEyeTracker();
  startCalibration();
}

function toggleTracking() {
  if (!isCalibrated) return;
  const statusDot = document.getElementById("status-dot");
  if (isPaused) {
    webgazer.resume();
    statusDot.style.backgroundColor = "green";
    isPaused = false;
  } else {
    webgazer.pause();
    statusDot.style.backgroundColor = "gray";
    isPaused = true;
  }
}

document
  .getElementById("tracking-status")
  .addEventListener("click", toggleTracking);
