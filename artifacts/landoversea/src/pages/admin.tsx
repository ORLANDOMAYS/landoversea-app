import { useState } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import {
  useGetCurrentUser,
  useAdminGetAnalytics,
  useAdminListReports,
  useAdminListVerifications,
  useAdminReviewReport,
  useAdminReviewVerification,
  useAdminListCoaches,
  useAdminVerifyCoach,
  useAdminSetCoachPayoutReady,
  useAdminGetCoachAudit,
  useAdminListCoachCredentials,
  getAdminStreamCoachCredentialUrl,
  useGetCulturalFacts,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  ShieldAlert,
  Users,
  UserPlus,
  Heart,
  MessageCircle,
  Crown,
  BarChart2,
  Activity,
  Star,
  CheckCircle,
  Flag,
  Globe,
  Trash2,
  Plus,
  FileText,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useI18n } from '@/i18n';

type TabId = 'verifications' | 'coaches' | 'reports' | 'metrics' | 'culture';

const TABS: { id: TabId; label: string }[] = [
  { id: 'verifications', label: 'Verifications' },
  { id: 'coaches', label: 'Coaches' },
  { id: 'reports', label: 'Reports' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'culture', label: 'Culture Facts' },
];

const REASON_COLORS: Record<string, string> = {
  harassment: 'text-red-400 border-red-500/30 bg-red-500/10',
  spam: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  inappropriate: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
  fake: 'text-[#8B5CF6] border-[#8B5CF6]/30 bg-[#8B5CF6]/10',
  other: 'text-muted-foreground border-border bg-muted',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
  approved: 'text-green-400 border-green-500/30 bg-green-500/10',
  rejected: 'text-red-400 border-red-500/30 bg-red-500/10',
  reviewed: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  dismissed: 'text-muted-foreground border-border bg-muted',
  actioned: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  escalated: 'text-[#8B5CF6] border-[#8B5CF6]/30 bg-[#8B5CF6]/10',
};

const CATEGORIES = ['History', 'Food', 'Customs', 'Language', 'Festivals', 'Etiquette'];

// Metrics tab
function MetricsTab() {
  const { data: analytics, isLoading } = useAdminGetAnalytics();

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-[#FF2D7A]" /></div>;
  }

  const maxCount = Math.max(...(analytics?.topCountries?.map((c) => c.count ?? 0) ?? [1]), 1);

  const stats = [
    { label: 'Total Users', value: analytics?.totalUsers ?? 0, icon: <Users className="w-5 h-5 text-[#63E6FF]" /> },
    { label: 'New This Week', value: analytics?.newUsersThisWeek ?? 0, icon: <UserPlus className="w-5 h-5 text-[#FF2D7A]" /> },
    { label: 'Total Matches', value: analytics?.totalMatches ?? 0, icon: <Heart className="w-5 h-5 text-[#8B5CF6]" /> },
    { label: 'Messages Sent', value: analytics?.totalMessages ?? 0, icon: <MessageCircle className="w-5 h-5 text-[#63E6FF]" /> },
    { label: 'Premium Subs', value: analytics?.activeSubscriptions ?? 0, icon: <Crown className="w-5 h-5 text-yellow-400" /> },
    {
      label: 'Conversion %',
      value: analytics?.totalUsers ? `${Math.round(((analytics?.activeSubscriptions ?? 0) / analytics.totalUsers) * 100)}%` : '0%',
      icon: <BarChart2 className="w-5 h-5 text-green-400" />,
    },
    { label: 'Pending Reports', value: analytics?.pendingReports ?? 0, icon: <Activity className="w-5 h-5 text-orange-400" /> },
    { label: 'Total Coaches', value: analytics?.totalCoaches ?? 0, icon: <Star className="w-5 h-5 text-blue-400" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              {s.icon}
              <span className="text-muted-foreground text-xs">{s.label}</span>
            </div>
            <div className="text-2xl font-bold text-foreground">{s.value}</div>
          </div>
        ))}
      </div>

      {analytics?.topCountries && analytics.topCountries.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <h3 className="font-serif text-foreground text-lg mb-4">Top Countries</h3>
          <div className="space-y-3">
            {analytics.topCountries.map((tc, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-foreground text-sm">{tc.country || 'Unknown'}</span>
                  <span className="text-muted-foreground text-xs">{tc.count} users</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#FF2D7A]/60 transition-all"
                    style={{ width: `${Math.round(((tc.count ?? 0) / maxCount) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-muted-foreground text-xs text-center mt-4">Metrics updated in real-time</p>
    </div>
  );
}

// Verifications tab
function VerificationsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const { data: verifications, isLoading } = useAdminListVerifications({ status: statusFilter });
  const reviewMutation = useAdminReviewVerification();

  const handleReview = (verifId: number, status: 'approved' | 'rejected') => {
    setLoadingId(verifId);
    reviewMutation.mutate(
      { requestId: verifId, data: { status, adminNotes: adminNotes[verifId] || null } },
      {
        onSuccess: () => {
          toast({ title: status === 'approved' ? 'Verification approved! ✓' : 'Verification rejected' });
          queryClient.invalidateQueries({ queryKey: ['/api/admin/verifications'] });
          queryClient.invalidateQueries({ queryKey: ['/api/admin/analytics'] });
        },
        onError: () => {
          toast({ title: 'Failed to update', variant: 'destructive' });
        },
        onSettled: () => setLoadingId(null),
      }
    );
  };

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="flex gap-2">
        {['pending', 'approved', 'rejected'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all capitalize font-medium ${
              statusFilter === s
                ? 'bg-[#FF2D7A]/20 border-[#FF2D7A] text-[#FF2D7A]'
                : 'glass border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-7 h-7 animate-spin text-[#FF2D7A]" /></div>}

      {!isLoading && (!verifications || verifications.length === 0) && (
        <div className="glass rounded-2xl p-8 text-center">
          <CheckCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">No {statusFilter} verifications</p>
        </div>
      )}

      {verifications?.map((verif: any) => (
        <div key={verif.id} className="glass rounded-2xl p-4 mb-3">
          {/* User row */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full glass flex items-center justify-center text-muted-foreground shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-foreground text-sm font-medium truncate">
                {verif.user?.name || verif.user?.displayName || `User #${verif.userId}`}
              </p>
              {verif.user?.email && (
                <p className="text-muted-foreground text-xs truncate">{verif.user.email}</p>
              )}
            </div>
            <div className="flex-none">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[verif.status] || STATUS_COLORS.other}`}>
                {verif.status}
              </span>
            </div>
          </div>

          {verif.createdAt && (
            <p className="text-muted-foreground text-xs mb-3">
              Submitted {new Date(verif.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}

          {/* Image comparison */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {verif.selfieUrl ? (
              <div>
                <p className="text-muted-foreground text-xs text-center mb-1">Selfie</p>
                <img src={verif.selfieUrl} alt="Selfie" className="glass rounded-xl h-32 w-full object-cover border border-border" />
              </div>
            ) : (
              <div>
                <p className="text-muted-foreground text-xs text-center mb-1">Selfie</p>
                <div className="glass rounded-xl h-32 flex items-center justify-center border border-border">
                  <span className="text-muted-foreground text-xs">No image</span>
                </div>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs text-center mb-1">Profile Photo</p>
              <div className="glass rounded-xl h-32 flex items-center justify-center border border-border">
                <span className="text-muted-foreground text-xs">Profile</span>
              </div>
            </div>
          </div>

          {/* Admin notes */}
          <textarea
            rows={2}
            placeholder="Admin notes (optional)..."
            value={adminNotes[verif.id] || ''}
            onChange={(e) => setAdminNotes((prev) => ({ ...prev, [verif.id]: e.target.value }))}
            className="glass-input w-full rounded-xl px-3 py-2 text-sm mb-3 placeholder:text-placeholder placeholder:opacity-100 outline-none resize-none"
          />

          {/* Actions (only if pending) */}
          {verif.status === 'pending' && (
            <div className="flex gap-2">
              <button
                onClick={() => handleReview(verif.id, 'approved')}
                disabled={loadingId === verif.id}
                className="glass border border-green-500/30 text-green-400 rounded-full px-4 py-1.5 text-sm flex-1 flex items-center justify-center gap-1 hover:bg-green-500/10 transition-all"
              >
                {loadingId === verif.id ? <Loader2 className="w-4 h-4 animate-spin" /> : '✓ Approve'}
              </button>
              <button
                onClick={() => handleReview(verif.id, 'rejected')}
                disabled={loadingId === verif.id}
                className="glass border border-red-500/30 text-red-400 rounded-full px-4 py-1.5 text-sm flex-1 flex items-center justify-center gap-1 hover:bg-red-500/10 transition-all"
              >
                {loadingId === verif.id ? <Loader2 className="w-4 h-4 animate-spin" /> : '✗ Reject'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const COACH_STATUS_COLORS: Record<string, string> = {
  unsubmitted: 'text-muted-foreground border-border bg-muted',
  pending: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
  approved: 'text-green-400 border-green-500/30 bg-green-500/10',
  rejected: 'text-red-400 border-red-500/30 bg-red-500/10',
};
function ReportsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const { data: reports, isLoading } = useAdminListReports({ status: statusFilter === 'all' ? undefined : statusFilter });
  const reviewMutation = useAdminReviewReport();

  const handleReview = (reportId: number, status: 'reviewed' | 'dismissed' | 'actioned') => {
    setLoadingId(reportId);
    reviewMutation.mutate(
      { reportId, data: { status, adminNotes: adminNotes[reportId] || null } },
      {
        onSuccess: () => {
          toast({ title: `Report ${status}` });
          queryClient.invalidateQueries({ queryKey: ['/api/admin/reports'] });
          queryClient.invalidateQueries({ queryKey: ['/api/admin/analytics'] });
        },
        onError: () => {
          toast({ title: 'Action failed', variant: 'destructive' });
        },
        onSettled: () => setLoadingId(null),
      }
    );
  };

  const filtered = (reports || []).filter((r: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.reporter?.name || '').toLowerCase().includes(q) ||
      (r.reported?.name || '').toLowerCase().includes(q) ||
      (r.reason || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
    );
  });

  const reasonKey = (reason: string) => {
    const key = (reason || '').split('_')[0].toLowerCase();
    return REASON_COLORS[key] || REASON_COLORS.other;
  };

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {['pending', 'reviewed', 'dismissed', 'actioned', 'all'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all capitalize font-medium ${
              statusFilter === s
                ? 'bg-[#FF2D7A]/20 border-[#FF2D7A] text-[#FF2D7A]'
                : 'glass border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search reports..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="glass-input w-full rounded-xl px-3 py-2 text-sm placeholder:text-placeholder placeholder:opacity-100 outline-none"
      />

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-7 h-7 animate-spin text-[#FF2D7A]" /></div>}

      {!isLoading && filtered.length === 0 && (
        <div className="glass rounded-2xl p-8 text-center">
          <Flag className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">No reports found</p>
        </div>
      )}

      {filtered.map((report: any) => (
        <div key={report.id} className="glass rounded-2xl p-4 mb-3">
          {/* Reporter / Reported rows */}
          <div className="space-y-1 mb-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground text-xs">reporter:</span>
              <span className="text-foreground font-medium">{report.reporter?.name || `#${report.reporterId}`}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground text-xs">reported:</span>
              <span className="text-foreground font-medium">{report.reported?.name || `#${report.reportedUserId}`}</span>
            </div>
          </div>

          {/* Reason + Status badges */}
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${reasonKey(report.reason)}`}>
              {report.reason?.replace(/_/g, ' ') || 'other'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[report.status] || STATUS_COLORS.other}`}>
              {report.status}
            </span>
          </div>

          {report.description && (
            <p className="text-muted-foreground text-sm line-clamp-2 mb-2">{report.description}</p>
          )}

          <p className="text-muted-foreground text-xs mb-3">
            {new Date(report.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>

          {/* Admin notes */}
          <textarea
            rows={2}
            placeholder="Admin notes..."
            value={adminNotes[report.id] || ''}
            onChange={(e) => setAdminNotes((prev) => ({ ...prev, [report.id]: e.target.value }))}
            className="glass-input w-full rounded-xl px-3 py-2 text-sm mb-3 placeholder:text-placeholder placeholder:opacity-100 outline-none resize-none"
          />

          {/* Actions (if pending) */}
          {report.status === 'pending' && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleReview(report.id, 'dismissed')}
                disabled={loadingId === report.id}
                className="glass border border-border text-muted-foreground rounded-full py-1.5 text-xs hover:glass-strong transition-all flex items-center justify-center"
              >
                {loadingId === report.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Dismiss'}
              </button>
              <button
                onClick={() => handleReview(report.id, 'reviewed')}
                disabled={loadingId === report.id}
                className="glass border border-yellow-500/30 text-yellow-400 rounded-full py-1.5 text-xs hover:bg-yellow-500/10 transition-all flex items-center justify-center"
              >
                {loadingId === report.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Warn'}
              </button>
              <button
                onClick={() => handleReview(report.id, 'actioned')}
                disabled={loadingId === report.id}
                className="glass border border-red-500/30 text-red-400 rounded-full py-1.5 text-xs hover:bg-red-500/10 transition-all flex items-center justify-center"
              >
                {loadingId === report.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Ban'}
              </button>
              <button
                disabled={loadingId === report.id}
                className="glass border border-[#8B5CF6]/30 text-[#8B5CF6] rounded-full py-1.5 text-xs hover:bg-[#8B5CF6]/10 transition-all flex items-center justify-center opacity-60 cursor-not-allowed"
              >
                Escalate
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Culture Facts tab
function CultureFactsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: facts, isLoading, refetch } = useGetCulturalFacts();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newFact, setNewFact] = useState({ country: '', category: 'History', fact: '', sortOrder: 0 });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [enabledStates, setEnabledStates] = useState<Record<number, boolean>>({});

  const handleSave = async () => {
    if (!newFact.country || !newFact.fact) {
      toast({ title: 'Country and fact are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/cultural/facts`, {
        method: 'POST',
        body: JSON.stringify(newFact),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to save');
      toast({ title: 'Fact added! ✓' });
      setNewFact({ country: '', category: 'History', fact: '', sortOrder: 0 });
      setShowAddForm(false);
      refetch();
    } catch {
      toast({ title: 'Failed to save fact', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (factId: number) => {
    if (!confirm('Delete this fact?')) return;
    setDeletingId(factId);
    try {
      await fetch(`${import.meta.env.BASE_URL}api/cultural/facts/${factId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      toast({ title: 'Fact deleted' });
      refetch();
    } catch {
      toast({ title: 'Failed to delete', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const factsArray = Array.isArray(facts) ? facts : [];

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-foreground text-lg">Cultural Facts</h2>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="btn-glow px-4 py-2 text-white text-xs font-semibold rounded-full flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add Fact
        </button>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="glass-strong rounded-2xl p-4 space-y-3 overflow-hidden"
          >
            <select
              value={newFact.country}
              onChange={(e) => setNewFact((f) => ({ ...f, country: e.target.value }))}
              className="glass-input w-full rounded-xl px-3 py-2 text-sm outline-none"
            >
              <option value="">Select Country</option>
              {['Japan', 'South Korea', 'Nigeria', 'Brazil', 'India', 'USA', 'France', 'Mexico', 'Ghana', 'China', 'Other'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={newFact.category}
              onChange={(e) => setNewFact((f) => ({ ...f, category: e.target.value }))}
              className="glass-input w-full rounded-xl px-3 py-2 text-sm outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <textarea
              rows={3}
              placeholder="Enter cultural fact..."
              value={newFact.fact}
              onChange={(e) => setNewFact((f) => ({ ...f, fact: e.target.value }))}
              className="glass-input w-full rounded-xl px-3 py-2 text-sm placeholder:text-placeholder placeholder:opacity-100 outline-none resize-none"
            />
            <input
              type="number"
              placeholder="Sort order (optional)"
              value={newFact.sortOrder || ''}
              onChange={(e) => setNewFact((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
              className="glass-input w-full rounded-xl px-3 py-2 text-sm placeholder:text-placeholder placeholder:opacity-100 outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-glow px-4 py-2 text-white text-xs font-semibold rounded-full flex items-center gap-1"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="glass border border-border rounded-full px-4 py-2 text-muted-foreground text-xs hover:glass-strong transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-7 h-7 animate-spin text-[#FF2D7A]" /></div>}

      {!isLoading && factsArray.length === 0 && (
        <div className="glass rounded-2xl p-8 text-center">
          <Globe className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">No cultural facts yet</p>
          <p className="text-muted-foreground text-sm mt-1">Add the first fact above</p>
        </div>
      )}

      {factsArray.map((fact: any) => {
        const isEnabled = enabledStates[fact.id] !== undefined ? enabledStates[fact.id] : true;

        return (
          <div key={fact.id} className="glass rounded-2xl p-4 flex gap-3 mb-2">
            <span className="text-2xl shrink-0">🌍</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {fact.category && (
                  <span className="glass px-2 py-0.5 rounded-full text-xs text-[#8B5CF6] border border-[#8B5CF6]/30">
                    {fact.category}
                  </span>
                )}
                {fact.country && (
                  <span className="text-muted-foreground text-xs">{fact.country}</span>
                )}
              </div>
              <p className="text-foreground text-sm line-clamp-2">{fact.fact}</p>
            </div>
            <div className="flex flex-col gap-2 items-end shrink-0">
              {/* Enable/disable toggle */}
              <button
                onClick={() => setEnabledStates((prev) => ({ ...prev, [fact.id]: !isEnabled }))}
                className={`w-10 h-5 rounded-full transition-all relative ${isEnabled ? 'bg-[#FF2D7A]/70' : 'bg-muted'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${isEnabled ? 'left-5' : 'left-0.5'}`} />
              </button>
              <button
                onClick={() => handleDelete(fact.id)}
                disabled={deletingId === fact.id}
                className="glass w-8 h-8 rounded-full flex items-center justify-center border border-red-500/30 hover:bg-red-500/10 transition-all"
              >
                {deletingId === fact.id ? <Loader2 className="w-3 h-3 animate-spin text-red-400" /> : <Trash2 className="w-3 h-3 text-red-400" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminPanel() {
  const { data: user, isLoading: userLoading } = useGetCurrentUser();
  const [activeTab, setActiveTab] = useState<TabId>('verifications');

  if (userLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#FF2D7A]" />
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center px-4">
        <p className="glass rounded-2xl px-6 py-4 text-muted-foreground">Admin access only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between"
        style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--nav-border)' }}
      >
        <h1 className="font-serif text-xl text-foreground">Admin Panel</h1>
        <ShieldAlert className="w-5 h-5 text-[#FF2D7A]" />
      </div>

      {/* Tab bar */}
      <div
        className="sticky top-[57px] z-30 flex border-b border-border overflow-x-auto scrollbar-hide"
        style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(20px)' }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 px-4 py-3 text-sm font-medium transition-all border-b-2 ${
              activeTab === tab.id
                ? 'border-[#FF2D7A] text-[#FF2D7A]'
                : 'border-transparent text-muted-foreground hover:text-muted-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-w-lg mx-auto px-4 pt-4">
        {activeTab === 'verifications' && <VerificationsTab />}
        {activeTab === 'coaches' && <CoachesTab />}
        {activeTab === 'reports' && <ReportsTab />}
        {activeTab === 'metrics' && <MetricsTab />}
        {activeTab === 'culture' && <CultureFactsTab />}
      </div>
    </div>
  );
}

function CoachAuditTrail({ coachId }: { coachId: number }) {
  const { data: events, isLoading } = useAdminGetCoachAudit(coachId);
  if (isLoading) return <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  if (!events || events.length === 0) return <p className="text-muted-foreground text-xs py-2">No audit events yet.</p>;
  return (
    <div className="space-y-2 pt-2 border-t border-border">
      {events.map((e: any) => (
        <div key={e.id} className="text-xs">
          <div className="flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded-full border capitalize ${e.field === 'payout' ? 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' : COACH_STATUS_COLORS[e.newValue] || 'text-muted-foreground border-border bg-muted'}`}>
              {e.action.replace(/_/g, ' ')}
            </span>
            <span className="text-muted-foreground">
              {e.actor?.name || `User #${e.actorUserId}`} · {new Date(e.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          {e.previousValue !== null && (
            <p className="text-muted-foreground mt-0.5">{e.field}: {e.previousValue} → {e.newValue}</p>
          )}
          {e.notes && <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap line-clamp-4">{e.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function CoachCredentials({ coachId }: { coachId: number }) {
  const { t } = useI18n();
  const { data: credentials, isLoading, isError } = useAdminListCoachCredentials(coachId);

  if (isLoading) return <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  if (isError) return <p className="text-red-400 text-xs py-2" role="alert">{t('adminCredential.loadError')}</p>;
  if (!credentials?.length) return <p className="text-muted-foreground text-xs py-2">{t('adminCredential.empty')}</p>;

  return (
    <div className="space-y-2 py-3 border-y border-border">
      <p className="text-muted-foreground text-xs font-medium">{t('adminCredential.title')}</p>
      {credentials.map((credential) => (
        <div key={credential.id} className="glass rounded-xl p-3 flex items-center gap-3">
          <FileText className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-foreground text-sm truncate">{credential.originalName}</p>
            <p className="text-muted-foreground text-xs capitalize">
              {credential.kind.replace(/_/g, ' ')} · {credential.status}
            </p>
          </div>
          <a
            href={getAdminStreamCoachCredentialUrl(coachId, credential.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="glass border border-cyan-500/30 text-cyan-400 rounded-full px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label={t('adminCredential.reviewNamed', { name: credential.originalName })}
          >
            {t('adminCredential.review')}
          </a>
        </div>
      ))}
    </div>
  );
}

function CoachesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [auditOpenId, setAuditOpenId] = useState<number | null>(null);

  const { data: coaches, isLoading } = useAdminListCoaches();
  const verifyMutation = useAdminVerifyCoach();
  const payoutMutation = useAdminSetCoachPayoutReady();

  const refresh = () => {
    queryClient.invalidateQueries();
  };

  const handleVerify = (coachId: number, status: 'approved' | 'rejected') => {
    setLoadingId(coachId);
    verifyMutation.mutate(
      { coachId, data: { status, notes: notes[coachId] || null } },
      {
        onSuccess: () => {
          toast({ title: status === 'approved' ? 'Coach approved ✓ — now live in the directory' : 'Coach application rejected' });
          refresh();
        },
        onError: () => toast({ title: 'Failed to update coach', variant: 'destructive' }),
        onSettled: () => setLoadingId(null),
      }
    );
  };

  const handlePayout = (coachId: number, isPayoutReady: boolean) => {
    setLoadingId(coachId);
    payoutMutation.mutate(
      { coachId, data: { isPayoutReady, notes: notes[coachId] || null } },
      {
        onSuccess: () => {
          toast({ title: isPayoutReady ? 'Payout enabled for coach' : 'Payout disabled for coach' });
          refresh();
        },
        onError: () => toast({ title: 'Failed to update payout state', variant: 'destructive' }),
        onSettled: () => setLoadingId(null),
      }
    );
  };

  const filtered = (coaches || []).filter((c: any) =>
    statusFilter === 'all' ? true : c.verificationStatus === statusFilter
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {['pending', 'approved', 'rejected', 'unsubmitted', 'all'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all capitalize font-medium ${
              statusFilter === s
                ? 'bg-[#FF2D7A]/20 border-[#FF2D7A] text-[#FF2D7A]'
                : 'glass border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-7 h-7 animate-spin text-[#FF2D7A]" /></div>}

      {!isLoading && filtered.length === 0 && (
        <div className="glass rounded-2xl p-8 text-center">
          <Star className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">No {statusFilter === 'all' ? '' : statusFilter} coach applications</p>
        </div>
      )}

      {filtered.map((coach: any) => (
        <div key={coach.id} className="glass rounded-2xl p-4 mb-3">
          <div className="flex items-center gap-3 mb-2">
            <img
              src={resolveMediaUrl(coach.photoUrl) || `https://ui-avatars.com/api/?name=${encodeURIComponent(coach.displayName)}&background=8B5CF6&color=fff`}
              alt={coach.displayName}
              className="w-10 h-10 rounded-full object-cover border border-border shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-foreground text-sm font-medium truncate">{coach.displayName}</p>
              {coach.user?.email && <p className="text-muted-foreground text-xs truncate">{coach.user.email}</p>}
            </div>
          </div>

          {/* Distinct verification + payout state badges */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${COACH_STATUS_COLORS[coach.verificationStatus] || COACH_STATUS_COLORS.unsubmitted}`}>
              Verification: {coach.verificationStatus}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${coach.isPayoutReady ? 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' : 'text-muted-foreground border-border bg-muted'}`}>
              Payout: {coach.isPayoutReady ? 'ready' : 'not ready'}
            </span>
            {coach.ratesPerHour != null && (
              <span className="text-muted-foreground text-xs">${coach.ratesPerHour}/hr {coach.currency}</span>
            )}
          </div>

          {coach.specialties?.length > 0 && (
            <p className="text-muted-foreground text-xs mb-2 truncate">Specialties: {coach.specialties.join(', ')}</p>
          )}

          <CoachCredentials coachId={coach.id} />

          <textarea
            rows={2}
            placeholder="Reviewer notes (recorded in the audit trail)..."
            value={notes[coach.id] || ''}
            onChange={(e) => setNotes((prev) => ({ ...prev, [coach.id]: e.target.value }))}
            className="glass-input w-full rounded-xl px-3 py-2 text-sm mb-3 placeholder:text-placeholder placeholder:opacity-100 outline-none resize-none"
          />

          <div className="flex gap-2 flex-wrap">
            {coach.verificationStatus !== 'approved' && (
              <button
                onClick={() => handleVerify(coach.id, 'approved')}
                disabled={loadingId === coach.id}
                className="glass border border-green-500/30 text-green-400 rounded-full px-4 py-1.5 text-sm flex-1 flex items-center justify-center gap-1 hover:bg-green-500/10 transition-all"
              >
                {loadingId === coach.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve'}
              </button>
            )}
            {coach.verificationStatus !== 'rejected' && (
              <button
                onClick={() => handleVerify(coach.id, 'rejected')}
                disabled={loadingId === coach.id}
                className="glass border border-red-500/30 text-red-400 rounded-full px-4 py-1.5 text-sm flex-1 flex items-center justify-center gap-1 hover:bg-red-500/10 transition-all"
              >
                {loadingId === coach.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reject'}
              </button>
            )}
            <button
              onClick={() => handlePayout(coach.id, !coach.isPayoutReady)}
              disabled={loadingId === coach.id}
              className="glass border border-cyan-500/30 text-cyan-400 rounded-full px-4 py-1.5 text-sm flex-1 flex items-center justify-center gap-1 hover:bg-cyan-500/10 transition-all"
            >
              {loadingId === coach.id ? <Loader2 className="w-4 h-4 animate-spin" /> : (coach.isPayoutReady ? 'Disable payout' : 'Enable payout')}
            </button>
          </div>

          <button
            onClick={() => setAuditOpenId(auditOpenId === coach.id ? null : coach.id)}
            className="w-full text-muted-foreground text-xs py-2 mt-1 hover:text-muted-foreground transition-colors"
          >
            {auditOpenId === coach.id ? 'Hide audit trail ▲' : 'View audit trail ▼'}
          </button>
          {auditOpenId === coach.id && <CoachAuditTrail coachId={coach.id} />}
        </div>
      ))}
    </div>
  );
}
