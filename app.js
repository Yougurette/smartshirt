const state = {
  connected: false,
  serialPort: null,
  reader: null,
  mockTimer: null,
  latest: null,
  calibration: {
    standing: null,
    prone: null,
  },
  optimum: {
    frontal: null,
    side: null,
  },
  captureBuffer: {
    frontal: [],
    side: [],
  },
  activeWorkout: null,
};

const els = {
  connectSerial: document.getElementById("connect-serial"),
  toggleMock: document.getElementById("toggle-mock"),
  connectionStatus: document.getElementById("connection-status"),
  calStand: document.getElementById("cal-stand"),
  calProne: document.getElementById("cal-prone"),
  calibrationStatus: document.getElementById("calibration-status"),
  optimumStatus: document.getElementById("optimum-status"),
  liveData: document.getElementById("live-data"),
  hintText: document.getElementById("hint-text"),
  qualityText: document.getElementById("quality-text"),
  illustration: document.getElementById("illustration"),
  stopWorkout: document.getElementById("stop-workout"),
};

document.querySelectorAll("[data-capture]").forEach((btn) => {
  btn.addEventListener("click", () => saveOptimum(btn.dataset.capture));
});

document.querySelectorAll("[data-workout]").forEach((btn) => {
  btn.addEventListener("click", () => startWorkout(btn.dataset.workout));
});

els.connectSerial.addEventListener("click", connectSerial);
els.toggleMock.addEventListener("click", toggleMockData);
els.calStand.addEventListener("click", () => saveCalibration("standing"));
els.calProne.addEventListener("click", () => saveCalibration("prone"));
els.stopWorkout.addEventListener("click", stopWorkout);

function parseLine(line) {
  // Erwartetes Format: L:1234,R:1678,AX:12,AY:3,AZ:16384,GX:2,GY:-4,GZ:11
  const out = {};
  line.split(",").forEach((pair) => {
    const [k, v] = pair.split(":");
    if (k && v) out[k.trim().toLowerCase()] = Number(v.trim());
  });

  if (
    Number.isFinite(out.l) &&
    Number.isFinite(out.r) &&
    Number.isFinite(out.ax) &&
    Number.isFinite(out.ay) &&
    Number.isFinite(out.az)
  ) {
    return {
      leftFlex: out.l,
      rightFlex: out.r,
      ax: out.ax,
      ay: out.ay,
      az: out.az,
      gx: out.gx ?? 0,
      gy: out.gy ?? 0,
      gz: out.gz ?? 0,
      ts: Date.now(),
    };
  }

  return null;
}

function handleSample(sample) {
  state.latest = sample;
  els.liveData.textContent = JSON.stringify(sample, null, 2);

  if (state.activeWorkout) {
    state.captureBuffer[state.activeWorkout].push(sample);
    if (state.captureBuffer[state.activeWorkout].length > 120) {
      state.captureBuffer[state.activeWorkout].shift();
    }
    updateFeedback();
  }
}

function saveCalibration(mode) {
  if (!state.latest) return;
  state.calibration[mode] = state.latest;

  const standingOk = !!state.calibration.standing;
  const proneOk = !!state.calibration.prone;

  if (standingOk && proneOk) {
    els.calibrationStatus.textContent = "Kalibrierung abgeschlossen ✅";
  } else {
    els.calibrationStatus.textContent = "Kalibrierung teilweise gespeichert ...";
  }
}

function saveOptimum(exercise) {
  const data = state.captureBuffer[exercise];
  if (!data.length) {
    els.optimumStatus.textContent = `Für ${exercise} noch keine Bewegungsdaten vorhanden.`;
    return;
  }

  state.optimum[exercise] = summarize(data);
  localStorage.setItem("smartshirt.optimum", JSON.stringify(state.optimum));
  els.optimumStatus.textContent = `Optimum für ${exercise} gespeichert ✅`;
}

function startWorkout(exercise) {
  if (!state.optimum[exercise]) {
    els.hintText.textContent = "Erst Optimum aufnehmen, dann Workout starten.";
    return;
  }

  state.activeWorkout = exercise;
  state.captureBuffer[exercise] = [];
  els.illustration.textContent =
    exercise === "frontal"
      ? "🧍 Frontal Raise: beide Arme kontrolliert nach oben führen"
      : "🤸 Side-to-side: in Bauchlage gleichmäßig links/rechts bewegen";
  els.hintText.textContent = "Workout läuft ...";
  els.qualityText.textContent = "Ich beobachte deine Symmetrie.";
}

function stopWorkout() {
  state.activeWorkout = null;
  els.hintText.textContent = "Workout gestoppt.";
  els.qualityText.textContent = "Bereit für die nächste Runde.";
}

function summarize(samples) {
  const sum = samples.reduce(
    (acc, s) => {
      acc.left += s.leftFlex;
      acc.right += s.rightFlex;
      acc.ay += s.ay;
      acc.gx += Math.abs(s.gx);
      return acc;
    },
    { left: 0, right: 0, ay: 0, gx: 0 }
  );

  return {
    leftFlex: sum.left / samples.length,
    rightFlex: sum.right / samples.length,
    ay: sum.ay / samples.length,
    gxAbs: sum.gx / samples.length,
  };
}

function updateFeedback() {
  const exercise = state.activeWorkout;
  const buffer = state.captureBuffer[exercise];
  if (buffer.length < 15) return;

  const current = summarize(buffer);
  const target = state.optimum[exercise];

  if (exercise === "frontal") {
    const leftDelta = current.leftFlex - target.leftFlex;
    const rightDelta = current.rightFlex - target.rightFlex;
    const symmetry = Math.abs(leftDelta - rightDelta);

    if (symmetry < 90) {
      setFeedback("✅ Sehr gut, beide Seiten sind ausgeglichen.", "Stabile Ausführung.", true);
    } else if (leftDelta > rightDelta) {
      setFeedback("↗ Versuch den rechten Arm etwas höher zu nehmen.", "Links dominiert gerade.", false);
    } else {
      setFeedback("↖ Versuch den linken Arm etwas höher zu nehmen.", "Rechts dominiert gerade.", false);
    }
    return;
  }

  const sideBias = current.ay - target.ay;
  if (Math.abs(sideBias) < 700) {
    setFeedback("✅ Schön gleichmäßig links/rechts.", "Gute Balance in Bauchlage.", true);
  } else if (sideBias > 0) {
    setFeedback("↙ Ich sehe mehr Bewegung zu einer Seite. Nimm auch die andere Seite mit.", "Asymmetrie erkannt.", false);
  } else {
    setFeedback("↘ Ich sehe mehr Bewegung zu einer Seite. Nimm auch die andere Seite mit.", "Asymmetrie erkannt.", false);
  }
}

function setFeedback(hint, quality, isGood) {
  els.hintText.textContent = hint;
  els.qualityText.textContent = quality;
  els.hintText.classList.toggle("good", isGood);
  els.hintText.classList.toggle("warn", !isGood);
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    els.connectionStatus.textContent = "Web Serial wird im aktuellen Browser nicht unterstützt.";
    return;
  }

  try {
    state.serialPort = await navigator.serial.requestPort();
    await state.serialPort.open({ baudRate: 115200 });
    state.connected = true;
    els.connectionStatus.textContent = "ESP32 via Serial verbunden ✅";
    readSerialLoop();
  } catch (err) {
    els.connectionStatus.textContent = `Verbindung fehlgeschlagen: ${err.message}`;
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoderStream();
  state.serialPort.readable.pipeTo(decoder.writable);
  const inputStream = decoder.readable;
  const reader = inputStream.getReader();
  state.reader = reader;

  let buffer = "";

  while (state.connected) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const sample = parseLine(line.trim());
      if (sample) handleSample(sample);
    }
  }
}

function toggleMockData() {
  if (state.mockTimer) {
    clearInterval(state.mockTimer);
    state.mockTimer = null;
    els.connectionStatus.textContent = "Mockdaten gestoppt.";
    return;
  }

  let t = 0;
  state.mockTimer = setInterval(() => {
    t += 0.1;
    const sample = {
      leftFlex: 1700 + Math.sin(t) * 250 + Math.random() * 40,
      rightFlex: 1700 + Math.sin(t + 0.3) * 250 + Math.random() * 40,
      ax: Math.sin(t) * 400,
      ay: Math.sin(t * 0.7) * 2500,
      az: 16384,
      gx: Math.sin(t * 1.3) * 90,
      gy: Math.cos(t) * 60,
      gz: 10,
      ts: Date.now(),
    };
    handleSample(sample);
  }, 120);

  els.connectionStatus.textContent = "Mockdaten aktiv ✅";
}

(function loadSavedOptimum() {
  const fromStorage = localStorage.getItem("smartshirt.optimum");
  if (!fromStorage) return;
  try {
    state.optimum = JSON.parse(fromStorage);
    els.optimumStatus.textContent = "Vorher gespeicherte Optimum-Daten geladen.";
  } catch {
    // ignore invalid cache
  }
})();
