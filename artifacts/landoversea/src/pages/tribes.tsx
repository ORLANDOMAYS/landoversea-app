import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetTribes,
  useJoinTribe,
  useLeaveTribe,
  getGetTribesQueryKey,
} from '@workspace/api-client-react';
import { ChevronLeft, Users, Search, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const CATEGORIES = ['All', 'Language', 'Culture', 'Food', 'Music', 'Travel', 'Professional', 'Romance'];

export default function TribesPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const { data: tribes, isLoading } = useGetTribes();

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

  const tribesArray = Array.isArray(tribes) ? tribes : [];

  const filtered = tribesArray.filter((t) => {
    const matchesSearch =
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      activeCategory === 'All' ||
      (t.language && activeCategory === 'Language') ||
      (t.country && activeCategory === 'Culture') ||
      t.name.toLowerCase().includes(activeCategory.toLowerCase());
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky Header */}
      <header
        className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <button
          className="w-9 h-9 rounded-full glass flex items-center justify-center flex-shrink-0"
          onClick={() => navigate('/cultural')}
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="font-serif text-xl text-foreground flex-1">Cultural Tribes</h1>
        <Users className="w-5 h-5 text-accent" />
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tribes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input rounded-full px-4 py-2 pl-10 w-full outline-none placeholder:text-muted-foreground text-sm"
          />
        </div>

        {/* Category Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm border transition-all ${
                activeCategory === cat
                  ? 'bg-secondary/20 border-secondary text-secondary font-semibold'
                  : 'glass border-border text-muted-foreground hover:glass-strong'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {/* Empty */}
        {!isLoading && filtered.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="w-14 h-14 glass rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7 text-muted-foreground" />
            </div>
            <h3 className="font-serif text-lg text-foreground mb-2">No tribes found</h3>
            <p className="text-muted-foreground text-sm">Try adjusting your search or filters.</p>
          </div>
        )}

        {/* Tribe List */}
        {!isLoading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((tribe) => {
              const isMember = tribe.isMember ?? false;
              const isJoining = joinTribe.isPending && joinTribe.variables?.tribeId === tribe.id;
              const isLeaving = leaveTribe.isPending && leaveTribe.variables?.tribeId === tribe.id;

              return (
                <div key={tribe.id} className="glass rounded-2xl p-4 flex gap-4 items-center">
                  {/* Avatar */}
                  <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center text-3xl flex-shrink-0">
                    {tribe.iconUrl ? (
                      <img src={tribe.iconUrl} alt={tribe.name} className="w-12 h-12 rounded-xl object-cover" />
                    ) : (
                      <span>{tribe.name.charAt(0)}</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground font-semibold truncate">{tribe.name}</p>
                    {tribe.description && (
                      <p className="text-muted-foreground text-sm line-clamp-2 leading-snug">{tribe.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      {(tribe.language || tribe.country) && (
                        <span className="glass rounded-full px-2 py-0.5 text-muted-foreground text-xs border border-border">
                          {tribe.language ?? tribe.country}
                        </span>
                      )}
                      <span className="text-muted-foreground text-xs">{tribe.memberCount} members</span>
                    </div>
                  </div>

                  {/* Action */}
                  <div className="flex-shrink-0">
                    {isMember ? (
                      <button
                        className="glass border border-border rounded-full px-3 py-1.5 text-muted-foreground text-sm hover:glass-strong transition-all"
                        disabled={isLeaving}
                        onClick={() => leaveTribe.mutate({ tribeId: tribe.id })}
                      >
                        {isLeaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Leave'}
                      </button>
                    ) : (
                      <button
                        className="btn-glow px-3 py-1.5 text-white text-sm rounded-full"
                        disabled={isJoining}
                        onClick={() => joinTribe.mutate({ tribeId: tribe.id })}
                      >
                        {isJoining ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Join'}
                      </button>
                    )}
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
