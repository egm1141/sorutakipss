/* ============================================================
   SoruTakip – app.js
   Supabase + Chart.js SPA Logic
   ============================================================ */

'use strict';

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let sb = null;                 // Supabase client
let dersler = [];              // Cached subjects
let selectedColor = '#6366f1'; // Current color in subject modal
let editingRecordId = null;    // null = new record
let editingSubjectId = null;   // null = new subject
let dailyChart = null;
let subjectChart = null;
let confirmCallback = null;    // For confirm modal

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
const DEFAULT_URL = 'https://fwvvojlcikqzmlcbeuvp.supabase.co';
const DEFAULT_KEY = 'sb_publishable_4_tNvk1AE0JfpnsvBMcoTg_eY2GsWCV';

document.addEventListener('DOMContentLoaded', async () => {
  const url = localStorage.getItem('sb_url') || DEFAULT_URL;
  const key = localStorage.getItem('sb_key') || DEFAULT_KEY;

  if (url && key) {
    try {
      initSupabase(url, key);
      await navigate('dashboard');
    } catch (e) {
      showSetupModal();
    }
  } else {
    showSetupModal();
  }

  // Set today's date label
  const today = new Date();
  const el = document.getElementById('today-date-label');
  if (el) el.textContent = formatDateLong(today);

  // Set history month to current month
  const hm = document.getElementById('history-month');
  if (hm) hm.value = today.toISOString().slice(0, 7);
});

// ── Supabase init ──
function initSupabase(url, key) {
  sb = supabase.createClient(url, key);
}

// ── Setup modal ──
function showSetupModal() {
  const modal = document.getElementById('setup-modal');
  modal.style.display = 'flex';
}

async function saveSetup() {
  const url = document.getElementById('setup-url').value.trim();
  const key = document.getElementById('setup-key').value.trim();

  if (!url || !key) {
    showToast('URL ve Key boş bırakılamaz!', 'error');
    return;
  }

  const btn = document.getElementById('setup-connect-btn');
  btn.innerHTML = '<span class="spinner"></span> Bağlanıyor...';
  btn.disabled = true;

  try {
    initSupabase(url, key);
    // Test bağlantısı
    const { error } = await sb.from('dersler').select('id').limit(1);
    if (error) throw error;

    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);

    document.getElementById('setup-modal').style.display = 'none';
    showToast('Bağlantı başarılı! 🎉', 'success');
    await navigate('dashboard');
  } catch (e) {
    showToast('Bağlantı hatası: ' + (e.message || 'Bilgiler yanlış olabilir.'), 'error');
    btn.innerHTML = '<i class="fas fa-plug"></i> Bağlan';
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
async function navigate(page, event) {
  if (event) event.preventDefault();

  // Tüm sayfaları gizle
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  // Hedef sayfayı göster
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  // Nav linkini aktif et
  document.querySelectorAll(`.nav-link[data-page="${page}"]`).forEach(l => l.classList.add('active'));

  // Sayfaya göre veri yükle
  if (!sb) return;

  switch (page) {
    case 'dashboard': await loadDashboard(); break;
    case 'history':   await loadHistory();   break;
    case 'stats':     await loadStats();      break;
    case 'subjects':  await loadSubjects();   break;
    case 'settings':  loadSettings();         break;
  }

  closeSidebar();
}

// ── Sidebar Toggle ──
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ═══════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════
async function loadDashboard() {
  await fetchDersler();
  const todayStr = getLocalDate();

  const { data: records, error } = await sb
    .from('gunluk_kayitlar')
    .select('*, dersler(ad, renk)')
    .eq('tarih', todayStr)
    .order('created_at');

  if (error) { showToast('Veriler yüklenemedi.', 'error'); return; }

  // KPIs
  const total = records.reduce((s, r) => s + r.soru_sayisi, 0);
  const subjectCount = new Set(records.map(r => r.ders_id)).size;

  document.getElementById('kpi-total').textContent    = total;
  document.getElementById('kpi-subjects').textContent  = subjectCount;
  document.getElementById('kpi-streak').textContent    = await calculateStreak();

  // Render cards
  renderTodayRecords(records);
}

function renderTodayRecords(records) {
  const container = document.getElementById('today-records');

  if (!records || records.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">📖</div>
        <p>Henüz kayıt yok.<br>Yukarıdan ekle!</p>
      </div>`;
    return;
  }

  container.innerHTML = records.map(r => {
    const ders = r.dersler || { ad: 'Bilinmiyor', renk: '#64748b' };
    const initials = ders.ad.charAt(0).toUpperCase();
    return `
      <div class="record-card" style="border-left-color:${ders.renk};">
        <div class="record-header">
          <div class="record-subject">
            <div class="record-dot" style="background:${ders.renk};"></div>
            ${escHtml(ders.ad)}
          </div>
          <div class="record-actions">
            <button class="record-action-btn" onclick="openRecordModal('${r.id}')" title="Düzenle">
              <i class="fas fa-pen"></i>
            </button>
            <button class="record-action-btn delete" onclick="confirmDeleteRecord('${r.id}')" title="Sil">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="record-count" style="color:${ders.renk};">${r.soru_sayisi}</div>
        <div class="record-count-label">soru</div>
        ${r.not_metni ? `<div class="record-note">💬 ${escHtml(r.not_metni)}</div>` : ''}
      </div>`;
  }).join('');
}

async function calculateStreak() {
  const { data, error } = await sb
    .from('gunluk_kayitlar')
    .select('tarih')
    .order('tarih', { ascending: false });

  if (error || !data || data.length === 0) return 0;

  const uniqueDays = [...new Set(data.map(r => r.tarih))].sort().reverse();
  let streak = 0;
  let check = new Date();
  check.setHours(12, 0, 0, 0);

  for (const day of uniqueDays) {
    const dayDate = new Date(day + 'T12:00:00');
    const diff = Math.round((check - dayDate) / (1000 * 60 * 60 * 24));
    if (diff <= 1) {
      streak++;
      check = dayDate;
      check.setDate(check.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// ═══════════════════════════════════════════
// RECORD MODAL
// ═══════════════════════════════════════════
async function openRecordModal(recordId = null) {
  editingRecordId = recordId;
  await fetchDersler();

  const title = document.getElementById('record-modal-title');
  const dateInput = document.getElementById('record-date');
  const subjectSel = document.getElementById('record-subject');
  const countInput = document.getElementById('record-count');
  const noteInput  = document.getElementById('record-note');
  const idInput    = document.getElementById('editing-record-id');

  // Populate subject dropdown
  subjectSel.innerHTML = '<option value="">Ders seçin...</option>';
  dersler.forEach(d => {
    subjectSel.innerHTML += `<option value="${d.id}">${escHtml(d.ad)}</option>`;
  });

  if (recordId) {
    title.textContent = 'Kaydı Düzenle';
    const { data } = await sb.from('gunluk_kayitlar').select('*').eq('id', recordId).single();
    if (data) {
      dateInput.value    = data.tarih;
      subjectSel.value   = data.ders_id;
      countInput.value   = data.soru_sayisi;
      noteInput.value    = data.not_metni || '';
      idInput.value      = recordId;
    }
  } else {
    title.textContent  = 'Soru Kaydı Ekle';
    dateInput.value    = getLocalDate();
    subjectSel.value   = '';
    countInput.value   = '';
    noteInput.value    = '';
    idInput.value      = '';
  }

  openModal('record-modal');
}

async function saveRecord() {
  const id      = document.getElementById('editing-record-id').value;
  const tarih   = document.getElementById('record-date').value;
  const dersId  = document.getElementById('record-subject').value;
  const sayisi  = parseInt(document.getElementById('record-count').value, 10);
  const not     = document.getElementById('record-note').value.trim();

  if (!tarih)          { showToast('Tarih seçin!', 'error'); return; }
  if (!dersId)         { showToast('Ders seçin!', 'error'); return; }
  if (isNaN(sayisi) || sayisi < 0) { showToast('Geçerli bir soru sayısı girin!', 'error'); return; }

  const btn = document.getElementById('save-record-btn');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;

  const payload = {
    tarih,
    ders_id: dersId,
    soru_sayisi: sayisi,
    not_metni: not || null
  };

  let error;
  if (id) {
    ({ error } = await sb.from('gunluk_kayitlar').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('gunluk_kayitlar').insert(payload));
  }

  btn.innerHTML = '<i class="fas fa-check"></i> Kaydet';
  btn.disabled = false;

  if (error) {
    showToast('Hata: ' + error.message, 'error');
    return;
  }

  closeModal('record-modal');
  showToast(id ? 'Kayıt güncellendi!' : 'Kayıt eklendi! 📝', 'success');

  // Reload current page
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (activePage) await navigate(activePage);
}

// ─── Delete record ───
function confirmDeleteRecord(id) {
  document.getElementById('confirm-title').textContent  = 'Kaydı sil?';
  document.getElementById('confirm-desc').textContent   = 'Bu kayıt kalıcı olarak silinecek.';
  confirmCallback = () => deleteRecord(id);
  document.getElementById('confirm-action-btn').onclick = () => {
    closeModal('confirm-modal');
    deleteRecord(id);
  };
  openModal('confirm-modal');
}

async function deleteRecord(id) {
  const { error } = await sb.from('gunluk_kayitlar').delete().eq('id', id);
  if (error) { showToast('Silinemedi: ' + error.message, 'error'); return; }
  showToast('Kayıt silindi.', 'info');
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (activePage) await navigate(activePage);
}

// ═══════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════
async function loadHistory() {
  const monthInput = document.getElementById('history-month');
  const month = monthInput.value || new Date().toISOString().slice(0, 7);
  const [year, mon] = month.split('-');

  const startDate = `${year}-${mon}-01`;
  const lastDay = new Date(parseInt(year), parseInt(mon), 0).getDate();
  const endDate = `${year}-${mon}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await sb
    .from('gunluk_kayitlar')
    .select('*, dersler(ad, renk)')
    .gte('tarih', startDate)
    .lte('tarih', endDate)
    .order('tarih', { ascending: false })
    .order('created_at', { ascending: false });

  const container = document.getElementById('history-container');

  if (error || !data || data.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">📅</div>
        <p>Bu ay kayıt bulunamadı.</p>
      </div>`;
    return;
  }

  // Group by date
  const byDay = {};
  data.forEach(r => {
    if (!byDay[r.tarih]) byDay[r.tarih] = [];
    byDay[r.tarih].push(r);
  });

  container.innerHTML = Object.entries(byDay).map(([date, records]) => {
    const total = records.reduce((s, r) => s + r.soru_sayisi, 0);
    const dateStr = formatDateLong(new Date(date + 'T12:00:00'));
    const rows = records.map(r => {
      const ders = r.dersler || { ad: '?', renk: '#64748b' };
      return `
        <div class="history-record-row">
          <div class="history-record-left">
            <div class="record-dot" style="background:${ders.renk};width:8px;height:8px;"></div>
            <span style="font-weight:600;color:${ders.renk};">${escHtml(ders.ad)}</span>
            <span class="history-record-count">${r.soru_sayisi} soru</span>
            ${r.not_metni ? `<span class="history-record-note">– ${escHtml(r.not_metni)}</span>` : ''}
          </div>
          <div class="history-record-actions">
            <button class="record-action-btn" onclick="openRecordModal('${r.id}')" title="Düzenle">
              <i class="fas fa-pen"></i>
            </button>
            <button class="record-action-btn delete" onclick="confirmDeleteRecord('${r.id}')" title="Sil">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="history-day">
        <div class="history-day-header">
          <div class="history-day-date">${dateStr}</div>
          <div class="history-day-total"><i class="fas fa-pen-nib"></i> ${total} soru</div>
        </div>
        <div class="history-day-body">${rows}</div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════
async function loadStats() {
  const { data, error } = await sb
    .from('gunluk_kayitlar')
    .select('*, dersler(ad, renk)')
    .order('tarih');

  if (error || !data) return;

  // Overall stats
  const totalQuestions = data.reduce((s, r) => s + r.soru_sayisi, 0);
  const uniqueDays = new Set(data.map(r => r.tarih)).size;
  const avg = uniqueDays > 0 ? Math.round(totalQuestions / uniqueDays) : 0;

  // Best day
  const byDay = {};
  data.forEach(r => { byDay[r.tarih] = (byDay[r.tarih] || 0) + r.soru_sayisi; });
  const bestDay = Math.max(...Object.values(byDay), 0);

  document.getElementById('stat-total').textContent = totalQuestions;
  document.getElementById('stat-days').textContent  = uniqueDays;
  document.getElementById('stat-avg').textContent   = avg;
  document.getElementById('stat-best').textContent  = bestDay;

  // Daily chart (last 14 days)
  renderDailyChart(byDay);

  // Subject chart
  const bySubject = {};
  data.forEach(r => {
    const name  = r.dersler?.ad || 'Diğer';
    const renk  = r.dersler?.renk || '#64748b';
    if (!bySubject[name]) bySubject[name] = { count: 0, renk };
    bySubject[name].count += r.soru_sayisi;
  });
  renderSubjectChart(bySubject);
}

function renderDailyChart(byDay) {
  // Last 14 days
  const labels = [];
  const values = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = getLocalDate(d);
    labels.push(formatDateShort(d));
    values.push(byDay[key] || 0);
  }

  const ctx = document.getElementById('daily-chart').getContext('2d');
  if (dailyChart) dailyChart.destroy();

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: values.map(v =>
          v > 0 ? 'rgba(99,102,241,0.7)' : 'rgba(99,102,241,0.1)'
        ),
        borderColor: values.map(v =>
          v > 0 ? '#6366f1' : 'rgba(99,102,241,0.2)'
        ),
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e3a',
          borderColor: 'rgba(99,102,241,0.5)',
          borderWidth: 1,
          callbacks: {
            label: ctx => ` ${ctx.raw} soru`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#64748b', font: { size: 11 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#64748b', font: { size: 11 } },
          beginAtZero: true
        }
      }
    }
  });
}

function renderSubjectChart(bySubject) {
  const entries = Object.entries(bySubject).sort((a, b) => b[1].count - a[1].count);
  const labels = entries.map(e => e[0]);
  const values = entries.map(e => e[1].count);
  const colors = entries.map(e => e[1].renk);

  const ctx = document.getElementById('subject-chart').getContext('2d');
  if (subjectChart) subjectChart.destroy();

  if (labels.length === 0) {
    subjectChart = null;
    return;
  }

  subjectChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            font: { size: 11 },
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 8
          }
        },
        tooltip: {
          backgroundColor: '#1e1e3a',
          borderColor: 'rgba(99,102,241,0.5)',
          borderWidth: 1,
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw} soru`
          }
        }
      }
    }
  });
}

// ═══════════════════════════════════════════
// SUBJECTS (DERSLER)
// ═══════════════════════════════════════════
async function fetchDersler() {
  const { data, error } = await sb.from('dersler').select('*').order('created_at');
  if (!error && data) dersler = data;
  return dersler;
}

async function loadSubjects() {
  await fetchDersler();
  const grid = document.getElementById('subjects-grid');

  if (!dersler || dersler.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">📚</div>
        <p>Henüz ders eklenmedi.</p>
      </div>`;
    return;
  }

  // Get question counts per subject
  const { data: counts } = await sb
    .from('gunluk_kayitlar')
    .select('ders_id, soru_sayisi');

  const countMap = {};
  if (counts) counts.forEach(r => {
    countMap[r.ders_id] = (countMap[r.ders_id] || 0) + r.soru_sayisi;
  });

  grid.innerHTML = dersler.map(d => {
    const initials = d.ad.slice(0, 2).toUpperCase();
    const total = countMap[d.id] || 0;
    return `
      <div class="subject-card" style="border-left-color:${d.renk};">
        <div class="subject-color-bar" style="background:${d.renk}22;color:${d.renk};">
          ${initials}
        </div>
        <div class="subject-info">
          <div class="subject-name">${escHtml(d.ad)}</div>
          <div class="subject-meta">${total} soru toplam</div>
        </div>
        <div class="subject-actions">
          <button class="record-action-btn" onclick="openSubjectModal('${d.id}')" title="Düzenle">
            <i class="fas fa-pen"></i>
          </button>
          <button class="record-action-btn delete" onclick="confirmDeleteSubject('${d.id}', '${escHtml(d.ad)}')" title="Sil">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>`;
  }).join('');
}

async function openSubjectModal(subjectId = null) {
  editingSubjectId = subjectId;
  const title = document.getElementById('subject-modal-title');
  const nameInput = document.getElementById('subject-name');
  const idInput   = document.getElementById('editing-subject-id');

  // Reset color picker
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  selectedColor = '#6366f1';
  const first = document.querySelector('.color-swatch[data-color="#6366f1"]');
  if (first) first.classList.add('selected');

  if (subjectId) {
    title.textContent = 'Dersi Düzenle';
    const ders = dersler.find(d => d.id === subjectId);
    if (ders) {
      nameInput.value  = ders.ad;
      idInput.value    = subjectId;
      selectedColor    = ders.renk;
      // Mark selected color
      const swatch = document.querySelector(`.color-swatch[data-color="${ders.renk}"]`);
      if (swatch) {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
      }
    }
  } else {
    title.textContent = 'Ders Ekle';
    nameInput.value   = '';
    idInput.value     = '';
  }

  openModal('subject-modal');
  nameInput.focus();
}

async function saveSubject() {
  const id   = document.getElementById('editing-subject-id').value;
  const name = document.getElementById('subject-name').value.trim();

  if (!name) { showToast('Ders adı boş bırakılamaz!', 'error'); return; }

  const payload = { ad: name, renk: selectedColor };
  let error;

  if (id) {
    ({ error } = await sb.from('dersler').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('dersler').insert(payload));
  }

  if (error) { showToast('Hata: ' + error.message, 'error'); return; }

  closeModal('subject-modal');
  showToast(id ? 'Ders güncellendi!' : 'Ders eklendi! 📚', 'success');
  await loadSubjects();
  await fetchDersler();
}

function confirmDeleteSubject(id, name) {
  document.getElementById('confirm-title').textContent = `"${name}" dersini sil?`;
  document.getElementById('confirm-desc').textContent  = 'Bu derse ait tüm kayıtlar da silinecek!';
  document.getElementById('confirm-action-btn').onclick = () => {
    closeModal('confirm-modal');
    deleteSubject(id);
  };
  openModal('confirm-modal');
}

async function deleteSubject(id) {
  const { error } = await sb.from('dersler').delete().eq('id', id);
  if (error) { showToast('Silinemedi: ' + error.message, 'error'); return; }
  showToast('Ders silindi.', 'info');
  await loadSubjects();
  await fetchDersler();
}

// ── Color picker ──
function selectColor(el) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  selectedColor = el.dataset.color;
}

// ═══════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════
function loadSettings() {
  const url = localStorage.getItem('sb_url') || '';
  const key = localStorage.getItem('sb_key') || '';
  const urlEl = document.getElementById('settings-url');
  const keyEl = document.getElementById('settings-key');
  if (urlEl) urlEl.value = url;
  if (keyEl) keyEl.value = key;
  document.getElementById('connection-status').className = 'connection-status';
}

async function saveSettings() {
  const url = document.getElementById('settings-url').value.trim();
  const key = document.getElementById('settings-key').value.trim();
  if (!url || !key) { showToast('URL ve Key boş bırakılamaz!', 'error'); return; }

  try {
    initSupabase(url, key);
    const { error } = await sb.from('dersler').select('id').limit(1);
    if (error) throw error;
    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
    showStatus('Bağlantı başarılı! ✅', 'success');
    showToast('Ayarlar kaydedildi!', 'success');
  } catch (e) {
    showStatus('Bağlantı başarısız: ' + (e.message || ''), 'error');
    showToast('Bağlantı hatası!', 'error');
  }
}

async function testConnection() {
  if (!sb) { showToast('Önce Supabase bilgilerini gir!', 'error'); return; }
  try {
    const { error } = await sb.from('dersler').select('id').limit(1);
    if (error) throw error;
    showStatus('Bağlantı başarılı! ✅', 'success');
    showToast('Bağlantı çalışıyor!', 'success');
  } catch (e) {
    showStatus('Bağlantı başarısız: ' + (e.message || ''), 'error');
    showToast('Bağlantı hatası!', 'error');
  }
}

function showStatus(msg, type) {
  const el = document.getElementById('connection-status');
  el.textContent = msg;
  el.className = 'connection-status ' + type;
}

// ═══════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════
function openModal(id) {
  const el = document.getElementById(id);
  el.style.display = 'flex';
  // Close on backdrop click
  el.onclick = (e) => { if (e.target === el) closeModal(id); };
}
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
let toastTimer = null;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3200);
}

// ═══════════════════════════════════════════
// SQL COPY
// ═══════════════════════════════════════════
function copySQL(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent.trim())
    .then(() => showToast('SQL kopyalandı! 📋', 'success'))
    .catch(() => showToast('Kopyalanamadı.', 'error'));
}

// ═══════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════
function getLocalDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const TR_DAYS   = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
                   'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

function formatDateLong(date) {
  return `${TR_DAYS[date.getDay()]}, ${date.getDate()} ${TR_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function formatDateShort(date) {
  return `${date.getDate()} ${TR_MONTHS[date.getMonth()].slice(0, 3)}`;
}

// ── XSS Koruması ──
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
