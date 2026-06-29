/**
 * dashboard.js — Garmin Dashboard
 * Lädt garmin.json und rendert alle UI-Komponenten.
 */

(async () => {
  // ── Datei-Pfad (funktioniert lokal + auf GitHub Pages) ─────────────────
  const BASE = (() => {
    const p = location.pathname;
    // GitHub Pages: /Garmin-Dashboard/...
    const m = p.match(/^(\/[^/]+\/)/);
    return m && !p.startsWith('/index') ? m[1].replace(/\/$/, '') : '';
  })();

  // ── Hilfsfunktionen ─────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  function fmtSec(sec) {
    if (sec == null) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
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

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── Daten laden ─────────────────────────────────────────────────────────
  let data;
  try {
    const res = await fetch(`${BASE}/data/garmin.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error('garmin.json konnte nicht geladen werden:', err);
    document.getElementById('grid').innerHTML = `
      <div class="card" style="grid-column:1/-1;text-align:center;padding:60px 24px;gap:12px">
        <div style="font-size:32px">⚡</div>
        <div style="font-size:15px;color:#8a8a8a;line-height:1.6">
          Keine Daten verfügbar.<br>
          Bitte <code style="color:#00d68f">python fetch_data.py</code> ausführen.
        </div>
      </div>`;
    return;
  }

  // ── Timestamp ──────────────────────────────────────────────────────────
  if (data.updated_at) {
    const d = new Date(data.updated_at);
    $('updated-time').textContent = d.toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }

  // ── Recovery Ring + HRV ────────────────────────────────────────────────
  const hrv = data.hrv || {};
  const hrvVal   = hrv.lastNight;
  const weeklyAvg = hrv.weeklyAvg;

  $('hrv-value').textContent = hrvVal   ?? '—';
  $('hrv-avg').textContent   = weeklyAvg ? `${weeklyAvg} ms` : '—';

  // Recovery-Score: HRV relativ zur Wochenbasis (0–100)
  let recoveryPct = 0;
  let ringColor   = 'var(--green)';
  let ringGlow    = 'var(--green-glow)';
  let statusText  = '—';
  let statusColor = 'var(--text-sec)';

  if (hrvVal != null && weeklyAvg && weeklyAvg > 0) {
    recoveryPct = clamp(Math.round((hrvVal / weeklyAvg) * 100), 0, 100);
  } else if (hrv.status) {
    const MAP = {
      BALANCED:   [80, 'var(--green)',  'var(--green-glow)'],
      UNBALANCED: [35, 'var(--yellow)', 'var(--yellow-glow)'],
      LOW:        [20, 'var(--red)',    'var(--red-glow)'],
      POOR:       [15, 'var(--red)',    'var(--red-glow)'],
    };
    const m = MAP[hrv.status];
    if (m) { recoveryPct = m[0]; ringColor = m[1]; ringGlow = m[2]; }
  }

  if (recoveryPct >= 67) {
    statusText = 'OPTIMAL';   statusColor = 'var(--green)';
    ringColor = 'var(--green)'; ringGlow = 'var(--green-glow)';
  } else if (recoveryPct >= 34) {
    statusText = 'MODERAT';   statusColor = 'var(--yellow)';
    ringColor = 'var(--yellow)'; ringGlow = 'var(--yellow-glow)';
  } else if (recoveryPct > 0) {
    statusText = 'NIEDRIG';   statusColor = 'var(--red)';
    ringColor = 'var(--red)'; ringGlow = 'var(--red-glow)';
  }

  $('ring-pct').textContent     = recoveryPct ? `${recoveryPct}%` : '—';
  $('ring-pct').style.color     = ringColor;
  $('ring-status').textContent  = statusText;
  $('ring-status').style.color  = statusColor;

  const CIRC = 502.65; // 2π × 80
  const ringEl = $('ring-fill');
  ringEl.style.stroke = ringColor;
  ringEl.style.filter = `drop-shadow(0 0 12px ${ringGlow})`;

  setTimeout(() => {
    ringEl.style.strokeDashoffset = CIRC * (1 - recoveryPct / 100);
  }, 150);

  // ── RHR ───────────────────────────────────────────────────────────────
  const rhr = data.restingHeartRate;
  $('rhr-value').textContent = rhr ? `${rhr} bpm` : '— bpm';

  // ── Body Battery ──────────────────────────────────────────────────────
  const bb = data.bodyBattery || {};
  const bbCurrent = bb.current;
  const bbEl = $('bb-value');

  bbEl.textContent = bbCurrent ?? '—';
  if (bbCurrent != null) {
    if (bbCurrent >= 70)      { bbEl.style.color = 'var(--green)'; }
    else if (bbCurrent >= 40) { bbEl.style.color = 'var(--yellow)'; }
    else                      { bbEl.style.color = 'var(--red)'; }
  }

  // Trend (Vergleich heute ↔ gestern)
  const hist = (bb.history || []);
  if (hist.length >= 2) {
    const diff = (hist[0].endValue ?? 0) - (hist[1].endValue ?? 0);
    $('bb-trend').textContent = diff > 0 ? `▲ ${diff}` : diff < 0 ? `▼ ${Math.abs(diff)}` : '—';
    $('bb-trend').style.color = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--text-muted)';
  }

  // Body Battery Chart (7 Tage, ältester zuerst)
  const bbRev    = [...hist].reverse();
  const bbLabels = bbRev.map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    return dt.toLocaleDateString('de-DE', { weekday: 'short' });
  });
  const bbVals = bbRev.map(d => d.endValue ?? null);

  new Chart($('bb-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: bbLabels,
      datasets: [{
        data: bbVals,
        borderColor: '#00d68f',
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 120);
          g.addColorStop(0, 'rgba(0,214,143,0.18)');
          g.addColorStop(1, 'rgba(0,214,143,0.00)');
          return g;
        },
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: '#00d68f',
        pointBorderColor: '#111',
        pointBorderWidth: 2,
        fill: true,
        tension: 0.35,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          borderColor: '#2a2a2a',
          borderWidth: 1,
          titleColor: '#8a8a8a',
          bodyColor: '#f0f0f0',
          padding: 10,
          callbacks: { label: ctx => ` ${ctx.parsed.y}%` },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#5a5a5a', font: { size: 10, family: 'Inter' } },
        },
        y: {
          min: 0, max: 100,
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#5a5a5a',
            font: { size: 10, family: 'Inter' },
            callback: v => `${v}%`,
            stepSize: 25,
          },
        },
      },
    },
  });

  // ── Schlaf ────────────────────────────────────────────────────────────
  const sleep = data.sleep || {};
  $('sleep-score').textContent = sleep.score ?? '—';
  $('sleep-dur').textContent   = fmtHM(sleep.totalSeconds);

  const phases = {
    deep:  sleep.deepSeconds  || 0,
    rem:   sleep.remSeconds   || 0,
    light: sleep.lightSeconds || 0,
    awake: sleep.awakeSeconds || 0,
  };
  const totalPhaseSec = Object.values(phases).reduce((a, b) => a + b, 0);

  if (totalPhaseSec > 0) {
    setTimeout(() => {
      $('ph-deep').style.width  = `${(phases.deep  / totalPhaseSec * 100).toFixed(1)}%`;
      $('ph-rem').style.width   = `${(phases.rem   / totalPhaseSec * 100).toFixed(1)}%`;
      $('ph-light').style.width = `${(phases.light / totalPhaseSec * 100).toFixed(1)}%`;
      $('ph-awake').style.width = `${(phases.awake / totalPhaseSec * 100).toFixed(1)}%`;
    }, 200);
  }

  $('dur-deep').textContent  = fmtHM(sleep.deepSeconds);
  $('dur-rem').textContent   = fmtHM(sleep.remSeconds);
  $('dur-light').textContent = fmtHM(sleep.lightSeconds);
  $('dur-awake').textContent = fmtHM(sleep.awakeSeconds);

  // ── Letzte Aktivität ──────────────────────────────────────────────────
  const act = data.lastActivity;
  if (act) {
    $('act-name').textContent = act.name || '—';
    $('act-dist').textContent = fmtDist(act.distanceMeters);
    $('act-dur').textContent  = fmtSec(act.durationSeconds);
    $('act-hr').textContent   = act.avgHr   ? `${act.avgHr} bpm`      : '—';
    $('act-cal').textContent  = act.calories ? `${Math.round(act.calories)} kcal` : '—';
  }

  // ── Stress ────────────────────────────────────────────────────────────
  const stress = data.stress || {};
  const avgStress = stress.avgStressLevel;

  $('stress-val').textContent = avgStress ?? '—';

  let stressLabel = '—';
  let stressColor = 'var(--text)';
  if (avgStress != null) {
    if      (avgStress < 26) { stressLabel = 'RUHIG';   stressColor = 'var(--green)'; }
    else if (avgStress < 51) { stressLabel = 'NIEDRIG'; stressColor = 'var(--yellow)'; }
    else if (avgStress < 76) { stressLabel = 'MODERAT'; stressColor = 'var(--yellow)'; }
    else                     { stressLabel = 'HOCH';    stressColor = 'var(--red)'; }
  }
  $('stress-label').textContent       = stressLabel;
  $('stress-val').style.color         = stressColor;

  setTimeout(() => {
    if (avgStress != null) {
      $('stress-thumb').style.left = `${clamp(avgStress, 0, 100)}%`;
    }
  }, 300);

  // ── VO2max ────────────────────────────────────────────────────────────
  const vo2 = data.vo2max;
  $('vo2-val').textContent = vo2 != null ? vo2.toFixed(1) : '—';

  let vo2Label = '—';
  let vo2Pct   = 0;
  if (vo2 != null) {
    // Skala: 20 (min) … 65+ (max dargestellt als 65)
    vo2Pct = clamp(Math.round(((vo2 - 20) / 45) * 100), 0, 100);

    if      (vo2 >= 55) vo2Label = 'HERVORRAGEND';
    else if (vo2 >= 48) vo2Label = 'SEHR GUT';
    else if (vo2 >= 42) vo2Label = 'GUT';
    else if (vo2 >= 36) vo2Label = 'DURCHSCHNITT';
    else                vo2Label = 'VERBESSERUNGSBEDARF';
  }
  $('vo2-label').textContent = vo2Label;

  setTimeout(() => {
    $('vo2-fill').style.width = `${vo2Pct}%`;
  }, 350);

})();
