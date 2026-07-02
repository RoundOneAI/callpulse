import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import {
  Upload as UploadIcon,
  FileText,
  Music,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Clock,
  Link2,
  Calendar,
  Sparkles,
  Info,
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { uploadCall, uploadAudioCall } from '../services/calls';
import { processCallAsync } from '../services/analysis';
import { supabase } from '../services/supabase';
import { getHubSpotIntegration, listHubSpotCalls, importHubSpotCalls } from '../services/hubspot';
import type { Profile, HubSpotCall } from '../types';
import { cn } from '../utils/cn';

interface UploadItem {
  id: string;
  file: File | null;
  transcript: string;
  sdrId: string;
  callDate: string;
  prospectName: string;
  status: 'pending' | 'uploading' | 'saving' | 'queued' | 'error';
  error?: string;
}

export default function Upload() {
  const { user, company } = useAuthStore();
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [selectedSdr, setSelectedSdr] = useState('');
  const [callDate, setCallDate] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 16);
  });
  const [prospectName, setProspectName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [allQueued, setAllQueued] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

  // HubSpot Integration state
  const [activeTab, setActiveTab] = useState<'upload' | 'hubspot'>('upload');
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [loadingHubspotStatus, setLoadingHubspotStatus] = useState(false);
  const [fetchingCalls, setFetchingCalls] = useState(false);
  const [importingCalls, setImportingCalls] = useState(false);
  const [hubspotCalls, setHubspotCalls] = useState<HubSpotCall[]>([]);
  const [selectedHubspotCallIds, setSelectedHubspotCallIds] = useState<string[]>([]);
  const [sdrMapping, setSdrMapping] = useState<Record<string, string>>({});
  const [durationFilter, setDurationFilter] = useState<'all' | '30s' | '1m' | '2m' | '5m'>('all');
  const [prospectNameMapping, setProspectNameMapping] = useState<Record<string, string>>({});

  const formatDateTimeLocal = (date: Date): string => {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    return localDate.toISOString().slice(0, 16);
  };

  const [startDateStr, setStartDateStr] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const offset = today.getTimezoneOffset();
    return new Date(today.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
  });
  const [endDateStr, setEndDateStr] = useState(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const offset = today.getTimezoneOffset();
    return new Date(today.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
  });

  const applyPreset = (preset: 'today' | 'yesterday' | 'week' | 'month') => {
    const start = new Date();
    const end = new Date();

    if (preset === 'today') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (preset === 'yesterday') {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
    } else if (preset === 'week') {
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (preset === 'month') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    }

    setStartDateStr(formatDateTimeLocal(start));
    setEndDateStr(formatDateTimeLocal(end));
  };

  useEffect(() => {
    async function checkHubspot() {
      if (!company) return;
      setLoadingHubspotStatus(true);
      try {
        const int = await getHubSpotIntegration();
        setHubspotConnected(!!int?.is_active && !!int?.credentials?.private_token);
      } catch (err) {
        console.error('Error checking HubSpot status:', err);
        setHubspotConnected(false);
      } finally {
        setLoadingHubspotStatus(false);
      }
    }
    checkHubspot();
  }, [company]);

  useEffect(() => {
    const initialSdrMap: Record<string, string> = {};
    const initialProspectMap: Record<string, string> = {};
    hubspotCalls.forEach((call) => {
      if (call.suggestedSdrId) {
        initialSdrMap[call.hubspotCallId] = call.suggestedSdrId;
      }
      if (call.prospectName) {
        initialProspectMap[call.hubspotCallId] = call.prospectName;
      }
    });
    setSdrMapping(initialSdrMap);
    setProspectNameMapping(initialProspectMap);
  }, [hubspotCalls]);

  useEffect(() => {
    setSelectedHubspotCallIds((prev) => {
      const visibleIds = hubspotCalls
        .filter((call) => {
          if (durationFilter === 'all') return true;
          if (durationFilter === '30s') return call.durationSeconds > 30;
          if (durationFilter === '1m') return call.durationSeconds > 60;
          if (durationFilter === '2m') return call.durationSeconds > 120;
          if (durationFilter === '5m') return call.durationSeconds > 300;
          return true;
        })
        .map((c) => c.hubspotCallId);
      return prev.filter((id) => visibleIds.includes(id));
    });
  }, [durationFilter, hubspotCalls]);

  async function fetchHubspotCalls() {
    setFetchingCalls(true);
    try {
      const calls = await listHubSpotCalls({
        startDate: new Date(startDateStr).toISOString(),
        endDate: new Date(endDateStr).toISOString(),
      });
      setHubspotCalls(calls);
      const autoSelected = calls
        .filter((c) => !!c.recordingUrl && !c.alreadyImported)
        .map((c) => c.hubspotCallId);
      setSelectedHubspotCallIds(autoSelected);
    } catch (err: any) {
      console.error('Error fetching HubSpot calls:', err);
      alert(err.message || 'Failed to fetch calls from HubSpot');
    } finally {
      setFetchingCalls(false);
    }
  }

  async function handleImport() {
    if (!company) return;
    setImportingCalls(true);

    const callsToImport = hubspotCalls
      .filter((c) => selectedHubspotCallIds.includes(c.hubspotCallId))
      .map((c) => {
        const sdrId = sdrMapping[c.hubspotCallId];
        const prospectName = prospectNameMapping[c.hubspotCallId] || '';
        return {
          hubspotCallId: c.hubspotCallId,
          sdrId,
          prospectName,
        };
      });

    const invalid = callsToImport.some((c) => !c.sdrId);
    if (invalid) {
      alert('Please select an SDR for all selected calls.');
      setImportingCalls(false);
      return;
    }

    try {
      const res = await importHubSpotCalls(callsToImport);
      const successCount = res.results.filter((r) => r.success).length;
      const failCount = res.results.filter((r) => !r.success).length;

      if (successCount > 0) {
        setQueuedCount(successCount);
        setAllQueued(true);
      }

      if (failCount > 0) {
        const errors = res.results
          .filter((r) => !r.success)
          .map((r) => `Call ${r.hubspotCallId}: ${r.error}`)
          .join('\n');
        alert(`Failed to import some calls:\n${errors}`);
      }

      await fetchHubspotCalls();
    } catch (err: any) {
      console.error('Error importing HubSpot calls:', err);
      alert(err.message || 'Failed to import calls');
    } finally {
      setImportingCalls(false);
    }
  }

  useEffect(() => {
    if (!company) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('company_id', company.id)
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setSdrs(data || []));
  }, [company]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setAllQueued(false);
    const newItems: UploadItem[] = acceptedFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      transcript: '',
      sdrId: selectedSdr,
      callDate,
      prospectName: '',
      status: 'pending' as const,
    }));
    setItems(prev => [...prev, ...newItems]);
  }, [selectedSdr, callDate]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.m4a', '.ogg'],
      'text/plain': ['.txt'],
    },
  });

  function addPasteTranscript() {
    if (!pasteText.trim()) return;
    setAllQueued(false);
    const item: UploadItem = {
      id: crypto.randomUUID(),
      file: null,
      transcript: pasteText.trim(),
      sdrId: selectedSdr,
      callDate,
      prospectName,
      status: 'pending',
    };
    setItems(prev => [...prev, item]);
    setPasteText('');
    setPasteMode(false);
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
  }

  function updateItem(id: string, updates: Partial<UploadItem>) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
  }

  async function uploadAndQueue() {
    if (!company || !user) return;
    setProcessing(true);
    setAllQueued(false);
    let queued = 0;
    let failed = 0;

    // Process all uploads in parallel
    const uploads = items
      .filter(item => item.status === 'pending')
      .map(async (item) => {
        if (!item.sdrId) {
          updateItem(item.id, { status: 'error', error: 'Select an SDR' });
          failed++;
          return;
        }

        try {
          updateItem(item.id, { status: 'uploading' });

          let transcript = item.transcript;

          // If it's a text file, read its content
          if (item.file && item.file.type === 'text/plain') {
            transcript = await item.file.text();
          }

          // Audio file: upload to storage → create DB record → fire-and-forget processing
          if (item.file && item.file.type.startsWith('audio/')) {
            const callData = await uploadAudioCall({
              sdrId: item.sdrId,
              companyId: company.id,
              uploadedBy: user.id,
              file: item.file,
              callDate: item.callDate,
              prospectName: item.prospectName || undefined,
              onStage: (stage) => updateItem(item.id, { status: stage }),
            });

            // Fire and forget — processing happens server-side
            processCallAsync({
              callId: callData.id,
              sdrId: item.sdrId,
              companyId: company.id,
              filePath: callData.filePath,
            });

            updateItem(item.id, { status: 'queued' });
            queued++;
          } else {
            // Text transcript: create DB record → fire-and-forget analysis
            if (!transcript) {
              updateItem(item.id, { status: 'error', error: 'No transcript content' });
              failed++;
              return;
            }

            updateItem(item.id, { status: 'saving' });

            const callData = await uploadCall({
              sdrId: item.sdrId,
              companyId: company.id,
              uploadedBy: user.id,
              transcript,
              callDate: item.callDate,
              prospectName: item.prospectName || undefined,
            });

            // Fire and forget — analysis happens server-side
            processCallAsync({
              callId: callData.id,
              sdrId: item.sdrId,
              companyId: company.id,
              transcript,
            });

            updateItem(item.id, { status: 'queued' });
            queued++;
          }
        } catch (err: any) {
          failed++;
          updateItem(item.id, {
            status: 'error',
            error: err.message || 'Failed to upload',
          });
        }
      });

    await Promise.all(uploads);

    setQueuedCount(queued);
    if (queued > 0 && failed === 0) setAllQueued(true);
    setProcessing(false);
  }

  function resetAndUploadMore() {
    setItems([]);
    setHubspotCalls([]);
    setSelectedHubspotCallIds([]);
    setAllQueued(false);
    setQueuedCount(0);
  }

  const pendingCount = items.filter(i => i.status === 'pending').length;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload Calls</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload transcripts or audio recordings, or import them directly from HubSpot — they'll be processed in the background
        </p>
      </div>

      {/* Tab Selector */}
      {!allQueued && (
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('upload')}
            className={cn(
              'px-5 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2',
              activeTab === 'upload'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
            )}
          >
            <UploadIcon className="h-4 w-4" />
            Upload Files
          </button>
          <button
            onClick={() => setActiveTab('hubspot')}
            className={cn(
              'px-5 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2',
              activeTab === 'hubspot'
                ? 'border-orange-500 text-orange-500 font-bold'
                : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
            )}
          >
            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            Import from HubSpot
          </button>
        </div>
      )}

      {/* Success Banner */}
      {allQueued && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-base font-semibold text-emerald-900">
                {queuedCount} {queuedCount === 1 ? 'call' : 'calls'} queued for processing
              </h3>
              <p className="text-sm text-emerald-700 mt-1">
                Your files have been uploaded and are being transcribed & analyzed in the background.
                This typically takes 1–3 minutes per call. You can check progress on the Calls page.
              </p>
              <div className="flex items-center gap-3 mt-4">
                <Link
                  to="/calls"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  View Calls <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  onClick={resetAndUploadMore}
                  className="px-4 py-2 text-emerald-700 text-sm font-medium rounded-lg hover:bg-emerald-100 transition-colors"
                >
                  Upload More
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Defaults */}
      {!allQueued && activeTab === 'upload' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SDR</label>
              <select
                value={selectedSdr}
                onChange={e => setSelectedSdr(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select SDR...</option>
                {sdrs.map(s => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Call Date & Time</label>
              <input
                type="datetime-local"
                value={callDate}
                onChange={e => setCallDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prospect Name</label>
              <input
                type="text"
                value={prospectName}
                onChange={e => setProspectName(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Upload area */}
          <div className="flex gap-3">
            <div
              {...getRootProps()}
              className={cn(
                'flex-1 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                isDragActive
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'
              )}
            >
              <input {...getInputProps()} />
              <UploadIcon className="h-8 w-8 text-gray-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700">
                Drop files here, or click to browse
              </p>
              <p className="text-xs text-gray-500 mt-1">
                .txt transcripts or .mp3/.wav/.m4a audio files
              </p>
            </div>

            <button
              onClick={() => setPasteMode(true)}
              className="flex flex-col items-center justify-center w-40 border-2 border-dashed border-gray-300 rounded-xl hover:border-indigo-300 hover:bg-gray-50 transition-colors"
            >
              <FileText className="h-6 w-6 text-gray-400 mb-1" />
              <span className="text-sm text-gray-600">Paste Transcript</span>
            </button>
          </div>

          {/* Paste modal */}
          {pasteMode && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder="Paste the call transcript here..."
                rows={8}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={addPasteTranscript}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                >
                  Add Transcript
                </button>
                <button
                  onClick={() => { setPasteMode(false); setPasteText(''); }}
                  className="px-4 py-2 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* HubSpot integration tab content */}
      {!allQueued && activeTab === 'hubspot' && (
        <div className="space-y-6">
          {loadingHubspotStatus ? (
            <div className="py-12 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
          ) : !hubspotConnected ? (
            <div className="bg-gradient-to-br from-amber-50 to-orange-50/50 border border-orange-200 rounded-2xl p-8 text-center max-w-lg mx-auto shadow-sm">
              <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-4">
                <Link2 className="h-6 w-6 text-orange-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">HubSpot Not Connected</h3>
              <p className="text-sm text-gray-600 mt-2 max-w-sm mx-auto">
                Connect your HubSpot account in settings using a Private App Token to fetch and process call recordings directly.
              </p>
              <div className="mt-5">
                <Link
                  to="/settings"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-lg shadow transition-colors cursor-pointer"
                >
                  Go to Settings
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-gray-400" />
                        Start Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        value={startDateStr}
                        onChange={(e) => setStartDateStr(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-gray-400" />
                        End Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        value={endDateStr}
                        onChange={(e) => setEndDateStr(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-gray-400" />
                        Min Duration
                      </label>
                      <select
                        value={durationFilter}
                        onChange={(e) => setDurationFilter(e.target.value as any)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                      >
                        <option value="all">All Durations</option>
                        <option value="30s">&gt; 30s</option>
                        <option value="1m">&gt; 1 min</option>
                        <option value="2m">&gt; 2 min</option>
                        <option value="5m">&gt; 5 min</option>
                      </select>
                    </div>
                  </div>
                  
                  {/* Presets/Shortcuts for date range selection */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mr-1">
                      Shortcuts:
                    </span>
                    {(['today', 'yesterday', 'week', 'month'] as const).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="px-2.5 py-0.5 rounded-full border border-gray-200 hover:border-orange-300 hover:bg-orange-50 text-[10px] font-medium text-gray-600 hover:text-orange-700 transition-all cursor-pointer capitalize"
                      >
                        {preset === 'week' ? 'this week' : preset === 'month' ? 'this month' : preset}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={fetchHubspotCalls}
                  disabled={fetchingCalls}
                  className="w-full sm:w-auto px-4 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {fetchingCalls ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Fetching...
                    </>
                  ) : (
                    'Fetch Calls'
                  )}
                </button>
              </div>

              {/* Calls list */}
              {hubspotCalls.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 shadow-sm">
                  <Sparkles className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-medium">No calls found in this date range.</p>
                  <p className="text-xs text-gray-400 mt-1">Try expanding the filter dates above.</p>
                </div>
              ) : (() => {
                const filteredCalls = hubspotCalls.filter((call) => {
                  if (durationFilter === 'all') return true;
                  if (durationFilter === '30s') return call.durationSeconds > 30;
                  if (durationFilter === '1m') return call.durationSeconds > 60;
                  if (durationFilter === '2m') return call.durationSeconds > 120;
                  if (durationFilter === '5m') return call.durationSeconds > 300;
                  return true;
                });

                if (filteredCalls.length === 0) {
                  return (
                    <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 shadow-sm">
                      <Clock className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm font-medium">No calls match the duration filter.</p>
                      <p className="text-xs text-gray-400 mt-1">Try selecting a shorter min duration above.</p>
                    </div>
                  );
                }

                return (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                        <thead className="bg-gray-50 font-semibold text-gray-700 uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="px-4 py-3 w-10">
                              <input
                                type="checkbox"
                                checked={
                                  selectedHubspotCallIds.length > 0 &&
                                  filteredCalls.filter((c) => !!c.recordingUrl && !c.alreadyImported).length > 0 &&
                                  filteredCalls.filter((c) => !!c.recordingUrl && !c.alreadyImported).every((c) => selectedHubspotCallIds.includes(c.hubspotCallId))
                                }
                                onChange={(e) => {
                                  const selectableIds = filteredCalls
                                    .filter((c) => !!c.recordingUrl && !c.alreadyImported)
                                    .map((c) => c.hubspotCallId);
                                  if (e.target.checked) {
                                    setSelectedHubspotCallIds((prev) => [...new Set([...prev, ...selectableIds])]);
                                  } else {
                                    setSelectedHubspotCallIds((prev) => prev.filter((id) => !selectableIds.includes(id)));
                                  }
                                }}
                                className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                              />
                            </th>
                            <th className="px-4 py-3">Call Title</th>
                            <th className="px-4 py-3">Date & Time</th>
                            <th className="px-4 py-3">Duration</th>
                            <th className="px-4 py-3">HubSpot Owner</th>
                            <th className="px-4 py-3">Map to SDR</th>
                            <th className="px-4 py-3 text-right">Recording Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {filteredCalls.map((call) => {
                            const isSelected = selectedHubspotCallIds.includes(call.hubspotCallId);
                            const hasRecording = !!call.recordingUrl;
                            const isDisabled = !hasRecording || call.alreadyImported;

                            return (
                              <tr
                                key={call.hubspotCallId}
                                className={cn(
                                  'hover:bg-gray-50/50 transition-colors',
                                  call.alreadyImported && 'bg-gray-50/20 opacity-70'
                                )}
                              >
                                <td className="px-4 py-3">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={isDisabled}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedHubspotCallIds((prev) => [...prev, call.hubspotCallId]);
                                      } else {
                                        setSelectedHubspotCallIds((prev) =>
                                          prev.filter((id) => id !== call.hubspotCallId)
                                        );
                                      }
                                    }}
                                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 disabled:opacity-50 cursor-pointer"
                                  />
                                </td>
                                <td className="px-4 py-3 font-semibold text-gray-900 max-w-xs truncate" title={call.title}>
                                  {call.title}
                                </td>
                                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                  {new Date(call.timestamp).toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono">
                                  {Math.floor(call.durationSeconds / 60)}:
                                  {String(call.durationSeconds % 60).padStart(2, '0')}
                                </td>
                                <td className="px-4 py-3 text-gray-500 truncate max-w-[120px]" title={call.ownerEmail || ''}>
                                  {call.ownerEmail || <span className="italic text-gray-400">None</span>}
                                </td>
                                <td className="px-4 py-3">
                                  <select
                                    value={sdrMapping[call.hubspotCallId] || ''}
                                    disabled={isDisabled || importingCalls}
                                    onChange={(e) =>
                                      setSdrMapping((prev) => ({
                                        ...prev,
                                        [call.hubspotCallId]: e.target.value,
                                      }))
                                    }
                                    className="border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:ring-orange-500 bg-white"
                                  >
                                    <option value="">Select SDR...</option>
                                    {sdrs.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.full_name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                  {call.alreadyImported ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                                      Imported
                                    </span>
                                  ) : !hasRecording ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 border border-red-100" title="HubSpot has no audio file recording URL for this engagement">
                                      <Info className="h-3 w-3 shrink-0" />
                                      No Recording URL
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                      Ready
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Action bar */}
                    <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        {selectedHubspotCallIds.length} of {filteredCalls.filter((c) => !!c.recordingUrl && !c.alreadyImported).length} calls selected
                      </span>
                      <button
                        onClick={handleImport}
                        disabled={importingCalls || selectedHubspotCallIds.length === 0}
                        className="px-4 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                      >
                        {importingCalls ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Importing & Processing...
                          </>
                        ) : (
                          'Import & Analyze Selected'
                        )}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Upload queue */}
      {items.length > 0 && activeTab === 'upload' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Upload Queue ({items.length})
            </h2>
            {!allQueued && (
              <button
                onClick={uploadAndQueue}
                disabled={processing || pendingCount === 0}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-lg',
                  processing || pendingCount === 0
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                )}
              >
                {processing ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Uploading...
                  </span>
                ) : (
                  `Upload & Analyze ${pendingCount > 1 ? `(${pendingCount})` : ''}`
                )}
              </button>
            )}
          </div>

          {items.map(item => (
            <div
              key={item.id}
              className={cn(
                'flex items-center gap-3 border rounded-lg p-3',
                item.status === 'queued' ? 'bg-indigo-50 border-indigo-200' :
                item.status === 'error' ? 'bg-red-50 border-red-200' :
                'bg-white border-gray-200'
              )}
            >
              {item.file ? (
                item.file.type.startsWith('audio/')
                  ? <Music className="h-5 w-5 text-purple-500 shrink-0" />
                  : <FileText className="h-5 w-5 text-blue-500 shrink-0" />
              ) : (
                <FileText className="h-5 w-5 text-gray-400 shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {item.file?.name || 'Pasted transcript'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {item.status === 'uploading' && 'Uploading to storage...'}
                  {item.status === 'saving' && 'Saving call record...'}
                  {item.status === 'queued' && 'Queued — processing in background'}
                </p>
                {item.error && (
                  <p className="text-xs text-red-600 mt-0.5">{item.error}</p>
                )}
              </div>

              {!allQueued && (
                <select
                  value={item.sdrId}
                  onChange={e => updateItem(item.id, { sdrId: e.target.value })}
                  className="text-sm border border-gray-300 rounded px-2 py-1"
                  disabled={item.status !== 'pending'}
                >
                  <option value="">SDR...</option>
                  {sdrs.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name}</option>
                  ))}
                </select>
              )}

              {item.status === 'error' && (
                <button
                  onClick={() => updateItem(item.id, { status: 'pending', error: undefined })}
                  className="text-sm font-medium text-red-700 hover:text-red-800"
                >
                  Retry
                </button>
              )}
              {(item.status === 'pending' || item.status === 'error') && (
                <button onClick={() => removeItem(item.id)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              )}
              {(item.status === 'uploading' || item.status === 'saving') && (
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              )}
              {item.status === 'queued' && (
                <span className="flex items-center gap-1 text-indigo-600 text-sm font-medium">
                  <Clock className="h-4 w-4" />
                  Queued
                </span>
              )}
              {item.status === 'error' && (
                <AlertCircle className="h-4 w-4 text-red-500" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
