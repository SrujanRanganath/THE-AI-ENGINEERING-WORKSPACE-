import React, { useState, useEffect } from 'react';
import { useAuth } from '../../lib/authContext';
import { getActivityLogs, ActivityLogRecord } from '../../lib/firestoreService';
import {
  Activity,
  Code2,
  Globe,
  FileText,
  Table2,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

export const ActivityPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [activities, setActivities] = useState<ActivityLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const fetchActivities = async () => {
    if (!currentUser?.uid) return;
    setLoading(true);
    setError(null);
    try {
      const logs = await getActivityLogs(currentUser.uid, 50);
      setActivities(logs);
    } catch (err: any) {
      console.error(err);
      setError('Could not load activity log.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, [currentUser?.uid]);

  const filtered = activities.filter((a) =>
    filterType === 'all' ? true : a.activityType === filterType
  );

  return (
    <div data-tour="activity-stream" className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-violet-400 mb-1">
            <Activity size={15} />
            <span>Audit Trail</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Workspace Activity Log
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Recorded user activity across all 4 intelligent agents and workspace operations.
          </p>
        </div>

        <button
          onClick={fetchActivities}
          className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-xs text-zinc-300 flex items-center gap-1.5 transition-colors self-start sm:self-auto"
        >
          <RefreshCw size={13} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2.5">
          <AlertCircle size={16} className="text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 p-1 bg-[#111116] border border-zinc-800/80 rounded-lg w-fit overflow-x-auto">
        {(
          [
            { id: 'all', label: 'All Activity' },
            { id: 'code', label: 'Code Generator' },
            { id: 'website', label: 'Website Generator' },
            { id: 'document', label: 'Document Generator' },
            { id: 'dataset', label: 'Data Cleaner' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterType(tab.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              filterType === tab.id
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Activity Timeline */}
      <div className="rounded-2xl bg-[#111116] border border-zinc-800/80 p-5">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-zinc-500 gap-2">
            <Loader2 size={24} className="animate-spin text-violet-400" />
            <span className="text-xs">Fetching audit logs...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-zinc-500">
            <Activity size={32} className="mx-auto mb-2 text-zinc-600" />
            <p className="text-xs font-medium">No activity recorded for this filter.</p>
          </div>
        ) : (
          <div className="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-px before:bg-zinc-800">
            {filtered.map((item) => (
              <div key={item.id} className="relative flex items-start gap-3 text-xs">
                {/* Dot icon */}
                <div
                  className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                    item.activityType === 'code'
                      ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30'
                      : item.activityType === 'website'
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                      : item.activityType === 'document'
                      ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30'
                      : 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                  }`}
                >
                  {item.activityType === 'code' && <Code2 size={11} />}
                  {item.activityType === 'website' && <Globe size={11} />}
                  {item.activityType === 'document' && <FileText size={11} />}
                  {item.activityType === 'dataset' && <Table2 size={11} />}
                </div>

                <div className="flex-1 bg-[#09090b] border border-zinc-800/80 p-3.5 rounded-xl">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono uppercase tracking-wider text-[10px] text-zinc-400">
                      {item.activityType}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-zinc-200 text-xs leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
