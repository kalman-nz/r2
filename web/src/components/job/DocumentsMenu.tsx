import { Link } from "react-router-dom";
import { useDropdown } from "../../lib/dropdown";
import { useDocumentTemplates } from "../../lib/documents";
import { useRole } from "../../lib/roles";

// A project's printable documents: the built-in packing list, then the
// organisation's own forms (Settings → Documents), like a technical
// handover or a deprep checklist.
export default function DocumentsMenu({ jobId }: { jobId: string }) {
  const { open, setOpen, ref } = useDropdown();
  const { can } = useRole();
  const { data: templates = [], isLoading } = useDocumentTemplates(open);
  const item = "block px-3 py-2 hover:bg-gray-50";
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn-secondary flex items-center gap-1.5" aria-haspopup="true" aria-expanded={open}>
        Documents
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-gray-400" aria-hidden>
          <path d="M5.5 7.5L10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto card shadow-lg py-1 z-40 text-sm">
          <Link to={`/print/jobs/${jobId}/packing`} className={item}>
            <span className="block font-medium text-gray-900">Packing list</span>
            <span className="block text-xs text-gray-500">What to pack, to tick off, with where it's kept</span>
          </Link>
          {isLoading && <p className="px-3 py-2 text-xs text-gray-400">Loading…</p>}
          {templates.map((t) => (
            <Link key={t.id} to={`/print/jobs/${jobId}/documents/${t.id}`} className={item}>
              <span className="block font-medium text-gray-900">{t.name}</span>
              {t.description && <span className="block text-xs text-gray-500">{t.description}</span>}
            </Link>
          ))}
          {can("settings.edit") && (
            <Link to="/settings/documents" className="block px-3 py-2 mt-1 border-t border-gray-100 text-gray-600 hover:bg-gray-50">
              Manage documents…
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
