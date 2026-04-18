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
  workoutStats:  null,

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
  // results
  resultHero:        $("result-hero"),
  resultGradeIcon:   $("result-grade-icon"),
  resultTitle:       $("result-title"),
  resultSubtitle:    $("result-subtitle"),
  barLeft:           $("bar-left"),
  barRight:          $("bar-right"),
  valLeft:           $("val-left"),
  valRight:          $("val-right"),
  symmDiff:          $("symm-diff"),
  statGood:          $("stat-good"),
  statWarn:          $("stat-warn"),
  statStability:     $("stat-stability"),
  resultFeedbackText:$("result-feedback-text"),
  resultDoneBtn:     $("result-done-btn"),
  // debug
  liveData:          $("live-data"),
  dataDot:           $("data-dot"),
  calCounter:        $("cal-counter"),
  // calibration progress
  calProgress1:      $("cal-progress-1"),
  calBar1:           $("cal-bar-1"),
  calCountdown1:     $("cal-countdown-1"),
  calProgress2:      $("cal-progress-2"),
  calBar2:           $("cal-bar-2"),
  calCountdown2:     $("cal-countdown-2"),
};

let sampleCount = 0;

// ── Screen Router ────────────────────────────────────────────────
const SCREENS = ["connect", "calibrate", "exercises", "detail", "workout", "results"];

const SCREEN_META = {
  connect:   { title: "SmartShirt Physio", back: null },
  calibrate: { title: "Kalibrierung",       back: null },
  exercises: { title: "Übungen",            back: null },
  detail:    { title: "Übung",              back: "exercises" },
  workout:   { title: "Workout",            back: null },
  results:   { title: "Auswertung",         back: null },
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
      filters: [{ name: "SmartShirt-ESP32" }],
      optionalServices: [BLE_SERVICE],
    });

    dom.connectionStatus.textContent = `Verbinde mit "${device.name}" …`;
    state.bleDevice = device;

    const server = await device.gatt.connect();

    let service;
    try {
      service = await server.getPrimaryService(BLE_SERVICE);
    } catch {
      dom.connectionStatus.textContent =
        `"${device.name}" gefunden, aber kein SmartShirt-Service — falsches Gerät?`;
      return;
    }

    state.bleChar = await service.getCharacteristic(BLE_TX_CHAR);
    state.bleChar.addEventListener("characteristicvaluechanged", onBleData);
    await state.bleChar.startNotifications();
    dom.liveData.textContent = "BLE verbunden — warte auf erste Daten …";
    startBlePolling();

    device.addEventListener("gattserverdisconnected", () => {
      dom.connDot.className = "conn-dot";
      dom.connectionStatus.textContent = "Verbindung unterbrochen — bitte neu verbinden.";
      state.connected = false;
      state.source = null;
    });

    onConnected("ble");
  } catch (err) {
    if (err.name === "NotFoundError") {
      dom.connectionStatus.textContent = "Kein Gerät ausgewählt.";
    } else if (err.name === "TypeError") {
      // Fallback: some browsers need acceptAllDevices for name filter to work
      dom.connectionStatus.textContent = "Filter fehlgeschlagen — versuche es mit Demo-Modus oder USB.";
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
  sampleCount++;
  dom.liveData.textContent = JSON.stringify(sample, null, 2);

  // Blinkender Punkt im Debug-Panel
  dom.dataDot.classList.add("alive");
  clearTimeout(dom.dataDot._offTimer);
  dom.dataDot._offTimer = setTimeout(() => dom.dataDot.classList.remove("alive"), 300);

  // Zähler auf Kalibrierungsscreen
  if (dom.calCounter) {
    dom.calCounter.textContent = "✅ Sensoren aktiv";
    dom.calCounter.className = "cal-counter ok";
  }

  // Sobald das erste Sample ankommt: Kalibrierungsbuttons freischalten
  if (firstSample) {
    if (!_calStanding) { dom.calStand.disabled = false; dom.calStand.textContent = "Aufnahme starten"; }
    if (!_calProne)    { dom.calProne.disabled = false; dom.calProne.textContent = "Aufnahme starten"; }
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
  const chunk = new TextDecoder().decode(event.target.value);
  state.bleBuffer += chunk;
  const lines = state.bleBuffer.split("\n");
  state.bleBuffer = lines.pop() ?? "";
  lines.forEach(l => {
    const trimmed = l.trim();
    if (!trimmed) return;
    const s = parseLine(trimmed);
    if (s) {
      handleSample(s);
    } else {
      // Show raw line that failed to parse so we can diagnose format issues
      dom.liveData.textContent = `[RAW, parse failed]:\n${trimmed}`;
    }
  });
}

async function startBlePolling() {
  // Fallback: if notifications don't arrive, poll via readValue()
  await new Promise(r => setTimeout(r, 1000)); // give notifications 1s to work
  if (!state.connected || state.source !== "ble") return;
  if (sampleCount > 0) return; // notifications are working, no need to poll

  dom.liveData.textContent = "BLE: Polling-Modus aktiv …";
  while (state.connected && state.source === "ble" && state.bleChar) {
    try {
      const val = await state.bleChar.readValue();
      const text = new TextDecoder().decode(val);
      state.bleBuffer += text + "\n";
      const lines = state.bleBuffer.split("\n");
      state.bleBuffer = lines.pop() ?? "";
      lines.forEach(l => { const s = parseLine(l.trim()); if (s) handleSample(s); });
    } catch (e) { /* ignore read errors */ }
    await new Promise(r => setTimeout(r, 50));
  }
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
const CAL_DURATION = 10000;
let _calStanding = null;
let _calProne    = null;
let _calActiveTimer = null;

dom.calStand.addEventListener("click", () => startCalPhase("stand"));
dom.calProne.addEventListener("click",  () => startCalPhase("prone"));

function startCalPhase(type) {
  if (_calActiveTimer) return; // already recording
  const isStand   = type === "stand";
  const btn       = isStand ? dom.calStand       : dom.calProne;
  const progressW = isStand ? dom.calProgress1   : dom.calProgress2;
  const bar       = isStand ? dom.calBar1        : dom.calBar2;
  const countdown = isStand ? dom.calCountdown1  : dom.calCountdown2;
  const okEl      = isStand ? dom.calStandOk     : dom.calProneOk;
  const chip      = isStand ? dom.stepChip1      : dom.stepChip2;

  // Disable both buttons while recording
  dom.calStand.disabled = true;
  dom.calProne.disabled = true;
  btn.textContent = "Aufnahme läuft …";
  progressW.hidden = false;
  bar.style.width  = "0%";

  const samples   = [];
  const startTime = Date.now();

  const tick = setInterval(() => {
    if (state.latest) samples.push({ ...state.latest });

    const elapsed  = Date.now() - startTime;
    const pct      = Math.min(elapsed / CAL_DURATION * 100, 100);
    const secsLeft = Math.max(0, Math.ceil((CAL_DURATION - elapsed) / 1000));
    bar.style.width      = pct + "%";
    countdown.textContent = secsLeft;

    if (elapsed >= CAL_DURATION) {
      clearInterval(tick);
      _calActiveTimer = null;

      if (samples.length > 0) {
        const avg = summarize(samples);
        if (isStand) _calStanding = avg; else _calProne = avg;
      }

      progressW.hidden = false;
      bar.style.width  = "100%";
      btn.disabled     = true;
      btn.textContent  = "✅ Gespeichert";
      okEl.hidden      = false;
      chip.classList.add("done");

      // Re-enable the OTHER button if not yet done
      if (isStand && !_calProne  && dom.calProne.textContent !== "✅ Gespeichert")
        dom.calProne.disabled = false;
      if (!isStand && !_calStanding && dom.calStand.textContent !== "✅ Gespeichert")
        dom.calStand.disabled = false;

      checkCalReady();
    }
  }, 100);
  _calActiveTimer = tick;
}

function checkCalReady() {
  if (_calStanding && _calProne) dom.calDone.disabled = false;
}

dom.calDone.addEventListener("click", () => {
  state.calibration = { standing: _calStanding, prone: _calProne };
  localStorage.setItem("smartshirt.calibration", JSON.stringify(state.calibration));
  showScreen("exercises");
});

dom.recalibrateBtn.addEventListener("click", () => {
  if (_calActiveTimer) { clearInterval(_calActiveTimer); _calActiveTimer = null; }
  _calStanding = null; _calProne = null;
  dom.calStand.textContent  = "Aufnahme starten";
  dom.calProne.textContent  = "Aufnahme starten";
  dom.calStandOk.hidden = true;
  dom.calProneOk.hidden = true;
  dom.calProgress1.hidden = true;
  dom.calProgress2.hidden = true;
  dom.calDone.disabled  = true;
  dom.stepChip1.classList.remove("done");
  dom.stepChip2.classList.remove("done");
  // Only enable if sensor data is already flowing
  dom.calStand.disabled = !state.latest;
  dom.calProne.disabled = !state.latest;
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
  state.workoutStats   = { goodCount: 0, warnCount: 0, backWarnCount: 0,
                           leftSum: 0, rightSum: 0, evalCount: 0 };

  const ex = EXERCISES[id];
  dom.exerciseImage.src       = ex.image;
  dom.workoutName.textContent = ex.title;
  setFeedback("neutral", "⏳", "Workout läuft — mach los!", "Sammle Daten …");
  showScreen("workout");
});

dom.stopWorkout.addEventListener("click", stopWorkout);
dom.resultDoneBtn.addEventListener("click", () => showScreen("exercises"));

function stopWorkout() {
  const stats = state.workoutStats;
  state.activeWorkout = null;
  stopFrameAnimation();
  if (stats && stats.evalCount > 0) {
    showResults(stats);
  } else {
    showScreen("exercises");
  }
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
  const st = state.workoutStats;
  if (st) { st.leftSum += cur.leftFlex; st.rightSum += cur.rightFlex; st.evalCount++; }

  if (cur.gxAbs > tgt.gxAbs * 2.5 + 150) {
    if (st) st.backWarnCount++;
    setFeedback("warn", "⚠️",
      "Rücken stabilisieren — weniger vor und zurück schwingen.",
      "Körperspannung aufbauen");
    return;
  }

  const lDelta = cur.leftFlex  - tgt.leftFlex;
  const rDelta = cur.rightFlex - tgt.rightFlex;
  const asymm  = lDelta - rDelta;

  if (lDelta < -150 && rDelta < -150) {
    if (st) st.warnCount++;
    setFeedback("warn", "↑",
      "Beide Arme höher heben — du schöpfst den Bewegungsbereich noch nicht aus.",
      "Mehr Amplitude");
    return;
  }

  if (Math.abs(asymm) < 100) {
    if (st) st.goodCount++;
    setFeedback("good", "✅", "Sehr gut! Beide Arme gleichmäßig auf Zielhöhe.", "Perfekte Ausführung");
  } else if (asymm < -100) {
    if (st) st.warnCount++;
    setFeedback("warn", "←", "Linker Arm zu niedrig — hebe ihn auf gleiche Höhe wie rechts.", "Linke Seite stärken");
  } else {
    if (st) st.warnCount++;
    setFeedback("warn", "→", "Rechter Arm zu niedrig — hebe ihn auf gleiche Höhe wie links.", "Rechte Seite stärken");
  }
}

function showResults(st) {
  const total   = st.goodCount + st.warnCount;
  const goodPct = total > 0 ? Math.round(st.goodCount / total * 100) : 0;
  const warnPct = 100 - goodPct;
  const backPct = total > 0 ? Math.round((1 - st.backWarnCount / st.evalCount) * 100) : 100;

  // Symmetry bars: share of movement between L and R
  const leftAvg  = st.evalCount > 0 ? st.leftSum  / st.evalCount : 0;
  const rightAvg = st.evalCount > 0 ? st.rightSum / st.evalCount : 0;
  const total2   = leftAvg + rightAvg;
  const leftPct  = total2 > 0 ? Math.round(leftAvg  / total2 * 100) : 50;
  const rightPct = 100 - leftPct;
  const diff     = Math.abs(leftPct - rightPct);

  dom.barLeft.style.width  = leftPct  + "%";
  dom.barRight.style.width = rightPct + "%";
  dom.valLeft.textContent  = leftPct  + "%";
  dom.valRight.textContent = rightPct + "%";

  if (diff <= 3) {
    dom.symmDiff.textContent = "Perfekte Symmetrie — Links und Rechts nahezu gleich.";
  } else if (diff <= 8) {
    const side = leftPct > rightPct ? "Links" : "Rechts";
    dom.symmDiff.textContent = `Leichte Asymmetrie: ${side} ${diff}% dominanter.`;
  } else {
    const side = leftPct > rightPct ? "Links" : "Rechts";
    dom.symmDiff.textContent = `Deutliche Asymmetrie: ${side} um ${diff}% stärker.`;
  }

  dom.statGood.textContent      = goodPct + "%";
  dom.statWarn.textContent      = warnPct + "%";
  dom.statStability.textContent = backPct + "%";

  // Overall grade
  let icon, title, subtitle, feedback;
  if (goodPct >= 75 && diff <= 5 && backPct >= 80) {
    icon = "🏆"; title = "Ausgezeichnet!"; subtitle = "Sehr ausgeglichenes Workout";
    feedback = "Deine Ausführung war sehr gleichmäßig und kontrolliert. Beide Arme arbeiteten symmetrisch — weiter so!";
  } else if (goodPct >= 50 && diff <= 12) {
    icon = "✅"; title = "Gute Leistung!"; subtitle = "Solides Workout mit Luft nach oben";
    const tip = diff > 5 ? ` Arbeite daran, ${leftPct > rightPct ? "rechts" : "links"} etwas mehr einzusetzen.` : "";
    feedback = `Du hast ${goodPct}% der Zeit sauber ausgeführt.${tip}`;
  } else if (goodPct >= 30) {
    icon = "💪"; title = "Weiter üben!"; subtitle = "Fokus auf gleichmäßige Bewegung";
    feedback = diff > 12
      ? `Große Asymmetrie zwischen Links (${leftPct}%) und Rechts (${rightPct}%). Konzentriere dich darauf, beide Arme gleichmäßig zu heben.`
      : "Versuche, die Bewegung kontrollierter und gleichmäßiger auszuführen. Weniger Schwung, mehr Muskelkontrolle.";
  } else {
    icon = "🔄"; title = "Aufwärmen & nochmal!"; subtitle = "Zu wenig Wiederholungen erkannt";
    feedback = "Es wurden zu wenig auswertbare Bewegungen erkannt. Stelle sicher, dass die Sensoren gut sitzen und führe die Übung vollständig aus.";
  }

  dom.resultGradeIcon.textContent = icon;
  dom.resultTitle.textContent     = title;
  dom.resultSubtitle.textContent  = subtitle;
  dom.resultFeedbackText.textContent = feedback;

  // Hero background color
  dom.resultHero.style.background = goodPct >= 75 ? "var(--green-light)"
    : goodPct >= 50 ? "var(--blue-light)" : "var(--amber-light)";

  showScreen("results");
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
