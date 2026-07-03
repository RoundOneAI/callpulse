import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Phone, Search, Trash2, Loader2, ArrowUpDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { getCalls, getAudioUrl, deleteCalls } from '../services/calls';
import { getLatestSyncRun, HubSpotSyncRun } from '../services/hubspot';
import { processCallAsync } from '../services/analysis';
import { supabase } from '../services/supabase';
import { cn } from '../utils/cn';
import { getScoreBadge } from '../utils/scores';
import AudioPlayer from '../components/AudioPlayer';
import type { Call, Profile } from '../types';

export default function Calls() {
  const { company, user } = useAuthStore();
  const navigate = useNavigate();
  const [calls, setCalls] = useState<Call[]>([]);
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [latestSync, setLatestSync] = useState<HubSpotSyncRun | null>(null);

  useEffect(() => {
    if (!company) return;
    getLatestSyncRun(company.id).then(setLatestSync);
  }, [company]);
  const [filterSdr, setFilterSdr] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [sortField, setSortField] = useState<'date' | 'score'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  const [filterDatePreset, setFilterDatePreset] = useState<'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Reset page when search/filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterSdr, filterStatus, search, filterDatePreset, customStartDate, customEndDate]);

  const handleSort = (field: 'date' | 'score') => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };

  useEffect(() => {
    if (!company) return;
    Promise.all([
      getCalls(company.id),
      supabase.from('profiles').select('*').eq('company_id', company.id).eq('role', 'sdr'),
    ]).then(([callsData, { data: sdrsData }]) => {
      const isSdr = user?.role === 'sdr';
      const allowSdrViewAll = company?.allow_sdr_view_all === true;

      let filteredCalls = callsData;
      let filteredSdrs = sdrsData || [];

      if (isSdr && !allowSdrViewAll) {
        filteredCalls = callsData.filter(c => c.sdr_id === user.id);
        filteredSdrs = (sdrsData || []).filter(s => s.id === user.id);
      }

      setCalls(filteredCalls);
      setSdrs(filteredSdrs);
      setLoading(false);
    });
  }, [company, user]);

  const audioUrlsRef = useRef(audioUrls);
  useEffect(() => {
    audioUrlsRef.current = audioUrls;
  }, [audioUrls]);

  // Fetch signed URLs for calls with audio files
  useEffect(() => {
    const withAudio = calls.filter(c => c.file_path && !audioUrlsRef.current[c.id]);
    if (withAudio.length === 0) return;

    Promise.all(
      withAudio.map(async (c) => {
        const url = await getAudioUrl(c.file_path!);
        return { id: c.id, url };
      })
    ).then((results) => {
      const newUrls: Record<string, string> = {};
      results.forEach(({ id, url }) => {
        if (url) newUrls[id] = url;
      });
      if (Object.keys(newUrls).length > 0) {
        setAudioUrls(prev => ({ ...prev, ...newUrls }));
      }
    });
  }, [calls]);

  // Poll calls if any are transcribing or analyzing
  useEffect(() => {
    if (!company) return;
    const hasProcessing = calls.some(c => c.status === 'transcribing' || c.status === 'analyzing');
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      getCalls(company.id).then((callsData) => {
        setCalls(callsData);
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [calls, company]);

  const getLocalDateString = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const now = new Date();
  const todayStr = getLocalDateString(now);

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  // Monday of this week:
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  const mondayStr = getLocalDateString(monday);
  // Sunday of this week:
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const sundayStr = getLocalDateString(sunday);

  // Month bounds:
  const startOfMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endOfMonthStr = getLocalDateString(lastDay);

  const filtered = calls.filter(c => {
    if (filterSdr && c.sdr_id !== filterSdr) return false;
    if (filterStatus && c.status !== filterStatus) return false;
    if (search) {
      const term = search.toLowerCase();
      const sdr = (c.sdr as unknown as Profile)?.full_name?.toLowerCase() || '';
      const prospect = c.prospect_name?.toLowerCase() || '';
      if (!sdr.includes(term) && !prospect.includes(term)) return false;
    }
    
    // Date filter:
    if (filterDatePreset !== 'all') {
      const callDate = c.call_date;
      if (!callDate) return false;

      if (filterDatePreset === 'today') {
        if (callDate !== todayStr) return false;
      } else if (filterDatePreset === 'yesterday') {
        if (callDate !== yesterdayStr) return false;
      } else if (filterDatePreset === 'week') {
        if (callDate < mondayStr || callDate > sundayStr) return false;
      } else if (filterDatePreset === 'month') {
        if (callDate < startOfMonthStr || callDate > endOfMonthStr) return false;
      } else if (filterDatePreset === 'custom') {
        if (customStartDate && callDate < customStartDate) return false;
        if (customEndDate && callDate > customEndDate) return false;
      }
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let valA: any;
    let valB: any;

    if (sortField === 'date') {
      valA = a.call_date || '';
      valB = b.call_date || '';
    } else if (sortField === 'score') {
      valA = a.analysis?.overall_score ?? -1;
      valB = b.analysis?.overall_score ?? -1;
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const totalItems = sorted.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedCalls = sorted.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  function toggleSelect(callId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(callId)) {
        next.delete(callId);
      } else {
        next.add(callId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(c => c.id)));
    }
  }

  async function handleDelete() {
    if (selected.size === 0) return;
    setDeleting(true);

    try {
      await deleteCalls(Array.from(selected));

      // Remove deleted calls from local state
      setCalls(prev => prev.filter(c => !selected.has(c.id)));
      setSelected(new Set());
      setShowDeleteConfirm(false);
    } catch (err: any) {
      console.error('Delete failed:', err);
      alert('Failed to delete calls: ' + (err.message || 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  }

  const [retriggering, setRetriggering] = useState(false);

  const failedCalls = filtered.filter(c => c.status === 'failed');
  const hasFailedCalls = failedCalls.length > 0;
  const allFailedSelected = hasFailedCalls && failedCalls.every(c => selected.has(c.id));
  const selectedFailedCount = filtered.filter(c => selected.has(c.id) && c.status === 'failed').length;

  function selectFailedCalls() {
    setSelected(prev => {
      const next = new Set(prev);
      filtered.forEach(c => {
        if (c.status === 'failed') {
          next.add(c.id);
        }
      });
      return next;
    });
  }

  async function handleRetrigger() {
    const selectedFailed = filtered.filter(c => selected.has(c.id) && c.status === 'failed');
    if (selectedFailed.length === 0) return;

    setRetriggering(true);
    try {
      await Promise.all(
        selectedFailed.map(async (call) => {
          const nextStatus = call.file_path ? 'transcribing' : 'analyzing';
          const { error } = await supabase
            .from('calls')
            .update({ status: nextStatus })
            .eq('id', call.id);

          if (error) throw error;

          processCallAsync({
            callId: call.id,
            sdrId: call.sdr_id,
            companyId: call.company_id,
            filePath: call.file_path || undefined,
            transcript: call.transcript || undefined,
          });
        })
      );

      // Update local state
      setCalls(prev =>
        prev.map(c => {
          if (selected.has(c.id) && c.status === 'failed') {
            return {
              ...c,
              status: c.file_path ? 'transcribing' : 'analyzing',
            };
          }
          return c;
        })
      );

      // Clear selection for these calls
      setSelected(prev => {
        const next = new Set(prev);
        selectedFailed.forEach(c => next.delete(c.id));
        return next;
      });
    } catch (err: any) {
      console.error('Retrigger failed:', err);
      alert('Failed to retrigger processing: ' + (err.message || 'Unknown error'));
    } finally {
      setRetriggering(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Calls</h1>
          {latestSync && (
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                latestSync.status === 'success' ? "bg-green-500 animate-pulse" : "bg-red-500"
              )}></span>
              Last HubSpot sync: <span className="font-semibold text-gray-700">{new Date(latestSync.run_at).toLocaleString()}</span>
              {latestSync.status === 'failed' && (
                <span className="text-red-500 bg-red-50 px-1 rounded font-medium">Failed</span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasFailedCalls && !allFailedSelected && (
            <button
              onClick={selectFailedCalls}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Select All Failed
            </button>
          )}
          {selectedFailedCount > 0 && (
            <button
              onClick={handleRetrigger}
              disabled={retriggering}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {retriggering ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Retriggering...
                </>
              ) : (
                <>
                  Retrigger Processing ({selectedFailedCount})
                </>
              )}
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Clear Selection
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
              Delete ({selected.size})
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by SDR or prospect..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            value={filterSdr}
            onChange={e => setFilterSdr(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All SDRs</option>
            {sdrs.map(s => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="analyzing">Analyzing</option>
            <option value="transcribing">Transcribing</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={filterDatePreset}
            onChange={e => setFilterDatePreset(e.target.value as any)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {filterDatePreset === 'custom' && (
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-3 w-fit animate-fade-in">
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Start Date</label>
              <input
                type="date"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              />
            </div>
            <span className="text-gray-400 mt-4 text-xs font-semibold">to</span>
            <div>
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">End Date</label>
              <input
                type="date"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="py-3 px-4 w-10 text-center">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
              </th>
              <th className="text-left py-3 px-4 font-semibold text-gray-600">SDR</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-600">Prospect</th>
              <th
                onClick={() => handleSort('date')}
                className="text-left py-3 px-4 font-semibold text-gray-600 cursor-pointer select-none hover:text-gray-900 group transition-colors"
              >
                <div className="flex items-center gap-1">
                  Date
                  {sortField === 'date' ? (
                    sortOrder === 'asc' ? <ChevronUp className="h-4 w-4 text-indigo-600" /> : <ChevronDown className="h-4 w-4 text-indigo-600" />
                  ) : (
                    <ArrowUpDown className="h-3.5 w-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
              </th>
              <th className="text-left py-3 px-4 font-semibold text-gray-600">Recording</th>
              <th
                onClick={() => handleSort('score')}
                className="text-left py-3 px-4 font-semibold text-gray-600 cursor-pointer select-none hover:text-gray-900 group transition-colors"
              >
                <div className="flex items-center gap-1">
                  Score
                  {sortField === 'score' ? (
                    sortOrder === 'asc' ? <ChevronUp className="h-4 w-4 text-indigo-600" /> : <ChevronDown className="h-4 w-4 text-indigo-600" />
                  ) : (
                    <ArrowUpDown className="h-3.5 w-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
              </th>
              <th className="text-left py-3 px-4 font-semibold text-gray-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {paginatedCalls.map(call => {
              const analysis = call.analysis;
              const isSelected = selected.has(call.id);
              const isCompleted = call.status === 'completed';
              return (
                <tr
                  key={call.id}
                  onClick={() => {
                    if (isCompleted) {
                      navigate(`/calls/${call.id}`, { state: { callIds: sorted.map(c => c.id), backUrl: '/calls' } });
                    }
                  }}
                  className={cn(
                    'border-t border-gray-100 transition-colors',
                    isCompleted ? 'cursor-pointer hover:bg-gray-50' : '',
                    isSelected ? 'bg-indigo-50/50 hover:bg-indigo-50/70' : ''
                  )}
                >
                  <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(call.id)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="py-3 px-4 font-medium text-gray-900">
                    {(call.sdr as unknown as Profile)?.full_name || '—'}
                  </td>
                  <td className="py-3 px-4 text-gray-600">
                    {call.hubspot_contact_id && call.hubspot_portal_id ? (
                      <a
                        href={`https://app.hubspot.com/contacts/${call.hubspot_portal_id}/contact/${call.hubspot_contact_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 hover:underline font-semibold"
                        title="View HubSpot Contact"
                      >
                        {call.prospect_name || '—'}
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                      </a>
                    ) : (
                      call.prospect_name || '—'
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-600">{call.call_date}</td>
                  <td className="py-3 px-4 min-w-[200px]" onClick={(e) => e.stopPropagation()}>
                    {audioUrls[call.id] ? (
                      <AudioPlayer
                        src={audioUrls[call.id]}
                        compact
                        duration={call.duration_seconds || undefined}
                      />
                    ) : (
                      <span className="text-xs text-gray-300">--</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {analysis ? (
                      <span className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                        getScoreBadge(analysis.overall_score)
                      )}>
                        {analysis.overall_score.toFixed(1)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <span className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                      call.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                      call.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    )}>
                      {call.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {paginatedCalls.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Phone className="h-6 w-6 mb-2" />
            <p className="text-sm">No calls found</p>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white border border-gray-200 px-4 py-3 rounded-xl shadow-sm mt-4">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Showing <span className="font-medium">{startIndex + 1}</span> to <span className="font-medium">{Math.min(startIndex + ITEMS_PER_PAGE, totalItems)}</span> of <span className="font-medium">{totalItems}</span> results
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                >
                  <span className="sr-only">Previous</span>
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 select-none">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                >
                  <span className="sr-only">Next</span>
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !deleting && setShowDeleteConfirm(false)}
          />
          <div className="relative bg-white rounded-xl border border-gray-200 shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900">Delete {selected.size} {selected.size === 1 ? 'call' : 'calls'}?</h3>
            <p className="text-sm text-gray-500 mt-2">
              This will permanently delete the selected {selected.size === 1 ? 'call' : 'calls'} along with {selected.size === 1 ? 'its' : 'their'} analysis, coaching items, and audio recordings. This action cannot be undone.
            </p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete Permanently
                  </>
                )}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2.5 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
