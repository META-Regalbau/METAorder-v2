import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function SettingsPage() {
  const { toast } = useToast();
  const [shopwareUrl, setShopwareUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  const handleSave = () => {
    console.log("Saving settings:", { shopwareUrl, apiKey });
    toast({
      title: "Settings saved",
      description: "Your Shopware connection settings have been updated.",
    });
    // TODO: Implement actual settings save
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure your Shopware connection and preferences
        </p>
      </div>

      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
          Shopware API Configuration
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
              type="password"
              placeholder="Enter your API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              data-testid="input-api-key"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Your Shopware API access key for authentication
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" data-testid="button-test-connection">
              Test Connection
            </Button>
            <Button onClick={handleSave} data-testid="button-save-settings">
              Save Settings
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
              data-testid="input-default-items-per-page"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
