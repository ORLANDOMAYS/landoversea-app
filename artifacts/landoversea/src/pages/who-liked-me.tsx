import { useState } from 'react';
import { resolveMediaUrl } from '@/lib/media-url';
import { useGetCurrentUser, useGetMySubscription, useGetWhoLikedMe, getGetWhoLikedMeQueryKey, useSwipe } from '@workspace/api-client-react';
import { Heart, Lock, Sparkles, MapPin, Loader2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';

export default function WhoLikedMe() {
  const { data: currentUser } = useGetCurrentUser();
  const { data: subscription } = useGetMySubscription();
  const isPremium = currentUser?.isPremium || subscription?.status === 'active';

  const { data: profiles, isLoading } = useGetWhoLikedMe({
    query: { enabled: isPremium === true, queryKey: getGetWhoLikedMeQueryKey() },
  });

  const swipeMutation = useSwipe();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [hidden, setHidden] = useState<number[]>([]);
  const [sparkle, setSparkle] = useState<number | null>(null);

  const handleLikeBack = (userId: number) => {
    setSparkle(userId);
    swipeMutation.mutate(
      { data: { targetUserId: userId, action: 'like' } },
      {
        onSuccess: (res) => {
          setTimeout(() => setSparkle(null), 800);
          setHidden(prev => [...prev, userId]);
          if (res.isMatch) {
            toast({ title: "It's a Match! 🎉", description: 'You matched! Say hello.' });
          } else {
            toast({ title: 'Liked back!', description: 'You liked them back.' });
          }
        },
        onError: () => {
          setSparkle(null);
          toast({ title: 'Error', description: 'Please try again.', variant: 'destructive' });
        },
      }
    );
  };

  const handlePass = (userId: number) => {
    setHidden(prev => [...prev, userId]);
  };

  const visibleProfiles = (profiles ?? []).filter(p => !hidden.includes(p.userId));

  // Blurred placeholder cards for non-premium
  const placeholderPhotos = [
    'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400&q=80',
    'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&q=80',
    'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&q=80',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80',
    'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80',
  ];

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky Header */}
      <div
        className="sticky top-0 z-40"
        style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--nav-border)' }}
      >
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <h1 className="font-serif text-2xl text-foreground flex-1">Who Liked You</h1>
          <Heart className="w-6 h-6 text-primary fill-primary" />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Non-premium state */}
        {!isPremium && (
          <>
            {/* Blurred placeholder grid */}
            <div className="grid grid-cols-2 gap-3">
              {placeholderPhotos.map((photo, i) => (
                <div key={i} className="glass rounded-3xl overflow-hidden aspect-[3/4] relative border border-border">
                  <img src={photo} alt="Blurred" className="w-full h-full object-cover blur-xl scale-110" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full glass border border-border flex items-center justify-center">
                      <Lock className="w-6 h-6 text-foreground" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Premium CTA card */}
            <div className="glass rounded-3xl p-6 border border-primary/30 text-center space-y-4">
              <div className="w-14 h-14 rounded-full mx-auto glass flex items-center justify-center glow-pink">
                <Sparkles className="w-7 h-7 text-yellow-400" />
              </div>
              <h2 className="font-serif text-xl text-foreground">💫 See Who Likes You</h2>
              <p className="text-muted-foreground text-sm">
                Upgrade to Premium and discover everyone who already likes your profile.
              </p>
              <button
                onClick={() => setLocation('/premium')}
                className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full"
              >
                Unlock Premium
              </button>
            </div>
          </>
        )}

        {/* Premium + Loading */}
        {isPremium && isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {/* Premium + Empty */}
        {isPremium && !isLoading && visibleProfiles.length === 0 && (
          <div className="glass rounded-3xl p-8 text-center space-y-4 border border-border">
            <div className="w-14 h-14 rounded-full mx-auto glass flex items-center justify-center">
              <Heart className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-serif text-xl text-foreground">No likes yet</h2>
            <p className="text-muted-foreground text-sm">Keep discovering — someone will like you soon! ✈️</p>
            <button
              onClick={() => setLocation('/discover')}
              className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full"
            >
              → Discover
            </button>
          </div>
        )}

        {/* Premium + Profiles */}
        {isPremium && !isLoading && visibleProfiles.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {visibleProfiles.map(profile => {
              const photo = resolveMediaUrl(profile.photos?.[0]?.url) || 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=400';
              const isSparkle = sparkle === profile.userId;

              return (
                <div key={profile.userId} className="glass rounded-3xl overflow-hidden border border-border relative">
                  <div className="relative aspect-[3/4]">
                    <img src={photo} alt={profile.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

                    {/* Sparkle animation on like */}
                    <AnimatePresence>
                      {isSparkle && (
                        <motion.div
                          className="absolute inset-0 flex items-center justify-center z-10"
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1.2 }}
                          exit={{ opacity: 0, scale: 0.5 }}
                        >
                          <span className="text-5xl">💖</span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="absolute bottom-0 left-0 right-0 rounded-t-xl bg-black/75 p-3">
                      <h3 className="font-serif text-fixed-dark-foreground font-semibold text-base truncate">
                        {profile.name}{profile.age ? `, ${profile.age}` : ''}
                      </h3>
                      {(profile.city || profile.country) && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-fixed-dark-muted-foreground shrink-0" />
                          <span className="text-fixed-dark-muted-foreground text-xs truncate">
                            {[profile.city, profile.country].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action bar */}
                  <div className="flex gap-2 p-2">
                    <button
                      onClick={() => handleLikeBack(profile.userId)}
                      disabled={swipeMutation.isPending}
                      className="btn-glow flex-1 py-1.5 px-3 text-sm text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
                    >
                      Like Back
                    </button>
                    <button
                      onClick={() => handlePass(profile.userId)}
                      className="glass border border-border rounded-full px-3 py-1.5 text-sm text-foreground hover:glass-strong transition-all"
                    >
                      Pass
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
