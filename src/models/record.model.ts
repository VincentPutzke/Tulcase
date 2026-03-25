/** A single time-tracking entry */
export interface RecordEntry {
    time_spent_min: number;
    notes: string;
}

/** Root shape of records_db/{year}/{month}.json */
export interface RecordDb {
    year: number;
    month: number;
    days: Record<string, RecordEntry[]>;
}

/** Records index entry for a single month */
export interface RecordIndexEntry {
    year: number;
    month: number;
    totalMinutes: number;
}
