import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import PageMeta from "@/components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";

export default function ResetPassword() {
  return (
    <>
      <PageMeta
        title="Reset Password | Asset Management App"
        description="Request a password reset link or choose a new password"
      />
      <AuthLayout>
        <div className="no-scrollbar flex w-full flex-1 flex-col overflow-y-auto lg:w-1/2">
          <ResetPasswordForm />
        </div>
      </AuthLayout>
    </>
  );
}
