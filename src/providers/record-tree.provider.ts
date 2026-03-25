import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { minutesToHHMM } from '../data/time-utils';
import type { ArbeitsplatzSettings } from '../config';
import type { RecordDb, RecordEntry } from '../models/record.model';

type RecordTreeNode = RecordYearItem | RecordMonthItem;

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/** A year group in the records tree */
class RecordYearItem extends vscode.TreeItem {
    constructor(
        public readonly year: number,
        public readonly months: RecordMonthItem[]
    ) {
        super(String(year), vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('calendar');
        this.contextValue = 'recordYear';
    }
}

/** A single month in the records tree */
export class RecordMonthItem extends vscode.TreeItem {
    constructor(
        public readonly year: number,
        public readonly month: number,
        totalMinutes: number
    ) {
        const monthName = MONTH_NAMES[month - 1] ?? `Month ${month}`;
        super(monthName, vscode.TreeItemCollapsibleState.None);
        this.description = minutesToHHMM(totalMinutes);
        this.tooltip = `${monthName} ${year}: ${minutesToHHMM(totalMinutes)}`;
        this.contextValue = 'recordMonth';
        this.iconPath = new vscode.ThemeIcon('clock');
    }
}

export class RecordTreeProvider implements vscode.TreeDataProvider<RecordTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<RecordTreeNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private settings: ArbeitsplatzSettings) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: RecordTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: RecordTreeNode): Promise<RecordTreeNode[]> {
        if (element instanceof RecordYearItem) {
            return element.months;
        }
        if (element) {
            return [];
        }

        // Scan records_db directory for year/month files
        const recordsDir = this.settings.recordsDir;
        const yearMap = new Map<number, RecordMonthItem[]>();

        try {
            const yearDirs = await fs.readdir(recordsDir);
            for (const yearDir of yearDirs) {
                const yearNum = parseInt(yearDir, 10);
                if (isNaN(yearNum)) {
                    continue;
                }

                const yearPath = path.join(recordsDir, yearDir);
                const stat = await fs.stat(yearPath);
                if (!stat.isDirectory()) {
                    continue;
                }

                const monthFiles = await fs.readdir(yearPath);
                const months: RecordMonthItem[] = [];

                for (const monthFile of monthFiles) {
                    if (!monthFile.endsWith('.json')) {
                        continue;
                    }
                    const monthNum = parseInt(path.basename(monthFile, '.json'), 10);
                    if (isNaN(monthNum)) {
                        continue;
                    }

                    try {
                        const content = await fs.readFile(path.join(yearPath, monthFile), 'utf-8');
                        const data: RecordDb = JSON.parse(content);
                        const totalMinutes = sumMinutes(data);
                        months.push(new RecordMonthItem(yearNum, monthNum, totalMinutes));
                    } catch {
                        months.push(new RecordMonthItem(yearNum, monthNum, 0));
                    }
                }

                months.sort((a, b) => b.month - a.month);
                yearMap.set(yearNum, months);
            }
        } catch {
            // Records directory may not exist yet
        }

        return Array.from(yearMap.entries())
            .sort((a, b) => b[0] - a[0])
            .map(([year, months]) => new RecordYearItem(year, months));
    }
}

function sumMinutes(data: RecordDb): number {
    let total = 0;
    for (const entries of Object.values(data.days ?? {})) {
        for (const entry of entries) {
            total += entry.time_spent_min ?? 0;
        }
    }
    return total;
}
