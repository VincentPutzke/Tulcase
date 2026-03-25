import * as vscode from 'vscode';
import * as path from 'path';
import { JsonStore } from '../data/json-store';
import { parseTimeToMinutes, todayStr, minutesToHHMM } from '../data/time-utils';
import type { ArbeitsplatzSettings } from '../config';
import type { RecordDb, RecordEntry } from '../models/record.model';
import type { RecordTreeProvider } from '../providers/record-tree.provider';

const store = new JsonStore();

export function registerRecordCommands(
    context: vscode.ExtensionContext,
    settings: ArbeitsplatzSettings,
    recordTree: RecordTreeProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.record.add', () => addRecord(settings, recordTree)),
    );
}

async function addRecord(settings: ArbeitsplatzSettings, recordTree: RecordTreeProvider): Promise<void> {
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
        vscode.window.showErrorMessage('Invalid time format. Use e.g. 1:30, 1.5h, 90');
        return;
    }

    const notes = await vscode.window.showInputBox({ prompt: 'Notes', placeHolder: 'What did you work on?' });
    if (!notes) { return; }

    // Parse year/month from date
    const [yearStr, monthStr] = dateStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const filePath = path.join(settings.recordsDir, String(year), `${String(month).padStart(2, '0')}.json`);
    const data = await store.read<RecordDb>(filePath, { year, month, days: {} });

    if (!data.days[dateStr]) {
        data.days[dateStr] = [];
    }

    data.days[dateStr].push({ time_spent_min: minutes, notes });
    await store.write(filePath, data);
    recordTree.refresh();
    vscode.window.showInformationMessage(`Logged ${minutesToHHMM(minutes)} on ${dateStr}`);
}
