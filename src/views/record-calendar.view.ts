import * as vscode from 'vscode';
import * as path from 'path';
import { JsonStore } from '../data/json-store';
import { parseTimeToMinutes, minutesToHHMM } from '../data/time-utils';
import type { ArbeitsplatzSettings } from '../config';
import type { RecordDb } from '../models/record.model';

const store = new JsonStore();

/**
 * WebviewViewProvider that renders a colourful monthly calendar for time records.
 *
 * Layout (two-column):
 *   Left  — Monthly calendar grid, colour-coded by hours worked per day.
 *            Month navigation arrows. Double-click a day → add-entry dialog.
 *   Right — Detail panel: selected month summary (total + avg), then per-day
 *            entries (time + notes) for the clicked day.
 */
export class RecordCalendarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'arbeitsplatz.records';

    /** Currently displayed year/month so refresh() can re-send data. */
    private _currentYear: number;
    private _currentMonth: number;
    private _view?: vscode.WebviewView;

    constructor(private readonly settings: ArbeitsplatzSettings) {
        const now = new Date();
        this._currentYear  = now.getFullYear();
        this._currentMonth = now.getMonth() + 1;
    }

    // ── WebviewViewProvider ────────────────────────────────────────────────────

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html  = this._buildHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(msg => this._handleMessage(msg));
    }

    /** Called from extension when file-watcher detects a change. */
    refresh(): void {
        if (this._view?.visible) {
            void this._sendMonthData(this._currentYear, this._currentMonth);
        }
    }

    // ── Message handling ───────────────────────────────────────────────────────

    private async _handleMessage(msg: { type: string; year?: number; month?: number; dateStr?: string }): Promise<void> {
        switch (msg.type) {
            case 'loadMonth':
                if (msg.year !== undefined && msg.month !== undefined) {
                    this._currentYear  = msg.year;
                    this._currentMonth = msg.month;
                    await this._sendMonthData(msg.year, msg.month);
                }
                break;

            case 'openAddDialog':
                if (msg.dateStr) {
                    await this._openAddDialog(msg.dateStr);
                }
                break;
        }
    }

    private async _sendMonthData(year: number, month: number): Promise<void> {
        if (!this._view) { return; }

        const filePath = path.join(
            this.settings.recordsDir,
            String(year),
            `${String(month).padStart(2, '0')}.json`,
        );
        const data = await store.read<RecordDb>(filePath, { year, month, days: {} });

        this._view.webview.postMessage({ type: 'updateData', year, month, data });
    }

    private async _openAddDialog(dateStr: string): Promise<void> {
        const timeStr = await vscode.window.showInputBox({
            prompt: `Time spent on ${dateStr} — e.g. 1:30, 1.5h, 90m`,
            placeHolder: '1:30',
        });
        if (!timeStr) { return; }

        let minutes: number;
        try {
            minutes = parseTimeToMinutes(timeStr);
        } catch {
            void vscode.window.showErrorMessage('Invalid time format — use e.g. 1:30, 1.5h, 90');
            return;
        }

        const notes = await vscode.window.showInputBox({
            prompt: 'Notes',
            placeHolder: 'What did you work on?',
        });
        if (notes === undefined) { return; } // cancelled; allow empty string

        const [yearStr, monthStr] = dateStr.split('-');
        const year  = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        const filePath = path.join(
            this.settings.recordsDir,
            String(year),
            `${String(month).padStart(2, '0')}.json`,
        );
        const data = await store.read<RecordDb>(filePath, { year, month, days: {} });
        if (!data.days[dateStr]) { data.days[dateStr] = []; }
        data.days[dateStr].push({ time_spent_min: minutes, notes: notes ?? '' });
        await store.write(filePath, data);

        await this._sendMonthData(year, month);
        void vscode.window.showInformationMessage(`Logged ${minutesToHHMM(minutes)} on ${dateStr}`);
    }

    // ── HTML / CSS / JS ────────────────────────────────────────────────────────

    private _buildHtml(webview: vscode.Webview): string {
        // CSP nonce for inline scripts
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src 'nonce-${nonce}';
               style-src 'unsafe-inline';">
<style>
  /* ── Reset / base ─────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family : var(--vscode-font-family);
    font-size   : var(--vscode-font-size, 13px);
    color       : var(--vscode-foreground);
    background  : var(--vscode-panel-background, var(--vscode-editor-background));
    padding     : 10px 12px;
    height      : 100vh;
    overflow    : hidden;
    display     : flex;
    flex-direction : column;
  }

  /* ── Two-column layout ─────────────────────────────────── */
  /*
   * The layout is a flex row so both columns share 100% of the remaining
   * body height.  min-height: 0 on all flex children is critical: without it
   * flex items refuse to shrink below their intrinsic content height and the
   * calendar rows overflow when the panel is wide.
   */
  .layout {
    display   : flex;
    flex      : 1;
    gap       : 0;
    min-height: 0;
  }

  .cal-col {
    flex           : 1;
    min-width      : 0;
    min-height     : 0;
    display        : flex;
    flex-direction : column;
    padding-right  : 14px;
    overflow       : hidden;
  }

  /* Vertical divider ── a 1 px hairline between the two columns */
  .col-divider {
    width         : 1px;
    align-self    : stretch;
    background    : var(--vscode-panel-border, rgba(128,128,128,.3));
    flex-shrink   : 0;
    margin        : 2px 0;
  }

  .detail-col {
    width          : 220px;
    flex-shrink    : 0;
    min-height     : 0;
    display        : flex;
    flex-direction : column;
    padding-left   : 14px;
    overflow       : hidden;
  }

  /* ── Month navigation bar ──────────────────────────────── */
  .month-nav {
    display          : flex;
    align-items      : center;
    background       : var(--vscode-toolbar-activeBackground,
                          var(--vscode-editor-inactiveSelectionBackground,
                          rgba(128,128,128,.12)));
    border-radius    : 6px;
    padding          : 3px 6px;
    margin-bottom    : 8px;
    border           : 1px solid var(--vscode-widget-border, rgba(128,128,128,.2));
  }

  .nav-btn {
    background    : transparent;
    color         : var(--vscode-foreground);
    border        : none;
    border-radius : 4px;
    width         : 22px;
    height        : 22px;
    font-size     : 16px;
    line-height   : 1;
    cursor        : pointer;
    display       : flex;
    align-items   : center;
    justify-content : center;
    transition    : background 0.12s;
  }
  .nav-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.25)); }

  .month-label {
    flex           : 1;
    text-align     : center;
    font-size      : 12px;
    font-weight    : 700;
    letter-spacing : 0.06em;
    color          : var(--vscode-foreground);
    text-transform : uppercase;
  }

  /* ── Calendar grid ─────────────────────────────────────── */
  /*
   * grid-template-rows:
   *   auto    — first 7 cells = day-of-week headers (natural height)
   *   repeat(6, 1fr) — up to 6 week rows share the remaining space equally
   *
   * This prevents height growth when the panel is stretched horizontally
   * because rows are height-controlled by the grid, not by cell content.
   */
  .calendar {
    display               : grid;
    grid-template-columns : repeat(7, 1fr);
    grid-template-rows    : auto repeat(6, 1fr);
    gap                   : 3px;
    flex                  : 1;
    min-height            : 0;
  }

  .day-hdr {
    text-align    : center;
    font-size     : 10px;
    font-weight   : 700;
    color         : var(--vscode-descriptionForeground);
    letter-spacing: 0.07em;
    background    : var(--vscode-editor-inactiveSelectionBackground,
                      rgba(128,128,128,.1));
    border-radius : 3px;
    padding       : 3px 0;
    /* sits in the auto row – no other sizing needed */
  }

  .day {
    /* No aspect-ratio — height is dictated by the grid row (1fr). */
    border-radius   : 5px;
    display         : flex;
    flex-direction  : column;
    align-items     : center;
    justify-content : center;
    cursor          : pointer;
    border          : 1px solid var(--vscode-widget-border, rgba(128,128,128,.18));
    transition      : transform 0.1s, border-color 0.1s, box-shadow 0.1s;
    user-select     : none;
    overflow        : hidden;
    min-height      : 0;
  }
  .day:hover {
    transform    : scale(1.06);
    border-color : var(--vscode-focusBorder) !important;
    box-shadow   : 0 2px 6px rgba(0,0,0,.25);
    z-index      : 1;
    position     : relative;
  }
  .day.empty { visibility: hidden; pointer-events: none; }

  /* ── Intensity levels — theme-adaptive colour ramp ──────
   *  l0  no work   → very subtle tinted background
   *  l1  ≤ 2 h     → 22 % green mix
   *  l2  ≤ 5 h     → 50 % green mix
   *  l3  ≤ 8 h     → 78 % green mix, white text
   *  l4  > 8 h     → full green, bold text
   * color-mix() resolves against the current VS Code theme variables
   * so the gradient looks good in both dark and light themes.           */
  .day.l0 {
    background : var(--vscode-input-background,
                   color-mix(in srgb, var(--vscode-foreground, #ccc) 5%,
                             var(--vscode-editor-background)));
  }
  .day.l1 {
    background : color-mix(in srgb,
                   var(--vscode-charts-green, #4ec9b0) 22%,
                   var(--vscode-editor-background));
  }
  .day.l2 {
    background : color-mix(in srgb,
                   var(--vscode-charts-green, #4ec9b0) 50%,
                   var(--vscode-editor-background));
  }
  .day.l3 {
    background : color-mix(in srgb,
                   var(--vscode-charts-green, #4ec9b0) 78%,
                   var(--vscode-editor-background));
    color      : var(--vscode-button-foreground, #fff);
  }
  .day.l4 {
    background  : var(--vscode-charts-green, #4ec9b0);
    color       : var(--vscode-button-foreground, #fff);
    font-weight : 700;
    border-color: color-mix(in srgb, var(--vscode-charts-green, #4ec9b0) 70%, #000) !important;
  }

  /* Today — blue outline ring */
  .day.today {
    border-color : var(--vscode-charts-blue, #75beff) !important;
    border-width : 2px !important;
  }

  /* Selected — primary-colour ring + subtle glow */
  .day.selected {
    border-color : var(--vscode-button-background, #0e639c) !important;
    border-width : 2px !important;
    box-shadow   : 0 0 0 1px var(--vscode-button-background, #0e639c);
  }

  .day-num   { font-size: 11px; font-weight: 500; line-height: 1; }
  .day-hours { font-size: 9px;  opacity: 0.85;   line-height: 1; margin-top: 2px; }

  /* ── Detail column ─────────────────────────────────────── */
  .detail-header {
    background    : var(--vscode-editor-inactiveSelectionBackground,
                      rgba(128,128,128,.1));
    border        : 1px solid var(--vscode-widget-border, rgba(128,128,128,.2));
    border-radius : 6px;
    padding       : 8px 10px;
    margin-bottom : 10px;
  }

  .detail-month {
    font-size   : 13px;
    font-weight : 700;
    color       : var(--vscode-foreground);
  }

  .detail-stats {
    font-size   : 11px;
    color       : var(--vscode-descriptionForeground);
    margin-top  : 4px;
    line-height : 1.6;
  }

  .detail-day-label {
    display       : inline-block;
    font-size     : 11px;
    font-weight   : 700;
    color         : var(--vscode-button-foreground, #fff);
    background    : var(--vscode-charts-blue, #75beff);
    border-radius : 4px;
    padding       : 2px 8px;
    margin-bottom : 8px;
    letter-spacing: 0.04em;
  }
  /* hide the label when empty */
  .detail-day-label:empty { display: none; }

  .entries {
    display        : flex;
    flex-direction : column;
    gap            : 5px;
    overflow-y     : auto;
    flex           : 1;
    min-height     : 0;
  }

  .entry {
    background    : var(--vscode-editor-inactiveSelectionBackground,
                      rgba(128,128,128,.08));
    border-radius : 5px;
    padding       : 6px 9px;
    border-left   : 3px solid var(--vscode-charts-blue, #75beff);
    border-top    : 1px solid var(--vscode-widget-border, rgba(128,128,128,.15));
    border-right  : 1px solid var(--vscode-widget-border, rgba(128,128,128,.15));
    border-bottom : 1px solid var(--vscode-widget-border, rgba(128,128,128,.15));
  }

  .entry-time  {
    font-size  : 11px;
    font-weight: 700;
    color      : var(--vscode-charts-blue, #75beff);
  }
  .entry-notes {
    font-size   : 11px;
    margin-top  : 3px;
    word-break  : break-word;
    color       : var(--vscode-foreground);
    opacity     : 0.9;
  }

  .hint {
    font-size  : 11px;
    color      : var(--vscode-descriptionForeground);
    font-style : italic;
    padding    : 4px 2px;
  }
</style>
</head>
<body>
<div class="layout">

  <!-- ── Calendar column ────────────────────────────── -->
  <div class="cal-col">
    <div class="month-nav">
      <button class="nav-btn" id="prev">&#8249;</button>
      <div class="month-label" id="month-label"></div>
      <button class="nav-btn" id="next">&#8250;</button>
    </div>
    <div class="calendar" id="calendar"></div>
  </div>

  <!-- ── Vertical divider ───────────────────────────── -->
  <div class="col-divider"></div>

  <!-- ── Detail column ──────────────────────────────── -->
  <div class="detail-col">
    <div class="detail-header">
      <div class="detail-month"  id="detail-month"></div>
      <div class="detail-stats"  id="detail-stats"></div>
    </div>
    <div class="detail-day-label" id="detail-day-label"></div>
    <div class="entries" id="entries">
      <div class="hint">Select a day to view entries.</div>
    </div>
  </div>

</div>
<script nonce="${nonce}">
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  const DAY_ABBR = ['Mo','Tu','We','Th','Fr','Sa','Su'];

  let year      = new Date().getFullYear();
  let month     = new Date().getMonth() + 1;
  let monthData = null;   // RecordDb | null
  let selected  = null;   // 'YYYY-MM-DD' | null

  // ── Helpers ────────────────────────────────────────────
  function fmt(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h + ':' + String(m).padStart(2, '0');
  }
  function escape(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')
           + '-' + String(d.getDate()).padStart(2,'0');
  }
  function level(min) {
    if (min === 0)    return 0;
    if (min <= 120)   return 1;   // ≤ 2 h
    if (min <= 300)   return 2;   // ≤ 5 h
    if (min <= 480)   return 3;   // ≤ 8 h
    return 4;
  }
  function dayTotalMin(dateStr) {
    const entries = monthData?.days?.[dateStr] ?? [];
    return entries.reduce((s, e) => s + e.time_spent_min, 0);
  }

  // ── Rendering ──────────────────────────────────────────
  function render() {
    renderCalendar();
    renderDetail();
  }

  function renderCalendar() {
    document.getElementById('month-label').textContent =
      MONTH_NAMES[month - 1] + ' ' + year;

    const cal  = document.getElementById('calendar');
    cal.innerHTML = '';

    // Day-of-week headers (Monday first)
    DAY_ABBR.forEach(d => {
      const h = document.createElement('div');
      h.className   = 'day-hdr';
      h.textContent = d;
      cal.appendChild(h);
    });

    // Offset: which column does day-1 fall on? (0 = Mon … 6 = Sun)
    const firstDow    = new Date(year, month - 1, 1).getDay();  // 0=Sun
    const startOffset = (firstDow + 6) % 7;                     // convert to Mon-first
    const daysInMonth = new Date(year, month, 0).getDate();
    const today       = todayISO();

    // Leading empty cells
    for (let i = 0; i < startOffset; i++) {
      const e = document.createElement('div');
      e.className = 'day empty';
      cal.appendChild(e);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      const min = dayTotalMin(iso);

      const cell = document.createElement('div');
      cell.className = 'day l' + level(min);
      if (iso === today)    cell.classList.add('today');
      if (iso === selected) cell.classList.add('selected');
      cell.setAttribute('title', 'Double-click to log time on ' + iso);

      const numEl = document.createElement('div');
      numEl.className   = 'day-num';
      numEl.textContent = String(d);
      cell.appendChild(numEl);

      if (min > 0) {
        const hEl = document.createElement('div');
        hEl.className   = 'day-hours';
        hEl.textContent = fmt(min);
        cell.appendChild(hEl);
      }

      cell.addEventListener('click', () => {
        selected = iso;
        // Update selected class without full re-render for snappiness
        document.querySelectorAll('.day.selected').forEach(el => el.classList.remove('selected'));
        cell.classList.add('selected');
        renderDetail();
      });
      cell.addEventListener('dblclick', () => {
        vscode.postMessage({ type: 'openAddDialog', dateStr: iso });
      });

      cal.appendChild(cell);
    }
  }

  function renderDetail() {
    document.getElementById('detail-month').textContent =
      MONTH_NAMES[month - 1] + ' ' + year;

    // Monthly totals
    let totalMin  = 0;
    let workedDays = 0;
    if (monthData?.days) {
      for (const entries of Object.values(monthData.days)) {
        const d = entries.reduce((s, e) => s + e.time_spent_min, 0);
        if (d > 0) { totalMin += d; workedDays++; }
      }
    }
    const avg = workedDays > 0 ? Math.round(totalMin / workedDays) : 0;
    document.getElementById('detail-stats').innerHTML =
      'Total: <strong>' + fmt(totalMin) + '</strong> &nbsp;·&nbsp; '
      + 'Avg: <strong>' + fmt(avg) + '</strong> / day';

    // Day entries
    const dayLabel  = document.getElementById('detail-day-label');
    const entriesEl = document.getElementById('entries');

    if (!selected) {
      dayLabel.textContent  = '';
      entriesEl.innerHTML   = '<div class="hint">Select a day to view entries.</div>';
      return;
    }

    const [y, mm, d] = selected.split('-');
    dayLabel.textContent = d + ' ' + MONTH_NAMES[parseInt(mm, 10) - 1] + ' ' + y;

    const entries = monthData?.days?.[selected] ?? [];
    entriesEl.innerHTML = '';

    if (entries.length === 0) {
      entriesEl.innerHTML = '<div class="hint">No entries — double-click the calendar cell to add one.</div>';
      return;
    }

    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'entry';
      item.innerHTML =
        '<div class="entry-time">' + escape(fmt(entry.time_spent_min)) + '</div>' +
        '<div class="entry-notes">' + escape(entry.notes) + '</div>';
      entriesEl.appendChild(item);
    });
  }

  // ── Navigation buttons ─────────────────────────────────
  document.getElementById('prev').addEventListener('click', () => {
    month--;
    if (month < 1) { month = 12; year--; }
    selected = null;
    requestMonth();
  });
  document.getElementById('next').addEventListener('click', () => {
    month++;
    if (month > 12) { month = 1; year++; }
    selected = null;
    requestMonth();
  });

  function requestMonth() {
    vscode.postMessage({ type: 'loadMonth', year, month });
  }

  // ── vs Code → Webview messages ─────────────────────────
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'updateData') {
      year      = msg.year;
      month     = msg.month;
      monthData = msg.data;
      render();
    }
  });

  // ── Boot ───────────────────────────────────────────────
  requestMonth();
}());
</script>
</body>
</html>`;
    }
}

/** Cryptographically random nonce for Content-Security-Policy. */
function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars[Math.floor(Math.random() * chars.length)];
    }
    return nonce;
}
