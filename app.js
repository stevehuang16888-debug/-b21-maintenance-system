import {
  NiimbotBluetoothClient,
  ImageEncoder,
} from "https://esm.sh/@mmote/niimbluelib@0.0.1-alpha.42?bundle";

const API_URL = 'https://script.google.com/macros/s/AKfycbyvnBmrqdwNAENPDYnS-hgT0TBI2mx93UWSHAVf29_kDcJRmmNMz8e-rEO13QuORYSWoA/exec';
const $ = (id) => document.getElementById(id);
const canvas = $('labelCanvas');
const ctx = canvas.getContext('2d');
let printer = null;
let storedNextDate = '';
let equipmentLoaded = false;
let earlyMaintenanceApproved = false;
let databaseUpdated = false;

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function displayDate(s) { return s ? String(s).slice(0,10).replaceAll('-', '/') : ''; }

function jsonp(params) {
  return new Promise((resolve, reject) => {
    const callback = `b21cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => cleanup(new Error('資料庫連線逾時')), 15000);

    function cleanup(error, value) {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
      error ? reject(error) : resolve(value);
    }

    window[callback] = (data) => cleanup(null, data);
    script.onerror = () => cleanup(new Error('無法連接 Google Sheet 資料庫'));
    const q = new URLSearchParams({ ...params, callback, _: Date.now().toString() });
    script.src = `${API_URL}?${q.toString()}`;
    document.head.appendChild(script);
  });
}

function drawLabel() {
  const id = $('equipmentId').value.trim() || 'EQ-001';
  const maintained = displayDate($('maintenanceDate').value);
  const next = displayDate($('nextDate').value);
  const maintainer = $('maintainer').value || '---';

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 354, 177);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, 350, 173);
  ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 24px sans-serif'; ctx.fillText(`設備 ${id}`, 12, 24);
  ctx.font = '20px sans-serif'; ctx.fillText(`保養 ${maintained}`, 12, 62);
  ctx.fillText(`下次 ${next}`, 12, 99);
  ctx.font = 'bold 20px sans-serif'; ctx.fillText(`人員 ${maintainer}`, 12, 138);
}

function setStatus(text, type='') {
  $('status').textContent = text;
  $('status').className = `status ${type}`;
}

function fillEquipment(data) {
  $('equipmentId').value = data.id || '';
  $('equipmentName').value = data.name || '';
  $('intervalMonths').value = data.interval || 1;
  storedNextDate = data.nextPM || '';
  $('maintenanceDate').value = localISODate();
  $('nextDate').value = data.calculatedNextPM || '';
  equipmentLoaded = true;
  drawLabel();
}

async function completeDatabasePM(isEarly) {
  const maintainer = $('maintainer').value;
  if (!maintainer) {
    setStatus('請先選擇保養人員 Hank 或 Duncan', 'error');
    $('maintainer').focus();
    return false;
  }
  setStatus('正在更新共用保養資料庫…');
  const result = await jsonp({
    action: 'complete',
    id: $('equipmentId').value.trim(),
    maintainer,
    early: isEarly ? '1' : '0'
  });
  if (!result.ok) throw new Error(result.error || '資料庫更新失敗');
  databaseUpdated = true;
  storedNextDate = result.nextPM;
  $('maintenanceDate').value = result.pmDate;
  $('nextDate').value = result.nextPM;
  drawLabel();
  setStatus(`資料庫已更新；下次保養 ${displayDate(result.nextPM)}`, 'ok');
  return true;
}

async function handleEarlyScan() {
  if (!storedNextDate || localISODate() >= storedNextDate) {
    earlyMaintenanceApproved = true;
    return;
  }

  const ok = window.confirm('未到保養期限，確定執行?');
  earlyMaintenanceApproved = ok;
  if (!ok) {
    setStatus(`已取消，資料庫未更新（原到期日 ${displayDate(storedNextDate)}）`, 'warn');
    return;
  }

  const maintainer = $('maintainer').value;
  if (maintainer) {
    try {
      await completeDatabasePM(true);
    } catch (e) {
      setStatus(`資料庫更新失敗：${e?.message || e}`, 'error');
    }
  } else {
    setStatus('已確認提前保養；請選擇保養人員，再按②完成更新與列印', 'warn');
  }
}

async function loadFromDatabase() {
  const p = new URLSearchParams(location.search);
  const id = p.get('id');
  const savedMaintainer = localStorage.getItem('b21-maintainer');
  if (savedMaintainer === 'Hank' || savedMaintainer === 'Duncan') $('maintainer').value = savedMaintainer;

  $('maintenanceDate').value = localISODate();
  drawLabel();
  if (!id) {
    setStatus('請掃描設備 QR Code 開啟本頁', 'error');
    return;
  }

  try {
    setStatus(`正在讀取設備 ${id}…`);
    const data = await jsonp({ action: 'get', id });
    if (!data.ok) throw new Error(data.error || `找不到設備 ${id}`);
    fillEquipment(data);
    setStatus(`已讀取 ${data.id} / ${data.name}`, 'ok');
    await handleEarlyScan();
  } catch (e) {
    setStatus(`資料讀取失敗：${e?.message || e}`, 'error');
  }
}

$('maintainer').addEventListener('change', () => {
  if ($('maintainer').value) localStorage.setItem('b21-maintainer', $('maintainer').value);
  drawLabel();
});

$('connectBtn').addEventListener('click', async () => {
  try {
    if (!navigator.bluetooth) throw new Error('此瀏覽器不支援 Web Bluetooth，請使用 Android Chrome 或電腦 Chrome/Edge');
    setStatus('正在開啟藍牙裝置選擇…');
    printer = new NiimbotBluetoothClient();
    const info = await printer.connect();
    setStatus(`已連接：${info.deviceName || 'B21 Pro'}`, 'ok');
    $('printBtn').disabled = false;
    $('disconnectBtn').disabled = false;
  } catch (e) {
    console.error(e); setStatus(`連線失敗：${e?.message || e}`, 'error'); printer = null;
  }
});

$('printBtn').addEventListener('click', async () => {
  if (!printer || !equipmentLoaded) return;
  if (!$('maintainer').value) {
    setStatus('請先選擇保養人員 Hank 或 Duncan', 'error');
    $('maintainer').focus();
    return;
  }

  const isEarly = storedNextDate && localISODate() < storedNextDate;
  if (isEarly && !earlyMaintenanceApproved) {
    if (!window.confirm('未到保養期限，確定執行?')) {
      setStatus('已取消，資料庫未更新', 'warn');
      return;
    }
    earlyMaintenanceApproved = true;
  }

  try {
    if (!databaseUpdated) {
      const updated = await completeDatabasePM(Boolean(isEarly));
      if (!updated) return;
    }

    let printTask = null;
    try {
      setStatus('資料庫已更新，正在列印…');
      drawLabel();
      const encoded = ImageEncoder.encodeCanvas(canvas, 'top');
      const printTaskName = printer.getPrintTaskType() ?? 'D110M_V4';
      printTask = printer.abstraction.newPrintTask(printTaskName, {
        totalPages: 1,
        statusPollIntervalMs: 100,
        statusTimeoutMs: 8000,
      });
      await printTask.printInit();
      await printTask.printPage(encoded, 1);
      await printTask.waitForPageFinished();
      await printTask.waitForFinished();
      setStatus(`保養完成、資料庫已更新、標籤已列印（${$('maintainer').value}）`, 'ok');
    } finally {
      if (printTask) { try { await printTask.printEnd(); } catch (_) {} }
    }
  } catch (e) {
    console.error(e);
    setStatus(`執行失敗：${e?.message || e}`, 'error');
  }
});

$('disconnectBtn').addEventListener('click', async () => {
  try { if (printer) await printer.disconnect(); } catch (_) {}
  printer = null;
  $('printBtn').disabled = true;
  $('disconnectBtn').disabled = true;
  setStatus('已中斷印表機連線');
});

loadFromDatabase();
