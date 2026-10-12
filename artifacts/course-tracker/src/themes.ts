/**
 * Panel theming.
 *
 * The app runs four visually distinct panels — Admin, the Zedking branch, every
 * other branch, and the Student portal. The colour tokens for each panel live in
 * ONE place: the `[data-theme='...']` blocks in `src/index.css`. This module only
 * decides WHICH theme a user gets and gives it a label. Components read the theme
 * through CSS variables, never through hard-coded colours, so no screen needs to
 * know it is being themed.
 *
 * A panel's theme is chosen by role and — for a module owner — by the BRANCH that
 * owns their module, never by the module itself. Every module inside one branch
 * shares a single theme, so a Zedking Digital Marketing teacher and a Zedking
 * Social Media teacher see the same green desk.
 *
 * To add a theme: add a `[data-theme='x']` block to `src/index.css`, then add 'x'
 * to `PanelTheme` and `PANEL_THEME_LABELS` below. No component changes needed.
 */
export type PanelTheme = 'admin' | 'zedking' | 'branch' | 'student';

/** The badge shown at the top of a panel when a more specific name is not known. */
export const PANEL_THEME_LABELS: Record<PanelTheme, string> = {
  admin: 'Admin',
  zedking: 'Zedking',
  branch: 'Branch',
  student: 'Student',
};

/** The one branch that gets its own theme; every other branch shares `branch`. */
export const ZEDKING_BRANCH_NAME = 'zedking';

/** Map a branch name to the theme every module in that branch uses. */
export function themeForBranch(branchName?: string | null): PanelTheme {
  return (branchName ?? '').trim().toLowerCase() === ZEDKING_BRANCH_NAME ? 'zedking' : 'branch';
}
