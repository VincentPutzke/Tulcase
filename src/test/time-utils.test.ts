import { describe, it, expect } from 'vitest';
import { parseTimeToMinutes, minutesToHHMM, todayStr, formatDate, parseDate, addDays } from '../data/time-utils';

describe('parseTimeToMinutes', () => {
    it('parses plain minutes', () => {
        expect(parseTimeToMinutes('90')).toBe(90);
    });

    it('parses decimal hours', () => {
        expect(parseTimeToMinutes('1.5')).toBe(90);
    });

    it('parses comma decimal', () => {
        expect(parseTimeToMinutes('1,5')).toBe(90);
    });

    it('parses HH:MM', () => {
        expect(parseTimeToMinutes('1:30')).toBe(90);
    });

    it('parses hours suffix', () => {
        expect(parseTimeToMinutes('1.5h')).toBe(90);
    });

    it('parses HH:MM + h suffix', () => {
        expect(parseTimeToMinutes('1:30h')).toBe(90);
    });

    it('throws on empty', () => {
        expect(() => parseTimeToMinutes('')).toThrow();
    });

    it('parses zero', () => {
        expect(parseTimeToMinutes('0')).toBe(0);
    });

    it('parses large values', () => {
        expect(parseTimeToMinutes('8:00')).toBe(480);
    });
});

describe('minutesToHHMM', () => {
    it('formats minutes to HH:MM', () => {
        expect(minutesToHHMM(90)).toBe('01:30');
    });

    it('formats zero', () => {
        expect(minutesToHHMM(0)).toBe('00:00');
    });

    it('formats large values', () => {
        expect(minutesToHHMM(480)).toBe('08:00');
    });
});

describe('date utilities', () => {
    it('todayStr returns YYYY-MM-DD', () => {
        const result = todayStr();
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('formatDate formats correctly', () => {
        expect(formatDate(new Date(2026, 2, 16))).toBe('2026-03-16');
    });

    it('parseDate parses correctly', () => {
        const date = parseDate('2026-03-16');
        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(2); // March = 2
        expect(date.getDate()).toBe(16);
    });

    it('addDays adds days', () => {
        expect(addDays('2026-03-16', 1)).toBe('2026-03-17');
    });

    it('addDays handles month boundary', () => {
        expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
    });
});
