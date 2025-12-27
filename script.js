/**
 * THE CLARITY GUARDIAN - GEMINI API INTEGRATED
 * Features: 
 * 1. Persistent Circular Launcher & 15s "Confusion" Tooltip.
 * 2. Expanded Chat Window (384px x 500px).
 * 3. Google Gemini API integration with "..." loading indicator.
 */

// --- GLOBAL STATE ---
let isCalibrated = false;
let isPaused = false;
let calibrationPoints = {};
const CLICKS_PER_POINT = 5;

// Gemini Configuration
const GEMINI_API_KEY = "AIzaSyBti21jpFtvVRECm6WJTgU3nezO1C8cioI";
const GEMINI_MODEL = "gemini-2.5-flash-lite";

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
  "zone-shipping": { dwellTime: 0, revisits: 0, lastEntry: null, isInside: false },
  "zone-payment": { dwellTime: 0, revisits: 0, lastEntry: null, isInside: false },
  "zone-items": { dwellTime: 0, revisits: 0, lastEntry: null, isInside: false },
  "zone-summary": { dwellTime: 0, revisits: 0, lastEntry: null, isInside: false },
};

// --- CORE INITIALIZATION ---
async function initEyeTracker() {
  try {
    await webgazer
      .setGazeListener(function (data, elapsedTime) {
        if (data == null || !isCalibrated || isPaused) return;

        const hpfMovement = applyHighPassFilter(data.x, data.y);
        const saccadeStrength = Math.sqrt(hpfMovement.x ** 2 + hpfMovement.y ** 2);
        const stableGaze = getStabilizedGaze(data.x, data.y);

        checkConfusionZones(stableGaze.x, stableGaze.y, saccadeStrength);
      })
      .begin();

    webgazer.applyKalmanFilter(true);
    webgazer.showVideoPreview(false).showPredictionPoints(true);

    window.addEventListener("click", (e) => {
      if (isCalibrated) webgazer.recordScreenPosition(e.clientX, e.clientY, "click");
    });
  } catch (err) {
    console.error("WebGazer failed:", err);
  }
}

// --- FILTERS & STABILIZATION ---
function applyHighPassFilter(currentX, currentY) {
  highPassGaze.x = HPF_ALPHA * (highPassGaze.x + currentX - lastRawGaze.x);
  highPassGaze.y = HPF_ALPHA * (highPassGaze.y + currentY - lastRawGaze.y);
  lastRawGaze.x = currentX; lastRawGaze.y = currentY;
  return { x: highPassGaze.x, y: highPassGaze.y };
}

function getStabilizedGaze(x, y) {
  gazeBufferX.push(x); gazeBufferY.push(y);
  if (gazeBufferX.length > SMOOTHING_BUFFER_SIZE) { gazeBufferX.shift(); gazeBufferY.shift(); }
  const avgX = gazeBufferX.reduce((a, b) => a + b, 0) / gazeBufferX.length;
  const avgY = gazeBufferY.reduce((a, b) => a + b, 0) / gazeBufferY.length;
  return { x: avgX, y: avgY };
}

// --- CALIBRATION & UI START ---
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
  for (let key in calibrationPoints) { if (calibrationPoints[key] >= CLICKS_PER_POINT) completedPoints++; }
  if (completedPoints === totalPoints) {
    isCalibrated = true;
    document.getElementById("calibration-overlay").classList.add("hidden");
    document.getElementById("status-dot").style.backgroundColor = "green";
    document.querySelector("#tracking-status span").innerText = "TRACKING ACTIVE";
    createPersistentChatLauncher();
  }
}

// --- CONFUSION LOGIC ---
function checkConfusionZones(x, y, saccadeStrength) {
  const now = Date.now();
  if (saccadeStrength > 15) totalSaccadeDistance += saccadeStrength;

  for (let zoneId in zoneMetrics) {
    const zone = zoneMetrics[zoneId];
    const element = document.getElementById(zoneId);
    if (!element) continue;

    const rect = element.getBoundingClientRect();
    const isLooking = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

    if (isLooking) {
      if (!zone.isInside) {
        zone.isInside = true;
        zone.revisits++;
        zone.lastEntry = now;
      } else {
        zone.dwellTime += (now - zone.lastEntry) / 1000;
        zone.lastEntry = now;
      }

      if (zone.dwellTime > 5 && (zone.revisits > 3 || totalSaccadeDistance > 6000)) {
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
  element.classList.add("confusion-highlight");
  showCustomPopup(zoneId, element);

  const sustainedTime = (Date.now() - interventionStartTime) / 1000;
  if (sustainedTime > 15 && !chatEscalationDismissed) {
    showLauncherTooltip();
  }
}

function showCustomPopup(zoneId, anchorElement) {
  if (document.querySelector(`.custom-popup[data-zone="${zoneId}"]`)) return;

  const popups = {
    "zone-shipping": {
      title: "Need help with delivery?",
      body: "Pick where you want your order sent. You can choose your saved Home or Office address. Don't worry, shipping is currently free!",
      color: "blue",
      align: "side"
    },
    "zone-payment": {
      title: "Is your payment secure?",
      body: "Yes! Your details are fully encrypted. Just select your preferred card or use Apple Pay to continue safely.",
      color: "indigo",
      align: "side"
    },
    "zone-summary": {
      title: "Understanding the Total",
      body: "The total includes the item price plus small fees for high-demand delivery and environmental offsets. We keep these transparent so there are no surprises.",
      color: "emerald",
      align: "bottom"
    },
    "zone-items": {
      title: "Reviewing your cart?",
      body: "You are purchasing 'The Clarity Guardian Pro'. It's currently in stock and will be ready to ship as soon as you finish.",
      color: "amber",
      align: "side"
    },
  };

  const content = popups[zoneId];
  const popup = document.createElement("div");

  // Use a slightly wider container (w-72) for the descriptive text
  popup.className = `custom-popup absolute z-[100] bg-white border-l-4 border-${content.color}-500 p-5 shadow-2xl rounded-xl w-72 text-left`;
  popup.setAttribute("data-zone", zoneId);

  if (content.align === "bottom") {
    popup.style.top = "100%";
    popup.style.left = "0px";
    popup.style.marginTop = "15px";
  } else {
    popup.style.top = "0px";
    popup.style.right = "-300px";
  }

  popup.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="mt-1">
        <svg class="w-4 h-4 text-${content.color}-600" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
        </svg>
      </div>
      <div>
        <h4 class="text-sm font-bold text-gray-900 mb-1">${content.title}</h4>
        <p class="text-xs text-gray-600 leading-relaxed">${content.body}</p>
        <button onclick="dismissPopup('${zoneId}', this.parentElement.parentElement.parentElement)" class="mt-3 text-[10px] font-bold text-${content.color}-600 uppercase tracking-wider hover:text-${content.color}-800">
          Got it, thanks!
        </button>
      </div>
    </div>
  `;

  anchorElement.style.position = "relative";
  anchorElement.appendChild(popup);
}

function dismissPopup(zoneId, popupElement) {
  dismissedPopups.add(zoneId);
  const zoneElement = document.getElementById(zoneId);
  if (zoneElement) zoneElement.classList.remove("confusion-highlight");
  popupElement.remove();
}

// --- CHATBOT UI & GEMINI API ---

function createPersistentChatLauncher() {
  if (document.getElementById("chat-launcher")) return;
  const launcher = document.createElement("button");
  launcher.id = "chat-launcher";
  launcher.className = "fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-2xl z-[10002] flex items-center justify-center hover:bg-indigo-700 transition-all transform hover:scale-110 active:scale-95";
  launcher.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>`;
  launcher.onclick = toggleChatWindow;
  document.body.appendChild(launcher);
}

function showLauncherTooltip() {
  if (document.getElementById("launcher-tooltip") || document.getElementById("puter-chat-window")) return;
  const tooltip = document.createElement("div");
  tooltip.id = "launcher-tooltip";
  tooltip.className = "fixed bottom-24 right-6 bg-white text-indigo-900 border-2 border-indigo-600 px-4 py-2 rounded-xl shadow-xl z-[10003] font-bold text-xs animate-bounce cursor-pointer";
  tooltip.innerText = "Click here for customer support 🤝";
  tooltip.onclick = toggleChatWindow;
  document.body.appendChild(tooltip);
}

function toggleChatWindow() {
  const existingChat = document.getElementById("puter-chat-window");
  const tooltip = document.getElementById("launcher-tooltip");
  if (tooltip) tooltip.remove();
  if (existingChat) { existingChat.remove(); } else { initChat(); }
}

async function initChat() {
  const chatWindow = document.createElement("div");
  chatWindow.id = "puter-chat-window";
  chatWindow.className = "fixed bottom-24 right-6 w-96 h-[500px] bg-white rounded-2xl shadow-2xl border border-slate-200 z-[10001] flex flex-col overflow-hidden font-sans animate-fade-in";
  chatWindow.innerHTML = `
        <div class="bg-indigo-600 p-5 text-white flex justify-between items-center">
            <div class="flex items-center gap-3">
                <div class="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></div>
                <span class="text-sm font-bold uppercase tracking-widest">Financial Guru</span>
            </div>
            <button onclick="toggleChatWindow()" class="text-white hover:text-indigo-200 text-xl font-light">✕</button>
        </div>
        <div id="chat-messages" class="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50 text-xs">
            <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm max-w-[85%]">
                Hello, Financial Guru Here 😄!! I noticed you might need some help. How can I help you?
            </div>
        </div>
        <div class="p-4 bg-white border-t flex gap-2">
            <input type="text" id="chat-input" placeholder="Type your message..." class="flex-1 text-sm border border-slate-200 rounded-xl px-4 py-2 outline-none focus:border-indigo-500 transition-all">
            <button id="send-btn" class="bg-indigo-600 text-white px-5 py-2 rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all">Send</button>
        </div>
    `;
  document.body.appendChild(chatWindow);

  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const msgContainer = document.getElementById("chat-messages");

  const sendMessage = async () => {
    const userText = input.value.trim();
    if (!userText) return;

    // 1. Display User Message
    msgContainer.innerHTML += `<div class="bg-indigo-600 text-white p-3 rounded-2xl self-end ml-auto max-w-[85%] shadow-sm">${userText}</div>`;
    input.value = "";

    // 2. Create and Display Loading Indicator
    const loadingId = "ai-loading-" + Date.now();
    msgContainer.innerHTML += `<div id="${loadingId}" class="bg-white p-3 rounded-2xl border border-slate-200 mr-auto max-w-[85%] shadow-sm italic text-gray-400">...</div>`;
    msgContainer.scrollTop = msgContainer.scrollHeight;

    try {
      // 3. Prepare Gemini API Request
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

      const payload = {
        contents: [{
          parts: [{
            text: `System: Support for "FinnovateMarket". Context: Checkout for Clarity Guardian Pro ($89.99). Fees: Surge ($4.50), Compliance ($3.86), Carbon Offset ($0.75). User Message: ${userText}`
          }]
        }]
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      // 4. Handle Response and Update UI
      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) {
        if (data.candidates && data.candidates[0].content.parts[0].text) {
          loadingEl.innerText = data.candidates[0].content.parts[0].text;
          loadingEl.classList.remove("italic", "text-gray-400");
          loadingEl.classList.add("text-slate-900");
        } else {
          throw new Error("Invalid response format");
        }
      }
    } catch (err) {
      console.error("Gemini API Error:", err);
      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) loadingEl.innerText = "Error: Could not connect to assistant.";
    }
    msgContainer.scrollTop = msgContainer.scrollHeight;
  };

  sendBtn.onclick = sendMessage;
  input.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };
  input.focus();
}

// --- PRIVACY & CONSENT ---
function declinePrivacy() {
  document.getElementById("privacy-modal").classList.add("hidden");
  document.getElementById("calibration-overlay").classList.add("hidden");
  createPersistentChatLauncher();
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

document.getElementById("tracking-status").addEventListener("click", toggleTracking);