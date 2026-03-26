import * as vscode from 'vscode';
import type { TagDef } from '../models/tag.model';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

/**
 * Reusable tag selection popup (QuickPick) for the Tulcase extension.
 *
 * Shows all configured tags with colour-circle icons, grouped by category.
 * Supports multi-select and pre-selection (for edit flows).
 *
 * Usage:
 * ```ts
 * const tags = await pickTags(tagTree);
 * const tags = await pickTags(tagTree, ['#work', '#urgent']);
 * ```
 */

/**
 * Show a multi-select QuickPick with all configured tags.
 *
 * @param tagTree   — the TagTreeProvider that owns tag data
 * @param preSelected — tag names that should be checked by default (edit mode)
 * @returns the selected tag names, or `undefined` if cancelled
 */
export async function pickTags(
    tagTree: TagTreeProvider,
    preSelected: string[] = [],
): Promise<string[] | undefined> {
    const tagMap = await tagTree.getTagMap();
    const tagNames = Object.keys(tagMap);

    if (tagNames.length === 0) {
        vscode.window.showInformationMessage(
            'No tags configured. Add one via the Tags view first.',
        );
        return [];
    }

    // Group tags by category for visual separation
    const grouped = groupByCategory(tagMap);

    // Build QuickPick items with colour icons + category separators
    const items: TagQuickPickItem[] = [];
    for (const [category, tags] of grouped) {
        // Category separator
        items.push({
            label: category,
            kind: vscode.QuickPickItemKind.Separator,
            tagName: '',
            description: '',
        });

        for (const [name, def] of tags) {
            items.push({
                label: name,
                tagName: name,
                description: def.color,
                iconPath: colorCircleUri(def.color),
                picked: preSelected.includes(name),
            });
        }
    }

    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select tags (type to filter)',
        matchOnDescription: false,
    });

    if (!picked) { return undefined; }  // user cancelled

    return picked
        .filter(i => i.kind !== vscode.QuickPickItemKind.Separator)
        .map(i => i.tagName);
}

// ── Internal ──────────────────────────────────────────────────────────────────

interface TagQuickPickItem extends vscode.QuickPickItem {
    tagName: string;
    iconPath?: vscode.Uri;
    picked?: boolean;
}

/**
 * Group a flat tag map into an array of [category, [name, def][]] sorted alphabetically.
 * Exported for testing.
 */
export function groupByCategory(
    tagMap: Record<string, TagDef>,
): [string, [string, TagDef][]][] {
    const groups = new Map<string, [string, TagDef][]>();

    for (const [name, def] of Object.entries(tagMap)) {
        const cat = def.category || 'general';
        if (!groups.has(cat)) { groups.set(cat, []); }
        groups.get(cat)!.push([name, def]);
    }

    // Sort categories alphabetically, tags alphabetically within each
    return Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cat, tags]) => [cat, tags.sort(([a], [b]) => a.localeCompare(b))]);
}

/** Create a data-URI SVG circle icon for the given hex colour. */
function colorCircleUri(hexColor: string): vscode.Uri {
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
        `<circle cx="8" cy="8" r="6" fill="${hexColor}"/>` +
        `</svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}
