// ── BLE Profile ──────────────────────────────────────────────────
const BLE_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const BLE_TX_CHAR = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

// ── Exercise Catalogue ───────────────────────────────────────────
const EXERCISES = {
  frontal: {
    title: "Frontal Raise",
    desc:  "Beide Arme gleichmäßig nach vorne und oben heben. Rücken gerade halten.",
    image: "assets/3eGE2JC.gif",
    frames: ["assets/3eGE2JC.gif"],
  },
};

// ── App State ────────────────────────────────────────────────────
const state = {
  // connection
  connected:     false,
  source:        null,     // "ble" | "serial" | "mock"
  serialPort:    null,
  reader:        null,
  bleDevice:     null,
  bleChar:       null,
  bleBuffer:     "",
  mockTimer:     null,
  latest:        null,

  // calibration (saved to localStorage)
  calibration:   null,     // { standing, prone }

  // optimum per exercise (saved to localStorage)
  optimum:       {},       // { frontal: { leftFlex, rightFlex, ay, gxAbs } }

  // optimum recording
  activeExercise: null,
  isRecording:   false,
  recBuffer:     [],

  // workout
  activeWorkout: null,
  workoutBuffer: [],

  // animation
  videoTimer:    null,
  videoFrame:    0,
};

// ── DOM shorthand ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
  topbarBack:        $("topbar-back"),
  topbarTitle:       $("topbar-title"),
  connDot:           $("conn-dot"),
  // connect
  connectBle:        $("connect-ble"),
  connectSerial:     $("connect-serial"),
  toggleMock:        $("toggle-mock"),
  connectionStatus:  $("connection-status"),
  // calibration
  calStand:          $("cal-stand"),
  calStandOk:        $("cal-stand-ok"),
  calProne:          $("cal-prone"),
  calProneOk:        $("cal-prone-ok"),
  calDone:           $("cal-done"),
  stepChip1:         $("step-chip-1"),
  stepChip2:         $("step-chip-2"),
  // exercises
  exCardFrontal:     $("ex-card-frontal"),
  optimumChipFrontal:$("optimum-chip-frontal"),
  recalibrateBtn:    $("recalibrate-btn"),
  // detail
  detailImage:       $("detail-image"),
  detailTitle:       $("detail-title"),
  detailDesc:        $("detail-desc"),
  detailOptimumChip: $("detail-optimum-chip"),
  optimumHint:       $("optimum-hint"),
  optimumRecordBtn:  $("optimum-record-btn"),
  optimumSaveBtn:    $("optimum-save-btn"),
  recordInfo:        $("record-info"),
  startWorkoutBtn:   $("start-workout-btn"),
  // workout
  exerciseImage:     $("exercise-image"),
  workoutName:       $("workout-name"),
  feedbackCard:      $("feedback-card"),
  feedbackIcon:      $("feedback-icon"),
  hintText:          $("hint-text"),
  qualityText:       $("quality-text"),
  stopWorkout:       $("stop-workout"),
  // debug
  liveData:          $("live-data"),
};

// ── Screen Router ────────────────────────────────────────────────
const SCREENS = ["connect", "calibrate", "exercises", "detail", "workout"];

const SCREEN_META = {
  connect:   { title: "SmartShirt Physio", back: null },
  calibrate: { title: "Kalibrierung",       back: null },   // no escape from calibration
  exercises: { title: "Übungen",            back: null },
  detail:    { title: "Übung",              back: "exercises" },
  workout:   { title: "Workout",            back: null },    // handled by stop button
};

function showScreen(name) {
  SCREENS.forEach(s => {
    const el = $(`screen-${s}`);
    if (el) {
      el.hidden = s !== name;
      if (s === name) {
        // re-trigger animation
        el.style.animation = "none";
        el.offsetHeight; // reflow
        el.style.animation = "";
      }
    }
  });

  const meta = SCREEN_META[name] ?? {};
  dom.topbarTitle.textContent = meta.title ?? "SmartShirt";

  if (meta.back) {
    dom.topbarBack.hidden = false;
    dom.topbarBack.onclick = () => {
      if (name === "workout") stopWorkout();
      else showScreen(meta.back);
    };
  } else {
    dom.topbarBack.hidden = true;
    dom.topbarBack.onclick = null;
  }
}

// ── Connection ───────────────────────────────────────────────────
dom.connectBle.addEventListener("click", connectBle);
dom.connectSerial.addEventListener("click", connectSerial);
dom.toggleMock.addEventListener("click", toggleMock);

function onConnected(source) {
  state.connected = true;
  state.source = source;
  const labels = { ble: "BLE", serial: "USB", mock: "Demo" };
  dom.connectionStatus.textContent = `Verbunden via ${labels[source] ?? source} ✓`;
  dom.connDot.className = `conn-dot ${source === "mock" ? "mock" : "on"}`;

  if (!state.calibration) {
    showScreen("calibrate");
  } else {
    showScreen("exercises");
  }
}

async function connectBle() {
  // Web Bluetooth braucht einen sicheren Kontext (localhost oder https)
  if (!window.isSecureContext) {
    dom.connectionStatus.textContent =
      "⚠️ Bluetooth funktioniert nur über http://localhost:8080 — öffne die App nicht als Datei direkt im Browser!";
    return;
  }
  if (!("bluetooth" in navigator)) {
    dom.connectionStatus.textContent =
      "Web Bluetooth nicht verfügbar — nutze Google Chrome (kein Firefox/Safari).";
    return;
  }

  await cleanupConnection();
  dom.connectionStatus.textContent = "Bluetooth-Dialog öffnet … wähle SmartShirt-ESP32";

  try {
    const device = await navigator.bluetooth.requestDevice({
      // Zeigt alle BLE-Geräte — zuverlässiger als Service-UUID-Filter
      acceptAllDevices: true,
      optionalServices: [BLE_SERVICE],
    });

    dom.connectionStatus.textContent = `Verbinde mit "${device.name ?? "Gerät"}" …`;
    state.bleDevice = device;

    const server  = await device.gatt.connect();

    let service;
    try {
      service = await server.getPrimaryService(BLE_SERVICE);
    } catch {
      dom.connectionStatus.textContent =
        `"${device.name}" gefunden, aber kein SmartShirt-Service — falsches Gerät gewählt?`;
      return;
    }

    state.bleChar = await service.getCharacteristic(BLE_TX_CHAR);
    await state.bleChar.startNotifications();
    state.bleChar.addEventListener("characteristicvaluechanged", onBleData);

    device.addEventListener("gattserverdisconnected", () => {
      dom.connDot.className = "conn-dot";
      dom.connectionStatus.textContent = "Verbindung unterbrochen — bitte neu verbinden.";
      state.connected = false;
    });

    onConnected("ble");
  } catch (err) {
    if (err.name === "NotFoundError") {
      dom.connectionStatus.textContent = "Kein Gerät ausgewählt.";
    } else {
      dom.connectionStatus.textContent = `Bluetooth Fehler: ${err.message}`;
    }
  }
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    dom.connectionStatus.textContent = "Web Serial nicht verfügbar — nutze Chrome oder Edge.";
    return;
  }
  await cleanupConnection();
  try {
    state.serialPort = await navigator.serial.requestPort();
    await state.serialPort.open({ baudRate: 115200 });
    onConnected("serial");
    readSerialLoop();
  } catch (err) {
    dom.connectionStatus.textContent = `USB Fehler: ${err.message}`;
  }
}

function toggleMock() {
  if (state.mockTimer) {
    clearInterval(state.mockTimer);
    state.mockTimer = null;
    dom.connectionStatus.textContent = "Demo gestoppt.";
    dom.connDot.className = "conn-dot";
    state.connected = false;
    state.source = null;
    if (state.activeWorkout) stopWorkout();
    showScreen("connect");
    return;
  }
  let t = 0;
  state.mockTimer = setInterval(() => {
    t += 0.12;
    handleSample({
      leftFlex:  1700 + Math.sin(t) * 260 + Math.random() * 30,
      rightFlex: 1700 + Math.sin(t + 0.2) * 260 + Math.random() * 30,
      ax:  Math.sin(t) * 400,
      ay:  Math.sin(t * 0.7) * 2400,
      az:  16384,
      gx:  Math.sin(t * 1.3) * 75,
      gy:  Math.cos(t) * 45,
      gz:  8,
      ts:  Date.now(),
    });
  }, 100);
  onConnected("mock");
}

async function cleanupConnection() {
  state.connected = false;
  if (state.mockTimer)  { clearInterval(state.mockTimer); state.mockTimer = null; }
  if (state.reader)     { try { await state.reader.cancel(); } catch {} state.reader = null; }
  if (state.serialPort) { try { await state.serialPort.close(); } catch {} state.serialPort = null; }
  if (state.bleChar) {
    try { await state.bleChar.stopNotifications(); state.bleChar.removeEventListener("characteristicvaluechanged", onBleData); } catch {}
    state.bleChar = null;
  }
  if (state.bleDevice?.gatt?.connected) state.bleDevice.gatt.disconnect();
  state.bleDevice = null;
}

// ── Data Ingestion ───────────────────────────────────────────────
function parseLine(line) {
  const out = {};
  line.split(",").forEach(pair => {
    const [k, v] = pair.split(":");
    if (k && v !== undefined) out[k.trim().toLowerCase()] = Number(v.trim());
  });
  if (!Number.isFinite(out.l) || !Number.isFinite(out.ax)) return null;
  return {
    leftFlex: out.l, rightFlex: out.r ?? 0,
    ax: out.ax, ay: out.ay ?? 0, az: out.az ?? 0,
    gx: out.gx ?? 0, gy: out.gy ?? 0, gz: out.gz ?? 0,
    ts: Date.now(),
  };
}

function handleSample(sample) {
  const firstSample = !state.latest;
  state.latest = sample;
  dom.liveData.textContent = JSON.stringify(sample, null, 2);

  // Sobald das erste Sample ankommt: Kalibrierungsbuttons freischalten
  if (firstSample) {
    dom.calStand.disabled = false;
    dom.calProne.disabled = false;
    dom.calStand.textContent = "Position jetzt speichern";
    dom.calProne.textContent = "Position jetzt speichern";
    const waiting = document.getElementById("cal-waiting");
    if (waiting) waiting.remove();
  }

  if (state.isRecording) {
    state.recBuffer.push(sample);
    dom.recordInfo.textContent = `${state.recBuffer.length} Datenpunkte aufgezeichnet …`;
  }

  if (state.activeWorkout) {
    state.workoutBuffer.push(sample);
    if (state.workoutBuffer.length > 150) state.workoutBuffer.shift();
    updateFeedback();
  }
}

function onBleData(event) {
  state.bleBuffer += new TextDecoder().decode(event.target.value);
  const lines = state.bleBuffer.split("\n");
  state.bleBuffer = lines.pop() ?? "";
  lines.forEach(l => { const s = parseLine(l.trim()); if (s) handleSample(s); });
}

async function readSerialLoop() {
  const decoder = new TextDecoderStream();
  state.serialPort.readable.pipeTo(decoder.writable);
  const reader = decoder.readable.getReader();
  state.reader  = reader;
  let buf = "";
  while (state.connected && state.source === "serial") {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(l => { const s = parseLine(l.trim()); if (s) handleSample(s); });
  }
}

// ── Calibration ──────────────────────────────────────────────────
let _calStanding = null;
let _calProne    = null;

dom.calStand.addEventListener("click", () => {
  _calStanding = { ...state.latest };
  dom.calStandOk.textContent = "✅ Gespeichert";
  dom.calStandOk.hidden = false;
  dom.calStand.disabled = true;
  dom.calStand.textContent = "✅ Gespeichert";
  dom.stepChip1.classList.add("done");
  checkCalReady();
});

dom.calProne.addEventListener("click", () => {
  _calProne = { ...state.latest };
  dom.calProneOk.textContent = "✅ Gespeichert";
  dom.calProneOk.hidden = false;
  dom.calProne.disabled = true;
  dom.calProne.textContent = "✅ Gespeichert";
  dom.stepChip2.classList.add("done");
  checkCalReady();
});

function checkCalReady() {
  if (_calStanding && _calProne) dom.calDone.disabled = false;
}

dom.calDone.addEventListener("click", () => {
  state.calibration = { standing: _calStanding, prone: _calProne };
  localStorage.setItem("smartshirt.calibration", JSON.stringify(state.calibration));
  showScreen("exercises");
});

dom.recalibrateBtn.addEventListener("click", () => {
  _calStanding = null; _calProne = null;
  dom.calStand.disabled  = false; dom.calStand.textContent  = "Position jetzt speichern";
  dom.calProne.disabled  = false; dom.calProne.textContent  = "Position jetzt speichern";
  dom.calStandOk.hidden  = true;
  dom.calProneOk.hidden  = true;
  dom.calDone.disabled   = true;
  dom.stepChip1.classList.remove("done");
  dom.stepChip2.classList.remove("done");
  showScreen("calibrate");
});

// ── Exercise Selection ───────────────────────────────────────────
dom.exCardFrontal.addEventListener("click", () => openExercise("frontal"));

function openExercise(id) {
  state.activeExercise = id;
  const ex = EXERCISES[id];
  dom.detailImage.src    = ex.image;
  dom.detailTitle.textContent = ex.title;
  dom.detailDesc.textContent  = ex.desc;
  refreshDetailUI(id);
  showScreen("detail");
}

function refreshDetailUI(id) {
  const has = !!state.optimum[id];

  dom.detailOptimumChip.textContent  = has ? "✅ Aufgenommen" : "Nicht aufgenommen";
  dom.detailOptimumChip.className    = `status-chip${has ? " done" : ""}`;
  dom.optimumHint.textContent        = has
    ? "Optimum ist gespeichert. Du kannst es jederzeit neu aufnehmen."
    : "Führe die Übung einmal perfekt aus und nimm sie als Referenz auf.";
  dom.startWorkoutBtn.disabled = !has;

  const chip = $(`optimum-chip-${id}`);
  if (chip) {
    chip.textContent = has ? "✅ Bereit für Workout" : "Optimum aufnehmen";
    chip.className   = `optimum-chip${has ? " ready" : ""}`;
  }
}

// ── Optimum Recording ────────────────────────────────────────────
dom.optimumRecordBtn.addEventListener("click", () => {
  if (!state.isRecording) {
    // Start recording
    state.isRecording = true;
    state.recBuffer   = [];
    dom.optimumRecordBtn.innerHTML = '<span class="rec-dot"></span> Aufnahme stoppen';
    dom.optimumRecordBtn.classList.add("active");
    dom.optimumSaveBtn.hidden = true;
    dom.recordInfo.textContent = "Aufnahme läuft …";
  } else {
    // Stop recording
    state.isRecording = false;
    dom.optimumRecordBtn.innerHTML = '<span class="rec-dot"></span> Aufnahme starten';
    dom.optimumRecordBtn.classList.remove("active");

    if (state.recBuffer.length >= 10) {
      dom.recordInfo.textContent = `${state.recBuffer.length} Datenpunkte aufgezeichnet — jetzt speichern.`;
      dom.optimumSaveBtn.hidden  = false;
    } else {
      dom.recordInfo.textContent = "Zu wenig Daten — bitte erneut versuchen.";
    }
  }
});

dom.optimumSaveBtn.addEventListener("click", () => {
  const id = state.activeExercise;
  if (!state.recBuffer.length) return;
  state.optimum[id] = summarize(state.recBuffer);
  localStorage.setItem("smartshirt.optimum", JSON.stringify(state.optimum));
  dom.optimumSaveBtn.hidden  = true;
  dom.recordInfo.textContent = "✅ Optimum gespeichert!";
  refreshDetailUI(id);
});

// ── Workout ──────────────────────────────────────────────────────
dom.startWorkoutBtn.addEventListener("click", () => {
  const id = state.activeExercise;
  if (!state.optimum[id]) return;
  state.activeWorkout  = id;
  state.workoutBuffer  = [];

  const ex = EXERCISES[id];
  dom.exerciseImage.src       = ex.frames[0];
  dom.workoutName.textContent = ex.title;

  dom.exerciseImage.src = ex.image;   // GIF animiert sich selbst
  setFeedback("neutral", "⏳", "Workout läuft — mach los!", "Sammle Daten …");
  showScreen("workout");
});

dom.stopWorkout.addEventListener("click", stopWorkout);

function stopWorkout() {
  state.activeWorkout = null;
  stopFrameAnimation();
  showScreen("exercises");
}

function startFrameAnimation(frames) {
  stopFrameAnimation();
  state.videoFrame = 0;
  state.videoTimer = setInterval(() => {
    state.videoFrame = (state.videoFrame + 1) % frames.length;
    dom.exerciseImage.src = frames[state.videoFrame];
  }, 900);
}

function stopFrameAnimation() {
  if (state.videoTimer) { clearInterval(state.videoTimer); state.videoTimer = null; }
}

// ── Feedback Engine ──────────────────────────────────────────────
function summarize(samples) {
  const n = samples.length;
  const acc = samples.reduce((a, s) => ({
    leftFlex:  a.leftFlex  + s.leftFlex,
    rightFlex: a.rightFlex + s.rightFlex,
    ay:        a.ay        + s.ay,
    gxAbs:     a.gxAbs     + Math.abs(s.gx),
  }), { leftFlex: 0, rightFlex: 0, ay: 0, gxAbs: 0 });
  return { leftFlex: acc.leftFlex/n, rightFlex: acc.rightFlex/n, ay: acc.ay/n, gxAbs: acc.gxAbs/n };
}

function updateFeedback() {
  const buf = state.workoutBuffer;
  if (buf.length < 15) return;
  const current = summarize(buf.slice(-30));
  const target  = state.optimum[state.activeWorkout];
  if (state.activeWorkout === "frontal") evaluateFrontalRaise(current, target);
}

function evaluateFrontalRaise(cur, tgt) {
  // Back stability: excessive forward/back rocking
  if (cur.gxAbs > tgt.gxAbs * 2.5 + 150) {
    setFeedback("warn", "⚠️",
      "Rücken stabilisieren — weniger vor und zurück schwingen.",
      "Körperspannung aufbauen");
    return;
  }

  const lDelta  = cur.leftFlex  - tgt.leftFlex;
  const rDelta  = cur.rightFlex - tgt.rightFlex;
  const asymm   = lDelta - rDelta;  // positive → left higher relative to target

  // Both arms clearly below target
  if (lDelta < -150 && rDelta < -150) {
    setFeedback("warn", "↑",
      "Beide Arme höher heben — du schöpfst den Bewegungsbereich noch nicht aus.",
      "Mehr Amplitude");
    return;
  }

  if (Math.abs(asymm) < 100) {
    setFeedback("good", "✅",
      "Sehr gut! Beide Arme gleichmäßig auf Zielhöhe.",
      "Perfekte Ausführung");
  } else if (asymm < -100) {
    setFeedback("warn", "←",
      "Linker Arm zu niedrig — hebe ihn auf gleiche Höhe wie rechts.",
      "Linke Seite stärken");
  } else {
    setFeedback("warn", "→",
      "Rechter Arm zu niedrig — hebe ihn auf gleiche Höhe wie links.",
      "Rechte Seite stärken");
  }
}

function setFeedback(type, icon, main, sub) {
  dom.feedbackCard.className   = `feedback-card ${type}`;
  dom.feedbackIcon.textContent = icon;
  dom.hintText.textContent     = main;
  dom.qualityText.textContent  = sub;
}

// ── Persistence ──────────────────────────────────────────────────
function loadStorage() {
  try {
    const cal = localStorage.getItem("smartshirt.calibration");
    if (cal) state.calibration = JSON.parse(cal);
  } catch {}
  try {
    const opt = localStorage.getItem("smartshirt.optimum");
    if (opt) state.optimum = JSON.parse(opt);
  } catch {}
}

// ── Boot ─────────────────────────────────────────────────────────
loadStorage();
refreshDetailUI("frontal");   // update chip colours from persisted data
showScreen("connect");
