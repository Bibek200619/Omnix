import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { HistoryList } from "@/components/chat/HistoryList";

export default function HistoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HistoryPageContent />
    </Suspense>
  );
}

function HistoryPageContent() {
  return <HistoryList />;
}
