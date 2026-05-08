// ManifoldFX dashboard — fetches the public data files in /data and renders them.
// Auto-refreshes every 60s. No backend, just static files served by GitHub Pages.

const DATA_BASE  = 'data';
const REFRESH_MS = 60_000;

// ── helpers ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function fmtUsd(v, signed = true) {
  if (v == null || isNaN(v)) return '—';
  const sign = signed && v > 0 ? '+' : v < 0 ? '−' : '';
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${sign}$${abs}`;
}

function fmtPct(v, decimals = 1) {
  if (v == null || isNaN(v)) return '—';
  return `${Number(v).toFixed(decimals)}%`;
}

function fmtNum(v, decimals = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(decimals);
}

function colorClass(v) {
  if (v == null || isNaN(v) || v === 0) return '';
  return v > 0 ? 'positive' : 'negative';
}

function bust(url) { return `${url}?v=${Date.now()}`; }

async function fetchJson(name) {
  const r = await fetch(bust(`${DATA_BASE}/${name}`));
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  return r.json();
}

async function fetchCsv(name) {
  const r = await fetch(bust(`${DATA_BASE}/${name}`));
  if (!r.ok) return [];
  const text = await r.text();
  return new Promise(resolve => {
    Papa.parse(text, {
      header: true, dynamicTyping: true, skipEmptyLines: true,
      complete: results => resolve(results.data || []),
    });
  });
}

function setMetric(id, text, cls = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `metric-value ${cls}`.trim();
}

// ── render: header + hero metrics ─────────────────────────────────────
function renderState(state, meta) {
  const initial = state.account_initial_usd || meta.account_initial_usd || 50000;
  const equity  = state.equity ?? initial;
  const today   = state.today_pnl ?? 0;
  const totalPnl = equity - initial;
  const dd      = state.drawdown_pct ?? 0;

  setMetric('m-equity', fmtUsd(equity, false));
  setMetric('m-today',  fmtUsd(today),  colorClass(today));
  setMetric('m-total',  fmtUsd(totalPnl), colorClass(totalPnl));
  setMetric('m-dd',     fmtPct(dd, 2),  dd > 5 ? 'warn' : '');

  const m = state.metrics || {};
  setMetric('m-wr',     fmtPct(m.win_rate));
  setMetric('m-trades', String(m.total_trades ?? 0));
  setMetric('m-pf',     fmtNum(m.profit_factor));
  setMetric('m-sharpe', fmtNum(m.annualised_sharpe));
  setMetric('m-avgwin', fmtUsd(m.avg_win_usd),  m.avg_win_usd  > 0 ? 'positive' : '');
  setMetric('m-avgloss',fmtUsd(m.avg_loss_usd), m.avg_loss_usd < 0 ? 'negative' : '');

  const phase = (state.phase || 'demo').toUpperCase();
  $('phase-badge').textContent = phase;

  if (state.as_of_utc) {
    const d = new Date(state.as_of_utc);
    const hb = state.last_heartbeat_utc ? new Date(state.last_heartbeat_utc) : null;
    $('updated-at').textContent = hb
      ? `Snapshot ${d.toLocaleString()} · heartbeat ${hb.toLocaleTimeString()}`
      : `Updated ${d.toLocaleString()}`;
  }

  const nm = meta.strategy_name || 'ManifoldFX';
  const assets = (meta.assets || []).join(' · ');
  $('meta-line').textContent = `${nm} · ${assets} · Account $${initial.toLocaleString()}`;

  const dot = $('status-dot');
  dot.className = 'status-dot ' + (state.dry_run ? 'dry' : 'live');

  $('dryrun-banner').classList.toggle('hidden', !state.dry_run);
}

// ── render: open positions ────────────────────────────────────────────
function renderPositions(state) {
  const div = $('positions');
  const positions = state.open_positions || [];
  if (!positions.length) {
    div.innerHTML = '<p class="text-gray-600 text-sm col-span-full px-1">No open positions</p>';
    return;
  }
  div.innerHTML = positions.map(p => {
    const pnl = p.floating_pnl_usd;
    const pnlClass = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '';
    const pnlText  = pnl != null ? fmtUsd(pnl) : '—';
    const sideCls  = p.side === 'LONG' ? 'side-long' : 'side-short';
    const ep = Number(p.entry_price || 0);
    const cp = Number(p.current_price || 0);
    return `<div class="position-card">
      <div>
        <p class="text-xs text-gray-500 uppercase tracking-wider">${p.asset}</p>
        <p class="text-lg mt-0.5"><span class="${sideCls}">${p.side}</span>
           <span class="text-gray-500 mx-1">·</span>
           <span style="font-family:'JetBrains Mono',monospace;">${Number(p.lots || 0).toFixed(2)} lots</span></p>
        <p class="text-xs text-gray-600 mt-1" style="font-family:'JetBrains Mono',monospace;">
          since ${p.entry_date || '—'} @ ${ep.toFixed(5)} → ${cp.toFixed(5)}
        </p>
      </div>
      <p class="metric-value ${pnlClass}" style="font-size:18px;">${pnlText}</p>
    </div>`;
  }).join('');
}

// ── render: equity curve ──────────────────────────────────────────────
function renderEquityChart(equity, initial) {
  const div = $('equity-chart');
  if (!equity || !equity.length) {
    div.innerHTML = '<p class="text-gray-600 text-sm p-6 text-center">Equity curve will appear after the first trade</p>';
    return;
  }
  const x   = equity.map(r => r.date);
  const y   = equity.map(r => Number(r.balance) || initial);
  const dd  = equity.map(r => -Number(r.drawdown_pct) || 0);

  const equityTrace = {
    x, y, type: 'scatter', mode: 'lines',
    line: { color: '#34d399', width: 2 },
    fill: 'tonexty', fillcolor: 'rgba(52,211,153,0.06)',
    name: 'Balance',
  };
  const baseTrace = {
    x, y: x.map(() => initial), type: 'scatter', mode: 'lines',
    line: { color: '#374151', width: 1, dash: 'dot' },
    hoverinfo: 'skip', showlegend: false,
  };
  const ddTrace = {
    x, y: dd, type: 'scatter', mode: 'lines',
    line: { color: '#f87171', width: 1 },
    yaxis: 'y2', name: 'Drawdown %', opacity: 0.6,
  };
  const layout = {
    paper_bgcolor: '#0f1419', plot_bgcolor: '#0f1419',
    font: { color: '#9ca3af', family: 'JetBrains Mono, monospace', size: 11 },
    margin: { t: 20, r: 60, b: 40, l: 70 },
    xaxis: { gridcolor: '#1f2937', zeroline: false, showgrid: true },
    yaxis: { gridcolor: '#1f2937', zeroline: false, tickformat: '$,.0f', title: '' },
    yaxis2: { overlaying: 'y', side: 'right', tickformat: '.1f', ticksuffix: '%',
              gridcolor: 'transparent', zeroline: false, range: [Math.min(-1, Math.min(...dd) * 1.2), 0] },
    showlegend: false, hovermode: 'x unified',
  };
  Plotly.newPlot(div, [baseTrace, equityTrace, ddTrace], layout, { displayModeBar: false, responsive: true });
}

// ── render: trades + signals tables ───────────────────────────────────
function renderTrades(trades) {
  const tbody = document.querySelector('#trades-table tbody');
  if (!trades.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-600 py-6">No trades yet</td></tr>';
    return;
  }
  const recent = trades.slice(-25).reverse();
  tbody.innerHTML = recent.map(t => {
    const pnl = Number(t.pnl_usd) || 0;
    const pnlCls = pnl > 0 ? 'side-long' : pnl < 0 ? 'side-short' : 'side-flat';
    const sideCls = t.side === 'LONG' ? 'side-long' : 'side-short';
    return `<tr>
      <td class="text-gray-400">${t.exit_date || '—'}</td>
      <td>${t.asset || ''}</td>
      <td class="${sideCls}">${t.side || ''}</td>
      <td class="num">${Number(t.lots || 0).toFixed(2)}</td>
      <td class="num ${pnlCls}">${fmtUsd(pnl)}</td>
      <td class="num text-gray-500">${t.hold_days ?? 0}</td>
    </tr>`;
  }).join('');
}

function renderSignals(signals) {
  const tbody = document.querySelector('#signals-table tbody');
  if (!signals.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-gray-600 py-6">No signals yet</td></tr>';
    return;
  }
  const recent = signals.slice(-25).reverse();
  tbody.innerHTML = recent.map(s => {
    const sig = parseInt(s.signal) || 0;
    const sideText = sig > 0 ? 'LONG' : sig < 0 ? 'SHORT' : 'FLAT';
    const sideCls = sig > 0 ? 'side-long' : sig < 0 ? 'side-short' : 'side-flat';
    const conv = (parseFloat(s.ensemble_avg) || 0).toFixed(2);
    return `<tr>
      <td class="text-gray-400">${s.as_of_date || ''}</td>
      <td>${s.asset || ''}</td>
      <td class="num text-gray-300">${conv}</td>
      <td class="cen ${sideCls}">${sideText}</td>
    </tr>`;
  }).join('');
}

// ── orchestrate ───────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [state, meta, equity, trades, signals] = await Promise.all([
      fetchJson('state.json').catch(() => ({})),
      fetchJson('meta.json').catch(() => ({})),
      fetchCsv('equity.csv'),
      fetchCsv('trades.csv'),
      fetchCsv('signals.csv'),
    ]);
    const initial = state.account_initial_usd || meta.account_initial_usd || 50000;
    renderState(state, meta);
    renderPositions(state);
    renderEquityChart(equity, initial);
    renderTrades(trades);
    renderSignals(signals);
  } catch (e) {
    console.error('Dashboard load failed:', e);
  }
}

loadAll();
setInterval(loadAll, REFRESH_MS);
