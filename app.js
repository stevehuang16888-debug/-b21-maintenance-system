import {
  NiimbotBluetoothClient,
  ImageEncoder,
} from "https://esm.sh/@mmote/niimbluelib@0.0.1-alpha.42?bundle";

const $ = (id) => document.getElementById(id);
const canvas = $('labelCanvas');
const ctx = canvas.getContext('2d');
let printer = null;
let storedNextDate = '';
let earlyMaintenanceApproved = true;

function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addMonths(dateString, months) {
  const [y,m,d] = dateString.split('-').map(Number);
  const result = new Date(y, m - 1 + Number(months), d);
  if (result.getDate() !== d) result.setDate(0);
  return localISODate(result);
}

function displayDate(s) { return s ? s.replaceAll('-', '/') : ''; }

function drawLabel() {
  const id = $('equipmentId').value.trim() || 'EQ-001';
  const maintained = displayDate($('maintenanceDate').value);
  const next = displayDate($('nextDate').value);
  const maintainer = $('maintainer').value || '---';

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 354, 177);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 350, 173);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`設備 ${id}`, 12, 24);
  ctx.font = '20px sans-serif';
  ctx.fillText(`保養 ${maintained}`, 12, 62);
  ctx.fillText(`下次 ${next}`, 12, 99);
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`人員 ${maintainer}`, 12, 138);
}

function updateDates() {
  const date = $('maintenanceDate').value;
  const months = Math.max(1, Number($('intervalMonths').value) || 1);
  if (date) $('nextDate').value = addMonths(date, months);
  drawLabel();
}

function setStatus(text, type='') {
  $('status').textContent = text;
  $('status').className = `status ${type}`;
}

function checkEarlyMaintenance() {
  if (!storedNextDate) {
    earlyMaintenanceApproved = true;
    return true;
  }

  const today = localISODate();
  if (today >= storedNextDate) {
    earlyMaintenanceApproved = true;
    return true;
  }

  const ok = window.confirm('未到保養期限，確定執行?');
  earlyMaintenanceApproved = ok;
  if (ok) {
    setStatus(`已確認提前保養（原到期日 ${displayDate(storedNextDate)}）`, 'warn');
  } else {
    setStatus(`已取消，本次不更新資料庫（原到期日 ${displayDate(storedNextDate)}）`, 'warn');
  }
  return ok;
}

function loadFromQR() {
  const p = new URLSearchParams(location.search);
  if (p.get('id')) $('equipmentId').value = p.get('id');
  if (p.get('name')) $('equipmentName').value = p.get('name');
  if (p.get('months')) $('intervalMonths').value = p.get('months');
  if (p.get('next')) storedNextDate = p.get('next');

  const savedMaintainer = localStorage.getItem('b21-maintainer');
  if (savedMaintainer === 'Hank' || savedMaintainer === 'Duncan') {
    $('maintainer').value = savedMaintainer;
  }

  $('maintenanceDate').value = localISODate();
  updateDates();

  if (storedNextDate && localISODate() < storedNextDate) {
    setTimeout(checkEarlyMaintenance, 250);
  }
}

['equipmentId','equipmentName'].forEach(id => $(id).addEventListener('input', drawLabel));
['intervalMonths','maintenanceDate'].forEach(id => $(id).addEventListener('change', updateDates));
$('maintainer').addEventListener('change', () => {
  if ($('maintainer').value) localStorage.setItem('b21-maintainer', $('maintainer').value);
  drawLabel();
});

$('connectBtn').addEventListener('click', async () => {
  try {
    if (!navigator.bluetooth) throw new Error('此瀏覽器不支援 Web Bluetooth，請使用 Chrome 或 Edge');
    setStatus('正在開啟藍牙裝置選擇…');
    printer = new NiimbotBluetoothClient();
    const info = await printer.connect();
    setStatus(`已連接：${info.deviceName || 'B21 Pro'}`, 'ok');
    $('printBtn').disabled = false;
    $('disconnectBtn').disabled = false;
  } catch (e) {
    console.error(e);
    setStatus(`連線失敗：${e?.message || e}`, 'error');
    printer = null;
  }
});

$('printBtn').addEventListener('click', async () => {
  if (!printer) return;
  if (!$('maintainer').value) {
    setStatus('請先選擇保養人員 Hank 或 Duncan', 'error');
    $('maintainer').focus();
    return;
  }
  if (!earlyMaintenanceApproved && !checkEarlyMaintenance()) return;

  let printTask = null;
  try {
    drawLabel();
    setStatus('正在準備列印…');

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
    setStatus('列印完成；資料庫接上後會在這一步同步寫入保養紀錄', 'ok');
  } catch (e) {
    console.error(e);
    setStatus(`列印失敗：${e?.message || e}`, 'error');
  } finally {
    if (printTask) {
      try { await printTask.printEnd(); } catch (_) {}
    }
  }
});

$('disconnectBtn').addEventListener('click', async () => {
  try { if (printer) await printer.disconnect(); } catch (_) {}
  printer = null;
  $('printBtn').disabled = true;
  $('disconnectBtn').disabled = true;
  setStatus('已中斷印表機連線');
});

loadFromQR();
setStatus('B21 Pro 通訊模組已載入，可以連線', 'ok');
