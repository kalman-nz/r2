import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../components/ToastProvider";
import LabelDesigner from "../components/LabelDesigner";
import type { LabelElement } from "../lib/labelSpec";
import Breadcrumbs from "../components/Breadcrumbs";

export default function LabelEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [name, setName] = useState("New template");
  const [widthMm, setWidthMm] = useState(62);
  const [heightMm, setHeightMm] = useState(29);
  const [sizeId, setSizeId] = useState("tape-62");
  const [elements, setElements] = useState<LabelElement[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew || !id) return;
    api.getLabel(id).then((t) => {
      setName(t.name);
      setWidthMm(t.widthMm);
      setHeightMm(t.heightMm);
      setSizeId(t.sizeId ?? "");
      setElements(t.elements);
    });
  }, [id, isNew]);

  async function save() {
    setSaving(true);
    try {
      const template = { name, widthMm, heightMm, sizeId, elements };
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
      <Breadcrumbs crumbs={[{ label: "Settings", to: "/settings" }, { label: "Labels", to: "/settings/labels" }, { label: name || "Label" }]} />

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
        sizeId={sizeId}
        onSizeChange={(w, h, size) => {
          setWidthMm(w);
          setHeightMm(h);
          setSizeId(size);
        }}
        onElementsChange={setElements}
      />
    </div>
  );
}
