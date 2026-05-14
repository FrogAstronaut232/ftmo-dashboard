// ManifoldFX / G10 dashboard. Reads:
//   data/state.json            -- ManifoldFX (2-pair) LIVE state + reference summary
//   data/meta.json             -- ManifoldFX metadata
//   data/live/*.csv            -- ManifoldFX live forward-test stream
//   data/reference/*.csv       -- ManifoldFX frozen historical OOS reference
//   data/g10/state.json        -- G10 (10-pair) LIVE state
//   data/g10/meta.json         -- G10 metadata
//   data/g10/live/*.csv        -- G10 live forward-test stream
//   data/backtest_strict_oos/  -- G10 Strict-OOS reference backtest (folded into G10 tab)
// Static, no backend. Polls every 60s.

const DATA_BASE  = 'data';
const REFRESH_MS = 60_000;

const $ = id => document.getElementById(id);

// -- formatters --------------------------------------------------------
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

// -- Header / live summary (driven by ManifoldFX state, since masthead is global) --
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

    // Data freshness indicator
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
    'Daily-close swing strategies. Strategy logic, model parameters, and per-trade '
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

// -- Open positions ----------------------------------------------------
function renderPositions(tableId, state, emptyMsg) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
  const positions = state.open_positions || [];
  if (!positions.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">${emptyMsg}</td></tr>`;
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

// -- Equity curve renderer (reused everywhere) ------------------------
// If equity rows include a `bh_sp500` column, plot it as a muted dashed
// overlay so the strategy can be compared against SP500 buy-and-hold.
function renderEquity(divId, equity, initial, lineColor, currentEquity, opts = {}) {
  const div = $(divId);
  if (!div) return;
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
    if (currentEquity != null && !isNaN(currentEquity)) {
      y[y.length - 1] = currentEquity;
    }
  } else {
    x = equity.map(r => r.date);
    y = equity.map(r => Number(r.balance) || initial);
    if (currentEquity != null && !isNaN(currentEquity)) {
      const today = new Date().toISOString().slice(0, 10);
      const lastDate = x[x.length - 1];
      const lastBal  = y[y.length - 1];
      if (today !== lastDate) {
        x.push(today);
        y.push(currentEquity);
      } else if (Math.abs(currentEquity - lastBal) > 0.005) {
        y[y.length - 1] = currentEquity;
      }
    }
  }
  const hasBh = equity && equity.length && equity.some(r => r.bh_sp500 != null && r.bh_sp500 !== '');
  const main = {
    x, y, type: 'scatter', mode: 'lines',
    name: opts.mainLabel || 'Strategy',
    line: { color: lineColor, width: 1.4, shape: 'linear' },
    hovertemplate: '%{x}<br>$%{y:,.0f}<extra>' + (opts.mainLabel || 'Strategy') + '</extra>',
    showlegend: hasBh,
  };
  const ref = {
    x: [x[0], x[x.length-1]], y: [initial, initial],
    type: 'scatter', mode: 'lines',
    line: { color: '#2c3340', width: 1, dash: 'dot' },
    hoverinfo: 'skip', showlegend: false,
  };
  let bhTrace = null;
  if (hasBh) {
    const bhX = equity.map(r => r.date);
    const bhY = equity.map(r => Number(r.bh_sp500) || initial);
    bhTrace = {
      x: bhX, y: bhY, type: 'scatter', mode: 'lines',
      name: 'SP500 buy & hold',
      line: { color: '#c9a14a', width: 1.2, dash: 'dash' },
      hovertemplate: '%{x}<br>$%{y:,.0f}<extra>SP500 B&H</extra>',
      showlegend: true,
    };
  }
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
    showlegend: hasBh,
    legend: hasBh ? {
      orientation: 'h', x: 0, y: 1.08,
      bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#9aa3ad', size: 10 },
    } : undefined,
  };
  const traces = bhTrace ? [ref, bhTrace, main] : [ref, main];
  Plotly.newPlot(div, traces, layout, { displayModeBar: false, responsive: true });
}

// -- Tables ------------------------------------------------------------
function renderTradesTable(tableId, trades, emptyMsg) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
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
  if (!tbody) return;
  if (!signals.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty">${emptyMsg}</td></tr>`;
    return;
  }
  const recent = signals.slice(-25).reverse();
  tbody.innerHTML = recent.map(s => {
    const { text: actText, cls: actCls } = fmtAction(s.action, s.signal);
    const conv = (parseFloat(s.ensemble_avg) || 0).toFixed(2);
    return `<tr>
      <td class="dim">${s.as_of_date || '—'}</td>
      <td class="num">${conv}</td>
      <td class="${actCls}">${actText}</td>
    </tr>`;
  }).join('');
}

// All-pairs signals table (used by G10 tab; includes Asset column)
function renderSignalsTableAllPairs(tableId, signals, emptyMsg) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
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
      <td>${s.asset || '—'}</td>
      <td class="num">${conv}</td>
      <td class="${actCls}">${actText}</td>
    </tr>`;
  }).join('');
}

function byAsset(signals, asset) {
  return (signals || []).filter(s => String(s.asset || '').toUpperCase() === asset);
}

// -- Reference section (ManifoldFX) -----------------------------------
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
    pill.textContent = `${first} -> ${last}`;
    sub.textContent = `Frozen-model out-of-sample inference, ${first} -> ${last}.  Static baseline; not live.`;
  } else {
    pill.textContent = '—';
    sub.textContent = 'No reference data loaded.';
  }
}

// -- G10 LIVE summary --------------------------------------------------
function renderG10LiveSummary(state, meta) {
  const initial = state.account_initial_usd || meta.account_initial_usd || 50000;
  const awaiting = !!state.awaiting_first_run;
  const m = state.metrics || {};

  if (awaiting) {
    // Empty-state placeholders -- don't render zero values as if they were real
    setValue('g-equity', 'hero-value', '—');
    setValue('g-total',  'hero-value', '—');
    setValue('g-today',  'hero-value', '—');
    setValue('g-dd',     'hero-value', '—');
    setValue('g-wr',      'sub-value', '—');
    setValue('g-trades',  'sub-value', '—');
    setValue('g-sharpe',  'sub-value', '—');
    setValue('g-pf',      'sub-value', '—');
    setValue('g-avgwin',  'sub-value', '—');
    setValue('g-avgloss', 'sub-value', '—');

    const pill = $('g10-live-status');
    const sub  = $('g10-live-sub');
    if (pill) {
      pill.textContent = 'Awaiting first run';
      pill.className = 'status-pill status-pill--mute';
    }
    if (sub) {
      sub.textContent =
        'First scheduled run: 2026-05-15 08:05 AEST (= 2026-05-14 22:05 UTC). '
      + '10-pair G10 FX swing portfolio on the same MT5 account as ManifoldFX, '
      + 'distinct magic numbers (100010-100019).';
    }
  } else {
    const equity   = state.equity ?? initial;
    const today    = state.today_pnl ?? 0;
    const totalPnl = equity - initial;
    const dd       = state.drawdown_pct ?? 0;

    setValue('g-equity', 'hero-value', fmtUsd(equity, false));
    setValue('g-total',  'hero-value', fmtUsd(totalPnl), pnlClass(totalPnl));
    setValue('g-today',  'hero-value', fmtUsd(today),    pnlClass(today));
    setValue('g-dd',     'hero-value', fmtPct(dd),       dd > 5 ? 'warn' : '');

    setValue('g-wr',      'sub-value', m.total_trades ? fmtPct(m.win_rate, 1) : '—');
    setValue('g-trades',  'sub-value', String(m.total_trades ?? 0));
    setValue('g-sharpe',  'sub-value', m.total_trades ? fmtNum(m.annualised_sharpe) : '—');
    setValue('g-pf',      'sub-value', m.total_trades ? fmtNum(m.profit_factor)     : '—');
    setValue('g-avgwin',  'sub-value', m.avg_win_usd  ? fmtUsd(m.avg_win_usd)  : '—', m.avg_win_usd  > 0 ? 'pos' : '');
    setValue('g-avgloss', 'sub-value', m.avg_loss_usd ? fmtUsd(m.avg_loss_usd) : '—', m.avg_loss_usd < 0 ? 'neg' : '');

    const liveFirst = state.live_first_date;
    const liveLast  = state.live_last_date;
    const pill = $('g10-live-status');
    const sub  = $('g10-live-sub');
    if (pill && sub) {
      if (liveFirst && liveLast) {
        const days = daysBetween(liveFirst, liveLast) + 1;
        const n = m.total_trades || 0;
        pill.textContent = `Live · ${days} day${days === 1 ? '' : 's'}`;
        pill.className = 'status-pill';
        sub.textContent = `Running since ${liveFirst}.  ${days} trading day${days === 1 ? '' : 's'} · ${n} closed trade${n === 1 ? '' : 's'}.`;
      } else {
        pill.textContent = 'Live';
        pill.className = 'status-pill';
      }
    }
  }
}

// -- Main loop ---------------------------------------------------------
async function loadAll() {
  try {
    // ManifoldFX (2-pair) data
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
    renderPositions('positions-table', state, 'No open positions.');
    renderEquity('live-equity-chart', liveEq, initial, '#cdd2d8', state.equity);
    renderTradesTable('live-trades-table',   liveTr,  'Awaiting first closed trade.');
    renderSignalsTable('live-signals-eurusd-table', byAsset(liveSig, 'EURUSD'), 'Awaiting first scheduled run.');
    renderSignalsTable('live-signals-gbpjpy-table', byAsset(liveSig, 'GBPJPY'), 'Awaiting first scheduled run.');

    if (liveEq.length) {
      $('live-equity-range').textContent = `${liveEq[0].date} -> ${liveEq[liveEq.length-1].date}`;
    } else {
      $('live-equity-range').textContent = '— (no data yet)';
    }

    renderRefSummary(state);
    renderEquity('ref-equity-chart', refEq, initial, '#7c8794');
    renderTradesTable('ref-trades-table',   refTr,  '—');
    renderSignalsTable('ref-signals-eurusd-table', byAsset(refSig, 'EURUSD'), '—');
    renderSignalsTable('ref-signals-gbpjpy-table', byAsset(refSig, 'GBPJPY'), '—');

    if (refEq.length) {
      $('ref-equity-range').textContent = `${refEq[0].date} -> ${refEq[refEq.length-1].date}`;
    } else {
      $('ref-equity-range').textContent = '—';
    }

    // G10 (10-pair) LIVE data
    await loadG10Live();
  } catch (e) {
    console.error('Dashboard load failed:', e);
  }
}

// -- G10 LIVE loader ---------------------------------------------------
async function loadG10Live() {
  try {
    const [gState, gMeta, gEq, gTr, gSig] = await Promise.all([
      fetchJson('g10/state.json').catch(() => ({ awaiting_first_run: true })),
      fetchJson('g10/meta.json').catch(() => ({})),
      fetchCsv('g10/live/equity.csv'),
      fetchCsv('g10/live/trades.csv'),
      fetchCsv('g10/live/signals.csv'),
    ]);
    const initial = gState.account_initial_usd || gMeta.account_initial_usd || 50000;
    const awaiting = !!gState.awaiting_first_run;

    renderG10LiveSummary(gState, gMeta);
    renderPositions('g-positions-table', gState,
      awaiting
        ? 'Awaiting first run — fires daily at 08:05 AEST (= 22:05 UTC).'
        : 'No open positions.');

    // Only paint a live equity curve if we actually have data
    if (gEq.length || !awaiting) {
      renderEquity('g-equity-chart', gEq, initial, '#cdd2d8', awaiting ? null : gState.equity);
      if (gEq.length) {
        $('g-equity-range').textContent = `${gEq[0].date} -> ${gEq[gEq.length-1].date}`;
      } else {
        $('g-equity-range').textContent = '— (no data yet)';
      }
    } else {
      // Awaiting-first-run: draw flat $50k baseline so the chart isn't empty
      renderEquity('g-equity-chart', [], initial, '#3a4452', null);
      $('g-equity-range').textContent = 'Awaiting first run';
    }

    renderTradesTable('g-trades-table', gTr,
      awaiting
        ? 'Awaiting first closed trade. First scheduled run: 2026-05-15 08:05 AEST.'
        : 'No closed trades yet.');
    renderSignalsTableAllPairs('g-signals-table', gSig,
      awaiting
        ? 'Awaiting first scheduled run.'
        : 'No signals yet.');
  } catch (e) {
    console.error('G10 live load failed:', e);
  }
}

// Manual refresh button -- reloads everything for BOTH strategies.
async function manualRefresh() {
  const btn = $('refresh-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('is-spinning');
  const label = btn.querySelector('.refresh-label');
  const original = label ? label.textContent : 'Refresh';
  try {
    await loadAll();
    // Also re-pull the Strict-OOS backtest data so the G10 tab's reference section refreshes.
    if (backtestLoaded) {
      try { await loadBacktest(); } catch (_) { /* ignore */ }
    }
    if (label) label.textContent = 'Refreshed';
  } catch (e) {
    if (label) label.textContent = 'Failed';
    console.error(e);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('is-spinning');
      if (label) label.textContent = original;
    }, 1200);
  }
}
$('refresh-btn').addEventListener('click', manualRefresh);

// -- Tab switching -----------------------------------------------------
// Two top-level tabs: ManifoldFX (2-pair live) and G10 (10-pair live +
// Strict-OOS reference backtest).
// G10's backtest section is fetched lazily on first tab activation.
let backtestLoaded = false;

function activateTab(name) {
  const tabs = ['manifoldfx', 'g10'];
  tabs.forEach(t => {
    const pane = $(`tab-${t}`);
    const btn  = $(`tab-btn-${t}`);
    if (!pane || !btn) return;
    const active = (t === name);
    pane.hidden = !active;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (name === 'g10' && !backtestLoaded) {
    backtestLoaded = true;
    loadBacktest().catch(e => {
      console.error('Backtest load failed:', e);
      backtestLoaded = false;
    });
  }
  // Plotly charts can mis-size when drawn while their container is hidden.
  setTimeout(() => {
    if (name === 'manifoldfx') {
      const live = $('live-equity-chart'); if (live && live._fullLayout) Plotly.Plots.resize(live);
      const ref  = $('ref-equity-chart');  if (ref  && ref._fullLayout)  Plotly.Plots.resize(ref);
    } else if (name === 'g10') {
      const gl = $('g-equity-chart');      if (gl && gl._fullLayout) Plotly.Plots.resize(gl);
      const eq = $('bt-equity-chart');     if (eq && eq._fullLayout) Plotly.Plots.resize(eq);
      const yr = $('bt-yearbar-chart');    if (yr && yr._fullLayout) Plotly.Plots.resize(yr);
      const mc = $('bt-macro-shift-chart');if (mc && mc._fullLayout) Plotly.Plots.resize(mc);
    }
  }, 30);
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// -- Backtest tab loader (G10 Strict-OOS reference) -------------------
async function loadBacktest() {
  const BT_BASE = `${DATA_BASE}/backtest_strict_oos`;
  const fetchBt = async (name) => {
    const r = await fetch(bust(`${BT_BASE}/${name}`));
    if (!r.ok) throw new Error(`${name} ${r.status}`);
    if (name.endsWith('.json')) return r.json();
    const text = await r.text();
    return new Promise(resolve => {
      Papa.parse(text, {
        header: true, dynamicTyping: true, skipEmptyLines: true,
        complete: results => resolve(results.data || []),
      });
    });
  };

  const [summary, portfolio, perPair, perYear, subPeriod, regime, mc,
         robustness, macro, tradeStats, sensitivity, verdict] = await Promise.all([
    fetchBt('summary.json'),
    fetchBt('portfolio.csv'),
    fetchBt('per_pair.csv'),
    fetchBt('per_year.csv'),
    fetchBt('sub_period.csv'),
    fetchBt('regime_conditional.csv'),
    fetchBt('ftmo_montecarlo.json').catch(() => null),
    fetchBt('robustness_scorecard.json').catch(() => null),
    fetchBt('macro_analysis.json').catch(() => null),
    fetchBt('trade_stats.json').catch(() => null),
    fetchBt('sensitivity_tests.json').catch(() => null),
    fetchBt('verdict_summary.json').catch(() => null),
  ]);

  // Hero + submetrics
  const signed = v => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  $('bt-sharpe').textContent  = signed(summary.sharpe);
  $('bt-cagr').textContent    = `${summary.cagr_pct > 0 ? '+' : ''}${summary.cagr_pct.toFixed(2)}%`;
  $('bt-mdd').textContent     = `${summary.mdd_pct.toFixed(2)}%`;
  $('bt-calmar').textContent  = summary.calmar.toFixed(2);

  $('bt-period').textContent  = `${summary.period_start} -> ${summary.period_end}`;
  $('bt-days').textContent    = String(summary.n_days);
  $('bt-wr').textContent      = `${summary.win_rate_pct.toFixed(1)}%`;
  $('bt-vol').textContent     = `${summary.ann_vol_pct.toFixed(2)}%`;
  $('bt-pf').textContent      = summary.profit_factor.toFixed(2);
  $('bt-sortino').textContent = summary.sortino.toFixed(2);

  // Equity curve (log scale)
  const eqX = portfolio.map(r => r.date);
  const eqY = portfolio.map(r => Number(r.equity));
  if (eqX.length) {
    $('bt-equity-range').textContent = `${eqX[0]} -> ${eqX[eqX.length - 1]}`;
  }
  const eqTrace = {
    x: eqX, y: eqY,
    type: 'scatter', mode: 'lines',
    name: 'G10 strategy',
    line: { color: '#5cb87a', width: 1.4, shape: 'linear' },
    hovertemplate: '%{x}<br>equity %{y:.3f}×<extra>G10</extra>',
    showlegend: true,
  };
  const eqRef = {
    x: [eqX[0], eqX[eqX.length - 1]], y: [1, 1],
    type: 'scatter', mode: 'lines',
    line: { color: '#2c3340', width: 1, dash: 'dot' },
    hoverinfo: 'skip', showlegend: false,
  };
  // SP500 B&H overlay (same unit-multiple scale: bh_sp500 / 50_000)
  const bhRows = portfolio.filter(r => r.bh_sp500 != null && r.bh_sp500 !== '');
  let bhTrace = null;
  if (bhRows.length) {
    const initialUsd = 50000;
    bhTrace = {
      x: bhRows.map(r => r.date),
      y: bhRows.map(r => Number(r.bh_sp500) / initialUsd),
      type: 'scatter', mode: 'lines',
      name: 'SP500 buy & hold',
      line: { color: '#c9a14a', width: 1.2, dash: 'dash' },
      hovertemplate: '%{x}<br>equity %{y:.3f}×<extra>SP500 B&H</extra>',
      showlegend: true,
    };
  }
  const eqLayout = {
    paper_bgcolor: '#161b24', plot_bgcolor: '#161b24',
    font: { color: '#6a727d', family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', size: 11 },
    margin: { t: 18, r: 28, b: 38, l: 72 },
    xaxis: {
      gridcolor: '#1f2531', zeroline: false,
      showline: true, linecolor: '#262d39', linewidth: 1,
      ticks: 'outside', tickcolor: '#262d39', ticklen: 4,
    },
    yaxis: {
      type: 'log',
      gridcolor: '#1f2531', zeroline: false,
      tickformat: '.2f',
      showline: true, linecolor: '#262d39', linewidth: 1,
      ticks: 'outside', tickcolor: '#262d39', ticklen: 4,
      title: { text: 'Equity multiple (log)', font: { color: '#6a727d', size: 10 } },
    },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: '#11151b', bordercolor: '#262d39',
      font: { color: '#e3e6ea', family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', size: 12 },
    },
    showlegend: !!bhTrace,
    legend: bhTrace ? {
      orientation: 'h', x: 0, y: 1.08,
      bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#9aa3ad', size: 10 },
    } : undefined,
  };
  const eqTraces = bhTrace ? [eqRef, bhTrace, eqTrace] : [eqRef, eqTrace];
  Plotly.newPlot('bt-equity-chart', eqTraces, eqLayout, { displayModeBar: false, responsive: true });

  // Per-year Sharpe bar chart
  const yrX = perYear.map(r => String(r.year));
  const yrY = perYear.map(r => Number(r.sharpe));
  const yrTrace = {
    x: yrX, y: yrY, type: 'bar',
    marker: {
      color: yrY.map(v => v >= 0 ? '#5cb87a' : '#d04a52'),
      line: { color: '#262d39', width: 1 },
    },
    text: yrY.map(v => v.toFixed(2)),
    textposition: 'outside',
    textfont: { color: '#9aa3ad', family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', size: 11 },
    hovertemplate: '%{x}<br>Sharpe %{y:.2f}<extra></extra>',
    showlegend: false,
  };
  const yrLayout = {
    paper_bgcolor: '#161b24', plot_bgcolor: '#161b24',
    font: { color: '#6a727d', family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', size: 11 },
    margin: { t: 26, r: 28, b: 38, l: 60 },
    xaxis: {
      gridcolor: '#1f2531', zeroline: false,
      showline: true, linecolor: '#262d39', linewidth: 1,
      ticks: 'outside', tickcolor: '#262d39', ticklen: 4,
    },
    yaxis: {
      gridcolor: '#1f2531', zeroline: true, zerolinecolor: '#3a4452',
      showline: true, linecolor: '#262d39', linewidth: 1,
      ticks: 'outside', tickcolor: '#262d39', ticklen: 4,
      title: { text: 'Sharpe', font: { color: '#6a727d', size: 10 } },
      rangemode: 'tozero',
    },
    bargap: 0.35,
    hoverlabel: {
      bgcolor: '#11151b', bordercolor: '#262d39',
      font: { color: '#e3e6ea', family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', size: 12 },
    },
    showlegend: false,
  };
  Plotly.newPlot('bt-yearbar-chart', [yrTrace], yrLayout, { displayModeBar: false, responsive: true });

  // Per-pair table (sorted by Sharpe desc)
  const pairs = perPair
    .filter(r => r && r.pair)
    .slice()
    .sort((a, b) => Number(b.sharpe) - Number(a.sharpe));
  const pairBody = document.querySelector('#bt-pair-table tbody');
  if (pairs.length) {
    pairBody.innerHTML = pairs.map(r => {
      const sh = Number(r.sharpe);
      const cagr = Number(r.cagr_pct);
      const shCls = sh > 0 ? 'pos' : sh < 0 ? 'neg' : 'dim';
      const cagrCls = cagr > 0 ? 'pos' : cagr < 0 ? 'neg' : 'dim';
      return `<tr>
        <td>${r.pair}</td>
        <td class="num ${shCls}">${sh.toFixed(2)}</td>
        <td class="num ${cagrCls}">${cagr.toFixed(2)}</td>
        <td class="num neg">${Number(r.mdd_pct).toFixed(2)}</td>
        <td class="num dim">${Number(r.ann_vol_pct).toFixed(2)}</td>
        <td class="num">${Number(r.calmar).toFixed(2)}</td>
      </tr>`;
    }).join('');
  } else {
    pairBody.innerHTML = '<tr><td colspan="6" class="empty">No data.</td></tr>';
  }

  // Regime table
  const regimeLabels = { low_vol: 'Low VIX', mid_vol: 'Mid VIX', high_vol: 'High VIX' };
  const regimeBody = document.querySelector('#bt-regime-table tbody');
  if (regime.length) {
    regimeBody.innerHTML = regime.map(r => {
      const sh = Number(r.sharpe);
      const cagr = Number(r.cagr_pct);
      const label = regimeLabels[r.regime] || r.regime;
      return `<tr>
        <td>${label}</td>
        <td class="num pos">${sh.toFixed(2)}</td>
        <td class="num pos">${cagr.toFixed(2)}</td>
        <td class="num dim">${r.n_days}</td>
      </tr>`;
    }).join('');
  } else {
    regimeBody.innerHTML = '<tr><td colspan="4" class="empty">No data.</td></tr>';
  }

  // Sub-period table
  const subBody = document.querySelector('#bt-subperiod-table tbody');
  if (subPeriod.length) {
    subBody.innerHTML = subPeriod.map(r => {
      const sh = Number(r.sharpe);
      const cagr = Number(r.cagr_pct);
      const mdd = Number(r.mdd_pct);
      const shCls = sh > 0 ? 'pos' : 'neg';
      const cagrCls = cagr > 0 ? 'pos' : 'neg';
      return `<tr>
        <td class="dim">${r.block}</td>
        <td class="num ${shCls}">${sh.toFixed(2)}</td>
        <td class="num ${cagrCls}">${cagr.toFixed(2)}</td>
        <td class="num neg">${mdd.toFixed(2)}</td>
      </tr>`;
    }).join('');
  } else {
    subBody.innerHTML = '<tr><td colspan="4" class="empty">No data.</td></tr>';
  }

  // FTMO Monte Carlo panel
  renderMonteCarlo(mc);

  // Forensic-audit panels
  renderMacroAnalysis(macro);
  renderUniverseRobustness(sensitivity);
  renderTradeStats(tradeStats);
  renderSensitivity(sensitivity);
  renderRobustnessScorecard(robustness);
}

// -- Macro analysis ----------------------------------------------------
function renderMacroAnalysis(macro) {
  if (!macro) return;
  const rows = (macro.shift_gradient && macro.shift_gradient.rows) || [];
  if (rows.length) {
    const x = rows.map(r => r.shift_days);
    const y = rows.map(r => Number(r.sharpe));
    const colors = rows.map(r => {
      if (r.shift_days === 0) return '#5cb87a';
      if (Number(r.sharpe) < 0) return '#d04a52';
      return '#3a4452';
    });
    const trace = {
      x, y, type: 'bar',
      marker: { color: colors, line: { color: '#262d39', width: 1 } },
      text: y.map(v => v.toFixed(2)),
      textposition: 'outside',
      textfont: { color: '#9aa3ad', family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', size: 11 },
      hovertemplate: 'shift %{x}d<br>Sharpe %{y:.2f}<extra></extra>',
      showlegend: false,
    };
    const layout = {
      paper_bgcolor: '#161b24', plot_bgcolor: '#161b24',
      font: { color: '#6a727d', family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', size: 11 },
      margin: { t: 26, r: 28, b: 38, l: 60 },
      xaxis: {
        gridcolor: '#1f2531', zeroline: true, zerolinecolor: '#3a4452',
        showline: true, linecolor: '#262d39', linewidth: 1,
        ticks: 'outside', tickcolor: '#262d39', ticklen: 4,
        title: { text: 'Macro feature shift (days)', font: { color: '#6a727d', size: 10 } },
        tickmode: 'array',
        tickvals: x, ticktext: x.map(v => v === 0 ? '0' : (v > 0 ? `+${v}` : `${v}`)),
      },
      yaxis: {
        gridcolor: '#1f2531', zeroline: true, zerolinecolor: '#3a4452',
        showline: true, linecolor: '#262d39', linewidth: 1,
        ticks: 'outside', tickcolor: '#262d39', ticklen: 4,
        title: { text: 'Sharpe', font: { color: '#6a727d', size: 10 } },
      },
      bargap: 0.3,
      hoverlabel: {
        bgcolor: '#11151b', bordercolor: '#262d39',
        font: { color: '#e3e6ea', family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', size: 12 },
      },
      showlegend: false,
    };
    Plotly.newPlot('bt-macro-shift-chart', [trace], layout, { displayModeBar: false, responsive: true });
  }

  const abl = (macro.per_feature_ablation && macro.per_feature_ablation.rows) || [];
  const ablBody = document.querySelector('#bt-macro-ablation-table tbody');
  if (ablBody) {
    if (abl.length) {
      const baseline = { feature: 'All three (baseline)', sharpe: 4.49, baseline: true };
      const allRows = [...abl, baseline];
      ablBody.innerHTML = allRows.map(r => {
        const isDxy = /^dxy/i.test(r.feature);
        const cls = isDxy ? 'pos' : (r.baseline ? 'pos' : 'dim');
        const note = isDxy ? ' <span class="dim">&larr; dominant</span>' : (r.baseline ? ' <span class="dim">&larr; deployed</span>' : '');
        return `<tr>
          <td>${r.feature}${note}</td>
          <td class="num ${cls}">${Number(r.sharpe).toFixed(2)}</td>
        </tr>`;
      }).join('');
    } else {
      ablBody.innerHTML = '<tr><td colspan="2" class="empty">No data.</td></tr>';
    }
  }

  const src = macro.data_source_independence;
  const srcBody = document.querySelector('#bt-macro-source-table tbody');
  if (srcBody) {
    if (src) {
      const rows = [
        { source: 'yfinance (baseline)', sharpe: src.yfinance_baseline_sharpe, note: 'deployed' },
        { source: 'FRED',                sharpe: src.fred_sharpe, note: `VIX/US10Y r=${src.correlation_vix}, DXY r=${src.correlation_dxy}` },
        { source: 'Random series',       sharpe: -0.6, note: 'macro collapses to zero' },
        { source: 'Constant',            sharpe: -0.6, note: 'macro collapses to zero' },
        { source: 'Shuffled dates',      sharpe: -0.5, note: 'macro collapses to zero' },
      ];
      srcBody.innerHTML = rows.map(r => {
        const cls = Number(r.sharpe) > 0 ? 'pos' : 'neg';
        return `<tr>
          <td>${r.source}</td>
          <td class="num ${cls}">${Number(r.sharpe).toFixed(2)}</td>
          <td class="dim">${r.note}</td>
        </tr>`;
      }).join('');
    } else {
      srcBody.innerHTML = '<tr><td colspan="3" class="empty">No data.</td></tr>';
    }
  }
}

// -- Universe robustness -----------------------------------------------
function renderUniverseRobustness(sens) {
  const body = document.querySelector('#bt-universe-table tbody');
  if (!body) return;
  if (!sens || !sens.alt_universe || !sens.alt_universe.rows) {
    body.innerHTML = '<tr><td colspan="4" class="empty">No data.</td></tr>';
    return;
  }
  const altRows = sens.alt_universe.rows.slice();
  const dropUsdchf = (sens.drop_one_pair && sens.drop_one_pair.rows || [])
    .find(r => r.dropped === 'USDCHF');
  if (dropUsdchf) {
    altRows.push({
      universe: 'Drop-USDCHF (9 pairs)',
      pairs: null, n_pairs: 9,
      sharpe: dropUsdchf.remaining_sharpe,
      note: 'USDCHF not the sole driver',
    });
  }
  if (sens.drop_three_combinatorial) {
    altRows.push({
      universe: 'Drop-3 worst case (7 pairs)',
      pairs: null, n_pairs: 7,
      sharpe: sens.drop_three_combinatorial.min_sharpe,
      note: 'Worst of 120 drop-3 combinations',
    });
  }
  body.innerHTML = altRows.map((r, i) => {
    const isBaseline = i === 0;
    const sh = Number(r.sharpe);
    const shCls = sh > 0 ? 'pos' : 'neg';
    const rowCls = isBaseline ? 'class="dim"' : '';
    const np = r.n_pairs != null ? r.n_pairs : (r.pairs ? r.pairs.length : '—');
    return `<tr ${rowCls}>
      <td>${r.universe}</td>
      <td class="num dim">${np}</td>
      <td class="num ${shCls}">${sh.toFixed(2)}</td>
      <td class="dim">${r.note || ''}</td>
    </tr>`;
  }).join('');
}

// -- Trade stats -------------------------------------------------------
function renderTradeStats(ts) {
  if (!ts) return;
  const pl = ts.portfolio_level || {};
  const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setTxt('bt-ts-trades', pl.n_trades_total != null ? pl.n_trades_total.toLocaleString() : '—');
  setTxt('bt-ts-wr',     pl.win_rate_pct  != null ? `${pl.win_rate_pct.toFixed(1)}%` : '—');
  setTxt('bt-ts-pf',     pl.profit_factor != null ? pl.profit_factor.toFixed(2) : '—');
  setTxt('bt-ts-payoff', pl.payoff_ratio  != null ? pl.payoff_ratio.toFixed(2) : '—');
  setTxt('bt-ts-hold',   pl.avg_holding_days != null ? `${pl.avg_holding_days.toFixed(1)} d` : '—');
  setTxt('bt-ts-exp',    pl.expectancy_bps_per_trade != null ? `${pl.expectancy_bps_per_trade.toFixed(1)} bps` : '—');

  const rows = ts.per_pair_summary || [];
  const body = document.querySelector('#bt-trade-pair-table tbody');
  if (body) {
    if (rows.length) {
      body.innerHTML = rows.map(r => {
        const sh = Number(r.sharpe);
        const shCls = sh > 1 ? 'pos' : (sh > 0 ? 'dim' : 'neg');
        return `<tr>
          <td>${r.pair}</td>
          <td class="num ${shCls}">${sh.toFixed(2)}</td>
          <td class="num dim">${Number(r.win_rate_pct).toFixed(1)}</td>
          <td class="num">${Number(r.pf).toFixed(2)}</td>
          <td class="num dim">${Number(r.share_of_pnl_pct).toFixed(2)}</td>
          <td class="num dim">${r.sign_flips}</td>
        </tr>`;
      }).join('');
    } else {
      body.innerHTML = '<tr><td colspan="6" class="empty">No data.</td></tr>';
    }
  }
}

// -- Sensitivity tests -------------------------------------------------
function renderSensitivity(sens) {
  if (!sens) return;

  const d1Rows = (sens.drop_one_pair && sens.drop_one_pair.rows) || [];
  const d1Body = document.querySelector('#bt-sens-drop1-table tbody');
  if (d1Body) {
    if (d1Rows.length) {
      const sorted = d1Rows.slice().sort((a, b) => Number(b.delta) - Number(a.delta));
      d1Body.innerHTML = sorted.map(r => {
        const sh = Number(r.remaining_sharpe);
        const dl = Number(r.delta);
        const dlCls = dl > 0 ? 'pos' : (dl < -0.2 ? 'neg' : 'warn');
        const rowHighlight = (r.dropped === 'EURGBP') ? ' style="background: rgba(198, 146, 86, 0.05);"' : '';
        const sign = dl > 0 ? '+' : '';
        return `<tr${rowHighlight}>
          <td>${r.dropped}</td>
          <td class="num">${sh.toFixed(2)}</td>
          <td class="num ${dlCls}">${sign}${dl.toFixed(2)}</td>
        </tr>`;
      }).join('');
    } else {
      d1Body.innerHTML = '<tr><td colspan="3" class="empty">No data.</td></tr>';
    }
  }

  const oosRows = (sens.oos_start_date && sens.oos_start_date.rows) || [];
  const oosBody = document.querySelector('#bt-sens-oos-table tbody');
  if (oosBody) {
    if (oosRows.length) {
      const baseline = '2018-01-02';
      const main = oosRows.map(r => {
        const sh = Number(r.sharpe);
        const isBase = r.start === baseline;
        const rowHighlight = isBase ? ' style="background: rgba(92, 184, 122, 0.05);"' : '';
        const note = isBase ? ' <span class="dim">(baseline)</span>' : '';
        return `<tr${rowHighlight}>
          <td>${r.start}${note}</td>
          <td class="num pos">${sh.toFixed(2)}</td>
        </tr>`;
      }).join('');
      const summary = sens.oos_start_date;
      const summaryRow = `<tr>
        <td class="dim">Range &middot; std</td>
        <td class="num dim">[${summary.range_min.toFixed(2)}, ${summary.range_max.toFixed(2)}] &middot; &sigma;=${summary.std.toFixed(3)}</td>
      </tr>`;
      oosBody.innerHTML = main + summaryRow;
    } else {
      oosBody.innerHTML = '<tr><td colspan="2" class="empty">No data.</td></tr>';
    }
  }

  const d3 = sens.drop_three_combinatorial;
  const d3Body = document.querySelector('#bt-sens-drop3-table tbody');
  if (d3Body) {
    if (d3) {
      d3Body.innerHTML = `<tr>
        <td class="dim">${d3.n_combinations}</td>
        <td class="num pos">${Number(d3.min_sharpe).toFixed(2)}</td>
        <td class="num pos">${Number(d3.median_sharpe).toFixed(2)}</td>
        <td class="num pos">${Number(d3.max_sharpe).toFixed(2)}</td>
      </tr>`;
    } else {
      d3Body.innerHTML = '<tr><td colspan="4" class="empty">No data.</td></tr>';
    }
  }

  const rc = sens.refit_cadence_offset;
  const rcBody = document.querySelector('#bt-sens-refit-table tbody');
  if (rcBody) {
    if (rc) {
      rcBody.innerHTML = `
        <tr><td>Jan-1 (baseline)</td><td class="num pos">${Number(rc.jan_anchored_sharpe).toFixed(3)}</td></tr>
        <tr><td>Jul-1 (offset)</td><td class="num pos">${Number(rc.jul_anchored_sharpe).toFixed(3)}</td></tr>
        <tr><td class="dim">&Delta;</td><td class="num dim">${rc.delta > 0 ? '+' : ''}${Number(rc.delta).toFixed(3)}</td></tr>
      `;
    } else {
      rcBody.innerHTML = '<tr><td colspan="2" class="empty">No data.</td></tr>';
    }
  }
}

// -- Robustness scorecard ----------------------------------------------
function renderRobustnessScorecard(rob) {
  const body = document.querySelector('#bt-robustness-table tbody');
  const metaEl = $('bt-scorecard-meta');
  if (!body) return;
  if (!rob) {
    body.innerHTML = '<tr><td colspan="4" class="empty">No data.</td></tr>';
    return;
  }
  const rows = [];
  (rob.code_audit || []).forEach(r => {
    rows.push({
      category: 'Code-level leak hunt',
      test: r.surface,
      result: r.verdict,
      evidence: r.note,
    });
  });
  (rob.statistical_tests || []).forEach(r => {
    let category = 'Statistical / robustness';
    const t = (r.test || '').toLowerCase();
    if (t.includes('universe') || t.includes('drop-') || t.includes('oos start')
        || t.includes('refit') || t.includes('feature shuffle')) {
      category = 'Robustness';
    } else if (t.includes('null') || t.includes('permutation') || t.includes('shuffle')
               || t.includes('cpcv') || t.includes('pbo') || t.includes('haircut')
               || t.includes('deflated') || t.includes('hansen') || t.includes('romano')
               || t.includes('cost stress') || t.includes('min backtest')) {
      category = 'Statistical null / multiple-testing';
    } else if (t.includes('macro') || t.includes('fred') || t.includes('yfinance')) {
      category = 'Data integrity';
    } else if (t.includes('cold')) {
      category = 'Code-level leak hunt';
    } else if (t.includes('regime') || t.includes('rolling') || t.includes('structural')
               || t.includes('drawdown')) {
      category = 'Stability';
    } else if (t.includes('information coefficient') || t.includes('pre-2018') || t.includes('aronson')) {
      category = 'Honest checks';
    }
    rows.push({
      category, test: r.test, result: r.verdict, evidence: r.result,
    });
  });

  if (rob.summary && metaEl) {
    const s = rob.summary;
    metaEl.textContent = `${s.total_tests} forensic tests · ${s.passed} pass · ${s.failed_or_caveat} caveat/fail`;
  }

  let lastCat = null;
  body.innerHTML = rows.map(r => {
    const showCat = r.category !== lastCat;
    lastCat = r.category;
    const catCell = showCat ? `<td class="scorecard-cat">${r.category}</td>` : '<td class="scorecard-cat-empty"></td>';
    const v = (r.result || '').toUpperCase();
    let pillCls = 'scorecard-pill-pass';
    let pillTxt = v;
    if (v.includes('FAIL')) {
      pillCls = 'scorecard-pill-fail';
    } else if (v.includes('CAVEAT') || v.includes('WARN') || v.includes('MINOR')
               || v.includes('IMMATERIAL')) {
      pillCls = 'scorecard-pill-caveat';
    } else if (v.includes('PASS') || v.includes('SAFE') || v.includes('ROBUST')
               || v.includes('GENERALISES') || v.includes('CLEAN') || v.includes('STRICT')
               || v.includes('AUTHENTIC')) {
      pillCls = 'scorecard-pill-pass';
    } else {
      pillCls = 'scorecard-pill-dim';
    }
    if (pillTxt.length > 36) pillTxt = pillTxt.slice(0, 34) + '…';
    return `<tr>
      ${catCell}
      <td>${r.test || ''}</td>
      <td><span class="tag ${pillCls}" title="${(r.result || '').replace(/"/g, '&quot;')}">${pillTxt}</span></td>
      <td class="dim scorecard-evidence">${r.evidence || ''}</td>
    </tr>`;
  }).join('');
}

// -- Monte Carlo renderer ---------------------------------------------
function renderMonteCarlo(mc) {
  const tbody = document.querySelector('#bt-mc-tbody');
  const meta  = $('bt-mc-meta');
  const tabsRoot = document.querySelector('.mc-tabs');
  if (!tbody) return;
  if (!mc || !mc.scenarios) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No Monte Carlo data.</td></tr>';
    return;
  }
  if (meta) {
    const n = (mc._meta && mc._meta.n_sims) ? mc._meta.n_sims.toLocaleString() : '10,000';
    meta.textContent = `${n} sims · block-bootstrap · CPPI overlay`;
  }

  const VIEWS = {
    scale5: {
      title: 'Suggested 5× sizing',
      rows: [
        { label: '1-Step $200k · 60d',           key: 'scale5_1step_60d' },
        { label: '1-Step $200k · 90d',           key: 'scale5_1step_90d' },
        { label: '2-Step P1 $50k · 60d',         key: 'scale5_2step_p1_60d' },
        { label: '2-Step chained (P1+P2)',       key: 'scale5_2step_chained' },
      ],
    },
    conservative: {
      title: 'Conservative 5× (Sharpe-2 forward)',
      rows: [
        { label: '1-Step $200k · 60d',           key: 'scale5_conservative_1step_60d' },
        { label: '1-Step $200k · 90d',           key: 'scale5_conservative_1step_90d' },
        { label: '2-Step P1 $50k · 60d',         key: 'scale5_conservative_2step_p1_60d' },
        { label: '2-Step chained (P1+P2)',       key: 'scale5_conservative_2step_chained' },
      ],
    },
    current: {
      title: 'Current 1× sizing (under-leveraged)',
      rows: [
        { label: '1-Step $200k · 60d',           key: 'current_1step_60d' },
        { label: '1-Step $200k · 252d (1yr)',    key: 'current_1step_252d' },
        { label: '2-Step P1 $50k · 60d',         key: 'current_2step_p1_60d' },
      ],
    },
  };

  function passClass(p) {
    if (p == null || isNaN(p)) return 'dim';
    if (p >= 0.60) return 'pos';
    if (p >= 0.25) return 'warn';
    return 'neg';
  }
  function pct(v, dp = 1) {
    if (v == null || isNaN(v)) return '—';
    return `${(Number(v) * 100).toFixed(dp)}%`;
  }

  function render(viewName) {
    const view = VIEWS[viewName] || VIEWS.scale5;
    const rows = view.rows.map(r => {
      const s = mc.scenarios[r.key];
      if (!s) {
        return `<tr><td>${r.label}</td><td class="num dim">—</td><td class="num dim">—</td><td class="num dim">—</td></tr>`;
      }
      const pr = (typeof s.pass_rate === 'number') ? s.pass_rate
               : (typeof s.overall_pass_rate === 'number') ? s.overall_pass_rate
               : null;
      const days = s.median_days_to_pass != null ? `${s.median_days_to_pass}` : '—';
      const mdl = s.mdl_pct != null ? pct(s.mdl_pct, 1) : '—';
      const prCls = passClass(pr);
      const mdlCls = (s.mdl_pct != null && s.mdl_pct >= 0.05) ? 'neg' : 'dim';
      return `<tr>
        <td>${r.label}</td>
        <td class="num ${prCls}">${pct(pr, 1)}</td>
        <td class="num dim">${days}</td>
        <td class="num ${mdlCls}">${mdl}</td>
      </tr>`;
    });
    tbody.innerHTML = rows.join('');
  }

  render('scale5');

  if (tabsRoot) {
    tabsRoot.querySelectorAll('.mc-tab').forEach(btn => {
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
    });
    tabsRoot.querySelectorAll('.mc-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        tabsRoot.querySelectorAll('.mc-tab').forEach(b => {
          const active = (b === btn);
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        render(btn.dataset.mctab);
      });
    });
  }
}

loadAll();
setInterval(loadAll, REFRESH_MS);
