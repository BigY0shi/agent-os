'use client';

import React, { useState } from 'react';
import {
  Settings,
  Palette,
  Link2,
  Database,
  Shield,
  Cpu,
  Save,
  Trash2,
  Plus,
  X,
  Check,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  ChevronRight,
} from 'lucide-react';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // General Settings
  const [appName, setAppName] = useState('Agent OS');
  const [defaultSection, setDefaultSection] = useState('social-media');
  const [theme, setTheme] = useState('dark');
  const [notifications, setNotifications] = useState({
    email: true,
    browser: true,
    sound: false,
  });

  // Harness Config — Proxmox LXCs; Hermes Workspace = full app on :3000 (not Nous dashboard :9119)
  const [harnesses, setHarnesses] = useState({
    'hermes-workspace': {
      enabled: true,
      apiKey: '',
      endpoint: 'http://192.168.0.168:3000',
      gatewayUrl: 'http://192.168.0.168:8642',
    },
    openclaw: {
      enabled: false,
      apiKey: '',
      endpoint: '',
      gatewayUrl: 'http://localhost:18789',
    },
    honcho: { enabled: true, apiKey: '', endpoint: '' },
    'claude-code': { enabled: false, apiKey: '', endpoint: '' },
    codex: { enabled: false, apiKey: '', endpoint: '' },
    gemini: { enabled: false, apiKey: '', endpoint: '' },
    crewai: { enabled: false, apiKey: '', endpoint: '' },
    custom: { enabled: false, apiKey: '', endpoint: '' },
  });

  const HARNESS_META = {
    'hermes-workspace': {
      label: 'Hermes Workspace',
      hint: 'Full operator UI (:3000) + gateway (:8642). Not the Nous hermes dashboard (:9119).',
      endpointLabel: 'Workspace UI URL',
      endpointPlaceholder: 'http://192.168.0.168:3000',
      showGateway: true,
    },
    openclaw: {
      label: 'OpenClaw',
      hint: 'Gateway only—no workspace UI. Agent OS covers fleet orchestration.',
      endpointLabel: 'Notes / docs URL (optional)',
      endpointPlaceholder: 'https://docs.openclaw.dev',
      showGateway: true,
    },
    honcho: {
      label: 'Honcho (memory LXC)',
      hint: 'Shared dialectic memory—Hermes connected; Claude/Codex/Gemini planned.',
      endpointLabel: 'Honcho API base URL',
      endpointPlaceholder: 'http://honcho.lxc:8000 or https://api.honcho.dev',
      showGateway: false,
    },
    'claude-code': {
      label: 'Claude Code',
      hint: 'IDE/CLI harness—will share Honcho workspace when wired.',
      endpointLabel: 'Endpoint (optional)',
      endpointPlaceholder: '',
      showGateway: false,
    },
    codex: {
      label: 'Codex',
      hint: 'Planned Honcho peer—configure when deployed.',
      endpointLabel: 'Endpoint (optional)',
      endpointPlaceholder: '',
      showGateway: false,
    },
    gemini: {
      label: 'Gemini',
      hint: 'Planned Honcho peer—configure when deployed.',
      endpointLabel: 'Endpoint (optional)',
      endpointPlaceholder: '',
      showGateway: false,
    },
    crewai: {
      label: 'CrewAI (legacy)',
      hint: 'Optional—primary stack is Hermes Workspace + OpenClaw on Proxmox.',
      endpointLabel: 'Endpoint URL',
      endpointPlaceholder: 'https://api.example.com',
      showGateway: false,
    },
    custom: {
      label: 'Custom harness',
      hint: '',
      endpointLabel: 'Endpoint URL',
      endpointPlaceholder: 'https://api.example.com',
      showGateway: false,
    },
  };

  const [showApiKey, setShowApiKey] = useState({});

  // Sections
  const [sections, setSections] = useState([
    { id: 'social-media', name: 'Social Media', color: '#FF6B00' },
    { id: 'marketing', name: 'Marketing', color: '#6B47FF' },
    { id: 'market-research', name: 'Market Research', color: '#00B4D8' },
    { id: 'freelance', name: 'Freelance', color: '#00D084' },
    { id: 'devops', name: 'DevOps', color: '#FF006E' },
  ]);
  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionColor, setNewSectionColor] = useState('#FF6B00');

  // API & Integrations
  const [webhookUrl, setWebhookUrl] = useState('https://api.agent-os.local/webhooks');
  const [apiKey, setApiKey] = useState('sk_live_abc123def456');
  const [showApiKeyFull, setShowApiKeyFull] = useState(false);
  const [rateLimit, setRateLimit] = useState('1000');
  const [rateLimitWindow, setRateLimitWindow] = useState('3600');

  // Data & Storage
  const [storageUsage, setStorageUsage] = useState(45);
  const [databaseSize, setDatabaseSize] = useState('2.3 GB');

  // Handlers
  const handleHarnessChange = (harness, field, value) => {
    setHarnesses((prev) => ({
      ...prev,
      [harness]: { ...prev[harness], [field]: value },
    }));
  };

  const toggleHarness = (harness) => {
    setHarnesses((prev) => ({
      ...prev,
      [harness]: { ...prev[harness], enabled: !prev[harness].enabled },
    }));
  };

  const toggleApiKeyVisibility = (harness) => {
    setShowApiKey((prev) => ({
      ...prev,
      [harness]: !prev[harness],
    }));
  };

  const addSection = () => {
    if (newSectionName.trim()) {
      const newId = newSectionName.toLowerCase().replace(/\s+/g, '-');
      setSections((prev) => [
        ...prev,
        { id: newId, name: newSectionName, color: newSectionColor },
      ]);
      setNewSectionName('');
      setNewSectionColor('#FF6B00');
    }
  };

  const removeSection = (id) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  };

  const updateSection = (id, field, value) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const handleSave = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleExportData = () => {
    const data = {
      appName,
      defaultSection,
      theme,
      notifications,
      harnesses,
      sections,
      webhookUrl,
      rateLimit,
      rateLimitWindow,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-os-settings-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearData = () => {
    if (
      window.confirm(
        'Are you sure? This will delete all stored data and cannot be undone.'
      )
    ) {
      setAppName('Agent OS');
      setDefaultSection('social-media');
      setSections([
        { id: 'social-media', name: 'Social Media', color: '#FF6B00' },
        { id: 'marketing', name: 'Marketing', color: '#6B47FF' },
        { id: 'market-research', name: 'Market Research', color: '#00B4D8' },
        { id: 'freelance', name: 'Freelance', color: '#00D084' },
        { id: 'devops', name: 'DevOps', color: '#FF006E' },
      ]);
      setStorageUsage(0);
    }
  };

  const styles = {
    container: {
      backgroundColor: 'var(--bg-base)',
      minHeight: '100vh',
      padding: '2rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    header: {
      marginBottom: '2rem',
    },
    title: {
      fontSize: '1.875rem',
      fontWeight: '600',
      color: 'var(--text-primary)',
      marginBottom: '0.5rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
    },
    subtitle: {
      color: 'var(--text-secondary)',
      fontSize: '0.875rem',
    },
    tabsContainer: {
      display: 'flex',
      gap: '0.5rem',
      marginBottom: '2rem',
      borderBottom: '1px solid var(--border-default)',
      overflow: 'auto',
    },
    tab: (isActive) => ({
      padding: '0.75rem 1.5rem',
      border: 'none',
      backgroundColor: 'transparent',
      color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
      cursor: 'pointer',
      fontSize: '0.875rem',
      fontWeight: '500',
      borderBottom: isActive ? '2px solid var(--accent)' : 'none',
      transition: 'all 0.2s ease',
      whiteSpace: 'nowrap',
    }),
    contentContainer: {
      maxWidth: '800px',
    },
    section: {
      backgroundColor: 'var(--bg-surface)',
      borderRadius: '0.5rem',
      border: '1px solid var(--border-default)',
      padding: '1.5rem',
      marginBottom: '1.5rem',
    },
    sectionTitle: {
      fontSize: '0.875rem',
      fontWeight: '600',
      color: 'var(--text-primary)',
      marginBottom: '1rem',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
    },
    formGroup: {
      marginBottom: '1.5rem',
    },
    label: {
      display: 'block',
      color: 'var(--text-primary)',
      fontSize: '0.875rem',
      fontWeight: '500',
      marginBottom: '0.5rem',
    },
    input: {
      width: '100%',
      padding: '0.625rem 0.875rem',
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: '0.375rem',
      color: 'var(--text-primary)',
      fontSize: '0.875rem',
      boxSizing: 'border-box',
      transition: 'all 0.2s ease',
    },
    inputFocus: {
      borderColor: 'var(--accent)',
      outline: 'none',
      boxShadow: '0 0 0 3px var(--accent-dim)',
    },
    select: {
      width: '100%',
      padding: '0.625rem 0.875rem',
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: '0.375rem',
      color: 'var(--text-primary)',
      fontSize: '0.875rem',
      boxSizing: 'border-box',
    },
    toggleContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '1rem 0',
      borderBottom: '1px solid var(--border-default)',
    },
    toggleLabel: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
    },
    toggleLabelMain: {
      color: 'var(--text-primary)',
      fontSize: '0.875rem',
      fontWeight: '500',
    },
    toggleLabelSub: {
      color: 'var(--text-secondary)',
      fontSize: '0.8125rem',
    },
    toggleButton: {
      cursor: 'pointer',
      color: 'var(--accent)',
    },
    harnessCard: {
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: '0.375rem',
      padding: '1rem',
      marginBottom: '1rem',
    },
    harnessHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '1rem',
    },
    harnessTitleContainer: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
    },
    harnessTitle: {
      color: 'var(--text-primary)',
      fontSize: '0.875rem',
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    inputGroup: {
      position: 'relative',
      marginBottom: '1rem',
    },
    inputWithIcon: {
      display: 'flex',
      gap: '0.5rem',
    },
    iconButton: {
      padding: '0.625rem',
      backgroundColor: 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: 'var(--text-secondary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sectionsList: {
      display: 'grid',
      gap: '1rem',
    },
    sectionItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      padding: '1rem',
      backgroundColor: 'var(--bg-elevated)',
      borderRadius: '0.375rem',
      border: '1px solid var(--border-default)',
    },
    colorPicker: {
      width: '40px',
      height: '40px',
      borderRadius: '0.375rem',
      border: '1px solid var(--border-default)',
      cursor: 'pointer',
    },
    sectionInputsGroup: {
      flex: 1,
      display: 'flex',
      gap: '0.5rem',
    },
    removeButton: {
      padding: '0.5rem',
      backgroundColor: 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: 'var(--text-secondary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.2s ease',
    },
    addSectionForm: {
      display: 'flex',
      gap: '0.5rem',
      marginTop: '1rem',
    },
    addSectionInput: {
      flex: 1,
    },
    addButton: {
      padding: '0.625rem 1rem',
      backgroundColor: 'var(--accent)',
      border: 'none',
      borderRadius: '0.375rem',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '0.875rem',
      fontWeight: '500',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      transition: 'all 0.2s ease',
    },
    saveButton: {
      padding: '0.75rem 1.5rem',
      backgroundColor: 'var(--accent)',
      border: 'none',
      borderRadius: '0.375rem',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '0.875rem',
      fontWeight: '600',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      transition: 'all 0.2s ease',
      marginTop: '2rem',
    },
    dangerButton: {
      padding: '0.75rem 1.5rem',
      backgroundColor: 'transparent',
      border: '1px solid #FF006E',
      borderRadius: '0.375rem',
      color: '#FF006E',
      cursor: 'pointer',
      fontSize: '0.875rem',
      fontWeight: '500',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      transition: 'all 0.2s ease',
    },
    successMessage: {
      padding: '1rem',
      backgroundColor: 'rgba(0, 208, 132, 0.15)',
      border: '1px solid #00D084',
      borderRadius: '0.375rem',
      color: '#00D084',
      fontSize: '0.875rem',
      marginBottom: '1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
    },
    storageBar: {
      width: '100%',
      height: '8px',
      backgroundColor: 'var(--bg-elevated)',
      borderRadius: '4px',
      overflow: 'hidden',
      marginTop: '0.5rem',
    },
    storageFill: {
      height: '100%',
      backgroundColor: 'var(--accent)',
      width: `${storageUsage}%`,
    },
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>
          <Settings size={28} />
          Settings
        </div>
        <div style={styles.subtitle}>Manage your Agent OS configuration</div>
      </div>

      {/* Tabs */}
      <div style={styles.tabsContainer}>
        {[
          { id: 'general', label: 'General', icon: Settings },
          { id: 'harness', label: 'Harness Config', icon: Cpu },
          { id: 'sections', label: 'Sections', icon: Palette },
          { id: 'integrations', label: 'API & Integrations', icon: Link2 },
          { id: 'data', label: 'Data & Storage', icon: Database },
        ].map((t) => (
          <button
            key={t.id}
            style={styles.tab(activeTab === t.id)}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={styles.contentContainer}>
        {saveSuccess && (
          <div style={styles.successMessage}>
            <Check size={16} />
            Settings saved successfully
          </div>
        )}

        {/* General Tab */}
        {activeTab === 'general' && (
          <>
            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                <Settings size={16} />
                General Settings
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Application Name</label>
                <input
                  type="text"
                  style={styles.input}
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  onFocus={(e) =>
                    Object.assign(e.target.style, styles.inputFocus)
                  }
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Default Section</label>
                <select
                  style={styles.select}
                  value={defaultSection}
                  onChange={(e) => setDefaultSection(e.target.value)}
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Theme</label>
                <select
                  style={styles.select}
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                <Shield size={16} />
                Notifications
              </div>

              <div style={styles.toggleContainer}>
                <div style={styles.toggleLabel}>
                  <span style={styles.toggleLabelMain}>Email Notifications</span>
                  <span style={styles.toggleLabelSub}>Receive updates via email</span>
                </div>
                <button
                  style={styles.toggleButton}
                  onClick={() =>
                    setNotifications((prev) => ({
                      ...prev,
                      email: !prev.email,
                    }))
                  }
                >
                  {notifications.email ? (
                    <ToggleRight size={24} />
                  ) : (
                    <ToggleLeft size={24} />
                  )}
                </button>
              </div>

              <div style={styles.toggleContainer}>
                <div style={styles.toggleLabel}>
                  <span style={styles.toggleLabelMain}>Browser Notifications</span>
                  <span style={styles.toggleLabelSub}>Show in-app alerts</span>
                </div>
                <button
                  style={styles.toggleButton}
                  onClick={() =>
                    setNotifications((prev) => ({
                      ...prev,
                      browser: !prev.browser,
                    }))
                  }
                >
                  {notifications.browser ? (
                    <ToggleRight size={24} />
                  ) : (
                    <ToggleLeft size={24} />
                  )}
                </button>
              </div>

              <div style={styles.toggleContainer}>
                <div style={styles.toggleLabel}>
                  <span style={styles.toggleLabelMain}>Sound Effects</span>
                  <span style={styles.toggleLabelSub}>Play audio alerts</span>
                </div>
                <button
                  style={styles.toggleButton}
                  onClick={() =>
                    setNotifications((prev) => ({
                      ...prev,
                      sound: !prev.sound,
                    }))
                  }
                >
                  {notifications.sound ? (
                    <ToggleRight size={24} />
                  ) : (
                    <ToggleLeft size={24} />
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Harness Config Tab */}
        {activeTab === 'harness' && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>
              <Cpu size={16} />
              Harness Connections
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Proxmox LXC runtimes over LAN (localhost when port-forwarded). See docs/agent-os/PROXMOX_RUNTIME_STACK.md.
            </div>

            {Object.entries(harnesses).map(([harness, config]) => {
              const meta = HARNESS_META[harness] || {
                label: harness,
                hint: '',
                endpointLabel: 'Endpoint URL',
                endpointPlaceholder: 'https://api.example.com',
                showGateway: false,
              };
              return (
              <div key={harness} style={styles.harnessCard}>
                <div style={styles.harnessHeader}>
                  <div style={styles.harnessTitleContainer}>
                    <button
                      style={styles.toggleButton}
                      onClick={() => toggleHarness(harness)}
                    >
                      {config.enabled ? (
                        <ToggleRight size={20} />
                      ) : (
                        <ToggleLeft size={20} />
                      )}
                    </button>
                    <span style={styles.harnessTitle}>{meta.label}</span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: config.enabled
                        ? 'var(--accent)'
                        : 'var(--text-tertiary)',
                      fontWeight: '500',
                      textTransform: 'uppercase',
                    }}
                  >
                    {config.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                {meta.hint ? (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '0 0 0.75rem 2rem' }}>
                    {meta.hint}
                  </p>
                ) : null}

                {config.enabled && (
                  <>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>API Key</label>
                      <div style={styles.inputWithIcon}>
                        <input
                          type={showApiKey[harness] ? 'text' : 'password'}
                          style={{ ...styles.input, flex: 1 }}
                          value={config.apiKey}
                          onChange={(e) =>
                            handleHarnessChange(harness, 'apiKey', e.target.value)
                          }
                          placeholder="sk_..."
                        />
                        <button
                          style={styles.iconButton}
                          onClick={() => toggleApiKeyVisibility(harness)}
                        >
                          {showApiKey[harness] ? (
                            <EyeOff size={18} />
                          ) : (
                            <Eye size={18} />
                          )}
                        </button>
                      </div>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>{meta.endpointLabel}</label>
                      <input
                        type="text"
                        style={styles.input}
                        value={config.endpoint}
                        onChange={(e) =>
                          handleHarnessChange(harness, 'endpoint', e.target.value)
                        }
                        placeholder={meta.endpointPlaceholder}
                      />
                    </div>

                    {meta.showGateway && (
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Gateway URL</label>
                        <input
                          type="text"
                          style={styles.input}
                          value={config.gatewayUrl || ''}
                          onChange={(e) =>
                            handleHarnessChange(harness, 'gatewayUrl', e.target.value)
                          }
                          placeholder="http://localhost:8642"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
            })}
          </div>
        )}

        {/* Sections Tab */}
        {activeTab === 'sections' && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>
              <Palette size={16} />
              Manage Sections
            </div>

            <div style={styles.sectionsList}>
              {sections.map((section) => (
                <div key={section.id} style={styles.sectionItem}>
                  <input
                    type="color"
                    style={styles.colorPicker}
                    value={section.color}
                    onChange={(e) =>
                      updateSection(section.id, 'color', e.target.value)
                    }
                  />
                  <div style={styles.sectionInputsGroup}>
                    <input
                      type="text"
                      style={{ ...styles.input, flex: 1 }}
                      value={section.name}
                      onChange={(e) =>
                        updateSection(section.id, 'name', e.target.value)
                      }
                    />
                  </div>
                  <button
                    style={styles.removeButton}
                    onClick={() => removeSection(section.id)}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>

            <div style={styles.addSectionForm}>
              <input
                type="text"
                style={{ ...styles.input, ...styles.addSectionInput }}
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                placeholder="New section name"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') addSection();
                }}
              />
              <input
                type="color"
                style={{
                  ...styles.colorPicker,
                  width: '100%',
                  maxWidth: '50px',
                }}
                value={newSectionColor}
                onChange={(e) => setNewSectionColor(e.target.value)}
              />
              <button style={styles.addButton} onClick={addSection}>
                <Plus size={16} />
                Add
              </button>
            </div>
          </div>
        )}

        {/* Integrations Tab */}
        {activeTab === 'integrations' && (
          <>
            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                <Link2 size={16} />
                Webhooks
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Webhook URL</label>
                <input
                  type="text"
                  style={styles.input}
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                <Shield size={16} />
                API Key
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Your API Key</label>
                <div style={styles.inputWithIcon}>
                  <input
                    type={showApiKeyFull ? 'text' : 'password'}
                    style={{ ...styles.input, flex: 1 }}
                    value={apiKey}
                    readOnly
                  />
                  <button
                    style={styles.iconButton}
                    onClick={() => setShowApiKeyFull(!showApiKeyFull)}
                  >
                    {showApiKeyFull ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                <Cpu size={16} />
                Rate Limits
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Requests per window</label>
                <input
                  type="number"
                  style={styles.input}
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Time window (seconds)</label>
                <input
                  type="number"
                  style={styles.input}
                  value={rateLimitWindow}
                  onChange={(e) => setRateLimitWindow(e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        {/* Data & Storage Tab */}
        {activeTab === 'data' && (
          <>
            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                <Database size={16} />
                Storage Information
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Database Size</label>
                <input
                  type="text"
                  style={{ ...styles.input, backgroundColor: 'var(--bg-elevated)' }}
                  value={databaseSize}
                  readOnly
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Storage Usage ({storageUsage}%)
                </label>
                <div style={styles.storageBar}>
                  <div style={styles.storageFill}></div>
                </div>
              </div>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                <Trash2 size={16} />
                Data Management
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1rem',
                }}
              >
                <button style={styles.addButton} onClick={handleExportData}>
                  <Save size={16} />
                  Export Data
                </button>
                <button
                  style={styles.dangerButton}
                  onClick={handleClearData}
                >
                  <Trash2 size={16} />
                  Clear Data
                </button>
              </div>

              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-elevated)',
                  borderRadius: '0.375rem',
                  fontSize: '0.8125rem',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <strong>Export Data:</strong> Download all your settings and
                configuration as a JSON file for backup purposes.
              </div>

              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-elevated)',
                  borderRadius: '0.375rem',
                  fontSize: '0.8125rem',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <strong>Clear Data:</strong> Permanently delete all stored data.
                This action cannot be undone.
              </div>
            </div>
          </>
        )}

        {/* Save Button */}
        <button style={styles.saveButton} onClick={handleSave}>
          <Save size={16} />
          Save Changes
        </button>
      </div>
    </div>
  );
}
