import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import FilesPage from "../files/page";

export default function SourcesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FilesPage />
    </Suspense>
  );
}
