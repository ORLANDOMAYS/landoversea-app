import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';

import Shell from './components/layout/Shell';
import AuthGuard from './components/auth/AuthGuard';
import { I18nProvider } from './i18n';
import { AuthProvider } from './lib/auth';

// Utility
import { lazy, Suspense, type ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never retry 4xx errors (auth, not-found, forbidden, etc.)
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number })?.status;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,          // 30 s default — prevents back-to-back refetches
      gcTime: 5 * 60_000,        // 5 min cache before GC
      refetchOnWindowFocus: false,
    },
  },
});

// Root tab paths get a crossfade; child screens slide in from the right.
const ROOT_TABS = new Set(['/discover', '/matches', '/messages', '/coaches', '/profile']);

function PageTransition({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const isTab = ROOT_TABS.has(location);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location}
        // `pointerEvents` is animated as a discrete value: the outgoing page
        // gets `none` for the whole exit so it cannot intercept taps meant for
        // the incoming page while both are briefly mounted.
        initial={isTab ? { opacity: 0 } : { x: '5%', opacity: 0 }}
        animate={{ x: 0, opacity: 1, pointerEvents: 'auto' }}
        exit={
          isTab
            ? { opacity: 0, pointerEvents: 'none' }
            : { x: '-3%', opacity: 0, pointerEvents: 'none' }
        }
        transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function RouteLoading() {
  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 0,
      }}
      aria-busy="true"
    >
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
function RootRedirect() {
  return <Redirect to="/discover" />;
}

function Router() {
  return (
    <AuthGuard>
      {(user) => (
        <Shell user={user}>
          <PageTransition>
            <Suspense fallback={<RouteLoading />}>
            <Switch>
            <Route path="/" component={RootRedirect} />

            {/* Auth */}
            <Route path="/login" component={Login} />
            <Route path="/auth/callback" component={AuthCallback} />
            <Route path="/register" component={Register} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/forgot-password" component={ForgotPassword} />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/verify-email" component={VerifyEmail} />
            <Route path="/delete-account" component={DeleteAccount} />

            {/* Core dating */}
            <Route path="/discover" component={Discover} />
            <Route path="/matches" component={Matches} />
            <Route path="/who-liked-me" component={WhoLikedMe} />
            <Route path="/filters" component={FiltersPage} />
            <Route path="/voice-intro" component={VoiceIntro} />

            {/* Messages */}
            <Route path="/messages" component={Messages} />
            <Route path="/messages/:conversationId" component={Conversation} />
            <Route path="/video-call/:callId" component={VideoCall} />

            {/* Profile */}
            <Route path="/profile" component={Profile} />
            <Route path="/profile/:userId" component={ProfileDetails} />
            <Route path="/edit-profile" component={EditProfile} />
            <Route path="/premium" component={Premium} />
            <Route path="/settings" component={Settings} />
            <Route path="/verification" component={Verification} />
            <Route path="/notifications" component={Notifications} />

            {/* Coaches — specific subroutes BEFORE dynamic :coachId */}
            <Route path="/coaches" component={Coaches} />
            <Route path="/coaches/ai" component={AICoach} />
            <Route path="/coaches/conversation" component={ConversationCoach} />
            <Route path="/coaches/profile-coach" component={ProfileCoach} />
            <Route path="/coaches/safety-advice" component={SafetyAdvicePage} />
            <Route path="/coaches/apply" component={CoachApply} />
            <Route path="/coaches/verify" component={CoachVerify} />
            <Route path="/coaches/:coachId/book" component={BookCoach} />
            <Route path="/coaches/:coachId" component={CoachProfile} />
            <Route path="/coaching" component={CoachingHub} />
            <Route path="/coach-dashboard" component={CoachDashboard} />
            <Route path="/client-progress" component={ClientProgress} />

            {/* Cultural & Social */}
            <Route path="/cultural" component={CulturalPassport} />
            <Route path="/passport" component={CulturalPassport} />
            <Route path="/tribes" component={Tribes} />
            <Route path="/events" component={EventsPage} />
            <Route path="/events/:eventId" component={EventDetail} />

            {/* Learning */}
            <Route path="/learn" component={LearnHub} />
            <Route path="/quiz" component={LearnHub} />
            <Route path="/learn/quiz/:quizId" component={QuizView} />

            {/* Workshops */}
            <Route path="/workshops" component={Workshops} />
            <Route path="/workshops/:workshopId" component={WorkshopDetail} />

            {/* Utility / Discovery */}
            <Route path="/user-dashboard" component={UserDashboard} />
            <Route path="/leaderboard" component={Leaderboard} />
            <Route path="/safety" component={Safety} />

            {/* Admin */}
            <Route path="/admin" component={AdminPanel} />

            {/* Legal */}
            <Route path="/terms" component={Terms} />
            <Route path="/privacy" component={Privacy} />

            <Route component={NotFound} />
            </Switch>
            </Suspense>
          </PageTransition>
        </Shell>
      )}
    </AuthGuard>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <RoutedErrorBoundary>
                <Router />
              </RoutedErrorBoundary>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

const Login = lazy(() => import('./pages/login'));
const AuthCallback = lazy(() => import('./pages/auth-callback'));
const Register = lazy(() => import('./pages/register'));
const Onboarding = lazy(() => import('./pages/onboarding'));
const ForgotPassword = lazy(() => import('./pages/forgot-password'));
const ResetPassword = lazy(() => import('./pages/reset-password'));
const VerifyEmail = lazy(() => import('./pages/verify-email'));
const DeleteAccount = lazy(() => import('./pages/delete-account'));
const Discover = lazy(() => import('./pages/discover'));
const ProfileDetails = lazy(() => import('./pages/profile-details'));

const Matches = lazy(() => import('./pages/matches'));

const AICoach = lazy(() => import('./pages/ai-coach'));

const BookCoach = lazy(() => import('./pages/book-coach'));

const CoachDashboard = lazy(() => import('./pages/coach-dashboard'));

const Profile = lazy(() => import('./pages/profile'));

const WhoLikedMe = lazy(() => import('./pages/who-liked-me'));

const CoachingHub = lazy(() => import('./pages/coaching'));

const ConversationCoach = lazy(() => import('./pages/conversation-coach'));

const CoachApply = lazy(() => import('./pages/coach-apply'));

const FiltersPage = lazy(() => import('./pages/filters-page'));

const CulturalPassport = lazy(() => import('./pages/cultural'));

const LearnHub = lazy(() => import('./pages/learn'));

const Workshops = lazy(() => import('./pages/workshops'));

const NotFound = lazy(() => import('@/pages/not-found'));

const CoachProfile = lazy(() => import('./pages/coach-profile'));

const ClientProgress = lazy(() => import('./pages/client-progress'));

const Privacy = lazy(() => import('./pages/privacy'));

const Conversation = lazy(() => import('./pages/conversation'));

const VideoCall = lazy(() => import('./pages/video-call'));

const Premium = lazy(() => import('./pages/premium'));

const SafetyAdvicePage = lazy(() => import('./pages/safety-advice'));

const ProfileCoach = lazy(() => import('./pages/profile-coach'));

const Leaderboard = lazy(() => import('./pages/leaderboard'));

const CoachVerify = lazy(() => import('./pages/coach-verify'));

const EventDetail = lazy(() => import('./pages/event-detail'));

const AdminPanel = lazy(() => import('./pages/admin'));

const Notifications = lazy(() => import('./pages/notifications'));

const Settings = lazy(() => import('./pages/settings'));

const EventsPage = lazy(() => import('./pages/events'));

const UserDashboard = lazy(() => import('./pages/user-dashboard'));

const Terms = lazy(() => import('./pages/terms'));

const EditProfile = lazy(() => import('./pages/edit-profile'));

const Coaches = lazy(() => import('./pages/coaches'));

const Safety = lazy(() => import('./pages/safety'));

const VoiceIntro = lazy(() => import('./pages/voice-intro'));

const WorkshopDetail = lazy(() => import('./pages/workshop-detail'));

const Messages = lazy(() => import('./pages/messages'));

const QuizView = lazy(() => import('./pages/quiz'));

const Verification = lazy(() => import('./pages/verification'));

const Tribes = lazy(() => import('./pages/tribes'));
