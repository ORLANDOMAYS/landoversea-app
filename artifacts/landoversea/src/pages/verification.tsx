import { useState, useRef, useEffect } from 'react';
import { useGetVerificationStatus, useRequestVerification, getGetVerificationStatusQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { normalizeApiError } from '@/lib/api-error';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  isAcceptedImageMime,
} from '@/lib/uploadLimits';
import {
  ChevronLeft, ShieldCheck, ShieldAlert, AlertCircle, Loader2, Camera
} from 'lucide-react';

export default function Verification() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: status, isLoading } = useGetVerificationStatus();
  const requestMutation = useRequestVerification();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Revoke the object URL whenever it changes or the component unmounts so we
  // never leak blob URLs.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const currentStatus = status?.status ?? 'none';
  const adminNotes = status?.adminNotes;

  const clearSelection = () => {
    setFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!isAcceptedImageMime(f.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a PNG, JPEG, or WebP image.',
        variant: 'destructive',
      });
      clearSelection();
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      toast({
        title: 'File too large',
        description: `Selfie must be under ${MAX_UPLOAD_LABEL}.`,
        variant: 'destructive',
      });
      clearSelection();
      return;
    }
    setFile(f);
    // Replacing the preview: revoke happens via the effect cleanup.
    setPreviewUrl(URL.createObjectURL(f));
  };

  const handleSubmit = () => {
    if (!file || requestMutation.isPending) return;
    // Submit real multipart FormData: the generated client appends `selfie`.
    requestMutation.mutate(
      { data: { selfie: file } as unknown as { selfie: string } },
      {
        onSuccess: () => {
          toast({ title: 'Submitted for review!', description: 'Usually within 24 hours.' });
          clearSelection();
          // Refresh persisted status so the UI reflects the new "pending" state.
          queryClient.invalidateQueries({ queryKey: getGetVerificationStatusQueryKey() });
        },
        onError: (err: unknown) => {
          const { message, status: httpStatus } = normalizeApiError(
            err,
            'Submission failed. Please try again.',
          );
          const title =
            httpStatus === 413
              ? 'Selfie too large'
              : httpStatus === 400
                ? 'Invalid selfie'
                : httpStatus === 502
                  ? 'Upload service unavailable'
                  : 'Submission failed';
          toast({ title, description: message, variant: 'destructive' });
        },
      }
    );
  };

  const canSubmit = currentStatus === 'none' || currentStatus === 'rejected';

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--nav-border)',
        }}
      >
        <Link href="/settings">
          <button className="w-9 h-9 rounded-full glass flex items-center justify-center">
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
        </Link>
        <h1 className="font-serif text-xl text-foreground flex-1">Get Verified</h1>
        <ShieldCheck className="w-5 h-5 text-accent" />
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {!isLoading && (
          <>
            {/* Status Card */}
            <div className="glass-strong rounded-3xl p-6 text-center space-y-3" data-testid="status-verification">
              {(currentStatus === 'none' || (currentStatus as string) === 'unverified') && (
                <>
                  <ShieldAlert className="w-16 h-16 text-muted-foreground mx-auto" />
                  <h2 className="font-serif text-2xl text-foreground">Not Verified</h2>
                  <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                    Verify your identity with a selfie to earn a verified badge, build trust, and unlock exclusive features.
                  </p>
                </>
              )}

              {currentStatus === 'pending' && (
                <>
                  <Loader2 className="w-16 h-16 text-yellow-400 animate-spin mx-auto" />
                  <h2 className="font-serif text-2xl text-foreground">Under Review</h2>
                  <p className="text-muted-foreground text-sm">Usually within 24 hours. We'll notify you once complete.</p>
                </>
              )}

              {(currentStatus === 'approved' || (currentStatus as string) === 'verified') && (
                <>
                  <div className="glow-cyan w-20 h-20 rounded-full glass-strong flex items-center justify-center mx-auto">
                    <ShieldCheck className="w-10 h-10 text-accent" />
                  </div>
                  <h2 className="font-serif text-2xl text-foreground">✓ Verified</h2>
                  <p className="text-muted-foreground text-sm">
                    Your identity has been confirmed
                    {status?.reviewedAt ? ` on ${new Date(status.reviewedAt).toLocaleDateString()}` : ''}.
                  </p>
                  <Link href="/profile">
                    <button className="glass border border-border rounded-full px-6 py-2 hover:glass-strong transition-all text-foreground text-sm">
                      Back to Profile
                    </button>
                  </Link>
                </>
              )}

              {currentStatus === 'rejected' && (
                <>
                  <AlertCircle className="w-16 h-16 text-red-400 mx-auto" />
                  <h2 className="font-serif text-2xl text-foreground">Rejected</h2>
                  {adminNotes && <p className="text-red-400/80 text-sm">{adminNotes}</p>}
                  <p className="text-muted-foreground text-sm">Please resubmit with a clearer photo.</p>
                </>
              )}
            </div>

            {/* Benefits */}
            <div className="glass rounded-2xl p-5 space-y-3">
              <h2 className="font-serif text-lg text-foreground">Benefits of Verification</h2>
              {[
                'Verified badge displayed on your profile',
                'Higher priority in discovery results',
                'Access to verified-only features & events',
              ].map((benefit, i) => (
                <div key={i} className="flex items-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
                  <span className="text-foreground text-sm">{benefit}</span>
                </div>
              ))}
            </div>

            {/* Upload Section */}
            {canSubmit && (
              <div className="glass rounded-2xl p-5 space-y-4">
                <h2 className="font-serif text-lg text-foreground">Take a Selfie</h2>
                <p className="text-muted-foreground text-sm">Hold your ID next to your face so we can confirm your identity.</p>
                <p className="text-muted-foreground text-xs">PNG, JPEG, or WebP · up to {MAX_UPLOAD_LABEL}.</p>

                <div
                  onClick={() => {
                    if (!requestMutation.isPending) fileInputRef.current?.click();
                  }}
                  className="block w-full aspect-video rounded-2xl border-2 border-dashed border-border overflow-hidden cursor-pointer hover:border-border transition-colors"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    data-testid="input-selfie"
                    accept="image/png,image/jpeg,image/webp"
                    capture="user"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {previewUrl ? (
                    <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Camera className="w-10 h-10" />
                      <span className="text-sm">Tap to take a selfie or upload photo</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {file && !requestMutation.isPending && (
                    <button
                      type="button"
                      data-testid="button-retake-selfie"
                      onClick={clearSelection}
                      className="glass border border-border rounded-full px-5 py-3 text-foreground text-sm hover:glass-strong transition-all"
                    >
                      {currentStatus === 'rejected' ? 'Retake' : 'Clear'}
                    </button>
                  )}
                  <button
                    data-testid="button-submit-selfie"
                    onClick={handleSubmit}
                    disabled={!file || requestMutation.isPending}
                    className="btn-glow px-6 py-3 flex-1 text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none flex items-center justify-center gap-2"
                  >
                    {requestMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {requestMutation.isPending
                      ? 'Submitting…'
                      : currentStatus === 'rejected'
                        ? 'Resubmit for Review'
                        : 'Submit for Review'}
                  </button>
                </div>
                {requestMutation.isError && !requestMutation.isPending && (
                  <p className="text-red-400/80 text-xs text-center">
                    {normalizeApiError(requestMutation.error, 'Something went wrong. Tap submit to retry.').message}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
