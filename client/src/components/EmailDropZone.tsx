import { useState, useRef } from 'react';
import { Upload, Mail, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface EmailDropZoneProps {
  onEmailParsed: (data: {
    subject: string;
    from: string;
    body: string;
    orderNumber?: string;
    attachmentCount: number;
    filename: string;
    fileData: string; // base64
  }) => void;
}

export function EmailDropZone({ onEmailParsed }: EmailDropZoneProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await processFile(files[0]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processFile(files[0]);
    }
  };

  const processFile = async (file: File) => {
    setError(null);
    setSuccess(false);

    // Check file extension
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'eml' && ext !== 'msg') {
      setError(t('tickets.emailDropZone.invalidFormat'));
      return;
    }

    setIsProcessing(true);

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const base64Data = event.target?.result as string;
          const base64Content = base64Data.split(',')[1]; // Remove data:...;base64, prefix

          // Send to backend
          const response = await fetch('/api/parse-email', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`,
            },
            body: JSON.stringify({
              filename: file.name,
              fileData: base64Content,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to parse email');
          }

          const data = await response.json();
          
          setSuccess(true);
          onEmailParsed({
            ...data,
            filename: file.name,
            fileData: base64Content,
          });
          
          // Reset after 2 seconds
          setTimeout(() => {
            setSuccess(false);
          }, 2000);
        } catch (err: any) {
          setError(err.message || t('tickets.emailDropZone.parseError'));
        } finally {
          setIsProcessing(false);
        }
      };

      reader.onerror = () => {
        setError(t('tickets.emailDropZone.readError'));
        setIsProcessing(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(err.message || t('tickets.emailDropZone.parseError'));
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card
        className={`p-6 border-2 border-dashed cursor-pointer transition-all ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover-elevate'
        } ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        data-testid="email-drop-zone"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".eml,.msg"
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-email-file"
        />

        <div className="flex flex-col items-center justify-center gap-3 text-center">
          {isProcessing ? (
            <>
              <FileText className="h-12 w-12 text-primary animate-pulse" />
              <p className="text-sm font-medium">{t('tickets.emailDropZone.processing')}</p>
            </>
          ) : success ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="text-sm font-medium text-green-600">
                {t('tickets.emailDropZone.success')}
              </p>
            </>
          ) : (
            <>
              <Mail className="h-12 w-12 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium mb-1">
                  {t('tickets.emailDropZone.title')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('tickets.emailDropZone.subtitle')}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-2" />
                {t('tickets.emailDropZone.browse')}
              </Button>
            </>
          )}
        </div>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
