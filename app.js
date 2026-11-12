const $ = id => document.getElementById(id);
const workers = [{name:'Graham', rate:5875}, {name:'Hayden', rate:3625}];
const key = 'daily-time-tracker:' + new URL('./', location.href).pathname;
const initial = {job:'', active:null, entries:[]};
let state = initial;
let previous = null;
let editing = null;
let storageError = false;

function valid(data) {
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const time = value => Number.isSafeInteger(value) && value > 0 && value <= Date.now();
  return data && typeof data.job === 'string' && (data.active === null || date(data.active))
    && Array.isArray(data.entries) && data.entries.every(entry => entry && workers[entry.worker]
      && Number.isInteger(entry.worker) && date(entry.day) && time(entry.start)
      && (entry.end === null ? entry.day === data.active : time(entry.end) && entry.end >= entry.start)
      && Array.isArray(entry.notes) && entry.notes.every(note => typeof note === 'string'))
    && !data.entries.some((entry, i) => data.entries.slice(i + 1).some(other =>
      entry.worker === other.worker && entry.start < (other.end ?? Infinity)
      && other.start < (entry.end ?? Infinity)));
}

try {
  const saved = JSON.parse(localStorage.getItem(key));
  if (saved !== null) {
    if (!valid(saved.state) || (saved.previous !== null && !valid(saved.previous))) throw Error();
    ({state, previous} = saved);
  }
} catch {
  storageError = true;
  $('status').textContent = 'Stored records could not be read. Restore a known backup if available.';
}

function commit(next, undo, message, restore = false) {
  try {
    if (storageError && !restore) throw Error();
    localStorage.setItem(key, JSON.stringify({state:next, previous:undo}));
  } catch {
    $('status').textContent = 'Could not save. No changes were applied.';
    return false;
  }
  state = next;
  previous = undo;
  storageError = false;
  $('status').textContent = message;
  render();
  return true;
}

function update(change, message) {
  const next = JSON.parse(JSON.stringify(state));
  change(next, Date.now());
  return commit(next, state, message);
}

function localTime(ms) {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0,19);
}

function dayNow() { return localTime(Date.now()).slice(0,10); }
const money = cents => '$' + (Math.round(cents) / 100).toFixed(2);
const duration = ms => {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2,'0')).join(':');
};
const running = worker => state.entries.some(entry => entry.worker === worker && entry.end === null);
const stop = (next, now, worker) => next.entries.forEach(entry => {
  if (entry.end === null && (worker === undefined || entry.worker === worker)) entry.end = Math.max(now, entry.start);
});
const start = (next, now, worker) => next.entries.push({worker, day:next.active, start:now, end:null, notes:[]});

workers.forEach(({name,rate}, i) => {
  const card = document.createElement('section');
  card.innerHTML = '<h2>' + name + '</h2><small>' + money(rate) + '/hr</small>'
    + '<div class="row"><output id="time' + i + '"></output><button id="toggle' + i + '"></button></div>';
  $('workers').append(card);
  $('worker').add(new Option(name, i));
  $('toggle' + i).onclick = () => {
    const wasRunning = running(i);
    update((next, now) => wasRunning ? stop(next, now, i) : start(next, now, i),
      name + (wasRunning ? ' paused.' : ' resumed.'));
  };
});

function totals() {
  const now = Date.now();
  const day = state.active ?? dayNow();
  let daily = 0;
  let total = 0;
  const times = [0,0];
  for (const entry of state.entries) {
    const ms = Math.max(0,(entry.end ?? now) - entry.start);
    const cents = ms * workers[entry.worker].rate / 3600000;
    total += cents;
    if (entry.day === day) {
      daily += cents;
      times[entry.worker] += ms;
    }
  }
  $('dayLabel').textContent = 'Daily billable · ' + day;
  $('daily').textContent = money(daily);
  $('total').textContent = money(total);
  times.forEach((ms,i) => $('time'+i).textContent = duration(ms));
}

function resetForm() {
  editing = null;
  $('manual').reset();
  $('date').value = dayNow();
  $('formTitle').textContent = 'Add past work';
  $('cancel').hidden = true;
}

function render() {
  $('job').value = state.job;
  $('job').disabled = storageError || state.active !== null || state.entries.length > 0;
  $('start').disabled = storageError || !state.job || state.active !== null;
  $('pause').disabled = storageError || !workers.some((_, i) => running(i));
  $('finish').disabled = storageError || state.active === null;
  $('undo').disabled = storageError || previous === null;
  $('export').disabled = storageError;
  workers.forEach((_, i) => {
    $('toggle'+i).textContent = running(i) ? 'Pause' : 'Resume';
    $('toggle'+i).disabled = storageError || state.active === null;
  });
  $('history').replaceChildren();
  state.entries.map((entry, index) => ({entry,index})).sort((a,b) => b.entry.start-a.entry.start)
    .forEach(({entry,index}) => {
      if (entry.end === null) return;
      const row = document.createElement('div');
      row.className = 'entry';
      row.textContent = workers[entry.worker].name + ' · ' + entry.day + ' · ' + duration(entry.end-entry.start);
      const times = document.createElement('small');
      times.textContent = new Date(entry.start).toLocaleString() + ' → ' + new Date(entry.end).toLocaleString();
      row.append(times);
      for (const note of entry.notes) {
        const text = document.createElement('small');
        text.textContent = note;
        row.append(text);
      }
      const edit = document.createElement('button');
      edit.textContent = 'Edit';
      edit.onclick = () => {
        editing = index;
        $('formTitle').textContent = 'Edit work segment';
        $('cancel').hidden = false;
        $('worker').value = entry.worker;
        $('date').value = entry.day;
        $('from').value = localTime(entry.start);
        $('to').value = localTime(entry.end);
        $('note').value = '';
        $('from').focus();
      };
      row.append(edit);
      $('history').append(row);
    });
  totals();
}

$('job').onchange = () => update(next => {next.job = $('job').value.trim();}, 'Job saved.');
$('start').onclick = () => {
  resetForm();
  update((next, now) => {
    next.active = localTime(now).slice(0,10);
    workers.forEach((_, i) => start(next, now, i));
  }, 'Both timers started.');
};
$('pause').onclick = () => update((next, now) => stop(next, now), 'Both timers paused.');
$('finish').onclick = () => update((next, now) => {
  stop(next, now);
  next.active = null;
}, 'Day saved.');
$('undo').onclick = () => {
  if (commit(previous, null, 'Last action undone.')) resetForm();
};
$('cancel').onclick = resetForm;
$('manual').onsubmit = event => {
  event.preventDefault();
  const worker = Number($('worker').value);
  const startTime = Date.parse($('from').value);
  const end = Date.parse($('to').value);
  const note = $('note').value.trim();
  const day = $('date').value;
  if (!state.job || !note || !Number.isFinite(startTime) || end <= startTime || end > Date.now()) {
    $('status').textContent = 'Enter a job, a past time range and a correction note.';
    return;
  }
  const old = state.entries[editing];
  const entry = {worker, day, start:startTime, end, notes:[...(old?.notes ?? []), note]};
  const next = JSON.parse(JSON.stringify(state));
  if (editing === null) next.entries.push(entry);
  else next.entries[editing] = entry;
  if (!valid(next)) {
    $('status').textContent = 'Check the dates and make sure this worker’s time does not overlap another segment.';
    return;
  }
  if (commit(next, state, 'Entry saved.')) resetForm();
};

$('export').onclick = () => {
  const backup = new Blob([JSON.stringify({version:1, state}, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(backup);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'daily-time-tracker-' + dayNow() + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
$('import').onchange = async () => {
  const file = $('import').files[0];
  $('import').value = '';
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.version !== 1 || !valid(backup.state)) throw Error();
    if (confirm('Replace the records on this device with this backup?')) {
      if (commit(backup.state, storageError ? null : state, 'Backup restored.', true)) resetForm();
    }
  } catch {
    $('status').textContent = 'This file is not a valid tracker backup.';
  }
};
window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) location.reload();
});
resetForm();
render();
setInterval(totals, 1000);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => { $('offline').textContent = 'Ready for offline use'; })
    .catch(() => { $('offline').textContent = 'Offline setup failed. Open the published HTTPS address.'; });
} else {
  $('offline').textContent = 'Open the published HTTPS address to enable offline use.';
}
