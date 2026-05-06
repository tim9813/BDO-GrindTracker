// ==================== Storage ====================
const STORAGE_KEY = 'BDO-GrindTracker:v1';
const LEGACY_STORAGE_KEY = 'garmoth-clone:v1';
const TAX = 0.155;

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { spots: [], items: [], classes: [], sessions: [] };
    const storeData = sanitizeStoreData(migrateStoreData(JSON.parse(raw)));
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw && raw !== legacyRaw) {
      restoreImagesFromStore(storeData, sanitizeStoreData(migrateStoreData(JSON.parse(legacyRaw))));
    }
    return storeData;
  } catch {
    return { spots: [], items: [], classes: [], sessions: [] };
  }
}
function saveStore() { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
const store = loadStore();

// ==================== Helpers ====================
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function clampNumber(value, min = 0, max = Infinity) {
  const n = Number(value);
  if (!isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function migrateStoreData(data) {
  const p = data && typeof data === 'object' ? data : {};
  const items = Array.isArray(p.items) ? [...p.items] : [];
  const spots = (Array.isArray(p.spots) ? p.spots : []).map(s => {
    if (!s || typeof s !== 'object') return {};
    // Migrate old per-spot items[] into shared library + itemIds[].
    if (Array.isArray(s.items) && !Array.isArray(s.itemIds)) {
      const ids = [];
      for (const it of s.items) {
        if (!it || typeof it !== 'object') continue;
        let existing = items.find(x => x && x.name === it.name);
        if (!existing) {
          existing = {
            id: it.id || uid(),
            name: it.name,
            imageUrl: it.imageUrl || '',
            price: Number(it.price) || 0,
            taxable: !!it.taxable,
          };
          items.push(existing);
        }
        ids.push(existing.id);
      }
      return { id: s.id, name: s.name, iconUrl: s.iconUrl || null, itemIds: ids };
    }
    return { id: s.id, name: s.name, iconUrl: s.iconUrl || null, itemIds: Array.isArray(s.itemIds) ? s.itemIds : [] };
  });
  return {
    spots,
    items,
    classes: Array.isArray(p.classes) ? p.classes : [],
    sessions: Array.isArray(p.sessions) ? p.sessions : [],
  };
}

function safeText(value, maxLength = 160) {
  return String(value ?? '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, maxLength);
}

function safeImageUrl(value) {
  const raw = String(value ?? '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 2_000_000);
  if (!raw) return '';
  const normalized = normalizeImageUrl(raw);
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=_-]+$/i.test(normalized)) return normalized;
  try {
    const url = new URL(normalized, document.baseURI);
    return (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'file:') ? url.href : '';
  } catch {
    return '';
  }
}

function shouldRestoreImage(value) {
  return !value || (String(value).startsWith('data:image/') && String(value).length <= 4096);
}

function restoreImagesFromStore(target, source) {
  const sourceItemsById = new Map(source.items.map(it => [it.id, it]));
  const sourceItemsByName = new Map(source.items.map(it => [it.name, it]));
  for (const it of target.items) {
    const src = sourceItemsById.get(it.id) || sourceItemsByName.get(it.name);
    if (src?.imageUrl && shouldRestoreImage(it.imageUrl)) it.imageUrl = src.imageUrl;
  }

  const sourceSpotsById = new Map(source.spots.map(s => [s.id, s]));
  const sourceSpotsByName = new Map(source.spots.map(s => [s.name, s]));
  for (const spot of target.spots) {
    const src = sourceSpotsById.get(spot.id) || sourceSpotsByName.get(spot.name);
    if (src?.iconUrl && shouldRestoreImage(spot.iconUrl)) spot.iconUrl = src.iconUrl;
  }

  const sourceClassesById = new Map(source.classes.map(c => [c.id, c]));
  const sourceClassesByName = new Map(source.classes.map(c => [c.name, c]));
  for (const cls of target.classes) {
    const src = sourceClassesById.get(cls.id) || sourceClassesByName.get(cls.name);
    if (src?.imageUrl && shouldRestoreImage(cls.imageUrl)) cls.imageUrl = src.imageUrl;
  }

  const sourceSessionsById = new Map(source.sessions.map(s => [s.id, s]));
  for (const session of target.sessions) {
    const src = sourceSessionsById.get(session.id);
    if (src?.spotIconUrl && shouldRestoreImage(session.spotIconUrl)) session.spotIconUrl = src.spotIconUrl;
  }
}

function safeId(value, prefix, idMap, usedIds) {
  const key = String(value ?? '');
  if (idMap.has(key)) return idMap.get(key);
  const cleaned = safeText(value, 80).replace(/[^a-z0-9_-]/gi, '');
  let id = cleaned || `${prefix}_${uid()}`;
  while (usedIds.has(id)) id = `${prefix}_${uid()}`;
  usedIds.add(id);
  idMap.set(key, id);
  return id;
}

function uniqueById(list) {
  const seen = new Set();
  return list.filter(entry => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function sanitizeStoreData(data) {
  const p = data && typeof data === 'object' ? data : {};
  const itemIdMap = new Map();
  const spotIdMap = new Map();
  const classIdMap = new Map();
  const usedIds = new Set();

  const items = uniqueById((Array.isArray(p.items) ? p.items : [])
    .filter(it => it && typeof it === 'object')
    .map(it => ({
      id: safeId(it.id, 'item', itemIdMap, usedIds),
      name: safeText(it.name, 120) || 'Untitled item',
      imageUrl: safeImageUrl(it.imageUrl),
      price: Math.round(clampNumber(it.price, 0, Number.MAX_SAFE_INTEGER)),
      taxable: !!it.taxable,
    })));

  const itemIds = new Set(items.map(it => it.id));
  const spots = uniqueById((Array.isArray(p.spots) ? p.spots : [])
    .filter(s => s && typeof s === 'object')
    .map(s => ({
      id: safeId(s.id, 'spot', spotIdMap, usedIds),
      name: safeText(s.name, 120) || 'Untitled spot',
      iconUrl: safeImageUrl(s.iconUrl) || null,
      itemIds: (Array.isArray(s.itemIds) ? s.itemIds : [])
        .map(id => itemIdMap.get(String(id ?? '')))
        .filter(id => id && itemIds.has(id)),
    })));

  const classes = uniqueById((Array.isArray(p.classes) ? p.classes : [])
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      id: safeId(c.id, 'class', classIdMap, usedIds),
      name: safeText(c.name, 120) || 'Untitled class',
      imageUrl: safeImageUrl(c.imageUrl || c.iconUrl) || null,
    })));

  const itemById = new Map(items.map(it => [it.id, it]));
  const sessions = uniqueById((Array.isArray(p.sessions) ? p.sessions : [])
    .filter(s => s && typeof s === 'object')
    .map(s => {
      const loot = {};
      for (const [rawItemId, qty] of Object.entries(s.loot || {})) {
        const itemId = itemIdMap.get(String(rawItemId));
        if (!itemId || !itemById.has(itemId)) continue;
        const cleanQty = Math.floor(clampNumber(qty, 0, Number.MAX_SAFE_INTEGER));
        if (cleanQty > 0) loot[itemId] = (loot[itemId] || 0) + cleanQty;
      }

      const hours = Math.floor(clampNumber(s.hours, 0, Number.MAX_SAFE_INTEGER));
      const mins = Math.floor(clampNumber(s.mins, 0, 59));
      const secs = Math.floor(clampNumber(s.secs, 0, 59));
      const totalHours = hours + mins / 60 + secs / 3600;
      const applyTax = s.applyTax !== false;
      let totalSilver = 0;
      for (const [itemId, qty] of Object.entries(loot)) {
        const it = itemById.get(itemId);
        let revenue = it.price * qty;
        if (applyTax && it.taxable) revenue *= (1 - TAX);
        totalSilver += revenue;
      }

      const createdAt = Number.isFinite(new Date(s.createdAt).getTime()) ? new Date(s.createdAt).toISOString() : new Date().toISOString();
      return {
        id: safeId(s.id, 'session', new Map(), usedIds),
        createdAt,
        spotId: spotIdMap.get(String(s.spotId ?? '')) || null,
        spotName: safeText(s.spotName, 120) || 'Unknown spot',
        spotIconUrl: safeImageUrl(s.spotIconUrl) || null,
        classId: classIdMap.get(String(s.classId ?? '')) || null,
        hours,
        mins,
        secs,
        totalHours,
        dropRatePct: clampNumber(s.dropRatePct, 0, Number.MAX_SAFE_INTEGER),
        applyTax,
        loot,
        notes: safeText(s.notes, 1000),
        totalSilver,
        silverPerHour: totalHours > 0 ? totalSilver / totalHours : 0,
      };
    }));

  return { spots, items, classes, sessions };
}

function colorFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 35%)`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
const escapeAttr = escapeHtml;

function normalizeImageUrl(url) {
  if (!url) return url;
  const u = url.trim();
  // Google Drive viewer/open URLs → thumbnail (file must be shared publicly)
  let m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([^\/?&]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w256`;
  m = u.match(/drive\.google\.com\/uc\?(?:[^#]*&)?id=([^&]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w256`;
  return u;
}

function avatarHTML(thing, size = 32, rounded = 'rounded-md') {
  const px = `${size}px`;
  const letter = (thing.name?.[0] || '?').toUpperCase();
  const fallback = `<div class="${rounded} flex items-center justify-center text-xs font-bold text-white shrink-0" style="width:${px};height:${px};background:${colorFor(thing.name || '')}">${escapeHtml(letter)}</div>`;
  const url = normalizeImageUrl(thing.iconUrl || thing.imageUrl);
  if (url) {
    const onerr = escapeAttr(`this.outerHTML=${JSON.stringify(fallback)}`);
    return `<img src="${escapeAttr(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:${px};height:${px}" class="${rounded} object-cover bg-panel2 shrink-0" onerror="${onerr}">`;
  }
  return fallback;
}

function fmtSilver(n) {
  if (!isFinite(n) || n === 0) return '0';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return Math.round(n).toString();
}

function fmtSilverFull(n) {
  if (!isFinite(n) || n === 0) return '0';
  return Math.round(n).toLocaleString('en-US');
}

function fmtHours(totalHours) {
  if (!isFinite(totalHours) || totalHours <= 0) return '0h';
  const totalMinutes = Math.round(totalHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtSessionDuration(hours = 0, mins = 0, secs = 0) {
  const h = Math.floor(clampNumber(hours));
  const m = Math.floor(clampNumber(mins, 0, 59));
  const s = Math.floor(clampNumber(secs, 0, 59));
  if (s > 0) return `${h}h ${m}m ${s}s`;
  return `${h}h ${m}m`;
}

function closeModal(id) { $('#' + id).classList.add('hidden'); }
function openModal(id)  { $('#' + id).classList.remove('hidden'); }

// ==================== Image upload (drag/drop/paste) ====================
function resizeImageFile(file, maxSize = 128) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image'));
      img.onload = () => {
        let { naturalWidth: w, naturalHeight: h } = img;
        if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
        else if (h > maxSize)     { w = Math.round(w * maxSize / h); h = maxSize; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const webp = canvas.toDataURL('image/webp', 0.85);
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function bindImageInput(input) {
  if (!input || input.dataset.imgBound === '1') return;
  input.dataset.imgBound = '1';

  const drop = async file => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const url = await resizeImageFile(file);
      input.value = url;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) { console.error('Image upload failed:', err); }
  };

  input.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    input.classList.add('ring-2', 'ring-accent2');
  });
  input.addEventListener('dragleave', () => input.classList.remove('ring-2', 'ring-accent2'));
  input.addEventListener('drop', e => {
    e.preventDefault();
    input.classList.remove('ring-2', 'ring-accent2');
    drop(e.dataTransfer.files[0]);
  });
  input.addEventListener('paste', e => {
    const items = e.clipboardData?.items || [];
    const imgItem = [...items].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (!imgItem) return; // text URLs fall through to native paste
    e.preventDefault();
    drop(imgItem.getAsFile());
  });
}

// ==================== App state ====================
const state = { view: 'spot', range: 'all' };

// ==================== View Switching ====================
function setView(name) {
  state.view = name;
  $$('.view-tab').forEach(b => {
    const active = b.dataset.view === name;
    b.classList.toggle('bg-accent', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('text-mute', !active);
  });
  $$('section[data-pane]').forEach(s => s.classList.toggle('hidden', s.dataset.pane !== name));
  $('#addBtn').style.display = name === 'settings' ? 'none' : '';
  $('#rangeTabsWrap').style.display = name === 'settings' ? 'none' : '';
  if (name === 'settings') { renderItemList(); renderSpotList(); renderClassList(); }
  else renderDashboard();
}
$$('.view-tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ==================== Date range tabs ====================
function setRange(r) {
  state.range = r;
  $$('.range-tab').forEach(b => {
    const active = b.dataset.range === r;
    b.classList.toggle('bg-accent', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('bg-panel', !active);
    b.classList.toggle('border', !active);
    b.classList.toggle('border-border', !active);
    b.classList.toggle('text-mute', !active);
  });
  renderDashboard();
}
$$('.range-tab').forEach(b => b.addEventListener('click', () => setRange(b.dataset.range)));

// ==================== Dashboard: filtering, aggregation, charts ====================
const PALETTE = ['#60a5fa', '#f87171', '#fbbf24', '#34d399', '#a78bfa', '#f472b6', '#22d3ee', '#fb923c', '#84cc16', '#e879f9'];
const charts = {};

function getFilteredSessions() {
  if (state.range === 'all') return store.sessions;
  const days = Number(state.range);
  const cutoff = Date.now() - days * 86400 * 1000;
  return store.sessions.filter(s => new Date(s.createdAt).getTime() >= cutoff);
}

function aggregate(sessions, keyFn) {
  const map = new Map();
  for (const s of sessions) {
    const k = keyFn(s);
    if (!k) continue;
    let cur = map.get(k.id);
    if (!cur) { cur = { id: k.id, name: k.name, hours: 0, silver: 0 }; map.set(k.id, cur); }
    cur.hours += s.totalHours || 0;
    cur.silver += s.totalSilver || 0;
  }
  const arr = [...map.values()];
  arr.forEach(g => g.silverPerHour = g.hours > 0 ? g.silver / g.hours : 0);
  return arr;
}

function showChart(wrapId, canvasKey) {
  const wrap = $('#' + wrapId);
  wrap.querySelector('.empty-state').classList.add('hidden');
  wrap.querySelector('canvas').classList.remove('hidden');
}
function showEmpty(wrapId, canvasKey) {
  const wrap = $('#' + wrapId);
  wrap.querySelector('.empty-state').classList.remove('hidden');
  wrap.querySelector('canvas').classList.add('hidden');
  if (charts[canvasKey]) { charts[canvasKey].destroy(); delete charts[canvasKey]; }
}

function drawDonut(canvasKey, groups, valueKey) {
  const canvas = document.querySelector(`canvas[data-chart="${canvasKey}"]`);
  if (!canvas) return;
  const labels = groups.map(g => g.name);
  const data = groups.map(g => g[valueKey] || 0);
  const colors = groups.map((_, i) => PALETTE[i % PALETTE.length]);

  if (charts[canvasKey]) {
    charts[canvasKey].data.labels = labels;
    charts[canvasKey].data.datasets[0].data = data;
    charts[canvasKey].data.datasets[0].backgroundColor = colors;
    charts[canvasKey].update();
    return;
  }
  charts[canvasKey] = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#15161a', borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      animation: false,
      plugins: {
        legend: { position: 'left', labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 12 } } },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${fmtHours(ctx.parsed)}` }
        }
      }
    }
  });
}

function drawBar(canvasKey, groups, valueKey, suffix = '') {
  const canvas = document.querySelector(`canvas[data-chart="${canvasKey}"]`);
  if (!canvas) return;
  const labels = groups.map(g => g.name);
  const data = groups.map(g => g[valueKey] || 0);
  const colors = groups.map((_, i) => PALETTE[i % PALETTE.length]);

  if (charts[canvasKey]) {
    charts[canvasKey].data.labels = labels;
    charts[canvasKey].data.datasets[0].data = data;
    charts[canvasKey].data.datasets[0].backgroundColor = colors;
    charts[canvasKey].update();
    return;
  }
  charts[canvasKey] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, barThickness: 18 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${fmtSilver(ctx.parsed.x)}${suffix}` } }
      },
      scales: {
        x: {
          ticks: { color: '#9aa0a6', callback: v => fmtSilver(v) },
          grid: { color: '#26282e' }
        },
        y: {
          ticks: { color: '#cbd5e1' },
          grid: { display: false }
        }
      }
    }
  });
}

function renderDashboard() {
  if (state.view !== 'spot' && state.view !== 'class') return;
  const sessions = getFilteredSessions();
  const totalSilver = sessions.reduce((a, s) => a + (s.totalSilver || 0), 0);
  const totalHours = sessions.reduce((a, s) => a + (s.totalHours || 0), 0);
  const avgPerHr = totalHours > 0 ? totalSilver / totalHours : 0;

  if (state.view === 'spot') {
    $('#kpiTotalSilver').textContent = fmtSilverFull(totalSilver);
    $('#kpiAvgSilver').textContent = fmtSilverFull(avgPerHr);
    $('#kpiTotalHours').textContent = fmtHours(totalHours);

    const groups = aggregate(sessions, s => ({ id: s.spotId || s.spotName, name: s.spotName }));

    if (groups.length === 0) {
      showEmpty('spotDonutWrap', 'spotDonut');
      showEmpty('spotSilverWrap', 'spotSilver');
      showEmpty('spotRateWrap', 'spotRate');
    } else {
      const donutGroups = [...groups].sort((a, b) => b.hours - a.hours);
      const silverGroups = [...groups].sort((a, b) => b.silver - a.silver);
      const rateGroups   = [...groups].sort((a, b) => b.silverPerHour - a.silverPerHour);
      showChart('spotDonutWrap');   drawDonut('spotDonut', donutGroups, 'hours');
      showChart('spotSilverWrap');  drawBar('spotSilver', silverGroups, 'silver');
      showChart('spotRateWrap');    drawBar('spotRate', rateGroups, 'silverPerHour', '/hr');
    }

    renderRecentSessions();
  }

  if (state.view === 'class') {
    $('#kpiClsTotalSilver').textContent = fmtSilverFull(totalSilver);
    $('#kpiClsAvgSilver').textContent = fmtSilverFull(avgPerHr);
    $('#kpiClsTotalHours').textContent = fmtHours(totalHours);

    const classGroups = aggregate(sessions, s => {
      if (!s.classId) return null;
      const c = store.classes.find(x => x.id === s.classId);
      return c ? { id: c.id, name: c.name } : { id: s.classId, name: '(deleted class)' };
    });

    const best = [...classGroups].sort((a, b) => b.silver - a.silver)[0];
    const most = [...classGroups].sort((a, b) => b.hours - a.hours)[0];

    $('#kpiBestClass').textContent     = best ? fmtSilverFull(best.silver) : '—';
    $('#kpiBestClassName').textContent = best ? best.name : '';
    $('#kpiMostPlayed').textContent     = most ? fmtHours(most.hours) : '—';
    $('#kpiMostPlayedName').textContent = most ? most.name : '';
    $('#kpiClassesUsed').textContent    = classGroups.length;

    if (classGroups.length === 0) {
      showEmpty('classDonutWrap', 'classDonut');
      showEmpty('classSilverWrap', 'classSilver');
      showEmpty('classRateWrap', 'classRate');
    } else {
      const donutGroups = [...classGroups].sort((a, b) => b.hours - a.hours);
      const silverGroups = [...classGroups].sort((a, b) => b.silver - a.silver);
      const rateGroups   = [...classGroups].sort((a, b) => b.silverPerHour - a.silverPerHour);
      showChart('classDonutWrap');   drawDonut('classDonut', donutGroups, 'hours');
      showChart('classSilverWrap');  drawBar('classSilver', silverGroups, 'silver');
      showChart('classRateWrap');    drawBar('classRate', rateGroups, 'silverPerHour', '/hr');
    }
  }
}

// ==================== Settings: Spots ====================
let editingSpotId = null;
const expandedSpots = new Set();

function renderSpotList() {
  const list = $('#spotList');
  const empty = $('#spotListEmpty');
  if (!store.spots.length) {
    list.innerHTML = '';
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  list.classList.remove('hidden');
  empty.classList.add('hidden');

  list.innerHTML = store.spots.map(s => {
    const expanded = expandedSpots.has(s.id);
    const linkedCount = (s.itemIds || []).length;
    return `
      <div class="border-b border-border last:border-b-0">
        <div class="flex items-center gap-3 px-4 py-3 bg-panel hover:bg-panel2 cursor-pointer" data-toggle="${s.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-mute2 transition-transform ${expanded ? 'rotate-90' : ''}"><path d="M9 6l6 6-6 6"/></svg>
          ${avatarHTML(s, 36)}
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${escapeHtml(s.name)}</div>
            <div class="text-xs text-mute2">${linkedCount} linked item${linkedCount === 1 ? '' : 's'}</div>
          </div>
          <button class="text-xs text-mute hover:text-white px-2 py-1" data-edit-spot="${s.id}">Edit</button>
          <button class="text-xs text-red-400 hover:text-red-300 px-2 py-1" data-del-spot="${s.id}">Delete</button>
        </div>
        ${expanded ? renderLinkedItemsPanel(s) : ''}
      </div>
    `;
  }).join('');

  $$('[data-toggle]', list).forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('[data-edit-spot],[data-del-spot]')) return;
      const id = row.dataset.toggle;
      if (expandedSpots.has(id)) expandedSpots.delete(id); else expandedSpots.add(id);
      renderSpotList();
    });
  });
  $$('[data-edit-spot]', list).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openSpotEditor(b.dataset.editSpot); }));
  $$('[data-del-spot]',  list).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); deleteSpot(b.dataset.delSpot); }));
  $$('[data-manage-items]', list).forEach(b => b.addEventListener('click', () => openItemPicker(b.dataset.manageItems)));
  $$('[data-unlink]', list).forEach(b => b.addEventListener('click', () => unlinkItemFromSpot(b.dataset.unlink.split('|')[0], b.dataset.unlink.split('|')[1])));
}

function renderLinkedItemsPanel(spot) {
  const ids = spot.itemIds || [];
  const items = ids.map(id => store.items.find(i => i.id === id)).filter(Boolean);
  return `
    <div class="bg-panel2/50 px-4 py-3 border-t border-border">
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs uppercase tracking-wide text-mute">Linked Items</div>
        <button class="h-7 px-2 bg-panel border border-border hover:text-white rounded-md text-xs flex items-center gap-1" data-manage-items="${spot.id}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Manage Items
        </button>
      </div>
      ${items.length === 0
        ? `<div class="text-xs text-mute2 py-2">No items linked. Click "Manage Items" to pick from the library.</div>`
        : `<div class="flex flex-wrap gap-1.5">
            ${items.map(it => `
              <div class="inline-flex items-center gap-1.5 bg-panel border border-border rounded-md pl-1.5 pr-1 py-1">
                ${avatarHTML(it, 22)}
                <span class="text-xs">${escapeHtml(it.name)}</span>
                <span class="text-[10px] text-mute2 ml-1">${fmtSilver(it.price || 0)}</span>
                <button class="text-mute2 hover:text-red-400 text-xs px-1" title="Unlink" data-unlink="${spot.id}|${it.id}">×</button>
              </div>
            `).join('')}
          </div>`}
    </div>
  `;
}

function openSpotEditor(id = null) {
  editingSpotId = id;
  $('#spotEditor').classList.remove('hidden');
  if (id) {
    const s = store.spots.find(x => x.id === id);
    $('#spotName').value = s?.name || '';
    $('#spotIcon').value = s?.iconUrl || '';
  } else {
    $('#spotName').value = '';
    $('#spotIcon').value = '';
  }
  $('#spotName').focus();
}
function closeSpotEditor() { editingSpotId = null; $('#spotEditor').classList.add('hidden'); }
function saveSpot() {
  const name = $('#spotName').value.trim();
  const iconUrl = $('#spotIcon').value.trim();
  if (!name) { $('#spotName').focus(); return; }
  if (editingSpotId) {
    const s = store.spots.find(x => x.id === editingSpotId);
    if (s) { s.name = name; s.iconUrl = iconUrl || null; }
  } else {
    store.spots.push({ id: uid(), name, iconUrl: iconUrl || null, itemIds: [] });
  }
  saveStore(); closeSpotEditor(); renderSpotList();
}
function deleteSpot(id) {
  if (!confirm('Delete this spot? Sessions linked to it will keep the spot name as a label.')) return;
  store.spots = store.spots.filter(s => s.id !== id);
  saveStore(); renderSpotList();
}

function unlinkItemFromSpot(spotId, itemId) {
  const s = store.spots.find(x => x.id === spotId);
  if (!s) return;
  s.itemIds = (s.itemIds || []).filter(id => id !== itemId);
  saveStore(); renderSpotList(); renderItemList();
}

// ==================== Settings: Items (shared library) ====================
let editingItemId = null;

function renderItemList() {
  const list = $('#itemList');
  const empty = $('#itemListEmpty');
  if (!store.items.length) {
    list.innerHTML = '';
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  list.classList.remove('hidden');
  empty.classList.add('hidden');
  list.innerHTML = store.items.map(it => {
    const usedBy = store.spots.filter(s => (s.itemIds || []).includes(it.id)).length;
    return `
      <div class="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-2.5 bg-panel hover:bg-panel2 border-b border-border last:border-b-0">
        ${avatarHTML(it, 36)}
        <div class="min-w-0">
          <div class="text-sm font-medium truncate">${escapeHtml(it.name)}</div>
          <div class="text-xs text-mute2">${fmtSilver(it.price || 0)}${it.taxable ? ' · taxable' : ''} · used by ${usedBy} spot${usedBy === 1 ? '' : 's'}</div>
        </div>
        <button class="text-xs text-mute hover:text-white px-2 py-1" data-edit-item="${it.id}">Edit</button>
        <button class="text-xs text-red-400 hover:text-red-300 px-2 py-1" data-del-item="${it.id}">Delete</button>
      </div>
    `;
  }).join('');
  $$('[data-edit-item]', list).forEach(b => b.addEventListener('click', () => openItemEditor(b.dataset.editItem)));
  $$('[data-del-item]',  list).forEach(b => b.addEventListener('click', () => deleteItem(b.dataset.delItem)));
}

function openItemEditor(id = null) {
  editingItemId = id;
  $('#itemEditor').classList.remove('hidden');
  if (id) {
    const it = store.items.find(x => x.id === id);
    $('#itemName').value  = it?.name || '';
    $('#itemImage').value = it?.imageUrl || '';
    $('#itemPrice').value = it?.price || 0;
    $('#itemTax').checked = it ? !!it.taxable : true;
  } else {
    $('#itemName').value = '';
    $('#itemImage').value = '';
    $('#itemPrice').value = 0;
    $('#itemTax').checked = true;
  }
  $('#itemName').focus();
}
function closeItemEditor() { editingItemId = null; $('#itemEditor').classList.add('hidden'); }

function saveItem() {
  const name = $('#itemName').value.trim();
  if (!name) { $('#itemName').focus(); return; }
  const data = {
    name,
    imageUrl: $('#itemImage').value.trim(),
    price: clampNumber($('#itemPrice').value),
    taxable: $('#itemTax').checked,
  };
  if (editingItemId) {
    const it = store.items.find(x => x.id === editingItemId);
    if (it) Object.assign(it, data);
  } else {
    store.items.push({ id: uid(), ...data });
  }
  saveStore(); closeItemEditor(); renderItemList(); renderSpotList();
}

function deleteItem(id) {
  const usedBy = store.spots.filter(s => (s.itemIds || []).includes(id)).length;
  const msg = usedBy > 0
    ? `Delete this item? It's linked to ${usedBy} spot${usedBy === 1 ? '' : 's'} — those links will be removed.`
    : 'Delete this item?';
  if (!confirm(msg)) return;
  store.items = store.items.filter(i => i.id !== id);
  store.spots.forEach(s => { s.itemIds = (s.itemIds || []).filter(x => x !== id); });
  saveStore(); renderItemList(); renderSpotList();
}

$('#addItemBtn')?.addEventListener('click', () => openItemEditor(null));
$('#itemSaveBtn')?.addEventListener('click', saveItem);
$('#itemCancelBtn')?.addEventListener('click', closeItemEditor);
$('#itemName')?.addEventListener('keydown',  e => { if (e.key === 'Enter') saveItem(); });
$('#itemImage')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveItem(); });
$('#itemPrice')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveItem(); });
bindImageInput($('#itemImage'));

// ==================== Item Picker Modal (link items to spot) ====================
let pickerSpotId = null;
let pickerSelected = new Set();

function openItemPicker(spotId) {
  const spot = store.spots.find(s => s.id === spotId);
  if (!spot) return;
  pickerSpotId = spotId;
  pickerSelected = new Set(spot.itemIds || []);
  $('#itemPickerTitle').textContent = `Link items to ${spot.name}`;
  $('#itemPickerSearch').value = '';
  renderItemPickerList('');
  openModal('itemPickerModal');
  setTimeout(() => $('#itemPickerSearch').focus(), 0);
}

function renderItemPickerList(query) {
  const list = $('#itemPickerList');
  if (!store.items.length) {
    list.innerHTML = `
      <div class="text-center py-8 text-mute2">
        <div class="text-sm">No items in your library</div>
        <div class="text-xs mt-1">Add items in Settings → Items first</div>
      </div>`;
    return;
  }
  const q = query.trim().toLowerCase();
  const items = store.items.filter(it => !q || it.name.toLowerCase().includes(q));
  if (!items.length) {
    list.innerHTML = `<div class="text-center py-8 text-mute2 text-sm">No matches</div>`;
    return;
  }
  list.innerHTML = items.map(it => `
    <label class="flex items-center gap-3 px-3 py-2.5 bg-panel2 hover:bg-[#23262d] border border-border rounded-lg cursor-pointer">
      <input type="checkbox" data-pick-item="${it.id}" ${pickerSelected.has(it.id) ? 'checked' : ''} class="accent-accent">
      ${avatarHTML(it, 28)}
      <span class="text-sm flex-1 min-w-0 truncate">${escapeHtml(it.name)}</span>
      <span class="text-xs text-mute2">${fmtSilver(it.price || 0)}</span>
    </label>
  `).join('');
  $$('[data-pick-item]', list).forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) pickerSelected.add(cb.dataset.pickItem);
    else pickerSelected.delete(cb.dataset.pickItem);
  }));
}

function saveItemPicker() {
  const spot = store.spots.find(s => s.id === pickerSpotId);
  if (!spot) return;
  // Preserve existing order; append newly checked at the end
  const existing = (spot.itemIds || []).filter(id => pickerSelected.has(id));
  const added = [...pickerSelected].filter(id => !existing.includes(id));
  spot.itemIds = [...existing, ...added];
  saveStore();
  closeModal('itemPickerModal');
  renderSpotList();
  renderItemList();
}

$('#itemPickerSearch')?.addEventListener('input', e => renderItemPickerList(e.target.value));
$('#itemPickerSaveBtn')?.addEventListener('click', saveItemPicker);

$('#addSpotBtn')?.addEventListener('click', () => openSpotEditor(null));
$('#spotSaveBtn')?.addEventListener('click', saveSpot);
$('#spotCancelBtn')?.addEventListener('click', closeSpotEditor);
$('#spotName')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveSpot(); });
$('#spotIcon')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveSpot(); });
bindImageInput($('#spotIcon'));

// ==================== Settings: Classes ====================
let editingClassId = null;

function renderClassList() {
  const list = $('#classList');
  const empty = $('#classListEmpty');
  if (!store.classes.length) {
    list.innerHTML = '';
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  list.classList.remove('hidden');
  empty.classList.add('hidden');
  list.innerHTML = store.classes.map(c => `
    <div class="flex items-center gap-3 px-4 py-3 bg-panel hover:bg-panel2 border-b border-border last:border-b-0">
      ${avatarHTML(c, 36, 'rounded-full')}
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">${escapeHtml(c.name)}</div>
      </div>
      <button class="text-xs text-mute hover:text-white px-2 py-1" data-edit-class="${c.id}">Edit</button>
      <button class="text-xs text-red-400 hover:text-red-300 px-2 py-1" data-del-class="${c.id}">Delete</button>
    </div>
  `).join('');
  $$('[data-edit-class]', list).forEach(b => b.addEventListener('click', () => openClassEditor(b.dataset.editClass)));
  $$('[data-del-class]',  list).forEach(b => b.addEventListener('click', () => deleteClass(b.dataset.delClass)));
}

function openClassEditor(id = null) {
  editingClassId = id;
  $('#classEditor').classList.remove('hidden');
  if (id) {
    const c = store.classes.find(x => x.id === id);
    $('#className').value = c?.name || '';
    $('#classIcon').value = c?.imageUrl || '';
  } else {
    $('#className').value = '';
    $('#classIcon').value = '';
  }
  $('#className').focus();
}
function closeClassEditor() { editingClassId = null; $('#classEditor').classList.add('hidden'); }
function saveClass() {
  const name = $('#className').value.trim();
  const imageUrl = $('#classIcon').value.trim();
  if (!name) { $('#className').focus(); return; }
  if (editingClassId) {
    const c = store.classes.find(x => x.id === editingClassId);
    if (c) { c.name = name; c.imageUrl = imageUrl || null; }
  } else {
    store.classes.push({ id: uid(), name, imageUrl: imageUrl || null });
  }
  saveStore(); closeClassEditor(); renderClassList();
}
function deleteClass(id) {
  if (!confirm('Delete this class?')) return;
  store.classes = store.classes.filter(c => c.id !== id);
  saveStore(); renderClassList();
}
$('#addClassBtn')?.addEventListener('click', () => openClassEditor(null));
$('#classSaveBtn')?.addEventListener('click', saveClass);
$('#classCancelBtn')?.addEventListener('click', closeClassEditor);
$('#className')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveClass(); });
$('#classIcon')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveClass(); });
bindImageInput($('#classIcon'));

// ==================== Pick Spot Modal ====================
function openPickSpot() {
  $('#pickSpotSearch').value = '';
  renderPickSpotList('');
  openModal('pickSpotModal');
  setTimeout(() => $('#pickSpotSearch').focus(), 0);
}
function renderPickSpotList(query) {
  const list = $('#pickSpotList');
  const q = query.trim().toLowerCase();
  const items = store.spots.filter(s => !q || s.name.toLowerCase().includes(q));
  if (!items.length) {
    list.innerHTML = `
      <div class="text-center py-8 text-mute2">
        <div class="text-sm">${store.spots.length === 0 ? 'No spots yet' : 'No matches'}</div>
        <div class="text-xs mt-1">${store.spots.length === 0 ? 'Add spots in Settings first' : 'Try a different search'}</div>
      </div>`;
    return;
  }
  list.innerHTML = items.map(s => `
    <button class="w-full flex items-center gap-3 px-3 py-2.5 bg-panel2 hover:bg-[#23262d] border border-border rounded-lg text-left" data-pick="${s.id}">
      ${avatarHTML(s, 32)}
      <span class="text-sm">${escapeHtml(s.name)}</span>
    </button>
  `).join('');
  $$('[data-pick]', list).forEach(b => {
    b.addEventListener('click', () => {
      const spot = store.spots.find(x => x.id === b.dataset.pick);
      if (spot) { closeModal('pickSpotModal'); openSessionForm(spot); }
    });
  });
}
$('#addBtn')?.addEventListener('click', openPickSpot);
$('#pickSpotSearch')?.addEventListener('input', e => renderPickSpotList(e.target.value));

// ==================== Session Form ====================
let sessionContext = null; // { spot, lootQty: {itemId: qty}, classId }

function openSessionForm(spot) {
  sessionContext = { spot, lootQty: {}, classId: null };
  $('#sessionSpotName').textContent = spot.name;
  $('#sessionSpotAvatar').innerHTML = avatarHTML(spot, 36);

  $('#sessHours').value = 1;
  $('#sessMins').value = 0;
  $('#sessSecs').value = 0;
  $('#sessDropRate').value = 100;
  $('#sessApplyTax').checked = true;
  $('#sessNotes').value = '';

  renderLootGrid();
  renderClassPicker();
  recalcTotals();
  clearOcr();
  openModal('sessionModal');
}

function getSpotItems(spot) {
  return (spot.itemIds || []).map(id => store.items.find(i => i.id === id)).filter(Boolean);
}

function renderLootGrid() {
  const grid = $('#sessLootGrid');
  const empty = $('#sessLootEmpty');
  const items = getSpotItems(sessionContext.spot);
  $('#sessItemHint').textContent = items.length ? `${items.length} item${items.length === 1 ? '' : 's'} linked` : '';

  if (items.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  grid.classList.remove('hidden');
  empty.classList.add('hidden');

  grid.innerHTML = items.map(it => `
    <div class="bg-panel border border-border rounded-md p-2 flex items-center gap-2">
      ${avatarHTML(it, 36)}
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium truncate" title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</div>
        <div class="text-[10px] text-mute2">${fmtSilver(it.price || 0)}${it.taxable ? ' · taxed' : ''}</div>
      </div>
      <input type="number" min="0" step="1" value="0" data-loot="${it.id}"
        class="w-16 bg-bg border border-border rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-accent">
    </div>
  `).join('');

  $$('[data-loot]', grid).forEach(inp => inp.addEventListener('input', () => {
    const v = Math.max(0, Math.floor(Number(inp.value) || 0));
    sessionContext.lootQty[inp.dataset.loot] = v;
    recalcTotals();
  }));
}

function renderClassPicker() {
  const wrap = $('#sessClassList');
  const empty = $('#sessClassEmpty');
  if (!store.classes.length) {
    wrap.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  empty.classList.add('hidden');
  wrap.innerHTML = `
    <button class="px-3 py-1.5 bg-panel border border-border hover:text-white rounded-md text-sm ${sessionContext.classId === null ? 'ring-1 ring-accent text-white' : 'text-mute'}" data-class="">
      None
    </button>
    ${store.classes.map(c => `
      <button class="flex items-center gap-2 px-2.5 py-1.5 bg-panel border border-border hover:text-white rounded-md text-sm ${sessionContext.classId === c.id ? 'ring-1 ring-accent text-white' : 'text-mute'}" data-class="${c.id}">
        ${avatarHTML(c, 22, 'rounded-full')}
        <span>${escapeHtml(c.name)}</span>
      </button>
    `).join('')}
  `;
  $$('[data-class]', wrap).forEach(b => b.addEventListener('click', () => {
    sessionContext.classId = b.dataset.class || null;
    renderClassPicker();
  }));
}

function getSessionTimeInput() {
  const hours = Math.floor(clampNumber($('#sessHours').value));
  const mins = Math.floor(clampNumber($('#sessMins').value, 0, 59));
  const secs = Math.floor(clampNumber($('#sessSecs').value, 0, 59));
  return { hours, mins, secs, totalHours: hours + mins / 60 + secs / 3600 };
}

function calcSession() {
  const items = getSpotItems(sessionContext.spot);
  const applyTax = $('#sessApplyTax').checked;
  let total = 0;
  for (const it of items) {
    const qty = Math.floor(clampNumber(sessionContext.lootQty[it.id]));
    let revenue = clampNumber(it.price) * qty;
    if (applyTax && it.taxable) revenue *= (1 - TAX);
    total += revenue;
  }
  const { totalHours } = getSessionTimeInput();
  const perHour = totalHours > 0 ? total / totalHours : 0;
  return { total, perHour, totalHours };
}

function recalcTotals() {
  const { total, perHour } = calcSession();
  $('#sessTotalSilver').textContent = fmtSilver(total);
  $('#sessSilverHr').textContent = fmtSilver(perHour);
}
['sessHours','sessMins','sessSecs','sessDropRate','sessApplyTax'].forEach(id => {
  $('#' + id)?.addEventListener('input', recalcTotals);
  $('#' + id)?.addEventListener('change', recalcTotals);
});

$('#sessSaveBtn')?.addEventListener('click', () => {
  const { total, perHour, totalHours } = calcSession();
  const { hours, mins, secs } = getSessionTimeInput();
  const session = {
    id: uid(),
    createdAt: new Date().toISOString(),
    spotId: sessionContext.spot.id,
    spotName: sessionContext.spot.name,
    spotIconUrl: sessionContext.spot.iconUrl || null,
    classId: sessionContext.classId,
    hours,
    mins,
    secs,
    totalHours,
    dropRatePct: clampNumber($('#sessDropRate').value),
    applyTax: $('#sessApplyTax').checked,
    loot: { ...sessionContext.lootQty },
    notes: $('#sessNotes').value.trim(),
    totalSilver: total,
    silverPerHour: perHour,
  };
  store.sessions.push(session);
  saveStore();
  closeModal('sessionModal');
  renderDashboard();
});

// ==================== OCR (Tesseract.js) ====================
let _tesseractScriptPromise = null;
let _ocrWorker = null;
let _ocrDetections = [];   // [{ text, qty, bbox, itemId }]
let _ocrImgNaturalSize = { w: 0, h: 0 };
let _ocrImageDataUrl = null;
let _ocrSelection = null;  // { x, y, w, h } in natural coords
let _ocrDetectedTime = null; // { hours, mins }

function loadTesseractScript() {
  if (typeof Tesseract !== 'undefined') return Promise.resolve();
  if (_tesseractScriptPromise) return _tesseractScriptPromise;
  _tesseractScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/tesseract/tesseract.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load tesseract.min.js'));
    document.head.appendChild(s);
  });
  return _tesseractScriptPromise;
}

function absUrl(rel) {
  return new URL(rel, document.baseURI).href;
}

async function getOcrWorker(progressCb) {
  if (_ocrWorker) return _ocrWorker;
  await loadTesseractScript();
  _ocrWorker = await Tesseract.createWorker('eng', 1, {
    workerPath: absUrl('vendor/tesseract/worker.min.js'),
    corePath:   absUrl('vendor/tesseract/'),
    langPath:   absUrl('vendor/tesseract/lang'),
    logger: m => progressCb && progressCb(m),
  });
  return _ocrWorker;
}

async function setOcrMode(mode) {
  // 'digits' | 'full'
  const worker = _ocrWorker;
  if (!worker) return;
  if (mode === 'digits') {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789,', preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
  } else if (mode === 'line-digits') {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789,', preserve_interword_spaces: '1', tessedit_pageseg_mode: '7' });
  } else {
    await worker.setParameters({ tessedit_char_whitelist: '', preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
  }
}

function parseTimeFromText(text) {
  if (!text) return null;
  const parseNumber = raw => parseInt(String(raw || '').replace(/[oO]/g, '0').replace(/[iIl|]/g, '1'), 10);
  const parseLine = line => {
    let m = line.match(/([0-9oOiIl|]+)\s*h(?:ours?|rs?)?\s*([0-9oOiIl|]+)\s*m(?:ins?|inutes?)?(?:\s*([0-9oOiIl|]+)\s*s(?:ec(?:onds?)?)?)?/i);
    if (m) {
      const hours = parseNumber(m[1]);
      const mins = parseNumber(m[2]);
      const secs = parseNumber(m[3] || 0);
      if (isFinite(hours) && isFinite(mins) && mins < 60) return { hours, mins, secs: isFinite(secs) ? Math.min(59, secs) : 0 };
    }
    m = line.match(/([0-9oOiIl|]+)\s*hours?\s*([0-9oOiIl|]+)\s*minutes?(?:\s*([0-9oOiIl|]+)\s*seconds?)?/i);
    if (m) {
      const hours = parseNumber(m[1]);
      const mins = parseNumber(m[2]);
      const secs = parseNumber(m[3] || 0);
      if (isFinite(hours) && isFinite(mins) && mins < 60) return { hours, mins, secs: isFinite(secs) ? Math.min(59, secs) : 0 };
    }
    m = line.match(/\b([0-9oOiIl|]{1,2}):([0-9oOiIl|]{2})(?::([0-9oOiIl|]{2}))?\b/);
    if (m && !/date|20\d{2}/i.test(line)) {
      const hours = parseNumber(m[1]);
      const mins = parseNumber(m[2]);
      const secs = parseNumber(m[3] || 0);
      if (isFinite(hours) && isFinite(mins) && mins < 60 && hours < 24) return { hours, mins, secs: isFinite(secs) ? Math.min(59, secs) : 0 };
    }
    m = line.match(/([0-9oOiIl|]+)\s*h\b/i);
    if (m) {
      const hours = parseNumber(m[1]);
      if (isFinite(hours)) return { hours, mins: 0, secs: 0 };
    }
    return null;
  };

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines.filter(line => /\btime\b/i.test(line) && !/\bdate\b/i.test(line))) {
    const parsed = parseLine(line);
    if (parsed) return parsed;
  }
  for (const line of lines.filter(line => /\bh\b/i.test(line) && /\bm\b/i.test(line))) {
    const parsed = parseLine(line);
    if (parsed) return parsed;
  }
  return null;
}

function formatDetectedTime(t) {
  if (!t) return '';
  return `${t.hours}h ${t.mins}m${t.secs ? ` ${t.secs}s` : ''}`;
}

function cropImageToDataUrl(img, rect, scale = 2) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(rect.w * scale));
  cv.height = Math.max(1, Math.round(rect.h * scale));
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png');
}

async function recognizeGrindTime(worker, img, fullText = '') {
  const fromFull = parseTimeFromText(fullText);
  if (fromFull) return fromFull;

  const crops = [
    { x: 0, y: 0, w: img.naturalWidth * 0.72, h: img.naturalHeight * 0.38 },
    { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight * 0.32 },
  ];
  await setOcrMode('full');
  for (const rect of crops) {
    const { data } = await worker.recognize(cropImageToDataUrl(img, rect, 3));
    const parsed = parseTimeFromText(data.text || '');
    if (parsed) return parsed;
  }
  return null;
}

function clearOcr() {
  _ocrDetections = [];
  _ocrImageDataUrl = null;
  _ocrSelection = null;
  _ocrDetectedTime = null;
  $('#sessOcrPreview').src = '';
  $('#sessOcrResults').classList.add('hidden');
  $('#sessOcrLoading').classList.add('hidden');
  $('#sessOcrDrop').classList.remove('hidden');
  $('#sessOcrClear').classList.add('hidden');
  $('#sessOcrFile').value = '';
  $('#sessOcrTime')?.classList.add('hidden');
  $('#sessOcrSelToolbar')?.classList.add('hidden');
}

function setOcrLoading(text) {
  $('#sessOcrLoading').classList.remove('hidden');
  $('#sessOcrLoadingText').textContent = text;
  $('#sessOcrDrop').classList.add('hidden');
  $('#sessOcrResults').classList.add('hidden');
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function handleOcrFile(file) {
  if (!file || !file.type?.startsWith('image/')) {
    alert('Please drop an image file.');
    return;
  }
  setOcrLoading('Loading scanner… (first run can take 5–10 s)');
  try {
    const dataUrl = await fileToDataUrl(file);
    _ocrImageDataUrl = dataUrl;
    const img = new Image();
    img.src = dataUrl;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    _ocrImgNaturalSize = { w: img.naturalWidth, h: img.naturalHeight };

    const worker = await getOcrWorker(m => {
      if (m.status === 'loading tesseract core' || m.status === 'initializing tesseract') {
        setOcrLoading('Loading scanner…');
      } else if (m.status === 'loading language traineddata') {
        setOcrLoading('Loading language model…');
      } else if (m.status === 'recognizing text') {
        setOcrLoading(`Scanning… ${Math.round((m.progress || 0) * 100)}%`);
      }
    });

    // Pass 1: full text → time pattern
    setOcrLoading('Detecting time…');
    await setOcrMode('full');
    const fullScan = await worker.recognize(dataUrl);
    _ocrDetectedTime = await recognizeGrindTime(worker, img, fullScan.data.text || '');

    // Pass 2: digits only → numbers list
    setOcrLoading('Detecting numbers…');
    await setOcrMode('digits');
    const digitScan = await worker.recognize(dataUrl);
    const digitDetections = extractDetections(digitScan.data.words, { x: 0, y: 0 });

    setOcrLoading('Matching loot icons...');
    const lootMatches = await detectLootMatches(img, digitDetections, null, worker);
    _ocrDetections = lootMatches.length ? lootMatches : digitDetections;

    $('#sessOcrLoading').classList.add('hidden');
    $('#sessOcrPreview').src = dataUrl;
    $('#sessOcrPreview').onload = () => drawOcrOverlay();
    $('#sessOcrResults').classList.remove('hidden');
    $('#sessOcrClear').classList.remove('hidden');

    if (_ocrDetectedTime) {
      $('#sessOcrTime').classList.remove('hidden');
      $('#sessOcrTimeText').textContent = formatDetectedTime(_ocrDetectedTime);
    } else {
      $('#sessOcrTime').classList.add('hidden');
    }

    if (_ocrDetections.length === 0 && !_ocrDetectedTime) {
      alert('Nothing recognized. Try cropping in on the loot row, or use a higher-resolution screenshot.');
    }
    renderOcrList();
  } catch (e) {
    console.error(e);
    alert('OCR failed: ' + (e.message || e));
    clearOcr();
  }
}

function extractDetections(words, offset = { x: 0, y: 0 }, scale = 1) {
  return (words || [])
    .map(w => {
      const cleaned = (w.text || '').replace(/[^\d]/g, '');
      if (!cleaned) return null;
      const n = parseInt(cleaned, 10);
      if (!isFinite(n) || n <= 0) return null;
      const b = w.bbox;
      return {
        text: w.text.trim(),
        qty: n,
        bbox: {
          x0: b.x0 / scale + offset.x,
          y0: b.y0 / scale + offset.y,
          x1: b.x1 / scale + offset.x,
          y1: b.y1 / scale + offset.y,
        },
        itemId: null,
      };
    })
    .filter(Boolean);
}

function contentPixel(r, g, b, a = 255) {
  if (a < 20) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max - min;
  return (max > 45 && saturation > 26) || (max > 150 && saturation > 12);
}

function scoreGroups(scores, threshold, offset = 0) {
  const groups = [];
  let start = -1, sum = 0;
  for (let i = 0; i <= scores.length; i++) {
    const active = i < scores.length && scores[i] >= threshold;
    if (active && start < 0) { start = i; sum = 0; }
    if (active) sum += scores[i];
    if ((!active || i === scores.length) && start >= 0) {
      groups.push({ start: start + offset, end: i - 1 + offset, sum });
      start = -1;
    }
  }
  return groups;
}

function mergeCloseGroups(groups, maxGap) {
  const merged = [];
  for (const group of groups) {
    const last = merged[merged.length - 1];
    if (last && group.start - last.end <= maxGap) {
      last.end = group.end;
      last.sum += group.sum;
    } else {
      merged.push({ ...group });
    }
  }
  return merged;
}

function clampRect(rect, w, h) {
  const x = Math.max(0, Math.min(w - 1, rect.x));
  const y = Math.max(0, Math.min(h - 1, rect.y));
  const x2 = Math.max(x + 1, Math.min(w, rect.x + rect.w));
  const y2 = Math.max(y + 1, Math.min(h, rect.y + rect.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

function detectLootSlotsFromCanvas(sourceCanvas, searchRect = null) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const xStart = searchRect ? Math.max(0, Math.floor(searchRect.x)) : 0;
  const xEnd = searchRect ? Math.min(w, Math.ceil(searchRect.x + searchRect.w)) : w;
  const yStart = searchRect ? Math.max(0, Math.floor(searchRect.y)) : Math.floor(h * 0.42);
  const yEnd = searchRect ? Math.min(h, Math.ceil(searchRect.y + searchRect.h)) : Math.floor(h * 0.78);
  const scanW = Math.max(1, xEnd - xStart);
  const scanH = Math.max(1, yEnd - yStart);
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(xStart, yStart, scanW, scanH).data;
  const rowScores = Array(scanH).fill(0);

  for (let y = 0; y < scanH; y++) {
    for (let x = 0; x < scanW; x++) {
      const i = (y * scanW + x) * 4;
      if (contentPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) rowScores[y]++;
    }
  }

  const rowThreshold = Math.max(8, Math.floor(scanW * 0.035));
  const rowGroups = scoreGroups(rowScores, rowThreshold, yStart)
    .filter(g => g.end - g.start >= 12 && g.end - g.start <= Math.max(90, h * 0.35));
  const row = rowGroups.sort((a, b) => b.sum - a.sum)[0];
  if (!row) return [];

  const rowPad = Math.max(4, Math.round((row.end - row.start) * 0.12));
  const y0 = Math.max(yStart, row.start - rowPad);
  const y1 = Math.min(yEnd, row.end + rowPad);
  const rowH = y1 - y0 + 1;
  const rowData = ctx.getImageData(xStart, y0, scanW, rowH).data;
  const colScores = Array(scanW).fill(0);

  for (let y = 0; y < rowH; y++) {
    for (let x = 0; x < scanW; x++) {
      const i = (y * scanW + x) * 4;
      if (contentPixel(rowData[i], rowData[i + 1], rowData[i + 2], rowData[i + 3])) colScores[x]++;
    }
  }

  const colThreshold = Math.max(3, Math.floor(rowH * 0.12));
  const cols = mergeCloseGroups(scoreGroups(colScores, colThreshold, xStart), 4)
    .filter(g => {
      const width = g.end - g.start + 1;
      return width >= 10 && width <= Math.max(64, rowH * 1.8);
    });

  const rowCenter = (y0 + y1) / 2;
  return cols.map(g => {
    const width = g.end - g.start + 1;
    const size = Math.max(22, Math.min(58, Math.max(rowH, width + 10)));
    const center = (g.start + g.end) / 2;
    return clampRect({
      x: Math.round(center - size / 2),
      y: Math.round(rowCenter - size / 2),
      w: Math.round(size),
      h: Math.round(size),
    }, w, h);
  });
}

function loadMatchImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = normalizeImageUrl(src);
  });
}

function slotIconCrop(slot, maxW, maxH) {
  const padX = Math.max(2, Math.round(slot.w * 0.06));
  const padTop = Math.max(2, Math.round(slot.h * 0.06));
  const padBottom = Math.max(7, Math.round(slot.h * 0.22));
  return clampRect({
    x: slot.x + padX,
    y: slot.y + padTop,
    w: slot.w - padX * 2,
    h: slot.h - padTop - padBottom,
  }, maxW, maxH);
}

function normalizeVector(values) {
  const norm = Math.sqrt(values.reduce((sum, n) => sum + n * n, 0)) || 1;
  return values.map(n => n / norm);
}

function dotProduct(a, b) {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

function buildSignature(source, crop = null, size = 30) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const sx = crop ? crop.x : 0;
  const sy = crop ? crop.y : 0;
  const sw = crop ? crop.w : source.naturalWidth || source.width;
  const sh = crop ? crop.h : source.naturalHeight || source.height;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const bins = Array(512).fill(0);
  const chroma = [];
  const gray = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (pixels[i + 3] < 20) continue;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 34 || (max < 70 && max - min < 18)) {
        chroma.push(0, 0, 0);
        gray.push(0);
        continue;
      }
      const rb = Math.min(7, r >> 5);
      const gb = Math.min(7, g >> 5);
      const bb = Math.min(7, b >> 5);
      const saturationWeight = 1 + (max - min) / 255;
      bins[(rb << 6) + (gb << 3) + bb] += saturationWeight;
      chroma.push((r / max) * saturationWeight, (g / max) * saturationWeight, (b / max) * saturationWeight);
      gray.push((0.299 * r + 0.587 * g + 0.114 * b) / 255);
    }
  }

  const edges = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const here = gray[y * size + x] || 0;
      const right = gray[y * size + Math.min(size - 1, x + 1)] || 0;
      const down = gray[Math.min(size - 1, y + 1) * size + x] || 0;
      edges.push(Math.abs(here - right), Math.abs(here - down));
    }
  }

  return {
    hist: normalizeVector(bins),
    chroma: normalizeVector(chroma),
    edges: normalizeVector(edges),
  };
}

function compareSignatures(a, b) {
  if (!a || !b) return 0;
  const hist = dotProduct(a.hist || [], b.hist || []);
  const chroma = dotProduct(a.chroma || [], b.chroma || []);
  const edges = dotProduct(a.edges || [], b.edges || []);
  return hist * 0.42 + chroma * 0.36 + edges * 0.22;
}

async function buildItemTemplates(items) {
  const templates = [];
  const failures = [];
  for (const item of items) {
    const src = item.imageUrl || item.iconUrl;
    if (!src) { failures.push({ item, reason: 'no-image-url' }); continue; }
    try {
      const img = await loadMatchImage(src);
      templates.push({ item, signature: buildSignature(img) });
    } catch (err) {
      // Likely CORS-tainted canvas or 404. The icon must serve
      // Access-Control-Allow-Origin for getImageData() to work.
      failures.push({ item, reason: err?.message || 'load-or-taint-error' });
    }
  }
  if (failures.length) {
    console.warn('[OCR] Could not build template signatures for', failures.length, 'item(s):', failures);
  }
  console.info('[OCR] templates built:', templates.length, '/ items linked to spot:', items.length);
  return templates;
}

function quantityFromDetectionsForSlot(slot, detections) {
  const x0 = slot.x - 4;
  const y0 = slot.y - 4;
  const x1 = slot.x + slot.w + 8;
  const y1 = slot.y + slot.h + 8;
  const candidates = detections
    .map((d, index) => ({ d, index, cx: (d.bbox.x0 + d.bbox.x1) / 2, cy: (d.bbox.y0 + d.bbox.y1) / 2 }))
    .filter(c => c.cx >= x0 && c.cx <= x1 && c.cy >= y0 && c.cy <= y1)
    .sort((a, b) => (b.cy - a.cy) || (b.cx - a.cx));
  const best = candidates[0];
  return best ? { qty: best.d.qty, text: best.d.text, index: best.index } : { qty: 1, text: '1', index: -1 };
}

function makeQuantityCrop(sourceCanvas, slot, mode = 'text') {
  const crop = clampRect({
    x: slot.x + 1,
    y: slot.y + Math.round(slot.h * 0.52),
    w: slot.w - 2,
    h: Math.round(slot.h * 0.48),
  }, sourceCanvas.width, sourceCanvas.height);
  const scale = 10;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(crop.w * scale));
  cv.height = Math.max(1, Math.round(crop.h * scale));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, cv.width, cv.height);

  if (mode === 'raw') return cv.toDataURL('image/png');

  const image = ctx.getImageData(0, 0, cv.width, cv.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max - min;
    const brightness = (r + g + b) / 3;
    const isStrictText = brightness > 88 && saturation < 110;
    const isLooseText = brightness > 66 && saturation < 145;
    const isText = mode === 'loose' ? isLooseText : isStrictText;
    data[i] = data[i + 1] = data[i + 2] = isText ? 0 : 255;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return cv.toDataURL('image/png');
}

function parseQuantityText(text) {
  const cleaned = String(text || '')
    .replace(/[oO]/g, '0')
    .replace(/[iIl|]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[bB]/g, '8')
    .replace(/[^\d]/g, '');
  if (!cleaned || cleaned.length > 8) return null;
  const qty = parseInt(cleaned, 10);
  return isFinite(qty) && qty > 0 ? { qty, text: cleaned, index: -1 } : null;
}

function chooseQuantityCandidate(candidates, fallback) {
  const usable = candidates.filter(Boolean);
  if (fallback && fallback.qty > 1) usable.push({ ...fallback, source: 'full-scan' });
  if (!usable.length) return fallback || { qty: 1, text: '1', index: -1 };
  return usable.sort((a, b) => {
    const aText = String(a.text);
    const bText = String(b.text);
    const suspicious = value => value.length >= 5 && /^(?:19|89|99)/.test(value);
    if (suspicious(aText) !== suspicious(bText)) return suspicious(aText) ? 1 : -1;
    const lenDiff = Math.min(bText.length, 5) - Math.min(aText.length, 5);
    if (lenDiff) return lenDiff;
    return (b.confidence || 0) - (a.confidence || 0);
  })[0];
}

async function recognizeSlotQuantity(worker, sourceCanvas, slot, fallback = null) {
  if (!worker) return null;
  await setOcrMode('line-digits');
  const candidates = [];
  for (const mode of ['text', 'loose', 'raw']) {
    try {
      const url = makeQuantityCrop(sourceCanvas, slot, mode);
      const { data } = await worker.recognize(url);
      const parsed = parseQuantityText(data.text);
      if (parsed) candidates.push({ ...parsed, confidence: data.confidence || 0, source: mode });
    } catch {
      // Keep trying the other variants.
    }
  }
  return chooseQuantityCandidate(candidates, fallback);
}

async function quantityForSlot(slot, detections, sourceCanvas, worker) {
  const fallback = quantityFromDetectionsForSlot(slot, detections);
  const direct = await recognizeSlotQuantity(worker, sourceCanvas, slot, fallback);
  if (direct) return direct;
  return fallback;
}

async function detectLootMatches(img, quantityDetections, searchRect = null, worker = null) {
  const items = getSpotItems(sessionContext.spot);

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = img.naturalWidth;
  sourceCanvas.height = img.naturalHeight;
  sourceCanvas.getContext('2d').drawImage(img, 0, 0);

  const slots = detectLootSlotsFromCanvas(sourceCanvas, searchRect);
  if (!slots.length) return [];

  const templates = items.length ? await buildItemTemplates(items) : [];
  const usedItemIds = new Set();

  const matches = [];
  for (const slot of slots) {
    let matchedItem = null;
    let matchScore = 0;
    if (templates.length) {
      const slotSignature = buildSignature(sourceCanvas, slotIconCrop(slot, sourceCanvas.width, sourceCanvas.height));
      const scored = templates
        .map(t => ({ item: t.item, score: compareSignatures(slotSignature, t.signature) }))
        .filter(s => !usedItemIds.has(s.item.id))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      const second = scored[1];
      const acceptStrict = best && best.score >= 0.42 && (!second || best.score - second.score >= 0.03);
      const acceptLoose  = best && best.score >= 0.32;
      if (acceptStrict || acceptLoose) {
        matchedItem = best.item;
        matchScore = best.score;
        usedItemIds.add(best.item.id);
      }
    }

    const quantity = await quantityForSlot(slot, quantityDetections, sourceCanvas, worker);
    matches.push({
      text: quantity.text,
      qty: quantity.qty,
      bbox: { x0: slot.x, y0: slot.y, x1: slot.x + slot.w, y1: slot.y + slot.h },
      itemId: matchedItem ? matchedItem.id : null,
      matchedName: matchedItem ? matchedItem.name : null,
      score: matchScore,
      source: matchedItem ? 'item-match' : 'slot-detection',
    });
  }

  return matches;
}

async function rescanSelection() {
  if (!_ocrSelection || !_ocrImageDataUrl) return;
  const sel = _ocrSelection;
  setOcrLoading('Scanning selection…');
  try {
    const img = new Image();
    img.src = _ocrImageDataUrl;
    await new Promise(r => { img.onload = r; });
    const SCALE = 2;  // upscale for small inventory numbers
    const cv = document.createElement('canvas');
    cv.width = Math.round(sel.w * SCALE);
    cv.height = Math.round(sel.h * SCALE);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sel.x, sel.y, sel.w, sel.h, 0, 0, cv.width, cv.height);
    const cropUrl = cv.toDataURL('image/png');

    const worker = await getOcrWorker();
    await setOcrMode('digits');
    const { data } = await worker.recognize(cropUrl);
    const digitDetections = extractDetections(data.words, { x: sel.x, y: sel.y }, SCALE);
    const lootMatches = await detectLootMatches(img, digitDetections, sel, worker);
    _ocrDetections = lootMatches.length ? lootMatches : digitDetections;

    $('#sessOcrLoading').classList.add('hidden');
    $('#sessOcrResults').classList.remove('hidden');
    if (_ocrDetections.length === 0) alert('No numbers found in that selection.');
    renderOcrList();
    drawOcrOverlay();
  } catch (e) {
    alert('Rescan failed: ' + (e.message || e));
    $('#sessOcrLoading').classList.add('hidden');
    $('#sessOcrResults').classList.remove('hidden');
  }
}

function renderOcrList() {
  const wrap = $('#sessOcrList');
  const items = getSpotItems(sessionContext.spot);
  if (_ocrDetections.length === 0) {
    wrap.innerHTML = `<div class="text-xs text-mute2 py-2">No numbers in current scan. Drag a rectangle on the image to scan a region.</div>`;
    $('#sessOcrSummary').textContent = '';
    return;
  }
  wrap.innerHTML = _ocrDetections.map((d, i) => {
    const itemOptionsRendered = items.map(it =>
      `<option value="${it.id}" ${d.itemId === it.id ? 'selected' : ''}>${escapeHtml(it.name)}</option>`
    ).join('');
    const matchMeta = d.source === 'item-match'
      ? `<div class="text-[10px] text-mute2 mt-0.5 truncate">Matched ${escapeHtml(d.matchedName || '')} (${Math.round((d.score || 0) * 100)}%)</div>`
      : '';
    return `
      <div class="grid grid-cols-[auto_1fr_auto] gap-3 items-center bg-panel border border-border rounded-md px-3 py-1.5">
        <input type="number" min="0" step="1" value="${escapeAttr(d.qty)}" data-ocr-qty="${i}"
          class="w-24 bg-bg border border-border rounded-md px-2 py-1.5 text-sm font-mono tabular-nums focus:outline-none focus:border-accent">
        <div class="min-w-0">
        <select data-ocr-pick="${i}" class="w-full bg-bg border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-accent">
          <option value="">— Skip —</option>
          <option value="__hours__" ${d.itemId === '__hours__' ? 'selected' : ''}>→ Hours</option>
          <option value="__mins__"  ${d.itemId === '__mins__'  ? 'selected' : ''}>→ Minutes</option>
          ${items.length ? `<optgroup label="Loot items">${itemOptionsRendered}</optgroup>` : ''}
        </select>
        ${matchMeta}
        </div>
        <button data-ocr-remove="${i}" class="text-red-400 hover:text-red-300 text-xs px-2" title="Remove">×</button>
      </div>
    `;
  }).join('');

  $$('[data-ocr-pick]', wrap).forEach(s => s.addEventListener('change', () => {
    _ocrDetections[Number(s.dataset.ocrPick)].itemId = s.value || null;
    drawOcrOverlay();
    updateOcrSummary();
  }));
  $$('[data-ocr-qty]', wrap).forEach(inp => inp.addEventListener('input', () => {
    const i = Number(inp.dataset.ocrQty);
    const qty = Math.floor(clampNumber(inp.value));
    _ocrDetections[i].qty = qty;
    _ocrDetections[i].text = String(qty);
    drawOcrOverlay();
  }));
  $$('[data-ocr-remove]', wrap).forEach(b => b.addEventListener('click', () => {
    _ocrDetections.splice(Number(b.dataset.ocrRemove), 1);
    renderOcrList();
    drawOcrOverlay();
  }));
  updateOcrSummary();
}

function updateOcrSummary() {
  const mapped = _ocrDetections.filter(d => d.itemId).length;
  $('#sessOcrSummary').textContent = `${mapped} of ${_ocrDetections.length} mapped`;
}

function drawOcrOverlay(extra) {
  const img = $('#sessOcrPreview');
  const cv = $('#sessOcrOverlay');
  if (!img || !cv || !img.complete || !img.naturalWidth) return;
  const w = img.clientWidth, h = img.clientHeight;
  cv.width = w; cv.height = h;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const sx = w / _ocrImgNaturalSize.w;
  const sy = h / _ocrImgNaturalSize.h;

  // Detection boxes
  ctx.lineWidth = 2;
  ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif';
  for (const d of _ocrDetections) {
    if (!d.bbox) continue;
    const { x0, y0, x1, y1 } = d.bbox;
    const x = x0 * sx, y = y0 * sy;
    const ww = (x1 - x0) * sx, hh = (y1 - y0) * sy;
    let color = '#fbbf24';
    if (d.itemId === '__hours__' || d.itemId === '__mins__') color = '#3b82f6';
    else if (d.itemId) color = '#22c55e';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.strokeRect(x, y, ww, hh);
    ctx.fillRect(x, Math.max(0, y - 14), Math.min(40, ww), 14);
    ctx.fillStyle = '#0b0b0d';
    ctx.fillText(d.text.slice(0, 5), x + 2, Math.max(11, y - 3));
  }

  // Persisted selection rectangle
  if (_ocrSelection) {
    const x = _ocrSelection.x * sx, y = _ocrSelection.y * sy;
    const ww = _ocrSelection.w * sx, hh = _ocrSelection.h * sy;
    ctx.strokeStyle = '#60a5fa';
    ctx.fillStyle = 'rgba(96,165,250,0.10)';
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, ww, hh);
    ctx.strokeRect(x, y, ww, hh);
  }

  // Live drag rect
  if (extra && extra.dragRect) {
    const r = extra.dragRect;
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
  }
}

function applyOcrToLoot() {
  const mapped = _ocrDetections.filter(d => d.itemId);
  if (!mapped.length && !_ocrDetectedTime) {
    alert('Nothing to apply — map at least one number to an item, or use the time fill.');
    return;
  }
  const additions = {};
  let hours = null, mins = null;
  for (const d of mapped) {
    if (d.itemId === '__hours__') hours = d.qty;
    else if (d.itemId === '__mins__') mins = Math.min(59, d.qty);
    else additions[d.itemId] = (additions[d.itemId] || 0) + d.qty;
  }
  if (_ocrDetectedTime) {
    if (hours == null) hours = _ocrDetectedTime.hours;
    if (mins == null) mins = Math.min(59, _ocrDetectedTime.mins);
  }
  if (hours != null) {
    $('#sessHours').value = hours;
    $('#sessHours').dispatchEvent(new Event('input'));
  }
  if (mins != null) {
    $('#sessMins').value = mins;
    $('#sessMins').dispatchEvent(new Event('input'));
  }
  if (_ocrDetectedTime?.secs != null) {
    $('#sessSecs').value = Math.min(59, _ocrDetectedTime.secs);
    $('#sessSecs').dispatchEvent(new Event('input'));
  }
  for (const [itemId, qty] of Object.entries(additions)) {
    sessionContext.lootQty[itemId] = qty;
  }
  renderLootGrid();
  for (const inp of $$('#sessLootGrid [data-loot]')) {
    inp.value = sessionContext.lootQty[inp.dataset.loot] || 0;
  }
  recalcTotals();
  clearOcr();
}

function applyDetectedTime() {
  if (!_ocrDetectedTime) return;
  $('#sessHours').value = _ocrDetectedTime.hours;
  $('#sessMins').value  = Math.min(59, _ocrDetectedTime.mins);
  $('#sessSecs').value  = Math.min(59, _ocrDetectedTime.secs || 0);
  $('#sessHours').dispatchEvent(new Event('input'));
  $('#sessMins').dispatchEvent(new Event('input'));
  $('#sessSecs').dispatchEvent(new Event('input'));
  $('#sessOcrTime').classList.add('hidden');
}

// Drop / paste / click wiring
function bindOcrZone() {
  const zone = $('#sessOcrDrop');
  const fileInput = $('#sessOcrFile');
  if (!zone || !fileInput) return;

  zone.addEventListener('click', e => { if (e.target.tagName !== 'INPUT') fileInput.click(); });
  fileInput.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) handleOcrFile(f);
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('border-accent'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('border-accent'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('border-accent');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleOcrFile(f);
  });

  $('#sessOcrClear').addEventListener('click', clearOcr);
  $('#sessOcrApply').addEventListener('click', applyOcrToLoot);
  $('#sessOcrTimeApply').addEventListener('click', applyDetectedTime);
  $('#sessOcrScanSel').addEventListener('click', rescanSelection);
  $('#sessOcrClearSel').addEventListener('click', () => {
    _ocrSelection = null;
    $('#sessOcrSelToolbar').classList.add('hidden');
    drawOcrOverlay();
  });

  // Mouse drag region selection on overlay
  const overlay = $('#sessOcrOverlay');
  let dragging = false, start = null;
  overlay.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const r = overlay.getBoundingClientRect();
    start = { x: e.clientX - r.left, y: e.clientY - r.top };
    dragging = true;
  });
  overlay.addEventListener('mousemove', e => {
    if (!dragging) return;
    const r = overlay.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const rect = { x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) };
    drawOcrOverlay({ dragRect: rect });
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    const r = overlay.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const w = overlay.clientWidth, h = overlay.clientHeight;
    const sx = _ocrImgNaturalSize.w / w;
    const sy = _ocrImgNaturalSize.h / h;
    const x0 = Math.max(0, Math.min(start.x, x)) * sx;
    const y0 = Math.max(0, Math.min(start.y, y)) * sy;
    const ww = Math.abs(x - start.x) * sx;
    const hh = Math.abs(y - start.y) * sy;
    if (ww < 8 * sx || hh < 8 * sy) { _ocrSelection = null; $('#sessOcrSelToolbar').classList.add('hidden'); drawOcrOverlay(); return; }
    _ocrSelection = { x: x0, y: y0, w: ww, h: hh };
    $('#sessOcrSelToolbar').classList.remove('hidden');
    drawOcrOverlay();
  }
  overlay.addEventListener('mouseup', endDrag);
  overlay.addEventListener('mouseleave', e => { if (dragging) endDrag(e); });

  // Paste anywhere inside session modal → only if drop zone visible (i.e. no current results)
  $('#sessionModal').addEventListener('paste', e => {
    if ($('#sessOcrDrop').classList.contains('hidden')) return; // already showing results
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); handleOcrFile(item.getAsFile()); }
  });

  // Repaint overlay on resize
  window.addEventListener('resize', drawOcrOverlay);
}
bindOcrZone();

// ==================== Recent Sessions (dashboard) ====================
function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'} ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

function sessionRowHTML(s) {
  return `
    <div class="group flex items-center gap-3 bg-panel2 border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-[#23262d]" data-session="${s.id}">
      ${avatarHTML({ name: s.spotName, iconUrl: s.spotIconUrl }, 28)}
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">${escapeHtml(s.spotName)}</div>
        <div class="text-[11px] text-mute2">${fmtSilver(s.silverPerHour)}/hr · ${fmtSessionDuration(s.hours, s.mins, s.secs)}</div>
      </div>
      <div class="text-right pr-1">
        <div class="text-sm font-semibold text-accent2">${fmtSilver(s.totalSilver)}</div>
        <div class="text-[11px] text-mute2">${timeAgo(s.createdAt)}</div>
      </div>
      <button class="opacity-0 group-hover:opacity-100 transition-opacity text-mute2 hover:text-red-400 p-1" title="Delete" data-quick-del="${s.id}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
      </button>
    </div>
  `;
}

function bindSessionRowHandlers(root) {
  $$('[data-session]', root).forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('[data-quick-del]')) return;
      openSessionDetail(row.dataset.session);
    });
  });
  $$('[data-quick-del]', root).forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    deleteSession(b.dataset.quickDel);
  }));
}

function renderRecentSessions() {
  const wrap = $('#recentWrap');
  if (!wrap) return;
  const all = [...store.sessions].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  if (!all.length) {
    wrap.className = 'h-[270px] flex flex-col items-center justify-center text-mute2';
    wrap.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-3 opacity-60"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
      <div class="text-sm">No sessions recorded yet</div>`;
    return;
  }
  const recent = all.slice(0, 6);
  const moreCount = all.length - recent.length;
  wrap.className = 'h-[270px] overflow-y-auto pr-1 space-y-1.5';
  wrap.innerHTML =
    recent.map(sessionRowHTML).join('') +
    (moreCount > 0
      ? `<button id="viewAllSessionsBtn" class="w-full text-center py-2 text-xs text-mute hover:text-white border border-dashed border-border rounded-md">View all ${all.length} sessions</button>`
      : `<button id="viewAllSessionsBtn" class="w-full text-center py-2 text-xs text-mute2 hover:text-white border border-dashed border-border rounded-md">View all sessions</button>`);
  bindSessionRowHandlers(wrap);
  $('#viewAllSessionsBtn')?.addEventListener('click', openAllSessions);
}

function openAllSessions() {
  const all = [...store.sessions].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  $('#allSessionsTitle').textContent = `All Sessions (${all.length})`;
  const list = $('#allSessionsList');
  if (!all.length) {
    list.innerHTML = `<div class="text-center py-10 text-mute2 text-sm">No sessions yet</div>`;
  } else {
    list.innerHTML = all.map(sessionRowHTML).join('');
    bindSessionRowHandlers(list);
  }
  openModal('allSessionsModal');
}

function openSessionDetail(id) {
  const s = store.sessions.find(x => x.id === id);
  if (!s) return;
  $('#sessDetailAvatar').innerHTML = avatarHTML({ name: s.spotName, iconUrl: s.spotIconUrl }, 36);
  $('#sessDetailSpot').textContent = s.spotName;
  $('#sessDetailWhen').textContent = `${new Date(s.createdAt).toLocaleString()} · ${timeAgo(s.createdAt)}`;

  const cls = s.classId ? store.classes.find(c => c.id === s.classId) : null;
  $('#sessDetailClass').textContent = cls ? cls.name : (s.classId ? '(deleted class)' : 'None');
  $('#sessDetailTime').textContent = fmtSessionDuration(s.hours, s.mins, s.secs);
  $('#sessDetailDropRate').textContent = `${s.dropRatePct ?? 100}%`;
  $('#sessDetailTax').textContent = s.applyTax ? '15.5% applied' : 'Not applied';

  const lootEntries = Object.entries(s.loot || {}).filter(([, q]) => q > 0);
  if (lootEntries.length) {
    $('#sessDetailLoot').innerHTML = lootEntries.map(([itemId, qty]) => {
      const it = store.items.find(i => i.id === itemId);
      const name = it?.name || '(deleted item)';
      const price = it?.price || 0;
      const taxed = it?.taxable && s.applyTax;
      const lineTotal = qty * price * (taxed ? 0.845 : 1);
      return `
        <div class="flex items-center gap-2 text-xs">
          ${it ? avatarHTML(it, 22) : `<div class="w-[22px] h-[22px] rounded bg-panel"></div>`}
          <span class="flex-1 truncate">${escapeHtml(name)} <span class="text-mute2">× ${qty}</span></span>
          <span class="text-mute2">${fmtSilver(price)}</span>
          <span class="text-accent2 w-20 text-right">${fmtSilver(lineTotal)}</span>
        </div>
      `;
    }).join('');
  } else {
    $('#sessDetailLoot').innerHTML = `<div class="text-xs text-mute2">No loot recorded</div>`;
  }

  $('#sessDetailTotal').textContent = fmtSilverFull(s.totalSilver || 0);
  $('#sessDetailRate').textContent  = fmtSilverFull(s.silverPerHour || 0);

  if (s.notes) {
    $('#sessDetailNotesWrap').classList.remove('hidden');
    $('#sessDetailNotes').textContent = s.notes;
  } else {
    $('#sessDetailNotesWrap').classList.add('hidden');
  }

  $('#sessDetailDelete').onclick = () => {
    if (!confirm('Delete this session? This cannot be undone.')) return;
    store.sessions = store.sessions.filter(x => x.id !== id);
    saveStore();
    closeModal('sessionDetailModal');
    closeModal('allSessionsModal');
    renderDashboard();
  };

  openModal('sessionDetailModal');
}

function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  store.sessions = store.sessions.filter(x => x.id !== id);
  saveStore();
  // If the All Sessions modal is open, refresh it
  if (!$('#allSessionsModal').classList.contains('hidden')) openAllSessions();
  renderDashboard();
}

// ==================== Modal close handlers ====================
$$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
$$('.fixed.inset-0').forEach(modal => {
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $$('.fixed.inset-0:not(.hidden)').forEach(m => m.classList.add('hidden'));
});

// ==================== Export / Import JSON ====================
function exportJson() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    spots:    store.spots,
    items:    store.items,
    classes:  store.classes,
    sessions: store.sessions,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `BDO-GrindTracker-data-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

function importJsonFile(file) {
  const reader = new FileReader();
  reader.onerror = () => alert('Could not read file.');
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch { alert('Not a valid JSON file.'); return; }

    if (!data || typeof data !== 'object' ||
        !Array.isArray(data.spots) || !Array.isArray(data.items) ||
        !Array.isArray(data.classes) || !Array.isArray(data.sessions)) {
      alert('JSON does not look like a BDO-GrindTracker export.');
      return;
    }

    const nextStore = sanitizeStoreData(migrateStoreData(data));
    const summary = `Import will REPLACE current data:
  • ${nextStore.spots.length} spot${nextStore.spots.length === 1 ? '' : 's'}
  • ${nextStore.items.length} item${nextStore.items.length === 1 ? '' : 's'}
  • ${nextStore.classes.length} class${nextStore.classes.length === 1 ? '' : 'es'}
  • ${nextStore.sessions.length} session${nextStore.sessions.length === 1 ? '' : 's'}

Continue?`;
    if (!confirm(summary)) return;

    store.spots    = nextStore.spots;
    store.items    = nextStore.items;
    store.classes  = nextStore.classes;
    store.sessions = nextStore.sessions;
    saveStore();
    renderItemList(); renderSpotList(); renderClassList();
    renderDashboard();
    alert('Import complete.');
  };
  reader.readAsText(file);
}

$('#exportBtn')?.addEventListener('click', exportJson);
$('#importBtn')?.addEventListener('click', () => $('#importFile').click());
$('#importFile')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) importJsonFile(file);
  e.target.value = '';
});

// Drag-and-drop on the Data card
(() => {
  const card = $('#dataCard');
  if (!card) return;
  const HIGHLIGHT = ['border-accent', 'ring-2', 'ring-accent/40'];
  const setHighlight = on => HIGHLIGHT.forEach(c => card.classList.toggle(c, on));

  card.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setHighlight(true);
  });
  card.addEventListener('dragleave', e => {
    if (e.target === card) setHighlight(false);
  });
  card.addEventListener('drop', e => {
    e.preventDefault();
    setHighlight(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
      alert('Please drop a .json file.');
      return;
    }
    importJsonFile(file);
  });
})();

// ==================== Init ====================
setView('spot');
