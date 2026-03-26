import * as vscode from 'vscode';
import * as path from 'path';
import { JsonStore } from '../data/json-store';
import { parseTimeToMinutes, todayStr, minutesToHHMM } from '../data/time-utils';
import type { TulcaseSettings } from '../config';
import type { RecordDb, RecordEntry } from '../models/record.model';
import type { RecordCalendarViewProvider } from '../views/record-calendar.view';

const store = new JsonStore();

/**
 * Register all record-related VS Code commands.
 *
 * @param recordCalendar – the webview view provider; calling its refresh()
 *   after a write keeps the calendar in sync.
 */
export function registerRecordCommands(
    context: vscode.ExtensionContext,
    settings: TulcaseSettings,
    recordCalendar: RecordCalendarViewProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'tulcase.record.add',
            () => addRecord(settings, recordCalendar),
        ),
    );
}

/**
 * Quick-add dialog for logging time without opening the calendar.
 * The calendar view refreshes automatically after the write.
 */
async function addRecord(
    settings: TulcaseSettings,
    recordCalendar: RecordCalendarViewProvider,
): Promise<void> {
    const dateStr = await vscode.window.showInputBox({
        prompt: 'Date (YYYY-MM-DD)',
        value: todayStr(),
        validateInput: val => /^\d{4}-\d{2}-\d{2}$/.test(val) ? null : 'Use YYYY-MM-DD format',
    });
    if (!dateStr) { return; }

    const timeStr = await vscode.window.showInputBox({
        prompt: 'Time spent (e.g., 1:30, 1.5h, 90m, 90)',
        placeHolder: '1:30',
    });
    if (!timeStr) { return; }

    let minutes: number;
    try {
        minutes = parseTimeToMinutes(timeStr);
    } catch {
        void vscode.window.showErrorMessage('Invalid time format. Use e.g. 1:30, 1.5h, 90');
        return;
    }

    const notes = await vscode.window.showInputBox({
        prompt: 'Notes',
        placeHolder: 'What did you work on?',
    });
    if (notes === undefined) { return; } // cancelled

    const [yearStr, monthStr] = dateStr.split('-');
    const year  = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const filePath = path.join(
        settings.recordsDir,
        String(year),
        `${String(month).padStart(2, '0')}.json`,
    );
    const data = await store.read<RecordDb>(filePath, { year, month, days: {} });
    if (!data.days[dateStr]) { data.days[dateStr] = []; }
    (data.days[dateStr] as RecordEntry[]).push({ time_spent_min: minutes, notes: notes ?? '' });
    await store.write(filePath, data);

    recordCalendar.refresh();
    void vscode.window.showInformationMessage(`Logged ${minutesToHHMM(minutes)} on ${dateStr}`);
}
