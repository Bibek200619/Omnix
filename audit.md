# OMNIX FRONTEND — COMPLETE AUDIT & REMEDIATION PROMPT

Role: You are a Principal Frontend Architect. Your mission is to execute every fix described below, strictly following the Execution Rules. Do NOT deviate from the plan. Do NOT add scope.

---

## SCORECARD TARGETS

| Category | Current | Target |
|---|---|---|
| Architecture | 6/10 | 8/10 |
| Performance | 5/10 | 8/10 |
| Accessibility | 4/10 | 8/10 |
| Visual Consistency | 8/10 | 9/10 |
| UX Friction | 5/10 | 8/10 |
| Mobile Responsiveness | 5/10 | 8/10 |
| State Management | 5/10 | 8/10 |
| Design System Maturity | 7/10 | 8/10 |

---

## EXECUTION RULES ("THE TEMPO")

You MUST follow this strict iterative workflow for every individual task below:

1. **Plan**: Outline a specific, step-by-step plan to address the current task.
2. **Execute**: Implement the code fixes according to your plan.
3. **Unit Test**: Run `npm run lint` (and `npm run typecheck` if available) to verify your fix. If no test command exists, verify by checking for TypeScript errors.
4. **Evaluate & Iterate**:
   - If tests fail (**Red Flag**): Do not proceed. Formulate a micro-plan to fix the failing test, implement the new fix, and retest.
   - If tests pass (**Green Flag**): Make a local Git commit with a descriptive message for this specific fix. Do NOT push yet.
5. **Proceed**: Move on to the next task and repeat Steps 1-4.

### Final Integration Phase

Once ALL individual tasks have been resolved and locally committed:
1. **Integration Testing**: Run all checks again together to ensure nothing is broken.
2. **Final Polish**: If issues arise, loop back and fix them.
3. **Push**: Once everything passes with a full green flag, make a final commit summarizing the overall improvements and push all commits to GitHub.

---

## TASK LIST (Ordered by Priority)

### TIER 1 — P0 CRITICAL (Accessibility + Safety)

#### TASK 1.1: Fix hover-only interaction patterns
- **Files**: `frontend/components/tasks/WorkspaceTasksSurface.tsx`, `frontend/components/chat/MessageBubble.tsx`, `frontend/components/layout/sidebar/WorkspaceTreeNode.tsx`
- **What**: Replace ALL `group-hover:opacity-0/opacity-100` patterns with `md:opacity-100` (always visible on mobile) OR add `focus-within:opacity-100` so keyboard users can access controls. Specifically:
  - WorkspaceTasksSurface.tsx line ~632: Secondary metadata (`opacity-0 group-hover:opacity-100`) → change to `md:opacity-100` or `focus-within:opacity-100`
  - WorkspaceTasksSurface.tsx line ~669: Blocker adder input → always visible, or toggle button
  - MessageBubble.tsx line ~194: Action buttons (`opacity-0 group-hover/content:opacity-100`) → add `group-focus-within/content:opacity-100` so keyboard focus reveals them
- **Verify**: Tab through all task cards and message bubbles — every control must be reachable and operable via keyboard alone.

#### TASK 1.2: Add confirmation dialogs for destructive actions
- **Files**: `frontend/lib/workspace-context.tsx`
- **What**: Before calling `deleteWorkspace`, `removeWorkspaceMember`, `revokeInvite`, show a confirmation dialog with the destructive action name and a confirm/cancel button. Use the existing `Modal` component.
  - Wrap `deleteWorkspace` calls with a confirmation step
  - Wrap `removeWorkspaceMember` calls with a confirmation step
  - Wrap `revokeInvite` calls with a confirmation step
- **Verify**: Trigger each action and confirm the dialog appears before the action executes.

#### TASK 1.3: Add `aria-live` regions for dynamic updates
- **Files**: `frontend/components/tasks/WorkspaceTasksSurface.tsx`, `frontend/components/initiatives/WorkspaceInitiativesSurface.tsx`, `frontend/components/decisions/WorkspaceDecisionsSurface.tsx`
- **What**: Add a visually hidden `aria-live="polite"` region that announces task/initiative/decision creation, updates, and deletions. Use a `useRef` + `useEffect` pattern to push status messages.
- **Verify**: Inspect the DOM for the `aria-live` element. Verify messages are pushed on create/update/delete.

#### TASK 1.4: Fix Toggle component ARIA
- **File**: `frontend/components/ui/Toggle.tsx`
- **What**: Change `input type="checkbox"` to include `role="switch"`. Add `aria-checked` based on the `checked` prop.
- **Verify**: Inspect the rendered toggle — it should have `role="switch"` and `aria-checked="true"|"false"`.

#### TASK 1.5: Fix ChatInput search mode buttons
- **File**: `frontend/components/chat/ChatInput.tsx`
- **What**: Replace the `<button>` elements that use `div`-based content in the search mode bar (lines ~208-222). They already use `<button>` tags — verify they have proper `type="button"`, `aria-pressed`, and focus styles. If any are `<div>` with `onClick`, convert to `<button>`.
- **Verify**: Inspect DOM to confirm all search mode toggles are native `<button>` elements.

#### TASK 1.6: Add focus-visible styles to custom select elements
- **Files**: `frontend/components/tasks/WorkspaceTasksSurface.tsx`, `frontend/components/initiatives/WorkspaceInitiativesSurface.tsx`, `frontend/app/(dashboard)/workspace/page.tsx`
- **What**: Add `focus-visible:ring-2 focus-visible:ring-cyan-300/70` to all `<select>` elements that use `omnix-input` class. The ring should be clearly visible on keyboard focus.
- **Verify**: Tab to each select element — a visible focus ring must appear.

#### TASK 1.7: Add accessible label to online presence dot
- **File**: `frontend/components/layout/Sidebar.tsx`
- **What**: Add `aria-label="Online"` or wrap the presence dot span in a visually hidden text span that screen readers can announce.
- **Verify**: Inspect the presence dot element for accessible labeling.

---

### TIER 2 — P1 HIGH (UX Friction + Mobile + Architecture)

#### TASK 2.1: Add action feedback toasts/notifications
- **Files**: All surface files
- **What**: Create a global toast/notification system for action feedback ("Task created", "Workspace deleted", "Member removed"). Use a simple React context + portal pattern. Add a `useToast` hook that surfaces toast messages. Wire it into:
  - `workspace-context.tsx` after create/delete/rename operations
  - `WorkspaceTasksSurface.tsx` after task create/update/delete
  - `WorkspaceInitiativesSurface.tsx` after initiative create/update/delete
- **Note**: Do NOT install a toast library — build a minimal one using the existing `Portal` and `Alert` components.
- **Verify**: Perform each action — a toast must appear and auto-dismiss after 3-4 seconds.

#### TASK 2.2: Fix line-clamp hover-only on mobile
- **File**: `frontend/components/tasks/WorkspaceTasksSurface.tsx`
- **What**: Replace `line-clamp-1` + `group-hover:line-clamp-none` with `line-clamp-2` always visible, OR add a "Show more" button that works on tap. On mobile (`max-md:`), make descriptions always show full text (or line-clamp-2 without hover dependency).
- **Verify**: On mobile viewport, tap a task card — description must be fully readable without hover.

#### TASK 2.3: Increase touch targets to 44px minimum
- **Files**: All component files
- **What**: Find all interactive elements smaller than 44x44 CSS pixels and increase them. Minimum targets:
  - `h-8 w-8` → `h-11 w-11` (44px)
  - `h-7 w-7` → `h-11 w-11`
  - `h-6 w-6` → `h-10 w-10`
  - **Exception**: Inline text controls (date input, select) can stay smaller but must have sufficient padding for tap.
- **Verify**: On a 375px viewport, confirm all interactive elements are at least 44x44px.

#### TASK 2.4: Add empty states to all missing pages
- **Files**: `frontend/app/(dashboard)/notifications/page.tsx`, `frontend/app/(dashboard)/mentions/page.tsx`, `frontend/app/(dashboard)/files/page.tsx`, `frontend/app/(dashboard)/history/page.tsx`, `frontend/app/(dashboard)/sources/page.tsx`
- **What**: Each page currently renders a surface component. If the data list is empty, show an EmptyState component (already exists at `components/ui/EmptyState.tsx`) with a relevant icon, title, description, and optional CTA button.
- **Verify**: Navigate to each page when the workspace has no data — a styled empty state must appear.

#### TASK 2.5: Improve error messages with actionable guidance
- **Files**: All surface components
- **What**: Replace generic error strings like `"Unable to load tasks."` with contextual messages that include possible causes and recovery actions. Pattern:
  - Network errors: "Unable to load tasks. Check your connection and try again."
  - Server errors: "Tasks are temporarily unavailable. Please try again in a moment."
  - Auth errors: "Your session may have expired. Try refreshing the page."
- **Verify**: Simulate each error condition and verify messages are helpful and actionable.

#### TASK 2.6: Add loading skeletons where spinners are used
- **Files**: `frontend/app/(dashboard)/analytics/page.tsx`, `frontend/app/(dashboard)/files/page.tsx`
- **What**: Replace `<Loader2 className="animate-spin" />` and `"..."` loading placeholders with `PageSkeleton` or matching skeleton layouts.
- **Verify**: On page load, skeletons must match the page layout structure (not just generic spinners).

#### TASK 2.7: Fix hardcoded inline color values
- **Files**: All components
- **What**: Find and replace all inline hex color values (`#00FFFF`, `#061020`, `rgba(0,255,255,...)`, `#050c17`) with CSS custom properties (`var(--omnix-cyan)`, `var(--omnix-bg)`, etc.) or Tailwind classes. Priority targets:
  - `frontend/components/auth/LoginForm.tsx` lines 138-139: `bg-[#00FFFF]` → use CSS variable or tailwind class
  - `frontend/components/auth/RegisterForm.tsx` similar lines
  - `frontend/components/chat/ChatInput.tsx` line 118: `bg-[rgba(8,16,30,0.9)]` → use `var(--omnix-surface-glass)` or similar
- **Verify**: No inline hex color values remain in component files (CSS files are exempt).

---

### TIER 3 — P2 MEDIUM (Architecture + Performance)

#### TASK 3.1: Break up workspace-context.tsx
- **File**: `frontend/lib/workspace-context.tsx` (1300 lines)
- **What**: Split into domain-specific files:
  - `frontend/lib/workspace-tree.tsx` — workspace hierarchy, CRUD, tree normalization
  - `frontend/lib/workspace-members.tsx` — members, invites, roles
  - `frontend/lib/workspace-intelligence.tsx` — intelligence profile, updates
  - The original `workspace-context.tsx` becomes a thin provider that composes them
- **Verify**: Existing functionality must work identically. All imports must be updated across the codebase.

#### TASK 3.2: Break up WorkspaceTasksSurface
- **File**: `frontend/components/tasks/WorkspaceTasksSurface.tsx` (750 lines)
- **What**: Extract:
  - `TaskCard.tsx` — individual task card rendering
  - `TaskCreateForm.tsx` — the inline create form
  - `TaskMomentumPanel.tsx` — momentum section
  - `TaskList.tsx` — the virtualized list wrapper
  - `ExecutionOverview.tsx` — the metrics grid
  - The main surface becomes a composition of these.
- **Verify**: All functionality preserved after refactor.

#### TASK 3.3: Break up WorkspaceInitiativesSurface
- **File**: `frontend/components/initiatives/WorkspaceInitiativesSurface.tsx` (833 lines)
- **What**: Same pattern as TasksSurface:
  - Extract `InitiativeCard.tsx`, `InitiativeCreateForm.tsx`, `InitiativeDetailPanel.tsx`
- **Verify**: All functionality preserved.

#### TASK 3.4: Add query abstraction layer
- **New file**: `frontend/lib/query.ts` or integrate SWR
- **What**: Create a thin wrapper around `apiClient` that provides:
  - Request deduplication (same URL + params in flight = share the promise)
  - Cache with TTL
  - Invalidation helpers
  - Do NOT add a new npm dependency if avoidable — build a minimal custom implementation
  - Update the most frequently called endpoints (workspace tree, tasks, initiatives) to use this layer
- **Verify**: Multiple rapid calls to the same endpoint should only fire one network request.

#### TASK 3.5: Add `React.memo` to context consumer components
- **Files**: `frontend/components/layout/Sidebar.tsx`, `frontend/components/layout/Header.tsx`, all surface components
- **What**: Wrap components that consume context but don't need to re-render on every context change with `React.memo`. Specifically:
  - `Sidebar` — only needs workspace list and user profile
  - `Header` — only needs active workspace, realtime status
  - `NotificationBell` — only needs unread count
- **Verify**: Use React DevTools profiler — components should not re-render when unrelated context values change.

#### TASK 3.6: Remove unused CSS classes
- **File**: `frontend/styles/globals.css`
- **What**: Remove these unused class definitions (confirmed during audit):
  - `.omnix-replit-panel` and its `::before`
  - `.omnix-beam-container` and `.omnix-beam-sweep`
  - `.omnix-glitch-hover`
  - `.omnix-border-beam` and its `::after`
  - `.omnix-input-focus`
- **Verify**: Grep for each class name across `app/`, `components/`, `lib/` — confirm zero usage before removing.

#### TASK 3.7: Remove hidden rendered component
- **File**: `frontend/components/layout/Sidebar.tsx`
- **What**: Lines 113-115 render `<div className="hidden"><WorkspaceHierarchyMini ... /></div>`. Either remove this dead code or make it visible/intentional.
- **Verify**: Component tree should no longer contain hidden dead elements.

---

### TIER 4 — P3 LOW (Polish + Consolidation)

#### TASK 4.1: Deduplicate formatRelativeTime
- **Files**: `frontend/components/ui/ClientTime.tsx`, any file with duplicate time formatting
- **What**: Consolidate `formatRelativeTime` and `formatCalendarDate` into a shared utility at `frontend/lib/time.ts`. Import from there in all consumers.
- **Verify**: Both components/functions produce identical output after refactor.

#### TASK 4.2: Fix misleading file/export names
- **File**: `frontend/components/layout/sidebar/SidebarPresence.tsx`
- **What**: Rename the file to match its export, OR rename the export. The file exports `WorkspaceHierarchyMini` but is named `SidebarPresence`. Either:
  - Rename file to `WorkspaceHierarchyMini.tsx`
  - Or rename export to `SidebarPresence`
  - Update all imports
- **Verify**: No broken imports after rename.

#### TASK 4.3: Add breadcrumbs to workspace pages
- **Files**: All dashboard page files
- **What**: Add a breadcrumb trail showing the current workspace path. Use the workspace hierarchy data from context. Show: `Root Workspace > Subspace > Current Page`.
- **Verify**: Breadcrumbs appear on task, initiative, decision, and conversation pages when a subspace is active.

#### TASK 4.4: Add branding/favicon to auth callback page
- **File**: `frontend/components/auth/OAuthCallbackClient.tsx`
- **What**: Already has branding — just ensure the page title/metadata is set correctly for SEO and screen reader context.
- **Verify**: Page has a meaningful `<title>`.

---

## SUGGESTED GIT COMMIT STRATEGY

After each Task passes verification, commit with a message following this convention:

```
fix(a11y): replace hover-only patterns with keyboard-accessible controls
fix(safety): add confirmation dialogs to all destructive workspace actions
fix(a11y): add aria-live regions for task/initiative mutations
fix(a11y): add role=switch to Toggle component
fix(a11y): ensure ChatInput search buttons are semantic elements
fix(a11y): add focus-visible rings to custom select elements
fix(a11y): add accessible label to presence online dot
feat(ux): add toast notification system for action feedback
fix(mobile): replace hover-only line-clamp with accessible tap-to-expand
fix(mobile): increase touch targets to 44px minimum
feat(ui): add empty states to all missing pages
fix(ux): improve error messages with actionable recovery guidance
fix(perf): replace spinner loading with skeleton screens
fix(theme): replace hardcoded inline colors with CSS variables
refactor(context): split workspace-context into domain-specific providers
refactor(tasks): split WorkspaceTasksSurface into focused components
refactor(initiatives): split WorkspaceInitiativesSurface into focused components
feat(query): add request deduplication and caching layer
perf: add React.memo to context-consuming components
chore(css): remove unused CSS classes
chore(cleanup): remove hidden rendered dead component
chore(consolidation): deduplicate formatRelativeTime utility
chore(cleanup): fix misleading file/export names
feat(ux): add breadcrumbs to workspace pages
```

Final commit after integration testing:
```
chore: complete full frontend audit remediation — all scores raised to 8+
```
