let receiptDatabase;
let receiptEditing = null;
let receiptPhoto = '';
let receiptUpdatedAt = null;
let receiptBusy = false;
let receiptRender = 0;

function openReceipts() {
  if (!receiptDatabase) receiptDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open('daily-time-tracker-receipts:' + new URL('./', location.href).pathname, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('receipts', {keyPath:'key'});
      store.createIndex('collection', 'collection');
    };
    request.onerror = () => { receiptDatabase = null; reject(request.error); };
    request.onblocked = () => { $('receiptStatus').textContent = 'Close other tracker tabs to finish opening receipt storage.'; };
    request.onsuccess = () => resolve(request.result);
  });
  return receiptDatabase;
}

async function receiptRecords(collection = state.receiptCollection) {
  const db = await openReceipts();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('receipts', 'readonly');
    const request = tx.objectStore('receipts').index('collection').getAll(collection);
    tx.oncomplete = () => resolve(request.result.map(({key, collection, ...receipt}) => receipt));
    tx.onabort = () => reject(tx.error);
  });
}

async function writeReceipt(receipt, expectedUpdatedAt, collection) {
  const db = await openReceipts();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('receipts', 'readwrite');
    const store = tx.objectStore('receipts');
    const key = collection + '/' + receipt.id;
    let conflict = false;
    const request = store.get(key);
    request.onsuccess = () => {
      if ((request.result?.updatedAt ?? null) !== expectedUpdatedAt) {
        conflict = true;
        tx.abort();
        return;
      }
      store.put({...receipt, collection, key});
    };
    tx.oncomplete = resolve;
    tx.onabort = () => reject(new Error(conflict ? 'This receipt changed in another tab. Reopen it before editing.' : 'Could not save the receipt. Check available device storage and try again.'));
  });
}

async function stageReceipts(receipts, collection) {
  const db = await openReceipts();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('receipts', 'readwrite');
    for (const receipt of receipts) tx.objectStore('receipts').put({...receipt, collection, key:collection + '/' + receipt.id});
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
}

function validReceipt(receipt, jobs) {
  const amount = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
  return receipt && typeof receipt.id === 'string' && /^[a-zA-Z0-9-]+$/.test(receipt.id)
    && jobs.includes(receipt.job) && typeof receipt.vendor === 'string' && receipt.vendor.trim().length > 0 && receipt.vendor.length <= 160
    && typeof receipt.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(receipt.date)
    && !Number.isNaN(Date.parse(receipt.date)) && new Date(receipt.date).toISOString().slice(0,10) === receipt.date
    && [receipt.subtotal, receipt.gst, receipt.pst].every(amount) && receipt.total !== null && amount(receipt.total)
    && typeof receipt.card === 'string' && /^(\d{4})?$/.test(receipt.card)
    && typeof receipt.category === 'string' && receipt.category.length <= 100
    && typeof receipt.notes === 'string' && receipt.notes.length <= 2000
    && typeof receipt.text === 'string' && receipt.text.length <= 20000
    && typeof receipt.photo === 'string' && (receipt.photo === '' || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(receipt.photo))
    && receipt.photo.length <= 3000000
    && Number.isSafeInteger(receipt.updatedAt) && receipt.updatedAt > 0
    && (receipt.deletedAt === null || Number.isSafeInteger(receipt.deletedAt) && receipt.deletedAt > 0);
}

function decimalCents(value, required = false) {
  const text = value.trim().replace(/[$,]/g, '');
  if (!text && !required) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Error('Enter dollar amounts with up to two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 1000000000) throw Error('Receipt amount is too large.');
  return cents;
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function receiptOptions(id, includeAll) {
  const select = $(id);
  const current = select.value;
  select.replaceChildren();
  if (includeAll) select.add(new Option('All jobs', ''));
  for (const job of state.jobs) select.add(new Option(job + (state.archived.includes(job) ? ' (archived)' : ''), job));
  select.value = state.jobs.includes(current) || includeAll && select.dataset.ready === 'yes' && current === '' ? current : state.job;
  select.dataset.ready = 'yes';
}

async function renderReceipts() {
  const generation = ++receiptRender;
  receiptOptions('receiptJob', false);
  receiptOptions('receiptFilter', true);
  receiptOptions('excelJob', true);
  $('saveReceipt').disabled = storageError || receiptBusy || !state.jobs.length;
  $('excelExport').disabled = storageError || receiptBusy;
  $('export').disabled = storageError || receiptBusy;
  try {
    const records = await receiptRecords();
    if (generation !== receiptRender) return;
    const filter = $('receiptFilter').value;
    const list = $('receiptList');
    list.replaceChildren();
    const visible = records.filter(receipt => !filter || receipt.job === filter).sort((a,b) => b.updatedAt - a.updatedAt);
    if (!visible.length) list.textContent = 'No receipts saved for this selection.';
    for (const receipt of visible) {
      const row = document.createElement('div');
      row.className = 'entry';
      row.textContent = receipt.job + ' · ' + receipt.date + ' · ' + receipt.vendor + ' · ' + money(receipt.total) + (receipt.deletedAt ? ' · Deleted' : '');
      if (receipt.card) {
        const card = document.createElement('small');
        card.textContent = 'Card ending ' + receipt.card;
        row.append(card);
      }
      if (!receipt.deletedAt) {
        const edit = document.createElement('button');
        edit.textContent = 'View / edit';
        edit.onclick = () => editReceipt(receipt);
        row.append(edit);
      }
      const remove = document.createElement('button');
      remove.textContent = receipt.deletedAt ? 'Restore receipt' : 'Delete receipt';
      remove.disabled = storageError || receiptBusy;
      remove.onclick = async () => {
        if (receiptBusy) return;
        receiptBusy = true;
        remove.disabled = true;
        try {
          await writeReceipt({...receipt, deletedAt:receipt.deletedAt ? null : Date.now(), updatedAt:Math.max(Date.now(), receipt.updatedAt + 1)}, receipt.updatedAt, state.receiptCollection);
          if (receiptEditing === receipt.id) resetReceipt();
          $('receiptStatus').textContent = receipt.deletedAt ? 'Receipt restored.' : 'Receipt moved to deleted receipts. Restore it here when needed.';
        } catch (error) { $('receiptStatus').textContent = error.message; }
        finally { receiptBusy = false; renderReceipts(); }
      };
      row.append(remove);
      list.append(row);
    }
  } catch {
    $('receiptStatus').textContent = 'Receipt storage is unavailable. Your time records are still accessible. Try a regular browser window with device storage enabled.';
    $('excelExport').disabled = true;
  }
}

function previewReceipt() {
  $('receiptPreview').hidden = !receiptPhoto;
  $('receiptPreview').src = receiptPhoto;
  $('scanReceipt').disabled = !receiptPhoto || receiptBusy;
}

function resetReceipt() {
  receiptEditing = null;
  receiptUpdatedAt = null;
  receiptPhoto = '';
  $('receiptForm').reset();
  $('receiptTitle').textContent = 'Add receipt';
  $('receiptDate').value = dayNow();
  $('receiptJob').value = state.job || state.jobs[0] || '';
  $('scanStatus').textContent = '';
  $('receiptStatus').textContent = '';
  previewReceipt();
}

function editReceipt(receipt) {
  if (receiptBusy) return;
  receiptEditing = receipt.id;
  receiptUpdatedAt = receipt.updatedAt;
  receiptPhoto = receipt.photo;
  $('receiptTitle').textContent = 'Edit receipt';
  $('receiptJob').value = receipt.job;
  for (const [field, property] of [['Vendor','vendor'],['Date','date'],['Card','card'],['Category','category'],['Notes','notes'],['Text','text']]) $('receipt' + field).value = receipt[property];
  for (const [field, property] of [['Subtotal','subtotal'],['GST','gst'],['PST','pst'],['Total','total']]) $('receipt' + field).value = receipt[property] === null ? '' : (receipt[property] / 100).toFixed(2);
  $('receiptsPanel').open = true;
  previewReceipt();
}

async function preparePhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw Error('Choose a photo or image of the receipt.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL('image/jpeg', 0.88);
    if (photo.length > 3000000) throw Error('This image is too large. Try a closer, cropped photo.');
    return photo;
  } finally { URL.revokeObjectURL(url); }
}

for (const id of ['receiptCamera', 'receiptFile']) $(id).onchange = async () => {
  const file = $(id).files[0];
  if (!file || receiptBusy) return;
  receiptBusy = true;
  $('receiptFields').disabled = true;
  try {
    receiptPhoto = await preparePhoto(file);
    $('scanStatus').textContent = 'Photo ready. Tap Scan receipt, then review the suggested fields.';
  } catch (error) { $('scanStatus').textContent = 'Could not read this photo. ' + error.message; }
  finally {
    receiptBusy = false;
    $('receiptFields').disabled = false;
    $(id).value = '';
    previewReceipt();
  }
};

function parseReceiptText(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const fields = {vendor:lines[0]?.slice(0,160) ?? ''};
  for (const line of lines) {
    const amounts = [...line.matchAll(/(?:\$\s*)?(\d[\d,]*\.\d{2})(?!\d)/g)];
    const amount = amounts.at(-1)?.[1].replace(/,/g, '');
    if (amount && /\bsub\s*total\b/i.test(line)) fields.subtotal = amount;
    if (amount && /\b(?:GST|HST)\b/i.test(line)) fields.gst = amount;
    if (amount && /\bPST\b/i.test(line)) fields.pst = amount;
    if (amount && /\b(?:grand\s+total|total|amount\s+(?:paid|due))\b/i.test(line) && !/sub\s*total|tax|savings|discount/i.test(line)) fields.total = amount;
    const card = line.match(/(?:[*xX•]{2,}[\s*-]*|\b(?:ending(?:\s+in)?|last\s*(?:four|4))\s*[:#-]?\s*)(\d{4})(?!\d)/i);
    if (card) fields.card = card[1];
    const date = line.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
    if (date) fields.date = date[1] + '-' + date[2].padStart(2,'0') + '-' + date[3].padStart(2,'0');
    const usDate = line.match(/\b(0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])[-/](20\d{2})\b/);
    if (usDate) fields.date = usDate[3] + '-' + usDate[1].padStart(2,'0') + '-' + usDate[2].padStart(2,'0');
  }
  return fields;
}

function applyReceiptText() {
  const fields = parseReceiptText($('receiptText').value);
  for (const [property, value] of Object.entries(fields)) {
    const field = {vendor:'Vendor',date:'Date',subtotal:'Subtotal',gst:'GST',pst:'PST',total:'Total',card:'Card'}[property];
    $('receipt' + field).value = value;
  }
}
$('applyScan').onclick = () => {
  applyReceiptText();
  $('scanStatus').textContent = 'Suggested fields applied. Review every field against the receipt before saving.';
};

let scannerScript;
async function scanWithTimeout(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Scanning timed out.')), 120000);
    })]);
  } finally { clearTimeout(timer); }
}

function loadScanner() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!scannerScript) scannerScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      script.remove(); scannerScript = null; reject(Error('Scanner download timed out.'));
    }, 30000);
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    script.onload = () => { clearTimeout(timeout); resolve(window.Tesseract); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); scannerScript = null; reject(Error('Scanner download failed.')); };
    document.head.append(script);
  });
  return scannerScript;
}

$('scanReceipt').onclick = async () => {
  if (!receiptPhoto || receiptBusy) return;
  receiptBusy = true;
  $('receiptFields').disabled = true;
  $('scanStatus').textContent = 'Loading scanner. The first scan may take a minute.';
  let worker;
  let finished = false;
  try {
    const scanner = await loadScanner();
    const pending = scanner.createWorker('eng', 1, {logger:message => {
      if (finished) return;
      $('scanStatus').textContent = 'Scanning · ' + message.status + ' ' + Math.round((message.progress ?? 0) * 100) + '%';
    }});
    pending.then(created => { if (finished) created.terminate().catch(() => {}); }).catch(() => {});
    worker = await scanWithTimeout(pending);
    const result = await scanWithTimeout(worker.recognize(receiptPhoto));
    $('receiptText').value = result.data.text.slice(0,20000);
    applyReceiptText();
    $('scanStatus').textContent = 'Scan complete. Review the supplier, date, tax, total and card last four before saving. You can edit every field.';
  } catch {
    $('scanStatus').textContent = 'Scanning is unavailable. Check your connection or enter the fields manually. The photo can still be saved.';
  } finally {
    finished = true;
    if (worker) { try { await worker.terminate(); } catch {} }
    receiptBusy = false;
    $('receiptFields').disabled = false;
    previewReceipt();
  }
};

$('receiptForm').onsubmit = async event => {
  event.preventDefault();
  if (receiptBusy || storageError) return;
  receiptBusy = true;
  $('receiptFields').disabled = true;
  try {
    const receipt = {
      id:receiptEditing ?? crypto.randomUUID(), job:$('receiptJob').value,
      vendor:$('receiptVendor').value.trim(), date:$('receiptDate').value,
      subtotal:decimalCents($('receiptSubtotal').value), gst:decimalCents($('receiptGST').value),
      pst:decimalCents($('receiptPST').value), total:decimalCents($('receiptTotal').value, true),
      card:$('receiptCard').value.trim(), category:$('receiptCategory').value.trim(),
      notes:$('receiptNotes').value.trim(), text:$('receiptText').value, photo:receiptPhoto,
      updatedAt:Math.max(Date.now(), (receiptUpdatedAt ?? 0) + 1), deletedAt:null
    };
    if (!validReceipt(receipt, state.jobs)) throw Error('Check the job, supplier, date, amounts, and four-digit card ending.');
    await writeReceipt(receipt, receiptUpdatedAt, state.receiptCollection);
    resetReceipt();
    $('receiptStatus').textContent = 'Receipt saved to ' + receipt.job + '.';
  } catch (error) { $('receiptStatus').textContent = error.message; }
  finally { receiptBusy = false; $('receiptFields').disabled = false; renderReceipts(); }
};
$('cancelReceipt').onclick = () => { if (!receiptBusy) resetReceipt(); };
$('receiptFilter').onchange = renderReceipts;

$('excelExport').onclick = async () => {
  if (receiptBusy || storageError) return;
  receiptBusy = true;
  $('excelExport').disabled = true;
  const snapshot = JSON.parse(JSON.stringify(state));
  const job = $('excelJob').value;
  try {
    const receipts = await receiptRecords(snapshot.receiptCollection);
    const sheets = jobExportSheets(snapshot, receipts, job);
    const bytes = excelWorkbook(sheets);
    const name = (job || 'All jobs').replace(/[^a-zA-Z0-9 -]/g, '_');
    downloadFile(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), name + ' - ' + dayNow() + '.xlsx');
    $('excelStatus').textContent = 'Excel report downloaded. Running sessions will appear after they are paused or finished.';
  } catch { $('excelStatus').textContent = 'Could not export. Check receipt storage and try again.'; }
  finally { receiptBusy = false; $('excelExport').disabled = false; }
};

// Receipt collections are staged before switching the local state pointer. A failed
// restore therefore leaves the current time records and receipt collection intact.
$('export').onclick = async () => {
  if (receiptBusy || storageError) return;
  receiptBusy = true;
  $('export').disabled = true;
  const snapshot = JSON.parse(JSON.stringify(state));
  try {
    const receipts = await receiptRecords(snapshot.receiptCollection);
    downloadFile(new Blob([JSON.stringify({version:3, state:snapshot, receipts}, null, 2)], {type:'application/json'}), 'daily-time-tracker-' + dayNow() + '.json');
    $('status').textContent = 'Backup downloaded with all jobs, time entries and receipt photos, including deleted receipts.';
  } catch { $('status').textContent = 'Backup could not read receipt storage. Try again before relying on a new backup.'; }
  finally { receiptBusy = false; $('export').disabled = storageError; }
};

$('import').onchange = async () => {
  const file = $('import').files[0];
  $('import').value = '';
  if (!file || receiptBusy) return;
  receiptBusy = true;
  try {
    const backup = JSON.parse(await file.text());
    const restored = migrate(backup.state);
    if (![1,2,3].includes(backup.version) || !valid(restored)) throw Error('This file is not a valid tracker backup.');
    const receipts = backup.version === 3 ? backup.receipts : [];
    if (!Array.isArray(receipts) || !receipts.every(receipt => validReceipt(receipt, restored.jobs)) || new Set(receipts.map(receipt => receipt.id)).size !== receipts.length) throw Error('Receipt records in this backup are invalid.');
    if (!confirm('Replace the jobs, time entries and receipts currently loaded on this device with this backup?')) return;
    restored.receiptCollection = crypto.randomUUID();
    await stageReceipts(receipts, restored.receiptCollection);
    if (commit(restored, storageError ? null : state, 'Backup restored with receipt photos.', true)) {
      resetForm(); resetReceipt();
      $('reportDate').value = state.lastFinished ?? dayNow();
      renderReport();
    }
  } catch (error) { $('status').textContent = 'Restore failed. ' + error.message; }
  finally { receiptBusy = false; renderReceipts(); }
};

resetReceipt();
renderReceipts();
