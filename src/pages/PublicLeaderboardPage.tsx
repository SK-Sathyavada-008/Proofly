import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, Lock } from 'lucide-react';
import { ProoflyGlobalHeader } from '../components/layout/ProoflyGlobalHeader';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { resultsAndAnalyticsService } from '../services/resultsAndAnalyticsService';
import type { RankedEntry, ResultPublicationRecord, RankingScope } from '../types/scoringAndResults';

export const PublicLeaderboardPage: React.FC = () => {
  const { competitionId } = useParams<{ competitionId?: string }>();
  const [publishedList, setPublishedList] = useState<ResultPublicationRecord[]>([]);
  const [selectedCompId, setSelectedCompId] = useState<string>(competitionId || '');
  const [scope, setScope] = useState<RankingScope>('OVERALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  useEffect(() => {
    const allPublished = resultsAndAnalyticsService.listPublishedLeaderboards();
    setPublishedList(allPublished);
    if (competitionId) {
      setSelectedCompId(competitionId);
    } else if (allPublished.length > 0 && !selectedCompId) {
      setSelectedCompId(allPublished[0].competitionId);
    }
  }, [competitionId, selectedCompId]);

  const activePublication = useMemo(() => {
    if (!selectedCompId) return null;
    return resultsAndAnalyticsService.getPublicLeaderboard(selectedCompId);
  }, [selectedCompId, publishedList]);

  const categories = useMemo(() => {
    if (!activePublication) return [];
    return Array.from(new Set(activePublication.entries.map((e) => e.category))).sort();
  }, [activePublication]);

  const filteredEntries = useMemo<RankedEntry[]>(() => {
    if (!activePublication) return [];
    let list = [...activePublication.entries];

    if (scope === 'INDIVIDUAL') {
      list = list.filter((e) => e.submissionType === 'INDIVIDUAL');
    } else if (scope === 'TEAM') {
      list = list.filter((e) => e.submissionType === 'TEAM');
    } else if (scope === 'CATEGORY' && selectedCategory !== 'ALL') {
      list = list.filter((e) => e.category === selectedCategory);
    }

    return list.map((entry, idx) => {
      if (scope === 'OVERALL') return entry;
      if (idx === 0) return { ...entry, rank: 1 };
      const prev = list[idx - 1];
      const sameScore = Math.abs(prev.officialScore - entry.officialScore) < 1e-6;
      const isTied = sameScore && entry.isTied && prev.isTied;
      return {
        ...entry,
        rank: isTied ? prev.rank : idx + 1,
      };
    });
  }, [activePublication, scope, selectedCategory]);

  const handleDownloadCsv = () => {
    if (!activePublication) return;
    const csv = resultsAndAnalyticsService.exportResultsToCsv(
      filteredEntries,
      activePublication.competitionTitle,
      `OFFICIAL_v${activePublication.version}`
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activePublication.publicSlug}-official-results-v${activePublication.version}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50/60 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 font-sans flex flex-col">
      <ProoflyGlobalHeader />

      <main className="proofly-page-enter flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
              {activePublication ? activePublication.competitionTitle : 'Leaderboard'}
            </h1>
            {activePublication && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Official v{activePublication.version} · Published{' '}
                {activePublication.publishedAt
                  ? new Date(activePublication.publishedAt).toLocaleDateString()
                  : ''}{' '}
                · {activePublication.policySnapshot.policyType.replace(/_/g, ' ')}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {publishedList.length > 1 && (
              <select
                value={selectedCompId}
                onChange={(e) => setSelectedCompId(e.target.value)}
                className="text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-200 transition-colors"
              >
                {publishedList.map((p) => (
                  <option key={p.competitionId} value={p.competitionId}>
                    {p.competitionTitle} (v{p.version})
                  </option>
                ))}
              </select>
            )}
            {activePublication && (
              <Button
                variant="outline"
                size="xs"
                leftIcon={<Download size={13} />}
                onClick={handleDownloadCsv}
              >
                Export CSV
              </Button>
            )}
          </div>
        </div>

        {!activePublication ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl py-12 px-6 text-center space-y-3">
            <Lock size={20} className="text-slate-400 dark:text-slate-500 mx-auto" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Results not published</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Official standings appear here once approved and published by the organizer.
              </p>
            </div>
            <div className="pt-1">
              <Link to="/organizer/results">
                <Button variant="outline" size="xs">
                  Go to results console
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Top 3 Summary Strip */}
            {filteredEntries.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {filteredEntries.slice(0, 3).map((entry) => (
                  <div
                    key={entry.submissionId}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-2 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        #{entry.rank} {entry.isTied ? '(Tied)' : ''}
                      </span>
                      <span className="text-slate-400 dark:text-slate-500">{entry.category}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {entry.projectTitle}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {entry.teamOrParticipantName}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-baseline justify-between">
                      <span className="text-base font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {entry.officialScore.toFixed(2)}
                        <span className="text-xs text-slate-400 dark:text-slate-500 font-normal">
                          {' '}/ {entry.maxPossibleScore}
                        </span>
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {entry.judgeCount} {entry.judgeCount === 1 ? 'judge' : 'judges'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Scope Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {(
                  [
                    { key: 'OVERALL', label: 'Overall' },
                    { key: 'TEAM', label: 'Teams' },
                    { key: 'INDIVIDUAL', label: 'Individuals' },
                    { key: 'CATEGORY', label: 'Category' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setScope(item.key)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer ${
                      scope === item.key
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {scope === 'CATEGORY' && (
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1.5 text-slate-700 dark:text-slate-200"
                >
                  <option value="ALL">All categories</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Standings Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Team / Participant</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Judges</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow key={entry.submissionId}>
                    <TableCell>
                      <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        #{entry.rank}
                      </span>
                      {entry.isTied && (
                        <Badge variant="warning" size="sm" className="ml-1.5">
                          Tie
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium text-slate-900 dark:text-slate-100 block">
                        {entry.projectTitle}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                        {entry.referenceId}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-700 dark:text-slate-300">{entry.teamOrParticipantName}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{entry.category}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {entry.officialScore.toFixed(2)} / {entry.maxPossibleScore}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{entry.judgeCount}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {entry.tieBrokenBy || (entry.isTied ? 'Shared rank' : '—')}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </main>
    </div>
  );
};
