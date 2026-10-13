import { useState, useRef } from 'react';
import { useLocation, Link } from 'wouter';
import {
  useGetMyCoachProfile,
  useGetMyCoachCredentials,
  useRequestUploadUrl,
  useFinalizeCoachCredential,
  useSubmitCoachVerification,
  getGetMyCoachProfileQueryKey,
  getGetMyCoachCredentialsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ShieldCheck, FileText, Video, User, CheckCircle,
  Upload, Loader2, AlertCircle, Star
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/i18n';

const STORAGE_KEY = 'coachVerifyData';
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function getStored() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

const STEPS = [
  { icon: ShieldCheck, label: 'Requirements' },
  { icon: FileText, label: 'Documents' },
  { icon: Video, label: 'Video Intro' },
  { icon: User, label: 'Background' },
  { icon: CheckCircle, label: 'Review' },
];

const STEP_TITLES = ['Coach Verification', 'Credential Documents', 'Video Introduction', 'Background & Qualifications', 'Review & Submit'];

export default function CoachVerify() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: coachProfile, isLoading } = useGetMyCoachProfile();
  const { data: credentials } = useGetMyCoachCredentials();
  const requestUploadMutation = useRequestUploadUrl();
  const finalizeCredentialMutation = useFinalizeCoachCredential();
  const submitMutation = useSubmitCoachVerification();

  const [step, setStep] = useState(0);
  const status = coachProfile?.verificationStatus ?? 'unsubmitted';
  const submitting = submitMutation.isPending;

  const stored = getStored();
  const [docName, setDocName] = useState<string>(stored.docName || '');
  const [docType, setDocType] = useState<string>(stored.docType || '');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [credentialId, setCredentialId] = useState<number | null>(null);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'finalizing' | 'success' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [videoUrl, setVideoUrl] = useState<string>(stored.videoUrl || '');
  const [fullName, setFullName] = useState<string>(stored.fullName || '');
  const [occupation, setOccupation] = useState<string>(stored.occupation || '');
  const [certifications, setCertifications] = useState<string>(stored.certifications || '');
  const [experience, setExperience] = useState<string>(stored.experience || '');
  const [location, setLocation] = useState<string>(stored.location || '');
  const docInputRef = useRef<HTMLInputElement>(null);

  const save = (extra?: Record<string, string>) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      docName, docType, videoUrl, fullName, occupation, certifications, experience, location,
      ...extra,
    }));
  };

  const uploadDocument = async (file: File) => {
    setUploadState('uploading');
    setUploadProgress(0);
    setUploadError('');
    try {
      const presign = await requestUploadMutation.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type,
          purpose: 'coach_credential',
        },
      });
      if (!presign.uploadToken) throw new Error(t('coachCredential.authorizationMissing'));

      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('PUT', presign.uploadURL);
        request.setRequestHeader('Content-Type', file.type);
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        };
        request.onload = () => request.status >= 200 && request.status < 300
          ? resolve()
          : reject(new Error(t('coachCredential.uploadFailed')));
        request.onerror = () => reject(new Error(t('coachCredential.uploadFailed')));
        request.send(file);
      });

      setUploadProgress(100);
      setUploadState('finalizing');
      const credential = await finalizeCredentialMutation.mutateAsync({
        data: {
          objectPath: presign.objectPath,
          uploadToken: presign.uploadToken,
          kind: docType === 'Professional Certificate' ? 'certification' : 'id_document',
          title: docType,
          originalName: file.name,
          contentType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png',
          size: file.size,
        },
      });
      setCredentialId(credential.id);
      setUploadState('success');
      queryClient.invalidateQueries({ queryKey: getGetMyCoachCredentialsQueryKey() });
      save({ docName: credential.originalName });
      toast({ title: t('coachCredential.uploaded'), description: t('coachCredential.ready') });
    } catch (error: any) {
      const message = error?.error || error?.message || t('coachCredential.uploadRetry');
      setUploadState('error');
      setUploadError(message);
      toast({ title: t('coachCredential.uploadFailed'), description: message, variant: 'destructive' });
    }
  };

  const handleDocFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!ALLOWED_DOCUMENT_TYPES.has(f.type)) {
      toast({ title: t('coachCredential.unsupportedType'), description: t('coachCredential.allowedTypes'), variant: 'destructive' });
      return;
    }
    if (f.size > MAX_DOCUMENT_SIZE) {
      toast({ title: t('coachCredential.tooLarge'), description: t('coachCredential.sizeLimit'), variant: 'destructive' });
      return;
    }
    setDocName(f.name);
    setDocFile(f);
    setCredentialId(null);
    void uploadDocument(f);
  };

  const handleSubmit = () => {
    if (!credentialId) {
      toast({ title: t('coachCredential.required'), description: t('coachCredential.waitForUpload'), variant: 'destructive' });
      return;
    }
    const summary = [
      `Full name: ${fullName}`,
      `Occupation: ${occupation}`,
      `Location: ${location}`,
      `Document: ${docType} (${docName})`,
      videoUrl ? `Video: ${videoUrl}` : null,
      certifications ? `Certifications: ${certifications}` : null,
      experience ? `Experience: ${experience}` : null,
    ].filter(Boolean).join('\n');
    submitMutation.mutate(
      { data: { notes: summary } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMyCoachProfileQueryKey() });
          toast({ title: 'Application submitted!', description: "We'll review within 3–5 business days." });
          navigate('/coach-dashboard');
        },
        onError: (err: any) => {
          toast({
            title: 'Submission failed',
            description: err?.error || 'Please try again in a moment.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[100dvh]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (!coachProfile) return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <div className="glass rounded-3xl p-8 max-w-sm w-full text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
        <h2 className="font-serif text-foreground text-xl">Coach Profile Required</h2>
        <p className="text-muted-foreground text-sm">Apply to become a coach first before submitting verification.</p>
        <Link href="/coaches/apply">
          <button className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full">Apply to Coach</button>
        </Link>
      </div>
    </div>
  );

  if (status === 'pending' || status === 'approved') return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <div className="glass rounded-3xl p-8 max-w-sm w-full text-center space-y-4">
        <div className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center glass ${status === 'approved' ? 'glow-cyan' : ''}`}>
          <ShieldCheck className={`w-10 h-10 ${status === 'approved' ? 'text-cyan-400' : 'text-yellow-400'}`} />
        </div>
        <h2 className="font-serif text-foreground text-2xl">
          {status === 'approved' ? 'Verified Coach' : 'Under Review'}
        </h2>
        <p className="text-muted-foreground text-sm">
          {status === 'approved'
            ? 'Your coach credentials are verified. The verified badge is live on your profile.'
            : "Your application is being reviewed. We'll notify you within 3–5 business days."}
        </p>
        <Link href="/coach-dashboard">
          <button className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full">Back to Dashboard</button>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--nav-border)' }}>
        <button onClick={() => step === 0 ? navigate('/coach-dashboard') : setStep(s => s - 1)}
          className="w-9 h-9 rounded-full glass flex items-center justify-center shrink-0">
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">Step {step + 1} of {STEPS.length}</p>
          <h1 className="font-serif text-lg text-foreground truncate">{STEP_TITLES[step]}</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Progress bar */}
        <div className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= step ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>

        {/* STEP 0 */}
        {step === 0 && (
          <>
            <div className="glass rounded-3xl p-6 text-center space-y-3">
              <div className="w-16 h-16 rounded-full glass glow-pink flex items-center justify-center mx-auto">
                <ShieldCheck className="w-8 h-8 text-primary" />
              </div>
              <h2 className="font-serif text-foreground text-xl">Get Coach Verified</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Verified coaches earn 3× more bookings and display a blue shield badge on their profile.
              </p>
            </div>
            <div className="glass rounded-2xl p-5 space-y-3">
              <h3 className="font-serif text-foreground text-lg">What you'll need</h3>
              {[
                { Icon: FileText, label: 'Government-issued ID or professional credential document' },
                { Icon: Video, label: 'A short video introduction (YouTube, Loom, or Vimeo URL)' },
                { Icon: User, label: 'Background, qualifications, and experience summary' },
                { Icon: Star, label: 'An active coach profile on LandOverSEA' },
              ].map(({ Icon, label }, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Icon className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <span className="text-foreground text-sm">{label}</span>
                </div>
              ))}
            </div>
            <div className="glass rounded-2xl p-4 border border-yellow-400/20">
              <p className="text-yellow-400/80 text-xs">Review takes 3–5 business days. You'll receive an email once complete.</p>
            </div>
            <button onClick={() => setStep(1)} className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full">
              Begin Verification →
            </button>
          </>
        )}

        {/* STEP 1 */}
        {step === 1 && (
          <>
            <div className="glass rounded-2xl p-5 space-y-3">
              <h3 className="font-serif text-foreground text-lg">{t('coachCredential.documentType')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {["Passport", "Driver's License", 'National ID', 'Professional Certificate'].map(t => (
                  <button key={t} onClick={() => { setDocType(t); save({ docType: t }); }}
                    className={`glass rounded-2xl px-3 py-3 text-sm text-left border transition-all ${
                      docType === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-white/25'
                    }`}>{t}</button>
                ))}
              </div>
            </div>
            <div className="glass rounded-2xl p-5 space-y-4">
              <h3 className="font-serif text-foreground text-lg">{t('coachCredential.uploadDocument')}</h3>
               <p className="text-muted-foreground text-sm">{t('coachCredential.allowedTypesAndSize')}</p>
               <button type="button" onClick={() => docInputRef.current?.click()}
                 disabled={!docType || uploadState === 'uploading' || uploadState === 'finalizing'}
                 className="w-full min-h-40 rounded-2xl border-2 border-dashed border-border overflow-hidden cursor-pointer hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none">
                 <FileText className="w-10 h-10" />
                  <span className="text-sm break-all px-4">{docName || t('coachCredential.chooseDocument')}</span>
                  {!docName && <span className="text-xs">{t('coachCredential.selectTypeFirst')}</span>}
               </button>
               <input ref={docInputRef} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={handleDocFile} />
               {(uploadState === 'uploading' || uploadState === 'finalizing') && (
                 <div className="space-y-2" role="status" aria-live="polite">
                   <div className="h-2 rounded-full bg-muted overflow-hidden">
                     <div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }} />
                   </div>
                   <p className="text-muted-foreground text-xs">
                      {uploadState === 'finalizing' ? t('coachCredential.securing') : t('coachCredential.uploading', { progress: uploadProgress })}
                   </p>
                 </div>
               )}
               {uploadState === 'success' && (
                 <p className="text-green-400 text-sm flex items-center gap-2" role="status">
                    <CheckCircle className="w-4 h-4" /> {t('coachCredential.complete')}
                 </p>
               )}
               {uploadState === 'error' && (
                 <div className="space-y-2" role="alert">
                   <p className="text-red-400 text-sm">{uploadError}</p>
                   <button type="button" disabled={!docFile} onClick={() => docFile && void uploadDocument(docFile)}
                     className="glass rounded-full px-4 py-2 text-sm text-foreground border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      {t('coachCredential.retry')}
                   </button>
                 </div>
               )}
               {credentials && credentials.length > 0 && uploadState === 'idle' && (
                  <p className="text-muted-foreground text-xs">{t('coachCredential.previouslySubmitted')}</p>
               )}
            </div>
             <button onClick={() => { save(); setStep(2); }} disabled={!docType || !credentialId || uploadState !== 'success'}
              className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none">
              Continue →
            </button>
          </>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <>
            <div className="glass rounded-2xl p-5 space-y-4">
              <h3 className="font-serif text-foreground text-lg">Video Introduction</h3>
              <p className="text-muted-foreground text-sm">Record a 60–90 second intro and paste the link. YouTube, Loom, and Vimeo all work.</p>
              <label className="text-muted-foreground text-xs">Video URL</label>
              <input type="url" placeholder="https://loom.com/share/..." value={videoUrl}
                onChange={e => { setVideoUrl(e.target.value); save({ videoUrl: e.target.value }); }}
                className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none placeholder:text-muted-foreground text-sm" />
            </div>
            <div className="glass rounded-2xl p-4 space-y-2">
              <h4 className="font-serif text-foreground">Tips for a great intro</h4>
              {[
                'Introduce your name and coaching specialty',
                'Mention your cultural background and languages',
                'Explain your coaching approach in 1–2 sentences',
                'Speak clearly — clients watch this before booking',
              ].map((tip, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-primary text-xs mt-1 shrink-0">•</span>
                  <span className="text-muted-foreground text-sm">{tip}</span>
                </div>
              ))}
            </div>
            <button onClick={() => { save(); setStep(3); }} disabled={!videoUrl}
              className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none">
              Continue →
            </button>
            <button onClick={() => setStep(3)} className="w-full text-muted-foreground text-sm py-2 hover:text-muted-foreground transition-colors">
              Skip for now
            </button>
          </>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <>
            <div className="glass rounded-2xl p-5 space-y-4">
              <h3 className="font-serif text-foreground text-lg">Personal Details</h3>
              {[
                { label: 'Full Legal Name', val: fullName, setVal: setFullName, key: 'fullName', ph: 'As it appears on your ID' },
                { label: 'Current Occupation / Title', val: occupation, setVal: setOccupation, key: 'occupation', ph: 'e.g. Certified Life Coach' },
                { label: 'Location / Country', val: location, setVal: setLocation, key: 'location', ph: 'e.g. Tokyo, Japan' },
              ].map(({ label, val, setVal, key, ph }) => (
                <div key={key} className="space-y-1">
                  <label className="text-muted-foreground text-xs">{label}</label>
                  <input type="text" placeholder={ph} value={val}
                    onChange={e => { setVal(e.target.value); save({ [key]: e.target.value }); }}
                    className="glass-input w-full rounded-2xl px-3 py-2.5 outline-none placeholder:text-muted-foreground text-sm" />
                </div>
              ))}
            </div>
            <div className="glass rounded-2xl p-5 space-y-4">
              <h3 className="font-serif text-foreground text-lg">Credentials & Experience</h3>
              <div className="space-y-1">
                <label className="text-muted-foreground text-xs">Certifications & Qualifications</label>
                <textarea rows={3} placeholder="List relevant certifications, degrees, or training..."
                  value={certifications}
                  onChange={e => { setCertifications(e.target.value); save({ certifications: e.target.value }); }}
                  className="glass-input w-full rounded-2xl p-3 resize-none outline-none placeholder:text-muted-foreground text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-muted-foreground text-xs">Coaching Experience</label>
                <textarea rows={4} placeholder="Describe your coaching background, client results, and areas of expertise..."
                  value={experience}
                  onChange={e => { setExperience(e.target.value); save({ experience: e.target.value }); }}
                  className="glass-input w-full rounded-2xl p-3 resize-none outline-none placeholder:text-muted-foreground text-sm" />
              </div>
            </div>
            <button onClick={() => { save(); setStep(4); }} disabled={!fullName || !occupation}
              className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none">
              Review Application →
            </button>
          </>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <>
            <div className="glass rounded-2xl p-5 space-y-3">
              <h3 className="font-serif text-foreground text-lg">Application Summary</h3>
              {[
                { label: 'Coach Profile', value: coachProfile.displayName },
                { label: 'Document Type', value: docType || '—' },
                { label: 'Document File', value: docName || '—' },
                { label: 'Video Intro', value: videoUrl || 'Not provided' },
                { label: 'Full Name', value: fullName || '—' },
                { label: 'Occupation', value: occupation || '—' },
                { label: 'Location', value: location || '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-4 py-1 border-b border-white/5 last:border-0">
                  <span className="text-muted-foreground text-sm shrink-0">{label}</span>
                  <span className="text-foreground text-sm text-right truncate max-w-[60%]">{value}</span>
                </div>
              ))}
            </div>
            {certifications && (
              <div className="glass rounded-2xl p-4">
                <p className="text-muted-foreground text-xs mb-1">Certifications</p>
                <p className="text-foreground text-sm">{certifications}</p>
              </div>
            )}
            <div className="glass rounded-2xl p-4 border border-primary/20">
              <p className="text-muted-foreground text-xs leading-relaxed">By submitting, you confirm all information is accurate and grant LandOverSEA permission to review your credentials for coach verification.</p>
            </div>
             <button onClick={handleSubmit} disabled={submitting || !credentialId}
              className="btn-glow px-6 py-3 w-full text-white font-semibold rounded-full disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:shadow-none disabled:bg-none flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Submitting...' : 'Submit Application'}
            </button>
            <button onClick={() => setStep(3)} className="w-full text-muted-foreground text-sm py-2 hover:text-muted-foreground transition-colors">
              ← Edit Details
            </button>
          </>
        )}
      </div>
    </div>
  );
}
