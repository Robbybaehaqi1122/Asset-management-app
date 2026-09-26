import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import ComponentCard from "@/components/ui/ComponentCard";

export default function Blank() {
  return (
    <div>
      <PageMeta
        title="React.js Blank Page | Asset Management App"
        description="This is React.js Blank Page for the Asset Management App"
      />
      <PageBreadcrumb pageTitle="Blank Page" />

      <ComponentCard title="Blank Page" desc="A minimal page to copy from.">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This is the smallest useful page:{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700 dark:bg-white/10 dark:text-gray-300">
            PageMeta
          </code>{" "}
          for the document title,{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700 dark:bg-white/10 dark:text-gray-300">
            PageBreadcrumb
          </code>{" "}
          for the header, and{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700 dark:bg-white/10 dark:text-gray-300">
            ComponentCard
          </code>{" "}
          as the content container. Replace this card with your own sections.
        </p>
      </ComponentCard>
    </div>
  );
}
