/**
 * dashboard.js — Garmin Dashboard
 * Per-Karte State-Management: HEUTE | 7T | 30T
 */

(async () => {

// ── Base URL ────────────────────────────────────────────────────────────────
const BASE = (() => {
  const p = location.pathname;
  const m = p.match(/^(\/[^/]+\/)/);
  return m && !p.startsWith('/index') ? m[1].replace(/\/$/, '') : '';
})();

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function fmtSec(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function fmtHM(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDist(m) {
  if (m == null) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const dt = new Date(dateStr + 'T12:00:00');
  return dt.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Odometer Count-Up ────────────────────────────────────────────────────────
// el: DOM element whose textContent to animate
// target: numeric target value
// duration: ms (default 950)
// fmt: optional formatter function v => string; defaults to Math.round(v).toString()
function countUp(el, target, duration = 950, fmt = null) {
  if (!el || target == null || isNaN(target)) return;
  const format = fmt || (v => String(Math.round(v)));
  const ease = t => 1 - Math.pow(1 - t, 4); // easeOutQuart
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min((now - t0) / duration, 1);
    el.textContent = format(target * ease(p));
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = format(target);
  };
  requestAnimationFrame(tick);
}

function actTypeIcon(type) {
  const map = {
    running: '🏃', cycling: '🚴', swimming: '🏊', walking: '🚶',
    hiking: '🥾', strength_training: '🏋️', yoga: '🧘',
    indoor_cycling: '🚴', elliptical: '⚡', fitness_equipment: '🏋️',
  };
  return map[type] || '⚡';
}

// ── Daten laden ─────────────────────────────────────────────────────────────
let data;
try {
  const res = await fetch(`${BASE}/data/garmin.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  data = await res.json();
} catch (err) {
  console.error('garmin.json konnte nicht geladen werden:', err);
  $('grid').innerHTML = `
    <div class="card" style="grid-column:1/-1;text-align:center;padding:60px 24px">
      <div style="font-size:32px;margin-bottom:12px">⚡</div>
      <div style="font-size:14px;color:var(--text-muted);line-height:1.7">
        Keine Daten verfügbar.<br>
        Bitte <code style="color:var(--green)">python3 fetch_data.py</code> ausführen.
      </div>
    </div>`;
  return;
}

// ── User-Konfiguration laden (Größe, Alter, Geschlecht für Berechnungen) ────
let userCfg = { height_cm: 180, birth_year: 1990, gender: 'male', step_goal: 10000, activity_level: 'moderate' };
try {
  const cfgRes = await fetch(`${BASE}/data/user_config.json?t=${Date.now()}`);
  if (cfgRes.ok) {
    const raw = await cfgRes.json();
    userCfg = { ...userCfg, ...raw };
  }
} catch (e) { /* Defaults verwenden */ }

// ── Datum + Timestamp ────────────────────────────────────────────────────────
const today = new Date();
const dateEl = $('header-date');
if (dateEl) {
  dateEl.textContent = today.toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
}

if (data.updated_at) {
  const d = new Date(data.updated_at);
  $('updated-time').textContent = d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

// ── Chart-Registry (destroy vor recreate) ───────────────────────────────────
const charts = {};

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

// ── Error-Boundary: schützt jede Karte vor Abstürzen ────────────────────────
function safeRender(fn, cardId) {
  // Shimmer entfernen bevor gerendert wird
  const bodyEl = $(`${cardId}-body`);
  if (bodyEl) bodyEl.classList.remove('card-loading');
  try {
    fn();
  } catch (err) {
    console.error(`[${cardId}] Render-Fehler:`, err);
    const el = $(cardId + '-body') || document.querySelector(`[id="${cardId}-body"]`);
    if (el) {
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
             flex:1;gap:8px;color:var(--text-muted);text-align:center;padding:20px">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="opacity:.4">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span style="font-size:11px;font-weight:600">Fehler beim Laden</span>
          <span style="font-size:9px;opacity:.6">${err.message || 'Unbekannter Fehler'}</span>
        </div>`;
    }
  }
}

// ── Gemeinsame Chart-Defaults ────────────────────────────────────────────────
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: {
    duration: 800,
    easing: 'easeOutQuart',
    delay: (context) => context.dataIndex * 18,
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1c1c1e',
      borderColor: 'rgba(255,255,255,0.10)',
      borderWidth: 1,
      titleColor: 'var(--text-muted)',
      bodyColor: '#f0f0f0',
      padding: 10,
    },
  },
};

// ── Chart Gradient Fill Helper ───────────────────────────────────────────────
// Erstellt einen vertikalen Canvas-Gradient für Linien-Chart Flächen
function gradientFill(r, g, b, alpha1 = 0.38, alpha2 = 0.02) {
  return (context) => {
    const { chart } = context;
    const { ctx, chartArea } = chart;
    if (!chartArea) return `rgba(${r},${g},${b},${alpha1})`;
    const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    grad.addColorStop(0, `rgba(${r},${g},${b},${alpha1})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${alpha2})`);
    return grad;
  };
}

function xScaleOpts() {
  return {
    grid: { display: false },
    ticks: { color: '#55585f', font: { size: 10, family: 'Inter' } },
  };
}

function yScaleOpts(min, max, stepSize, suffix = '') {
  return {
    min, max,
    grid: { color: 'rgba(255,255,255,0.05)' },
    ticks: {
      color: '#55585f',
      font: { size: 10, family: 'Inter' },
      stepSize,
      callback: v => suffix ? `${v}${suffix}` : v,
    },
  };
}

// Wochentag-Labels aus History-Array (ältester zuerst)
function dayLabels(days) {
  return [...days].reverse().map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    return dt.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' });
  });
}

// ── History-Slice ────────────────────────────────────────────────────────────
const historyDays = data.history?.days || [];

function getSlice(range) {
  const n = range === '7d' ? 7 : 30;
  return historyDays.slice(0, n);   // newest first
}

// ═══════════════════════════════════════════════════════════════════════════
//  RECOVERY CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderRecovery(range) {
  destroyChart('recovery');
  const el = $('recovery-body');

  const hrv     = data.hrv || {};
  const hrvVal  = hrv.lastNight;
  const weekAvg = hrv.weeklyAvg;
  const rhr     = data.restingHeartRate;
  const tr      = data.trainingReadiness;

  if (range === 'today') {
    // Recovery-Score berechnen
    let pct = 0, ringColor = '#1ed760', ringGlow = 'rgba(30,215,96,0.4)', statusText = '—', statusClass = '';
    if (hrvVal != null && weekAvg && weekAvg > 0) {
      pct = clamp(Math.round((hrvVal / weekAvg) * 100), 0, 100);
    } else if (hrv.status) {
      const M = { BALANCED:[80,'#1ed760','rgba(30,215,96,0.4)'], UNBALANCED:[35,'#ffa42b','rgba(255,164,43,0.4)'], LOW:[20,'#f3727f','rgba(243,114,127,0.4)'], POOR:[15,'#f3727f','rgba(243,114,127,0.4)'] };
      const m = M[hrv.status];
      if (m) { pct = m[0]; ringColor = m[1]; ringGlow = m[2]; }
    }
    if      (pct >= 67) { statusText = 'OPTIMAL';  statusClass = 'status-optimal';  ringColor = '#1ed760'; ringGlow = 'rgba(30,215,96,0.4)'; }
    else if (pct >= 34) { statusText = 'MODERAT';  statusClass = 'status-moderate'; ringColor = '#ffa42b'; ringGlow = 'rgba(255,164,43,0.4)'; }
    else if (pct >   0) { statusText = 'NIEDRIG';  statusClass = 'status-low';      ringColor = '#f3727f'; ringGlow = 'rgba(243,114,127,0.4)'; }

    const CIRC = 515.22; // 2π × 82
    const offset = CIRC * (1 - pct / 100);

    el.innerHTML = `
      <div class="ring-wrapper">
        <svg class="ring-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle class="ring-track" cx="100" cy="100" r="82"/>
          <circle class="ring-fill" id="r-ring" cx="100" cy="100" r="82"
            style="stroke:${ringColor};filter:drop-shadow(0 0 16px ${ringGlow});stroke-dasharray:${CIRC};stroke-dashoffset:${CIRC}"/>
        </svg>
        <div class="ring-center">
          <div class="ring-pct" style="color:${ringColor}">${pct ? pct + '%' : '—'}</div>
          <div class="ring-label-inner">RECOVERY</div>
          <div class="ring-status ${statusClass}">${statusText}</div>
        </div>
      </div>
      <div class="hrv-row">
        <div class="hrv-metric">
          <div class="hrv-value">${hrvVal ?? '—'}</div>
          <div class="hrv-sub">ms HRV</div>
        </div>
        <div class="hrv-divider"></div>
        <div class="hrv-metric">
          <div class="hrv-value">${weekAvg ? weekAvg + ' ms' : '—'}</div>
          <div class="hrv-sub">Wöch. ø</div>
        </div>
      </div>
      ${tr != null ? `
      <div class="readiness-row">
        <span class="readiness-label">TRAINING READINESS</span>
        <span class="readiness-val" style="color:${tr>=67?'var(--green)':tr>=34?'var(--yellow)':'var(--red)'}">${tr}</span>
      </div>` : ''}
      <div class="rhr-bar">
        <span class="rhr-label">RHR</span>
        <span class="rhr-value">${rhr ? rhr + ' bpm' : '— bpm'}</span>
      </div>
      ${(() => {
        // HRV-Trend: Wöch.Ø vs. 30T-Baseline
        const hvs = historyDays.slice(0,30).map(d=>d.hrv).filter(v=>v!=null);
        const wk7  = historyDays.slice(0,7).map(d=>d.hrv).filter(v=>v!=null);
        if (!hvs.length && weekAvg) {
          // Nur weeklyAvg verfügbar — zeige Wöchentlich vs. keine Basis
          return `<div class="rhr-bar" style="margin-top:6px"><span class="rhr-label">HRV ø 7T</span><span class="rhr-value">${weekAvg} ms</span></div>`;
        }
        const avg7 = wk7.length ? Math.round(wk7.reduce((a,b)=>a+b,0)/wk7.length) : weekAvg;
        const avg30 = hvs.length ? Math.round(hvs.reduce((a,b)=>a+b,0)/hvs.length) : null;
        if (!avg7) return '';
        const trendPct = avg30 ? Math.round((avg7/avg30-1)*100) : null;
        const trendStr = trendPct == null ? '' : (trendPct>0?`↑ +${trendPct}%`:`↓ ${trendPct}%`);
        const trendCol = trendPct == null ? 'var(--text-muted)' : trendPct>=0 ? 'var(--green)' : 'var(--red)';
        return `<div class="rhr-bar" style="margin-top:6px"><span class="rhr-label">HRV TREND</span><span class="rhr-value" style="color:${trendCol}">${trendStr || `${avg7} ms`}</span></div>`;
      })()}`;

    // Animiere Ring + Zahl nach Render
    setTimeout(() => {
      const ring = document.getElementById('r-ring');
      if (ring) ring.style.strokeDashoffset = offset;
      if (pct > 0) {
        const pctEl = el.querySelector('.ring-pct');
        if (pctEl) countUp(pctEl, pct, 1300, v => Math.round(v) + '%');
      }
    }, 120);

  } else {
    // ── WHOOP-Style: Belastung & Erholung ─────────────────────────────
    const slice    = getSlice(range);
    const n        = slice.length;
    const reversed = [...slice].reverse(); // oldest first

    // X-Labels: Wochentag + Tag (2-zeilig via Array)
    const labelStep = n > 14 ? Math.ceil(n / 8) : 1;
    const xLabels = reversed.map((d, i) => {
      if (n > 14 && i % labelStep !== 0) return ['', ''];
      const dt = new Date(d.date + 'T12:00:00');
      return [
        dt.toLocaleDateString('de-DE', { weekday: 'short' }),
        dt.getDate().toString(),
      ];
    });

    // Erholung (rechte Achse 0–100%) — Sleep Score als Proxy, wenn kein HRV
    const recoveryVals = reversed.map(d => {
      if (d.hrv != null && hrv.weeklyAvg) return clamp(Math.round(d.hrv / hrv.weeklyAvg * 100), 0, 100);
      return d.sleepScore ?? null;
    });

    // Belastung (linke Achse 0–21) — Stress auf WHOOP-Strain-Skala mappen
    const strainVals = reversed.map(d =>
      d.avgStress != null ? +(d.avgStress / 100 * 21).toFixed(1) : null
    );

    // Farbe je Recovery-Wert
    const recovColor = v => v == null ? 'transparent' : v >= 67 ? '#1ed760' : v >= 34 ? '#ffa42b' : '#f3727f';

    // Custom Plugin: Wert-Labels direkt am Punkt + Heute-Spalte
    const whoop_plugin = {
      id: 'whoopLabels',
      afterDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        const lastIdx = chart.data.labels.length - 1;

        // Heute-Spalte
        const xScale = scales.x;
        const todayX = xScale.getPixelForValue(lastIdx);
        const colW   = xScale.width / (lastIdx + 1);
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(todayX - colW / 2, chartArea.top, colW, chartArea.height);
        ctx.restore();

        // Wert-Labels
        chart.data.datasets.forEach((ds, di) => {
          const meta = chart.getDatasetMeta(di);
          meta.data.forEach((pt, pi) => {
            const v = ds.data[pi];
            if (v == null) return;

            let color, text;
            if (di === 0) {
              // Erholung
              color = recovColor(v);
              text  = `${Math.round(v)}%`;
            } else {
              // Belastung
              color = '#539df5';
              text  = v.toFixed(1);
            }

            ctx.save();
            ctx.font = `bold ${n > 14 ? 8 : 10}px Inter, sans-serif`;
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            // Abwechselnd oben/unten um Überlappung zu vermeiden
            const above = pi % 2 === 0;
            ctx.fillText(text, pt.x, pt.y + (above ? -10 : 14));
            ctx.restore();
          });
        });
      },
    };

    el.innerHTML = `
      <div class="whoop-chart-header">
        <span class="whoop-chart-title">BELASTUNG &amp; ERHOLUNG</span>
        <div class="whoop-chart-legend">
          <span class="wc-leg"><span style="background:#539df5"></span>Belastung</span>
          <span class="wc-leg"><span style="background:#888"></span>Erholung</span>
        </div>
      </div>
      <div class="chart-wrap" style="height:220px;flex:none"><canvas id="recovery-chart"></canvas></div>`;

    charts['recovery'] = new Chart($('recovery-chart').getContext('2d'), {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          {
            label: 'Erholung %',
            data: recoveryVals,
            borderColor: 'rgba(180,180,180,0.7)',
            borderWidth: 2,
            tension: 0,
            spanGaps: true,
            pointRadius: n > 14 ? 4 : 6,
            pointHoverRadius: 8,
            pointBackgroundColor: recoveryVals.map(recovColor),
            pointBorderColor: '#0f1011',
            pointBorderWidth: 2,
            yAxisID: 'yRecov',
          },
          {
            label: 'Belastung',
            data: strainVals,
            borderColor: '#539df5',
            borderWidth: 2,
            tension: 0,
            spanGaps: true,
            pointRadius: n > 14 ? 4 : 6,
            pointHoverRadius: 8,
            pointBackgroundColor: '#539df5',
            pointBorderColor: '#0f1011',
            pointBorderWidth: 2,
            yAxisID: 'yStrain',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: 'easeOutQuart' },
        layout: { padding: { top: 20, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1c1c1e',
            borderColor: 'rgba(255,255,255,0.10)',
            borderWidth: 1,
            titleColor: '#a8aaad',
            bodyColor: '#f0f0f0',
            padding: 10,
            callbacks: {
              label: ctx => ctx.datasetIndex === 0
                ? ` Erholung: ${Math.round(ctx.raw)}%`
                : ` Belastung: ${ctx.raw?.toFixed(1)}`,
            },
          },
          whoopLabels: whoop_plugin,
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: '#55585f',
              font: { size: 9, family: 'Inter' },
              maxRotation: 0,
              autoSkip: false,
            },
          },
          yRecov: {
            position: 'right',
            min: 0, max: 100,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: '#55585f',
              font: { size: 9 },
              stepSize: 33,
              callback: v => v === 0 ? '0%' : v === 33 ? '33%' : v === 66 ? '66%' : v === 99 ? '100%' : null,
            },
          },
          yStrain: {
            position: 'left',
            min: 0, max: 21,
            grid: { display: false },
            ticks: {
              color: '#55585f',
              font: { size: 9 },
              stepSize: 7,
            },
          },
        },
      },
      plugins: [whoop_plugin],
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  BODY BATTERY CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderBattery(range) {
  destroyChart('battery');
  const el = $('battery-body');

  const bb      = data.bodyBattery || {};
  const bbHist  = bb.history || [];
  const today   = bbHist[0] || {};
  const display = bb.current ?? today.charged ?? null;

  const color = display != null
    ? (display >= 70 ? '#1ed760' : display >= 40 ? '#ffa42b' : '#f3727f')
    : 'var(--text-muted)';

  if (range === 'today') {
    const net = (today.charged ?? 0) - (today.drained ?? 0);
    const netStr = net > 0 ? `+${net}` : `${net}`;

    el.innerHTML = `
      <div class="bb-top">
        <span class="bb-value" style="color:${color}">${display ?? '—'}</span>
        <span class="bb-unit">%</span>
        <span class="bb-trend" style="color:${net>0?'var(--green)':net<0?'var(--red)':'var(--text-muted)'}">${net !== 0 ? netStr : ''}</span>
      </div>
      <div class="bb-label">${bb.current != null ? 'AKTUELL' : 'GELADEN HEUTE'}</div>
      ${display != null ? `<span class="status-badge ${display >= 70 ? 'badge-green' : display >= 40 ? 'badge-yellow' : 'badge-red'}">${display >= 70 ? 'OPTIMAL' : display >= 40 ? 'MODERAT' : 'NIEDRIG'}</span>` : ''}
      <div class="bb-today-stats">
        <div class="bb-stat"><span class="bb-stat-dot" style="background:#1ed760"></span><span class="bb-stat-val">${today.charged ?? '—'}</span><span class="bb-stat-lbl">Geladen</span></div>
        <div class="bb-stat"><span class="bb-stat-dot" style="background:#f3727f"></span><span class="bb-stat-val">${today.drained ?? '—'}</span><span class="bb-stat-lbl">Verbraucht</span></div>
      </div>
      <div class="chart-wrap"><canvas id="battery-chart"></canvas></div>`;

    // Animate main number
    const bbNumEl = el.querySelector('.bb-value');
    if (bbNumEl && display != null) countUp(bbNumEl, display, 900);

    const slice  = bbHist.slice(0, 7);
    const labels = [...slice].reverse().map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' }));

    charts['battery'] = new Chart($('battery-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Geladen',    data: [...slice].reverse().map(d => d.charged ?? 0), backgroundColor: 'rgba(30,215,96,0.65)',    hoverBackgroundColor: 'rgba(30,215,96,0.90)',    borderRadius: 4, borderSkipped: false },
          { label: 'Verbraucht', data: [...slice].reverse().map(d => d.drained ?? 0), backgroundColor: 'rgba(243,114,127,0.50)', hoverBackgroundColor: 'rgba(243,114,127,0.80)', borderRadius: 4, borderSkipped: false },
        ],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { display: true, position: 'top', align: 'end', labels: { color: '#55585f', font: { size: 9, family: 'Inter' }, boxWidth: 8, boxHeight: 8, padding: 8 } },
        },
        scales: { x: xScaleOpts(), y: yScaleOpts(0, 100, 25) },
      },
    });

  } else {
    // Für 7T/30T: Range aus history.days
    const slice  = historyDays.slice(0, range === '7d' ? 7 : 30);
    const labels = dayLabels(slice);

    el.innerHTML = `
      <div class="bb-top">
        <span class="bb-value" style="color:${color}">${display ?? '—'}</span>
        <span class="bb-unit">%</span>
      </div>
      <div class="bb-label">${range === '7d' ? '7-TAGE VERLAUF' : '30-TAGE VERLAUF'}</div>
      <div class="chart-wrap" style="flex:1"><canvas id="battery-chart"></canvas></div>`;

    charts['battery'] = new Chart($('battery-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Geladen',    data: [...slice].reverse().map(d => d.bbCharged ?? 0), backgroundColor: 'rgba(30,215,96,0.60)',    hoverBackgroundColor: 'rgba(30,215,96,0.85)',    borderRadius: 3, borderSkipped: false },
          { label: 'Verbraucht', data: [...slice].reverse().map(d => d.bbDrained ?? 0), backgroundColor: 'rgba(243,114,127,0.45)', hoverBackgroundColor: 'rgba(243,114,127,0.75)', borderRadius: 3, borderSkipped: false },
        ],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { display: true, position: 'top', align: 'end', labels: { color: '#55585f', font: { size: 9, family: 'Inter' }, boxWidth: 8, boxHeight: 8, padding: 8 } },
        },
        scales: { x: xScaleOpts(), y: yScaleOpts(0, 100, 25) },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCHLAF CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderSleep(range) {
  destroyChart('sleep');
  const el = $('sleep-body');
  const sleep = data.sleep || {};

  if (range === 'today') {
    const phases = {
      deep:  sleep.deepSeconds  || 0,
      rem:   sleep.remSeconds   || 0,
      light: sleep.lightSeconds || 0,
      awake: sleep.awakeSeconds || 0,
    };
    const total = Object.values(phases).reduce((a, b) => a + b, 0);

    // Schlafeffizienz: Schlafzeit / Gesamtbettzeit × 100
    const inBedSec    = (sleep.totalSeconds || 0) + (sleep.awakeSeconds || 0);
    const efficiency  = inBedSec > 0 ? Math.round((sleep.totalSeconds || 0) / inBedSec * 100) : null;
    const effColor    = efficiency == null ? 'var(--text-muted)' : efficiency >= 85 ? 'var(--green)' : efficiency >= 75 ? 'var(--yellow)' : 'var(--red)';

    // Schlafschulden: 7-Tage kumulativ (Ziel: 8h)
    const TARGET_SLEEP = 8 * 3600;
    const last7sleep   = historyDays.slice(0, 7);
    const debtSec      = last7sleep.reduce((acc, d) => acc + (d.sleepSeconds != null ? Math.max(0, TARGET_SLEEP - d.sleepSeconds) : 0), 0);
    const debtStr      = debtSec > 0 ? fmtHM(debtSec) : '0m';
    const debtColor    = debtSec === 0 ? 'var(--green)' : debtSec < 7200 ? 'var(--yellow)' : 'var(--red)';

    el.innerHTML = `
      <div class="sleep-top">
        <span class="sleep-score">${sleep.score ?? '—'}</span>
        <span class="sleep-dur">${fmtHM(sleep.totalSeconds)}</span>
      </div>
      ${sleep.score != null ? `<span class="status-badge ${sleep.score >= 80 ? 'badge-purple' : sleep.score >= 60 ? 'badge-yellow' : 'badge-red'}">${sleep.score >= 80 ? 'GUT GESCHLAFEN' : sleep.score >= 60 ? 'AUSREICHEND' : 'SCHLECHT'}</span>` : ''}
      <div class="phase-bar" id="phase-bar">
        <div class="phase deep"  id="ph-deep"></div>
        <div class="phase rem"   id="ph-rem"></div>
        <div class="phase light" id="ph-light"></div>
        <div class="phase awake" id="ph-awake"></div>
      </div>
      <div class="phase-legend">
        <div class="leg"><span class="dot deep"></span>Tief <b>${fmtHM(sleep.deepSeconds)}</b></div>
        <div class="leg"><span class="dot rem"></span>REM <b>${fmtHM(sleep.remSeconds)}</b></div>
        <div class="leg"><span class="dot light"></span>Leicht <b>${fmtHM(sleep.lightSeconds)}</b></div>
        <div class="leg"><span class="dot awake"></span>Wach <b>${fmtHM(sleep.awakeSeconds)}</b></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <div style="flex:1;background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:8px;padding:8px 10px">
          <div style="font-size:16px;font-weight:800;color:${effColor}">${efficiency != null ? efficiency + '%' : '—'}</div>
          <div style="font-size:8px;font-weight:700;letter-spacing:1px;color:var(--text-muted);text-transform:uppercase;margin-top:3px">EFFIZIENZ</div>
        </div>
        <div style="flex:1;background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:8px;padding:8px 10px">
          <div style="font-size:16px;font-weight:800;color:${debtColor}">${debtStr}</div>
          <div style="font-size:8px;font-weight:700;letter-spacing:1px;color:var(--text-muted);text-transform:uppercase;margin-top:3px">SCHULDEN 7T</div>
        </div>
      </div>`;

    // Animate sleep score
    const sleepScoreEl = el.querySelector('.sleep-score');
    if (sleepScoreEl && sleep.score != null) countUp(sleepScoreEl, sleep.score, 900);

    if (total > 0) {
      setTimeout(() => {
        document.getElementById('ph-deep').style.width  = `${(phases.deep  / total * 100).toFixed(1)}%`;
        document.getElementById('ph-rem').style.width   = `${(phases.rem   / total * 100).toFixed(1)}%`;
        document.getElementById('ph-light').style.width = `${(phases.light / total * 100).toFixed(1)}%`;
        document.getElementById('ph-awake').style.width = `${(phases.awake / total * 100).toFixed(1)}%`;
      }, 200);
    }

  } else {
    const slice  = historyDays.slice(0, range === '7d' ? 7 : 30);
    const labels = dayLabels(slice);
    const scores = [...slice].reverse().map(d => d.sleepScore ?? null);
    const hours  = [...slice].reverse().map(d => d.sleepSeconds != null ? +(d.sleepSeconds / 3600).toFixed(1) : null);

    const avgScore = scores.filter(Boolean).length
      ? Math.round(scores.filter(Boolean).reduce((a, b) => a + b, 0) / scores.filter(Boolean).length)
      : null;

    el.innerHTML = `
      <div class="sleep-top">
        <span class="sleep-score">${sleep.score ?? '—'}</span>
        <span class="sleep-dur">${avgScore != null ? `ø ${avgScore}` : ''}</span>
      </div>
      <div class="trend-chart-label">SCORE & STUNDEN</div>
      <div class="chart-wrap" style="flex:1"><canvas id="sleep-chart"></canvas></div>`;

    charts['sleep'] = new Chart($('sleep-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Score',
            data: scores,
            backgroundColor: scores.map(s => s == null ? 'transparent' : s >= 80 ? 'rgba(167,139,250,0.7)' : s >= 60 ? 'rgba(167,139,250,0.45)' : 'rgba(243,114,127,0.5)'),
            borderRadius: 4,
            borderSkipped: false,
            yAxisID: 'yScore',
          },
          {
            label: 'Stunden',
            data: hours,
            type: 'line',
            borderColor: '#539df5',
            backgroundColor: gradientFill(83, 157, 245, 0.30, 0.02),
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#539df5',
            tension: 0.3,
            spanGaps: true,
            yAxisID: 'yHours',
          },
        ],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { display: true, position: 'top', align: 'end', labels: { color: '#55585f', font: { size: 9, family: 'Inter' }, boxWidth: 8, boxHeight: 8, padding: 8 } },
        },
        scales: {
          x: xScaleOpts(),
          yScore: { min: 0, max: 100, position: 'left',  grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#55585f', font: { size: 9 }, stepSize: 25 } },
          yHours: { min: 0, max: 12,  position: 'right', grid: { display: false },                  ticks: { color: '#539df5', font: { size: 9 }, stepSize: 3, callback: v => `${v}h` } },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCHRITTE CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderSteps(range) {
  destroyChart('steps');
  const el = $('steps-body');
  const GOAL = userCfg.step_goal || 10000;

  const stepsToday = data.stepsToday ?? historyDays[0]?.steps ?? null;

  if (range === 'today') {
    const pct = stepsToday != null ? clamp(Math.round(stepsToday / GOAL * 100), 0, 100) : 0;
    const color = stepsToday != null
      ? (stepsToday >= GOAL ? '#1ed760' : stepsToday >= 7000 ? '#ffa42b' : '#f3727f')
      : 'var(--text-muted)';

    // Schrittziel-Rate: % Tage mit ≥ GOAL Schritten (30 Tage)
    const daysWithSteps = historyDays.slice(0, 30).filter(d => d.steps != null);
    const daysAtGoal    = daysWithSteps.filter(d => d.steps >= GOAL);
    const goalRate      = daysWithSteps.length > 0 ? Math.round(daysAtGoal.length / daysWithSteps.length * 100) : null;
    const rateColor     = goalRate == null ? 'var(--text-muted)' : goalRate >= 70 ? 'var(--green)' : goalRate >= 40 ? 'var(--yellow)' : 'var(--red)';

    el.innerHTML = `
      <div class="steps-top">
        <span class="steps-value" style="color:${color}">${stepsToday != null ? stepsToday.toLocaleString('de-DE') : '—'}</span>
        <span class="steps-unit">Schritte</span>
      </div>
      <div class="steps-goal-row">
        <span class="steps-goal-lbl">ZIEL ${GOAL.toLocaleString('de-DE')}</span>
        <span class="steps-goal-pct" style="color:${color}">${pct}%</span>
      </div>
      <div class="steps-track">
        <div class="steps-fill" id="steps-fill" style="background:${color}"></div>
      </div>
      ${stepsToday != null ? `<span class="status-badge ${pct >= 100 ? 'badge-green' : pct >= 70 ? 'badge-yellow' : 'badge-red'}">${pct >= 100 ? 'ZIEL ERREICHT' : pct >= 70 ? 'FAST DA' : 'WEITER SO'}</span>` : ''}
      ${goalRate != null ? `
      <div style="margin-top:10px;background:var(--surface-1);border:1px solid var(--border-subtle);border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:8px;font-weight:700;letter-spacing:1px;color:var(--text-muted);text-transform:uppercase">ZIEL-RATE 30T</span>
        <span style="font-size:18px;font-weight:800;color:${rateColor}">${goalRate}%</span>
      </div>` : ''}`;

    // Animate step count
    const stepsNumEl = el.querySelector('.steps-value');
    if (stepsNumEl && stepsToday != null) {
      countUp(stepsNumEl, stepsToday, 1100, v => Math.round(v).toLocaleString('de-DE'));
    }

    setTimeout(() => {
      const fill = document.getElementById('steps-fill');
      if (fill) fill.style.width = `${pct}%`;
    }, 200);

  } else {
    const slice  = historyDays.slice(0, range === '7d' ? 7 : 30);
    const labels = dayLabels(slice);
    const vals   = [...slice].reverse().map(d => d.steps ?? null);

    const avg = vals.filter(Boolean).length
      ? Math.round(vals.filter(Boolean).reduce((a, b) => a + b, 0) / vals.filter(Boolean).length)
      : null;

    el.innerHTML = `
      <div class="steps-top">
        <span class="steps-value" style="color:var(--green)">${stepsToday != null ? stepsToday.toLocaleString('de-DE') : '—'}</span>
        <span class="steps-unit">Heute</span>
      </div>
      ${avg != null ? `<div class="steps-goal-row"><span class="steps-goal-lbl">ø ${range === '7d' ? '7T' : '30T'}</span><span class="steps-goal-pct">${avg.toLocaleString('de-DE')}</span></div>` : ''}
      <div class="chart-wrap" style="flex:1"><canvas id="steps-chart"></canvas></div>`;

    charts['steps'] = new Chart($('steps-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Schritte',
          data: vals,
          backgroundColor: vals.map(v => v == null ? 'transparent' : v >= GOAL ? 'rgba(30,215,96,0.65)' : v >= 7000 ? 'rgba(255,164,43,0.60)' : 'rgba(243,114,127,0.55)'),
          hoverBackgroundColor: 'rgba(255,255,255,0.2)',
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          tooltip: {
            ...CHART_DEFAULTS.plugins.tooltip,
            callbacks: { label: ctx => ` ${(ctx.parsed.y || 0).toLocaleString('de-DE')} Schritte` },
          },
        },
        scales: {
          x: xScaleOpts(),
          y: {
            min: 0,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#55585f', font: { size: 10 }, callback: v => v >= 1000 ? `${v/1000}k` : v },
          },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  STRESS CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderStress(range) {
  destroyChart('stress');
  const el = $('stress-body');
  const stress = data.stress || {};
  const avg = stress.avgStressLevel;

  let label = '—', color = 'var(--text)';
  if (avg != null) {
    if      (avg < 26) { label = 'RUHIG';   color = '#1ed760'; }
    else if (avg < 51) { label = 'NIEDRIG'; color = '#ffa42b'; }
    else if (avg < 76) { label = 'MODERAT'; color = '#ffa42b'; }
    else               { label = 'HOCH';    color = '#f3727f'; }
  }

  if (range === 'today') {
    el.innerHTML = `
      <div class="metric-big" style="color:${color}">${avg ?? '—'}</div>
      <div class="metric-sub">${label}</div>
      <div class="stress-track">
        <div class="stress-fill"></div>
        <div class="stress-thumb" id="s-thumb"></div>
      </div>
      <div class="stress-scale"><span>RUHIG</span><span>HOCH</span></div>`;

    // Animate stress number
    const stressNumEl = el.querySelector('.metric-big');
    if (stressNumEl && avg != null) countUp(stressNumEl, avg, 900);

    setTimeout(() => {
      const t = document.getElementById('s-thumb');
      if (t && avg != null) t.style.left = `${clamp(avg, 0, 100)}%`;
    }, 300);

  } else {
    const slice  = historyDays.slice(0, range === '7d' ? 7 : 30);
    const labels = dayLabels(slice);
    const vals   = [...slice].reverse().map(d => d.avgStress ?? null);

    const avgTrend = vals.filter(Boolean).length
      ? Math.round(vals.filter(Boolean).reduce((a, b) => a + b, 0) / vals.filter(Boolean).length)
      : null;

    el.innerHTML = `
      <div class="metric-big" style="color:${color}">${avg ?? '—'}</div>
      <div class="metric-sub">${avgTrend != null ? `ø ${avgTrend} — ${range === '7d' ? '7 Tage' : '30 Tage'}` : label}</div>
      <div class="chart-wrap" style="flex:1"><canvas id="stress-chart"></canvas></div>`;

    charts['stress'] = new Chart($('stress-chart').getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: vals,
          borderColor: '#ffa42b',
          backgroundColor: ctx => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 120);
            g.addColorStop(0, 'rgba(255,164,43,0.20)');
            g.addColorStop(1, 'rgba(255,164,43,0.00)');
            return g;
          },
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#ffa42b',
          tension: 0.35,
          fill: true,
          spanGaps: true,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        scales: { x: xScaleOpts(), y: yScaleOpts(0, 100, 25) },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AKTIVITÄTEN CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderActivity(range) {
  const el = $('activity-body');
  const activities = data.history?.activities || [];
  const last = data.lastActivity;

  if (range === 'today') {
    const act = last || activities[0];
    if (!act) {
      el.innerHTML = `<div class="act-empty">Keine Aktivität gefunden</div>`;
      return;
    }
    el.innerHTML = `
      <div class="act-name">${actTypeIcon(act.type)} ${act.name || '—'}</div>
      <div class="act-grid">
        <div class="act-stat"><div class="act-stat-label">DISTANZ</div><div class="act-stat-val">${fmtDist(act.distanceMeters)}</div></div>
        <div class="act-stat"><div class="act-stat-label">DAUER</div><div class="act-stat-val">${fmtSec(act.durationSeconds)}</div></div>
        <div class="act-stat"><div class="act-stat-label">Ø PULS</div><div class="act-stat-val">${act.avgHr ? act.avgHr + ' bpm' : '—'}</div></div>
        <div class="act-stat"><div class="act-stat-label">KALORIEN</div><div class="act-stat-val">${act.calories ? Math.round(act.calories) + ' kcal' : '—'}</div></div>
      </div>`;

  } else {
    const daysBack = range === '7d' ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const filtered = activities.filter(a => {
      if (!a.date) return false;
      return new Date(a.date) >= cutoff;
    });

    const totalKm = filtered.reduce((s, a) => s + (a.distanceMeters || 0), 0) / 1000;
    const totalMin = filtered.reduce((s, a) => s + (a.durationSeconds || 0), 0) / 60;

    if (filtered.length === 0) {
      el.innerHTML = `<div class="act-empty">Keine Aktivitäten in diesem Zeitraum</div>`;
      return;
    }

    el.innerHTML = `
      <div class="act-summary">
        <div class="act-sum-stat"><span class="act-sum-val">${filtered.length}</span><span class="act-sum-lbl">Aktivitäten</span></div>
        <div class="act-sum-stat"><span class="act-sum-val">${totalKm.toFixed(1)} km</span><span class="act-sum-lbl">Gesamt</span></div>
        <div class="act-sum-stat"><span class="act-sum-val">${Math.round(totalMin)} min</span><span class="act-sum-lbl">Dauer</span></div>
      </div>
      <div class="act-list">
        ${filtered.slice(0, range === '7d' ? 10 : 20).map(a => `
          <div class="act-item">
            <span class="act-item-icon">${actTypeIcon(a.type)}</span>
            <div class="act-item-info">
              <div class="act-item-name">${a.name || a.type || '—'}</div>
              <div class="act-item-meta">${fmtDate(a.date)} · ${fmtDist(a.distanceMeters)} · ${fmtSec(a.durationSeconds)}</div>
            </div>
            <div class="act-item-hr">${a.avgHr ? a.avgHr + ' bpm' : ''}</div>
          </div>`).join('')}
      </div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  FITNESSALTER CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderFitnessAge() {
  const el = $('fitness-age-body');
  const fitnessAge = data.fitnessAge;

  // Chronologisches Alter aus Garmin-Profil ist nicht direkt verfügbar,
  // wir zeigen nur das Fitnessalter + Trend
  if (fitnessAge == null) {
    el.innerHTML = `<div class="fa-empty">Fitnessalter nicht verfügbar.<br><small>Garmin benötigt ausreichend Aktivitätsdaten.</small></div>`;
    return;
  }

  // Für einen Altersvergleich brauchen wir das echte Alter — hardcode nicht möglich,
  // also zeigen wir einfach das Fitnessalter prominent.
  // Farbe: je niedriger desto besser (hier vereinfacht)
  const color = fitnessAge <= 30 ? '#1ed760' : fitnessAge <= 40 ? '#ffa42b' : '#f3727f';

  el.innerHTML = `
    <div class="fa-main">
      <div class="fa-value" style="color:${color}" id="fa-val">—</div>
      <div class="fa-unit">Jahre</div>
    </div>
    <div class="fa-label">BIOLOGISCHES ALTER</div>
    <div class="fa-sub">Basiert auf VO2max, Ruhepuls &amp; Aktivitätslevel</div>
    <div class="fa-bar-wrap">
      <div class="fa-bar-track">
        <div class="fa-bar-fill" id="fa-fill" style="background:${color}"></div>
      </div>
      <div class="fa-bar-labels"><span>20</span><span>40</span><span>60</span><span>80+</span></div>
    </div>`;

  // Odometer
  const faEl = document.getElementById('fa-val');
  if (faEl) countUp(faEl, fitnessAge, 1000);

  // Bar fill (20–80 range mapped to 0–100%)
  setTimeout(() => {
    const fill = document.getElementById('fa-fill');
    if (fill) fill.style.width = `${clamp((fitnessAge - 20) / 60 * 100, 2, 100)}%`;
  }, 200);
}

// ═══════════════════════════════════════════════════════════════════════════
//  KÖRPERDATEN CARD (Garmin Index S2)
// ═══════════════════════════════════════════════════════════════════════════
function renderBodyComp(range) {
  destroyChart('bodycomp');
  const el = $('bodycomp-body');
  const bc = data.bodyComposition || [];
  const latest = bc[0] || null;

  if (!latest) {
    el.innerHTML = `<div class="fa-empty">Keine Waagendaten vorhanden.<br><small>Garmin Index S2 muss mit deinem Account verbunden sein.</small></div>`;
    return;
  }

  const w   = latest.weight;      // kg
  const fat = latest.bodyFat;     // %
  const mus = latest.muscleMass;  // kg (Index S2) oder null
  const bmi = latest.bmi;
  const bon = latest.boneMass;    // kg
  const wat = latest.bodyWater;   // %

  const fatColor = fat != null ? (fat < 15 ? '#539df5' : fat < 22 ? '#1ed760' : fat < 28 ? '#ffa42b' : '#f3727f') : 'var(--text-muted)';
  const musLabel = mus != null ? 'MUSKELMASSE kg' : 'KNOCHENMASSE kg';
  const musVal   = mus ?? bon;
  const musColor = '#a78bfa';

  // Fettmasse in kg berechnen
  const fatKg   = (w != null && fat != null) ? +(w * fat / 100).toFixed(1) : null;
  const fatKgColor = fatColor;

  if (range === 'today') {
    el.innerHTML = `
      <div class="bc-top">
        <span class="bc-weight" id="bc-w">—</span>
        <span class="bc-weight-unit">kg</span>
      </div>
      <div class="bc-grid">
        <div class="bc-metric">
          <div class="bc-metric-val" style="color:${fatColor}" id="bc-fat">—</div>
          <div class="bc-metric-lbl">KÖRPERFETT %</div>
        </div>
        <div class="bc-metric">
          <div class="bc-metric-val" style="color:${fatKgColor}" id="bc-fatkg">—</div>
          <div class="bc-metric-lbl">FETTMASSE kg</div>
        </div>
        <div class="bc-metric">
          <div class="bc-metric-val" style="color:${musColor}" id="bc-mus">—</div>
          <div class="bc-metric-lbl">${musLabel}</div>
        </div>
        <div class="bc-metric">
          <div class="bc-metric-val" id="bc-bmi">—</div>
          <div class="bc-metric-lbl">BMI</div>
        </div>
        <div class="bc-metric">
          <div class="bc-metric-val" style="color:#539df5" id="bc-wat">—</div>
          <div class="bc-metric-lbl">KÖRPERWASSER %</div>
        </div>
        <div class="bc-metric">
          <div class="bc-metric-val" style="color:#539df5" id="bc-h2o-lbl">
            ${w != null && wat != null ? (+((w*(wat/100))).toFixed(1))+'kg' : '—'}
          </div>
          <div class="bc-metric-lbl">KÖRPERWASSER kg</div>
        </div>
      </div>
      <div class="bc-date">Letzte Messung: ${fmtDate(latest.date)}</div>`;

    // Animate numbers
    if (w   != null) countUp($('bc-w'),     w,   900, v => v.toFixed(1));
    if (fat != null) countUp($('bc-fat'),   fat, 800, v => v.toFixed(1) + '%');
    if (fatKg != null) countUp($('bc-fatkg'), fatKg, 800, v => v.toFixed(1));
    if (musVal != null) countUp($('bc-mus'), musVal, 800, v => v.toFixed(1));
    if (bmi != null) countUp($('bc-bmi'),   bmi, 800, v => v.toFixed(1));
    if (wat != null) countUp($('bc-wat'),   wat, 800, v => v.toFixed(1) + '%');

  } else {
    // Verlauf: Gewicht + Körperfett als Linienchart
    const days = range === '30d' ? 30 : 90;
    const slice = bc.slice(0, days);
    const reversed = [...slice].reverse();

    const labels  = reversed.map(d => {
      const dt = new Date(d.date + 'T12:00:00');
      return dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    });
    const weights  = reversed.map(d => d.weight ?? null);
    const fatVals  = reversed.map(d => d.bodyFat ?? null);

    el.innerHTML = `
      <div class="bc-top" style="margin-bottom:6px">
        <span class="bc-weight">${w != null ? w.toFixed(1) : '—'}</span>
        <span class="bc-weight-unit">kg</span>
      </div>
      <div class="bc-legend-row">
        <span class="bc-leg"><span style="background:#f2f3f4"></span>Gewicht (kg)</span>
        <span class="bc-leg"><span style="background:#ffa42b"></span>Körperfett (%)</span>
      </div>
      <div class="chart-wrap" style="flex:1"><canvas id="bodycomp-chart"></canvas></div>`;

    charts['bodycomp'] = new Chart($('bodycomp-chart').getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Gewicht kg',
            data: weights,
            borderColor: 'rgba(242,243,244,0.8)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: slice.length > 20 ? 2 : 4,
            pointBackgroundColor: '#f2f3f4',
            tension: 0.3,
            spanGaps: true,
            yAxisID: 'yWeight',
          },
          {
            label: 'Körperfett %',
            data: fatVals,
            borderColor: '#ffa42b',
            backgroundColor: ctx => {
              const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 120);
              g.addColorStop(0, 'rgba(255,164,43,0.15)');
              g.addColorStop(1, 'rgba(255,164,43,0.00)');
              return g;
            },
            borderWidth: 2,
            pointRadius: slice.length > 20 ? 2 : 4,
            pointBackgroundColor: '#ffa42b',
            tension: 0.3,
            fill: true,
            spanGaps: true,
            yAxisID: 'yFat',
          },
        ],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { display: false },
        },
        scales: {
          x: xScaleOpts(),
          yWeight: {
            position: 'left',
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#55585f', font: { size: 9 }, callback: v => `${v} kg` },
          },
          yFat: {
            position: 'right',
            min: 0, max: 50,
            grid: { display: false },
            ticks: { color: '#ffa42b', font: { size: 9 }, callback: v => `${v}%` },
          },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SPO2 CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderSpO2(range) {
  destroyChart('spo2');
  const el = $('spo2-body');
  const spo2Data = data.spo2 || {};
  const todayVal = spo2Data.today;
  const history  = spo2Data.history || [];

  const getStatus = v => {
    if (v == null) return { label: '—', cls: '', color: 'var(--text-muted)' };
    if (v >= 95) return { label: 'NORMAL', cls: 'optimal', color: 'var(--green)' };
    if (v >= 90) return { label: 'LEICHT NIEDRIG', cls: 'moderate', color: 'var(--yellow)' };
    return { label: 'NIEDRIG', cls: 'low', color: 'var(--red)' };
  };

  if (range === 'today') {
    const st = getStatus(todayVal);
    el.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:4px">
        <span class="spo2-big" style="color:${st.color}" id="spo2-num">${todayVal != null ? '—' : '—'}</span>
        <span class="spo2-unit">%</span>
      </div>
      ${todayVal != null ? `<span class="spo2-status ${st.cls}">${st.label}</span>` : '<span class="spo2-info">Keine SpO2-Daten.<br>Gerät muss SpO2-Messung unterstützen (Fenix 7, FR255 etc.)</span>'}
      <div class="spo2-dots">
        ${[...history].reverse().map(h => {
          const s = getStatus(h.value);
          const barH = h.value != null ? Math.max(4, Math.round((h.value - 88) / 12 * 100)) : 4;
          const dt = new Date(h.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' });
          return `<div class="spo2-dot-wrap">
            <div class="spo2-bar" style="height:${barH}%;background:${s.color};opacity:${h.value?'1':'0.25'}"></div>
            <div class="spo2-dot-lbl">${dt}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="spo2-info">Norm: 95–100%. Unter 90% Arztbesuch empfohlen.</div>`;

    if (todayVal != null) {
      const numEl = document.getElementById('spo2-num');
      if (numEl) countUp(numEl, todayVal, 900, v => Math.round(v).toString());
    }

  } else {
    // 7T Verlaufs-Balkendiagramm
    const labels = [...history].reverse().map(h =>
      new Date(h.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' }));
    const vals = [...history].reverse().map(h => h.value ?? null);
    const avg  = vals.filter(Boolean).length ? +(vals.filter(Boolean).reduce((a,b)=>a+b,0)/vals.filter(Boolean).length).toFixed(1) : null;

    el.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:4px">
        <span class="spo2-big" style="color:var(--green)">${avg != null ? avg : '—'}</span>
        <span class="spo2-unit">% ø</span>
      </div>
      <div class="chart-wrap" style="flex:1"><canvas id="spo2-chart"></canvas></div>`;

    charts['spo2'] = new Chart($('spo2-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'SpO2 %',
          data: vals,
          backgroundColor: vals.map(v => v == null ? 'transparent' : v >= 95 ? 'rgba(30,215,96,0.65)' : v >= 90 ? 'rgba(255,164,43,0.65)' : 'rgba(243,114,127,0.65)'),
          borderRadius: 4, borderSkipped: false,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        scales: {
          x: xScaleOpts(),
          y: { min: 88, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#55585f', font: { size: 9 }, callback: v => `${v}%` } },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RUHEPULS CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderRestingHR(range) {
  destroyChart('restinghr');
  const el = $('restinghr-body');
  const rhrToday = data.restingHeartRate;

  const slice    = historyDays.slice(0, range === '7d' ? 7 : 30);
  const reversed = [...slice].reverse();
  const labels   = dayLabels(slice);
  const vals     = reversed.map(d => d.rhr ?? null);
  const valsFilt = vals.filter(v => v != null);

  const avg  = valsFilt.length ? Math.round(valsFilt.reduce((a,b)=>a+b,0)/valsFilt.length) : null;
  const mn   = valsFilt.length ? Math.min(...valsFilt) : null;
  const mx   = valsFilt.length ? Math.max(...valsFilt) : null;

  // Trend: Vergleich erste vs. letzte Hälfte
  const half = Math.floor(valsFilt.length/2);
  const firstHalf = valsFilt.slice(0, half);
  const lastHalf  = valsFilt.slice(half);
  const avgFirst  = firstHalf.length ? firstHalf.reduce((a,b)=>a+b,0)/firstHalf.length : null;
  const avgLast   = lastHalf.length  ? lastHalf.reduce((a,b)=>a+b,0)/lastHalf.length   : null;
  const trend     = (avgFirst && avgLast) ? Math.round(avgLast - avgFirst) : null;
  const trendStr  = trend == null ? '' : trend > 0 ? `↑ +${trend} bpm` : trend < 0 ? `↓ ${trend} bpm` : '→ stabil';
  const trendCls  = trend == null ? 'flat' : trend > 0 ? 'up' : 'down';

  el.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:2px">
      <span class="rhr-big" id="rhr-num">${rhrToday ?? '—'}</span>
      <span class="rhr-unit">bpm</span>
    </div>
    <div class="rhr-sub">RUHEPULS HEUTE</div>
    ${rhrToday != null ? `<span class="status-badge ${rhrToday < 55 ? 'badge-green' : rhrToday < 70 ? 'badge-blue' : rhrToday < 85 ? 'badge-yellow' : 'badge-red'}" style="margin-top:4px">${rhrToday < 55 ? 'EXZELLENT' : rhrToday < 70 ? 'NORMAL' : rhrToday < 85 ? 'ERHÖHT' : 'HOCH'}</span>` : ''}
    ${trend != null ? `<div class="rhr-trend ${trendCls}">${trendStr} (${range === '7d' ? '7T' : '30T'})</div>` : ''}
    <div class="chart-wrap" style="flex:1;margin-top:10px"><canvas id="restinghr-chart"></canvas></div>
    ${mn != null ? `<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:9px;color:var(--text-muted)"><span>MIN ${mn} bpm</span><span>ø ${avg} bpm</span><span>MAX ${mx} bpm</span></div>` : ''}`;

  if (rhrToday != null) {
    const numEl = document.getElementById('rhr-num');
    if (numEl) countUp(numEl, rhrToday, 800);
  }

  const yMin = mn != null ? Math.max(30, mn - 5) : 40;
  const yMax = mx != null ? Math.min(100, mx + 5) : 80;

  charts['restinghr'] = new Chart($('restinghr-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'RHR bpm',
        data: vals,
        borderColor: '#9333ea',
        backgroundColor: gradientFill(147, 51, 234, 0.40, 0.02),
        fill: true,
        borderWidth: 2,
        pointRadius: vals.map(v => v != null ? 3 : 0),
        pointBackgroundColor: '#9333ea',
        tension: 0.35,
        spanGaps: true,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: xScaleOpts(),
        y: { min: yMin, max: yMax, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#55585f', font: { size: 9 }, callback: v => `${v}` } },
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  KALORIEN CARD
// ═══════════════════════════════════════════════════════════════════════════
function renderCalories(range) {
  destroyChart('calories');
  const el = $('calories-body');

  // Heutige Werte: aus dem neuesten history-Eintrag
  const todayDay    = historyDays[0] || {};
  const activeCal   = todayDay.activeCalories ?? null;
  const bmrCal      = todayDay.bmrCalories    ?? null;
  const totalCal    = activeCal != null && bmrCal != null ? activeCal + bmrCal : null;
  const fillPct     = totalCal && activeCal ? Math.round(activeCal / totalCal * 100) : 0;

  if (range === 'today') {
    const noData = activeCal == null && bmrCal == null;
    if (noData) {
      el.innerHTML = `<div class="fa-empty" style="padding:16px 0">Keine Kaloriendata.<br><small>Wird ab dem nächsten python3 fetch_data.py Lauf verfügbar.</small></div>`;
      return;
    }
    el.innerHTML = `
      <div class="cal-row">
        <div class="cal-metric">
          <div class="cal-val" style="color:var(--green)" id="cal-active">${activeCal ?? '—'}</div>
          <div class="cal-lbl">AKTIV kcal</div>
        </div>
        <div class="cal-metric">
          <div class="cal-val" style="color:var(--text-sec)" id="cal-bmr">${bmrCal ?? '—'}</div>
          <div class="cal-lbl">GRUNDUMSATZ kcal</div>
        </div>
      </div>
      ${totalCal != null ? `
      <div style="margin-top:auto">
        <div class="cal-bar-lbl"><span>GESAMT</span><span id="cal-total">—</span></div>
        <div class="cal-bar-bg">
          <div class="cal-bar-fill" id="cal-bar" style="width:0%;background:var(--green)"></div>
        </div>
        <div class="cal-bar-lbl" style="margin-top:4px"><span style="color:var(--green)">■ Aktiv ${fillPct}%</span><span style="color:var(--text-muted)">■ Ruhe ${100-fillPct}%</span></div>
      </div>` : ''}`;

    if (activeCal != null) countUp(document.getElementById('cal-active'), activeCal, 800);
    if (bmrCal    != null) countUp(document.getElementById('cal-bmr'),    bmrCal,    800);
    if (totalCal  != null) countUp(document.getElementById('cal-total'),  totalCal,  900, v => Math.round(v) + ' kcal');
    setTimeout(() => {
      const bar = document.getElementById('cal-bar');
      if (bar) bar.style.width = `${fillPct}%`;
    }, 200);

  } else {
    const n     = range === '7d' ? 7 : 30;
    const slice = historyDays.slice(0, n);
    const rev   = [...slice].reverse();
    const labels = dayLabels(slice);
    const active = rev.map(d => d.activeCalories ?? null);
    const bmr    = rev.map(d => d.bmrCalories    ?? null);
    const hasData = active.some(v => v != null);

    if (!hasData) {
      el.innerHTML = `<div class="fa-empty" style="padding:16px 0">Kalorienhistorie noch nicht verfügbar.<br><small>Erst nach erneutem fetch_data.py.</small></div>`;
      return;
    }

    const avg = active.filter(Boolean).length
      ? Math.round(active.filter(Boolean).reduce((a,b)=>a+b,0)/active.filter(Boolean).length) : null;

    el.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:4px">
        <span class="cal-val" style="color:var(--green);font-size:36px">${avg ?? '—'}</span>
        <span style="font-size:12px;color:var(--text-muted)">kcal/Tag aktiv ø</span>
      </div>
      <div class="chart-wrap" style="flex:1"><canvas id="calories-chart"></canvas></div>`;

    charts['calories'] = new Chart($('calories-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Aktiv kcal', data: active, backgroundColor: 'rgba(30,215,96,0.6)',  borderRadius: 4, borderSkipped: false, stack: 'cal' },
          { label: 'Grundumsatz', data: bmr,   backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4, borderSkipped: false, stack: 'cal' },
        ],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { display: true, position: 'top', align: 'end', labels: { color: '#55585f', font: { size: 9 }, boxWidth: 8, boxHeight: 8 } },
        },
        scales: {
          x: xScaleOpts(),
          y: { min: 0, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#55585f', font: { size: 9 }, callback: v => `${v}` } },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  METABOLIK CARD (TDEE + FFMI + Metabolisches Alter)
// ═══════════════════════════════════════════════════════════════════════════
function renderMetabolic() {
  const el = $('metabolic-body');
  const bc = data.bodyComposition || [];
  const latest = bc[0] || {};

  const h   = userCfg.height_cm || 180;
  const gy  = userCfg.gender === 'female' ? -166 : 5;
  const byr = userCfg.birth_year || 1990;
  const age = new Date().getFullYear() - byr;
  const w   = latest.weight  || 78;
  const fat = latest.bodyFat || 18;

  // Mifflin-St Jeor BMR
  const bmr = Math.round(10 * w + 6.25 * h - 5 * age + gy);

  // TDEE
  const actFactors = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
  const factor = actFactors[userCfg.activity_level] || 1.55;
  const tdee = Math.round(bmr * factor);

  // FFMI
  const lbm  = +(w * (1 - fat / 100)).toFixed(1);
  const hm   = h / 100;
  const ffmi = +(lbm / (hm * hm)).toFixed(1);
  const normFFMI = +(ffmi + 6.1 * (1.8 - hm)).toFixed(1);
  const ffmiDesc = normFFMI < 18 ? 'Unterdurchschn.' : normFFMI < 20 ? 'Durchschnittlich' : normFFMI < 22 ? 'Gut' : normFFMI < 25 ? 'Fortgeschritten' : 'Sehr fortgeschritten';
  const ffmiColor = normFFMI < 18 ? 'var(--text-muted)' : normFFMI < 22 ? 'var(--green)' : normFFMI < 25 ? 'var(--yellow)' : '#a78bfa';

  // Metabolisches Alter: BMR-Vergleich mit Altersgruppen (Männer, Mifflin-Durchschnitt bei 80kg/180cm)
  // BMR = 10×80 + 6.25×180 − 5×age + 5 → 800+1125−5age+5 = 1930 - 5age
  // Für user: BMR = 10×w + 6.25×h − 5×age + gy
  // Metabolisches Alter = Alter bei dem Referenz-BMR = user BMR
  // ref_bmr(age) = 10×80 + 6.25×180 - 5×age + 5 = 1930 - 5×age → age = (1930 - bmr) / 5
  const refBmr0 = 10 * 80 + 6.25 * 180 + gy; // Referenz bei age=0
  const metAge = Math.round((refBmr0 - bmr) / 5);
  const metAgeDelta = metAge - age;
  const metAgeColor = metAgeDelta <= 0 ? 'var(--green)' : metAgeDelta <= 5 ? 'var(--yellow)' : 'var(--red)';
  const metAgeDesc = metAgeDelta <= -3 ? 'Sehr jung' : metAgeDelta <= 0 ? 'Gut' : metAgeDelta <= 5 ? 'Leicht erhöht' : 'Erhöht';

  const noConfig = !userCfg.height_cm || !userCfg.birth_year;

  el.innerHTML = `
    ${noConfig ? `<div class="met-config-hint">⚠ Bitte <b>user_config.json</b> mit Größe und Geburtsjahr ausfüllen für genaue Werte.</div>` : ''}
    <div class="met-grid">
      <div class="met-tile">
        <div class="met-val" style="color:var(--green)" id="met-tdee">—</div>
        <div class="met-unit">kcal/Tag</div>
        <div class="met-bar-bg"><div class="met-bar-fill" style="background:var(--green);width:${clamp(tdee/4000*100,5,100)}%"></div></div>
        <div class="met-lbl">TDEE</div>
        <div class="met-desc">Gesamtenergiebedarf inkl. Aktivität</div>
      </div>
      <div class="met-tile">
        <div class="met-val" style="color:${ffmiColor}" id="met-ffmi">—</div>
        <div class="met-unit">kg/m²</div>
        <div class="met-bar-bg"><div class="met-bar-fill" style="background:${ffmiColor};width:${clamp((normFFMI-14)/12*100,5,100)}%"></div></div>
        <div class="met-lbl">FFMI</div>
        <div class="met-desc">${ffmiDesc} (nat. Max ≈25)</div>
      </div>
      <div class="met-tile">
        <div class="met-val" style="color:${metAgeColor}" id="met-age">—</div>
        <div class="met-unit">Jahre</div>
        <div class="met-bar-bg"><div class="met-bar-fill" style="background:${metAgeColor};width:${clamp((metAge-20)/50*100,5,100)}%"></div></div>
        <div class="met-lbl">MET. ALTER</div>
        <div class="met-desc">${metAgeDesc} (Real ${age}J)</div>
      </div>
    </div>
    <div style="font-size:9px;color:var(--text-muted);margin-top:8px">BMR ${bmr} kcal — ${userCfg.activity_level || 'moderate'} × ${factor} — LBM ${lbm} kg</div>`;

  countUp(document.getElementById('met-tdee'), tdee, 1000);
  countUp(document.getElementById('met-ffmi'), normFFMI, 900, v => v.toFixed(1));
  countUp(document.getElementById('met-age'),  metAge,  900);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PILL INDICATOR — iOS Segmented Control Slider
// ═══════════════════════════════════════════════════════════════════════════
function initPillIndicator(pillGroup) {
  let indicator = pillGroup.querySelector('.pill-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'pill-indicator';
    pillGroup.insertBefore(indicator, pillGroup.firstChild);
    pillGroup.classList.add('has-indicator');
  }
  const active = pillGroup.querySelector('.pill.active');
  if (active) {
    // Kein Transition beim ersten Setzen
    indicator.style.transition = 'none';
    indicator.style.left  = active.offsetLeft + 'px';
    indicator.style.width = active.offsetWidth + 'px';
    // Transition wieder aktivieren
    requestAnimationFrame(() => {
      indicator.style.transition = '';
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PILL SETUP
// ═══════════════════════════════════════════════════════════════════════════
const RENDERS = {
  recovery:  renderRecovery,
  battery:   renderBattery,
  sleep:     renderSleep,
  steps:     renderSteps,
  stress:    renderStress,
  activity:  renderActivity,
  spo2:      renderSpO2,
  restinghr: renderRestingHR,
  calories:  renderCalories,
  bodycomp:  renderBodyComp,
};

document.querySelectorAll('.time-pills').forEach(pillGroup => {
  const card = pillGroup.dataset.card;
  pillGroup.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return; // Kein Re-Render wenn schon aktiv

      pillGroup.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      initPillIndicator(pillGroup); // Slider aktualisieren

      // Fade-Out → Render → Fade-In
      const bodyEl = document.getElementById(`${card}-body`);
      if (bodyEl) {
        bodyEl.classList.add('switching');
        bodyEl.classList.remove('switching-in');
        setTimeout(() => {
          safeRender(() => RENDERS[card]?.(btn.dataset.range), card);
          bodyEl.classList.remove('switching');
          bodyEl.classList.add('switching-in');
          // Klasse nach Animation entfernen
          bodyEl.addEventListener('animationend', () => {
            bodyEl.classList.remove('switching-in');
          }, { once: true });
        }, 150);
      } else {
        RENDERS[card]?.(btn.dataset.range);
      }
    });
  });
});

// ── Shimmer-Skeleton auf allen Karten anzeigen (vor dem ersten Render) ──────
document.querySelectorAll('.card-body').forEach(el => el.classList.add('card-loading'));

// ── Pill Indicators initialisieren ───────────────────────────────────────────
document.querySelectorAll('.time-pills').forEach(initPillIndicator);

// ═══════════════════════════════════════════════════════════════════════════
//  INITIAL RENDER — alle Karten mit "today" starten
// ═══════════════════════════════════════════════════════════════════════════
safeRender(() => renderRecovery('today'),  'recovery');
safeRender(() => renderBattery('today'),   'battery');
safeRender(() => renderSleep('today'),     'sleep');
safeRender(() => renderSteps('today'),     'steps');
safeRender(() => renderStress('today'),    'stress');
safeRender(() => renderActivity('today'),  'activity');
safeRender(() => renderFitnessAge(),       'fitness-age');
safeRender(() => renderSpO2('today'),      'spo2');
safeRender(() => renderRestingHR('7d'),    'restinghr');
safeRender(() => renderCalories('today'),  'calories');
safeRender(() => renderMetabolic(),        'metabolic');
safeRender(() => renderBodyComp('today'),  'bodycomp');

})();
