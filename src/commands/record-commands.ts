import * as vscode from 'vscode';
import type { TulcaseSettings } from '../config';
import type { RecordCalendarViewProvider } from '../views/record-calendar.view';

/**
 * Register all record-related VS Code commands.
 *
 * All data operations (add / edit / delete) live in the view provider;
 * the commands simply delegate.
 */
export function registerRecordCommands(
    context: vscode.ExtensionContext,
    _settings: TulcaseSettings,
    recordCalendar: RecordCalendarViewProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.record.add',
            () => recordCalendar.addRecordToday()),
        vscode.commands.registerCommand('tulcase.record.addOther',
            () => recordCalendar.addRecordAnotherDay()),
    );
}
