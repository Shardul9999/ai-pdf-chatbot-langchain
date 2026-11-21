'use client';
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p>
        Please try again. Your saved documents and messages are still available.
      </p>
      <button className="rounded border px-4 py-2" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
