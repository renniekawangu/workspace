import { useCallback, useEffect, useState } from "react";
import { addDriveAsset, ASSET_CATEGORIES } from "../../lib/driveAssets";
import {
  categoryForMime,
  downloadFromDrive,
  listDriveFiles,
  uploadProblem,
  uploadToDrive,
  type DriveFile,
} from "../../lib/drive";
import { useToast } from "../../lib/toast";
import {
  Button,
  EmptyState,
  ErrorNote,
  LoadingState,
  Modal,
  SelectField,
  TextField,
} from "../../lib/ui";

const msg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;
const fmtSize = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : n >= 1024
      ? `${Math.round(n / 1024)} KB`
      : n
        ? `${n} B`
        : "";

/** Download link for an asset that lives in Drive. Goes through the app, so no Drive access is needed. */
export function DriveDownloadButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="ml-3 mt-3 inline-block text-xs text-sky-300 underline disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        try {
          await downloadFromDrive(id, name);
        } catch (e) {
          toast(msg(e, "Download failed."), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Downloading…" : "Download"}
    </button>
  );
}

export function DrivePicker({
  uid,
  existingIds,
  onAdded,
  onClose,
}: {
  uid: string;
  existingIds: Set<string>;
  onAdded: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [next, setNext] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState("");
  const [chosen, setChosen] = useState<File | null>(null);
  const [category, setCategory] = useState("Image");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async (q: string, page = "") => {
    setLoading(true);
    setError("");
    try {
      const r = await listDriveFiles(q, page);
      setFiles((prev) => (page ? [...prev, ...r.files] : r.files));
      setNext(r.nextPageToken);
    } catch (e) {
      setError(msg(e, "Could not load files from Google Drive."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load("");
  }, [load]);

  const inLibrary = (id: string) => existingIds.has(id) || added.has(id);

  async function add(f: DriveFile) {
    if (adding) return;
    setAdding(f.id);
    try {
      await addDriveAsset(uid, f, categoryForMime(f.mimeType));
      setAdded((s) => new Set(s).add(f.id));
      onAdded();
      toast(`${f.name} added to the library.`, "success");
    } catch {
      toast(
        "Could not add that file. Check your role and the latest Firestore rules.",
        "error",
      );
    } finally {
      setAdding("");
    }
  }

  async function upload() {
    if (!chosen || uploading) return;
    setUploading(true);
    setError("");
    try {
      const f = await uploadToDrive(chosen);
      await addDriveAsset(uid, f, category);
      setAdded((s) => new Set(s).add(f.id));
      setChosen(null);
      onAdded();
      toast("Uploaded to Drive and added to the library.", "success");
      await load(search);
    } catch (e) {
      setError(msg(e, "Upload failed."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal
      size="lg"
      title="Google Drive"
      onClose={() => !uploading && onClose()}
      footer={
        <Button variant="ghost" disabled={uploading} onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-6">
        {error && <ErrorNote>{error}</ErrorNote>}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white">Upload a file</h3>
          <input
            type="file"
            className="block w-full text-sm text-slate-300"
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              const problem = f ? uploadProblem(f) : "";
              setError(problem);
              setChosen(f && !problem ? f : null);
              if (f && !problem) setCategory(categoryForMime(f.type));
            }}
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <SelectField
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={ASSET_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
            <Button
              disabled={!chosen || uploading}
              onClick={() => void upload()}
            >
              {uploading ? "Uploading…" : "Upload and add"}
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Up to 4 MB here. For larger files (videos), drop them into the Drive
            folder and add them from the list below.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white">
            Files in the Drive folder
          </h3>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void load(search);
            }}
          >
            <TextField
              label="Search"
              placeholder="File name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit" variant="ghost" disabled={loading}>
              Search
            </Button>
          </form>
          {loading && files.length === 0 ? (
            <LoadingState label="Loading Drive files…" rows={3} />
          ) : files.length === 0 && !error ? (
            <EmptyState
              title="No files found"
              text="Upload a file above, or add files to the Drive folder."
            />
          ) : (
            <ul className="space-y-2">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {f.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {[
                        categoryForMime(f.mimeType),
                        fmtSize(f.size),
                        f.modifiedTime &&
                          new Date(f.modifiedTime).toLocaleDateString(),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {f.webViewLink && (
                      <a
                        href={f.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-sky-300 underline"
                      >
                        Open in Drive
                      </a>
                    )}
                    {inLibrary(f.id) ? (
                      <span className="text-xs text-slate-500">In library</span>
                    ) : (
                      <Button
                        variant="subtle"
                        disabled={!!adding}
                        onClick={() => void add(f)}
                      >
                        {adding === f.id ? "Adding…" : "Add to library"}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {next && (
            <Button
              variant="ghost"
              disabled={loading}
              onClick={() => void load(search, next)}
            >
              {loading ? "Loading…" : "Load more"}
            </Button>
          )}
        </section>
      </div>
    </Modal>
  );
}
