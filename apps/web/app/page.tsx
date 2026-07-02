'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Database } from '@trello-optimization/shared';

type DraftRow = Database['public']['Tables']['task_drafts']['Row'];
type ReviewStatus = DraftRow['review_status'];
type Priority = DraftRow['priority'];

interface TeamMember {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  skills: string[];
  trello_member_id: string;
  is_active: boolean;
}

const PRIORITY_COLORS: Record<Priority, string> = {
  high: '#dc2626',
  medium: '#d97706',
  low: '#16a34a',
};

const STATUS_META: Record<ReviewStatus, { bg: string; text: string; label: string }> = {
  pending:              { bg: '#f3f4f6', text: '#374151',  label: 'Pending' },
  needs_clarification:  { bg: '#fef3c7', text: '#92400e',  label: 'Needs Clarification' },
  approved:             { bg: '#dcfce7', text: '#166534',  label: 'Approved' },
  rejected:             { bg: '#fee2e2', text: '#991b1b',  label: 'Rejected' },
};

function Badge({ status }: { status: ReviewStatus }) {
  const { bg, text, label } = STATUS_META[status];
  return (
    <span style={{ background: bg, color: text, padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function hasOwner(draft: DraftRow): boolean {
  if (draft.owners && draft.owners.length > 0) return true;
  return !!draft.owner?.trim();
}

function canApprove(draft: DraftRow): boolean {
  return (
    draft.review_status !== 'approved' &&
    draft.review_status !== 'rejected' &&
    !draft.needs_clarification &&
    hasOwner(draft) &&
    !!draft.due_date
  );
}

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '100%', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 8px',
    fontSize: 13, fontFamily: 'inherit', background: disabled ? '#f8fafc' : '#fff',
    color: disabled ? '#64748b' : '#1e293b', cursor: disabled ? 'default' : 'text',
    outline: 'none', boxSizing: 'border-box',
  };
}

// ─── Feature 2: Owner cell with multi-select + "Other" Trello lookup ──────────

function draftOwners(draft: DraftRow): string[] {
  if (draft.owners && draft.owners.length > 0) return draft.owners;
  return draft.owner ? [draft.owner] : [];
}

function OwnerCell({
  draft,
  teamMembers,
  isLocked,
  onUpdate,
}: {
  draft: DraftRow;
  teamMembers: TeamMember[];
  isLocked: boolean;
  onUpdate: (id: string, fields: Partial<DraftRow>) => Promise<void>;
}) {
  const owners = draftOwners(draft);
  const [showOther, setShowOther] = useState(false);
  const [otherInput, setOtherInput] = useState('');
  const [resolve, setResolve] = useState<{
    status: 'idle' | 'loading' | 'found' | 'error';
    message?: string;
  }>({ status: 'idle' });

  if (isLocked) {
    return <span style={{ fontSize: 13, color: '#64748b' }}>{owners.join(', ') || '—'}</span>;
  }

  // Persist an updated owners list, keeping owner (legacy) = owners[0].
  async function saveOwners(next: string[]) {
    const deduped = Array.from(new Set(next));
    await onUpdate(draft.id, {
      owners: deduped,
      owner: deduped[0] ?? null,
    });
  }

  function toggleMember(name: string, checked: boolean) {
    const next = checked ? [...owners, name] : owners.filter((o) => o !== name);
    void saveOwners(next);
  }

  async function handleOtherBlur() {
    const q = otherInput.trim();
    if (!q || resolve.status === 'found') return;
    setResolve({ status: 'loading' });
    try {
      const res = await fetch('/api/resolve-trello-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResolve({ status: 'error', message: 'Trello member not found' });
        return;
      }
      const fullName = json.full_name as string;
      setResolve({ status: 'found', message: fullName });
      await saveOwners([...owners, fullName]);
      setOtherInput('');
      setShowOther(false);
      setResolve({ status: 'idle' });
    } catch {
      setResolve({ status: 'error', message: 'Lookup failed' });
    }
  }

  const memberNames = new Set(teamMembers.map((m) => m.display_name));
  const extraOwners = owners.filter((o) => !memberNames.has(o));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
      {owners.length > 0 && (
        <div style={{ fontSize: 12, color: '#1e293b', fontWeight: 500 }}>{owners.join(', ')}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 120, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 6px', background: '#fff' }}>
        {teamMembers.map((m) => (
          <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: '#334155' }}>
            <input
              type="checkbox"
              checked={owners.includes(m.display_name)}
              onChange={(e) => toggleMember(m.display_name, e.target.checked)}
            />
            {m.display_name}
          </label>
        ))}
        {extraOwners.map((name) => (
          <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: '#334155' }}>
            <input
              type="checkbox"
              checked
              onChange={(e) => toggleMember(name, e.target.checked)}
            />
            {name} <span style={{ color: '#94a3b8' }}>(external)</span>
          </label>
        ))}
      </div>
      {showOther ? (
        <>
          <input
            value={otherInput}
            onChange={(e) => { setOtherInput(e.target.value); setResolve({ status: 'idle' }); }}
            onBlur={() => void handleOtherBlur()}
            placeholder="Trello username or email"
            style={{ ...inputStyle(false), fontSize: 12 }}
          />
          {resolve.status === 'loading' && <span style={{ fontSize: 11, color: '#94a3b8' }}>Looking up…</span>}
          {resolve.status === 'error' && <span style={{ fontSize: 11, color: '#dc2626' }}>{resolve.message}</span>}
        </>
      ) : (
        <button
          onClick={() => { setShowOther(true); setResolve({ status: 'idle' }); }}
          style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 11, cursor: 'pointer', textAlign: 'left', padding: 0 }}
        >
          + Add other…
        </button>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Filter = 'pending' | 'all';

export default function Page() {
  // Extract state
  const [notes, setNotes] = useState('');
  const [sourceType, setSourceType] = useState<'sprint_meeting' | 'customer_meeting'>('sprint_meeting');
  const [pdfFile, setPdfFile] = useState<File | null>(null);           // Feature 3
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  // Draft state
  const [allDrafts, setAllDrafts] = useState<DraftRow[]>([]);
  const [filter, setFilter] = useState<Filter>('pending');
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<Record<string, { ok: boolean; msg: string }>>({});

  // Feature 1 — bulk actions
  const [approvingAll, setApprovingAll] = useState(false);
  const [rejectingAll, setRejectingAll] = useState(false);
  const [bulkSkipCount, setBulkSkipCount] = useState<number | null>(null);

  // Feature 2 — team members for owner dropdown
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // ── Load data on mount ──────────────────────────────────────────────────────
  const loadDrafts = useCallback(async () => {
    try {
      const res = await fetch('/api/drafts');
      if (!res.ok) return;
      const data: DraftRow[] = await res.json();
      setAllDrafts(data);
    } catch { /* silently fail */ }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return;
      const data = await res.json();
      const members: TeamMember[] = (data.teamMembers ?? []) as TeamMember[];
      setTeamMembers(members.filter((m) => m.is_active));
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => {
    void loadDrafts();
    void loadConfig();
  }, [loadDrafts, loadConfig]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const drafts = filter === 'pending'
    ? allDrafts.filter((d) => d.review_status === 'pending' || d.review_status === 'needs_clarification')
    : allDrafts;

  const pendingCount = allDrafts.filter(
    (d) => d.review_status === 'pending' || d.review_status === 'needs_clarification',
  ).length;
  const approvedCount = allDrafts.filter((d) => d.review_status === 'approved').length;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function setMsg(id: string, ok: boolean, msg: string) {
    setActionMsg((prev) => ({ ...prev, [id]: { ok, msg } }));
  }
  function clearMsg(id: string) {
    setActionMsg((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  // ── Extract ─────────────────────────────────────────────────────────────────
  async function handleExtract() {
    if (!notes.trim() && !pdfFile) return;
    setExtracting(true);
    setExtractError(null);
    setSummary(null);
    try {
      let res: Response;
      if (pdfFile) {
        // Feature 3: multipart upload
        const form = new FormData();
        form.append('pdf_file', pdfFile);
        form.append('source_type', sourceType);
        res = await fetch('/api/extract', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_text: notes, source_type: sourceType }),
        });
      }
      const json = await res.json();
      if (!res.ok) { setExtractError(json.error ?? 'Extraction failed'); return; }
      setSummary(json.summary);
      setAllDrafts((prev) => [...(json.drafts as DraftRow[]), ...prev]);
      setNotes('');
      setPdfFile(null);
    } catch (err) {
      setExtractError(String(err));
    } finally {
      setExtracting(false);
    }
  }

  // ── Single-row field change (optimistic) ────────────────────────────────────
  async function handleFieldChange(id: string, field: string, value: string | null) {
    setAllDrafts((prev) => prev.map((d) => d.id === id ? { ...d, [field]: value } : d));
    try {
      await fetch(`/api/drafts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
    } catch { /* optimistic — ignore */ }
  }

  // Feature 2: multi-field update (owner + trello_member_id)
  async function handleFieldsUpdate(id: string, fields: Partial<DraftRow>) {
    setAllDrafts((prev) => prev.map((d) => d.id === id ? { ...d, ...fields } : d));
    try {
      await fetch(`/api/drafts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
    } catch { /* optimistic — ignore */ }
  }

  // ── Single approve ───────────────────────────────────────────────────────────
  async function handleApprove(draft: DraftRow) {
    setApproving(draft.id);
    clearMsg(draft.id);
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draft.id }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg(draft.id, false, json.error ?? 'Approval failed'); return; }
      setAllDrafts((prev) => prev.map((d) =>
        d.id === draft.id ? { ...d, review_status: 'approved', trello_card_url: json.card_url ?? d.trello_card_url } : d,
      ));
      setMsg(draft.id, true, json.status === 'already_approved' ? 'Already approved' : '✓ Card created');
    } catch (err) {
      setMsg(draft.id, false, String(err));
    } finally {
      setApproving(null);
    }
  }

  // ── Single reject ────────────────────────────────────────────────────────────
  async function handleReject(draft: DraftRow) {
    if (!confirm(`Reject "${draft.extracted_title}"? This cannot be undone.`)) return;
    setRejecting(draft.id);
    clearMsg(draft.id);
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: 'rejected' }),
      });
      if (!res.ok) {
        const json = await res.json();
        setMsg(draft.id, false, json.error ?? 'Reject failed');
        return;
      }
      setAllDrafts((prev) => prev.map((d) =>
        d.id === draft.id ? { ...d, review_status: 'rejected' } : d,
      ));
    } catch (err) {
      setMsg(draft.id, false, String(err));
    } finally {
      setRejecting(null);
    }
  }

  // ── Feature 1: Approve All ────────────────────────────────────────────────────
  async function handleApproveAll() {
    setBulkSkipCount(null);
    const activeDrafts = drafts.filter(
      (d) => d.review_status !== 'approved' && d.review_status !== 'rejected',
    );
    const toApprove = activeDrafts.filter((d) => canApprove(d));
    const skipped = activeDrafts.filter((d) => d.needs_clarification).length;

    if (toApprove.length === 0) {
      if (skipped > 0) setBulkSkipCount(skipped);
      return;
    }

    setApprovingAll(true);
    for (const draft of toApprove) {
      setApproving(draft.id);
      clearMsg(draft.id);
      try {
        const res = await fetch('/api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft_id: draft.id }),
        });
        const json = await res.json();
        if (res.ok) {
          setAllDrafts((prev) => prev.map((d) =>
            d.id === draft.id
              ? { ...d, review_status: 'approved', trello_card_url: json.card_url ?? d.trello_card_url }
              : d,
          ));
          setMsg(draft.id, true, json.status === 'already_approved' ? 'Already approved' : '✓ Card created');
        } else {
          setMsg(draft.id, false, json.error ?? 'Approval failed');
        }
      } catch (err) {
        setMsg(draft.id, false, String(err));
      }
    }
    setApproving(null);
    setApprovingAll(false);
    if (skipped > 0) setBulkSkipCount(skipped);
  }

  // ── Feature 1: Reject All ─────────────────────────────────────────────────────
  async function handleRejectAll() {
    const activeDrafts = drafts.filter(
      (d) => d.review_status !== 'approved' && d.review_status !== 'rejected',
    );
    if (activeDrafts.length === 0) return;
    if (!confirm(`Reject all ${activeDrafts.length} pending task(s)? This cannot be undone.`)) return;

    setRejectingAll(true);
    for (const draft of activeDrafts) {
      try {
        const res = await fetch(`/api/drafts/${draft.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ review_status: 'rejected' }),
        });
        if (res.ok) {
          setAllDrafts((prev) => prev.map((d) =>
            d.id === draft.id ? { ...d, review_status: 'rejected' } : d,
          ));
        }
      } catch { /* continue */ }
    }
    setRejectingAll(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const canExtract = !extracting && (notes.trim().length > 0 || pdfFile !== null);
  const activePendingCount = drafts.filter(
    (d) => d.review_status !== 'approved' && d.review_status !== 'rejected',
  ).length;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <header style={{ background: '#1e293b', color: '#f8fafc', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>MeeBo</span>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>Task Capture & Review</span>
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 13, color: '#94a3b8' }}>
          <span><strong style={{ color: '#fbbf24' }}>{pendingCount}</strong> pending</span>
          <span><strong style={{ color: '#4ade80' }}>{approvedCount}</strong> approved</span>
          <Link href="/settings" style={{ color: '#7dd3fc', textDecoration: 'none' }}>⚙ Settings</Link>
        </div>
      </header>

      <main style={{ maxWidth: 1300, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── Capture box ────────────────────────────────────────────────────── */}
        <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1e293b' }}>Paste Meeting Notes</h2>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
            style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '8px 12px', fontSize: 14, background: '#fff', cursor: 'pointer', marginBottom: 12 }}
          >
            <option value="sprint_meeting">Sprint Meeting</option>
            <option value="customer_meeting">Customer Meeting</option>
          </select>

          <textarea
            value={notes}
            onChange={(e) => { setNotes(e.target.value); if (e.target.value) setPdfFile(null); }}
            placeholder="Paste meeting notes here — Vietnamese or English, any format…"
            rows={6}
            style={{ display: 'block', width: '100%', border: '1px solid #cbd5e1', borderRadius: 8, padding: 12, fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
          />

          {/* Feature 3 — PDF upload */}
          <div style={{ marginTop: 12, padding: '14px 16px', border: '1px dashed #cbd5e1', borderRadius: 8, background: pdfFile ? '#f0fdf4' : '#f8fafc', textAlign: 'center' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#64748b' }}>— or upload a PDF —</p>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setPdfFile(file);
                if (file) setNotes('');
                e.target.value = '';
              }}
              style={{ fontSize: 13, cursor: 'pointer' }}
            />
            {pdfFile && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>📄 {pdfFile.name}</span>
                <button
                  onClick={() => setPdfFile(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12, padding: '0 4px' }}
                >✕</button>
              </div>
            )}
          </div>

          {extractError && (
            <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0', padding: '8px 12px', background: '#fee2e2', borderRadius: 6 }}>
              {extractError}
            </p>
          )}
          <button
            onClick={() => void handleExtract()}
            disabled={!canExtract}
            style={{ marginTop: 12, background: canExtract ? '#2563eb' : '#94a3b8', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: canExtract ? 'pointer' : 'not-allowed' }}
          >
            {extracting ? 'Extracting…' : 'Extract Tasks'}
          </button>
        </section>

        {/* ── Summary banner ─────────────────────────────────────────────────── */}
        {summary && (
          <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontSize: 14, color: '#713f12', lineHeight: 1.6 }}>
            <strong style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#92400e' }}>Meeting Summary</strong>
            {summary}
          </div>
        )}

        {/* ── Draft table ─────────────────────────────────────────────────────── */}
        {allDrafts.length > 0 && (
          <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>

            {/* Table header bar */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1e293b' }}>Task Drafts</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Click cells to edit • Approve requires owner + due date</span>
                {/* Filter toggle */}
                <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, padding: 3, gap: 2 }}>
                  {(['pending', 'all'] as Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      style={{
                        border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: filter === f ? '#fff' : 'transparent',
                        color: filter === f ? '#1e293b' : '#64748b',
                        boxShadow: filter === f ? '0 1px 2px rgba(0,0,0,.1)' : 'none',
                      }}
                    >
                      {f === 'pending' ? `Pending (${pendingCount})` : `All (${allDrafts.length})`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Feature 1 — Bulk action bar */}
            {activePendingCount > 0 && (
              <div style={{ padding: '10px 20px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#64748b', marginRight: 4 }}>Bulk actions:</span>
                <button
                  onClick={() => void handleApproveAll()}
                  disabled={approvingAll || rejectingAll}
                  style={{
                    background: approvingAll ? '#94a3b8' : '#16a34a',
                    color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px',
                    fontSize: 12, fontWeight: 600, cursor: approvingAll ? 'not-allowed' : 'pointer',
                  }}
                >
                  {approvingAll ? 'Approving…' : '✅ Approve All'}
                </button>
                <button
                  onClick={() => void handleRejectAll()}
                  disabled={approvingAll || rejectingAll}
                  style={{
                    background: rejectingAll ? '#94a3b8' : '#fff',
                    color: rejectingAll ? '#fff' : '#dc2626',
                    border: '1px solid #fca5a5', borderRadius: 6, padding: '5px 14px',
                    fontSize: 12, fontWeight: 600, cursor: rejectingAll ? 'not-allowed' : 'pointer',
                  }}
                >
                  {rejectingAll ? 'Rejecting…' : '❌ Reject All'}
                </button>
                {bulkSkipCount !== null && bulkSkipCount > 0 && (
                  <span style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', padding: '4px 10px', borderRadius: 6 }}>
                    {bulkSkipCount} task{bulkSkipCount !== 1 ? 's' : ''} skipped — needs clarification. Review them individually.
                  </span>
                )}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    {['Title', 'Project', 'Owner', 'Due Date', 'Priority', 'Status', 'Actions'].map((h) => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drafts.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                        No pending drafts — switch to &quot;All&quot; to see approved/rejected.
                      </td>
                    </tr>
                  ) : drafts.map((draft) => {
                    const isLocked = draft.review_status === 'approved' || draft.review_status === 'rejected';
                    const isClarification = draft.review_status === 'needs_clarification';
                    const isApproved = draft.review_status === 'approved';
                    const isRejected = draft.review_status === 'rejected';
                    const rowBg = isClarification ? '#fffbeb' : isApproved ? '#f0fdf4' : isRejected ? '#fef2f2' : '#fff';
                    const msg = actionMsg[draft.id];

                    return (
                      <tr key={draft.id} style={{ background: rowBg, borderBottom: '1px solid #f1f5f9', opacity: isRejected ? 0.65 : 1 }}>

                        {/* Title */}
                        <td style={{ padding: '8px 12px', minWidth: 200, maxWidth: 280 }}>
                          <input
                            key={draft.id + draft.extracted_title}
                            defaultValue={draft.extracted_title}
                            disabled={isLocked}
                            onBlur={(e) => void handleFieldChange(draft.id, 'extracted_title', e.target.value)}
                            style={inputStyle(isLocked)}
                          />
                        </td>

                        {/* Project */}
                        <td style={{ padding: '8px 12px', minWidth: 140 }}>
                          <input
                            key={draft.id + (draft.project ?? '')}
                            defaultValue={draft.project ?? ''}
                            disabled={isLocked}
                            onBlur={(e) => void handleFieldChange(draft.id, 'project', e.target.value || null)}
                            style={inputStyle(isLocked)}
                          />
                        </td>

                        {/* Owner — Feature 2 dropdown */}
                        <td style={{ padding: '8px 12px', minWidth: 160 }}>
                          <OwnerCell
                            draft={draft}
                            teamMembers={teamMembers}
                            isLocked={isLocked}
                            onUpdate={handleFieldsUpdate}
                          />
                          {!hasOwner(draft) && !isLocked && (
                            <span style={{ fontSize: 10, color: '#f59e0b', display: 'block', marginTop: 2 }}>Required for approve</span>
                          )}
                        </td>

                        {/* Due Date */}
                        <td style={{ padding: '8px 12px', minWidth: 130 }}>
                          <input
                            key={draft.id + (draft.due_date ?? '')}
                            type="date"
                            defaultValue={draft.due_date ?? ''}
                            disabled={isLocked}
                            onBlur={(e) => void handleFieldChange(draft.id, 'due_date', e.target.value || null)}
                            style={{
                              ...inputStyle(isLocked),
                              border: !draft.due_date && !isLocked ? '1px solid #fca5a5' : inputStyle(isLocked).border,
                            }}
                          />
                        </td>

                        {/* Priority */}
                        <td style={{ padding: '8px 12px' }}>
                          <select
                            key={draft.id + draft.priority}
                            defaultValue={draft.priority}
                            disabled={isLocked}
                            onChange={(e) => void handleFieldChange(draft.id, 'priority', e.target.value)}
                            style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '3px 6px', fontSize: 12, color: PRIORITY_COLORS[draft.priority], fontWeight: 600, background: isLocked ? '#f8fafc' : '#fff', cursor: isLocked ? 'default' : 'pointer' }}
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </td>

                        {/* Status */}
                        <td style={{ padding: '8px 12px' }}>
                          <Badge status={draft.review_status} />
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                          {isApproved && (
                            draft.trello_card_url
                              ? <a href={draft.trello_card_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: 12 }}>View card ↗</a>
                              : <span style={{ color: '#94a3b8', fontSize: 12 }}>Approved</span>
                          )}
                          {isRejected && <span style={{ color: '#94a3b8', fontSize: 12 }}>Rejected</span>}
                          {!isLocked && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <button
                                onClick={() => void handleApprove(draft)}
                                disabled={!canApprove(draft) || approving === draft.id || approvingAll}
                                title={!canApprove(draft) ? 'Set owner and due date first (no clarification needed)' : 'Create Trello card'}
                                style={{ background: canApprove(draft) ? '#16a34a' : '#d1d5db', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: canApprove(draft) ? 'pointer' : 'not-allowed' }}
                              >
                                {approving === draft.id ? '…' : 'Approve'}
                              </button>
                              <button
                                onClick={() => void handleReject(draft)}
                                disabled={rejecting === draft.id || rejectingAll}
                                style={{ background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                              >
                                {rejecting === draft.id ? '…' : 'Reject'}
                              </button>
                              {msg && (
                                <span style={{ fontSize: 11, color: msg.ok ? '#16a34a' : '#dc2626' }}>
                                  {msg.msg}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {allDrafts.length === 0 && !extracting && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontSize: 15 }}>
            No drafts yet — paste meeting notes above or upload a PDF to get started.
          </div>
        )}
      </main>
    </div>
  );
}
