import { auth, signIn, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-slate-900 text-white">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm flex flex-col gap-6">
        <h1 className="text-4xl font-bold tracking-tight text-center">
          Chess Prediction Platform
        </h1>
        <p className="text-slate-400 text-center">
          Your AI-powered chess opponent analytics and RAG strategy assistant.
        </p>

        <div className="p-8 bg-slate-800 rounded-xl border border-slate-700 flex flex-col items-center gap-4 shadow-xl">
          {session?.user ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-emerald-400 font-medium">
                Welcome back, {session.user.name} ({session.user.email})!
              </p>
              <form
                action={async () => {
                  "use server";
                  await signOut();
                }}
              >
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-sans"
                >
                  Sign Out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <p className="text-slate-300">You are not signed in.</p>
              <form
                action={async () => {
                  "use server";
                  await signIn("google");
                }}
              >
                <button
                  type="submit"
                  className="px-4 py-2 bg-white text-slate-900 hover:bg-slate-200 rounded-lg transition-colors font-sans font-semibold"
                >
                  Sign in with Google
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}