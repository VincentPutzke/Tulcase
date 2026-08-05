/**
 * Central registry of the "Tulcase GitLab" activity-bar container + view ids.
 *
 * The container **id** is deliberately preserved (`tulcase-pipe`) so the rebrand
 * doesn't reset existing users' activity-bar pins; only its title/icon changed
 * (see ADR / plan B6). The three sub-views (Pipelines, Packages, Scopes) get
 * their own ids under the `tulcase.gitlab.*` namespace.
 *
 * These constants are the single source of truth for view ids and their
 * `.focus` cross-navigation commands — package.json declares the same ids, and
 * a build assertion in `esbuild.mjs` checks every `*.focus` string in `src/`
 * against them so a rename can never leave a dead cross-nav button.
 */

/** Activity-bar container id — unchanged from the pre-rebrand "Tulcase Pipe". */
export const GITLAB_CONTAINER_ID = 'tulcase-pipe';

/** The three sub-view ids of the unified container. */
export const GITLAB_VIEWS = {
    pipelines: 'tulcase.gitlab.pipelines',
    packages:  'tulcase.gitlab.packages',
    scopes:    'tulcase.gitlab.scopes',
} as const;

/** The `viewId.focus` command VS Code auto-registers for every declared view. */
export function focusCommand(viewId: string): string {
    return `${viewId}.focus`;
}
