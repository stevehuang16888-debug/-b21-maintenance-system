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
let busy = false;

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
      clearTimeout(timer); delete window[callback]; script.remove();
      error ? reject(error) : resolve(value);
    }
    window[callback] = data => cleanup(null, data);
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
function setStatus(text, type='') { $('status').textContent = text; $('status').className = `status ${type}`; }
function fillEquipment(data) {
  $('equipmentId').value = data.id || '';
  $('equipmentName').value = data.name || '';
  $('intervalMonths').value = data.interval || 1;
  storedNextDate = data.nextPM || '';
  $('maintenanceDate').value = localISODate();
  $('nextDate').value = data.calculatedNextPM || '';
  equipmentLoaded = true; databaseUpdated = false;
  drawLabel();
}

async function updateDatabase() {
  const maintainer = $('maintainer').value;
  const result = await jsonp({ action:'complete', id:$('equipmentId').value.trim(), maintainer });
  if (!result.ok) throw new Error(result.error || '資料庫更新失敗');
  databaseUpdated = true; storedNextDate = result.nextPM;
  $('maintenanceDate').value = result.pmDate; $('nextDate').value = result.nextPM;
  drawLabel();
  return result;
}

function askEarlyMaintenanceIfNeeded() {
  if (!storedNextDate || localISODate() >= storedNextDate) {
    earlyMaintenanceApproved = true; return true;
  }
  const ok = window.confirm('未到保養期限，確定執行?');
  earlyMaintenanceApproved = ok;
  setStatus(ok ? `已確認提前保養（原到期日 ${displayDate(storedNextDate)}）；資料庫尚未更新` : `已取消，資料庫未更新（原到期日 ${displayDate(storedNextDate)}）`, 'warn');
  return ok;
}

async function loadFromDatabase() {
  const p = new URLSearchParams(location.search);
  const id = p.get('id');
  const savedMaintainer = localStorage.getItem('b21-maintainer');
  if (savedMaintainer === 'Hank' || savedMaintainer === 'Duncan') $('maintainer').value = savedMaintainer;
  $('maintenanceDate').value = localISODate(); drawLabel();
  if (!id) { setStatus('請掃描設備 QR Code 開啟本頁', 'error'); return; }
  try {
    setStatus(`正在讀取設備 ${id}…`);
    const data = await jsonp({ action:'get', id });
    if (!data.ok) throw new Error(data.error || `找不到設備 ${id}`);
    fillEquipment(data);
    setStatus(`已讀取 ${data.id} / ${data.name}`, 'ok');
    askEarlyMaintenanceIfNeeded();
  } catch (e) { setStatus(`資料讀取失敗：${e?.message || e}`, 'error'); }
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
    $('printBtn').disabled = false; $('disconnectBtn').disabled = false;
  } catch (e) { console.error(e); setStatus(`連線失敗：${e?.message || e}`, 'error'); printer = null; }
});

$('printBtn').addEventListener('click', async () => {
  if (busy || !printer || !equipmentLoaded) return;
  if (!$('maintainer').value) { setStatus('請先選擇保養人員 Hank 或 Duncan', 'error'); $('maintainer').focus(); return; }

  const isEarly = storedNextDate && localISODate() < storedNextDate;
  if (isEarly && !earlyMaintenanceApproved && !askEarlyMaintenanceIfNeeded()) return;
  if (!window.confirm(`確定完成 ${$('equipmentId').value} 保養並列印標籤？\n保養人員：${$('maintainer').value}`)) {
    setStatus('已取消，資料庫未更新', 'warn'); return;
  }

  busy = true; $('printBtn').disabled = true;
  let printTask = null;
  try {
    // 先列印。只有 B21 Pro 回報列印完成後才寫入 Google Sheet。
    setStatus('正在列印標籤；資料庫尚未更新…');
    drawLabel();
    const encoded = ImageEncoder.encodeCanvas(canvas, 'top');
    const printTaskName = printer.getPrintTaskType() ?? 'D110M_V4';
    printTask = printer.abstraction.newPrintTask(printTaskName, { totalPages:1, statusPollIntervalMs:100, statusTimeoutMs:8000 });
    await printTask.printInit();
    await printTask.printPage(encoded, 1);
    await printTask.waitForPageFinished();
    await printTask.waitForFinished();
    try { await printTask.printEnd(); } catch (_) {}
    printTask = null;

    setStatus('標籤已列印，正在更新共用資料庫…');
    const result = await updateDatabase();
    setStatus(`保養完成：${$('maintainer').value}；下次保養 ${displayDate(result.nextPM)}`, 'ok');
  } catch (e) {
    console.error(e);
    if (printTask) { try { await printTask.printEnd(); } catch (_) {} }
    setStatus(`執行失敗：${e?.message || e}。請確認 Google Sheet 後再重試，避免重複紀錄。`, 'error');
  } finally {
    busy = false; $('printBtn').disabled = !printer;
  }
});

$('disconnectBtn').addEventListener('click', async () => {
  try { if (printer) await printer.disconnect(); } catch (_) {}
  printer = null; $('printBtn').disabled = true; $('disconnectBtn').disabled = true;
  setStatus('已中斷印表機連線');
});

loadFromDatabase();
