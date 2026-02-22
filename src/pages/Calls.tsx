import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Search } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { getCalls, getAudioUrl } from '../services/calls';
import { supabase } from '../services/supabase';
import { cn } from '../utils/cn';
import { getScoreBadge } from '../utils/scores';
import AudioPlayer from '../components/AudioPlayer';
import type { Call, Profile } from '../types';

export default function Calls() {
  const { company } = useAuthStore();
  const [calls, setCalls] = useState<Call[]>([]);
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSdr, setFilterSdr] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!company) return;
    Promise.all([
      getCalls(company.id),
      supabase.from('profiles').select('*').eq('company_id', company.id).eq('role', 'sdr'),
    ]).then(async ([callsData, { data: sdrsData }]) => {
      setCalls(callsData);
      setSdrs(sdrsData || []);
      setLoading(false);

      // Fetch signed URLs for calls with audio files
      const withAudio = callsData.filter(c => c.file_path);
      if (withAudio.length > 0) {
        const urls: Record<string, string> = {};
        await Promise.all(
          withAudio.map(async (c) => {
            const url = await getAudioUrl(c.file_path!);
            if (url) urls[c.id] = url;
          })
        );
        setAudioUrls(urls);
      }
    });
  }, [company]);

  const filtered = calls.filter(c => {
    if (filterSdr && c.sdr_id !== filterSdr) return false;
    if (filterStatus && c.status !== filterStatus) return false;
    if (search) {
      const term = search.toLowerCase();
      const sdr = (c.sdr as unknown as Profile)?.full_name?.toLowerCase() || '';
      const prospect = c.prospect_name?.toLowerCase() || '';
      if (!sdr.includes(term) && !prospect.includes(term)) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">All Calls</h1>

      {/* Filters */}
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
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All SDRs</option>
          {sdrs.map(s => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="analyzing">Analyzing</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-gray-500">SDR</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">Prospect</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">Date</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">Recording</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">Score</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">Status</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(call => {
              const analysis = (call.analysis as unknown as any[])?.[0];
              return (
                <tr key={call.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-900">
                    {(call.sdr as unknown as Profile)?.full_name || '—'}
                  </td>
                  <td className="py-3 px-4 text-gray-600">{call.prospect_name || '—'}</td>
                  <td className="py-3 px-4 text-gray-600">{call.call_date}</td>
                  <td className="py-3 px-4 min-w-[180px]">
                    {audioUrls[call.id] ? (
                      <AudioPlayer src={audioUrls[call.id]} compact />
                    ) : (
                      <span className="text-xs text-gray-300">--</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {analysis ? (
                      <span className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
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
                  <td className="py-3 px-4">
                    {call.status === 'completed' && (
                      <Link
                        to={`/calls/${call.id}`}
                        className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
                      >
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Phone className="h-6 w-6 mb-2" />
            <p className="text-sm">No calls found</p>
          </div>
        )}
      </div>
    </div>
  );
}
