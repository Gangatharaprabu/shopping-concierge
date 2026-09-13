/**
 * Thin re-export -- the actual checklist implementation (category filter
 * chips, grouped-by-category rows, the owned-checkbox visual-inversion
 * mapping) lives in the shared app/components/ItemChecklist.tsx, since
 * /usecases/[id]'s pre-Start live preview (StartScenarioForm.tsx) needs the
 * identical rendering with no persisted `owned` to toggle yet. Kept as its
 * own file/name here (rather than updating every import site) so
 * ListWorkspace.tsx's existing `import ItemsList from "./ItemsList"` and
 * this directory's existing test file keep working unchanged.
 */
export { default, type ItemChecklistProps as ItemsListProps } from "@/app/components/ItemChecklist";
