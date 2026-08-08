"use client";

import { useEffect, useState } from "react";
import { Workflow, Plus, Trash2, Key, Play, AlertCircle, CheckCircle2, XCircle, Settings, ExternalLink } from "lucide-react";
import type { DifyPublicProfile, DifyNormalizedParameter } from "@/lib/dify/contracts";

export default function DifyWorkflowView() {
  const [profiles, setProfiles] = useState<DifyPublicProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("https://api.dify.ai/v1");
  const [newApiKey, setNewApiKey] = useState("");
  const [newStudioLink, setNewStudioLink] = useState("");
  const [adding, setAdding] = useState(false);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileSchema, setProfileSchema] = useState<DifyNormalizedParameter[] | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    fetchProfiles();
  }, []);

  useEffect(() => {
    if (selectedProfileId) {
      fetchProfileSchema(selectedProfileId);
    } else {
      setProfileSchema(null);
    }
  }, [selectedProfileId]);

  async function fetchProfiles() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/dify/connections");
      if (!res.ok) throw new Error("Failed to fetch Dify profiles");
      const data = await res.json();
      setProfiles(data.profiles || []);
      if (data.profiles?.length > 0 && !selectedProfileId) {
        setSelectedProfileId(data.profiles[0].id);
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newBaseUrl.trim() || !newApiKey.trim()) return;

    setAdding(true);
    try {
      const res = await fetch("/api/integrations/dify/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          baseUrl: newBaseUrl,
          apiKey: newApiKey,
          studioLink: newStudioLink || undefined
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add profile");
      }

      const data = await res.json();
      setProfiles(prev => [...prev, data.profile]);
      setSelectedProfileId(data.profile.id);

      setNewName("");
      setNewBaseUrl("https://api.dify.ai/v1");
      setNewApiKey("");
      setNewStudioLink("");
      setShowAddForm(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function fetchProfileSchema(id: string) {
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const res = await fetch(`/api/integrations/dify/connections/${id}/workflow`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch schema");
      }
      const data = await res.json();
      setProfileSchema(data.parameters || []);
    } catch (err: any) {
      setSchemaError(err.message);
    } finally {
      setSchemaLoading(false);
    }
  }

  async function handleEnableExecution() {
    if (!selectedProfileId) return;
    setEnabling(true);
    try {
      const res = await fetch("/api/integrations/dify/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: selectedProfileId })
      });
      if (!res.ok) throw new Error("Failed to enable execution");
      alert("Execution gate created successfully. Note: Actual execution will be implemented in a future phase.");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setEnabling(false);
    }
  }

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
            <Workflow size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-bricolage" style={{ color: "var(--text-primary)" }}>
              Dify Workflows
            </h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Connect and execute remote Dify workflows natively in NEWS OS
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-colors"
          style={{ background: "var(--surface-sunken)", color: "var(--text-primary)", border: "1px solid var(--line-soft)" }}
        >
          {showAddForm ? <XCircle size={16} /> : <Plus size={16} />}
          {showAddForm ? "Cancel" : "Add Profile"}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddProfile} className="p-6 rounded-xl space-y-4" style={{ background: "var(--surface-raised)", border: "1px solid var(--line-soft)" }}>
          <h2 className="text-lg font-semibold font-bricolage" style={{ color: "var(--text-primary)" }}>New Dify Connection</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>Profile Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. My Content Generator"
                className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
                style={{ background: "var(--surface-sunken)", color: "var(--text-primary)", border: "1px solid var(--line-soft)" }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>Base URL</label>
              <input
                type="url"
                required
                value={newBaseUrl}
                onChange={e => setNewBaseUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
                style={{ background: "var(--surface-sunken)", color: "var(--text-primary)", border: "1px solid var(--line-soft)" }}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>API Key (Workflow/App secret)</label>
              <input
                type="password"
                required
                value={newApiKey}
                onChange={e => setNewApiKey(e.target.value)}
                placeholder="app-xxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
                style={{ background: "var(--surface-sunken)", color: "var(--text-primary)", border: "1px solid var(--line-soft)" }}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>Studio Link (Optional)</label>
              <input
                type="url"
                value={newStudioLink}
                onChange={e => setNewStudioLink(e.target.value)}
                placeholder="https://cloud.dify.ai/app/..."
                className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
                style={{ background: "var(--surface-sunken)", color: "var(--text-primary)", border: "1px solid var(--line-soft)" }}
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={adding || !newName.trim() || !newBaseUrl.trim() || !newApiKey.trim()}
              className="px-6 py-2 rounded-md font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--text-primary)", color: "var(--bg-primary)" }}
            >
              {adding ? "Saving..." : "Save Connection"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "var(--text-primary)" }}></div>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl flex items-start gap-3 bg-red-500/10 text-red-500 border border-red-500/20">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center rounded-xl" style={{ border: "1px dashed var(--line-soft)" }}>
          <Workflow size={48} className="mb-4 opacity-20" style={{ color: "var(--text-primary)" }} />
          <h3 className="text-lg font-medium font-bricolage mb-2" style={{ color: "var(--text-primary)" }}>No Dify Profiles</h3>
          <p className="max-w-md text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            Connect a Dify App API endpoint to run complex multi-agent workflows directly from NEWS OS.
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-6 py-2 rounded-md font-medium text-sm transition-colors"
            style={{ background: "var(--text-primary)", color: "var(--bg-primary)" }}
          >
            Add First Profile
          </button>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
          {/* Sidebar: Profile List */}
          <div className="flex flex-col space-y-3 overflow-y-auto pr-2">
            {profiles.map(profile => (
              <button
                key={profile.id}
                onClick={() => setSelectedProfileId(profile.id)}
                className="w-full text-left p-4 rounded-xl border transition-all"
                style={{
                  background: selectedProfileId === profile.id ? "var(--surface-raised)" : "var(--surface-sunken)",
                  borderColor: selectedProfileId === profile.id ? "var(--line-hard)" : "var(--line-soft)",
                  transform: selectedProfileId === profile.id ? "scale(1)" : "scale(0.98)"
                }}
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold font-bricolage truncate pr-2" style={{ color: "var(--text-primary)" }}>
                    {profile.name}
                  </h3>
                  {profile.health === "healthy" ? (
                    <div className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <CheckCircle2 size={12} /> Healthy
                    </div>
                  ) : profile.health === "offline" ? (
                    <div className="flex items-center gap-1 text-xs text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <XCircle size={12} /> Offline
                    </div>
                  ) : profile.health === "unauthorized" ? (
                    <div className="flex items-center gap-1 text-xs text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <Key size={12} /> Auth Error
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: "var(--surface-sunken)", color: "var(--text-muted)" }}>
                      <AlertCircle size={12} /> Unknown
                    </div>
                  )}
                </div>
                {profile.info?.description && (
                  <p className="text-xs line-clamp-2 mb-2" style={{ color: "var(--text-muted)" }}>
                    {profile.info.description}
                  </p>
                )}
                <div className="text-[10px] font-mono truncate" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                  {profile.baseUrl}
                </div>
              </button>
            ))}
          </div>

          {/* Main Area: Schema & Execution */}
          <div className="lg:col-span-2 flex flex-col p-6 rounded-xl overflow-y-auto" style={{ background: "var(--surface-raised)", border: "1px solid var(--line-soft)" }}>
            {selectedProfile ? (
              <>
                <div className="flex items-start justify-between mb-8">
                  <div>
                    <h2 className="text-2xl font-bold font-bricolage mb-1" style={{ color: "var(--text-primary)" }}>
                      {selectedProfile.info?.name || selectedProfile.name}
                    </h2>
                    {selectedProfile.info?.description && (
                      <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
                        {selectedProfile.info.description}
                      </p>
                    )}
                  </div>
                  {selectedProfile.studioLink && (
                    <a
                      href={selectedProfile.studioLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium hover:opacity-80 transition-opacity"
                      style={{ background: "var(--surface-sunken)", color: "var(--text-primary)" }}
                    >
                      <ExternalLink size={14} /> Open in Studio
                    </a>
                  )}
                </div>

                {schemaLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "var(--text-primary)" }}></div>
                  </div>
                ) : schemaError ? (
                  <div className="p-4 rounded-xl flex items-start gap-3 bg-red-500/10 text-red-500 border border-red-500/20">
                    <AlertCircle size={20} className="shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold mb-1">Failed to fetch schema</h4>
                      <p className="text-sm opacity-90">{schemaError}</p>
                    </div>
                  </div>
                ) : profileSchema ? (
                  <div className="flex-1 flex flex-col">
                    <div className="flex-1 space-y-6">
                      <h3 className="font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                        <Settings size={18} /> Input Parameters
                      </h3>

                      {profileSchema.length === 0 ? (
                        <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
                          This workflow does not require any input parameters.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-5">
                          {profileSchema.map(param => (
                            <div key={param.name} className="space-y-1.5">
                              <label className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                                {param.label || param.name}
                                {param.required && <span className="text-red-500">*</span>}
                                <span className="text-xs px-1.5 py-0.5 rounded bg-black/20 font-mono" style={{ color: "var(--text-muted)" }}>
                                  {param.type}
                                </span>
                              </label>

                              {param.description && (
                                <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>{param.description}</p>
                              )}

                              {param.type === "paragraph" ? (
                                <textarea
                                  placeholder={String(param.defaultValue || "")}
                                  className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none min-h-[100px] resize-y"
                                  style={{ background: "var(--surface-sunken)", color: "var(--text-primary)", border: "1px solid var(--line-soft)" }}
                                />
                              ) : param.type === "number" ? (
                                <input
                                  type="number"
                                  placeholder={String(param.defaultValue || "")}
                                  className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
                                  style={{ background: "var(--surface-sunken)", color: "var(--text-primary)", border: "1px solid var(--line-soft)" }}
                                  min={param.min}
                                  max={param.max}
                                />
                              ) : param.type === "select" ? (
                                <select
                                  className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
                                  style={{ background: "var(--surface-sunken)", color: "var(--text-primary)", border: "1px solid var(--line-soft)" }}
                                  defaultValue={String(param.defaultValue || "")}
                                >
                                  {param.options?.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              ) : param.type === "boolean" ? (
                                <div className="flex items-center gap-3 py-2">
                                  <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" defaultChecked={Boolean(param.defaultValue)} />
                                    <div className="w-9 h-5 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" style={{ background: "var(--line-soft)" }}></div>
                                  </label>
                                </div>
                              ) : (
                                <input
                                  type="text"
                                  placeholder={String(param.defaultValue || "")}
                                  className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
                                  style={{ background: "var(--surface-sunken)", color: "var(--text-primary)", border: "1px solid var(--line-soft)" }}
                                  maxLength={param.maxLength}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-8 pt-6 flex items-center justify-between" style={{ borderTop: "1px solid var(--line-soft)" }}>
                      <button
                        onClick={handleEnableExecution}
                        disabled={enabling}
                        className="px-4 py-2 rounded-md font-medium text-sm transition-colors border hover:bg-black/10"
                        style={{ color: "var(--text-primary)", borderColor: "var(--line-soft)" }}
                      >
                        {enabling ? "Enabling..." : "Enable Dify Execution"}
                      </button>

                      <button
                        disabled
                        className="flex items-center gap-2 px-6 py-2.5 rounded-md font-medium text-sm transition-colors opacity-50 cursor-not-allowed"
                        style={{ background: "var(--text-primary)", color: "var(--bg-primary)" }}
                        title="Execution will be implemented in a future phase"
                      >
                        <Play size={16} fill="currentColor" /> Run Workflow
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>Select a profile to view workflow schema</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}