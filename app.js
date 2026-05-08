// ManifoldFX dashboard — pulls /data/{state.json,meta.json,equity.csv,trades.csv,signals.csv}
// from the same origin and renders a static dashboard. Polls every 60s.

const DATA_BASE  = 'data';
const REFRESH_MS = 60_000;

// ── helpers ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function fmtUsd(v, signed = true, decimals = 0) {
  if (v == null || isNaN(v)) return '—';
  const sign = signed && v > 0 ? '+' : v < 0 ? '−' : '';
  const abs = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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
function pnlClass(v) {
  if (v == null || isNaN(v) || v === 0) return '';
  return v > 0 ? 'pos' : 'neg';
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

function setValue(id, baseClass, text, mod = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = mod ? `${baseClass} ${mod}` : baseClass;
}

function fmtUtc(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} `
       + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

// ── render: header + hero + sub-metrics ──────────────────────────────
function renderSummary(state, meta) {
  const initial = state.account_initial_usd || meta.account_initial_usd || 50000;
  const equity   = state.equity ?? initial;
  const today    = state.today_pnl ?? 0;
  const totalPnl = equity - initial;
  const dd       = state.drawdown_pct ?? 0;
  const m        = state.metrics || {};

  setValue('m-equity', 'hero-value', fmtUsd(equity, false));
  setValue('m-total',  'hero-value', fmtUsd(totalPnl), pnlClass(totalPnl));
  setValue('m-today',  'hero-value', fmtUsd(today),    pnlClass(today));
  setValue('m-dd',     'hero-value', fmtPct(dd),       dd > 5 ? 'warn' : '');

  setValue('m-wr',      'sub-value', m.total_trades ? fmtPct(m.win_rate, 1) : '—');
  setValue('m-trades',  'sub-value', String(m.total_trades ?? 0));
  setValue('m-sharpe',  'sub-value', m.total_trades ? fmtNum(m.annualised_sharpe) : '—');
  setValue('m-pf',      'sub-value', m.total_trades ? fmtNum(m.profit_factor)     : '—');
  setValue('m-avgwin',  'sub-value', m.avg_win_usd  ? fmtUsd(m.avg_win_usd)  : '—', m.avg_win_usd  > 0 ? 'pos' : '');
  setValue('m-avgloss', 'sub-value', m.avg_loss_usd ? fmtUsd(m.avg_loss_usd) : '—', m.avg_loss_usd < 0 ? 'neg' : '');

  $('phase-badge').textContent = (state.phase || 'demo').toUpperCase();
  $('dryrun-tag').hidden = !state.dry_run;

  const upd = state.as_of_utc ? fmtUtc(state.as_of_utc) : '—';
  const hb  = state.last_heartbeat_utc ? fmtUtc(state.last_heartbeat_utc) : null;
  $('updated-at').textContent = hb ? `Updated ${upd}  ·  Heartbeat ${hb.slice(11)}`
                                   : `Updated ${upd}`;

  const nm     = meta.strategy_name || 'ManifoldFX';
  const assets = (meta.assets || []).join('  ·  ');
  const acct   = `${initial.toLocaleString()} USD account`;
  $('meta-line').textContent = [nm + '  ·  FTMO 2-step swing', assets, acct]
                                .filter(Boolean).join('   ·   ');

  $('foot-meta').textContent =
    'Daily-close swing strategy. The strategy logic, model parameters, '
  + 'and per-trade reasoning are not exposed in this view.';
}

// ── render: open positions ───────────────────────────────────────────
function renderPositions(state) {
  const tbody = document.querySelector('#positions-table tbody');
  const positions = state.open_positions || [];
  if (!positions.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No open positions.</td></tr>';
    return;
  }
  tbody.innerHTML = positions.map(p => {
    const pnl     = p.floating_pnl_usd;
    const pnlCls  = pnl == null ? 'dim' : pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';
    const pnlText = pnl != null ? fmtUsd(pnl) : '—';
    const sideCls = p.side === 'LONG' ? 'pos' : 'neg';
    const ep = Number(p.entry_price || 0);
    const cp = Number(p.current_price || 0);
    return `<tr>
      <td>${p.asset || '—'}</td>
      <td class="${sideCls}">${p.side || '—'}</td>
      <td class="num">${Number(p.lots || 0).toFixed(2)}</td>
      <td class="dim">${p.entry_date || '—'}</td>
      <td class="num">${ep.toFixed(5)}</td>
      <td class="num">${cp.toFixed(5)}</td>
      <td class="num ${pnlCls}">${pnlText}</td>
    </tr>`;
  }).join('');
}

// ── render: equity curve ─────────────────────────────────────────────
function renderEquity(equity, initial) {
  const div = $('equity-chart');
  let x, y, rangeText;
  if (!equity || !equity.length) {
    // Synthetic flat baseline so the chart doesn't render an empty void.
    const today = new Date();
    const days = 30;
    x = []; y = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (days - 1 - i));
      x.push(d.toISOString().slice(0, 10));
      y.push(initial);
    }
    rangeText = '— (no data)';
  } else {
    x = equity.map(r => r.date);
    y = equity.map(r => Number(r.balance) || initial);
    rangeText = `${x[0]} → ${x[x.length-1]}`;
  }
  $('equity-range').textContent = rangeText;

  const main = {
    x, y, type: 'scatter', mode: 'lines',
    line: { color: '#cdd2d8', width: 1.4, shape: 'linear' },
    hovertemplate: '%{x}<br>$%{y:,.0f}<extra></extra>',
    showlegend: false,
  };
  const ref = {
    x: [x[0], x[x.length-1]], y: [initial, initial],
    type: 'scatter', mode: 'lines',
    line: { color: '#2c3340', width: 1, dash: 'dot' },
    hoverinfo: 'skip', showlegend: false,
  };

  const layout = {
    paper_bgcolor: '#161b24',
    plot_bgcolor:  '#161b24',
    font: { color: '#6a727d',
            family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            size: 11 },
    margin: { t: 18, r: 28, b: 38, l: 72 },
    xaxis: {
      gridcolor: '#1f2531', zeroline: false,
      showline: true, linecolor: '#262d39', linewidth: 1,
      ticks: 'outside', tickcolor: '#262d39', ticklen: 4,
    },
    yaxis: {
      gridcolor: '#1f2531', zeroline: false,
      tickformat: '$,.0f',
      showline: true, linecolor: '#262d39', linewidth: 1,
      ticks: 'outside', tickcolor: '#262d39', ticklen: 4,
    },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: '#11151b',
      bordercolor: '#262d39',
      font: { color: '#e3e6ea',
              family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
              size: 12 },
    },
    showlegend: false,
  };
  Plotly.newPlot(div, [ref, main], layout, { displayModeBar: false, responsive: true });
}

// ── render: trades + signals ─────────────────────────────────────────
function renderTrades(trades) {
  const tbody = document.querySelector('#trades-table tbody');
  if (!trades.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No closed trades yet.</td></tr>';
    return;
  }
  const recent = trades.slice(-25).reverse();
  tbody.innerHTML = recent.map(t => {
    const pnl     = Number(t.pnl_usd) || 0;
    const pnlCls  = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'dim';
    const sideCls = t.side === 'LONG' ? 'pos' : 'neg';
    return `<tr>
      <td class="dim">${t.exit_date || '—'}</td>
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
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No signals recorded.</td></tr>';
    return;
  }
  const recent = signals.slice(-25).reverse();
  tbody.innerHTML = recent.map(s => {
    const sig = parseInt(s.signal) || 0;
    const sideText = sig > 0 ? 'LONG' : sig < 0 ? 'SHORT' : 'FLAT';
    const sideCls  = sig > 0 ? 'pos' : sig < 0 ? 'neg' : 'dim';
    const conv = (parseFloat(s.ensemble_avg) || 0).toFixed(2);
    return `<tr>
      <td class="dim">${s.as_of_date || '—'}</td>
      <td>${s.asset || ''}</td>
      <td class="num">${conv}</td>
      <td class="${sideCls}">${sideText}</td>
    </tr>`;
  }).join('');
}

// ── orchestrate ──────────────────────────────────────────────────────
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
    console.error('Dashboard load failed:', e);
  }
}

loadAll();
setInterval(loadAll, REFRESH_MS);
