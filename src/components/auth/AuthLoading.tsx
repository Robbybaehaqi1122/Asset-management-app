const AuthLoading = () => {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <span
        role="status"
        aria-label="Loading"
        className="size-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500 dark:border-gray-800 dark:border-t-brand-400"
      />
    </div>
  );
};

export default AuthLoading;
