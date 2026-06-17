const games = [
  { id: "g1", title: "Gambling Together", status: "Installato", tag: "PC / VM" },
  { id: "g2", title: "Party Racer", status: "Disponibile", tag: "Multiplayer" },
  { id: "g3", title: "Puzzle Night", status: "Bloccato", tag: "Solo host" }
];

const invites = [
  { code: "K7P3QX", game: "Gambling Together", host: "Tu", status: "Live" },
  { code: "Z2M8AA", game: "Party Racer", host: "Tu", status: "Lobby" }
];

export default function Page() {
  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-300/80">Remote Play Friends</p>
              <h1 className="mt-2 text-3xl font-semibold md:text-5xl">Libreria, stanze e streaming privato</h1>
              <p className="mt-3 max-w-2xl text-sm text-slate-300 md:text-base">
                Avvii un gioco nella tua VM, condividi solo la finestra del gioco e lasci entrare un amico via browser.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Account" value="12" />
              <Stat label="Sessioni" value="48" />
              <Stat label="Amici online" value="3" />
              <Stat label="Ping medio" value="32ms" />
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Libreria giochi</h2>
              <button className="rounded-full border border-cyan-400/40 px-4 py-2 text-sm text-cyan-200">
                Aggiungi gioco
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {games.map((game) => (
                <article key={game.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="h-32 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20" />
                  <div className="mt-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{game.title}</h3>
                      <p className="text-sm text-slate-400">{game.tag}</p>
                    </div>
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
                      {game.status}
                    </span>
                  </div>
                  <button className="mt-4 w-full rounded-xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">
                    Avvia nella VM
                  </button>
                </article>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
              <h2 className="text-xl font-semibold">Crea stanza</h2>
              <div className="mt-4 space-y-3">
                <Input label="Codice amico" placeholder="es. XBOX-123" />
                <Input label="Gioco" placeholder="Gambling Together" />
                <button className="w-full rounded-2xl bg-violet-500 px-4 py-3 font-medium text-white">
                  Genera invito
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
              <h2 className="text-xl font-semibold">Inviti attivi</h2>
              <div className="mt-4 space-y-3">
                {invites.map((invite) => (
                  <div
                    key={invite.code}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div>
                      <p className="font-medium">{invite.game}</p>
                      <p className="text-sm text-slate-400">
                        {invite.code} · host: {invite.host}
                      </p>
                    </div>
                    <span className="rounded-full bg-sky-500/15 px-3 py-1 text-xs text-sky-300">
                      {invite.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Player remoto</h2>
              <div className="flex gap-2 text-xs">
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-300">Streaming</span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200">Controller ready</span>
              </div>
            </div>
            <div className="mt-4 aspect-video rounded-3xl border border-dashed border-cyan-400/30 bg-black/60 p-4">
              <div className="flex h-full items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/10 to-violet-500/10 text-center text-sm text-slate-300">
                Qui va il video della finestra del gioco dalla VM
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <ActionButton label="Mouse" />
              <ActionButton label="Tastiera" />
              <ActionButton label="Xbox Pad" />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
            <h2 className="text-xl font-semibold">Chat stanza</h2>
            <div className="mt-4 space-y-3">
              <ChatBubble who="Tu" text="Avvio il gioco adesso." />
              <ChatBubble who="Amico" text="Ci sono, apro la stanza dalla Xbox." />
            </div>
            <div className="mt-4 flex gap-2">
              <input
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none"
                placeholder="Scrivi un messaggio..."
              />
              <button className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950">
                Invia
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Input({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-300">{label}</span>
      <input
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-slate-500"
        placeholder={placeholder}
      />
    </label>
  );
}

function ActionButton({ label }: { label: string }) {
  return (
    <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
      {label}
    </button>
  );
}

function ChatBubble({ who, text }: { who: string; text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{who}</p>
      <p className="mt-1 text-sm text-slate-200">{text}</p>
    </div>
  );
}
