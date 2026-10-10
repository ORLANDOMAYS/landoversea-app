import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetCulturalPassport,
  useGetCulturalStamps,
  useGetCulturalFacts,
  useGetConversationStarters,
  useGetTribes,
  useJoinTribe,
  useLeaveTribe,
  getGetTribesQueryKey,
} from '@workspace/api-client-react';
import {
  Globe, Loader2, Lock, Copy, ChevronRight, Users,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function CulturalPassport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [factIndex, setFactIndex] = useState(0);

  const { data: passport, isLoading: pLoading } = useGetCulturalPassport();
  const { data: stamps, isLoading: sLoading } = useGetCulturalStamps();
  const { data: fact, isLoading: factLoading } = useGetCulturalFacts();
  const { data: starters, isLoading: startersLoading } = useGetConversationStarters();
  const { data: tribes, isLoading: tribesLoading } = useGetTribes();

  const joinTribe = useJoinTribe({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTribesQueryKey() });
        toast({ title: 'Joined! 🎉', description: "You've joined the tribe." });
      },
      onError: () => {
        toast({ title: 'Error', description: 'Could not join tribe.', variant: 'destructive' });
      },
    },
  });

  const leaveTribe = useLeaveTribe({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTribesQueryKey() });
        toast({ title: 'Left tribe', description: "You've left the tribe." });
      },
      onError: () => {
        toast({ title: 'Error', description: 'Could not leave tribe.', variant: 'destructive' });
      },
    },
  });

  if (pLoading || sLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const stampsArray = Array.isArray(stamps) ? stamps : [];
  const tribesArray = Array.isArray(tribes) ? tribes : [];
  const startersArray = Array.isArray(starters) ? starters : [];
  const xpPoints = passport?.xpPoints ?? 0;
  const xpProgress = xpPoints % 100;

  // Placeholder phrases
  const phrases = [
    { target: 'Bonjour', translation: 'Hello', phonetics: 'bohn-ZHOOR', flag: '🇫🇷' },
    { target: 'Arigato', translation: 'Thank you', phonetics: 'ah-ree-GAH-toh', flag: '🇯🇵' },
    { target: 'Te quiero', translation: 'I love you', phonetics: 'teh KYEH-roh', flag: '🇪🇸' },
  ];

  // Milestones based on passport data
  const milestones = [
    { emoji: '🌍', title: 'First Connection', done: (passport?.stampCount ?? 0) >= 1 },
    { emoji: '✈️', title: '5 Countries', done: (passport?.countriesVisited?.length ?? 0) >= 5 },
    { emoji: '🏆', title: 'Level 5', done: parseInt(passport?.level ?? '0') >= 5 },
    { emoji: '💬', title: '50 Chats', done: false },
  ];

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      <div className="max-w-lg mx-auto px-4 pt-4 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Globe className="w-6 h-6 text-accent" />
          <h1 className="font-serif text-2xl text-foreground">Cultural Passport</h1>
        </div>

        {/* Passport Overview */}
        <div className="glass-strong rounded-3xl p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          <p className="text-accent text-sm font-semibold mb-3">✈️ Your Passport</p>

          <div className="flex items-center gap-3 mb-4">
            <span className="glass rounded-full px-4 py-1.5 text-primary text-sm font-semibold border border-primary/30">
              Level {passport?.level ?? '1'} Explorer
            </span>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { label: 'Stamps', value: passport?.stampCount ?? 0 },
              { label: 'Points', value: xpPoints },
              { label: 'Badges', value: stampsArray.length },
              { label: 'Countries', value: passport?.countriesVisited?.length ?? 0 },
            ].map((stat) => (
              <div key={stat.label} className="glass rounded-2xl p-2 text-center">
                <Globe className="w-3.5 h-3.5 text-accent mx-auto mb-1" />
                <p className="text-foreground font-bold text-sm">{stat.value}</p>
                <p className="text-muted-foreground text-[10px]">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* XP progress */}
          <div className="h-2 rounded-full overflow-hidden glass mb-1">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${xpProgress}%`,
                background: 'linear-gradient(90deg, #FF2D7A, #63E6FF)',
              }}
            />
          </div>
          <p className="text-muted-foreground text-xs">{100 - xpProgress} XP to next level</p>
        </div>

        {/* Stamp Collection */}
        <div>
          <h2 className="font-serif text-xl text-foreground mb-3">
            Stamps Collected{' '}
            <span className="text-muted-foreground text-base">({stampsArray.length})</span>
          </h2>
          {stampsArray.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-muted-foreground text-sm">No stamps yet. Connect with people from other countries!</p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
              {stampsArray.map((stamp) => (
                <div key={stamp.id} className="flex-shrink-0 w-20 h-24 glass rounded-2xl flex flex-col items-center justify-center gap-1 p-2">
                  <span className="text-3xl">🌍</span>
                  <p className="text-muted-foreground text-xs text-center leading-tight truncate w-full text-center">{stamp.country}</p>
                </div>
              ))}
              {/* Locked placeholder stamps */}
              {[1, 2].map((i) => (
                <div key={`locked-${i}`} className="flex-shrink-0 w-20 h-24 glass rounded-2xl flex flex-col items-center justify-center gap-1 p-2 opacity-40 relative grayscale">
                  <span className="text-3xl">🌍</span>
                  <Lock className="w-4 h-4 text-muted-foreground absolute top-2 right-2" />
                  <p className="text-muted-foreground text-xs">???</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Milestones */}
        <div>
          <h2 className="font-serif text-xl text-foreground mb-3">Milestones</h2>
          <div className="grid grid-cols-2 gap-3">
            {milestones.map((m) => (
              <div
                key={m.title}
                className={`glass rounded-2xl p-3 text-center ${
                  m.done
                    ? 'border border-accent/40 glow-cyan'
                    : 'opacity-60'
                }`}
              >
                <p className="text-2xl mb-1">{m.emoji}</p>
                <p className="text-foreground text-sm font-medium">{m.title}</p>
                {m.done && <p className="text-accent text-xs mt-1">✓ Complete</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Icebreaker Challenges */}
        <div>
          <h2 className="font-serif text-xl text-foreground mb-3">Today's Icebreakers</h2>
          {startersLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : startersArray.length === 0 ? (
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-muted-foreground text-sm">No icebreakers available.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {startersArray.slice(0, 3).map((starter) => (
                <div key={starter.id} className="glass rounded-2xl p-4 flex items-start gap-3">
                  <span className="text-xl flex-shrink-0">🗣️</span>
                  <p className="text-foreground text-sm flex-1">{starter.text}</p>
                  <button
                    className="glass border border-border rounded-full px-3 py-1 text-foreground text-xs hover:glass-strong transition-all flex-shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(starter.text);
                      toast({ title: 'Copied!', description: 'Challenge copied to clipboard.' });
                    }}
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cultural Facts */}
        <div>
          <h2 className="font-serif text-xl text-foreground mb-3">Did You Know? 🌍</h2>
          {factLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : fact ? (
            <div className="glass-strong rounded-2xl p-5">
              <p className="text-foreground text-sm leading-relaxed mb-3">{fact.fact}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-accent text-sm">{fact.country}</p>
                  {fact.category && (
                    <span className="glass rounded-full px-2 py-0.5 text-muted-foreground text-xs border border-border">
                      {fact.category}
                    </span>
                  )}
                </div>
                <button
                  className="glass border border-border rounded-full px-3 py-1 text-foreground text-xs hover:glass-strong transition-all"
                  onClick={() => setFactIndex((i) => i + 1)}
                >
                  Next →
                </button>
              </div>
            </div>
          ) : (
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-muted-foreground text-sm">No facts available.</p>
            </div>
          )}
        </div>

        {/* Tribes Teaser */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-serif text-xl text-foreground">Cultural Tribes</h2>
            <Link href="/tribes">
              <span className="text-accent text-sm cursor-pointer hover:text-foreground transition-colors">See All →</span>
            </Link>
          </div>
          {tribesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : tribesArray.length === 0 ? (
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-muted-foreground text-sm">No tribes yet.</p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
              {tribesArray.slice(0, 6).map((tribe) => {
                const isMember = tribe.isMember ?? false;
                const isJoining = joinTribe.isPending && joinTribe.variables?.tribeId === tribe.id;
                const isLeaving = leaveTribe.isPending && leaveTribe.variables?.tribeId === tribe.id;
                return (
                  <div key={tribe.id} className="flex-shrink-0 glass rounded-2xl p-3 w-40">
                    <div className="w-10 h-10 rounded-xl glass flex items-center justify-center text-2xl mb-2">
                      {tribe.iconUrl ? (
                        <img src={tribe.iconUrl} alt={tribe.name} className="w-8 h-8 object-cover rounded-lg" />
                      ) : (
                        <Users className="w-5 h-5 text-secondary" />
                      )}
                    </div>
                    <p className="text-foreground text-sm font-semibold truncate">{tribe.name}</p>
                    <p className="text-muted-foreground text-xs mb-2">{tribe.memberCount} members</p>
                    {isMember ? (
                      <button
                        className="glass border border-border rounded-full px-3 py-1 text-muted-foreground text-xs hover:glass-strong transition-all w-full"
                        disabled={isLeaving}
                        onClick={() => leaveTribe.mutate({ tribeId: tribe.id })}
                      >
                        {isLeaving ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Leave'}
                      </button>
                    ) : (
                      <button
                        className="btn-glow px-3 py-1 text-white text-xs rounded-full w-full"
                        disabled={isJoining}
                        onClick={() => joinTribe.mutate({ tribeId: tribe.id })}
                      >
                        {isJoining ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Join'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Useful Phrases */}
        <div>
          <h2 className="font-serif text-xl text-foreground mb-3">Useful Phrases</h2>
          <div className="space-y-3">
            {phrases.map((phrase) => (
              <div key={phrase.target} className="glass rounded-2xl p-4 flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{phrase.flag}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-primary font-medium">{phrase.target}</p>
                  <p className="text-foreground text-sm">{phrase.translation}</p>
                  <p className="text-muted-foreground text-xs italic">{phrase.phonetics}</p>
                </div>
                <button
                  className="glass border border-border rounded-full px-3 py-1 text-foreground text-xs hover:glass-strong transition-all flex-shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(phrase.target);
                    toast({ title: 'Copied!', description: `"${phrase.target}" copied.` });
                  }}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
