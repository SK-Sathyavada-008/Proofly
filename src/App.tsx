// ─────────────────────────────────────────────
// App.tsx — Proofly Root Application Router
// Clean, Modern SaaS Architecture
// ─────────────────────────────────────────────

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProoflyAuthProvider } from './context/ProoflyAuthContext';

// Layouts
import { OrganizerLayout } from './layouts/OrganizerLayout';
import { JudgeLayout } from './layouts/JudgeLayout';
import { ParticipantLayout } from './layouts/ParticipantLayout';

// Public Pages
import { LandingHubPage } from './pages/LandingHubPage';
import { AuthPage } from './pages/AuthPage';
import AiLogicTestPage from './pages/AiLogicTestPage';
import { PublicLeaderboardPage } from './pages/PublicLeaderboardPage';

// Route Protection
import { ProtectedRoute } from './components/auth/ProtectedRoute';

// Organizer Pages
import { OrganizerOverviewPage } from './pages/organizer/OrganizerOverviewPage';
import { CompetitionListPage } from './pages/organizer/CompetitionListPage';
import { CompetitionFormsAndAccessPage } from './pages/organizer/CompetitionFormsAndAccessPage';
import { SubmissionListPage } from './pages/organizer/SubmissionListPage';
import { OrganizerEvaluationsPage } from './pages/organizer/OrganizerEvaluationsPage';
import { OrganizerJudgesPage } from './pages/organizer/OrganizerJudgesPage';
import { OrganizerResultsPage } from './pages/organizer/OrganizerResultsPage';
import { OrganizerSettingsPage } from './pages/organizer/OrganizerSettingsPage';

// Judge Pages
import { JudgeAssignmentListPage } from './pages/judge/JudgeAssignmentListPage';
import { JudgeReviewWorkspacePage } from './pages/judge/JudgeReviewWorkspacePage';
import { JudgeHistoryPage } from './pages/judge/JudgeHistoryPage';

// Participant Pages
import { ParticipantSubmissionPage } from './pages/participant/ParticipantSubmissionPage';
import { ParticipantSubmissionManagePage } from './pages/participant/ParticipantSubmissionManagePage';

export default function App() {
  return (
    <ProoflyAuthProvider>
      <BrowserRouter>
        <Routes>
        {/* Public Landing & Product Entry Hub */}
        <Route path="/" element={<LandingHubPage />} />

        {/* Firebase Authentication & Invitation Onboarding */}
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/login" element={<AuthPage initialMode="signin" />} />
        <Route path="/signup" element={<AuthPage initialMode="signup" />} />
        <Route path="/reset-password" element={<AuthPage initialMode="reset" />} />

        {/* Phase 1: Firebase AI Logic Hybrid Inference Spike */}
        <Route path="/ai-test" element={<AiLogicTestPage />} />

        {/* ── 1. ORGANIZER COMMAND CENTER (Protected: Organizer/Admin/Viewer Scope) ── */}
        <Route
          path="/organizer"
          element={
            <ProtectedRoute requiredWorkspace="organizer">
              <OrganizerLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<OrganizerOverviewPage />} />
          <Route path="overview" element={<OrganizerOverviewPage />} />
          <Route path="competitions" element={<CompetitionListPage />} />
          <Route path="forms" element={<CompetitionFormsAndAccessPage />} />
          <Route path="submissions" element={<SubmissionListPage />} />
          <Route path="evaluations" element={<OrganizerEvaluationsPage />} />
          <Route path="judges" element={<OrganizerJudgesPage />} />
          <Route path="results" element={<OrganizerResultsPage />} />
          <Route path="settings" element={<OrganizerSettingsPage />} />
          <Route path="*" element={<Navigate to="/organizer" replace />} />
        </Route>

        {/* ── 2. JUDGE WORKSPACE (Protected: Authorized Judge/Organizer Scope) ── */}
        <Route
          path="/judge"
          element={
            <ProtectedRoute requiredWorkspace="judge">
              <JudgeLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/judge/assignments" replace />} />
          <Route path="assignments" element={<JudgeAssignmentListPage />} />
          <Route path="review" element={<JudgeReviewWorkspacePage />} />
          <Route path="history" element={<JudgeHistoryPage />} />
          <Route path="*" element={<Navigate to="/judge/assignments" replace />} />
        </Route>

        {/* ── 3. PARTICIPANT SUBMISSION PORTAL ── */}
        <Route path="/submit" element={<ParticipantLayout />}>
          <Route index element={<ParticipantSubmissionPage />} />
          <Route path="manage" element={<ParticipantSubmissionManagePage />} />
        </Route>
        <Route path="/p" element={<ParticipantLayout />}>
          <Route index element={<Navigate to="/submit" replace />} />
          <Route path="submit" element={<ParticipantSubmissionPage />} />
          <Route path="manage" element={<ParticipantSubmissionManagePage />} />
        </Route>

        {/* Public Official Leaderboard (Phase 8) */}
        <Route path="/leaderboard" element={<PublicLeaderboardPage />} />
        <Route path="/leaderboard/:competitionId" element={<PublicLeaderboardPage />} />

        {/* Legacy redirect */}
        <Route path="/admin/*" element={<Navigate to="/organizer" replace />} />

        {/* Global Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </ProoflyAuthProvider>
  );
}
