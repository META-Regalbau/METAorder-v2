import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

export default function SettingsPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [shopwareUrl, setShopwareUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [aiEnabled, setAiEnabled] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);

  // Fetch AI settings
  const { data: aiSettings, isLoading: aiSettingsLoading } = useQuery<{ enabled: boolean; hasApiKey: boolean }>({
    queryKey: ['/api/settings/ai'],
    retry: false,
  });

  useEffect(() => {
    if (aiSettings) {
      setAiEnabled(aiSettings.enabled);
    }
  }, [aiSettings]);

  const saveAiSettingsMutation = useMutation({
    mutationFn: async (data: { apiKey?: string; enabled: boolean }) => {
      const response = await apiRequest("POST", "/api/settings/ai", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings/ai'] });
      toast({
        title: t('ai.settingsSaved'),
        description: t('ai.settingsSavedDesc'),
      });
      setOpenaiApiKey("");
    },
    onError: (error: Error) => {
      toast({
        title: t('ai.settingsFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const response = await apiRequest('POST', '/api/settings/shopware/test', {
        shopwareUrl,
        apiKey,
        apiSecret,
      });

      toast({
        title: "Connection successful",
        description: "Successfully connected to Shopware API.",
      });
    } catch (error: any) {
      console.error("Connection test failed:", error);
      toast({
        title: "Connection failed",
        description: error.message || "Could not connect to Shopware API. Please check your credentials.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiRequest('POST', '/api/settings/shopware', {
        shopwareUrl,
        apiKey,
        apiSecret,
      });

      toast({
        title: "Settings saved",
        description: "Your Shopware connection settings have been updated successfully.",
      });
    } catch (error: any) {
      console.error("Save settings failed:", error);
      toast({
        title: "Save failed",
        description: error.message || "Could not save settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure your Shopware connection and preferences
        </p>
      </div>

      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          Shopware Admin API Configuration
        </h2>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2">Shopware URL</Label>
            <Input
              placeholder="https://your-shopware-store.com"
              value={shopwareUrl}
              onChange={(e) => setShopwareUrl(e.target.value)}
              data-testid="input-shopware-url"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The base URL of your Shopware 6 instance
            </p>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2">API Access Key</Label>
            <Input
              placeholder="Enter your API access key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono"
              data-testid="input-api-key"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Your Shopware Admin API access key
            </p>
          </div>

          <div>
            <Label className="text-sm font-medium mb-2">API Secret Key</Label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                placeholder="Enter your API secret key"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="font-mono pr-10"
                data-testid="input-api-secret"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setShowSecret(!showSecret)}
                data-testid="button-toggle-secret-visibility"
              >
                {showSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Your Shopware Admin API secret key (will be stored securely)
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button 
              variant="outline" 
              onClick={handleTestConnection}
              disabled={isTesting || isSaving || !shopwareUrl || !apiKey || !apiSecret}
              data-testid="button-test-connection"
            >
              {isTesting ? "Testing..." : "Test Connection"}
            </Button>
            <Button 
              onClick={handleSave}
              disabled={isSaving || isTesting || !shopwareUrl || !apiKey || !apiSecret}
              data-testid="button-save-settings"
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          {t('ai.aiIntegration')}
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t('ai.enableAi')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('ai.enableAiDesc')}
              </p>
            </div>
            <Switch
              checked={aiEnabled}
              onCheckedChange={setAiEnabled}
              data-testid="switch-ai-enabled"
            />
          </div>

          <div>
            <Label className="text-sm font-medium mb-2">{t('ai.apiKey')}</Label>
            <div className="relative">
              <Input
                type={showOpenaiKey ? "text" : "password"}
                placeholder={aiSettings?.hasApiKey ? "••••••••••••••••••••" : t('ai.apiKeyPlaceholder')}
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                className="font-mono pr-10"
                data-testid="input-openai-api-key"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                data-testid="button-toggle-openai-key-visibility"
              >
                {showOpenaiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('ai.apiKeyDesc')}
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <Button 
              onClick={() => saveAiSettingsMutation.mutate({ 
                apiKey: openaiApiKey || undefined, 
                enabled: aiEnabled 
              })}
              disabled={saveAiSettingsMutation.isPending}
              data-testid="button-save-ai-settings"
            >
              {saveAiSettingsMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          User Preferences
        </h2>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2">Default Items Per Page</Label>
            <Input
              type="number"
              defaultValue="25"
              min="10"
              max="200"
              data-testid="input-default-items-per-page"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Number of orders to display per page by default
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
