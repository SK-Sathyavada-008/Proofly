import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ProoflyGlobalHeader } from '../components/layout/ProoflyGlobalHeader';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { useProoflyAuth } from '../context/ProoflyAuthContext';
import { competitionService } from '../services/competitionService';
import type { Competition } from '../types/authAndCompetition';

export const LandingHubPage: React.FC = () => {
  const { activeOrganization } = useProoflyAuth();
  const [competitions, setCompetitions] = useState<Competition[]>([]);

  useEffect(() => {
    if (activeOrganization) {
      competitionService
        .listOrganizationCompetitions(activeOrganization.id)
        .then((comps) => {
          setCompetitions(comps);
        })
        .catch(() => {
          setCompetitions([]);
        });
    } else {
      setCompetitions([]);
    }
  }, [activeOrganization]);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 font-sans flex flex-col w-full">
      <ProoflyGlobalHeader />

      <main className="proofly-page-enter flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 space-y-16">
        {/* Hero */}
        <section className="max-w-2xl space-y-5">
          <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight leading-tight">
            Structured project evaluation for competitions.
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
            Collect submissions without participant accounts, pre-evaluate evidence with Firebase AI
            Logic, coordinate human judges, and publish audited results.
          </p>
          <div className="flex flex-wrap items-center gap-2.5 pt-2">
            <Link to="/organizer">
              <Button variant="primary" size="sm" rightIcon={<ArrowRight size={14} />}>
                Organizer console
              </Button>
            </Link>
            <Link to="/judge/assignments">
              <Button variant="secondary" size="sm">
                Judge workspace
              </Button>
            </Link>
            <Link to="/submit">
              <Button variant="outline" size="sm">
                Submit project
              </Button>
            </Link>
            <Link to="/leaderboard">
              <Button variant="outline" size="sm">
                Leaderboard
              </Button>
            </Link>
          </div>
        </section>

        {/* Core Workflows — Quiet 3-column strip */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 border-t border-slate-200 dark:border-slate-800">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Intake without accounts</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Participants submit via competition access codes or single-use links with verified
              multi-file uploads and hashed management tokens.
            </p>
            <div className="pt-1">
              <Link
                to="/submit"
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                Open submission form →
              </Link>
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Evidence-grounded pre-review</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Hybrid on-device and cloud inference evaluates submitted documents against immutable
              rubrics and surfaces exact deductions and evidence gaps.
            </p>
            <div className="pt-1">
              <Link
                to="/ai-test"
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                Inspect AI runtime →
              </Link>
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Human authority & audit trail</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Judges review assigned submissions with blind mode and locked scorecards. Official
              rankings default strictly to human scores with an append-only ledger.
            </p>
            <div className="pt-1">
              <Link
                to="/organizer/results"
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                View results console →
              </Link>
            </div>
          </div>
        </section>

        {/* Active Competitions Table */}
        <section className="space-y-3 pt-8 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {activeOrganization?.name || 'Competitions'}
            </h2>
            <Link
              to="/organizer/competitions"
              className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              Manage all →
            </Link>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competition</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Access code</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competitions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No competitions created yet.{' '}
                    <Link
                      to="/organizer/competitions?action=create"
                      className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Create your first competition →
                    </Link>
                  </TableCell>
                </TableRow>
              ) : (
                competitions.map((comp) => (
                <TableRow key={comp.id}>
                  <TableCell>
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100">{comp.title}</span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        comp.status === 'ACTIVE'
                          ? 'success'
                          : comp.status === 'EVALUATION'
                          ? 'warning'
                          : 'neutral'
                      }
                      size="sm"
                    >
                      {comp.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{comp.publicAccessCode}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {comp.policies.submissionDeadline.split('T')[0]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link
                        to={`/submit?code=${comp.publicAccessCode}`}
                        className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                      >
                        Submit
                      </Link>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <Link
                        to={`/organizer/submissions?comp=${comp.id}`}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                      >
                        Submissions
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))
              )}
            </TableBody>
          </Table>
        </section>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-5 text-center text-xs text-slate-400 dark:text-slate-500">
        Proofly
      </footer>
    </div>
  );
};
