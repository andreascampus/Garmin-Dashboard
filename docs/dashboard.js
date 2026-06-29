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

// ── Timestamp ───────────────────────────────────────────────────────────────
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

// ── Gemeinsame Chart-Defaults ────────────────────────────────────────────────
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 700, easing: 'easeOutQuart' },
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
      </div>`;

    // Animiere Ring nach Render
    setTimeout(() => {
      const ring = document.getElementById('r-ring');
      if (ring) ring.style.strokeDashoffset = offset;
    }, 100);

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
      <div class="bb-today-stats">
        <div class="bb-stat"><span class="bb-stat-dot" style="background:#1ed760"></span><span class="bb-stat-val">${today.charged ?? '—'}</span><span class="bb-stat-lbl">Geladen</span></div>
        <div class="bb-stat"><span class="bb-stat-dot" style="background:#f3727f"></span><span class="bb-stat-val">${today.drained ?? '—'}</span><span class="bb-stat-lbl">Verbraucht</span></div>
      </div>
      <div class="chart-wrap"><canvas id="battery-chart"></canvas></div>`;

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

    el.innerHTML = `
      <div class="sleep-top">
        <span class="sleep-score">${sleep.score ?? '—'}</span>
        <span class="sleep-dur">${fmtHM(sleep.totalSeconds)}</span>
      </div>
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
      </div>`;

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
            backgroundColor: 'transparent',
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
  const GOAL = 10000;

  const stepsToday = data.stepsToday ?? historyDays[0]?.steps ?? null;

  if (range === 'today') {
    const pct = stepsToday != null ? clamp(Math.round(stepsToday / GOAL * 100), 0, 100) : 0;
    const color = stepsToday != null
      ? (stepsToday >= GOAL ? '#1ed760' : stepsToday >= 7000 ? '#ffa42b' : '#f3727f')
      : 'var(--text-muted)';

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
      </div>`;

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
//  PILL SETUP
// ═══════════════════════════════════════════════════════════════════════════
const RENDERS = {
  recovery: renderRecovery,
  battery:  renderBattery,
  sleep:    renderSleep,
  steps:    renderSteps,
  stress:   renderStress,
  activity: renderActivity,
};

document.querySelectorAll('.time-pills').forEach(pillGroup => {
  const card = pillGroup.dataset.card;
  pillGroup.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      pillGroup.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      RENDERS[card]?.(btn.dataset.range);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  INITIAL RENDER — alle Karten mit "today" starten
// ═══════════════════════════════════════════════════════════════════════════
renderRecovery('today');
renderBattery('today');
renderSleep('today');
renderSteps('today');
renderStress('today');
renderActivity('today');

})();
