import SignInForm from "@/components/auth/SignInForm";
import PageMeta from "@/components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";

export default function SignIn() {
  return (
    <>
      <PageMeta
        title="React.js SignIn Dashboard | Asset Management App"
        description="This is React.js SignIn Tables Dashboard page for the Asset Management App"
      />
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
}
