import { useGetNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@workspace/api-client-react';
import { Loader2, Bell, Heart, MessageCircle, Star, Calendar, Shield, ChevronLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { normalizeApiError } from '@/lib/api-error';

export default function Notifications() {
  const { data: notifications, isLoading, isError, error, refetch } = useGetNotifications(
    { limit: 50 },
    { query: { queryKey: ['/api/notifications'] } }
  );
  const markReadMutation = useMarkNotificationRead();
  const markAllMutation = useMarkAllNotificationsRead();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
  };

  const handleMarkAll = () => {
    setMutationError(null);
    markAllMutation.mutate(undefined, {
      onSuccess: invalidate,
      onError: (err) => {
        const message = normalizeApiError(err, 'Could not mark notifications as read.').message;
        setMutationError(message);
        toast({ title: 'Update failed', description: message, variant: 'destructive' });
      },
    });
  };

  const handleClick = (notif: NonNullable<typeof notifications>[number]) => {
    if (!notif.isRead) {
      markReadMutation.mutate(
        { notificationId: notif.id },
        {
          onSuccess: invalidate,
          onError: (err) => {
            const message = normalizeApiError(err, 'Could not mark this notification as read.').message;
            toast({ title: 'Update failed', description: message, variant: 'destructive' });
          },
        },
      );
    }
    switch (notif.type) {
      case 'match': setLocation('/matches'); break;
      case 'message': setLocation(notif.relatedId ? `/messages/${notif.relatedId}` : '/messages'); break;
      case 'like':
      case 'superlike': setLocation('/who-liked-me'); break;
      case 'verification': setLocation('/verification'); break;
      case 'booking': setLocation('/coaching'); break;
    }
  };

  const getIconConfig = (type: string): { icon: React.ReactNode; bg: string } => {
    switch (type) {
      case 'match':
        return {
          icon: <Heart className="w-5 h-5 text-primary fill-primary/30" />,
          bg: 'rgba(255,45,122,0.15)',
        };
      case 'message':
        return {
          icon: <MessageCircle className="w-5 h-5 text-cyan-400" />,
          bg: 'rgba(99,230,255,0.12)',
        };
      case 'like':
      case 'superlike':
        return {
          icon: <Star className="w-5 h-5 text-violet-400 fill-violet-400/30" />,
          bg: 'rgba(139,92,246,0.15)',
        };
      case 'booking':
        return {
          icon: <Calendar className="w-5 h-5 text-blue-400" />,
          bg: 'rgba(59,130,246,0.15)',
        };
      case 'verification':
      default:
        return {
          icon: <Shield className="w-5 h-5 text-violet-400" />,
          bg: 'rgba(139,92,246,0.15)',
        };
    }
  };

  const hasUnread = notifications?.some(n => !n.isRead);

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky Header */}
      <div
        className="sticky top-0 z-40"
        style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--nav-border)' }}
      >
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            aria-label="Back"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else setLocation('/');
            }}
            className="w-9 h-9 rounded-full glass flex items-center justify-center border border-border"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-serif text-2xl text-foreground flex-1">Notifications</h1>
          {hasUnread && (
            <button
              onClick={handleMarkAll}
              disabled={markAllMutation.isPending}
              className="text-sm text-primary hover:text-primary transition-colors disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none"
            >
              Mark all
            </button>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-2">
        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-16" role="status" aria-label="Loading notifications">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {isError && (
          <div role="alert" className="glass rounded-3xl p-8 text-center mt-8">
            <h2 className="font-serif text-xl text-foreground mb-2">Notifications unavailable</h2>
            <p className="text-muted-foreground text-sm mb-4">
              {normalizeApiError(error, 'Could not load notifications.').message}
            </p>
            <button type="button" onClick={() => refetch()} className="btn-glow rounded-full px-5 py-2.5">
              Retry
            </button>
          </div>
        )}

        {mutationError && (
          <div role="alert" className="glass rounded-xl p-3 border border-red-400/30 flex items-center gap-3">
            <p className="text-red-200 text-sm flex-1">{mutationError}</p>
            <button type="button" onClick={handleMarkAll} disabled={markAllMutation.isPending} className="underline text-sm">
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && (!notifications || notifications.length === 0) && (
          <div className="glass rounded-3xl p-10 flex flex-col items-center gap-4 border border-border text-center mt-8">
            <div className="w-16 h-16 rounded-full glass border border-border flex items-center justify-center">
              <Bell className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="font-serif text-xl text-foreground">All caught up!</h2>
            <p className="text-muted-foreground text-sm">No new notifications right now.</p>
          </div>
        )}

        {/* Notification list */}
        {!isLoading && !isError && notifications && notifications.length > 0 && (
          <div className="space-y-2">
            {notifications.map(notif => {
              const { icon, bg } = getIconConfig(notif.type);
              const timeStr = new Date(notif.createdAt).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              });

              return (
                <button
                  type="button"
                  key={notif.id}
                  onClick={() => handleClick(notif)}
                  aria-label={`${notif.isRead ? '' : 'Unread: '}${notif.title || notif.body || 'Notification'}`}
                  className={`w-full text-left glass rounded-2xl p-4 flex gap-3 cursor-pointer hover:glass-strong transition-all border ${
                    notif.isRead ? 'border-border' : 'border-l-2 border-l-primary/60 border-border'
                  }`}
                >
                  {/* Icon circle */}
                  <div
                    className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center"
                    style={{ background: bg }}
                  >
                    {icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {notif.title && (
                      <p className="text-foreground font-semibold text-sm leading-snug">{notif.title}</p>
                    )}
                    {notif.body && (
                      <p className="text-foreground text-sm leading-snug mt-0.5 line-clamp-2">{notif.body}</p>
                    )}
                    <p className="text-muted-foreground text-xs mt-1">{timeStr}</p>
                  </div>

                  {/* Unread dot */}
                  {!notif.isRead && (
                    <div className="shrink-0 mt-1">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
