const BLE_UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const BLE_UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // device -> app notify

const EXERCISE_META = {
  frontal: {
    title: "🧍 Frontal Raise: beide Arme kontrolliert nach oben führen",
    frames: ["assets/frontal-raise.svg", "assets/frontal-raise-frame2.svg"],
  },
  side: {
    title: "🤸 Side-to-side: in Bauchlage gleichmäßig links/rechts bewegen",
    frames: ["assets/side-to-side.svg", "assets/side-to-side-frame2.svg"],
  },
};

const state = {
  connected: false,
  source: null,
  serialPort: null,
  reader: null,
  bleDevice: null,
  bleChar: null,
  bleBuffer: "",
  mockTimer: null,
  latest: null,
  videoTimer: null,
  videoFrameIndex: 0,
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
  connectBle: document.getElementById("connect-ble"),
  toggleMock: document.getElementById("toggle-mock"),
  connectionStatus: document.getElementById("connection-status"),
  calStand: document.getElementById("cal-stand"),
  calProne: document.getElementById("cal-prone"),
  calibrationStatus: document.getElementById("calibration-status"),
  optimumStatus: document.getElementById("optimum-status"),
  liveData: document.getElementById("live-data"),
  hintText: document.getElementById("hint-text"),
  qualityText: document.getElementById("quality-text"),
  exerciseImage: document.getElementById("exercise-image"),
  exerciseTitle: document.getElementById("exercise-title"),
  stopWorkout: document.getElementById("stop-workout"),
};

document.querySelectorAll("[data-capture]").forEach((btn) => {
  btn.addEventListener("click", () => saveOptimum(btn.dataset.capture));
});

document.querySelectorAll("[data-workout]").forEach((btn) => {
  btn.addEventListener("click", () => {
    setExerciseVisual(btn.dataset.workout);
    startWorkout(btn.dataset.workout);
  });
});

els.connectSerial.addEventListener("click", connectSerial);
els.connectBle.addEventListener("click", connectBle);
els.toggleMock.addEventListener("click", toggleMockData);
els.calStand.addEventListener("click", () => saveCalibration("standing"));
els.calProne.addEventListener("click", () => saveCalibration("prone"));
els.stopWorkout.addEventListener("click", stopWorkout);

function parseLine(line) {
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
  setExerciseVisual(exercise);
  els.hintText.textContent = "Workout läuft ...";
  els.qualityText.textContent = "Ich beobachte deine Symmetrie.";
}

function stopWorkout() {
  state.activeWorkout = null;
  stopExerciseVideo();
  els.hintText.textContent = "Workout gestoppt.";
  els.qualityText.textContent = "Bereit für die nächste Runde.";
}

function setExerciseVisual(exercise) {
  const meta = EXERCISE_META[exercise];
  if (!meta) return;

  stopExerciseVideo();
  state.videoFrameIndex = 0;
  els.exerciseImage.src = meta.frames[0];
  els.exerciseTitle.textContent = meta.title;

  state.videoTimer = setInterval(() => {
    state.videoFrameIndex = (state.videoFrameIndex + 1) % meta.frames.length;
    els.exerciseImage.src = meta.frames[state.videoFrameIndex];
  }, 900);
}

function stopExerciseVideo() {
  if (state.videoTimer) {
    clearInterval(state.videoTimer);
    state.videoTimer = null;
  }
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
  } else {
    setFeedback("↔ Ich sehe gerade eine Seite stärker. Geh bewusst auch zur anderen Seite.", "Asymmetrie erkannt.", false);
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

  await disconnectSource();

  try {
    state.serialPort = await navigator.serial.requestPort();
    await state.serialPort.open({ baudRate: 115200 });
    state.connected = true;
    state.source = "serial";
    els.connectionStatus.textContent = "ESP32 via Serial verbunden ✅";
    readSerialLoop();
  } catch (err) {
    els.connectionStatus.textContent = `Serial fehlgeschlagen: ${err.message}`;
  }
}

async function connectBle() {
  if (!("bluetooth" in navigator)) {
    els.connectionStatus.textContent = "Web Bluetooth ist im aktuellen Browser nicht verfügbar.";
    return;
  }

  await disconnectSource();

  try {
    // 1) Primär: strikt nach Service filtern
    // 2) Fallback: nach Gerätename suchen (hilft wenn Service nicht korrekt advertised wird)
    // 3) Letzter Fallback: alle BLE Geräte zulassen
    try {
      state.bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_UART_SERVICE] }],
        optionalServices: [BLE_UART_SERVICE],
      });
    } catch {
      try {
        state.bleDevice = await navigator.bluetooth.requestDevice({
          filters: [{ namePrefix: "SmartShirt" }, { namePrefix: "ESP32" }],
          optionalServices: [BLE_UART_SERVICE],
        });
      } catch {
        state.bleDevice = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [BLE_UART_SERVICE],
        });
      }
    }

    const server = await state.bleDevice.gatt.connect();
    const service = await server.getPrimaryService(BLE_UART_SERVICE);
    state.bleChar = await service.getCharacteristic(BLE_UART_TX);

    await state.bleChar.startNotifications();
    state.bleChar.addEventListener("characteristicvaluechanged", onBleData);

    state.connected = true;
    state.source = "ble";
    els.connectionStatus.textContent = "ESP32 via BLE verbunden ✅";
  } catch (err) {
    els.connectionStatus.textContent =
      `BLE fehlgeschlagen: ${err.message}. ` +
      "Tipp: Firmware neu flashen, Board neu starten, und Chrome auf localhost/127.0.0.1 nutzen.";
  }
}

function onBleData(event) {
  const value = new TextDecoder().decode(event.target.value);
  state.bleBuffer += value;
  const lines = state.bleBuffer.split("\n");
  state.bleBuffer = lines.pop() || "";
  for (const line of lines) {
    const sample = parseLine(line.trim());
    if (sample) handleSample(sample);
  }
}

async function disconnectSource() {
  state.connected = false;

  if (state.reader) {
    try {
      await state.reader.cancel();
    } catch {
      // ignore
    }
    state.reader = null;
  }

  if (state.serialPort) {
    try {
      await state.serialPort.close();
    } catch {
      // ignore
    }
    state.serialPort = null;
  }

  if (state.bleChar) {
    try {
      await state.bleChar.stopNotifications();
      state.bleChar.removeEventListener("characteristicvaluechanged", onBleData);
    } catch {
      // ignore
    }
    state.bleChar = null;
  }

  if (state.bleDevice?.gatt?.connected) {
    state.bleDevice.gatt.disconnect();
  }
  state.bleDevice = null;
}

async function readSerialLoop() {
  const decoder = new TextDecoderStream();
  state.serialPort.readable.pipeTo(decoder.writable);
  const inputStream = decoder.readable;
  const reader = inputStream.getReader();
  state.reader = reader;

  let buffer = "";
  while (state.connected && state.source === "serial") {
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
