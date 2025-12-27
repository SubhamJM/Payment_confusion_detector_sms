/**
 * THE CLARITY GUARDIAN - Core Logic
 * Track 5: Payment Confusion Detector
 */

// --- GLOBAL STATE & CONFIGURATION ---
let isCalibrated = false;
let isPaused = false;
let calibrationPoints = {};
const CLICKS_PER_POINT = 5; //

// Phase 2: Metrics Tracking State
let zoneMetrics = {
    'zone-shipping': { dwellTime: 0, revisits: 0, lastEntry: null, isInside: false },
    'zone-payment': { dwellTime: 0, revisits: 0, lastEntry: null, isInside: false },
    'zone-items': { dwellTime: 0, revisits: 0, lastEntry: null, isInside: false },
    'zone-summary': { dwellTime: 0, revisits: 0, lastEntry: null, isInside: false }
};

window.onload = async function () {
    try {
        // Phase 1: Initialize Eye Tracker
        await webgazer.setGazeListener(function (data, elapsedTime) {
            if (data == null || !isCalibrated || isPaused) return;

            // Phase 1.3: Continuous gaze stream
            // Feed coordinates into Phase 2 Algorithm
            checkConfusionZones(data.x, data.y);
        }).begin();

        // Phase 1.1: Accuracy Enhancement
        // Enable Kalman filter for smoother tracking
        webgazer.applyKalmanFilter(true);

        // Phase 4: Privacy Transparency
        // Show video preview to confirm local processing
        webgazer.showVideoPreview(true).showPredictionPoints(true);

        // Reposition WebGaze video feed to not block checkout
        const videoContainer = document.getElementById('webgazeVideoContainer');
        if (videoContainer) {
            videoContainer.style.top = '80px';
            videoContainer.style.left = '20px';
        }

    } catch (err) {
        console.error("WebGazer failed to initialize:", err);
    }
};

// --- PHASE 1.2: CALIBRATION LOGIC ---
function startCalibration() {
    document.getElementById('intro-screen').classList.add('hidden');
    document.getElementById('dots-container').classList.remove('hidden');

    const dots = document.querySelectorAll('.calib-point');

    dots.forEach(dot => {
        const dotId = dot.style.top + "-" + dot.style.left;
        calibrationPoints[dotId] = 0;

        dot.addEventListener('click', () => {
            calibrationPoints[dotId]++;

            // Visual feedback: change opacity as it learns dot position
            dot.style.opacity = 1 - (calibrationPoints[dotId] * 0.15);

            if (calibrationPoints[dotId] >= CLICKS_PER_POINT) {
                dot.classList.add('pointer-events-none');
                dot.style.backgroundColor = "#22c55e"; // Green when trained
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
        document.getElementById('calibration-overlay').classList.add('hidden');

        // Phase 4 Indicator: Visual cue for active tracking
        const statusDot = document.getElementById('status-dot');
        statusDot.style.backgroundColor = "green";
        document.querySelector('#tracking-status span').innerText = "TRACKING ACTIVE";

        alert("Calibration Complete! The Clarity Guardian is monitoring for confusion.");
    }
}

// --- PHASE 2: THE CONFUSION ALGORITHM ---
function checkConfusionZones(x, y) {
    const now = Date.now();

    for (let zoneId in zoneMetrics) {
        const zone = zoneMetrics[zoneId];
        const element = document.getElementById(zoneId);
        if (!element) continue;

        const rect = element.getBoundingClientRect();

        // Map UI regions
        const isCurrentlyLooking = (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);

        if (isCurrentlyLooking) {
            if (!zone.isInside) {
                // Phase 2.2: Revisit Count
                zone.isInside = true;
                zone.revisits++;
                zone.lastEntry = now;
            } else {
                // Phase 2.2: Dwell Time
                const timeSpent = (now - zone.lastEntry) / 1000;
                zone.dwellTime += timeSpent;
                zone.lastEntry = now;
            }

            // Phase 2.3: Threshold Check
            // Flag as "Confusion Hotspot" if dwell > 5s AND revisits > 3
            if (zone.dwellTime > 5 && zone.revisits > 3) {
                triggerSmartResponse(zoneId);
            }
        } else {
            zone.isInside = false;
        }
    }
}

// --- PHASE 3: THE SMART RESPONSE ---
function triggerSmartResponse(zoneId) {
    const element = document.getElementById(zoneId);
    const helpMsg = document.getElementById('intervention-msg');

    // Phase 3.1: Visual Cues (Pulse yellow border)
    if (!element.classList.contains('confusion-highlight')) {
        element.classList.add('confusion-highlight');
        console.log(`Confusion Hotspot detected in ${zoneId}!`);
    }

    // Phase 3.2: Progressive Disclosure
    if (helpMsg) {
        helpMsg.classList.remove('hidden');
    }
}

// --- PHASE 4: PRIVACY & TRANSPARENCY ---
function acceptPrivacy() {
    document.getElementById('privacy-modal').classList.add('hidden');
    startCalibration();
}

function toggleTracking() {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.querySelector('#tracking-status span');

    if (isPaused) {
        webgazer.resume();
        statusDot.style.backgroundColor = "green";
        statusText.innerText = "TRACKING ACTIVE";
        isPaused = false;
    } else {
        webgazer.pause();
        statusDot.style.backgroundColor = "gray";
        statusText.innerText = "TRACKING PAUSED";
        isPaused = true;
    }
}

// Privacy Indicator click-to-pause
document.getElementById('tracking-status').addEventListener('click', toggleTracking);
