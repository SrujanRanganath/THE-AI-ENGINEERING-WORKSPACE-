import React, { useState } from 'react';
import { Check, X, FileCode, AlertCircle, ArrowRight } from 'lucide-react';

export interface ModifiedFile {
  path: string;
  action: 'modified' | 'added' | 'deleted';
  changeDescription: string;
  content: string;
  language?: string;
}

interface DiffViewerProps {
  summary: string;
  modifiedFiles: ModifiedFile[];
  originalFiles: Array<{ path: string; content: string; language: string }>;
  onApply: () => void;
  onCancel: () => void;
  applying?: boolean;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  summary,
  modifiedFiles,
  originalFiles,
  onApply,
  onCancel,
  applying = false,
}) => {
  const [selectedPath, setSelectedPath] = useState<string>(
    modifiedFiles[0]?.path || ''
  );

  const selectedMod = modifiedFiles.find((f) => f.path === selectedPath) || modifiedFiles[0];
  const origFile = originalFiles.find((f) => f.path === selectedPath);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-[#0d121d] border border-white/10 rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-start justify-between bg-[#0a0e17]">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">
              <AlertCircle size={14} />
              Review Proposed Code Modifications
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-slate-100">{summary}</h3>
            <p className="text-xs text-slate-400 mt-1">
              {modifiedFiles.length} file{modifiedFiles.length > 1 ? 's' : ''} affected. Inspect changes
              before applying.
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={applying}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* File selector tabs */}
        <div className="flex border-b border-white/10 overflow-x-auto bg-[#080b12] px-4 py-2 gap-2">
          {modifiedFiles.map((file) => {
            const isSelected = file.path === selectedPath;
            return (
              <button
                key={file.path}
                onClick={() => setSelectedPath(file.path)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <FileCode size={13} />
                <span>{file.path}</span>
                <span
                  className={`text-[10px] px-1 rounded uppercase font-bold ${
                    file.action === 'added'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : file.action === 'deleted'
                      ? 'bg-rose-500/20 text-rose-400'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  {file.action}
                </span>
              </button>
            );
          })}
        </div>

        {/* File Description */}
        {selectedMod && (
          <div className="px-5 py-2.5 bg-blue-950/20 border-b border-blue-900/30 text-xs text-blue-200 flex items-center gap-2">
            <span className="font-semibold uppercase text-[10px] text-blue-400">Change Note:</span>
            <span>{selectedMod.changeDescription || 'Updated file according to specification.'}</span>
          </div>
        )}

        {/* Side-by-Side Comparison */}
        <div className="flex-1 min-h-[300px] overflow-hidden grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10">
          {/* Before */}
          <div className="flex flex-col h-full overflow-hidden bg-[#07090f]">
            <div className="px-4 py-2 text-xs font-medium text-slate-400 bg-white/[0.02] border-b border-white/5 flex items-center justify-between">
              <span>Original (Current Version)</span>
              <span className="text-[11px] text-slate-500">
                {origFile ? `${origFile.content.split('\n').length} lines` : 'File does not exist yet'}
              </span>
            </div>
            <div className="flex-1 p-4 overflow-auto font-mono text-xs text-slate-400 leading-relaxed">
              {origFile ? (
                <pre>{origFile.content}</pre>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 italic">
                  New file will be created
                </div>
              )}
            </div>
          </div>

          {/* After */}
          <div className="flex flex-col h-full overflow-hidden bg-[#080d1a]">
            <div className="px-4 py-2 text-xs font-medium text-emerald-400 bg-emerald-950/20 border-b border-emerald-900/30 flex items-center justify-between">
              <span>Proposed (Modified Version)</span>
              <span className="text-[11px] text-emerald-500">
                {selectedMod?.content
                  ? `${selectedMod.content.split('\n').length} lines`
                  : 'Empty'}
              </span>
            </div>
            <div className="flex-1 p-4 overflow-auto font-mono text-xs text-slate-200 leading-relaxed bg-[#060a14]">
              {selectedMod ? (
                <pre>{selectedMod.content}</pre>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-600 italic">
                  No preview available
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer with Actions */}
        <div className="p-4 border-t border-white/10 bg-[#0a0e17] flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400 hidden sm:block">
            Changes will be saved as a new version and can be restored anytime.
          </p>
          <div className="flex items-center gap-2.5 ml-auto">
            <button
              onClick={onCancel}
              disabled={applying}
              className="px-4 py-2 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onApply}
              disabled={applying}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50"
            >
              <Check size={16} />
              {applying ? 'Applying Modifications...' : 'Apply Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
