import React, { useState, useEffect, useRef } from "react";

type DocumentStatus = "pending" | "processing" | "needs_review" | "extracted" | "failed";

type DocumentItem = {
  id: string;
  filename: string;
  file_type: string;
  storage_path: string;
  status: DocumentStatus;
  created_at: string;
  invoice?: {
    id: string;
    vendor_name: string;
    invoice_number: string;
    grand_total: number;
    needs_review: boolean;
    reviewed_by_human: boolean;
  } | null;
};

type LineItem = {
  id?: string;
  description: string;
  qty: number;
  unit_price: number;
  total: number;
};

type FullDocumentDetail = DocumentItem & {
  raw_llm_response?: Record<string, unknown> | null;
  invoice?: {
    id: string;
    document_id: string;
    vendor_name: string;
    invoice_number: string;
    invoice_date: string;
    grand_total: number;
    field_confidence: Record<string, "high" | "medium" | "low">;
    needs_review: boolean;
    reviewed_by_human: boolean;
    updated_at: string;
    lineItems: LineItem[];
  } | null;
};

type DocumentsResponse = { ok: boolean; documents?: DocumentItem[]; error?: string };
type DocumentDetailResponse = { ok: boolean; document?: FullDocumentDetail; error?: string };
type UploadResponse = {
  ok: boolean;
  document?: DocumentItem;
  documents?: DocumentItem[];
  splitPages?: boolean;
  pageCount?: number;
  error?: string;
};
type ExtractResponse = { ok: boolean; invoice?: FullDocumentDetail["invoice"]; error?: string };
type PatchResponse = { ok: boolean; invoice?: FullDocumentDetail["invoice"]; error?: string };

export default function App() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<FullDocumentDetail | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form edit states
  const [editVendor, setEditVendor] = useState("");
  const [editInvNum, setEditInvNum] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTotal, setEditTotal] = useState<number>(0);
  const [editItems, setEditItems] = useState<LineItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch documents list
  const fetchDocuments = async () => {
    try {
      const res = await fetch("/api/documents");
      const json = (await res.json()) as DocumentsResponse;
      if (json.ok && Array.isArray(json.documents)) {
        setDocuments(json.documents);
      }
    } catch (err) {
      console.error("Failed to load documents:", err);
    }
  };

  useEffect(() => {
    void fetchDocuments();
    const interval = setInterval(() => {
      void fetchDocuments();
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // Fetch full document details on selection
  useEffect(() => {
    if (!selectedDocId) {
      setSelectedDoc(null);
      return;
    }
    const loadDetail = async () => {
      try {
        const res = await fetch(`/api/documents/${selectedDocId}`);
        const json = (await res.json()) as DocumentDetailResponse;
        if (json.ok && json.document) {
          const doc: FullDocumentDetail = json.document;
          setSelectedDoc(doc);
          if (doc.invoice) {
            setEditVendor(doc.invoice.vendor_name || "");
            setEditInvNum(doc.invoice.invoice_number || "");
            setEditDate(doc.invoice.invoice_date || "");
            setEditTotal(doc.invoice.grand_total || 0);
            setEditItems(doc.invoice.lineItems || []);
          }
        }
      } catch (err) {
        console.error("Failed to load document detail:", err);
      }
    };
    void loadDetail();
  }, [selectedDocId]);

  // Handle file upload
  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as UploadResponse;
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }
      await fetchDocuments();
      if (data.documents && data.documents.length > 0) {
        // Multi-page PDF split into individual documents: extract each
        for (const doc of data.documents) {
          void handleExtract(doc.id);
        }
      } else if (data.document?.id) {
        void handleExtract(data.document.id);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload error");
    } finally {
      setIsUploading(false);
    }
  };

  // Trigger extraction
  const handleExtract = async (id: string) => {
    setExtractingId(id);
    try {
      const res = await fetch(`/api/documents/${id}/extract`, { method: "POST" });
      const data = (await res.json()) as ExtractResponse;
      if (!res.ok) {
        console.error("Extraction error:", data);
      }
      await fetchDocuments();
      if (selectedDocId === id) {
        // Refresh detail
        setSelectedDocId(null);
        setTimeout(() => setSelectedDocId(id), 50);
      } else {
        setSelectedDocId(id);
      }
    } catch (err) {
      console.error("Extraction trigger failed:", err);
    } finally {
      setExtractingId(null);
    }
  };

  // Save human correction
  const handleSaveCorrection = async () => {
    if (!selectedDoc?.invoice) return;
    try {
      const res = await fetch(`/api/invoices/${selectedDoc.invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_name: editVendor,
          invoice_number: editInvNum,
          invoice_date: editDate,
          grand_total: Number(editTotal),
          line_items: editItems,
        }),
      });
      const data = (await res.json()) as PatchResponse;
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        await fetchDocuments();
        // Refresh local view
        setSelectedDoc((prev) =>
          prev && prev.invoice
            ? {
                ...prev,
                status: "extracted",
                invoice: {
                  ...prev.invoice,
                  vendor_name: editVendor,
                  invoice_number: editInvNum,
                  invoice_date: editDate,
                  grand_total: Number(editTotal),
                  reviewed_by_human: true,
                  needs_review: false,
                  lineItems: editItems,
                },
              }
            : prev
        );
      } else {
        alert(data.error || "Failed to save correction");
      }
    } catch {
      alert("Error saving correction");
    }
  };

  // Calculate items sum
  const itemsSum = editItems.reduce((acc, it) => acc + (Number(it.total) || 0), 0);
  const sumDiff = Math.abs(itemsSum - Number(editTotal));
  const hasSumMismatch = sumDiff > 0.05;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur px-6 py-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
            IE
          </div>
          <div>
            <h1 className="font-semibold text-lg leading-tight">Invoice Extractor</h1>
            <p className="text-xs text-slate-400">Structured Data Extraction & Review Pipeline</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              if (e.target.files?.[0]) void handleUpload(e.target.files[0]);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-lg text-sm font-medium transition shadow flex items-center gap-2 disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading...
              </>
            ) : (
              <>+ Upload Invoice</>
            )}
          </button>
        </div>
      </header>

      {uploadError && (
        <div className="bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm px-6 py-2.5 flex justify-between items-center">
          <span>⚠️ {uploadError}</span>
          <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-300 font-bold">×</button>
        </div>
      )}

      {/* Main Content Grid */}
      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden max-w-7xl mx-auto w-full">
        {/* Left Column: Document List */}
        <section className={`${selectedDocId ? "lg:col-span-5" : "lg:col-span-12"} flex flex-col gap-4 transition-all duration-200`}>
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Documents ({documents.length})
              </h2>
              <button
                onClick={() => void fetchDocuments()}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline"
              >
                Refresh
              </button>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.[0]) void handleUpload(e.dataTransfer.files[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-indigo-500/80 bg-slate-900/50 hover:bg-indigo-950/20 rounded-lg p-5 text-center cursor-pointer transition flex flex-col items-center justify-center gap-1"
            >
              <span className="text-2xl">📄</span>
              <p className="text-sm font-medium text-slate-300">Drop PDF, Excel, or Image invoice here</p>
              <p className="text-xs text-slate-500">Supports .pdf, .xlsx, .xls, .png, .jpg, .webp up to 25MB</p>
            </div>
          </div>

          {/* Documents Table */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex-1 flex flex-col">
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/80 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">File</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Total</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {documents.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-500">
                        No documents yet. Upload a sample invoice to get started.
                      </td>
                    </tr>
                  ) : (
                    documents.map((doc) => {
                      const isSelected = selectedDocId === doc.id;
                      const isExtracting = extractingId === doc.id;

                      let statusBadge = (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300">
                          {doc.status}
                        </span>
                      );

                      if (doc.status === "needs_review") {
                        statusBadge = (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 w-fit">
                            <span>⚠️</span> Needs Review
                          </span>
                        );
                      } else if (doc.status === "extracted") {
                        statusBadge = (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 w-fit">
                            <span>✓</span> Extracted
                          </span>
                        );
                      } else if (doc.status === "failed") {
                        statusBadge = (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30 w-fit">
                            Failed
                          </span>
                        );
                      } else if (doc.status === "processing" || isExtracting) {
                        statusBadge = (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 animate-pulse w-fit">
                            Processing...
                          </span>
                        );
                      }

                      return (
                        <tr
                          key={doc.id}
                          onClick={() => setSelectedDocId(doc.id)}
                          className={`hover:bg-slate-800/40 cursor-pointer transition ${
                            isSelected ? "bg-indigo-950/30 border-l-4 border-indigo-500" : ""
                          }`}
                        >
                          <td className="py-3 px-4">
                            <p className="font-medium text-slate-200 truncate max-w-[170px]" title={doc.filename}>
                              {doc.filename}
                            </p>
                            <p className="text-xs text-slate-500">
                              {doc.invoice?.vendor_name || doc.file_type.toUpperCase()}
                            </p>
                          </td>
                          <td className="py-3 px-3">{statusBadge}</td>
                          <td className="py-3 px-3 font-mono text-xs">
                            {doc.invoice?.grand_total !== undefined
                              ? `$${doc.invoice.grand_total.toFixed(2)}`
                              : "—"}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {doc.status === "pending" || doc.status === "failed" ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleExtract(doc.id);
                                }}
                                disabled={isExtracting}
                                className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium disabled:opacity-50"
                              >
                                Extract
                              </button>
                            ) : (
                              <span className="text-xs text-indigo-400 hover:underline">
                                View →
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Right Column: Review & Edit View */}
        {selectedDoc && (
          <section className="lg:col-span-7 flex flex-col gap-4 bg-slate-950/70 border border-slate-800 rounded-xl p-5 shadow-lg overflow-y-auto max-h-[calc(100vh-7.5rem)]">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-100">{selectedDoc.filename}</h2>
                  {selectedDoc.invoice?.reviewed_by_human && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                      ✓ Reviewed by Human
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Uploaded: {new Date(selectedDoc.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSelectedDocId(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Status alerts */}
            {selectedDoc.invoice?.needs_review && (
              <div className="bg-amber-500/15 border border-amber-500/40 rounded-lg p-3 text-amber-200 text-xs flex items-start gap-2">
                <span className="text-base leading-none">⚠️</span>
                <div>
                  <p className="font-semibold text-amber-100">Review Required</p>
                  <p className="text-amber-200/90 mt-0.5">
                    This document was flagged by our verification heuristics (e.g. scanned image format, sum discrepancy, or model low confidence). Please verify all highlighted fields before saving.
                  </p>
                </div>
              </div>
            )}

            {hasSumMismatch && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2.5 text-yellow-300 text-xs">
                ⚠️ <strong>Sum Discrepancy:</strong> Line items total ${itemsSum.toFixed(2)} does not equal Grand Total ${Number(editTotal).toFixed(2)} (diff: ${sumDiff.toFixed(2)}).
              </div>
            )}

            {selectedDoc.invoice ? (
              <div className="flex flex-col gap-5">
                {/* Top Fields Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Vendor Name */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                      Vendor Name
                      <span
                        className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                          selectedDoc.invoice.field_confidence?.vendor_name === "high"
                            ? "text-emerald-400 bg-emerald-950/40"
                            : "text-amber-400 bg-amber-950/40"
                        }`}
                      >
                        {selectedDoc.invoice.field_confidence?.vendor_name || "confidence"}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={editVendor}
                      onChange={(e) => setEditVendor(e.target.value)}
                      className={`bg-slate-900 border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 ${
                        selectedDoc.invoice.field_confidence?.vendor_name === "low"
                          ? "border-amber-500/80 ring-amber-500 bg-amber-950/20"
                          : "border-slate-700 focus:border-indigo-500 focus:ring-indigo-500"
                      }`}
                    />
                  </div>

                  {/* Invoice Number */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                      Invoice Number
                      <span
                        className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                          selectedDoc.invoice.field_confidence?.invoice_number === "high"
                            ? "text-emerald-400 bg-emerald-950/40"
                            : "text-amber-400 bg-amber-950/40"
                        }`}
                      >
                        {selectedDoc.invoice.field_confidence?.invoice_number || "confidence"}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={editInvNum}
                      onChange={(e) => setEditInvNum(e.target.value)}
                      className={`bg-slate-900 border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 ${
                        selectedDoc.invoice.field_confidence?.invoice_number === "low"
                          ? "border-amber-500/80 ring-amber-500 bg-amber-950/20"
                          : "border-slate-700 focus:border-indigo-500 focus:ring-indigo-500"
                      }`}
                    />
                  </div>

                  {/* Invoice Date */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                      Invoice Date (YYYY-MM-DD)
                      <span
                        className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                          selectedDoc.invoice.field_confidence?.invoice_date === "high"
                            ? "text-emerald-400 bg-emerald-950/40"
                            : "text-amber-400 bg-amber-950/40"
                        }`}
                      >
                        {selectedDoc.invoice.field_confidence?.invoice_date || "confidence"}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      placeholder="YYYY-MM-DD"
                      className={`bg-slate-900 border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 ${
                        selectedDoc.invoice.field_confidence?.invoice_date === "low"
                          ? "border-amber-500/80 ring-amber-500 bg-amber-950/20"
                          : "border-slate-700 focus:border-indigo-500 focus:ring-indigo-500"
                      }`}
                    />
                  </div>

                  {/* Grand Total */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                      Grand Total ($)
                      <span
                        className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                          selectedDoc.invoice.field_confidence?.grand_total === "high"
                            ? "text-emerald-400 bg-emerald-950/40"
                            : "text-amber-400 bg-amber-950/40"
                        }`}
                      >
                        {selectedDoc.invoice.field_confidence?.grand_total || "confidence"}
                      </span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editTotal}
                      onChange={(e) => setEditTotal(parseFloat(e.target.value) || 0)}
                      className={`bg-slate-900 border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 font-mono ${
                        hasSumMismatch
                          ? "border-amber-500/80 ring-amber-500 bg-amber-950/20"
                          : "border-slate-700 focus:border-indigo-500 focus:ring-indigo-500"
                      }`}
                    />
                  </div>
                </div>

                {/* Line Items Table */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Line Items ({editItems.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        setEditItems((prev) => [
                          ...prev,
                          { description: "New Item", qty: 1, unit_price: 0, total: 0 },
                        ])
                      }
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      + Add Item
                    </button>
                  </div>

                  <div className="border border-slate-800 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="p-2.5">Description</th>
                          <th className="p-2.5 w-16 text-right">Qty</th>
                          <th className="p-2.5 w-24 text-right">Unit Price</th>
                          <th className="p-2.5 w-24 text-right">Total</th>
                          <th className="p-2.5 w-10 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {editItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/40">
                            <td className="p-2">
                              <input
                                type="text"
                                value={item.description}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditItems((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, description: val } : it))
                                  );
                                }}
                                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                value={item.qty}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setEditItems((prev) =>
                                    prev.map((it, i) =>
                                      i === idx
                                        ? { ...it, qty: val, total: Math.round(val * it.unit_price * 100) / 100 }
                                        : it
                                    )
                                  );
                                }}
                                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-right text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                step="0.01"
                                value={item.unit_price}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setEditItems((prev) =>
                                    prev.map((it, i) =>
                                      i === idx
                                        ? { ...it, unit_price: val, total: Math.round(it.qty * val * 100) / 100 }
                                        : it
                                    )
                                  );
                                }}
                                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-right text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                step="0.01"
                                value={item.total}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setEditItems((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, total: val } : it))
                                  );
                                }}
                                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-right text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                              />
                            </td>
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() => setEditItems((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-slate-500 hover:text-rose-400 font-bold"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Footer Save Button */}
                <div className="pt-2 flex items-center justify-between border-t border-slate-800">
                  <div className="text-xs text-slate-400">
                    Calculated Line Items Sum:{" "}
                    <strong className="text-slate-200 font-mono">${itemsSum.toFixed(2)}</strong>
                  </div>
                  <div className="flex items-center gap-3">
                    {saveSuccess && (
                      <span className="text-emerald-400 text-xs font-semibold">
                        ✓ Saved successfully
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleSaveCorrection()}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition shadow-sm"
                    >
                      Save & Mark Reviewed
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-3">
                <p>This document has not been extracted yet.</p>
                <button
                  onClick={() => void handleExtract(selectedDoc.id)}
                  disabled={extractingId === selectedDoc.id}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  {extractingId === selectedDoc.id ? "Extracting..." : "Run Extraction Now"}
                </button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
