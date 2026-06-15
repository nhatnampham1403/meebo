'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Database } from '@trello-optimization/shared';
import type { TrelloList } from '@/lib/trello';

type TeamMemberRow = Database['public']['Tables']['team_members']['Row'];

interface ConfigData {
  teamMembers: TeamMemberRow[];
  trelloLists: TrelloList[];
  config: Array<{ key: string; value: string }>;
}

const emptyMember: Omit<TeamMemberRow, 'id' | 'created_at'> = {
  display_name: '',
  email: null,
  role: '',
  skills: [],
  trello_member_id: '',
  telegram_user_id: null,
  is_active: true,
};

export default function SettingsPage() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<TeamMemberRow>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newMember, setNewMember] = useState({ ...emptyMember });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load');
      setData(await res.json());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function saveMember(payload: Record<string, unknown>) {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'team_member', ...payload }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setSaveMsg('Saved');
      setEditingId(null);
      setAddingNew(false);
      setNewMember({ ...emptyMember });
      await loadData();
    } catch (err) {
      setSaveMsg(`Error: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function deactivateMember(id: string) {
    if (!confirm('Deactivate this team member?')) return;
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'delete_team_member', id }),
    });
    await loadData();
  }

  const card: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    boxShadow: '0 1px 3px rgba(0,0,0,.06)',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      <header
        style={{
          background: '#1e293b',
          color: '#f8fafc',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 56,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 13 }}>
            ← Back
          </Link>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>MeeBo</span>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>Settings</span>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
        {loading && (
          <p style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>Loading…</p>
        )}
        {error && (
          <div style={{ background: '#fee2e2', color: '#dc2626', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            {error}
          </div>
        )}
        {saveMsg && (
          <div
            style={{
              background: saveMsg.startsWith('Error') ? '#fee2e2' : '#dcfce7',
              color: saveMsg.startsWith('Error') ? '#dc2626' : '#166534',
              padding: '8px 14px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {saveMsg}
          </div>
        )}

        {data && (
          <>
            {/* Team Members */}
            <section style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1e293b' }}>
                  Team Members
                </h2>
                <button
                  onClick={() => { setAddingNew(true); setEditingId(null); }}
                  style={btnStyle('#2563eb')}
                >
                  + Add Member
                </button>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                    {['Name', 'Role', 'Skills', 'Trello ID', 'Email', ''].map((h) => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.teamMembers.map((m) =>
                    editingId === m.id ? (
                      <tr key={m.id} style={{ background: '#f0f9ff', borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '6px 10px' }}>
                          <input defaultValue={m.display_name} style={inputStyle}
                            onChange={(e) => setEditDraft((d) => ({ ...d, display_name: e.target.value }))} />
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <input defaultValue={m.role} style={inputStyle}
                            onChange={(e) => setEditDraft((d) => ({ ...d, role: e.target.value }))} />
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <input
                            defaultValue={m.skills.join(', ')}
                            style={inputStyle}
                            placeholder="comma-separated"
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                              }))
                            }
                          />
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <input defaultValue={m.trello_member_id} style={inputStyle}
                            onChange={(e) => setEditDraft((d) => ({ ...d, trello_member_id: e.target.value }))} />
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <input defaultValue={m.email ?? ''} style={inputStyle}
                            onChange={(e) => setEditDraft((d) => ({ ...d, email: e.target.value || null }))} />
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => void saveMember({ ...m, ...editDraft })}
                            disabled={saving}
                            style={btnStyle('#16a34a')}
                          >
                            {saving ? '…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            style={{ ...btnStyle('#6b7280'), marginLeft: 6 }}
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 500 }}>{m.display_name}</td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>{m.role}</td>
                        <td style={{ padding: '8px 10px', color: '#64748b', maxWidth: 200 }}>
                          {m.skills.join(', ') || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>
                          {m.trello_member_id || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>{m.email ?? '—'}</td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => { setEditingId(m.id); setEditDraft({}); }}
                            style={btnStyle('#2563eb')}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void deactivateMember(m.id)}
                            style={{ ...btnStyle('#dc2626'), marginLeft: 6 }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  )}

                  {/* New member row */}
                  {addingNew && (
                    <tr style={{ background: '#f0fdf4', borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '6px 10px' }}>
                        <input placeholder="Name" style={inputStyle}
                          value={newMember.display_name}
                          onChange={(e) => setNewMember((m) => ({ ...m, display_name: e.target.value }))} />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input placeholder="Role" style={inputStyle}
                          value={newMember.role}
                          onChange={(e) => setNewMember((m) => ({ ...m, role: e.target.value }))} />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input placeholder="Node.js, React" style={inputStyle}
                          value={newMember.skills.join(', ')}
                          onChange={(e) =>
                            setNewMember((m) => ({
                              ...m,
                              skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                            }))
                          }
                        />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input placeholder="24-char Trello ID" style={inputStyle}
                          value={newMember.trello_member_id}
                          onChange={(e) => setNewMember((m) => ({ ...m, trello_member_id: e.target.value }))} />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input placeholder="email@example.com" style={inputStyle}
                          value={newMember.email ?? ''}
                          onChange={(e) => setNewMember((m) => ({ ...m, email: e.target.value || null }))} />
                      </td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => void saveMember({ ...newMember })}
                          disabled={saving || !newMember.display_name || !newMember.role}
                          style={btnStyle('#16a34a')}
                        >
                          {saving ? '…' : 'Add'}
                        </button>
                        <button
                          onClick={() => setAddingNew(false)}
                          style={{ ...btnStyle('#6b7280'), marginLeft: 6 }}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {data.teamMembers.length === 0 && !addingNew && (
                <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>
                  No team members yet. Add them here or run{' '}
                  <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
                    npm run seed:members
                  </code>{' '}
                  after filling in <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>scripts/seed-members.ts</code>.
                </p>
              )}
            </section>

            {/* Trello Lists */}
            <section style={card}>
              <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1e293b' }}>
                Trello Board Lists
              </h2>
              {data.trelloLists.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>No lists found (check Trello credentials).</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {data.trelloLists.map((l) => (
                    <span
                      key={l.id}
                      style={{
                        background: '#f1f5f9',
                        padding: '4px 12px',
                        borderRadius: 9999,
                        fontSize: 13,
                        color: '#334155',
                      }}
                    >
                      {l.name}
                    </span>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
