import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/i18n';
import { useReportUser } from '@workspace/api-client-react';

interface ReportUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportedUserId: number;
  reportedUserName: string;
  messageId?: number;
  onSuccess?: () => void;
}

const REASONS: { value: string; labelKey: TranslationKey }[] = [
  { value: 'harassment', labelKey: 'report.reasons.harassment' },
  { value: 'fake_profile', labelKey: 'report.reasons.fakeProfile' },
  { value: 'inappropriate_content', labelKey: 'report.reasons.inappropriateContent' },
  { value: 'spam', labelKey: 'report.reasons.spam' },
  { value: 'underage', labelKey: 'report.reasons.underage' },
  { value: 'scam', labelKey: 'report.reasons.scam' },
  { value: 'other', labelKey: 'report.reasons.other' },
];

export function ReportUserModal({
  isOpen,
  onClose,
  reportedUserId,
  reportedUserName,
  messageId,
  onSuccess,
}: ReportUserModalProps) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [desc, setDesc] = useState('');
  const reportMutation = useReportUser();

  // Reset form when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      setReason('');
      setDesc('');
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!reason) return;
    try {
      await reportMutation.mutateAsync({
        data: {
          reportedUserId,
          reason,
          description: desc.trim() || undefined,
          messageId,
        },
      });
      toast({ title: t('report.submitSuccess') });
      onSuccess?.();
      onClose();
    } catch {
      toast({ title: t('report.submitFailed'), variant: 'destructive' });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('report.title', { name: reportedUserName })}</DialogTitle>
          <DialogDescription>
            {t('report.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="report-reason">{t('report.reasonLabel')}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="report-reason">
                <SelectValue placeholder={t('report.reasonPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {t(r.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-desc">{t('report.detailsLabel')}</Label>
            <Textarea
              id="report-desc"
              placeholder={t('report.detailsPlaceholder')}
              value={desc}
              onChange={(e) => {
                if (e.target.value.length <= 500) setDesc(e.target.value);
              }}
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground text-right">{desc.length}/500</p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={reportMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={!reason || reportMutation.isPending}
            >
              {reportMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('report.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
