// ManifoldFX dashboard. Reads:
//   data/state.json        — current LIVE state + reference summary
//   data/meta.json         — strategy metadata
//   data/live/*.csv        — live forward-test stream
//   data/reference/*.csv   — frozen historical OOS reference
// Static, no backend. Polls every 60s.

const DATA_BASE  = 'data';
const REFRESH_MS = 60_000;

const $ = id => document.getElementById(id);

// ── formatters ───────────────────────────────────────────────────────
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
function pnlClass(v) {
  if (v == null || isNaN(v) || v === 0) return '';
  return v > 0 ? 'pos' : 'neg';
}
function bust(url) { return `${url}?v=${Date.now()}`; }
function fmtUtc(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} `
       + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

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

// ── Header / live summary ────────────────────────────────────────────
function renderMasthead(state, meta) {
  $('phase-badge').textContent = (state.phase || 'demo').toUpperCase();
  $('dryrun-tag').hidden = !state.dry_run;

  if (state.as_of_utc) {
    const d = new Date(state.as_of_utc);
    const hb = state.last_heartbeat_utc ? new Date(state.last_heartbeat_utc) : null;
    const fmt = dt => fmtUtc(dt.toISOString());
    $('updated-at').textContent = hb
      ? `${fmt(d)}  ·  hb ${fmt(hb).slice(11)}`
      : fmt(d);

    // Data freshness indicator — based on the most recent of report/heartbeat
    const newest = hb && hb > d ? hb : d;
    const ageMs  = Date.now() - newest.getTime();
    const ageMin = Math.round(ageMs / 60000);
    const ageEl  = $('data-age');
    let cls, label;
    if (ageMin < 30)         { cls = 'fresh';  label = `Live data ${ageMin}m old`; }
    else if (ageMin < 180)   { cls = 'recent'; label = `Live data ${ageMin}m old`; }
    else if (ageMin < 1440)  { cls = 'stale';  label = `Stale: ${Math.round(ageMin/60)}h old (desktop may be asleep)`; }
    else                     { cls = 'frozen'; label = `Stale: ${Math.round(ageMin/1440)}d old (desktop offline?)`; }
    ageEl.textContent = label;
    ageEl.className   = `data-age ${cls}`;
  }

  const nm     = meta.strategy_name || 'ManifoldFX';
  const assets = (meta.assets || []).join('  ·  ');
  const initial = state.account_initial_usd || meta.account_initial_usd || 50000;
  const acct   = `${initial.toLocaleString()} USD account`;
  $('meta-line').textContent = [nm + '  ·  FTMO 2-step swing', assets, acct]
                                .filter(Boolean).join('   ·   ');

  $('foot-meta').textContent =
    'Daily-close swing strategy. Strategy logic, model parameters, and per-trade '
  + 'reasoning are private and not exposed in this view.';
}

function renderLiveSummary(state, meta) {
  const initial  = state.account_initial_usd || meta.account_initial_usd || 50000;
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

  // Live-stream status pill + sub
  const liveFirst = state.live_first_date;
  const liveLast  = state.live_last_date;
  const pill   = $('live-status');
  const subEl  = $('live-sub');
  if (liveFirst && liveLast) {
    const days = daysBetween(liveFirst, liveLast) + 1;
    const n = m.total_trades || 0;
    pill.textContent = `Live · ${days} day${days === 1 ? '' : 's'}`;
    pill.className = 'status-pill';
    subEl.textContent = `Running since ${liveFirst}.  ${days} trading day${days === 1 ? '' : 's'} · ${n} closed trade${n === 1 ? '' : 's'}.`;
  } else {
    pill.textContent = 'Awaiting first run';
    pill.className = 'status-pill status-pill--mute';
    subEl.textContent = 'Will populate on the first scheduled daily run.';
  }
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  return Math.round((db - da) / 86_400_000);
}

// ── Open positions ───────────────────────────────────────────────────
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

// ── Equity curve renderer (reused for both live + reference) ─────────
function renderEquity(divId, equity, initial, lineColor, emptyMsg) {
  const div = $(divId);
  let x, y;
  if (!equity || !equity.length) {
    const today = new Date();
    const days = 30;
    x = []; y = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (days - 1 - i));
      x.push(d.toISOString().slice(0, 10));
      y.push(initial);
    }
  } else {
    x = equity.map(r => r.date);
    y = equity.map(r => Number(r.balance) || initial);
  }
  const main = {
    x, y, type: 'scatter', mode: 'lines',
    line: { color: lineColor, width: 1.4, shape: 'linear' },
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
      bgcolor: '#11151b', bordercolor: '#262d39',
      font: { color: '#e3e6ea',
              family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
              size: 12 },
    },
    showlegend: false,
  };
  Plotly.newPlot(div, [ref, main], layout, { displayModeBar: false, responsive: true });
}

// ── Tables (reused for both live + reference) ────────────────────────
function renderTradesTable(tableId, trades, emptyMsg) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!trades.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${emptyMsg}</td></tr>`;
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

function fmtAction(raw, sigFallback) {
  // Prefer the reporter's `action` column. Fall back to signal sign if absent.
  let a = raw ? String(raw).toUpperCase() : null;
  if (!a) {
    const sig = parseInt(sigFallback) || 0;
    a = sig > 0 ? 'OPEN_LONG' : sig < 0 ? 'OPEN_SHORT' : 'NO_POSITION';
  }
  const text = a.replace(/_/g, ' ');
  let cls = 'dim';
  if (a === 'OPEN_LONG'  || a === 'HOLD_LONG'  || a === 'REVERSE_TO_LONG')  cls = 'pos';
  else if (a === 'OPEN_SHORT' || a === 'HOLD_SHORT' || a === 'REVERSE_TO_SHORT') cls = 'neg';
  else if (a === 'EXIT_LONG'  || a === 'EXIT_SHORT')                              cls = 'warn';
  return { text, cls };
}

function renderSignalsTable(tableId, signals, emptyMsg) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!signals.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">${emptyMsg}</td></tr>`;
    return;
  }
  const recent = signals.slice(-25).reverse();
  tbody.innerHTML = recent.map(s => {
    const { text: actText, cls: actCls } = fmtAction(s.action, s.signal);
    const conv = (parseFloat(s.ensemble_avg) || 0).toFixed(2);
    return `<tr>
      <td class="dim">${s.as_of_date || '—'}</td>
      <td>${s.asset || ''}</td>
      <td class="num">${conv}</td>
      <td class="${actCls}">${actText}</td>
    </tr>`;
  }).join('');
}

// ── Reference section ────────────────────────────────────────────────
function renderRefSummary(state) {
  const m = state.reference_metrics || {};
  setValue('r-trades', 'sub-value', String(m.total_trades ?? 0));
  setValue('r-wr',     'sub-value', m.total_trades ? fmtPct(m.win_rate, 1) : '—');
  setValue('r-total',  'sub-value', fmtUsd(m.total_pnl_usd), pnlClass(m.total_pnl_usd));
  setValue('r-dd',     'sub-value', fmtPct(m.max_drawdown_pct));
  setValue('r-pf',     'sub-value', m.total_trades ? fmtNum(m.profit_factor) : '—');
  setValue('r-sharpe', 'sub-value', m.total_trades ? fmtNum(m.annualised_sharpe) : '—');

  const first = state.reference_first_date;
  const last  = state.reference_last_date;
  const pill  = $('ref-status');
  const sub   = $('ref-sub');
  if (first && last) {
    pill.textContent = `${first} → ${last}`;
    sub.textContent = `Frozen-model out-of-sample inference, ${first} → ${last}.  Static baseline; not live.`;
  } else {
    pill.textContent = '—';
    sub.textContent = 'No reference data loaded.';
  }
}

// ── Main loop ─────────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [state, meta, liveEq, liveTr, liveSig, refEq, refTr, refSig] = await Promise.all([
      fetchJson('state.json').catch(() => ({})),
      fetchJson('meta.json').catch(() => ({})),
      fetchCsv('live/equity.csv'),
      fetchCsv('live/trades.csv'),
      fetchCsv('live/signals.csv'),
      fetchCsv('reference/equity.csv'),
      fetchCsv('reference/trades.csv'),
      fetchCsv('reference/signals.csv'),
    ]);
    const initial = state.account_initial_usd || meta.account_initial_usd || 50000;

    renderMasthead(state, meta);
    renderLiveSummary(state, meta);
    renderPositions(state);
    renderEquity('live-equity-chart', liveEq, initial, '#cdd2d8', 'Awaiting first run.');
    renderTradesTable('live-trades-table',   liveTr,  'Awaiting first closed trade.');
    renderSignalsTable('live-signals-table', liveSig, 'Awaiting first scheduled run.');

    // Live equity range label
    if (liveEq.length) {
      $('live-equity-range').textContent = `${liveEq[0].date} → ${liveEq[liveEq.length-1].date}`;
    } else {
      $('live-equity-range').textContent = '— (no data yet)';
    }

    renderRefSummary(state);
    renderEquity('ref-equity-chart', refEq, initial, '#7c8794', 'No reference data.');
    renderTradesTable('ref-trades-table',   refTr,  '—');
    renderSignalsTable('ref-signals-table', refSig, '—');

    if (refEq.length) {
      $('ref-equity-range').textContent = `${refEq[0].date} → ${refEq[refEq.length-1].date}`;
    } else {
      $('ref-equity-range').textContent = '—';
    }
  } catch (e) {
    console.error('Dashboard load failed:', e);
  }
}

// Manual refresh button — re-fetches everything from GitHub. Doesn't reach into
// the user's desktop; if their machine is asleep, this just shows the last data
// the heartbeat was able to push. Useful when the desktop IS awake (data is
// at most ~15 min old in that case).
async function manualRefresh() {
  const btn = $('refresh-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('is-spinning');
  try {
    await loadAll();
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('is-spinning');
    }, 350);
  }
}
$('refresh-btn').addEventListener('click', manualRefresh);

loadAll();
setInterval(loadAll, REFRESH_MS);
