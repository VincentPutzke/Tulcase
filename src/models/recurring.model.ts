/** Schedule definition for a recurring action */
export interface RecurringSchedule {
    type: 'daily' | 'weekly' | 'monthly';
    weekdays?: number[];
    weeks?: number[];
}

/** A recurring action definition */
export interface RecurringAction {
    id: string;
    note: string;
    tags: string[];
    schedule: RecurringSchedule;
    active: boolean;
    lastCreatedDate?: string;
    instances: Record<string, { status: string; movedTo?: string }>;
}

/** Root shape of recurring.json */
export interface RecurringStore {
    actions: RecurringAction[];
}
