import Calendar from "@/components/calendar/Calendar";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PageMeta from "@/components/common/PageMeta";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/palette.css";
import "@fullcalendar/react/themes/classic/theme.css";

export default function CalendarPage() {
  return (
    <div>
      <PageMeta
        title="React.js Calendar Dashboard | Asset Management App"
        description="This is React.js Calendar Dashboard page for the Asset Management App"
      />
      <PageBreadcrumb pageTitle="Calendar" />
      <Calendar />
    </div>
  );
}
