import { ScanForm } from "@/components/scan-form";
import { getMessages } from "@/lib/messages";

export default function HomePage() {
  const messages = getMessages();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <div className="rise">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{messages.site.name}</h1>
        <p className="mt-3 text-lg text-muted">{messages.site.tagline}</p>
        <p className="mt-6 max-w-prose leading-8 text-muted">{messages.site.description}</p>

        <div className="mt-10">
          <ScanForm messages={messages} />
        </div>
      </div>

      <footer className="mt-20 text-sm text-muted">{messages.site.independent}</footer>
    </main>
  );
}
