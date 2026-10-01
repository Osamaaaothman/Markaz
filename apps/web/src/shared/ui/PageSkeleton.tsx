import { Skeleton } from "primereact/skeleton";

// A full-page loading shape: a title bar, a metric-card row, and a table body —
// close enough to most Tier-1 screens' real layout that the skeleton doesn't
// visually jump into place once data arrives (docs/08-FRONTEND-I18N-RULES.md §9).
export function PageSkeleton(): React.JSX.Element {
  return (
    <div className="erp-page-skeleton" aria-busy="true" aria-live="polite">
      <Skeleton height="1.75rem" width="14rem" className="erp-page-skeleton__title" />
      <div className="erp-page-skeleton__cards">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="erp-page-skeleton__card">
            <Skeleton height="0.85rem" width="50%" />
            <Skeleton height="1.6rem" width="70%" />
          </div>
        ))}
      </div>
      <div className="erp-page-skeleton__body">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} height="2.5rem" />
        ))}
      </div>
    </div>
  );
}
