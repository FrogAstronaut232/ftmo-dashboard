// G2 / G10 dashboard. Reads:
//   data/state.json            -- G2 (2-pair) LIVE state + reference summary
//   data/meta.json             -- G2 metadata
//   data/live/*.csv            -- G2 live forward-test stream
//   data/reference/*.csv       -- G2 frozen historical OOS reference
//   data/g10/state.json        -- G10 (10-pair) LIVE state
//   data/g10/meta.json         -- G10 metadata
//   data/g10/live/*.csv        -- G10 live forward-test stream
//   data/backtest_strict_oos/  -- G10 Strict-OOS reference backtest (folded into G10 tab)
// Static, no backend. Polls every 60s.

const DATA_BASE  = 'data';
const REFRESH_MS = 60_000;
// Account selector (internal storage keys):
//   'real100k' = REAL $100K FTMO account (G10 only; engine pushes to data/real100k/g10) — PRIMARY
//   'trial'    = $50K FTMO Free Trial (G10 only; data/trial/g10)
//   '50k'      = archived $50K generic-broker demo (G2 + G10, frozen)
// G10-only accounts = everything except '50k'. Default to the real $100K account.
const VALID_ACCOUNTS = ['real100k', 'trial', '50k'];
let currentAccount = (typeof localStorage !== 'undefined' && localStorage.getItem('account')) || 'real100k';
// Migrate retired keys ('200k' = old $200K FTMO-Demo) to the real account.
if (!VALID_ACCOUNTS.includes(currentAccount)) {
  currentAccount = 'real100k';
  try { localStorage.setItem('account', 'real100k'); } catch (e) {}
}
// Show only the banner matching the active account (ids: banner-<acc>).
function showAccountBanner(acc) {
  document.querySelectorAll('.account-banner').forEach(b => {
    b.hidden = (b.id !== `banner-${acc}`);
  });
}

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

// -- Header / live summary (driven by G2 state, since masthead is global) --
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
    if (currentAccount === '50k') {
      // Archived demo period: data is intentionally frozen at the migration
      // cutoff, so a "stale / desktop offline" warning is misleading here.
      cls = 'archived';
      label = `Archived · final state ${fmtUtc(d.toISOString()).slice(0, 10)}`;
    }
    else if (ageMin < 30)    { cls = 'fresh';  label = `Live data ${ageMin}m old`; }
    else if (ageMin < 180)   { cls = 'recent'; label = `Live data ${ageMin}m old`; }
    else if (ageMin < 1440)  { cls = 'stale';  label = `Stale: ${Math.round(ageMin/60)}h old (desktop may be asleep)`; }
    else                     { cls = 'frozen'; label = `Stale: ${Math.round(ageMin/1440)}d old (desktop offline?)`; }
    ageEl.textContent = label;
    ageEl.className   = `data-age ${cls}`;
  }

  // Brand subtitle is account-aware. The real $100K and the $50K free trial
  // run G10 only; the archived demo ran G2 + G10.
  $('meta-line').textContent =
      currentAccount === 'real100k' ? `Live  ·  G10 (10-pair)  ·  FTMO 2-step swing  ·  $100,000 REAL account`
    : currentAccount === 'trial'    ? `Live forward test  ·  G10 (10-pair)  ·  FTMO 2-step swing  ·  $50,000 FTMO Free Trial`
    :                                 `Archived demo  ·  G2 (2-pair) + G10 (10-pair)  ·  FTMO 2-step swing  ·  $50,000 generic-broker demo`;

  $('foot-meta').textContent =
    'Daily-close swing strategies. Strategy logic, model parameters, and per-trade '
  + 'reasoning are private and not exposed in this view.';
}

function renderLiveSummary(state, meta) {
  const initial  = state.account_initial_usd || meta.account_initial_usd || 50000;
  const equity   = state.equity ?? initial;
  const balance  = state.balance ?? initial;
  const floating = equity - balance;                  // pure current open MTM
  const totalPnl = equity - initial;
  const dd       = state.drawdown_pct ?? 0;
  const m        = state.metrics || {};

  setValue('m-equity', 'hero-value', fmtUsd(equity, false));
  setValue('m-total',  'hero-value', fmtUsd(totalPnl), pnlClass(totalPnl));
  setValue('m-today',  'hero-value', fmtUsd(floating), pnlClass(floating));
  setValue('m-dd',     'hero-value', fmtPct(dd),       dd > 5 ? 'warn' : '');

  // % of initial under each $ value
  const pctOfInitial = v => initial > 0 ? `${v >= 0 ? '+' : ''}${(v/initial*100).toFixed(2)}%` : '—';
  setValue('m-equity-pct', 'hero-pct', pctOfInitial(equity - initial), pnlClass(totalPnl));
  setValue('m-total-pct',  'hero-pct', pctOfInitial(totalPnl),         pnlClass(totalPnl));
  setValue('m-today-pct',  'hero-pct', pctOfInitial(floating),         pnlClass(floating));

  setValue('m-wr',      'sub-value', m.total_trades ? fmtPct(m.win_rate, 1) : '—');
  setValue('m-trades',  'sub-value', String(m.total_trades ?? 0));
  setValue('m-sharpe',  'sub-value', (m.total_trades && m.annualised_sharpe) ? fmtNum(m.annualised_sharpe) : '— (<21d)');
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
      // equity.csv dates are AEST (trade exit_date in user TZ), but
      // new Date().toISOString() returns UTC — which can be 1 day BEHIND
      // AEST during AEST-morning hours. If we naively append "todayUtc"
      // we end up plotting it BEFORE the latest CSV row → backward curve.
      // Strategy: only APPEND a new point if today's UTC date is strictly
      // greater than the last CSV date. Otherwise update the last row in place.
      const todayUtc = new Date().toISOString().slice(0, 10);
      const lastDate = x[x.length - 1];
      const lastBal  = y[y.length - 1];
      if (todayUtc > lastDate) {
        x.push(todayUtc);
        y.push(currentEquity);
      } else if (Math.abs(currentEquity - lastBal) > 0.005) {
        y[y.length - 1] = currentEquity;
      }
    }
  }
  const hasBh = equity && equity.length && equity.some(r => r.bh_sp500 != null && r.bh_sp500 !== '');

  // Per-asset buy & hold overlays. opts.benchmark = parsed benchmark.csv rows
  // ([{date, EURUSD, GBPJPY, ...}]). One faint dashed line per traded pair —
  // the account's starting capital invested in that single pair and held,
  // so you can see the strategy's edge over each underlying.
  const benchRows = (opts.benchmark && opts.benchmark.length) ? opts.benchmark : null;
  const benchTraces = [];
  if (benchRows) {
    const cols = Object.keys(benchRows[0]).filter(k => k !== 'date');
    const palette = ['#4a90d9', '#c69256', '#5cb87a', '#b05ad9', '#4ac6c6',
                     '#d0894a', '#c64a6e', '#8a9bd9', '#9ac64a', '#d04a52'];
    cols.forEach((c, i) => {
      benchTraces.push({
        x: benchRows.map(r => r.date),
        y: benchRows.map(r => Number(r[c])),
        type: 'scatter', mode: 'lines',
        name: `${c} B&H`,
        line: { color: palette[i % palette.length], width: 1, dash: 'dot' },
        opacity: 0.5,
        hovertemplate: '%{x}<br>$%{y:,.0f}<extra>' + c + ' B&H</extra>',
        showlegend: true,
      });
    });
  }

  const showLegend = hasBh || benchTraces.length > 0;
  const main = {
    x, y, type: 'scatter', mode: 'lines',
    name: opts.mainLabel || 'Strategy',
    line: { color: lineColor, width: benchTraces.length ? 2 : 1.4, shape: 'linear' },
    hovertemplate: '%{x}<br>$%{y:,.0f}<extra>' + (opts.mainLabel || 'Strategy') + '</extra>',
    showlegend: showLegend,
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
      line: { color: '#4a90d9', width: 1.4, shape: 'linear' },
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
    showlegend: showLegend,
    legend: showLegend ? {
      orientation: 'h', x: 0, y: 1.08,
      bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#9aa3ad', size: 10 },
    } : undefined,
  };
  // Optional explicit x-axis range (e.g. pin a single live day to the full
  // day instead of letting Plotly auto-zoom to a near-zero-width window).
  if (opts.xRange) layout.xaxis.range = opts.xRange;
  // Draw order: baseline, faint per-asset B&H, SP500 B&H (if any), strategy on top.
  const traces = [ref, ...benchTraces, ...(bhTrace ? [bhTrace] : []), main];
  Plotly.newPlot(div, traces, layout, { displayModeBar: false, responsive: true });
}

// -- Daily P&L calendar ------------------------------------------------
// Renders a month-grouped grid of cells, one per day, showing daily P&L in
// $ and % of initial. Days with zero P&L (no trades / weekend) shown muted.
// If `todayPnl` is provided (= state.today_pnl from heartbeat, includes
// realized today + total floating), it OVERRIDES today's cell so the
// calendar sum matches the hero "Total P&L" card.
function renderDailyCalendar(divId, equity, initial, todayPnl) {
  const div = $(divId);
  if (!div) return;
  // Index daily_pnl by ISO date string (empty equity -> empty index;
  // we still render the current month grid below so a fresh account
  // shows the calendar with zero-cells instead of "No data yet").
  const pnlByDate = {};
  (equity || []).forEach(r => {
    const d = String(r.date || '').slice(0, 10);
    if (d) pnlByDate[d] = Number(r.daily_pnl) || 0;
  });

  // Inject "today" cell with live P&L (realized + floating).
  // If today is a weekend (markets closed), attribute the floating to the
  // most recent weekday cell instead — otherwise the calendar appears to
  // show "weekend trades" when the algo only fires Mon-Fri.
  if (todayPnl != null && !isNaN(todayPnl)) {
    const sortedDates = Object.keys(pnlByDate).sort();
    const lastDate = sortedDates[sortedDates.length - 1];
    const todayUtc = new Date().toISOString().slice(0, 10);
    const todayObj = new Date(todayUtc + 'T00:00:00Z');
    const dow = todayObj.getUTCDay();       // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) {
      // Weekend: roll back to previous Friday, ADD floating to whatever's
      // already there (Friday's realized closes stay intact)
      const offset = (dow === 0) ? 2 : 1;
      todayObj.setUTCDate(todayObj.getUTCDate() - offset);
      const useDate = todayObj.toISOString().slice(0, 10);
      pnlByDate[useDate] = (pnlByDate[useDate] || 0) + Number(todayPnl);
    } else {
      // Weekday: replace today's cell (todayPnl already includes today's realized)
      const useDate = (lastDate && lastDate >= todayUtc) ? lastDate : todayUtc;
      pnlByDate[useDate] = Number(todayPnl);
    }
  }

  const dates = Object.keys(pnlByDate).sort();
  // Fresh account fallback: still render the current month so the calendar
  // appears immediately (with zero-cells), instead of "No data yet".
  let firstDate, lastDate;
  if (!dates.length) {
    const nowIso = new Date().toISOString().slice(0, 10);
    firstDate = new Date(nowIso + 'T00:00:00Z');
    lastDate  = new Date(nowIso + 'T00:00:00Z');
  } else {
    firstDate = new Date(dates[0] + 'T00:00:00Z');
    lastDate  = new Date(dates[dates.length - 1] + 'T00:00:00Z');
  }
  const months = [];
  const cursor = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), 1));
  const end    = new Date(Date.UTC(lastDate.getUTCFullYear(),  lastDate.getUTCMonth(),  1));
  while (cursor <= end) {
    months.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const monthName = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
  const dow = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const note = `<div class="calendar-note">FX markets closed Sat/Sun (hatched cells). The algorithm doesn't fire signals on weekends. Open positions carry through the weekend gap.</div>`;
  div.innerHTML = note + months.map(m => {
    const y = m.getUTCFullYear(), mo = m.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const firstDay   = new Date(Date.UTC(y, mo, 1)).getUTCDay(); // 0=Sun,1=Mon..6=Sat
    const leadEmpty  = (firstDay + 6) % 7; // Mon-first → Sun=6
    const cells = [];
    for (let i = 0; i < leadEmpty; i++) cells.push(`<div class="calendar-cell empty"></div>`);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayDate = new Date(Date.UTC(y, mo, d));
      const dow = dayDate.getUTCDay();             // 0=Sun, 6=Sat
      const isWeekend = (dow === 0 || dow === 6);
      const pnl = pnlByDate[iso];
      if (isWeekend && (pnl === undefined || pnl === 0)) {
        // FX market closed — algo doesn't fire signals Sat/Sun
        cells.push(`<div class="calendar-cell weekend" title="Markets closed (weekend)"><div class="calendar-date">${d}</div></div>`);
      } else if (pnl === undefined) {
        cells.push(`<div class="calendar-cell zero"><div class="calendar-date">${d}</div></div>`);
      } else {
        const cls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'zero';
        const pct = initial > 0 ? `${pnl >= 0 ? '+' : ''}${(pnl/initial*100).toFixed(2)}%` : '';
        cells.push(`<div class="calendar-cell ${cls}">
          <div class="calendar-date">${d}</div>
          <div class="calendar-pnl ${cls}">${fmtUsd(pnl)}</div>
          <div class="calendar-pct ${cls}">${pct}</div>
        </div>`);
      }
    }
    return `<div class="calendar-month">
      <div class="calendar-month-label">${monthName[mo]} ${y}</div>
      <div class="calendar-grid">
        ${dow.map(d => `<div class="calendar-dow">${d}</div>`).join('')}
        ${cells.join('')}
      </div>
    </div>`;
  }).join('');
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
    const conv = (parseFloat(s.conviction) || 0).toFixed(2);
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
    const conv = (parseFloat(s.conviction) || 0).toFixed(2);
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

// -- Reference section (G2) -----------------------------------
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
    sub.textContent = `Full G2 backtest, ${first} -> ${last}.  Static baseline; not live.`;
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
    setValue('g-equity-pct', 'hero-pct', '—');
    setValue('g-total-pct',  'hero-pct', '—');
    setValue('g-today-pct',  'hero-pct', '—');
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
      + '10-pair G10 FX swing portfolio on the same MT5 account as G2, '
      + 'distinct magic numbers (100010-100019).';
    }
  } else {
    const equity   = state.equity ?? initial;
    const balance  = state.balance ?? initial;
    const floating = equity - balance;                // pure current open MTM
    const totalPnl = equity - initial;
    const dd       = state.drawdown_pct ?? 0;

    setValue('g-equity', 'hero-value', fmtUsd(equity, false));
    setValue('g-total',  'hero-value', fmtUsd(totalPnl), pnlClass(totalPnl));
    setValue('g-today',  'hero-value', fmtUsd(floating), pnlClass(floating));
    setValue('g-dd',     'hero-value', fmtPct(dd),       dd > 5 ? 'warn' : '');

    const pctOfInitial = v => initial > 0 ? `${v >= 0 ? '+' : ''}${(v/initial*100).toFixed(2)}%` : '—';
    setValue('g-equity-pct', 'hero-pct', pctOfInitial(equity - initial), pnlClass(totalPnl));
    setValue('g-total-pct',  'hero-pct', pctOfInitial(totalPnl),         pnlClass(totalPnl));
    setValue('g-today-pct',  'hero-pct', pctOfInitial(floating),         pnlClass(floating));

    setValue('g-wr',      'sub-value', m.total_trades ? fmtPct(m.win_rate, 1) : '—');
    setValue('g-trades',  'sub-value', String(m.total_trades ?? 0));
    setValue('g-sharpe',  'sub-value', (m.total_trades && m.annualised_sharpe) ? fmtNum(m.annualised_sharpe) : '— (<21d)');
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
        pill.textContent = 'Awaiting first run';
        pill.className = 'status-pill status-pill--mute';
        sub.textContent = 'Will populate on the first scheduled daily run.';
      }
    }
  }
}

// -- Main loop ---------------------------------------------------------
async function loadAll() {
  try {
    // The G10-only accounts (real $100K and the $50K trial) have no G2 data —
    // fetch only the active account's G10 state; no G2 / reference / summary.
    // Only the archived $50K demo ('50k') had G2 + G10 running together.
    if (currentAccount !== '50k') {
      const gState = await fetchJson(`${currentAccount}/g10/state.json`).catch(() => ({}));
      const gMeta  = await fetchJson(`${currentAccount}/g10/meta.json`).catch(() => ({}));
      renderMasthead(gState, gMeta);   // masthead driven by G10 on this account
      await loadG10Live();
      return;
    }

    // --- Archived $50K demo: full G2 + reference + G10 + combined summary ---
    const ab = `${currentAccount}/g2`;
    const [state, meta, liveEq, liveTr, liveSig, liveBench, refEq, refTr, refSig] = await Promise.all([
      fetchJson(`${ab}/state.json`).catch(() => ({})),
      fetchJson(`${ab}/meta.json`).catch(() => ({})),
      fetchCsv(`${ab}/live/equity.csv`),
      fetchCsv(`${ab}/live/trades.csv`),
      fetchCsv(`${ab}/live/signals.csv`),
      fetchCsv(`${ab}/live/benchmark.csv`),
      fetchCsv('reference/equity.csv'),
      fetchCsv('reference/trades.csv'),
      fetchCsv('reference/signals.csv'),
    ]);
    const initial = state.account_initial_usd || meta.account_initial_usd || 50000;

    // Archived 50k account is frozen at the migration cutoff. Don't extend the
    // equity curve or calendar to "today" with the final equity — that would
    // draw a flat line / phantom cell from 2026-05-23 to the present.
    const isArchive = true;

    renderMasthead(state, meta);
    renderLiveSummary(state, meta);
    renderPositions('positions-table', state, 'No open positions.');
    renderEquity('live-equity-chart', liveEq, initial, '#cdd2d8', isArchive ? null : state.equity, { benchmark: liveBench });
    renderDailyCalendar('live-calendar', liveEq, initial, isArchive ? null : state.today_pnl);
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

    // Combined G2 + G10 summary for the archived account
    await renderSummary();
  } catch (e) {
    console.error('Dashboard load failed:', e);
  }
}

// -- Combined Summary tab (G2 + G10 totals for the active account) ----
async function renderSummary() {
  try {
    const [g2State, g10State] = await Promise.all([
      fetchJson(`${currentAccount}/g2/state.json`).catch(() => ({})),
      fetchJson(`${currentAccount}/g10/state.json`).catch(() => ({})),
    ]);
    const g2m  = (g2State.metrics  || {});
    const g10m = (g10State.metrics || {});

    // Both accounts are $50K. The Summary tab is only shown for the archived
    // demo (where G2 + G10 ran together); the live FTMO Free Trial is G10-only
    // and hides this tab. Combined return = sum of each strategy's USD P&L.
    const isArchive = currentAccount === '50k';
    const startCap  = 50000;

    const g2Pnl  = Number(g2m.total_pnl_usd  || 0);
    const g10Pnl = Number(g10m.total_pnl_usd || 0);
    const totalPnl = g2Pnl + g10Pnl;
    const finalEq  = startCap + totalPnl;
    const maxDd    = Math.max(
      Number(g2m.max_drawdown_pct  || 0),
      Number(g10m.max_drawdown_pct || 0),
    );

    const accountTag = $('summary-account-tag');
    if (accountTag) accountTag.textContent = isArchive ? '$50K (archived demo)' : '$50K FTMO Free Trial (live)';
    const statusPill = $('summary-status');
    if (statusPill) {
      statusPill.textContent = isArchive ? 'Archived' : 'Live';
      statusPill.className = isArchive ? 'status-pill status-pill--mute' : 'status-pill';
    }

    const sumSub = $('summary-sub');
    if (sumSub) {
      sumSub.textContent = isArchive
        ? 'G2 and G10 ran simultaneously on one shared $50K generic-broker demo account (2026-05-13 to 2026-05-23). Numbers below sum their realized P&L on the shared $50K base.'
        : 'The live $50K FTMO Free Trial runs G10 only. See the G10 tab for live detail.';
    }

    setValue('sum-start',     'hero-value', fmtUsd(startCap));
    setValue('sum-period',    'hero-pct',   isArchive ? '2026-05-13 -> 2026-05-23' : '2026-05-24 -> live');
    setValue('sum-pnl',       'hero-value', fmtUsd(totalPnl), pnlClass(totalPnl));
    setValue('sum-pnl-pct',   'hero-pct',   startCap > 0 ? `${totalPnl >= 0 ? '+' : ''}${(totalPnl/startCap*100).toFixed(2)}%` : '—', pnlClass(totalPnl));
    setValue('sum-final',     'hero-value', fmtUsd(finalEq));
    setValue('sum-final-pct', 'hero-pct',   startCap > 0 ? `${(finalEq/startCap*100).toFixed(2)}% of start` : '—');
    setValue('sum-dd',        'hero-value', maxDd ? `-${maxDd.toFixed(2)}%` : '0.00%', maxDd ? 'neg' : '');

    setValue('sum-g2-trades',  'sub-value', String(g2m.total_trades  || 0));
    setValue('sum-g2-wr',      'sub-value', g2m.total_trades  ? fmtPct(g2m.win_rate, 1)  : '—');
    setValue('sum-g2-pnl',     'sub-value', fmtUsd(g2Pnl),  pnlClass(g2Pnl));
    setValue('sum-g10-trades', 'sub-value', String(g10m.total_trades || 0));
    setValue('sum-g10-wr',     'sub-value', g10m.total_trades ? fmtPct(g10m.win_rate, 1) : '—');
    setValue('sum-g10-pnl',    'sub-value', fmtUsd(g10Pnl), pnlClass(g10Pnl));

    const prose = $('summary-prose');
    if (prose) {
      if (isArchive) {
        prose.innerHTML = `
          <p>Both strategies ran simultaneously on one shared $50K generic-broker demo account for roughly two weeks (2026-05-13 to 2026-05-23). The goal was to verify the live execution stack end-to-end: yfinance data pull, frozen-model inference, vol-targeted sizing, MT5 order placement, hedging, magic-number filtering, JSONL logging, dashboard push.</p>
          <p><strong>Result: G2 contributed +5.55% (+$2,776.60) and G10 contributed +4.00% (+$1,998.18), for a combined +9.55% (+$4,774.78) on the shared $50K base.</strong> The execution stack ran cleanly throughout. We are finished here.</p>
          <p>We have since moved on to the live <strong>$50K FTMO Free Trial</strong> account, running <strong>G10 only</strong>. See the FTMO Free Trial view (top toggle) for live state.</p>
          <p class="muted">Snapshot above is the final state from the last 50K heartbeat before the migration cutoff.</p>
        `;
      } else {
        prose.innerHTML = `
          <p>The live $50K FTMO Free Trial runs the <strong>G10 10-pair strategy only</strong>. See the G10 tab for live detail.</p>
        `;
      }
    }
  } catch (e) {
    console.error('renderSummary failed:', e);
  }
}

// -- G10 LIVE loader ---------------------------------------------------
async function loadG10Live() {
  try {
    // G10 data — account-scoped (50k archive / trial live)
    const ab = `${currentAccount}/g10`;
    const [gState, gMeta, gEq, gTr, gSig, gBench] = await Promise.all([
      fetchJson(`${ab}/state.json`).catch(() => ({ awaiting_first_run: true })),
      fetchJson(`${ab}/meta.json`).catch(() => ({})),
      fetchCsv(`${ab}/live/equity.csv`),
      fetchCsv(`${ab}/live/trades.csv`),
      fetchCsv(`${ab}/live/signals.csv`),
      fetchCsv(`${ab}/live/benchmark.csv`),
    ]);
    const initial = gState.account_initial_usd || gMeta.account_initial_usd || 50000;
    const awaiting = !!gState.awaiting_first_run;

    renderG10LiveSummary(gState, gMeta);
    renderPositions('g-positions-table', gState,
      awaiting
        ? 'Awaiting first run — fires daily at 08:05 AEST (= 22:05 UTC).'
        : 'No open positions.');

    // Archived 50k account is frozen — same rule as G2: don't extend to "today".
    const isArchive = currentAccount === '50k';

    // Build the equity series to plot. When live/equity.csv has no rows yet
    // (e.g. day 1, no closed trades), synthesise a series anchored to the real
    // live start date so the x-axis begins on the first live day — NOT 30 days
    // back, which is what renderEquity's generic empty-data fallback would draw.
    let gEqEff = gEq;        // series for the equity chart
    let gEqCal = gEq;        // series for the daily calendar (date-only)
    let eqXRange = null;     // explicit x-axis range (single-day case only)
    if (!gEq.length && !awaiting && gState.live_first_date) {
      const lfd      = gState.live_first_date;
      const todayUtc = new Date().toISOString().slice(0, 10);
      const cur = (gState.equity != null && !isNaN(gState.equity)) ? gState.equity : initial;
      if (todayUtc > lfd) {
        // Multiple live days: a simple daily two-point line (distinct dates).
        gEqEff = [{ date: lfd,      balance: initial, equity: initial },
                  { date: todayUtc, balance: cur, equity: cur, daily_pnl: gState.today_pnl }];
        gEqCal = gEqEff;
      } else {
        // Day 1: start and "now" share the same calendar date. Plot two
        // INTRADAY points (00:00 at the $50k open -> now at current equity) so
        // a line actually renders, and pin the x-axis to the whole day so the
        // axis isn't auto-zoomed to a ~1ms sliver around midnight.
        const aestNow = new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(11, 19);
        gEqEff = [{ date: `${lfd}T00:00:00`,     balance: initial, equity: initial },
                  { date: `${lfd}T${aestNow}`,   balance: cur,     equity: cur }];
        eqXRange = [`${lfd}T00:00:00`, `${lfd}T23:59:59`];
        gEqCal = [{ date: lfd, balance: cur, equity: cur, daily_pnl: gState.today_pnl }];
      }
    }

    if (gEqEff.length || !awaiting) {
      // currentEquity is already baked into the synthesised series, so only
      // pass it when we're extending a real equity.csv (gEq.length > 0).
      renderEquity('g-equity-chart', gEqEff, initial, '#cdd2d8',
                   (awaiting || isArchive) ? null : (gEq.length ? gState.equity : null),
                   { benchmark: gBench, xRange: eqXRange });
      renderDailyCalendar('g-calendar', gEqCal, initial, isArchive ? null : gState.today_pnl);
      if (gEqEff.length) {
        const d0 = String(gEqEff[0].date).slice(0, 10);
        const d1 = String(gEqEff[gEqEff.length - 1].date).slice(0, 10);
        $('g-equity-range').textContent = `${d0} -> ${d1}`;
      } else {
        $('g-equity-range').textContent = '— (no data yet)';
      }
    } else {
      // Awaiting-first-run: draw flat $50k baseline so the chart isn't empty
      renderEquity('g-equity-chart', [], initial, '#3a4452', null);
      renderDailyCalendar('g-calendar', [], initial);
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
// Two top-level tabs: G2 (2-pair live) and G10 (10-pair live +
// Strict-OOS reference backtest).
// G10's backtest section is fetched lazily on first tab activation.
let backtestLoaded = false;

function activateTab(name) {
  const tabs = ['g2', 'g10', 'summary'];
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
    if (name === 'g2') {
      const live = $('live-equity-chart'); if (live && live._fullLayout) Plotly.Plots.resize(live);
      const ref  = $('ref-equity-chart');  if (ref  && ref._fullLayout)  Plotly.Plots.resize(ref);
    } else if (name === 'g10') {
      const gl = $('g-equity-chart');      if (gl && gl._fullLayout) Plotly.Plots.resize(gl);
      const eq = $('bt-equity-chart');     if (eq && eq._fullLayout) Plotly.Plots.resize(eq);
      const yr = $('bt-yearbar-chart');    if (yr && yr._fullLayout) Plotly.Plots.resize(yr);
    }
  }, 30);
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// The live accounts (real $100K and the $50K trial) run G10 only — hide the G2
// and Summary sub-tabs there and force G10 active. Only the archived demo
// ('50k') ran both strategies, so it shows all three sub-tabs.
function applyAccountChrome(acc) {
  const g10Only = (acc !== '50k');
  const g2btn  = $('tab-btn-g2');
  const sumbtn = $('tab-btn-summary');
  // Hide via BOTH the hidden attribute and inline display. .tab-btn sets
  // display:inline-flex in CSS, which overrides the [hidden] attribute — so
  // setting .hidden alone leaves the button visible. Inline style always wins.
  if (g2btn)  { g2btn.hidden  = g10Only; g2btn.style.display  = g10Only ? 'none' : ''; }
  if (sumbtn) { sumbtn.hidden = g10Only; sumbtn.style.display = g10Only ? 'none' : ''; }
  if (g10Only) {
    activateTab('g10');
  }
}

// Account toggle — reroutes data fetches and reloads.
function activateAccount(acc) {
  if (!VALID_ACCOUNTS.includes(acc)) return;
  currentAccount = acc;
  try { localStorage.setItem('account', acc); } catch (e) {}
  document.querySelectorAll('.account-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.account === acc);
  });
  showAccountBanner(acc);
  applyAccountChrome(acc);
  // Re-fetch everything for the new account
  loadAll().catch(e => console.error('loadAll on account switch:', e));
}
document.querySelectorAll('.account-btn').forEach(btn => {
  btn.addEventListener('click', () => activateAccount(btn.dataset.account));
});
// Initial UI state for the persisted/default account selection
document.querySelectorAll('.account-btn').forEach(b => {
  b.classList.toggle('is-active', b.dataset.account === currentAccount);
});
showAccountBanner(currentAccount);
// Initial sub-tab visibility (hide G2 + Summary on the G10-only live accounts)
applyAccountChrome(currentAccount);

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

  const [summary, portfolio, perPair, perYear, subPeriod, regime] = await Promise.all([
    fetchBt('summary.json'),
    fetchBt('portfolio.csv'),
    fetchBt('per_pair.csv'),
    fetchBt('per_year.csv'),
    fetchBt('sub_period.csv'),
    fetchBt('regime_conditional.csv'),
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
      line: { color: '#4a90d9', width: 1.4, shape: 'linear' },
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
  const regimeLabels = { low_vol: 'Low Vol', mid_vol: 'Mid Vol', high_vol: 'High Vol' };
  const regimeBody = document.querySelector('#bt-regime-table tbody');
  if (regimeBody && regime.length) {
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
  } else if (regimeBody) {
    regimeBody.innerHTML = '<tr><td colspan="4" class="empty">No data.</td></tr>';
  }

  // Sub-period table
  const subBody = document.querySelector('#bt-subperiod-table tbody');
  if (subBody && subPeriod.length) {
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
  } else if (subBody) {
    subBody.innerHTML = '<tr><td colspan="4" class="empty">No data.</td></tr>';
  }
}

loadAll();
setInterval(loadAll, REFRESH_MS);
