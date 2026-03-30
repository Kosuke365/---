import './style.css';
import { Html5Qrcode } from 'html5-qrcode';

// =========================================
// State
// =========================================
const state = {
  gasUrl: localStorage.getItem('kimino_gas_url') || '',
  campus: localStorage.getItem('kimino_campus') || '',
  students: [],
  todayLogs: [],
  scanner: null,
  scanning: false,
  cooldown: false,
};

// =========================================
// GAS API
// =========================================
async function callGAS(action, data = {}) {
  if (!state.gasUrl) throw new Error('GAS URLが設定されていません');
  const payload = { action, ...data };
  try {
    const res = await fetch(state.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    return await res.json();
  } catch (e) {
    console.error('GAS API Error:', e);
    if (action === 'log') {
      await fetch(state.gasUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      return { success: true, fallback: true };
    }
    throw e;
  }
}

async function loadStudents() {
  try {
    const res = await callGAS('get_init_data');
    if (res.success) {
      state.students = res.users || [];
      console.log(`✅ ${state.students.length}人の生徒データを取得`);
    }
  } catch (e) {
    console.error('生徒データ取得失敗:', e);
    showError('生徒データの取得に失敗しました。GAS URLを確認してください。');
  }
}

function findStudent(id) {
  return state.students.find(s => String(s.id) === String(id));
}

// =========================================
// Clock
// =========================================
function updateClock() {
  const now = new Date();
  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('date');
  if (clockEl) clockEl.textContent = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (dateEl) dateEl.textContent = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

// =========================================
// QR Scanner - 感度最適化
// =========================================
async function startScanner() {
  if (state.scanning) return;

  const reader = document.getElementById('qr-reader');
  if (!reader) return;

  state.scanner = new Html5Qrcode('qr-reader');

  // シンプルなカメラ設定
  const cameraConfig = { facingMode: 'environment' };

  try {
    await state.scanner.start(
      cameraConfig,
      {
        fps: 15,
        disableFlip: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        },
      },
      onScanSuccess,
      () => {}
    );
    state.scanning = true;
    console.log('📷 Scanner started (HD, full-frame)');
  } catch (err) {
    console.error('Scanner error:', err);
    showError('カメラの起動に失敗しました。カメラの権限を確認してください。');
  }
}

async function stopScanner() {
  if (state.scanner && state.scanning) {
    try {
      await state.scanner.stop();
    } catch (e) {
      console.warn('Scanner stop error:', e);
    }
    state.scanning = false;
  }
}

function onScanSuccess(decodedText) {
  if (state.cooldown) return;
  state.cooldown = true;

  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

  const student = findStudent(decodedText);

  if (!student) {
    showError(`ID「${decodedText}」の生徒が見つかりません`);
    setTimeout(() => { state.cooldown = false; }, 2000);
    return;
  }

  showResult(student);
}

// =========================================
// UI: Result Overlay
// =========================================
function showResult(student) {
  const overlay = document.getElementById('result-overlay');
  const nameEl = document.getElementById('result-name');
  const infoEl = document.getElementById('result-info');

  nameEl.textContent = student.name;
  infoEl.textContent = `ID: ${student.id}　•　${student.campus}`;

  const lastLog = state.todayLogs.filter(l => String(l.userId) === String(student.id)).pop();
  const enterBtn = document.getElementById('btn-enter');
  const exitBtn = document.getElementById('btn-exit');

  enterBtn.classList.remove('recommended');
  exitBtn.classList.remove('recommended');

  if (!lastLog || lastLog.type === '退室') {
    enterBtn.classList.add('recommended');
  } else {
    exitBtn.classList.add('recommended');
  }

  overlay.classList.add('visible');
}

function hideResult() {
  document.getElementById('result-overlay').classList.remove('visible');
  setTimeout(() => { state.cooldown = false; }, 500);
}

// =========================================
// UI: Record Log
// =========================================
async function recordLog(type) {
  const nameEl = document.getElementById('result-name');
  const infoEl = document.getElementById('result-info');
  const studentName = nameEl.textContent;
  const infoText = infoEl.textContent;
  const idMatch = infoText.match(/ID:\s*(\S+)/);
  const studentId = idMatch ? idMatch[1] : '';

  hideResult();
  showSuccess(studentName, type);

  // Add to local log (internal only, not displayed)
  state.todayLogs.push({
    userId: studentId,
    userName: studentName,
    type,
    time: new Date(),
    campus: state.campus,
  });
  updateStats();

  // Send to GAS
  try {
    await callGAS('log', {
      userId: studentId,
      userName: studentName,
      type,
      campus: state.campus,
      mood: 'normal',
    });
    console.log(`✅ ${studentName} ${type} logged`);
  } catch (e) {
    console.error('Log failed:', e);
    showError('ログの送信に失敗しました');
  }
}

// =========================================
// UI: Success Animation
// =========================================
function showSuccess(name, type) {
  const overlay = document.getElementById('success-overlay');
  const icon = document.getElementById('success-icon');
  const text = document.getElementById('success-text');
  const sub = document.getElementById('success-subtext');

  icon.className = 'success-icon ' + (type === '入室' ? 'enter' : 'exit');
  icon.textContent = type === '入室' ? '🏫' : '👋';
  text.textContent = `${type}しました`;
  sub.textContent = name;

  overlay.classList.add('visible');

  setTimeout(() => {
    overlay.classList.remove('visible');
  }, 2500);
}

// =========================================
// UI: Stats
// =========================================
function updateStats() {
  const enterCount = state.todayLogs.filter(l => l.type === '入室').length;
  const exitCount = state.todayLogs.filter(l => l.type === '退室').length;
  const enterEl = document.getElementById('stat-enter');
  const exitEl = document.getElementById('stat-exit');
  if (enterEl) enterEl.textContent = enterCount;
  if (exitEl) exitEl.textContent = exitCount;
}

// =========================================
// UI: Error
// =========================================
function showError(msg) {
  const banner = document.getElementById('error-banner');
  if (!banner) return;
  banner.textContent = msg;
  banner.classList.add('visible');
  setTimeout(() => banner.classList.remove('visible'), 3500);
}

// =========================================
// Settings
// =========================================
function showSettings() {
  const overlay = document.getElementById('settings-overlay');
  const urlInput = document.getElementById('settings-url');
  const campusInput = document.getElementById('settings-campus');
  urlInput.value = state.gasUrl;
  campusInput.value = state.campus;
  overlay.classList.add('visible');
}

function hideSettings() {
  document.getElementById('settings-overlay').classList.remove('visible');
}

async function saveSettings() {
  const url = document.getElementById('settings-url').value.trim();
  const campus = document.getElementById('settings-campus').value;

  if (!url) { showError('GAS URLを入力してください'); return; }
  if (!campus) { showError('キャンパスを選択してください'); return; }

  state.gasUrl = url;
  state.campus = campus;
  localStorage.setItem('kimino_gas_url', url);
  localStorage.setItem('kimino_campus', campus);

  hideSettings();

  const campusEl = document.getElementById('campus-name');
  if (campusEl) campusEl.textContent = campus;

  await loadStudents();
  renderMain();
}

// =========================================
// Render
// =========================================
function renderSetup() {
  document.getElementById('app').innerHTML = `
    <div class="header">
      <div class="header-brand">
        <div>
          <h1>KIMINO</h1>
          <div class="subtitle">Camera Scanner</div>
        </div>
      </div>
    </div>
    <div class="setup-screen">
      <div class="setup-icon">📷</div>
      <div class="setup-title">初期設定</div>
      <div class="setup-desc">
        KIMINO PORTALのGASデプロイURLとキャンパスを設定してください。
        設定はこの端末に保存されます。
      </div>
      <button class="btn-save" onclick="window.__showSettings()" style="max-width:280px">⚙️ 設定を開く</button>
    </div>
    ${renderSettingsModal()}
    <div id="error-banner" class="error-banner"></div>
  `;
}

function renderMain() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="header">
      <div class="header-brand">
        <div>
          <h1>KIMINO</h1>
          <div class="subtitle">Camera Scanner</div>
        </div>
      </div>
      <div class="header-right">
        <div>
          <div id="clock" class="header-clock">--:--:--</div>
          <div id="date" class="header-date"></div>
        </div>
        <button class="btn-settings" onclick="window.__showSettings()">⚙️</button>
      </div>
    </div>

    <div class="stats-bar">
      <div class="stat-chip">🏫 入室 <span class="num" id="stat-enter">0</span></div>
      <div class="stat-chip success">👋 退室 <span class="num" id="stat-exit">0</span></div>
      <div class="stat-chip campus" id="campus-name">📍 ${state.campus}</div>
    </div>

    <div class="scanner-area">
      <div id="qr-reader"></div>
      <div class="scanner-overlay">
        <div class="scan-frame">
          <div class="scan-corner-bl"></div>
          <div class="scan-corner-br"></div>
          <div class="scan-line"></div>
        </div>
      </div>
      <div class="scan-hint">📱 QRコードをカメラに向けてください</div>
    </div>

    <!-- Result overlay -->
    <div id="result-overlay" class="result-overlay">
      <div class="result-card">
        <div class="result-avatar">👤</div>
        <div id="result-name" class="result-name"></div>
        <div id="result-info" class="result-info"></div>
        <div class="result-actions">
          <button id="btn-enter" class="btn-action btn-enter" onclick="window.__recordLog('入室')">🏫 入室</button>
          <button id="btn-exit" class="btn-action btn-exit" onclick="window.__recordLog('退室')">👋 退室</button>
        </div>
        <button class="btn-action btn-cancel" style="margin-top:12px" onclick="window.__hideResult()">キャンセル</button>
      </div>
    </div>

    <!-- Success overlay -->
    <div id="success-overlay" class="success-overlay">
      <div id="success-icon" class="success-icon">🏫</div>
      <div id="success-text" class="success-text"></div>
      <div id="success-subtext" class="success-subtext"></div>
    </div>

    ${renderSettingsModal()}
    <div id="error-banner" class="error-banner"></div>
  `;

  updateClock();
  setInterval(updateClock, 1000);
  setTimeout(() => startScanner(), 500);
}

function renderSettingsModal() {
  return `
    <div id="settings-overlay" class="settings-overlay">
      <div class="settings-card">
        <div class="settings-title">⚙️ 設定</div>
        <div class="form-group">
          <label class="form-label">GAS Web App URL</label>
          <input id="settings-url" class="form-input" placeholder="https://script.google.com/macros/s/.../exec" />
          <div class="form-hint">KIMINO PORTALの「ウェブアプリとしてデプロイ」で取得したURL</div>
        </div>
        <div class="form-group">
          <label class="form-label">キャンパス</label>
          <select id="settings-campus" class="form-select">
            <option value="">選択してください</option>
            <option value="横浜">横浜</option>
            <option value="武蔵小杉">武蔵小杉</option>
            <option value="藤沢">藤沢</option>
            <option value="津田沼">津田沼</option>
            <option value="立川">立川</option>
            <option value="町田">町田</option>
            <option value="所沢">所沢</option>
          </select>
        </div>
        <button class="btn-save" onclick="window.__saveSettings()">💾 保存して開始</button>
        <button class="btn-action btn-cancel" style="margin-top:12px;width:100%" onclick="window.__hideSettings()">キャンセル</button>
      </div>
    </div>
  `;
}

// =========================================
// Global handlers
// =========================================
window.__showSettings = showSettings;
window.__hideSettings = hideSettings;
window.__saveSettings = saveSettings;
window.__recordLog = recordLog;
window.__hideResult = hideResult;

// =========================================
// Init
// =========================================
async function init() {
  if (state.gasUrl && state.campus) {
    renderMain();
    await loadStudents();
    updateStats();
  } else {
    renderSetup();
  }
}

init();
