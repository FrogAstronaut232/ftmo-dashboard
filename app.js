// ManifoldFX dashboard. Reads /data/{state.json,meta.json,equity.csv,trades.csv,signals.csv}.
// Static, no backend. Polls every 60s.

const DATA_BASE  = 'data';
const REFRESH_MS = 60_000;

const $ = id => document.getElementById(id);

function fmtUsd(v, signed = true) {
  if (v == null || isNaN(v)) return '—';
  const sign = signed && v > 0 ? '+' : v < 0 ? '−' : '';
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${sign}$${abs}`;
}
function fmtPct(v, decimals = 2) {
  if (v == null || isNaN(v)) return '—';
  return `${Number(v).toFixed(decimals)}%`;
}
function fmtNum(v, decimals = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(decimals);
}
function fmtDate(d) {
  if (!d) return '—';
  return String(d);
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

function setStat(id, text, cls = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `stat-value ${cls}`.trim();
}
function pnlClass(v) {
  if (v == null || isNaN(v) || v === 0) return '';
  return v > 0 ? 'pos' : 'neg';
}

// ── Header / summary strip ────────────────────────────────────────────
function renderSummary(state, meta) {
  const initial = state.account_initial_usd || meta.account_initial_usd || 50000;
  const equity  = state.equity ?? initial;
  const today   = state.today_pnl ?? 0;
  const totalPnl = equity - initial;
  const dd      = state.drawdown_pct ?? 0;
  const m       = state.metrics || {};

  setStat('m-equity', fmtUsd(equity, false));
  setStat('m-today',  fmtUsd(today),  pnlClass(today));
  setStat('m-total',  fmtUsd(totalPnl), pnlClass(totalPnl));
  setStat('m-dd',     fmtPct(dd),  dd > 5 ? 'warn' : '');
  setStat('m-wr',     m.total_trades ? fmtPct(m.win_rate, 1) : '—');
  setStat('m-trades', String(m.total_trades ?? 0));
  setStat('m-pf',     m.total_trades ? fmtNum(m.profit_factor) : '—');
  setStat('m-sharpe', m.total_trades ? fmtNum(m.annualised_sharpe) : '—');

  $('phase-badge').textContent = (state.phase || 'demo').toUpperCase();
  $('dryrun-tag').hidden = !state.dry_run;

  if (state.as_of_utc) {
    const d = new Date(state.as_of_utc);
    const hb = state.last_heartbeat_utc ? new Date(state.last_heartbeat_utc) : null;
    const fmt = dt => dt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    $('updated-at').textContent = hb ? `${fmt(d)} · hb ${fmt(hb).slice(11)}` : fmt(d);
  }

  const nm = meta.strategy_name || 'ManifoldFX';
  const assets = (meta.assets || []).join(' · ');
  const acct = `${initial.toLocaleString()} USD`;
  $('meta-line').textContent = [nm, assets, `Account ${acct}`].filter(Boolean).join('  ·  ');
  $('foot-meta').textContent = `Daily-close swing strategy. Strategy logic, model parameters, and per-trade reasoning are not included in this view.`;
}

// ── Open positions ────────────────────────────────────────────────────
function renderPositions(state) {
  const tbody = document.querySelector('#positions-table tbody');
  const positions = state.open_positions || [];
  if (!positions.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No open positions.</td></tr>';
    return;
  }
  tbody.innerHTML = positions.map(p => {
    const pnl = p.floating_pnl_usd;
    const pnlCls = pnl == null ? 'dim' : pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';
    const pnlText = pnl != null ? fmtUsd(pnl) : '—';
    const sideCls = p.side === 'LONG' ? 'pos' : 'neg';
    const ep = Number(p.entry_price || 0);
    const cp = Number(p.current_price || 0);
    return `<tr>
      <td>${p.asset || '—'}</td>
      <td class="${sideCls}">${p.side || '—'}</td>
      <td class="num">${Number(p.lots || 0).toFixed(2)}</td>
      <td class="dim">${fmtDate(p.entry_date)}</td>
      <td class="num">${ep.toFixed(5)}</td>
      <td class="num">${cp.toFixed(5)}</td>
      <td class="num ${pnlCls}">${pnlText}</td>
    </tr>`;
  }).join('');
}

// ── Equity curve ──────────────────────────────────────────────────────
function renderEquity(equity, initial) {
  const div = $('equity-chart');
  if (!equity || !equity.length) {
    div.innerHTML = '<div style="color:#4a5058;font-size:12px;text-align:center;padding:140px 0;">No equity data yet.</div>';
    return;
  }
  const x = equity.map(r => r.date);
  const y = equity.map(r => Number(r.balance) || initial);
  const main = {
    x, y, type: 'scatter', mode: 'lines',
    line: { color: '#d0d4d8', width: 1.4, shape: 'linear' },
    hovertemplate: '%{x}<br>$%{y:,.0f}<extra></extra>',
  };
  const ref = {
    x: [x[0], x[x.length - 1]], y: [initial, initial],
    type: 'scatter', mode: 'lines',
    line: { color: '#2a2f37', width: 1, dash: 'dot' },
    hoverinfo: 'skip', showlegend: false,
  };
  const layout = {
    paper_bgcolor: '#0b0d10', plot_bgcolor: '#0b0d10',
    font: { color: '#6e757d', family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', size: 10.5 },
    margin: { t: 14, r: 14, b: 36, l: 64 },
    xaxis: { gridcolor: '#15181d', zeroline: false, showline: true, linecolor: '#1c2026', linewidth: 1, ticks: 'outside', tickcolor: '#1c2026', ticklen: 4 },
    yaxis: { gridcolor: '#15181d', zeroline: false, tickformat: '$,.0f', showline: true, linecolor: '#1c2026', linewidth: 1, ticks: 'outside', tickcolor: '#1c2026', ticklen: 4 },
    showlegend: false, hovermode: 'x unified',
    hoverlabel: { bgcolor: '#0b0d10', bordercolor: '#1c2026', font: { color: '#d8d8d8', family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 11 } },
  };
  Plotly.newPlot(div, [ref, main], layout, { displayModeBar: false, responsive: true });
}

// ── Trades + signals tables ───────────────────────────────────────────
function renderTrades(trades) {
  const tbody = document.querySelector('#trades-table tbody');
  if (!trades.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No closed trades yet.</td></tr>';
    return;
  }
  const recent = trades.slice(-25).reverse();
  tbody.innerHTML = recent.map(t => {
    const pnl = Number(t.pnl_usd) || 0;
    const pnlCls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'dim';
    const sideCls = t.side === 'LONG' ? 'pos' : 'neg';
    return `<tr>
      <td class="dim">${fmtDate(t.exit_date)}</td>
      <td>${t.asset || ''}</td>
      <td class="${sideCls}">${t.side || ''}</td>
      <td class="num">${Number(t.lots || 0).toFixed(2)}</td>
      <td class="num ${pnlCls}">${fmtUsd(pnl)}</td>
      <td class="num dim">${t.hold_days ?? 0}</td>
    </tr>`;
  }).join('');
}

function renderSignals(signals) {
  const tbody = document.querySelector('#signals-table tbody');
  if (!signals.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No signals yet.</td></tr>';
    return;
  }
  const recent = signals.slice(-25).reverse();
  tbody.innerHTML = recent.map(s => {
    const sig = parseInt(s.signal) || 0;
    const sideText = sig > 0 ? 'LONG' : sig < 0 ? 'SHORT' : 'FLAT';
    const sideCls  = sig > 0 ? 'pos' : sig < 0 ? 'neg' : 'dim';
    const conv = (parseFloat(s.ensemble_avg) || 0).toFixed(2);
    return `<tr>
      <td class="dim">${fmtDate(s.as_of_date)}</td>
      <td>${s.asset || ''}</td>
      <td class="num">${conv}</td>
      <td class="${sideCls}">${sideText}</td>
    </tr>`;
  }).join('');
}

// ── Main loop ─────────────────────────────────────────────────────────
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
    renderSummary(state, meta);
    renderPositions(state);
    renderEquity(equity, initial);
    renderTrades(trades);
    renderSignals(signals);
  } catch (e) {
    console.error('load failed', e);
  }
}

loadAll();
setInterval(loadAll, REFRESH_MS);
