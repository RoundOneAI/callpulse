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
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { uploadCall, uploadAudioCall } from '../services/calls';
import { processCallAsync } from '../services/analysis';
import { supabase } from '../services/supabase';
import type { Profile } from '../types';
import { cn } from '../utils/cn';

interface UploadItem {
  id: string;
  file: File | null;
  transcript: string;
  sdrId: string;
  callDate: string;
  prospectName: string;
  status: 'pending' | 'uploading' | 'queued' | 'error';
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

    // Process all uploads in parallel
    const uploads = items
      .filter(item => item.status === 'pending')
      .map(async (item) => {
        if (!item.sdrId) {
          updateItem(item.id, { status: 'error', error: 'Select an SDR' });
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
              return;
            }

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
          updateItem(item.id, {
            status: 'error',
            error: err.message || 'Failed to upload',
          });
        }
      });

    await Promise.all(uploads);

    setQueuedCount(queued);
    if (queued > 0) setAllQueued(true);
    setProcessing(false);
  }

  function resetAndUploadMore() {
    setItems([]);
    setAllQueued(false);
    setQueuedCount(0);
  }

  const pendingCount = items.filter(i => i.status === 'pending').length;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload Calls</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload transcripts or audio recordings — they'll be processed in the background
        </p>
      </div>

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
      {!allQueued && (
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

      {/* Upload queue */}
      {items.length > 0 && (
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

              {item.status === 'pending' && (
                <button onClick={() => removeItem(item.id)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              )}
              {item.status === 'uploading' && (
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
