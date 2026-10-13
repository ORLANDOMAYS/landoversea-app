import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  useGetMySubscription,
  useCancelSubscription,
  useGetCurrentUser,
} from '@workspace/api-client-react';
import { Loader2, Crown, CheckCircle, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import Starfield from '@/components/Starfield';

const FEATURES = [
  'Unlimited Connections',
  'See Who Liked You',
  'AI Coach (Luna)',
  'Advanced Filters',
  'Priority Matching',
  'Cultural Passport Unlocked',
  'Read Receipts',
  'Profile Boost 1×/month',
];

export default function Premium() {
  const [, navigate] = useLocation();
  const { data: subscription, refetch: refetchSub } = useGetMySubscription();
  const cancelMutation = useCancelSubscription();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCancel, setShowCancel] = useState(false);

  const isPremium = subscription?.status === 'active';

  // Detect Stripe return
  useEffect(() => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    if (params.get('success') === '1') {
      queryClient.invalidateQueries({ queryKey: ['/api/premium/subscription'] });
      refetchSub();
    }
    if (params.get('cancelled') === '1') {
      toast({ description: 'Checkout cancelled. Your plan has not changed.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    cancelMutation.mutate(undefined, {
      onSuccess: (sub) => {
        const endDate = sub?.currentPeriodEnd
          ? new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
          : 'the end of your billing period';
        toast({ description: `Your plan remains active until ${endDate}.` });
        queryClient.invalidateQueries({ queryKey: ['/api/premium/subscription'] });
        refetchSub();
        setShowCancel(false);
      },
      onError: () => {
        toast({ title: 'Cancellation failed', description: 'Please try again.', variant: 'destructive' });
      },
    });
  };

  return (
    <div className="min-h-[100dvh] relative pb-12">
      <Starfield />

      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="absolute top-4 left-4 z-20 w-9 h-9 rounded-full glass flex items-center justify-center"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <ChevronLeft className="w-5 h-5 text-foreground" />
      </button>

      <div className="relative z-10">
        {/* Hero */}
        <div className="pt-16 pb-6 px-4 text-center">
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="inline-flex items-center justify-center mb-3"
          >
            <Crown className="w-14 h-14 text-yellow-400" />
          </motion.div>
          <h1 className="font-script text-3xl bg-gradient-to-r from-yellow-400 via-[#FF2D7A] to-[#8B5CF6] bg-clip-text text-transparent">
            LandOverSEA Premium
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">Unlock the full cross-cultural experience</p>
        </div>

        {/* Active subscription card */}
        {isPremium && (
          <div className="mx-4 mb-4 glass rounded-2xl p-4 border border-green-500/30">
            <div className="flex items-center gap-3 mb-2">
              <Crown className="w-6 h-6 text-yellow-400" />
              <span className="font-serif text-foreground font-semibold">Premium Active</span>
            </div>
            {subscription?.planId && (
              <p className="text-muted-foreground text-sm mb-1">Plan: {subscription.planId}</p>
            )}
            {subscription?.currentPeriodEnd && (
              <p className="text-muted-foreground text-xs mb-3">
                Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            )}
            <button
              onClick={() => setShowCancel(true)}
              className="text-red-400 text-sm cursor-pointer hover:text-red-300 transition-colors"
            >
              Cancel Plan
            </button>
          </div>
        )}

        {/* Features list */}
        {!isPremium && (
          <>
            <div className="mx-4 mb-4 glass rounded-2xl p-4">
              <h2 className="font-serif text-foreground font-semibold mb-3">Everything Included</h2>
              <div className="space-y-2">
                {FEATURES.map((f) => (
                  <div key={f} className="flex items-center gap-3">
                    <CheckCircle className="w-4 h-4 text-[#63E6FF] shrink-0" />
                    <span className="text-foreground text-sm">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mx-4 mb-4 glass rounded-2xl border border-border p-5 text-center">
              <h2 className="font-serif text-lg font-semibold text-foreground">Premium purchases are not available yet</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                No payment will be taken on this website. Existing subscriptions will appear here when Premium launches.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Cancel confirmation sheet */}
      <AnimatePresence>
        {showCancel && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-30"
              style={{ background: 'rgba(0,0,0,0.6)' }}
              onClick={() => setShowCancel(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-40 glass-strong rounded-t-3xl p-6"
            >
              <h2 className="font-serif text-xl text-foreground mb-4">Cancel Premium?</h2>
              <ul className="space-y-2 mb-6">
                {['Lose access to unlimited connections', 'Can no longer see who liked you', 'AI Coach (Luna) disabled', 'Advanced filters removed'].map((c) => (
                  <li key={c} className="flex items-center gap-2 text-foreground text-sm">
                    <span className="text-red-400">•</span> {c}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setShowCancel(false)}
                className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full mb-3"
              >
                Keep Premium
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
                className="glass border border-border rounded-full px-4 py-3 w-full hover:glass-strong transition-all text-red-400 font-semibold flex items-center justify-center gap-2"
              >
                {cancelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Yes, Cancel'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
