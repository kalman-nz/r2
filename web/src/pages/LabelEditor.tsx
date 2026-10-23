import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../components/ToastProvider";
import LabelDesigner from "../components/LabelDesigner";
import type { LabelElement } from "../lib/labelSpec";

export default function LabelEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [name, setName] = useState("New template");
  const [widthMm, setWidthMm] = useState(62);
  const [heightMm, setHeightMm] = useState(29);
  const [elements, setElements] = useState<LabelElement[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew || !id) return;
    api.getLabel(id).then((t) => {
      setName(t.name);
      setWidthMm(t.widthMm);
      setHeightMm(t.heightMm);
      setElements(t.elements);
    });
  }, [id, isNew]);

  async function save() {
    setSaving(true);
    try {
      const template = { name, widthMm, heightMm, elements };
      if (isNew) {
        const created = await api.createLabel(template);
        navigate(`/labels/${created.id}`, { replace: true });
      } else if (id) {
        await api.updateLabel(id, template);
      }
      showToast("success", "Template saved");
    } catch (err) {
      showToast("error", `Couldn't save template: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lg:h-full flex flex-col gap-4 lg:min-h-0">
      <Link to="/settings/labels" className="text-sm text-gray-500 hover:text-gray-900 w-fit">
        ← Settings
      </Link>

      <div className="flex items-center justify-between">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-transparent text-xl font-semibold text-gray-900 focus:outline-none border-b border-transparent focus:border-gray-300"
        />
        <button onClick={save} disabled={saving} className="btn-primary py-1.5 px-4">
          {saving ? "Saving…" : "Save template"}
        </button>
      </div>

      <LabelDesigner
        widthMm={widthMm}
        heightMm={heightMm}
        elements={elements}
        onSizeChange={(w, h) => {
          setWidthMm(w);
          setHeightMm(h);
        }}
        onElementsChange={setElements}
      />
    </div>
  );
}
