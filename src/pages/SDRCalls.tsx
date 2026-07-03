import { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Phone, Search, Trash2, Loader2, ArrowLeft, BarChart2, Star, CheckCircle,
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus, CheckCircle2, Circle, Clock, ArrowUpDown, ChevronUp, ChevronDown, ExternalLink
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';
import { useAuthStore } from '../store/auth';
import { getCalls, getAudioUrl, deleteCalls, getCoachingItems, updateCoachingStatus } from '../services/calls';
import { getSDRTrend } from '../services/reports';
import { processCallAsync } from '../services/analysis';
import { supabase } from '../services/supabase';
import { cn } from '../utils/cn';
import { getScoreBadge, getScoreColor } from '../utils/scores';
import AudioPlayer from '../components/AudioPlayer';
import ScoreCard from '../components/ScoreCard';
import { DIMENSIONS } from '../types';
import type { Call, Profile, CallAnalysis, WeeklyReport, CoachingItem } from '../types';

export default function SDRCalls() {
  const { id: paramId } = useParams<{ id: string }>();
  const { company, user } = useAuthStore();
  const navigate = useNavigate();

  const id = paramId || user?.id;
  const isManagerOrAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isSdr = user?.role === 'sdr';
  const isViewingSelf = id === user?.id;

  const [sdr, setSdr] = useState<Profile | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [trend, setTrend] = useState<WeeklyReport[]>([]);
  const [coaching, setCoaching] = useState<CoachingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'calls' | 'performance' | 'coaching' | 'settings'>('calls');

  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [filterDatePreset, setFilterDatePreset] = useState<'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retriggering, setRetriggering] = useState(false);

  const [sortField, setSortField] = useState<'date' | 'score'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [currentCoachingPage, setCurrentCoachingPage] = useState(1);
  const [coachingSubTab, setCoachingSubTab] = useState<'backlog' | 'completed'>('backlog');
  const ITEMS_PER_PAGE = 50;
  const COACHING_ITEMS_PER_PAGE = 20;

  const [hubspotEmail, setHubspotEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Reset page when search/filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, search, filterDatePreset, customStartDate, customEndDate]);

  useEffect(() => {
    setCurrentPage(1);
    setCurrentCoachingPage(1);
    setCoachingSubTab('backlog');
  }, [id, activeTab]);

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
    if (!id || !company) return;
    if (isSdr && !isViewingSelf) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      supabase.from('profiles').select('*').eq('id', id).single(),
      getCalls(company.id, { sdrId: id }),
      getSDRTrend(id, 8),
      getCoachingItems({ companyId: company.id, sdrId: id }),
    ]).then(([{ data: sdrData }, callsData, trendData, coachingData]) => {
      setSdr(sdrData);
      if (sdrData) {
        setHubspotEmail(sdrData.hubspot_owner_email || '');
      }
      setCalls(callsData);
      setTrend(trendData);
      setCoaching(coachingData);
      setLoading(false);
    }).catch((err) => {
      console.error('Error loading consolidated SDR data:', err);
      setLoading(false);
    });
  }, [id, company, isSdr, isViewingSelf]);

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
    if (!id || !company) return;
    if (isSdr && !isViewingSelf) return;
    const hasProcessing = calls.some(c => c.status === 'transcribing' || c.status === 'analyzing');
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      getCalls(company.id, { sdrId: id }).then((callsData) => {
        setCalls(callsData);
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [calls, id, company, isSdr, isViewingSelf]);

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
    if (filterStatus && c.status !== filterStatus) return false;
    if (search) {
      const term = search.toLowerCase();
      const prospect = c.prospect_name?.toLowerCase() || '';
      if (!prospect.includes(term)) return false;
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

  // Calculate statistics from completed calls
  const completedCalls = calls.filter(c => c.status === 'completed' && c.analysis);
  const totalCallsCount = calls.length;
  const completedCallsCount = completedCalls.length;

  const overallAvgScore = completedCallsCount > 0
    ? completedCalls.reduce((sum, c) => sum + (c.analysis?.overall_score || 0), 0) / completedCallsCount
    : 0;

  // Compute dimension averages
  const dimensionAverages = DIMENSIONS.map(dim => {
    const scoreKey = `${dim.dbPrefix}_score` as keyof CallAnalysis;
    const avg = completedCallsCount > 0
      ? completedCalls.reduce((sum, c) => sum + (Number(c.analysis?.[scoreKey]) || 0), 0) / completedCallsCount
      : 0;
    return {
      ...dim,
      average: avg,
    };
  });

  // Build trend chart data
  const trendChart = trend.map(r => ({
    week: `W${r.week_number}`,
    ...(r.avg_scores as Record<string, number>),
  }));

  // Build radar data from latest report
  const latest = trend[trend.length - 1];
  const latestScores = latest?.avg_scores as Record<string, number> | undefined;
  const radarData = DIMENSIONS.map(dim => ({
    dimension: dim.label.split(' ')[0],
    score: latestScores?.[dim.key] || 0,
  }));

  // Build coaching pagination data
  const backlogCoaching = coaching.filter(item => item.status !== 'completed');
  const completedCoaching = coaching.filter(item => item.status === 'completed');

  const activeCoachingList = coachingSubTab === 'backlog' ? backlogCoaching : completedCoaching;
  const totalCoachingItems = activeCoachingList.length;
  const totalCoachingPages = Math.ceil(totalCoachingItems / COACHING_ITEMS_PER_PAGE);
  const coachingStartIndex = (currentCoachingPage - 1) * COACHING_ITEMS_PER_PAGE;
  const paginatedCoaching = activeCoachingList.slice(coachingStartIndex, coachingStartIndex + COACHING_ITEMS_PER_PAGE);

  async function saveHubspotEmail() {
    if (!id) return;
    setSavingEmail(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ hubspot_owner_email: hubspotEmail.trim() || null })
        .eq('id', id);
      if (error) throw error;
      setSdr(prev => prev ? { ...prev, hubspot_owner_email: hubspotEmail.trim() || null } : null);
      alert('HubSpot owner email updated successfully');
    } catch (err) {
      console.error('Error saving HubSpot owner email:', err);
      alert('Failed to save HubSpot owner email');
    } finally {
      setSavingEmail(false);
    }
  }

  async function deleteSdrProfile() {
    if (!id || !sdr) return;
    if (!window.confirm(`Are you absolutely sure you want to permanently delete SDR ${sdr.full_name}? This will delete all their call analyses, coaching items, and weekly reports. This action cannot be undone.`)) {
      return;
    }
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw error;
      alert('SDR profile deleted successfully');
      navigate('/team');
    } catch (err: any) {
      console.error('Error deleting SDR:', err);
      alert('Failed to delete SDR: ' + (err.message || 'Unknown error'));
    }
  }

  async function toggleActiveStatus() {
    if (!id || !sdr) return;
    try {
      const nextActiveState = !sdr.is_active;
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: nextActiveState })
        .eq('id', id);
      if (error) throw error;
      setSdr(prev => prev ? { ...prev, is_active: nextActiveState } : null);
      alert(`SDR has been ${nextActiveState ? 'activated' : 'deactivated'}.`);
    } catch (err: any) {
      console.error('Error updating SDR status:', err);
      alert('Failed to update SDR status: ' + (err.message || 'Unknown error'));
    }
  }

  async function toggleCoaching(item: CoachingItem) {
    const newStatus = item.status === 'completed' ? 'open' : 'completed';
    await updateCoachingStatus(item.id, newStatus);
    setCoaching(prev =>
      prev.map(c => c.id === item.id ? { ...c, status: newStatus } : c)
    );
  }

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

  const allowSdrViewAll = company?.allow_sdr_view_all === true;

  if (isSdr && !isViewingSelf && !allowSdrViewAll) {
    return (
      <div className="text-center py-12 text-gray-500 font-medium">
        Access Denied. You do not have permission to view other SDR profiles.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!sdr) {
    return <div className="text-center py-12 text-gray-500">SDR not found</div>;
  }

  const failedCalls = filtered.filter(c => c.status === 'failed');
  const hasFailedCalls = failedCalls.length > 0;
  const allFailedSelected = hasFailedCalls && failedCalls.every(c => selected.has(c.id));
  const selectedFailedCount = filtered.filter(c => selected.has(c.id) && c.status === 'failed').length;

  return (
    <div className="space-y-6 max-w-6xl">
      {!isSdr && (
        <div className="flex items-center justify-between">
          <Link to="/team" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-4 w-4" /> Back to team
          </Link>
        </div>
      )}

      {/* Header and Summary stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-indigo-100 flex items-center justify-center">
            <span className="text-xl font-bold text-indigo-700">
              {sdr.full_name.split(' ').map(n => n[0]).join('')}
            </span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{sdr.full_name}</h1>
              {!sdr.is_active && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                  Inactive
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">{sdr.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm min-w-[320px]">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{totalCallsCount}</p>
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Total Calls</p>
          </div>
          <div className="text-center border-x border-gray-100">
            <p className="text-2xl font-bold text-indigo-600">{completedCallsCount}</p>
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Completed</p>
          </div>
          <div className="text-center">
            <p className={cn('text-2xl font-bold', getScoreColor(overallAvgScore))}>
              {overallAvgScore > 0 ? overallAvgScore.toFixed(1) : '—'}
            </p>
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Avg Score</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('calls')}
            className={cn(
              "border-b-2 py-4 px-1 text-sm font-medium transition-colors cursor-pointer",
              activeTab === 'calls'
                ? "border-indigo-500 text-indigo-600 font-semibold"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            )}
          >
            Calls ({totalCallsCount})
          </button>
          <button
            onClick={() => setActiveTab('performance')}
            className={cn(
              "border-b-2 py-4 px-1 text-sm font-medium transition-colors cursor-pointer",
              activeTab === 'performance'
                ? "border-indigo-500 text-indigo-600 font-semibold"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            )}
          >
            Performance Insights
          </button>
          <button
            onClick={() => setActiveTab('coaching')}
            className={cn(
              "border-b-2 py-4 px-1 text-sm font-medium transition-colors cursor-pointer",
              activeTab === 'coaching'
                ? "border-indigo-500 text-indigo-600 font-semibold"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            )}
          >
            Coaching Backlog ({backlogCoaching.length})
          </button>
          {isManagerOrAdmin && (
            <button
              onClick={() => setActiveTab('settings')}
              className={cn(
                "border-b-2 py-4 px-1 text-sm font-medium transition-colors cursor-pointer",
                activeTab === 'settings'
                  ? "border-indigo-500 text-indigo-600 font-semibold"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              )}
            >
              Settings
            </button>
          )}
        </nav>
      </div>

      {/* Tab Contents */}
      {activeTab === 'calls' && (
        <div className="space-y-6">
          {/* Dimension Averages */}
          {completedCallsCount > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wider">Average Performance by Skill</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {dimensionAverages.map(dim => (
                  <ScoreCard
                    key={dim.key}
                    label={dim.label.split('&')[0].trim()}
                    score={dim.average}
                    compact
                  />
                ))}
              </div>
            </div>
          )}

          {/* Filters and Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="flex flex-col gap-3 flex-1">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by prospect name..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
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

            <div className="flex items-center gap-2">
              {hasFailedCalls && !allFailedSelected && (
                <button
                  onClick={() => {
                    setSelected(prev => {
                      const next = new Set(prev);
                      filtered.forEach(c => {
                        if (c.status === 'failed') next.add(c.id);
                      });
                      return next;
                    });
                  }}
                  className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 cursor-pointer shadow-sm"
                >
                  Select Failed
                </button>
              )}
              {selectedFailedCount > 0 && (
                <button
                  onClick={handleRetrigger}
                  disabled={retriggering}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {retriggering ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Retrigger ({selectedFailedCount})
                </button>
              )}
              {selected.size > 0 && (
                <>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 cursor-pointer shadow-sm"
                  >
                    Clear
                  </button>
                  {isManagerOrAdmin && (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 cursor-pointer shadow-sm"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete ({selected.size})
                    </button>
                  )}
                </>
              )}
            </div>
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
                          navigate(`/calls/${call.id}`, { state: { callIds: sorted.map(c => c.id), backUrl: `/team/${sdr.id}` } });
                        }
                      }}
                      className={cn(
                        'border-b border-gray-100 transition-colors',
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
        </div>
      )}

      {activeTab === 'performance' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
          {/* Trend chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Score Trend (8 weeks)</h2>
            {trendChart.length > 1 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="overall" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} name="Overall" />
                  <Line type="monotone" dataKey="opening" stroke="#f59e0b" strokeWidth={1} dot={false} name="Opening" />
                  <Line type="monotone" dataKey="closing" stroke="#ef4444" strokeWidth={1} dot={false} name="Closing" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-gray-400 text-sm">
                Need at least 2 weeks of data
              </div>
            )}
          </div>

          {/* Radar chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Skills Radar</h2>
            {radarData.some(d => d.score > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                  <Radar dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-gray-400 text-sm">
                No scoring data yet
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'coaching' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm animate-fade-in space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Coaching Backlog</h2>
              <p className="text-sm text-gray-500 mt-0.5">Track action items and suggestions to improve sales performance.</p>
            </div>
            
            {/* Backlog vs Completed Sub-tabs */}
            <div className="flex bg-gray-100 p-1 rounded-lg w-fit">
              <button
                onClick={() => {
                  setCoachingSubTab('backlog');
                  setCurrentCoachingPage(1);
                }}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer",
                  coachingSubTab === 'backlog'
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                )}
              >
                Active Backlog ({backlogCoaching.length})
              </button>
              <button
                onClick={() => {
                  setCoachingSubTab('completed');
                  setCurrentCoachingPage(1);
                }}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer",
                  coachingSubTab === 'completed'
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                )}
              >
                Completed Items ({completedCoaching.length})
              </button>
            </div>
          </div>

          {paginatedCoaching.length > 0 ? (
            <div className="space-y-2">
              {paginatedCoaching.map(item => (
                <div key={item.id} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/30 px-2 rounded-lg transition-colors">
                  <button onClick={() => toggleCoaching(item)} className="mt-0.5 transition-transform hover:scale-105 cursor-pointer">
                    {item.status === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : item.status === 'in_progress' ? (
                      <Clock className="h-5 w-5 text-amber-500" />
                    ) : (
                      <Circle className="h-5 w-5 text-gray-300 hover:text-indigo-400" />
                    )}
                  </button>
                  <div className="flex-1">
                    <p className={cn('text-sm transition-all', item.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-700')}>
                      {item.action_item}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400 capitalize">{item.dimension.replace('_', ' ')}</span>
                      {item.call_analyses?.call_id && (
                        <>
                          <span className="text-gray-300 text-xs">•</span>
                          <Link
                            to={`/calls/${item.call_analyses.call_id}`}
                            state={{ backUrl: sdr ? `/team/${sdr.id}` : '/my-performance' }}
                            className="inline-flex items-center gap-0.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View associated call
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">
              {coachingSubTab === 'backlog' ? 'No active coaching items' : 'No completed coaching items yet'}
            </p>
          )}

          {/* Pagination Controls */}
          {totalCoachingPages > 1 && (
            <div className="flex items-center justify-between bg-white border border-gray-200 px-4 py-3 rounded-xl shadow-sm mt-4">
              <div className="flex-1 flex justify-between sm:hidden">
                <button
                  onClick={() => setCurrentCoachingPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentCoachingPage === 1}
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentCoachingPage(prev => Math.min(prev + 1, totalCoachingPages))}
                  disabled={currentCoachingPage === totalCoachingPages}
                  className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing <span className="font-medium">{coachingStartIndex + 1}</span> to <span className="font-medium">{Math.min(coachingStartIndex + COACHING_ITEMS_PER_PAGE, totalCoachingItems)}</span> of <span className="font-medium">{totalCoachingItems}</span> results
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    <button
                      onClick={() => setCurrentCoachingPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentCoachingPage === 1}
                      className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                    >
                      <span className="sr-only">Previous</span>
                      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 select-none">
                      Page {currentCoachingPage} of {totalCoachingPages}
                    </span>
                    <button
                      onClick={() => setCurrentCoachingPage(prev => Math.min(prev + 1, totalCoachingPages))}
                      disabled={currentCoachingPage === totalCoachingPages}
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
        </div>
      )}

      {activeTab === 'settings' && isManagerOrAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-6 animate-fade-in max-w-2xl">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">SDR Profile Settings</h2>
            <p className="text-sm text-gray-500 mt-1">Configure HubSpot email mapping and manage profile status.</p>
          </div>

          {/* HubSpot Email Mapping */}
          <div className="bg-orange-50/30 border border-orange-100/70 rounded-xl p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-orange-800">HubSpot Integration</h3>
              <p className="text-xs text-orange-600 mt-0.5">Map this SDR to their HubSpot owner email to automatically pull call recordings.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={hubspotEmail}
                onChange={(e) => setHubspotEmail(e.target.value)}
                placeholder="owner@company.com"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 flex-1 bg-white"
              />
              <button
                onClick={saveHubspotEmail}
                disabled={savingEmail}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 cursor-pointer transition-colors shadow-sm"
              >
                {savingEmail ? 'Saving...' : 'Save Email'}
              </button>
            </div>
          </div>

          {/* Status Management */}
          <div className="border-t border-gray-100 pt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Profile Status</h3>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={toggleActiveStatus}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg border transition-colors cursor-pointer shadow-sm",
                  sdr.is_active
                    ? "border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100"
                    : "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                )}
              >
                {sdr.is_active ? 'Deactivate SDR Profile' : 'Activate SDR Profile'}
              </button>
              <button
                onClick={deleteSdrProfile}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors cursor-pointer shadow-sm"
              >
                Delete SDR Profile
              </button>
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
              This will permanently delete the selected {selected.size === 1 ? 'call' : 'calls'} along with their analysis and coaching suggestions. This action cannot be undone.
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
