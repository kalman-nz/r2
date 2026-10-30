import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { formatDateTime, formatDuration, parseDate } from "../lib/format";
import type { PrintAgent } from "../lib/printing";
import { useConfirm } from "./ConfirmProvider";
import { InlineText } from "./InlineInput";
import Segmented from "./Segmented";
import { useToast } from "./ToastProvider";

export function usePrintAgents() {
  return useQuery({ queryKey: ["print-agents"], queryFn: api.listPrintAgents, refetchInterval: 10_000 });
}

// "Online", "Last seen 5 min ago", "Not connected yet"
function seen(agent: PrintAgent): string {
  if (agent.online) return "Online";
  const at = parseDate(agent.lastSeen);
  if (!at) return "Not connected yet";
  const ago = Date.now() - at.getTime();
  if (ago < 60_000) return "Last seen just now";
  return ago < 24 * 3600_000 ? `Last seen ${formatDuration(ago)} ago` : `Last seen ${formatDateTime(agent.lastSeen)}`;
}

// Settings → Printer setup → Print agents: the programs at the venues
// that take labels to their printers (print/r2_print_agent.py). Each has a
// token, shown once, for the commands that set it up.
export default function PrintAgentsSection() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { data: agents = [], isLoading } = usePrintAgents();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // The agent just made (or given a new token), with its token.
  const [setup, setSetup] = useState<{ agent: PrintAgent; token: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["print-agents"] });

  async function add() {
    setBusy(true);
    try {
      const made = await api.createPrintAgent(name.trim());
      setSetup(made);
      setAdding(false);
      setName("");
      await refresh();
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function newToken(agent: PrintAgent) {
    const ok = await confirm({ title: `New token for ${agent.name}`, message: "The old token stops working, so the agent needs setting up again with the new one.", confirmLabel: "Make a new token" });
    if (!ok) return;
    try {
      setSetup(await api.newPrintAgentToken(agent.id));
      await refresh();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function remove(agent: PrintAgent) {
    const ok = await confirm({ title: `Remove ${agent.name}`, message: "Its token stops working.", confirmLabel: "Remove", danger: true });
    if (!ok) return;
    try {
      await api.deletePrintAgent(agent.id);
      if (setup?.agent.id === agent.id) setSetup(null);
      await refresh();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function rename(agent: PrintAgent, value: string) {
    if (!value) return;
    try {
      await api.renamePrintAgent(agent.id, value);
      await refresh();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">Print agents</h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn-secondary">
            Add print agent
          </button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="card p-3 flex items-center gap-2 flex-wrap"
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Workshop Pi" className="input py-1.5 w-56" />
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary py-1.5">
            {busy ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={() => setAdding(false)} className="btn-secondary py-1.5">
            Cancel
          </button>
        </form>
      )}

      {setup && <SetupCommands agent={agents.find((a) => a.id === setup.agent.id) ?? setup.agent} token={setup.token} onDone={() => setSetup(null)} />}

      {isLoading ? null : agents.length === 0 ? (
        !adding && <div className="card p-6 text-center text-sm text-gray-500">No print agents yet.</div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${a.online ? "bg-emerald-500" : "bg-gray-300"}`} title={seen(a)} />
              <div className="min-w-0 flex-1">
                <InlineText value={a.name} onCommit={(v) => rename(a, v)} className="font-medium text-gray-900 w-full max-w-64" />
                <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 mt-0.5">
                  <span>{seen(a)}</span>
                  {a.hostname && <span className="font-mono">{a.hostname}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => newToken(a)} className="btn-secondary">
                  New token
                </button>
                <button onClick={() => remove(a)} className="btn-secondary text-red-600 hover:text-red-700">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type Where = "linux" | "docker" | "other";

// The commands that set an agent up, with its token in them.
function SetupCommands({ agent, token, onDone }: { agent: PrintAgent; token: string; onDone: () => void }) {
  const { showToast } = useToast();
  const [where, setWhere] = useState<Where>("linux");
  const url = window.location.origin;
  const script = `${url}/api/print-agent/script`;
  const commands: Record<Where, string> = {
    linux: `curl -fsSL ${script} -o r2_print_agent.py\nsudo python3 r2_print_agent.py --install --url ${url} --token ${token}`,
    docker: `docker run -d --name r2-print-agent --restart unless-stopped -e R2_URL=${url} -e R2_AGENT_TOKEN=${token} python:3.12-alpine sh -c "wget -qO /agent.py ${script} && exec python /agent.py"`,
    other: `curl -fsSL ${script} -o r2_print_agent.py\npython3 r2_print_agent.py --url ${url} --token ${token}`,
  };

  function copy() {
    navigator.clipboard?.writeText(commands[where]).then(
      () => showToast("success", "Copied"),
      () => showToast("error", "Couldn't copy: select the commands instead"),
    );
  }

  return (
    <div className="card p-4 flex flex-col gap-3 border-signal/40">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-900">Set up {agent.name}</h3>
        <span className={`text-xs ${agent.online ? "text-emerald-700 font-medium" : "text-gray-500"}`}>{agent.online ? "Connected" : "Waiting for it to connect…"}</span>
      </div>
      <Segmented
        label="Where it runs"
        value={where}
        onChange={setWhere}
        options={[
          { value: "linux", label: "Raspberry Pi or Linux" },
          { value: "docker", label: "Docker" },
          { value: "other", label: "Windows or Mac" },
        ]}
      />
      <pre className="bg-gray-50 border border-gray-200 rounded-md p-3 text-xs font-mono text-gray-800 whitespace-pre-wrap break-all select-all">{commands[where]}</pre>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={copy} className="btn-secondary">
          Copy
        </button>
        <button onClick={onDone} className="btn-primary">
          Done
        </button>
        <span className="text-xs text-gray-500 ml-auto">The token is only shown now.</span>
      </div>
    </div>
  );
}
