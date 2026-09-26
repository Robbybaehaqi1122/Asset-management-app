import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import ComponentCard from "@/components/ui/ComponentCard";

export default function Dashboard() {
  return (
    <div>
      <PageMeta
        title="React.js Dashboard | Asset Management App"
        description="This is the dashboard page for the Asset Management App"
      />
      <PageBreadcrumb pageTitle="Dashboard" />

      <ComponentCard
        title="Dashboard"
        desc="Placeholder for the asset management overview."
      >
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing here yet. New pages go in{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700 dark:bg-white/10 dark:text-gray-300">
            src/pages/&lt;Category&gt;/&lt;PageName&gt;.tsx
          </code>{" "}
          and get registered as a{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700 dark:bg-white/10 dark:text-gray-300">
            &lt;Route&gt;
          </code>{" "}
          inside the{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700 dark:bg-white/10 dark:text-gray-300">
            &lt;AppLayout&gt;
          </code>{" "}
          group in{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700 dark:bg-white/10 dark:text-gray-300">
            src/App.tsx
          </code>
          .
        </p>
      </ComponentCard>
    </div>
  );
}
